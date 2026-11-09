// monk2d.js — 2.5D 纸片角色系统（小沙弥 + 橘猫）
// 用 Canvas 纸娃娃绘制，渲染为面向相机的 billboard 贴图，取代几何体堆砌。
// 参考：韩国山寺 Sansatemple 的圆润小沙弥 + 中国风平涂。
import * as THREE from 'three';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------- 绘制工具 ----------
function limb(ctx, x0, y0, x1, y1, w, col, outline) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + 7;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline; ctx.lineWidth = w + 4;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
}
function blob(ctx, x, y, r, col, outline, lw = 3) {
  ctx.fillStyle = col; ctx.strokeStyle = outline; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.stroke();
}
function softShadow(ctx, x, y, w) {
  ctx.fillStyle = 'rgba(40,46,42,0.18)';
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.32, 0, 0, TAU); ctx.fill();
}

// ============================================================
//  Monk2D — 纸片小沙弥
// ============================================================
export class Monk2D {
  constructor(opts = {}) {
    this.robe = opts.robe || '#7E8C84';
    this.robeShade = opts.robeShade || '#697871';
    this.skin = opts.skin || '#F0D9C0';
    this.outline = opts.outline || '#3A403C';
    this.sash = opts.sash || '#B0492F';

    this.W = 256; this.H = 384;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    // 用 Sprite 替代手动旋转的 PlaneGeometry：永远朝向相机、永不会被面剔除，
    // 从任意视角都能稳定看到纸片小沙弥及其动作。
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Sprite(mat);
    this.mesh.scale.set(1.2, 1.8, 1);
    this.mesh.position.y = 0.9;
    this.mesh.raycast = () => {};
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.raycast = () => {};

    this.action = null; this.t = 0; this.repeat = 1; this.loop = false;
    this.time = 0;
    this.smoke = []; // 上香烟
    this.facing = 1;
  }

  setColors(c) { Object.assign(this, c); }
  setFacing(f) { this.facing = f >= 0 ? 1 : -1; }

  play(name, { repeat = 1, loop = false } = {}) {
    this.action = name; this.t = 0; this.repeat = repeat; this.loop = loop;
    if (name === 'incense') this.smoke = [];
  }
  stop() { this.action = null; this.t = 0; this.smoke = []; }

  // ---- 动作姿态求解 ----
  _pose() {
    const p = { bodyY: 0, tilt: 0, hl: [86, 250], hr: [170, 250], breathe: Math.sin(this.time * 1.7) * 3 };
    const a = this.action, t = this.t;
    if (!a) return p;
    const durs = { pray: 2.4, bow: 2.8, woodfish: 0.62, beads: 1.3, lamp: 1.8, incense: 3.2, pet: 1.1 };
    const d = durs[a] || 1;
    const k = clamp(t / d, 0, 1);
    const e = ease(k);

    if (a === 'pray') {
      const up = Math.sin(k * Math.PI); // 合掌升起再落下
      p.hl = [lerp(86, 122, e), lerp(250, 150 - up * 6, e)];
      p.hr = [lerp(170, 134, e), lerp(250, 150 - up * 6, e)];
      p.tilt = 0.04 * up;
    } else if (a === 'bow') {
      const dn = Math.sin(k * Math.PI); // 俯身再起
      p.bodyY = -dn * 34; p.tilt = dn * 0.34;
      p.hl = [lerp(86, 108, e), lerp(250, 300, e)];
      p.hr = [lerp(170, 148, e), lerp(250, 300, e)];
    } else if (a === 'woodfish') {
      const tap = Math.max(0, Math.sin(t / d * TAU)); // 上下敲击
      p.hr = [185, lerp(236, 208, tap)];
      p.hl = [92, 248];
    } else if (a === 'beads') {
      const spin = Math.sin(t / d * TAU);
      p.hr = [lerp(160, 150 + spin * 8, 1), lerp(250, 206, 1)];
      p.hl = [96, 214];
    } else if (a === 'lamp') {
      p.hr = [lerp(170, 196, e), lerp(250, 168, e)];
      p.hl = [92, 248];
    } else if (a === 'incense') {
      const lift = Math.min(1, k * 1.6);
      p.hl = [lerp(86, 124, e), lerp(250, 150, e)];
      p.hr = [lerp(170, 132, e), lerp(250, 150, e)];
      if (k > 0.55) this._emitSmoke();
    } else if (a === 'pet') {
      const rub = Math.sin(t / d * TAU);
      p.bodyY = -8; p.tilt = 0.12;
      p.hr = [lerp(150, 158 + rub * 6, 1), lerp(250, 300, 1)];
      p.hl = [108, 252];
    }
    return p;
  }

