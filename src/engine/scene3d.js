/**
 * The 3D presentation layer;
 *
 * The simulation stays in the ground plane (x, y); here that maps to
 * three.js (x, z) with y as height. LoL units are used throughout, so the
 * numbers in the drills and the numbers in the scene are the same numbers;
 */

import * as THREE from "../../vendor/three.module.js";
import { buildChampionModel, animateModel } from "./models.js";
import { config, DEFAULTS } from "../config.js";

const GROUND_Y = 0;

function makeFloorTexture(worldW, worldH) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = Math.max(256, Math.round((1024 * worldH) / worldW));
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#0f1822");
  grad.addColorStop(0.5, "#152130");
  grad.addColorStop(1, "#0d141d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // A worn lane running down the middle;
  ctx.fillStyle = "rgba(120,150,190,.045)";
  ctx.fillRect(0, canvas.height * 0.22, canvas.width, canvas.height * 0.56);

  // Grid, one cell every 200 League units;
  ctx.strokeStyle = "rgba(130,170,220,.09)";
  ctx.lineWidth = 1;
  const cell = (200 / worldW) * canvas.width;
  for (let x = 0; x <= canvas.width; x += cell) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(canvas.width, Math.round(y) + 0.5);
    ctx.stroke();
  }

  // Speckle for texture;
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.fillRect(x, y, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Scene3D {
  constructor(container) {
    this.container = container;

    // Create canvas element for Three.js renderer
    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    container.appendChild(canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x070a0e, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080c12);
    this.scene.fog = new THREE.Fog(0x080c12, 3200, 7200);

    this.camera = new THREE.PerspectiveCamera(42, 1, 10, 9000);
    this.cameraFocus = new THREE.Vector3(0, 0, 0);
    this.zoom = 1;
    this.cameraDistance = 850;
    this.cameraHeight = 800;
    this.cameraPitch = 30; // degrees
    this.focusTarget = new THREE.Vector3(0, 0, 0);

    const hemi = new THREE.HemisphereLight(0x8fb4e0, 0x1b2430, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(-600, 1200, 700);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x5f86c4, 0.45);
    rim.position.set(700, 400, -900);
    this.scene.add(rim);

    this.unitViews = new Map();
    this.shotViews = new Map();
    this.projectileViews = new Map();
    this.powerupViews = new Map();
    this.markers = [];
    this.effects = [];
    this.attackMoveMesh = null;

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.resize();
  }

  /** Clears everything that belongs to a previous drill. */
  reset() {
    for (const [, view] of this.unitViews) {
      try {
        if (view.model?.root) this.scene.remove(view.model.root);
        if (view.plate) this.scene.remove(view.plate);
      } catch {}
    }
    this.unitViews.clear();
    for (const [, view] of this.shotViews) {
      this.scene.remove(view.mesh, view.edge);
      view.mesh.geometry.dispose();
      view.mat.dispose();
    }
    this.shotViews.clear();
    for (const [, view] of this.projectileViews) this.scene.remove(view.mesh);
    this.projectileViews.clear();
    for (const m of this.markers) this.scene.remove(m.mesh);
    this.markers.length = 0;
    for (const e of this.effects) this.scene.remove(e.sprite);
    this.effects.length = 0;
    if (this.rings) {
      for (const ring of this.rings.values()) ring.visible = false;
    } else {
      this.rings = new Map();
    }
    if (this.focus) this.focus.visible = false;
    if (this.attackMoveMesh) {
      this.scene.remove(this.attackMoveMesh);
      this.attackMoveMesh.geometry.dispose();
      this.attackMoveMesh.material.dispose();
      this.attackMoveMesh = null;
    }
    this.cameraFocus.set(0, 0, 0);
  }

  resize() {
    const rect = this.container.getBoundingClientRect();
    const w = Math.max(320, Math.floor(rect.width));
    const h = Math.max(240, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.width = w;
    this.height = h;
  }

  setArena(arena) {
    this.arena = arena;
    if (this.floor) {
      this.scene.remove(this.floor);
      this.floor.geometry.dispose();
      this.floor.material.map?.dispose();
      this.floor.material.dispose();
    }
    const padX = arena.w * 0.9;
    const padZ = arena.h * 0.9;
    const texture = makeFloorTexture(arena.w + padX * 2, arena.h + padZ * 2);
    const geo = new THREE.PlaneGeometry(arena.w + padX * 2, arena.h + padZ * 2);
    const mat = new THREE.MeshBasicMaterial({ map: texture });
    this.floor = new THREE.Mesh(geo, mat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(arena.x + arena.w / 2, GROUND_Y, arena.y + arena.h / 2);
    this.scene.add(this.floor);

    if (!this.rim) {
      this.rim = new THREE.Group();
      this.scene.add(this.rim);
    }
    this.rim.clear();
    const rimMat = new THREE.MeshBasicMaterial({ color: 0x3d5578, transparent: true, opacity: 0.5 });
    const t = 12;
    const parts = [
      [arena.w, t, arena.x + arena.w / 2, arena.y - t / 2],
      [arena.w, t, arena.x + arena.w / 2, arena.y + arena.h + t / 2],
      [t, arena.h + t * 2, arena.x - t / 2, arena.y + arena.h / 2],
      [t, arena.h + t * 2, arena.x + arena.w + t / 2, arena.y + arena.h / 2],
    ];
    for (const [w, h, x, y] of parts) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 18, h), rimMat);
      mesh.position.set(x, 9, y);
      this.rim.add(mesh);
    }
  }

  /** Converts a client-space point into a point on the ground plane. */
  clientToGround(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) {
      return { x: 0, y: 0 };
    }
    return { x: hit.x, y: hit.z };
  }

  place(obj, x, y, z = 0) {
    obj.position.set(x, z, y);
  }

  worldToScreen(x, y) {
    const v = new THREE.Vector3(x, 0, y).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
    };
  }

  syncUnits(world) {
    const seen = new Set();
    for (const unit of world.units || []) {
      if (!unit) continue;
      seen.add(unit.id);
      let view = this.unitViews.get(unit.id);
      if (!view) {
        const model = buildChampionModel(unit.data || { alias: unit.name });
        const blob = new THREE.Mesh(
          new THREE.CircleGeometry(unit.radius * 0.85, 20),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }),
        );
        blob.rotation.x = -Math.PI / 2;
        blob.position.y = 2;
        model.root.add(blob);

        const plate = new THREE.Group();
        // Get arena settings for HP bar dimensions
        const arenaSettings = config?.state?.arenaSettings || DEFAULTS.arenaSettings;
        const hpBarWidth = arenaSettings.hpBarWidth || 80;
        const hpBarHeight = arenaSettings.hpBarHeight || 16;
        const useHudColor = arenaSettings.hpBarUseHudColor !== false;
        
        const barBg = new THREE.Mesh(
          new THREE.PlaneGeometry(hpBarWidth, hpBarHeight),
          new THREE.MeshBasicMaterial({ color: 0x0b0f16, transparent: true, opacity: 0.85, depthTest: false }),
        );
        const barFill = new THREE.Mesh(
          new THREE.PlaneGeometry(hpBarWidth - 4, hpBarHeight - 4),
          new THREE.MeshBasicMaterial({ color: 0x46d39a, depthTest: false }),
        );
        barFill.position.z = 0.01;
        const label = this._makeNameSprite(unit.data?.name || unit.name || "?");
        label.position.y = hpBarHeight + 8;
        plate.add(barBg, barFill, label);
        plate.renderOrder = 999;
        this.scene.add(plate);

        this.scene.add(model.root);
        view = { model, blob, plate, barFill, barBg, label, facing: 0 };
        this.unitViews.set(unit.id, view);
      }
      view.model.root.position.set(unit.x || 0, 0, unit.y || 0);
      const fx = unit.facing?.x || 1;
      const fy = unit.facing?.y || 0;
      const want = Math.atan2(fx, fy);
      let diff = want - view.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      view.facing += diff * 0.25;
      view.model.root.rotation.y = view.facing;

      const pct = Math.max(0, Math.min(1, unit.hp / Math.max(unit.maxHp, 1)));
      const arenaSettings = config?.state?.arenaSettings || DEFAULTS.arenaSettings;
      const hpBarWidth = arenaSettings.hpBarWidth || 80;
      const useHudColor = arenaSettings.hpBarUseHudColor !== false;
      
      view.barFill.scale.x = Math.max(0.001, pct);
      view.barFill.position.x = -(hpBarWidth / 2 - 2) * (1 - pct);
      if (useHudColor) {
        view.barFill.material.color.set(pct > 0.4 ? 0x46d39a : (pct > 0.25 ? 0xffb454 : 0xff5f6d));
      }
      view.plate.visible = unit.alive;
      if (view.plate.visible && this.camera) {
        view.plate.position.set(unit.x, 215, unit.y);
        try {
          view.plate.quaternion.copy(this.camera.quaternion);
        } catch (e) {}
      }

      animateModel(view.model, unit, this.dt || 0.016, this.worldTime || 0);
      view.blob.visible = unit.alive;
    }

    for (const [id, view] of this.unitViews) {
      if (!seen.has(id)) {
        try {
          this.scene.remove(view.model.root);
          if (view.plate) this.scene.remove(view.plate);
        } catch (e) {}
        this.unitViews.delete(id);
      }
    }
  }

  ensureRing(key, color, opacity = 0.18) {
    if (!this.rings) this.rings = new Map();
    let ring = this.rings.get(key);
    if (!ring) {
      // Thinner ring (0.975 to 1.025 = 5% of radius)
      ring = new THREE.Mesh(
        new THREE.RingGeometry(0.975, 1.025, 64),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity,
          side: THREE.DoubleSide,
          depthWrite: false,
          depthTest: true,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 3; // Above ground
      ring.renderOrder = 100; // Render on top
      if (this.scene) this.scene.add(ring);
      this.rings.set(key, ring);
    } else {
      if (ring.material) {
        ring.material.color.set(color);
        ring.material.opacity = opacity;
      }
      ring.position.y = 3;
    }
    return ring;
  }

  _makeNameSprite(text, color = "#ffffff") {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = '700 40px "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = 7;
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color || "#e6ecf5";
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.scale.set(86, 22, 1);
    return sprite;
  }

  _makeTextSprite(text, color = "#ffffff") {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.font = '700 40px "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = 7;
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = color || "#e6ecf5";
    ctx.fillText(text, 128, 32);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.scale.set(86, 22, 1);
    return sprite;
  }

  drawRanges(world, player, showRanges, attackMoveActive = false, opts = {}) {
    if (!this.rings) this.rings = new Map();
    for (const ring of this.rings.values()) {
      try { ring.visible = false; } catch {}
    }

    // Player range ring (blue) - only when showRanges is on
    if (player && player.alive && showRanges) {
      const own = this.ensureRing("player-attack-range", 0x4ea1ff, 0.45);
      own.visible = true;
      own.scale.setScalar(player.attackRange || 550);
      own.position.set(player.x || 0, 3, player.y || 0);
    }

    // Attack-move indicator (orange filled circle) - always follows player, visibility controlled by A key
    if (player && player.alive) {
      if (!this.attackMoveMesh) {
        const geo = new THREE.CircleGeometry(player.attackRange || 550, 64);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffb454,
          transparent: true,
          opacity: 0.35,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        this.attackMoveMesh = new THREE.Mesh(geo, mat);
        this.attackMoveMesh.rotation.x = -Math.PI / 2;
        this.attackMoveMesh.position.y = 1.5;
        this.scene.add(this.attackMoveMesh);
      }
      // Always follow player
      this.attackMoveMesh.position.set(player.x || 0, 1.5, player.y || 0);
      // Visible only when A held AND not consumed by click
      const consumedClick = opts.input?.consumedAttackMove;
      this.attackMoveMesh.visible = attackMoveActive && !consumedClick;
    }

    // Reset the consumed flag after using it
    if (opts.input) {
      opts.input.consumedAttackMove = false;
    }

    // Telegraph rings: units exposing telegraphProgress in [0,1] draw a persistent
    // ring that lerps green -> amber -> red as their next attack approaches.
    for (const unit of world.living("enemy")) {
      if (typeof unit.telegraphProgress !== "number") continue;
      const p = Math.max(0, Math.min(1, unit.telegraphProgress));
      const c = new THREE.Color(0x46d39a);
      if (p < 0.35) c.lerp(new THREE.Color(0xffd166), p / 0.35);
      else c.lerp(new THREE.Color(0xff5f6d), Math.min(1, (p - 0.35) / 0.45));
      // flash bright red earlier (from unit.telegraphFlashAt, default 55% progress)
      let opacity = 0.35;
      const flashAt = typeof unit.telegraphFlashAt === "number" ? unit.telegraphFlashAt : 0.55;
      if (p >= flashAt && Math.floor((this.worldTime || 0) * 8) % 2 === 0) {
        c.set(0xff2d43);
        opacity = 0.75;
      }
      const ring = this.ensureRing(`telegraph-${unit.id}`, c.getHex(), opacity);
      ring.visible = true;
      ring.scale.setScalar((unit.radius || 40) + 18 + p * 14);
      ring.position.set(unit.x, 3, unit.y);
    }

    if (!showRanges) return;

    for (const enemy of world.living("enemy")) {
      if (!enemy.attackRange) continue;
      if (typeof enemy.telegraphProgress === "number") {
        // dummy de telegráfico: sem anel de range duplicado
        this.ensureRing(`enemy-${enemy.id}`, 0x000000, 0).visible = false;
        continue;
      }
      const safe = player.attackRange > enemy.attackRange + 40;
      const ring = this.ensureRing(`enemy-${enemy.id}`, safe ? 0x46d39a : 0xff5f6d, 0.16);
      ring.visible = true;
      ring.scale.setScalar(enemy.attackRange);
      ring.position.set(enemy.x, 3, enemy.y);
    }
  }

  syncSkillshots(world) {
    const seen = new Set();
    for (const shot of world.skillshots) {
      seen.add(shot.id ?? shot);
      const key = shot.id ?? shot;
      let view = this.shotViews.get(key);
      if (!view) {
        const mat = new THREE.MeshBasicMaterial({
          color: shot.team === "enemy" ? 0xff5566 : 0x7fc8ff,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 4;
        const edgeMat = new THREE.MeshBasicMaterial({
          color: shot.team === "enemy" ? 0xff8894 : 0xa8dcff,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const edge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), edgeMat);
        edge.rotation.x = -Math.PI / 2;
        edge.position.y = 5;
        this.scene.add(mesh, edge);
        view = { mesh, edge, mat, edgeMat };
        this.shotViews.set(key, view);
      }

      const hostile = shot.team === "enemy";
      view.mat.color.set(hostile ? 0xff5566 : 0x7fc8ff);
      view.edgeMat.color.set(hostile ? 0xff8894 : 0xa8dcff);

      if (shot.kind === "linear") {
        const len = Math.max(40, shot.traveled);
        const angle = Math.atan2(shot.dirX, shot.dirY);
        view.mesh.visible = true;
        view.mesh.scale.set(shot.width * 2, len, 1);
        view.mesh.position.set(
          shot.x + shot.dirX * (shot.traveled / 2),
          4,
          shot.y + shot.dirY * (shot.traveled / 2),
        );
        view.mesh.rotation.set(-Math.PI / 2, 0, -angle);
        view.edge.visible = true;
        view.edge.scale.set(shot.width * 2, 14, 1);
        view.edge.position.set(shot.headX, 5, shot.headY);
        view.edge.rotation.set(-Math.PI / 2, 0, -angle);
        if (shot.phase === "telegraph") {
          view.mat.opacity = 0.12;
        } else {
          view.mat.opacity = 0.26;
        }
      } else if (shot.kind === "circle") {
        view.mesh.visible = true;
        view.edge.visible = false;
        view.mesh.geometry.dispose();
        view.mesh.geometry = new THREE.CircleGeometry(shot.radius, 48);
        view.mesh.position.set(shot.x, 4, shot.y);
        const t = shot.phase === "telegraph"
          ? Math.min(1, shot.elapsed / Math.max(shot.castTime, 0.01))
          : 1;
        view.mat.opacity = 0.1 + t * 0.16;
      } else {
        view.mesh.visible = true;
        view.edge.visible = false;
        view.mesh.geometry.dispose();
        view.mesh.geometry = new THREE.CircleGeometry(shot.length, 32, -Math.PI / 2, Math.PI / 3);
        view.mesh.position.set(shot.x, 4, shot.y);
        view.mesh.rotation.set(-Math.PI / 2, 0, Math.atan2(shot.dirX, shot.dirY) - Math.PI / 2);
        view.mat.opacity = 0.18;
      }
    }

    for (const [key, view] of this.shotViews) {
      if (!seen.has(key)) {
        this.scene.remove(view.mesh, view.edge);
        view.mesh.geometry.dispose();
        view.mat.dispose();
        this.shotViews.delete(key);
      }
    }
  }

  syncProjectiles(world) {
    const seen = new Set();
    for (const proj of world.projectiles) {
      seen.add(proj);
      let view = this.projectileViews.get(proj);
      if (!view) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(9, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd98a }),
        );
        const glow = new THREE.Mesh(
          new THREE.SphereGeometry(17, 10, 8),
          new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.25 }),
        );
        mesh.add(glow);
        this.scene.add(mesh);
        view = { mesh };
        this.projectileViews.set(proj, view);
      }
      view.mesh.position.set(proj.x, 90, proj.y);
    }
    for (const [key, view] of this.projectileViews) {
      if (!seen.has(key)) {
        this.scene.remove(view.mesh);
        this.projectileViews.delete(key);
      }
    }
  }

  syncEffects(world) {
    const seen = new Set();
    for (const effect of world.effects) {
      if (effect.kind !== "text") continue;
      const key = `${effect.x.toFixed(0)}:${effect.y.toFixed(0)}:${effect.text}:${effect.life.toFixed(2)}`;
      seen.add(key);
      if (!this.effects.some((e) => e.key === key)) {
        const sprite = this._makeTextSprite(effect.text, effect.color);
        sprite.position.set(effect.x, 150, effect.y);
        this.scene.add(sprite);
        this.effects.push({ key, sprite, life: 0, maxLife: effect.maxLife });
      }
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.life += this.dt || 0.016;
      const t = e.life / e.maxLife;
      e.sprite.position.y = 150 + t * 70;
      e.sprite.material.opacity = 1 - t * t;
      if (e.life >= e.maxLife) {
        this.scene.remove(e.sprite);
        e.sprite.material.map.dispose();
        e.sprite.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  syncPowerups(powerups) {
    if (!powerups || !Array.isArray(powerups) || !powerups.length) {
      for (const [, view] of this.powerupViews) {
        try {
          if (view.ring) { this.scene.remove(view.ring); view.ring.geometry?.dispose(); view.ring.material?.dispose(); }
          if (view.inner) { this.scene.remove(view.inner); view.inner.geometry?.dispose(); view.inner.material?.dispose(); }
          if (view.iconSprite) { this.scene.remove(view.iconSprite); view.iconSprite.material?.map?.dispose(); view.iconSprite.material?.dispose(); }
          if (view.mesh) { this.scene.remove(view.mesh); view.mesh.geometry?.dispose(); view.mesh.material?.dispose(); }
        } catch {}
      }
      this.powerupViews.clear();
      return;
    }

    const seen = new Set();
    for (const pu of powerups) {
      if (!pu) continue;
      const key = `${Math.round(pu.x || 0)}:${Math.round(pu.y || 0)}:${pu.id}`;
      seen.add(key);
      let view = this.powerupViews.get(key);
      if (!view) {
        const ringGeo = new THREE.RingGeometry(25, 35, 32);
        const mat = new THREE.MeshBasicMaterial({
          color: pu.color,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const ring = new THREE.Mesh(ringGeo, mat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(pu.x, 8, pu.y);
        this.scene.add(ring);

        const innerGeo = new THREE.RingGeometry(15, 22, 32);
        const innerMat = new THREE.MeshBasicMaterial({
          color: pu.color,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthWrite: false,
        });
        const inner = new THREE.Mesh(innerGeo, innerMat);
        inner.rotation.x = -Math.PI / 2;
        inner.position.set(pu.x, 9, pu.y);
        this.scene.add(inner);

        const iconCanvas = document.createElement("canvas");
        iconCanvas.width = 128;
        iconCanvas.height = 128;
        const ictx = iconCanvas.getContext("2d");
        ictx.font = "bold 80px Arial";
        ictx.textAlign = "center";
        ictx.textBaseline = "middle";
        ictx.fillStyle = "#fff";
        ictx.shadowColor = "#000";
        ictx.shadowBlur = 8;
        ictx.fillText(pu.icon, 64, 72);
        const iconTexture = new THREE.CanvasTexture(iconCanvas);
        iconTexture.colorSpace = THREE.SRGBColorSpace;
        const iconSprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: iconTexture, transparent: true, depthTest: false })
        );
        iconSprite.scale.set(50, 50, 1);
        iconSprite.position.set(pu.x, 45, pu.y);
        this.scene.add(iconSprite);

        view = { ring, inner, iconSprite, mat, innerMat };
        this.powerupViews.set(key, view);
      }

      const time = this.worldTime || 0;
      if (view.ring) {
        view.ring.position.set(pu.x || 0, 8 + Math.sin(time * 3) * 3, pu.y || 0);
        view.ring.rotation.z += 0.02;
        view.ring.scale.setScalar(1 + Math.sin(time * 4) * 0.1);
      }
      if (view.inner) {
        view.inner.position.set(pu.x || 0, 9 + Math.sin(time * 3 + 0.5) * 2, pu.y || 0);
        view.inner.rotation.z -= 0.03;
        view.inner.scale.setScalar(1 + Math.cos(time * 4) * 0.15);
      }
      if (view.iconSprite) view.iconSprite.position.set(pu.x || 0, 55 + Math.sin(time * 2) * 5, pu.y || 0);
    }

    for (const [key, view] of this.powerupViews) {
      if (!seen.has(key)) {
        try {
          if (view.ring) {
            this.scene.remove(view.ring);
            view.ring.geometry?.dispose();
            view.ring.material?.dispose();
          }
          if (view.inner) {
            this.scene.remove(view.inner);
            view.inner.geometry?.dispose();
            view.inner.material?.dispose();
          }
          if (view.iconSprite) {
            this.scene.remove(view.iconSprite);
            view.iconSprite.material?.map?.dispose(); view.iconSprite.material?.dispose();
          }
          if (view.mesh) {
            this.scene.remove(view.mesh);
            view.mesh.geometry?.dispose(); view.mesh.material?.dispose();
          }
        } catch {}
        this.powerupViews.delete(key);
      }
    }
  }

  render(world, opts = {}) {
    const dt = opts.dt ?? 0.016;
    this.dt = dt;
    this.worldTime = world.time;

    // Consume zoom delta from input (mouse wheel)
    const input = opts.input;
    if (input && typeof input.consumeZoomDelta === "function") {
      const zoomDelta = input.consumeZoomDelta();
      if (zoomDelta !== 0) {
        this.zoom = Math.max(0.5, Math.min(1.5, this.zoom + zoomDelta));
      }
    }

    this.syncUnits(world);
    this.drawRanges(world, opts.player, opts.showRanges !== false, opts.attackMoveActive, opts);
    this.syncSkillshots(world);
    this.syncProjectiles(world);
    this.syncEffects(world);
    this.syncPowerups(opts.powerups);
    this.setFocusTarget(opts.focusTarget);
    this.updateCamera(opts.player, dt);

    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.life += dt;
      const t = m.life / m.maxLife;
      m.mesh.scale.setScalar(1 + t * 1.6);
      m.mesh.material.opacity = 0.85 * (1 - t);
      if (m.life >= m.maxLife) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        m.mesh.material.dispose();
        this.markers.splice(i, 1);
      }
    }

    try { this.renderer.render(this.scene, this.camera); } catch (e) { console.error("WebGL render error", e, e.stack); }
  }

  showMoveMarker(x, y, color = 0x4ea1ff) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(20, 30, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 6, y);
    this.scene.add(mesh);
    this.markers.push({ mesh, life: 0, maxLife: 0.45 });
  }

  setFocusTarget(unit) {
    if (!this.focus) {
      this.focus = new THREE.Mesh(
        new THREE.RingGeometry(60, 70, 40),
        new THREE.MeshBasicMaterial({
          color: 0x46d39a, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      this.focus.rotation.x = -Math.PI / 2;
      this.focus.position.y = 5;
      this.scene.add(this.focus);
    }
    this.focus.visible = Boolean(unit);
    if (unit) this.focus.position.set(unit.x, 5, unit.y);
  }

  updateCamera(player, dt, edgeScroll = null) {
    if (!player || !this.camera || !this.cameraFocus) return;
    const arena = this.arena || { x: 0, y: 0, w: 3200, h: 1900 };

    if (edgeScroll) {
      const speed = 2200 * dt;
      this.cameraFocus.x += edgeScroll.x * speed;
      this.cameraFocus.z += edgeScroll.y * speed;

      this.cameraFocus.x = Math.max(arena.x + 120, Math.min(arena.x + arena.w - 120, this.cameraFocus.x));
      this.cameraFocus.z = Math.max(arena.y + 120, Math.min(arena.y + arena.h - 120, this.cameraFocus.z));
    } else {
      const focusX = player.x;
      const focusZ = player.y;
      const clampX = Math.max(arena.x + 120, Math.min(arena.x + arena.w - 120, focusX));
      const clampZ = Math.max(arena.y + 120, Math.min(arena.y + arena.h - 120, focusZ));
      this.focusTarget.set(clampX, 0, clampZ);
      const k = 1 - Math.pow(0.0015, dt);
      this.cameraFocus.lerp(this.focusTarget, k);
    }

    const zoom = this.zoom || 1;
    const distance = this.cameraDistance / zoom;

    const pitchRad = THREE.MathUtils.degToRad(this.cameraPitch);
    const height = distance * Math.tan(pitchRad);

    this.camera.position.set(
      this.cameraFocus.x,
      height,
      this.cameraFocus.z + distance,
    );
    this.camera.lookAt(this.cameraFocus.x, 0, this.cameraFocus.z);
  }

  setCameraConfig({ zoom = 1, fov = 42, distance = 850, pitch = 30 } = {}) {
    this.zoom = zoom > 0 ? zoom : 1;
    this.cameraDistance = distance > 0 ? distance : 850;
    this.cameraPitch = pitch > 0 ? pitch : 30;
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}