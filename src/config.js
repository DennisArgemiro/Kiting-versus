/**
 * Runtime configuration.
 *
 * Everything the admin screen can change lives here. The values are merged
 * over DEFAULTS, persisted in localStorage and applied to the live game
 * objects (arena, champions, enemies, drills, camera) by main.js.
 *
 * Design rules:
 *   - a missing key always falls back to the default, so old saves and
 *     partially filled import files keep working;
 *   - only numbers are accepted for numeric fields (see `num`), which keeps a
 *     hand-edited JSON from turning the simulation into NaN soup;
 *   - the module never imports game modules, so there are no cycles.
 */

const KEY = "skillgap-web.config.v1";

export const DEFAULTS = {
  version: 1,
  // The lane segment used by every drill, in League of Legends game units.
  // 3200 x 1900 is roughly twice the old 2400 x 1400 - enough room to kite
  // without walking off the map.
  arena: { w: 3200, h: 1900 },
  // Camera framing. `zoom` multiplies the distance. Height is derived from distance * tan(pitch).
  camera: { zoom: 1, fov: 42, distance: 850 },
  // Global multipliers applied on top of the per-level tuning.
  combat: {
    enemyRangeScale: 1,
    enemySpeedScale: 1,
    enemyDamageScale: 1,
    enemyHpScale: 1,
    playerHpScale: 1,
    playerAttackSpeedScale: 1,
    playerHitRadius: 45,
    showRanges: true,
    cameraLocked: true,
    attackMoveTargetNearest: true,
    cameraPitch: 55, // degrees from horizontal down to focus point; lower = flatter LoL-style
  },
  // alias -> partial champion stats
  champions: {},
  // drillId -> partial params (duration, enemyCount, speedScale, ...)
  drills: {},
  // key -> level -> full/partial Firestore level override.  A saved object is
  // merged over the recovered snapshot at drill-construction time, so the
  // admin can edit any recovered numeric field without re-running REA.
  skillgap: {},
};

/** Stats the admin screen may override, in the order it shows them. */
export const CHAMPION_FIELDS = [
  "health",
  "attackDamage",
  "attackRange",
  "attackSpeed",
  "attackCastTime",
  "movementSpeed",
  "projectileSpeed",
  "armor",
];

export const ARENA_LIMITS = { minW: 1200, maxW: 9000, minH: 900, maxH: 7000 };

const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

function deepMerge(base, patch) {
  if (!isObject(patch)) return base;
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    return deepMerge(structuredClone(DEFAULTS), JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function persist(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage disabled: settings apply for this session only */
  }
}

let state = read();
let listeners = [];

export const config = {
  get state() {
    return state;
  },

  /** Re-read from localStorage (used by the automated driver). */
  reload() {
    state = read();
    persist(state);
    return state;
  },

  /** Merge a patch over the whole config tree. */
  set(patch) {
    state = deepMerge(structuredClone(DEFAULTS), deepMerge(state, patch));
    persist(state);
    emit();
    return state;
  },

  /** Merge values into one top-level section (arena, camera, combat, ...). */
  patch(section, values) {
    state[section] = deepMerge(state[section] ?? {}, values);
    persist(state);
    emit();
    return state;
  },

  /** Store a per-champion override. `null` removes it. */
  setChampion(alias, values) {
    if (values === null) delete state.champions[alias];
    else state.champions[alias] = { ...(state.champions[alias] || {}), ...values };
    persist(state);
    emit();
  },

  clearChampion(alias) {
    delete state.champions[alias];
    persist(state);
    emit();
  },

  /** Remove a single champion override (the "reset field" button). */
  clearChampionField(alias, field) {
    const entry = state.champions?.[alias];
    if (!entry) return;
    delete entry[field];
    if (!Object.keys(entry).length) delete state.champions[alias];
    persist(state);
    emit();
  },

  /** Store a per-drill override. `null` removes it. */
  setDrill(drillId, values) {
    if (values === null) delete state.drills[drillId];
    else state.drills[drillId] = { ...(state.drills[drillId] || {}), ...values };
    persist(state);
    emit();
  },

  clearDrill(drillId) {
    delete state.drills[drillId];
    persist(state);
    emit();
  },

  /** Remove a single drill override (the "reset field" button). */
  clearDrillField(drillId, field) {
    const entry = state.drills?.[drillId];
    if (!entry) return;
    delete entry[field];
    if (!Object.keys(entry).length) delete state.drills[drillId];
    persist(state);
    emit();
  },

  /** A saved override for one real Skill Gap level, or null. */
  skillgapLevel(key, level) {
    return state.skillgap?.[key]?.[String(level)] || null;
  },

  /** Replace the override for a level.  `null` restores the snapshot. */
  setSkillgapLevel(key, level, values) {
    state.skillgap = state.skillgap || {};
    if (values === null) {
      if (state.skillgap[key]) {
        delete state.skillgap[key][String(level)];
        if (!Object.keys(state.skillgap[key]).length) delete state.skillgap[key];
      }
    } else {
      state.skillgap[key] = state.skillgap[key] || {};
      state.skillgap[key][String(level)] = values;
    }
    persist(state);
    emit();
  },

  clearSkillgap(key) {
    if (state.skillgap) delete state.skillgap[key];
    persist(state);
    emit();
  },

  reset() {
    state = structuredClone(DEFAULTS);
    persist(state);
    emit();
    return state;
  },

  exportJSON() {
    return JSON.stringify(state, null, 2);
  },

  importJSON(text) {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) throw new Error("O JSON precisa ser um objeto.");
    state = deepMerge(structuredClone(DEFAULTS), parsed);
    persist(state);
    emit();
    return state;
  },

  onChange(fn) {
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((f) => f !== fn);
    };
  },

  // ── typed getters ────────────────────────────────────────────────
  arena() {
    return {
      x: 0,
      y: 0,
      w: Math.round(num(state.arena?.w, DEFAULTS.arena.w)),
      h: Math.round(num(state.arena?.h, DEFAULTS.arena.h)),
    };
  },

  camera() {
    return {
      zoom: num(state.camera?.zoom, DEFAULTS.camera.zoom),
      fov: num(state.camera?.fov, DEFAULTS.camera.fov),
      distance: num(state.camera?.distance, DEFAULTS.camera.distance),
    };
  },

  combat() {
    const c = state.combat || {};
    return {
      enemyRangeScale: num(c.enemyRangeScale, 1),
      enemySpeedScale: num(c.enemySpeedScale, 1),
      enemyDamageScale: num(c.enemyDamageScale, 1),
      enemyHpScale: num(c.enemyHpScale, 1),
      playerHpScale: num(c.playerHpScale, 1),
      playerAttackSpeedScale: num(c.playerAttackSpeedScale, 1),
      playerHitRadius: num(c.playerHitRadius, 45),
      showRanges: c.showRanges !== false,
      cameraLocked: c.cameraLocked !== false,
      attackMoveTargetNearest: c.attackMoveTargetNearest !== false,
      cameraPitch: num(c.cameraPitch, 30),
    };
  },

  champion(alias) {
    return state.champions?.[alias] || null;
  },

  drill(drillId) {
    return state.drills?.[drillId] || null;
  },
};

