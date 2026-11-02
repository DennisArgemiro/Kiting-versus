import { Loop } from "./core/loop.js";
import { Input } from "./core/input.js";
import { Scene3D } from "./engine/scene3d.js";
import { buildDrills, CATEGORY_LABEL } from "./drills/index.js";
import { store } from "./store.js";
import { orderLabel } from "./engine/orders.js";
import { formatTime, makeRng } from "./core/math.js";
import { config, applyChampionOverrides, applyDrillOverrides } from "./config.js";
import { syncArena, ARENA } from "./engine/battlefield.js";
import { buildVersusDrill } from "./drills/versus.js";
import { createAdmin } from "./admin.js";
import { gameState } from "./core/GameState.js";
import { championRegistry } from "./champions/index.js";
import { updateHud, updateCameraMode, banner } from "./ui/hud.js";

const $ = (sel) => document.querySelector(sel);

let lastFrame = performance.now();
let lastDelta = 0.016;

const app = {
  champions: [],
  rawChampions: [],
  kitingVersus: null,
  drills: [],
  byId: new Map(),
  filter: "all",
  session: null,
  loop: null,
  admin: null,
  config,
  socket: null,
  onlineRoom: null,
  onlineOpponent: null,
  onlineConnected: false,
  onlineLobbyActive: false,
  onlineLobbyTimer: 0,
  adminAuthenticated: false,
};

// Objeto app no scope do módulo; sem window.app global.

const SOCKET_URL = 'http://localhost:3002';
const ADMIN_AUTH_KEY = 'kitingVersus-web.admin-auth';
const ADMIN_SESSION_KEY = 'kitingVersus-web.admin-session';
const DEFAULT_ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';
const ADMIN_PASSWORD_HASH_ENV = (typeof ADMIN_PASSWORD_HASH !== 'undefined') ? ADMIN_PASSWORD_HASH : null;

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPasswordHash() {
  try {
    const stored = localStorage.getItem('kitingVersus-web.admin-password');
    return stored || ADMIN_PASSWORD_HASH_ENV || DEFAULT_ADMIN_PASSWORD_HASH;
  } catch {
    return ADMIN_PASSWORD_HASH_ENV || DEFAULT_ADMIN_PASSWORD_HASH;
  }
}

function setStoredPasswordHash(hash) {
  try {
    localStorage.setItem('kitingVersus-web.admin-password', hash);
  } catch {}
}

function isAdminAuthenticated() {
  try {
    const session = sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (session === 'authenticated') return true;
    const persistent = localStorage.getItem(ADMIN_AUTH_KEY);
    return persistent === 'true';
  } catch {
    return false;
  }
}

function setAdminAuthenticated(remember = false) {
  try {
    sessionStorage.setItem(ADMIN_SESSION_KEY, 'authenticated');
    if (remember) {
      localStorage.setItem(ADMIN_AUTH_KEY, 'true');
    }
    app.adminAuthenticated = true;
  } catch {
    app.adminAuthenticated = true;
  }
}

function clearAdminAuth() {
  try {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    localStorage.removeItem(ADMIN_AUTH_KEY);
  } catch {}
  app.adminAuthenticated = false;
}

async function verifyAdminPassword(password) {
  const hash = await hashPassword(password);
  const storedHash = getStoredPasswordHash();
  return hash === storedHash;
}

async function changeAdminPassword(currentPassword, newPassword) {
  const verified = await verifyAdminPassword(currentPassword);
  if (!verified) return { success: false, error: 'Senha atual incorreta' };
  const newHash = await hashPassword(newPassword);
  setStoredPasswordHash(newHash);
  return { success: true };
}

function showAdminLogin(error = '') {
  showScreen('admin-login');
  const errorEl = $('#login-error');
  const passwordInput = $('#admin-password');
  if (error) {
    errorEl.textContent = error;
    errorEl.classList.add('visible');
  } else {
    errorEl.textContent = '';
    errorEl.classList.remove('visible');
  }
  passwordInput.value = '';
  passwordInput.focus();
}

