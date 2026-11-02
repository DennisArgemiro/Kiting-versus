import { World } from "../engine/world.js";
import { Champion } from "../engine/unit.js";
import { skillshotFromSpell } from "../engine/skillshot.js";
import { applyInput } from "../engine/controls.js";
import { makePlayer } from "../engine/factory.js";
import { ARENA } from "../engine/battlefield.js";
import { castAbility, resolveAttack, tickAbilities } from "../engine/combat.js";
import { renderDrillScene } from "../rendering/render.js";
import { clamp } from "../core/math.js";
import { Carry } from "../champions/Carry.js";
import { Ahri } from "../champions/Ahri.js";
import { Dummy } from "../champions/Dummy.js";
import { HealPowerup } from "../powerups/Heal.js";
import { AttackSpeedPowerup } from "../powerups/AttackSpeed.js";
import { MoveSpeedPowerup } from "../powerups/MoveSpeed.js";
import { PowerupManager } from "../powerups/PowerupManager.js";

const CHAMPION_BY_ALIAS = {
  Carry,
  Ahri,
  Dummy,
};

function pickBot(champions, botAlias, rng) {
  if (!champions || champions.length === 0) {
    return Ahri;
  }
  const byAlias = Object.fromEntries(champions.map((c) => [c.alias, c]));
  return byAlias[botAlias] || champions[Math.floor(rng.range(0, champions.length))];
}

