/**
 * Combat — combate compartilhado entre todos os modos.
 *
 * `resolveAttack`  → ataque básico (melee direto ou projétil);
 * `castAbility`    → conjuração de Q/W/E/R com cooldown padrão;
 * `tickAbilities`  → decaimento de cooldowns e do buff ativo;
 * `updateEnemy`    → IA de posicionamento/ataque do sparring/bot.
 */
import { Projectile } from "./world.js";
import { skillshotFromSpell } from "./skillshot.js";
import { norm } from "../core/math.js";

const ABILITY_COOLDOWNS = { Q: 4, W: 6, E: 8, R: 12 };

/** Resolve um ataque básico: melee aplica dano direto; ranged dispara projétil. */
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

/** Conjura a habilidade do slot com cooldown; mirada em (aimX, aimY). */
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

  // Conjurações direcionadas giram o campeão para o ponto mirado (como no LoL).
  if (typeof player.faceTowards === "function") player.faceTowards(aimX, aimY);

  // Usa player.team (não "player" fixo) para bots não se atingirem.
  const team = player.team || "player";

  if (spell.shape === "circle") {
    const shot = skillshotFromSpell(
      spell, player, aimX, aimY, team, player.attackDamage * 1.2,
    );
    shot.castTime = Math.min(shot.castTime, 0.15);
    world.addSkillshot(shot);
    return spell;
  }

  if (spell.shape === "cone") {
    const shot = skillshotFromSpell(
      spell, player, aimX, aimY, team, player.attackDamage * 1.1,
    );
    shot.castTime = Math.min(shot.castTime, 0.15);
    world.addSkillshot(shot);
    return spell;
  }

  const shot = skillshotFromSpell(
    spell, player, aimX, aimY, team, player.attackDamage * 1.1,
  );
  world.addSkillshot(shot);
  return spell;
}

/** Decai cooldowns de habilidades e o buff ativo do jogador. */
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

/**
 * IA de inimigo: mantém preferredRange do jogador, recua se estiver colado
 * (exceto melee) e ataca quando em alcance. `options.speedScale` ajusta
 * a velocidade de movimento.
 */
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
