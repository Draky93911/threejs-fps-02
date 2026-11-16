// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the display's
// rate. ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createGun, WEAPONS } from './weapons.js';
import { createBot, BOT_NAMES } from './bots.js';
import { createCombat } from './combat.js';
import { createMatch, BUY_TIME, ROUND_TIME } from './match.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
// ?timescale=N (1-8) runs the simulation faster than real time: a testing aid for
// slow software renderers, where one rendered frame can take a second.
const timeScale = Math.min(8, Math.max(1, Number(params.get('timescale') ?? '1') || 1));
const random = mulberry32(seed);
const rng = () => random();

window.__errors = [];
window.addEventListener('error', (event) => {
  window.__errors.push(String(event.message || event.error));
});

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 22, 60);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const combat = createCombat(scene, world);
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 120;

const body = player.state;
const noises = [];
let playerHealth = 100;
let playerAlive = true;
let playerGun = null;
let playerGuns = {};
let prevFiring = false;
let frozen = false;
let started = false;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let shakeTime = 0;
let shakeMag = 0;
let lastBeepAt = -10;
let channelKind = null;
let channelStart = null;
let stepAccum = 0;

// Fighters: the player and the seven bots, one list for combat and the AI.
const bots = [];
const emberBots = [];
const slateBots = [];
for (const name of BOT_NAMES.ember) {
  const bot = createBot(scene, world, 'ember', name, random);
  bots.push(bot);
  emberBots.push(bot);
}
for (const name of BOT_NAMES.slate) {
  const bot = createBot(scene, world, 'slate', name, random);
  bots.push(bot);
  slateBots.push(bot);
}
const playerFighter = {
  team: 'ember',
  name: 'You',
  position: body.position,
  alive: true,
  groundSpeed: () => player.groundSpeed(),
};
const fighters = [playerFighter, ...bots];
const botHitMeshes = bots.flatMap((bot) => [bot.torso, bot.head]);
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

const match = createMatch({
  onRoundStart(round) {
    hud.showRoundBanner(`ROUND ${round}`, round === 1 ? 'Ember attacks — plant the bomb at A or B.' : 'Buy up. The yard remembers nothing.');
    resetPositions();
  },
  onResetRound() {
    resetPositions();
  },
  onLive() {
    hud.hideBuy();
    hud.setBuyHint('');
  },
  onRoundEnd(winner, reason) {
    const won = winner === 'ember';
    hud.showRoundBanner(won ? 'EMBER TAKES THE ROUND' : 'SLATE TAKES THE ROUND', reason);
    if (won) audio.roundWin();
    else audio.roundLose();
    if (!playerAlive) hud.showOverlay('paused');
    input.releaseLock();
  },
  onMatchEnd(winner) {
    const won = winner === 'ember';
    hud.showRoundBanner(won ? 'EMBER WINS THE MATCH' : 'SLATE WINS THE MATCH', `Final — Ember ${match.state.score.ember} : ${match.state.score.slate} Slate`);
    hud.showOverlay('paused', {
      title: won ? 'Ember wins the match' : 'Slate wins the match',
      copy: `Final score — Ember ${match.state.score.ember} : ${match.state.score.slate} Slate. Refresh to run it back.`,
    });
    input.releaseLock();
  },
  onPlant(site) {
    hud.showBomb(`BOMB PLANTED — SITE ${site}`, false);
    audio.plantBeep(true);
  },
  onDefuse() {
    hud.hideBomb();
    hud.showRoundBanner('BOMB DEFUSED', 'Slate holds the yard.');
  },
  onBuy(item) {
    audio.buy();
    hud.setBuyHint(`Bought ${item.name}.`);
  },
  onWeaponBought(weaponId) {
    switchGun(weaponId);
  },
});

function switchGun(weaponId) {
  if (playerGun) playerGun.dispose();
  playerGun = createGun(camera, WEAPONS[weaponId]);
  playerGuns[weaponId] = playerGun;
  hud.setAmmo(playerGun.state.mag, playerGun.state.reserve, WEAPONS[weaponId].name);
}

