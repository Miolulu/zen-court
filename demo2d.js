// demo2d.js — 2.5D 角色验证场景（独立，不依赖 game.js）
import * as THREE from 'three';
import { Monk2D, Cat2D } from './monk2d.js';

const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b7bcb0');
scene.fog = new THREE.Fog('#b7bcb0', 14, 30);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 2.2, 6.2);
camera.lookAt(0, 1.1, 0);

scene.add(new THREE.HemisphereLight('#fff6e6', '#6b7268', 1.05));
const dir = new THREE.DirectionalLight('#fff1d6', 0.8); dir.position.set(3, 8, 5); scene.add(dir);

// 地面
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(10, 48),
  new THREE.MeshStandardMaterial({ color: '#8a9186', roughness: 1 })
);
ground.rotation.x = -Math.PI / 2; scene.add(ground);
// 庭院石板提示圈
const ring = new THREE.Mesh(
  new THREE.RingGeometry(2.3, 2.45, 48),
  new THREE.MeshBasicMaterial({ color: '#7d8478', transparent: true, opacity: 0.5, side: THREE.DoubleSide })
);
ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01; scene.add(ring);

// 香炉（上香参照）
const burner = new THREE.Mesh(
  new THREE.CylinderGeometry(0.28, 0.34, 0.3, 16),
  new THREE.MeshStandardMaterial({ color: '#9aa39b', roughness: 0.7 })
);
burner.position.set(-1.6, 0.15, -0.4); scene.add(burner);

// 2.5D 小沙弥
const monk = new Monk2D({ robe: '#7E8C84', robeShade: '#697871', skin: '#F0D9C0', sash: '#B0492F' });
monk.group.position.set(0, 0, 0); scene.add(monk.group);

// 2.5D 橘猫
const cat = new Cat2D({ fur: '#E0922F', furShade: '#C9771F' });
cat.group.position.set(1.5, 0, 0.3); scene.add(cat.group);
cat.play('idle');

const acts = { pray: { r: 1 }, bow: { r: 1 }, woodfish: { r: 4, loop: true }, beads: { r: 2, loop: true }, lamp: { r: 1 }, incense: { r: 1 }, pet: { r: 3, loop: true } };
document.querySelectorAll('.bar button').forEach(b => {
  b.onclick = () => {
    const a = b.dataset.a;
    if (a === 'pet') { monk.play('pet', { repeat: 3, loop: true }); cat.play('pet'); setTimeout(() => cat.play('idle'), 2600); return; }
    if (a === 'idle') { monk.stop(); return; }
    const o = acts[a]; monk.play(a, { repeat: o.r, loop: o.loop });
  };
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  monk.update(dt, camera);
  cat.update(dt, camera);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
