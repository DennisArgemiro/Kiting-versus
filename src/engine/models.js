import * as THREE from "../../vendor/three.module.js";

/**
 * Procedural low-poly champion models.
 *
 * Riot's own champion meshes are proprietary, so the models here are built
 * from primitives: a stylised humanoid whose proportions, colours and weapon
 * silhouette identify the champion at a glance.
 *
 * Units are League of Legends units: a champion is ~180 tall with a 65
 * gameplay radius.
 */

const HEIGHT = 180;

// Champion colour schemes (primary, secondary, accent).
const PALETTES = {
  Ezreal: ["#2f6fd0", "#f2c14e", "#1b3f7a"],
  Caitlyn: ["#7b4fbf", "#c9a227", "#2c1b4d"],
  Ashe: ["#3f7a4e", "#2f5fa8", "#1d3b28"],
  Jinx: ["#2f8fd0", "#e0518a", "#123a5c"],
  Kaisa: ["#8b4fc9", "#3fc9b0", "#3a1a55"],
  Lucian: ["#c9a227", "#6b4a2f", "#3d2c17"],
  MissFortune: ["#c93f3f", "#6b4a2f", "#5c1a1a"],
  Tristana: ["#2f8fd0", "#4fbf6b", "#123a5c"],
  Vayne: ["#7b4fbf", "#3f6fd0", "#2c1b4d"],
  Varus: ["#8b4fc9", "#c9a227", "#3a1a55"],
  Xayah: ["#8b3fc9", "#c93f6b", "#3a1a55"],
  Aphelios: ["#d9dde5", "#c9a227", "#6a6f7a"],
  Ahri: ["#e8e2f0", "#e0518a", "#9c7fb5"],
  Morgana: ["#6b3fa8", "#2b1b4d", "#1a1030"],
  Lux: ["#e0b83f", "#3f7ad0", "#6a5418"],
  Brand: ["#c93f3f", "#2b1b1b", "#6a1a1a"],
  Thresh: ["#4fbf8a", "#1f2b2b", "#123c2c"],
  Nautilus: ["#2f4f8f", "#c9a227", "#16294d"],
  Blitzcrank: ["#3f8fd0", "#c9a227", "#1a3a5c"],
  Ekko: ["#3fc9b0", "#e0518a", "#1a4d45"],
  Annie: ["#c93f4f", "#e0b83f", "#5c1a25"],
  Zed: ["#3a3a45", "#c93f3f", "#17171d"],
  Syndra: ["#8b4fc9", "#3f7ad0", "#3a1a55"],
  Velkoz: ["#3fc9c9", "#e07a3f", "#1a4d4d"],
};

// Which silhouette each champion carries.
const ARCHETYPES = {
  Ezreal: "gun", Caitlyn: "gun", Jinx: "gun", Lucian: "gun",
  MissFortune: "gun", Tristana: "gun", Aphelios: "gun",
  Ashe: "bow", Varus: "bow", Kaisa: "bow", Xayah: "bow",
  Ahri: "staff", Lux: "staff", Morgana: "staff", Brand: "staff",
  Syndra: "staff", Annie: "staff", Velkoz: "staff",
  Thresh: "scythe", Nautilus: "hammer", Blitzcrank: "gauntlet",
  Ekko: "bat", Zed: "blade", Vayne: "crossbow",
};

function paletteFor(alias) {
  return PALETTES[alias] || ["#5b6b80", "#93a3b8", "#2a3340"];
}

function archetypeFor(alias) {
  return ARCHETYPES[alias] || "staff";
}

function material(hex, opts = {}) {
  return new THREE.MeshLambertMaterial({
    color: new THREE.Color(hex),
    flatShading: true,
    ...opts,
  });
}

/** Lightens a colour towards white so dark parts still read on a dark floor. */
function shade(hex, amount) {
  const color = new THREE.Color(hex);
  color.lerp(new THREE.Color(0xffffff), amount);
  return `#${color.getHexString()}`;
}

/**
 * Builds a champion model.
 * Returns { root, parts } where root is the object to add to the scene.
 */
