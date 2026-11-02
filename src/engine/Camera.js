/**
 * Camera — módulo único de câmera do jogo.
 *
 * Possui a CÂMERA THREE.js, o alvo (focus), o zoom e a política de travamento:
 *   - Camera travada: segue o jogador (com lerp suave).
 *   - Camera livre: fica onde o jogador deixou + edge-scroll nas bordas.
 *   - Espaço segurado: trava temporariamente no campeão (snap).
 *
 * O Scene3D apenas delega; nenhum modo contém lógica de câmera própria.
 */
import * as THREE from "../../vendor/three.module.js";

export class CameraRig {
  /** Cria a câmera e o estado (zoom, pitch, distância). */
  constructor() {
    this.threeCamera = new THREE.PerspectiveCamera(42, 1, 10, 9000);
    this.focus = new THREE.Vector3(0, 0, 0);      // onde a câmera olha
    this.focusTarget = new THREE.Vector3(0, 0, 0); // alvo do lerp
    this.zoom = 1;
    this.distance = 850;
    this.pitch = 30; // graus
    this._freeCamReady = false;
  }

  /** Reset entre partidas: volta ao centro e sai do modo livre. */
  reset() {
    this.focus.set(0, 0, 0);
    this.focusTarget.set(0, 0, 0);
    this._freeCamReady = false;
  }

  /** Ajusta aspect (chamado no resize da cena). */
  setAspect(aspect) {
    this.threeCamera.aspect = aspect;
    this.threeCamera.updateProjectionMatrix();
  }

  /** Configuração vinda do painel admin/config: zoom, fov, distância e pitch. */
  setConfig({ zoom = 1, fov = 42, distance = 850, pitch = 30 } = {}) {
    this.zoom = zoom > 0 ? zoom : 1;
    this.distance = distance > 0 ? distance : 850;
    this.pitch = pitch > 0 ? pitch : 30;
    if (this.threeCamera.fov !== fov) {
      this.threeCamera.fov = fov;
      this.threeCamera.updateProjectionMatrix();
    }
  }

  /** Zoom acumulado pelo scroll do mouse (clamp 0.5..1.5). */
  applyZoom(delta) {
    if (!delta) return;
    this.zoom = Math.max(0.5, Math.min(1.5, this.zoom + delta));
  }

  /**
   * Resolve a política de câmera para um frame a partir do input:
   * retorna { cameraLocked, snap, edgeScroll }.
   *   - Y (via input.cameraLocked) alterna travado/livre;
   *   - Espaço segurado trava temporariamente no campeão com snap;
   *   - Camera livre gera edge-scroll pelas bordas da tela.
   */
  resolveFrame(input, cameraLocked, player) {
    let locked = cameraLocked;
    if (locked === undefined) locked = input ? input.cameraLocked !== false : true;
    let snap = false;
    let edgeScroll = null;
    if (!locked && player) {
      const centering = input && typeof input.down === "function" && input.down("Space");
      if (centering) {
        locked = true;
        snap = true;
      } else if (input && typeof input.getEdgeScroll === "function") {
        edgeScroll = input.getEdgeScroll();
      }
    }
    return { cameraLocked: locked, snap, edgeScroll };
  }

  /**
   * Atualiza a posição da câmera dentro da arena.
   * `arena` = {x,y,w,h} para clamp; `player` = unidade a seguir.
   */
  update({ player, dt, edgeScroll = null, cameraLocked = true, snap = false, arena } = {}) {
    if (!player || !this.threeCamera) return;
    const a = arena || { x: 0, y: 0, w: 3200, h: 1900 };
    const clampX = (x) => Math.max(a.x + 120, Math.min(a.x + a.w - 120, x));
    const clampZ = (z) => Math.max(a.y + 120, Math.min(a.y + a.h - 120, z));

    if (cameraLocked) {
      this._freeCamReady = false;
      this.focusTarget.set(clampX(player.x), 0, clampZ(player.y));
      if (snap) this.focus.copy(this.focusTarget);
      else this.focus.lerp(this.focusTarget, 1 - Math.pow(0.0015, dt));
    } else {
      // Camera livre: fica onde o jogador a deixou; edge-scroll move o foco.
      if (!this._freeCamReady) {
        this.focus.set(clampX(player.x), 0, clampZ(player.y));
        this._freeCamReady = true;
      }
      if (edgeScroll) {
        const speed = 2200 * dt;
        this.focus.x = clampX(this.focus.x + edgeScroll.x * speed);
        this.focus.z = clampZ(this.focus.z + edgeScroll.y * speed);
      }
    }

    const effectiveDistance = this.distance / (this.zoom || 1);
    const pitchRad = THREE.MathUtils.degToRad(this.pitch);
    const height = effectiveDistance * Math.tan(pitchRad);

    this.threeCamera.position.set(
      this.focus.x,
      height,
      this.focus.z + effectiveDistance,
    );
    this.threeCamera.lookAt(this.focus.x, 0, this.focus.z);
  }
}