function botTask(bot, site, siteNode, patrol) {
  return { site, siteNode, patrol, carrier: null };
}

function resetPositions() {
  // Player redeploys at the Ember spawn, facing up mid.
  body.position.copy(world.spawns.ember[0]);
  body.velocity.set(0, 0, 0);
  body.yaw = 0;
  body.pitch = 0;
  playerHealth = 100;
  playerAlive = true;
  playerFighter.alive = true;
  if (!playerGun || match.state.currentWeapon !== playerGun.state.def.id) switchGun(match.state.currentWeapon);
  else playerGun.refill();
  const emberTasks = [
    botTask(emberBots[0], 'A', 9, [9, 16, 5]),
    botTask(emberBots[1], 'B', 13, [13, 17, 4]),
    botTask(emberBots[2], 'A', 9, [9, 5, 16]),
  ];
  emberBots.forEach((bot, i) => bot.reset(world.spawns.ember[i + 1], i === 2 ? 'sparrow' : 'kestrel', emberTasks[i]));
  const slateTasks = [
    botTask(slateBots[0], 'A', 21, [21, 9, 18]),
    botTask(slateBots[1], 'B', 22, [22, 13, 20]),
    botTask(slateBots[2], 'A', 5, [5, 16, 14]),
    botTask(slateBots[3], 'B', 13, [13, 12, 17]),
  ];
  slateBots.forEach((bot, i) => bot.reset(world.spawns.slate[i], i === 3 ? 'sparrow' : 'kestrel', slateTasks[i]));
  hud.hideBomb();
  hud.channel(null, null);
  channelKind = null;
  syncHud();
}

function passBombCarrier() {
  if (match.state.bomb.state !== 'carried') return;
  const living = emberBots.find((bot) => bot.alive);
  for (const bot of emberBots) if (bot.task) bot.task.carrier = null;
  if (living && living.task) {
    living.task.carrier = living;
    match.state.bomb.carrier = 'bot';
  }
}

function damagePlayer(amount, part, attackerName) {
  if (!playerAlive) return;
  let remaining = amount;
  if (match.state.armor > 0) {
    const absorbed = Math.min(match.state.armor, remaining * 0.5);
    match.state.armor -= absorbed;
    remaining -= absorbed;
  }
  playerHealth -= remaining;
  hud.damageFlash();
  audio.hurt();
  if (playerHealth <= 0) {
    playerHealth = 0;
    playerAlive = false;
    playerFighter.alive = false;
    match.onPlayerDeath();
    passBombCarrier();
    hud.showOverlay('paused', {
      title: 'You are down',
      copy: 'Your squad fights on. You redeploy next round — click to keep watching.',
    });
    input.releaseLock();
  }
  syncHud();
}

function damageBot(bot, amount, part, attackerTeam, attackerIsPlayer) {
  const result = bot.damage(amount, part);
  if (attackerIsPlayer) {
    hud.hitMarker(result.killed);
    if (result.killed) audio.kill();
    else audio.hit();
  }
  if (result.killed) {
    match.onKill(attackerTeam, bot.team, bot.name, part === 'head');
    if (bot.team === 'ember' && bot.task && bot.task.carrier === bot) passBombCarrier();
    if (bot.team === 'slate' && match.state.bomb.state === 'planted') {
      // A defender dying on the site may leave the bomb alone; nothing special.
    }
  }
  return result;
}

