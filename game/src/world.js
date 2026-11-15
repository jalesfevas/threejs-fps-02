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

  const TEX_SIZE = 512; // round-3 art pass: 128 px read as mush up close

  function surfaceCanvas(name, seed, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = TEX_SIZE;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[name];
    ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    draw(ctx, texRandom(seed));
    return canvas;
  }

  // Grainy speckle over the whole tile: cheap concrete/plaster variation.
  function speckle(ctx, random, count, alpha) {
    for (let i = 0; i < count; i += 1) {
      const light = random() > 0.5;
      ctx.fillStyle = `rgba(${light ? '255,250,238' : '20,14,10'},${(alpha * random()).toFixed(3)})`;
      ctx.fillRect(random() * TEX_SIZE, random() * TEX_SIZE, 1 + random() * 2, 1 + random() * 2);
    }
  }

  // Fired-brick courses: darker mortar lines every 64 px, alternating row offsets.
  function brickCourses(ctx, random) {
    ctx.fillStyle = 'rgba(30,16,12,0.55)';
    for (let y = 0; y < TEX_SIZE; y += 64) {
      ctx.fillRect(0, y, TEX_SIZE, 6);
      const shift = (y / 64) % 2 ? 64 : 0;
      for (let x = shift; x < TEX_SIZE; x += 128) ctx.fillRect(x, y, 6, 64);
    }
    speckle(ctx, random, 2600, 0.16);
  }

  // Wood grain for the crates: long horizontal streaks plus knots.
  function woodGrain(ctx, random) {
    for (let i = 0; i < 120; i += 1) {
      const y = random() * TEX_SIZE;
      const dark = random() > 0.5;
      ctx.strokeStyle = `rgba(${dark ? '52,32,16' : '230,200,150'},${(0.10 + random() * 0.20).toFixed(3)})`;
      ctx.lineWidth = 1 + random() * 3;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(
        TEX_SIZE * 0.31, y + (random() - 0.5) * 36,
        TEX_SIZE * 0.70, y + (random() - 0.5) * 36,
        TEX_SIZE, y + (random() - 0.5) * 20,
      );
      ctx.stroke();
    }
    speckle(ctx, random, 500, 0.12);
  }

  // Repeats scale ×4 with the 512 px tile so ground coverage per world metre is unchanged.
  const SURFACES = {
    sand: {
      repeat: [40, 28],
      // Round-4: patch variation — seeded darker/lighter dirt blobs so the packed yard
      // floor reads as ground, not one uniform field.
      draw: (ctx, random) => {
        speckle(ctx, random, 5000, 0.18);
        for (let i = 0; i < 52; i += 1) {
          const dark = random() > 0.42;
          ctx.fillStyle = `rgba(${dark ? '58,42,28' : '238,224,196'},${(0.05 + random() * 0.09).toFixed(3)})`;
          ctx.beginPath();
          ctx.ellipse(random() * TEX_SIZE, random() * TEX_SIZE,
            14 + random() * 46, 8 + random() * 26, random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    },
    brick: { repeat: [16, 8], draw: brickCourses },
    slate: { repeat: [12, 12], draw: (ctx, random) => speckle(ctx, random, 3600, 0.15) },
    crate: { repeat: [1, 1], draw: woodGrain },
    terracotta: { repeat: [12, 8], draw: (ctx, random) => speckle(ctx, random, 3200, 0.14) },
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

  // Round-4: the courtyard platform gets its own surface — slate tiles with a darker mortar
  // grid (joints every quarter tile → ~0.75 m tiles at repeat 3 x 2.4 over the 9 x 7 slab).
  const tileCanvas = surfaceCanvas('slate', 0x51ab, (ctx, random) => {
    ctx.strokeStyle = 'rgba(30,34,40,0.75)';
    ctx.lineWidth = 5;
    const step = TEX_SIZE / 4;
    for (let i = 0; i <= 4; i += 1) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, TEX_SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(TEX_SIZE, i * step); ctx.stroke();
    }
    speckle(ctx, random, 2400, 0.15);
  });
  const tileTexture = new THREE.CanvasTexture(tileCanvas);
  tileTexture.wrapS = tileTexture.wrapT = THREE.RepeatWrapping;
  tileTexture.colorSpace = THREE.SRGBColorSpace;
  tileTexture.anisotropy = 4;
  tileTexture.repeat.set(3, 2.4);
  materials.platformTile = new THREE.MeshStandardMaterial({ map: tileTexture, roughness: 0.9, metalness: 0.03 });

  const colliders = [];
  const shootables = [];

  // Slightly varied crate materials: three clones of the wood texture with small lightness
  // offsets, picked round-robin so stacked crates do not read as one flat colour. Brick
  // walls get the same treatment so long wall runs are not one flat field.
  function tintVariants(materialName, shifts) {
    return shifts.map((shift) => {
      const variant = materials[materialName].clone();
      variant.color = new THREE.Color(1 + shift, 1 + shift, 1 + shift);
      return variant;
    });
  }
  const crateVariants = tintVariants('crate', [-0.05, 0, 0.05]);
  const brickVariants = tintVariants('brick', [-0.05, 0.02, 0.06]);
  const slateVariants = tintVariants('slate', [-0.04, 0, 0.05]);
  let crateVariantIndex = 0;
  let brickVariantIndex = 0;
  let slateVariantIndex = 0;

  // `material` may be a palette name or an already-built material (e.g. platformTile).
  function box(width, height, depth, x, y, z, materialName) {
    let material = typeof materialName === 'string' ? materials[materialName] : materialName;
    if (materialName === 'crate') {
      material = crateVariants[crateVariantIndex % crateVariants.length];
      crateVariantIndex += 1;
    } else if (materialName === 'brick') {
      material = brickVariants[brickVariantIndex % brickVariants.length];
      brickVariantIndex += 1;
    } else if (materialName === 'slate') {
      material = slateVariants[slateVariantIndex % slateVariants.length];
      slateVariantIndex += 1;
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

  // Mid courtyard: raised tiled platform, 1.2 m up, with three 0.4 m steps on the south side.
  // Round-4: thin darker rim strips cap the top edge (bevel illusion); they are plain decor
  // meshes — the platform slab below already carries the collider and the shootable entry.
  box(9, 1.2, 7, 0, 0.6, 0, materials.platformTile);
  const rimGeoX = new THREE.BoxGeometry(9.16, 0.12, 0.12);
  const rimGeoZ = new THREE.BoxGeometry(0.12, 0.12, 7.16);
  for (const [geo, rx2, rz2] of [
    [rimGeoX, 0, -3.51], [rimGeoX, 0, 3.51], [rimGeoZ, -4.58, 0], [rimGeoZ, 4.58, 0],
  ]) {
    const rim = new THREE.Mesh(geo, materials.hairline);
    rim.position.set(rx2, 1.22, rz2);
    rim.castShadow = true;
    rim.receiveShadow = true;
    group.add(rim);
  }
  box(3, 0.8, 1.0, 0, 0.4, 3.9, 'slate');
  box(3, 0.4, 1.0, 0, 0.2, 4.9, 'slate');

  // Round-4: dark scuff strips along the wall bases — flat decor quads, no collider and no
  // shootable entry (the walls behind them already stop bullets and feet). S9: slate canvas
  // material with tint variants instead of one flat colour.
  let stripVariantIndex = 0;
  for (const [width, depth, sx, sz] of [
    [26, 0.8, -8, -19.5], [14, 0.6, 18, -19.6], [22, 0.7, -6, 19.5], [12, 0.6, -21, 19.6],
    [0.7, 20, -29.5, 2], [0.6, 14, 29.6, 10], [0.7, 16, 29.5, -8],
  ]) {
    const stripMaterial = slateVariants[stripVariantIndex % slateVariants.length];
    stripVariantIndex += 1;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), stripMaterial);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(sx, 0.015, sz);
    strip.receiveShadow = true;
    group.add(strip);
  }

  // Courtyard cover: two low walls to fight over. S9: brick canvas material with tint
  // variants, plus a darker 0.1 m trim strip along each base (decor only — no collider).
  box(3, 1.1, 1.2, -6, 0.55, 8, 'brick');
  box(3, 1.1, 1.2, 6, 0.55, -8, 'brick');
  for (const [cx, cz] of [[-6, 8], [6, -8]]) {
    const trim = new THREE.Mesh(new THREE.BoxGeometry(3.04, 0.1, 1.24), materials.hairline);
    trim.position.set(cx, 0.05, cz);
    trim.castShadow = true;
    trim.receiveShadow = true;
    group.add(trim);
  }

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

  // --- Round-3 art pass: small props --------------------------------------------------------
  // Non-colliding, non-shootable decoration (bullets pass through them, feet do not collide),
  // placed against walls and platform edges to break empty sightlines without closing lanes.
  // Round-4: props are excluded from the bullet raycast list — inconsistent hits on decor
  // read as shots vanishing; the solids behind them are what should absorb the bullet.
  function prop(geo, x, y, z, materialName, rx = 0, ry = 0, rz = 0) {
    const mesh = new THREE.Mesh(geo, materials[materialName]);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }
  const pipeGeo = new THREE.CylinderGeometry(0.14, 0.14, 12, 8);
  const vpipeGeo = new THREE.CylinderGeometry(0.14, 0.14, 3.4, 8);
  const tileGeo = new THREE.BoxGeometry(2.6, 0.14, 0.6);
  const plankGeo = new THREE.BoxGeometry(0.34, 3.4, 0.09);
  const poleGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.6, 8);
  // Roof tile strips along the outer wall tops (one per wall segment).
  prop(tileGeo, -14, 4.62, -20.1, 'terracotta', 0, 0, 0);
  prop(tileGeo, 14, 4.62, -20.1, 'terracotta');
  prop(tileGeo, -14, 4.62, 20.1, 'terracotta');
  prop(tileGeo, 14, 4.62, 20.1, 'terracotta');
  prop(tileGeo, -30.1, 4.62, -10, 'terracotta', 0, Math.PI / 2, 0);
  prop(tileGeo, -30.1, 4.62, 10, 'terracotta', 0, Math.PI / 2, 0);
  prop(tileGeo, 30.1, 4.62, -10, 'terracotta', 0, Math.PI / 2, 0);
  prop(tileGeo, 30.1, 4.62, 10, 'terracotta', 0, Math.PI / 2, 0);
  // Drain pipes running along the north and south walls, just above head height.
  prop(pipeGeo, -16, 2.7, -19.85, 'slate', 0, 0, Math.PI / 2);
  prop(pipeGeo, 16, 2.7, -19.85, 'slate', 0, 0, Math.PI / 2);
  prop(pipeGeo, -16, 2.7, 19.85, 'slate', 0, 0, Math.PI / 2);
  prop(pipeGeo, 16, 2.7, 19.85, 'slate', 0, 0, Math.PI / 2);
  // Vertical downpipes at the lane-divider ends.
  prop(vpipeGeo, -10.6, 1.7, -7.8, 'slate');
  prop(vpipeGeo, 10.6, 1.7, -7.8, 'slate');
  prop(vpipeGeo, -10.6, 1.7, 5.8, 'slate');
  prop(vpipeGeo, 10.6, 1.7, 5.8, 'slate');
  // Wooden planks leaning against walls and the courtyard platform.
  prop(plankGeo, -28.4, 1.6, -6, 'crate', 0, 0.4, 0.22);
  prop(plankGeo, -27.9, 1.6, -4.6, 'crate', 0, 0.35, 0.2);
  prop(plankGeo, 28.4, 1.6, 8, 'crate', 0, -0.4, -0.22);
  prop(plankGeo, 27.9, 1.6, 9.4, 'crate', 0, -0.35, -0.2);
  prop(plankGeo, -4.4, 1.3, 3.2, 'crate', 0, 1.1, 0.24);
  prop(plankGeo, 4.4, 1.3, -3.2, 'crate', 0, -1.1, -0.24);
  // Poles breaking the long empty courtyard sightlines at platform corners.
  prop(poleGeo, -4.2, 1.8, -3.2, 'crate');
  prop(poleGeo, 4.2, 1.8, 3.2, 'crate');
  prop(poleGeo, -19, 1.8, 15.5, 'crate');
  prop(poleGeo, 19, 1.8, 12.5, 'crate');

  // Light: one hemisphere (dusk sky over a warmer ground bounce) plus the low western sun
  // casting the map's only shadows, with an ortho frustum covering the full 60 x 40 yard.
  // Round-3: a second dim fill light opposite the sun gives the yard a gradient feel
  // instead of one hard sun side and one flat black side.
  const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color('#a5683f'), 1.0);
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

  const fill = new THREE.DirectionalLight(new THREE.Color('#7a86b0'), 0.3);
  fill.position.set(32, 10, -16);
  fill.target.position.set(0, 0, 0);
  scene.add(fill, fill.target);

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
