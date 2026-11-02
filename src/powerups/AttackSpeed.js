export class AttackSpeedPowerup {
  static get id() { return "atk-speed"; }
  static get name() { return "Vel. Ataque"; }
  static get icon() { return "⚡"; }
  static get color() { return "#4ea1ff"; }
  static get duration() { return 8; }

  apply(player) {
    player.buffAttackSpeed = 1.5;
    player.buffAttackSpeedTimer = 8;
    return { type: "atk-speed", duration: 8 };
  }
}
