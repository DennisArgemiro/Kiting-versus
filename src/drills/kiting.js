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

const CASTER_POOL = ["Ahri", "Lux", "Morgana", "Brand", "Thresh", "Blitzcrank", "Zed", "Velkoz", "Ekko"];

function resolveChampion(spec, ctx) {
  const list = ctx.champions || [ctx.champion];
  const byAlias = Object.fromEntries(list.map((c) => [c.alias, c]));
  const pick = (pool, offset = 0) => pool[Math.abs(offset) % pool.length];

  let base;
  switch (spec.role) {
    case "partner": {
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

  return withRealStats(base, spec.stats, {
    attackRange: spec.attackRange,
    isMelee: spec.isMelee,
  });
}

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
    this.ready = 2.4;

    this.player = makePlayer(champion, ARENA.w * 0.375, ARENA.h / 2, 1);
    const playerStatsForDummy = params.playerStats ? { ...params.playerStats } : undefined;
    if (playerStatsForDummy) delete playerStatsForDummy.attackSpeed;
    applyPlayerStats(this.player, playerStatsForDummy, params.playerHpScale ?? 1);
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
      if (this.ready <= 0) {
        for (let i = 0; i < 3; i++) {
          try { this.spawnDummy(); } catch {}
        }
      }
      return;
    }

    if (!this.finished) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.finished = true;
        this.outcome = "completed";
      }
    }

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

    if (input.attackMoveActive && action.attacked && player.controller.order.kind === "attackMove") {
      input.deactivateAttackMove();
    }

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

    for (const enemy of this.enemies) {
      if (enemy.alive || enemy.counted) continue;
      enemy.counted = true;
      this.metrics.kills += 1;
      world.effect("ring", enemy.x, enemy.y, {
        color: "#46d39a", radius: 60, grow: 320, duration: 0.6,
      });
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

  focusTarget() {
    const ordered = this.player.controller.target;
    if (ordered && ordered.alive) return ordered;
    return this.enemies.find((e) => e.alive) || null;
  }

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

class SpacingKitingDrill {
  constructor({ champion, level, params, rng, champions, onMoveMarker }) {
    this.world = new World(ARENA);
    this.rng = rng || makeRng(Date.now());
    this.params = params;
    this.ctx = { champion, champions: champions || [champion], level, rng: this.rng };
    this.onMoveMarker = onMoveMarker;
    this.duration = params.duration ?? 60;
    this.timeLeft = this.duration;
    this.finished = false;
    this.outcome = "completed";
    this.ready = 2.4;

    this.levelNum = (level && level.index) || 1;

    this.player = makePlayer(champion, ARENA.w * 0.5, ARENA.h * 0.5, 1, 1);
    const playerStatsForDummy = params.playerStats ? { ...params.playerStats } : undefined;
    if (playerStatsForDummy) delete playerStatsForDummy.attackSpeed;
    applyPlayerStats(this.player, playerStatsForDummy, params.playerHpScale ?? 1);
    this.world.add(this.player);

    const dummyHits = this.levelNum >= 1 && this.levelNum <= 5 ? this.levelNum : 3;
    this.dummyHitsToKill = dummyHits;
    this.dummyHp = Math.max(1, Math.round((this.player.attackDamage || 60) * dummyHits));

    this.score = 0;
    this.lastPos = { x: this.player.x || 0, y: this.player.y || 0 };
    this.lastMoveTime = this.world.time;
    this.cooldownStartTime = 0;
    this.cooldownPenaltyTime = 0;
    this.movedDuringCooldown = false;

    this.dummies = [];
    this.dummyKills = 0;

    this.dummyLifeTime = Math.max(2, 10 - (this.levelNum - 1));

    this.world.onDamage = (unit, amount, source) => {
      if (!unit || !unit.isDummy || !unit.alive) return;
      unit.hitsTaken = (unit.hitsTaken || 0) + 1;
      if (unit.hitsTaken >= unit.hitsToKill) {
        unit.alive = false;
        try { this.scoreKillingDummy(unit); } catch {}
      }
    };
  }

  spawnDummy() {
    if (!this.rng || !this.player) return;
    const angle = this.rng.range(0, Math.PI * 2);
    // Spawn 20% beyond player's attack range
    const distance = this.player.attackRange * 1.2;
    const x = this.player.x + Math.cos(angle) * distance;
    const y = this.player.y + Math.sin(angle) * distance;
    if (!isFinite(x) || !isFinite(y)) return;

    const dummyHp = this.dummyHp;

    const dummy = new Champion(
      { stats: { health: dummyHp, attackDamage: 0, attackRange: 0, movementSpeed: 0, attackPeriod: 0.625, attackCastTime: 0.25, projectileSpeed: 0, armor: 0, magicResistance: 0 } },
      {
        team: "enemy",
        x,
        y,
        hp: dummyHp,
        radius: 40,
        moveSpeed: 0,
        attackRange: 0,
        attackPeriod: 0.625,
        attackCast: 0.25,
        attackDamage: 0,
        projectileSpeed: 0,
        isMelee: false,
      }
    );
    dummy.name = "Dummy";
    dummy.behaviour = "stationary";
    dummy.isDummy = true;
    dummy.maxHp = dummyHp;
    dummy.hp = dummyHp;
    dummy.hitsTaken = 0;
    dummy.hitsToKill = this.dummyHitsToKill;
    dummy.spawnTime = this.world.time;
    dummy.lifeTime = this.dummyLifeTime;
    this.world.add(dummy);
    this.dummies.push(dummy);

    this.world.effect("ring", x, y, {
      color: "#ffb454", radius: 60, grow: 0, duration: 999,
    });
  }

  scoreKillingDummy(dummy) {
    if (!dummy || !dummy.isDummy) return;
    this.score += 50;
    this.dummyKills += 1;
    dummy.respawnAt = this.world.time + 1.0;
  }

  update(dt, input) {
    input.dt = dt;
    const world = this.world;
    const player = this.player;
    const now = this.world.time;

    if (!player || !world) return;

    if (this.ready > 0) {
      this.ready = Math.max(0, this.ready - dt);
      world.update(dt);
      if (this.ready <= 0) {
        for (let i = 0; i < 2; i++) {
          try { this.spawnDummy(); } catch {}
        }
      }
      return;
    }

    if (!this.finished) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      if (this.timeLeft <= 0) {
        this.finished = true;
        this.outcome = "completed";
      }
    }

    const deadDummies = this.dummies.filter(d => d && !d.alive);
    for (const d of deadDummies) {
      try { world.remove(d); } catch {}
      this.dummies.splice(this.dummies.indexOf(d), 1);
    }
    const deadCount = this.dummies.filter(d => d && !d.alive).length;
    for (const d of this.dummies) {
      if (d && d.alive && d.spawnTime && d.lifeTime) {
        if (now - d.spawnTime >= d.lifeTime) {
          d.alive = false;
          try { world.remove(d); } catch {}
          const idx = this.dummies.indexOf(d);
          if (idx >= 0) this.dummies.splice(idx, 1);
        }
      }
    }
    while (this.dummies.filter(d => d && d.alive).length < 2) {
      try { this.spawnDummy(); } catch {}
    }

    let orders = null;
    try { orders = applyInput(player, input, world, this.onMoveMarker); } catch {}

    const moved = Math.hypot(player.x - this.lastPos.x, player.y - this.lastPos.y) > 1;
    this.lastPos = { x: player.x, y: player.y };

    const attackTimer = player.attackTimer || 0;
    const inCooldown = attackTimer > 0;

    let resolved = null;
    try { resolved = player.tickTimers(dt); } catch {}
    if (resolved) {
      this.score += 10;
      this.movedDuringCooldown = false;
      this.cooldownStartTime = now;
      try { resolveAttack(player, world, resolved, null); } catch {}
    }

    if (attackTimer > 0 && this.cooldownStartTime === 0) {
      this.cooldownStartTime = now;
      this.cooldownPenaltyTime = now;
      this.movedDuringCooldown = false;
    }
    if (attackTimer <= 0) {
      this.cooldownStartTime = 0;
      this.cooldownPenaltyTime = 0;
      this.movedDuringCooldown = false;
    }

    if (inCooldown && moved && !this.movedDuringCooldown) {
      this.score += 10;
      this.movedDuringCooldown = true;
    }

    if (inCooldown && !moved) {
      if (now - this.cooldownPenaltyTime >= 1.0) {
        this.score -= 1;
        this.cooldownPenaltyTime = now;
      }
    }

    if (!moved) {
      if (now - this.lastMoveTime >= 0.5) {
        this.score -= 2;
        this.lastMoveTime = now;
      }
    } else {
      this.lastMoveTime = now;
    }

    for (const slot of ["Q", "W", "E", "R"]) {
      try {
        if (input.hit(`Key${slot}`)) {
          castAbility(player, slot, input.mouse.x, input.mouse.y, world);
        }
      } catch {}
    }
    try { tickAbilities(player, dt); player.controller.update(dt, world); } catch {}

    try {
      if (input.attackMoveActive && player.controller.order.kind === "attackMove") {
        input.deactivateAttackMove();
      }
    } catch {}

    try { world.update(dt); world.separate(); world.clampUnits(); } catch {}

    if (!player.alive && !this.finished) {
      this.finished = true;
      this.outcome = "defeated";
    }
  }

  render(scene, opts) {
    if (!scene) return;
    try {
      scene.render(this.world, {
        player: this.player,
        showRanges: opts.showRanges !== false,
        attackMoveActive: opts.attackMoveActive,
        input: opts.input,
        focusTarget: this.focusTarget(),
        dt: opts.dt,
      });
    } catch {}
  }

  focusTarget() {
    let best = null;
    let bestDist = Infinity;
    for (const d of this.dummies) {
      if (d && d.alive) {
        const dd = Math.hypot(d.x - this.player.x, d.y - this.player.y);
        if (dd < bestDist) { bestDist = dd; best = d; }
      }
    }
    return best;
  }

  coach() {
    const player = this.player;
    const target = this.focusTarget();
    if (!target) return "Aguarde o próximo alvo aparecer";
    if (player.casting > 0) return "Ataque em andamento - recue";
    const d = Math.hypot(target.x - player.x, target.y - player.y);
    if (d > player.attackRange * 0.96) {
      return "Aproxime-se do dummy para atacar";
    }
    return "Ataque o dummy e recue antes do próximo swing";
  }

  hud() {
    const aliveDummies = this.dummies.filter(d => d && d.alive).length;
    return [
      { label: "Pontos", value: Math.max(0, Math.round(this.score)), tone: "good" },
      { label: "Dummies", value: this.dummyKills },
      { label: "Ativos", value: `${aliveDummies}/2` },
    ];
  }

  result() {
    const duration = Math.max(this.duration, 1);
    const score = Math.max(0, Math.round(this.score));

    let verdict = "";
    if (score >= 300) verdict = "Excelente! Ritmo impecável.";
    else if (score >= 200) verdict = "Muito bom. Mantenha o movimento.";
    else if (score >= 100) verdict = "Bom. Tente se mover mais entre ataques.";
    else if (score >= 50) verdict = "Precisa se movimentar mais entre os ataques.";
    else verdict = "Você está parado demais. Movimente-se!";

    const params = this.params || {};
    const dummiesParaPassar = params.dummiesParaPassar || 10;

    return {
      score,
      breakdown: [
        { name: "Pontuação", detail: "Pontos acumulados", value: score / 300, display: score.toString(), color: "#4ea1ff" },
        { name: "Dummies eliminados", detail: `${this.dummyKills}/${dummiesParaPassar} dummies eliminados`, value: this.dummyKills / dummiesParaPassar, display: this.dummyKills.toString(), color: "#46d39a" },
      ],
      verdict,
      stats: {
        score,
        dummyKills: this.dummyKills,
        duration: Math.round(this.duration - this.timeLeft),
        dummiesParaPassar,
      },
    };
  }
}

