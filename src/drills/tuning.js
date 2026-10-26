/**
 * Tela de balanceamento: schema de valores editáveis + persistência + aplicação.
 *
 * Os valores editáveis são gravados como "overrides" por treino/nível e
 * aplicados sobre `level.params` quando a lista de treinos é montada.
 * Nada aqui altera o motor dos treinos: é apenas uma camada de configuração.
 */

const STORAGE_KEY = "kiting-versus.tuning.v1";

/* ─────────────────────────── persistência ─────────────────────────── */

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/** Todos os overrides gravados: { [drillId]: { [levelKey]: patch } } */
export function loadOverrides() {
  return readStore();
}

/** Salva o patch de um nível (levelKey = índice do nível ou "all"). */
export function saveOverride(drillId, levelKey, patch) {
  const store = readStore();
  if (!store[drillId]) store[drillId] = {};
  if (patch === null || patch === undefined) delete store[drillId][levelKey];
  else store[drillId][levelKey] = patch;
  writeStore(store);
  return store;
}

/** Remove os overrides de um treino (ou de todos). */
export function clearOverrides(drillId = null) {
  const store = readStore();
  if (drillId) delete store[drillId];
  else Object.keys(store).forEach((k) => delete store[k]);
  writeStore(store);
  return store;
}

export function exportOverrides() {
  return JSON.stringify(readStore(), null, 2);
}

export function importOverrides(json) {
  const parsed = JSON.parse(json);
  if (!parsed || typeof parsed !== "object") throw new Error("JSON inválido");
  writeStore(parsed);
  return parsed;
}

/* ─────────────────────────── merge / aplicação ─────────────────────────── */

function isObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/** Merge profundo (patch tem prioridade). */
export function deepMerge(base, patch) {
  if (!isObject(patch)) return patch === undefined ? base : patch;
  const out = isObject(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (isObject(value) && isObject(out[key])) out[key] = deepMerge(out[key], value);
    else out[key] = value;
  }
  return out;
}

/**
 * Aplica os overrides nos drills (mutando level.params).
 * - chave de nível = índice do nível (1-based) ou "all" (todos os níveis)
 */
export function applyOverrides(drills) {
  const store = readStore();
  for (const drill of drills || []) {
    const perDrill = store[drill.id];
    if (!perDrill) continue;
    for (const level of drill.levels || []) {
      const key = String(level.index);
      const patch = perDrill[key] || perDrill.all;
      if (!patch) continue;
      level.params = deepMerge(level.params || {}, patch);
    }
  }
  return drills;
}

/* ─────────────────────────── schema de campos ─────────────────────────── */