// Analytic hit test of a ray against the player capsule (head sphere + torso sphere).
// Plain numbers only: no shared scratch vector is touched, so the caller's direction
// survives the test.
function rayHitsPlayer(origin, dir, range) {
  const spheres = [
    { x: body.position.x, y: body.position.y + 1.55, z: body.position.z, radius: 0.22, part: 'head' },
    { x: body.position.x, y: body.position.y + 1.1, z: body.position.z, radius: 0.5, part: 'torso' },
  ];
  let best = null;
  for (const sphere of spheres) {
    const ox = sphere.x - origin.x;
    const oy = sphere.y - origin.y;
    const oz = sphere.z - origin.z;
    const t = ox * dir.x + oy * dir.y + oz * dir.z;
    if (t < 0 || t > range) continue;
    const cx = origin.x + dir.x * t;
    const cy = origin.y + dir.y * t;
    const cz = origin.z + dir.z * t;
    const d = Math.hypot(cx - sphere.x, cy - sphere.y, cz - sphere.z);
    if (d < sphere.radius && (!best || t < best.distance)) best = { distance: t, part: sphere.part };
  }
  return best;
}

function fireBotShot(bot) {
  const def = WEAPONS[bot.weaponId];
  const gun = bot.gunState;
  if (gun.mag <= 0) return;
  gun.mag -= 1;
  gun.cooldown = def.fireGap;
  const origin = bot.eyePos(new THREE.Vector3());
  const target = bot.target;
  if (!target) return;
  tmpVec.set(target.position.x, target.position.y + 1.25, target.position.z).sub(origin).normalize();
  tmpVec.x += (random() * 2 - 1) * bot.aimError;
  tmpVec.y += (random() * 2 - 1) * bot.aimError;
  tmpVec.z += (random() * 2 - 1) * bot.aimError;
  tmpVec.normalize();
  const enemyMeshes = bots.filter((other) => other.alive && other.team !== bot.team).flatMap((other) => [other.torso, other.head]);
  const hit = combat.shoot(origin, tmpVec, def, enemyMeshes);
  const playerHit = playerAlive && target === playerFighter ? rayHitsPlayer(origin, tmpVec, def.range) : null;
  if (playerHit && (!hit || playerHit.distance < hit.distance)) {
    const falloff = Math.max(0.55, 1 - (playerHit.distance / def.range) * 0.45);
    damagePlayer(Math.round(def.damage * (playerHit.part === 'head' ? def.headMult : 1) * falloff), playerHit.part, bot.name);
  } else if (hit && hit.bot) {
    const falloff = Math.max(0.55, 1 - (hit.distance / def.range) * 0.45);
    damageBot(hit.bot, Math.round(def.damage * (hit.part === 'head' ? def.headMult : 1) * falloff), hit.part, bot.team, false);
  }
  noises.push({ pos: origin.clone(), time: elapsed });
  if (noises.length > 8) noises.shift();
  const distToPlayer = origin.distanceTo(body.position);
  if (distToPlayer < 42) audio.distantShot();
}

function botContext() {
  return {
    time: elapsed,
    rng,
    enemies: fighters,
    noises,
    bomb: {
      state: match.state.bomb.state,
      siteNode: match.state.bomb.siteNode,
      pos: match.state.bomb.pos,
    },
    sites: world.sites,
    phase: match.state.phase,
    los: (from, to) => combat.los(from, to),
    fireBot: fireBotShot,
    onPlant(bot, site) {
      const siteNode = site === 'A' ? 9 : 13;
      match.plant(site, siteNode, bot.position);
    },
    onDefuse() {
      match.defuse();
    },
  };
}

function shootPlayer() {
  const def = match.weaponDef();
  if (!playerGun.takeRound()) {
    audio.dryClick();
    return;
  }
  camera.getWorldDirection(direction);
  const spread = playerGun.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  const hit = combat.shoot(camera.position, direction, def, botHitMeshes);
  if (hit && hit.bot) {
    const falloff = Math.max(0.55, 1 - (hit.distance / def.range) * 0.45);
    damageBot(hit.bot, Math.round(def.damage * (hit.part === 'head' ? def.headMult : 1) * falloff), hit.part, 'ember', true);
  }
  playerGun.pullTrigger();
  player.recoil(0.009 + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.id);
  noises.push({ pos: body.position.clone(), time: elapsed });
  if (noises.length > 8) noises.shift();
  hud.setAmmo(playerGun.state.mag, playerGun.state.reserve, def.name);
}

