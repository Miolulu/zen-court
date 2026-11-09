/* 小沙弥静修 · 3D 真实在线原型
 * 场景布局参照 sansatemple「清缘堂」：林中敞口木构大殿 + 正中一尊大佛 + 佛后壁画 +
 * 佛前供桌 / 中轴一座香炉 + 每排 10 张、共 5 排 50 张拜垫（中轴留过道）+ 蓝衣呆萌小沙弥 + 寺猫。
 * 礼佛位 6 列 × 3 排 = 18 席，疏朗布置；在线上限由服务端 MAX_PLAYERS 独立控制。
 * 纯场景交互：悬停高亮 → 走过去 → 才能碰；木鱼/念珠/上香/撸猫/点灯有独立放大界面。
 * 生态：寺猫自主巡游/洗脸/打盹/扑落花/蹲蒲团/蹭人/被木鱼惊到，烛火、香烟、池水、鱼、
 *       小沙弥待机呼吸眨眼也各有生命感；点灯每人每日一盏，全庙共见愿望。
 * 无目标、无进度条、无时长限制。美术风格待定，当前为程序化基础几何体。
 *
 * 运行：双击 start.bat（或 node server.js），浏览器开 http://localhost:8787
 */
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 色调分级：线性空间里做极轻的暖调、对比与暗角，最后交给 OutputPass 做 ACES + sRGB
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uWarm: { value: 0.022 },
    uVignette: { value: 0.14 },
    uContrast: { value: 1.02 }
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'uniform sampler2D tDiffuse; uniform float uWarm, uVignette, uContrast; varying vec2 vUv;',
    'void main(){',
    '  vec4 c = texture2D(tDiffuse, vUv);',
    '  c.rgb = (c.rgb - 0.5) * uContrast + 0.5;',
    '  c.r = min(1.0, c.r + uWarm * 0.9);',
    '  c.b = max(0.0, c.b - uWarm * 0.55);',
    '  float v = smoothstep(0.82, 0.20, length(vUv - 0.5) * 1.42);',
    '  c.rgb *= mix(1.0 - uVignette, 1.0, v);',
    '  gl_FragColor = c;',
    '}'
  ].join('\n')
};


// ===================== Blender GLB 资产（tools/gen_blender_models.py 生成） =====================
// monk / cushion / toad / buddha / court 由 Blender 建模导出；加载失败自动回退到程序化建模。
// court.glb = 全场景静态环境（tools/gen_court.py），只含建筑/铺装/树/石灯/池沿，不含任何交互热点。
// GLB 材质按语义命名（robe/skin/cloth/gold...），载入后替换为游戏的 toon / 贴图材质，风格保持统一。
const GLB_CACHE = {};
function preloadGLB() {
  let loader;
  try { loader = new GLTFLoader(); } catch (e) { return Promise.resolve(); }
  // ?nocourt=1 强制走旧的程序化占位几何，用于 A/B 对比与一键回退
  const glbNames = ['monk', 'cushion', 'toad', 'buddha', 'koi', 'coin', 'toad_v2', 'cat_v2'];
  if (!location.search.includes('nocourt')) glbNames.push('court');
  const jobs = glbNames.map((n) =>
    loader.loadAsync('assets/models/' + n + '.glb')
      .then((g) => { GLB_CACHE[n] = g.scene; })
      .catch(() => {}));
  // 和尚 v2（连续曲面袍身 + 袖臂链 + 扁平双掌）：存在即覆盖 v1；
  // 加载失败自动沿用旧 monk.glb，?oldmonk=1 可一键 A/B 回退。
  if (!location.search.includes('oldmonk')) {
    jobs.push(loader.loadAsync('assets/models/monk_v2.glb')
      .then((g) => { GLB_CACHE.monk = g.scene; })
      .catch(() => {}));
  }
  return Promise.all(jobs);
}
const toonMatCache = {};
function toonMat(hex) {
  if (!toonMatCache[hex]) toonMatCache[hex] = new THREE.MeshToonMaterial({ color: hex, gradientMap: toonGradient() });
  return toonMatCache[hex];
}
const GLB_MATS = {
  robe: (t) => toonMat(t),
  robeDark: (t) => toonMat(new THREE.Color(t).multiplyScalar(0.78)),
  skin: () => toonMat(0xf8dcbf),
  ink: () => toonMat(0x332a23),
  ink2: () => toonMat(0x2a1e10),
  sash: () => toonMat(0xd8c08a),
  bead: () => toonMat(0x8f4d2d),
  rope: () => toonMat(0x6b4a2a),
  // v3 宪章：旧金只作勾边/包浆，明度 ≤ #C9B07A，roughness ≥ 0.42、metalness ≤ 0.35。
  // 旧值（gold .36/.62、goldLight .3/.7、urnaGold .35/.6）是「塑料鎏金」的直接来源，全部重标定。
  goldtrim: () => new THREE.MeshStandardMaterial({ color: 0xB49A68, roughness: 0.58, metalness: 0.25 }),
  hi: () => new THREE.MeshBasicMaterial({ color: 0xffffff }),
  blush: () => new THREE.MeshBasicMaterial({ color: 0xc98c82, transparent: true, opacity: 0.28, depthWrite: false }),
  band: () => new THREE.MeshStandardMaterial({ color: 0xb1a17d, roughness: 0.85 }),
  stitch: () => new THREE.MeshStandardMaterial({ color: 0xa89468, roughness: 0.9 }),
  gold: () => new THREE.MeshStandardMaterial({ color: 0xB49A68, roughness: 0.62, metalness: 0.28 }),
  goldDark: () => new THREE.MeshStandardMaterial({ color: 0x8C7448, roughness: 0.72, metalness: 0.20 }),
  goldLight: () => new THREE.MeshStandardMaterial({ color: 0xC9B07A, roughness: 0.55, metalness: 0.30 }),
  buddhaGold: () => new THREE.MeshStandardMaterial({ color: 0xB9A375, roughness: 0.62, metalness: 0.20 }),
  buddhaRobe: () => new THREE.MeshStandardMaterial({ color: 0xA8916C, roughness: 0.82 }),
  lotusGold: () => new THREE.MeshStandardMaterial({ color: 0xB49A68, roughness: 0.62, metalness: 0.24 }),
  // v3 参考图模型材质：白瓷佛身 / 佛墨线 / 白毫金 / 袍摆白衬边 / 拜垫布面
  cloth: () => new THREE.MeshStandardMaterial({ color: 0xdfe6e8, roughness: 0.96 }),
  trim: () => new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.9 }),
  buddhaSkin: () => new THREE.MeshStandardMaterial({ color: 0xf3efe6, roughness: 0.85 }),
  buddhaInk: () => toonMat(0x4a3a28),
  urnaGold: () => new THREE.MeshStandardMaterial({ color: 0xC9B07A, roughness: 0.55, metalness: 0.28 }),
  // 金蟾脚下的池心石：原来依赖 stone.png 贴图，贴图未就绪时会渲染成突兀的纯黑圆盘；
  // v3 改用不依赖外部贴图的低饱和青灰哑光石。
  stone: () => new THREE.MeshStandardMaterial({ color: 0x8A9186, roughness: 0.95 })
};
function findNode(root, name) {
  let r = null;
  root.traverse((o) => { if (!r && o.name === name) r = o; });
  return r;
}
// 取 GLB 里第一份 mesh geometry，供 InstancedMesh / 飞行币复用（保持与建模同源）
function firstMeshGeometry(root) {
  let g = null;
  if (root) root.traverse((o) => { if (!g && o.isMesh && o.geometry) g = o.geometry; });
  return g;
}
// 合十动画骨架：记录双手「家位」（GLB 内已合于胸前的姿）与袖臂静息角。
// 播放时双手从袖口翻起、逐渐合于胸前，两条袖臂同步向中线抬起——
// 修掉「胸口凭空出现两个小圆点、手臂纹丝不动」的组装感。
function makeHandsRig(hands, sleeves) {
  const sl = (sleeves || []).filter(Boolean);
  return {
    home: hands ? { pos: hands.position.clone(), rot: hands.rotation.clone(), scale: hands.scale.clone() } : null,
    rest: sl.map((s) => s.rotation.z),
    restX: sl.map((s) => s.rotation.x),
    sleeves: sl
  };
}
function handsRigApply(h, rig, k) {
  if (!h || !rig || !rig.home) return;
  const e = k * k * (3 - 2 * k);   // smoothstep：起步慢、合拢快
  // 和尚 v2：双掌家位已在袍面之外（不再藏在袍内），sleeveL/R 是袖臂的 pivot Group。
  // 合十 = 整条袖臂绕肩向中线抬起 + 双掌小幅上抬前送，不再做「手穿袍」的硬位移。
  h.position.set(
    rig.home.pos.x,
    rig.home.pos.y + 0.045 * e,
    rig.home.pos.z + 0.035 * e
  );
  h.rotation.set(rig.home.rot.x - 0.06 * e, rig.home.rot.y, rig.home.rot.z);
  const s = 1 + 0.05 * e;
  h.scale.set(rig.home.scale.x * s, rig.home.scale.y * s, rig.home.scale.z * s);
  rig.sleeves.forEach((sl, i) => {
    const sgn = i === 0 ? 1 : -1;   // 左袖向右、右袖向左，整条袖臂向中线合拢
    sl.rotation.z = rig.rest[i] + sgn * 0.50 * e;
    sl.rotation.x = (rig.restX ? rig.restX[i] : 0) + 0.42 * e;
  });
}
function applyGameMaterials(root, tint) {
  root.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const name = Array.isArray(o.material) ? o.material[0].name : o.material.name;
    // v3 重建模型自带烘焙 albedo/normal/AO，材质名统一 v3_* 前缀；
    // 这里绝不能按语义名覆盖成纯色，否则贴图被丢掉，重建等于白做。
    if (typeof name === 'string' && name.indexOf('v3_') === 0) return;
    const f = GLB_MATS[name];
    if (f) o.material = f(tint);
  });
}

// ===================== 配置 =====================
// ws 同源动态生成；托管网关要求升级请求带上页面的 sharecode（没有就直连，本地/Pages 单人模式）
const WS_SC = (() => { const s = new URLSearchParams(location.search).get('sharecode'); return s ? ('?sharecode=' + encodeURIComponent(s)) : ''; })();
const CONFIG = {
  USE_REMOTE: true,
  WS_URL: (location.protocol === 'https:' ? 'wss://' : 'ws://') + (location.host || 'localhost:8787') + WS_SC,
  REACH: 2.6,                 // 交互半径：超出就必须先走过去
  WALK_SPEED: 3.6,
  SAVE_KEY: 'zen-court-save-v1',
  CO_KEY: 'zen-court-co-v1',
  NAME_KEY: 'zen-court-name-v1',
  CAT_MAX: 9999
};
// ---- 同修社交：预设短句（服务端只传索引，天然零 UGC / 零审核依赖） ----
const CHAT_LINES = [
  '此刻风很好', '一起听会儿钟', '这池水真静', '愿你心安',
  '同坐片刻', '今日月色不错', '且共一炷香', '慢慢来，不急',
  '随喜', '山门深处有松声', '我在此处，不必回', '合十'
];
const GREET_DUR = 1.85;   // 完整行礼：起手 .55 → 定住 .35 → 微躬 .45 → 收手回落 .5
let greetAnim = 0, chatPeerId = null, selfBubble = null;
const bubbleTimers = {};
function greetK(remain) {
  if (remain <= 0) return 0;
  const t = GREET_DUR - remain;
  if (t < 0.55) return t / 0.55;
  if (t < 0.90) return 1;
  if (t < 1.35) return 1 - (t - 0.90) / 0.45 * 0.12;
  return Math.max(0, (GREET_DUR - t) / 0.5);   // 收手回落，手不再「弹」回去
}
function playGreet() { greetAnim = GREET_DUR; }

const META = {
  clasp:   { name: '合掌',   verb: '合十',     gain: 1 },
  bow:     { name: '拜垫',   verb: '拜一拜',   gain: 2 },
  worship: { name: '祈福像', verb: '礼拜',     gain: 2 },
  fish:    { name: '木鱼',   verb: '敲一敲',   gain: 1, focus: true },
  beads:   { name: '念珠',   verb: '拨一拨',   gain: 1, focus: true },
  lamp:    { name: '长明灯', verb: '点一盏灯', gain: 3, focus: true },
  incense: { name: '香炉',   verb: '上一炷香', gain: 3, focus: true },
  pet:     { name: '庙里的猫', verb: '撸一撸', gain: 1, focus: true },
  coin:    { name: '荷池金蟾', verb: '抛一枚硬币', gain: 1, focus: true },
  sweep:   { name: '落叶堆', verb: '扫一扫', gain: 2 }
};
// 布局对齐 sansatemple「清缘堂」：正中一尊大佛 + 佛后壁画 + 佛前供桌 + 中轴香炉 + 成排拜垫。
// 原站每排 10 垫、共 10 排 100 席（对应单房 100 人，fr(i): x=(e-5)*2.4/(e-4)*2.4, z=-8.4+排*2.8）。
// 氛围观赏型：6 列 × 3 排 = 18 席，间距拉开、单垫放大，殿前留白让佛堂成为主体。
// 拜垫区从月台前沿（z=-5.0）之后开始，石灯 / 石栏 / 荷池全部让到阵列之外，不再压在垫子上。
const CUSHION_COLS = 6, CUSHION_ROWS = 3;      // 18 席，不再密铺 50 张
const CUSHION_X_STEP = 2.45, CUSHION_Z_STEP = 2.9, CUSHION_Z0 = -3.9;  // 净间隙 X 0.82 / Z 1.27，疏朗
const TERRACE_TOP = 0.16, TERRACE_FRONT = -5.0;      // 月台高度与前沿
const POND = { x: 0, z: 7.0, r: 2.35, spot: { x: 3.15, z: 7.0 } };  // 荷池居院子正中（中轴上、拜垫之南）：金蟾蹲池心石上，东岸立足投币
const CUSHION_HALF_W = (CUSHION_COLS - 1) / 2 * CUSHION_X_STEP + 0.7, CUSHION_BACK = CUSHION_Z0 - 0.7, CUSHION_FRONT = CUSHION_Z0 + (CUSHION_ROWS - 1) * CUSHION_Z_STEP + 0.7;
const CUSHION_SEATS = CUSHION_COLS * CUSHION_ROWS;   // 18 席礼佛位（在线容量另由 MAX_PLAYERS 决定）
const MAIN_BUDDHA = {
  x: 0, y: 0, z: -11.4, scale: 1.0, big: true,
  title: '静照', wish: '大佛', color: 0xe8c275, robe: 0xc79a4e, prop: 'lotus'
};
const STATUES = [MAIN_BUDDHA];
const Bounds = { x: 14.6, z: 10.4 };
const WALK_Z_MIN = -5.15;   // 走不到月台里侧，避免人陷进殿基
// 地面高度：月台上抬一层；拜垫抬高由 nearestCushion 单独叠
function groundYAt(x, z) {
  if (z < TERRACE_FRONT && Math.abs(x) < 12.6 && z > -15) return TERRACE_TOP;
  return 0;
}
// 可行走落点约束：不出院、不上殿基、不下荷池
function clampWalk(x, z) {
  let nx = clamp(x, -Bounds.x, Bounds.x);
  let nz = clamp(z, WALK_Z_MIN, Bounds.z);
  const dx = nx - POND.x, dz = nz - POND.z, d = Math.hypot(dx, dz);
  if (d < POND.r + 0.5) {
    const k = (POND.r + 0.5) / (d || 0.001);
    nx = POND.x + (dx || 0.001) * k; nz = POND.z + dz * k;
  }
  return { x: nx, z: nz };
}
const CAPACITY = 50;   // 与服务端 MAX_PLAYERS 一致，仅用于 HUD 文案
// 同修统一蓝色系僧袍（参考大慈寺「圆一」与宝光寺萌和尚的灰蓝僧衣）
// v3：从高饱和钴蓝收敛到「宣纸米 / 墨青 / 朱砂 / 旧金」体系内的雾青灰（jade 派生），
// 同修之间只做明度差，不新增色相；与准写实大殿同频。
const ROBE_BLUES = [0x788B80, 0x6C7F75, 0x84968B, 0x5F7168, 0x7E9086, 0x6B7E74, 0x8B9C92, 0x71847A];
const NAME_KEY = CONFIG.NAME_KEY;

// ===================== 存储 / 计时 =====================
function defaultSave() { return { totalMerit: 0, catAffection: 0, lampsLit: 0, lastVisit: '', lampDate: '', lampWish: '', coinDate: '', coinCount: 0, coinHit: 0 }; }
let save = defaultSave();
function loadSave() {
  try { const raw = localStorage.getItem(CONFIG.SAVE_KEY); if (raw) { const p = JSON.parse(raw); for (const k in save) if (p[k] !== undefined) save[k] = p[k]; } } catch (e) {}
}
function persist() { try { localStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
// 测试辅助：?wipe=1 直接清空本地存档（绕过 confirm 弹窗，便于自动化验证）
if (new URLSearchParams(location.search).has('wipe')) {
  try { localStorage.removeItem(CONFIG.SAVE_KEY); localStorage.removeItem(CONFIG.CO_KEY); localStorage.removeItem(CONFIG.NAME_KEY); } catch (e) {}
}
function localDateStr() { const d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
// 断线/离线时的本地兜底：服务端在线时以 welcome.lamps 为准
function localLamp() {
  if (save.lampDate === localDateStr() && save.lampWish) return { name: myName || '我', wish: save.lampWish, date: save.lampDate, litAt: 0, local: true };
  return null;
}
function saveLocalLamp(l) { save.lampDate = l.date || localDateStr(); save.lampWish = l.wish; persist(); }
// ---- 荷池投币：真实许愿池语义，数据不清理 --------------------------------
// 服务端 pond-coins.json 是权威；前端只负责把最近 500 枚画成 InstancedMesh。
// 旧实现的四处「清理」全部移除：跨天清零 / 上限 18 / 每枚 new+dispose / 落定后删除。
let pondCoinData = [], pondCoinTotal = 0, pondCoinMesh = null;
const POND_COIN_COLORS = [0xB49A68, 0x8C7448, 0xA8916C, 0x788B80]; // 旧金 → 暗铜 → 铜锈
function coinToday() { return pondCoinTotal; }   // 兼容旧调用，不再跨天清零
function addLocalCoin(dx, dz, rot) {
  pondCoinData.push({ x: dx, z: dz, rot: rot || Math.random() * 6.28, variant: (Math.random() * 4) | 0 });
  if (pondCoinData.length > 500) pondCoinData.shift();
  pondCoinTotal += 1;
  refreshPondCoins();
}
function addCoin(x, z) {
  const dx = clamp(x - POND.x, -2.1, 2.1), dz = clamp(z - POND.z, -1.9, 1.9);
  // 在线时由服务端权威记录并广播给全院；离线时本地兜底，刷新后以服务端为准。
  if (Net && Net.coinDrop && myId !== null) Net.coinDrop(dx, dz);
  else addLocalCoin(dx, dz);
}
function refreshPondCoins() {
  if (!pondCoinsGroup || !scene) return;
  if (!pondCoinMesh) {
    // 真·方孔铜钱几何（coin.glb），不再是实心金色圆柱
    const geo = firstMeshGeometry(GLB_CACHE.coin) || new THREE.CylinderGeometry(0.105, 0.105, 0.024, 16);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.28 });
    pondCoinMesh = new THREE.InstancedMesh(geo, mat, 500);
    pondCoinMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    pondCoinMesh.raycast = () => {};
    pondCoinMesh.castShadow = false;
    pondCoinsGroup.add(pondCoinMesh);
  }
  const n = Math.min(pondCoinData.length, 500);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const c = pondCoinData[i];
    dummy.position.set(POND.x + c.x, 0.030 + (i % 3) * 0.0015, POND.z + c.z);
    dummy.rotation.set((i % 5 - 2) * 0.055, c.rot || i * 0.7, (i % 4 - 2) * 0.045);
    dummy.updateMatrix();
    pondCoinMesh.setMatrixAt(i, dummy.matrix);
    pondCoinMesh.setColorAt(i, new THREE.Color(POND_COIN_COLORS[(c.variant || 0) % 4]));
  }
  pondCoinMesh.count = n;
  pondCoinMesh.instanceMatrix.needsUpdate = true;
  if (pondCoinMesh.instanceColor) pondCoinMesh.instanceColor.needsUpdate = true;
}

let sessionSeconds = 0;
let co = { date: '', names: [], seconds: 0 };
function loadCo() { try { const raw = localStorage.getItem(CONFIG.CO_KEY); if (raw) { const p = JSON.parse(raw); if (p.date === localDateStr()) { co.date = p.date; co.names = p.names || []; co.seconds = p.seconds || 0; } } } catch (e) {} }
function persistCo() { try { co.date = localDateStr(); localStorage.setItem(CONFIG.CO_KEY, JSON.stringify(co)); } catch (e) {} }
function addCoName(name) { if (name && co.names.indexOf(name) < 0) { co.names.push(name); persistCo(); } }
function fmtTime(s) { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ':' + ('0' + m).slice(-2) : ('0' + m).slice(-2)) + ':' + ('0' + ss).slice(-2); }

// 法号：服务端随机赐名，sessionStorage 只用于刷新/重连时沿用
let myName = null, greeted = false;
function loadMyName() { try { myName = sessionStorage.getItem(NAME_KEY) || null; } catch (e) {} }
function saveMyName(n) { myName = n; try { sessionStorage.setItem(NAME_KEY, n); } catch (e) {} }

// ===================== 合成音效（无素材） =====================
const Sound = (function () {
  let ctx = null, master = null, muted = false, purrNodes = null, chant = null;
  function ensure() { if (ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return; ctx = new AC(); master = ctx.createGain(); master.gain.value = muted ? 0 : 0.5; master.connect(ctx.destination); }
  function unlock() { ensure(); if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function tone(freq, dur, type, vol, glideTo) {
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, ctx.currentTime + dur);
    g.gain.value = 0; g.gain.linearRampToValueAtTime(vol || 0.3, ctx.currentTime + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + dur + 0.03);
  }
  function chime() { ensure(); tone(660, 1.4, 'sine', 0.3); tone(1320, 1.2, 'sine', 0.1); }

  // 写实音效：播放 tools/gen_sfx.py 离线生成的模态合成采样（中空木腔 + 木槌瞬态）。
  // 采样没加载好时用简版模态合成兜底，不再是电子振荡器那种「嘀」声。
  const samples = { fish: [], beads: [], lamp: null };
  let samplesLoading = false;
  function loadSamples() {
    ensure(); if (!ctx || samplesLoading || !ctx.decodeAudioData) return;
    samplesLoading = true;
    const list = [];
    for (let i = 1; i <= 4; i++) { list.push(['fish', './sfx/woodfish-' + i + '.wav'], ['beads', './sfx/beads-' + i + '.wav']); }
    list.push(['lamp', './sfx/lamp.wav']);
    list.forEach(([kind, url]) => {
      fetch(url).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then((b) => new Promise((res, rej) => ctx.decodeAudioData(b, res, rej)))
        .then((buf) => { if (kind === 'lamp') samples.lamp = buf; else samples[kind].push(buf); })
        .catch(() => {});
    });
  }
  function fallback(kind) {
    if (!ctx) return;
    const dur = kind === 'fish' ? 0.34 : 0.09;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    const modes = kind === 'fish'
      ? [[196, .6, .09], [372, .35, .06], [588, .2, .04], [894, .12, .025]]
      : [[1980, .5, .012], [3180, .3, .008], [640, .2, .02]];
    for (let i = 0; i < n; i++) {
      const t = i / ctx.sampleRate; let v = 0;
      for (const [f, a, tau] of modes) v += a * Math.exp(-t / tau) * Math.sin(2 * Math.PI * f * t);
      v += (Math.random() * 2 - 1) * Math.exp(-t / 0.0018) * 0.4;
      d[i] = Math.tanh(v * 1.2) * 0.85;
    }
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 0.7; s.connect(g); g.connect(master); s.start();
  }
  function play(kind, vol) {
    ensure(); if (!ctx || !master) return;
    let buf = null;
    if (kind === 'lamp') buf = samples.lamp;
    else { const arr = samples[kind]; if (arr && arr.length) buf = arr[(Math.random() * arr.length) | 0]; }
    if (!buf) { fallback(kind); return; }
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.playbackRate.value = 0.97 + Math.random() * 0.06;   // 每次略有差别，避免机械重复
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'beads' ? 9000 : 6800;
    const g = ctx.createGain(); g.gain.value = vol || 0.85;
    src.connect(lp); lp.connect(g); g.connect(master); src.start();
  }
  function woodfish() { play('fish', 0.9); }
  function tick() { play('beads', 0.72); }
  function lamp() { play('lamp', 0.95); }
  function purrStart() {
    ensure(); if (!ctx || purrNodes) return;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 55;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 26;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    lfo.connect(lfoG); lfoG.connect(g.gain); g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + 0.3);
    o.connect(g); g.connect(master); o.start(); lfo.start(); purrNodes = { o, lfo, g };
  }
  function purrStop() {
    if (!purrNodes || !ctx) return; const n = purrNodes;
    n.g.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    n.o.stop(ctx.currentTime + 0.35); n.lfo.stop(ctx.currentTime + 0.35); purrNodes = null;
  }
  // 诵经氛围：低频人声般的持续嗡鸣 + 缓慢呼吸起伏 + 偶尔轻磬，全程实时合成
  function chantStart() {
    ensure(); if (!ctx || chant) return;
    const bus = ctx.createGain(); bus.gain.value = 0.0001; bus.connect(master);
    const breath = ctx.createGain(); breath.gain.value = 0.7; breath.connect(bus);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4; lp.connect(breath);
    const oscs = [110, 164.8, 220, 277.2].map((f, i) => {
      const o = ctx.createOscillator(); o.type = i % 2 ? 'sine' : 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = 0.075 / (i + 1);
      o.connect(g); g.connect(lp); o.start(); return o;
    });
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.2;
    lfo.connect(lg); lg.connect(breath.gain); lfo.start();
    bus.gain.setValueAtTime(0.0001, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(0.6, ctx.currentTime + 2.2);
    const bell = setInterval(() => { if (!muted) { tone(523.25, 3.4, 'sine', 0.045); tone(784, 2.8, 'sine', 0.02); } }, 7200);
    chant = { bus, breath, lp, oscs, lfo, bell };
  }
  function chantStop() {
    if (!chant || !ctx) return; const n = chant; chant = null;
    clearInterval(n.bell);
    n.bus.gain.cancelScheduledValues(ctx.currentTime);
    n.bus.gain.setValueAtTime(Math.max(0.0001, n.bus.gain.value), ctx.currentTime);
    n.bus.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.9);
    setTimeout(() => { try { n.oscs.forEach(o => o.stop()); n.lfo.stop(); n.bus.disconnect(); } catch (e) {} }, 1100);
  }
  function setMute(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.5; }
  return { unlock, loadSamples, chime, woodfish, tick, lamp, purrStart, purrStop, chantStart, chantStop, setMute };
})();

