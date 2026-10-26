import { World } from "../engine/world.js";
import { Champion } from "../engine/unit.js";
import { skillshotFromSpell } from "../engine/skillshot.js";
import {
  ARENA, applyInput, castAbility, makePlayer, resolveAttack, ringPositions,
  tickAbilities, tuneEnemy, unit01,
} from "./common.js";
import { clamp } from "../core/math.js";
import {
  applyPlayerStats, durationOf, levelsOf, selectedChampions as pickSelectedChampions,
  slotFromAbility, withRealStats,
} from "./kitingVersus.js";

/**
 * Dodge drill.
 *
 * The enemy casts real champion skillshots — real cast time, real projectile
 * speed, real hitbox width. You have to leave the shape before it resolves.
 *
 * Two numbers decide the score:
 *   dodge rate   how many shots you avoided
 *   reaction     how fast you left the danger zone after the telegraph
 */
class DodgeDrill {
  constructor({ champion, level, params, rng, onMoveMarker }) {
    this.world = new World(ARENA);
    this.rng = rng;
    this.params = params;
    this.duration = params.duration;
    this.timeLeft = params.duration;
    this.finished = false;
    this.outcome = "completed";
    // Countdown before the drill starts: the clock does not run yet.
    this.ready = 2.4;
    this.punishMode = params.punish === true;

    this.player = makePlayer(champion, ARENA.w / 2, ARENA.h / 2, 1);
    applyPlayerStats(this.player, params.playerStats, params.playerHpScale ?? 1);
    this.onMoveMarker = onMoveMarker;
    this.world.add(this.player);
    this.state = { attackTarget: null };

    this.metrics = {
      casts: 0,
      dodges: 0,
      hits: 0,
      punishes: 0,
      punishWindows: 0,
      damageTaken: 0,
      orders: 0,
      casts: 0,
      attacksStarted: 0,
      reactions: [],
      dodgesBySpell: {},
    };

    this.casters = [];
    this.spawnCasters(params);

    this.world.onDamage = (unit, amount) => {
      if (unit.team === "player") {
        this.metrics.damageTaken += amount;
      } else if (this.punishMode) {
        // Any damage on a caster while a punish window is open counts.
        const window = this.punishWindow;
        if (window && window.enemy === unit && this.world.time <= window.deadline) {
          window.damaged = true;
        }
      }
    };

    this.world.onSkillshotResolved = (shot, outcome) => {
      if (shot.team !== "enemy") return;
      this.countResolution(shot, outcome === "hit");
    };
  }

  spawnCasters(params) {
    const count = params.casters.length;
    const positions = ringPositions(
      count,
      ARENA.w / 2,
      ARENA.h / 2,
      params.radius ?? 880,
      (params.radius ?? 880) * 0.52,
      -Math.PI / 2,
    );
    params.casters.forEach((spec, i) => {
      const data = withRealStats(spec.champion, spec.stats);
      const enemy = new Champion(data, {
        team: "enemy",
        x: positions[i].x,
        y: positions[i].y,
        hp: spec.hp ?? data.stats.health * 3,
      });
      enemy.behaviour = "caster";
      // Casters have no auto-attack, so they get no threat ring.
      enemy.attackRange = 0;
      enemy.preferredRange = spec.range ?? 900;
      enemy.attackDamage = spec.attackDamage ?? data.stats.attackDamage * 0.5;
      enemy.moveSpeed = spec.moveSpeed ?? data.stats.movementSpeed * 0.7;
      enemy.casterTimer = spec.casterTimer ?? (0.9 + i * 0.55);
      enemy.baseCooldown = spec.cooldown;
      enemy.spellsPool = spec.spells;
      tuneEnemy(enemy);
      this.world.add(enemy);
      this.casters.push(enemy);
    });
  }

