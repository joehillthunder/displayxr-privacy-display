// The demo apps. Each one is a window on the glass (z = 0) with a public layer (one canvas texture)
// and private fields (PrivateField) laid on top. The privacy condition that covers an app comes
// from Samsung's "Conditions for turning on": 'pin' (PIN, pattern, password), 'apps' (chosen apps)
// and 'notifications' (notification pop-ups, partial-screen privacy).
//
// Window space: units, origin at the window's top-left, +y DOWN (like the canvases); place() maps
// it to stage space (+y up, window centred on the origin).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PrivateField, unitCanvas, drawText, rr, makeTex } from './fields.js';

export const WIN_W = 1.56, WIN_H = 0.86;

function place(obj, x, y, z = 0) { obj.position.set(-WIN_W / 2 + x, WIN_H / 2 - y, z); return obj; }

function windowBase(title, accent, body) {
  const tex = makeTex(unitCanvas(WIN_W, WIN_H, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, WIN_H);
    g.addColorStop(0, '#171b25'); g.addColorStop(1, '#0d1017');
    rr(ctx, 0, 0, WIN_W, WIN_H, 0.04); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 0.002; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.stroke();
    ctx.save(); rr(ctx, 0, 0, WIN_W, WIN_H, 0.04); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.fillRect(0, 0, WIN_W, 0.1);
    ctx.restore();
    ctx.fillStyle = accent; rr(ctx, 0.04, 0.03, 0.045, 0.045, 0.012); ctx.fill();
    drawText(ctx, title, 0.105, 0.068, 0.036, { weight: 650 });
    body(ctx);
  }));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WIN_W, WIN_H), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
  mesh.renderOrder = 1;
  return mesh;
}

function field(app, o, x, y, z = 0) {
  const f = new PrivateField(o);
  place(f.object, x, y, z);
  app.group.add(f.object); app.fields.push(f);
  return f;
}

function newApp(id, name, condition) {
  return { id, name, condition, group: new THREE.Group(), fields: [], targets: [], update() {}, click() {}, enter() {} };
}

