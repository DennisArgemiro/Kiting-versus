import { Loop } from "./core/loop.js";
import { Input } from "./core/input.js";
import { Scene3D } from "./engine/scene3d.js";
import { buildDrills, CATEGORY_LABEL } from "./drills/index.js";
import { store } from "./store.js";
import { orderLabel } from "./engine/orders.js";
import { formatTime, makeRng } from "./core/math.js";
import { config, applyChampionOverrides, applyDrillOverrides } from "./config.js";
import { syncArena, ARENA } from "./drills/common.js";
import { createAdmin } from "./admin.js";
import { ArenaMode, createP2Input, applyP2Input, POWERUP_TYPES } from "./arena.js";

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
  // Arena
  arenaSession: null,
  arenaInput2: null,
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
  bindArenaEvents();

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
  
  // Initialize abilities HUD on first run
  if (!updateHud._abilitiesInited) {
    renderAbilitiesHud(run.player, "#hud-abilities");
    updateHud._abilitiesInited = true;
  }
  updateAbilitiesCooldowns(run.player, "#hud-abilities");
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
    if (app.arenaSession) {
      app.arenaSession.scene.resize();
      app.arenaSession.scene.setArena(app.arenaSession.run.world.arena);
    }
  });
}

function bindArenaEvents() {
  // Arena button in main menu
  const openArenaBtn = $("#open-arena");
  if (openArenaBtn) openArenaBtn.addEventListener("click", () => {
    renderArenaSetup();
    showScreen("arena-setup");
  });
  
  // Arena setup close
  const closeBtn = $("#arena-setup-close");
  if (closeBtn) closeBtn.addEventListener("click", () => showScreen("menu"));
  
  // Bot difficulty change
  const diffSel = $("#arena-bot-difficulty");
  if (diffSel) diffSel.addEventListener("change", () => {});
  
  // Start vs Bot
  const startBotBtn = $("#arena-start-bot");
  if (startBotBtn) startBotBtn.addEventListener("click", () => startArena({ isBot: true, mode: 'bot' }));
  
  // Start PvP Local
  const startPvpBtn = $("#arena-start-pvp");
  if (startPvpBtn) startPvpBtn.addEventListener("click", () => startArena({ isBot: false, mode: 'local' }));
  
  // Start PvP Online (if button exists)
  const startOnlineBtn = $("#arena-start-online");
  if (startOnlineBtn) startOnlineBtn.addEventListener("click", () => startArena({ isBot: false, mode: 'online' }));
  
  // Arena exit
  const exitBtn = $("#arena-exit");
  if (exitBtn) exitBtn.addEventListener("click", abortArena);
  
  // Modal buttons
  const rematchBtn = $("#arena-result-modal .modal-rematch");
  if (rematchBtn) rematchBtn.addEventListener("click", () => {
    hideArenaResultModal();
    const lastSettings = app.lastArenaSettings || { isBot: true };
    startArena(lastSettings);
  });
  
  const menuBtn = $("#arena-result-modal .modal-menu");
  if (menuBtn) menuBtn.addEventListener("click", () => {
    hideArenaResultModal();
    renderMenu();
    showScreen("menu");
  });
}function renderArenaSetup() {
  // Get main menu's selected champion
  const mainChampion = store.champion();
  
  // Populate bot champion select
  const botSelect = $("#arena-bot-champion");
  botSelect.innerHTML = "";
  for (const champion of app.champions) {
    const option = document.createElement("option");
    option.value = champion.alias;
    option.textContent = champion.name;
    botSelect.appendChild(option);
  }
  botSelect.value = app.champions[1]?.alias || app.champions[0].alias;
  
  // Populate PvP champion selects
  const p1Select = $("#arena-p1-champion");
  const p2Select = $("#arena-p2-champion");
  p1Select.innerHTML = "";
  p2Select.innerHTML = "";
  for (const champion of app.champions) {
    const o1 = document.createElement("option");
    o1.value = champion.alias;
    o1.textContent = champion.name;
    p1Select.appendChild(o1);
    const o2 = document.createElement("option");
    o2.value = champion.alias;
    o2.textContent = champion.name;
    p2Select.appendChild(o2);
  }
  // P1 uses main menu's selected champion
  p1Select.value = mainChampion;
  p2Select.value = app.champions[1]?.alias || "";
}

