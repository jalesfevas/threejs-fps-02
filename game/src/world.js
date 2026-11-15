// The map: Kiln Yard, a ceramics yard at dusk. A 60 x 40 m outer wall, two long lanes
// (Kiln Lane past the kiln in the north-west, Dock Lane along stacked crates in the
// east) joined by a mid courtyard with a raised platform. Every mesh is a box or a
// cylinder, every solid box/cylinder is an AABB collider. Also owns the lights, the fog
// and the scene background, and exports the named spawns and the two bomb-site zones.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createWorld(scene) {
  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 28, 105);

  // --- Procedural surface detail (canvas textures, runtime-only, no network) -------------
  // Deterministic PRNG so every build bakes identical noise.
  function texRandom(seed) {
    let a = seed;
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function surfaceCanvas(name, seed, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[name];
    ctx.fillRect(0, 0, 128, 128);
    draw(ctx, texRandom(seed));
    return canvas;
  }

  // Grainy speckle over the whole tile: cheap concrete/plaster variation.
  function speckle(ctx, random, count, alpha) {
    for (let i = 0; i < count; i += 1) {
      const light = random() > 0.5;
      ctx.fillStyle = `rgba(${light ? '255,250,238' : '20,14,10'},${(alpha * random()).toFixed(3)})`;
      ctx.fillRect(random() * 128, random() * 128, 1 + random() * 2, 1 + random() * 2);
    }
  }

  // Fired-brick courses: darker mortar lines every 16 px, alternating row offsets.
  function brickCourses(ctx, random) {
    ctx.fillStyle = 'rgba(30,16,12,0.55)';
    for (let y = 0; y < 128; y += 16) {
      ctx.fillRect(0, y, 128, 2);
      const shift = (y / 16) % 2 ? 16 : 0;
      for (let x = shift; x < 128; x += 32) ctx.fillRect(x, y, 2, 16);
    }
    speckle(ctx, random, 220, 0.16);
  }

  // Wood grain for the crates: long horizontal streaks plus knots.
  function woodGrain(ctx, random) {
    for (let i = 0; i < 46; i += 1) {
      const y = random() * 128;
      const dark = random() > 0.5;
      ctx.strokeStyle = `rgba(${dark ? '52,32,16' : '230,200,150'},${(0.10 + random() * 0.20).toFixed(3)})`;
      ctx.lineWidth = 1 + random() * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(40, y + (random() - 0.5) * 10, 90, y + (random() - 0.5) * 10, 128, y + (random() - 0.5) * 6);
      ctx.stroke();
    }
    speckle(ctx, random, 90, 0.12);
  }

  const SURFACES = {
    sand: { repeat: [10, 7], draw: (ctx, random) => speckle(ctx, random, 420, 0.18) },
    brick: { repeat: [4, 2], draw: brickCourses },
    slate: { repeat: [3, 3], draw: (ctx, random) => speckle(ctx, random, 300, 0.15) },
    crate: { repeat: [1, 1], draw: woodGrain },
    terracotta: { repeat: [3, 2], draw: (ctx, random) => speckle(ctx, random, 260, 0.14) },
  };

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    const params = { roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92, metalness: 0.03 };
    const surface = SURFACES[name];
    if (surface) {
      const texture = new THREE.CanvasTexture(surfaceCanvas(name, 0x9e37 + name.length * 7919, surface.draw));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      texture.repeat.set(surface.repeat[0], surface.repeat[1]);
      params.map = texture;
      params.color = 0xffffff; // the texture already carries the palette colour
    } else {
      params.color = new THREE.Color(PALETTE[name]);
    }
    materials[name] = new THREE.MeshStandardMaterial(params);
  }

  const group = new THREE.Group();
  scene.add(group);

  const colliders = [];
  const shootables = [];

  // Slightly varied crate materials: three clones of the wood texture with small lightness
  // offsets, picked round-robin so stacked crates do not read as one flat colour.
  const crateVariants = [-0.05, 0, 0.05].map((shift) => {
    const variant = materials.crate.clone();
    variant.color = new THREE.Color(1 + shift, 1 + shift, 1 + shift);
    return variant;
  });
  let crateVariantIndex = 0;

  function box(width, height, depth, x, y, z, materialName) {
    let material = materials[materialName];
    if (materialName === 'crate') {
      material = crateVariants[crateVariantIndex % crateVariants.length];
      crateVariantIndex += 1;
    }
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // A painted site marker: flat, walkable-over, still a surface a bullet stops on.
  function sitePad(x, z, size) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 0.08, size), materials.ochre);
    mesh.position.set(x, 0.04, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  // Ground and the outer wall rectangle (60 m east-west, 40 m north-south, north = -z).
  box(61, 0.5, 41, 0, -0.25, 0, 'sand');
  box(61, 4.5, 1, 0, 2.25, -20.5, 'brick');
  box(61, 4.5, 1, 0, 2.25, 20.5, 'brick');
  box(1, 4.5, 41, -30.5, 2.25, 0, 'brick');
  box(1, 4.5, 41, 30.5, 2.25, 0, 'brick');

  // Lane dividers at x = -10 and x = 10, each with two gaps (mid entrances at z ~ -5..4).
  box(1, 3.6, 12, -10, 1.8, -14, 'brick');
  box(1, 3.6, 14, -10, 1.8, 11, 'brick');
  box(1, 3.6, 12, 10, 1.8, -14, 'brick');
  box(1, 3.6, 14, 10, 1.8, 11, 'brick');

  // The kiln: site A's landmark in the north-west, a big cylinder with a chimney box.
  const kiln = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.9, 6, 24), materials.terracotta);
  kiln.position.set(-21, 3, -13);
  kiln.castShadow = true;
  kiln.receiveShadow = true;
  group.add(kiln);
  shootables.push(kiln);
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-24.9, 0, -16.9),
    new THREE.Vector3(-17.1, 6, -9.1),
  ));
  box(1.4, 2.6, 1.4, -24.2, 7.2, -16.2, 'brick'); // chimney shoulder

  // Mid courtyard: raised slate platform, 1.2 m up, with three 0.4 m steps on the south side.
  box(9, 1.2, 7, 0, 0.6, 0, 'slate');
  box(3, 0.8, 1.0, 0, 0.4, 3.9, 'slate');
  box(3, 0.4, 1.0, 0, 0.2, 4.9, 'slate');

  // Courtyard cover: two low walls to fight over.
  box(3, 1.1, 1.2, -6, 0.55, 8, 'hairline');
  box(3, 1.1, 1.2, 6, 0.55, -8, 'hairline');

  // Dock Lane (east): a low dock platform carrying site B, crates stacked around it.
  box(6, 0.8, 10, 25, 0.4, -8, 'slate');
  sitePad(25, -8, 5);
  box(1.7, 1.7, 1.7, 19.6, 0.85, -8, 'crate');
  box(1.7, 1.7, 1.7, 19.6, 2.55, -8, 'crate');
  box(1.7, 1.7, 1.7, 19.6, 0.85, -6.1, 'crate');
  box(1.7, 1.7, 1.7, 21.5, 0.85, -2, 'crate');
  box(1.7, 1.7, 1.7, 14.5, 0.85, -14, 'crate');
  box(1.7, 1.7, 1.7, 14.5, 0.85, -12.1, 'crate');
  box(1.7, 1.7, 1.7, 14.5, 2.55, -13, 'crate');
  box(1.7, 1.7, 1.7, 26, 0.85, 3, 'crate');
  box(1.7, 1.7, 1.7, 16, 0.85, 5, 'crate');
  box(1.7, 1.7, 1.7, 16, 0.85, 6.9, 'crate');

  // Kiln Lane (west): crates scattered from spawn to site A.
  sitePad(-21, -13, 6);
  box(1.7, 1.7, 1.7, -15.5, 0.85, -3, 'crate');
  box(1.7, 1.7, 1.7, -15.5, 0.85, -1.1, 'crate');
  box(1.7, 1.7, 1.7, -26, 0.85, -4, 'crate');
  box(1.7, 1.7, 1.7, -14, 0.85, 8, 'crate');
  box(1.7, 1.7, 1.7, -14, 2.55, 8, 'crate');
  box(1.7, 1.7, 1.7, -24, 0.85, 12, 'crate');

  // Light: one hemisphere (dusk sky over warm ground) and one low western sun casting the
  // map's only shadows, with an ortho frustum covering the full 60 x 40 yard.
  const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.brick), 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 1.7);
  sun.position.set(-34, 16, 10);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 35;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 100;
  sun.shadow.bias = -0.0004;
  scene.add(sun, sun.target);

  // Gradient dusk sky: one big inverted sphere, vertical gradient baked into a 1 x 256
  // canvas (zenith blue-violet down to the fog-coloured horizon). fog=false so distance
  // haze never washes the sky out.
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 1;
  skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const gradient = skyCtx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, '#2a2333');
  gradient.addColorStop(0.42, '#b07050');
  gradient.addColorStop(0.55, PALETTE.sky);
  gradient.addColorStop(0.72, '#8a5a40');
  skyCtx.fillStyle = gradient;
  skyCtx.fillRect(0, 0, 1, 256);
  const skyTexture = new THREE.CanvasTexture(skyCanvas);
  skyTexture.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  scene.add(sky);

  const spawns = {
    attackers: [
      { name: 'attack-south-west', position: new THREE.Vector3(-16, 0, 17.5) },
      { name: 'attack-south-mid', position: new THREE.Vector3(0, 0, 18) },
      { name: 'attack-south-east', position: new THREE.Vector3(16, 0, 17.5) },
    ],
    defenders: [
      { name: 'defend-north-west', position: new THREE.Vector3(-13, 0, -17.5) },
      { name: 'defend-north-mid', position: new THREE.Vector3(0, 0, -17.5) },
      { name: 'defend-north-east', position: new THREE.Vector3(13, 0, -17.5) },
    ],
  };

  const sites = {
    A: { name: 'A — the Kiln', center: new THREE.Vector3(-21, 0, -13), min: new THREE.Vector3(-24, 0, -16), max: new THREE.Vector3(-18, 2, -10) },
    B: { name: 'B — the Dock', center: new THREE.Vector3(25, 0, -8), min: new THREE.Vector3(22.5, 0, -11), max: new THREE.Vector3(27.5, 2, -5) },
  };

  return { colliders, shootables, spawns, sites, group };
}
