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
  constructor(update, render, step = 1 / 120) {
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
    while (this.accumulator >= this.step && guard++ < 240) {
      this.update(this.step);
      this.accumulator -= this.step;
    }
    this.render(this.accumulator / this.step);
    this.rafId = requestAnimationFrame(this.frame);
  }
}
