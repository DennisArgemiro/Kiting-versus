import { Loop } from "./core/loop.js";
import { Input } from "./core/input.js";
import { Scene3D } from "./engine/scene3d.js";
import { buildDrills, CATEGORY_LABEL } from "./drills/index.js";
import { store } from "./store.js";
import { orderLabel } from "./engine/orders.js";
import { formatTime, makeRng } from "./core/math.js";
import { config, applyChampionOverrides, applyDrillOverrides } from "./config.js";
import { syncArena } from "./drills/common.js";
import { createAdmin } from "./admin.js";

const $ = (sel) => document.querySelector(sel);

let lastFrame = performance.now();
let lastDelta = 0.016;

const app = {
  champions: [],
  rawChampions: [],
  skillgap: null,
  drills: [],
  byId: new Map(),
  filter: "all",
  session: null,
  loop: null,
  admin: null,
  config,
};

// ────────────────────────────── boot ──────────────────────────────

async function boot() {
  const response = await fetch("./src/data/champions.json");
  const data = await response.json();
  app.rawChampions = data.champions;
  app.champions = applyChampionOverrides(structuredClone(app.rawChampions));

  // Snapshot real do Skill Gap (Firestore).  Se o arquivo não existir, os
  // treinos caem de volta nas tabelas antigas, sem impedir o app de abrir.
  try {
    const sgResponse = await fetch("./src/data/skillgap-levels.json");
    if (sgResponse.ok) app.skillgap = await sgResponse.json();
  } catch (err) {
    console.warn("Snapshot do Skill Gap indisponível; usando níveis locais.", err);
  }

  syncArena();

  rebuildDrills();

  // Debug handle: lets the automated driver (tools/probe.mjs) read the live
  // simulation state and play the drill.
  window.__trainer = app;

  buildChampionSelect();
  renderMenu();
  bindGlobalEvents();

  app.admin = createAdmin({ app, onApply: applyConfig });
}

function rebuildDrills() {
  app.drills = buildDrills(app.champions, app.skillgap);
  app.byId = new Map(app.drills.map((d) => [d.id, d]));
}

/**
 * Re-applies the persisted configuration to the live game objects.
 *
 * The champion list is rebuilt from the pristine JSON on every change, so
 * resetting an override actually restores the original numbers instead of
 * layering on top of the previous edit.
 */
function applyConfig() {
  app.champions = applyChampionOverrides(structuredClone(app.rawChampions));
  rebuildDrills();
  syncArena();
  if (app.scene) app.scene.setCameraConfig({ ...config.camera(), pitch: config.combat().cameraPitch });
  buildChampionSelect();
  renderMenu();
}

// ────────────────────────────── screens ──────────────────────────────

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
  $(`#screen-${id}`).classList.add("is-active");
}

function banner(text, tone = "") {
  const el = $("#drill-banner");
  el.textContent = text;
  el.className = `banner is-on ${tone}`;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => {
    el.className = `banner ${tone}`;
  }, 2200);
}

// ────────────────────────────── menu ──────────────────────────────

function buildChampionSelect() {
  const select = $("#champion-select");
  select.innerHTML = "";
  for (const champion of app.champions) {
    const option = document.createElement("option");
    option.value = champion.alias;
    option.textContent = champion.name;
    select.appendChild(option);
  }
  select.value = store.champion();
  if (!select.value || !app.champions.some((c) => c.alias === select.value)) {
    select.value = app.champions[0].alias;
    store.setChampion(select.value);
  }
  // `onchange` instead of addEventListener: this function runs again after
  // every admin change, and stacked listeners would fire multiple times.
  select.onchange = () => {
    store.setChampion(select.value);
    renderMenu();
  };
}

function championByAlias(alias) {
  return app.champions.find((c) => c.alias === alias) || app.champions[0];
}

function renderMenu() {
  const list = $("#drill-list");
  list.innerHTML = "";

  for (const drill of app.drills) {
    if (app.filter !== "all" && drill.category !== app.filter) continue;
    list.appendChild(renderDrillCard(drill));
  }

  renderSideChampion();
  renderProgressSummary();
}