class PeelKitingDrill extends KitingDrill {
  constructor(opts) {
    super(opts);
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
    this.enemyTarget = () => (this.ally?.alive ? this.ally : this.player);
  }

  update(dt, input) {
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
      dummiesParaPassar: 5 + i * 3,
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
    { duration: 45, spread: 0.8, enemies: [{ role: "partner", damageScale: 0.30, attackSpeedScale: 1.45 }], dummiesParaPassar: 5 },
    { duration: 45, spread: 0.8, enemies: [{ role: "partner", damageScale: 0.38, attackSpeedScale: 1.25 }], dummiesParaPassar: 8 },
    { duration: 50, spread: 0.9, enemies: [{ role: "partner", damageScale: 0.42, attackSpeedScale: 1.1 }], dummiesParaPassar: 12 },
    { duration: 50, spread: 0.9, enemies: [{ role: "partner", damageScale: 0.42, attackSpeedScale: 1.1 }, { role: "partner", seed: 1, damageScale: 0.30, attackSpeedScale: 1.3 }], dummiesParaPassar: 15 },
    { duration: 55, spread: 1, enemies: [{ role: "partner", damageScale: 0.48, attackSpeedScale: 1.0 }, { role: "ranged", behaviour: "stationary", damageScale: 0.35, attackSpeedScale: 1.15 }], dummiesParaPassar: 18 },
    { duration: 55, spread: 1, enemies: [{ role: "partner", damageScale: 0.48, attackSpeedScale: 1.0 }, { role: "ranged", behaviour: "stationary", damageScale: 0.35, attackSpeedScale: 1.15 }, { role: "partner", seed: 1, damageScale: 0.32, attackSpeedScale: 1.25 }], dummiesParaPassar: 20 },
    { duration: 60, spread: 1.1, enemies: [{ role: "partner", damageScale: 0.52, attackSpeedScale: 0.95 }, { role: "ranged", behaviour: "stationary", damageScale: 0.4, attackSpeedScale: 1.05 }, { role: "melee", behaviour: "stationary", damageScale: 0.4, attackSpeedScale: 1.15 }], dummiesParaPassar: 25 },
    { duration: 60, spread: 1.1, enemies: [{ role: "partner", damageScale: 0.55, attackSpeedScale: 0.9 }, { role: "ranged", behaviour: "stationary", damageScale: 0.42, attackSpeedScale: 1.0 }, { role: "melee", behaviour: "stationary", damageScale: 0.42, attackSpeedScale: 1.1 }, { role: "partner", seed: 1, damageScale: 0.35, attackSpeedScale: 1.2 }], dummiesParaPassar: 30 },
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
      tagline: "Dummies de 3 hits - Elimine todos para passar de nível",
      hint: "Acerte o dummy quando estiver no seu anel azul. Recue logo após o ataque. Cada nível exige mais dummies mortos para passar.",
      description:
        "Destrua dummies que aparecem ao redor de você. Cada nível exige eliminar uma quantidade específica de dummies para avançar. Os dummies somem com o tempo, então seja rápido!",
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