function bindAdminLoginEvents() {
  const form = $('#admin-login-form');
  const backBtn = $('#login-back');
  const passwordInput = $('#admin-password');
  const errorEl = $('#login-error');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = passwordInput.value;
    if (!password) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verificando...';
    errorEl.classList.remove('visible');

    try {
      const valid = await verifyAdminPassword(password);
      if (valid) {
        setAdminAuthenticated(true);
        errorEl.classList.remove('visible');
        app.admin?.render();
        showScreen('admin');
      } else {
        errorEl.textContent = 'Senha incorreta. Tente novamente.';
        errorEl.classList.add('visible');
        passwordInput.value = '';
        passwordInput.focus();
      }
    } catch (err) {
      errorEl.textContent = 'Erro ao verificar senha.';
      errorEl.classList.add('visible');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });

  backBtn.addEventListener('click', () => {
    showScreen('menu');
  });

  passwordInput.addEventListener('input', () => {
    errorEl.classList.remove('visible');
  });
}

function requireAdminAuth() {
  if (!isAdminAuthenticated()) {
    showAdminLogin();
    return false;
  }
  return true;
}

function logoutAdmin() {
  clearAdminAuth();
  showScreen('menu');
}

function initSocket() {
  if (!window.io) {
    console.warn('Socket.io client not loaded');
    return;
  }
  app.socket = io(SOCKET_URL, { transports: ['websocket', 'polling'] });

  app.socket.on('connect', () => {
    app.onlineConnected = true;
    console.log('Connected to online server:', app.socket.id);
  });

  app.socket.on('disconnect', () => {
    app.onlineConnected = false;
  });

  app.socket.on('room-created', ({ roomCode, role, champion }) => {
    app.onlineRoom = { roomCode, role };
    app.onlineLobbyActive = true;
    app.onlineLobbyTimer = 5;
    showScreen('arena-lobby');
    updateLobbyUI();
    startLobbyCountdown();
  });

  app.socket.on('room-joined', ({ roomCode, role, champion }) => {
    app.onlineRoom = { roomCode, role };
    app.onlineLobbyActive = true;
    app.onlineLobbyTimer = 5;
    showScreen('arena-lobby');
    updateLobbyUI();
    startLobbyCountdown();
  });

  app.socket.on('match-found', ({ roomCode, role, opponentChampion }) => {
    app.onlineRoom = { roomCode, role };
    app.onlineLobbyActive = true;
    app.onlineLobbyTimer = 5;
    showScreen('arena-lobby');
    updateLobbyUI();
    startLobbyCountdown();
  });

  app.socket.on('room-full', ({ roomCode }) => {
    app.onlineLobbyTimer = 5;
    updateLobbyUI();
    startLobbyCountdown();
  });

  app.socket.on('room-error', ({ message }) => {
    alert(message);
  });
}

function startLobbyCountdown() {
  const timer = setInterval(() => {
    app.onlineLobbyTimer--;
    updateLobbyUI();
    if (app.onlineLobbyTimer <= 0) {
      clearInterval(timer);
      app.onlineLobbyActive = false;
      startOnlineMatch();
    }
  }, 1000);
  app.onlineLobbyTimerInterval = timer;
}

function updateLobbyUI() {
  const timerEl = document.getElementById('lobby-timer');
  const statusEl = document.getElementById('lobby-status');
  const p1El = document.getElementById('lobby-p1');
  const p2El = document.getElementById('lobby-p2');
  if (!timerEl || !statusEl) return;

  timerEl.textContent = app.onlineLobbyTimer;
  statusEl.textContent = app.onlineLobbyTimer > 0 ? 'Adversário encontrado! Iniciando em...' : 'Iniciando partida...';

  if (p1El) {
    p1El.querySelector('.name').textContent = app.onlineRoom.role === 'p1' ? 'Você' : 'Oponente';
    p1El.querySelector('.ready').textContent = 'Pronto';
  }
  if (p2El) {
    p2El.querySelector('.name').textContent = app.onlineRoom.role === 'p2' ? 'Você' : 'Oponente';
    p2El.querySelector('.ready').textContent = 'Pronto';
  }
}

