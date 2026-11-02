export class RangePowerup {
  static get id() { return "range"; }
  static get name() { return "Alcance"; }
  static get icon() { return "🎯"; }
  static get color() { return "#ffd27a"; }
  static get duration() { return 8; }

  apply(player) {
    if (player._baseAttackRange === undefined) {
      player._baseAttackRange = player.attackRange;
    }
    player.attackRange = Math.floor(player._baseAttackRange * 1.35);
    player.buffRangeTimer = 8;
    return { type: "range", duration: 8 };
  }
}
