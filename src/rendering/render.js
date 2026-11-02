/**
 * Render — integração padronizada mundo → cena 3D.
 *
 * Único ponto que conecta um drill/modo à Scene3D. Propaga TODAS as flags
 * (zoom, attackMove, ranges, foco, powerups, extras do modo) e aplica o
 * default de showRanges no pipeline.
 */
export function renderDrillScene(scene, world, opts = {}) {
  if (!scene) return;
  scene.render(world, {
    showRanges: opts.showRanges !== false,
    ...opts,
  });
}