function startVersus(opts) {
  const { isBot = true } = opts;
  app.lastVersusSettings = opts;

  let champion1;
  let champion2;
  if (isBot) {
    champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
    champion2 = app.champions.find(c => c.alias === $("#arena-bot-champion").value) || app.champions[1];
  } else {
    champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
    champion2 = app.champions[1];
  }

  const botDifficulty = $("#arena-bot-difficulty").value;
  const powerupsEnabled = $("#arena-powerups-enabled").checked;
  const abilitiesEnabled = $("#arena-abilities-enabled") ? $("#arena-abilities-enabled").checked : true;
  const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  // DESTROY old scene/input if they exist (cleanup from previous mode)
  // Remove old canvas/WebGL context para evitar acumulação de contexts (Chrome ~16 limit)
  const container = $("#arena-game-stage");
  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) {
    container.removeChild(oldCanvas);
    // Clear all event listeners to break references
    try { oldCanvas.onclick = null; } catch {}
    try { oldCanvas.onmousedown = null; } catch {}
    try { oldCanvas.onmousemove = null; } catch {}
    try { oldCanvas.oncontextmenu = null; } catch {}
    try { oldCanvas.onwheel = null; } catch {}
    // Force WebGL context disposal
    try { oldCanvas.getContext("webgl")?.dispose(); } catch {}
    try { oldCanvas.getContext("webgl2")?.dispose(); } catch {}
    // Null out the dom element completely
    try { oldCanvas.parentNode.removeChild(oldCanvas); } catch {}
  }
  // DESTROY old scene/input if they exist (cleanup from previous mode)
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    // If old scene had a destroy, remove its window listeners first
    if (typeof app.scene.destroy === "function") app.scene.destroy();
  }
  if (app.input) {
    app.input.destroy();
    app.input = null;
  }
  const stage = $("#arena-game-stage");
  app.scene = new Scene3D(stage);
  // Ensure game stage is visible (may be hidden if coming from lobby)
  stage.style.display = "block";
  stage.style.visibility = "visible";
  // Garantir que o canvas tenha dimensões corretas (100% do container)
  const canvas = stage.querySelector("canvas");
  if (canvas) {
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // Aplicar dimensões reais do container para o canvas
    canvas.width = stage.clientWidth;
    canvas.height = stage.clientHeight;
  }
  app.input = new Input(app.scene.renderer.domElement, {
    toWorld: (x, y) => app.scene.clientToGround(x, y),
  }, config.combat().cameraLocked);
  // Reset cameraLocked to default for new game session
  // Ensures each new Arena/Drill game starts with predictable camera state
  config.patch("combat", { cameraLocked: true });
  const scene = app.scene;
  const input = app.input;
  input._cameraLocked = config.combat().cameraLocked;
  scene.setCameraConfig({ ...config.camera(), pitch: config.combat().cameraPitch });
  scene.reset();
  scene.resize();
  scene.setArena(ARENA);
  input.reset();

  const drill = buildVersusDrill(champion1, champion2, isBot, botDifficulty, powerupsEnabled, abilitiesEnabled, rng, app.champions);

  const run = drill.create({
    champion: champion1,
    level: { index: 1, params: {} },
    rng,
    champions: app.champions,
  });
  if ("onMoveMarker" in run) {
    run.onMoveMarker = (x, y, color) => scene.showMoveMarker(x, y, color);
  }

  const loop = new Loop(
    (dt) => {
      try { run.update(dt, input); } catch (e) { console.error("versus update error", e, e.stack); }
      if (run.finished && app.session && !app.session.ending) {
        app.session.ending = true;
        finishVersus(run);
      }
    },
    () => {
      const now = performance.now();
      lastDelta = Math.min(0.1, (now - lastFrame) / 1000);
      lastFrame = now;
      const combat = config.combat();
      try { run.render(scene, { showRanges: combat.showRanges, dt: lastDelta, attackMoveActive: input.attackMoveActive, input }); } catch (e) { console.error("versus render error", e, e.stack); }
      updateCameraMode("drill", input);
      updateHud(run);
      // Placar de mortes visível da arena
      try {
        const pEl = $("#arena-score-player");
        const bEl = $("#arena-score-bot");
        if (pEl && bEl) {
          pEl.textContent = String(run.playerKills ?? 0);
          bEl.textContent = String(run.botKills ?? 0);
        }
      } catch {}
      // Painel de power-ups ativos do jogador
      try {
        const puContainer = $("#arena-active-powerups");
        if (puContainer) {
          const chips = [];
          const p = run.player;
          if (p && p.buffAttackSpeedTimer > 0) {
            chips.push(`<div class="powerup-chip"><span class="powerup-icon">⚡</span><span class="powerup-name">Vel. Ataque</span><span class="powerup-timer">${Math.ceil(p.buffAttackSpeedTimer)}s</span></div>`);
          }
          if (p && p.buffMoveSpeedTimer > 0) {
            chips.push(`<div class="powerup-chip"><span class="powerup-icon">👟</span><span class="powerup-name">Vel. Mov.</span><span class="powerup-timer">${Math.ceil(p.buffMoveSpeedTimer)}s</span></div>`);
          }
          if (p && p.buffRangeTimer > 0) {
            chips.push(`<div class="powerup-chip"><span class="powerup-icon">🎯</span><span class="powerup-name">Alcance</span><span class="powerup-timer">${Math.ceil(p.buffRangeTimer)}s</span></div>`);
          }
          puContainer.innerHTML = chips.length ? chips.join("") : "";
        }
      } catch {}
      $("#arena-game-stage").classList.toggle("is-attackmove", input.attackMoveActive);
      input.endFrame();
    }
  );

  app.session = { drill, level: { index: 1 }, run, scene, input, loop, ending: false, startedAt: performance.now() };
  app.sessionPaused = false;
  $("#pause-overlay").classList.remove("visible");
  gameState.session = app.session;
  lastFrame = performance.now();

  showScreen("arena");  // ← ADICIONADO: Ativa a screen do arena
  document.body.classList.add("arena-mode");

  const exitBtn = $("#arena-exit");
  if (exitBtn) exitBtn.textContent = "⏸ Pause";

  $("#hud-drill-name").textContent = "Versus — Bot";
  $("#hud-drill-level").textContent = "1 vs 1";
  $("#global-hud").style.display = "block";
  // Esconder o botão "Sair" do HUD global na arena — a arena usa seu próprio Pause
  const drillExitOverlay = $("#drill-info-overlay-global");
  if (drillExitOverlay) drillExitOverlay.style.display = "none";
  updateHud(run);

  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(ARENA);
    loop.start();
  });
}

