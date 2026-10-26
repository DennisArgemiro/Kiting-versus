import { Champion } from "../engine/unit.js";
import { Projectile } from "../engine/world.js";
import { Controller, ORDER, unitUnderCursor } from "../engine/orders.js";
import { skillshotFromSpell } from "../engine/skillshot.js";
import { clamp, norm } from "../core/math.js";
import { config } from "../config.js";

export const ARENA = { x: 0, y: 0, w: 3200, h: 1900 };

const ABILITY_COOLDOWNS = { Q: 4, W: 6, E: 8, R: 12 };

export function syncArena() {
  const arena = config.arena();
  ARENA.w = arena.w;
  ARENA.h = arena.h;
  return ARENA;
}

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

export function makePlayer(championData, x, y, hpScale = 1, attackSpeedScale = null) {
  const combat = config.combat();
  const champConfig = config.champion(championData.alias) || {};
  const atkSpeedScale = attackSpeedScale ?? combat.playerAttackSpeedScale;

  // championData.stats.attackPeriod already has the champion override applied (final value).
  // Champion constructor multiplies by mult.attackSpeed again, so we need to pass the BASE
  // attackPeriod (final / multiplier) so Champion's multiplication gives the correct final value.
  const mult = champConfig.attackSpeed || 1;
  const baseAttackPeriod = championData.stats.attackPeriod / mult;

  const player = new Champion(championData, {
    team: "player",
    x,
    y,
    hp: championData.stats.health * hpScale * combat.playerHpScale,
    hitRadius: combat.playerHitRadius,
    attackPeriod: baseAttackPeriod / atkSpeedScale,
    attackCast: championData.stats.attackCastTime / atkSpeedScale,
    multipliers: champConfig,
  });
  player.isPlayer = true;
  player.abilityCooldowns = { Q: 0, W: 0, E: 0, R: 0 };
  player.controller = new Controller(player);
  return player;
}

export function resolveAttack(unit, world, target, onLanded) {
  if (!unit || !unit.alive || !target || !target.alive || !world) {
    onLanded?.(null);
    return;
  }
  if (unit.isMelee) {
    target.takeDamage(unit.attackDamage, world.time, unit);
    world.effect("text", target.x, target.y - unit.radius, {
      text: `-${Math.round(unit.attackDamage)}`,
      color: "#ffd27a",
      duration: 0.75,
    });
    onLanded?.(target);
    return;
  }
  const dx = target.x - unit.x;
  const dy = target.y - unit.y;
  const d = norm(dx, dy);
  world.addProjectile(
    new Projectile({
      x: unit.x + d.x * unit.radius,
      y: unit.y + d.y * unit.radius,
      dirX: d.x,
      dirY: d.y,
      speed: unit.projectileSpeed,
      damage: unit.attackDamage,
      owner: unit,
      team: unit.team,
      color: unit.team === "player" ? "#ffe08a" : "#ff9a8a",
      width: 18,
    }),
  );
  onLanded?.(target);
}

export function applyInput(player, input, world, onMoveMarker) {
  const controller = player.controller;
  const events = { attacked: null, cast: null, ordered: null };

  if (input.hit("KeyS")) {
    controller.stop();
    events.ordered = ORDER.STOP;
  }

  for (const click of input.takeClicks()) {
    const unit = unitUnderCursor(world, click.x, click.y, 150);
    const attackMove = input.attackMoveActive;
    input.lastClick = { button: click.button, x: click.x, y: click.y, onUnit: Boolean(unit) };

    if (click.button === 2) {
      if (attackMove) {
        input.consumedAttackMove = true;
        // Quando A está segurado: sempre ataque o inimigo mais próximo do clique
        if (world && world.nearest) {
          const enemyNear = world.nearest(click.x, click.y, (player.attackRange || 550) * 1.3, (u) => u && u.alive && u.team !== player.team);
          if (enemyNear && enemyNear.alive) {
            controller.attackUnit(enemyNear);
            events.ordered = ORDER.ATTACK;
            onMoveMarker?.(enemyNear.x, enemyNear.y, 0xff5f6d);
          } else {
            // Nenhum inimigo próximo do clique: ataque-move para o ponto
            controller.attackMoveTo(click.x, click.y);
            events.ordered = ORDER.ATTACK_MOVE;
            onMoveMarker?.(click.x, click.y, 0xffb454);
          }
        } else {
          controller.attackMoveTo(click.x, click.y);
          events.ordered = ORDER.ATTACK_MOVE;
          onMoveMarker?.(click.x, click.y, 0xffb454);
        }
        // Removido o fallback para unitUnderCursor quando A está segurado
      } else if (unit && unit.alive) {
        controller.attackUnit(unit);
        events.ordered = ORDER.ATTACK;
        onMoveMarker?.(unit.x, unit.y, 0xff5f6d);
      } else {
        controller.moveTo(click.x, click.y);
        events.ordered = ORDER.MOVE;
        onMoveMarker?.(click.x, click.y, 0x4ea1ff);
      }
    } else if (click.button === 0) {
      if (attackMove) {
        input.consumedAttackMove = true;
        // Quando A está segurado: sempre ataque o inimigo mais próximo do clique
        if (world && world.nearest) {
          const enemyNear = world.nearest(click.x, click.y, (player.attackRange || 550) * 1.3, (u) => u && u.alive && u.team !== player.team);
          if (enemyNear && enemyNear.alive) {
            controller.attackUnit(enemyNear);
            events.ordered = ORDER.ATTACK;
            onMoveMarker?.(enemyNear.x, enemyNear.y, 0xff5f6d);
          } else {
            // Nenhum inimigo próximo do clique: ataque-move para o ponto
            controller.attackMoveTo(click.x, click.y);
            events.ordered = ORDER.ATTACK_MOVE;
            onMoveMarker?.(click.x, click.y, 0xffb454);
          }
        } else {
          controller.attackMoveTo(click.x, click.y);
          events.ordered = ORDER.ATTACK_MOVE;
          onMoveMarker?.(click.x, click.y, 0xffb454);
        }
        // Removido o fallback para unitUnderCursor quando A está segurado
      } else if (unit && unit.alive) {
        controller.attackUnit(unit);
        events.ordered = ORDER.ATTACK;
        onMoveMarker?.(unit.x, unit.y, 0xff5f6d);
      }
    }
  }

  return events;
}

