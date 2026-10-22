import { World } from "../engine/world.js";
import { Champion } from "../engine/unit.js";
import { skillshotFromSpell } from "../engine/skillshot.js";
import {
  ARENA, applyInput, castAbility, makePlayer, pickSparringPartner, resolveAttack,
  tickAbilities, tuneEnemy, updateEnemy, unit01,
} from "./common.js";
import { clamp } from "../core/math.js";
import {
  applyPlayerStats, durationOf, levelsOf, realLevel, selectedChampions as pickSelectedChampions,
  syntheticStats, withRealStats,
} from "./skillgap.js";

/**
 * Resolves an enemy "role" into a concrete champion.
 *
 * Roles keep the levels champion-agnostic, so a melee champion and a marksman
 * both get a fair sparring partner whose reach matches their own.
 */
const CASTER_POOL = ["Ahri", "Lux", "Morgana", "Brand", "Thresh", "Blitzcrank", "Zed", "Velkoz", "Ekko"];

function resolveChampion(spec, ctx) {
  const list = ctx.champions || [ctx.champion];
  const byAlias = Object.fromEntries(list.map((c) => [c.alias, c]));
  const pick = (pool, offset = 0) => pool[Math.abs(offset) % pool.length];

  let base;
  switch (spec.role) {
    case "partner": {
      // The sparring partner with the closest reach to the player.
      base = pickSparringPartner(list, ctx.champion);
      break;
    }
    case "melee": {
      const pool = list.filter((c) => c.stats.attackRange <= 200 && c.alias !== ctx.champion.alias);
      base = pick(pool.length ? pool : list, spec.seed || 0);
      break;
    }
    case "ranged": {
      const pool = list.filter((c) => c.stats.attackRange >= 450 && c.alias !== ctx.champion.alias);
      base = pick(pool.length ? pool : list, spec.seed || 0);
      break;
    }
    case "caster": {
      const pool = CASTER_POOL.map((a) => byAlias[a]).filter(Boolean);
      base = pick(pool.length ? pool : list, spec.seed || 0);
      break;
    }
    default:
      base = byAlias[spec.champion] || ctx.champion;
  }

  // The real Firestore level stores generic training stats (health, AD,
  // speed, attack speed) for the enemy.  Apply them to a clone of the chosen
  // champion so the training uses the recovered numbers.
  return withRealStats(base, spec.stats, {
    attackRange: spec.attackRange,
    isMelee: spec.isMelee,
  });
}

/**
 * Shared kiting machinery.
 *
 * The skill being trained is the attack / reposition rhythm:
 *   attack  ->  the windup locks you in place
 *   ->  step out of the enemy's reach
 *   ->  step back in and attack again
 *
 * Three metrics capture it:
 *   dps        how much of your theoretical damage you actually landed
 *   safety     how much of the drill you spent outside the enemy's reach
 *   rhythm     accuracy plus how often you repositioned after a swing
 */
class KitingDrill {
  constructor({ champion, level, params, rng, champions, onMoveMarker }) {
    this.world = new World(ARENA);
    this.rng = rng;
    this.params = params;
    this.ctx = { champion, champions: champions || [champion], level, rng };
    this.onMoveMarker = onMoveMarker;
    this.duration = params.duration;
    this.timeLeft = params.duration;
    this.finished = false;
    this.outcome = "completed";
    // Countdown before the drill starts: the clock does not run yet.
    this.ready = 2.4;

    this.player = makePlayer(champion, ARENA.w * 0.375, ARENA.h / 2, 1);
    applyPlayerStats(this.player, params.playerStats, params.playerHpScale ?? 1);
    this.world.add(this.player);

    this.state = { attackTarget: null };

    this.metrics = {
      attacksStarted: 0,
      attacksLanded: 0,
      attacksResolved: 0,
      repositioned: 0,
      damageDealt: 0,
      damageTaken: 0,
      hitsTaken: 0,
      timeInDanger: 0,
      timeInRange: 0,
      orders: 0,
      casts: 0,
      kills: 0,
      totalEnemyHp: 0,
      maxEnemyHp: 0,
    };

    this.repositionProbe = null;
    this.enemies = [];
    this.ally = null;
    this.respawns = [];
    this.spawnEnemies(params);

    this.world.onDamage = (unit, amount) => {
      if (unit.team === "player") {
        this.metrics.damageTaken += amount;
        this.metrics.hitsTaken += 1;
      } else if (unit.team === "enemy") {
        this.metrics.damageDealt += amount;
      } else if (unit.team === "ally") {
        this.metrics.allyDamageTaken = (this.metrics.allyDamageTaken || 0) + amount;
      }
    };
  }