async function boot() {
  const response = await fetch("./src/data/champions.json");
  const data = await response.json();
  app.rawChampions = data.champions;
  app.champions = applyChampionOverrides(structuredClone(app.rawChampions));

  try {
    const sgResponse = await fetch("./src/data/kitingVersus-levels.json");
    if (sgResponse.ok) app.kitingVersus = await sgResponse.json();
  } catch (err) {
    console.warn("Snapshot do Skill Gap indisponível; usando níveis locais.", err);
  }

  syncArena();
  rebuildDrills();
  window.__trainer = app;

  // Registra os campeões reais (com overrides aplicados) no ChampionRegistry.
  for (const champion of app.champions) {
    if (!championRegistry.has(champion.alias)) championRegistry.register(champion);
  }
  gameState.champions = app.champions;
  gameState.rawChampions = app.rawChampions;
  gameState.kitingVersus = app.kitingVersus;
  gameState.drills = app.drills;
  gameState.byId = app.byId;
  gameState.config = config;

  buildChampionSelect();
  renderMenu();
  bindGlobalEvents();
  bindArenaEvents();
  bindAdminLoginEvents();
  initSocket();

  app.admin = createAdmin({ app, onApply: applyConfig });
}

function rebuildDrills() {
  app.drills = buildDrills(app.champions, app.kitingVersus, config.state.modosDrills);
  app.byId = new Map(app.drills.map((d) => [d.id, d]));
}

function applyConfig() {
  app.champions = applyChampionOverrides(structuredClone(app.rawChampions));
  rebuildDrills();
  syncArena();
  if (app.scene) app.scene.setCameraConfig({ ...config.camera(), pitch: config.combat().cameraPitch });
  buildChampionSelect();
  renderMenu();
}

export function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
  $(`#screen-${id}`).classList.add("is-active");
  // Hide global HUD when leaving drill/arena screens
  if (id === "menu" || id === "arena-lobby" || id === "arena-setup" || id === "stats" || id === "admin-login" || id === "admin") {
    $("#global-hud").style.display = "none";
  }
}

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
  select.onchange = () => {
    store.setChampion(select.value);
    renderMenu();
  };
}

function championByAlias(alias) {
  return app.champions.find((c) => c.alias === alias) || app.champions[0];
}