export function castAbility(player, slot, aimX, aimY, world) {
  const spell = player.spells.get(slot);
  if (!spell) return null;
  const cooldown = ABILITY_COOLDOWNS[slot] ?? 6;
  if ((player.abilityCooldowns[slot] ?? 0) > 0) return null;

  player.abilityCooldowns[slot] = cooldown;
  player.attackTimer = Math.max(player.attackTimer, 0.25);

  if (spell.shape === "self") {
    player.hp = Math.min(player.maxHp, player.hp + player.maxHp * 0.2);
    player.buffTimer = 3.5;
    player.buffDamage = 1.45;
    world.effect("ring", player.x, player.y, {
      color: "#46d39a", radius: 30, grow: 220, duration: 0.6,
    });
    return spell;
  }

  if (spell.shape === "circle") {
    const shot = skillshotFromSpell(
      spell, player, aimX, aimY, "player", player.attackDamage * 1.2,
    );
    shot.castTime = Math.min(shot.castTime, 0.15);
    world.addSkillshot(shot);
    return spell;
  }

  if (spell.shape === "cone") {
    const shot = skillshotFromSpell(
      spell, player, aimX, aimY, "player", player.attackDamage * 1.1,
    );
    shot.castTime = Math.min(shot.castTime, 0.15);
    world.addSkillshot(shot);
    return spell;
  }

  const shot = skillshotFromSpell(
    spell, player, aimX, aimY, "player", player.attackDamage * 1.1,
  );
  world.addSkillshot(shot);
  return spell;
}

export function tickAbilities(player, dt) {
  for (const slot of ["Q", "W", "E", "R"]) {
    if ((player.abilityCooldowns[slot] ?? 0) > 0) {
      player.abilityCooldowns[slot] = Math.max(0, player.abilityCooldowns[slot] - dt);
    }
  }
  if (player.buffTimer > 0) {
    player.buffTimer = Math.max(0, player.buffTimer - dt);
    if (player.buffTimer === 0) player.buffDamage = 1;
  }
}

export function updateEnemy(enemy, world, player, dt, options = {}) {
  if (!enemy || !enemy.alive || !player || !player.alive) return;

  const behaviour = enemy.behaviour || "melee";
  const toPlayer = Math.hypot(player.x - enemy.x, player.y - enemy.y);
  enemy.faceTowards(player.x, player.y);

  const desired = enemy.preferredRange ?? (
    behaviour === "ranged" || behaviour === "caster"
      ? enemy.attackRange * 0.92
      : enemy.attackRange * 0.85
  );

  if (behaviour !== "stationary") {
    if (toPlayer > desired + 40) {
      enemy.moveToward(player.x, player.y, dt, options.speedScale ?? 1);
    } else if (toPlayer < desired - 160 && behaviour !== "melee") {
      enemy.moveDirection(-(player.x - enemy.x), -(player.y - enemy.y), dt, options.speedScale ?? 1);
    }
  }

  if (behaviour === "caster") return;

  if (enemy.attackRange > 0 && toPlayer <= enemy.attackRange * 0.98 && enemy.canAttack()) {
    enemy.startAttack(player);
  }
}

export function ringPositions(count, cx, cy, rx, ry = rx, offset = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

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

export const unit01 = (v) => clamp(v, 0, 1);