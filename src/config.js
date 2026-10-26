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

const KEY = "kitingVersus-web.config.v1";

export const DEFAULTS = {
  version: 1,
  arena: { w: 3200, h: 1900 },
  camera: { zoom: 1, fov: 42, distance: 850 },
  combat: {
    enemyRangeScale: 1,
    enemySpeedScale: 1,
    enemyDamageScale: 1,
    enemyHpScale: 1,
    playerHpScale: 1,
    playerAttackSpeedScale: 1,
    playerHitRadius: 45,
    showRanges: false,
    cameraLocked: true,
    attackMoveTargetNearest: true,
    cameraPitch: 55,
  },
  arenaSettings: {
    maxScore: 5,
    duration: 180,
    powerupsEnabled: true,
    powerupSpawnInterval: { min: 12, max: 20 },
    maxPowerups: 3,
    powerups: {
      heal: { enabled: true, hpPercent: 0.25 },
      atkSpeed: { enabled: true, multiplier: 1.2, duration: 5 },
      movSpeed: { enabled: true, multiplier: 1.3, duration: 5 },
      vamp: { enabled: true, lifesteal: 0.2, duration: 8 },
      atkSpeedNerf: { enabled: true, multiplier: 0.8, duration: 5 },
      movSpeedNerf: { enabled: true, multiplier: 0.7, duration: 5 },
    },
  },
  champions: {},
  drills: {},
  kitingVersus: {},
  // Drill mode toggles (admin panel). Only kiting-spacing and kiting-defensive enabled.
  modosDrills: {
    "kiting-spacing": true,
    "kiting-defensive": true,
    "kiting-peel": false,
    "dodge-skillshot": false,
    "dodge-shoot-dodge": false,
    "sg-kiting-microgame": false,
    "sg-kiting-dodge": false,
  },
};

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
  } catch {}
}

let state = read();
let listeners = [];

export const config = {
  get state() {
    return state;
  },

  reload() {
    state = read();
    persist(state);
    return state;
  },

  set(patch) {
    state = deepMerge(structuredClone(DEFAULTS), deepMerge(state, patch));
    persist(state);
    emit();
    return state;
  },

  patch(section, values) {
    state[section] = deepMerge(state[section] ?? {}, values);
    persist(state);
    emit();
    return state;
  },

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

  clearChampionField(alias, field) {
    const entry = state.champions?.[alias];
    if (!entry) return;
    delete entry[field];
    if (!Object.keys(entry).length) delete state.champions[alias];
    persist(state);
    emit();
  },

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

  clearDrillField(drillId, field) {
    const entry = state.drills?.[drillId];
    if (!entry) return;
    delete entry[field];
    if (!Object.keys(entry).length) delete state.drills[drillId];
    persist(state);
    emit();
  },

  kitingVersusLevel(key, level) {
    return state.kitingVersus?.[key]?.[String(level)] || null;
  },

  setKitingVersusLevel(key, level, values) {
    state.kitingVersus = state.kitingVersus || {};
    if (values === null) {
      if (state.kitingVersus[key]) {
        delete state.kitingVersus[key][String(level)];
        if (!Object.keys(state.kitingVersus[key]).length) delete state.kitingVersus[key];
      }
    } else {
      state.kitingVersus[key] = state.kitingVersus[key] || {};
      state.kitingVersus[key][String(level)] = values;
    }
    persist(state);
    emit();
  },

  clearKitingVersus(key) {
    if (state.kitingVersus) delete state.kitingVersus[key];
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

export function applyChampionOverrides(champions) {
  for (const champion of champions) {
    const override = state.champions?.[champion.alias];
    if (!override || !champion.stats) continue;
    const stats = champion.stats;
    for (const field of CHAMPION_FIELDS) {
      if (field === "attackSpeed") continue;
      const value = override[field];
      if (typeof value === "number" && Number.isFinite(value)) stats[field] = value;
    }
    if (typeof override.attackSpeed === "number" && override.attackSpeed > 0) {
      const baseAaPerSec = 1 / stats.attackPeriod;
      stats.attackSpeed = baseAaPerSec * override.attackSpeed;
      stats.attackPeriod = 1 / stats.attackSpeed;
    }
    if (typeof override.isMelee === "boolean") stats.isMelee = override.isMelee;
  }
  return champions;
}

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