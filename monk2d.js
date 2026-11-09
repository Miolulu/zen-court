// monk2d.js — 2.5D 纸片角色系统 v3（AI 生成精灵 + canvas 兜底）
// v3：小沙弥/橘猫改用 AI 生成的水墨纸片立绘（assets/sprites/*.png），
//   加载成功 → 按姿势切换精灵 + 轻量形变（呼吸/俯身）+ canvas 合成道具；
//   加载失败 → 回退到 v2 canvas 手绘（保底不白屏）。
// 对外接口（play/stop/update/setColors/setFacing/mesh/group）与 v1/v2 一致。
import * as THREE from 'three';

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------- 绘制工具 ----------
function limb(ctx, x0, y0, x1, y1, w, col, outline) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + 6;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline; ctx.lineWidth = w + 3;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
}
function blob(ctx, x, y, r, col, outline, lw = 3) {
  ctx.fillStyle = col; ctx.strokeStyle = outline; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); if (lw > 0) ctx.stroke();
}
function softShadow(ctx, x, y, w) {
  ctx.fillStyle = 'rgba(40,46,42,0.24)';
  ctx.beginPath(); ctx.ellipse(x, y, w, w * 0.3, 0, 0, TAU); ctx.fill();
}
function loadImg(src, cb) {
  const img = new Image();
  img.onload = () => cb(img);
  img.onerror = () => cb(null);
  img.src = src;
}

// ============================================================
//  Monk2D — 纸片小沙弥
// ============================================================
export class Monk2D {
  constructor(opts = {}) {
    this.robe = opts.robe || '#7E8C84';
    this.robeShade = opts.robeShade || '#697871';
    this.skin = opts.skin || '#F0D9C0';
    this.outline = opts.outline || '#46504A';
    this.sash = opts.sash || '#B0492F';
    this.skinShade = '#E3C3A2';
    this.sashShade = '#8E3A24';
    this.trim = '#C9B07A';
    this.collar = '#F2EBDC';
    this.shoe = '#3A322A';

    this.W = 256; this.H = 384;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Sprite(mat);
    this.mesh.scale.set(1.06, 1.68, 1);
    this.mesh.position.y = 0.84;
    this.mesh.raycast = () => {};
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.group.raycast = () => {};

    this.action = null; this.t = 0; this.repeat = 1; this.loop = false;
    this.time = 0;
    this.smoke = [];
    this.facing = 1;

    // ---- v3：AI 精灵加载（stand 必备；pray/bow 可选）----
    this.sprites = {}; this.ready = false;
    loadImg('assets/sprites/monk_stand.png', (img) => { if (img) { this.sprites.stand = img; this.ready = true; } });
    loadImg('assets/sprites/monk_pray.png', (img) => { if (img) this.sprites.pray = img; });
    loadImg('assets/sprites/monk_bow.png', (img) => { if (img) this.sprites.bow = img; });
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
    const p = {
      bodyY: 0, tilt: 0, breathe: Math.sin(this.time * 1.7) * 2.5,
      hl: [86, 272], hr: [170, 272],
      headDx: 0, headDrop: 0, headTilt: 0
    };
    const a = this.action, t = this.t;
    if (!a) return p;
    const durs = { pray: 2.4, bow: 2.8, woodfish: 0.62, beads: 1.3, lamp: 1.8, incense: 3.2, pet: 1.1 };
    const d = durs[a] || 1;
    const k = clamp(t / d, 0, 1);
    const e = ease(k);

    if (a === 'pray') {
      const up = Math.sin(k * Math.PI);
      p.hl = [lerp(86, 121, e), lerp(272, 176 - up * 6, e)];
      p.hr = [lerp(170, 135, e), lerp(272, 176 - up * 6, e)];
      p.tilt = 0.03 * up;
    } else if (a === 'bow') {
      const dn = Math.sin(k * Math.PI);
      p.bodyY = -dn * 8;
      p.headDx = dn * 24; p.headDrop = dn * 52; p.headTilt = dn * 0.85;
      p.hl = [lerp(86, 118, e), lerp(272, 312, e)];
      p.hr = [lerp(170, 138, e), lerp(272, 312, e)];
    } else if (a === 'woodfish') {
      const tap = Math.max(0, Math.sin(t / d * TAU));
      p.hr = [184, lerp(262, 226, tap)];
      p.hl = [92, 272];
    } else if (a === 'beads') {
      const spin = Math.sin(t / d * TAU);
      p.hr = [lerp(164, 150 + spin * 8, 1), lerp(272, 224, 1)];
      p.hl = [lerp(92, 106, 1), lerp(272, 224, 1)];
    } else if (a === 'lamp') {
      p.hr = [lerp(170, 196, e), lerp(272, 190, e)];
      p.hl = [92, 272];
    } else if (a === 'incense') {
      const lift = Math.min(1, k * 1.6);
      p.hl = [lerp(86, 118, e), lerp(272, 168, e)];
      p.hr = [lerp(170, 138, e), lerp(272, 168, e)];
      if (k > 0.55) this._emitSmoke();
    } else if (a === 'pet') {
      const rub = Math.sin(t / d * TAU);
      p.bodyY = -6; p.tilt = 0.1;
      p.hr = [lerp(152, 160 + rub * 6, 1), lerp(272, 306, 1)];
      p.hl = [104, 276];
    }
    return p;
  }

