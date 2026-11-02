/**
 * PowerupManager — módulo único responsável por ciclos de power-up:
 * spawn, decaimento por tempo e coleta por contato.
 *
 * Usável por qualquer modo/treino: recebe a arena, um RNG e as unidades
 * que podem coletar. As classes de power-up ficam em arquivos próprios
 * (Heal.js, AttackSpeed.js, MoveSpeed.js).
 */
import { HealPowerup } from "./Heal.js";
import { AttackSpeedPowerup } from "./AttackSpeed.js";
import { MoveSpeedPowerup } from "./MoveSpeed.js";
import { RangePowerup } from "./Range.js";

const POWERUP_CLASSES = [HealPowerup, AttackSpeedPowerup, MoveSpeedPowerup, RangePowerup];

export class PowerupManager {
  constructor({ arena, rng, world, maxPowerups = 3, spawnInterval = { min: 12, max: 20 } } = {}) {
    this.arena = arena;
    this.rng = rng;
    this.world = world;
    this.maxPowerups = maxPowerups;
    this.spawnInterval = spawnInterval;
    this.spawnTimer = 5;
    this.items = [];
  }

  /** Cria um power-up aleatório em posição aleatória da arena. */
  spawn() {
    const PowerupClass = POWERUP_CLASSES[Math.floor(this.rng.range(0, POWERUP_CLASSES.length))];
    const type = new PowerupClass();
    const margin = 200;
    // NOTE: spread (...) copia apenas propriedades próprias da instância.
    // apply/id/name/color/icon são getters estáticos da classe, não da instância,
    // então precisam ser copiados explicitamente com bind para manter o `this`.
    this.items.push({
      ...type,
      id: PowerupClass.id,
      name: PowerupClass.name,
      color: PowerupClass.color,
      icon: PowerupClass.icon,
      apply: type.apply.bind(type),
      x: this.rng.range(margin, this.arena.w - margin),
      y: this.rng.range(margin, this.arena.h - margin),
      life: 30,
      collected: false,
    });
  }

  /**
   * Tick: decai o timer de spawn, decai a vida dos itens e aplica coleta
   * por proximidade para as unidades passadas em `units`.
   */
  update(dt, units = []) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.items.length < this.maxPowerups) {
      this.spawn();
      this.spawnTimer = this.rng.range(this.spawnInterval.min, this.spawnInterval.max);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const pu = this.items[i];
      if (!pu) { this.items.splice(i, 1); continue; }
      pu.life = (pu.life ?? 30) - dt;
      if (pu.life <= 0) {
        this.items.splice(i, 1);
        continue;
      }

      for (const unit of units) {
        if (!unit || !unit.alive || pu.collected) continue;
        const d = Math.hypot(unit.x - pu.x, unit.y - pu.y);
        if (d < (unit.radius || 65) + 40) {
          pu.collected = true;
          pu.apply?.(unit);
          // Feedback visual de coleta
          if (this.world && typeof this.world.effect === "function") {
            try {
              this.world.effect("text", pu.x, pu.y, {
                text: pu.name ?? "Power-up",
                color: pu.color ?? "#ffffff",
                duration: 1.2,
                radius: 0,
                grow: 0,
              });
            } catch (e) { console.error("[Powerup] efeito erro", e); }
          }
          this.items.splice(i, 1);
          break;
        }
      }
    }
  }

  /** Lista imutável para renderização. */
  get list() {
    return this.items;
  }
}
