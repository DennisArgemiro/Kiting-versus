/**
 * DrillBase — ciclo de vida compartilhado por TODOS os treinos.
 *
 * Cada treino (kiting, esquiva, sobrevivência...) é um orquestrador fino:
 * define SEU cenário (inimigos/dummies/timing) e as funções de decisão
 * (coach/hud/result) — todo o resto do frame vem daqui, que por sua vez só
 * invoca os módulos engine/ (controls, factory, combat) e rendering/.
 *
 * Esqueleto de frame que a base padroniza:
 *   1. countdown (tickReady)  → 2. relógio (tickClock)
 *   3. input → ordens (takeOrders)
 *   4. QWER + cooldowns (castAbilities)
 *   5. controller + attack-move + auto-attack (controlPass)
 *   6. lógica exclusiva do treino (inimigos, dummies, scoring)
 *   7. simulação (simStep)  → 8. derrota (checkDefeat)
 */
import { World } from "../engine/world.js";
import { ARENA } from "../engine/battlefield.js";
import { applyInput } from "../engine/controls.js";
import { castAbility, resolveAttack, tickAbilities } from "../engine/combat.js";
import { renderDrillScene } from "../rendering/render.js";

export const ABILITY_SLOTS = ["Q", "W", "E", "R"];

export class DrillBase {
  /**
   * @param {object} opts
   *   champion  — dados do campeão do jogador
   *   level     — { index, params } do nível ativo
   *   rng       — PRNG seedable (mesma seed = mesma partida)
   *   onMoveMarker(x, y, cor) — marcador visual, conectado pelo main.js
   */
  constructor({ champion, level, params, rng, champions, onMoveMarker, duration, outcome = "completed", ready = 2.4 }) {
    this.world = new World(ARENA);
    this.rng = rng;
    this.params = params || {};
    this.levelNum = (level && level.index) || 1;
    this.ctx = { champion, champions: champions || [champion], level, rng };
    this.onMoveMarker = onMoveMarker;
    this.duration = duration;
    this.timeLeft = duration;
    this.finished = false;
    this.outcome = outcome;
    this.ready = ready;
    this.state = { attackTarget: null };
    this.metrics = this.buildMetrics();
  }

  /** Métricas padrão — cada treino adiciona/remover chaves que usa. */
  buildMetrics() {
    return {
      attacksStarted: 0,
      attacksLanded: 0,
      attacksResolved: 0,
      orders: 0,
      casts: 0,
      kills: 0,
      damageDealt: 0,
      damageTaken: 0,
    };
  }

  /** Countdown inicial: mundo roda, cenário spawna quando zera (uma vez). */
  tickReady(dt) {
    this.ready = Math.max(0, this.ready - dt);
    this.world.update(dt);
    if (this.ready <= 0) this.onReady();
  }

  /** Hook: chamado uma única vez ao fim do countdown (2.4s). */
  onReady() {}

  /**
   * Caminho ÚNICO de entrada → ordens em todos os treinos.
   * `count: false` para treinos que não contam ordens (score próprio).
   */
  takeOrders(input, { count = true } = {}) {
    let orders = null;
    try {
      orders = applyInput(this.player, input, this.world, this.onMoveMarker);
      if (orders && count && orders.ordered) this.metrics.orders += 1;
    } catch (e) {
      console.error("drill input error", e, e.stack);
    }
    return orders;
  }

  /**
   * QWER do jogador pela ÚNICA rota (engine/combat castAbility).
   * `tickCooldowns: false` quando o treino decai cooldowns em outro lugar.
   */
  castAbilities(input, { count = true, tickCooldowns = true, dt = 0 } = {}) {
    for (const slot of ABILITY_SLOTS) {
      if (input.hit(`Key${slot}`)) {
        try {
          const spell = castAbility(this.player, slot, input.mouse.x, input.mouse.y, this.world);
          if (spell && count) this.metrics.casts += 1;
        } catch (e) {
          console.error("drill ability error", e, e.stack);
        }
      }
    }
    if (tickCooldowns) tickAbilities(this.player, dt);
  }

  /**
   * Controller → attack-move → tickTimers → resolveAttack (mesma ordem que o
   * LoL usa). Options:
   *   trackAttacks         conta attacksStarted (padrão true)
   *   trackResolves        conta attacksResolved (padrão true)
   *   onResolved(target)   callback de acerto do ataque
   *   attackMoveDeactivate "onAttack" (padrão: desliga A após o swing) | "always"
   */
  controlPass(dt, input, opts = {}) {
    const player = this.player;
    const world = this.world;
    const action = player.controller.update(dt, world);

    if (opts.trackAttacks !== false && action && action.attacked) {
      this.metrics.attacksStarted += 1;
    }

    const mode = opts.attackMoveDeactivate || "onAttack";
    const kind = player.controller.order ? player.controller.order.kind : null;
    const deactivate =
      mode === "always"
        ? input.attackMoveActive && kind === "attackMove"
        : input.attackMoveActive && action && action.attacked && kind === "attackMove";
    if (deactivate) input.deactivateAttackMove();

    const resolved = player.tickTimers(dt);
    if (resolved) {
      if (opts.trackResolves !== false) this.metrics.attacksResolved += 1;
      resolveAttack(player, world, resolved, opts.onResolved ?? null);
    }
    return { action, resolved };
  }

  /** Simulação: física, separação de corpos e clamp na arena. */
  simStep(dt) {
    this.world.update(dt);
    this.world.separate();
    this.world.clampUnits();
  }

  /** Relógio da partida: encerra com "completed" quando zera. */
  tickClock(dt) {
    if (this.finished) return;
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      this.finished = true;
      this.outcome = "completed";
    }
  }

  /** Derrota: jogador morto encerra o treino. */
  checkDefeat() {
    if (!this.player || this.player.alive || this.finished) return;
    this.finished = true;
    this.outcome = "defeated";
  }

  /** Alvo padrão: a ordem atual do controller (cada treino refina). */
  focusTarget() {
    const ordered = this.player.controller.target;
    if (ordered && ordered.alive) return ordered;
    return null;
  }

  /** Render padrão por renderDrillScene (mesma pipeline de todos os modos). */
  render(scene, opts = {}) {
    renderDrillScene(scene, this.world, {
      player: this.player,
      ...opts,
      focusTarget: this.focusTarget ? this.focusTarget() : null,
      dt: opts.dt,
    });
  }
}

/**
 * Texto de veredito — única implementação, configurada por treino.
 * `bands` = [[scoreMinimo, texto], ...] em ordem decrescente.
 */
export function verdictFor(score, outcome, { defeated, bands = [] } = {}) {
  const fallback = bands.length ? bands[bands.length - 1][1] : "";
  if (outcome === "defeated") return defeated ?? fallback;
  for (const [min, text] of bands) if (score >= min) return text;
  return fallback;
}
