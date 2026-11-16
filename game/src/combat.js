// Combat: hitscan shooting, tracers, impact sparks and frag grenades. One raycaster
// and a preallocated pool of lines and points — nothing is created per shot, so a
// firefight never allocates in the hot loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_POOL = 24;
const SPARK_POOL = 12;
const SPARK_POINTS = 10;
const GRENADE_FUSE = 2.2;
const GRENADE_RADIUS = 7;
const GRENADE_DAMAGE = 110;

export function createCombat(scene, world) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const direction = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  // Tracer pool: fading lines from muzzle to impact.
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0,
    }));
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerIndex = 0;

  // Spark pool: one Points cloud per impact, reused.
  const sparks = [];
  for (let i = 0; i < SPARK_POOL; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPARK_POINTS * 3), 3));
    const points = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: new THREE.Color(PALETTE.accent), size: 0.09, transparent: true, opacity: 0,
    }));
    points.frustumCulled = false;
    scene.add(points);
    sparks.push({ points, life: 0, velocities: new Float32Array(SPARK_POINTS * 3) });
  }
  let sparkIndex = 0;

  // Grenades in flight: four preallocated slots, idle until thrown.
  const grenades = [];
  const grenadeMeshes = [];
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ember), roughness: 0.5, metalness: 0.4 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    grenadeMeshes.push(mesh);
    grenades.push({ active: false, owner: null, mesh, pos: new THREE.Vector3(), vel: new THREE.Vector3(), fuse: 0, bounced: 0 });
  }
  const grenadeProbe = new THREE.Box3();

  function spawnTracer(from, to) {
    const tracer = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    const positions = tracer.line.geometry.attributes.position.array;
    positions[0] = from.x; positions[1] = from.y; positions[2] = from.z;
    positions[3] = to.x; positions[4] = to.y; positions[5] = to.z;
    tracer.line.geometry.attributes.position.needsUpdate = true;
    tracer.line.material.opacity = 0.85;
    tracer.life = 0.09;
  }

  function spawnSparks(at, normal) {
    const spark = sparks[sparkIndex];
    sparkIndex = (sparkIndex + 1) % SPARK_POOL;
    const positions = spark.points.geometry.attributes.position.array;
    for (let i = 0; i < SPARK_POINTS; i += 1) {
      positions[i * 3] = at.x;
      positions[i * 3 + 1] = at.y;
      positions[i * 3 + 2] = at.z;
      spark.velocities[i * 3] = (Math.random() - 0.5) * 4 + normal.x * 2;
      spark.velocities[i * 3 + 1] = Math.random() * 3 + 1;
      spark.velocities[i * 3 + 2] = (Math.random() - 0.5) * 4 + normal.z * 2;
    }
    spark.points.geometry.attributes.position.needsUpdate = true;
    spark.points.material.opacity = 0.95;
    spark.life = 0.35;
  }

  function los(from, to) {
    direction.copy(to).sub(from);
    const dist = direction.length();
    if (dist < 0.001) return true;
    direction.normalize();
    raycaster.set(from, direction);
    raycaster.far = dist;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  }

  // One hitscan shot. Returns the hit, if any: { bot, part, point, distance, wall }.
  // shootables are the world plus every living bot's torso and head.
  function shoot(origin, dir, def, hitMeshes) {
    direction.copy(dir).normalize();
    raycaster.set(origin, direction);
    raycaster.far = def.range;
    const hits = raycaster.intersectObjects(world.shootables.concat(hitMeshes), false);
    const end = tmp.copy(origin).addScaledVector(direction, def.range);
    if (hits.length === 0) {
      spawnTracer(origin, end);
      return null;
    }
    const hit = hits[0];
    spawnTracer(origin, hit.point);
    if (hit.object.userData.bot) {
      return { bot: hit.object.userData.bot, part: hit.object.userData.part || 'torso', point: hit.point.clone(), distance: hit.distance };
    }
    const normal = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    spawnSparks(hit.point, normal);
    return { wall: true, point: hit.point.clone(), distance: hit.distance };
  }

  function throwGrenade(from, dir, owner) {
    const slot = grenades.findIndex((g) => !g.active);
    if (slot === -1) return false;
    const mesh = grenadeMeshes[slot];
    const grenade = {
      active: true, owner, mesh,
      pos: from.clone(),
      vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
      fuse: GRENADE_FUSE, bounced: 0,
    };
    grenades[slot] = grenade;
    mesh.visible = true;
    mesh.position.copy(grenade.pos);
    return true;
  }

  function stepGrenades(dt, onExplode) {
    for (const grenade of grenades) {
      if (!grenade || !grenade.active) continue;
      grenade.fuse -= dt;
      grenade.vel.y -= 14 * dt;
      const next = grenade.pos.clone().addScaledVector(grenade.vel, dt);
      grenadeProbe.min.set(next.x - 0.1, next.y - 0.1, next.z - 0.1);
      grenadeProbe.max.set(next.x + 0.1, next.y + 0.1, next.z + 0.1);
      let hit = false;
      for (const collider of world.colliders) {
        if (grenadeProbe.intersectsBox(collider)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        // Simple bounce: dampen and reflect the dominant axis by stepping back.
        grenade.vel.multiplyScalar(-0.35);
        grenade.vel.y = Math.abs(grenade.vel.y) * 0.5 + 1.5;
        grenade.bounced += 1;
        if (grenade.bounced === 1) onExplode.bounce();
      } else {
        grenade.pos.copy(next);
      }
      if (grenade.pos.y < 0.1) {
        grenade.pos.y = 0.1;
        grenade.vel.y = Math.abs(grenade.vel.y) * 0.4;
        grenade.vel.x *= 0.7;
        grenade.vel.z *= 0.7;
      }
      grenade.mesh.position.copy(grenade.pos);
      if (grenade.fuse <= 0) {
        grenade.active = false;
        grenade.mesh.visible = false;
        onExplode.bang(grenade.pos.clone());
      }
    }
  }

  function explodeDamage(center, fighters) {
    const victims = [];
    for (const fighter of fighters) {
      if (!fighter.alive) continue;
      const dist = center.distanceTo(new THREE.Vector3(fighter.position.x, fighter.position.y + 1, fighter.position.z));
      if (dist > GRENADE_RADIUS) continue;
      const from = center.clone();
      const to = new THREE.Vector3(fighter.position.x, fighter.position.y + 1.2, fighter.position.z);
      if (!los(from, to)) continue;
      const damage = Math.round(GRENADE_DAMAGE * (1 - (dist / GRENADE_RADIUS) * 0.7));
      victims.push({ fighter, damage });
    }
    return victims;
  }

  function step(dt) {
    for (const tracer of tracers) {
      if (tracer.life > 0) {
        tracer.life -= dt;
        tracer.line.material.opacity = Math.max(0, tracer.life / 0.09) * 0.85;
      }
    }
    for (const spark of sparks) {
      if (spark.life > 0) {
        spark.life -= dt;
        const positions = spark.points.geometry.attributes.position.array;
        for (let i = 0; i < SPARK_POINTS; i += 1) {
          positions[i * 3] += spark.velocities[i * 3] * dt;
          positions[i * 3 + 1] += spark.velocities[i * 3 + 1] * dt;
          positions[i * 3 + 2] += spark.velocities[i * 3 + 2] * dt;
          spark.velocities[i * 3 + 1] -= 12 * dt;
        }
        spark.points.geometry.attributes.position.needsUpdate = true;
        spark.points.material.opacity = Math.max(0, spark.life / 0.35) * 0.95;
      }
    }
  }

  return { shoot, los, throwGrenade, stepGrenades, explodeDamage, step };
}
