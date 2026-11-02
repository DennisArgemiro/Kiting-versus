/**
 * HUD — único módulo de interface em tempo real de todos os modos.
 *
 * main.js apenas chama updateHud(run) / updateCameraMode() no loop; aqui ficam
 * os slots de habilidades, barras de vida/recurso, retrato, atributos, chips
 * de métricas, coach e o banner. Todos os modos (treinos e arena) usam o
 * MESMO HUD — nunca um estilo de HUD por modo.
 */
import { orderLabel } from "../engine/orders.js";
import { formatTime } from "../core/math.js";

const $ = (sel) => document.querySelector(sel);

/** Banner global (usado por main.js e pelos avisos de countdown do HUD). */
export function banner(text, tone = "") {
  const el = $("#drill-banner");
  el.textContent = text;
  el.className = `banner is-on ${tone}`;
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => {
    el.className = `banner ${tone}`;
  }, 2200);
}

function updateChampionPortrait(player, ids) {
  const img = document.getElementById(ids.img);
  const levelEl = document.getElementById(ids.level);
  const arcEl = document.getElementById(ids.arc);
  const smallIconEl = document.getElementById(ids.smallIcon);
  const alias = (player && (player.alias || (player.data && player.data.alias))) || "Ahri";
  const level = (player && player.level) || 1;
  const progress = (player && player.portraitProgress) || 0;

  if (img) img.src = "./assets/champions/" + encodeURIComponent(alias) + ".png";
  if (levelEl) levelEl.textContent = String(level);

  if (arcEl) {
    const r = 30;
    const C = 2 * Math.PI * r;
    const len = C * Math.max(0, Math.min(1, progress));
    arcEl.style.strokeDasharray = len + " " + (C - len);
  }

  if (smallIconEl) {
    smallIconEl.innerHTML = '<svg viewBox="0 0 24 24"><path d="M13 2 L4 14 h6 l-1 8 9-12 h-6 z" fill="#4ea1ff"/></svg>';
  }
}

function updateHudBars(player, containerSelector) {
  const container = $(containerSelector);
  if (!container) return;
  const fills = container.querySelectorAll(".hud-bar-fill");
  const texts = container.querySelectorAll(".hud-bar-text");
  if (!fills.length) return;
  const hpMax = player.maxHp || 1;
  const hpPct = Math.max(0, Math.min(1, (player.hp ?? 0) / hpMax));
  const resMax = player.resourceMax || player.maxHp * 0.3;
  const resCur = player.resourceCur ?? resMax * 0.5;
  const resPct = Math.max(0, Math.min(1, resMax > 0 ? resCur / resMax : 0));
  fills[0].style.width = (hpPct * 100).toFixed(1) + "%";
  texts[0].textContent = String(Math.round(player.hp ?? 0));
  fills[1].style.width = (resPct * 100).toFixed(1) + "%";
  texts[1].textContent = String(Math.round(resCur));
}

/**
 * Modo de câmera no HUD — lê o MESMO estado do módulo engine/Camera.js
 * (input.cameraLocked é o inventário de câmera único compartilhado).
 */
const cameraModeEls = { drill: null, arena: null };
export function updateCameraMode(which, input) {
  if (!input) return;
  // Both drill and arena share the same global HUD camera mode element
  if (!cameraModeEls[which]) {
    cameraModeEls[which] = document.getElementById("hud-camera-mode");
  }
  const el = cameraModeEls[which];
  if (!el) return;
  const free = !input.cameraLocked;
  const centering = free && typeof input.down === "function" && input.down("Space");
  const state = !free ? "locked" : centering ? "centering" : "free";
  if (el.dataset.state === state) return;
  el.dataset.state = state;
  const text = el.querySelector(".camera-mode-text");
  if (text) text.textContent = !free ? "Câmera fixa" : centering ? "Câmera no campeão" : "Câmera livre";
}

