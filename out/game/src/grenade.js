// The Kilnpot: one grenade type, thrown on G or middle-click, simulated inside the fixed step.
// Gravity, a single ground bounce, a 2.2 s fuse, then a 6 m blast with distance falloff. Four
// pooled records and four meshes, built once — the loop allocates nothing. Explosion damage is
// applied through the onExplode callback owned by main.js; this module only moves metal.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { state } from './state.js';

const MAX_LIVE = 4;
const FUSE = 2.2;
const RADIUS = 0.12;
const GRAVITY = 20;
const THROW_SPEED = 14;
const THROW_UP = 3.5;
const THROW_LIFT = 0.5;
const BOUNCE_DAMP = 0.45;
const SLIDE_DAMP = 4;
const LIGHT_RANGE = 12;

export function createGrenades(scene, colliders, opts) {
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.terracotta), roughness: 0.6, metalness: 0.05 });
  const band = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.1 });
  const potGeometry = new THREE.SphereGeometry(RADIUS, 10, 8);
  const bandGeometry = new THREE.CylinderGeometry(RADIUS * 1.02, RADIUS * 1.02, 0.05, 10);

  const list = state.grenades.list;
  for (let i = 0; i < MAX_LIVE; i += 1) {
    const mesh = new THREE.Group();
    const pot = new THREE.Mesh(potGeometry, skin);
    const stripe = new THREE.Mesh(bandGeometry, band);
    mesh.add(pot, stripe);
    mesh.visible = false;
    scene.add(mesh);
    list.push({ live: false, bounced: false, fuse: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), mesh });
  }

  const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, LIGHT_RANGE);
  scene.add(blastLight);

  const forward = new THREE.Vector3();
  const probe = new THREE.Box3();

  // Highest collider top under a point, or the yard floor. Reused across the loop.
  function groundHeight(x, z, below) {
    let ground = 0;
    for (const collider of colliders) {
      if (x < collider.min.x || x > collider.max.x || z < collider.min.z || z > collider.max.z) continue;
      if (collider.max.y <= below + 0.05 && collider.max.y > ground) ground = collider.max.y;
    }
    return ground;
  }

  function throw_() {
    if (state.grenades.count <= 0) return;
    let record = null;
    for (const candidate of list) if (!candidate.live) { record = candidate; break; }
    if (!record) return;
    state.grenades.count -= 1;
    record.live = true;
    record.bounced = false;
    record.fuse = FUSE;
    const player = state.player;
    forward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    record.position.set(
      player.position.x + forward.x * 0.5,
      player.position.y + player.eye - THROW_LIFT,
      player.position.z + forward.z * 0.5,
    );
    record.velocity.set(
      forward.x * THROW_SPEED + player.velocity.x * 0.6,
      THROW_UP,
      forward.z * THROW_SPEED + player.velocity.z * 0.6,
    );
    record.mesh.visible = true;
  }

  function explode(record) {
    record.live = false;
    record.mesh.visible = false;
    blastLight.position.copy(record.position);
    blastLight.intensity = 60;
    opts.onExplode(record.position);
  }

  function step(dt) {
    for (const record of list) {
      if (!record.live) continue;
      record.fuse -= dt;
      if (record.fuse <= 0) {
        explode(record);
        continue;
      }
      record.velocity.y -= GRAVITY * dt;
      record.position.addScaledVector(record.velocity, dt);

      const ground = groundHeight(record.position.x, record.position.z, record.position.y - RADIUS);
      if (record.position.y - RADIUS <= ground && record.velocity.y <= 0) {
        record.position.y = ground + RADIUS;
        if (!record.bounced) {
          record.bounced = true;
          record.velocity.y = -record.velocity.y * BOUNCE_DAMP;
          record.velocity.x *= 0.6;
          record.velocity.z *= 0.6;
          if (record.velocity.y < 0.6) record.velocity.y = 0; // a dying bounce becomes a slide
        } else {
          record.velocity.y = 0;
          const damp = Math.max(0, 1 - SLIDE_DAMP * dt);
          record.velocity.x *= damp;
          record.velocity.z *= damp;
        }
      }

      // Side collision: a wall stops the pot dead (velocity zeroed) instead of tunnelling.
      probe.min.set(record.position.x - RADIUS, record.position.y - RADIUS, record.position.z - RADIUS);
      probe.max.set(record.position.x + RADIUS, record.position.y + RADIUS, record.position.z + RADIUS);
      for (const collider of colliders) {
        if (!probe.intersectsBox(collider)) continue;
        if (collider.max.y >= record.position.y + RADIUS) {
          record.velocity.set(0, record.velocity.y, 0);
          break;
        }
      }

      record.mesh.position.copy(record.position);
      record.mesh.rotation.x += record.velocity.length() * dt * 3;
      record.mesh.rotation.y += dt * 2;
    }

    if (blastLight.intensity > 0) blastLight.intensity = Math.max(0, blastLight.intensity - dt * 240);
  }

  function reset() {
    state.grenades.count = 3;
    for (const record of list) {
      record.live = false;
      record.mesh.visible = false;
    }
    blastLight.intensity = 0;
  }

  return { step, throw: throw_, reset };
}