  _emitSmoke() {
    if (this.smoke.length < 24 && Math.random() < 0.5) this.smoke.push({ x: 128 + (Math.random() - 0.5) * 6, y: 76, v: 14 + Math.random() * 8, life: 1 });
  }

  // ---- 主绘制 ----
  update(dt, camera) {
    this.time += dt;
    if (this.action) {
      this.t += dt;
      const durs = { pray: 2.4, bow: 2.8, woodfish: 0.62, beads: 1.3, lamp: 1.8, incense: 3.2, pet: 1.1 };
      const d = durs[this.action] || 1;
      if (this.t >= d) {
        if (this.loop) {
          this.repeat -= 1;
          if (this.repeat > 0) this.t = 0; else this.action = null;
        } else if (this.repeat > 1) { this.repeat -= 1; this.t = 0; }
        else this.action = null;
      }
    }
    // Sprite 已自动朝向相机，无需手动旋转
    this._draw();
    this.tex.needsUpdate = true;
  }

  _draw() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    const p = this._pose();
    const O = this.outline;
    const cx = 128;
    const groundY = 360;

    ctx.save();
    ctx.translate(0, p.bodyY + p.breathe);
    // tilt around feet
    ctx.translate(cx, groundY); ctx.rotate(p.tilt * this.facing); ctx.translate(-cx, -groundY);

    softShadow(ctx, cx, groundY + 4, 52);

