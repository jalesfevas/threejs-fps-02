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

  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // A painted site marker: flat, walkable-over, still a surface a bullet stops on.
  function sitePad(x, z, size) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 0.08, size), materials.ochre);
    mesh.position.set(x, 0.04, z);
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

  // Light: one hemisphere (dusk sky over warm ground) and one low western sun. No shadows.
  const hemi = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.brick), 1.0);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 1.7);
  sun.position.set(-34, 16, 10);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);

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