function renderDrillCard(drill) {
  const card = document.createElement("article");
  card.className = "drill-card";

  const unlocked = store.unlockedLevel(drill.id);
  const best = Math.max(
    0,
    ...drill.levels.map((lv) => store.levelRecord(drill.id, lv.index)?.best || 0),
  );

  card.innerHTML = `
    <div class="drill-card-head">
      <div>
        <span class="cat">${CATEGORY_LABEL[drill.category]}</span>
        <h3>${drill.name}</h3>
      </div>
      <span class="badge ${drill.category}">${drill.levels.length} níveis</span>
    </div>
    <p class="drill-tagline">${drill.tagline}</p>
    <p class="drill-desc">${drill.description}</p>
    <div class="level-grid"></div>
  `;
  const grid = card.querySelector(".level-grid");
  for (const level of drill.levels) {
    const record = store.levelRecord(drill.id, level.index);
    const btn = document.createElement("button");
    btn.className = "lv";
    btn.type = "button";
    if (record) btn.classList.add("is-done");
    if (level.index === unlocked) btn.classList.add("is-current");
    if (level.index > unlocked) btn.disabled = true;
    btn.textContent = level.index;
    btn.title = record
      ? `Nível ${level.index} — recorde ${record.best}`
      : `Nível ${level.index}${level.index > unlocked ? " (bloqueado)" : ""}`;
    if (record?.best >= drill.unlockScore) {
      const pip = document.createElement("span");
      pip.className = "pip";
      btn.appendChild(pip);
    }
    btn.addEventListener("click", () => startDrill(drill, level));
    grid.appendChild(btn);
  }

  const footer = document.createElement("div");
  footer.className = "stat-row";
  footer.innerHTML = `<span>Melhor pontuação</span><span>${best}</span>`;
  card.appendChild(footer);

  return card;
}

function renderSideChampion() {
  const champion = championByAlias(store.champion());
  const s = champion.stats;
  const box = $("#side-champion");
  box.innerHTML = `
    <img src="./assets/champions/${encodeURIComponent(champion.alias)}.png" alt=""
         onerror="this.style.visibility='hidden'" />
    <div>
      <div class="name">${champion.name}</div>
      <div class="meta">${champion.title}</div>
    </div>
  `;

  const rows = [
    ["Vida", Math.round(s.health)],
    ["Dano de ataque", Math.round(s.attackDamage)],
    ["Alcance", Math.round(s.attackRange)],
    ["Velocidade de ataque", `${s.attackSpeed.toFixed(3)}`],
    ["Tempo de windup", `${(s.attackCastTime * 1000).toFixed(0)} ms`],
    ["Velocidade de movimento", Math.round(s.movementSpeed)],
    ["Armadura", Math.round(s.armor)],
    ["Resistência mágica", Math.round(s.magicResistance)],
  ];
  $("#progress-summary").innerHTML = `
    ${rows.map(([k, v]) => `<div class="stat-row"><span>${k}</span><span>${v}</span></div>`).join("")}
  `;
}

function renderProgressSummary() {
  const summary = store.summary();
  const drillsDone = app.drills.filter((d) =>
    d.levels.some((lv) => store.levelRecord(d.id, lv.index)?.best),
  ).length;
  const totalLevels = app.drills.reduce((n, d) => n + d.levels.length, 0);
  const doneLevels = app.drills.reduce(
    (n, d) => n + d.levels.filter((lv) => store.levelRecord(d.id, lv.index)).length,
    0,
  );
  const pct = totalLevels ? Math.round((doneLevels / totalLevels) * 100) : 0;

  const el = $("#progress-summary");
  el.innerHTML = `
    <div class="stat-row"><span>Treinos concluídos</span><span>${drillsDone}/${app.drills.length}</span></div>
    <div class="stat-row"><span>Níveis vencidos</span><span>${doneLevels}/${totalLevels}</span></div>
    <div class="stat-row"><span>Melhor pontuação</span><span>${summary.best}</span></div>
    <div class="stat-row"><span>Sessões</span><span>${summary.sessions}</span></div>
    <div class="bar"><i style="width:${pct}%"></i></div>
  `;
}

