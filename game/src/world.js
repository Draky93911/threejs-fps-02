// The map: Ashline Yard, a freight yard at dusk. Two bomb sites, three lanes, and cover
// worth fighting over. Everything is boxes and cylinders with a dusk palette; the ground
// and the containers carry canvas-painted markings, made at runtime, so the game ships
// no image files at all. Every solid is a collider for movement and a surface a bullet
// stops on. The waypoint graph is what the bots walk.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: [x, z] and the lanes they join. Attackers spawn south (z +15), defenders
// north (z -15). A sits north-west, B south-east, mid runs down the middle.
const WAYPOINTS = [
  [0, 15], [-7, 14], [7, 14], // 0-2 attacker spawn
  [0, 8], [0, 0], [0, -8], // 3-5 mid
  [-14, 10], [-17, 0], [-16, -8], [-16, -12], // 6-9 A-long and A site
  [14, 10], [16, 0], [16, 8], [16, 12], // 10-13 B lane and B site
  [-8, 4], [8, -4], [-8, -8], [8, 8], // 14-17 connectors
  [-8, -14], [8, -14], [0, -14], // 18-20 defender spawn
  [-12, -14], [12, -14], // 21-22 defender holds
];
const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 6], [2, 10], [3, 4], [3, 14], [3, 17],
  [4, 5], [4, 14], [4, 15], [5, 16], [5, 19], [5, 20], [6, 7], [7, 8],
  [8, 9], [8, 16], [9, 21], [10, 11], [11, 12], [12, 13], [12, 17],
  [13, 12], [14, 16], [15, 17], [15, 19], [16, 18], [17, 20], [18, 19],
  [19, 20], [18, 21], [20, 22], [9, 18], [13, 22], [2, 17], [1, 14],
];

export const SITES = {
  A: { center: new THREE.Vector3(-16, 0, -12), half: 4.5, label: 'A' },
  B: { center: new THREE.Vector3(16, 0, 12), half: 4.5, label: 'B' },
};

