export class MoveSpeedPowerup {
  static get id() { return "mov-speed"; }
  static get name() { return "Vel. Mov."; }
  static get icon() { return "👟"; }
  static get color() { return "#46d39a"; }
  static get duration() { return 8; }

  apply(player) {
    player.buffMoveSpeed = 1.4;
    player.buffMoveSpeedTimer = 8;
    return { type: "mov-speed", duration: 8 };
  }
}