// ===================== Three 全局 =====================
let renderer, scene, camera, raycaster, pointer, composer = null, usePost = false, gradePass = null, introT = 0;
let ground, monkObj, catObj, bowPivot, hands, woodfishMesh, beadsMesh, incenseMesh, pondCoinsGroup = null;
let monkRig = null;   // 合十动画骨架（双手家位 + 袖臂静息角），buildMonk 时赋值
let monkLower = null, monkKnees = null;
let cushions = [], statues = [], lanternMeshes = [], incenseSmoke = [], leafPiles = [];
let petalGeo, petalPoints, hearts = [], heartTex = null, smokeTex = null, petalCount = 150;
let interactables = [], hoverRing = null, hovered = null, pending = null;
let activeCushion = null;
// 生态：猫的可动部件与状态机、烛火/池水/小鱼/逗猫光点、愿签
let catParts = null, catLife = null, monkEyes = null, monkHead = null;
let toadObj = null, toadParts = null;
let flames = [], pondRings = [], pondFish = null, lure = null, wishTags = [], coinFx = [], koiSchool = [];
// 每日愿灯（服务端按法号+日期权威限制）
let todayLamps = [], myLamp = null, lampBusy = false, lampTimeout = null;
const peers = {};
let myId = null;
let state = 'playing';
let time = 0, hudT = 0, coPersistT = 3;
const target = new THREE.Vector3(0, 0, 2.4);
let monkPose = 'idle', monkPoseT = 0;
// 猫窝放在拜垫阵列外的左前方树下，猫自己会溜进殿前、蹲蒲团、蹭人
const catBase = new THREE.Vector3(-8.2, 0, 8.9), catTarget = catBase.clone();
// 庭院落叶堆：银杏落叶聚成小堆，走近扫一扫会散开，过一会儿又在别处落出一堆
const LEAF_SPOTS = [[-12.6, 3.2], [12.9, 3.0], [-6.6, 9.6], [7.4, 9.9], [-13.6, 6.4], [13.4, 7.2]];
let focusMode = false, focusKind = null, focusCount = 0;
let kneeling = false, kneelT = 0;
let monkYaw = Math.PI, monkYawTarget = Math.PI;   // 当前朝向 / 目标朝向（弧度）
// 美术层：贴地软阴影、佛光、萤火、自己头顶的法号牌
let statueHalo = null, monkShadow = null, catShadow = null, fireflies = null, kneelGlow = null;
let selfLabel = null, entryTimer = null, sceneGuardUntil = 0;
const el = {};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// 最短弧转身：限制每帧角速度，才能看见「侧身转过去」而不是瞬间翻面
function turnTo(cur, want, maxStep) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) <= maxStep ? want : cur + Math.sign(d) * maxStep;
}
function moveToward(pos, tgt, step) { const dx = tgt.x - pos.x, dz = tgt.z - pos.z, d = Math.hypot(dx, dz); if (d > 0.02) { const s = Math.min(d, step); pos.x += dx / d * s; pos.z += dz / d * s; } }
function $(id) { return document.getElementById(id); }

// ===================== 美术资源：原画 + 平铺贴图 + 绘本色阶 =====================
const ART = './assets/art/';
const Tex = {
  // 单次用途的贴图（原画 / 壁画 / 精灵），不重复平铺
  flat(name) {
    const t = new THREE.TextureLoader().load(ART + name);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  },
  // 可平铺材质贴图。每个用途独立加载，避免 clone() 在异步加载完成前拿到空 image
  tile(name, rx, ry) {
    const t = new THREE.TextureLoader().load(ART + name);
    if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = 8;
    return t;
  }
};
let toonRamp = null, glowTex = null;
function toonGradient() {
  if (toonRamp) return toonRamp;
  // 四阶明暗：让角色与猫读起来像绘本，而不是塑料球
  toonRamp = new THREE.DataTexture(new Uint8Array([96, 168, 222, 255]), 4, 1, THREE.RedFormat);
  toonRamp.minFilter = toonRamp.magFilter = THREE.NearestFilter;
  toonRamp.needsUpdate = true;
  return toonRamp;
}
function glowTexture() {
  if (!glowTex) glowTex = new THREE.TextureLoader().load(ART + 'glow.png');
  return glowTex;
}
// 贴地的软阴影：Plane + 径向 alpha，比真阴影便宜，也不会被阴影相机裁掉
function softShadow(size, opacity) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0x2b2c26, transparent: true,
    opacity: opacity == null ? 0.3 : opacity, depthWrite: false, fog: false
  }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.035;
  m.scale.set(size || 1.6, (size || 1.6) * 0.7, 1);
  return m;
}
function softGlow(size, color, opacity) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(), color: color, transparent: true,
    opacity: opacity == null ? 0.5 : opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  s.scale.set(size, size, 1);
  return s;
}
// 绘本描边：复制一份略大的背面网格
function inkOutline(mesh, scale) {
  const o = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({
    color: 0x40372c, side: THREE.BackSide, fog: true
  }));
  o.scale.setScalar(scale || 1.055);
  o.raycast = () => {};
  mesh.add(o);
  return o;
}

// ===================== 程序化贴图 =====================

// 程序化微凹凸：给石板 / 木构补一层极淡的表面起伏，斜阳下才有材质呼吸感
function makeBumpTexture(size) {
  size = size || 128;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const n = 112 + Math.random() * 34;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = n;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function makeSkyTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256; const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3a4a63'); grd.addColorStop(0.5, '#7e8593'); grd.addColorStop(1, '#d8c4a0');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function heartTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#e6738a'; g.beginPath(); g.moveTo(32, 52); g.bezierCurveTo(4, 30, 12, 8, 32, 22); g.bezierCurveTo(52, 8, 60, 30, 32, 52); g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t;
}
function softDotTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grd.addColorStop(0, 'rgba(226,230,226,0.75)'); grd.addColorStop(0.5, 'rgba(210,216,212,0.28)'); grd.addColorStop(1, 'rgba(210,216,212,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
// 匾额：木底金边 + 楷体吉语，贴在殿檐与佛龛上方
function plaqueTexture(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const g = c.getContext('2d');
  g.fillStyle = '#2a1a12'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#b9913f'; g.lineWidth = 9; g.strokeRect(9, 9, 494, 142);
  g.strokeStyle = 'rgba(212,175,55,.35)'; g.lineWidth = 2; g.strokeRect(22, 22, 468, 116);
  g.fillStyle = '#ecd393'; g.font = 'bold 84px "Kaiti SC","STKaiti","KaiTi","SimSun",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 86);
  const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// 佛后壁画：柔光背轮 + 远山，对应官网 altar-wall 的位置，不画具体宗教图像
function muralTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, 512);
  bg.addColorStop(0, '#3d4a45'); bg.addColorStop(0.62, '#606a58'); bg.addColorStop(1, '#96906f');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = 'rgba(52,70,63,' + (0.12 + i * 0.035) + ')';
    g.beginPath(); g.moveTo(-40 + i * 130, 512);
    g.quadraticCurveTo(60 + i * 135, 250 + (i % 3) * 48, 200 + i * 130, 512);
    g.fill();
  }
  const halo = g.createRadialGradient(512, 218, 24, 512, 218, 300);
  halo.addColorStop(0, 'rgba(247,222,158,.78)'); halo.addColorStop(0.42, 'rgba(224,193,127,.32)');
  halo.addColorStop(1, 'rgba(224,193,127,0)');
  g.fillStyle = halo; g.fillRect(180, 0, 664, 512);
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = 'rgba(240,214,156,' + (0.3 - i * 0.08) + ')'; g.lineWidth = 3;
    g.beginPath(); g.arc(512, 218, 96 + i * 42, 0, Math.PI * 2); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t;
}
// 愿签：挂在被点亮的长明灯下的小木牌，写点亮者的法号（完整愿望靠 hover 查看）
function wishTagTexture(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#3b2718'; g.fillRect(0, 0, 256, 128);
  g.strokeStyle = '#c9a24a'; g.lineWidth = 5; g.strokeRect(7, 7, 242, 114);
  g.fillStyle = '#f0d9a0'; g.font = 'bold 62px "Kaiti SC","STKaiti","KaiTi","SimSun",serif';
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 68);
  const t = new THREE.CanvasTexture(c); if (THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ===================== 角色：蓝衣呆萌小沙弥（中性、不区分性别） =====================
// 主路径用 Blender 建模的 monk.glb（回转体袍形 + 穿绳挂珠），同名节点 lower/bowPivot/grpHands/
// head/eyeL/eyeR/hiL/hiR/kneeL/kneeR 与程序化版完全对应，动画代码零改动；加载失败回退程序化版。
function buildMonk(tint) {
  if (GLB_CACHE.monk) {
    const group = GLB_CACHE.monk.clone(true);
    applyGameMaterials(group, tint);
    const robe = findNode(group, 'robe'), head = findNode(group, 'head');
    const lower = findNode(group, 'lower');
    const bowPivot = findNode(group, 'bowPivot');
    const hands = findNode(group, 'grpHands');
    const sleeves = [findNode(group, 'sleeveL'), findNode(group, 'sleeveR')];
    const eyes = ['eyeL', 'eyeR'].map((n) => ({ ball: findNode(group, n), hi: findNode(group, n === 'eyeL' ? 'hiL' : 'hiR') }));
    const knees = [findNode(group, 'kneeL'), findNode(group, 'kneeR')];
    // 部件完整性校验：GLB 里缺任何一个动画节点就整体回退程序化建模
    if (lower && bowPivot && hands && head && robe && eyes.every((e) => e.ball && e.hi) && knees.every(Boolean)) {
      // v3 宪章：取消全身等宽黑描边（inkOutline），否则新模型的衣纹/掌形会被压成卡通。
      hands.visible = false;
      knees.forEach((k) => { k.visible = false; });
      return { group, lower, bowPivot, hands, head, eyes, knees, rig: makeHandsRig(hands, sleeves) };
    }
  }
  return buildMonkProcedural(tint);
}
function buildMonkProcedural(tint) {
  const group = new THREE.Group();
  // 上下身分离：跪拜时只有上身前俯下沉，鞋和膝始终贴着垫面，不再整个人沉进地面
  const lower = new THREE.Group(); group.add(lower);
  const bowPivot = new THREE.Group(); group.add(bowPivot);
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  const robe = toon(tint);
  const robeDark = toon(new THREE.Color(tint).multiplyScalar(0.78));
  const skin = toon(0xf8dcbf);
  const ink = toon(0x332a23);
  const blush = new THREE.MeshBasicMaterial({ color: 0xe99a92, transparent: true, opacity: 0.55, depthWrite: false });
  const beadMat = toon(0x8f4d2d);

  // ---- 下身：袍脚 / 腰带 / 僧鞋 / 跪时露出的双膝 ----
  const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.72, 0.42, 20), robeDark);
  hem.position.y = 0.26; lower.add(hem);
  const sash = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.12, 20), toon(0xd8c08a));
  sash.position.y = 0.62; lower.add(sash);
  const shoeGeo = new THREE.SphereGeometry(0.19, 12, 10);
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(shoeGeo, ink); sh.scale.set(1, 0.55, 1.35);
    sh.position.set(s * 0.28, 0.11, 0.18); lower.add(sh);
  }
  const knees = [];
  const kneeGeo = new THREE.SphereGeometry(0.24, 14, 10);
  for (const s of [-1, 1]) {
    const k = new THREE.Mesh(kneeGeo, robe);
    k.scale.set(1, 0.68, 1.15); k.position.set(s * 0.29, 0.24, 0.42);
    k.visible = false; lower.add(k); knees.push(k);
  }

  // ---- 上身：圆袍 / 斜襟 / 双袖 / 大头 ----
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.66, 24, 18), robe);
  body.scale.set(1, 1.12, 0.94); body.position.y = 0.86; bowPivot.add(body);
  inkOutline(body, 1.05);
  const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.9, 0.05), robeDark);
  lapel.position.set(-0.16, 1.05, 0.58); lapel.rotation.z = -0.38; bowPivot.add(lapel);
  const sleeveGeo = new THREE.SphereGeometry(0.28, 14, 12);
  const sleeves = [];
  for (const s of [-1, 1]) {
    const sl = new THREE.Mesh(sleeveGeo, robeDark);
    sl.scale.set(0.85, 1.05, 0.9); sl.position.set(s * 0.6, 1.02, 0.05);
    sl.rotation.z = s * 0.26; bowPivot.add(sl); sleeves.push(sl);
  }
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.51, 26, 20), skin);
  head.position.y = 1.78; bowPivot.add(head);
  inkOutline(head, 1.045);
  const earGeo = new THREE.SphereGeometry(0.1, 10, 8);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(earGeo, skin); e.position.set(s * 0.5, 1.76, 0.01); bowPivot.add(e); }
  // 圆眼 + 高光 + 淡眉
  const eyeGeo = new THREE.SphereGeometry(0.075, 12, 10);
  const hiGeo = new THREE.SphereGeometry(0.026, 8, 8);
  const hiMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, ink); e.scale.set(0.85, 1.15, 0.5);
    e.position.set(s * 0.19, 1.83, 0.46); bowPivot.add(e);
    const h = new THREE.Mesh(hiGeo, hiMat); h.position.set(s * 0.19 - 0.022, 1.86, 0.5); bowPivot.add(h);
    const brow = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.012, 5, 10, Math.PI), ink);
    brow.position.set(s * 0.19, 1.98, 0.455); brow.rotation.z = s * 0.12; bowPivot.add(brow);
    eyes.push({ ball: e, hi: h });
  }
  const blushGeo = new THREE.CircleGeometry(0.105, 16);
  for (const s of [-1, 1]) { const b = new THREE.Mesh(blushGeo, blush); b.position.set(s * 0.34, 1.68, 0.42); bowPivot.add(b); }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.016, 6, 14, Math.PI), ink);
  mouth.position.set(0, 1.64, 0.485); mouth.rotation.z = Math.PI; bowPivot.add(mouth);
  // 挂脖念珠
  const beadGeo = new THREE.SphereGeometry(0.055, 8, 8);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const b = new THREE.Mesh(beadGeo, beadMat);
    b.position.set(Math.sin(a) * 0.42, 1.3 - Math.cos(a) * 0.1, Math.cos(a) * 0.4);
    bowPivot.add(b);
  }
  // 合十双手
  const hands = new THREE.Group();
  const handGeo = new THREE.SphereGeometry(0.13, 12, 10);
  const h1 = new THREE.Mesh(handGeo, skin), h2 = new THREE.Mesh(handGeo, skin);
  h1.position.set(-0.1, 1.16, 0.5); h2.position.set(0.1, 1.16, 0.5);
  hands.add(h1); hands.add(h2); hands.visible = false; bowPivot.add(hands);
  return { group, lower, bowPivot, hands, head, eyes, knees, rig: makeHandsRig(hands, sleeves) };
}

// ===================== 寺猫（圆润、可动部件齐全，供生态行为驱动） =====================
function buildCat() {
  // v2：连续曲面躯干 + 有厚度耳廓 + 锥形尾，取代 40 个相切球堆出来的简笔猫
  if (GLB_CACHE.cat_v2) {
    const cg = GLB_CACHE.cat_v2.clone(true);
    const parts = {
      body: findNode(cg, 'body'), belly: findNode(cg, 'belly'), head: findNode(cg, 'head'),
      tailPivot: findNode(cg, 'tailPivot'), nose: findNode(cg, 'nose'),
      ears: [findNode(cg, 'earL'), findNode(cg, 'earR')],
      eyes: [findNode(cg, 'eyeL'), findNode(cg, 'eyeR')],
      paws: [findNode(cg, 'pawL'), findNode(cg, 'pawR')],
      hind: [findNode(cg, 'hindL'), findNode(cg, 'hindR')]
    };
    if (parts.body && parts.head && parts.tailPivot &&
        parts.ears.every(Boolean) && parts.eyes.every(Boolean) && parts.paws.every(Boolean)) {
      cg.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 1.2),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
      hit.position.set(0.15, 0.7, 0); cg.add(hit);
      // 记录 GLB 基准变换：updateCatLife 原来用绝对值摆姿态，会把新模型拆散；
      // v2 一律走「基准 + 增量」，只做相对幅度。
      [parts.body, parts.belly, parts.head, parts.tailPivot, parts.nose]
        .concat(parts.ears, parts.eyes, parts.paws, parts.hind)
        .forEach(o => {
          if (!o) return;
          o.userData.basePos = o.position.clone();
          o.userData.baseScale = o.scale.clone();
          o.userData.baseRot = o.rotation.clone();
        });
      parts.v2 = true;
      return { group: cg, parts };
    }
  }
  const g = new THREE.Group();
  const toon = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: toonGradient() });
  // 布偶猫配色（对齐撸猫面板与理想参考图）：奶油底色 + 深棕重点色（耳/背/尾）
  const fur = toon(0xece2d0);
  const furDark = toon(0x5c4434);
  const point = toon(0x6b5240);
  const white = toon(0xf9efd9);
  const ink = toon(0x332720);
  const pink = new THREE.MeshBasicMaterial({ color: 0xe89c94, transparent: true, opacity: 0.62, depthWrite: false });

  // 身形：胸在 +x、臀在 -x，中间略收，读起来是猫而不是一颗球
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 22, 16), fur);
  body.scale.set(1.25, 0.85, 0.9); body.position.y = 0.5; g.add(body);
  inkOutline(body, 1.04);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.31, 18, 14), fur);
  chest.scale.set(0.96, 0.96, 0.92); chest.position.set(0.3, 0.5, 0); g.add(chest);
  const haunch = new THREE.Mesh(new THREE.SphereGeometry(0.35, 18, 14), fur);
  haunch.scale.set(1, 0.98, 0.98); haunch.position.set(-0.3, 0.47, 0); g.add(haunch);
  // 前胸白毛：贴着胸口，不另起一颗球
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12), white);
  belly.scale.set(0.92, 0.9, 0.66); belly.position.set(0.35, 0.52, 0); g.add(belly);
  // 背上的虎斑：贴在背线的扁椭球，不会像圆环那样悬空
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), furDark);
    s.scale.set(0.62, 0.2, 1.08); s.position.set(-0.16 + i * 0.2, 0.85, 0);
    s.rotation.z = -0.12; g.add(s);
  }

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 24, 18), fur);
  head.position.set(0.56, 0.78, 0); head.scale.set(1, 0.96, 1); g.add(head);
  inkOutline(head, 1.05);
  // 脸颊两团绒毛：让脸不是标准球
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), fur);
    c.scale.set(0.82, 0.9, 1); c.position.set(0.62, 0.68, s * 0.2); g.add(c);
  }
  const ears = [], eyes = [], paws = [], hind = [];
  const earGeo = new THREE.ConeGeometry(0.14, 0.26, 4);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(earGeo, point);
    e.position.set(0.54, 1.0, s * 0.18); e.rotation.z = -0.16; e.rotation.y = Math.PI / 4; g.add(e); ears.push(e);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.072, 0.15, 4), pink);
    inner.position.set(0.575, 1.0, s * 0.18); inner.rotation.z = -0.16; inner.rotation.y = Math.PI / 4; g.add(inner);
  }
  // 眼：竖瞳更像猫；高光单独一颗
  const eyeGeo = new THREE.SphereGeometry(0.058, 12, 10);
  const pupilGeo = new THREE.SphereGeometry(0.03, 10, 8);
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, ink);
    e.scale.set(0.8, 1.15, 0.55); e.position.set(0.83, 0.83, s * 0.125); g.add(e); eyes.push(e);
    const p = new THREE.Mesh(pupilGeo, new THREE.MeshBasicMaterial({ color: 0x0a0806 }));
    p.scale.set(0.9, 1.5, 0.5); p.position.set(0.87, 0.83, s * 0.125); g.add(p);
    const hi = new THREE.Mesh(new THREE.SphereGeometry(0.017, 6, 5), new THREE.MeshBasicMaterial({ color: 0xfff8ea }));
    hi.position.set(0.885, 0.855, s * 0.145); g.add(hi);
  }
  // 口鼻：两瓣白颊 + 三角鼻 + 一张小嘴
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8), white);
    m.scale.set(1, 0.9, 1); m.position.set(0.8, 0.68, s * 0.062); g.add(m);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), toon(0xc4786c));
  nose.scale.set(0.9, 0.8, 1); nose.position.set(0.855, 0.715, 0); g.add(nose);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 5, 10, Math.PI), ink);
  mouth.position.set(0.845, 0.665, 0); mouth.rotation.set(Math.PI / 2, 0, Math.PI); g.add(mouth);
  const whiskerMat = new THREE.MeshBasicMaterial({ color: 0xf7ead2, transparent: true, opacity: 0.55 });
  for (const s of [-1, 1]) for (let k = -1; k <= 1; k++) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.3, 4), whiskerMat);
    w.rotation.z = Math.PI / 2; w.rotation.y = s * (0.3 + k * 0.18);
    w.position.set(0.86, 0.68 + k * 0.045, s * 0.14); g.add(w);
  }

  // 前腿：脚与小腿打成一个组，抬爪时整条腿跟着动
  for (const s of [-1, 1]) {
    const lg = new THREE.Group(); lg.position.set(0.62, 0.12, s * 0.185);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), fur);
    paw.scale.set(1.25, 0.7, 0.95); lg.add(paw);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.32, 8), fur);
    shin.position.set(-0.02, 0.16, 0); lg.add(shin);
    g.add(lg); paws.push(lg);
  }
  // 后腿：蹲踞的折腿 + 落地脚掌
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), fur);
    h.scale.set(1, 1.05, 0.92); h.position.set(-0.3, 0.3, s * 0.25); g.add(h); hind.push(h);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), fur);
    foot.scale.set(1.35, 0.62, 0.95); foot.position.set(-0.16, 0.075, s * 0.25); g.add(foot);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.07, 0.22, 8), fur);
    shin.position.set(-0.2, 0.16, s * 0.25); shin.rotation.z = 0.24; g.add(shin);
  }

  // 尾巴：曲线管，尾根挂在 pivot 上，摆尾时整条尾跟着弯
  const tailPivot = new THREE.Group(); tailPivot.position.set(-0.52, 0.56, 0); g.add(tailPivot);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.24, 0.1, 0.03),
    new THREE.Vector3(-0.38, 0.34, 0.08), new THREE.Vector3(-0.34, 0.56, 0.02)
  ]);
  const tail = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.062, 7, false), fur);
  tailPivot.add(tail);
  const tailTip = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), fur);
  tailTip.position.set(-0.34, 0.56, 0.02); tailPivot.add(tailTip);
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.058, 0.014, 5, 10), furDark);
    const p = curve.getPoint(0.35 + i * 0.2);
    ring.position.copy(p); ring.rotation.x = Math.PI / 2 - 0.5; tailPivot.add(ring);
  }

  g.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 1.2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.position.set(0.15, 0.7, 0); g.add(hit);
  return { group: g, parts: { body, belly, head, tailPivot, ears, eyes, paws, hind, nose } };
}

