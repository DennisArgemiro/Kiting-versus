# Modelo reutilizável — Skill Gap Web

Este documento descreve o "esqueleto" do trainer para que ele possa ser reaproveitado
em outro jogo sem arrastar junto as decisões específicas de League of Legends.

Snapshot congelado antes da análise com REA:

- Pasta: `skillgap-web-snapshot-2026-10-22/`
- Zip: `skillgap-web-snapshot-2026-10-22.zip`
- 101 arquivos, ~22 MB (zip ~8 MB)
- SHA-256 do zip: `2925BF7DE2B4ABD25A56D9ED783AE7DB7212D2ED3714116311F0C0B8AF2C8A8C`

## O que o projeto é

Aplicação web sem build, em HTML/CSS/JS puro (ES modules), com Three.js vendorizado.
Roda em qualquer servidor estático (`node server.mjs 5173`) e persiste progresso e
configuração no `localStorage`.

O modelo de jogo é:

```
menu → escolha de campeão/treino/nível → simulação 3D → resultado → progressão
                                      ↘ admin (configuração ao vivo)
```

## Camadas

| Caminho | Responsabilidade | Acoplamento com LoL |
| --- | --- | --- |
| `index.html`, `styles.css` | Telas, HUD, cards, admin, responsivo | Baixo (textos/ícones) |
| `src/core/loop.js` | Loop fixo (120 Hz) + render | Nenhum |
| `src/core/input.js` | Teclado/mouse, clique→mundo, attack-move | Médio (botões) |
| `src/core/math.js` | Vetores, RNG, clamp, formatação | Nenhum |
| `src/engine/world.js` | Entidades, projéteis, skillshots, efeitos, dano | Baixo |
| `src/engine/unit.js` | `Champion`/unidade, HP, ataque, windup, movimento | Médio (stats) |
| `src/engine/orders.js` | Ordens persistentes: mover, atacar, attack-move, parar | Alto (semântica LoL) |
| `src/engine/skillshot.js` | Formas de habilidade (linear, círculo, cone, self) | Baixo |
| `src/engine/scene3d.js` | Câmera, chão, arena, telegraphs, barras, nameplates | Baixo |
| `src/engine/models.js` | Modelos procedurais dos campeões | Baixo |
| `src/drills/common.js` | Arena, tuning de inimigos, input→ordens, IA genérica | Médio |
| `src/drills/kiting.js` | 3 treinos de kiting e suas métricas | Alto (kiting LoL) |
| `src/drills/dodging.js` | 2 treinos de esquiva, skillshots, reaction time | Alto (dodge LoL) |
| `src/drills/skillgap.js` | Ponte para o snapshot real: stats, duração, campeões, overrides | Médio (Skill Gap) |
| `src/drills/index.js` | Registro de treinos | Baixo |
| `src/data/champions.json` | Dados base dos campeões | Alto (nomes/stats) |
| `src/data/skillgap-levels.json` | 48 chaves / 382 níveis reais do Firestore | Alto (Skill Gap) |
| `src/config.js` | Defaults, overrides, persistência, export/import | Baixo |
| `src/admin.js` | UI do admin (mapa, campeões, inimigos, treinos, dados REA) | Baixo |
| `src/store.js` | Progressão, unlocks, histórico, recordes | Baixo |
| `src/main.js` | Boot, telas, sessão, HUD, resultados, estatísticas | Médio |
| `tools/probe.mjs` | Driver CDP de ponta a ponta | Baixo |

## Fluxo de uma sessão

1. `boot()` carrega `champions.json`, aplica overrides e registra os treinos.
2. `startDrill(drill, level)`:
   - aplica `applyDrillOverrides(drill.id, level.params)`;
   - cria a cena/input **uma única vez** para a sessão;
   - chama `drill.create({ champion, level, rng, champions })`;
   - inicia o `Loop` fixo.
3. A cada tick: `run.update(dt, input)`; se `run.finished`, vai para o resultado.
4. A cada frame: `run.render(scene, { showRanges, dt })`, HUD e `input.endFrame()`.
5. `store.recordResult()` grava score, stats e desbloqueia o próximo nível.

## Contrato de um treino

Um treino é um objeto descritor:

```js
{
  id: "meu-treino",
  name: "Nome",
  category: "kiting" | "dodge",
  tagline: "frase curta",
  hint: "coaching no HUD",
  description: "texto do card",
  unlockScore: 70,                 // score mínimo para liberar o próximo nível
  levels: [{ index: 1, params: { ... } }],
  create: (ctx) => new MinhaDrill({ ...ctx, params: ctx.level.params }),
}
```

A instância devolvida por `create` precisa expor:

