/**
 * Battlefield — mapa/arena compartilhada.
 *
 * Única fonte do retângulo de jogo: engine, render e todos os modos leem
 * daqui. `syncArena()` copia as dimensões do config para o objeto vivo.
 */
import { config } from "../config.js";

export const ARENA = { x: 0, y: 0, w: 3200, h: 1900 };

/** Copia w/h do config para a arena viva e a retorna. */
export function syncArena() {
  const arena = config.arena();
  ARENA.w = arena.w;
  ARENA.h = arena.h;
  return ARENA;
}
