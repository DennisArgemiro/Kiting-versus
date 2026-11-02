/**
 * Factory — criação e ajuste de unidades.
 *
 * `makePlayer` constrói o Champion do jogador com controller/HUD prontos;
 * `tuneEnemy` aplica os multiplicadores de dificuldade do config;
 * `pickSparringPartner` escolhe o sparring de alcance compatível.
 */
import { Champion } from "./unit.js";
import { Controller } from "./orders.js";
import { config } from "../config.js";

/** Aplica os scales de inimigo do config (range/speed/damage/hp). */
export function tuneEnemy(unit) {
  if (!unit) return unit;
  const c = config.combat();
  if (c.enemyRangeScale !== 1) {
    if (unit.attackRange > 0) unit.attackRange *= c.enemyRangeScale;
    if (unit.preferredRange > 0) unit.preferredRange *= c.enemyRangeScale;
  }
  if (c.enemySpeedScale !== 1) unit.moveSpeed *= c.enemySpeedScale;
  if (c.enemyDamageScale !== 1) unit.attackDamage *= c.enemyDamageScale;
  if (c.enemyHpScale !== 1 && unit.maxHp > 0) {
    const ratio = unit.hp / unit.maxHp;
    unit.maxHp *= c.enemyHpScale;
    unit.hp = unit.maxHp * ratio;
  }
  return unit;
}

/**
 * Cria a unidade do jogador a partir dos dados do campeão.
 * `championData.stats` já contém os multiplicadores do campeão (aplicados por
 * applyChampionOverrides), então os valores abaixo são finais: não reaplicar.
 */
export function makePlayer(championData, x, y, hpScale = 1, attackSpeedScale = null) {
  const combat = config.combat();
  const atkSpeedScale = attackSpeedScale ?? combat.playerAttackSpeedScale;

  const player = new Champion(championData, {
    team: "player",
    x,
    y,
    hp: championData.stats.health * hpScale * combat.playerHpScale,
    hitRadius: combat.playerHitRadius,
    attackPeriod: championData.stats.attackPeriod / atkSpeedScale,
    attackCast: championData.stats.attackCastTime / atkSpeedScale,
  });
  player.isPlayer = true;
  // Display-only: permite ao HUD mostrar as porcentagens configuradas.
  player.statModifiers = config.champion(championData.alias) || {};
  player.abilityCooldowns = { Q: 0, W: 0, E: 0, R: 0 };
  player.controller = new Controller(player);
  return player;
}

/**
 * Escolhe o sparring com alcance mais próximo do do jogador
 * (mesmo regime: ranged com ranged, melee com melee).
 */
export function pickSparringPartner(champions, playerChampion) {
  const playerRange = playerChampion.stats.attackRange;
  const playerRanged = playerRange > 300;
  const pool = champions.filter(
    (c) => (c.stats.attackRange > 300) === playerRanged && c.alias !== playerChampion.alias,
  );
  let best = null;
  let bestDiff = Infinity;
  for (const candidate of pool) {
    const diff = Math.abs(candidate.stats.attackRange - playerRange);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best || champions[0];
}