- `world` (com `arena`, `add`, `addProjectile`, `addSkillshot`, `effect`, `update`);
- `player` (unidade com `hp`, `maxHp`, `controller`);
- `duration`, `timeLeft`, `ready`, `finished`;
- `update(dt, input)`;
- `render(scene, { showRanges, dt })`;
- `result()` → `{ score, stats }`;
- `hud()` → array de chips `{ label, value, tone }`;
- `coach()` → string opcional;
- `onMoveMarker` (opcional, para o marcador de clique).

`ctx` traz `champion`, `level`, `rng`, `champions` e `params`.

## Configuração e admin

`config.js` guarda tudo o que o admin edita:

```
arena   { w, h }
camera  { zoom, fov, height, distance }
combat  { enemyRangeScale, enemySpeedScale, enemyDamageScale,
          enemyHpScale, playerHpScale, playerHitRadius, showRanges }
champions { alias: { stats parciais } }
drills    { drillId: { duration, enemyCount, ... } }
skillgap  { key: { level: { ...campos do documento } } }
```

Regras que valem a pena manter em qualquer jogo:

- defaults + merge profundo; campo ausente volta ao default;
- overrides por campeão/treino são **parciais**;
- overrides de nível REA são parciais e mesclados sobre o snapshot na hora de
  construir o treino; o snapshot em disco nunca é reescrito pelo admin;
- campeões são reconstruídos do JSON puro a cada mudança (reset real);
- config em chave separada da progressão;
- export/import JSON para versionar balanceamento.

## O que é genérico vs. específico de LoL

Genérico (reaproveite quase intacto):

- loop fixo, câmera, cena, HUD, resultados, histórico, progressão;
- admin com abas, placeholders = default, reset por campo, export/import;
- contrato de treino e o padrão "params por nível";
- snapshot remoto somente leitura + overrides locais parciais (o padrão da aba
  **Dados REA**), útil para qualquer jogo com configs publicadas;
- `tuneEnemy()` e multiplicadores globais de combate;
- `probe.mjs` como teste de fumaça.

Específico de LoL (troque ou remova):

- ordens de botão direito + attack-move + `A`, `S`;
- Q/W/E/R com cooldown e skillshots;
- windup, alcance, projétil, AS, dano de auto-ataque;
- métricas de kiting (DPS, safety, rhythm) e de esquiva (reaction, dodges);
- dados/nomes de campeões e a arena em "unidades de LoL".

## Como portar para outro jogo

1. Copie a pasta do snapshot para o novo projeto.
2. Troque `src/data/champions.json` pelo seu elenco (alias, name, stats, spells).
3. Ajuste `DEFAULTS` em `src/config.js`: arena, câmera, escalas de combate.
   Se o novo jogo também tiver configs remotas, mantenha o padrão
   `snapshot + override parcial` usado em `src/drills/skillgap.js`; assim o admin
   continua editável sem perder a possibilidade de regerar o snapshot.
4. Crie `src/drills/meu-jogo.js` seguindo o contrato acima e registre em
   `src/drills/index.js` (+ `CATEGORY_LABEL`).
5. Ajuste as teclas em `src/core/input.js` e `applyInput()` em `common.js`.
6. Troque textos, HUD e telas em `index.html`/`styles.css`.
7. Renomeie as chaves `skillgap-web.v1` (store) e `skillgap-web.config.v1`
   (config) para evitar colisão no mesmo domínio.
8. Rode `node tools/probe.mjs` depois de subir o servidor; ele cobre boot,
   admin, um treino de cada categoria e reset.

## Armadilhas já resolvidas (não reintroduza)

- **Cena única por sessão**: criar um canvas novo por treino empilha WebGL e
  vaza contexto. `Scene3D` e `Input` são criados uma vez em `startDrill`.
- **Ordens persistentes**: em LoL a ordem continua até ser substituída; é isso
  que permite orbwalking. Não converta para "clique = ação instantânea".
- **Timestep fixo**: a simulação roda em passo fixo; o render usa o delta real.
- **Hitbox**: raio de acerto vem da config (`playerHitRadius`), não hardcoded.
- **Reset de override**: reconstruir do JSON puro; nunca aplicar override sobre
  override.
- **Listeners**: funções que rodam de novo (ex.: select de campeão) usam
  `onchange =`, não `addEventListener` acumulativo.
- **Coordenadas**: um único `clientToGround()` converte mouse→mundo; não some
  offset duas vezes.

## Atalho de depuração

`window.__trainer` expõe `champions`, `rawChampions`, `skillgap`, `drills`,
`byId`, `session`, `loop`, `scene`, `input`, `admin` e `config`. Use isso no
console ou no driver CDP para inspecionar e dirigir a simulação.