export function renderMenu() {
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
    btn.addEventListener("click", () => {
      // resolve novamente pelo id: os params podem ter mudado (tela de balanceamento)
      const freshDrill = app.byId.get(drill.id) || drill;
      const freshLevel = freshDrill.levels.find((lv) => Number(lv.index) === Number(level.index)) || level;
      startDrill(freshDrill, freshLevel);
    });
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

function startDrill(drill, level) {
  const champion = championByAlias(store.champion());
  const rng = makeRng((Date.now() ^ (Math.random() * 0xffffffff)) >>> 0);

  const runLevel = { ...level, params: applyDrillOverrides(drill.id, level.params) };

  let run;
  try {
    run = drill.create({ champion, level: runLevel, rng, champions: app.champions });
  } catch (err) {
    console.error("Falha ao criar o treino:", err);
    banner("Não foi possível iniciar este treino.", "bad");
    return;
  }

  // Show screen FIRST so container has dimensions
  showScreen("drill");

  // DESTROY old scene/input if they exist (cleanup from previous mode)
  // Remove old canvas/WebGL context para evitar acumulação de contexts (Chrome ~16 limit)
  const container = $("#game-stage");
  const oldCanvas = container.querySelector("canvas");
  if (oldCanvas) {
    container.removeChild(oldCanvas);
    // Clear all event listeners to break references
    try { oldCanvas.onclick = null; } catch {}
    try { oldCanvas.onmousedown = null; } catch {}
    try { oldCanvas.onmousemove = null; } catch {}
    try { oldCanvas.oncontextmenu = null; } catch {}
    try { oldCanvas.onwheel = null; } catch {}
    // Force WebGL context disposal
    try { oldCanvas.getContext("webgl")?.dispose(); } catch {}
    try { oldCanvas.getContext("webgl2")?.dispose(); } catch {}
    // Null out the dom element completely
    try { container.removeChild(oldCanvas); } catch {}
  }
  // DESTROY old scene/input if they exist (cleanup from previous mode)
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    // If old scene had a destroy, remove its window listeners first
    if (typeof app.scene.destroy === "function") app.scene.destroy();
  }
  if (app.input) {
    app.input.destroy();
    app.input = null;
  }

  const stage = $("#game-stage");
  app.scene = new Scene3D(stage);
  app.input = new Input(app.scene.renderer.domElement, {
    toWorld: (x, y) => app.scene.clientToGround(x, y),
  }, config.combat().cameraLocked);
  // Reset cameraLocked to default for new game session
  config.patch("combat", { cameraLocked: true });
  const scene = app.scene;
  const input = app.input;
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
      try { run.update(dt, input); } catch (e) { console.error("drill update error", e, e.stack); }
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
      try { run.render(scene, { showRanges: combat.showRanges, dt: lastDelta, attackMoveActive: input.attackMoveActive, input }); } catch (e) { console.error("drill render error", e, e.stack); }
      updateCameraMode("drill", input);
      updateHud(run);
      $("#game-stage").classList.toggle("is-attackmove", input.attackMoveActive);
      input.endFrame();
    },
  );

  app.session = { drill, level, run, scene, input, loop, ending: false, startedAt: performance.now() };
  app.sessionPaused = false;
  $("#pause-overlay").classList.remove("visible");
  gameState.session = app.session;
  lastFrame = performance.now();

  $("#hud-drill-name").textContent = drill.name;
  $("#hud-drill-level").textContent = `Nível ${level.index}`;
  const hintEl = $("#drill-hint");
  if (hintEl) hintEl.textContent = hintFor(drill);
  $("#global-hud").style.display = "block";
  updateHud(run);

  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(run.world.arena);
    loop.start();
  });
}

function hintFor(drill) {
  return drill.hint || "WASD para mover, clique para atacar, botão direito para andar até o ponto.";
}

function finishDrill() {
  if (!app.session) return;
  if (app.session.input) app.session.input.destroy();
  app.session.loop.stop();
  // Clean up scene/input
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    app.scene = null;
  }
  if (app.input) {
    app.input = null;
  }
  const result = app.session.run.result();
  result.stats.duration = app.session.run.duration;
  const session = app.session;
  const outcome = store.recordResult(session.drill.id, session.level.index, result.score, result.stats, session.drill.unlockScore);

  app.session = null;
  gameState.session = null;
  $("#global-hud").style.display = "none";

  showResults(session.drill, session.level, result, outcome);
}

function abortDrill() {
  if (!app.session) return;
  if (app.session.input) app.session.input.destroy();
  app.session.loop.stop();
  app.sessionPaused = false;
  // Clean up scene/input
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    app.scene = null;
  }
  if (app.input) {
    app.input = null;
  }
  app.session = null;
  gameState.session = null;
  $("#pause-overlay").classList.remove("visible");
  $("#global-hud").style.display = "none";
  renderMenu();
  showScreen("menu");
}

