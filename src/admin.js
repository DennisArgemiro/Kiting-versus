/**
 * Admin screen.
 *
 * Four tabs, all live: every change is written to localStorage and applied to
 * the running game objects immediately (via the onApply callback in main.js).
 * The fields show the *override*; an empty field means "use the default",
 * which is printed as the input placeholder.
 */
import { config, DEFAULTS, ARENA_LIMITS } from "./config.js";

const TABS = [
  { id: "map", label: "Mapa" },
  { id: "champions", label: "Campeões" },
  { id: "enemies", label: "Inimigos" },
  { id: "arena", label: "Arena" },
  { id: "drills", label: "Treinos" },
  { id: "modos", label: "Modos" },
  { id: "kitingVersus", label: "Dados REA" },
];

const number = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export function createAdmin({ app, onApply }) {
  const tabsEl = document.querySelector("#admin-tabs");
  const bodyEl = document.querySelector("#admin-body");
  const statusEl = document.querySelector("#admin-status");

  const trainingKeys = Object.keys(app.kitingVersus?.trainings || {});
  const view = {
    tab: "map",
    champion: app.champions[0]?.alias ?? "",
    drill: app.drills[0]?.id ?? "",
    kitingVersusKey: trainingKeys.includes("KITING_0") ? "KITING_0" : (trainingKeys[0] || ""),
    kitingVersusLevel: 1,
  };

  let statusTimer = 0;

  function flash(text = "Alterações aplicadas") {
    statusEl.textContent = `${text} ✓`;
    statusEl.classList.remove("is-bad");
    statusEl.classList.add("is-on");
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => statusEl.classList.remove("is-on"), 1600);
  }

  /** Every commit goes through here: persist, apply, confirm. */
  function commit(mutate) {
    mutate();
    onApply();
    flash();
  }

  // ── small DOM helpers ────────────────────────────────────────────

  function section(title, caption) {
    const el = document.createElement("section");
    el.className = "admin-section";
    const head = document.createElement("div");
    head.className = "admin-section-head";
    head.innerHTML = `<h3>${title}</h3>${caption ? `<p>${caption}</p>` : ""}`;
    el.appendChild(head);
    return el;
  }

  function fieldGrid(...fields) {
    const grid = document.createElement("div");
    grid.className = "admin-grid";
    grid.append(...fields.filter(Boolean));
    return grid;
  }

  /**
   * A numeric input with a reset button.
   *
   *   value        current override (null = empty)
   *   placeholder  the default, shown in grey
   *   onSet(n|0)   commit a number; `null` restores the default
   */
  function numeric({
    label, value, placeholder, min, max, step = 1, unit = "", onSet, hint, after,
  }) {
    const wrap = document.createElement("label");
    wrap.className = "admin-field";

    const head = document.createElement("span");
    head.className = "admin-field-label";
    head.textContent = label;
    if (unit) {
      const em = document.createElement("em");
      em.textContent = `(${unit})`;
      head.append(" ", em);
    }

    const row = document.createElement("div");
    row.className = "admin-input-row";

    const input = document.createElement("input");
    input.type = "number";
    input.className = "admin-input";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.placeholder = placeholder === null || placeholder === undefined ? "" : String(placeholder);
    input.value = value === null || value === undefined ? "" : String(value);
    input.setAttribute("aria-label", label);

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "admin-clear";
    clear.textContent = "↺";
    clear.title = `Voltar ao padrão${placeholder !== undefined && placeholder !== null ? ` (${placeholder})` : ""}`;

    const applyValue = (raw, fromClear) => {
      if (fromClear || raw === "") {
        input.value = "";
        commit(() => onSet(null));
        after?.();
        return;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        input.value = value === null || value === undefined ? "" : String(value);
        return;
      }
      const next = clamp(parsed, min, max);
      input.value = String(next);
      commit(() => onSet(next));
      after?.();
    };

    input.addEventListener("change", () => applyValue(input.value.trim(), false));
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyValue(input.value.trim(), false);
        input.blur();
      }
    });
    clear.addEventListener("click", () => applyValue("", true));

    row.append(input, clear);
    wrap.append(head, row);
    if (hint) {
      const small = document.createElement("small");
      small.className = "admin-field-hint";
      small.textContent = hint;
      wrap.appendChild(small);
    }
    return wrap;
  }

  function toggle({ label, hint, checked, onSet }) {
    const wrap = document.createElement("label");
    wrap.className = "admin-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = checked;
    input.addEventListener("change", () => commit(() => onSet(input.checked)));
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    if (hint) {
      const small = document.createElement("small");
      small.className = "admin-field-hint";
      small.textContent = hint;
      wrap.appendChild(small);
    }
    return wrap;
  }

  function resetButton(label, action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = label;
    btn.addEventListener("click", () => {
      commit(action);
      render();
    });
    return btn;
  }

  // ── panels ───────────────────────────────────────────────────────

  function mapPanel() {
    const arena = config.arena();
    const camera = config.camera();
    const combat = config.combat();
    const root = document.createDocumentFragment();

    const map = section(
      "Tamanho do mapa",
      "O mapa vale para todos os treinos. Aumente para ter espaço de kite; a câmera continua seguindo você.",
    );
    const mapGrid = fieldGrid(
      numeric({
        label: "Largura", unit: "unidades", min: ARENA_LIMITS.minW, max: ARENA_LIMITS.maxW, step: 100,
        value: arena.w, placeholder: DEFAULTS.arena.w,
        onSet: (v) => config.patch("arena", { w: v ?? DEFAULTS.arena.w }),
      }),
      numeric({
        label: "Altura", unit: "unidades", min: ARENA_LIMITS.minH, max: ARENA_LIMITS.maxH, step: 100,
        value: arena.h, placeholder: DEFAULTS.arena.h,
        onSet: (v) => config.patch("arena", { h: v ?? DEFAULTS.arena.h }),
      }),
    );
    map.appendChild(mapGrid);
    const mapActions = document.createElement("div");
    mapActions.className = "admin-actions";
    mapActions.append(
      resetButton("Mapa padrão", () => config.patch("arena", { ...DEFAULTS.arena })),
    );
    map.appendChild(mapActions);

    const cam = section(
      "Câmera",
      "Zoom afasta a visão. A inclinação (pitch) define o ângulo: menor = mais achatado (estilo LoL), maior = mais top-down. A altura é calculada automaticamente: distância × tangente(pitch).",
    );
    const camGrid = fieldGrid(
      numeric({
        label: "Zoom", min: 0.4, max: 2.5, step: 0.05,
        value: camera.zoom, placeholder: DEFAULTS.camera.zoom,
        onSet: (v) => config.patch("camera", { zoom: v ?? DEFAULTS.camera.zoom }),
      }),
      numeric({
        label: "FOV", unit: "graus", min: 25, max: 70, step: 1,
        value: camera.fov, placeholder: DEFAULTS.camera.fov,
        onSet: (v) => config.patch("camera", { fov: v ?? DEFAULTS.camera.fov }),
      }),
      numeric({
        label: "Distância", min: 300, max: 2000, step: 25,
        value: camera.distance, placeholder: DEFAULTS.camera.distance,
        onSet: (v) => config.patch("camera", { distance: v ?? DEFAULTS.camera.distance }),
      }),
      numeric({
        label: "Inclinação (pitch)", unit: "graus", min: 10, max: 60, step: 1,
        value: combat.cameraPitch, placeholder: DEFAULTS.combat.cameraPitch,
        hint: "Menor = mais achatado (estilo LoL), maior = mais top-down.",
        onSet: (v) => config.patch("combat", { cameraPitch: v ?? DEFAULTS.combat.cameraPitch }),
      }),
    );
    cam.appendChild(camGrid);
    const camActions = document.createElement("div");
    camActions.className = "admin-actions";
    camActions.append(
      resetButton("Câmera padrão", () => config.patch("camera", { ...DEFAULTS.camera })),
    );
    cam.appendChild(camActions);

    const display = section("Exibição", "Controle os anéis de alcance desenhados no chão.");
    display.appendChild(
      toggle({
        label: "Mostrar anéis de alcance",
        hint: "Azul: seu alcance. Vermelho: alcance dos inimigos.",
        checked: combat.showRanges,
        onSet: (checked) => config.patch("combat", { showRanges: checked }),
      }),
    );

    root.append(map, cam, display);
    return root;
  }

  function championPanel() {
    const root = document.createDocumentFragment();
    try {
      if (!app.champions || app.champions.length === 0) {
        const empty = section("Campeões", "Nenhum campeão carregado. Recarregue a página.");
        root.appendChild(empty);
        return root;
      }
      const raw = (app.rawChampions || []).find((c) => c.alias === view.champion) || app.rawChampions?.[0];
      const live = app.champions.find((c) => c.alias === (raw?.alias ?? view.champion)) || app.champions[0];
      const alias = live?.alias ?? "";
      const override = config.champion(alias) || {};
      const isCustom = Object.keys(override).length > 0;

      const head = document.createElement("div");
      head.className = "admin-toolbar";
      const select = document.createElement("select");
      select.id = "admin-champion";
      select.className = "admin-select";
      for (const champion of app.champions) {
        const option = document.createElement("option");
        option.value = champion.alias;
        option.textContent = champion.name;
        select.appendChild(option);
      }
      select.value = alias;
      select.addEventListener("change", () => {
        view.champion = select.value;
        render();
      });

      const badge = document.createElement("span");
      badge.className = `badge ${isCustom ? "custom" : ""}`;
      badge.textContent = isCustom ? "Personalizado" : "Padrão do campeão";
      head.append(select, badge);

      const info = document.createElement("div");
      info.className = "admin-actions";
      info.append(
        resetButton("Voltar este campeão ao padrão", () => config.clearChampion(alias)),
      );

      const stats = section(
        "Atributos (Multiplicadores %)",
        "Valores em porcentagem: 1.00 = valor original do campeão. 1.20 = +20%. Deixe vazio para usar o valor original.",
      );

      const stat = (key) => number(override[key]);

      // A field commits a single stat multiplier; clearing it removes only that override.
      // Values are stored as multipliers (1.0 = 100%), but displayed/edited as percentages (0% = no change)
      const champField = (key, opts) =>
        numeric({
          ...opts,
          value: stat(key) !== null ? Math.round((stat(key) - 1) * 100) : null,
          placeholder: 0,
          onSet: (v) =>
            v === null
              ? config.clearChampionField(alias, key)
              : config.setChampion(alias, { [key]: 1 + v / 100 }),
          after: () => refresh(),
        });

      const grid = fieldGrid(
        champField("health", { label: "Vida", min: -90, max: 400, step: 5, unit: "%" }),
        champField("attackDamage", { label: "Dano de ataque", min: -90, max: 400, step: 5, unit: "%" }),
        champField("attackRange", { label: "Alcance", min: -50, max: 100, step: 5, unit: "%" }),
        // Vel. ataque editada diretamente em AA/s (ataques por segundo)
        numeric({
          label: "Vel. ataque (AA/s)", min: 0.1, max: 10, step: 0.05, unit: "AA/s",
          value: raw?.stats ? Math.round(((1 / raw.stats.attackPeriod) * (override.attackSpeed || 1)) * 100) / 100 : null,
          placeholder: raw?.stats ? Math.round((1 / raw.stats.attackPeriod) * 100) / 100 : null,
          onSet: (v) =>
            v === null
              ? config.clearChampionField(alias, "attackSpeed")
              : config.setChampion(alias, { attackSpeed: (v || 0) / (1 / (raw?.stats?.attackPeriod || 0.625)) }),
          after: () => refresh(),
        }),
        numeric({
          label: "Windup", min: -80, max: 200, step: 5, unit: "%",
          value: stat("attackCastTime") !== null ? Math.round((stat("attackCastTime") - 1) * 100) : null,
          placeholder: 0,
          onSet: (v) =>
            v === null
              ? config.clearChampionField(alias, "attackCastTime")
              : config.setChampion(alias, { attackCastTime: 1 + v / 100 }),
          after: () => refresh(),
        }),
        champField("movementSpeed", { label: "Vel. movimento", min: -50, max: 100, step: 5, unit: "%" }),
        champField("projectileSpeed", { label: "Vel. projétil", min: -50, max: 100, step: 5, unit: "%" }),
        champField("armor", { label: "Armadura", min: -90, max: 400, step: 5, unit: "%" }),
        champField("magicResistance", { label: "Res. Mágica", min: -90, max: 400, step: 5, unit: "%" }),
      );
      stats.appendChild(grid);

      const typeRow = document.createElement("div");
      typeRow.className = "admin-inline";
      const typeLabel = document.createElement("span");
      typeLabel.className = "admin-field-label";
      typeLabel.textContent = "Tipo de ataque";
      const typeSelect = document.createElement("select");
      typeSelect.className = "admin-select";
      for (const [value, label] of [["", "Padrão"], ["ranged", "À distância"], ["melee", "Corpo a corpo"]]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        typeSelect.appendChild(option);
      }
      typeSelect.value = typeof override.isMelee === "boolean" ? (override.isMelee ? "melee" : "ranged") : "";
      typeSelect.addEventListener("change", () => {
        const value = typeSelect.value;
        commit(() => {
          if (value === "") config.clearChampionField(alias, "isMelee");
          else config.setChampion(alias, { isMelee: value === "melee" });
        });
        refresh();
      });
      typeRow.append(typeLabel, typeSelect);
      stats.appendChild(typeRow);

      // Live read-out so the player sees what the numbers mean in game.
      const liveBox = document.createElement("div");
      liveBox.className = "admin-readout";

      /** Recomputes the badge and the read-out without rebuilding the panel. */
      const refresh = () => {
        const current = config.champion(alias) || {};
        const custom = Object.keys(current).length > 0;
        badge.textContent = custom ? "Personalizado" : "Padrão do campeão";
        badge.classList.toggle("custom", custom);
        const baseStats = raw?.stats || {};
        const mult = config.champion(alias) || {};
        const effective = {
          health: Math.round((baseStats.health || 0) * (mult.health || 1)),
          attackDamage: Math.round((baseStats.attackDamage || 0) * (mult.attackDamage || 1)),
          attackRange: Math.round((baseStats.attackRange || 0) * (mult.attackRange || 1)),
          attackSpeed: ((1 / (baseStats.attackPeriod || 0.625)) * (mult.attackSpeed || 1)).toFixed(2),
          attackCastTime: ((baseStats.attackCastTime || 0.3) * (mult.attackCastTime || 1) * 1000).toFixed(0),
          movementSpeed: Math.round((baseStats.movementSpeed || 0) * (mult.movementSpeed || 1)),
          projectileSpeed: Math.round((baseStats.projectileSpeed || 0) * (mult.projectileSpeed || 1)),
          armor: Math.round((baseStats.armor || 0) * (mult.armor || 1)),
          magicResistance: Math.round((baseStats.magicResistance || 0) * (mult.magicResistance || 1)),
        };
        liveBox.innerHTML = `
          <div><span>Vida efetiva</span><b>${effective.health}</b></div>
          <div><span>Dano efetivo</span><b>${effective.attackDamage}</b></div>
          <div><span>Alcance efetivo</span><b>${effective.attackRange}</b></div>
          <div><span>AA/s efetiva</span><b>${effective.attackSpeed}</b></div>
          <div><span>Windup efetivo</span><b>${effective.attackCastTime}ms</b></div>
          <div><span>Vel. Mov efetiva</span><b>${effective.movementSpeed}</b></div>
          <div><span>Vel. Proj. efetiva</span><b>${effective.projectileSpeed}</b></div>
          <div><span>Armadura efetiva</span><b>${effective.armor}</b></div>
          <div><span>Res. Mágica efetiva</span><b>${effective.magicResistance}</b></div>
        `;
      };
      refresh();
      root.append(head, stats, liveBox, info);
    } catch (e) {
      const errBox = document.createElement("div");
      errBox.className = "admin-section";
      errBox.innerHTML = `<h3>Erro no Admin Campeões</h3><p style="color:#ff5f6d">${e.message}</p><p style="font-size:11px;color:#888">${e.stack?.split('\n').slice(0,3).join('<br>')}</p>`;
      root.appendChild(errBox);
    }
    return root;
  }

  function enemyPanel() {
    const combat = config.combat();
    const root = document.createDocumentFragment();

    const enemies = section(
      "Inimigos",
      "Multiplicadores aplicados a todos os inimigos, por cima do ajuste de cada nível. 1,00 = valor original do campeão.",
    );
    enemies.appendChild(
      fieldGrid(
        numeric({
          label: "Alcance ×", min: 0.4, max: 3, step: 0.05,
          value: combat.enemyRangeScale, placeholder: DEFAULTS.combat.enemyRangeScale,
          hint: "1,40 = 40% mais alcance. Afeta o anel vermelho.",
          onSet: (v) => config.patch("combat", { enemyRangeScale: v ?? DEFAULTS.combat.enemyRangeScale }),
        }),
        numeric({
          label: "Velocidade ×", min: 0.3, max: 2.5, step: 0.05,
          value: combat.enemySpeedScale, placeholder: DEFAULTS.combat.enemySpeedScale,
          onSet: (v) => config.patch("combat", { enemySpeedScale: v ?? DEFAULTS.combat.enemySpeedScale }),
        }),
        numeric({
          label: "Dano ×", min: 0.1, max: 3, step: 0.05,
          value: combat.enemyDamageScale, placeholder: DEFAULTS.combat.enemyDamageScale,
          onSet: (v) => config.patch("combat", { enemyDamageScale: v ?? DEFAULTS.combat.enemyDamageScale }),
        }),
        numeric({
          label: "Vida ×", min: 0.2, max: 6, step: 0.1,
          value: combat.enemyHpScale, placeholder: DEFAULTS.combat.enemyHpScale,
          onSet: (v) => config.patch("combat", { enemyHpScale: v ?? DEFAULTS.combat.enemyHpScale }),
        }),
      ),
    );

    const player = section("Jogador", "Ajustes do seu campeão nos treinos.");
    player.appendChild(
      fieldGrid(
        numeric({
          label: "Vida ×", min: 0.3, max: 6, step: 0.1,
          value: combat.playerHpScale, placeholder: DEFAULTS.combat.playerHpScale,
          onSet: (v) => config.patch("combat", { playerHpScale: v ?? DEFAULTS.combat.playerHpScale }),
        }),
        numeric({
          label: "Vel. ataque ×", min: 0.3, max: 3, step: 0.05,
          value: combat.playerAttackSpeedScale, placeholder: DEFAULTS.combat.playerAttackSpeedScale,
          hint: "1,50 = 50% mais rápido. Afeta o período e o windup.",
          onSet: (v) => config.patch("combat", { playerAttackSpeedScale: v ?? DEFAULTS.combat.playerAttackSpeedScale }),
        }),
        numeric({
          label: "Raio de acerto", unit: "unidades", min: 20, max: 100, step: 5,
          value: combat.playerHitRadius, placeholder: DEFAULTS.combat.playerHitRadius,
          hint: "Menor = esquiva mais generosa.",
          onSet: (v) => config.patch("combat", { playerHitRadius: v ?? DEFAULTS.combat.playerHitRadius }),
        }),
      ),
    );

    const cameraSection = section("Câmera & Attack-move", "Comportamento da câmera e do attack-move (tecla A).");
    cameraSection.appendChild(
      fieldGrid(
        toggle({
          label: "Câmera travada no personagem",
          hint: "Y alterna travada/solta. Solta = mover câmera encostando o mouse nas bordas.",
          checked: combat.cameraLocked,
          onSet: (checked) => config.patch("combat", { cameraLocked: checked }),
        }),
        toggle({
          label: "A + clique direito foca no alvo mais próximo",
          hint: "Com A pressionado, clicar direito em um inimigo ordena ataque direto nele. Desativado = attack-move normal.",
          checked: combat.attackMoveTargetNearest,
          onSet: (checked) => config.patch("combat", { attackMoveTargetNearest: checked }),
        }),
      ),
    );

    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      resetButton("Restaurar inimigos e jogador", () => config.patch("combat", { ...DEFAULTS.combat })),
    );

    root.append(enemies, player, cameraSection, actions);
    return root;
  }

  function arenaPanel() {
    const arenaSettings = config.state.arenaSettings || DEFAULTS.arenaSettings;
    const combat = config.combat();
    const root = document.createDocumentFragment();

    // Player stats readout with icons
    const liveStats = section("Atributos do Jogador", "Valores atuais do seu campeão (somente leitura).");
    const liveBox = document.createElement("div");
    liveBox.className = "admin-stats-readout";
    
    // Get the current player champion stats
    const championAlias = config.state.champions ? Object.keys(config.state.champions)[0] || "Ezreal" : "Ezreal";
    const champData = app.champions.find(c => c.alias === championAlias) || app.champions[0];
    const s = champData?.stats || {};
    
    liveBox.innerHTML = `
      <div class="stat-item"><span class="stat-icon" title="Vida">❤️</span><span class="stat-label">Vida</span><span class="stat-value">${Math.round(s.health || 0)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Dano de ataque">⚔️</span><span class="stat-label">Dano</span><span class="stat-value">${Math.round(s.attackDamage || 0)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Alcance">🎯</span><span class="stat-label">Alcance</span><span class="stat-value">${Math.round(s.attackRange || 0)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Velocidade de ataque">🏹</span><span class="stat-label">Vel. Atk</span><span class="stat-value">${(s.attackSpeed || 0).toFixed(3)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Windup">⏱️</span><span class="stat-label">Windup</span><span class="stat-value">${(s.attackCastTime * 1000).toFixed(0)}ms</span></div>
      <div class="stat-item"><span class="stat-icon" title="Velocidade de movimento">👟</span><span class="stat-label">Vel. Mov</span><span class="stat-value">${Math.round(s.movementSpeed || 0)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Armadura">🛡️</span><span class="stat-label">Armadura</span><span class="stat-value">${Math.round(s.armor || 0)}</span></div>
      <div class="stat-item"><span class="stat-icon" title="Resistência mágica">🔮</span><span class="stat-label">Res. Mágica</span><span class="stat-value">${Math.round(s.magicResistance || 0)}</span></div>
    `;
    liveStats.appendChild(liveBox);
    root.appendChild(liveStats);

    // Arena settings
    const arenaSec = section("Configurações da Arena", "Ajustes globais do modo Arena (vs Bot / Online).");
    const arenaGrid = fieldGrid(
      numeric({
        label: "Pontuação máxima", min: 1, max: 20, step: 1,
        value: arenaSettings.maxScore, placeholder: DEFAULTS.arenaSettings.maxScore,
        onSet: (v) => config.patch("arenaSettings", { maxScore: v ?? DEFAULTS.arenaSettings.maxScore }),
      }),
      numeric({
        label: "Duração (segundos)", min: 30, max: 600, step: 10,
        value: arenaSettings.duration, placeholder: DEFAULTS.arenaSettings.duration,
        onSet: (v) => config.patch("arenaSettings", { duration: v ?? DEFAULTS.arenaSettings.duration }),
      }),
      toggle({
        label: "Power-ups ativados",
        hint: "Ativa/desativa o spawn de power-ups na arena.",
        checked: arenaSettings.powerupsEnabled,
        onSet: (checked) => config.patch("arenaSettings", { powerupsEnabled: checked }),
      }),
      numeric({
        label: "Intervalo spawn (mín)", min: 5, max: 60, step: 1,
        value: arenaSettings.powerupSpawnInterval?.min, placeholder: DEFAULTS.arenaSettings.powerupSpawnInterval?.min,
        onSet: (v) => config.patch("arenaSettings", { powerupSpawnInterval: { ...arenaSettings.powerupSpawnInterval, min: v ?? DEFAULTS.arenaSettings.powerupSpawnInterval.min } }),
      }),
      numeric({
        label: "Intervalo spawn (máx)", min: 10, max: 120, step: 1,
        value: arenaSettings.powerupSpawnInterval?.max, placeholder: DEFAULTS.arenaSettings.powerupSpawnInterval?.max,
        onSet: (v) => config.patch("arenaSettings", { powerupSpawnInterval: { ...arenaSettings.powerupSpawnInterval, max: v ?? DEFAULTS.arenaSettings.powerupSpawnInterval.max } }),
      }),
      numeric({
        label: "Máx. power-ups simultâneos", min: 1, max: 6, step: 1,
        value: arenaSettings.maxPowerups, placeholder: DEFAULTS.arenaSettings.maxPowerups,
        onSet: (v) => config.patch("arenaSettings", { maxPowerups: v ?? DEFAULTS.arenaSettings.maxPowerups }),
      }),
    );
    arenaSec.appendChild(arenaGrid);
    root.appendChild(arenaSec);

    // Power-ups configuration
    const puSec = section("Power-ups", "Configure cada power-up individualmente. Desative os que não quiser.");
    const puSettings = arenaSettings.powerups || DEFAULTS.arenaSettings.powerups;
    
    const puTypes = [
      { key: 'heal', name: 'Cura', icon: '❤️+', color: '#ff4d6a' },
      { key: 'atkSpeed', name: 'Vel. Ataque', icon: '🏹↑', color: '#ffb84d' },
      { key: 'movSpeed', name: 'Vel. Movimento', icon: '👟↑', color: '#4dff88' },
      { key: 'vamp', name: 'Vampirismo', icon: '⚔️🩸', color: '#d84dff' },
      { key: 'atkSpeedNerf', name: 'Nerf Vel. Atk (Inimigo)', icon: '🏹↓', color: '#ff4d4d' },
      { key: 'movSpeedNerf', name: 'Nerf Vel. Mov (Inimigo)', icon: '👟↓', color: '#4d4dff' },
    ];

    const puGrid = document.createElement("div");
    puGrid.className = "admin-grid";
    
    for (const pu of puTypes) {
      const puConfig = puSettings[pu.key] || DEFAULTS.arenaSettings.powerups[pu.key];
      const puSection = document.createElement("div");
      puSection.className = "admin-pu-section";
      puSection.style.borderLeftColor = pu.color;
      
      let fields;
      if (pu.key === 'heal') {
        fields = fieldGrid(
          toggle({
            label: `${pu.icon} ${pu.name} (Ativo)`,
            checked: puConfig.enabled,
            onSet: (checked) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, enabled: checked } } }),
          }),
          numeric({
            label: "Cura (% vida máx.)", min: 0.05, max: 1, step: 0.05,
            value: puConfig.hpPercent, placeholder: DEFAULTS.arenaSettings.powerups.heal.hpPercent,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, hpPercent: v ?? DEFAULTS.arenaSettings.powerups.heal.hpPercent } } }),
          }),
        );
      } else if (pu.key === 'vamp') {
        fields = fieldGrid(
          toggle({
            label: `${pu.icon} ${pu.name} (Ativo)`,
            checked: puConfig.enabled,
            onSet: (checked) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, enabled: checked } } }),
          }),
          numeric({
            label: "Vampirismo (%)", min: 0.05, max: 0.5, step: 0.05,
            value: puConfig.lifesteal, placeholder: DEFAULTS.arenaSettings.powerups.vamp.lifesteal,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, lifesteal: v ?? DEFAULTS.arenaSettings.powerups.vamp.lifesteal } } }),
          }),
          numeric({
            label: "Duração (s)", min: 1, max: 30, step: 1,
            value: puConfig.duration, placeholder: DEFAULTS.arenaSettings.powerups.vamp.duration,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, duration: v ?? DEFAULTS.arenaSettings.powerups.vamp.duration } } }),
          }),
        );
      } else if (pu.key === 'atkSpeedNerf' || pu.key === 'movSpeedNerf') {
        fields = fieldGrid(
          toggle({
            label: `${pu.icon} ${pu.name} (Ativo)`,
            checked: puConfig.enabled,
            onSet: (checked) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, enabled: checked } } }),
          }),
          numeric({
            label: "Multiplicador", min: 0.2, max: 1, step: 0.05,
            value: puConfig.multiplier, placeholder: DEFAULTS.arenaSettings.powerups[pu.key].multiplier,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, multiplier: v ?? DEFAULTS.arenaSettings.powerups[pu.key].multiplier } } }),
          }),
          numeric({
            label: "Duração (s)", min: 1, max: 30, step: 1,
            value: puConfig.duration, placeholder: DEFAULTS.arenaSettings.powerups[pu.key].duration,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, duration: v ?? DEFAULTS.arenaSettings.powerups[pu.key].duration } } }),
          }),
        );
      } else {
        fields = fieldGrid(
          toggle({
            label: `${pu.icon} ${pu.name} (Ativo)`,
            checked: puConfig.enabled,
            onSet: (checked) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, enabled: checked } } }),
          }),
          numeric({
            label: "Multiplicador", min: 0.5, max: 3, step: 0.1,
            value: puConfig.multiplier, placeholder: DEFAULTS.arenaSettings.powerups[pu.key].multiplier,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, multiplier: v ?? DEFAULTS.arenaSettings.powerups[pu.key].multiplier } } }),
          }),
          numeric({
            label: "Duração (s)", min: 1, max: 30, step: 1,
            value: puConfig.duration, placeholder: DEFAULTS.arenaSettings.powerups[pu.key].duration,
            onSet: (v) => config.patch("arenaSettings", { powerups: { ...arenaSettings.powerups, [pu.key]: { ...puConfig, duration: v ?? DEFAULTS.arenaSettings.powerups[pu.key].duration } } }),
          }),
        );
      }
      
      puSection.appendChild(fields);
      puGrid.appendChild(puSection);
    }
    
    const puReset = document.createElement("div");
    puReset.className = "admin-actions";
    puReset.appendChild(resetButton("Restaurar power-ups padrão", () => config.patch("arenaSettings", { powerups: { ...DEFAULTS.arenaSettings.powerups } })));
    
    puSec.appendChild(puGrid);
    puSec.appendChild(puReset);
    root.appendChild(puSec);

    // HP Bar settings
    const hpSec = section("Barra de Vida", "Ajuste visual da barra de vida na arena.");
    const hpGrid = fieldGrid(
      numeric({
        label: "Altura da barra (px)", min: 8, max: 30, step: 1,
        value: config.state.arenaSettings?.hpBarHeight || 16,
        placeholder: 16,
        onSet: (v) => config.patch("arenaSettings", { hpBarHeight: v ?? 16 }),
        hint: "Altura da barra de vida acima do personagem.",
      }),
      numeric({
        label: "Largura da barra (px)", min: 40, max: 150, step: 5,
        value: config.state.arenaSettings?.hpBarWidth || 80,
        placeholder: 80,
        onSet: (v) => config.patch("arenaSettings", { hpBarWidth: v ?? 80 }),
        hint: "Largura da barra de vida acima do personagem.",
      }),
      toggle({
        label: "Usar cor da HUD superior",
        hint: "Se ativo, usa a mesma cor verde/vermelha da barra de vida do HUD superior.",
        checked: config.state.arenaSettings?.hpBarUseHudColor !== false,
        onSet: (checked) => config.patch("arenaSettings", { hpBarUseHudColor: checked }),
      }),
    );
    hpSec.appendChild(hpGrid);
    root.appendChild(hpSec);

    // Reset button
    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      resetButton("Restaurar arena padrão", () => config.patch("arenaSettings", { ...DEFAULTS.arenaSettings })),
    );
    root.appendChild(actions);

    return root;
  }

  function drillPanel() {
    const root = document.createDocumentFragment();
    const drill = app.drills.find((d) => d.id === view.drill) || app.drills[0];
    if (!drill) return root;

    const override = config.drill(drill.id) || {};
    const first = drill.levels[0]?.params || {};
    const isDodge = drill.category === "dodge";
    const roster = first.enemies ?? first.casters ?? [];

    const head = document.createElement("div");
    head.className = "admin-toolbar";
    const select = document.createElement("select");
    select.className = "admin-select";
    for (const item of app.drills) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      select.appendChild(option);
    }
    select.value = drill.id;
    select.addEventListener("change", () => {
      view.drill = select.value;
      render();
    });
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = isDodge ? "Esquiva" : "Kiting";
    head.append(select, badge);
    root.appendChild(head);

    const body = section(
      "Parâmetros do treino",
      "Vazio = padrão do nível. O número entre parênteses no campo é o valor padrão.",
    );
    const drillField = (key, opts) =>
      numeric({
        ...opts,
        value: number(override[key]),
        onSet: (v) =>
          v === null
            ? config.clearDrillField(drill.id, key)
            : config.setDrill(drill.id, { [key]: v }),
      });

    const grid = fieldGrid(
      drillField("duration", {
        label: "Duração", unit: "s", min: 10, max: 600, step: 5,
        placeholder: first.duration ?? null,
      }),
      drillField("enemyCount", {
        label: "Nº de inimigos", min: 1, max: 8, step: 1,
        placeholder: roster.length || 1,
      }),
      drillField("playerHpScale", {
        label: "Vida do jogador ×", min: 0.3, max: 6, step: 0.1,
        placeholder: 1,
      }),
      !isDodge
        ? drillField("spread", {
            label: "Espaçamento", min: 0.4, max: 3, step: 0.1,
            placeholder: first.spread ?? 1,
            hint: "Distância lateral entre os inimigos.",
          })
        : null,
      isDodge
        ? drillField("speedScale", {
            label: "Velocidade do projétil ×", min: 0.25, max: 2.5, step: 0.05,
            placeholder: first.speedScale ?? 1,
          })
        : null,
      isDodge
        ? drillField("cooldown", {
            label: "Intervalo entre lançamentos", unit: "s", min: 0.3, max: 10, step: 0.1,
            placeholder: first.cooldown ?? null,
          })
        : null,
      isDodge
        ? drillField("radius", {
            label: "Raio de spawn", unit: "unidades", min: 200, max: 3000, step: 20,
            placeholder: first.radius ?? 880,
            hint: "Quão longe os lançadores começam.",
          })
        : null,
    );
    body.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      resetButton("Limpar ajustes deste treino", () => config.clearDrill(drill.id)),
    );
    body.appendChild(actions);
    root.appendChild(body);

    // Per-drill note about the current level shape.
    const note = document.createElement("p");
    note.className = "hint admin-note";
    note.textContent = `${drill.levels.length} níveis · ${isDodge ? "lançadores de skillshot" : "parceiros de treino"} · primeiro nível: ${first.duration ?? "?"}s, ${roster.length || 0} inimigo(s).`;
    root.appendChild(note);
    return root;
  }

  // ── dados REA (Firestore) ────────────────────────────────────────

  function mergeLevel(base, override) {
    if (!base) return {};
    if (!override) return base;
    const out = { ...base };
    for (const [key, value] of Object.entries(override)) {
      out[key] = value && typeof value === "object" && !Array.isArray(value)
        && base[key] && typeof base[key] === "object" && !Array.isArray(base[key])
        ? { ...base[key], ...value }
        : value;
    }
    return out;
  }

  function readPath(obj, path) {
    return path.split(".").reduce((value, key) => (value == null ? value : value[key]), obj);
  }

  function pruneEmpty(obj) {
    for (const [key, value] of Object.entries(obj)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        pruneEmpty(value);
        if (!Object.keys(value).length) delete obj[key];
      }
    }
    return obj;
  }

  function humanize(key) {
    return String(key)
      .replace(/_/g, " ")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/^./, (c) => c.toUpperCase());
  }

  function kitingVersusPanel() {
    const root = document.createDocumentFragment();
    const snapshot = app.kitingVersus;
    if (!snapshot) {
      const warn = section(
        "Snapshot real não carregado",
        "O arquivo src/data/kitingVersus-levels.json não foi encontrado. Rode build_kitingVersus_data.py e recarregue a página.",
      );
      root.appendChild(warn);
      return root;
    }

    const keys = Object.keys(snapshot.trainings || {});
    if (!keys.includes(view.kitingVersusKey)) view.kitingVersusKey = keys[0] || "";
    const training = snapshot.trainings[view.kitingVersusKey];
    const levels = training?.levels || [];
    if (!levels.some((lv) => Number(lv.level) === Number(view.kitingVersusLevel))) {
      view.kitingVersusLevel = levels[0]?.level ?? 1;
    }
    const raw = levels.find((lv) => Number(lv.level) === Number(view.kitingVersusLevel)) || levels[0];
    const key = view.kitingVersusKey;
    const levelId = raw?.level ?? view.kitingVersusLevel;
    const override = config.kitingVersusLevel(key, levelId) || {};
    const effective = mergeLevel(raw, override);

    const head = document.createElement("div");
    head.className = "admin-toolbar";

    const keySelect = document.createElement("select");
    keySelect.className = "admin-select";
    keySelect.setAttribute("aria-label", "Chave do treino");
    for (const k of keys) {
      const item = snapshot.trainings[k];
      const option = document.createElement("option");
      option.value = k;
      option.textContent = `${k} — ${item.title} (${item.levelCount})`;
      keySelect.appendChild(option);
    }
    keySelect.value = key;
    keySelect.addEventListener("change", () => {
      view.kitingVersusKey = keySelect.value;
      view.kitingVersusLevel = 1;
      render();
    });

    const levelSelect = document.createElement("select");
    levelSelect.className = "admin-select";
    levelSelect.setAttribute("aria-label", "Nível");
    for (const lv of levels) {
      const option = document.createElement("option");
      option.value = String(lv.level);
      option.textContent = `Nível ${lv.level}`;
      levelSelect.appendChild(option);
    }
    levelSelect.value = String(levelId);
    levelSelect.disabled = !levels.length;
    levelSelect.addEventListener("change", () => {
      view.kitingVersusLevel = Number(levelSelect.value);
      render();
    });

    const badge = document.createElement("span");
    badge.className = "badge";
    const updateBadge = () => {
      const custom = Object.keys(config.kitingVersusLevel(key, levelId) || {}).length > 0;
      badge.textContent = custom ? "Editado" : "Firestore";
      badge.classList.toggle("custom", custom);
    };
    updateBadge();
    head.append(keySelect, levelSelect, badge);
    root.appendChild(head);

    const meta = section(
      "Snapshot real do Skill Gap",
      "Valores recuperados de Firestore via REA. Editar um campo cria um override local; o snapshot em si não é alterado.",
    );
    const metaBox = document.createElement("div");
    metaBox.className = "admin-readout";
    metaBox.innerHTML = `
      <div><span>Fonte</span><b>${snapshot.meta?.source ?? "—"}</b></div>
      <div><span>Coleção</span><b>${snapshot.meta?.collection ?? "—"}</b></div>
      <div><span>Chaves / níveis</span><b>${snapshot.meta?.keyCount ?? keys.length} / ${snapshot.meta?.levelCount ?? "—"}</b></div>
      <div><span>Nível atual</span><b>${levelId} · ${training?.title ?? key}</b></div>
    `;
    meta.appendChild(metaBox);
    root.appendChild(meta);

    if (!raw) {
      const empty = document.createElement("p");
      empty.className = "hint admin-note";
      empty.textContent = "Esta chave não possui documentos de nível no Firestore (0 níveis).";
      root.appendChild(empty);
      return root;
    }

    const setField = (path, value) => {
      const current = structuredClone(config.kitingVersusLevel(key, levelId) || {});
      const parts = path.split(".");
      let target = current;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (!target[part] || typeof target[part] !== "object") target[part] = {};
        target = target[part];
      }
      const last = parts[parts.length - 1];
      if (value === null) delete target[last];
      else target[last] = value;
      pruneEmpty(current);
      config.setKitingVersusLevel(key, levelId, Object.keys(current).length ? current : null);
      updateBadge();
    };

    const fieldFor = (path, label, opts = {}) => numeric({
      label,
      value: number(readPath(override, path)),
      placeholder: number(readPath(raw, path)) ?? null,
      min: opts.min ?? -100000,
      max: opts.max ?? 100000,
      step: opts.step ?? 0.01,
      unit: opts.unit ?? "",
      hint: opts.hint,
      onSet: (value) => setField(path, value),
    });

    const sg = section(
      "Campos do nível",
      "Vazio = valor do Firestore. Campos numéricos podem ser editados individualmente; o JSON abaixo aceita qualquer campo aninhado.",
    );
    const grid = document.createElement("div");
    grid.className = "admin-grid";
    grid.append(
      fieldFor("trainingDuration", "trainingDuration (doc)", {
        step: 1, min: 0, hint: "Valor cru do Firestore; sozinho não altera a duração usada.",
      }),
      fieldFor("durationSeconds", "Duração jogável", {
        step: 1, min: 10, unit: "s", hint: "Duração usada pelo motor web.",
      }),
    );

    const skip = new Set(["level", "trainingDuration", "durationSeconds",
      "playerStats", "playerStatsIncrement", "enemyStats", "enemyStatsIncrement"]);
    for (const field of Object.keys(raw)) {
      if (skip.has(field)) continue;
      if (typeof raw[field] !== "number") continue;
      grid.append(fieldFor(field, humanize(field), { step: Number.isInteger(raw[field]) ? 1 : 0.01 }));
    }

    for (const group of ["playerStats", "playerStatsIncrement", "enemyStats", "enemyStatsIncrement"]) {
      if (!raw[group] || typeof raw[group] !== "object") continue;
      for (const field of ["health", "speed", "attackDamage", "attackSpeed", "attackRange", "windUpPercentage"]) {
        if (typeof raw[group][field] !== "number") continue;
        grid.append(fieldFor(`${group}.${field}`, `${group}.${humanize(field)}`, {
          step: field === "attackSpeed" || field === "windUpPercentage" ? 0.01 : 1,
          min: 0,
        }));
      }
    }
    sg.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "admin-actions";
    actions.append(
      resetButton("Restaurar este nível", () => config.setKitingVersusLevel(key, levelId, null)),
    );
    sg.appendChild(actions);
    root.appendChild(sg);

    const advanced = document.createElement("details");
    advanced.className = "admin-section";
    const summary = document.createElement("summary");
    summary.innerHTML = `<h3>JSON completo do nível</h3><p>Edite qualquer campo recuperado, inclusive arrays e mapas de campeões.</p>`;
    advanced.appendChild(summary);
    const area = document.createElement("textarea");
    area.className = "admin-json";
    area.spellcheck = false;
    area.value = JSON.stringify(effective, null, 2);
    const jsonActions = document.createElement("div");
    jsonActions.className = "admin-actions";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn btn-primary btn-sm";
    apply.textContent = "Aplicar JSON";
    apply.addEventListener("click", () => {
      try {
        const parsed = JSON.parse(area.value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("O JSON precisa ser um objeto.");
        }
        config.setKitingVersusLevel(key, levelId, parsed);
        onApply();
        render();
        flash("Nível atualizado");
      } catch (err) {
        statusEl.textContent = `JSON inválido: ${err.message}`;
        statusEl.classList.add("is-on", "is-bad");
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => statusEl.classList.remove("is-on", "is-bad"), 3200);
      }
    });
    const restore = resetButton("Voltar ao Firestore", () => config.setKitingVersusLevel(key, levelId, null));
    jsonActions.append(apply, restore);
    advanced.append(area, jsonActions);
    root.appendChild(advanced);

    const note = document.createElement("p");
    note.className = "hint admin-note";
    note.textContent = `${training?.levelCount ?? 0} níveis recuperados · ${training?.fields?.length ?? 0} campos no doc · ${override && Object.keys(override).length ? "override local ativo" : "sem override local"}.`;
    root.appendChild(note);
    return root;
  }

  // ── shell ────────────────────────────────────────────────────────

  function renderTabs() {
    tabsEl.innerHTML = "";
    for (const tab of TABS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "admin-tab";
      btn.textContent = tab.label;
      if (tab.id === view.tab) btn.classList.add("is-on");
      btn.addEventListener("click", () => {
        view.tab = tab.id;
        render();
      });
      tabsEl.appendChild(btn);
    }
  }

  function modosPanel() {
    const root = document.createDocumentFragment();

    const section = document.createElement("section");
    section.className = "admin-section";

    const head = document.createElement("div");
    head.className = "admin-section-head";
    head.innerHTML = `<h3>Modos de Treino</h3><p>Habilite ou desabilite modos de treino para aparecer no menu principal.</p>`;
    section.appendChild(head);

    const grid = document.createElement("div");
    grid.className = "admin-grid";

    const modos = [
      { id: "kiting-spacing", label: "Kiting de Separação", default: true },
      { id: "kiting-defensive", label: "Kiting Defensivo", default: true },
      { id: "kiting-peel", label: "Peel / Proteção", default: true },
      { id: "dodge-skillshot", label: "Esquiva de Skillshots", default: true },
      { id: "dodge-shoot-dodge", label: "Esquiva e Contragolpe", default: true },
      { id: "kiting-peel", label: "Peel / Proteção", default: true },
      { id: "kiting-microgame", label: "Kiting — Microgame (REA)", default: true },
      { id: "kiting-dodge", label: "Kiting + Esquiva (REA)", default: true },
    ];

    for (const modo of modos) {
      const current = config.state.modosDrills?.[modo.id] ?? modo.default;

      const wrap = document.createElement("div");
      wrap.className = "admin-field";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = current;
      checkbox.addEventListener("change", () => {
        commit(() => {
          const modosDrills = { ...(config.state.modosDrills || {}) };
          modosDrills[modo.id] = checkbox.checked;
          config.patch("modosDrills", modosDrills);
        });
      });

      const label = document.createElement("label");
      label.textContent = modo.label;

      wrap.appendChild(checkbox);
      wrap.appendChild(label);
      grid.appendChild(wrap);
    }

    section.appendChild(grid);
    root.appendChild(section);

    return root;
  }

  function render() {
    renderTabs();
    bodyEl.innerHTML = "";
    if (view.tab === "map") bodyEl.appendChild(mapPanel());
    else if (view.tab === "champions") bodyEl.appendChild(championPanel());
    else if (view.tab === "enemies") bodyEl.appendChild(enemyPanel());
    else if (view.tab === "arena") bodyEl.appendChild(arenaPanel());
    else if (view.tab === "modos") bodyEl.appendChild(modosPanel());
    else if (view.tab === "kitingVersus") bodyEl.appendChild(kitingVersusPanel());
    else bodyEl.appendChild(drillPanel());
  }

  // ── persistence chrome ───────────────────────────────────────────

  document.querySelector("#admin-export").addEventListener("click", () => {
    const blob = new Blob([config.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kitingVersus-config.json";
    link.click();
    URL.revokeObjectURL(url);
    flash("Configuração exportada");
  });

  document.querySelector("#admin-import").addEventListener("click", () => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "application/json,.json";
    picker.addEventListener("change", async () => {
      const file = picker.files?.[0];
      if (!file) return;
      try {
        config.importJSON(await file.text());
        onApply();
        render();
        flash("Configuração importada");
      } catch {
        statusEl.textContent = "JSON inválido — nada foi alterado.";
        statusEl.classList.add("is-on", "is-bad");
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => statusEl.classList.remove("is-on", "is-bad"), 3200);
      }
    });
    picker.click();
  });

  document.querySelector("#admin-reset").addEventListener("click", () => {
    const ok = confirm(
      "Restaurar todas as configurações padrão? Seu progresso nos treinos não é afetado.",
    );
    if (!ok) return;
    config.reset();
    onApply();
    render();
    flash("Padrões restaurados");
  });

  return { render };
}
