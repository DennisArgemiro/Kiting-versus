import { norm } from "../core/math.js";

/**
 * League of Legends command model.
 *
 *   right click on ground  -> move order
 *   right click on enemy   -> attack order (walk into range, then attack)
 *   A + click              -> attack-move order
 *   S                      -> stop
 *   Q / W / E / R          -> cast, aimed with the mouse
 *
 * An order is sticky until it is replaced: that is why kiting works the way
 * it does - you order an attack, then order a move to break away, then order
 * the attack again.
 */

export const ORDER = {
  STOP: "stop",
  MOVE: "move",
  ATTACK: "attack",
  ATTACK_MOVE: "attackMove",
};

const STOP_RADIUS = 45;

export class Controller {
  constructor(player) {
    this.player = player;
    this.order = { kind: ORDER.STOP };
    this.moving = 0;
    this.lastOrderKind = ORDER.STOP;
  }

  stop() {
    this.order = { kind: ORDER.STOP };
  }

  moveTo(x, y) {
    this.order = { kind: ORDER.MOVE, point: { x, y } };
  }

  attackUnit(unit) {
    if (!unit || !unit.alive) return;
    this.order = { kind: ORDER.ATTACK, target: unit };
  }

  attackMoveTo(x, y) {
    this.order = { kind: ORDER.ATTACK_MOVE, point: { x, y } };
  }

  get target() {
    return this.order.kind === ORDER.ATTACK ? this.order.target : null;
  }

  /**
   * Runs the current order for one simulation step.
   * Returns { attacked, moved, order } so drills can measure the rhythm.
   */
  update(dt, world) {
    const player = this.player;
    const result = { attacked: null, moved: false, order: this.order.kind };
    this.moving = 0;

    if (!player || !player.alive || !world) {
      if (player) {
        player.moving = 0;
        this.order = { kind: ORDER.STOP };
      }
      return result;
    }

    switch (this.order.kind) {
      case ORDER.MOVE: {
        const p = this.order.point;
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        if (d <= STOP_RADIUS) {
          this.order = { kind: ORDER.STOP };
          break;
        }
        const dir = norm(p.x - player.x, p.y - player.y);
        const before = { x: player.x, y: player.y };
        player.moveDirection(dir.x, dir.y, dt);
        result.moved = Math.hypot(player.x - before.x, player.y - before.y) > 0.01;
        this.moving = 1;
        break;
      }

      case ORDER.ATTACK: {
        const target = this.order.target;
        if (!target || !target.alive) {
          this.order = { kind: ORDER.STOP };
          break;
        }
        const d = Math.hypot(target.x - player.x, target.y - player.y);
        if (d > player.attackRange * 0.96) {
          // Not in range: walk towards it.
          const dir = norm(target.x - player.x, target.y - player.y);
          const before = { x: player.x, y: player.y };
          player.moveDirection(dir.x, dir.y, dt);
          result.moved = Math.hypot(player.x - before.x, player.y - before.y) > 0.01;
          this.moving = 1;
          player.faceTowards(target.x, target.y);
        } else {
          player.faceTowards(target.x, target.y);
          if (player.canAttack()) {
            player.startAttack(target);
            result.attacked = target;
          }
        }
        break;
      }

      case ORDER.ATTACK_MOVE: {
        const p = this.order.point;
        const d = Math.hypot(p.x - player.x, p.y - player.y);
        // Attack anything reachable on the way.
        const victim = world.nearest ? world.nearest(player.x, player.y, player.attackRange * 1.5, (u) => u && u.team !== player.team && u.alive) : null;
        if (victim && victim.alive) {
          player.faceTowards(victim.x, victim.y);
          if (player.canAttack()) {
            player.startAttack(victim);
            result.attacked = victim;
          }
        }
        if (d > STOP_RADIUS) {
          const dir = norm(p.x - player.x, p.y - player.y);
          const before = { x: player.x, y: player.y };
          player.moveDirection(dir.x, dir.y, dt);
          result.moved = Math.hypot(player.x - before.x, player.y - before.y) > 0.01;
          this.moving = 1;
        } else if (!victim) {
          this.order = { kind: ORDER.STOP };
        }
        break;
      }

      default:
        break;
    }

    this.lastOrderKind = this.order.kind;
    player.moving = this.moving;
    return result;
  }
}

/**
 * Which unit (if any) sits under the cursor.
 * `radius` is generous on purpose: in LoL you click the champion model.
 */
export function unitUnderCursor(world, x, y, radius = 120) {
  // Only opponents: the player is never a click target.
  if (!world || !world.nearest) return null;
  return world.nearest(x, y, radius, (u) => u && u.alive && u.team !== "player");
}

/** Human readable label for the current order, used by the HUD. */
export function orderLabel(controller) {
  switch (controller.order.kind) {
    case ORDER.MOVE:
      return "Movendo";
    case ORDER.ATTACK:
      return "Atacando";
    case ORDER.ATTACK_MOVE:
      return "Atacando e avançando";
    default:
      return "Parado";
  }
}