export function showResults(drill, level, result, outcome) {
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
    if (requireAdminAuth()) {
      app.admin?.render();
      showScreen("admin");
    }
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

  ["#hud-stats", "#arena-hud-stats"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.add("hud-status", "hud-status--right");
  });

  const hudStatusToggle = document.getElementById("hud-status-toggle");
  if (hudStatusToggle) {
    hudStatusToggle.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      app.hudStatusRetracted = !app.hudStatusRetracted;
      const side = app.hudStatusRetracted ? "left" : "right";
      ["#hud-stats", "#arena-hud-stats"].forEach((sel) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.classList.remove("hud-status", "hud-status--right", "hud-status--left");
        el.classList.add("hud-status", side === "left" ? "hud-status--left" : "hud-status--right");
      });
      hudStatusToggle.textContent = side === "left" ? "\u2190" : "\u2192";
    });
  }

  // Pause-resume button
  const pauseResumeBtn = $("#pause-resume");
  if (pauseResumeBtn) {
    pauseResumeBtn.addEventListener("click", () => {
      if (app.session && !app.sessionPaused) {
        app.session.loop.stop();
        app.sessionPaused = true;
        $("#pause-overlay").classList.add("visible");
      } else if (app.sessionPaused) {
        app.session.loop.start();
        app.sessionPaused = false;
        $("#pause-overlay").classList.remove("visible");
      }
    });
  }

  // Pause-restart button
  const pauseRestartBtn = $("#pause-restart");
  if (pauseRestartBtn) {
    pauseRestartBtn.addEventListener("click", () => {
      if (app.session) {
        abortDrill();
        startDrill(app.session.drill, app.session.level);
      }
    });
  }

  // Pause-menu button
  const pauseMenuBtn = $("#pause-menu");
  if (pauseMenuBtn) {
    pauseMenuBtn.addEventListener("click", () => {
      if (app.session) {
        abortDrill();
        renderMenu();
        showScreen("menu");
      }
    });
  }

  // Pause state per session
  app.sessionPaused = false;

  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;

    const isDrillSession = !!app.session && !app.sessionPaused;

    if (isDrillSession) {
      app.session.loop.stop();
      app.sessionPaused = true;
      $("#pause-overlay").classList.add("visible");
    } else if (app.sessionPaused) {
      app.session.loop.start();
      app.sessionPaused = false;
      $("#pause-overlay").classList.remove("visible");
    }
  });

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

function bindArenaEvents() {
  const openArenaBtn = $("#open-arena");
  if (openArenaBtn) openArenaBtn.addEventListener("click", () => {
    renderArenaSetup();
    showScreen("arena-setup");
  });
  
  const closeBtn = $("#arena-setup-close");
  if (closeBtn) closeBtn.addEventListener("click", () => showScreen("menu"));
  
  const diffSel = $("#arena-bot-difficulty");
  if (diffSel) diffSel.addEventListener("change", () => {});
  
  const startBotBtn = $("#arena-start-bot");
  if (startBotBtn) startBotBtn.addEventListener("click", () => startVersus({ isBot: true, mode: 'bot' }));
  
  const startOnlineBtn = $("#arena-start-online");
  if (startOnlineBtn) startOnlineBtn.addEventListener("click", () => {
    // Online removed; start local versus instead.
    startVersus({ isBot: true, mode: 'bot' });
  });
  
  const exitBtn = $("#arena-exit");
  if (exitBtn) {
    exitBtn.addEventListener("click", () => {
      if (app.sessionPaused) {
        // Resume game
        app.sessionPaused = false;
        exitBtn.textContent = "⏸ Pause";
        $("#pause-overlay").classList.remove("visible");
        if (app.session.loop) app.session.loop.start();
      } else {
        // Pause game
        app.sessionPaused = true;
        exitBtn.textContent = "▶ Continuar";
        $("#pause-overlay").classList.add("visible");
        if (app.session.loop) app.session.loop.stop();
      }
    });
  }
  
  const rematchBtn = $("#arena-result-modal .modal-rematch");
  if (rematchBtn) rematchBtn.addEventListener("click", () => {
    hideArenaResultModal();
    const lastSettings = app.lastVersusSettings || { isBot: true };
    startVersus(lastSettings);
  });
  
  const menuBtn = $("#arena-result-modal .modal-menu");
  if (menuBtn) menuBtn.addEventListener("click", () => {
    hideArenaResultModal();
    renderMenu();
    showScreen("menu");
  });

  // Botões da tela de resultados da arena (screen-arena-results)
  const arenaResultsRematch = $("#arena-results-rematch");
  if (arenaResultsRematch) {
    arenaResultsRematch.addEventListener("click", () => {
      const lastSettings = app.lastVersusSettings || { isBot: true };
      renderMenu();
      showScreen("menu");
      startVersus(lastSettings);
    });
  }
  const arenaResultsMenu = $("#arena-results-menu");
  if (arenaResultsMenu) {
    arenaResultsMenu.addEventListener("click", () => {
      renderMenu();
      showScreen("menu");
      const drillExitOverlay = $("#drill-info-overlay-global");
      if (drillExitOverlay) drillExitOverlay.style.display = "";
    });
  }
}