export class VersusDrill {
  constructor({ champion, champion2, isBot, botDifficulty, powerupsEnabled, abilitiesEnabled, rng, champions }) {
    this.world = new World(ARENA);
    this.rng = rng;
    this.params = {};
    this.ctx = { champion, champions: champions || [champion], level: { index: 1 }, rng };
    this.duration = 180;
    this.timeLeft = 180;
    this.finished = false;
    this.outcome = "completed";
    this.ready = 2.4;
    this.isBot = isBot;
    this.botDifficulty = botDifficulty;
    this.powerupsEnabled = powerupsEnabled;
    this.abilitiesEnabled = abilitiesEnabled;

    // Player 1 (human) - use makePlayer for proper HUD properties
    const p1Data = CHAMPION_BY_ALIAS[champion?.alias] || Carry;
    this.player = makePlayer(p1Data, ARENA.w * 0.25, ARENA.h / 2, 1);
    this.player.isPlayer = true;
    this.world.add(this.player);

    // Player 2 (bot) - use makePlayer for proper HUD properties
    const p2Data = CHAMPION_BY_ALIAS[champion2?.alias] || Ahri;
    this.player2 = makePlayer(p2Data, ARENA.w * 0.75, ARENA.h / 2, 1);
    this.player2.team = "enemy";
    this.player2.isPlayer = false;
    this.world.add(this.player2);

    this.playerKills = 0;
    this.botKills = 0;

    this.metrics = {
      attacksStarted: 0,
      attacksLanded: 0,
      attacksResolved: 0,
      damageDealt: 0,
      damageTaken: 0,
      casts: 0,
      kills: 0,
    };

    this.botTimer = 1.0;
    // Ciclo de power-ups delegado ao módulo powerups/PowerupManager.js
    this.powerups = powerupsEnabled
      ? new PowerupManager({ arena: ARENA, rng, world: this.world, maxPowerups: 3 })
      : null;
    if (this.powerups) {
      this.powerups.spawn();
      this.powerups.spawn();
    }
    this.activePowerups = new Map();

    // World damage hook: track kills
    this.world.onDamage = (unit, amount, source) => {
      if (!unit || !source) return;
      if (source === this.player && unit === this.player2) {
        this.metrics.damageDealt += amount;
      } else if (source === this.player2 && unit === this.player) {
        this.metrics.damageTaken += amount;
      }
    };

    this.world.onDeath = (unit, killer) => {
      if (!unit) return;
      // Se o player matou o bot
      if (unit === this.player2) {
        this.playerKills += 1;
        this.metrics.kills += 1;
        this.player2.respawnAt = this.world.time + 4;
        // Killer heals 50%
        const heal = Math.max(1, Math.floor(this.player.maxHp * 0.5));
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + heal);
        if (this.playerKills >= 5) {
          this.finished = true;
          this.outcome = "victory";
        }
      }
      // Se o bot matou o player
      if (unit === this.player) {
        this.botKills += 1;
        this.player.respawnAt = this.world.time + 4;
        if (this.botKills >= 5) {
          this.finished = true;
          this.outcome = "defeat";
        }
      }
    };
  }

  /** Conexão externa do marcador visual (definida pelo main.js). */
  onMoveMarker = null;

  update(dt, input) {
    if (this.finished) return;

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      this.finished = true;
      this.outcome = this.playerKills > this.botKills ? "victory" : "defeat";
      return;
    }

    // Player 1 input — mesmo caminho de input de TODOS os modos (applyInput)
    // O marcador visual é conectado externamente via this.onMoveMarker.
    if (this.player && this.player.alive) {
      const p1Orders = applyInput(this.player, input, this.world, (x, y, color) => this.onMoveMarker?.(x, y, color));
      if (this.abilitiesEnabled) {
        for (const slot of ['Q', 'W', 'E', 'R']) {
          if (input.hit && input.hit(`Key${slot}`) && input.mouse) {
            const mx = input.mouse.x;
            const my = input.mouse.y;
            if (Number.isFinite(mx) && Number.isFinite(my) && mx > 0 && my > 0 && mx < ARENA.w && my < ARENA.h) {
              const spell = castAbility(this.player, slot, mx, my, this.world);
              if (spell) this.metrics.casts += 1;
            }
          }
        }
      }
      if (this.player.controller) this.player.controller.update(dt, this.world);
      tickAbilities(this.player, dt);
      const p1Resolved = this.player.tickTimers(dt);
      if (p1Resolved) resolveAttack(this.player, this.world, p1Resolved, null);
    } else if (this.player && !this.player.alive && this.player.respawnAt && this.world.time >= this.player.respawnAt) {
      this.player.hp = this.player.maxHp;
      this.player.alive = true;
      this.player.respawnAt = 0;
      this.player.deadChecked = false;
    }

    // Bot AI
    if (this.player2 && this.player2.alive && this.player && this.player.alive) {
      this.botTimer -= dt;
      const target = this.player;
      const d = Math.hypot(target.x - this.player2.x, target.y - this.player2.y);

      const difficultySettings = {
        easy: { reaction: 0.5, accuracy: 0.6, aggression: 0.4 },
        normal: { reaction: 0.3, accuracy: 0.8, aggression: 0.6 },
        hard: { reaction: 0.15, accuracy: 0.9, aggression: 0.8 },
        expert: { reaction: 0.05, accuracy: 1.0, aggression: 1.0 }
      };
      const settings = difficultySettings[this.botDifficulty] || difficultySettings.normal;

      if (this.botTimer <= 0) {
        this.botTimer = settings.reaction + this.rng.range(-0.1, 0.2);

        if (d <= this.player2.attackRange * 1.1 && this.player2.canAttack()) {
          this.player2.controller.attackUnit(target);
        } else if (d > this.player2.attackRange * 1.2) {
          const movePoint = {
            x: target.x + this.rng.range(-100, 100),
            y: target.y + this.rng.range(-100, 100)
          };
          this.player2.controller.moveTo(movePoint.x, movePoint.y);
        } else {
          const angle = Math.atan2(this.player2.y - target.y, this.player2.x - target.x) + this.rng.range(-0.5, 0.5);
          const strafePoint = {
            x: this.player2.x + Math.cos(angle) * 200,
            y: this.player2.y + Math.sin(angle) * 200
          };
          this.player2.controller.moveTo(strafePoint.x, strafePoint.y);
        }

        if (this.abilitiesEnabled && Math.random() < settings.accuracy * 0.3) {
          const available = ['Q', 'W', 'E', 'R'].filter(s => this.player2.abilityCooldowns[s] <= 0);
          if (available.length) {
            const slot = available[Math.floor(this.rng.range(0, available.length))];
            const spell = this.player2.spells?.get(slot);
            if (spell) {
              castAbility(this.player2, slot, target.x, target.y, this.world);
            }
          }
        }
      }

      if (this.player2.controller) this.player2.controller.update(dt, this.world);
      tickAbilities(this.player2, dt);
      const p2Resolved = this.player2.tickTimers(dt);
      if (p2Resolved) resolveAttack(this.player2, this.world, p2Resolved, null);
    } else if (this.player2 && !this.player2.alive && this.player2.respawnAt && this.world.time >= this.player2.respawnAt) {
      this.player2.hp = this.player2.maxHp;
      this.player2.alive = true;
      this.player2.respawnAt = 0;
      this.player2.deadChecked = false;
    }

    // Powerups — ciclo delegado ao módulo powerups/ (spawn/decaimento/coleta)
    if (this.powerups) {
      this.powerups.update(dt, [this.player, this.player2]);
    }

    try {
      this.world.update(dt);
      this.world.separate();
      this.world.clampUnits();
    } catch (e) {
      console.error('versus world update error', e, e.stack);
    }
  }

  render(scene, opts = {}) {
    renderDrillScene(scene, this.world, {
      player: this.player,
      showRanges: opts.showRanges !== false,
      attackMoveActive: opts.attackMoveActive,
      input: opts.input,
      focusTarget: this.player?.controller?.target,
      dt: opts.dt,
      powerups: this.powerups ? this.powerups.list : [],
    });
  }

  result() {
    return {
      score: 0,
      verdict: this.outcome === "victory" ? "Vitória" : "Derrota",
      breakdown: [
        { name: "Seus abates", detail: "", value: this.playerKills, display: String(this.playerKills), color: "#4ea1ff" },
        { name: "Abates do bot", detail: "", value: this.botKills, display: String(this.botKills), color: "#ff5f6d" },
        { name: "Habilidades", detail: "", value: this.metrics.casts, display: String(this.metrics.casts), color: "#4ea1ff" },
      ],
      stats: {
        casts: this.metrics.casts,
        playerKills: this.playerKills,
        botKills: this.botKills,
        damageDealt: this.metrics.damageDealt,
        damageTaken: this.metrics.damageTaken,
        duration: this.duration - this.timeLeft,
      },
    };
  }

  hud() {
    return [
      { label: "Seus abates", value: this.playerKills, tone: "good" },
      { label: "Abates do bot", value: this.botKills },
      { label: "Tempo", value: Math.round(this.timeLeft) },
    ];
  }

  coach() {
    if (!this.player2 || !this.player2.alive) return "Bot respawndo...";
    const d = Math.hypot(this.player.x - this.player2.x, this.player.y - this.player2.y);
    if (d <= this.player.attackRange) return "Bot em alcance! Ataque ou recue.";
    return "Encare o bot ou mantenha distância.";
  }
}

export function buildVersusDrill(champion1, champion2, isBot, botDifficulty, powerupsEnabled, abilitiesEnabled, rng, champions = []) {
  return {
    id: "versus",
    name: "Versus",
    category: "versus",
    create: (ctx) => new VersusDrill({
      champion: champion1,
      champion2,
      isBot,
      botDifficulty,
      powerupsEnabled,
      abilitiesEnabled,
      rng,
      champions,
    }),
  };
}