/** Metadados por chave de param (label, grupo, limites). */
const KEY_META = {
  duration: { label: "Duração (s)", group: "Tempos", min: 0, max: 900, step: 5 },
  readyTime: { label: "Tempo de preparação (s)", group: "Tempos", min: 0, max: 10, step: 0.5 },
  spread: { label: "Espalhamento dos inimigos", group: "Inimigos", min: 0.1, max: 3, step: 0.05 },
  dummiesParaPassar: { label: "Dummies para passar", group: "Objetivo", min: 1, max: 100, step: 1 },
  allyHp: { label: "HP do aliado", group: "Aliado", min: 50, max: 6000, step: 50 },
  radius: { label: "Raio de spawn (px)", group: "Posicionamento", min: 100, max: 2500, step: 20 },
  cooldown: { label: "Cooldown do caster (s)", group: "Tempos", min: 0.2, max: 12, step: 0.1 },
  speedScale: { label: "Escala de velocidade", group: "Inimigos", min: 0.1, max: 3, step: 0.05 },
  punish: { label: "Modo punição", group: "Regras", type: "bool" },

  playerHpScale: { label: "Multiplicador de HP do player", group: "Player", min: 0.1, max: 20, step: 0.1 },
  playerStats: { label: "Atributos do player", group: "Player" },

  enemies: { label: "Inimigos", group: "Inimigos" },
  casters: { label: "Casters", group: "Inimigos" },

  // Supervivencia
  dummyCount: { label: "Dummies simultâneos", group: "Inimigos", min: 1, max: 10, step: 1 },
  dummyHp: { label: "HP do dummy", group: "Inimigos", min: 10, max: 5000, step: 10 },
  dummyHitsToKill: { label: "Hits para matar o dummy", group: "Inimigos", min: 1, max: 20, step: 1 },
  dummyLifeTime: { label: "Tempo de vida do dummy (s)", group: "Tempos", min: 1, max: 60, step: 1 },
  dummyAttackDamagePct: { label: "Dano do dummy (% da vida do player)", group: "Inimigos", min: 0, max: 1, step: 0.01, percent: true },
  dummyAttackWait: { label: "Espera antes do 1º ataque (s)", group: "Tempos", min: 0, max: 30, step: 0.5 },
  dummyAttackPeriod: { label: "Intervalo entre ataques (s)", group: "Tempos", min: 0.1, max: 10, step: 0.1 },
  dummyAttackRange: { label: "Alcance de ataque do dummy", group: "Inimigos", min: 100, max: 2000, step: 10 },
  dummyRewardHp: { label: "HP recuperado por kill", group: "Recompensas", min: 0, max: 2000, step: 10 },
  dummyRewardScore: { label: "Pontos por kill", group: "Recompensas", min: 0, max: 1000, step: 10 },
  telegraphFlashAt: { label: "Começa a piscar em vermelho (% do ciclo)", group: "Visual", min: 0, max: 1, step: 0.05, percent: true },
  drainInterval: { label: "Intervalo da drenagem (s)", group: "Tempos", min: 1, max: 120, step: 1 },
  drainFirst: { label: "Primeiro tick de drenagem", group: "Drenagem", min: 0, max: 2000, step: 10 },
  drainStep: { label: "Aumento por tick", group: "Drenagem", min: 0, max: 2000, step: 10 },
  drainCapPct: { label: "Teto da drenagem (% da vida máx.)", group: "Drenagem", min: 0, max: 1, step: 0.01, percent: true },
};

const PLAYER_STAT_META = {
  health: { label: "Vida do player", min: 50, max: 10000, step: 50 },
  attackDamage: { label: "Dano de ataque", min: 0, max: 1000, step: 1 },
  attackRange: { label: "Alcance de ataque", min: 50, max: 2500, step: 10 },
  attackSpeed: { label: "Ataques por segundo", min: 0.1, max: 10, step: 0.05 },
  speed: { label: "Velocidade de movimento", min: 50, max: 1500, step: 10 },
};

const ENEMY_META = {
  role: { label: "Papel", type: "text" },
  behaviour: { label: "Comportamento", type: "select", options: ["melee", "ranged", "caster", "stationary"] },
  hp: { label: "HP", min: 10, max: 20000, step: 10 },
  attackDamage: { label: "Dano", min: 0, max: 3000, step: 5 },
  attackRange: { label: "Alcance de ataque", min: 0, max: 2500, step: 10 },
  attackPeriod: { label: "Periodo de ataque (s)", min: 0.1, max: 10, step: 0.05 },
  moveSpeed: { label: "Velocidade de movimento", min: 0, max: 1500, step: 10 },
  damageScale: { label: "Escala de dano", min: 0, max: 5, step: 0.05 },
  attackSpeedScale: { label: "Escala de vel. de ataque", min: 0.1, max: 5, step: 0.05 },
  speedScale: { label: "Escala de movimento", min: 0.1, max: 3, step: 0.05 },
  range: { label: "Distância preferida", min: 100, max: 2500, step: 20 },
  spell: { label: "Spell (Q/W/E/R)", type: "text" },
  lives: { label: "Vidas", min: 1, max: 20, step: 1 },
};

const CASTER_META = {
  hp: { label: "HP", min: 10, max: 20000, step: 10 },
  attackDamage: { label: "Dano", min: 0, max: 3000, step: 5 },
  moveSpeed: { label: "Velocidade de movimento", min: 0, max: 1500, step: 10 },
  range: { label: "Distância preferida", min: 100, max: 2500, step: 20 },
  cooldown: { label: "Cooldown (s)", min: 0.2, max: 15, step: 0.1 },
  casterTimer: { label: "Primeiro disparo (s)", min: 0, max: 15, step: 0.1 },
};

