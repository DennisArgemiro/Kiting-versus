/**
 * Ponte entre os dados recuperados do Skill Gap (Firestore) e o motor web.
 *
 * O snapshot é gerado por `skillgap-re/build_skillgap_data.py` e carregado
 * uma única vez em `main.js`.  Nada aqui importa o motor: são apenas funções
 * puras de leitura/normalização, para que kiting.js e dodging.js possam montar
 * os níveis reais sem criar ciclos.
 */

import { config } from "../config.js";

const finite = (v, fallback = null) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);

function mergeOverride(level, override) {
  if (!override) return level;
  const out = { ...level };
  for (const [key, value] of Object.entries(override)) {
    out[key] = isObject(value) && isObject(level[key]) ? { ...level[key], ...value } : value;
  }
  return out;
}

export function training(snapshot, key) {
  return snapshot?.trainings?.[key] || null;
}

export function levelsOf(snapshot, key) {
  const levels = training(snapshot, key)?.levels || [];
  return levels.map((level) => mergeOverride(level, config.skillgapLevel(key, level.level)));
}

export function realLevel(snapshot, key, index) {
  const levels = levelsOf(snapshot, key);
  return levels.find((level) => Number(level.level) === Number(index)) || levels[index - 1] || null;
}

/** Duração jogável. 3/5 nos docs são minutos; 60 já está em segundos. */
export function durationOf(level, fallback = 60) {
  return Math.max(10, finite(level?.durationSeconds, fallback));
}

/** Uma cópia do campeão com os atributos do documento real aplicados. */
export function withRealStats(data, stats, extra = {}) {
  if (!data) return data;
  if (!stats && !Object.keys(extra).length) return data;

  const clone = { ...data, stats: { ...(data.stats || {}) } };
  const s = clone.stats;

  const health = finite(stats?.health);
  if (health !== null && health > 0) s.health = health;

  const speed = finite(stats?.speed);
  if (speed !== null && speed > 0) s.movementSpeed = speed;

  const ad = finite(stats?.attackDamage);
  if (ad !== null && ad >= 0) s.attackDamage = ad;

  const as = finite(stats?.attackSpeed);
  if (as !== null && as > 0) {
    s.attackSpeed = as;
    s.attackPeriod = 1 / as;
  }

  const range = finite(stats?.attackRange);
  if (range !== null && range > 0) s.attackRange = range;

  const windup = finite(stats?.windUpPercentage);
  if (windup !== null && windup > 0 && s.attackPeriod > 0) {
    s.attackCastTime = s.attackPeriod * windup;
  }

  if (extra.attackRange !== undefined) s.attackRange = extra.attackRange;
  if (extra.isMelee !== undefined) s.isMelee = extra.isMelee;

  return clone;
}

/**
 * Aplica os stats reais no jogador já criado.  `attackRange: 0` significa
 * "use o alcance do campeão escolhido", exatamente como no jogo original.
 */
export function applyPlayerStats(player, stats, hpScale = 1) {
  if (!player || !stats) {
    if (player && hpScale !== 1) {
      player.maxHp *= hpScale;
      player.hp = player.maxHp;
    }
    return player;
  }

  const health = finite(stats.health);
  if (health !== null && health > 0) {
    player.maxHp = health;
    player.hp = health;
  }

  const speed = finite(stats.speed);
  if (speed !== null && speed > 0) player.moveSpeed = speed;

  const ad = finite(stats.attackDamage);
  if (ad !== null && ad >= 0) player.attackDamage = ad;

  const as = finite(stats.attackSpeed);
  if (as !== null && as > 0) {
    player.attackPeriod = 1 / as;
    player.attackCast = Math.min(player.attackCast, player.attackPeriod * 0.45);
  }

  const range = finite(stats.attackRange);
  if (range !== null && range > 0) player.attackRange = range;

  if (hpScale !== 1) {
    player.maxHp *= hpScale;
    player.hp = player.maxHp;
  }
  return player;
}

/** Converte "AbilityQ" / "AbilityW" / "AbilityR" no slot da spell. */
export function slotFromAbility(name) {
  const match = /Ability([QWER])/i.exec(String(name || ""));
  return match ? match[1].toUpperCase() : null;
}

/**
 * Ordena os campeões de um `selectedChampions` por peso de spawn e devolve
 * apenas os que existem no elenco web (Nidalee/Xerath não estão no JSON).
 */
export function selectedChampions(snapshotLevel, championList, limit = 6) {
  const selected = snapshotLevel?.selectedChampions;
  if (!selected || typeof selected !== "object") return [];
  const byAlias = new Map(championList.map((c) => [c.alias, c]));
  return Object.values(selected)
    .map((entry) => ({ ...entry, champion: byAlias.get(entry.championKey) }))
    .filter((entry) => entry.champion)
    .sort((a, b) => finite(b.spawnWeight, 0) - finite(a.spawnWeight, 0))
    .slice(0, limit);
}

/** Stats de um aliado/inimigo fictício (minion, dummy) sem dados de campeão. */
export function syntheticStats({ health = 600, speed = 325, attackDamage = 60, attackSpeed = 1, attackRange = 550, isMelee = false } = {}) {
  return {
    health,
    speed,
    attackDamage,
    attackSpeed,
    attackRange,
    windUpPercentage: 0,
    isMelee,
  };
}