  spawnEnemies(params) {
    const roster = params.enemies;
    const positions = this.placeEnemies(roster.length, params.spread ?? 1);
    roster.forEach((spec, i) => {
      const data = resolveChampion(spec, this.ctx);
      const real = Boolean(spec.stats);
      const enemy = new Champion(data, {
        team: "enemy",
        x: positions[i].x,
        y: positions[i].y,
        hp: spec.hp ?? data.stats.health * (spec.lives ?? (real ? 1 : 1.2)),
        attackRange: spec.attackRange,
      });
      enemy.behaviour = spec.behaviour ?? "melee";
      enemy.attackDamage = spec.attackDamage ?? data.stats.attackDamage * (spec.damageScale ?? (real ? 1 : 0.55));
      enemy.moveSpeed = spec.moveSpeed ?? data.stats.movementSpeed * (spec.speedScale ?? (real ? 1 : 0.82));
      enemy.attackPeriod = spec.attackPeriod ?? data.stats.attackPeriod * (spec.attackSpeedScale ?? 1);
      enemy.casterSpell = spec.spell
        ? enemy.data.spells?.find((s) => s.slot === spec.spell && s.shape !== "self")
        : null;
      if (enemy.behaviour === "caster") {
        // Casters never swing; they only fire skillshots.
        enemy.attackRange = 0;
        enemy.preferredRange = spec.range ?? 1250;
        enemy.casterTimer = 2.2;
      }
      tuneEnemy(enemy);
      this.world.add(enemy);
      this.enemies.push(enemy);
      this.metrics.totalEnemyHp += enemy.maxHp;
      this.metrics.maxEnemyHp += enemy.maxHp;
    });
  }

