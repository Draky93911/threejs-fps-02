// Weapons: the numbers and the view models. Four guns and a frag grenade, each with its
// own feel — damage, headshot multiplier, fire rate, magazine, reload, spread and price.
// Spread grows with movement speed, so stopping to aim pays; recoil kicks the aim up.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: {
    id: 'p9', name: 'P9 Wren', kind: 'pistol', price: 0,
    damage: 26, headMult: 3.2, fireGap: 0.16, mag: 12, reserve: 36,
    reloadTime: 1.1, spreadStill: 0.004, spreadMoving: 0.03, auto: false, range: 45,
  },
  kestrel: {
    id: 'kestrel', name: 'Kestrel AR', kind: 'rifle', price: 2700,
    damage: 33, headMult: 3.0, fireGap: 0.1, mag: 30, reserve: 90,
    reloadTime: 2.0, spreadStill: 0.0022, spreadMoving: 0.028, auto: true, range: 80,
  },
  sparrow: {
    id: 'sparrow', name: 'Sparrow SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 2.8, fireGap: 0.068, mag: 28, reserve: 84,
    reloadTime: 1.7, spreadStill: 0.006, spreadMoving: 0.034, auto: true, range: 40,
  },
  longbow: {
    id: 'longbow', name: 'Longbow DMR', kind: 'dmr', price: 4100,
    damage: 78, headMult: 3.5, fireGap: 0.55, mag: 10, reserve: 30,
    reloadTime: 2.6, spreadStill: 0.0009, spreadMoving: 0.05, auto: false, range: 100,
  },
};

export const GRENADE = { id: 'frag', name: 'Frag Grenade', price: 300, maxCarry: 2 };

// View-model shapes, one per kind: boxes only, distinct silhouettes so the held gun
// reads at a glance in the corner of the screen.
const MODEL_SPECS = {
  pistol: { receiver: [0.07, 0.09, 0.26], barrel: [0.04, 0.04, 0.14], stock: [0.06, 0.14, 0.08], barrelZ: -0.18, stockZ: 0.1, stockY: -0.09 },
  rifle: { receiver: [0.09, 0.1, 0.42], barrel: [0.045, 0.045, 0.4], stock: [0.075, 0.08, 0.22], barrelZ: -0.38, stockZ: 0.3, stockY: -0.02 },
  smg: { receiver: [0.08, 0.09, 0.3], barrel: [0.05, 0.05, 0.2], stock: [0.07, 0.07, 0.16], barrelZ: -0.24, stockZ: 0.22, stockY: -0.02 },
  dmr: { receiver: [0.09, 0.1, 0.5], barrel: [0.04, 0.04, 0.55], stock: [0.075, 0.09, 0.26], barrelZ: -0.5, stockZ: 0.34, stockY: -0.02 },
};

export function createWeaponView(camera, def) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const spec = MODEL_SPECS[def.kind] || MODEL_SPECS.rifle;
  const model = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(...spec.receiver), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(...spec.barrel), grip);
  barrel.position.set(0, 0.025, spec.barrelZ);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(...spec.stock), grip);
  stock.position.set(0, spec.stockY, spec.stockZ);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.08), grip);
  sight.position.set(0, 0.07, -0.05);
  model.add(receiver, barrel, stock, sight);
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  const flashTexture = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const g = canvas.getContext('2d');
    const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 30);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,200,90,0.85)');
    gradient.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  })();
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ map: flashTexture, color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  return { model, flash, flashLight };
}

// One held gun: magazine, reserve, cooldown, reload and kick. The shooter (player or
// bot) owns the ray and the damage; this owns the numbers.
export function createGun(camera, def) {
  const view = createWeaponView(camera, def);
  const state = { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0 };

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    view.model.position.z = -0.42 + state.kick;
    view.model.rotation.x = state.kick * 2.2;
    view.flash.visible = state.flash > 0;
    view.flash.rotation.z = state.flash * 30;
    view.flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      view.model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = def.kind === 'dmr' ? 0.11 : 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      return def.spreadStill + Math.min(1, speed / 5.4) * def.spreadMoving;
    },
    refill() {
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    dispose() {
      camera.remove(view.model, view.flash, view.flashLight);
    },
  };
}