// ────────────────────────────── drill session ──────────────────────────────

function startDrill(drill, level) {
  const champion = championByAlias(store.champion());
  const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  // Apply the admin overrides for this drill (duration, enemy count, ...)
  // without mutating the level table itself.
  const runLevel = { ...level, params: applyDrillOverrides(drill.id, level.params) };

  let run;
  try {
    run = drill.create({ champion, level: runLevel, rng, champions: app.champions });
  } catch (err) {
    console.error("Falha ao criar o treino:", err);
    banner("Não foi possível iniciar este treino.", "bad");
    return;
  }

  // One scene and one input for the whole session: creating a new WebGL
  // canvas per drill would stack them inside the stage and push the newest
  // one off screen (and leak a GL context every time).
  const stage = $("#game-stage");
  if (!app.scene) {
    app.scene = new Scene3D(stage);
    app.input = new Input(app.scene.renderer.domElement, {
      toWorld: (x, y) => app.scene.clientToGround(x, y),
    }, config.combat().cameraLocked);
  }
  const scene = app.scene;
  const input = app.input;
  // Sync camera lock from config (in case it was changed in admin)
  input._cameraLocked = config.combat().cameraLocked;
  scene.setCameraConfig({ ...config.camera(), pitch: config.combat().cameraPitch });
  scene.reset();
  scene.resize();
  scene.setArena(run.world.arena);
  input.reset();
  if ("onMoveMarker" in run) {
    run.onMoveMarker = (x, y, color) => scene.showMoveMarker(x, y, color);
  }

  const loop = new Loop(
    (dt) => {
      run.update(dt, input);
      if (run.finished && app.session && !app.session.ending) {
        app.session.ending = true;
        finishDrill();
      }
    },
    () => {
      const now = performance.now();
      lastDelta = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const combat = config.combat();
      const edgeScroll = combat.cameraLocked ? null : input.getEdgeScroll();
      run.render(scene, { showRanges: combat.showRanges, dt: lastDelta, attackMoveActive: input.attackMoveActive });
      scene.updateCamera(run.player, lastDelta, edgeScroll);
      updateHud(run);
      $("#game-stage").classList.toggle("is-attackmove", input.attackMoveActive);
      input.endFrame();
    },
  );

  app.session = { drill, level, run, scene, input, loop, ending: false, startedAt: performance.now() };
  lastFrame = performance.now();

  $("#hud-drill-name").textContent = drill.name;
  $("#hud-drill-level").textContent = `Nível ${level.index}`;
  $("#drill-hint").textContent = hintFor(drill);
  updateHud(run);

  showScreen("drill");
  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(run.world.arena);
    loop.start();
  });
}

function hintFor(drill) {
  return drill.hint || "WASD para mover, clique para atacar, botão direito para andar até o ponto.";
}

function updateHud(run) {
  const hpPct = Math.max(0, Math.min(1, run.player.hp / run.player.maxHp));
  const hpBar = $("#hud-hp");
  hpBar.style.width = `${hpPct * 100}%`;
  hpBar.parentElement.classList.toggle("low", hpPct < 0.35);
  $("#hud-hp-text").textContent = `${Math.round(run.player.hp)}`;

  if (run.ready > 0) {
    const left = Math.ceil(run.ready);
    const label = left > 1 ? String(left) : "Já!";
    if (updateHud._lastReady !== left) {
      updateHud._lastReady = left;
      banner(label, "");
    }
    $("#hud-timer").textContent = formatTime(run.duration);
    $("#hud-score").textContent = "—";
    return;
  }
  if (updateHud._lastReady !== undefined) {
    updateHud._lastReady = undefined;
    banner("Comece!", "good");
  }

  $("#hud-timer").textContent = formatTime(run.timeLeft);
  $("#hud-timer").classList.toggle("is-low", run.timeLeft <= 10 && run.timeLeft > 0);

  const result = run.result();
  $("#hud-score").textContent = result.score;

  const chips = run.hud();
  if (run.player.controller) {
    chips.unshift({ label: "Ordem", value: orderLabel(run.player.controller) });
  }
  $("#hud-stats").innerHTML = chips
    .map((c) => `<span class="stat-chip ${c.tone || ""}">${c.label}<b>${c.value}</b></span>`)
    .join("");

  const coach = run.coach ? run.coach() : "";
  const coachEl = $("#hud-coach");
  coachEl.textContent = coach;
  coachEl.classList.toggle("is-alert", /incoming|Recue|Clique/.test(coach));
}

