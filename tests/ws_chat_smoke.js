/* 同修社交冒烟：A 向 B 行礼 → B 回礼 → 两人私聊 → 验证 C 收不到任何聊天内容。
 * 用法：node tools/ws_chat_smoke.js [wsUrl]
 */
const WebSocket = require('ws');
const URL = process.argv[2] || 'ws://localhost:8788/';

function mk(name) {
  const ws = new WebSocket(URL);
  const o = { name, ws, id: null, msgs: [] };
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d); } catch (_) { return; }
    o.msgs.push(m);
    if (m.type === 'welcome') o.id = m.id;
  });
  o.ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return o;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (o, t) => o.msgs.some((m) => m.type === t);
const send = (o, obj) => o.ws.send(JSON.stringify(obj));

(async () => {
  const A = mk('A'), B = mk('B'), C = mk('C');
  await Promise.all([A.ready, B.ready, C.ready]);
  await wait(700);
  if (!A.id || !B.id || !C.id) throw new Error('welcome 未下发 id');

  send(A, { type: 'greet', to: B.id });
  await wait(350);
  if (!has(B, 'greetInvite')) throw new Error('B 未收到行礼邀请');
  if (!has(C, 'peerGreet')) throw new Error('C 未看到两人行礼');

  send(B, { type: 'greetAccept', to: A.id });
  await wait(350);
  if (!has(A, 'chatReady') || !has(B, 'chatReady')) throw new Error('双方未进入同坐');
  if (has(C, 'chatReady')) throw new Error('隐私事故：C 收到了 chatReady');

  send(A, { type: 'chat', to: B.id, idx: 0 });
  await wait(350);
  if (!has(A, 'chatMsg') || !has(B, 'chatMsg')) throw new Error('两人未收到气泡');
  if (has(C, 'chatMsg')) throw new Error('隐私事故：C 收到了聊天内容');
  if (!has(C, 'chatMute')) throw new Error('C 未看到省略号');

  // 越界索引必须被拒
  const before = B.msgs.filter((m) => m.type === 'chatMsg').length;
  send(A, { type: 'chat', to: B.id, idx: 99 });
  await wait(250);
  if (B.msgs.filter((m) => m.type === 'chatMsg').length !== before) throw new Error('越界短句未被拦截');

  // 未建立会话的 C 不能直接发消息
  send(C, { type: 'chat', to: A.id, idx: 1 });
  await wait(250);
  if (has(A, 'chatMsg')) {
    const last = A.msgs.filter((m) => m.type === 'chatMsg').pop();
    if (last && last.from === C.id) throw new Error('未回礼者竟然能发消息');
  }

  console.log('CHAT_SMOKE_OK', JSON.stringify({
    A: A.id, B: B.id, C: C.id,
    aMsgs: A.msgs.map((m) => m.type), bMsgs: B.msgs.map((m) => m.type), cMsgs: C.msgs.map((m) => m.type),
    cHasChatMsg: has(C, 'chatMsg')
  }));
  [A, B, C].forEach((o) => o.ws.close());
  process.exit(0);
})().catch((e) => { console.error('CHAT_SMOKE_FAIL', e.message); process.exit(1); });
