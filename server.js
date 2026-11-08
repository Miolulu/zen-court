/* 小沙弥静修 · 真实多人后端（同庙在场 + 3D 走动 + 动作 + 随机法号 + 每日愿灯）
 * 同时托管静态页面（index.html / game.js / vendor / sfx），一条命令跑通真实在线：
 *
 *   npm i ws three        （three 仅用于本地化 vendor，运行时靠浏览器加载）
 *   node server.js
 *   浏览器打开 http://localhost:8787 即可（需起服务，因前端用 ES module + importmap）。
 *
 * 多开几个浏览器标签 / 发给朋友同链接，就能看到彼此的蓝衣小沙弥在殿前走动、跪拜、上香，各有随机法号。
 * 无人时庙里便空着——清静正好。
 *
 * 协议（3D 坐标 x 左右、z 前后）：
 *   客户端 -> 服务端： {type:'hello',name?} | {type:'move',x,z} | {type:'action',pose}
 *                    | {type:'lightLamp',wish}   （每人每日一盏，服务端权威校验）
 *   服务端 -> 客户端： {type:'welcome',id,x,z,name,capacity,peers[],lamps[]}
 *                    {type:'peerJoin',id,x,z,name} | {type:'peerMove',id,x,z}
 *                    {type:'peerAction',id,pose} | {type:'peerLeave',id}
 *                    {type:'lampOk',lamp} | {type:'lampDeny',reason,lamp?}
 *                    {type:'lampLit',lamp} | {type:'presence',count,total,capacity}
 *                    {type:'full',limit}（满 50 席，随后以 1008 关闭）
 *
 * 单庙上限 50 人（MAX_PLAYERS），与前端 10 列 × 5 排 = 50 张拜垫一一对应。
 *
 * hello 用于「进庙即赐法号」的沿用：客户端把 sessionStorage 里的法号发来，
 * 合法且未被占用就沿用，否则服务端重新随机分配一个两字法号。
 *
 * 愿灯按「法号 + 服务端日期」限每日一盏；前端另有 localStorage 兜底，
 * 断线时也不会误以为能点第二盏。未接账号体系，正式上线应换为账号维度。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const PORT = process.env.PORT || 8787;   // 托管平台会注入 PORT；本地默认 8787
const ROOT = __dirname;
const MAX_PLAYERS = 50;   // 单庙在线上限；与前端 10 列 × 5 排 = 50 张拜垫一一对应
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.glb': 'model/gltf-binary'
};

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/' || p === '') p = '/index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache'
  });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocket.Server({ server: server, path: '/' });

let nextId = 1;
const peers = new Map(); // id -> {x, z, pose, name}
const BX = 10, BZ = 8;    // 庭院活动边界（与前端一致）
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 两字法号字库：进庙随机赐名，庙内不重名；字都偏安静，避免俗艳与宗教尊号
const NAME_A = ['清', '明', '云', '竹', '一', '无', '观', '照', '寂', '了', '心', '月', '石', '泉', '松', '雪', '闻', '觉', '澄', '闲', '素', '知', '空', '静', '和', '尘', '溪', '岚', '朴', '玄', '半', '随'];
const NAME_B = ['念', '照', '心', '然', '和', '非', '一', '相', '栖', '影', '泉', '晴', '尘', '雪', '花', '山', '舟', '灯', '远', '初', '白', '言', '行', '月', '云', '水', '禅', '真', '默', '明', '闲', '知'];
const usedNames = new Set();
function randomName() {
  for (let i = 0; i < 200; i++) {
    const a = NAME_A[(Math.random() * NAME_A.length) | 0];
    const b = NAME_B[(Math.random() * NAME_B.length) | 0];
    const n = a + b;
    if (a !== b && !usedNames.has(n)) { usedNames.add(n); return n; }
  }
  // 穷举兜底：仍保证两字、不重名
  for (const a of NAME_A) for (const b of NAME_B) {
    if (a !== b && !usedNames.has(a + b)) { usedNames.add(a + b); return a + b; }
  }
  return '清念';
}
function claimName(n) {
  if (typeof n !== 'string' || n.length !== 2 || n[0] === n[1]) return null;
  if (!NAME_A.includes(n[0]) || !NAME_B.includes(n[1])) return null;
  for (const v of peers.values()) if (v.name === n) return null;
  usedNames.add(n); return n;
}

// ---- 每日愿灯：法号 + 日期，服务端权威 ----
const lamps = new Map(); // name -> {name, wish, date, litAt}
function dateStr() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function todayLamps() {
  const today = dateStr();
  for (const [k, v] of lamps) if (v.date !== today) lamps.delete(k); // 跨天自动清灯
  return [...lamps.values()].sort((a, b) => a.litAt - b.litAt);
}
function cleanWish(s) {
  if (typeof s !== 'string') return '';
  // 去掉控制字符与前后空白，最多 24 字（含 emoji 按码点计）
  return [...s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()].slice(0, 24).join('');
}

function broadcast(obj, exceptId) {
  const s = JSON.stringify(obj);
  wss.clients.forEach((c) => { if (c._pid !== exceptId && c.readyState === 1) c.send(s); });
}
function presence() { return { type: 'presence', count: Math.max(0, peers.size - 1), total: peers.size, capacity: MAX_PLAYERS }; }
function snapshot(exceptId) {
  const arr = [];
  peers.forEach((v, k) => { if (k !== exceptId) arr.push({ id: k, x: v.x, z: v.z, name: v.name, pose: v.pose }); });
  return arr;
}

wss.on('connection', (ws) => {
  // 满 50 席：不赐法号、不进快照、不广播入庙，只温和地请稍后再来
  if (peers.size >= MAX_PLAYERS) {
    try { ws.send(JSON.stringify({ type: 'full', limit: MAX_PLAYERS })); } catch (_) {}
    setTimeout(() => { try { ws.close(1008, 'temple full'); } catch (_) {} }, 120);
    return;
  }
  const id = nextId++;
  ws._pid = id;
  // 从庭院中轴入院（拜垫阵列的中央过道，避开居中荷池），再自行找拜垫
  const x = clamp((Math.random() * 2 - 1) * 1.0, -BX, BX);
  const z = clamp(2.0 + Math.random() * 1.0, -BZ, BZ);
  let joined = false;

  // 等客户端 hello（沿用旧法号）；400ms 没来就按全新访客处理，兼容不发 hello 的简易客户端
  const joinTimer = setTimeout(() => join(null), 400);
  function join(requested) {
    if (joined) return; joined = true; clearTimeout(joinTimer);
    // 并发入庙时再校验一次，绝不越过 50 席
    if (peers.size >= MAX_PLAYERS) {
      try { ws.send(JSON.stringify({ type: 'full', limit: MAX_PLAYERS })); } catch (_) {}
      setTimeout(() => { try { ws.close(1008, 'temple full'); } catch (_) {} }, 120);
      return;
    }
    const name = (requested && claimName(requested)) || randomName();
    peers.set(id, { x, z, pose: 'idle', name });

    ws.send(JSON.stringify({ type: 'welcome', id, x, z, name, capacity: MAX_PLAYERS, peers: snapshot(id), lamps: todayLamps() }));
    broadcast({ type: 'peerJoin', id, x, z, name }, id);
    broadcast(presence());
    ws.send(JSON.stringify(presence()));
  }

  ws.on('message', (m) => {
    let d; try { d = JSON.parse(m); } catch (e) { return; }
    if (d.type === 'hello') { join(d.name); return; }
    if (!joined) join(null);
    const p = peers.get(id);
    if (!p) return;
    if (d.type === 'move') {
      p.x = clamp(d.x, -BX, BX);
      p.z = clamp(d.z, -BZ, BZ);
      broadcast({ type: 'peerMove', id, x: p.x, z: p.z }, id);
    } else if (d.type === 'action') {
      p.pose = d.pose || 'idle';
      broadcast({ type: 'peerAction', id, pose: p.pose }, id);
    } else if (d.type === 'lightLamp') {
      const wish = cleanWish(d.wish);
      if (!wish) { ws.send(JSON.stringify({ type: 'lampDeny', reason: 'empty' })); return; }
      const old = lamps.get(p.name);
      if (old && old.date === dateStr()) {
        ws.send(JSON.stringify({ type: 'lampDeny', reason: 'today', lamp: old }));
        return;
      }
      const lamp = { name: p.name, wish, date: dateStr(), litAt: Date.now() };
      lamps.set(p.name, lamp);
      ws.send(JSON.stringify({ type: 'lampOk', lamp }));
      broadcast({ type: 'lampLit', lamp }, id);
    }
  });

  ws.on('close', () => {
    clearTimeout(joinTimer);
    const p = peers.get(id);
    if (!p) return;                       // 满员被拒的连接没有入庙，不广播离庙
    usedNames.delete(p.name); peers.delete(id);
    broadcast({ type: 'peerLeave', id });
    broadcast(presence());
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[zen-court] 真实多人服务已启动');
  console.log('   浏览器打开： http://localhost:' + PORT);
});