// ---- Lock screen: PIN entry --------------------------------------------------------------------------
export function lockApp(ctx) {
  const app = newApp('lock', 'Lock screen', 'pin');
  app.group.add(windowBase('Lock screen', '#6fe0a4', (c) => {
    drawText(c, '9:41', 0.1, 0.33, 0.17, { weight: 300 });
    drawText(c, 'Wednesday, October 14', 0.1, 0.4, 0.034, { color: '#aab3c6' });
    drawText(c, 'Enter PIN', 0.1, 0.53, 0.04, { weight: 600 });
    drawText(c, 'Demo PIN 2580. The keypad shuffles and its digits are private:', 0.1, 0.74, 0.022, { color: '#7d869a' });
    drawText(c, 'a shoulder-surfer sees where you click, not what you press.', 0.1, 0.772, 0.022, { color: '#7d869a' });
  }));

  // PIN dots (public: how many digits, never which).
  const dotsCanvas = unitCanvas(0.36, 0.06, () => {});
  const dotsTex = makeTex(dotsCanvas);
  const dots = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.06), new THREE.MeshBasicMaterial({ map: dotsTex, transparent: true, toneMapped: false }));
  place(dots, 0.1 + 0.18, 0.6, 0.002); dots.renderOrder = 3; app.group.add(dots);
  let entered = '', message = '', messageT = 0, unlocked = false;
  function drawDots() {
    const c = dotsCanvas.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, dotsCanvas.width, dotsCanvas.height);
    c.scale(dotsCanvas.width / 0.36, dotsCanvas.height / 0.06);
    if (message) { drawText(c, message, 0, 0.042, 0.032, { weight: 600, color: unlocked ? '#6fe0a4' : '#ff8a8a' }); }
    else for (let i = 0; i < 4; i++) {
      c.beginPath(); c.arc(0.02 + i * 0.06, 0.03, 0.016, 0, Math.PI * 2);
      if (i < entered.length) { c.fillStyle = '#eef1f7'; c.fill(); } else { c.lineWidth = 0.003; c.strokeStyle = '#8f97aa'; c.stroke(); }
    }
    dotsTex.needsUpdate = true;
  }
  drawDots();

  // Keypad: 3D keys; each key's digit is a private field.
  const KW = 0.15, KH = 0.13, GAP = 0.024, X0 = 0.86, Y0 = 0.14;
  const keyGeo = new RoundedBoxGeometry(KW, KH, 0.03, 3, 0.02);
  const keyMat = new THREE.MeshStandardMaterial({ color: 0x232938, roughness: 0.45, metalness: 0.2 });
  const keyHover = new THREE.MeshStandardMaterial({ color: 0x2f3a52, roughness: 0.45, metalness: 0.2, emissive: 0x0d2a1e });
  const keys = [];
  const digitFields = [];
  for (let r = 0; r < 4; r++) for (let col = 0; col < 3; col++) {
    const x = X0 + col * (KW + GAP), y = Y0 + r * (KH + GAP);
    const k = new THREE.Mesh(keyGeo, keyMat);
    place(k, x + KW / 2, y + KH / 2, 0.0);
    k.userData.slot = r * 3 + col; k.userData.baseZ = 0; k.userData.press = 0;
    app.group.add(k); keys.push(k); app.targets.push(k);
  }
  // Slot 9 = delete, 11 = OK: public labels on small canvases.
  for (const [slot, label] of [[9, '⌫'], [11, 'OK']]) {
    const t = makeTex(unitCanvas(KW, KH, (c) => drawText(c, label, KW / 2, KH * 0.66, 0.05, { weight: 600, align: 'center', color: '#aab3c6' })));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(KW, KH), new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }));
    m.position.z = 0.0155; m.renderOrder = 4; keys[slot].add(m);
  }
  let layout = [];
  function buildDigits() {
    for (const f of digitFields) { f.object.parent?.remove(f.object); f.dispose(); app.fields.splice(app.fields.indexOf(f), 1); }
    digitFields.length = 0;
    const slots = [0, 1, 2, 3, 4, 5, 6, 7, 8, 10];
    layout = [];

    const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
    if (ctx.shuffle()) for (let i = digits.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [digits[i], digits[j]] = [digits[j], digits[i]]; }
    slots.forEach((slot, i) => {
      layout[slot] = digits[i];
      const f = new PrivateField({ w: KW * 0.9, h: KH * 0.9, group: 'pin', label: '', lines: [{ text: digits[i], x: KW * 0.45, y: KH * 0.68, size: 0.085, weight: 600, align: 'center' }] });
      f.object.position.set(-KW * 0.45, KH * 0.45, 0.0155);
      keys[slot].add(f.object); digitFields.push(f); app.fields.push(f);
    });
  }
  buildDigits();

  app.enter = () => { entered = ''; message = ''; unlocked = false; buildDigits(); drawDots(); };
  const keyOf = (o) => { while (o && o.userData.slot === undefined) o = o.parent; return o; };
  function submit() {
    unlocked = entered === '2580';
    message = unlocked ? 'Unlocked' : 'Wrong PIN';
    messageT = unlocked ? 1.2 : 1.0; entered = '';
    if (!unlocked) buildDigits();
  }
  app.click = (hit) => {
    const k = keyOf(hit?.object);
    if (!k) return;
    k.userData.press = 1;
    const slot = k.userData.slot;
    message = '';
    if (slot === 9) entered = entered.slice(0, -1);
    else if (slot === 11) submit();
    else { entered += layout[slot]; if (entered.length === 4) submit(); }
    drawDots();
  };  app.update = (dt, t, hoverObj) => {
    const hover = keyOf(hoverObj);
    for (const k of keys) {
      k.userData.press = Math.max(0, k.userData.press - dt * 5);
      k.position.z = -0.012 * k.userData.press + (hover === k ? 0.012 : 0);
      k.material = hover === k ? keyHover : keyMat;
    }
    if (messageT > 0) { messageT -= dt; if (messageT <= 0) { if (unlocked) ctx.go('bank'); message = ''; drawDots(); } }
  };
  return app;
}