/** Atualiza o HUD global da sessão em execução. */
export function updateHud(run, ids = {}) {
  const hpPct = Math.max(0, Math.min(1, run.player.hp / run.player.maxHp));
  const hpBar = $(ids.hpBar || "#hud-hp");

  if (!updateHud._abilitiesInited) {
    renderAbilitiesHud(run.player, ids.abilities || "#hud-abilities");
    renderAttributesHud(run.player, ids.attributes || "#hud-attributes");
    updateHud._abilitiesInited = true;
  }
  updateAbilitiesCooldowns(run.player, ids.abilities || "#hud-abilities");
  updateHudBars(run.player, ids.abilities || "#hud-abilities");
  updateChampionPortrait(run.player, ids.portrait || { img: "hud-portrait-img", level: "hud-portrait-level", arc: "hud-portrait-arc", smallIcon: "hud-portrait-small-icon" });
  updateAttributesHud(run.player, ids.attributes || "#hud-attributes");
  hpBar.style.width = `${hpPct * 100}%`;
  hpBar.parentElement.classList.toggle("low", hpPct < 0.35);
  $(ids.hpText || "#hud-hp-text").textContent = `${Math.round(run.player.hp)}`;

  if (run.ready > 0) {
    const left = Math.ceil(run.ready);
    const label = left > 1 ? String(left) : "Já!";
    if (updateHud._lastReady !== left) {
      updateHud._lastReady = left;
      banner(label, "");
    }
    const readyTimeText = formatTime(run.duration);
    if (updateHud._lastTimerText !== readyTimeText) {
      updateHud._lastTimerText = readyTimeText;
      $(ids.timer || "#hud-timer").textContent = readyTimeText;
    }
    if (updateHud._lastScore !== "—") {
      updateHud._lastScore = "—";
      $(ids.p1Score || "#hud-score").textContent = "—";
    }
    return;
  }
  if (updateHud._lastReady !== undefined) {
    updateHud._lastReady = undefined;
    banner("Comece!", "good");
  }

  const timeLeftText = formatTime(run.timeLeft);
  if (updateHud._lastTimerText !== timeLeftText) {
    updateHud._lastTimerText = timeLeftText;
    $(ids.timer || "#hud-timer").textContent = timeLeftText;
    if (ids.timerMain) $(ids.timerMain).textContent = timeLeftText;
  }
  $(ids.timer || "#hud-timer").classList.toggle("is-low", run.timeLeft <= 10 && run.timeLeft > 0);

  // Placar de mortes no modo arena (VersusDrill) vs pontuação nos treinos
  const scoreEl = $(ids.p1Score || "#hud-score");
  const hasKills = typeof run.playerKills === "number" && typeof run.botKills === "number";
  if (hasKills) {
    const killText = `${run.playerKills} - ${run.botKills}`;
    if (updateHud._lastKillScore !== killText && scoreEl) {
      updateHud._lastKillScore = killText;
      scoreEl.textContent = killText;
    }
    const labelEl = scoreEl.previousElementSibling;
    if (labelEl && labelEl.textContent.includes("Pontos")) {
      labelEl.textContent = "Abates";
    }
    // Oculta o container "Pontos" do HUD global na arena (placar próprio em arena-kill-score)
    const hudScoreBox = scoreEl.closest ? scoreEl.closest('.hud-score') : scoreEl.parentElement;
    if (hudScoreBox) hudScoreBox.style.display = "none";
  } else {
    const result = run.result();
    const scoreText = String(result.score);
    if (updateHud._lastScore !== scoreText && scoreEl) {
      updateHud._lastScore = scoreText;
      scoreEl.textContent = scoreText;
    }
    const hudScoreBox = scoreEl.closest ? scoreEl.closest('.hud-score') : scoreEl.parentElement;
    if (hudScoreBox) hudScoreBox.style.display = "";
    if (ids.p2Score && run.player2 !== undefined && updateHud._lastP2Score !== run.player2Score) {
      updateHud._lastP2Score = run.player2Score;
      $(ids.p2Score).textContent = String(run.player2Score);
    }
  }

  const chips = run.hud();
  if (run.player.controller) {
    chips.unshift({ label: "Ordem", value: orderLabel(run.player.controller) });
  }
  const statsHtml = chips
    .map((c) => `<span class="stat-chip ${c.tone || ""}">${c.label}<b>${c.value}</b></span>`)
    .join("");
  if (updateHud._lastStatsHtml !== statsHtml) {
    updateHud._lastStatsHtml = statsHtml;
    $(ids.stats || "#hud-stats").innerHTML = statsHtml;
  }

  const coach = run.coach ? run.coach() : "";
  if (updateHud._lastCoach !== coach) {
    updateHud._lastCoach = coach;
    const coachEl = $(ids.coach || "#hud-coach");
    coachEl.textContent = coach;
    coachEl.classList.toggle("is-alert", /incoming|Recue|Clique/.test(coach));
  }
}

