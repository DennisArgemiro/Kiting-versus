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
import { ArenaMode, POWERUP_TYPES } from "./arena.js";

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
  arenaSession: null,
  socket: null,
  onlineRoom: null,
  onlineOpponent: null,
  onlineConnected: false,
  onlineLobbyActive: false,
  onlineLobbyTimer: 0,
  adminAuthenticated: false,
};

const SOCKET_URL = 'http://localhost:3002';
const ADMIN_AUTH_KEY = 'skillgap-web.admin-auth';
const ADMIN_SESSION_KEY = 'skillgap-web.admin-session';
const DEFAULT_ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function getStoredPasswordHash() {
  try {
    const stored = localStorage.getItem('skillgap-web.admin-password');
    return stored || DEFAULT_ADMIN_PASSWORD_HASH;
  } catch {
    return DEFAULT_ADMIN_PASSWORD_HASH;
  }
}

function setStoredPasswordHash(hash) {
  try {
    localStorage.setItem('skillgap-web.admin-password', hash);
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
    if (app.onlineLobbyActive) {
      showScreen('arena-setup');
      app.onlineLobbyActive = false;
    }
    if (app.arenaSession) {
      abortArena();
    }
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

  app.socket.on('opponent-input', ({ role, input, timestamp }) => {
    if (!app.arenaSession || !app.arenaSession.arena) return;
    applyOpponentInput(role, input);
  });

  app.socket.on('opponent-disconnected', () => {
    alert('Oponente desconectou');
    abortArena();
    showScreen('arena-setup');
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

function startOnlineMatch() {
  app.onlineLobbyActive = false;
  if (app.onlineLobbyTimerInterval) {
    clearInterval(app.onlineLobbyTimerInterval);
  }

  const champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
  const champion2 = app.champions.find(c => c.alias === ($("#arena-bot-champion") ? $("#arena-bot-champion").value : app.champions[1]?.alias)) || app.champions[1];

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

  const isBot = false;
  const arena = new ArenaMode({
    champion1,
    champion2,
    isBot,
    botDifficulty: 'normal',
    powerupsEnabled: $("#arena-powerups-enabled") ? $("#arena-powerups-enabled").checked : true,
    abilitiesEnabled: $("#arena-abilities-enabled") ? $("#arena-abilities-enabled").checked : true,
    rng,
    onMoveMarker: (x, y, color) => scene.showMoveMarker(x, y, color),
  });

  arena.showBanner = function(text, tone) {
    const el = $("#arena-banner");
    el.textContent = text;
    el.className = "banner is-on " + tone;
    clearTimeout(arena.showBanner._timer);
    arena.showBanner._timer = setTimeout(() => {
      el.className = "banner " + tone;
    }, 2000);
  };

  const loop = new Loop(
    function(dt) {
      if (app.socket && app.socket.connected && app.onlineRoom && arena.player1) {
        const player = arena.player1;
        try {
          app.socket.emit('player-input', {
            roomCode: app.onlineRoom.roomCode,
            role: app.onlineRoom.role,
            input: {
              x: player.x,
              y: player.y,
              orderKind: player.controller?.order?.kind || 'stop',
              orderPoint: player.controller?.order?.point,
              orderTarget: player.controller?.order?.target,
              attackTimer: player.attackTimer,
              casting: player.casting,
            },
            hp: player.hp,
            maxHp: player.maxHp,
            alive: player.alive,
            timestamp: Date.now(),
          });
        } catch (e) {}
      }

      try {
        arena.update(dt, input1, null);
      } catch (e) {
        console.error('arena update error', e, e.stack);
      }

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
      try {
        arena.render(scene, {
          showRanges: true,
          dt: lastDelta,
          attackMoveActive: input1.attackMoveActive,
          input: input1,
          focusTarget: arena.player1?.controller?.target,
          powerups: arena.powerups,
        });
        if (arena.player1) {
          scene.updateCamera(arena.player1, lastDelta, edgeScroll);
        }
        updateArenaHud(arena, input1);
        $("#arena-game-stage").classList.toggle("is-attackmove", input1.attackMoveActive);
        input1.endFrame();
      } catch (e) {
        console.error('arena render error', e, e.stack);
      }
    }
  );

  app.arenaSession = { arena, scene, input1, input2: null, loop, ending: false };
  lastFrame = performance.now();
  renderAbilitiesHud(arena.player1, "#arena-hud-abilities");
  showScreen("arena");
  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(ARENA);
    loop.start();
  });
}

function applyOpponentInput(role, input) {
  if (!app.arenaSession || !app.arenaSession.arena) return;
  const arena = app.arenaSession.arena;
  const opponent = role === 'p1' ? arena.player2 : arena.player1;
  if (!opponent || !opponent.alive) return;

  opponent.x = input.x;
  opponent.y = input.y;
  opponent.hp = input.hp;
  opponent.alive = input.alive;

  if (input.orderKind === 'move' && input.orderPoint) {
    opponent.controller.moveTo(input.orderPoint.x, input.orderPoint.y);
  } else if (input.orderKind === 'attack' && input.orderTarget) {
    opponent.controller.order = { kind: 'attack', target: opponent };
  } else if (input.orderKind === 'attackMove' && input.orderPoint) {
    opponent.controller.attackMoveTo(input.orderPoint.x, input.orderPoint.y);
  } else if (input.orderKind === 'stop') {
    opponent.controller.stop();
  }

  opponent.attackTimer = input.attackTimer;
  opponent.casting = input.casting;
}

async function boot() {
  const response = await fetch("./src/data/champions.json");
  const data = await response.json();
  app.rawChampions = data.champions;
  app.champions = applyChampionOverrides(structuredClone(app.rawChampions));

  try {
    const sgResponse = await fetch("./src/data/skillgap-levels.json");
    if (sgResponse.ok) app.skillgap = await sgResponse.json();
  } catch (err) {
    console.warn("Snapshot do Skill Gap indisponível; usando níveis locais.", err);
  }

  syncArena();
  rebuildDrills();
  window.__trainer = app;

  buildChampionSelect();
  renderMenu();
  bindGlobalEvents();
  bindArenaEvents();
  bindAdminLoginEvents();
  initSocket();

  app.admin = createAdmin({ app, onApply: applyConfig });
}

function rebuildDrills() {
  app.drills = buildDrills(app.champions, app.skillgap, config.state.modosDrills);
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

  const stage = $("#game-stage");
  if (!app.scene) {
    app.scene = new Scene3D(stage);
    app.input = new Input(app.scene.renderer.domElement, {
      toWorld: (x, y) => app.scene.clientToGround(x, y),
    }, config.combat().cameraLocked);
  }
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
      const edgeScroll = combat.cameraLocked ? null : input.getEdgeScroll();
      try { run.render(scene, { showRanges: combat.showRanges, dt: lastDelta, attackMoveActive: input.attackMoveActive, input }); } catch (e) { console.error("drill render error", e, e.stack); }
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
  
  if (!updateHud._abilitiesInited) {
    renderAbilitiesHud(run.player, "#hud-abilities");
    renderAttributesHud(run.player, "#hud-attributes");
    updateHud._abilitiesInited = true;
  }
  updateAbilitiesCooldowns(run.player, "#hud-abilities");
  updateAttributesHud(run.player, "#hud-attributes");
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

  window.addEventListener("keydown", (e) => {
    if (e.code === "Escape" && app.session) {
      abortDrill();
    }
  });

  document.addEventListener("contextmenu", (e) => {
    if (app.session || app.arenaSession) e.preventDefault();
  }, true);
  document.addEventListener("mousedown", (e) => {
    if ((app.session || app.arenaSession) && e.button === 2) e.preventDefault();
  }, true);

  window.addEventListener("resize", () => {
    if (app.session) {
      app.session.scene.resize();
      app.session.scene.setArena(app.session.run.world.arena);
    }
    if (app.arenaSession) {
      app.arenaSession.scene.resize();
      if (app.arenaSession.arena && app.arenaSession.arena.run) {
        app.arenaSession.scene.setArena(app.arenaSession.arena.run.world.arena);
      }
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
  if (startBotBtn) startBotBtn.addEventListener("click", () => startArena({ isBot: true, mode: 'bot' }));
  
  const startOnlineBtn = $("#arena-start-online");
  if (startOnlineBtn) startOnlineBtn.addEventListener("click", () => {
    app.socket.emit('find-match', { champion: $("#arena-p1-champion").value });
  });
  
  const exitBtn = $("#arena-exit");
  if (exitBtn) exitBtn.addEventListener("click", abortArena);
  
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
  const { isBot, mode = 'bot' } = opts;
  app.lastArenaSettings = opts;
  
  if (mode === 'online') {
    startOnlineLobby(opts);
    return;
  }
  
  const champion1 = app.champions.find(c => c.alias === $("#arena-p1-champion").value) || app.champions[0];
  let champion2;
  if (isBot) {
    champion2 = app.champions.find(c => c.alias === $("#arena-bot-champion").value) || app.champions[1];
  } else {
    champion2 = app.champions[1];
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
  
  const arena = new ArenaMode({
    champion1,
    champion2,
    isBot,
    botDifficulty,
    powerupsEnabled,
    abilitiesEnabled: $("#arena-abilities-enabled") ? $("#arena-abilities-enabled").checked : true,
    rng,
    onMoveMarker: (x, y, color) => scene.showMoveMarker(x, y, color),
  });
  
  arena.showBanner = function(text, tone) {
    const el = $("#arena-banner");
    el.textContent = text;
    el.className = "banner is-on " + tone;
    clearTimeout(arena.showBanner._timer);
    arena.showBanner._timer = setTimeout(() => {
      el.className = "banner " + tone;
    }, 2000);
  };
  
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
      if (app.socket && app.socket.connected && app.onlineRoom && !isBot && arena.player1) {
        const player = arena.player1;
        try {
          app.socket.emit('player-input', {
            roomCode: app.onlineRoom.roomCode,
            role: app.onlineRoom.role,
            input: {
              x: player.x,
              y: player.y,
              orderKind: player.controller?.order?.kind || 'stop',
              orderPoint: player.controller?.order?.point,
              orderTarget: player.controller?.order?.target ? 'unit' : null,
              attackTimer: player.attackTimer,
              casting: player.casting,
            },
            hp: player.hp,
            maxHp: player.maxHp,
            alive: player.alive,
            timestamp: Date.now(),
          });
        } catch (e) {}
      }
      
      try {
        arena.update(dt, input1, null);
      } catch (e) {
        console.error('arena update error', e, e.stack);
      }
      
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
      
      try {
        const attackMoveActive = input1.attackMoveActive;
        const showRanges = combat.showRanges !== false;
        if (attackMoveActive !== this._lastAttackMoveActive) {
          console.log('[main] attackMoveActive changed:', attackMoveActive, 'keysA:', input1.keys?.has('KeyA'));
          this._lastAttackMoveActive = attackMoveActive;
        }
        arena.render(scene, { 
          showRanges: showRanges, 
          dt: lastDelta, 
          attackMoveActive,
          input: input1,
          focusTarget: arena.player1?.controller?.target,
          powerups: arena.powerups,
          opponent: app.onlineOpponent,
        });
        if (arena.player1) {
          scene.updateCamera(arena.player1, lastDelta, edgeScroll);
        }
        updateArenaHud(arena, input1);
        $("#arena-game-stage").classList.toggle("is-attackmove", input1.attackMoveActive);
        input1.endFrame();
      } catch (e) {
        console.error('arena render error', e, e.stack);
      }
    }
  );
  
  app.arenaSession = { arena, scene, input1, input2: null, loop, ending: false };
  lastFrame = performance.now();
  
  const abilHud = document.getElementById("arena-hud-abilities");
  if (abilHud) {
    if (arena.abilitiesEnabled) {
      renderAbilitiesHud(arena.player1, "#arena-hud-abilities");
      abilHud.style.display = "flex";
    } else {
      abilHud.style.display = "none";
    }
  }
  updateArenaHud(arena, input1);
  
  showScreen("arena");
  requestAnimationFrame(() => {
    scene.resize();
    scene.setArena(ARENA);
    loop.start();
  });
}

function startOnlineLobby(opts) {
  app.socket.emit('find-match', { champion: $("#arena-p1-champion").value });
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

function abortArena() {
  if (!app.arenaSession) return;
  try { app.arenaSession.loop.stop(); } catch {}
  if (app.arenaScene) {
    try { app.arenaScene.reset(); } catch {}
  }
  app.arenaSession = null;
  app.arenaInput2 = null;
  renderMenu();
  showScreen("menu");
}

function finishArena() {
  if (!app.arenaSession) return;
  const { arena, loop } = app.arenaSession;
  try { loop.stop(); } catch {}
  if (app.arenaScene) {
    try { app.arenaScene.reset(); } catch {}
  }
  app.arenaSession = null;
  app.arenaInput2 = null;
  
  const result = arena.result();
  let winnerText;
  if (result.winner === 'p1') winnerText = "Jogador 1 venceu!";
  else if (result.winner === 'p2') winnerText = "Jogador 2 venceu!";
  else winnerText = "Empate!";
  
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
  
  modal.querySelector(".modal-title").textContent = data.winner === 'draw' ? "Empate!" : data.winnerText;
  modal.querySelector(".modal-score").textContent = data.p1Score + " x " + data.p2Score;
  modal.querySelector(".modal-champions").innerHTML = 
    '<span class="p1">' + data.p1Champion + '</span> vs <span class="p2">' + data.p2Champion + '</span>';
  modal.querySelector(".modal-duration").textContent = "Duração: " + formatTime(data.duration);
  modal.querySelector(".modal-medal").textContent = data.winner === 'draw' ? "🤝" : (data.winner === 'p1' ? "🏆" : "🥈");
  
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
  const min = Math.floor(arena.timeLeft / 60);
  const sec = Math.floor(arena.timeLeft % 60).toString().padStart(2, '0');
  $("#arena-hud-timer").textContent = min + ":" + sec;
  
  $("#arena-p1-score").textContent = "P1: " + arena.p1Score;
  $("#arena-p2-score").textContent = "P2: " + arena.p2Score;
  
  if (!arena.player1) return;
  const hpPct = Math.max(0, Math.min(1, (arena.player1.hp || 0) / (arena.player1.maxHp || 1)));
  const hpBar = $("#arena-hud-hp");
  if (hpBar) {
    hpBar.style.width = (hpPct * 100) + "%";
    if (hpBar.parentElement) hpBar.parentElement.classList.toggle("low", hpPct < 0.35);
  }
  const hpText = $("#arena-hud-hp-text");
  if (hpText) hpText.textContent = String(Math.round(arena.player1.hp || 0));
  
  const chips = [
    { label: "Ordem", value: arena.player1.controller?.order?.kind || "-" }
  ];
  const statsEl = $("#arena-hud-stats");
  if (statsEl) {
    statsEl.innerHTML = chips
      .map(function(c) { return '<span class="stat-chip">' + c.label + '<b>' + c.value + '</b></span>'; })
      .join("");
  }
  
  if (arena.abilitiesEnabled) {
    updateAbilitiesCooldowns(arena.player1, "#arena-hud-abilities");
  }
  
  if (!updateArenaHud._attributesInited) {
    renderAttributesHud(arena.player1, "#arena-hud-attributes");
    updateArenaHud._attributesInited = true;
  }
  updateAttributesHud(arena.player1, "#arena-hud-attributes");
  
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
      '<span class="icon">' + p.icon + '</span>' +
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

function renderAttributesHud(player, containerSelector) {
  const container = $(containerSelector);
  if (!container) return;
  
  const s = player.data?.stats || {};
  const mult = player.multipliers || {};
  const buffAtkSpd = player.buffAttackSpeed || 1;
  const buffMovSpd = player.buffMoveSpeed || 1;
  
  const attrs = [
    { key: 'health', icon: '❤️', label: 'Vida', value: Math.round((s.health || 0) * (mult.health || 1)), base: s.health },
    { key: 'attackDamage', icon: '⚔️', label: 'Dano', value: Math.round((s.attackDamage || 0) * (mult.attackDamage || 1)), base: s.attackDamage },
    { key: 'attackRange', icon: '🎯', label: 'Alcance', value: Math.round((s.attackRange || 0) * (mult.attackRange || 1)), base: s.attackRange },
    { key: 'attackSpeed', icon: '🏹', label: 'AA/s', value: ((1 / (s.attackPeriod || 0.625)) * (mult.attackSpeed || 1) * (player.buffAttackSpeed || 1)).toFixed(2), base: 1 / (s.attackPeriod || 0.625) },
    { key: 'attackCastTime', icon: '⏱️', label: 'Windup', value: ((s.attackCastTime || 0.3) * (mult.attackCastTime || 1) * 1000).toFixed(0) + 'ms', base: s.attackCastTime * 1000 },
    { key: 'movementSpeed', icon: '👟', label: 'Vel. Mov', value: Math.round((s.movementSpeed || 0) * (mult.movementSpeed || 1) * (player.buffMoveSpeed || 1)), base: s.movementSpeed },
    { key: 'projectileSpeed', icon: '🚀', label: 'Vel. Proj', value: Math.round((s.projectileSpeed || 0) * (mult.projectileSpeed || 1)), base: s.projectileSpeed },
    { key: 'armor', icon: '🛡️', label: 'Armadura', value: Math.round((s.armor || 0) * (mult.armor || 1)), base: s.armor },
    { key: 'magicResistance', icon: '🔮', label: 'Res. Mág', value: Math.round((s.magicResistance || 0) * (mult.magicResistance || 1)), base: s.magicResistance },
  ];
  
  container.innerHTML = attrs.map(function(a) {
    const multVal = a.base > 0 ? (a.value / a.base) : 1;
    const pct = Math.round((multVal - 1) * 100);
    let tone = 'neutral';
    if (pct > 0) tone = 'positive';
    else if (pct < 0) tone = 'negative';
    return '<div class="attr-item" title="' + a.label + ': ' + a.value + ' (' + (pct >= 0 ? '+' : '') + pct + '%)">' +
      '<span class="attr-icon">' + a.icon + '</span>' +
      '<span class="attr-value ' + tone + '">' + a.value + '</span>' +
      '<span class="attr-pct ' + tone + '">(' + (pct >= 0 ? '+' : '') + pct + '%)</span>' +
    '</div>';
  }).join('');
}

function updateAttributesHud(player, containerSelector) {
  const container = $(containerSelector);
  if (!container) return;
  
  const items = container.querySelectorAll('.attr-item');
  if (items.length === 0) return;
  
  const s = player.data?.stats || {};
  const mult = player.multipliers || {};
  const buffAtkSpd = player.buffAttackSpeed || 1;
  const buffMovSpd = player.buffMoveSpeed || 1;
  
  const attrs = [
    { key: 'health', value: Math.round((s.health || 0) * (mult.health || 1)) },
    { key: 'attackDamage', value: Math.round((s.attackDamage || 0) * (mult.attackDamage || 1)) },
    { key: 'attackRange', value: Math.round((s.attackRange || 0) * (mult.attackRange || 1)) },
    { key: 'attackSpeed', value: ((1 / (s.attackPeriod || 0.625)) * (mult.attackSpeed || 1) * (player.buffAttackSpeed || 1)).toFixed(2) },
    { key: 'attackCastTime', value: ((s.attackCastTime || 0.3) * (mult.attackCastTime || 1) * 1000).toFixed(0) + 'ms' },
    { key: 'movementSpeed', value: Math.round((s.movementSpeed || 0) * (mult.movementSpeed || 1) * (player.buffMoveSpeed || 1)) },
    { key: 'projectileSpeed', value: Math.round((s.projectileSpeed || 0) * (mult.projectileSpeed || 1)) },
    { key: 'armor', value: Math.round((s.armor || 0) * (mult.armor || 1)) },
    { key: 'magicResistance', value: Math.round((s.magicResistance || 0) * (mult.magicResistance || 1)) },
  ];
  
  attrs.forEach(function(a, i) {
    const item = items[i];
    if (!item) return;
    const valueEl = item.querySelector('.attr-value');
    let base;
    if (a.key === 'attackSpeed') {
      base = 1 / (s.attackPeriod || 0.625);
    } else {
      base = s[Object.keys(s).find(k => k === a.key)] || 1;
    }
    const multVal = base > 0 ? (a.value / base) : 1;
    const pct = Math.round((multVal - 1) * 100);
    let tone = 'neutral';
    if (pct > 0) tone = 'positive';
    else if (pct < 0) tone = 'negative';
    if (valueEl) {
      valueEl.textContent = a.value + ' ';
      const small = document.createElement('small');
      small.textContent = '(' + (pct >= 0 ? '+' : '') + pct + '%)';
      valueEl.innerHTML = a.value + ' ' + small.outerHTML;
      valueEl.className = 'attr-value ' + tone;
    }
  });
}

boot();