    const sh = this.sash;
    // --- 僧袍（钟形）---
    ctx.fillStyle = this.robe; ctx.strokeStyle = O; ctx.lineWidth = 3; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 30, 168);
    ctx.quadraticCurveTo(cx - 56, 300, cx - 46, groundY);
    ctx.lineTo(cx + 46, groundY);
    ctx.quadraticCurveTo(cx + 56, 300, cx + 30, 168);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 下摆暗部
    ctx.fillStyle = this.robeShade;
    ctx.beginPath();
    ctx.moveTo(cx - 46, groundY); ctx.lineTo(cx + 46, groundY);
    ctx.quadraticCurveTo(cx + 50, 330, cx + 30, 320);
    ctx.lineTo(cx - 30, 320); ctx.quadraticCurveTo(cx - 50, 330, cx - 46, groundY);
    ctx.closePath(); ctx.fill();
    // 腰带
    ctx.fillStyle = sh; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - 44, 252); ctx.quadraticCurveTo(cx, 262, cx + 44, 252);
    ctx.lineTo(cx + 40, 270); ctx.quadraticCurveTo(cx, 280, cx - 40, 270); ctx.closePath(); ctx.fill(); ctx.stroke();

    // --- 手臂（后臂先画，避免遮挡脸）---
    const shL = [96, 174], shR = [160, 174];
    limb(ctx, shL[0], shL[1], p.hl[0], p.hl[1], 15, this.robe, O);
    limb(ctx, shR[0], shR[1], p.hr[0], p.hr[1], 15, this.robe, O);

    // --- 道具 ---
    if (this.action === 'woodfish') { this._woodfish(ctx, O); blob(ctx, p.hr[0], p.hr[1], 9, this.skin, O); }
    else if (this.action === 'beads') { this._beads(ctx, O); blob(ctx, p.hr[0], p.hr[1], 8, this.skin, O); }
    else if (this.action === 'lamp') { this._lantern(ctx, O, p); blob(ctx, p.hr[0], p.hr[1], 9, this.skin, O); }
    else if (this.action === 'incense') { this._incense(ctx, O, p); blob(ctx, p.hr[0], p.hr[1], 8, this.skin, O); blob(ctx, p.hl[0], p.hl[1], 8, this.skin, O); }
    else { blob(ctx, p.hr[0], p.hr[1], 9, this.skin, O); blob(ctx, p.hl[0], p.hl[1], 9, this.skin, O); }

    // --- 头 ---
    const hy = 118 + (this.action === 'bow' ? 18 : 0);
    // 脖颈
    ctx.fillStyle = this.skin; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(cx - 12, 150); ctx.lineTo(cx + 12, 150); ctx.lineTo(cx + 10, 168); ctx.lineTo(cx - 10, 168); ctx.closePath(); ctx.fill(); ctx.stroke();
    blob(ctx, cx, hy, 33, this.skin, O, 3);
    // 僧帽
    ctx.fillStyle = this.robe; ctx.strokeStyle = O; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, hy - 6, 33, Math.PI * 1.08, Math.PI * 1.92); ctx.lineTo(cx + 24, hy - 10); ctx.quadraticCurveTo(cx, hy - 26, cx - 24, hy - 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    // 脸
    const look = this.facing;
    ctx.fillStyle = '#2E3532';
    blob(ctx, cx - 11 * look, hy + 2, 3.2, '#2E3532', 'rgba(0,0,0,0)'); // 简化处理：点眼
    ctx.beginPath(); ctx.arc(cx - 11 * look, hy + 2, 3.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + 11 * look, hy + 2, 3.2, 0, TAU); ctx.fill();
    // 微笑
    ctx.strokeStyle = '#9A5B4E'; ctx.lineWidth = 2; ctx.beginPath();
    ctx.arc(cx, hy + 10, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

    // 上香烟
    if (this.smoke.length) {
      ctx.strokeStyle = 'rgba(214,214,205,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const s of this.smoke) {
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x + 8, s.y - 14, s.x - 4, s.y - 28); ctx.stroke();
      }
    }
    ctx.restore();

    // 烟位置推进（屏幕空间，不随 tilt）
    for (const s of this.smoke) { s.y -= s.v * 0.016; s.life -= 0.02; }
    this.smoke = this.smoke.filter(s => s.life > 0 && s.y > 10);
  }

  _woodfish(ctx, O) {
    const x = 188, y = 214;
    ctx.fillStyle = '#8A5A3B'; ctx.strokeStyle = O; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(x, y, 22, 15, -0.3, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5E3C26'; ctx.beginPath(); ctx.ellipse(x + 14, y - 4, 6, 4, 0, 0, TAU); ctx.fill();
  }
  _beads(ctx, O) {
    ctx.strokeStyle = '#C9B07A'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(96, 214, 16, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#C9B07A';
    for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; blob(ctx, 96 + Math.cos(a) * 16, 214 + Math.sin(a) * 16, 2.4, '#C9B07A', O, 1); }
  }
  _lantern(ctx, O, p) {
    const x = 198, y = 162; const glow = p.action === 'lamp' && p.t > 0.4;
    if (glow) { ctx.fillStyle = 'rgba(255,214,140,0.35)'; ctx.beginPath(); ctx.arc(x, y, 30, 0, TAU); ctx.fill(); }
    ctx.fillStyle = '#E8C97A'; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(x, y, 14, 18, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#9A5B4E'; ctx.beginPath(); ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 24); ctx.stroke();
  }
  _incense(ctx, O, p) {
    // 香炉（脚下）
    ctx.fillStyle = '#9AA39B'; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(128, 332, 18, 8, 0, 0, TAU); ctx.fill(); ctx.stroke();
    // 香支（双手持）
    ctx.strokeStyle = '#C9A24B'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(128, 150); ctx.lineTo(128, 84); ctx.stroke();
    ctx.fillStyle = '#E0703A'; ctx.beginPath(); ctx.arc(128, 84, 3, 0, TAU); ctx.fill();
  }
}

// ============================================================
//  Cat2D — 纸片橘猫
// ============================================================
export class Cat2D {
  constructor(opts = {}) {
    this.fur = opts.fur || '#E0922F';
    this.furShade = opts.furShade || '#C9771F';
    this.outline = opts.outline || '#3A2A1E';
    this.W = 220; this.H = 200;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    // Sprite：永远朝向相机、永不被剔除
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Sprite(mat);
    this.mesh.scale.set(1.0, 0.9, 1);
    this.mesh.position.y = 0.45; this.mesh.raycast = () => {};
    this.group = new THREE.Group(); this.group.add(this.mesh); this.group.raycast = () => {};
    this.action = 'idle'; this.t = 0; this.time = 0; this.facing = 1;
  }
  play(a) { this.action = a; this.t = 0; }
  update(dt, camera) {
    this.time += dt; this.t += dt;
    // Sprite 已自动朝向相机
    this._draw(); this.tex.needsUpdate = true;
  }
  _draw() {
    const ctx = this.ctx, O = this.outline, F = this.fur, FS = this.furShade, cx = 110, gy = 168;
    ctx.clearRect(0, 0, this.W, this.H);
    const blink = (this.action === 'sleep') || (Math.sin(this.time * 2) > 0.96 && this.action === 'idle');
    const squint = this.action === 'pet' || this.action === 'rub';
    softShadow(ctx, cx, gy + 6, 40);
    // 尾
    ctx.strokeStyle = F; ctx.lineWidth = 12; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 30, gy - 6); ctx.quadraticCurveTo(cx - 70, gy - 10, cx - 64, gy - 50); ctx.stroke();
    ctx.strokeStyle = O; ctx.lineWidth = 14; ctx.beginPath(); ctx.moveTo(cx - 30, gy - 6); ctx.quadraticCurveTo(cx - 70, gy - 10, cx - 64, gy - 50); ctx.stroke();
    ctx.strokeStyle = F; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(cx - 30, gy - 6); ctx.quadraticCurveTo(cx - 70, gy - 10, cx - 64, gy - 50); ctx.stroke();
    // 身体
    ctx.fillStyle = F; ctx.strokeStyle = O; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(cx, gy - 18, 46, 30, 0, 0, TAU); ctx.fill(); ctx.stroke();
    // 斑纹
    ctx.strokeStyle = FS; ctx.lineWidth = 5;
    for (const dx of [-30, -10, 12]) { ctx.beginPath(); ctx.moveTo(cx + dx, gy - 44); ctx.lineTo(cx + dx - 4, gy - 22); ctx.stroke(); }
    // 头
    blob(ctx, cx, gy - 56, 30, F, O, 3);
    // 耳
    ctx.fillStyle = F; ctx.strokeStyle = O; ctx.lineWidth = 3;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 14, gy - 78); ctx.lineTo(cx + s * 26, gy - 96); ctx.lineTo(cx + s * 30, gy - 74); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#F4C9A0'; ctx.beginPath(); ctx.moveTo(cx + s * 18, gy - 80); ctx.lineTo(cx + s * 24, gy - 90); ctx.lineTo(cx + s * 27, gy - 78); ctx.closePath(); ctx.fill();
    }
    // 脸
    ctx.fillStyle = '#2E2018';
    if (squint) { ctx.strokeStyle = '#2E2018'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(cx - 14, gy - 54); ctx.lineTo(cx - 6, gy - 54); ctx.moveTo(cx + 6, gy - 54); ctx.lineTo(cx + 14, gy - 54); ctx.stroke(); }
    else if (!blink) { blob(ctx, cx - 11, gy - 56, 4, '#2E2018', 'rgba(0,0,0,0)', 0); blob(ctx, cx + 11, gy - 56, 4, '#2E2018', 'rgba(0,0,0,0)', 0); }
    else { ctx.strokeStyle = '#2E2018'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - 14, gy - 56); ctx.lineTo(cx - 8, gy - 56); ctx.moveTo(cx + 8, gy - 56); ctx.lineTo(cx + 14, gy - 56); ctx.stroke(); }
    // 鼻
    ctx.fillStyle = '#D98A8A'; ctx.beginPath(); ctx.moveTo(cx, gy - 48); ctx.lineTo(cx - 3, gy - 50); ctx.lineTo(cx + 3, gy - 50); ctx.closePath(); ctx.fill();
    // 胡须
    ctx.strokeStyle = 'rgba(60,42,30,0.6)'; ctx.lineWidth = 1.2;
    for (const s of [-1, 1]) for (const dy of [-2, 2, 6]) { ctx.beginPath(); ctx.moveTo(cx + s * 4, gy - 48); ctx.lineTo(cx + s * 30, gy - 50 + dy); ctx.stroke(); }
    // 洗脸/呼噜
    if (this.action === 'wash') { ctx.strokeStyle = F; ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(cx + 18, gy - 58); ctx.quadraticCurveTo(cx + 30, gy - 70, cx + 16, gy - 78); ctx.stroke(); }
    if (this.action === 'pet' || this.action === 'rub') { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '14px serif'; ctx.fillText('💤', cx + 24, gy - 86); }
    if (this.action === 'sleep') { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '16px serif'; ctx.fillText('z', cx + 26, gy - 80); ctx.fillText('Z', cx + 36, gy - 92); }
  }
}