  /** Picks a spell the player is actually in range of, rotating the pool. */
  pickSpell(enemy, distance) {
    const pool = enemy.spellsPool || [];
    if (!pool.length) return null;
    for (let i = 0; i < pool.length; i++) {
      const index = ((enemy.spellIndex ?? -1) + 1 + i) % pool.length;
      const spell = pool[index];
      const reach = spell.length ?? spell.range ?? 900;
      if (distance <= reach) {
        enemy.spellIndex = index;
        return spell;
      }
    }
    // Nothing reaches: take the longest one and close the distance.
    let longest = pool[0];
    for (const spell of pool) {
      if ((spell.length ?? spell.range ?? 0) > (longest.length ?? longest.range ?? 0)) longest = spell;
    }
    enemy.spellIndex = pool.indexOf(longest);
    return longest;
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

    // Deactivate attack-move after an attack-move attack completes
    if (input.attackMoveActive && action.attacked && player.controller.order.kind === "attackMove") {
      input.deactivateAttackMove();
    }

    const resolved = player.tickTimers(dt);
    if (resolved) resolveAttack(player, world, resolved, null);

    // ---- casters ------------------------------------------------------
    for (const enemy of this.casters) {
      if (!enemy.alive) continue;
      enemy.faceTowards(player.x, player.y);

      const d = Math.hypot(player.x - enemy.x, player.y - enemy.y);
      const desired = enemy.preferredRange ?? 900;
      if (d > desired + 80) {
        enemy.moveToward(player.x, player.y, dt, 0.6);
      } else if (d < desired - 320) {
        enemy.moveDirection(-(player.x - enemy.x), -(player.y - enemy.y), dt, 0.6);
      }

      enemy.casterTimer -= dt;
      if (enemy.casterTimer <= 0) {
        const spell = this.pickSpell(enemy, d);
        const reach = spell ? (spell.length ?? spell.range ?? 900) : 0;
        if (spell && d <= reach) {
          // Only fire from inside the real reach of the spell.
          const shot = skillshotFromSpell(
            spell, enemy, player.x, player.y, "enemy", enemy.attackDamage * 1.5,
            this.params.speedScale ?? 1,
          );
          shot.startTime = world.time;
          shot.reactionStart = null;
          world.addSkillshot(shot);
          this.metrics.casts += 1;
          enemy.casterTimer = (enemy.baseCooldown ?? this.params.cooldown) + this.rng.range(-0.25, 0.4);
          enemy.preferredRange = reach * 0.95;
        } else {
          // Out of range: walk into it and try again shortly.
          enemy.casterTimer = 0.35;
          enemy.preferredRange = reach * 0.9;
          enemy.moveToward(player.x, player.y, dt, 0.75);
        }
      }
      const enemyResolved = enemy.tickTimers(dt);
      if (enemyResolved) resolveAttack(enemy, world, enemyResolved, null);
    }

    // ---- reaction tracking -------------------------------------------
    for (const shot of world.skillshots) {
      if (shot.team !== "enemy") continue;
      if (shot.reactionStart === null && shot.phase === "telegraph") {
        if (shot.threatensPoint(player.x, player.y, player.hitRadius)) {
          shot.reactionStart = world.time;
        }
      } else if (shot.reactionStart !== null) {
        if (!shot.threatensPoint(player.x, player.y, player.hitRadius)) {
          this.metrics.reactions.push(world.time - shot.reactionStart);
          shot.reactionStart = null;
          shot.escaped = true;
        }
      }
    }

    // ---- punish window (Dodge & Punish) -------------------------------
    if (this.punishMode) {
      if (this.punishWindow) {
        const w = this.punishWindow;
        if (w.damaged) {
          this.metrics.punishes += 1;
          world.effect("ring", w.enemy.x, w.enemy.y, {
            color: "#46d39a", radius: 40, grow: 260, duration: 0.5,
          });
          this.punishWindow = null;
        } else if (world.time > w.deadline) {
          this.punishWindow = null;
        }
      }
    }

    // ---- caster respawns ----------------------------------------------
    for (const enemy of this.casters) {
      if (enemy.alive) continue;
      if (enemy.respawnAt === undefined) {
        enemy.respawnAt = world.time + 4;
        world.effect("ring", enemy.x, enemy.y, {
          color: "#ff6b78", radius: 50, grow: 300, duration: 0.6,
        });
      } else if (world.time >= enemy.respawnAt) {
        enemy.respawnAt = undefined;
        enemy.hp = enemy.maxHp;
        enemy.alive = true;
        enemy.casterTimer = 1.2;
        world.effect("ring", enemy.x, enemy.y, {
          color: "#ff6b78", radius: 40, grow: 260, duration: 0.5,
        });
      }
    }

    world.update(dt);
    world.separate();
    world.clampUnits();

    if (!player.alive && !this.finished) {
      this.finished = true;
      this.outcome = "defeated";
    }
  }

  /** Count resolved skillshots: a hit or a dodge. */
  countResolution(shot, wasHit) {
    if (wasHit) {
      this.metrics.hits += 1;
      this.punishWindow = null;
    } else {
      const label = shot.spell ? `${shot.spell.slot}` : "?";
      this.metrics.dodges += 1;
      this.metrics.dodgesBySpell[label] = (this.metrics.dodgesBySpell[label] || 0) + 1;
      if (this.punishMode && shot.owner && shot.owner.alive) {
        this.metrics.punishWindows += 1;
        this.punishWindow = { enemy: shot.owner, deadline: this.world.time + 3.0, damaged: false };
      }
    }
  }