// ===================== 四类 Q 版吉语祈福像 =====================
function buildStatue(def) {
  const g = new THREE.Group();
  g.position.set(def.x, def.y || 0, def.z);
  g.scale.setScalar(def.scale || 1);
  const wood = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 2, 1), roughness: 0.86 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x7a4c2c, roughness: 0.72 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd6b169, roughness: 0.44, metalness: 0.32 });
  const cream = new THREE.MeshStandardMaterial({ color: 0xf0ddba, roughness: 0.8 });

  // 深色佛龛衬底：浅色水彩立绘要靠暗底才不会被背景与柔光洗白
  const nicheBack = new THREE.Mesh(new THREE.BoxGeometry(4.7, 6.5, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x332a22, roughness: 0.95 }));
  nicheBack.position.set(0, 3.62, -0.94); g.add(nicheBack);

  // 立绘背后的柔光：慢慢呼吸，光效由代码叠加而不是画进图里；压在立绘之后渲染
  statueHalo = softGlow(6.6, 0xffdca2, 0.18);
  statueHalo.position.set(0, 3.75, -0.8); statueHalo.renderOrder = 1; g.add(statueHalo);

  // 立体坐佛（Blender 建模 buddha.glb）：结跏趺坐 + 螺髻 + 禅定印，坐在金边莲台上；
  // GLB 加载失败时回退到原水彩立绘平面版
  if (GLB_CACHE.buddha) {
    const bd = GLB_CACHE.buddha.clone(true);
    applyGameMaterials(bd);
    bd.scale.setScalar(2.08);   // 主尊略增存在感，佛龛木框 6.4 高仍框得住
    bd.position.set(0, 1.02, -0.2);
    g.add(bd);
  } else {
    const icon = new THREE.Mesh(new THREE.PlaneGeometry(4.25, 6.38),
      new THREE.MeshBasicMaterial({
        map: Tex.flat('buddha.webp'), transparent: true, alphaTest: 0.02,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false
      }));
    icon.position.set(0, 3.62, -0.3); icon.renderOrder = 3; g.add(icon);
  }

  // 佛龛木框：两根立柱 + 额枋 + 底座，中轴留空让立绘完整露出
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.3, 6.4, 0.5), frame);
    p.position.set(s * 2.22, 3.5, -0.72); g.add(p);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.24, 0.62), gold);
    cap.position.set(s * 2.22, 6.78, -0.72); g.add(cap);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(4.9, 0.3, 0.55), frame);
  lintel.position.set(0, 6.72, -0.72); g.add(lintel);
  const sill = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.22, 0.6), gold);
  sill.position.set(0, 0.98, -0.55); g.add(sill);

  // 3D 莲瓣分两层托住立绘里的莲台（上层错位半瓣），加金边莲台盘
  const lotusDisc = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.56, 0.14, 28),
    new THREE.MeshStandardMaterial({ color: 0xc9a25c, roughness: 0.5, metalness: 0.35 }));
  lotusDisc.position.set(0, 0.92, -0.3); g.add(lotusDisc);
  const petalGeo = new THREE.SphereGeometry(0.30, 12, 9);
  for (let layer = 0; layer < 2; layer++) {
    const n = 12, rr = layer ? 1.04 : 1.3, py = layer ? 1.12 : 0.98;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (layer ? Math.PI / n : 0);
      const p = new THREE.Mesh(petalGeo, cream);
      p.scale.set(0.62, 0.28, 1.15);
      p.position.set(Math.cos(a) * rr, py, Math.sin(a) * rr * 0.42 - 0.3);
      p.rotation.y = -a; p.rotation.x = 0.14;
      g.add(p);
    }
  }

  // 供桌 + 烛台 + 供果（中轴香炉在殿外另有一座）
  const table = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.2, 0.9), wood);
  table.position.set(0, 1.02, 1.25); g.add(table);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.0, 0.2), wood);
    leg.position.set(s * 1.85, 0.5, 1.25); g.add(leg);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.34, 10), cream);
    candle.position.set(s * 1.25, 1.28, 1.25); g.add(candle);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffc46a }));
    flame.position.set(s * 1.25, 1.52, 1.25); g.add(flame);
    const fg = softGlow(0.9, 0xffb457, 0.5); fg.position.set(s * 1.25, 1.52, 1.28); g.add(fg);
    flames.push({ mesh: flame, base: flame.position.clone(), phase: Math.random() * 9, rate: 3.1 + Math.random(), kind: 'candle' });
  }
  // 贡品：中央果盘三色供果 + 左侧一盏清茶 + 右侧一碟糕点（烛台在外侧不动）
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(
    [[0.0, 0.0], [0.18, 0.0], [0.26, 0.06], [0.30, 0.15], [0.29, 0.18]].map(p => new THREE.Vector2(p[0], p[1])), 18), wood);
  bowl.position.set(0, 1.12, 1.25); g.add(bowl);
  const fruitCols = [0xd98b4a, 0xc94f43, 0xe0b14e];
  fruitCols.forEach((fc, i) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.105 + (i === 1 ? 0.02 : 0), 14, 12),
      new THREE.MeshStandardMaterial({ color: fc, roughness: 0.75 }));
    const fx = (i - 1) * 0.15;
    f.position.set(fx, 1.35 + (i === 1 ? 0.02 : 0), 1.25 - Math.abs(fx) * 0.4); g.add(f);
  });
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.055, 0.09, 12),
    new THREE.MeshStandardMaterial({ color: 0xe7e2d4, roughness: 0.4 }));
  cup.position.set(-0.75, 1.17, 1.25); g.add(cup);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.035, 14),
    new THREE.MeshStandardMaterial({ color: 0xdcd6c6, roughness: 0.5 }));
  plate.position.set(0.75, 1.14, 1.25); g.add(plate);
  for (let i = 0; i < 3; i++) {
    const pa = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.055, 10),
      new THREE.MeshStandardMaterial({ color: 0xe2c489, roughness: 0.85 }));
    pa.position.set(0.75 + (i - 1) * 0.09, 1.19 + (i === 1 ? 0.045 : 0), 1.25 + (i % 2) * 0.07 - 0.03); g.add(pa);
  }

  // 装饰件不参与射线，只留一个可控点击盒，避免佛龛背板抢走附近物事的点击
  g.traverse(o => { if (o.isMesh || o.isSprite) o.raycast = () => {}; });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(3.9, 5.4, 1.4),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.position.set(0, 3.3, 0.1); g.add(hit);
  return g;
}

// ===================== 荷池金蟾（三足 · 口衔铜钱 · 背驮七星） =====================
// 主路径用 Blender 建模的 toad.glb（named: toadBody/toadEyeL/toadEyeR/grpCoin），失败回退程序化版。
function buildToad() {
  // v2：一体曲面泥胎金蟾（癞瘤/三足/方孔钱），自带 v3_* 材质，不能被纯色覆盖
  const useV2 = !!GLB_CACHE.toad_v2;
  const src = useV2 ? GLB_CACHE.toad_v2 : GLB_CACHE.toad;
  if (src) {
    const g = src.clone(true);
    if (!useV2) applyGameMaterials(g);
    const parts = {
      body: findNode(g, 'toadBody'),
      head: findNode(g, 'toadHead'),
      eyes: [findNode(g, 'toadEyeL'), findNode(g, 'toadEyeR')].filter(Boolean),
      coin: findNode(g, 'grpCoin')
    };
    if (parts.body && parts.coin && parts.eyes.length === 2) {
      g.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
      const hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.6),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
      hit.position.set(0, 0.7, 0); g.add(hit);
      return { group: g, parts };
    }
  }
  return buildToadProcedural();
}
function buildToadProcedural() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd8a94c, roughness: 0.36, metalness: 0.62, flatShading: false });
  const goldDark = new THREE.MeshStandardMaterial({ color: 0xa87c30, roughness: 0.44, metalness: 0.55 });
  const goldLt = new THREE.MeshStandardMaterial({ color: 0xefd08a, roughness: 0.3, metalness: 0.7 });
  const ink = new THREE.MeshBasicMaterial({ color: 0x2a1e10 });

  // 石座：从水里露出来的一块扁石
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.92, 0), new THREE.MeshStandardMaterial({ map: Tex.tile('stone.png', 1, 1), color: 0x8f9290, roughness: 0.98 }));
  rock.scale.set(1.25, 0.46, 1.05); rock.position.y = 0.16; g.add(rock);

  // 蟾身：宽扁鼓腹，前低后高
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.56, 24, 18), gold);
  body.scale.set(1.2, 0.82, 1.02); body.position.set(0, 0.62, -0.02); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 16), gold);
  head.scale.set(1.1, 0.8, 0.95); head.position.set(0, 0.78, 0.38); g.add(head);
  // 下巴/喉咙的褶
  const throat = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), goldLt);
  throat.scale.set(1.06, 0.5, 0.72); throat.position.set(0, 0.6, 0.5); g.add(throat);

  // 凸眼 + 竖瞳：金蟾的眼睛要能看出「活」
  const eyes = [];
  for (const s of [-1, 1]) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.125, 14, 12), gold);
    bulb.position.set(s * 0.235, 1.02, 0.34); g.add(bulb);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), ink);
    pupil.scale.set(0.9, 1.15, 0.5); pupil.position.set(s * 0.235, 1.03, 0.44); g.add(pupil);
    eyes.push(pupil);
  }
  // 宽嘴：一道深色弧，铜钱就衔在这道口里
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.032, 6, 18, Math.PI), ink);
  mouth.position.set(0, 0.74, 0.61); mouth.rotation.set(Math.PI / 2, 0, 0); g.add(mouth);

  // 口衔铜钱：正面朝外，中间方孔；这是金蟾「吐宝」的核心符号
  const coin = new THREE.Group(); coin.position.set(0, 0.7, 0.63);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 20), goldLt);
  disc.rotation.x = Math.PI / 2; coin.add(disc);
  const hole = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.05), ink);
  hole.rotation.z = Math.PI / 4; coin.add(hole);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 6, 22), goldDark);
  coin.add(ring);
  g.add(coin);

  // 三足：两只前脚 + 一只后脚（少了的那条腿正是金蟾的来历）
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), gold);
    leg.scale.set(0.9, 0.7, 1.25); leg.position.set(s * 0.42, 0.34, 0.34); g.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), goldDark);
    foot.scale.set(1.15, 0.4, 1.35); foot.position.set(s * 0.44, 0.28, 0.46); g.add(foot);
  }
  const hind = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), gold);
  hind.scale.set(1, 0.7, 1.3); hind.position.set(0, 0.32, -0.4); g.add(hind);

  // 疣粒：稀疏几颗，别铺成麻子
  for (let i = 0; i < 9; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.038, 7, 6), goldDark);
    const a = i * 2.1, r = 0.3 + (i % 3) * 0.09;
    s.position.set(Math.cos(a) * r, 0.98 + (i % 2) * 0.06, -0.28 + Math.sin(a) * r * 0.6);
    g.add(s);
  }
  // 背驮北斗七星
  const starPos = [[-0.22, 0.98, -0.32], [0.02, 1.0, -0.38], [0.22, 0.99, -0.26], [0.18, 0.94, 0.02], [-0.06, 0.95, 0.04], [-0.26, 0.95, -0.06], [-0.4, 0.9, 0.12]];
  for (const [sx, sy, sz] of starPos) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), goldLt);
    s.position.set(sx, sy, sz); g.add(s);
  }
  // 脚下散着的几枚小钱
  for (const [cx, cz, rot] of [[0.5, 0.0, 0.4], [-0.48, 0.12, -0.7], [0.2, -0.5, 1.2]]) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), goldLt);
    c.rotation.set(Math.PI / 2, 0, rot); c.position.set(cx, 0.3, cz); g.add(c);
  }

  g.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.6),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.position.set(0, 0.7, 0); g.add(hit);
  return { group: g, parts: { body, head, eyes, coin } };
}

// ===================== 场景搭建 =====================
// 松树：弯曲主干 + 真实分枝 + 一撮撮扁平松针团（不是圆锥堆成的圣诞树）
function buildPine(scale) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 1, 3), color: 0x766450, roughness: 1, flatShading: true });
  const leafA = new THREE.MeshStandardMaterial({ color: 0x536b5c, roughness: 1, flatShading: true });
  const leafB = new THREE.MeshStandardMaterial({ color: 0x6b8070, roughness: 1, flatShading: true });
  const padGeo = new THREE.IcosahedronGeometry(0.6, 0);   // 棱面块叶：写意松针团，不再是圆滚滚的西兰花

  // 主干分三段，每段带一点侧倾，读起来是一棵长歪了的松
  let y = 0, leanX = 0, leanZ = 0;
  const segs = [[0.34, 0.27, 1.9], [0.27, 0.2, 1.75], [0.2, 0.12, 1.6]];
  for (let i = 0; i < segs.length; i++) {
    const [r1, r2, h] = segs[i];
    leanX += (i - 1) * 0.055; leanZ += (i % 2 ? 0.045 : -0.03);
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r2, r1, h, 9), bark);
    seg.position.set(leanX, y + h / 2, leanZ); seg.rotation.z = -leanX * 0.5; seg.rotation.x = leanZ * 0.5;
    seg.castShadow = true; g.add(seg);
    // 段间留一点重叠，接缝不露空
    y += h * 0.93;
  }

  // 枝层：越往上越小；每层绕轴错开，避免对称感
  const levels = [
    { y: 1.7, r: 1.62, n: 5, s: 1.05 },
    { y: 2.65, r: 1.32, n: 4, s: 0.88 },
    { y: 3.5, r: 0.98, n: 4, s: 0.7 },
    { y: 4.25, r: 0.6, n: 3, s: 0.5 }
  ];
  levels.forEach((lv, li) => {
    const phase = li * 1.15;
    for (let i = 0; i < lv.n; i++) {
      const a = phase + (i / lv.n) * Math.PI * 2;
      const rr = lv.r * (0.82 + (i % 3) * 0.09);
      const cx = Math.cos(a) * rr + leanX * 0.6, cz = Math.sin(a) * rr + leanZ * 0.6;
      const cy = lv.y - (i % 2) * 0.12;
      // 一根细枝把树冠和主干连起来，侧面看不会「树冠悬空」
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.075, rr + 0.25, 5), bark);
      limb.position.set(cx * 0.55, cy - 0.08, cz * 0.55);
      limb.rotation.z = Math.PI / 2 - Math.atan2(cy - lv.y + 1.1, rr + 0.25);
      limb.rotation.y = -a;
      g.add(limb);
      const pad = new THREE.Mesh(padGeo, i % 2 ? leafB : leafA);
      pad.position.set(cx, cy, cz);
      pad.scale.set(lv.s * (1.18 + (i % 2) * 0.12), lv.s * 0.34, lv.s * (1.06 + (i % 3) * 0.08));
      pad.rotation.y = a * 1.7;
      pad.castShadow = true; g.add(pad);
    }
  });
  // 树尖
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 7), leafB);
  tip.position.set(leanX * 0.8, 4.55, leanZ * 0.8); tip.scale.set(1, 0.6, 1); g.add(tip);

  g.scale.setScalar(scale || 1);
  g.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = true; } });
  return g;
}
// 银杏：主干 + 三枝 + 扇形暖黄树冠
function buildGinkgo(scale) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 1, 3), color: 0x6d5c4a, roughness: 1, flatShading: true });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb9a26e, roughness: 1, flatShading: true });
  const goldLt = new THREE.MeshStandardMaterial({ color: 0xcbb885, roughness: 1, flatShading: true });
  const green = new THREE.MeshStandardMaterial({ color: 0x879072, roughness: 1, flatShading: true });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.38, 3.0, 9), bark);
  trunk.position.y = 1.5; trunk.rotation.z = 0.045; g.add(trunk);
  const branchGeo = new THREE.CylinderGeometry(0.07, 0.16, 1.5, 6);
  const crown = [
    [0.02, 3.55, 0, 1.15, gold], [-0.92, 3.15, 0.28, 0.86, goldLt], [0.9, 3.2, -0.2, 0.8, gold],
    [0.32, 3.05, 0.86, 0.72, goldLt], [-0.36, 3.0, -0.86, 0.7, green],
    [-0.1, 4.15, 0.12, 0.62, gold], [0.55, 3.85, 0.42, 0.5, goldLt]
  ];
  for (const [cx, cy, cz, s, mat] of crown) {
    const limb = new THREE.Mesh(branchGeo, bark);
    const d = Math.hypot(cx, cz) || 0.4;
    limb.position.set(cx * 0.45, cy - 0.55, cz * 0.45);
    limb.rotation.z = Math.atan2(cx, 2.0) * -1;
    limb.rotation.x = Math.atan2(cz, 2.0);
    g.add(limb);
    const pad = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 0), mat);
    pad.position.set(cx, cy, cz); pad.scale.set(s, s * 0.66, s * 0.92);
    pad.castShadow = true; g.add(pad);
  }
  g.scale.setScalar(scale || 1);
  g.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = true; } });
  return g;
}

function buildPetals() {
  // 银杏叶精灵：不再是粉色小方点，而是与院中银杏树呼应的暖黄落叶
  petalCount = 110;
  petalGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(petalCount * 3);
  for (let i = 0; i < petalCount; i++) {
    pos[i * 3] = (Math.random() * 2 - 1) * 20;
    pos[i * 3 + 1] = Math.random() * 13;
    pos[i * 3 + 2] = (Math.random() * 2 - 1) * 18;
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  petalPoints = new THREE.Points(petalGeo, new THREE.PointsMaterial({
    map: Tex.flat('leaf.png'), color: 0xf3d18c, size: 0.44,
    transparent: true, opacity: 0.9, alphaTest: 0.08,
    sizeAttenuation: true, depthWrite: false
  }));
  scene.add(petalPoints);
}
function buildIncenseBurner() {
  const g = new THREE.Group();
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8a7d5e, roughness: 0.44, metalness: 0.62, flatShading: false });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4c4434, roughness: 0.6, metalness: 0.45 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a45e, roughness: 0.38, metalness: 0.7 });

  // 腹身：车削出「鼓腹 → 收颈 → 外撇口」的鼎形，而不是一个直筒
  const profile = [
    [0.16, 0.56], [0.40, 0.58], [0.60, 0.66], [0.74, 0.80],
    [0.83, 0.98], [0.85, 1.14], [0.78, 1.26], [0.86, 1.34], [0.90, 1.38]
  ].map(p => new THREE.Vector2(p[0], p[1]));
  const belly = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), bronze);
  belly.castShadow = true; g.add(belly);
  // 底：封一片，避免从下方看穿
  const bottom = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), dark);
  bottom.rotation.x = Math.PI / 2; bottom.position.y = 0.575; g.add(bottom);
  // 口沿 + 腹间一道弦纹
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.885, 0.05, 8, 30), gold);
  rim.rotation.x = Math.PI / 2; rim.position.y = 1.385; g.add(rim);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.845, 0.028, 6, 30), gold);
  band.rotation.x = Math.PI / 2; band.position.y = 1.03; g.add(band);

  // 三足：上粗下细、略外撇，足底落地
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + i * Math.PI * 2 / 3;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.075, 0.62, 8), bronze);
    leg.position.set(Math.cos(a) * 0.5, 0.32, Math.sin(a) * 0.5);
    leg.rotation.z = -Math.cos(a) * 0.14; leg.rotation.x = Math.sin(a) * 0.14;
    leg.castShadow = true; g.add(leg);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), dark);
    foot.scale.set(1, 0.62, 1); foot.position.set(Math.cos(a) * 0.545, 0.06, Math.sin(a) * 0.545); g.add(foot);
  }

  // 双耳：立在口沿上的方环，鼎的标志性轮廓
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.052, 7, 18, Math.PI * 1.15), bronze);
    ear.position.set(s * 0.80, 1.46, 0); ear.rotation.y = Math.PI / 2; ear.rotation.z = -Math.PI * 0.08 * s;
    ear.castShadow = true; g.add(ear);
    const stud = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), gold);
    stud.position.set(s * 0.80, 1.30, 0); g.add(stud);
  }

  // 香灰：浅浅一层，香支从灰里立起来
  const ash = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.78, 0.07, 26),
    new THREE.MeshStandardMaterial({ color: 0xa8a08c, roughness: 1 }));
  ash.position.y = 1.32; g.add(ash);

  // 炉中原有的三炷残香
  const stickMat = new THREE.MeshStandardMaterial({ color: 0x9c5f31, roughness: 0.9 });
  const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8a45 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.7;
    const px = Math.cos(a) * 0.3, pz = Math.sin(a) * 0.3;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.86, 6), stickMat);
    st.position.set(px, 1.75, pz);
    st.rotation.z = -px * 0.18; st.rotation.x = pz * 0.18; g.add(st);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.032, 7, 6), emberMat);
    tip.position.set(px + px * 0.16, 2.18, pz + pz * 0.16); g.add(tip);
  }

  // 袅袅青烟
  if (!smokeTex) smokeTex = softDotTexture();
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.28, depthWrite: false }));
    s.position.set((Math.random() - 0.5) * 0.26, 2.28 + i * 0.42, (Math.random() - 0.5) * 0.26);
    s.scale.setScalar(0.48 + i * 0.15); g.add(s);
    incenseSmoke.push({ spr: s, base: i });
  }
  g.traverse(o => { if (o.isMesh || o.isSprite) o.raycast = () => {}; });
  const hit = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.7, 2.0),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.position.set(0, 1.25, 0); g.add(hit);
  return g;
}


// ===================== 全场景静态环境 court.glb（Blender 精建） =====================
// tools/gen_court.py 生成：举折起翘屋面 / 筒瓦瓦垄瓦当 / 斗拱 / 车削柱 / 棂条格扇 /
// 须弥座台基 / 望柱栏板 / 石板铺装与御道 / 分叉松树银杏 / 六角石灯 / 荷池石沿。
// 材质按语义名（court*）导出，这里统一接到清雅水墨色板，风格与 4 个角色 GLB 一致。
const COURT_PALETTE = {
  courtStone: 0xC6C1B3, courtStoneDark: 0xB7B2A5, courtStoneLight: 0xCEC9BB,
  courtMoss: 0xA9AE9B, courtPlaster: 0xBEAE98,
  courtWood: 0x96574C, courtWoodDark: 0x6B443C, courtWoodLight: 0xAE7D6C,
  courtTile: 0x3C4541, courtTileLight: 0x51605A,
  courtGold: 0xB49A68, courtGoldDark: 0x8C7448,
  courtPine: 0x4A5C4E, courtPineLight: 0x66795F, courtPineDark: 0x39483D,
  courtTrunk: 0x5A4638, courtGinkgo: 0xB49A68, courtGinkgoLt: 0xC9B07A
};
function applyCourtMaterials(root) {
  const bump = makeBumpTexture(); bump.repeat.set(9, 9);
  const cache = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    const src = Array.isArray(o.material) ? o.material[0] : o.material;
    const name = (src && src.name) || '';
    if (name.indexOf('court') !== 0) return;
    if (!cache[name]) {
      const isTile = name.indexOf('courtTile') === 0;
      cache[name] = new THREE.MeshStandardMaterial({
        color: COURT_PALETTE[name] || 0xc7c1b0,
        roughness: name.indexOf('courtGold') === 0 ? 0.58 : 0.9,
        metalness: name.indexOf('courtGold') === 0 ? 0.28 : 0,
        bumpMap: bump, bumpScale: 0.012,
        side: isTile ? THREE.DoubleSide : THREE.FrontSide
      });
    }
    o.material = cache[name];
    // 只让大轮廓投影：瓦垄/瓦当/棂条/椽子/脊饰这些细节在 1024 阴影贴图里
    // 本来就看不见，却会让阴影 pass 从 ~20k 面涨到 62k 面，手机端是实打实的负担。
    const detail = /^(paving|roof_tiles|roof_wadang|roof_ridge|roof_chiwen|roof_gable|halo|altar_trim|columns_trim|platform_trim|platform_step|platform_edge|balustrade|plaque|lantern|lattice|rafters)/.test(o.name);
    o.castShadow = !detail;
    o.receiveShadow = true;
    o.raycast = () => {};   // 静态环境不参与拾取，点击穿透到 ground（行走照常）
  });
}
function mountCourt() {
  const c = GLB_CACHE.court.clone(true);
  c.name = 'courtEnvironment';
  applyCourtMaterials(c);
  scene.add(c);

  // 匾额文字与佛后壁画是代码生成的贴图层，必须叠在 GLB 木框/后墙之前
  const bigPlaque = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.5),
    new THREE.MeshBasicMaterial({ map: plaqueTexture('静 照 院'), transparent: true, toneMapped: false }));
  bigPlaque.position.set(0, 6.5, -7.59); bigPlaque.raycast = () => {}; scene.add(bigPlaque);
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 6.6),
    new THREE.MeshBasicMaterial({ map: Tex.flat('mural.jpg'), fog: false }));
  mural.position.set(0, 3.72, -13.9); mural.raycast = () => {}; scene.add(mural);

  // 石灯笼的火袋在 GLB 里是镂空六角角柱，暖光由这里补回
  for (const sx of [-9.6, 9.6]) {
    const fire = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.30, 0.46, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8d9ae, emissive: 0xffb45e, emissiveIntensity: 0.72, roughness: 0.8 }));
    fire.position.set(sx, 1.52, -2.6); fire.raycast = () => {}; scene.add(fire);
    const lg = softGlow(2.0, 0xffc078, 0.22);
    lg.position.set(sx, 1.55, -2.6); lg.raycast = () => {}; scene.add(lg);
  }
  return c;
}

