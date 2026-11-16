// Bots: the other seven soldiers. Each one walks the waypoint graph, holds a lane,
// fights in bursts, hears gunfire, and plays the objective — attackers push a site and
// plant, defenders hold and rotate, and everyone converges once the bomb is down.
// A bot thinks at 10 Hz and moves every fixed step, so the AI never costs a frame.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WEAPONS } from './weapons.js';
import { range, pick } from './rng.js';

const BOT_SPEED = 4.3;
const ENGAGE_SPEED = 2.1;
const THINK_EVERY = 0.1;
const REACTION_MIN = 0.28;
const REACTION_MAX = 0.55;
const HEAR_RADIUS = 26;
const SEE_RANGE = 46;
const PLANT_TIME = 3.5;
const DEFUSE_TIME = 5;

export const BOT_NAMES = {
  ember: ['Ash', 'Cinder', 'Flint'],
  slate: ['Rook', 'Haven', 'Moss', 'Vex'],
};

function nameSprite(name, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(20,22,26,0.72)';
  g.fillRect(28, 10, 200, 40);
  g.fillStyle = color;
  g.fillRect(28, 10, 6, 40);
  g.fillStyle = '#ece7db';
  g.font = 'bold 26px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(name, 132, 31);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}

export function createBot(scene, world, team, name, rng) {
  const teamColor = team === 'ember' ? PALETTE.accent : PALETTE.slate;
  const group = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.6, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.7 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), vest);
  torso.position.y = 1.08;
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), skin);
  head.position.y = 1.6;
  head.userData.part = 'head';
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  helmet.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.72, 0.2), dark);
  legL.position.set(-0.14, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.14;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.2, 1.15, -0.3);
  const tag = nameSprite(name, teamColor);
  tag.position.y = 2.05;
  group.add(torso, head, helmet, legL, legR, gun, tag);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
    }
  });
  scene.add(group);

  const bot = {
    team,
    name,
    group,
    torso,
    head,
    position: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    health: 100,
    armor: 0,
    alive: true,
    weaponId: 'kestrel',
    gunState: { cooldown: 0, mag: 30, reserve: 90, reloadLeft: 0 },
    path: [],
    pathIndex: 0,
    mode: 'hold',
    holdNode: -1,
    holdUntil: 0,
    target: null,
    targetSeenAt: -10,
    lastSeen: new THREE.Vector3(),
    aimError: 0,
    burstLeft: 0,
    nextShotAt: 0,
    reactAt: 0,
    strafeDir: 1,
    strafeUntil: 0,
    thinkAt: 0,
    task: null,
    plantProgress: 0,
    defuseProgress: 0,
    fall: 0,
    walkPhase: 0,
    speed: BOT_SPEED * range(rng, 0.92, 1.08),
  };
  torso.userData.bot = bot;
  head.userData.bot = bot;

  const probe = new THREE.Box3();
  const moveTarget = new THREE.Vector3();

  function collides(x, z) {
    probe.min.set(x - 0.34, 0.05, z - 0.34);
    probe.max.set(x + 0.34, 1.7, z + 0.34);
    for (const collider of world.colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function moveToward(tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const stepLen = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * stepLen;
    const nz = bot.position.z + (dz / dist) * stepLen;
    if (!collides(nx, bot.position.z)) bot.position.x = nx;
    if (!collides(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-(dx / dist), -(dz / dist));
    return dist - stepLen < 0.15;
  }

  function eyePos(out) {
    return out.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
  }

  function aimAt(point, dt, error) {
    const dx = point.x - bot.position.x;
    const dy = point.y - (bot.position.y + 1.55);
    const dz = point.z - bot.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    let dyaw = wantYaw - bot.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turn = Math.min(1, dt * 7);
    bot.yaw += dyaw * turn;
    bot.pitch += (wantPitch - bot.pitch) * turn;
    bot.aimError = error;
  }

  function canSee(enemy, ctx) {
    if (!enemy.alive) return false;
    const from = eyePos(new THREE.Vector3());
    const to = new THREE.Vector3(enemy.position.x, enemy.position.y + 1.3, enemy.position.z);
    const dist = from.distanceTo(to);
    if (dist > SEE_RANGE) return false;
    return ctx.los(from, to);
  }

  function pickTarget(ctx) {
    let best = null;
    let bestDist = Infinity;
    for (const enemy of ctx.enemies) {
      if (!enemy.alive || enemy.team === bot.team) continue;
      if (!canSee(enemy, ctx)) continue;
      const d = bot.position.distanceTo(enemy.position);
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }

  function startRouteTo(nodeIndex, ctx) {
    const from = world.nearestNode(bot.position.x, bot.position.z);
    bot.path = world.findPath(from, nodeIndex);
    bot.pathIndex = 0;
    bot.mode = 'route';
  }

  function think(ctx) {
    if (!bot.alive) return;
    const now = ctx.time;
    // Keep the current target while it is still visible; otherwise re-scan.
    if (bot.target && bot.target.alive && canSee(bot.target, ctx)) {
      bot.targetSeenAt = now;
      bot.lastSeen.set(bot.target.position.x, bot.target.position.y + 1.2, bot.target.position.z);
    } else {
      const found = pickTarget(ctx);
      if (found) {
        if (bot.target !== found) bot.reactAt = now + range(ctx.rng, REACTION_MIN, REACTION_MAX);
        bot.target = found;
        bot.targetSeenAt = now;
        bot.lastSeen.set(found.position.x, found.position.y + 1.2, found.position.z);
      } else if (bot.target && now - bot.targetSeenAt > 2.5) {
        bot.target = null;
      }
    }

    const bomb = ctx.bomb;
    if (bot.mode !== 'plant' && bot.mode !== 'defuse') {
      if (bot.team === 'ember') {
        if (bomb.state === 'planted') {
          // Hold the site: camp near the bomb, routing only when not already headed there.
          const dest = bot.path.length > 0 ? bot.path[bot.path.length - 1] : -1;
          if (dest !== bomb.siteNode) {
            bot.holdNode = bomb.siteNode;
            startRouteTo(bomb.siteNode, ctx);
          }
        } else if (bot.mode === 'hold' && now > bot.holdUntil) {
          startRouteTo(bot.task.siteNode, ctx);
        }
      } else if (bomb.state === 'planted') {
        if (bot.mode !== 'route' || bot.path[bot.path.length - 1] !== bomb.siteNode) {
          startRouteTo(bomb.siteNode, ctx);
        }
      } else if (bot.mode === 'hold' && now > bot.holdUntil) {
        // Rotate between the sites and mid on a slow patrol.
        const next = pick(ctx.rng, bot.task.patrol);
        bot.holdNode = next;
        startRouteTo(next, ctx);
      }
    }

    // Hearing: a nearby shot pulls an idle bot toward the noise.
    if (!bot.target && ctx.noises.length > 0 && bot.mode === 'hold') {
      const noise = ctx.noises[ctx.noises.length - 1];
      if (now - noise.time < 1.5 && bot.position.distanceTo(noise.pos) < HEAR_RADIUS) {
        bot.holdNode = world.nearestNode(noise.pos.x, noise.pos.z);
        startRouteTo(bot.holdNode, ctx);
      }
    }

    // Planting: the carrier plants when the site is quiet.
    if (bot.task && bot.task.carrier === bot && bomb.state === 'carried' && ctx.phase === 'live') {
      const site = ctx.sites[bot.task.site];
      const inSite = Math.abs(bot.position.x - site.center.x) < site.half && Math.abs(bot.position.z - site.center.z) < site.half;
      if (inSite && !bot.target) {
        bot.mode = 'plant';
        bot.plantProgress += THINK_EVERY;
        if (bot.plantProgress >= PLANT_TIME) {
          bot.plantProgress = 0;
          bot.mode = 'hold';
          ctx.onPlant(bot, bot.task.site);
        }
        return;
      }
      bot.plantProgress = 0;
    }

    // Defusing: a defender on the bomb works the wires.
    if (bot.team === 'slate' && bomb.state === 'planted' && ctx.phase === 'live') {
      const dist = bot.position.distanceTo(bomb.pos);
      if (dist < 1.6) {
        bot.mode = 'defuse';
        bot.defuseProgress += THINK_EVERY;
        if (bot.defuseProgress >= DEFUSE_TIME) {
          bot.defuseProgress = 0;
          bot.mode = 'hold';
          ctx.onDefuse(bot);
        }
        return;
      }
      bot.defuseProgress = 0;
    }
  }

  function step(dt, ctx) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        group.rotation.x = -bot.fall * 1.45;
      }
      return;
    }
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = THINK_EVERY;
      think(ctx);
    }

    const now = ctx.time;
    const engaging = bot.target && bot.target.alive && now >= bot.reactAt;
    // Movement: follow the path, or strafe while fighting.
    if (bot.mode === 'route' && bot.path.length > 0) {
      const node = world.nodes[bot.path[bot.pathIndex]];
      const arrived = moveToward(node.x, node.z, dt, engaging ? ENGAGE_SPEED : bot.speed);
      if (arrived) {
        bot.pathIndex += 1;
        if (bot.pathIndex >= bot.path.length) {
          bot.mode = 'hold';
          bot.holdUntil = now + (bot.team === 'slate' ? range(ctx.rng, 6, 12) : 2);
        }
      }
    } else if (engaging) {
      if (now > bot.strafeUntil) {
        bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
        bot.strafeUntil = now + range(ctx.rng, 0.4, 0.9);
      }
      const side = bot.yaw + (Math.PI / 2) * bot.strafeDir;
      moveTarget.set(bot.position.x + Math.sin(side) * 1.5, 0, bot.position.z + Math.cos(side) * 1.5);
      moveToward(moveTarget.x, moveTarget.z, dt, ENGAGE_SPEED);
    }

    // Aiming and firing in bursts.
    if (bot.target && bot.target.alive) {
      const enemy = bot.target;
      const dist = bot.position.distanceTo(enemy.position);
      const targetSpeed = enemy.groundSpeed ? enemy.groundSpeed() : 0;
      const error = 0.014 + dist * 0.0011 + targetSpeed * 0.004 + (bot.mode === 'route' ? 0.012 : 0);
      const aimPoint = new THREE.Vector3(enemy.position.x, enemy.position.y + 1.25, enemy.position.z);
      aimAt(aimPoint, dt, error);
      if (engaging && bot.gunState.cooldown <= 0 && bot.gunState.reloadLeft <= 0) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(ctx.rng() * 3);
          bot.nextShotAt = now + range(ctx.rng, 0.25, 0.7);
        }
        if (now >= bot.nextShotAt && bot.burstLeft > 0) {
          bot.burstLeft -= 1;
          bot.nextShotAt = now + WEAPONS[bot.weaponId].fireGap * range(ctx.rng, 1, 1.6);
          ctx.fireBot(bot);
        }
      }
    } else if (bot.mode === 'route' && bot.path.length > 0) {
      const node = world.nodes[bot.path[bot.pathIndex]];
      bot.pitch += (0 - bot.pitch) * Math.min(1, dt * 5);
    }

    // Gun timers and reload.
    const gun = bot.gunState;
    gun.cooldown = Math.max(0, gun.cooldown - dt);
    if (gun.reloadLeft > 0) {
      gun.reloadLeft -= dt;
      if (gun.reloadLeft <= 0) {
        const def = WEAPONS[bot.weaponId];
        const take = Math.min(def.mag - gun.mag, gun.reserve);
        gun.mag += take;
        gun.reserve -= take;
      }
    } else if (gun.mag === 0 && gun.reserve > 0) {
      gun.reloadLeft = WEAPONS[bot.weaponId].reloadTime;
    }

    // Walk cycle and mesh pose.
    const moving = bot.mode === 'route' || engaging;
    bot.walkPhase += dt * (moving ? 9 : 0);
    const swing = moving ? Math.sin(bot.walkPhase) * 0.35 : 0;
    legL.rotation.x = swing;
    legR.rotation.x = -swing;
    group.position.copy(bot.position);
    group.rotation.y = bot.yaw;
    group.rotation.x = 0;
    tag.visible = bot.alive;
  }

  function damage(amount, part) {
    if (!bot.alive) return { killed: false, damage: 0 };
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.health -= remaining;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.target = null;
      bot.fall = 0;
      return { killed: true, damage: remaining };
    }
    return { killed: false, damage: remaining };
  }

  function reset(spawnPos, weaponId, task) {
    bot.position.copy(spawnPos);
    bot.yaw = team === 'ember' ? Math.PI : 0;
    bot.pitch = 0;
    bot.health = 100;
    bot.armor = 0;
    bot.alive = true;
    bot.weaponId = weaponId;
    const def = WEAPONS[weaponId];
    bot.gunState = { cooldown: 0, mag: def.mag, reserve: def.reserve, reloadLeft: 0 };
    bot.path = [];
    bot.pathIndex = 0;
    bot.mode = 'hold';
    bot.holdNode = -1;
    bot.holdUntil = 0;
    bot.target = null;
    bot.plantProgress = 0;
    bot.defuseProgress = 0;
    bot.fall = 0;
    bot.task = task;
    bot.burstLeft = 0;
    group.rotation.set(0, bot.yaw, 0);
    group.position.copy(spawnPos);
    group.visible = true;
  }

  bot.step = step;
  bot.damage = damage;
  bot.reset = reset;
  bot.eyePos = eyePos;
  bot.moveToward = moveToward;
  bot.collides = collides;
  return bot;
}
