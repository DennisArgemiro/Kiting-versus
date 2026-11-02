export class HealPowerup {
  static get id() { return "heal"; }
  static get name() { return "Cura"; }
  static get icon() { return "❤️+"; }
  static get color() { return "#ff4d6a"; }
  static get duration() { return 0; } // instant

  apply(player) {
    const heal = Math.max(1, Math.floor(player.maxHp * 0.25));
    player.hp = Math.min(player.maxHp, player.hp + heal);
    return { type: "heal", amount: heal };
  }
}
