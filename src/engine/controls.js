/**
 * Controls — único caminho de entrada → ordens de TODOS os modos.
 *
 * Traduz cliques (mover/atacar/attack-move) e tecla S (stop) em ordens para
 * o Controller da unidade. Treinos (kiting, esquiva) e Arena usam todos
 * exatamente esta função — nunca um caminho proprio.
 *
 * Callbacks externos:
 *   - onMoveMarker(x, y, corHex) → marcador visual (conectado pelo main.js).
 */
import { ORDER, unitUnderCursor } from "./orders.js";

/** Tolerância de clique direto em cima do modelo (LoL-like). */
const DIRECT_CLICK_RADIUS = 120;

export function applyInput(player, input, world, onMoveMarker) {
  const controller = player.controller;
  const events = { attacked: null, cast: null, ordered: null };

  if (input.hit("KeyS")) {
    controller.stop();
    events.ordered = ORDER.STOP;
  }

  for (const click of input.takeClicks()) {
    // Botão esquerdo (0) e direito (2) compartilham a mesma política LoL-like.
    if (click.button !== 0 && click.button !== 2) continue;

    // Clique DIRETO no inimigo: raio apertado (em cima do modelo, como no LoL).
    // A tolerância larga (procurar inimigo perto do cursor) é exclusiva do A.
    const unit = unitUnderCursor(world, click.x, click.y, DIRECT_CLICK_RADIUS);
    const attackMove = input.attackMoveActive;
    input.lastClick = { button: click.button, x: click.x, y: click.y, onUnit: Boolean(unit) };

    if (attackMove) {
      input.consumedAttackMove = true;
      // A segurado: tenta achar inimigo próximo do clique...
      let enemyNear = null;
      if (world && world.nearest) {
        enemyNear = world.nearest(
          click.x, click.y,
          (player.attackRange || 550) * 1.3,
          (u) => u && u.alive && u.team !== player.team,
        );
      }
      // ...com fallback: clique direto em cima do inimigo.
      if (!enemyNear && unit && unit.alive && unit.team !== player.team) {
        enemyNear = unit;
      }
      if (enemyNear && enemyNear.alive) {
        controller.attackUnit(enemyNear);
        events.ordered = ORDER.ATTACK;
        onMoveMarker?.(enemyNear.x, enemyNear.y, 0xff5f6d);
      } else {
        // Sem inimigo próximo: ataque-move para o ponto.
        controller.attackMoveTo(click.x, click.y);
        events.ordered = ORDER.ATTACK_MOVE;
        onMoveMarker?.(click.x, click.y, 0xffb454);
      }
    } else if (unit && unit.alive) {
      // Clique em unidade: atacar (prioridade sobre mover).
      controller.attackUnit(unit);
      events.ordered = ORDER.ATTACK;
      onMoveMarker?.(unit.x, unit.y, 0xff5f6d);
    } else {
      // Clique no chão: mover.
      controller.moveTo(click.x, click.y);
      events.ordered = ORDER.MOVE;
      onMoveMarker?.(click.x, click.y, 0x4ea1ff);
    }
  }

  return events;
}