export function buildChampionModel(champion) {
  const alias = champion.alias || champion.name || "?";
  const [primary, secondary, accent] = paletteFor(alias);
  const archetype = archetypeFor(alias);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const skin = material("#e8c39a");
  const cloth = material(primary);
  const trim = material(secondary);
  const dark = material(shade(accent, 0.22));
  const metal = material("#c9d2dd");

  // ── legs ──────────────────────────────────────────────────────────
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  for (const [group, sign] of [[legL, -1], [legR, 1]]) {
    group.position.set(sign * 15, 78, 0);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(22, 42, 24), dark);
    thigh.position.y = -21;
    const shin = new THREE.Mesh(new THREE.BoxGeometry(19, 40, 21), dark);
    shin.position.y = -58;
    const boot = new THREE.Mesh(new THREE.BoxGeometry(22, 12, 32), trim);
    boot.position.set(0, -74, 4);
    group.add(thigh, shin, boot);
    body.add(group);
  }

  // ── torso ─────────────────────────────────────────────────────────
  const torso = new THREE.Group();
  torso.position.y = 78;
  const hips = new THREE.Mesh(new THREE.BoxGeometry(40, 22, 26), dark);
  hips.position.y = 4;
  const chest = new THREE.Mesh(new THREE.BoxGeometry(46, 50, 28), cloth);
  chest.position.y = 38;
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(58, 11, 26), trim);
  shoulder.position.y = 60;
  const belt = new THREE.Mesh(new THREE.BoxGeometry(42, 10, 28), trim);
  belt.position.y = 16;
  torso.add(hips, chest, shoulder, belt);
  body.add(torso);

  // ── head ──────────────────────────────────────────────────────────
  const head = new THREE.Group();
  head.position.y = 63;
  const neck = new THREE.Mesh(new THREE.BoxGeometry(12, 6, 12), skin);
  neck.position.y = 2;
  const skull = new THREE.Mesh(new THREE.BoxGeometry(25, 22, 23), skin);
  skull.position.y = 18;
  const hair = new THREE.Mesh(new THREE.BoxGeometry(27, 8, 25), trim);
  hair.position.y = 27;
  head.add(neck, skull, hair);
  torso.add(head);

  // ── arms ──────────────────────────────────────────────────────────
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  for (const [group, sign] of [[armL, -1], [armR, 1]]) {
    group.position.set(sign * 29, 57, 0);
    const upper = new THREE.Mesh(new THREE.BoxGeometry(14, 32, 16), cloth);
    upper.position.y = -16;
    const fore = new THREE.Mesh(new THREE.BoxGeometry(12, 30, 14), skin);
    fore.position.y = -44;
    group.add(upper, fore);
    torso.add(group);
  }

  // ── weapon ────────────────────────────────────────────────────────
  const weapon = new THREE.Group();
  weapon.position.set(0, -50, 0);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 58), metal);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(10, 16, 12), dark);
  grip.position.set(0, -10, -8);
  weapon.add(barrel, grip);
  armR.add(weapon);

  switch (archetype) {
    case "gun": {
      weapon.position.set(0, -46, 4);
      weapon.rotation.x = -Math.PI / 2;
      break;
    }
    case "bow": {
      weapon.position.set(0, -42, 10);
      weapon.rotation.set(Math.PI / 2, 0, 0);
      const bow = new THREE.Mesh(new THREE.TorusGeometry(26, 3.5, 6, 16, Math.PI), trim);
      bow.rotation.z = Math.PI / 2;
      weapon.add(bow);
      break;
    }
    case "staff": {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 120, 8), dark);
      shaft.position.y = 10;
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(12, 0), trim);
      orb.position.y = 72;
      weapon.add(shaft, orb);
      weapon.position.set(0, -30, 6);
      weapon.rotation.x = -0.25;
      break;
    }
    case "blade": {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(7, 78, 16), metal);
      blade.position.set(0, 26, 4);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(22, 7, 22), trim);
      weapon.add(blade, guard);
      break;
    }
    case "scythe": {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 130, 8), dark);
      shaft.position.y = 20;
      const curve = new THREE.Mesh(new THREE.TorusGeometry(26, 4, 6, 14, Math.PI / 1.6), trim);
      curve.position.set(0, 82, 10);
      curve.rotation.z = -0.5;
      weapon.add(shaft, curve);
      break;
    }
    case "hammer": {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 110, 8), dark);
      shaft.position.y = 18;
      const head = new THREE.Mesh(new THREE.BoxGeometry(42, 34, 34), metal);
      head.position.y = 82;
      weapon.add(shaft, head);
      break;
    }
    case "gauntlet": {
      const fist = new THREE.Mesh(new THREE.BoxGeometry(26, 26, 30), metal);
      fist.position.set(0, -6, 6);
      weapon.add(fist);
      break;
    }
    case "bat": {
      const club = new THREE.Mesh(new THREE.CylinderGeometry(5, 11, 78, 8), trim);
      club.position.set(0, 22, 6);
      club.rotation.x = 0.4;
      weapon.add(club);
      break;
    }
    case "crossbow": {
      const bow = new THREE.Mesh(new THREE.TorusGeometry(22, 3, 6, 14, Math.PI), trim);
      bow.rotation.z = Math.PI / 2;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(8, 46, 10), dark);
      stock.position.z = -6;
      weapon.add(bow, stock);
      break;
    }
  }

  root.traverse((node) => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = false;
    }
  });

  return {
    root,
    parts: { body, torso, head, armL, armR, legL, legR, weapon },
    archetype,
    phase: Math.random() * Math.PI * 2,
  };
}

/**
 * Drives the procedural animation.
 *
 * `unit` provides the simulation state:
 *   moving      0..1 share of max speed
 *   casting     remaining windup seconds
 *   attackCast  full windup length
 *   alive
 */
export function animateModel(model, unit, dt, now) {
  const { parts } = model;
  const speed = unit.moving || 0;
  model.phase += dt * (4 + speed * 9);

  const swing = Math.sin(model.phase);
  const bob = Math.sin(model.phase * 2) * (1.5 + speed * 3);

  // Walk cycle.
  const stride = 0.55 * speed;
  parts.legL.rotation.x = swing * stride;
  parts.legR.rotation.x = -swing * stride;
  parts.armL.rotation.x = -swing * stride * 0.7;
  parts.armR.rotation.x = swing * stride * 0.7;

  // Idle / walk body motion.
  parts.body.position.y = bob;
  parts.torso.rotation.z = swing * 0.04 * speed;

  // Attack swing: wind back, strike through, recover.
  if (unit.casting > 0 && unit.attackCast > 0) {
    const t = 1 - unit.casting / unit.attackCast; // 0 -> 1 through the windup
    const strike = Math.sin(Math.min(1, t * 1.6) * Math.PI);
    parts.armR.rotation.x = -1.5 * strike;
    parts.torso.rotation.y = -0.7 * strike;
  } else {
    parts.armR.rotation.x *= 0.6;
    parts.torso.rotation.y *= 0.6;
  }

  // Death: topple over. Respawning brings the rig back upright.
  if (!unit.alive) {
    parts.body.rotation.x = Math.min(Math.PI / 2, (parts.body.rotation.x || 0) + dt * 4);
    parts.body.position.y = -20;
  } else if (parts.body.rotation.x) {
    parts.body.rotation.x = Math.max(0, parts.body.rotation.x - dt * 4);
    parts.body.position.y = 0;
  }
}
