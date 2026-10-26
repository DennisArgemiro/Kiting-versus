/**
 * Keyboard + mouse input, modelled on League of Legends.
 *
 *   right click      move / attack order
 *   left click       selection (used with A for attack-move)
 *   A                hold for attack-move mode (shows range indicator)
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
    this.consumedAttackMove = false; // set true when attack-move click processed
    this._cameraLocked = initialCameraLocked;
    this.enabled = true;
    this._zoomDelta = 0; // Accumulated zoom delta from wheel
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
      if (this.keys.has("KeyA")) {
        this.consumedAttackMove = true;
      }
      e.preventDefault();
    });

    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Mouse wheel zoom (like League of Legends)
    this.canvas.addEventListener("wheel", (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      // Emit zoom event for the scene to handle
      const zoomDelta = -e.deltaY * 0.001; // Scroll up = zoom in
      this._zoomDelta = (this._zoomDelta || 0) + zoomDelta;
      // Clamp zoom
      if (this._zoomDelta > 1.5) this._zoomDelta = 1.5;
      if (this._zoomDelta < -0.5) this._zoomDelta = -0.5;
    }, { passive: false });
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
    this._zoomDelta = 0;
  }

  /** True while the key is held. */
  down(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  /** Attack-move mode: true while A is held down. */
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
    const edge = 24;
    if (!this._lastClient) return null;
    const cx = this._lastClient.x;
    const cy = this._lastClient.y;
    let dx = 0, dy = 0;
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

  /** Consumes and returns the accumulated zoom delta from mouse wheel. */
  consumeZoomDelta() {
    const delta = this._zoomDelta || 0;
    this._zoomDelta = 0;
    return delta;
  }

  endFrame() {
    this.pressed.clear();
    this.clicks.length = 0;
  }
}