function buildScene() {
  flames = []; pondRings = []; wishTags = [];
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdcd6c6);
  scene.fog = new THREE.Fog(0xdcd6c6, 28, 96);   // 雾色介于远山底部与石板之间，地面远端充分沉入雾里

  // 远山雾景原画：衬在寺院背后，不吃雾、不吃色调映射，像一张画
  // 加宽到 260：横屏 aspect 2.16 的水平视野更宽，180 会露出平面左右边缘
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(260, 110),
    new THREE.MeshBasicMaterial({ map: Tex.flat('backdrop.jpg'), fog: false, depthWrite: false, toneMapped: false }));
  backdrop.position.set(0, 16, -72); backdrop.renderOrder = -10; scene.add(backdrop);

  // 光：右上方暖金斜阳 + 冷色天光补面 + 佛前一点暖光；主光投柔和阴影
  scene.add(new THREE.HemisphereLight(0xf3ebd8, 0x6c7269, 0.74));   // 略降平光，留出明暗层次
  const sun = new THREE.DirectionalLight(0xffe4ba, 1.85);           // 晨光斜射，长柔影
  sun.position.set(19, 17, 12); sun.castShadow = true;
  const lowShadow = matchMedia('(hover: none)').matches || innerWidth < 700;
  sun.shadow.mapSize.set(lowShadow ? 512 : 1024, lowShadow ? 512 : 1024);
  const sc = sun.shadow.camera;
  sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 110;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.025; sun.shadow.radius = 2.5;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xaabbb8, 0.22); fill.position.set(-14, 10, 8); scene.add(fill);
  const altarLight = new THREE.PointLight(0xffcf94, 2.4, 24, 2);    // 佛前唯一暖亮点
  altarLight.position.set(0, 4.0, -10.6); scene.add(altarLight);

  // 地面放大到 200×200：远端边缘远到被雾完全吞掉，不再出现平面尽头的斜切
  const stoneBump = makeBumpTexture(); stoneBump.repeat.set(26, 26);
  ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ map: Tex.tile('stone.png', 26, 26), bumpMap: stoneBump, bumpScale: 0.028, roughness: 0.97 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  ground.userData.action = 'walk'; scene.add(ground);

  // 静态环境优先用 Blender 精建的 court.glb；加载失败自动回退到下面的程序化占位几何
  const useCourt = !!GLB_CACHE.court;
  const stone = new THREE.MeshStandardMaterial({ map: Tex.tile('stone.png', 6, 2), roughness: 0.95 });
  if (!useCourt) {
  // 拜垫区铺一层略深的石板，把「殿前礼佛空间」从大庭院里分出来
  const courtBump = makeBumpTexture(); courtBump.repeat.set(5, 3);
  const court = new THREE.Mesh(new THREE.PlaneGeometry(26, 13),
    new THREE.MeshStandardMaterial({ map: Tex.tile('stone.png', 5, 3), bumpMap: courtBump, bumpScale: 0.024, color: 0xc7c1b0, roughness: 0.97 }));
  court.rotation.x = -Math.PI / 2; court.position.set(0, 0.012, -2.0);
  court.receiveShadow = true; court.raycast = () => {}; scene.add(court);

  // ---- 大殿主体：台基 / 月台 / 墙体 / 红柱 / 格扇 / 歇山飞檐 / 匾额 ----
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b6a5e, roughness: 0.92 });
  const pillarMat = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 1, 3), color: 0xa3665a, roughness: 0.82 });
  const tileMat = new THREE.MeshStandardMaterial({ map: Tex.tile('tile.png', 10, 2), roughness: 0.82 });
  const beamMat = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 6, 1), roughness: 0.86 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(25.4, 0.7, 7.8), stone); plinth.position.set(0, 0.35, -11.5); scene.add(plinth);
  const terrace = new THREE.Mesh(new THREE.BoxGeometry(25.4, 0.16, 3.6), stone); terrace.position.set(0, 0.08, -6.8); scene.add(terrace);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(24.6, 6.6, 0.8), wallMat); backWall.position.set(0, 3.9, -14.6); scene.add(backWall);
  for (const s of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.8, 6.6, 7.4), wallMat); w.position.set(s * 12.1, 3.9, -11.5); scene.add(w); }

  // 前檐红柱 + 柱础：中轴不立柱，让正中大佛完整露出来（与官网敞口佛堂一致）
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const px = -11 + i * 2.75;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.3, 12), stone); base.position.set(px, 0.85, -8.0); scene.add(base);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.33, 5.8, 14), pillarMat); col.position.set(px, 3.8, -8.0); scene.add(col);
  }
  // 殿做敞口：只留前檐金色格栅作装饰，不设实心门扇；中轴两格留空，保证大佛可见
  for (let i = 0; i < 8; i++) {
    if (i === 3 || i === 4) continue;
    const px = -9.6 + i * 2.75;
    for (let k = -1; k <= 1; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.4, 0.06), new THREE.MeshStandardMaterial({ color: 0xa9946c, roughness: 0.7 }));
      bar.position.set(px + k * 0.6, 3.4, -8.06); scene.add(bar);
    }
    for (let k = -1; k <= 1; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.06, 0.06), new THREE.MeshStandardMaterial({ color: 0xa9946c, roughness: 0.7 }));
      bar.position.set(px, 3.4 + k * 1.25, -8.06); scene.add(bar);
    }
  }
  // 檐下椽子 + 柱头斗拱：让大殿从「几块盒子」变成有木构层次
  const rafterMat = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 1, 2), roughness: 0.9 });
  const rafterGeo = new THREE.CylinderGeometry(0.055, 0.055, 4.6, 6);
  for (let i = 0; i < 36; i++) {
    const r = new THREE.Mesh(rafterGeo, rafterMat);
    r.rotation.x = Math.PI / 2;
    r.position.set(-12.3 + i * 0.7, 6.15, -10.2); scene.add(r);
  }
  const bracketMat = new THREE.MeshStandardMaterial({ color: 0x7a6047, roughness: 0.8 });
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const px = -11 + i * 2.75;
    for (let k = 0; k < 3; k++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.9 + k * 0.34, 0.16, 0.9 + k * 0.24), bracketMat);
      b.position.set(px, 6.75 + k * 0.19, -8.0); scene.add(b);
    }
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0xb49a68, roughness: 0.6 }));
    cap.position.set(px, 6.05, -8.0); scene.add(cap);
  }

  // 额枋 / 主檐 / 起翘 / 屋脊
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(25, 0.55, 0.7), beamMat);
  lintel.position.set(0, 6.55, -8.0); scene.add(lintel);
  const eaves = new THREE.Mesh(new THREE.BoxGeometry(27.4, 0.55, 8.8), tileMat);
  eaves.position.set(0, 7.25, -11.4); scene.add(eaves);
  // 瓦垄：半圆筒沿进深方向铺开，檐口才有真实瓦当的起伏
  const tileRollGeo = new THREE.CylinderGeometry(0.12, 0.12, 8.6, 8, 1, true, 0, Math.PI);
  for (let i = 0; i < 50; i++) {
    const roll = new THREE.Mesh(tileRollGeo, tileMat);
    roll.rotation.x = Math.PI / 2;
    roll.position.set(-13.2 + i * 0.54, 7.5, -11.4); scene.add(roll);
  }
  // 檐口一排金色瓦当：第三人称从下方看屋顶时才有细节，而不是一整块黑板
  const tileEndGeo = new THREE.CylinderGeometry(0.115, 0.115, 0.08, 10);
  const tileEndMat = new THREE.MeshStandardMaterial({ color: 0xae9c72, roughness: 0.65, metalness: 0.2 });
  for (let i = 0; i < 26; i++) {
    const e = new THREE.Mesh(tileEndGeo, tileEndMat);
    e.rotation.x = Math.PI / 2;
    e.position.set(-13.0 + i * 1.04, 7.22, -7.02); scene.add(e);
  }
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 8.8), tileMat);
    tip.position.set(s * 13.6, 7.75, -11.4); tip.rotation.z = s * 0.22; scene.add(tip);
  }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(27, 0.6, 0.8), tileMat); ridge.position.set(0, 7.9, -14.9); scene.add(ridge);
  for (const s of [-1, 1]) { const chi = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.0, 8), tileMat); chi.position.set(s * 13.2, 8.4, -14.9); chi.rotation.z = s * 0.4; scene.add(chi); }

  // 殿额：木底 + 金边匾额，不再是一张飘着的贴纸
  const plaqueBack = new THREE.Mesh(new THREE.BoxGeometry(5.7, 1.75, 0.22),
    new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 1, 1), color: 0x6f5b45, roughness: 0.75 }));
  plaqueBack.position.set(0, 6.5, -7.72); scene.add(plaqueBack);
  const bigPlaque = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.5),
    new THREE.MeshBasicMaterial({ map: plaqueTexture('静 照 院'), transparent: true, toneMapped: false }));
  bigPlaque.position.set(0, 6.5, -7.59); scene.add(bigPlaque);

  // 佛后壁画：水彩远山 + 柔光，对应官网 altar-wall 的位置
  const mural = new THREE.Mesh(new THREE.PlaneGeometry(13.2, 6.6),
    new THREE.MeshBasicMaterial({ map: Tex.flat('mural.jpg'), fog: false }));
  mural.position.set(0, 3.72, -13.9); scene.add(mural);
  // 须弥台：木身 + 束腰 + 金边台面
  const altarWood = new THREE.MeshStandardMaterial({ map: Tex.tile('wood.png', 3, 1), roughness: 0.82 });
  const altar = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.7, 2.5), altarWood);
  altar.position.set(0, 0.7, -11.4); altar.receiveShadow = true; scene.add(altar);
  const waist = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.16, 2.3),
    new THREE.MeshStandardMaterial({ color: 0x6c4c2e, roughness: 0.8 }));
  waist.position.set(0, 0.44, -11.4); scene.add(waist);
  const altarEdge = new THREE.Mesh(new THREE.BoxGeometry(6.7, 0.12, 2.8),
    new THREE.MeshStandardMaterial({ color: 0xbf9a56, roughness: 0.6, metalness: 0.2 }));
  altarEdge.position.set(0, 1.08, -11.4); scene.add(altarEdge);
  // 月台前的石阶只铺中轴过道（两侧全是拜垫，不能压上去）
  for (let i = 0; i < 3; i++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.56, 0.09, 0.34), stone);
    step.position.set(0, TERRACE_TOP - 0.045 - i * 0.05, TERRACE_FRONT + 0.16 + i * 0.33);
    step.receiveShadow = true; scene.add(step);
  }
  // 月台前沿压边：把高差收住，也让拜垫区有一条清楚的界线
  for (const s of [-1, 1]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(9.4, 0.2, 0.3), stone);
    edge.position.set(s * 7.6, TERRACE_TOP - 0.07, TERRACE_FRONT + 0.12);
    edge.receiveShadow = true; scene.add(edge);
  }
  // 石栏移到月台两端（拜垫阵列之外），不再插在拜垫之间
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.56, 8), stone);
      post.position.set(s * 12.1, TERRACE_TOP + 0.26, -8.1 + i * 1.25); scene.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 2.8), stone);
    rail.position.set(s * 12.1, TERRACE_TOP + 0.52, -6.85); scene.add(rail);
  }
  // 森林环抱：弯曲主干 + 松针团的松树，比圆锥堆叠更像真树
  const PINE_SPOTS = [
    [-15, -12, 1.25], [-16.5, -3, 1.0], [-15, 6, 1.15], [-17, 14, 1.35],
    [15.5, -12, 1.3], [16.5, -2, 1.05], [18.2, 11.2, 1.2], [17.5, 16, 1.4],
    [-8, -19, 1.1], [0, -20, 1.25], [8, -19, 1.1], [-19, 1, 1.2], [19, 3, 1.15],
    [-13, 12.5, 1.0], [14.6, -6.4, 0.95], [-11.3, 1.4, 1.0], [10.4, -3.6, 0.95], [10.4, 1.2, 1.0]
  ];
  for (const [px, pz, sc] of PINE_SPOTS) {
    const t = buildPine(sc);
    t.position.set(px, 0, pz); t.rotation.y = (px * 0.7 + pz * 0.3) % 6.28;
    scene.add(t);
  }
  // 三株银杏：暖黄树冠呼应飘落的银杏叶
  for (const [gx, gz, gs] of [[-14.3, 9.6, 1.05], [16.8, 13.4, 1.0], [-11.4, 10.2, 0.85]]) {
    const t = buildGinkgo(gs);
    t.position.set(gx, 0, gz); t.rotation.y = gx * 0.4;
    scene.add(t);
  }

  } else {
    mountCourt();
  }

  // ---- 正中一尊大佛 + 佛前成排拜垫 ----
  cushions = []; statues = [];
  // 大佛：殿内正中、坐在须弥台上，面向院子（+z）
  const st = buildStatue(MAIN_BUDDHA);
  st.userData = {
    action: 'worship', label: '静照大佛 · 礼拜', statueIndex: 0,
    ringPos: new THREE.Vector3(0, 0.03, -9.0),
    spot: new THREE.Vector3(0, 0, -3.2)
  };
  scene.add(st); statues.push(st);

  // 佛前拜垫：6 列 × 3 排 18 席，疏朗错列、中轴留过道，殿前留出礼佛空地。
  // 压到约 0.28 高的扁蒲团（真实蒲团厚度），人跪上去才不会半个身子插进垫子里
  const clothMap = Tex.tile('fabric.png', 1, 1);
  const cushionGeo = new THREE.SphereGeometry(0.68, 20, 14);
  const bandGeo = new THREE.TorusGeometry(0.63, 0.045, 6, 24);
  const makeCushion = (row, col, cx, cz) => {
    let clothMat = null;
    const tone = [0xc9d1c8, 0xc4ccc4, 0xcfd5ca, 0xc1c9c2][(row * 3 + col) % 4];
    const c = GLB_CACHE.cushion
      ? GLB_CACHE.cushion.clone(true)
      : new THREE.Mesh(cushionGeo, new THREE.MeshStandardMaterial({
          map: clothMap, color: tone,
          roughness: 0.96, emissive: 0xffc46a, emissiveIntensity: 0
        }));
    if (!GLB_CACHE.cushion) { c.scale.set(1.18, 0.24, 1.18); c.position.set(cx, 0.14, cz); clothMat = c.material; }
    else {
      c.scale.setScalar(1.18);   // 单垫直径 1.38 → 1.63，跪拜位更实在
      c.position.set(cx, 0.005, cz);
      clothMat = new THREE.MeshStandardMaterial({
        map: clothMap, color: tone,
        roughness: 0.96, emissive: 0xffc46a, emissiveIntensity: 0
      });
      c.traverse((o) => {
        if (!o.isMesh) return;
        o.receiveShadow = true;
        if (o.material && o.material.name === 'cloth') o.material = clothMat;
      });
    }
    if (!GLB_CACHE.cushion) {
      const band = new THREE.Mesh(bandGeo, new THREE.MeshStandardMaterial({ color: 0xb1a17d, roughness: 0.85 }));
      band.rotation.x = Math.PI / 2; c.add(band);
    }
    c.receiveShadow = true;
    c.userData = {
        action: 'bow', label: '第 ' + (row + 1) + ' 排 · ' + (col + 1) + ' 号拜垫',
        ringPos: new THREE.Vector3(cx, 0.03, cz),
        spot: new THREE.Vector3(cx, 0, cz),
        onSpot: new THREE.Vector3(cx, 0, cz),
        row: row, seat: row * CUSHION_COLS + col,
        clothMat: clothMat
      };
      scene.add(c); cushions.push(c);
  };
  for (let row = 0; row < CUSHION_ROWS; row++) {
    for (let col = 0; col < CUSHION_COLS; col++) {
      const cx = (col - (CUSHION_COLS - 1) / 2) * CUSHION_X_STEP
        + (row % 2 ? 0.16 : -0.16);
      const cz = CUSHION_Z0 + row * CUSHION_Z_STEP;
      makeCushion(row, col, cx, cz);
    }
  }

  // ---- 殿前长明灯：六角宫灯 + 宝盖 + 流苏 + 柔光晕（挂在檐下） ----
  lanternMeshes = [];
  const lanternPaper = new THREE.MeshStandardMaterial({ color: 0xa8635a, emissive: 0xd8a878, emissiveIntensity: 0.12, roughness: 0.72, transparent: true, opacity: 0.94 });
  const lanternTrim = new THREE.MeshStandardMaterial({ color: 0xa7946d, roughness: 0.6, metalness: 0.25 });
  for (let i = 0; i < 10; i++) {
    const lx = -9.6 + i * 2.13;
    const g = new THREE.Group();
    // children[0] 是灯身、children[1] 是点光源，updateLanterns() 依赖这个顺序
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.66, 6), lanternPaper.clone());
    body.position.set(lx, 5.5, -7.2); g.add(body);
    // 灯骨 + 上下金箍：灯身从光筒变成有骨架的纸灯
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3;
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.66, 5), lanternTrim);
      rib.position.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35); body.add(rib);
    }
    for (const dy of [0.34, -0.34]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.345, 0.024, 6, 18), lanternTrim);
      hoop.rotation.x = Math.PI / 2; hoop.position.y = dy; body.add(hoop);
    }
    const light = new THREE.PointLight(0xffb060, 0.0, 9, 2); light.position.set(lx, 5.5, -7.2); g.add(light);
    const glow = softGlow(2.4, 0xffb763, 0.08); glow.position.set(lx, 5.5, -7.15); g.add(glow);
    for (const dy of [0.38, -0.38]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.12, 6), lanternTrim);
      cap.position.set(lx, 5.5 + dy, -7.2); g.add(cap);
    }
    const tassel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.012, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0xb5453c, roughness: 0.9 }));
    tassel.position.set(lx, 4.82, -7.2); g.add(tassel);
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 5), lanternTrim);
    cord.position.set(lx, 6.1, -7.2); g.add(cord);
    g.userData = { action: 'lamp', ringPos: new THREE.Vector3(lx, 0.03, -7.2), spot: new THREE.Vector3(clamp(lx * 0.9, -9.2, 9.2), 0, -4.85) };
    flames.push({ mesh: body, light: light, base: body.position.clone(), phase: Math.random() * 9, rate: 1.9 + Math.random(), kind: 'lantern', on: false, group: g });
    lanternMeshes.push(g); scene.add(g);
  }

  // ---- 荷池（移到院东，彻底让开拜垫阵列）：石沿 / 水面 / 荷叶 / 涟漪 / 锦鲤 + 金蟾 ----
  if (!useCourt) {
  const pondRim = new THREE.Mesh(new THREE.TorusGeometry(POND.r + 0.04, 0.19, 8, 40), stone);
  pondRim.rotation.x = -Math.PI / 2; pondRim.position.set(POND.x, 0.07, POND.z); scene.add(pondRim);
  }
  // v3 y 层次（建模专家 v1.2 定案）：不挖洞、不下沉到负值、不动 court.glb。
  // 不透明池底盖住 ground 的 stone.png 平铺缝；水面 0.105 低于 court 池沿 0.15。
  const pondBed = new THREE.Mesh(new THREE.CircleGeometry(POND.r + 0.06, 48),
    new THREE.MeshStandardMaterial({ color: 0x7C8579, roughness: 0.96, bumpMap: makeBumpTexture(), bumpScale: 0.02 }));
  pondBed.rotation.x = -Math.PI / 2; pondBed.position.set(POND.x, 0.015, POND.z);
  pondBed.raycast = () => {}; pondBed.renderOrder = 0; scene.add(pondBed);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 48),
    new THREE.MeshStandardMaterial({ color: 0x8A9A90, roughness: 0.42, metalness: 0,
      transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide,
      bumpMap: makeBumpTexture(), bumpScale: 0.012 }));
  pond.rotation.x = -Math.PI / 2; pond.position.set(POND.x, 0.105, POND.z);
  pond.raycast = () => {}; pond.renderOrder = 2; scene.add(pond);
  for (let i = 0; i < 7; i++) {
    const a = i * 2.4, r = 0.75 + (i % 3) * 0.5;
    const leaf = new THREE.Mesh(new THREE.CircleGeometry(0.3 + (i % 2) * 0.1, 16),
      new THREE.MeshStandardMaterial({ color: i % 2 ? 0x6B7C68 : 0x84917A, roughness: 0.9, side: THREE.DoubleSide }));
    leaf.rotation.x = -Math.PI / 2; leaf.rotation.z = a;
    leaf.position.set(POND.x + Math.cos(a) * r, 0.125, POND.z + Math.sin(a) * r);
    leaf.raycast = () => {}; leaf.renderOrder = 3; scene.add(leaf);
  }
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.0, 40),
      new THREE.MeshBasicMaterial({ color: 0x8A9A90, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false }));
    r.rotation.x = -Math.PI / 2; r.position.set(POND.x, 0.13, POND.z);
    r.scale.setScalar(0.2); r.renderOrder = 4; scene.add(r);
    pondRings.push({ mesh: r, t: i * 1.7 });
  }
  // 锦鲤群：真实曲面模型，常驻水下缓慢巡游（取代原来每 7.5s 从地下弹出一次的橙椭球）
  if (GLB_CACHE.koi) {
    for (let i = 0; i < 5; i++) {
      const k = GLB_CACHE.koi.clone(true);
      k.scale.setScalar(0.72 + Math.random() * 0.42);
      k.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = false; } });
      k.userData = {
        phase: Math.random() * 6.28, radius: 0.75 + Math.random() * 0.95,
        speed: 0.22 + Math.random() * 0.16, y: 0.052 + Math.random() * 0.028
      };
      k.renderOrder = 1; scene.add(k); koiSchool.push(k);
    }
  } else {
    // 无 GLB 时保留旧的跃出彩蛋作为回退
    pondFish = new THREE.Group();
    const fb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), toonMat(0x9a8a72));
    fb.scale.set(1.5, 0.7, 0.7); pondFish.add(fb);
    pondFish.position.set(POND.x, -0.6, POND.z); scene.add(pondFish);
  }

  // 池底硬币组：服务端权威下发的全院累积，InstancedMesh 承载
  pondCoinsGroup = new THREE.Group(); pondCoinsGroup.renderOrder = 1;
  scene.add(pondCoinsGroup);
  refreshPondCoins();

  // 金蟾：按 1 号定稿图摆到池心对称正中、不再歪着；石座略抬以露出水面
  const toad = buildToad();
  toad.group.position.set(POND.x, 0.09, POND.z);
  toad.group.rotation.y = 0;
  toad.group.userData = {
    action: 'coin', label: '荷池金蟾 · 抛一枚硬币',
    ringPos: new THREE.Vector3(POND.x, 0.10, POND.z),
    spot: new THREE.Vector3(POND.spot.x, 0, POND.spot.z)
  };
  scene.add(toad.group); toadObj = toad.group; toadParts = toad.parts;

  // ---- 两座石灯笼：让到拜垫阵列之外，立在庭院东西两侧 ----
  if (!useCourt) {
  const stoneLampMat = new THREE.MeshStandardMaterial({ map: Tex.tile('stone.png', 1, 1), roughness: 0.95 });
  for (const sx of [-9.6, 9.6]) {
    const sl = new THREE.Group();
    // 春日形制：六角基座 → 角柱 → 中台 → 火袋（三面窗棂）→ 六角笠 → 宝珠
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.56, 0.18, 6), stoneLampMat); base.position.y = 0.09; sl.add(base);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 1.0, 8), stoneLampMat); pole.position.y = 0.68; sl.add(pole);
    const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.24, 0.12, 6), stoneLampMat); mid.position.y = 1.24; sl.add(mid);
    const fire = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.5, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8d9ae, emissive: 0xffb45e, emissiveIntensity: 0.75, roughness: 0.8 }));
    fire.position.y = 1.55; sl.add(fire);
    for (const a of [0.5, 2.6, 4.7]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.34, 0.05), stoneLampMat);
      bar.position.set(Math.sin(a) * 0.315, 1.55, Math.cos(a) * 0.315); sl.add(bar);
    }
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.6, 0.3, 6), stoneLampMat); roof.position.y = 1.95; sl.add(roof);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xb9965a, roughness: 0.5, metalness: 0.4 }));
    orb.position.y = 2.16; sl.add(orb);
    const lg = softGlow(2.0, 0xffc078, 0.24); lg.position.set(0, 1.55, 0); sl.add(lg);
    sl.position.set(sx, 0, -2.6); sl.traverse(o => { if (o.isMesh) o.raycast = () => {}; });
    scene.add(sl);
  }

  }
  // ---- 庭院落叶堆：银杏落叶聚成小堆，走近扫一扫会散开，过一会儿又在别处落出一堆 ----
  const leafMoundMat = new THREE.MeshStandardMaterial({ color: 0xd9a13c, roughness: 0.95 });
  for (const [px, pz] of LEAF_SPOTS) {
    if (Math.hypot(px - POND.x, pz - POND.z) < POND.r + 1.2) continue;   // 不落进荷池里
    const g = new THREE.Group();
    const mound = new THREE.Mesh(new THREE.SphereGeometry(0.62, 12, 8), leafMoundMat);
    mound.scale.set(1, 0.38, 1); mound.position.y = 0.08; mound.castShadow = true; g.add(mound);
    for (let k = 0; k < 6; k++) {
      const lf = new THREE.Mesh(new THREE.CircleGeometry(0.09, 6),
        new THREE.MeshStandardMaterial({ color: k % 2 ? 0xe0b254 : 0xc98f30, roughness: 0.95, side: THREE.DoubleSide }));
      lf.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5, Math.random() * 6.28, 0);
      const a = Math.random() * 6.28, r = 0.55 + Math.random() * 0.45;
      lf.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      lf.userData.leaf = true; g.add(lf);
    }
    g.position.set(px, 0, pz);
    g.userData = {
      action: 'sweep', label: '落叶堆 · 扫一扫',
      ringPos: new THREE.Vector3(px, 0.03, pz), spot: new THREE.Vector3(px, 0, pz + 0.9),
      moundScaleY: 0.38, swept: false, nextAt: 0
    };
    scene.add(g); leafPiles.push(g);
  }

  // 木鱼与念珠不再摆在院子边角：改到右下角固定工具坞（见 index.html 的 .dock）

  // ---- 佛前中轴一座青铜香炉（三足双耳鼎，立在月台中轴上） ----
  incenseMesh = buildIncenseBurner(); incenseMesh.position.set(0, TERRACE_TOP, -6.5);
  incenseMesh.scale.setScalar(0.94);
  incenseMesh.userData = { action: 'incense', label: '佛前香炉 · 上香', ringPos: new THREE.Vector3(0, 0.03, -6.5), spot: new THREE.Vector3(0, 0, -4.55) };
  const incenseGlow = softGlow(2.6, 0xffb877, 0.2);
  incenseGlow.position.set(0, 1.7, 0); incenseGlow.raycast = () => {}; incenseMesh.add(incenseGlow);
  scene.add(incenseMesh);

  buildPetals();

  // 逗猫光点：在院西空地上飘，猫会去扑（不放进拜垫阵列里，免得猫踩垫子穿模）
  lure = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe6bd, transparent: true, opacity: 0.8 }));
  lure.position.set(-7.2, 1.1, 6.4); scene.add(lure);
  const lureGlow = softGlow(1.1, 0xffd89a, 0.55); lure.add(lureGlow);
  // 猫窝：藤编圆窝 + 里层软布垫，猫会自己回去趴着打盹
  const nest = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.16, 8, 24),
    new THREE.MeshStandardMaterial({ color: 0xa8824f, roughness: 1 }));
  nest.rotation.x = -Math.PI / 2; nest.position.set(catBase.x, 0.14, catBase.z); scene.add(nest);
  const nestPad = new THREE.Mesh(new THREE.CircleGeometry(0.76, 24),
    new THREE.MeshStandardMaterial({ map: Tex.tile('fabric.png', 1, 1), color: 0xd8c6a4, roughness: 1, side: THREE.DoubleSide }));
  nestPad.rotation.x = -Math.PI / 2; nestPad.position.set(catBase.x, 0.055, catBase.z);
  nestPad.receiveShadow = true; scene.add(nestPad);

  // ---- 小沙弥 / 寺猫 ----
  const m = buildMonk(ROBE_BLUES[0]);
  monkObj = m.group; monkObj.position.set(0, 0, 2.4);
  bowPivot = m.bowPivot; hands = m.hands; monkEyes = m.eyes; monkHead = m.head;
  monkLower = m.lower; monkKnees = m.knees; monkRig = m.rig;
  monkObj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  monkObj.userData = { action: 'clasp', self: true }; scene.add(monkObj);
  monkShadow = softShadow(2.1, 0.32); scene.add(monkShadow);
  // 跪拜时垫子上升起的一团暖光：远处看也知道有人正在礼拜
  kneelGlow = softGlow(3.2, 0xffcf8a, 0);
  kneelGlow.position.y = 0.7; scene.add(kneelGlow);

  const cat = buildCat(); catObj = cat.group; catParts = cat.parts; catObj.position.copy(catBase);
  catObj.userData = { action: 'pet', dynamic: true };
  catObj.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(catObj);
  catShadow = softShadow(1.5, 0.28); scene.add(catShadow);

  // 悬停提示：地面柔光盘 + 一圈细金环，比原来的硬边圆环柔和
  hoverRing = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({
    map: glowTexture(), color: 0xffd27a, transparent: true, opacity: 0.6,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false
  }));
  hoverRing.rotation.x = -Math.PI / 2;
  const hoverEdge = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.78, 40),
    new THREE.MeshBasicMaterial({ color: 0xffe2a4, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  // 父级已经把平面转成水平；子级只需沿父的局部 z（即世界 +y）微微抬起
  hoverEdge.position.z = 0.002; hoverEdge.raycast = () => {}; hoverRing.add(hoverEdge);
  hoverRing.visible = false; scene.add(hoverRing);

  // 萤火：几十点暖光在院里慢慢浮，补一层空气感
  const flyGeo = new THREE.BufferGeometry();
  const flyPos = new Float32Array(46 * 3);
  for (let i = 0; i < 46; i++) {
    flyPos[i * 3] = (Math.random() * 2 - 1) * 14;
    flyPos[i * 3 + 1] = 0.6 + Math.random() * 5;
    flyPos[i * 3 + 2] = (Math.random() * 2 - 1) * 11 + 1;
  }
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  fireflies = new THREE.Points(flyGeo, new THREE.PointsMaterial({
    map: glowTexture(), color: 0xffe3a8, size: 0.34, transparent: true, opacity: 0.62,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
  }));
  scene.add(fireflies);

  // 可交互物脚下一圈极淡的暖光，只提示「这里可以点」，跟随物件一起移动
  for (const o of [catObj, incenseMesh, toadObj].filter(Boolean)) {
    const g = softGlow(1.5, 0xd9c69b, 0.15);
    g.position.set(0, 0.06, 0); g.raycast = () => {}; o.add(g);
  }

  interactables = [ground, catObj, incenseMesh, toadObj, ...cushions, ...statues, monkObj, ...lanternMeshes, ...leafPiles].filter(Boolean);
}

// 佛前三盏常明；其余按「今日愿灯」点亮，灯下挂写有法号的愿签，hover 可看完整愿望
const LANTERN_BASE = 3;
function updateLanterns() {
  for (const t of wishTags) { scene.remove(t); if (t.material.map) t.material.map.dispose(); t.material.dispose(); }
  wishTags = [];
  for (let i = 0; i < lanternMeshes.length; i++) {
    const g = lanternMeshes[i], lamp = i >= LANTERN_BASE ? (todayLamps[i - LANTERN_BASE] || null) : null;
    const on = i < LANTERN_BASE || !!lamp;
    g.children[0].material.emissiveIntensity = on ? 1.2 : 0.1;
    g.children[1].intensity = on ? 1.1 : 0.0;
    if (g.children[2] && g.children[2].material) g.children[2].material.opacity = on ? 0.5 : 0.06;
    const f = flames.find(x => x.group === g); if (f) f.on = on;
    g.userData.label = lamp ? ('愿灯 · ' + lamp.name + '：' + lamp.wish) : (myLamp ? '长明灯 · 今日已点一盏' : '长明灯');
    if (lamp) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: wishTagTexture(lamp.name), transparent: true, depthWrite: false }));
      tag.position.set(g.children[0].position.x, 4.55, -7.02);
      tag.scale.set(0.95, 0.48, 1); scene.add(tag); wishTags.push(tag);
    }
  }
}
function applyPose(bowP, pose, t) {
  bowP.rotation.x = (pose === 'bow' && t > 0) ? Math.sin((1 - t / 0.8) * Math.PI) * 0.5 : 0;
}