  /**
   * Places the enemies just outside the player's reach, so the first decision
   * of the drill is "step in or not", not "walk across the map".
   */
  placeEnemies(count, spread = 1) {
    const out = [];
    const startX = this.player.x + this.player.attackRange * 1.25;
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 220 * spread;
      out.push({
        x: startX + i * 180 * spread,
        y: this.player.y + offset,
      });
    }
    return out;
  }

  update(dt, input) {
    input.dt = dt;
    const world = this.world;
    const player = this.player;

    if (this.ready > 0) {
      this.ready = Math.max(0, this.ready - dt);
      world.update(dt);
      return;
    }

    if (!this.finished) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.finished = true;
        this.outcome = "completed";
      }
    }

    // ---- player: League style orders ---------------------------------
    const orders = applyInput(player, input, world, this.onMoveMarker);
    if (orders.ordered) this.metrics.orders += 1;

    for (const slot of ["Q", "W", "E", "R"]) {
      if (input.hit(`Key${slot}`)) {
        const spell = castAbility(player, slot, input.mouse.x, input.mouse.y, world);
        if (spell) this.metrics.casts += 1;
      }
    }
    tickAbilities(player, dt);

    const action = player.controller.update(dt, world);
    if (action.attacked) this.metrics.attacksStarted += 1;

    // ---- timers & attack resolution ----------------------------------
    const resolved = player.tickTimers(dt);
    if (resolved) {
      this.metrics.attacksResolved += 1;
      resolveAttack(player, world, resolved, (target) => {
        if (target && target.alive) this.metrics.attacksLanded += 1;
        this.repositionProbe = {
          target,
          distance: target ? Math.hypot(target.x - player.x, target.y - player.y) : 0,
          deadline: world.time + 1.1,
        };
      });
    }

    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const target = this.enemyTarget ? this.enemyTarget(enemy) : player;
      updateEnemy(enemy, world, target, dt, { speedScale: 1 });
      const enemyResolved = enemy.tickTimers(dt);
      if (enemyResolved) {
        resolveAttack(enemy, world, enemyResolved, null);
      }
    }

    // ---- caster skillshots -------------------------------------------
    for (const enemy of this.enemies) {
      if (!enemy.alive || enemy.behaviour !== "caster") continue;
      enemy.casterTimer = (enemy.casterTimer ?? 1.5) - dt;
      const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      if (enemy.casterTimer <= 0 && d <= (enemy.preferredRange ?? 1300)) {
        enemy.casterTimer = this.params.casterCooldown ?? 2.6;
        const spell = enemy.casterSpell;
        if (spell) {
          world.addSkillshot(
            skillshotFromSpell(spell, enemy, player.x, player.y, "enemy", enemy.attackDamage * 1.5),
          );
        }
      }
    }

    // ---- reposition tracking -----------------------------------------
    if (this.repositionProbe) {
      const p = this.repositionProbe;
      const target = p.target;
      if (!target || !target.alive) {
        this.repositionProbe = null;
      } else if (world.time > p.deadline) {
        this.repositionProbe = null;
      } else {
        const d = Math.hypot(target.x - player.x, target.y - player.y);
        if (d > p.distance + 90) {
          this.metrics.repositioned += 1;
          this.repositionProbe = null;
        }
      }
    }

    // ---- metrics -----------------------------------------------------
    if (!this.finished) {
      let inDanger = false;
      for (const enemy of this.enemies) {
        if (!enemy.alive || !enemy.attackRange) continue;
        if (Math.hypot(enemy.x - player.x, enemy.y - player.y) <= enemy.attackRange) {
          inDanger = true;
          break;
        }
      }
      if (inDanger) this.metrics.timeInDanger += dt;

      const focus = this.focusTarget();
      if (focus && Math.hypot(focus.x - player.x, focus.y - player.y) <= player.attackRange) {
        this.metrics.timeInRange += dt;
      }
    }

    // ---- deaths & respawns -------------------------------------------
    for (const enemy of this.enemies) {
      if (enemy.alive || enemy.counted) continue;
      enemy.counted = true;
      this.metrics.kills += 1;
      world.effect("ring", enemy.x, enemy.y, {
        color: "#46d39a", radius: 60, grow: 320, duration: 0.6,
      });
      // Bring the opponent back so the drill keeps its pressure.
      this.respawns.push({ enemy, at: world.time + 3 });
    }
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const entry = this.respawns[i];
      if (world.time < entry.at) continue;
      this.respawns.splice(i, 1);
      const enemy = entry.enemy;
      enemy.hp = enemy.maxHp;
      enemy.alive = true;
      enemy.counted = false;
      enemy.casting = 0;
      enemy.attackTimer = 0;
      enemy.pendingTarget = null;
      world.effect("ring", enemy.x, enemy.y, {
        color: "#4ea1ff", radius: 40, grow: 260, duration: 0.5,
      });
    }

    world.update(dt);
    world.separate();
    world.clampUnits();

    if (!player.alive && !this.finished) {
      this.finished = true;
      this.outcome = "defeated";
    }
  }

  render(scene, opts) {
    scene.render(this.world, {
      player: this.player,
      showRanges: opts.showRanges !== false,
      attackMoveActive: opts.attackMoveActive,
      focusTarget: this.focusTarget(),
      dt: opts.dt,
    });
  }

  /** The unit the player is ordered to hit, or the closest live enemy. */
  focusTarget() {
    const ordered = this.player.controller.target;
    if (ordered && ordered.alive) return ordered;
    return this.enemies.find((e) => e.alive) || null;
  }

  /**
   * Live coaching for the orbwalk rhythm.
   *
   * The technique being drilled: right click the target to attack, then right
   * click the ground to step out before the cooldown is back.
   */
  coach() {
    const player = this.player;
    const controller = player.controller;
    const target = this.focusTarget();
    if (!target) return "Clique com o botão direito no alvo para atacar";
    if (this.repositionProbe) {
      return "Recue agora: clique com o botão direito no chão, longe do alvo";
    }
    if (controller.order.kind === "attack") {
      const d = Math.hypot(target.x - player.x, target.y - player.y);
      if (d > player.attackRange * 0.96) return "Aproxime-se do alvo para atacar";
      return "Atacando - espere o swing e depois recue";
    }
    return "Clique com o botão direito no alvo para atacar";
  }

  hud() {
    return [
      { label: "Ataques", value: this.metrics.attacksLanded, tone: "good" },
      { label: "Dano", value: Math.round(this.metrics.damageDealt) },
      { label: "Tomou dano", value: Math.round(this.metrics.damageTaken), tone: this.metrics.damageTaken > 0 ? "bad" : "" },
      { label: "Em risco", value: `${Math.round((this.metrics.timeInDanger / Math.max(this.duration, 1)) * 100)}%`, tone: "bad" },
      { label: "Reposicionou", value: `${this.metrics.repositioned}/${this.metrics.attacksResolved}` },
    ];
  }

  result() {
    const m = this.metrics;
    const duration = Math.max(this.duration, 1);

    const theoreticalDamage = this.player.attackDamage * (duration / this.player.attackPeriod);
    const dpsComponent = unit01(theoreticalDamage > 0 ? m.damageDealt / theoreticalDamage : 0);
    const safetyComponent = unit01(1 - m.timeInDanger / duration);
    const accuracy = m.attacksStarted > 0 ? unit01(m.attacksLanded / m.attacksStarted) : 0;
    const repositionRate = m.attacksResolved > 0 ? unit01(m.repositioned / m.attacksResolved) : 0;
    const rhythmComponent = clamp(accuracy * 0.5 + repositionRate * 0.5, 0, 1);

    const score = Math.round(100 * (0.40 * dpsComponent + 0.35 * safetyComponent + 0.25 * rhythmComponent));

    const breakdown = [
      {
        name: "DPS efetivo",
        detail: `${Math.round(m.damageDealt)} de ${Math.round(theoreticalDamage)} de dano máximo`,
        value: dpsComponent,
        display: `${Math.round(dpsComponent * 100)}%`,
        color: "#4ea1ff",
      },
      {
        name: "Segurança",
        detail: `${Math.round(duration - m.timeInDanger)}s fora do alcance inimigo`,
        value: safetyComponent,
        display: `${Math.round(safetyComponent * 100)}%`,
        color: "#46d39a",
      },
      {
        name: "Ritmo de ataque",
        detail: `${m.attacksLanded}/${m.attacksStarted} acertados, ${m.repositioned}/${m.attacksResolved} reposicionou`,
        value: rhythmComponent,
        display: `${Math.round(rhythmComponent * 100)}%`,
        color: "#ffb454",
      },
    ];

    return {
      score,
      breakdown,
      verdict: verdictFor(score, this.outcome),
      stats: {
        attacksLanded: m.attacksLanded,
        attacksStarted: m.attacksStarted,
        orders: m.orders,
        casts: m.casts,
        damageDealt: Math.round(m.damageDealt),
        damageTaken: Math.round(m.damageTaken),
        hitsTaken: m.hitsTaken,
        kills: m.kills,
        timeInDanger: Math.round(m.timeInDanger),
        repositioned: m.repositioned,
        attacksResolved: m.attacksResolved,
      },
    };
  }
}