/** Chaves de topo conhecidas por treino (ordem de exibição). */
const TOP_FIELDS_BY_DRILL = {
  "kiting-spacing": ["duration", "spread", "dummiesParaPassar", "dummyHitsToKill", "dummyLifeTime", "playerHpScale", "playerStats", "enemies"],
  "kiting-defensive": ["duration", "spread", "playerHpScale", "playerStats", "enemies"],
  "kiting-peel": ["duration", "allyHp", "playerHpScale", "playerStats", "enemies"],
  "kiting-survival": [
    "duration", "readyTime", "playerHpScale", "playerStats",
    "dummyCount", "dummyHp", "dummyAttackDamagePct", "dummyAttackRange",
    "dummyAttackWait", "dummyAttackPeriod", "telegraphFlashAt",
    "drainInterval", "drainFirst", "drainStep", "drainCapPct",
    "dummyRewardHp", "dummyRewardScore",
  ],
  "dodge-skillshot": ["duration", "radius", "speedScale", "cooldown", "playerHpScale", "playerStats", "casters"],
  "sg-kiting-microgame": ["duration", "playerHpScale", "playerStats", "enemies"],
  "sg-kiting-dodge": ["duration", "playerHpScale", "playerStats", "enemies"],
};

function metaFor(key, fallback = {}) {
  return KEY_META[key] || { label: key, group: "Outros", min: 0, max: 10000, step: 1, ...fallback };
}

/**
 * Gera a lista de campos editáveis para um drill + nível.
 * Cada campo: { path: [..], key, label, group, type, min, max, step, percent }
 */
export function fieldsFor(drill, level) {
  const params = level?.params || {};
  const known = TOP_FIELDS_BY_DRILL[drill.id] || Object.keys(params).filter((k) => !Array.isArray(params[k]));
  const fields = [];
  const seen = new Set();

  const push = (path, meta, groupOverride) => {
    const key = path[path.length - 1];
    const id = path.join(".");
    if (seen.has(id)) return;
    seen.add(id);
    fields.push({
      path,
      id,
      key,
      label: meta.label || key,
      group: groupOverride || meta.group || "Outros",
      type: meta.type || "number",
      min: meta.min,
      max: meta.max,
      step: meta.step,
      options: meta.options,
      percent: meta.percent,
      zeroIsDefault: meta.zeroIsDefault,
    });
  };

  for (const key of known) {
    const meta = metaFor(key);
    if (meta.type === "bool") {
      push([key], meta);
      continue;
    }
    if (key === "playerStats") {
      for (const [sub, subMeta] of Object.entries(PLAYER_STAT_META)) {
        push(["playerStats", sub], { ...subMeta, group: "Player", zeroIsDefault: true });
      }
      continue;
    }
    if (key === "enemies") {
      const list = Array.isArray(params.enemies) ? params.enemies : [];
      list.forEach((spec, i) => {
        for (const [sub, subMeta] of Object.entries(ENEMY_META)) {
          if (spec[sub] === undefined && !["role", "behaviour"].includes(sub)) continue;
          push(["enemies", i, sub], { ...subMeta, group: `Inimigo ${i + 1}` });
        }
      });
      continue;
    }
    if (key === "casters") {
      const list = Array.isArray(params.casters) ? params.casters : [];
      list.forEach((spec, i) => {
        for (const [sub, subMeta] of Object.entries(CASTER_META)) {
          if (spec[sub] === undefined) continue;
          push(["casters", i, sub], { ...subMeta, group: `Caster ${i + 1}` });
        }
      });
      continue;
    }
    // valor simples
    if (params[key] === undefined && key !== "duration") continue;
    push([key], meta);
  }

  return fields;
}

/** Quais arrays de inimigos/casters existem no nível (para add/remove). */
export function listGroups(drill, level) {
  const params = level?.params || {};
  const groups = [];
  if (Array.isArray(params.enemies)) groups.push({ key: "enemies", label: "Inimigos", items: params.enemies });
  if (Array.isArray(params.casters)) groups.push({ key: "casters", label: "Casters", items: params.casters });
  return groups;
}

/** Lê um valor por caminho (ex.: ["enemies", 0, "hp"]). */
export function getByPath(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}

/** Escreve um valor por caminho, criando objetos intermediários. */
export function setByPath(obj, path, value) {
  let cur = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (cur[key] === null || typeof cur[key] !== "object") {
      cur[key] = typeof path[i + 1] === "number" ? [] : {};
    }
    cur = cur[key];
  }
  cur[path[path.length - 1]] = value;
  return obj;
}
