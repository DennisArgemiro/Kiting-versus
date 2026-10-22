import { buildKitingDrills, buildRealKitingDrills } from "./kiting.js";
import { buildDodgeDrills } from "./dodging.js";

/**
 * Drill registry. A drill owns its levels and knows how to build a run.
 *
 * A ordem importa: os cinco treinos legados continuam nas posições 0..4
 * porque tools/probe.mjs usa os índices 0 (kiting) e 3 (dodge).  Os treinos
 * extras com dados REA entram no fim.
 */
export function buildDrills(champions, snapshot = null) {
  return [
    ...buildKitingDrills(champions, snapshot),
    ...buildDodgeDrills(champions, snapshot),
    ...buildRealKitingDrills(champions, snapshot),
  ];
}

export const CATEGORY_LABEL = {
  kiting: "Kiting",
  dodge: "Esquiva",
};