function verdictFor(score, outcome) {
  if (outcome === "defeated") return "Você morreu antes do tempo — defensiva primeiro, DPS depois.";
  if (score >= 90) return "Excelente. Você maximiza dano sem nunca ficar exposto.";
  if (score >= 75) return "Muito bom. Afine o ritmo: ataque, saia, volte.";
  if (score >= 55) return "Bom começo. Você acerta, mas ainda passa tempo no alcance inimigo.";
  if (score >= 35) return "Está atacando sem kitar. Saia do anel vermelho entre os ataques.";
  return "ComeceAttackando quando estiver com o alvo no anel azul e recue logo depois.";
}

// ───────────────────────────────────────────────────────────────────────────
// Drill 1 — Kiting de Separação
// ───────────────────────────────────────────────────────────────────────────

class SpacingKitingDrill extends KitingDrill {
  spawnEnemies(params) {
    const roster = params.enemies;
    const positions = this.placeEnemies(roster.length, params.spread ?? 1);
    roster.forEach((spec, i) => {
      const data = resolveChampion(spec, this.ctx);
      const real = Boolean(spec.stats);
      const enemy = new Champion(data, {
        team: "enemy",
        x: positions[i].x,
        y: positions[i].y,
        // The sparring partner is meant to last the whole drill: this drill
        // is about the rhythm, not about killing the dummy.
        hp: spec.hp ?? data.stats.health * 12,
        attackRange: spec.attackRange,
      });
      // The partner stands its ground: the whole point is the attack / step
      // rhythm, not the chase.
      enemy.behaviour = "stationary";
      enemy.attackDamage = data.stats.attackDamage * (spec.damageScale ?? (real ? 1 : 0.4));
      enemy.attackPeriod = data.stats.attackPeriod * (spec.attackSpeedScale ?? 1);
      enemy.moveSpeed = spec.moveSpeed ?? data.stats.movementSpeed;
      tuneEnemy(enemy);
      this.world.add(enemy);
      this.enemies.push(enemy);
      this.metrics.totalEnemyHp += enemy.maxHp;
      this.metrics.maxEnemyHp += enemy.maxHp;
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Drill 3 — Kiting de Peel (proteger o aliado)
// ───────────────────────────────────────────────────────────────────────────

class PeelKitingDrill extends KitingDrill {
  constructor(opts) {
    super(opts);
    // Your partner: a low-health carry standing next to you in the lane.
    const ally = new Champion(opts.champion, {
      team: "ally",
      x: this.player.x + 320,
      y: this.player.y - 120,
      hp: opts.params.allyHp ?? 900,
    });
    ally.name = "Aliado";
    ally.behaviour = "stationary";
    ally.attackDamage = 0;
    ally.attackRange = 0;
    this.world.add(ally);
    this.ally = ally;
    // The generic AI targets `this.enemyTarget(enemy)` when it exists.  Until
    // the ally dies, peel enemies chase the ally; afterwards they switch back.
    this.enemyTarget = () => (this.ally?.alive ? this.ally : this.player);
  }

  update(dt, input) {
    // `enemyTarget` (set in the constructor) redirects the generic enemy AI
    // to the ally.  The player still runs the normal kiting loop.
    super.update(dt, input);
  }

  result() {
    const base = super.result();
    const allyHpPct = this.ally ? clamp(this.ally.hp / Math.max(this.ally.maxHp, 1), 0, 1) : 0;
    const protect = 0.55 * allyHpPct + 0.45 * (base.breakdown[0].value * 0.5 + base.breakdown[2].value * 0.5);
    const score = Math.round(clamp(base.score * 0.45 + protect * 100 * 0.55, 0, 100));
    base.breakdown.unshift({
      name: "Aliado protegido",
      detail: `Vida do seu parceiro: ${Math.round(this.ally?.hp ?? 0)} / ${this.ally?.maxHp ?? 0}`,
      value: allyHpPct,
      display: `${Math.round(allyHpPct * 100)}%`,
      color: "#46d39a",
    });
    base.score = score;
    base.verdict = verdictFor(score, this.outcome);
    return base;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Drill definitions
// ───────────────────────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────────────────────
// Real Skill Gap levels (Firestore, v4.4.0)
// ───────────────────────────────────────────────────────────────────────────

function realSpacingLevels(snapshot) {
  return levelsOf(snapshot, "AUTO_SPACING").map((level, i) => ({
    index: Number(level.level) || i + 1,
    params: {
      duration: durationOf(level, 60),
      spread: 0.8,
      playerStats: level.playerStats,
      enemies: [{
        role: "partner",
        behaviour: "stationary",
        damageScale: 1,
        attackSpeedScale: 1,
        speedScale: 1,
        attackRange: level.enemyAttackRange,
        stats: level.enemyStats,
        hp: (level.enemyStats?.health ?? 600) * 12,
      }],
    },
  }));
}

function realDefensiveLevels(snapshot) {
  return levelsOf(snapshot, "DEFENSIVE_KITING").map((level, i) => {
    const enemies = [];
    const championCount = clamp(Math.round(level.maxMeleeChampionsAlive ?? 1), 1, 6);
    const minionCount = clamp(Math.round(level.maxMinionsAlive ?? 0), 0, 4);

    for (let n = 0; n < championCount; n++) {
      enemies.push({
        role: "melee",
        seed: n,
        behaviour: "melee",
        lives: level.meleeChampionLives ?? 3,
        moveSpeed: level.meleeChampionSpeed ?? 300,
        damageScale: 1,
        speedScale: 1,
        attackSpeedScale: 1,
      });
    }
    for (let n = 0; n < minionCount; n++) {
      enemies.push({
        role: "melee",
        seed: n,
        behaviour: "melee",
        isMelee: true,
        attackRange: 150,
        moveSpeed: level.minionSpeed ?? 250,
        lives: level.minionLives ?? 1,
        stats: syntheticStats({
          health: 300,
          speed: level.minionSpeed ?? 250,
          attackDamage: 18,
          attackSpeed: 1,
          attackRange: 150,
          isMelee: true,
        }),
      });
    }

    return {
      index: Number(level.level) || i + 1,
      params: {
        duration: durationOf(level, 60),
        playerStats: { attackSpeed: level.playerAttackSpeed },
        enemies,
      },
    };
  });
}

function realPeelLevels(snapshot, champions) {
  return levelsOf(snapshot, "PEELING_MICROGAME").map((level, i) => {
    const picks = pickSelectedChampions(level, champions, 5);
    const count = clamp(Math.round(level.maxEntitiesAlive ?? 2), 1, 5);
    const enemies = [];
    for (let n = 0; n < count; n++) {
      const pick = picks[n % Math.max(picks.length, 1)];
      if (!pick) break;
      enemies.push({
        champion: pick.champion.alias,
        behaviour: "ranged",
        attackRange: 520,
        moveSpeed: pick.movementSpeed,
        hp: pick.champion.stats.health * 3,
        damageScale: 1,
        speedScale: 1,
        attackSpeedScale: 1,
      });
    }
    return {
      index: Number(level.level) || i + 1,
      params: {
        duration: durationOf(level, 60),
        allyHp: 900,
        allySpeed: level.allySpeed,
        playerStats: { speed: level.playerSpeed },
        enemies,
      },
    };
  });
}

export function buildKitingDrills(champions, snapshot = null) {
  const fallbackSpacingLevels = [
    { duration: 45, spread: 0.8, enemies: [{ role: "partner", damageScale: 0.30, attackSpeedScale: 1.45 }] },
    { duration: 45, spread: 0.8, enemies: [{ role: "partner", damageScale: 0.38, attackSpeedScale: 1.25 }] },
    { duration: 50, spread: 0.9, enemies: [{ role: "partner", damageScale: 0.42, attackSpeedScale: 1.1 }] },
    { duration: 50, spread: 0.9, enemies: [{ role: "partner", damageScale: 0.42, attackSpeedScale: 1.1 }, { role: "partner", seed: 1, damageScale: 0.30, attackSpeedScale: 1.3 }] },
    { duration: 55, spread: 1, enemies: [{ role: "partner", damageScale: 0.48, attackSpeedScale: 1.0 }, { role: "ranged", behaviour: "stationary", damageScale: 0.35, attackSpeedScale: 1.15 }] },
    { duration: 55, spread: 1, enemies: [{ role: "partner", damageScale: 0.48, attackSpeedScale: 1.0 }, { role: "ranged", behaviour: "stationary", damageScale: 0.35, attackSpeedScale: 1.15 }, { role: "partner", seed: 1, damageScale: 0.32, attackSpeedScale: 1.25 }] },
    { duration: 60, spread: 1.1, enemies: [{ role: "partner", damageScale: 0.52, attackSpeedScale: 0.95 }, { role: "ranged", behaviour: "stationary", damageScale: 0.4, attackSpeedScale: 1.05 }, { role: "melee", behaviour: "stationary", damageScale: 0.4, attackSpeedScale: 1.15 }] },
    { duration: 60, spread: 1.1, enemies: [{ role: "partner", damageScale: 0.55, attackSpeedScale: 0.9 }, { role: "ranged", behaviour: "stationary", damageScale: 0.42, attackSpeedScale: 1.0 }, { role: "melee", behaviour: "stationary", damageScale: 0.42, attackSpeedScale: 1.1 }, { role: "partner", seed: 1, damageScale: 0.35, attackSpeedScale: 1.2 }] },
  ];

  const fallbackDefensiveLevels = [
    { duration: 45, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.35, speedScale: 0.78 }] },
    { duration: 45, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.4, speedScale: 0.84 }, { role: "ranged", behaviour: "ranged", damageScale: 0.3 }] },
    { duration: 50, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.45, speedScale: 0.88 }, { role: "ranged", behaviour: "ranged", damageScale: 0.35 }] },
    { duration: 50, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.45, speedScale: 0.9 }, { role: "ranged", behaviour: "ranged", damageScale: 0.35 }, { role: "caster", behaviour: "caster", spell: "Q", damageScale: 0.3 }] },
    { duration: 55, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.5, speedScale: 0.92 }, { role: "melee", seed: 1, behaviour: "melee", damageScale: 0.4, speedScale: 0.95 }, { role: "ranged", behaviour: "ranged", damageScale: 0.4 }] },
    { duration: 55, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.5, speedScale: 0.94 }, { role: "ranged", behaviour: "ranged", damageScale: 0.4 }, { role: "caster", behaviour: "caster", spell: "Q", damageScale: 0.35 }] },
    { duration: 60, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.55, speedScale: 0.95 }, { role: "melee", seed: 1, behaviour: "melee", damageScale: 0.45, speedScale: 1.0 }, { role: "ranged", behaviour: "ranged", damageScale: 0.45 }, { role: "caster", behaviour: "caster", spell: "Q", damageScale: 0.35 }] },
  ];

  const fallbackPeelLevels = [
    { duration: 45, allyHp: 1000, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.35, speedScale: 0.8 }] },
    { duration: 45, allyHp: 1000, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.4, speedScale: 0.85 }, { role: "ranged", behaviour: "ranged", damageScale: 0.3 }] },
    { duration: 50, allyHp: 950, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.45, speedScale: 0.88 }, { role: "ranged", behaviour: "ranged", damageScale: 0.35 }] },
    { duration: 50, allyHp: 900, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.45, speedScale: 0.9 }, { role: "ranged", behaviour: "ranged", damageScale: 0.35 }, { role: "caster", behaviour: "caster", spell: "Q", damageScale: 0.3 }] },
    { duration: 55, allyHp: 900, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.5, speedScale: 0.92 }, { role: "melee", seed: 1, behaviour: "melee", damageScale: 0.4, speedScale: 0.95 }, { role: "ranged", behaviour: "ranged", damageScale: 0.4 }] },
    { duration: 55, allyHp: 850, enemies: [{ role: "melee", behaviour: "melee", damageScale: 0.5, speedScale: 0.94 }, { role: "ranged", behaviour: "ranged", damageScale: 0.4 }, { role: "caster", behaviour: "caster", spell: "Q", damageScale: 0.35 }] },
  ];

  const realSpacing = realSpacingLevels(snapshot);
  const realDefensive = realDefensiveLevels(snapshot);
  const realPeel = realPeelLevels(snapshot, champions);

  const spacingLevels = realSpacing.length ? realSpacing : fallbackSpacingLevels;
  const defensiveLevels = realDefensive.length ? realDefensive : fallbackDefensiveLevels;
  const peelLevels = realPeel.length ? realPeel : fallbackPeelLevels;
  const asLevels = (list) => list.map((item, i) => (item?.params ? item : { index: i + 1, params: item }));

  return [
    {
      id: "kiting-spacing",
      name: "Kiting de Separação",
      category: "kiting",
      tagline: "O ritmo ataque → recuo → ataque",
      hint: "Acerte quando o alvo estiver no seu anel azul. Saia do anel vermelho assim que o ataque terminar.",
      description:
        "Alvo parado que revida quando você entra no anel vermelho. Aprenda a sair do alcance logo depois do auto-atacar e voltar para manter o DPS.",
      unlockScore: 70,
      levels: asLevels(spacingLevels),
      create: (ctx) => new SpacingKitingDrill({ ...ctx, params: ctx.level.params }),
    },
    {
      id: "kiting-defensive",
      name: "Kiting Defensivo",
      category: "kiting",
      tagline: "Máxima distância, DPS máximo",
      hint: "Eles vão te perseguir. Fique no alcance máximo, bata e recue — nunca pare de andar.",
      description:
        "Inimigos te perseguem e atiram de longe. Você precisa manter o maior alcance possível enquanto ainda causa dano — o kiting de verdade.",
      unlockScore: 72,
      levels: asLevels(defensiveLevels),
      create: (ctx) => new KitingDrill({ ...ctx, params: ctx.level.params }),
    },
    {
      id: "kiting-peel",
      name: "Peel / Proteção",
      category: "kiting",
      tagline: "Kiteie os inimigos para longe do seu parceiro",
      hint: "O inimigo vai atrás do seu aliado. Atraia a pressão e mantenha a vida dele alta.",
      description:
        "Seu aliado está com vida baixa e os inimigos vão atrás dele. Atraia a pressão, kiteie e proteja sem deixar o carry morrer.",
      unlockScore: 75,
      levels: asLevels(peelLevels),
      create: (ctx) => new PeelKitingDrill({ ...ctx, params: ctx.level.params }),
    },
  ];
}

