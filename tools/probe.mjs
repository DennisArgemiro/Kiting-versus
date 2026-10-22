/**
 * End-to-end driver for the browser trainer.
 *
 * Launches headless Chrome, drives the app over the Chrome DevTools Protocol
 * with real mouse clicks, captures console output and page errors, and saves
 * screenshots to tools/.shots/ for visual review.
 *
 *   node tools/probe.mjs
 *
 * Requires a server already listening on http://localhost:5173.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, "tools", ".shots");
const APP = process.env.APP_URL || "http://localhost:5173/";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const fn of this.listeners) fn(msg);
      }
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout: ${method}`));
        }
      }, 30000);
    });
  }

  on(fn) {
    this.listeners.push(fn);
  }
}

async function getJson(path) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`);
  return res.json();
}

const KEYS = {
  KeyQ: { key: "q", code: "KeyQ", vk: 81 },
  KeyW: { key: "w", code: "KeyW", vk: 87 },
  KeyE: { key: "e", code: "KeyE", vk: 69 },
  KeyR: { key: "r", code: "KeyR", vk: 82 },
  KeyA: { key: "a", code: "KeyA", vk: 65 },
  KeyS: { key: "s", code: "KeyS", vk: 83 },
  Space: { key: " ", code: "Space", vk: 32 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
};

async function main() {
  await rm(SHOTS, { recursive: true, force: true });
  await mkdir(SHOTS, { recursive: true });

  const profile = join(ROOT, "tools", ".chrome-profile");
  await rm(profile, { recursive: true, force: true });

  const chrome = spawn(CHROME, [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--use-gl=swiftshader",
    "--enable-unsafe-swiftshader",
    "--window-size=1440,900",
    "--hide-scrollbars",
    "--mute-audio",
    "about:blank",
  ], { stdio: "ignore" });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await getJson("/json/list");
      if (targets.length) break;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  if (!targets || !targets.length) throw new Error("Chrome nao iniciou");

  const page = targets.find((t) => t.type === "page") || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  const cdp = new CDP(ws);

  const consoleLog = [];
  const errors = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.consoleAPICalled") {
      consoleLog.push({
        type: msg.params.type,
        text: msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" "),
      });
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      errors.push(d.exception?.description || d.text);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      const e = msg.params.entry;
      if (!String(e.url || "").includes("favicon")) {
        errors.push(`[${e.source}] ${e.text} ${e.url || ""}`);
      }
    }
    // Auto-accept the admin "restore defaults" confirm dialog.
    if (msg.method === "Page.javascriptDialogOpening") {
      cdp.send("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
    }
  });

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  const shot = async (name) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
  };

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  };

  const waitFor = async (expression, timeout = 15000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evaluate(expression)) return true;
      await sleep(120);
    }
    throw new Error(`timeout esperando: ${expression}`);
  };

  const key = async (code, type) => {
    const k = KEYS[code];
    await cdp.send("Input.dispatchKeyEvent", {
      type,
      key: k.key,
      code: k.code,
      windowsVirtualKeyCode: k.vk,
      nativeVirtualKeyCode: k.vk,
    });
  };
  const tap = async (code, ms = 40) => {
    await key(code, "keyDown");
    await sleep(ms);
    await key(code, "keyUp");
  };

  const mouse = async (type, x, y, button = "none", buttons = 0) => {
    await cdp.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y), button, clickCount: 1, buttons,
    });
  };
  /** League style: right click issues the order. */
  const rightClick = async (x, y) => {
    await mouse("mouseMoved", x, y, "none", 0);
    await mouse("mousePressed", x, y, "right", 2);
    await sleep(20);
    await mouse("mouseReleased", x, y, "right", 0);
  };

  const state = () =>
    evaluate(`(() => {
      const s = window.__trainer && window.__trainer.session;
      if (!s || !s.scene) return null;
      const run = s.run, p = run.player, scene = s.scene;
      const enemies = run.world.living('enemy');
      let best = null, bd = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.x - p.x, e.y - p.y);
        if (d < bd) { bd = d; best = e; }
      }
      const order = p.controller ? p.controller.order.kind : 'stop';
      return {
        px: p.x, py: p.y, pr: p.attackRange, casting: p.casting,
        ex: best ? best.x : 0, ey: best ? best.y : 0,
        er: best ? best.attackRange : 0, ed: bd,
        eScreen: best ? scene.worldToScreen(best.x, best.y) : null,
        hp: p.hp, maxHp: p.maxHp, order,
        shots: run.world.skillshots.map((sh) => ({
          k: sh.kind, x: sh.x, y: sh.y, dx: sh.dirX, dy: sh.dirY,
          len: sh.length, w: sh.width, r: sh.radius, ph: sh.phase,
          tx: sh.x + sh.dirX * sh.traveled, ty: sh.y + sh.dirY * sh.traveled,
        })),
      };
    })()`);

  /** Screen position of a world point. */
  const screenOf = (x, y) =>
    evaluate(`(() => {
      const s = window.__trainer && window.__trainer.session;
      if (!s || !s.scene) return null;
      const sc = s.scene;
      const p = sc.worldToScreen(${x}, ${y});
      const cam = sc.camera;
      return {
        x: p.x, y: p.y,
        camPos: [cam.position.x, cam.position.y, cam.position.z],
        focus: [sc.cameraFocus.x, sc.cameraFocus.y, sc.cameraFocus.z],
        fov: cam.fov, aspect: cam.aspect,
        near: cam.near, far: cam.far,
        rect: (() => { const r = sc.renderer.domElement.getBoundingClientRect();
          return { l: r.left, t: r.top, w: r.width, h: r.height }; })(),
        canvas: [sc.renderer.domElement.width, sc.renderer.domElement.height],
      };
    })()`);

  const report = { steps: [], console: consoleLog, errors };

  try {
    // ── 1. menu ───────────────────────────────────────────────────────
    await cdp.send("Page.navigate", { url: APP });
    await waitFor("!!document.querySelector('.drill-card')");
    await sleep(500);
    await shot("01-menu");
    report.steps.push({
      step: "menu",
      cards: await evaluate("document.querySelectorAll('.drill-card').length"),
      champions: await evaluate("document.querySelectorAll('#champion-select option').length"),
      webgl: await evaluate(
        "!!(window.__trainer && document.querySelector('#game-stage'))",
      ),
    });

    // ── 2. kiting drill: the League orbwalk rhythm ────────────────────
    await evaluate("document.querySelectorAll('.drill-card')[0].querySelectorAll('.lv')[0].click()");
    await waitFor("!!document.querySelector('#screen-drill.is-active')");
    await sleep(3200);
    await shot("02-kiting-start");

    // The right button is a game command: the native context menu must be
    // cancelled everywhere on the drill screen.
    await evaluate(`(() => {
      window.__ctx = [];
      // Listen on the window in the bubble phase: that is the last chance to
      // see whether the default was actually prevented.
      window.addEventListener('contextmenu', (e) => {
        window.__ctx.push({ prevented: e.defaultPrevented, target: e.target.tagName });
      });
    })()`);
    await rightClick(700, 500);
    await rightClick(900, 600);
    // Also on the HUD, which is outside the canvas.
    await rightClick(700, 40);
    await sleep(200);
    report.contextMenu = await evaluate("JSON.stringify(window.__ctx)");

    let phase = "attack";
    for (let i = 0; i < 24; i++) {
      const st = await state();
      if (!st || st.hp <= 0) break;
      if (i === 5) await shot("03-kiting-fight");

      if (phase === "attack") {
        if (st.eScreen) await rightClick(st.eScreen.x, st.eScreen.y);
        await sleep(320);
        phase = "retreat";
      } else {
        // Right click the ground, away from the target.
        const awayX = st.px - (st.ex - st.px);
        const awayY = st.py - (st.ey - st.py);
        const sc = await screenOf(awayX, awayY);
        if (sc) await rightClick(sc.x, sc.y);
        await sleep(260);
        phase = "attack";
      }
    }
    await shot("04-kiting-late");
    report.steps.push({
      step: "kiting",
      hud: await evaluate(`JSON.stringify({
        score: document.querySelector('#hud-score').textContent,
        hp: document.querySelector('#hud-hp-text').textContent,
        timer: document.querySelector('#hud-timer').textContent,
        coach: document.querySelector('#hud-coach').textContent,
        chips: [...document.querySelectorAll('.stat-chip')].map(c => c.textContent.trim()),
      })`),
    });

    await tap("KeyQ");
    await sleep(600);
    await shot("05-kiting-spell");

    // Close-up of the models, for visual review.
    await evaluate("window.__trainer.session.scene.zoom = 3.2");
    await sleep(500);
    await shot("05b-closeup");
    await evaluate("window.__trainer.session.scene.zoom = 1");

    // ── 3. dodge drill: move out with right clicks ────────────────────
    await tap("Escape");
    await waitFor("!!document.querySelector('#screen-menu.is-active')");
    await sleep(400);

    await evaluate("document.querySelectorAll('.drill-card')[3].querySelectorAll('.lv')[0].click()");
    await waitFor("!!document.querySelector('#screen-drill.is-active')");
    await sleep(3200);
    await shot("06-dodge-start");
;

    const trace = [];
    for (let i = 0; i < 60; i++) {
      const st = await state();
      if (!st || st.hp <= 0) break;
      if (i === 9) await shot("07-dodge-skillshot");

      let safe = null;
      for (const sh of st.shots) {
        if (sh.k === "linear") {
          const ax = st.px - sh.tx;
          const ay = st.py - sh.ty;
          const along = ax * sh.dx + ay * sh.dy;
          const side = ax * -sh.dy + ay * sh.dx;
          if (along > -50 && along < sh.len && Math.abs(side) < sh.w + 380) {
            const sign = side >= 0 ? 1 : -1;
            // A fixed spot well off to the side of the shot line, the way a
            // human aims for cover instead of running forever. The offset must
            // beat width + hitRadius with room to spare while the missile
            // travels, so 340 leaves a comfortable margin.
            safe = { x: st.px + -sh.dy * sign * (sh.w + 340), y: st.py + sh.dx * sign * (sh.w + 340) };
            break;
          }
        } else if (sh.k === "circle") {
          const dx = st.px - sh.x;
          const dy = st.py - sh.y;
          if (Math.hypot(dx, dy) < sh.r + 380) {
            const d = Math.hypot(dx, dy) || 1;
            safe = { x: sh.x + (dx / d) * (sh.r + 460), y: sh.y + (dy / d) * (sh.r + 460) };
            break;
          }
        }
      }
      let clicked = null;
      if (safe) {
        const sc = await screenOf(safe.x, safe.y);
        if (sc) {
          clicked = { sx: Math.round(sc.x), sy: Math.round(sc.y) };
          await rightClick(sc.x, sc.y);
        }
        await sleep(30);
      } else {
        await sleep(35);
      }
      trace.push({
        i,
        order: st.order,
        px: Math.round(st.px),
        py: Math.round(st.py),
        hp: Math.round(st.hp),
        clicked: Boolean(clicked),
      });
    }
    report.dodgeTrace = trace;
    await shot("08-dodge-late");
    report.steps.push({
      step: "dodge",
      hud: await evaluate(`JSON.stringify({
        score: document.querySelector('#hud-score').textContent,
        hp: document.querySelector('#hud-hp-text').textContent,
        coach: document.querySelector('#hud-coach').textContent,
        chips: [...document.querySelectorAll('.stat-chip')].map(c => c.textContent.trim()),
      })`),
    });

    // ── 4. results screen ────────────────────────────────────────────
    await evaluate("window.__trainer.session.run.timeLeft = 0.05");
    await waitFor("!!document.querySelector('#screen-results.is-active')", 8000);
    await sleep(500);
    await shot("10-results");
    report.steps.push({
      step: "results",
      score: await evaluate("document.querySelector('#results-score').textContent"),
      verdict: await evaluate("document.querySelector('#results-verdict').textContent"),
      rows: await evaluate("document.querySelectorAll('#results-breakdown .bd-row').length"),
      next: await evaluate("document.querySelector('#results-next').textContent"),
    });

    await evaluate("document.querySelector('#results-menu').click()");
    await waitFor("!!document.querySelector('#screen-menu.is-active')");
    await sleep(400);

    // Outside a drill the native menu stays available.
    await evaluate("window.__ctx = []");
    await rightClick(700, 40);
    await sleep(200);
    report.contextMenuMenuScreen = await evaluate("JSON.stringify(window.__ctx)");

    // ── 5. smoke test every drill ─────────────────────────────────────
    const drillCount = await evaluate("document.querySelectorAll('.drill-card').length");
    for (let i = 0; i < drillCount; i++) {
      const name = await evaluate(
        `document.querySelectorAll('.drill-card')[${i}].querySelector('h3').textContent`,
      );
      try {
        await evaluate(
          `document.querySelectorAll('.drill-card')[${i}].querySelectorAll('.lv')[0].click()`,
        );
        await waitFor("!!document.querySelector('#screen-drill.is-active')", 6000);
        await sleep(3000);
        await shot(`smoke-${i}`);
        const alive = await evaluate(
          "!!(window.__trainer.session && window.__trainer.session.run)",
        );
        const units = await evaluate(
          "window.__trainer.session ? window.__trainer.session.run.world.units.length : -1",
        );
        report.steps.push({ step: `smoke:${name}`, alive, units });
        await evaluate("document.querySelector('#drill-exit').click()");
        await waitFor("!!document.querySelector('#screen-menu.is-active')", 6000);
        await sleep(300);
      } catch (err) {
        report.steps.push({ step: `smoke:${name}`, error: err.message });
      }
    }

    // ── 6. admin: change the map and enemy reach, then verify in game ──
    await evaluate("document.querySelector('#open-admin').click()");
    await waitFor("!!document.querySelector('#screen-admin.is-active')");
    await sleep(300);
    await shot("11-admin-map");
    report.steps.push({
      step: "admin-open",
      tabs: await evaluate(
        "[...document.querySelectorAll('#admin-tabs .admin-tab')].map(b => b.textContent)",
      ),
      inputs: await evaluate("document.querySelectorAll('#admin-body .admin-input').length"),
    });

    const setNumber = async (index, value) => {
      await evaluate(`(() => {
        const el = document.querySelectorAll('#admin-body .admin-input')[${index}];
        if (!el) return false;
        el.value = '${value}';
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await sleep(140);
    };
    const openTab = async (index) => {
      await evaluate(`document.querySelectorAll('#admin-tabs .admin-tab')[${index}].click()`);
      await sleep(200);
    };

    // Mapa: 3600 x 2200
    await setNumber(0, 3600);
    await setNumber(1, 2200);
    await openTab(2); // Inimigos
    await setNumber(0, 1.6); // alcance ×
    await shot("12-admin-enemies");
    await openTab(1); // Campeões
    await setNumber(2, 620); // alcance do campeão
    await shot("12b-admin-champions");
    await openTab(3); // Treinos
    await setNumber(0, 20); // duração
    await setNumber(1, 2); // nº de inimigos
    await shot("13-admin-drills");

    // Dados REA: o painel precisa abrir, editar o JSON e persistir o override.
    await openTab(4);
    report.skillgap = await evaluate(`(() => {
      const s = window.__trainer.skillgap;
      const selects = [...document.querySelectorAll('#admin-body .admin-toolbar select')];
      return {
        keys: Object.keys(s?.trainings || {}).length,
        levels: s?.meta?.levelCount ?? null,
        key: selects[0]?.value ?? null,
        level: selects[1]?.value ?? null,
        inputs: document.querySelectorAll('#admin-body .admin-input').length,
        json: !!document.querySelector('#admin-body .admin-json'),
      };
    })()`);
    await evaluate(`(() => {
      const area = document.querySelector('#admin-body .admin-json');
      const data = JSON.parse(area.value);
      data.durationSeconds = 42;
      area.value = JSON.stringify(data, null, 2);
      [...document.querySelectorAll('#admin-body button')]
        .find((b) => b.textContent === "Aplicar JSON")
        .click();
      return true;
    })()`);
    await sleep(250);
    report.skillgapApplied = await evaluate(
      "window.__trainer.config.skillgapLevel('KITING_0', 1)?.durationSeconds ?? null",
    );
    await shot("13b-admin-skillgap");

    report.adminConfig = await evaluate("JSON.stringify(window.__trainer.config.state)");

    await evaluate("document.querySelector('#admin-close').click()");
    await waitFor("!!document.querySelector('#screen-menu.is-active')");

    await evaluate(
      "document.querySelectorAll('.drill-card')[0].querySelectorAll('.lv')[0].click()",
    );
    await waitFor("!!document.querySelector('#screen-drill.is-active')");
    await sleep(3200);
    await shot("14-admin-drill");
    report.adminApplied = await evaluate(`(() => {
      const s = window.__trainer.session;
      const run = s.run;
      const e = run.enemies && run.enemies[0];
      return {
        arena: { w: run.world.arena.w, h: run.world.arena.h },
        duration: run.duration,
        enemies: run.enemies ? run.enemies.length : -1,
        playerRange: run.player.attackRange,
        enemyRange: e ? e.attackRange : 0,
        enemyDamage: e ? e.attackDamage : 0,
        camera: { zoom: s.scene.zoom, fov: s.scene.camera.fov },
      };
    })()`);
    await evaluate("document.querySelector('#drill-exit').click()");
    await waitFor("!!document.querySelector('#screen-menu.is-active')");

    // ── 7. admin reset restores every default ─────────────────────────
    await evaluate("document.querySelector('#open-admin').click()");
    await waitFor("!!document.querySelector('#screen-admin.is-active')");
    await sleep(200);
    await evaluate("document.querySelector('#admin-reset').click()");
    await sleep(500);
    report.adminReset = await evaluate(`(() => {
      const c = window.__trainer.config.state;
      return {
        arena: c.arena,
        combat: c.combat,
        champions: Object.keys(c.champions),
        drills: Object.keys(c.drills),
        skillgap: Object.keys(c.skillgap || {}),
      };
    })()`);
    await shot("15-admin-reset");
    await evaluate("document.querySelector('#admin-close').click()");
    await waitFor("!!document.querySelector('#screen-menu.is-active')");

    report.steps.push({ step: "menu-again", ok: true });
    await shot("09-menu-after");
  } catch (err) {
    report.steps.push({ step: "FAILED", error: err.message });
    await shot("99-failure");
  }

  console.log(JSON.stringify(report, null, 1));
  ws.close();
  chrome.kill();
  // Chrome keeps a few files in the profile locked for a moment after it
  // exits; retry the cleanup instead of failing the whole run.
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    try {
      await rm(profile, { recursive: true, force: true });
      break;
    } catch {
      /* locked - try again */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