function startArena(opts) {
  const { isBot, mode = 'bot' } = opts;
  // Store for rematch
  app.lastArenaSettings = opts;
  
  if (mode === 'online') {
    // Go to lobby screen for online matchmaking
    startOnlineLobby(opts);
    return;
  }
  
  const champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
  let champion2;
  if (isBot) {
    champion2 = app.champions.find(c => c.alias === $("#arena-bot-champion").value) || app.champions[1];
  } else {
    champion2 = app.champions.find(c => c.alias === $("#arena-p2-champion").value) || app.champions[1];
  }
  
  const botDifficulty = $("#arena-bot-difficulty").value;
  const powerupsEnabled = $("#arena-powerups-enabled").checked;
  const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);
  
  const arenaStage = $("#arena-game-stage");
  if (!app.arenaScene) {
    app.arenaScene = new Scene3D(arenaStage);
    app.arenaInput = new Input(app.arenaScene.renderer.domElement, {
      toWorld: (x, y) => app.arenaScene.clientToGround(x, y),
    }, config.combat().cameraLocked);
  }
  const scene = app.arenaScene;
  const input1 = app.arenaInput;
  input1._cameraLocked = config.combat().cameraLocked;
  scene.setCameraConfig({ ...config.camera(), pitch: config.combat().cameraPitch });
  scene.reset();
  scene.resize();
  scene.setArena(ARENA);
  input1.reset();
  
  // Create second input for PvP
  let input2 = null;
  if (!isBot) {
    input2 = createP2Input(scene.renderer.domElement, {
      toWorld: (x, y) => scene.clientToGround(x, y)
    });
    app.arenaInput2 = input2;
  }
  
  const arena = new ArenaMode({
    champion1,
    champion2,
    isBot,
    botDifficulty,
    powerupsEnabled,
    rng,
    onMoveMarker: (x, y, color) => scene.showMoveMarker(x, y, color)
  });
  
  // Override showBanner for powerup messages
  arena.showBanner = function(text, tone) {
    const el = $("#arena-banner");
    el.textContent = text;
    el.className = "banner is-on " + tone;
    clearTimeout(arena.showBanner._timer);
    arena.showBanner._timer = setTimeout(() => {
      el.className = "banner " + tone;
    }, 2000);
  };
  
  // Initialize powerup HUD
  if (!document.getElementById("arena-hud-powerups")) {
    const hudAbilities = $("#arena-hud-abilities");
    if (hudAbilities) {
      const powerupHud = document.createElement("div");
      powerupHud.className = "hud-powerups";
      powerupHud.id = "arena-hud-powerups";
      hudAbilities.parentNode.insertBefore(powerupHud, hudAbilities.nextSibling);
    }
  }
  
  const loop = new Loop(
    function(dt) {
      arena.update(dt, input1, input2);
      if (arena.finished && app.arenaSession && !app.arenaSession.ending) {
        app.arenaSession.ending = true;
        finishArena();
      }
    },
    function() {
      const now = performance.now();
      lastDelta = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const combat = config.combat();
      const edgeScroll = combat.cameraLocked ? null : input1.getEdgeScroll();
      // P2 input handling
      if (input2 && !arena.isBot) {
        applyP2Input(arena.player2, input2, arena.world);
      }
      
      arena.render(scene, { 
        showRanges: combat.showRanges, 
        dt: lastDelta, 
        attackMoveActive: input1.attackMoveActive,
        focusTarget: arena.player1.controller.target,
        powerups: arena.powerups
      });
      scene.updateCamera(arena.player1, lastDelta, edgeScroll);
      updateArenaHud(arena, input1);
      $("#arena-game-stage").classList.toggle("is-attackmove", input1.attackMoveActive);
      input1.endFrame();
      if (input2) input2.endFrame();
    }
  );
  
  app.arenaSession = { arena, scene, input1, input2, loop, ending: false };
  lastFrame = performance.now();
  
  // Populate abilities HUD for P1
  renderAbilitiesHud(arena.player1, "#arena-hud-abilities");
  
  showScreen("arena");
  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(ARENA);
    loop.start();
  });
}

