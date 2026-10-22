import { clamp, norm } from "../core/math.js";

let nextId = 1;

/**
 * A combat entity. Champions, minions and training dummies are all units;
 * they differ by which fields are populated, not by their type.
 */
export class Unit {
  constructor(opts = {}) {
    this.id = nextId++;
    this.name = opts.name || "unit";
    this.team = opts.team || "enemy"; // player | enemy | ally
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.radius = opts.radius ?? 65;
    this.maxHp = opts.hp ?? 600;
    this.hp = this.maxHp;
    this.moveSpeed = opts.moveSpeed ?? 325;
    this.attackRange = opts.attackRange ?? 550;
    this.attackPeriod = opts.attackPeriod ?? 1.0;
    this.attackCast = opts.attackCast ?? 0.25;
    this.attackDamage = opts.attackDamage ?? 60;
    this.projectileSpeed = opts.projectileSpeed ?? 1400;
    this.isMelee = opts.isMelee ?? false;
    this.armor = opts.armor ?? 30;
    // Radius used by skillshot hit tests. Gameplay radius is 65 in League
    // units; the player gets a slightly smaller one so a committed dodge is
    // rewarded instead of feeling arbitrary.
    this.hitRadius = opts.hitRadius ?? this.radius;

    // Combat state
    this.alive = true;
    this.casting = 0; // remaining windup: movement is locked while > 0
    this.attackTimer = 0; // time until the next attack may start
    this.pendingTarget = null; // unit the current windup will strike
    this.pendingHit = false; // melee windup resolved already?
    this.moveTarget = null; // ground order
    this.lastDamageAt = -99;
    this.hitFlash = 0;
    this.facing = { x: 1, y: 0 };
  }

  get busy() {
    return this.casting > 0;
  }

  /** Distance to another unit, edge to edge. */
  distanceTo(other) {
    return Math.hypot(other.x - this.x, other.y - this.y) - this.radius - other.radius;
  }

  /** Can this unit start an attack right now? */
  canAttack() {
    return this.alive && this.casting <= 0 && this.attackTimer <= 0;
  }

  /**
   * Begin an attack. Returns true when the swing actually started.
   * The windup locks movement, exactly like a real auto-attack.
   */
  startAttack(target) {
    if (!this.canAttack() || !target || !target.alive) return false;
    this.pendingTarget = target;
    this.casting = this.attackCast;
    this.attackTimer = this.attackPeriod;
    this.pendingHit = false;
    return true;
  }

  /** Cancel a windup (used when the target dies mid-swing). */
  cancelAttack() {
    this.pendingTarget = null;
    this.casting = 0;
    this.pendingHit = false;
  }

  /**
   * Advance timers. Returns the target that just finished its windup, if any
   * (the caller resolves damage and spawns projectiles).
   */
  tickTimers(dt) {
    let resolved = null;
    if (this.attackTimer > 0) this.attackTimer = Math.max(0, this.attackTimer - dt);
    if (this.casting > 0) {
      this.casting = Math.max(0, this.casting - dt);
      if (this.casting === 0 && this.pendingTarget) {
        resolved = this.pendingTarget;
        this.pendingHit = true;
      }
    }
    if (this.hitFlash > 0) this.hitFlash = Math.max(0, this.hitFlash - dt);
    return resolved;
  }

  /**
   * Move towards a point, honouring the windup lock.
   * Returns true when the unit actually moved.
   */
  moveToward(tx, ty, dt, speedScale = 1) {
    if (this.casting > 0) return false;
    const d = norm(tx - this.x, ty - this.y);
    if (d.x === 0 && d.y === 0) return false;
    const speed = this.moveSpeed * speedScale;
    const step = speed * dt;
    this.x += d.x * step;
    this.y += d.y * step;
    this.facing = d;
    return true;
  }

  /** Move along an arbitrary normalised direction. */
  moveDirection(dx, dy, dt, speedScale = 1) {
    if (this.casting > 0) return false;
    const d = norm(dx, dy);
    if (d.x === 0 && d.y === 0) return false;
    const step = this.moveSpeed * speedScale * dt;
    this.x += d.x * step;
    this.y += d.y * step;
    this.facing = d;
    return true;
  }

  /** Face a point without moving. */
  faceTowards(x, y) {
    const d = norm(x - this.x, y - this.y);
    if (d.x || d.y) this.facing = d;
  }

  takeDamage(amount, now) {
    this.hp = Math.max(0, this.hp - amount);
    this.hitFlash = 0.18;
    this.lastDamageAt = now;
    if (this.hp <= 0) this.alive = false;
    return this.hp;
  }

  /** Effective distance from this unit's centre to a target centre. */
  reachTo(target) {
    return Math.hypot(target.x - this.x, target.y - this.y);
  }

  /** Can this unit reach the target with its next attack? */
  inAttackRange(target) {
    return this.reachTo(target) <= this.attackRange;
  }

  /** True when the target sits inside this unit's threat radius. */
  threatens(target) {
    return this.reachTo(target) <= this.attackRange;
  }
}

/**
 * A champion is a unit plus the real game data: skills, portraits and the
 * per-skill geometry used by the dodge drills.
 */
export class Champion extends Unit {
  constructor(data, opts = {}) {
    const stats = data.stats;
    super({
      name: data.name,
      team: opts.team || "player",
      x: opts.x || 0,
      y: opts.y || 0,
      hp: opts.hp ?? stats.health,
      radius: opts.radius ?? 65,
      moveSpeed: opts.moveSpeed ?? stats.movementSpeed,
      attackRange: opts.attackRange ?? stats.attackRange,
      attackPeriod: opts.attackPeriod ?? stats.attackPeriod,
      attackCast: opts.attackCast ?? stats.attackCastTime,
      attackDamage: opts.attackDamage ?? stats.attackDamage,
      projectileSpeed: opts.projectileSpeed ?? stats.projectileSpeed,
      isMelee: opts.isMelee ?? stats.isMelee,
      armor: opts.armor ?? stats.armor,
    });
    this.data = data;
    this.alias = data.alias;
    this.icon = data.icon;
    this.skills = data.spells || [];
    this.spells = new Map();
    for (const spell of this.skills) {
      if (spell.slot !== "P") this.spells.set(spell.slot, spell);
    }
  }

  /** The champion's primary skillshot (Q), used by the player's own spells. */
  primarySkillshot() {
    const q = this.spells.get("Q");
    if (q && q.shape === "linear") return q;
    for (const spell of this.spells.values()) {
      if (spell.shape === "linear") return spell;
    }
    return null;
  }

  /** Difficulty scalar applied to enemy champions in a drill. */
  scaleDamage(factor) {
    this.attackDamage = this.data.stats.attackDamage * factor;
  }
}