  render(scene, opts) {
    scene.render(this.world, {
      player: this.player,
      showRanges: opts.showRanges !== false,
      attackMoveActive: opts.attackMoveActive,
      input: opts.input,
      focusTarget: this.focusTarget ? this.focusTarget() : null,
      punishTarget: this.punishWindow ? this.punishWindow.enemy : null,
      dt: opts.dt,
    });
  }


  /** Live coaching for the dodge drill. */
  coach() {
    const player = this.player;
    for (const shot of this.world.skillshots) {
      if (shot.team !== "enemy") continue;
      if (shot.threatensPoint(player.x, player.y, player.hitRadius)) {
        return "Está incoming! Clique com o botão direito para o lado seguro";
      }
    }
    return "Fique pronto: a marcação aparece antes do projétil";
  }

  focusTarget() {
    const ordered = this.player.controller.target;
    if (ordered && ordered.alive) return ordered;
    return this.casters.find((c) => c.alive) || null;
  }

  hud() {
    const chips = [
      { label: "Esquivas", value: this.metrics.dodges, tone: "good" },
      { label: "Atingido", value: this.metrics.hits, tone: this.metrics.hits ? "bad" : "" },
      { label: "Lançamentos", value: this.metrics.casts },
    ];
    if (this.punishMode) {
      chips.push({ label: "Contragolpes", value: `${this.metrics.punishes}/${this.metrics.punishWindows}`, tone: "good" });
    }
    if (this.metrics.reactions.length) {
      const avg = this.metrics.reactions.reduce((a, b) => a + b, 0) / this.metrics.reactions.length;
      chips.push({ label: "Reação", value: `${(avg * 1000).toFixed(0)}ms` });
    }
    return chips;
  }

  result() {
    const m = this.metrics;
    const total = m.dodges + m.hits;
    const dodgeRate = total > 0 ? unit01(m.dodges / total) : 1;

    const avgReaction = m.reactions.length
      ? m.reactions.reduce((a, b) => a + b, 0) / m.reactions.length
      : 0;
    // 0.45s or slower is sloppy, 0.12s or faster is excellent.
    const reactionScore = m.reactions.length ? unit01((0.45 - avgReaction) / (0.45 - 0.12)) : 0.5;

    let score = Math.round(100 * (0.75 * dodgeRate + 0.25 * reactionScore));
    const breakdown = [
      {
        name: "Taxa de esquiva",
        detail: `${m.dodges} esquivados de ${total} lançamentos`,
        value: dodgeRate,
        display: `${Math.round(dodgeRate * 100)}%`,
        color: "#46d39a",
      },
      {
        name: "Tempo de reação",
        detail: m.reactions.length
          ? `Média de ${(avgReaction * 1000).toFixed(0)}ms para sair da área de perigo`
          : "Você nunca entrou na área de perigo",
        value: reactionScore,
        display: m.reactions.length ? `${(avgReaction * 1000).toFixed(0)}ms` : "—",
        color: "#ffb454",
      },
    ];

    if (this.punishMode) {
      const punishRate = m.punishWindows > 0 ? unit01(m.punishes / m.punishWindows) : 0;
      score = Math.round(clamp(score * 0.75 + punishRate * 100 * 0.25, 0, 100));
      breakdown.push({
        name: "Contragolpe",
        detail: `${m.punishes} de ${m.punishWindows} esquivas transformadas em dano`,
        value: punishRate,
        display: `${Math.round(punishRate * 100)}%`,
        color: "#4ea1ff",
      });
    }

    return {
      score,
      breakdown,
      verdict: verdictFor(score, this.outcome),
      stats: {
        casts: m.casts,
        dodges: m.dodges,
        hits: m.hits,
        punishes: m.punishes,
        damageTaken: Math.round(m.damageTaken),
        avgReactionMs: Math.round(avgReaction * 1000),
      },
    };
  }
}


function verdictFor(score, outcome) {
  if (outcome === "defeated") return "Você tomou dano demais. Saia da área marcada assim que ela aparecer.";
  if (score >= 90) return "Excelente. Você lê a skillshot e sai antes de ela viajar.";
  if (score >= 75) return "Muito bom. Aumente a antecipação — não espere a linha tocar em você.";
  if (score >= 55) return "Bom. Você se move, mas às vezes tarde demais.";
  if (score >= 35) return "Está olhando para o projétil. Olhe para a marcação no chão.";
  return "Fique de olho no indicador de perigo: ele aparece antes do disparo.";
}

// ───────────────────────────────────────────────────────────────────────────
// Drill definitions
// ───────────────────────────────────────────────────────────────────────────