function throwPlayerGrenade() {
  if (match.state.grenades <= 0 || match.state.phase !== 'live' || !playerAlive) return;
  camera.getWorldDirection(direction);
  const from = tmpVec.set(body.position.x, body.position.y + body.eye - 0.15, body.position.z);
  if (combat.throwGrenade(from, direction, 'player')) {
    match.state.grenades -= 1;
    audio.grenadeThrow();
    hud.setGrenades(match.state.grenades);
  }
}

function explodeAt(pos) {
  audio.explosion();
  shakeTime = 0.5;
  shakeMag = 0.5;
  const victims = combat.explodeDamage(pos, fighters);
  for (const { fighter, damage } of victims) {
    if (fighter === playerFighter) {
      const dist = pos.distanceTo(body.position);
      damagePlayer(damage, 'torso', 'grenade');
      if (dist < 12) shakeTime = 0.6;
    } else {
      damageBot(fighter, damage, 'torso', 'player', true);
    }
  }
  // Flash sphere, preallocated once and reused.
  flashMesh.position.copy(pos);
  flashMesh.scale.setScalar(0.5);
  flashMesh.material.opacity = 0.55;
  flashLife = 0.4;
  flashLight.position.copy(pos).y += 1;
  flashLight.intensity = 60;
}

const flashMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false }),
);
scene.add(flashMesh);
const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 24);
scene.add(flashLight);
let flashLife = 0;

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  let pitch = body.pitch;
  let yaw = body.yaw;
  if (shakeTime > 0) {
    pitch += (random() - 0.5) * shakeMag * shakeTime;
    yaw += (random() - 0.5) * shakeMag * shakeTime;
  }
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}

function syncHud() {
  const state = match.state;
  hud.setHealth(playerHealth, state.armor);
  hud.setMoney(state.money);
  hud.setGrenades(state.grenades);
  hud.setScore(state.score.ember, state.score.slate, state.round);
  hud.setTimer(state.timer, state.phase);
  hud.setKillfeed(state.killfeed);
  if (playerGun) hud.setAmmo(playerGun.state.mag, playerGun.state.reserve, match.weaponDef().name);
  if (state.bomb.state === 'planted') {
    hud.showBomb(`BOMB PLANTED — SITE ${state.bomb.site} — ${Math.max(0, Math.ceil(state.bomb.timer))}s`, state.bomb.timer < 10);
  } else if (state.phase !== 'live' || state.bomb.state !== 'carried') {
    hud.hideBomb();
  }
}

function handlePressed(codes) {
  const state = match.state;
  for (const code of codes) {
    if (code === 'KeyB' && state.phase === 'buy' && playerAlive) {
      if (document.getElementById('buy-menu').hidden) hud.showBuy(state.money, state.owned, state.grenades, state.armor);
      else hud.hideBuy();
    }
    if (!document.getElementById('buy-menu').hidden && state.phase === 'buy') {
      const buyIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(code);
      if (buyIndex !== -1) {
        const item = ['kestrel', 'sparrow', 'longbow', 'frag', 'kevlar'][buyIndex];
        const result = match.buy(item);
        if (!result.ok) {
          hud.setBuyHint(result.why);
          audio.denied();
        } else {
          hud.updateBuy(state.money, state.owned, state.grenades, state.armor);
        }
      }
    } else if (state.phase === 'live') {
      const switchIndex = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(code);
      if (switchIndex !== -1) {
        const weaponId = ['p9', 'kestrel', 'sparrow', 'longbow'][switchIndex];
        if (state.owned[weaponId] && weaponId !== state.currentWeapon) {
          state.currentWeapon = weaponId;
          switchGun(weaponId);
        }
      }
      if (code === 'KeyG') throwPlayerGrenade();
    }
    if (code === 'KeyR' && playerGun) {
      if (playerGun.reload()) audio.reload();
    }
  }
}