function startOnlineLobby(opts) {
  // For now, simulate online matchmaking with a 10s countdown
  // In production, this would connect to a matchmaking server
  showScreen("arena-lobby");
  
  const champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
  const champion2 = app.champions.find(c => c.alias === $("#arena-p2-champion").value) || app.champions[1];
  
  // Update lobby UI
  $("#lobby-p1 .name").textContent = champion1.name;
  $("#lobby-p1 .avatar").textContent = getChampionEmoji(champion1.alias);
  $("#lobby-p1 .ready").textContent = "Pronto";
  
  // Simulate opponent joining after 2 seconds
  setTimeout(() => {
    $("#lobby-p2 .name").textContent = champion2.name;
    $("#lobby-p2 .avatar").textContent = getChampionEmoji(champion2.alias);
    $("#lobby-p2 .ready").textContent = "Pronto";
  }, 2000);
  
  let countdown = 10;
  $("#lobby-timer").textContent = countdown;
  $("#lobby-status").textContent = "Adversário encontrado! Iniciando em...";
  
  const timer = setInterval(() => {
    countdown--;
    $("#lobby-timer").textContent = countdown;
    if (countdown <= 0) {
      clearInterval(timer);
      // Start the actual match
      startArena({ ...opts, isBot: false, mode: 'local' });
    }
  }, 1000);
  
  // Allow canceling
  const cancelFn = () => {
    clearInterval(timer);
    window.removeEventListener("keydown", cancelFn);
    renderMenu();
    showScreen("menu");
  };
  window.addEventListener("keydown", cancelFn);
}

function getChampionEmoji(alias) {
  const emojis = {
    Ezreal: '🏹', Caitlyn: '🎯', Ashe: '🏹', Jinx: '💥',
    Kaisa: '🦋', Lucian: '🔫', MissFortune: '🔫', Tristana: '🚀',
    Vayne: '🌙', Varus: '🏹', Xayah: '🪶', Aphelios: '🌙',
    Ahri: '🦊', Morgana: '🌑', Lux: '✨', Brand: '🔥',
    Thresh: '⛓️', Nautilus: '⚓', Blitzcrank: '🤖', Ekko: '⏰',
    Annie: '🧸', Zed: '🗡️', Syndra: '🔮', Velkoz: '👁️'
  };
  return emojis[alias] || '❓';
}function abortArena() {
  if (!app.arenaSession) return;
  app.arenaSession.loop.stop();
  app.arenaSession = null;
  app.arenaInput2 = null;
  renderMenu();
  showScreen("menu");
}

function finishArena() {
  const { arena, loop } = app.arenaSession;
  loop.stop();
  app.arenaSession = null;
  app.arenaInput2 = null;
  
  const result = arena.result();
  let winnerText;
  if (result.winner === 'p1') winnerText = "Jogador 1 venceu!";
  else if (result.winner === 'p2') winnerText = "Jogador 2 venceu!";
  else winnerText = "Empate!";
  
  // Show modal instead of separate screen
  showArenaResultModal({
    winner: result.winner,
    p1Score: result.p1Score,
    p2Score: result.p2Score,
    p1Champion: result.p1Champion,
    p2Champion: result.p2Champion,
    duration: 180 - result.duration,
    winnerText
  });
}

function showArenaResultModal(data) {
  const modal = $("#arena-result-modal");
  if (!modal) return;
  
  // Fill content
  modal.querySelector(".modal-title").textContent = data.winner === 'draw' ? "Empate!" : data.winnerText;
  modal.querySelector(".modal-score").textContent = data.p1Score + " x " + data.p2Score;
  modal.querySelector(".modal-champions").innerHTML = 
    '<span class="p1">' + data.p1Champion + '</span> vs <span class="p2">' + data.p2Champion + '</span>';
  modal.querySelector(".modal-duration").textContent = "Duração: " + formatTime(data.duration);
  modal.querySelector(".modal-medal").textContent = data.winner === 'draw' ? "🤝" : (data.winner === 'p1' ? "🏆" : "🥈");
  
  // Button handlers
  const rematchBtn = modal.querySelector(".modal-rematch");
  const menuBtn = modal.querySelector(".modal-menu");
  
  rematchBtn.onclick = () => {
    hideArenaResultModal();
    const lastSettings = app.lastArenaSettings || { isBot: true };
    startArena(lastSettings);
  };
  
  menuBtn.onclick = () => {
    hideArenaResultModal();
    renderMenu();
    showScreen("menu");
  };
  
  modal.classList.add("visible");
}

