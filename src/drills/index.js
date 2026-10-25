import { buildKitingDrills, buildRealKitingDrills } from "./kiting.js";
import { buildDodgeDrills } from "./dodging.js";

/**
 * Drill registry. A drill owns its levels and knows how to build a run.
 *
 * A ordem importa: os cinco treinos legados continuam nas posições 0..4
 * porque tools/probe.mjs usa os índices 0 (kiting) e 3 (dodge).  Os treinos
 * extras com dados REA entram no fim.
 */
export function buildDrills(champions, snapshot = null, modosDrills = null) {
  const modosAtivos = modosDrills || {};

  const kiting = buildKitingDrills(champions, snapshot);
  const dodge = buildDodgeDrills(champions, snapshot);
  const real = buildRealKitingDrills(champions, snapshot);

  return [
    ...kiting.filter(d => modosAtivos[d.id] !== false),
    ...dodge.filter(d => modosAtivos[d.id] !== false),
    ...real.filter(d => modosAtivos[d.id] !== false),
  ];
}

export const CATEGORY_LABEL = {
  kiting: "Kiting",
  dodge: "Esquiva",
};