export function buildDodgeDrills(champions, snapshot = null) {
  const byAlias = Object.fromEntries(champions.map((c) => [c.alias, c]));

  const dodgeSpells = (alias) => {
    const champ = byAlias[alias];
    if (!champ) return [];
    return (champ.spells || [])
      .filter((s) => s.slot !== "P" && (s.shape === "linear" || s.shape === "circle"))
      .filter((s) => (s.range ?? 0) >= 600);
  };

  const pool = ["Ahri", "Lux", "Morgana", "Brand", "Thresh", "Blitzcrank", "Zed", "Velkoz", "Ekko"];

  const makeCasters = (aliases) =>
    aliases.map((alias) => ({
      champion: byAlias[alias],
      spells: dodgeSpells(alias).slice(0, 3),
      range: 1300,
    }));

  /**
   * Monta os níveis de SKILL_DODGE/SHOOT_DODGE usando os campeões, pesos de
   * spawn, velocidade de movimento e taxa de spawn recuperados do Firestore.
   * Nidalee e Xerath não estão no elenco web; os pesos dos disponíveis são
   * renormalizados naturalmente pela ordenação.
   */
  const realCasterLevels = (key, punish = false) => {
    if (!snapshot) return [];
    return levelsOf(snapshot, key).map((level, i) => {
      const picks = pickSelectedChampions(level, champions, 6);
      const count = clamp(Math.round(level.maxEntitiesAlive ?? 3), 1, 5);
      const rate = Math.max(0.1, Number(level.spawnsPerSecond) || 0.5);
      const cooldown = clamp(1 / rate, 1.1, 4.5);
      const casters = [];

      for (let n = 0; n < count; n++) {
        const pick = picks.length ? picks[n % picks.length] : null;
        const champion = pick?.champion || byAlias[pool[n % pool.length]] || champions[0];
        if (!champion) break;
        const slot = slotFromAbility(pick?.skillshotToUse) || "Q";
        let spells = dodgeSpells(champion.alias).filter((s) => s.slot === slot);
        if (!spells.length) spells = dodgeSpells(champion.alias);
        if (!spells.length) spells = makeCasters([champion.alias])[0]?.spells || [];
        casters.push({
          champion,
          spells: spells.slice(0, 1),
          range: 1150,
          moveSpeed: pick?.movementSpeed,
          cooldown,
          casterTimer: 0.8 + n * 0.35,
        });
      }

      return {
        index: Number(level.level) || i + 1,
        params: {
          duration: durationOf(level, 60),
          cooldown,
          radius: 880,
          speedScale: 1,
          casters,
          ...(punish ? { punish: true } : {}),
        },
      };
    });
  };

  const levels = [];
  const counts = [1, 1, 2, 2, 2, 3, 3, 4];
  const cooldowns = [3.2, 2.6, 2.4, 2.0, 1.8, 1.6, 1.4, 1.2];
  // Projectile speed multiplier per level. The shapes, widths and cast times
  // stay authentic; only the flight time scales, which is how aim trainers
  // ramp difficulty without changing the skill being trained.
  const speedScales = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85];
  const durations = [40, 40, 45, 45, 50, 50, 55, 55];
  for (let i = 0; i < counts.length; i++) {
    const aliases = pool.slice(i % 3, i % 3 + counts[i]);
    levels.push({
      index: i + 1,
      params: {
        duration: durations[i],
        cooldown: cooldowns[i],
        radius: 880,
        speedScale: speedScales[i],
        casters: makeCasters(aliases),
      },
    });
  }

  const realSkillLevels = realCasterLevels("SKILL_DODGE", false);
  const realShootLevels = realCasterLevels("SHOOT_DODGE", true);

  const punishLevels = realShootLevels.length
    ? realShootLevels
    : levels.map((lv) => ({
        index: lv.index,
        params: { ...lv.params, punish: true, duration: lv.params.duration + 10 },
      }));

  return [
    {
      id: "dodge-skillshot",
      name: "Esquiva de Skillshots",
      category: "dodge",
      tagline: "Saia da marcação antes do projétil chegar",
      hint: "A marcação aparece antes do disparo. Saia dela assim que enxergar.",
      description:
        "Campeões reais lançam suas skillshots com o tempo de cast e a velocidade de projétil originais. Você vê a marcação, reage e sobrevive.",
      unlockScore: 70,
      levels: realSkillLevels.length ? realSkillLevels : levels,
      create: (ctx) => new DodgeDrill({ ...ctx, params: ctx.level.params }),
    },
    {
      id: "dodge-punish",
      name: "Esquiva e Contragolpe",
      category: "dodge",
      tagline: "Desvie e transforme a esquiva em dano",
      hint: "Desvie e em 3 segundos revide com um auto-ataque no inimigo que atirou.",
      description:
        "Além de sobreviver, você tem 3 segundos depois de cada esquiva para punir o inimigo. É o padrão real: desviar e contra-atacar.",
      unlockScore: 75,
      levels: punishLevels,
      create: (ctx) => new DodgeDrill({ ...ctx, params: ctx.level.params }),
    },
  ];
}