function hideArenaResultModal() {
  const modal = $("#arena-result-modal");
  if (modal) modal.classList.remove("visible");
}

function updateArenaHud(arena, input) {
  // Timer
  const min = Math.floor(arena.timeLeft / 60);
  const sec = Math.floor(arena.timeLeft % 60).toString().padStart(2, '0');
  $("#arena-hud-timer").textContent = min + ":" + sec;
  
  // Scores
  $("#arena-p1-score").textContent = "P1: " + arena.p1Score;
  $("#arena-p2-score").textContent = "P2: " + arena.p2Score;
  
  // Player 1 HP
  const hpPct = Math.max(0, Math.min(1, arena.player1.hp / arena.player1.maxHp));
  const hpBar = $("#arena-hud-hp");
  hpBar.style.width = (hpPct * 100) + "%";
  hpBar.parentElement.classList.toggle("low", hpPct < 0.35);
  $("#arena-hud-hp-text").textContent = String(Math.round(arena.player1.hp));
  
  // Stats chips
  const chips = [
    { label: "Ordem", value: arena.player1.controller?.order?.kind || "-" }
  ];
  $("#arena-hud-stats").innerHTML = chips
    .map(function(c) { return '<span class="stat-chip">' + c.label + '<b>' + c.value + '</b></span>'; })
    .join("");
  
  // Update abilities cooldown display
  updateAbilitiesCooldowns(arena.player1, "#arena-hud-abilities");
  
  // Update powerup HUD for player 1
  updatePowerupHud(arena, "p1", "#arena-hud-powerups");
}

function updatePowerupHud(arena, playerId, containerSelector) {
  const container = $(containerSelector);
  if (!container) return;
  
  const powerups = arena.getActivePowerups(playerId);
  if (!powerups.length) {
    container.innerHTML = "";
    return;
  }
  
  container.innerHTML = powerups.map(function(p) {
    const progress = (p.timer / p.maxTimer) * 360;
    return '<div class="powerup-hud-item" style="--powerup-color: ' + p.color + '; --progress: ' + progress + 'deg;">' +
      '<div class="cooldown-ring"></div>' +
      '<span class="timer-text">' + Math.ceil(p.timer) + 's</span>' +
    '</div>';
  }).join("");
}

function renderAbilitiesHud(player, containerSelector) {
  const container = $(containerSelector);
  if (!container || !player.data?.spells) {
    if (container) container.innerHTML = "";
    return;
  }
  
  const spells = player.data.spells.filter(function(s) { return s.slot !== 'P'; });
  container.innerHTML = spells.map(function(spell) {
    return '<div class="ability-slot" data-slot="' + spell.slot + '">' +
      '<div class="cooldown-overlay ready" id="cd-' + spell.slot + '"></div>' +
      '<span class="key-hint">' + spell.slot + '</span>' +
    '</div>';
  }).join("");
  
  // Apply spell backgrounds
  spells.forEach(function(spell) {
    const slot = container.querySelector('[data-slot="' + spell.slot + '"]');
    if (slot) {
      slot.style.background = getSpellBackground(spell);
    }
  });
}

function getSpellBackground(spell) {
  const colors = {
    'linear': 'linear-gradient(135deg, #4ea1ff, #2b6fbd)',
    'circle': 'linear-gradient(135deg, #ffb454, #e67e22)',
    'cone': 'linear-gradient(135deg, #46d39a, #2ecc71)',
    'self': 'linear-gradient(135deg, #c8aa6e, #b8860b)'
  };
  return colors[spell.shape] || 'linear-gradient(135deg, #666, #444)';
}

function updateAbilitiesCooldowns(player, containerSelector) {
  if (!player.data?.spells) return;
  
  for (const spell of player.data.spells.filter(function(s) { return s.slot !== 'P'; })) {
    const cd = player.abilityCooldowns[spell.slot] || 0;
    const overlay = document.getElementById("cd-" + spell.slot);
    if (overlay) {
      if (cd > 0) {
        overlay.textContent = String(Math.ceil(cd));
        overlay.classList.remove('ready');
      } else {
        overlay.classList.add('ready');
      }
    }
  }
}

boot();