function channelStep(dt) {
  const state = match.state;
  if (state.phase !== 'live' || !playerAlive) {
    channelKind = null;
    hud.channel(null, null);
    return;
  }
  const keys = input.state.keys;
  const wantPlant = keys.has('KeyE') && state.bomb.state === 'carried' && state.bomb.carrier === 'player';
  const wantDefuse = keys.has('KeyE') && state.bomb.state === 'planted';
  let kind = null;
  let progress = 0;
  if (wantPlant) {
    const site = ['A', 'B'].find((label) => {
      const s = world.sites[label];
      return Math.abs(body.position.x - s.center.x) < s.half && Math.abs(body.position.z - s.center.z) < s.half;
    });
    if (site) {
      kind = 'plant';
      if (channelKind !== 'plant' || !channelStart) channelStart = body.position.clone();
      const moved = body.position.distanceTo(channelStart);
      state.plantProgress = moved > 0.6 ? 0 : state.plantProgress + dt;
      progress = state.plantProgress / 3.5;
      if (state.plantProgress >= 3.5) {
        const siteNode = site === 'A' ? 9 : 13;
        state.plantProgress = 0;
        match.plant(site, siteNode, body.position);
        channelKind = null;
        hud.channel(null, null);
        return;
      }
    } else {
      state.plantProgress = 0;
    }
  }
  if (wantDefuse && !kind) {
    const dist = body.position.distanceTo(state.bomb.pos);
    if (dist < 1.8) {
      kind = 'defuse';
      if (channelKind !== 'defuse' || !channelStart) channelStart = body.position.clone();
      const moved = body.position.distanceTo(channelStart);
      state.defuseProgress = moved > 0.6 ? 0 : state.defuseProgress + dt;
      progress = state.defuseProgress / 5;
      if (Math.floor(elapsed * 2) !== Math.floor((elapsed - dt) * 2)) audio.defuseBeep();
      if (state.defuseProgress >= 5) {
        state.defuseProgress = 0;
        match.defuse();
        channelKind = null;
        hud.channel(null, null);
        return;
      }
    } else {
      state.defuseProgress = 0;
    }
  }
  if (!kind) {
    state.plantProgress = 0;
    state.defuseProgress = 0;
  }
  channelKind = kind;
  if (kind === 'plant') hud.channel('Planting the bomb — hold E', progress);
  else if (kind === 'defuse') hud.channel('Defusing — hold E', progress);
  else hud.channel(null, null);
}

function step(dt) {
  elapsed += dt;
  const state = match.state;
  const alive = {
    ember: (playerAlive ? 1 : 0) + emberBots.filter((bot) => bot.alive).length,
    slate: slateBots.filter((bot) => bot.alive).length,
  };
  match.step(dt, alive);

  // Player movement and actions, skipped while dead or frozen on an overlay.
  if (playerAlive && state.phase !== 'matchEnd') {
    player.step(dt, input.state.keys);
    const look = input.takeLook();
    player.look(look.x, look.y);
    const firing = input.state.firing;
    const def = match.weaponDef();
    if (firing && playerGun.ready() && (def.auto || !prevFiring)) shootPlayer();
    prevFiring = firing;
    playerGun.step(dt);
    stepAccum += dt;
    if (stepAccum > 0.45 && player.groundSpeed() > 3) {
      stepAccum = 0;
      audio.step();
    }
    handlePressed(input.takePressed());
    channelStep(dt);
  } else {
    input.takePressed();
  }

  const ctx = botContext();
  // Freeze time: nobody moves during the buy phase, and the dead stay down.
  if (state.phase !== 'buy' && state.phase !== 'matchEnd') {
    for (const bot of bots) bot.step(dt, ctx);
  } else {
    for (const bot of bots) if (!bot.alive && bot.fall < 1) bot.step(dt, ctx);
  }
  combat.step(dt);
  combat.stepGrenades(dt, {
    bounce: () => audio.grenadeBounce(),
    bang: (pos) => explodeAt(pos),
  });

  // Bomb beeps, faster as the fuse runs down.
  if (state.bomb.state === 'planted') {
    const interval = state.bomb.timer > 20 ? 1 : state.bomb.timer > 10 ? 0.6 : 0.35;
    if (elapsed - lastBeepAt >= interval) {
      lastBeepAt = elapsed;
      audio.plantBeep(false);
    }
  }
  if (shakeTime > 0) shakeTime -= dt;
  if (flashLife > 0) {
    flashLife -= dt;
    flashMesh.scale.addScalar(dt * 22);
    flashMesh.material.opacity = Math.max(0, flashLife / 0.4) * 0.55;
    flashLight.intensity = Math.max(0, flashLife / 0.4) * 60;
    if (flashLife <= 0) flashMesh.material.opacity = 0;
  }
  syncHud();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    accumulator += dt * timeScale;
    let steps = 0;
    const maxSteps = 5 * timeScale;
    while (accumulator >= FIXED_STEP && steps < maxSteps) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * maxSteps) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  audio.unlock();
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (match.state.phase === 'buy') hud.showBuy(match.state.money, match.state.owned, match.state.grenades, match.state.armor);
  } else if (match.state.phase !== 'matchEnd' && playerAlive) {
    hud.showOverlay(started ? 'paused' : 'start');
    hud.hideBuy();
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.state.phase === 'matchEnd') return;
  audio.unlock();
  input.requestLock();
});

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
      return;
    }
    requestAnimationFrame(paint);
  }
  requestAnimationFrame(paint);
}