// ===================== 生态：寺猫 / 烛火 / 香烟 / 池水 / 待机呼吸 =====================
// 猫不是摆件：有地盘和作息，会巡院、端坐、舔爪洗脸、伸懒腰、蜷着打盹、
// 蹲蒲团、去池边看鱼、扑飘动的光点、蹭走近的人、被木鱼声吓一跳；
// 被点名时坐下来等人走过来，撸完再自行散去。
const CAT_SPOTS = [
  { x: -9.6, z: 7.4 }, { x: 0.35, z: -2.4 }, { x: 0.4, z: 1.2 }, { x: -0.4, z: 3.6 },
  { x: -10.6, z: 3.4 }, { x: -9.4, z: -1.0 }, { x: 9.7, z: -1.2 }, { x: 10.2, z: 3.0 },
  { x: 6.6, z: 6.8 }, { x: -5.4, z: 6.6 }
];
const CAT_STATES = ['stroll', 'stroll', 'sit', 'groom', 'nap', 'chase', 'watch', 'stretch', 'nap', 'sit'];
catLife = {
  state: 'sit', t: 0, dur: 3.5, phase: 0, spot: null,
  wait: false, petting: false, blink: 0, blinkT: 2.2,
  startleT: 0, startleCd: 0, greetCd: 0
};
function catState(s, dur) {
  catLife.state = s; catLife.t = 0; catLife.dur = dur || 4;
  catLife.phase = Math.random() * 6.28;
}
function catPick() {
  const s = CAT_STATES[(Math.random() * CAT_STATES.length) | 0];
  const spot = CAT_SPOTS[(Math.random() * CAT_SPOTS.length) | 0];
  catLife.spot = spot;
  if (s === 'chase' && lure) lure.position.set(-10.4 + Math.random() * 3.2, 0.7 + Math.random() * 0.8, 5.0 + Math.random() * 3.0);
  const dur = { stroll: 4 + Math.random() * 3, sit: 2.5 + Math.random() * 3, groom: 2.4 + Math.random() * 1.8,
    nap: 6 + Math.random() * 6, chase: 2.2, watch: 3 + Math.random() * 2, stretch: 1.8, greet: 3.6 }[s] || 4;
  catState(s, dur);
  if (s === 'stroll' || s === 'chase' || s === 'watch') {
    const dest = (s === 'chase' && lure) ? lure.position : spot;
    catTarget.set(dest.x, 0, dest.z);
  }
}
const CatLife = {
  waitForPlayer() { catLife.wait = true; catState('wait', 18); catTarget.copy(catObj.position); },
  pet() {
    catLife.wait = false; catLife.petting = true; catState('petted', 999);
    Sound.purrStart(); spawnHeart(catObj.position.x, 1.0, catObj.position.z);
  },
  endPet() { catLife.petting = false; Sound.purrStop(); catPick(); },
  startle() {
    if (catLife.startleCd > 0 || catLife.wait || catLife.petting) return;
    catLife.startleCd = 6; catLife.startleT = 1.1;
    const dx = catObj.position.x - monkObj.position.x, dz = catObj.position.z - monkObj.position.z;
    const d = Math.hypot(dx, dz) || 1;
    catTarget.set(clamp(catObj.position.x + dx / d * 1.6, -Bounds.x, Bounds.x), 0,
      clamp(catObj.position.z + dz / d * 1.6, -Bounds.z, Bounds.z));
  }
};
function updateCatLife(dt) {
  if (!catParts || !catObj) return;
  const L = catLife, P = catParts;
  L.t += dt;
  if (L.startleCd > 0) L.startleCd -= dt;
  if (L.greetCd > 0) L.greetCd -= dt;
  L.blink -= dt; L.blinkT -= dt;
  if (L.blinkT <= 0) { L.blink = 0.14; L.blinkT = 2 + Math.random() * 4; }
  const blink = L.blink > 0;

  // 玩家走近且猫正闲着：偶尔主动来蹭腿（猫的社交方式，不强行打断玩家操作）
  const near = Math.hypot(monkObj.position.x - catObj.position.x, monkObj.position.z - catObj.position.z);
  if (!L.wait && !L.petting && L.startleT <= 0 && L.greetCd <= 0 && near < 2.8 &&
    ['sit', 'groom', 'stroll'].indexOf(L.state) >= 0 && Math.random() < dt * 0.35) {
    L.greetCd = 14; catState('greet', 3.6);
    catTarget.set(monkObj.position.x + 0.9, 0, monkObj.position.z + 0.6);
  }

  let speed = 0, walking = false;
  if (L.startleT > 0) { L.startleT -= dt; speed = 2.6; walking = true; }
  else if (['stroll', 'chase', 'watch', 'greet'].indexOf(L.state) >= 0) {
    speed = L.state === 'chase' ? 2.5 : (L.state === 'greet' ? 1.0 : 0.95); walking = true;
  }
  const bx = catObj.position.x, bz = catObj.position.z;
  if (walking) moveToward(catObj.position, catTarget, speed * dt);
  const mx = catObj.position.x - bx, mz = catObj.position.z - bz;
  if (Math.hypot(mx, mz) > 0.001) {
    // 猫模型头朝局部 +x，绕 Y 的角度取 atan2(-dz, dx) 才会朝行进方向
    const want = Math.atan2(-mz, mx);
    let diff = want - catObj.rotation.y;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    catObj.rotation.y += diff * Math.min(1, dt * 6);
  }
  if (L.t > L.dur) {
    if (L.state === 'wait') { L.wait = false; catPick(); }
    else if (L.state !== 'petted') catPick();
  }

  // ---- 姿态：按状态叠加身形、头、尾、耳、眼、爪 ----
  const s = L.state;
  let bodySY = 0.85, bodySX = 1.25, bodyY = 0.5, headY = 0.78, headRotZ = 0, headYaw = 0;
  let tailRot = -0.2 + Math.sin(time * (s === 'nap' ? 0.8 : 2.4) + L.phase) * (s === 'chase' ? 0.5 : 0.22);
  let eyeSY = (blink || s === 'nap' || s === 'petted') ? 0.12 : 1;
  let earTwitch = 0, jumpY = 0, pawLift = 0, pawFwd = 0;
  const breathe = Math.sin(time * (s === 'nap' ? 1.5 : 2.2) + L.phase);

  if (s === 'sit' || s === 'wait' || s === 'watch') {
    bodySY = 0.72; bodyY = 0.44; headY = 0.7; bodySX = 1.16;
    if (s === 'watch') { headYaw = Math.sin(time * 1.1 + L.phase) * 0.35; tailRot = Math.sin(time * 7 + L.phase) * 0.28; }
    if (s === 'wait') tailRot = Math.sin(time * 1.6) * 0.1;
  } else if (s === 'nap') {
    bodySY = 0.6; bodySX = 1.42; bodyY = 0.36; headY = 0.56; headRotZ = -0.28;
    eyeSY = 0.08; earTwitch = Math.random() < dt * 0.6 ? 0.28 : 0;
  } else if (s === 'groom') {
    bodySY = 0.78; bodyY = 0.46; headY = 0.66; headRotZ = -0.55 + Math.sin(time * 6 + L.phase) * 0.22;
    pawLift = 0.22 + Math.sin(time * 6 + L.phase) * 0.06; eyeSY = 0.35;
  } else if (s === 'stretch') {
    bodySX = 1.55; bodySY = 0.62; bodyY = 0.38; headY = 0.6; headRotZ = -0.35;
    pawFwd = 0.42; eyeSY = 0.2;
  } else if (s === 'chase') {
    jumpY = Math.max(0, Math.sin((L.t / L.dur) * Math.PI * 3)) * 0.35;
    tailRot = 0.5 + Math.sin(time * 9) * 0.3; pawFwd = 0.18;
  } else if (s === 'greet') {
    headYaw = 0.3 * Math.sin(time * 1.6); tailRot = 0.55 + Math.sin(time * 3) * 0.18;
    bodySY = 0.8; bodyY = 0.47;
  } else if (s === 'petted') {
    bodySY = 0.74; bodyY = 0.45; headY = 0.7; headRotZ = 0.16;
    eyeSY = 0.12; tailRot = Math.sin(time * 3.4) * 0.3;
    if (Math.random() < dt * 0.9) spawnHeart(catObj.position.x, 1.0, catObj.position.z);
  }
  if (L.startleT > 0) {
    earTwitch = 0.45; eyeSY = 1; jumpY = Math.max(0, Math.sin(L.startleT * 6)) * 0.22; tailRot = 0.9;
  }

  if (P.v2) {
    // 新 GLB：只叠加相对幅度，不重写绝对坐标（保留连续曲面躯干与各部件的相对位置）
    const b0 = P.body.userData, h0 = P.head.userData, t0 = P.tailPivot.userData;
    P.body.scale.set(b0.baseScale.x * (bodySX / 1.25),
      b0.baseScale.y * (bodySY / 0.85) * (1 + breathe * 0.012), b0.baseScale.z);
    P.body.position.y = b0.basePos.y + (bodyY - 0.5) * 0.20;
    P.head.position.y = h0.basePos.y + (headY - 0.78) * 0.22;
    P.head.rotation.z = h0.baseRot.z + headRotZ * 0.5;
    P.head.rotation.y = h0.baseRot.y + headYaw * 0.5 +
      (s === 'stroll' ? Math.sin(time * 1.4 + L.phase) * 0.10 : 0);
    P.tailPivot.rotation.x = t0.baseRot.x + tailRot * 0.45;
    P.ears.forEach((e, i) => { e.rotation.z = e.userData.baseRot.z + earTwitch * (i ? 0.25 : -0.25); });
    P.eyes.forEach(e => { e.scale.y = e.userData.baseScale.y * eyeSY; });
    P.paws.forEach((p, i) => {
      p.position.y = p.userData.basePos.y + pawLift * 0.35 +
        (walking ? Math.max(0, Math.sin(time * 11 + i * Math.PI)) * 0.05 : 0);
    });
  } else {
    P.body.scale.set(bodySX, bodySY * (1 + breathe * 0.012), 0.9);
    P.body.position.y = bodyY;
    P.head.position.y = headY;
    P.head.rotation.z = headRotZ;
    P.head.rotation.y = headYaw + (s === 'stroll' ? Math.sin(time * 1.4 + L.phase) * 0.16 : 0);
    P.tailPivot.rotation.x = tailRot;
    P.ears.forEach((e, i) => { e.rotation.z = -0.16 + earTwitch * (i ? 1 : -1); });
    P.eyes.forEach(e => { e.scale.y = eyeSY; });
    P.paws.forEach((p, i) => {
      p.position.y = 0.12 + pawLift + (walking ? Math.max(0, Math.sin(time * 11 + i * Math.PI)) * 0.09 : 0);
      p.position.x = 0.62 + pawFwd;
    });
  }
  catObj.position.y = jumpY;
  if (hovered === catObj && hoverRing) hoverRing.position.set(catObj.position.x, 0.04, catObj.position.z);
}
function updateFlames() {
  for (const f of flames) {
    const w = Math.sin(time * f.rate + f.phase) * 0.5 + Math.sin(time * f.rate * 2.7 + f.phase * 1.7) * 0.25;
    if (f.kind === 'candle') {
      // 火苗摇曳、明暗呼吸；猫跑动带起的气流会让火苗多偏一点
      const gust = (catLife && (catLife.state === 'chase' || catLife.state === 'stroll')) ? 0.05 : 0;
      f.mesh.scale.set(1 + w * 0.2, 1 + w * 0.34, 1 + w * 0.2);
      f.mesh.position.x = f.base.x + w * (0.03 + gust);
      f.mesh.material.color.setHSL(0.09, 0.85, 0.58 + w * 0.05);
    } else {
      f.mesh.scale.set(1 + w * 0.05, 1 + w * 0.08, 1 + w * 0.05);
      if (f.on && f.light) f.light.intensity = 1.0 + w * 0.28;
    }
  }
}
function updateLure(dt) {
  if (!lure) return;
  lure.position.y += Math.sin(time * 1.7) * dt * 0.22;
  lure.position.x += Math.sin(time * 0.7) * dt * 0.16;
  lure.material.opacity = 0.55 + Math.sin(time * 3) * 0.2;
}
function updatePond(dt) {
  for (const r of pondRings) {
    r.t += dt; const k = (r.t % 5.1) / 5.1;
    r.mesh.scale.setScalar(0.25 + k * 2.4);
    r.mesh.material.opacity = Math.max(0, 0.16 * (1 - k));
  }
  // 锦鲤：水下缓慢 S 形巡游 + 尾鳍摆动（取代「每 7.5 秒从地下弹出一次的橙椭球」）
  for (const k of koiSchool) {
    const a = time * k.userData.speed + k.userData.phase;
    const rr = k.userData.radius;
    k.position.set(POND.x + Math.cos(a) * rr,
      k.userData.y + Math.sin(a * 2.2) * 0.010,
      POND.z + Math.sin(a) * rr * 0.70);
    k.rotation.y = -a + Math.PI / 2;
    k.rotation.z = Math.sin(a * 3) * 0.055;
    const tail = k.getObjectByName('koiTail');
    if (tail) tail.rotation.y = Math.sin(a * 5.5) * 0.30;
  }
  if (pondFish && !koiSchool.length) {
    const k = time % 7.5;
    if (k < 0.95) {
      const p = k / 0.95;
      pondFish.visible = true;
      pondFish.position.y = 0.05 + Math.sin(p * Math.PI) * 0.55;
      pondFish.position.x = POND.x + Math.sin(p * Math.PI) * 0.85;
      pondFish.rotation.z = -0.8 + p * 1.6;
    } else { pondFish.visible = false; pondFish.rotation.z = 0; pondFish.position.set(POND.x, 0.05, POND.z); }
  }
  // 金蟾：一律「记录 GLB 基准值 + 增量」。旧代码用绝对值 scale.set(1.2,0.82,1.02)
  // 会把 Blender 里放样好的拱背强行压扁 18%，新模型重建后照样被压丑。
  if (toadObj && toadParts) {
    const b = toadParts.body;
    if (b) {
      if (!b.userData.baseScale) b.userData.baseScale = b.scale.clone();
      const s = b.userData.baseScale;
      b.scale.set(s.x, s.y * (1 + Math.sin(time * 1.5) * 0.012), s.z);
    }
    const blink = (time % 5.7) < 0.12;
    toadParts.eyes.forEach(e => {
      if (!e.userData.baseScaleY) e.userData.baseScaleY = e.scale.y || 1;
      e.scale.y = e.userData.baseScaleY * (blink ? 0.16 : 1);
    });
    const c = toadParts.coin;
    if (c) {
      if (c.userData.baseY === undefined) c.userData.baseY = c.position.y;
      c.position.y = c.userData.baseY + Math.sin(time * 1.1) * 0.005;
    }
    toadObj.rotation.y = Math.sin(time * 0.4) * 0.03;   // 基准 0：池心对称、不再歪着
  }
  updateCoinFx(dt);
}
// 3D 池面反馈：投中时冒一团金光，没投中只起一圈水纹
function pondSplash(x, z, gold) {
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.62, 40),
    new THREE.MeshBasicMaterial({ color: gold ? 0xffe1a0 : 0xd9f0f6, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.135, z); ring.scale.setScalar(0.3);
  ring.renderOrder = 5;
  scene.add(ring); coinFx.push({ mesh: ring, kind: 'ring', t: 0, life: 1.8 });
  if (!gold) return;
  for (let i = 0; i < 12; i++) {
    const s = softGlow(0.55, 0xffd27a, 0.9);
    s.position.set(x + (Math.random() - 0.5) * 0.5, 1.0, z + (Math.random() - 0.5) * 0.5);
    scene.add(s);
    coinFx.push({ mesh: s, kind: 'spark', t: 0, life: 1.1, vx: (Math.random() - 0.5) * 1.0, vz: (Math.random() - 0.5) * 1.0, vy: 0.9 + Math.random() * 0.9 });
  }
}
// 一枚真实下落的硬币：从水面上方坠入、沉到池底（水面半透明，全程可见），落定后并入池底硬币堆
function pondCoinDrop(x, z, gold) {
  // v3：旧金哑光，不再用亮金 + 高 metalness 的「原型几何体」
  const geo = firstMeshGeometry(GLB_CACHE.coin) || new THREE.CylinderGeometry(0.105, 0.105, 0.024, 16);
  const c = new THREE.Mesh(geo,
    new THREE.MeshStandardMaterial({ color: gold ? 0xC9B07A : 0xB49A68, roughness: 0.6, metalness: 0.28 }));
  c.position.set(x, 1.5, z);
  c.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  c.raycast = () => {};
  scene.add(c);
  coinFx.push({ mesh: c, kind: 'coin', t: 0, life: 2.4, vy: -0.4, x: x, z: z, forceEnd: false });
}
function updateCoinFx(dt) {
  for (let i = coinFx.length - 1; i >= 0; i--) {
    const f = coinFx[i]; f.t += dt;
    const k = Math.min(1, f.t / f.life);
    if (f.kind === 'ring') {
      f.mesh.scale.setScalar(0.3 + k * 2.7);
      f.mesh.material.opacity = 0.9 * (1 - k);
    } else if (f.kind === 'coin') {
      // 真实坠币：旋转下落 → 穿过半透明水面 → 触底转为池底常驻实例，不再发光淡出、不再被删除
      f.mesh.position.y += f.vy * dt; f.vy -= dt * 3.4;
      f.mesh.rotation.x += dt * 8; f.mesh.rotation.z += dt * 6;
      if (f.mesh.position.y <= 0.030) {
        f.mesh.position.y = 0.030;
        // 保留前一帧的旋转作为落定姿态，避免 rotation.set() 造成「瞬间跳成水平」的穿帮
        addLocalCoin(f.x - POND.x, f.z - POND.z, f.mesh.rotation.y);
        f.forceEnd = true;   // 交给 InstancedMesh，飞行用的临时 Mesh 本帧移除
      }
    } else {
      f.mesh.position.x += f.vx * dt; f.mesh.position.z += f.vz * dt;
      f.mesh.position.y += f.vy * dt; f.vy -= dt * 1.7;
      f.mesh.material.opacity = 0.9 * (1 - k);
    }
    if (k >= 1 || f.forceEnd) {
      scene.remove(f.mesh);
      if (f.mesh.material) f.mesh.material.dispose();
      coinFx.splice(i, 1);
    }
  }
}
// 扫落叶：叶片四散飞开、土堆塌平，稍后在院子另一处重新落出一堆
function sweepLeafPile(g) {
  if (!g || !g.userData || g.userData.swept) return;
  g.userData.swept = true;
  g.userData.nextAt = time + 20 + Math.random() * 14;
  g.userData.label = '落叶已扫 · 稍后又会落一堆';
  for (const m of g.children) {
    if (!m.userData || !m.userData.leaf) continue;
    const a = Math.random() * 6.28, r = 0.8 + Math.random() * 1.6;
    m.userData.fly = { vx: Math.cos(a) * r, vz: Math.sin(a) * r, vy: 1.1 + Math.random(), spin: (Math.random() - 0.5) * 8 };
  }
}
function updateLeafPiles(dt) {
  for (const g of leafPiles) {
    const ud = g.userData;
    if (!ud || !ud.swept) continue;
    let flying = false;
    for (const m of g.children) {
      if (!m.userData || !m.userData.leaf || !m.userData.fly) continue;
      flying = true;
      const f = m.userData.fly;
      m.position.x += f.vx * dt; m.position.z += f.vz * dt;
      m.position.y += f.vy * dt; f.vy -= dt * 2.6;
      m.rotation.z += f.spin * dt;
      if (m.position.y <= 0.02) { m.position.y = 0.02; f.vy = 0; f.vx *= 0.86; f.vz *= 0.86; }
    }
    const mound = g.children[0];
    if (mound) mound.scale.y = Math.max(0.06, mound.scale.y - dt * 0.55);
    if (!flying && ud.nextAt && time > ud.nextAt) {
      // 在别处重新落出一堆
      ud.swept = false; ud.nextAt = 0; ud.label = '落叶堆 · 扫一扫';
      let s = LEAF_SPOTS[0];
      for (let tries = 0; tries < 12; tries++) {
        const c = LEAF_SPOTS[(Math.random() * LEAF_SPOTS.length) | 0];
        if (Math.hypot(c[0] - g.position.x, c[1] - g.position.z) > 3.5) { s = c; break; }
      }
      g.position.set(s[0], 0, s[1]);
      ud.ringPos.set(s[0], 0.03, s[1]); ud.spot.set(s[0], 0, s[1] + 0.9);
      if (mound) mound.scale.y = ud.moundScaleY;
      for (const m of g.children) {
        if (!m.userData || !m.userData.leaf) continue;
        m.userData.fly = null;
        const a = Math.random() * 6.28, r = 0.55 + Math.random() * 0.45;
        m.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
        m.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.5, Math.random() * 6.28, 0);
      }
    }
  }
}
function updateMonkIdle() {
  // 小沙弥与同修都不是杵着的：呼吸起伏、偶尔眨眼、轻轻转头
  // 呼吸叠加在跪姿缩放之上，不能把 kneelT 算出来的压低覆盖掉
  if (bowPivot) bowPivot.scale.y = 1 - 0.06 * kneelT + Math.sin(time * 1.9) * 0.012;
  const blink = (time % 4.3) < 0.13;
  if (monkEyes) monkEyes.forEach(e => { e.ball.scale.y = blink ? 0.12 : 1.15; e.hi.visible = !blink; });
  if (monkHead && !kneeling) monkHead.rotation.z = Math.sin(time * 0.55) * 0.035;
  for (const id in peers) {
    const p = peers[id];
    if (p.bowPivot) p.bowPivot.scale.y = 1 - 0.06 * p.kneelT + Math.sin(time * 1.9 + Number(id)) * 0.012;
    const b = ((time + Number(id) * 0.7) % 4.1) < 0.13;
    if (p.eyes) p.eyes.forEach(e => { e.ball.scale.y = b ? 0.12 : 1.15; e.hi.visible = !b; });
  }
}