export const SPAWNS = {
  ember: [new THREE.Vector3(-4, 0, 15), new THREE.Vector3(0, 0, 16), new THREE.Vector3(4, 0, 15), new THREE.Vector3(-8, 0, 13)],
  slate: [new THREE.Vector3(-6, 0, -15), new THREE.Vector3(0, 0, -16), new THREE.Vector3(6, 0, -15), new THREE.Vector3(10, 0, -13)],
};

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 896;
  const g = canvas.getContext('2d');
  g.fillStyle = '#20242e';
  g.fillRect(0, 0, 1024, 896);
  // Asphalt speckle.
  for (let i = 0; i < 5200; i += 1) {
    const v = 26 + Math.floor(Math.random() * 22);
    g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
    g.fillRect(Math.random() * 1024, Math.random() * 896, 2, 2);
  }
  // Faded lane lines down mid and the two side lanes.
  g.strokeStyle = 'rgba(240,168,48,0.5)';
  g.lineWidth = 4;
  g.setLineDash([26, 22]);
  g.beginPath(); g.moveTo(512, 40); g.lineTo(512, 856); g.stroke();
  g.beginPath(); g.moveTo(170, 40); g.lineTo(170, 856); g.stroke();
  g.beginPath(); g.moveTo(854, 40); g.lineTo(854, 856); g.stroke();
  g.setLineDash([]);
  // Hazard chevrons ringing each site.
  function hazard(cx, cz, color) {
    g.save();
    g.translate(cx, cz);
    g.strokeStyle = color;
    g.lineWidth = 10;
    for (let i = -3; i <= 3; i += 1) {
      g.beginPath();
      g.moveTo(i * 26 - 12, -52);
      g.lineTo(i * 26 + 12, 52);
      g.stroke();
    }
    g.restore();
  }
  hazard(170, 150, 'rgba(240,168,48,0.75)');
  hazard(854, 746, 'rgba(228,87,46,0.75)');
  // Painted site letters.
  g.font = 'bold 92px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(240,168,48,0.85)';
  g.fillText('A', 170, 180);
  g.fillStyle = 'rgba(228,87,46,0.85)';
  g.fillText('B', 854, 776);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function containerTexture(base, stripe) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 128);
  for (let x = 0; x < 256; x += 16) {
    g.fillStyle = 'rgba(0,0,0,0.16)';
    g.fillRect(x, 0, 5, 128);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.fillRect(x + 8, 0, 3, 128);
  }
  g.fillStyle = stripe;
  g.fillRect(0, 8, 256, 6);
  g.fillStyle = 'rgba(236,231,219,0.8)';
  g.font = 'bold 26px system-ui, sans-serif';
  g.fillText('ASHLINE', 14, 74);
  g.font = '16px system-ui, sans-serif';
  g.fillText('YARD 07', 14, 98);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWorld(scene) {
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
  const containerMatA = new THREE.MeshStandardMaterial({ map: containerTexture('#37455c', '#f0a830'), roughness: 0.85, metalness: 0.08 });
  const containerMatB = new THREE.MeshStandardMaterial({ map: containerTexture('#5c3a2e', '#e4572e'), roughness: 0.85, metalness: 0.08 });
  const containerMatC = new THREE.MeshStandardMaterial({ map: containerTexture('#2e4a3a', '#9aa3b0'), roughness: 0.85, metalness: 0.08 });
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.96, metalness: 0.02 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(radius, height, x, z, material) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 20), material);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Circumscribed box: the collider never lets a player inside the steel.
    const half = radius;
    colliders.push(new THREE.Box3(new THREE.Vector3(x - half, 0, z - half), new THREE.Vector3(x + half, height, z + half)));
    shootables.push(mesh);
    return mesh;
  }

  function pylon(x, z, color, letter) {
    const post = box(0.5, 4.4, 0.5, x, 2.2, z, materials.surface);
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.9, 0.9),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(color), emissive: new THREE.Color(color), emissiveIntensity: 1.6 }),
    );
    lamp.position.set(x, 4.6, z);
    group.add(lamp);
    const light = new THREE.PointLight(new THREE.Color(color), 14, 16);
    light.position.set(x, 4.4, z);
    group.add(light);
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = '#14161a';
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = color;
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, 64, 70);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true }));
    sprite.scale.set(1.6, 1.6, 1);
    sprite.position.set(x, 3.2, z);
    group.add(sprite);
    return post;
  }

  // Ground and outer walls: 48 x 40 m, open to the dusk sky.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(48, 40), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-24, -0.4, -20), new THREE.Vector3(24, 0, 20)));
  shootables.push(ground);
  box(48.8, 5, 0.6, 0, 2.5, -20.3, 'surface');
  box(48.8, 5, 0.6, 0, 2.5, 20.3, 'surface');
  box(0.6, 5, 40.6, -24.3, 2.5, 0, 'surface');
  box(0.6, 5, 40.6, 24.3, 2.5, 0, 'surface');

  // Mid: the container canyon. Two stacked rows leave a zig-zag lane.
  box(6.1, 2.6, 2.5, -2.5, 1.3, -3.5, containerMatA);
  box(6.1, 2.6, 2.5, -2.5, 3.9, -3.5, containerMatB);
  box(6.1, 2.6, 2.5, 3.5, 1.3, 3.5, containerMatB);
  box(6.1, 2.6, 2.5, 3.5, 3.9, 3.5, containerMatC);
  box(2.5, 2.6, 6.1, -5.5, 1.3, 4.5, containerMatC);
  box(2.5, 2.6, 6.1, 6.5, 1.3, -4.5, containerMatA);

  // Crates: low cover to crouch behind, scattered on every lane.
  const crateSpots = [
    [-9, 9, 1.2], [-9.5, 11.5, 1.2], [9, -9, 1.2], [9.5, -11.5, 1.2],
    [-3, -12, 1.1], [4, 12, 1.1], [-12, 4, 1.1], [12, -4, 1.1],
    [-18, -4, 1.2], [18, 4, 1.2], [-2, 6, 0.8], [2, -6, 0.8],
  ];
  for (const [x, z, s] of crateSpots) box(s, s, s, x, s / 2, z, 'hairline');
  box(3.4, 1.1, 1.2, -6, 0.55, -11, 'hairline');
  box(3.4, 1.1, 1.2, 7, 0.55, 11, 'hairline');

  // A site: warehouse corner, an L of tall walls and stacked crates.
  box(0.6, 4.2, 9, -20.5, 2.1, -12, 'surface');
  box(9, 4.2, 0.6, -16, 2.1, -16.5, 'surface');
  box(2.4, 2.4, 2.4, -19, 1.2, -9, containerMatA);
  box(2.4, 1.2, 2.4, -13, 0.6, -15, 'hairline');
  pylon(-16, -12, PALETTE.siteA, 'A');

  // B site: silo yard, two tanks and a low wall.
  cylinder(2.3, 7, 19, 9, materials.surface);
  cylinder(2.3, 7, 19, 15.5, materials.hairline);
  box(9, 1.4, 0.6, 13, 0.7, 16.5, 'surface');
  box(1.2, 1.2, 1.2, 13, 0.6, 9, 'hairline');
  pylon(16, 12, PALETTE.siteB, 'B');

  // Distant skyline silhouettes beyond the walls, for the horizon in screenshots.
  const skyline = new THREE.MeshStandardMaterial({ color: new THREE.Color('#12151c'), roughness: 1 });
  const skyBoxes = [[-30, 9, -28, 14], [10, 14, -30, 10], [34, 7, 12, 12], [-34, 11, 20, 10], [28, 18, -26, 12]];
  for (const [x, h, z, w] of skyBoxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), skyline);
    m.position.set(x, h / 2, z);
    group.add(m);
  }

  // Light: low amber sun from the west, cool dusk fill, and the site lamps above.
  const sky = new THREE.HemisphereLight(new THREE.Color('#33405c'), new THREE.Color('#1a1d24'), 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb45e'), 2.4);
  sun.position.set(-26, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(14, 12, -12);
  scene.add(fill);

  // Waypoint graph: nodes as Vector3, edges as index pairs.
  const nodes = WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
  const adjacency = nodes.map(() => []);
  for (const [a, b] of EDGES) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  // Dijkstra over the graph; returns the node indices from start to goal.
  function findPath(fromIndex, toIndex) {
    const dist = new Array(nodes.length).fill(Infinity);
    const prev = new Array(nodes.length).fill(-1);
    const done = new Array(nodes.length).fill(false);
    dist[fromIndex] = 0;
    for (let step = 0; step < nodes.length; step += 1) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < nodes.length; i += 1) {
        if (!done[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u === -1 || u === toIndex) break;
      done[u] = true;
      for (const v of adjacency[u]) {
        const w = nodes[u].distanceTo(nodes[v]);
        if (dist[u] + w < dist[v]) {
          dist[v] = dist[u] + w;
          prev[v] = u;
        }
      }
    }
    if (dist[toIndex] === Infinity) return [fromIndex];
    const path = [];
    let cur = toIndex;
    while (cur !== -1) {
      path.unshift(cur);
      cur = prev[cur];
    }
    return path;
  }

  return { colliders, shootables, group, nodes, findPath, nearestNode, sites: SITES, spawns: SPAWNS };
}