function renderArenaSetup() {
  const mainChampion = store.champion();
  
  const botSelect = $("#arena-bot-champion");
  botSelect.innerHTML = "";
  for (const champion of app.champions) {
    const option = document.createElement("option");
    option.value = champion.alias;
    option.textContent = champion.name;
    botSelect.appendChild(option);
  }
  botSelect.value = app.champions[1]?.alias || app.champions[0].alias;
  
  const p1Select = $("#arena-p1-champion");
  p1Select.innerHTML = "";
  for (const champion of app.champions) {
    const o1 = document.createElement("option");
    o1.value = champion.alias;
    o1.textContent = champion.name;
    p1Select.appendChild(o1);
  }
  p1Select.value = mainChampion;
}

function startArena(opts) {
  startVersus(opts);
}

function finishVersus(run) {
  if (!app.session) return;
  if (app.session.input) app.session.input.destroy();
  const { loop } = app.session;
  try { loop.stop(); } catch {}
  // Clean up scene/input
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    app.scene = null;
  }
  if (app.input) {
    app.input = null;
  }
  app.session = null;
  gameState.session = null;
  $("#global-hud").style.display = "none";
  document.body.classList.remove("arena-mode");
  // Mostrar tela de resultados da arena em vez de ir direto para o menu
  showArenaResults(run);
}

function showArenaResults(run) {
  const result = run.result();
  const scoreEl = $("#arena-results-score");
  const verdictEl = $("#arena-results-verdict");
  const medalEl = $("#arena-results-medal");
  const detailsEl = $("#arena-results-details");

  if (scoreEl) scoreEl.textContent = `${result.stats.playerKills ?? 0} x ${result.stats.botKills ?? 0}`;
  if (verdictEl) verdictEl.textContent = result.verdict;
  if (medalEl) medalEl.textContent = result.stats.playerKills >= result.stats.botKills ? "🏆" : "💀";

  if (detailsEl) {
    detailsEl.innerHTML = result.breakdown
      .map(
        (b) => `
      <div class="bd-row">
        <span class="bd-name">${b.name} <small style="opacity:.7">${b.detail || ""}</small></span>
        <span class="bd-val">${b.display}</span>
      </div>
    `,
      )
      .join("");
  }

  renderMenu();
  showScreen("arena-results");
}

function abortVersus() {
  if (!app.session) return;
  if (app.session.input) app.session.input.destroy();
  app.session.loop.stop();
  app.sessionPaused = false;
  // Clean up scene/input
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    app.scene = null;
  }
  if (app.input) {
    app.input = null;
  }
  app.session = null;
  gameState.session = null;
  document.body.classList.remove("arena-mode");
  // Restaurar o botão "Sair" do HUD global ao sair da arena
  const drillExitOverlay = $("#drill-info-overlay-global");
  if (drillExitOverlay) drillExitOverlay.style.display = "";
  $("#pause-overlay").classList.remove("visible");
  $("#global-hud").style.display = "none";
  renderMenu();
  showScreen("menu");
}

function startOnlineLobby(opts) {
  // Online lobby removed; versus mode runs locally.
}

function abortArena() {
  abortVersus();
}

function finishArena() {
  if (!app.session) return;
  if (app.session.input) app.session.input.destroy();
  const { loop } = app.session;
  try { loop.stop(); } catch {}
  if (app.scene) {
    try { app.scene.reset(); } catch {}
    app.scene = null;
  }
  if (app.input) {
    app.input = null;
  }
  app.session = null;
  gameState.session = null;
  gameState.arenaSession = null;
  $("#global-hud").style.display = "none";
  renderMenu();
  showScreen("menu");
}

function hideArenaResultModal() {
  // No result modal for versus mode.
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
}

boot();