// ---- Bank ----------------------------------------------------------------------------------------------
export function bankApp() {
  const app = newApp('bank', 'Lumen Bank', 'apps');
  const tx = [['Grocery market', '−$84.12'], ['Paycheck', '+$3,904.55'], ['Rent', '−$2,150.00'], ['Coffee', '−$5.40']];
  app.group.add(windowBase('Lumen Bank', '#7aa7ff', (c) => {
    drawText(c, 'Checking balance', 0.08, 0.2, 0.032, { color: '#aab3c6' });
    drawText(c, 'Account number', 0.08, 0.44, 0.032, { color: '#aab3c6' });
    drawText(c, 'Recent activity', 0.86, 0.2, 0.032, { color: '#aab3c6' });
    tx.forEach(([name], i) => drawText(c, name, 0.86, 0.3 + i * 0.13, 0.036, { weight: 550 }));
    // Public spending chart: shape only, no amounts.
    const bars = [0.4, 0.62, 0.35, 0.8, 0.55, 0.7, 0.45];
    bars.forEach((b, i) => { c.fillStyle = i === 3 ? '#7aa7ff' : 'rgba(122,167,255,0.35)'; rr(c, 0.08 + i * 0.09, 0.8 - b * 0.18, 0.06, b * 0.18, 0.01); c.fill(); });
    drawText(c, 'Spending this week', 0.08, 0.6, 0.026, { color: '#7d869a' });
  }));
  field(app, { w: 0.7, h: 0.15, lines: [{ text: '$48,213.07', y: 0.12, size: 0.115, weight: 600 }] }, 0.07, 0.22);
  field(app, { w: 0.7, h: 0.09, lines: [{ text: '4417 0921 8836', y: 0.068, size: 0.06, weight: 600 }] }, 0.07, 0.455);
  tx.forEach(([, amt], i) => field(app, { w: 0.3, h: 0.085, label: '', lines: [{ text: amt, x: 0.3, y: 0.064, size: 0.052, align: 'right', color: amt.startsWith('+') ? '#6fe0a4' : '#eef1f7' }] }, 1.18, 0.245 + i * 0.13));
  return app;
}

// ---- Health record ---------------------------------------------------------------------------------------
export function healthApp() {
  const app = newApp('health', 'Health record', 'apps');
  const labs = [['A1C', '6.8 %'], ['LDL', '112'], ['Blood pressure', '128/84']];
  app.group.add(windowBase('Health record', '#ff8fb1', (c) => {
    drawText(c, 'Patient', 0.08, 0.19, 0.03, { color: '#aab3c6' });
    drawText(c, 'Diagnosis', 0.08, 0.39, 0.03, { color: '#aab3c6' });
    drawText(c, 'Latest labs', 0.08, 0.59, 0.03, { color: '#aab3c6' });
    labs.forEach(([name], i) => {
      c.fillStyle = 'rgba(255,255,255,0.04)'; rr(c, 0.08 + i * 0.48, 0.62, 0.44, 0.19, 0.02); c.fill();
      drawText(c, name, 0.11 + i * 0.48, 0.665, 0.028, { color: '#aab3c6' });
    });
    drawText(c, 'Visit: Oct 2 · Clinic room 4', 1.05, 0.19, 0.026, { color: '#7d869a' });
  }));
  field(app, { w: 0.8, h: 0.1, lines: [{ text: 'Jordan Rivera', y: 0.075, size: 0.07 }] }, 0.07, 0.2);
  field(app, { w: 1.3, h: 0.1, lines: [{ text: 'Type 2 diabetes', y: 0.075, size: 0.07 }] }, 0.07, 0.4);
  labs.forEach(([, v], i) => field(app, { w: 0.4, h: 0.11, label: '', lines: [{ text: v, y: 0.085, size: 0.075 }] }, 0.1 + i * 0.48, 0.685));
  return app;
}