// ===================== 粒子 / 爱心 =====================
function updatePetals(dt) {
  const pos = petalGeo.attributes.position;
  for (let i = 0; i < petalCount; i++) {
    let y = pos.getY(i) - (0.34 + (i % 5) * 0.1) * dt * 2.6;
    let x = pos.getX(i) + Math.sin(time * 1.1 + i * 0.7) * dt * 0.62;
    let z = pos.getZ(i) + Math.cos(time * 0.8 + i) * dt * 0.18;
    if (y < 0.05) {
      y = 11 + Math.random() * 3;
      x = (Math.random() * 2 - 1) * 20;
      z = (Math.random() * 2 - 1) * 18;
    }
    pos.setX(i, x); pos.setY(i, y); pos.setZ(i, z);
  }
  pos.needsUpdate = true;
}
function spawnHeart(x, y, z) {
  if (!heartTex) heartTex = heartTexture();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTex, transparent: true, depthWrite: false }));
  spr.position.set(x, y, z); spr.scale.set(0.6, 0.6, 0.6); scene.add(spr);
  hearts.push({ spr, life: 1.2, vy: 0.9 });
}
function updateHearts(dt) {
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i]; h.spr.position.y += h.vy * dt; h.life -= dt;
    h.spr.material.opacity = Math.max(0, h.life / 1.2);
    if (h.life <= 0) { scene.remove(h.spr); hearts.splice(i, 1); }
  }
}
function updateIncenseSmoke(dt) {
  // 青烟被院里气流带着走；猫跑动 / 扑光点时扰动更明显
  const wind = Math.sin(time * 0.43) * 0.16 +
    (catLife && (catLife.state === 'chase' || catLife.state === 'stroll') ? Math.sin(time * 1.3) * 0.22 : 0);
  for (const s of incenseSmoke) {
    s.spr.position.y += dt * 0.42;
    s.spr.position.x += (Math.sin(time * 0.8 + s.base) * 0.14 + wind) * dt;
    if (s.spr.position.y > 4.6) s.spr.position.y = 2.3;
    s.spr.material.opacity = 0.3 * (1 - (s.spr.position.y - 2.3) / 2.3);
  }
}

// ===================== 悬停高亮 / 标签 =====================
function ringPosOf(obj) {
  if (obj.userData.dynamic) return new THREE.Vector3(obj.position.x, 0.03, obj.position.z);
  if (obj.userData.ringPos) return obj.userData.ringPos;
  return new THREE.Vector3(obj.position.x, 0.03, obj.position.z);
}
function spotOf(obj) {
  if (obj.userData.dynamic) {
    // 活物会动：站到它「朝玩家这一侧」一步半的位置，之后 pending 每帧跟随
    const dx = obj.position.x - monkObj.position.x, dz = obj.position.z - monkObj.position.z;
    const d = Math.hypot(dx, dz) || 1;
    const p = clampWalk(obj.position.x - dx / d * 1.5, obj.position.z - dz / d * 1.5);
    return new THREE.Vector3(p.x, 0, p.z);
  }
  if (obj.userData.spot) return obj.userData.spot;
  const v = new THREE.Vector3(obj.position.x, 0, obj.position.z);
  const dir = v.clone().multiplyScalar(-1);
  if (dir.lengthSq() < 0.01) dir.set(0, 0, 1);
  return v.addScaledVector(dir.normalize(), 1.8);
}
function distanceTo(obj) {
  const p = ringPosOf(obj);
  return Math.hypot(monkObj.position.x - p.x, monkObj.position.z - p.z);
}
function setHighlight(obj, on) {
  obj.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach((m) => {
      if (!m.emissive) return;
      if (on) {
        if (m.userData.__em0 === undefined) { m.userData.__em0 = m.emissive.getHex(); m.userData.__ei0 = m.emissiveIntensity; }
        m.emissive.setHex(0xffc46a); m.emissiveIntensity = Math.max(0.4, m.userData.__ei0 || 0);
      } else if (m.userData.__em0 !== undefined) {
        m.emissive.setHex(m.userData.__em0); m.emissiveIntensity = m.userData.__ei0;
        delete m.userData.__em0; delete m.userData.__ei0;
      }
    });
  });
}
function clearHover() {
  if (hovered) { setHighlight(hovered, false); hovered = null; updateLanterns(); }
  hoverRing.visible = false;
  el.tip.classList.remove('show');
  renderer.domElement.style.cursor = 'default';
}
function setHover(obj, cx, cy) {
  if (hovered !== obj) { clearHover(); hovered = obj; setHighlight(obj, true); }
  const act = obj.userData.action;
  const meta = META[act];
  const near = distanceTo(obj) <= CONFIG.REACH;
  let verb = meta.verb;
  if (act === 'bow') verb = (kneeling && activeCushion === obj) ? '起身' : '拜一拜';
  else if (act === 'worship') verb = kneeling ? '起身' : '礼拜';
  el.tip.querySelector('.k').textContent = obj.userData.label || meta.name;
  el.tip.querySelector('.d').textContent = near ? verb : '走过去';
  el.tip.style.left = cx + 'px'; el.tip.style.top = cy + 'px';
  el.tip.classList.add('show');
  renderer.domElement.style.cursor = 'pointer';
  const p = ringPosOf(obj);
  hoverRing.position.set(p.x, 0.04, p.z); hoverRing.visible = true;
}
function pickRoot(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  // 手指有约 44px 的落点误差：触摸时在周围补 8 条射线，优先命中「可交互物」而不是地面
  const isTouch = e.pointerType === 'touch' || e.pointerType === 'pen';
  const r = isTouch ? 22 : 0;
  const offsets = r
    ? [[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.7,r*.7],[-r*.7,r*.7],[r*.7,-r*.7],[-r*.7,-r*.7]]
    : [[0,0]];
  let walkHit = null;
  for (const [ox, oy] of offsets) {
    pointer.x = ((e.clientX + ox - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY + oy - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(interactables, true);
    if (!hits.length) continue;
    let obj = hits[0].object;
    while (obj && !obj.userData.action) obj = obj.parent;
    if (!obj) continue;
    const res = { root: obj, point: hits[0].point };
    if (obj.userData.action !== 'walk') return res;
    if (!walkHit) walkHit = res;
  }
  return walkHit;
}

// ===================== 动作 / 走近后交互 =====================
function doAction(id) {
  monkPose = id; monkPoseT = 0.8;
  save.totalMerit += META[id].gain;
  if (id === 'clasp' || id === 'bow' || id === 'worship') Sound.chime();
  else if (id === 'fish') Sound.woodfish();
  else if (id === 'beads') Sound.tick();
  else if (id === 'lamp') Sound.lamp();          // 功德与点亮由服务端的 lampOk 发放
  else if (id === 'pet') CatLife.pet();          // 猫进入被撸状态，不再被瞬移到脚边
  else if (id === 'sweep') Sound.tick();         // 扫叶：簌的一声轻响
  Net.action(id); persist(); updateHUD();
}
function nearestCushion(p) {
  let best = cushions[0], bd = Infinity;
  const v = p || new THREE.Vector3(0, 0, -3.2);
  for (const c of cushions) {
    const d = Math.hypot(c.position.x - v.x, c.position.z - v.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function trigger(id, obj) {
  if (id === 'bow') { toggleKneel(obj); return; }
  if (id === 'worship') {
    // 点大佛：已跪则起身；否则走到佛前最近的一张拜垫跪下（面朝殿内大佛）
    if (kneeling) { toggleKneel(activeCushion); return; }
    toggleKneel(nearestCushion(obj.userData.spot), true);
    return;
  }
  if (id === 'sweep') { sweepLeafPile(obj); doAction(id); return; }
  monkPose = id; monkPoseT = 0.8;
  if (META[id].focus) openFocus(id);
  else doAction(id);
}
// 点拜垫：走到垫子上跪下并保持；再点一次才起身。换垫子视为重新礼拜。
function toggleKneel(cushion, force) {
  Sound.unlock();
  const c = cushion || activeCushion || cushions[0] || null;
  if (!c) return;
  const same = kneeling && activeCushion === c;
  if (same && !force) {
    kneeling = false;
    // 起身：不再保持背对镜头。鼠标指得远就朝向鼠标，指在脚下就转身面向镜头
    const dx = pointerGround.x - monkObj.position.x, dz = pointerGround.z - monkObj.position.z;
    monkYawTarget = Math.hypot(dx, dz) > 1.4
      ? Math.atan2(dx, dz)
      : Math.atan2(camera.position.x - monkObj.position.x, camera.position.z - monkObj.position.z);
    Sound.chime();
    Net.action('rise');
  } else {
    kneeling = true; activeCushion = c;
    const p = c.userData.onSpot;
    target.set(p.x, 0, p.z); Net.move(target.x, target.z);
    monkYawTarget = Math.PI;   // 面朝殿内佛像
    Sound.chime();
    save.totalMerit += META.bow.gain; persist(); updateHUD(); Net.action('bow');
  }
  if (hovered && (hovered.userData.action === 'bow' || hovered.userData.action === 'worship')) {
    el.tip.querySelector('.d').textContent = kneeling ? '起身' : '拜一拜';
  }
}
function approachAndDo(obj) {
  const id = obj.userData.action;
  if (obj.userData.self || distanceTo(obj) <= CONFIG.REACH) { trigger(id, obj); return; }
  // 点活物时它先停下来等人，否则玩家追、猫也在巡游，永远走不到跟前
  if (obj.userData.dynamic && id === 'pet') CatLife.waitForPlayer();
  const spot = spotOf(obj);
  const cw = clampWalk(spot.x, spot.z);
  target.set(cw.x, 0, cw.z);
  Net.move(target.x, target.z);
  pending = { id: id, obj: obj, guard: obj.userData.dynamic ? 16 : 8, dynamic: !!obj.userData.dynamic };
  showToast('走过去');
}

// ===================== 放大界面：木鱼 / 念珠 / 上香 / 撸猫 =====================
const BEAD_N = 14;
let beadOffset = 0, beadActive = 0, lastWheel = 0, dragY = null, dragMoved = false;
let focusGuardUntil = 0, lastBeadMove = 0, dragSteps = 0;
let incenseStep = 0, incensePlaced = 0;
let coinBusy = false;
let petting = false, petDist = 0, petLastX = 0, petLastY = 0, petCount = 0, petNetTick = 0;

function layoutBeads() {
  const ring = $('beadRing'); if (!ring) return;
  ring.querySelectorAll('.bead').forEach((b, i) => {
    const a = (i / BEAD_N + beadOffset) * Math.PI * 2;
    const near = 0.5 - 0.5 * Math.cos(a);
    const s = 0.78 + 0.46 * near;
    b.style.left = (50 + Math.sin(a) * 19) + '%';
    b.style.top = (50 - Math.cos(a) * 43) + '%';
    b.style.transform = 'translate(-50%,-50%) scale(' + s.toFixed(3) + ')';
    b.style.opacity = (0.48 + 0.52 * near).toFixed(2);
    b.style.zIndex = String(Math.round(s * 100));
    b.classList.toggle('on', i === beadActive);
  });
}
function renderFocusObj(kind) {
  const box = el.focusObj; box.innerHTML = '';
  box.className = 'obj' + (kind === 'incense' || kind === 'pet' ? ' wide-obj' : '');
  if (kind === 'fish') {
    const d = document.createElement('div'); d.className = 'woodfish'; box.appendChild(d);
    const m = document.createElement('div'); m.className = 'mallet'; m.id = 'mallet';
    m.innerHTML = '<i class="stick"></i><i class="knob"></i>'; box.appendChild(m);
  } else if (kind === 'beads') {
    beadOffset = 0; beadActive = 0;
    const ring = document.createElement('div'); ring.className = 'beads'; ring.id = 'beadRing';
    for (let i = 0; i < BEAD_N; i++) {
      const b = document.createElement('div'); b.className = 'bead' + (i === 0 ? ' tassel' : ''); ring.appendChild(b);
    }
    const hint = document.createElement('div'); hint.className = 'bead-hint'; hint.id = 'beadHint'; hint.textContent = '上下滑动'; ring.appendChild(hint);
    box.appendChild(ring); layoutBeads();
  } else if (kind === 'lamp') {
    const st = document.createElement('div'); st.className = 'lamp-stage'; st.id = 'lampStage';
    st.innerHTML =
      '<div class="lamp-glow"></div><div class="lamp-halo"></div>' +
      '<div class="lamp-stand"><div class="lamp-bowl"><div class="lamp-oil"></div></div>' +
        '<div class="lamp-stem"></div><div class="lamp-foot"></div></div>' +
      '<div class="lamp-wick" id="lampWick"><i class="lamp-flame"></i></div>' +
      '<div class="lamp-tag" id="lampTag"><b id="lampTagName"></b><span id="lampWishText"></span></div>' +
      '<input class="lamp-wish" id="lampWish" maxlength="24" placeholder="写下此刻的心愿…" autocomplete="off" inputmode="text" enterkeyhint="done" />' +
      '<div class="lamp-hint" id="lampHint">写好愿望，轻点灯芯</div>';
    box.appendChild(st);
    bindLamp();
  } else if (kind === 'incense') {
    incenseStep = 0; incensePlaced = 0;
    const st = document.createElement('div'); st.className = 'incense-stage'; st.id = 'incenseStage';
    st.innerHTML =
      '<div class="i-item i-holder" id="iHolder"><div class="tube"></div><i></i><i></i><i></i><span class="tag">取一炷香</span></div>' +
      '<div class="i-item i-candle" id="iCandle"><b class="flame"></b><div class="wax"></div><span class="tag">就烛点燃</span></div>' +
      '<div class="i-item i-bowl" id="iBowl"><div class="ear l"></div><div class="ear r"></div>' +
        '<div class="body"></div><div class="ash"></div><div class="legs"><i></i><i></i><i></i></div>' +
        '<div class="slots" id="iSlots"></div><span class="tag">插入香炉</span></div>' +
      '<div class="hand-stick" id="handStick"></div>';
    box.appendChild(st);
    const hint = document.createElement('div'); hint.className = 'focus-hint'; hint.textContent = '取香 · 就烛 · 插炉'; box.appendChild(hint);
    bindIncense();
  } else if (kind === 'pet') {
    const st = document.createElement('div'); st.className = 'cat-stage'; st.id = 'catStage';
    st.innerHTML =
      '<div class="cat-purr"></div><div class="cat-tail"></div>' +
      '<div class="cat-body"><div class="cat-belly"></div></div>' +
      '<div class="cat-head"><div class="cat-ear l"></div><div class="cat-ear r"></div>' +
        '<div class="cat-eye l"></div><div class="cat-eye r"></div>' +
        '<div class="cat-cheek l"></div><div class="cat-cheek r"></div>' +
        '<div class="cat-nose"></div><div class="cat-mouth"></div></div>' +
      '<div class="cat-paw l"></div><div class="cat-paw r"></div>';
    box.appendChild(st);
    const hint = document.createElement('div'); hint.className = 'focus-hint'; hint.textContent = '按住，轻轻顺毛'; box.appendChild(hint);
    bindPet();
  } else if (kind === 'coin') {
    coinBusy = false;
    const st = document.createElement('div'); st.className = 'coin-stage'; st.id = 'coinStage';
    st.innerHTML =
      '<div class="coin-scene">' +
        '<div class="coin-water" id="coinWater"><div class="coin-floor"></div></div>' +
        '<div class="toad" id="coinToad">' +
          '<div class="toad-body"></div><div class="toad-head"></div>' +
          '<div class="toad-eye l"><i></i></div><div class="toad-eye r"><i></i></div>' +
          '<div class="toad-mouth" id="toadMouth"><b class="toad-coin"></b></div>' +
          '<div class="toad-leg l"></div><div class="toad-leg r"></div>' +
          '<span class="toad-star" style="left:42%;top:31%"></span>' +
          '<span class="toad-star" style="left:50%;top:34%"></span>' +
          '<span class="toad-star" style="left:57%;top:30%"></span>' +
        '</div>' +
        '<div class="coin-hint">投一枚 · 落一枚 · 池底渐满</div>' +
      '</div>';
    box.appendChild(st);
    // 打开面板时把全院日积月累的池底币一并画出来（刷新后仍看得见，不再清零）
    const water = st.querySelector('#coinWater');
    if (water) {
      pondCoinData.slice(-40).forEach((c) => {
        const sunk = document.createElement('div'); sunk.className = 'coin sunk-coin';
        sunk.style.left = (50 + c.x / 2.1 * 40) + '%';
        sunk.style.top = (48 + (c.z + 1.9) / 3.8 * 34) + '%';
        water.appendChild(sunk);
      });
    }
    const hint = document.createElement('div'); hint.className = 'focus-hint'; hint.textContent = '心诚则灵 · 不限次数'; box.appendChild(hint);
    bindCoin();
  }
  applyPropSprites(kind, box);
}
function strikeMallet() {
  const m = $('mallet'); if (!m) return;
  m.classList.remove('hit'); void m.offsetWidth; m.classList.add('hit');
  setTimeout(() => m.classList.remove('hit'), 145);
  const sp = document.createElement('div'); sp.className = 'spark'; el.focusObj.appendChild(sp);
  setTimeout(() => sp.remove(), 380);
}
function openFocus(kind) {
  clearHover();
  focusMode = true; focusKind = kind; focusCount = 0;
  dragY = null; dragMoved = false; lastWheel = 0; dragSteps = 0;
  petting = false; petDist = 0; petCount = 0; petNetTick = 0;
  focusGuardUntil = performance.now() + 320;
  renderFocusObj(kind);
  el.focus.classList.toggle('wide', kind === 'incense' || kind === 'pet' || kind === 'coin');
  el.focus.classList.toggle('beads-big', kind === 'beads');
  el.focus.classList.toggle('lamp-focus', kind === 'lamp');
  el.focus.classList.add('show');
  // 右上角工具按钮与「收起」位置重叠，打开聚焦界面时先藏起来，避免误触重置
  if (el.tools) el.tools.style.visibility = 'hidden';
  if (el.dock) el.dock.style.visibility = 'hidden';
  // v3：面板只给状态与动作提示，不出现「第 N 敲 / 第 N 念 / 好感度 / 功德 +N」这类计数。
  if (kind === 'fish') el.focusCount.textContent = '敲一敲 · 听一声';
  else if (kind === 'beads') el.focusCount.textContent = '拨一拨 · 静一念';
  else if (kind === 'incense') el.focusCount.textContent = '点香筒，取一炷香';
  else if (kind === 'lamp') el.focusCount.textContent = myLamp ? ('愿 · ' + myLamp.wish) : '点一盏灯';
  else if (kind === 'coin') el.focusCount.textContent = '点水面抛一枚硬币';
  else el.focusCount.textContent = '轻轻顺毛';
  if (kind === 'pet') CatLife.pet();
  Sound.unlock();
  if (kind !== 'pet') Sound.chantStart();
}
function closeFocus() {
  if (!focusMode) return;
  if (focusKind === 'pet') { petting = false; Sound.purrStop(); CatLife.endPet(); }
  if (focusKind === 'lamp' && lampTimeout) { clearTimeout(lampTimeout); lampTimeout = null; lampBusy = false; }
  focusMode = false; focusKind = null; dragY = null;
  el.focus.classList.remove('show', 'wide', 'beads-big', 'lamp-focus');
  if (el.tools) el.tools.style.visibility = '';
  if (el.dock) el.dock.style.visibility = '';
  Sound.chantStop();
}
function focusTap(dir) {
  if (!focusMode || performance.now() < focusGuardUntil) return;
  if (focusKind !== 'fish' && focusKind !== 'beads') return;
  const d = dir === -1 ? -1 : 1;
  focusCount += 1;
  Sound.unlock();
  const obj = el.focusObj;
  if (focusKind === 'fish') {
    Sound.woodfish(); strikeMallet();
    if (Math.random() < 0.3) CatLife.startle();   // 突然的木鱼声会惊到猫
    obj.classList.remove('bounce'); obj.classList.add('press');
    setTimeout(() => { obj.classList.remove('press'); obj.classList.add('bounce'); setTimeout(() => obj.classList.remove('bounce'), 170); }, 105);
  } else {
    Sound.tick();
    beadOffset = (beadOffset + d / BEAD_N) % 1;
    beadActive = (beadActive + d + BEAD_N) % BEAD_N;
    layoutBeads();
    const hint = $('beadHint'); if (hint) hint.classList.add('hide');
  }
  const rip = document.createElement('div'); rip.className = 'ripple'; obj.appendChild(rip);
  setTimeout(() => rip.remove(), 800);
  el.focusCount.textContent = focusKind === 'fish' ? '一声一响 · 心自静' : '一珠一念 · 莫问数';
  save.totalMerit += 1; persist(); updateHUD(); Net.action(focusKind);
}

// 上香：点香筒 → 点烛火 → 点香炉，全程点物件，无按钮
function bindIncense() {
  const holder = $('iHolder'), candle = $('iCandle'), bowl = $('iBowl'), stick = $('handStick');
  if (!holder || !candle || !bowl) return;
  const INCENSE_MAX = 3;   // 一炉三炷，插满就封炉，不许无限取
  function nudge(text) { el.focusCount.textContent = text; }
  function sealIfFull() {
    if (incensePlaced < INCENSE_MAX) return false;
    holder.classList.add('done'); holder.classList.remove('active');
    return true;
  }
  holder.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (sealIfFull()) { nudge('香已三炷 · 心诚则灵'); return; }
    if (incenseStep !== 0) { nudge('香已在手，先就烛火点燃'); return; }
    incenseStep = 1; stick.classList.add('show'); holder.classList.add('active');
    Sound.tick(); nudge('已取香 · 点烛火点燃');
  });
  candle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (incensePlaced >= INCENSE_MAX) { nudge('香已三炷 · 心诚则灵'); return; }
    if (incenseStep === 0) { nudge('先点香筒，取一炷香'); return; }
    if (incenseStep === 2) { nudge('香已燃 · 插入香炉'); return; }
    incenseStep = 2; stick.classList.add('lit'); candle.classList.add('active');
    Sound.lamp(); nudge('香已燃 · 点香炉插入');
  });
  bowl.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (incenseStep !== 2) { nudge('先取香、就烛点燃'); return; }
    // 插入：香支挂在香炉容器上（而不是细窄的 slots），才会真正立起来；炉中最多留 3 炷
    const old = bowl.querySelectorAll('.placed-stick');
    if (old.length >= 3) old[0].remove();
    const idx = bowl.querySelectorAll('.placed-stick').length;
    const s = document.createElement('div'); s.className = 'placed-stick';
    s.style.left = (44 + idx * 6) + '%';
    s.style.transform = 'rotate(' + (idx - 1) * 6 + 'deg)';
    bowl.appendChild(s);
    const smoke = document.createElement('div'); smoke.className = 'i-smoke';
    smoke.style.left = (46 + idx * 6) + '%';
    bowl.appendChild(smoke);
    incenseStep = 0; incensePlaced += 1;
    stick.classList.remove('show', 'lit'); holder.classList.remove('active'); candle.classList.remove('active');
    Sound.chime();
    save.totalMerit += META.incense.gain; persist(); updateHUD(); Net.action('incense');
    if (sealIfFull()) {
      nudge('三炷已满 · 心诚则灵');
      showToast('香已三炷，不必再添');
    } else nudge('第 ' + incensePlaced + ' 炷香 · 青烟袅袅');
  });
}
// 撸猫：按住拖动顺毛，累计距离给一次好感反馈
function bindPet() {
  const st = $('catStage'); if (!st) return;
  function heart(x, y) {
    const h = document.createElement('div'); h.className = 'pet-heart'; h.textContent = '♥';
    h.style.left = x + 'px'; h.style.top = y + 'px'; st.appendChild(h);
    setTimeout(() => h.remove(), 1300);
  }
  function onePet(x, y) {
    save.catAffection = Math.min(CONFIG.CAT_MAX, save.catAffection + 1);
    petCount += 1; petNetTick += 1;
    heart(x, y); Sound.tick();
    el.focusCount.textContent = '轻轻顺毛';
    persist(); updateHUD();
    if (petNetTick >= 3) { Net.action('pet'); petNetTick = 0; }
  }
  st.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    petting = true; petDist = 0; petLastX = e.clientX; petLastY = e.clientY;
    st.classList.add('petting'); Sound.unlock(); Sound.purrStart();
    try { st.setPointerCapture(e.pointerId); } catch (_) {}
  });
  st.addEventListener('pointermove', (e) => {
    if (!petting) return;
    petDist += Math.hypot(e.clientX - petLastX, e.clientY - petLastY);
    petLastX = e.clientX; petLastY = e.clientY;
    if (petDist >= 62) {
      petDist = 0;
      const r = st.getBoundingClientRect();
      onePet(e.clientX - r.left, e.clientY - r.top);
    }
  });
  function endPet(e) {
    if (!petting) return;
    petting = false; st.classList.remove('petting');
    if (petCount === 0) {
      const r = st.getBoundingClientRect();
      onePet((e && e.clientX ? e.clientX : r.left + r.width / 2) - r.left, (e && e.clientY ? e.clientY : r.top + r.height / 2) - r.top);
    }
    setTimeout(() => { if (!focusMode || focusKind !== 'pet') Sound.purrStop(); }, 500);
  }
  st.addEventListener('pointerup', endPet);
  st.addEventListener('pointercancel', endPet);
}

