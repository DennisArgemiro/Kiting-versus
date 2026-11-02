/**
 * Fixed-timestep game loop.
 *
 * The drills simulate movement, attack windups and skillshot travel, so the
 * physics must advance in constant steps or the drill would reward players
 * with fast machines. Rendering happens once per animation frame.
 */
export class Loop {
  /**
   * @param {(dt:number)=>void} update   simulation step, dt in seconds
   * @param {(alpha:number)=>void} render interpolation factor in [0,1)
   * @param {number} step fixed simulation step in seconds
   */
  constructor(update, render, step = 1 / 60) {
    this.update = update;
    this.render = render;
    this.step = step;
    this.accumulator = 0;
    this.last = 0;
    this.running = false;
    this.rafId = 0;
    this.frame = this.frame.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.accumulator = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  frame(now) {
    if (!this.running) return;
    // Clamp so a background tab does not fast-forward the drill.
    let delta = (now - this.last) / 1000;
    this.last = now;
    if (delta > 0.25) delta = 0.25;

    this.accumulator += delta;
    let guard = 0;
    // Max 6 steps per frame (100ms at 60Hz) to prevent spiral of death
    while (this.accumulator >= this.step && guard++ < 6) {
      this.update(this.step);
      this.accumulator -= this.step;
    }
    this.render(this.accumulator / this.step);
    // stop() may have been called by update/render (e.g. drill finished):
    // do not schedule another frame, otherwise the loop keeps running as a zombie.
    if (!this.running) { this.rafId = 0; return; }
    this.rafId = requestAnimationFrame(this.frame);
  }
}