  _emitSmoke() {
    if (this.smoke.length < 24 && Math.random() < 0.5) this.smoke.push({ x: 128 + (Math.random() - 0.5) * 6, y: 66, v: 14 + Math.random() * 8, life: 1 });
  }

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
    if (this.ready && this.sprites.stand) this._drawSprite(); else this._drawCanvas();
    this.tex.needsUpdate = true;
  }

  // ---- v3：AI 精灵绘制 ----
  _drawSprite() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    const p = this._pose();
    const cx = 128, groundY = 360;

    ctx.save();
    ctx.translate(0, p.bodyY + p.breathe);
    ctx.translate(cx, groundY); ctx.rotate(p.tilt * this.facing * 0.6); ctx.translate(-cx, -groundY);
    softShadow(ctx, cx, groundY + 4, 54);

    // 选姿势：叩首用 bow 精灵（矮宽），合掌用 pray，其余 stand
    let img = this.sprites.stand, hFrac = 0.92;
    if (this.action === 'bow' && this.sprites.bow) { img = this.sprites.bow; hFrac = 0.74; }
    else if (this.action === 'pray' && this.sprites.pray) { img = this.sprites.pray; hFrac = 0.92; }
    const dh = H * hFrac;
    const dw = dh * (img.width / img.height);
    const drawH = dh * (1 + (this.action ? 0 : Math.sin(this.time * 1.7) * 0.006));
    const drawW = dw * drawH / dh;
    ctx.save();
    if (this.facing < 0) { ctx.translate(cx * 2, 0); ctx.scale(-1, 1); }
    ctx.drawImage(img, cx - drawW / 2, groundY - drawH, drawW, drawH);
    ctx.restore();

    // 道具合成（画在精灵之上，位置按精灵盒比例锚定）
    const px = cx + this.facing * drawW * 0.26, py = groundY - drawH * 0.34;
    if (this.action === 'woodfish') this._woodfishAt(ctx, px, py + 8);
    else if (this.action === 'beads') this._beadsAt(ctx, cx, groundY - drawH * 0.30);
    else if (this.action === 'lamp') this._lanternAt(ctx, px + this.facing * 14, groundY - drawH * 0.52);
    else if (this.action === 'incense') this._incenseAt(ctx, cx, groundY - drawH * 0.52);

    // 上香烟
    if (this.smoke.length) {
      ctx.strokeStyle = 'rgba(214,214,205,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const s of this.smoke) {
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x + 8, s.y - 14, s.x - 4, s.y - 28); ctx.stroke();
      }
    }
    ctx.restore();
    for (const s of this.smoke) { s.y -= s.v * 0.016; s.life -= 0.02; }
    this.smoke = this.smoke.filter(s => s.life > 0 && s.y > 10);
  }

  // ---- v2 canvas 兜底（精灵加载失败时）----
  _drawCanvas() {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.clearRect(0, 0, W, H);
    const p = this._pose();
    const O = this.outline;
    const cx = 128;
    const groundY = 360;
    const sh = this.sash, shD = this.sashShade;

    ctx.save();
    ctx.translate(0, p.bodyY + p.breathe);
    ctx.translate(cx, groundY); ctx.rotate(p.tilt * this.facing); ctx.translate(-cx, -groundY);
    softShadow(ctx, cx, groundY + 4, 56);
    ctx.fillStyle = this.shoe;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.ellipse(cx + s * 16, groundY - 4, 11, 6, 0, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = this.robe; ctx.strokeStyle = O; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 30, 182);
    ctx.quadraticCurveTo(cx - 50, 290, cx - 46, groundY - 6);
    ctx.lineTo(cx + 46, groundY - 6);
    ctx.quadraticCurveTo(cx + 50, 290, cx + 30, 182);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.robeShade;
    ctx.beginPath();
    ctx.moveTo(cx - 46, groundY - 6); ctx.lineTo(cx + 46, groundY - 6);
    ctx.quadraticCurveTo(cx + 48, 326, cx + 30, 314);
    ctx.lineTo(cx - 30, 314); ctx.quadraticCurveTo(cx - 48, 326, cx - 46, groundY - 6);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = this.robeShade; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 14, 236); ctx.quadraticCurveTo(cx - 20, 292, cx - 16, 330); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 18, 240); ctx.quadraticCurveTo(cx + 24, 292, cx + 20, 330); ctx.stroke();
    ctx.fillStyle = sh;
    ctx.beginPath();
    ctx.moveTo(cx + 30, 180);
    ctx.quadraticCurveTo(cx + 42, 224, cx + 24, 268);
    ctx.lineTo(cx - 34, 268);
    ctx.quadraticCurveTo(cx - 6, 236, cx + 6, 184);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = shD;
    ctx.beginPath();
    ctx.moveTo(cx + 30, 180);
    ctx.quadraticCurveTo(cx + 40, 222, cx + 22, 264);
    ctx.lineTo(cx + 4, 264);
    ctx.quadraticCurveTo(cx + 18, 226, cx + 12, 182);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = this.trim; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 30, 180);
    ctx.quadraticCurveTo(cx + 42, 224, cx + 24, 268);
    ctx.stroke();
    ctx.fillStyle = this.skin;
    ctx.beginPath();
    ctx.moveTo(cx - 12, 182); ctx.lineTo(cx, 208); ctx.lineTo(cx + 12, 182);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = this.collar; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx - 12, 182); ctx.lineTo(cx, 206); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 12, 182); ctx.lineTo(cx, 206); ctx.stroke();
    ctx.fillStyle = sh; ctx.strokeStyle = O; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 36, 262); ctx.quadraticCurveTo(cx, 272, cx + 36, 262);
    ctx.lineTo(cx + 32, 280); ctx.quadraticCurveTo(cx, 290, cx - 32, 280); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = shD; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const dx of [-14, -8, -2]) {
      ctx.beginPath(); ctx.moveTo(cx + dx, 282); ctx.quadraticCurveTo(cx + dx - 2, 300, cx + dx - 4, 314); ctx.stroke();
    }
    const shL = [96, 190], shR = [160, 190];
    limb(ctx, shL[0], shL[1], p.hl[0], p.hl[1], 17, this.robe, O);
    limb(ctx, shR[0], shR[1], p.hr[0], p.hr[1], 17, this.robe, O);
    ctx.strokeStyle = this.robeShade; ctx.lineWidth = 5;
    for (const h of [p.hl, p.hr]) {
      ctx.beginPath(); ctx.arc(h[0], h[1] - 12, 8.5, 0, TAU); ctx.stroke();
    }
    if (this.action === 'woodfish') { this._woodfishAt(ctx, 196, 252); blob(ctx, p.hr[0], p.hr[1], 10, this.skin, O); }
    else if (this.action === 'beads') { this._beadsAt(ctx, 128, 226); blob(ctx, p.hr[0], p.hr[1], 9, this.skin, O); blob(ctx, p.hl[0], p.hl[1], 9, this.skin, O); }
    else if (this.action === 'lamp') { this._lanternAt(ctx, 202, 176); blob(ctx, p.hr[0], p.hr[1], 10, this.skin, O); }
    else if (this.action === 'incense') { this._incenseAt(ctx, 128, 172); blob(ctx, p.hr[0], p.hr[1], 9, this.skin, O); blob(ctx, p.hl[0], p.hl[1], 9, this.skin, O); }
    else { blob(ctx, p.hr[0], p.hr[1], 10, this.skin, O); blob(ctx, p.hl[0], p.hl[1], 10, this.skin, O); }
    const hy = 118;
    ctx.save();
    ctx.translate(p.headDx * this.facing, p.headDrop);
    ctx.translate(cx, hy + 44); ctx.rotate(p.headTilt * this.facing); ctx.translate(-cx, -(hy + 44));
    ctx.fillStyle = this.skin; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.fillRect(cx - 11, hy + 26, 22, 18);
    ctx.strokeRect(cx - 11, hy + 26, 22, 18);
    for (const s of [-1, 1]) {
      ctx.fillStyle = this.skin; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx + s * 40, hy + 8, 7, 10, s * 0.15, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = this.skinShade;
      ctx.beginPath(); ctx.ellipse(cx + s * 41, hy + 8, 3, 5, s * 0.15, 0, TAU); ctx.fill();
    }
    blob(ctx, cx, hy, 41, this.skin, O, 2.5);
    ctx.fillStyle = '#3A322C';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + s * 33, hy - 16, 10, 15, s * 0.5, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,252,240,0.5)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, hy + 4, 33, Math.PI * 1.22, Math.PI * 1.62); ctx.stroke();
    ctx.strokeStyle = '#5A4A3A'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 20, hy - 8); ctx.quadraticCurveTo(cx - 11, hy - 13, cx - 3, hy - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 3, hy - 8); ctx.quadraticCurveTo(cx + 11, hy - 13, cx + 20, hy - 8); ctx.stroke();
    const eyesClosed = this.action === 'bow' || this.action === 'pet';
    if (eyesClosed) {
      ctx.strokeStyle = '#3A322C'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx - 19, hy + 4); ctx.quadraticCurveTo(cx - 11, hy + 9, cx - 3, hy + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 3, hy + 4); ctx.quadraticCurveTo(cx + 11, hy + 9, cx + 19, hy + 4); ctx.stroke();
    } else {
      blob(ctx, cx - 11, hy + 4, 4.6, '#3A322C', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx + 11, hy + 4, 4.6, '#3A322C', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx - 9.5, hy + 2.5, 1.6, '#FFFFFF', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx + 12.5, hy + 2.5, 1.6, '#FFFFFF', 'rgba(0,0,0,0)', 0);
    }
    ctx.fillStyle = 'rgba(233,154,146,0.5)';
    ctx.beginPath(); ctx.ellipse(cx - 24, hy + 14, 6, 4, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 24, hy + 14, 6, 4, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#9A5B4E'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(cx, hy + 12, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    ctx.restore();
    if (this.smoke.length) {
      ctx.strokeStyle = 'rgba(214,214,205,0.5)'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const s of this.smoke) {
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(s.x + 8, s.y - 14, s.x - 4, s.y - 28); ctx.stroke();
      }
    }
    ctx.restore();
    for (const s of this.smoke) { s.y -= s.v * 0.016; s.life -= 0.02; }
    this.smoke = this.smoke.filter(s => s.life > 0 && s.y > 10);
  }

  // ---- 道具（坐标由调用方给定，精灵/兜底两路共用）----
  _woodfishAt(ctx, x, y) {
    ctx.fillStyle = '#7A4A2E'; ctx.strokeStyle = this.outline; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(x, y + 16, 20, 7, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#8A5A3B';
    ctx.beginPath(); ctx.ellipse(x, y, 24, 17, -0.2, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#5E3C26';
    ctx.beginPath(); ctx.ellipse(x + 10, y - 4, 7, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5E3C26'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x - 8, y + 2, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  }
  _beadsAt(ctx, x, y) {
    const w = 26, n = 11;
    ctx.strokeStyle = '#C9B07A'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - w, y); ctx.quadraticCurveTo(x, y + 30, x + w, y); ctx.stroke();
    for (let i = 0; i <= n; i++) {
      const tt = i / n;
      blob(ctx, x + (tt * 2 - 1) * w, y + Math.sin(tt * Math.PI) * 30, 4.2, '#C9B07A', this.outline, 1);
    }
    blob(ctx, x, y + 34, 6, '#A8552F', this.outline, 1.5);
    ctx.strokeStyle = '#A8552F'; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x, y + 40); ctx.lineTo(x, y + 52); ctx.stroke();
  }
  _lanternAt(ctx, x, y) {
    const glow = this.action === 'lamp' && this.t > 0.4;
    if (glow) {
      ctx.fillStyle = 'rgba(255,214,140,0.4)';
      ctx.beginPath(); ctx.arc(x, y, 34, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = '#E8C97A'; ctx.strokeStyle = this.outline; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(x, y, 15, 12, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#D89A55';
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(x + s * 6, y + 9);
      ctx.quadraticCurveTo(x + s * 16, y + 16, x + s * 9, y + 21);
      ctx.quadraticCurveTo(x + s * 3, y + 16, x + s * 3, y + 10);
      ctx.closePath(); ctx.fill();
    }
    if (glow) {
      ctx.fillStyle = '#FFC46A';
      ctx.beginPath(); ctx.ellipse(x, y - 12, 5, 9, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#FFF3D0';
      ctx.beginPath(); ctx.ellipse(x, y - 10, 2.5, 5, 0, 0, TAU); ctx.fill();
    }
  }
  _incenseAt(ctx, x, y) {
    ctx.strokeStyle = '#C9A24B'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const dx of [-8, 0, 8]) {
      ctx.beginPath(); ctx.moveTo(x + dx * 0.6, y); ctx.lineTo(x + dx, y - 94); ctx.stroke();
      ctx.fillStyle = '#E0703A';
      ctx.beginPath(); ctx.arc(x + dx, y - 94, 3, 0, TAU); ctx.fill();
    }
  }
}

// ============================================================
//  Cat2D — 纸片橘猫（AI 精灵 + canvas 兜底）
// ============================================================
export class Cat2D {
  constructor(opts = {}) {
    this.fur = opts.fur || '#E0922F';
    this.furShade = opts.furShade || '#C9771F';
    this.outline = opts.outline || '#5A3A20';
    this.belly = '#F6E8D2';
    this.stripe = '#B8651A';
    this.earIn = '#F4B8A0';

    this.W = 220; this.H = 200;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W; this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthWrite: false });
    this.mesh = new THREE.Sprite(mat);
    this.mesh.scale.set(0.78, 0.66, 1);
    this.mesh.position.y = 0.33; this.mesh.raycast = () => {};
    this.group = new THREE.Group(); this.group.add(this.mesh); this.group.raycast = () => {};
    this.action = 'idle'; this.t = 0; this.time = 0; this.facing = 1;

    this.sprites = {}; this.ready = false;
    loadImg('assets/sprites/cat_sit.png', (img) => { if (img) { this.sprites.sit = img; this.ready = true; } });
    loadImg('assets/sprites/cat_sleep.png', (img) => { if (img) this.sprites.sleep = img; });
  }
  play(a) { this.action = a; this.t = 0; }
  update(dt, camera) {
    this.time += dt; this.t += dt;
    if (this.ready && this.sprites.sit) this._drawSprite(); else this._drawCanvas();
    this.tex.needsUpdate = true;
  }
  _drawSprite() {
    const ctx = this.ctx, W = this.W, H = this.H, cx = 110, gy = 194;
    ctx.clearRect(0, 0, W, H);
    const sleeping = this.action === 'sleep';
    const img = (sleeping && this.sprites.sleep) ? this.sprites.sleep : this.sprites.sit;
    const hFrac = (sleeping && this.sprites.sleep) ? 0.82 : 0.9;
    softShadow(ctx, cx, gy + 2, 42);
    const dh = H * hFrac, dw = dh * (img.width / img.height);
    ctx.save();
    ctx.translate(cx, gy);
    if (this.facing < 0) ctx.scale(-1, 1);
    const wiggle = this.action === 'pet' ? Math.sin(this.time * 9) * 0.03 : 0;
    ctx.rotate(wiggle);
    ctx.drawImage(img, -dw / 2, -dh, dw, dh);
    ctx.restore();
    if (this.action === 'pet' || this.action === 'rub') {
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = '15px serif';
      ctx.fillText('💤', cx + 34, gy - dh * 0.92);
      ctx.fillStyle = 'rgba(240,150,120,0.8)'; ctx.font = '13px serif';
      ctx.fillText('♡', cx - 44, gy - dh * 0.7);
    }
  }
  _drawCanvas() {
    const ctx = this.ctx, O = this.outline, F = this.fur, FS = this.furShade;
    const cx = 110, gy = 170;
    ctx.clearRect(0, 0, this.W, this.H);
    const blink = (this.action === 'sleep') || (Math.sin(this.time * 2) > 0.96 && this.action === 'idle');
    const squint = this.action === 'pet' || this.action === 'rub';
    const tailSway = Math.sin(this.time * 2.2) * 10;
    softShadow(ctx, cx, gy + 6, 44);
    const tx = cx - 34, ty = gy - 18;
    const tailPath = () => {
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx - 34, ty - 4 + tailSway * 0.4, tx - 38, ty - 40 + tailSway);
      ctx.quadraticCurveTo(tx - 40, ty - 54 + tailSway, tx - 28, ty - 56 + tailSway);
    };
    ctx.lineCap = 'round';
    ctx.strokeStyle = O; ctx.lineWidth = 15; tailPath(); ctx.stroke();
    ctx.strokeStyle = F; ctx.lineWidth = 11; tailPath(); ctx.stroke();
    ctx.strokeStyle = FS; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.arc(tx - 30, ty - 48 + tailSway, 7, 0, Math.PI); ctx.stroke();
    ctx.fillStyle = F; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cx - 46, gy);
    ctx.quadraticCurveTo(cx - 54, gy - 34, cx - 30, gy - 46);
    ctx.quadraticCurveTo(cx, gy - 60, cx + 30, gy - 46);
    ctx.quadraticCurveTo(cx + 52, gy - 34, cx + 46, gy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = this.belly;
    ctx.beginPath(); ctx.ellipse(cx + 4, gy - 10, 30, 16, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = this.stripe; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const [dx, dy] of [[-26, -46], [-6, -52], [14, -50]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx, gy + dy); ctx.lineTo(cx + dx - 3, gy + dy + 16); ctx.stroke();
    }
    ctx.strokeStyle = O; ctx.lineWidth = 10;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 20, gy - 8); ctx.lineTo(cx + s * 22, gy - 1); ctx.stroke();
    }
    ctx.strokeStyle = F; ctx.lineWidth = 8;
    for (const s of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 20, gy - 8); ctx.lineTo(cx + s * 22, gy - 2); ctx.stroke();
    }
    const hy = gy - 62;
    blob(ctx, cx, hy, 33, F, O, 2.5);
    for (const s of [-1, 1]) {
      ctx.fillStyle = F; ctx.strokeStyle = O; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + s * 10, hy - 24);
      ctx.quadraticCurveTo(cx + s * 20, hy - 46, cx + s * 30, hy - 30);
      ctx.quadraticCurveTo(cx + s * 30, hy - 22, cx + s * 26, hy - 18);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = this.earIn;
      ctx.beginPath();
      ctx.moveTo(cx + s * 16, hy - 27);
      ctx.quadraticCurveTo(cx + s * 21, hy - 38, cx + s * 25, hy - 27);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = this.stripe; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const dx of [-7, 0, 7]) {
      ctx.beginPath(); ctx.moveTo(cx + dx, hy - 30); ctx.lineTo(cx + dx, hy - 20); ctx.stroke();
    }
    ctx.fillStyle = this.belly;
    ctx.beginPath(); ctx.ellipse(cx, hy + 12, 18, 13, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#2E2018';
    if (squint) {
      ctx.strokeStyle = '#2E2018'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx - 16, hy - 4); ctx.quadraticCurveTo(cx - 10, hy - 9, cx - 4, hy - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 4, hy - 4); ctx.quadraticCurveTo(cx + 10, hy - 9, cx + 16, hy - 4); ctx.stroke();
    } else if (!blink) {
      blob(ctx, cx - 11, hy - 4, 4.5, '#2E2018', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx + 11, hy - 4, 4.5, '#2E2018', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx - 9.5, hy - 5.5, 1.5, '#FFFFFF', 'rgba(0,0,0,0)', 0);
      blob(ctx, cx + 12.5, hy - 5.5, 1.5, '#FFFFFF', 'rgba(0,0,0,0)', 0);
    } else {
      ctx.strokeStyle = '#2E2018'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 15, hy - 4); ctx.lineTo(cx - 7, hy - 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + 7, hy - 4); ctx.lineTo(cx + 15, hy - 4); ctx.stroke();
    }
    ctx.fillStyle = '#D97F7F';
    ctx.beginPath(); ctx.moveTo(cx, hy + 6); ctx.lineTo(cx - 3.5, hy + 3); ctx.lineTo(cx + 3.5, hy + 3); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8A5A40'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(cx, hy + 6); ctx.lineTo(cx, hy + 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hy + 10); ctx.quadraticCurveTo(cx - 5, hy + 15, cx - 9, hy + 11); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, hy + 10); ctx.quadraticCurveTo(cx + 5, hy + 15, cx + 9, hy + 11); ctx.stroke();
    ctx.strokeStyle = 'rgba(90,58,32,0.55)'; ctx.lineWidth = 1.2;
    for (const s of [-1, 1]) for (const dy of [-2, 3, 8]) {
      ctx.beginPath(); ctx.moveTo(cx + s * 6, hy + 8); ctx.lineTo(cx + s * 32, hy + 6 + dy); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,150,120,0.35)';
    ctx.beginPath(); ctx.ellipse(cx - 22, hy + 8, 5, 3.5, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 22, hy + 8, 5, 3.5, 0, 0, TAU); ctx.fill();
    if (this.action === 'wash') {
      ctx.strokeStyle = F; ctx.lineWidth = 9; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx + 20, hy + 2); ctx.quadraticCurveTo(cx + 32, hy - 12, cx + 18, hy - 20); ctx.stroke();
    }
    if (this.action === 'pet' || this.action === 'rub') {
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.font = '14px serif';
      ctx.fillText('💤', cx + 26, hy - 28);
    }
    if (this.action === 'sleep') {
      ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.font = '16px serif';
      ctx.fillText('z', cx + 26, hy - 22); ctx.fillText('Z', cx + 36, hy - 34);
    }
  }
}