// ---- Messages ------------------------------------------------------------------------------------------
export function messagesApp() {
  const app = newApp('messages', 'Messages', 'apps');
  const chats = [['Sam', 'Gate code is 4471'], ['Dr. Lee', 'Results look good'], ['Bank', 'Code: 839 201']];
  const bubbles = [['in', 'Can you send the'], ['in', 'door code again?'], ['out', 'It is 4471#'], ['in', 'Thanks!']];
  app.group.add(windowBase('Messages', '#6fe0a4', (c) => {
    c.fillStyle = 'rgba(255,255,255,0.03)'; c.fillRect(0, 0.1, 0.5, WIN_H - 0.14);
    chats.forEach(([name], i) => {
      c.fillStyle = ['#ffb86b', '#ff8fb1', '#7aa7ff'][i]; c.beginPath(); c.arc(0.08, 0.19 + i * 0.16, 0.03, 0, Math.PI * 2); c.fill();
      drawText(c, name, 0.125, 0.18 + i * 0.16, 0.032, { weight: 650 });
      if (i === 0) { c.fillStyle = 'rgba(111,224,164,0.08)'; c.fillRect(0, 0.13 + i * 0.16, 0.5, 0.15); }
    });
    drawText(c, 'Sam', 0.56, 0.17, 0.034, { weight: 650 });
    bubbles.forEach(([dir], i) => {
      const x = dir === 'in' ? 0.56 : 1.02, y = 0.22 + i * 0.13;
      c.fillStyle = dir === 'in' ? '#232938' : '#1d5b43'; rr(c, x, y, 0.46, 0.105, 0.04); c.fill();
    });
  }));
  chats.forEach(([, msg], i) => field(app, { w: 0.36, h: 0.06, label: '', lines: [{ text: msg, y: 0.045, size: 0.034, color: '#c7cede' }] }, 0.125, 0.195 + i * 0.16));
  bubbles.forEach(([dir, msg], i) => field(app, { w: 0.42, h: 0.085, label: '', lines: [{ text: msg, y: 0.062, size: 0.044 }] }, (dir === 'in' ? 0.56 : 1.02) + 0.02, 0.23 + i * 0.13));
  return app;
}

// ---- Notification pop-ups (over any app) -----------------------------------------------------------------
export function notifications() {
  const NOTES = [
    ['Bank', 'Sign-in code 839 201', '#7aa7ff'],
    ['Sam', 'Gate code is 4471', '#ffb86b'],
    ['Dr. Lee', 'Your results are in', '#ff8fb1'],
  ];
  const W = 0.86, H = 0.15;
  const group = new THREE.Group();
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({
    map: makeTex(unitCanvas(W, H, (c) => { rr(c, 0, 0, W, H, 0.035); c.fillStyle = 'rgba(30,35,48,0.97)'; c.fill(); c.lineWidth = 0.002; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.stroke(); })),
    transparent: true, toneMapped: false, depthWrite: false,
  }));
  plate.renderOrder = 8; group.add(plate);
  const fields = NOTES.map(([who, body, color]) => {
    const f = new PrivateField({ w: W - 0.16, h: H - 0.03, group: 'notifications', lines: [{ text: who, y: 0.045, size: 0.036, weight: 700, color }, { text: body, y: 0.1, size: 0.044 }] });
    f.object.position.set(-W / 2 + 0.13, H / 2 - 0.015, 0.001);
    f.object.traverse((o) => { if (o.renderOrder) o.renderOrder += 5; });
    f.object.visible = false; group.add(f.object);
    return f;
  });
  const icon = new THREE.Mesh(new THREE.CircleGeometry(0.032, 32), new THREE.MeshBasicMaterial({ color: 0x6fe0a4, toneMapped: false }));
  icon.position.set(-W / 2 + 0.065, 0, 0.001); icon.renderOrder = 9; group.add(icon);
  group.visible = false;
  let t = 3, idx = -1, showing = 0;
  return {
    group, fields,
    get active() { return idx >= 0 && group.visible ? fields[idx] : null; },
    trigger() { t = 0; },
    update(dt) {
      t -= dt;
      if (t <= 0) {
        idx = (idx + 1) % NOTES.length; t = 11; showing = 5.5;
        fields.forEach((f, i) => { f.object.visible = i === idx; });
        icon.material.color.set(NOTES[idx][2]);
      }
      showing -= dt;
      const target = showing > 0 ? 1 : 0;
      group.userData.s = (group.userData.s ?? 0) + (target - (group.userData.s ?? 0)) * Math.min(1, dt * 8);
      const s = group.userData.s;
      group.visible = s > 0.01;
      group.position.set(0, WIN_H / 2 - 0.02 - H / 2 + (1 - s) * 0.12, 0.05);
      group.scale.setScalar(0.92 + 0.08 * s);
    },
  };
}
