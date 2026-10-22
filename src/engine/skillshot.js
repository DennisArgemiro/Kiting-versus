import { insideCone, pointSegmentDistance } from "../core/math.js";

/**
 * A skillshot: the thing you have to dodge.
 *
 * Lifecycle:
 *   telegraph  -> the shape is announced for `castTime` seconds
 *   flying     -> a linear missile travels along its path
 *   burst      -> a circle / cone resolves instantly at the target point
 *   done
 *
 * `spec` fields
 *   kind        'linear' | 'circle' | 'cone'
 *   x, y        origin (caster position for linear, target point otherwise)
 *   dirX, dirY  travel direction (linear only)
 *   length      reach of the shape
 *   width       half width of a linear shape
 *   radius      radius of a circle
 *   speed       projectile speed in units/second
 *   castTime    telegraph duration
 *   damage      damage applied on hit
 *   owner       the unit that cast it (null for the player's own shots)
 *   team        'enemy' or 'player'
 */
export class Skillshot {
  constructor(spec) {
    Object.assign(this, {
      kind: "linear",
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      length: 1000,
      width: 120,
      radius: 200,
      speed: 1500,
      castTime: 0.25,
      damage: 100,
      owner: null,
      team: "enemy",
      spell: null,
      label: "",
      color: "#ff6b78",
    }, spec);

    this.phase = "telegraph";
    this.elapsed = 0;
    this.traveled = 0;
    this.travelX = this.x;
    this.travelY = this.y;
    this.dead = false;
    this.hitSomething = false;
    this.startTime = 0;
  }

  /** Where the missile currently is (linear only). */
  get headX() {
    return this.x + this.dirX * this.traveled;
  }

  get headY() {
    return this.y + this.dirY * this.traveled;
  }

  /** Total flight time once the telegraph ends. */
  get flightTime() {
    return this.speed > 0 ? this.length / this.speed : 0;
  }

  /**
   * Advance the skillshot.
   * `targets` is the list of units it can hit.
   * `onHit(unit)` is called when a target is struck.
   * Returns an event string when something happened: 'hit' | 'miss' | null.
   */
  update(dt, targets, onHit) {
    if (this.dead) return null;
    this.elapsed += dt;

    if (this.phase === "telegraph") {
      if (this.elapsed >= this.castTime) {
        this.phase = this.kind === "linear" ? "flying" : "burst";
        this.travelX = this.x;
        this.travelY = this.y;
        this.elapsed = 0;
      }
      return null;
    }

    if (this.phase === "flying") {
      const prevX = this.travelX;
      const prevY = this.travelY;
      const step = this.speed * dt;
      this.traveled = Math.min(this.length, this.traveled + step);
      this.travelX = this.x + this.dirX * this.traveled;
      this.travelY = this.y + this.dirY * this.traveled;

      for (const target of targets) {
        if (!target.alive || target.team === this.team) continue;
        const hit = pointSegmentDistance(
          target.x, target.y,
          prevX, prevY,
          this.travelX, this.travelY,
        );
        if (hit.distance <= this.width + (target.hitRadius ?? target.radius)) {
          this.hitSomething = true;
          this.dead = true;
          onHit(target, this);
          return "hit";
        }
      }

      if (this.traveled >= this.length) {
        this.dead = true;
        return this.hitSomething ? "hit" : "miss";
      }
      return null;
    }

    if (this.phase === "burst") {
      this.dead = true;
      for (const target of targets) {
        if (!target.alive || target.team === this.team) continue;
        if (this.hits(target)) {
          this.hitSomething = true;
          onHit(target, this);
          return "hit";
        }
      }
      return "miss";
    }

    return null;
  }

  /**
   * Does the *full* shape threaten this point? For a linear skillshot this
   * covers the whole path, not just the part already travelled, so it can be
   * used during the telegraph to tell whether the player has to move.
   */
  threatensPoint(x, y, padding = 0) {
    if (this.kind === "circle") {
      return Math.hypot(x - this.x, y - this.y) <= this.radius + padding;
    }
    if (this.kind === "cone") {
      return insideCone(x, y, this.x, this.y, this.dirX, this.dirY, Math.PI / 6, this.length);
    }
    const endX = this.x + this.dirX * this.length;
    const endY = this.y + this.dirY * this.length;
    const hit = pointSegmentDistance(x, y, this.x, this.y, endX, endY);
    return hit.distance <= this.width + padding;
  }

  /** Does this shape cover the given unit right now? */
  hits(target) {
    if (this.kind === "circle") {
      return Math.hypot(target.x - this.x, target.y - this.y) <= this.radius + (target.hitRadius ?? target.radius);
    }
    if (this.kind === "cone") {
      return insideCone(
        target.x, target.y,
        this.x, this.y,
        this.dirX, this.dirY,
        Math.PI / 6, // 60 degree cone
        this.length,
      );
    }
    // Linear: distance from the target to the travelled segment.
    const hit = pointSegmentDistance(
      target.x, target.y,
      this.x, this.y,
      this.headX, this.headY,
    );
    return hit.distance <= this.width + (target.hitRadius ?? target.radius);
  }
}

/**
 * Builds a skillshot from a champion skill record.
 * `caster` supplies the origin, `targetX/targetY` the aim point.
 */
export function skillshotFromSpell(spell, caster, targetX, targetY, team, damage, speedScale = 1) {
  const dx = targetX - caster.x;
  const dy = targetY - caster.y;
  const len = Math.hypot(dx, dy) || 1;
  const dirX = dx / len;
  const dirY = dy / len;

  if (spell.shape === "circle") {
    return new Skillshot({
      kind: "circle",
      x: targetX,
      y: targetY,
      radius: spell.radius ?? 200,
      castTime: spell.castTime ?? 0.25,
      damage,
      owner: caster,
      team,
      spell,
      label: `${caster.name} ${spell.slot}`,
    });
  }
  if (spell.shape === "cone") {
    return new Skillshot({
      kind: "cone",
      x: caster.x,
      y: caster.y,
      dirX,
      dirY,
      length: spell.length ?? spell.range ?? 600,
      castTime: spell.castTime ?? 0.25,
      damage,
      owner: caster,
      team,
      spell,
      label: `${caster.name} ${spell.slot}`,
    });
  }
  return new Skillshot({
    kind: "linear",
    x: caster.x,
    y: caster.y,
    dirX,
    dirY,
    // The real reach of the spell: the drill only fires when the target is
    // inside it, so the shot always covers the whole path.
    length: spell.length ?? spell.range ?? 1000,
    width: spell.width ?? 120,
    speed: (spell.speed ?? 1500) * speedScale,
    castTime: spell.castTime ?? 0.25,
    damage,
    owner: caster,
    team,
    spell,
    label: `${caster.name} ${spell.slot}`,
  });
}