function finishDrill() {
  const { drill, level, run, loop } = app.session;
  loop.stop();
  app.session = null;
  const result = run.result();
  result.stats.duration = run.duration;
  const outcome = store.recordResult(drill.id, level.index, result.score, result.stats, drill.unlockScore);

  showResults(drill, level, result, outcome);
}

function abortDrill() {
  if (!app.session) return;
  app.session.loop.stop();
  app.session = null;
  renderMenu();
  showScreen("menu");
}

// ────────────────────────────── results ──────────────────────────────

function showResults(drill, level, result, outcome) {
  $("#results-drill").textContent = `${drill.name} — nível ${level.index}`;
  $("#results-score").textContent = result.score;
  $("#results-verdict").textContent = result.verdict;
  $("#results-medal").textContent = medalFor(result.score);

  $("#results-breakdown").innerHTML = result.breakdown
    .map(
      (b) => `
      <div class="bd-row">
        <span class="bd-name">${b.name} <small style="opacity:.7">${b.detail || ""}</small></span>
        <span class="bd-val">${b.display}</span>
      </div>
      <div class="bd-track"><i style="width:${Math.round((b.value || 0) * 100)}%;background:${b.color}"></i></div>
    `,
    )
    .join("");

  $("#results-stats").innerHTML = Object.entries(result.stats || {})
    .filter(([key]) => key !== "duration")
    .map(([key, value]) => `<div class="stat-row"><span>${statLabel(key)}</span><span>${value}</span></div>`)
    .join("");

  drawHistory(drill);

  const nextLevel = level.index + 1;
  const hasNext = nextLevel <= drill.levels.length;
  const nextBtn = $("#results-next");
  nextBtn.style.display = hasNext ? "" : "none";
  nextBtn.disabled = !hasNext;
  nextBtn.textContent = outcome.unlockedNext
    ? `Nível ${nextLevel} desbloqueado →`
    : `Próximo nível (${nextLevel})`;

  $("#results-retry").onclick = () => startDrill(drill, level);
  $("#results-next").onclick = () => {
    if (hasNext) startDrill(drill, drill.levels[nextLevel - 1]);
  };
  $("#results-menu").onclick = () => {
    app.session = null;
    renderMenu();
    showScreen("menu");
  };

  showScreen("results");
}

const STAT_LABELS = {
  orders: "Comandos dados",
  casts: "Habilidades usadas",
  attacksLanded: "Ataques acertados",
  attacksStarted: "Ataques tentados",
  attacksResolved: "Golpes resolvidos",
  damageDealt: "Dano causado",
  damageTaken: "Dano recebido",
  hitsTaken: "Vezes atingido",
  kills: "Alvos eliminados",
  timeInDanger: "Tempo em risco (s)",
  repositioned: "Reposicionamentos",
  casts: "Lançamentosenemy",
  dodges: "Esquivas",
  hits: "Vezes atingido",
  punishes: "Contragolpes",
  avgReactionMs: "Reação média (ms)",
};

function statLabel(key) {
  if (key === "casts") return "Lançamentos";
  return STAT_LABELS[key] || key;
}

function medalFor(score) {
  if (score >= 90) return "🏆";
  if (score >= 80) return "🥈";
  if (score >= 65) return "🥉";
  return "◔";
}