// ── Detalhes internos do HUD (abilities/atributos) ────────────────────────

function renderAbilitiesHud(player, containerSelector) {
  const container = $(containerSelector);
  if (!container || !player.data?.spells) {
    if (container) container.innerHTML = "";
    return;
  }

  const spells = player.data.spells.filter(function (s) { return s.slot !== 'P'; });
  const slotsHtml = spells.map(function (spell) {
    return '<div class="ability-slot" data-slot="' + spell.slot + '">' +
      '<div class="cooldown-overlay ready" id="cd-' + spell.slot + '"></div>' +
      '<span class="key-hint">' + spell.slot + '</span>' +
    '</div>';
  }).join("");

  const hpMax = player.maxHp || 1;
  const hpPct = Math.max(0, Math.min(1, (player.hp ?? 0) / hpMax));
  const resMax = player.resourceMax || player.maxHp * 0.3;
  const resCur = player.resourceCur ?? resMax * 0.5;
  const resPct = Math.max(0, Math.min(1, resMax > 0 ? resCur / resMax : 0));

  container.innerHTML = '<div class="ability-row">' + slotsHtml + '</div>' +
    '<div class="hud-bars">' +
      '<div class="hud-bar"><div class="hud-bar-fill" style="width:' + (hpPct * 100).toFixed(1) + '%"></div><div class="hud-bar-text">' + Math.round(player.hp ?? 0) + '</div></div>' +
      '<div class="hud-bar"><div class="hud-bar-fill resource" style="width:' + (resPct * 100).toFixed(1) + '%"></div><div class="hud-bar-text">' + Math.round(resCur) + '</div></div>' +
    '</div>';

  spells.forEach(function (spell) {
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

  const container = $(containerSelector);
  if (!container) return;

  for (const spell of player.data.spells.filter(function (s) { return s.slot !== 'P'; })) {
    const cd = player.abilityCooldowns[spell.slot] || 0;
    const slotEl = container.querySelector('[data-slot="' + spell.slot + '"]');
    const overlay = slotEl ? slotEl.querySelector('.cooldown-overlay') : null;
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
  const outer = $(containerSelector);
  if (!outer) return;
  const container = outer.querySelector('.attr-grid') || outer;
  if (!container) return;

  const s = player.data?.stats || {};
  const mods = player.statModifiers || {};
  const buffAtkSpd = player.buffAttackSpeed || 1;
  const buffMovSpd = player.buffMoveSpeed || 1;
  const baseRange = s.attackRange || 0;
  const curRange = typeof player.attackRange === "number" ? player.attackRange : baseRange;
  const pctOf = (key, base, cur) => Math.round(((cur / Math.max(base, 1)) - 1) * 100);

  const attrs = [
    { key: 'health', icon: '❤️', label: 'Vida', value: Math.round(s.health || 0) },
    { key: 'attackDamage', icon: '⚔️', label: 'Dano', value: Math.round(s.attackDamage || 0) },
    { key: 'attackRange', icon: '🎯', label: 'Alcance', value: Math.round(curRange) },
    { key: 'attackSpeed', icon: '🏹', label: 'AA/s', value: ((1 / (s.attackPeriod || 0.625)) * buffAtkSpd).toFixed(2) },
    { key: 'attackCastTime', icon: '⏱️', label: 'Windup', value: Math.round((s.attackCastTime || 0.3) * 1000) + 'ms' },
    { key: 'movementSpeed', icon: '👟', label: 'Vel. Mov', value: Math.round((s.movementSpeed || 0) * buffMovSpd) },
    { key: 'projectileSpeed', icon: '🚀', label: 'Vel. Proj', value: Math.round(s.projectileSpeed || 0) },
    { key: 'armor', icon: '🛡️', label: 'Armadura', value: Math.round(s.armor || 0) },
    { key: 'magicResistance', icon: '🔮', label: 'Res. Mág', value: Math.round(s.magicResistance || 0) },
  ];

  container.innerHTML = attrs.map(function (a) {
    let pct;
    if (a.key === 'attackRange') {
      pct = pctOf(a.key, baseRange, curRange);
    } else {
      pct = Math.round(((mods[a.key] ?? 1) - 1) * 100);
    }
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
  const outer = $(containerSelector);
  if (!outer) return;
  const container = outer.querySelector('.attr-grid') || outer;
  if (!container) return;

  const items = container.querySelectorAll('.attr-item');
  if (items.length === 0) return;

  const s = player.data?.stats || {};
  const mods = player.statModifiers || {};
  const buffAtkSpd = player.buffAttackSpeed || 1;
  const buffMovSpd = player.buffMoveSpeed || 1;
  const baseRange = s.attackRange || 0;
  const curRange = typeof player.attackRange === "number" ? player.attackRange : baseRange;
  const pctOf = (key, base, cur) => Math.round(((cur / Math.max(base, 1)) - 1) * 100);

  const attrs = [
    { key: 'health', value: Math.round(s.health || 0) },
    { key: 'attackDamage', value: Math.round(s.attackDamage || 0) },
    { key: 'attackRange', value: Math.round(curRange) },
    { key: 'attackSpeed', value: ((1 / (s.attackPeriod || 0.625)) * buffAtkSpd).toFixed(2) },
    { key: 'attackCastTime', value: Math.round((s.attackCastTime || 0.3) * 1000) + 'ms' },
    { key: 'movementSpeed', value: Math.round((s.movementSpeed || 0) * buffMovSpd) },
    { key: 'projectileSpeed', value: Math.round(s.projectileSpeed || 0) },
    { key: 'armor', value: Math.round(s.armor || 0) },
    { key: 'magicResistance', value: Math.round(s.magicResistance || 0) },
  ];

  const sig = attrs.map((a) => `${a.key}:${a.value}`).join("|");
  if (updateAttributesHud._lastSig === sig) return;
  updateAttributesHud._lastSig = sig;

  attrs.forEach(function (a, i) {
    const item = items[i];
    if (!item) return;
    const valueEl = item.querySelector('.attr-value');
    const pctEl = item.querySelector('.attr-pct');
    let pct;
    let tone = 'neutral';
    if (a.key === 'attackRange') {
      pct = pctOf(a.key, baseRange, curRange);
    } else {
      pct = Math.round(((mods[a.key] ?? 1) - 1) * 100);
    }
    if (pct > 0) tone = 'positive';
    else if (pct < 0) tone = 'negative';
    if (valueEl) {
      valueEl.textContent = a.value;
      valueEl.className = 'attr-value ' + tone;
    }
    if (pctEl) pctEl.textContent = '(' + (pct >= 0 ? '+' : '') + pct + '%)';
  });
}