function aimAtPoint(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideRoundBanner();
  if (name === 'start' || name === 'buy') {
    match.state.phase = 'buy';
    match.state.timer = BUY_TIME;
    body.position.set(0, 0, 15);
    body.yaw = 0;
    body.pitch = 0.02;
    settle(30);
    if (name === 'buy') hud.showBuy(match.state.money, match.state.owned, match.state.grenades, match.state.armor);
    else hud.showOverlay('start');
    syncHud();
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.timer = 78;
    // Stage a firefight down A-long, the open west lane: two defenders up the lane,
    // one friendly on the player's shoulder, the A pylon behind them.
    body.position.set(-14, 0, 6);
    settle(10);
    slateBots[0].position.set(-16, 0, -6);
    slateBots[0].yaw = Math.PI;
    slateBots[1].position.set(-14, 0, -11);
    slateBots[1].yaw = Math.PI;
    emberBots[0].position.set(-11, 0, 9);
    emberBots[0].yaw = 0;
    settle(20);
    aimAtPoint(new THREE.Vector3(slateBots[0].position.x, 1.3, slateBots[0].position.z));
    shootPlayer();
    settle(1);
    aimAtPoint(new THREE.Vector3(slateBots[1].position.x, 1.3, slateBots[1].position.z));
    shootPlayer();
    settle(1);
    syncHud();
  } else if (name === 'end') {
    match.state.score.ember = 1;
    match.state.score.slate = 0;
    match.state.phase = 'roundEnd';
    match.state.timer = 4;
    match.state.roundWinner = 'ember';
    body.position.set(2, 0, 10);
    body.yaw = 0.3;
    settle(10);
    hud.showRoundBanner('EMBER TAKES THE ROUND', 'Slate eliminated — the yard is yours, for now.');
    syncHud();
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.__gameState = () => JSON.stringify({
  phase: match.state.phase,
  round: match.state.round,
  score: match.state.score,
  timer: Math.round(match.state.timer),
  playerHealth,
  playerAlive,
  money: match.state.money,
  armor: match.state.armor,
  grenades: match.state.grenades,
  pos: [Math.round(body.position.x * 10) / 10, Math.round(body.position.z * 10) / 10],
  aliveEmber: (playerAlive ? 1 : 0) + emberBots.filter((bot) => bot.alive).length,
  aliveSlate: slateBots.filter((bot) => bot.alive).length,
  bomb: match.state.bomb.state,
  weapon: match.state.currentWeapon,
  errors: window.__errors,
});

syncCamera();
resetPositions();
match.startRound();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