function drawHistory(drill) {
  const canvas = $("#results-chart-canvas");
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0f141c";
  ctx.fillRect(0, 0, w, h);

  const history = store.history(drill.id);
  if (history.length < 2) {
    ctx.fillStyle = "#61708a";
    ctx.font = "13px 'Segoe UI', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Faça mais algumas tentativas para ver o gráfico", w / 2, h / 2);
    return;
  }

  const scores = history.map((x) => x.score);
  const max = Math.max(100, ...scores);
  const min = Math.min(0, ...scores);
  const pad = 16;
  const stepX = (w - pad * 2) / (scores.length - 1);

  ctx.strokeStyle = "rgba(120,160,210,.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad + ((h - pad * 2) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(w - pad, y);
    ctx.stroke();
  }

  // Unlock threshold.
  const ty = h - pad - (drill.unlockScore / max) * (h - pad * 2);
  ctx.strokeStyle = "rgba(70,211,154,.45)";
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(pad, ty);
  ctx.lineTo(w - pad, ty);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  scores.forEach((score, i) => {
    const x = pad + stepX * i;
    const y = h - pad - (score / max) * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#4ea1ff";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#4ea1ff";
  scores.forEach((score, i) => {
    const x = pad + stepX * i;
    const y = h - pad - (score / max) * (h - pad * 2);
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  });
}

// ────────────────────────────── statistics ──────────────────────────────

function renderStats() {
  const summary = store.summary();
  const body = $("#stats-body");
  const rows = summary.rows.slice(0, 40);

  body.innerHTML = `
    <div>
      <h3>Resumo</h3>
      <div class="stat-row"><span>Sessões</span><span>${summary.sessions}</span></div>
      <div class="stat-row"><span>Melhor pontuação</span><span>${summary.best}</span></div>
      <div class="stat-row"><span>Níveis tentados</span><span>${rows.length}</span></div>
    </div>
    <div>
      <h3>Por nível</h3>
      <table class="stats-table">
        <thead><tr><th>Treino</th><th>Nível</th><th class="num">Melhor</th><th class="num">Tentativas</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map((r) => {
                    const drill = app.byId.get(r.drillId);
                    return `<tr>
                      <td>${drill ? drill.name : r.drillId}</td>
                      <td>${r.level}</td>
                      <td class="num">${r.best}</td>
                      <td class="num">${r.attempts}</td>
                    </tr>`;
                  })
                  .join("")
              : '<tr><td colspan="4" style="color:var(--muted)">Nenhuma tentativa registrada.</td></tr>'
          }
        </tbody>
      </table>
    </div>
  `;
}

// ────────────────────────────── events ──────────────────────────────

function bindGlobalEvents() {
  document.querySelectorAll("#drill-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#drill-filters .chip").forEach((c) => c.classList.remove("is-on"));
      chip.classList.add("is-on");
      app.filter = chip.dataset.filter;
      renderMenu();
    });
  });

  $("#drill-exit").addEventListener("click", abortDrill);

  $("#open-stats").addEventListener("click", () => {
    renderStats();
    showScreen("stats");
  });
  $("#open-admin").addEventListener("click", () => {
    app.admin?.render();
    showScreen("admin");
  });
  $("#admin-close").addEventListener("click", () => showScreen("menu"));
  $("#stats-close").addEventListener("click", () => showScreen("menu"));
  $("#stats-reset").addEventListener("click", () => {
    if (confirm("Apagar todo o progresso salvo neste navegador?")) {
      store.reset();
      buildChampionSelect();
      renderMenu();
      showScreen("menu");
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && app.session) {
      abortDrill();
    }
  });

  // The right button is a game command, so the native context menu must
  // never appear while a drill is running - not on the canvas, not on the
  // HUD, not anywhere else in the drill screen.
  document.addEventListener("contextmenu", (e) => {
    if (app.session) e.preventDefault();
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (app.session && e.button === 2) e.preventDefault();
  }, true);

  window.addEventListener("resize", () => {
    if (app.session) {
      app.session.scene.resize();
      app.session.scene.setArena(app.session.run.world.arena);
    }
  });
}

boot();
