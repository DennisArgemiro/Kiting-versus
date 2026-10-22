import { clamp } from "../core/math.js";

/** A simple auto-attack missile. */
export class Projectile {
  constructor(spec) {
    Object.assign(this, {
      x: 0,
      y: 0,
      dirX: 1,
      dirY: 0,
      speed: 1400,
      damage: 50,
      owner: null,
      team: "player",
      target: null,
      color: "#ffe08a",
      width: 16,
      dead: false,
    }, spec);
    this.traveled = 0;
    this.maxTravel = 3000;
  }

  update(dt, units, onHit) {
    if (this.dead) return;
    const step = this.speed * dt;
    this.x += this.dirX * step;
    this.y += this.dirY * step;
    this.traveled += step;

    for (const unit of units) {
      if (!unit.alive || unit.team === this.team) continue;
      if (Math.hypot(unit.x - this.x, unit.y - this.y) <= unit.radius + this.width) {
        this.dead = true;
        onHit(unit, this);
        return;
      }
    }
    if (this.traveled >= this.maxTravel) this.dead = true;
  }
}

/**
 * The simulation state of a drill: entities, projectiles, feedback effects and
 * the arena the player moves inside.
 */
export class World {
  constructor(arena = { x: 0, y: 0, w: 2800, h: 1800 }) {
    this.arena = arena;
    this.units = [];
    this.skillshots = [];
    this.projectiles = [];
    this.effects = [];
    this.time = 0;
  }

  add(unit) {
    this.units.push(unit);
    return unit;
  }

  addSkillshot(shot) {
    this.skillshots.push(shot);
    return shot;
  }

  addProjectile(proj) {
    this.projectiles.push(proj);
    return proj;
  }

  /** Floating combat text / expanding ring feedback. */
  effect(kind, x, y, opts = {}) {
    this.effects.push({
      kind,
      x,
      y,
      life: 0,
      maxLife: opts.duration ?? 0.8,
      text: opts.text ?? "",
      color: opts.color ?? "#ffffff",
      radius: opts.radius ?? 0,
      grow: opts.grow ?? 0,
    });
  }

  team(team) {
    return this.units.filter((u) => u.team === team);
  }

  /** Units of `team` that are still alive. */
  living(team) {
    return this.units.filter((u) => u.team === team && u.alive);
  }

  /** Closest living unit to (x, y) within maxRange, optionally filtered. */
  nearest(x, y, maxRange = Infinity, filter = null) {
    let best = null;
    let bestDist = maxRange;
    for (const unit of this.units) {
      if (!unit.alive) continue;
      if (filter && !filter(unit)) continue;
      const d = Math.hypot(unit.x - x, unit.y - y);
      if (d < bestDist) {
        bestDist = d;
        best = unit;
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;

    for (const shot of this.skillshots) {
      const outcome = shot.update(dt, this.units, (unit, source) => this.onSkillshotHit(unit, source));
      if (outcome) this.onSkillshotResolved?.(shot, outcome);
    }
    this.skillshots = this.skillshots.filter((s) => !s.dead);

    for (const proj of this.projectiles) {
      proj.update(dt, this.units, (unit, source) => this.onProjectileHit(unit, source));
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    for (const effect of this.effects) {
      effect.life += dt;
      if (effect.kind === "ring") effect.radius += effect.grow * dt;
    }
    this.effects = this.effects.filter((e) => e.life < e.maxLife);
  }

  onSkillshotHit(unit, shot) {
    unit.takeDamage(shot.damage, this.time);
    this.effect("text", unit.x, unit.y - unit.radius, {
      text: `-${Math.round(shot.damage)}`,
      color: "#ff7b86",
      duration: 0.9,
    });
    this.onDamage?.(unit, shot.damage, shot);
  }

  onProjectileHit(unit, proj) {
    unit.takeDamage(proj.damage, this.time);
    this.effect("text", unit.x, unit.y - unit.radius, {
      text: `-${Math.round(proj.damage)}`,
      color: "#ffd27a",
      duration: 0.8,
    });
    this.onDamage?.(unit, proj.damage, proj);
  }

  /** Keep every unit inside the arena. */
  clampUnits() {
    const a = this.arena;
    for (const unit of this.units) {
      unit.x = clamp(unit.x, a.x + unit.radius, a.x + a.w - unit.radius);
      unit.y = clamp(unit.y, a.y + unit.radius, a.y + a.h - unit.radius);
    }
  }

  /** Soft separation so bodies do not stack on top of each other. */
  separate(push = 0.35) {
    const units = this.units;
    for (let i = 0; i < units.length; i++) {
      const a = units[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < units.length; j++) {
        const b = units[j];
        if (!b.alive) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const min = a.radius + b.radius;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < min) {
          const overlap = (min - d) * push;
          const nx = dx / d;
          const ny = dy / d;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
        }
      }
    }
  }
}
