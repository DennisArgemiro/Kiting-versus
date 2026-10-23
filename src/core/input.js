/**
 * Keyboard + mouse input, modelled on League of Legends.
 *
 *   right click      move / attack order
 *   left click       selection (used with A for attack-move)
 *   A (hold)         show attack range indicator + attack-move mode
 *   S                stop
 *   Q W E R          abilities, aimed with the mouse
 *
 * Mouse coordinates are reported in world space (the ground plane), so the
 * drill logic never has to think about the 3D camera.
 */
export class Input {
  constructor(canvas, world, initialCameraLocked = true) {
    this.canvas = canvas;
    this.world = world; // { toWorld(clientX, clientY) -> {x, y} }
    this.keys = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0 };
    this.clicks = [];
    this._cameraLocked = initialCameraLocked; // Y toggles this (backing field for getter/setter)
    this.enabled = true;
    this._bind();
  }

  _bind() {
    const onKeyDown = (e) => {
      if (!this.enabled) return;
      const code = e.code;
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
      // Y toggles camera lock (also persists to config)
      if (code === "KeyY") {
        this._cameraLocked = !this._cameraLocked;
        try {
          import("../config.js").then(({ config }) => config.patch("combat", { cameraLocked: this._cameraLocked }));
        } catch {}
        e.preventDefault();
      }
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(code)) {
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    const onBlur = () => {
      this.keys.clear();
      this.pressed.clear();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    // Raw client coordinates: the projection layer owns the canvas offset.
    const toWorld = (e) => this.world.toWorld(e.clientX, e.clientY);

    this.canvas.addEventListener("mousemove", (e) => {
      const p = toWorld(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this._lastClient = { x: e.clientX, y: e.clientY };
    });

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.enabled) return;
      const p = toWorld(e);
      this.mouse.x = p.x;
      this.mouse.y = p.y;
      this.clicks.push({ button: e.button, x: p.x, y: p.y, shift: e.shiftKey, ctrl: e.ctrlKey });
      // In LoL: clicking while holding A does attack-move, but doesn't release A.
      // The range indicator stays visible until A is released.
      // We only clear the click queue, not the key state.
      e.preventDefault();
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /** Clears any pending state between drills. */
  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.clicks.length = 0;
    this._cameraLocked = true;
    this.mouse.x = 0;
    this.mouse.y = 0;
    this._lastClient = null;
  }

  /** True while the key is held. */
  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Attack-move mode: true while A key is held down (LoL behavior). */
  get attackMoveActive() {
    return this.keys.has("KeyA");
  }

  /** Camera locked to player (Y toggles). */
  get cameraLocked() {
    return this._cameraLocked;
  }
  set cameraLocked(v) {
    this._cameraLocked = v;
  }

  /** Edge scroll vector for free camera (normalized -1..1). Returns {x,y} or null. */
  getEdgeScroll() {
    if (this.cameraLocked) return null;
    const rect = this.canvas.getBoundingClientRect();
    const edge = 24; // pixels from edge to start scrolling
    let dx = 0, dy = 0;
    const mx = this.mouse.x; // world x
    const my = this.mouse.y; // world y
    // We need screen-space mouse for edge detection
    // The mouse is stored in world coords; we need to convert back or track client
    // Instead, let's use the raw client position from the last mousemove
    if (!this._lastClient) return null;
    const cx = this._lastClient.x;
    const cy = this._lastClient.y;
    if (cx < edge) dx = -1;
    else if (cx > rect.width - edge) dx = 1;
    if (cy < edge) dy = -1;
    else if (cy > rect.height - edge) dy = 1;
    if (dx === 0 && dy === 0) return null;
    const len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  /**
   * True on the frame the key went down. The press is consumed, so a single
   * key press can never trigger two simulation steps.
   */
  hit(...codes) {
    for (const code of codes) {
      if (this.pressed.has(code)) {
        this.pressed.delete(code);
        return true;
      }
    }
    return false;
  }

  /** Returns the pending mouse clicks and clears them. */
  takeClicks() {
    if (!this.clicks.length) return [];
    const out = this.clicks.slice();
    this.clicks.length = 0;
    return out;
  }

  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
  }
}