// 荷池抛币：每日三枚，落在金蟾口中就「吐宝」，其余只起一圈涟漪
function bindCoin() {
  const stage = $('coinStage'), toad = $('coinToad'), mouth = $('toadMouth');
  if (!stage || !toad || !mouth) return;
  stage.addEventListener('pointerdown', (e) => {
    if (focusKind !== 'coin' || coinBusy) return;
    if (performance.now() < focusGuardUntil) return;   // 开面板的那一下点击不算投币
    e.preventDefault(); e.stopPropagation();
    coinBusy = true;
    const r = stage.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    // 手感：落点带一点点手抖，投中靠瞄准
    const lx = clamp(cx + (Math.random() - 0.5) * 16, 8, r.width - 8);
    const ly = clamp(cy + (Math.random() - 0.5) * 12, 8, r.height - 8);

    const coin = document.createElement('div'); coin.className = 'coin toss-coin';
    coin.style.left = (r.width * 0.5) + 'px'; coin.style.top = (r.height * 0.96) + 'px';
    stage.appendChild(coin);
    const anim = coin.animate([
      { left: (r.width * 0.5) + 'px', top: (r.height * 0.96) + 'px', transform: 'translate(-50%,-50%) scale(1.2)' },
      { left: ((r.width * 0.5 + lx) / 2) + 'px', top: (Math.min(ly, r.height * 0.45) - 70) + 'px', transform: 'translate(-50%,-50%) scale(.82)' },
      { left: lx + 'px', top: ly + 'px', transform: 'translate(-50%,-50%) scale(1)' }
    ], { duration: 680, easing: 'cubic-bezier(.32,.02,.68,1)', fill: 'forwards' });

    anim.onfinish = () => {
      coin.remove();
      // 水花 + 涟漪
      const splash = document.createElement('div'); splash.className = 'coin-splash';
      splash.style.left = lx + 'px'; splash.style.top = ly + 'px'; stage.appendChild(splash);
      const rip = document.createElement('div'); rip.className = 'coin-ripple';
      rip.style.left = lx + 'px'; rip.style.top = ly + 'px'; stage.appendChild(rip);
      setTimeout(() => { splash.remove(); rip.remove(); }, 1350);
      // 面板里也留下这枚沉底的硬币：越投越多，看得见积累（不再删最旧）
      const water = $('coinWater');
      if (water) {
        const sunk = document.createElement('div'); sunk.className = 'coin sunk-coin';
        sunk.style.left = lx + 'px'; sunk.style.top = ly + 'px';
        water.appendChild(sunk);
      }

      const m = mouth.getBoundingClientRect();
      const mx = m.left + m.width / 2 - r.left, my = m.top + m.height / 2 - r.top;
      // 投进蟾口是低概率的福分：瞄准蟾口也只有约四分之一能进，随便点水面基本都落水
      const aimed = Math.hypot(lx - mx, ly - my) < 54;
      const hit = aimed ? Math.random() < 0.25 : Math.random() < 0.05;
      // 3D 落点与面板瞄准点用同一组归一化坐标，消除「面板投这里、院里落那里」的不同步
      const dropX = POND.x + (lx / r.width - 0.5) * 3.4;
      const dropZ = POND.z + (ly / r.height - 0.5) * 2.9;
      addCoin(dropX, dropZ);
      Sound.unlock();
      pondCoinDrop(dropX, dropZ, hit);
      pondSplash(dropX, dropZ, hit);

      if (hit) {
        save.coinHit += 1; persist();
        toad.classList.remove('happy'); void toad.offsetWidth; toad.classList.add('happy');
        const txt = document.createElement('div'); txt.className = 'coin-hit-text';
        txt.textContent = '一声清响'; stage.appendChild(txt);
        setTimeout(() => txt.remove(), 1550);
        Sound.chime();
        Net.action('coin');
      } else {
        Sound.tick();
      }
      el.focusCount.textContent = hit ? '投进金蟾口 · 一声清响' : '落进荷池 · 涟漪渐开';
      coinBusy = false;
    };
  });
}

// ===================== 点灯：写愿望 → 点灯芯 → 每人每日一盏 =====================
function applyLampState(l) {
  const st = $('lampStage'); if (!st) return;
  st.classList.add('lit');
  const name = $('lampTagName'), text = $('lampWishText'), hint = $('lampHint');
  if (name) name.textContent = (l.name || '我') + ' 的愿';
  if (text) text.textContent = l.wish;
  if (hint) hint.textContent = '长明灯已亮 · 明日再来';
  el.focusCount.textContent = '愿 · ' + l.wish;
}
function bindLamp() {
  const st = $('lampStage'), wick = $('lampWick'), input = $('lampWish');
  if (!st || !wick) return;
  if (myLamp) { applyLampState(myLamp); return; }
  if (input) {
    input.addEventListener('pointerdown', e => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') return;      // 留给 window 收起界面
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); tryLightLamp(); }
    });
  }
  wick.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); tryLightLamp(); });
}
function tryLightLamp() {
  if (lampBusy || myLamp) return;
  const st = $('lampStage'), input = $('lampWish');
  const wish = ((input && input.value) || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 24);
  if (!wish) {
    el.focusCount.textContent = '先写下心愿，再点灯芯';
    if (st) { st.classList.remove('shake'); void st.offsetWidth; st.classList.add('shake'); }
    return;
  }
  lampBusy = true; el.focusCount.textContent = '点亮中…';
  Net.lightLamp(wish);
  // 断线兜底：本地按日期记一盏，避免长时间卡在「点亮中」
  lampTimeout = setTimeout(() => {
    lampTimeout = null;
    if (!myLamp) onLampOk({ lamp: { name: myName || '我', wish, date: localDateStr(), litAt: Date.now(), local: true } }, true);
  }, 2200);
}
function addLamp(l) {
  const i = todayLamps.findIndex(x => x.name === l.name && x.date === l.date);
  if (i >= 0) todayLamps[i] = l; else todayLamps.push(l);
  todayLamps.sort((a, b) => a.litAt - b.litAt);
  updateLanterns();
}
function onLampOk(m, local) {
  lampBusy = false;
  if (lampTimeout) { clearTimeout(lampTimeout); lampTimeout = null; }
  const l = m.lamp; if (!l) return;
  if (myLamp) { applyLampState(myLamp); return; }   // 本地兜底先到时，服务端回包不重复加功德
  myLamp = l; saveLocalLamp(l); addLamp(l);
  Sound.lamp(); Sound.chime();
  save.totalMerit += META.lamp.gain; persist(); updateHUD();
  if (!local) Net.action('lamp');
  applyLampState(l);
  showToast(local ? '愿灯已亮（离线记账）' : '愿灯已亮 · ' + l.wish);
}
function onLampDeny(m) {
  lampBusy = false;
  if (lampTimeout) { clearTimeout(lampTimeout); lampTimeout = null; }
  if (m.reason === 'empty') { el.focusCount.textContent = '愿望不能为空'; return; }
  if (m.lamp) { myLamp = m.lamp; saveLocalLamp(m.lamp); addLamp(m.lamp); applyLampState(m.lamp); }
  showToast('今日已点过一盏长明灯，明日再来');
}

// ===================== 多人层 =====================
const Net = (function () {
  let ws = null, handlers = {}, fullMode = false;
  function on(t, cb) { handlers[t] = cb; }
  function emit(t, d) { if (handlers[t]) handlers[t](d); }
  function connect() {
    try {
      ws = new WebSocket(CONFIG.WS_URL);
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.type === 'full') {
          fullMode = true; emit('full', m);
          // 满员不疯狂重连：20 秒后再安静地试一次
          setTimeout(() => { fullMode = false; connect(); }, 20000);
          try { ws.close(); } catch (_) {}
          return;
        }
        emit(m.type, m);
      };
      ws.onopen = () => { emit('presence', { count: 0, capacity: CAPACITY }); send({ type: 'hello', name: myName }); };
      ws.onerror = () => emit('presence', { count: -1 });
      ws.onclose = () => { emit('presence', { count: -1 }); if (!fullMode) setTimeout(connect, 2500); };
    } catch (_) { emit('presence', { count: -1 }); setTimeout(connect, 2500); }
  }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  return { connect, on,
    move: (x, z) => send({ type: 'move', x, z }),
    action: (p) => send({ type: 'action', pose: p }),
    lightLamp: (w) => send({ type: 'lightLamp', wish: w }),
    coinDrop: (x, z) => send({ type: 'coinDrop', x, z }),
    greet: (to) => send({ type: 'greet', to }),
    greetAccept: (to) => send({ type: 'greetAccept', to }),
    chat: (to, idx) => send({ type: 'chat', to, idx }),
    chatClose: () => send({ type: 'chatClose' }) };
})();

function addPeer(m) {
  if (peers[m.id]) return;
  const tint = ROBE_BLUES[(m.id - 1) % ROBE_BLUES.length];
  const mk = buildMonk(tint); mk.group.position.set(m.x, 0, m.z);
  mk.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  scene.add(mk.group);
  const label = document.createElement('div'); label.className = 'pname'; label.textContent = m.name || '香客'; el.labels.appendChild(label);
  // 点同修法号牌 = 合十行礼并发出同坐邀请（不弹窗、不抢镜头）
  label.addEventListener('click', (e) => { e.stopPropagation(); startGreet(m.id); });
  peers[m.id] = {
    group: mk.group, bowPivot: mk.bowPivot, lower: mk.lower, knees: mk.knees,
    hands: mk.hands, eyes: mk.eyes, rig: mk.rig, target: new THREE.Vector3(m.x, 0, m.z),
    pose: 'idle', poseT: 0, kneel: m.pose === 'bow', kneelT: 0, name: m.name, label
  };
  addCoName(m.name);
}

// ===================== HUD =====================
// v3 宪章：氛围观赏型、零数值。功德 / 修行时长 / 今日修行 / 计数器全部从界面移除，
// 存档字段与累计逻辑保留（不破坏旧存档迁移），只是不再显示。
const DAILY_VERSES = [
  '风来疏竹 · 雁度寒潭', '竹密不妨流水过', '山高岂碍白云飞',
  '闲看庭前花开花落', '云在青天水在瓶', '一花一世界 · 一叶一如来',
  '行到水穷处 · 坐看云起时', '心安即是归处'
];
function updateHUD() {
  if (el.dailyVerse) {
    const d = new Date();
    const k = d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate();
    el.dailyVerse.textContent = DAILY_VERSES[k % DAILY_VERSES.length];
  }
  if (el.presenceHint) el.presenceHint.textContent = '佛前 18 席 · 随意落座';
}
let toastTimer = null;
function showToast(msg) {
  el.toast.textContent = msg; el.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 1800);
}
let muted = false;
function toggleMute() { muted = !muted; Sound.setMute(muted); el.mute.textContent = muted ? '已静音' : '声音'; }
function resetSave() {
  if (!confirm('确定重置静修记录？功德、点亮的灯与修行时间都会归零。')) return;
  try { localStorage.removeItem(CONFIG.SAVE_KEY); localStorage.removeItem(CONFIG.CO_KEY); } catch (e) {}
  save = defaultSave(); co = { date: '', names: [], seconds: 0 }; sessionSeconds = 0;
  kneeling = false; kneelT = 0; activeCushion = null;
  persist(); updateHUD(); updateLanterns(); showToast('已重置');
}

// ===================== 输入 =====================
// 鼠标落在院子里的地面点：起身时要朝这个方向，而不是一直背对镜头
const pointerGround = new THREE.Vector3(0, 0, 8);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function trackPointerGround(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(groundPlane, p) && Math.hypot(p.x, p.z) < 60) pointerGround.copy(p);
}
function onPointerMove(e) {
  if (state !== 'playing') return;
  trackPointerGround(e);
  // 触屏没有 hover：手指划过就弹提示纸片会挡住佛像，只在鼠标上显示
  if (e.pointerType && e.pointerType !== 'mouse') { clearHover(); return; }
  if (focusMode || performance.now() < sceneGuardUntil) return;
  const hit = pickRoot(e);
  if (!hit || hit.root.userData.action === 'walk') { clearHover(); return; }
  setHover(hit.root, e.clientX, e.clientY);
}
function onPointerDown(e) {
  if (state !== 'playing' || focusMode || performance.now() < sceneGuardUntil) return;
  Sound.unlock();
  trackPointerGround(e);
  const hit = pickRoot(e);
  if (!hit) {
    if (e.pointerType === 'touch' && performance.now() > (window.__lastMissTip || 0) + 2200) {
      window.__lastMissTip = performance.now(); showToast('轻点物件或空地');
    }
    return;
  }
  if (hit.root.userData.action === 'walk') {
    pending = null;
    if (catLife && catLife.state === 'wait') { catLife.wait = false; catPick(); }  // 不等了，猫继续过自己的日子
    if (kneeling) toggleKneel(activeCushion);   // 跪着时点任意空地：先起身，再走过去
    const cw = clampWalk(hit.point.x, hit.point.z);
    target.set(cw.x, 0, cw.z);
    Net.move(target.x, target.z);
  } else approachAndDo(hit.root);
}
function onKey(e) {
  if (e.key === 'Escape') { closeFocus(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (!focusMode) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); focusTap(e.key === 'ArrowUp' ? -1 : 1); }
  else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); focusTap(1); }
}

// ===================== 相机 / 标签 =====================
function updateCamera(dt) {
  // 第三人称：横屏沿用远随；竖屏换成「略高、更平、往后退」的专用机位，
  // 让大殿、拜垫阵与荷池落在画面中段，而不是留一大片空天空。
  const mx = monkObj.position.x, mz = monkObj.position.z;
  let camTarget, lookX, lookY, lookZ;
  if (camera.aspect < 0.72) {
    // 视线压低、俯角加大：把远山背景压到画面上缘，大殿 / 拜垫 / 荷池顶满中下段
    camTarget = new THREE.Vector3(mx * 0.4, 11.6, mz + 20.0);
    lookX = mx * 0.28; lookY = 0.9; lookZ = mz - 8.4;
  } else {
    camTarget = new THREE.Vector3(mx * 0.62, 9.4, mz + 17.5);
    lookX = mx * 0.62; lookY = 2.8; lookZ = mz - 10.5;
  }
  // 入场缓推：按真实时间推进（不依赖帧率），起点只略高略远，避免拉远后露出远山平面边缘
  introT = Math.min(1, introT + (dt || 0.016) / 2.4);
  const e = 1 - Math.pow(1 - introT, 3);
  if (introT < 1) {
    const introStart = new THREE.Vector3(camTarget.x - 1.4, camTarget.y + 4.8, camTarget.z + 5.2);
    camera.position.copy(introStart.lerp(camTarget, e));
  } else {
    camera.position.lerp(camTarget, 0.07);
  }
  camera.lookAt(lookX, lookY, lookZ);
}
// ===================== 同修社交：行礼 / 邀请 / 气泡 / 第三人省略号 =====================
let inviteTag = null, inviteTimer = 0;
function startGreet(id) {
  if (id === myId || !peers[id] || chatPeerId !== null) return;
  playGreet(); Net.greet(id);
  showToast('已合十 · 待对方回礼');
}
function showInvite(from, name) {
  if (!el.labels) return;
  if (inviteTag) inviteTag.remove();
  const tag = document.createElement('div');
  tag.className = 'greet-invite';
  tag.textContent = (name || '一位同修') + ' 合十 · 点此回礼';
  tag.addEventListener('click', (e) => {
    e.stopPropagation();
    tag.remove(); if (inviteTag === tag) inviteTag = null;
    playGreet(); Net.greetAccept(from);
  });
  el.labels.appendChild(tag);
  inviteTag = tag;
  clearTimeout(inviteTimer);
  inviteTimer = setTimeout(() => { tag.remove(); if (inviteTag === tag) inviteTag = null; }, 8000);
}
function showChatBubble(targetId, text, mine) {
  if (!el.labels) return;
  const node = document.createElement('div');
  node.className = 'chat-bubble' + (mine ? ' mine' : '');
  node.textContent = text;
  el.labels.appendChild(node);
  if (targetId === myId) {
    if (selfBubble) selfBubble.remove();
    selfBubble = node;
  } else {
    const p = peers[targetId];
    if (!p) { node.remove(); return; }
    if (p.bubble) p.bubble.remove();
    p.bubble = node;
  }
  clearTimeout(bubbleTimers[targetId]);
  bubbleTimers[targetId] = setTimeout(() => {
    node.remove();
    if (targetId === myId) { if (selfBubble === node) selfBubble = null; }
    else if (peers[targetId] && peers[targetId].bubble === node) peers[targetId].bubble = null;
  }, 5600);
}
function showMute(id) {
  if (id === myId || !peers[id] || !el.labels) return;
  const p = peers[id];
  if (p.mute) p.mute.remove();
  const node = document.createElement('div');
  node.className = 'chat-mute'; node.textContent = '···';
  el.labels.appendChild(node); p.mute = node;
  setTimeout(() => { node.remove(); if (p.mute === node) p.mute = null; }, 5600);
}
function openChatBar(peerId, name) {
  chatPeerId = peerId;
  const bar = $('chatBar'), lines = $('chatLines'), peer = $('chatPeer');
  if (!bar || !lines || !peer) return;
  peer.textContent = '与 ' + (name || '同修') + ' 同坐';
  lines.innerHTML = '';
  CHAT_LINES.forEach((s, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = s;
    b.addEventListener('click', () => { if (chatPeerId !== null) Net.chat(chatPeerId, i); });
    lines.appendChild(b);
  });
  bar.classList.add('show');
}
function closeChatBar(localOnly) {
  chatPeerId = null;
  const bar = $('chatBar'); if (bar) bar.classList.remove('show');
  if (!localOnly) Net.chatClose();
}

function updateLabels() {
  if (!el.labels) return;
  const W = el.labels.clientWidth, H = el.labels.clientHeight;
  // 法号牌避让：几位同修站得近时，把重叠的牌子依次向上错开，不再叠成一团
  const placed = [];
  const put = (label, v) => {
    if (v.z >= 1) { label.style.display = 'none'; return; }
    const x = (v.x * 0.5 + 0.5) * W;
    const y = (-v.y * 0.5 + 0.5) * H;
    let dy = 0;
    for (let guard = 0; guard < 8; guard++) {
      const hit = placed.some(p => Math.abs(p.x - x) < 76 && Math.abs(p.y - (y + dy)) < 25);
      if (!hit) break;
      dy -= 26;
    }
    placed.push({ x, y: y + dy });
    label.style.display = 'block';
    label.style.left = x + 'px';
    label.style.top = (y + dy) + 'px';
  };
  if (selfLabel && monkObj && myName) {
    const v = monkObj.position.clone(); v.y += 2.52 - (kneeling ? 0.34 : 0); v.project(camera);
    put(selfLabel, v);
  }
  // 气泡 / 回礼签 / 省略号复用同一套屏幕投影与 26px 避让，不再另写一套
  if ((selfBubble || inviteTag) && monkObj) {
    const v = monkObj.position.clone(); v.y += 2.52 - (kneeling ? 0.34 : 0); v.project(camera);
    if (selfBubble) put(selfBubble, v);
    if (inviteTag) put(inviteTag, v);
  }
  for (const id in peers) {
    const p = peers[id]; const v = p.group.position.clone(); v.y += 2.4; v.project(camera);
    put(p.label, v);
    if (p.bubble) put(p.bubble, v);
    if (p.mute) put(p.mute, v);
  }
}