function emit() {
  for (const fn of listeners) {
    try {
      fn(state);
    } catch (err) {
      console.error("config listener failed:", err);
    }
  }
}

// ─────────────────────────── application helpers ───────────────────────────

/**
 * Writes the champion overrides into a mutable champion list and returns it.
 * Call it on a fresh clone of the base data, never on the pristine source.
 */
export function applyChampionOverrides(champions) {
  for (const champion of champions) {
    const override = state.champions?.[champion.alias];
    if (!override || !champion.stats) continue;
    const stats = champion.stats;
    for (const field of CHAMPION_FIELDS) {
      if (field === "attackSpeed") continue; // derived below, keeps period in sync
      const value = override[field];
      if (typeof value === "number" && Number.isFinite(value)) stats[field] = value;
    }
    if (typeof override.attackSpeed === "number" && override.attackSpeed > 0) {
      stats.attackSpeed = override.attackSpeed;
      stats.attackPeriod = 1 / override.attackSpeed;
    }
    if (typeof override.isMelee === "boolean") stats.isMelee = override.isMelee;
  }
  return champions;
}

/**
 * Merges the per-drill overrides into a level's params.
 *
 * `enemyCount` grows or shrinks the roster without editing every level:
 * extra enemies are clones of the existing specs with a bumped seed, which
 * is exactly how the hand-written level tables add a second partner.
 */
export function applyDrillOverrides(drillId, params) {
  const override = state.drills?.[drillId];
  if (!override) return params;

  const next = { ...params };
  const duration = num(override.duration, NaN);
  if (duration > 0) next.duration = duration;

  const hpScale = num(override.playerHpScale, NaN);
  if (hpScale > 0) next.playerHpScale = hpScale;

  const spread = num(override.spread, NaN);
  if (spread > 0) next.spread = spread;

  const speedScale = num(override.speedScale, NaN);
  if (speedScale > 0) next.speedScale = speedScale;

  const cooldown = num(override.cooldown, NaN);
  if (cooldown > 0) next.cooldown = cooldown;

  const radius = num(override.radius, NaN);
  if (radius > 0) next.radius = radius;

  const count = Math.round(num(override.enemyCount, NaN));
  if (count > 0) {
    if (Array.isArray(next.enemies)) next.enemies = fitRoster(next.enemies, count);
    if (Array.isArray(next.casters)) next.casters = fitRoster(next.casters, count);
  }
  return next;
}

function fitRoster(roster, count) {
  if (!roster.length) return roster;
  const out = [];
  for (let i = 0; i < count; i++) {
    const base = roster[i % roster.length];
    out.push(i < roster.length ? { ...base } : { ...base, seed: (base.seed ?? 0) + Math.floor(i / roster.length) });
  }
  return out;
}