/**
 * Treinos extras que usam o mesmo motor de kiting, mas representam chaves
 * reais que não existiam no catálogo original do web trainer.  São anexados
 * depois dos treinos legados para não deslocar os índices usados pelo probe.
 */
export function buildRealKitingDrills(champions, snapshot = null) {
  if (!snapshot) return [];

  const microLevels = levelsOf(snapshot, "KITING_0").map((level, i) => ({
    index: Number(level.level) || i + 1,
    params: {
      duration: durationOf(level, 180),
      playerStats: level.playerStats,
      enemies: [{
        role: "melee",
        behaviour: "melee",
        hp: level.enemyStats?.health,
        stats: level.enemyStats,
        damageScale: 1,
        speedScale: 1,
        attackSpeedScale: 1,
      }],
    },
  }));

  const kitingDodgeLevels = levelsOf(snapshot, "KITING_DODGE").map((level, i) => {
    const min = level.minTimeToCast ?? 2;
    const max = level.maxTimeToCast ?? min;
    return {
      index: Number(level.level) || i + 1,
      params: {
        duration: durationOf(level, 180),
        playerStats: level.playerStats,
        casterCooldown: clamp((min + max) / 2, 1, 6),
        enemies: [{
          champion: "Ezreal",
          behaviour: "caster",
          spell: "Q",
          range: 1150,
          stats: level.enemyStats,
          moveSpeed: level.championMovementSpeed,
          hp: level.enemyStats?.health,
          damageScale: 1,
        }],
      },
    };
  });

  const out = [];
  if (microLevels.length) {
    out.push({
      id: "sg-kiting-microgame",
      name: "Kiting — Microgame (REA)",
      category: "kiting",
      tagline: "O microgame real de kiting, com stats do Firestore",
      hint: "Use o ritmo ataque → recuo. O inimigo real persegue com a velocidade e o dano recuperados.",
      description:
        "Versão do KITING_0 do Skill Gap: vida, dano, velocidade e velocidade de ataque do jogador e do inimigo vêm diretamente dos documentos de nível do Firestore.",
      unlockScore: 70,
      levels: microLevels,
      create: (ctx) => new KitingDrill({ ...ctx, params: ctx.level.params }),
    });
  }
  if (kitingDodgeLevels.length) {
    out.push({
      id: "sg-kiting-dodge",
      name: "Kiting + Esquiva (REA)",
      category: "kiting",
      tagline: "Kiteie enquanto desvia das skillshots",
      hint: "O inimigo persegue e lança skillshots. Mantenha a distância e saia da linha antes do projétil.",
      description:
        "Versão do KITING_DODGE: um campeão perseguidor com stats reais e tempo de cast recuperado do Firestore. O motor usa a skillshot real do campeão escolhido.",
      unlockScore: 72,
      levels: kitingDodgeLevels,
      create: (ctx) => new KitingDrill({ ...ctx, params: ctx.level.params }),
    });
  }
  return out;
}