// ===================== 主循环 =====================
function update(dt) {
  time += dt;
  sessionSeconds += dt; co.seconds += dt;
  hudT -= dt; coPersistT -= dt;
  if (hudT <= 0) { updateHUD(); hudT = 0.3; }
  if (coPersistT <= 0) { persistCo(); coPersistT = 3; }

  if (monkPoseT > 0) monkPoseT -= dt;
  if (greetAnim > 0) greetAnim = Math.max(0, greetAnim - dt);   // 1.85s 行礼（含 0.5s 收手回落）
  const dx = target.x - monkObj.position.x, dz = target.z - monkObj.position.z, d = Math.hypot(dx, dz);
  const moving = d > 0.05;
  if (moving) {
    const s = Math.min(d, CONFIG.WALK_SPEED * dt);
    monkObj.position.x += dx / d * s; monkObj.position.z += dz / d * s;
    if (!kneeling) monkYawTarget = Math.atan2(dx, dz);   // 朝行进方向
  }
  applyPose(bowPivot, monkPose, monkPoseT);
  if (monkPose === 'beads' && monkPoseT > 0 && beadsMesh) beadsMesh.rotation.z += dt * 3;

  // 走到任何拜垫上就自然「踩上垫面」：脚底不会插进蒲团，也不需要把人沉进地面
  const nearC = nearestCushion(monkObj.position);
  const dc = Math.hypot(nearC.position.x - monkObj.position.x, nearC.position.z - monkObj.position.z);
  const standY = dc < 0.8 ? 0.25 * Math.min(1, (0.8 - dc) / 0.34) : 0;
  const baseY = groundYAt(monkObj.position.x, monkObj.position.z);
  monkObj.position.y = baseY + standY;

  // 跪拜：只有上身前俯下沉、双膝落到垫上、双手合十；下身与鞋保持贴着垫面
  kneelT += ((kneeling ? 1 : 0) - kneelT) * Math.min(1, dt * 4.5);
  if (kneeling) { monkYawTarget = Math.PI; monkObj.position.y = baseY + 0.30; }
  // 朝向：按最大角速度转，转身过程有侧身过渡；不再出现「起身后一直背身」
  monkYaw = turnTo(monkYaw, monkYawTarget, dt * (kneeling ? 6 : 9));
  monkObj.rotation.y = monkYaw;
  const bob = moving && !kneeling ? Math.sin(time * 11) * 0.035 : 0;  // 走路轻轻起伏
  // 跪坐合十：只轻微前俯与下沉，保留完整身形，不要趴成一团
  bowPivot.position.y = -0.11 * kneelT + bob;
  bowPivot.rotation.x = 0.24 * kneelT;
  bowPivot.scale.y = 1 - 0.06 * kneelT;
  if (monkLower) monkLower.scale.y = 1 - 0.18 * kneelT;
  if (monkKnees) for (const k of monkKnees) k.visible = kneelT > 0.32;
  // 合十 / 跪拜合掌：双手从袖口翻起合于胸前（k 越大越合拢），袖臂同步抬起
  const ckSelf = monkPose === 'clasp' ? clamp(1 - monkPoseT / 0.8, 0, 1) : 0;
  const bkSelf = kneelT > 0.4 ? clamp((kneelT - 0.4) / 0.6, 0, 1) : 0;
  const hkSelf = Math.max(ckSelf, bkSelf, greetK(greetAnim));
  hands.visible = hkSelf > 0.02;
  handsRigApply(hands, monkRig, hkSelf);
  for (const c of cushions) {
    const m = c.material || c.userData.clothMat;
    if (m) m.emissiveIntensity = (c === activeCushion) ? 0.75 * kneelT : 0;
  }

  // 贴地软阴影、佛光呼吸、萤火浮动
  if (monkShadow) {
    monkShadow.position.x = monkObj.position.x; monkShadow.position.z = monkObj.position.z;
    monkShadow.position.y = baseY + 0.035;
    monkShadow.material.opacity = 0.32 - 0.06 * kneelT;
  }
  if (catShadow && catObj) { catShadow.position.x = catObj.position.x; catShadow.position.z = catObj.position.z; }
  if (statueHalo) statueHalo.material.opacity = 0.17 + Math.sin(time * 0.8) * 0.05;
  if (kneelGlow) {
    if (kneeling && activeCushion) {
      kneelGlow.position.x = activeCushion.position.x;
      kneelGlow.position.z = activeCushion.position.z;
      kneelGlow.material.opacity = (0.55 + Math.sin(time * 2.1) * 0.1) * kneelT;
    } else kneelGlow.material.opacity = 0;
  }
  if (fireflies) fireflies.position.y = Math.sin(time * 0.45) * 0.32;

  // 走到跟前才触发，绝不隔空交互；目标会动时落脚点每帧跟着重算
  if (pending) {
    pending.guard -= dt;
    if (pending.dynamic && pending.obj) {
      const s = spotOf(pending.obj);
      target.set(s.x, 0, s.z);
      if (Math.random() < 0.06) Net.move(target.x, target.z);
    }
    const rest = Math.hypot(target.x - monkObj.position.x, target.z - monkObj.position.z);
    const ok = pending.dynamic ? (distanceTo(pending.obj) <= CONFIG.REACH + 0.2) : (rest < 0.22);
    if (ok) { const p = pending; pending = null; trigger(p.id, p.obj); }
    else if (pending.guard <= 0) pending = null;
  }

  for (const id in peers) {
    const p = peers[id]; const px = p.target.x - p.group.position.x, pz = p.target.z - p.group.position.z, pd = Math.hypot(px, pz);
    if (pd > 0.05) {
      const s = Math.min(pd, 3.0 * dt);
      p.group.position.x += px / pd * s; p.group.position.z += pz / pd * s;
      if (!p.kneel) p.group.rotation.y = Math.atan2(px, pz);
    }
    if (p.poseT > 0) p.poseT -= dt;
    applyPose(p.bowPivot, p.pose, p.poseT);
    p.kneelT += ((p.kneel ? 1 : 0) - p.kneelT) * Math.min(1, dt * 4.5);
    const pc = nearestCushion(p.group.position);
    const pdc = Math.hypot(pc.position.x - p.group.position.x, pc.position.z - p.group.position.z);
    p.group.position.y = pdc < 0.8 ? 0.25 * Math.min(1, (0.8 - pdc) / 0.34) : 0;
    if (p.kneel) {
      p.group.position.y = 0.25;
      let a = p.group.rotation.y, diff = Math.PI - a;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.group.rotation.y = a + diff * Math.min(1, dt * 9);
    }
    p.bowPivot.position.y = -0.11 * p.kneelT;
    p.bowPivot.rotation.x = 0.24 * p.kneelT;
    if (p.lower) p.lower.scale.y = 1 - 0.18 * p.kneelT;
    if (p.knees) for (const k of p.knees) k.visible = p.kneelT > 0.32;
    const ckP = p.pose === 'clasp' ? clamp(1 - p.poseT / 0.8, 0, 1) : 0;
    const bkP = p.kneelT > 0.4 ? clamp((p.kneelT - 0.4) / 0.6, 0, 1) : 0;
    if (p.greetAnim > 0) p.greetAnim = Math.max(0, p.greetAnim - dt);
    const hkP = Math.max(ckP, bkP, greetK(p.greetAnim || 0));
    p.hands.visible = hkP > 0.02;
    handsRigApply(p.hands, p.rig, hkP);
  }

  updateCatLife(dt); updateFlames(); updateLure(dt); updatePond(dt); updateLeafPiles(dt); updateMonkIdle();
  updatePetals(dt); updateHearts(dt); updateIncenseSmoke(dt);

  if (hovered) {
    const p = ringPosOf(hovered);
    hoverRing.position.set(p.x, 0.04, p.z);
    const pulse = 1 + Math.sin(time * 4) * 0.09;
    hoverRing.scale.set(pulse, pulse, pulse);
    hoverRing.material.opacity = 0.55 + Math.sin(time * 4) * 0.25;
  }
}

let lastTs = 0;
function frame(ts) {
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0; lastTs = ts;
  if (state === 'playing') update(dt);
  updateCamera(dt); updateLabels();
  if (usePost && composer) composer.render(dt);
  else renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ===================== 启动 =====================
function initThree() {
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true });
  const touchDevice = matchMedia('(hover: none)').matches || innerWidth < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touchDevice ? 1.5 : 2));
  // 色彩管理 + 电影级色调映射 + 柔和阴影：让原画、贴图与 3D 物件待在同一套光里
  if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.16;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r187 已移除 PCFSoftShadowMap
  camera = new THREE.PerspectiveCamera(58, 1, 0.1, 260);
  camera.position.set(-1.4, 14.2, 27.8);   // 入场运镜起点：略高略远，不拉到露出远山边缘
  raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2();
  window.addEventListener('resize', onResize);
  onResize();
}
function initPost() {
  const touch = matchMedia('(hover: none)').matches || innerWidth < 700;
  usePost = !touch;   // 触屏直接走 renderer.render，省掉一次全屏合成与 Bloom
  if (!usePost || !renderer || !scene || !camera) return;
  try {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    gradePass = new ShaderPass(GradeShader);
    composer.addPass(gradePass);
    // 只让佛前暖光与纸灯这种极亮处轻微晕开，不做年节感的泛光
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.16, 0.42, 0.92));
    composer.addPass(new OutputPass());
    onResize();
  } catch (e) { console.warn('post fx unavailable', e); composer = null; usePost = false; }
}
function onResize() {
  const canvas = renderer.domElement; const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const aspect = w / h;
  camera.aspect = aspect;
  // 竖屏水平视野被压得很窄：适度放大 fov，才能把大殿与两侧拜垫收进画面
  camera.fov = aspect < 0.72 ? 68 : (aspect < 1.1 ? 62 : 58);
  camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
  if (composer) composer.setSize(w, h);
}


// ===================== 放大界面：与 3D 场景同源的离屏渲染图 =====================
// 以前每个放大面板都用 CSS 渐变另画一只猫 / 一只金蟾，和院子里的 3D 模型不是同一个东西。
// 现在统一用同一套 Three.js 建模函数 + 同一套灯光，离屏渲染成透明 PNG 给面板使用。
const PROP_SPRITES = {};
const SPRITE_SIZE = 448;
let spriteRT = null, spriteScene = null, spriteCam = null;

function propMat(color, rough, metal) {
  return new THREE.MeshStandardMaterial({ color: color, roughness: rough == null ? 0.82 : rough, metalness: metal || 0 });
}
function buildPropModel(key) {
  // 场景里已有同款模型的，直接复用建模函数，保证「同源」而不是另画一只
  if (key === 'bowl') return buildIncenseBurner();
  if (key === 'cat') { const c = buildCat(); return c.group || c; }
  if (key === 'toad') { const t = buildToad(); return t.group || t; }
  const g = new THREE.Group();
  const wood = propMat(0xa98257, 0.86), woodLt = propMat(0xc3a176, 0.8);
  const dark = propMat(0x5c4c3a, 0.7), bronze = propMat(0xa08f6c, 0.5, 0.45);
  if (key === 'fish') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), wood);
    body.scale.set(1.18, 0.82, 1.0); g.add(body);
    // 木鱼的开口是一道弧形缝，不是横贯的黑条
    const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.10, 8, 28, Math.PI * 1.18), dark);
    mouth.rotation.z = -0.08; mouth.scale.set(1.0, 0.42, 1.0);
    mouth.position.set(0, -0.04, 0.99); g.add(mouth);
    const cavity = new THREE.Mesh(new THREE.SphereGeometry(0.66, 18, 12), dark);
    cavity.scale.set(1.0, 0.15, 0.06); cavity.position.set(0, -0.09, 1.0); g.add(cavity);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.76, 0.035, 8, 28), woodLt);
    rim.rotation.x = Math.PI / 2; rim.position.y = -0.02; g.add(rim);
  } else if (key === 'mallet') {
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 2.0, 10), woodLt);
    stick.position.y = -0.35; g.add(stick);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.32, 18, 14), wood);
    knob.position.y = 0.78; g.add(knob);
  } else if (key === 'bead') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1, 22, 18), woodLt));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 2.1, 10), dark));
  } else if (key === 'lamp') {
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.62, 0.42, 20), bronze);
    bowl.position.y = 0.62; g.add(bowl);
    const oil = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.04, 20), propMat(0xb9a26e, 0.4, 0.2));
    oil.position.y = 0.84; g.add(oil);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.8, 12), bronze);
    stem.position.y = 0.1; g.add(stem);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.18, 20), dark);
    foot.position.y = -0.38; g.add(foot);
    const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 8), dark);
    wick.position.set(0, 0.96, 0.28); g.add(wick);
  } else if (key === 'holder') {
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.5, 1.5, 18), wood));
    const lip = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.06, 8, 24), woodLt);
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.76; g.add(lip);
    for (let i = -1; i <= 1; i++) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.6, 8), propMat(0xb98f5c, 0.85));
      st.position.set(i * 0.2, 1.1, 0); st.rotation.z = i * 0.09; g.add(st);
    }
  } else if (key === 'candle') {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.14, 18), bronze);
    base.position.y = -0.8; g.add(base);
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.32, 1.5, 16), propMat(0xe0d6bc, 0.9));
    g.add(wax);
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12),
      new THREE.MeshBasicMaterial({ color: 0xe8c687, transparent: true, opacity: 0.9 }));
    flame.scale.set(0.7, 1.5, 0.7); flame.position.y = 0.92; g.add(flame);
  }
  return g;
}
function ensureSpriteStage() {
  if (spriteRT) return true;
  try {
    spriteRT = new THREE.WebGLRenderTarget(SPRITE_SIZE, SPRITE_SIZE, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false
    });
    spriteScene = new THREE.Scene();
    spriteCam = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    spriteCam.position.set(0, 1.05, 6.0); spriteCam.lookAt(0, 0.25, 0);
    // 与主场景同一套光，保证放大图和院子里的物件看起来是同一种材质
    spriteScene.add(new THREE.HemisphereLight(0xfff4df, 0x7c8277, 1.65));
    const key = new THREE.DirectionalLight(0xffedcf, 2.3); key.position.set(4, 6, 5); spriteScene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d6cf, 0.85); fill.position.set(-4, 2, 4); spriteScene.add(fill);
    const front = new THREE.DirectionalLight(0xfff6e4, 0.95); front.position.set(0, 1, 8); spriteScene.add(front);
    return true;
  } catch (e) { console.warn('sprite stage unavailable', e); return false; }
}
function renderPropSprite(key) {
  // buildIncenseBurner 会往全局烟雾表登记 sprite；离屏用的那份不属于主场景，用完立刻撤回
  const smokeLen = incenseSmoke.length;
  const obj = buildPropModel(key);
  if (incenseSmoke.length > smokeLen) incenseSmoke.length = smokeLen;
  if (!obj) return null;
  const holder = new THREE.Group(); holder.add(obj); spriteScene.add(holder);
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  obj.scale.multiplyScalar(2.95 / maxDim);
  obj.updateMatrixWorld(true);
  const center = new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3());
  obj.position.sub(center); obj.position.y += 0.12;
  // 猫的模型默认朝 +X，转 -90° 让它正面对着放大面板；金蟾保留四分之三侧
  obj.rotation.y = key === 'cat' ? (-Math.PI / 2 + 0.18) : (key === 'toad' ? -0.25 : 0.12);

  const prevTarget = renderer.getRenderTarget();
  const prevColor = renderer.getClearColor(new THREE.Color()).clone();
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(spriteRT);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(spriteScene, spriteCam);
  const buf = new Uint8Array(SPRITE_SIZE * SPRITE_SIZE * 4);
  renderer.readRenderTargetPixels(spriteRT, 0, 0, SPRITE_SIZE, SPRITE_SIZE, buf);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevColor, prevAlpha);
  spriteScene.remove(holder);

  // WebGL 像素自下而上，canvas 自上而下：逐行翻转成透明 PNG
  const cv = document.createElement('canvas'); cv.width = cv.height = SPRITE_SIZE;
  const ctx = cv.getContext('2d'); const out = ctx.createImageData(SPRITE_SIZE, SPRITE_SIZE);
  const row = SPRITE_SIZE * 4;
  for (let y = 0; y < SPRITE_SIZE; y++) {
    out.data.set(buf.subarray((SPRITE_SIZE - 1 - y) * row, (SPRITE_SIZE - y) * row), y * row);
  }
  ctx.putImageData(out, 0, 0);
  return cv.toDataURL('image/png');
}
async function buildPropSprites() {
  if (!renderer || !ensureSpriteStage()) return;
  const keys = ['fish', 'mallet', 'bead', 'lamp', 'holder', 'candle', 'bowl', 'cat', 'toad'];
  for (const k of keys) {
    try { PROP_SPRITES[k] = renderPropSprite(k); } catch (e) { console.warn('sprite fail', k, e); }
    await new Promise((r) => setTimeout(r, 16));  // 分帧生成，别卡住首屏
  }
}
// 把渲染图挂进面板 DOM；拿不到图就什么都不做，自动回退到原来的 CSS 画法
function applyPropSprites(kind, box) {
  const put = (key, sel, cls) => {
    const url = PROP_SPRITES[key]; if (!url) return false;
    const host = sel ? box.querySelector(sel) : box;
    if (!host) return false;
    const im = document.createElement('img');
    im.className = 'prop-img ' + (cls || ''); im.src = url; im.alt = ''; im.draggable = false;
    host.insertBefore(im, host.firstChild);
    return true;
  };
  let ok = false;
  if (kind === 'fish') ok = put('fish', '.woodfish', 'prop-fish') && put('mallet', '.mallet', 'prop-mallet');
  else if (kind === 'beads') {
    const url = PROP_SPRITES.bead;
    if (url) box.querySelectorAll('.bead').forEach((b) => {
      b.style.backgroundImage = 'url("' + url + '")';
      b.style.backgroundSize = 'contain'; b.style.backgroundRepeat = 'no-repeat';
      b.style.backgroundPosition = 'center';
    });
    ok = !!url;
  } else if (kind === 'lamp') ok = put('lamp', '.lamp-stage', 'prop-lamp');
  else if (kind === 'incense') ok = put('holder', '.i-holder', 'prop-holder') && put('candle', '.i-candle', 'prop-candle') && put('bowl', '.i-bowl', 'prop-bowl');
  else if (kind === 'pet') ok = put('cat', '.cat-stage', 'prop-cat');
  else if (kind === 'coin') ok = put('toad', '.toad', 'prop-toad');
  if (ok) box.classList.add('sprite-mode');
}

async function boot() {
  el.dailyVerse = $('dailyVerse'); el.presenceHint = $('presenceHint');
  el.presence = $('presence'); el.toast = $('toast'); el.mute = $('mute'); el.labels = $('labels');
  el.tip = $('hoverTip'); el.focus = $('focus'); el.focusObj = $('focusObj'); el.focusCount = $('focusCount');
  el.dharma = $('dharmaName'); el.fullGate = $('fullGate'); el.fullMsg = $('fullMsg');
  el.entry = $('entry'); el.entryName = $('entryName'); el.veil = $('veil');
  el.tools = document.querySelector('.tools'); el.dock = $('dock');

  // 自己头顶也挂一块法号牌：进庙第一眼就能认出哪个是自己
  selfLabel = document.createElement('div');
  selfLabel.className = 'selfname'; selfLabel.style.display = 'none';
  el.labels.appendChild(selfLabel);
  // 点卷轴关闭时，同一次点击可能穿透到下面的 3D 场景，误触发一次交互；
  // 关闭后给输入留 400ms 静默期，对用户几乎无感
  const dismissEntry = () => {
    if (el.entry && el.entry.classList.contains('show')) {
      el.entry.classList.remove('show');
      sceneGuardUntil = performance.now() + 400;
    }
  };
  if (el.entry) el.entry.addEventListener('click', dismissEntry);

  loadSave(); save.lastVisit = localDateStr(); persist(); loadCo(); loadMyName();
  if (myName) {
    el.dharma.textContent = myName; el.dharma.classList.remove('dharma-wait');
    selfLabel.textContent = myName;
  }
  await preloadGLB();   // Blender 建模资产（失败自动回退程序化建模）
  initThree(); buildScene(); initPost(); updateLanterns(); updateHUD();
  setTimeout(buildPropSprites, 500);   // 生成 6 个放大面板的同源 3D 渲染图
  Sound.loadSamples();   // 预载写实木鱼 / 念珠 / 点灯采样，首次手势后即可播放
  // 淡入：先让 3D 画面露出来，再收掉遮罩
  requestAnimationFrame(() => setTimeout(() => { if (el.veil) el.veil.classList.add('gone'); }, 180));
  setTimeout(() => { if (el.veil && el.veil.parentNode) el.veil.parentNode.removeChild(el.veil); }, 2400);

  Net.on('welcome', (m) => {
    for (const id in peers) { const p = peers[id]; if (p.label) p.label.remove(); scene.remove(p.group); delete peers[id]; }
    if (myId === null) { monkObj.position.set(m.x, 0, m.z); target.set(m.x, 0, m.z); }
    myId = m.id;
    if (el.fullGate) el.fullGate.classList.remove('show');
    saveMyName(m.name);
    el.dharma.textContent = m.name; el.dharma.classList.remove('dharma-wait');
    if (selfLabel) { selfLabel.textContent = m.name; selfLabel.style.display = 'block'; }
    // 进庙赐名卷轴：法号大字居中停留几秒，比左上角小字醒目得多
    if (!greeted) {
      greeted = true;
      if (el.entryName) el.entryName.textContent = m.name;
      if (el.entry) el.entry.classList.add('show');
      clearTimeout(entryTimer);
      entryTimer = setTimeout(() => { if (el.entry) el.entry.classList.remove('show'); }, 6500);
    }
    // 今日愿灯由服务端下发；若曾离线点过，本地兜底也补进灯列
    todayLamps = m.lamps || [];
    myLamp = todayLamps.find(l => l.name === m.name) || localLamp();
    if (myLamp && !todayLamps.some(l => l.name === myLamp.name && l.date === myLamp.date)) todayLamps.push(myLamp);
    updateLanterns();
    (m.peers || []).forEach(addPeer);
    // 池底硬币由服务端权威下发：进庙就能看到全院日积月累的钱，重启不丢。
    pondCoinData = (m.coins || []).slice();
    pondCoinTotal = m.coinTotal || pondCoinData.length;
    refreshPondCoins();
  });
  Net.on('coinDropped', (m) => {
    if (!m.coin) return;
    if (m.self) { pondCoinTotal = m.total || pondCoinTotal; return; } // 自己的币由飞行落定后并入，避免重叠
    pondCoinData.push(m.coin);
    if (pondCoinData.length > 500) pondCoinData.shift();
    pondCoinTotal = m.total || pondCoinTotal + 1;
    refreshPondCoins();
    pondSplash(POND.x + m.coin.x, POND.z + m.coin.z, false);
  });
  Net.on('lampOk', (m) => onLampOk(m, false));
  Net.on('lampDeny', onLampDeny);
  Net.on('lampLit', (m) => { addLamp(m.lamp); showToast((m.lamp.name || '一位同修') + ' 点亮了一盏愿灯'); });
  Net.on('peerJoin', (m) => { addPeer(m); showToast((m.name || '一位香客') + ' 入庙了'); });
  Net.on('peerMove', (m) => { if (peers[m.id]) peers[m.id].target.set(m.x, 0, m.z); });
  Net.on('peerAction', (m) => {
    const p = peers[m.id]; if (!p) return;
    if (m.pose === 'bow') p.kneel = true;
    else if (m.pose === 'rise') p.kneel = false;
    else { p.pose = m.pose; p.poseT = 1.2; }
    if (m.pose === 'fish' && Math.random() < 0.25) CatLife.startle();
  });
  Net.on('greetInvite', (m) => { if (!inviteTag) showInvite(m.from, m.name); });
  Net.on('peerGreet', (m) => {
    // 第三人只看到两人相对合十，没有任何文字或系统提示
    if (peers[m.from]) peers[m.from].greetAnim = GREET_DUR;
    if (peers[m.to]) peers[m.to].greetAnim = GREET_DUR;
  });
  Net.on('chatReady', (m) => openChatBar(m.peerId, m.name));
  Net.on('chatMsg', (m) => {
    if (typeof m.idx !== 'number' || !CHAT_LINES[m.idx]) return;
    showChatBubble(m.from, CHAT_LINES[m.idx], m.from === myId);
  });
  Net.on('chatMute', (m) => { showMute(m.from); showMute(m.to); });   // 光遇式：旁观者只见「···」
  Net.on('chatEnd', () => closeChatBar(true));
  Net.on('peerLeave', (m) => {
    const p = peers[m.id];
    if (p) { if (p.label) p.label.remove(); if (p.bubble) p.bubble.remove(); if (p.mute) p.mute.remove(); scene.remove(p.group); delete peers[m.id]; }
    if (chatPeerId === m.id) closeChatBar(true);
  });
  Net.on('presence', (m) => {
    if (m.count < 0) el.presence.textContent = '未连接 · 庙中空着';
    else if (m.count <= 0) el.presence.textContent = '此刻庙中唯有你一人 · 佛前 ' + CUSHION_SEATS + ' 席';
    else el.presence.textContent = '此刻庙中另有 ' + m.count + ' 位同修 · 佛前 ' + CUSHION_SEATS + ' 席';
  });
  Net.on('full', (m) => {
    el.presence.textContent = '庙中已满 · 稍后再来';
    if (el.fullMsg) el.fullMsg.textContent = '此刻已有 ' + (m.limit || CAPACITY) + ' 位同修在殿内，清静无需抢，稍后再来吧';
    if (el.fullGate) el.fullGate.classList.add('show');
  });
  Net.connect();

  const canvas = renderer.domElement;
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('keydown', onKey);
  // 手机键盘弹起时 visualViewport 会变矮：把放大面板底边抬高，别让心愿输入框被键盘盖住
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const syncVV = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.focus.style.bottom = kb > 90 ? kb + 'px' : '';
    };
    vv.addEventListener('resize', syncVV); vv.addEventListener('scroll', syncVV);
  }
  el.mute.addEventListener('click', toggleMute);
  const resetBtn = $('reset'); if (resetBtn) resetBtn.addEventListener('click', resetSave);
  const chatCloseBtn = $('chatClose'); if (chatCloseBtn) chatCloseBtn.addEventListener('click', () => closeChatBar());
  $('focusClose').addEventListener('click', closeFocus);
  // 木鱼 / 念珠：固定在右下角，点一下直接开面板，不用在场景里找
  // 用 pointerdown 而非 click：手机上少一次 300ms 判定，也不会留下点击高亮
  const bindDock = (node, kind) => {
    if (!node) return;
    node.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (!focusMode) { Sound.unlock(); openFocus(kind); }
    });
  };
  bindDock($('dockFish'), 'fish'); bindDock($('dockBeads'), 'beads');

  // 通用聚焦输入：只对木鱼 / 念珠生效，上香与撸猫由各自的子元素处理
  el.focusObj.addEventListener('pointerdown', (e) => {
    if (focusKind !== 'fish' && focusKind !== 'beads') return;
    e.preventDefault(); e.stopPropagation();
    if (focusKind === 'beads') {
      dragY = e.clientY; dragMoved = false; dragSteps = 0;
      try { el.focusObj.setPointerCapture(e.pointerId); } catch (_) {}
    } else focusTap(1);
  });
  el.focusObj.addEventListener('pointermove', (e) => {
    if (focusKind !== 'beads' || dragY === null) return;
    const dy = e.clientY - dragY, now = performance.now();
    if (now - lastBeadMove < 90 || dragSteps >= 10) return;
    if (Math.abs(dy) >= 32) { lastBeadMove = now; dragSteps += 1; focusTap(dy > 0 ? 1 : -1); dragY = e.clientY; dragMoved = true; }
  });
  el.focusObj.addEventListener('pointerup', (e) => {
    if (focusKind !== 'beads' || dragY === null) return;
    if (!dragMoved) { const r = el.focusObj.getBoundingClientRect(); focusTap(e.clientY < r.top + r.height / 2 ? -1 : 1); }
    dragY = null; dragMoved = false;
  });
  el.focusObj.addEventListener('pointercancel', () => { dragY = null; dragMoved = false; });
  window.addEventListener('pointerup', () => { dragY = null; dragMoved = false; });
  window.addEventListener('pointercancel', () => { dragY = null; dragMoved = false; });
  el.focusObj.addEventListener('wheel', (e) => {
    if (focusKind !== 'beads') return;
    e.preventDefault();
    const now = performance.now();
    if (now - lastWheel < 85) return;
    lastWheel = now; focusTap(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (state === 'playing') state = 'paused'; Sound.purrStop(); Sound.chantStop(); persistCo(); }
    else { state = 'playing'; lastTs = 0; if (focusMode && focusKind !== 'pet') Sound.chantStart(); }
  });

  requestAnimationFrame(frame);
  window.__zenReady = true;
}

try { boot(); } catch (err) { console.error(err); window.__zenError = String((err && err.message) || err); }
// 运行期错误也要浮出来：异步加载 / 渲染循环里的异常统一送到启动兜底页显示
window.addEventListener('unhandledrejection', (e) => {
  if (window.__zenReady) { window.__zenReady = false; window.__zenError = String((e.reason && e.reason.message) || e.reason); }
});
window.addEventListener('error', (e) => {
  if (window.__zenReady && e.message) { window.__zenReady = false; window.__zenError = e.message; }
});




