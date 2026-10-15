// Privacy Display 3D: app shell.
//
// One three.js renderer on one persistent <canvas>. In the DisplayXR Browser on a 3D display the
// canvas is an inline-3D window (display rig, 1 unit = the canvas height): each frame draws once
// per eye, and the per-eye view transforms are also the TRACKED EYE POSITIONS, which feed the
// privacy policy (js/privacy.js). Anywhere else it renders 2D and a simulated viewer drives the
// policy, so the logic can be tried on any screen.
//
// URL: ?app=lock|bank|health|messages  ?max  ?stereo  ?sim  ?mono  ?pair (cross-eye 2D)  ?selftest

import * as THREE from 'three';
import { createInline3D } from '@displayxr/inline3d';
import { EyeCamera } from '@displayxr/inline3d/three';
import { PrivacyPolicy, PRESETS, selfTest } from './privacy.js';
import { rdsShared } from './fields.js';
import { lockApp, bankApp, healthApp, messagesApp, notifications, WIN_W, WIN_H } from './apps.js';

const VIRTUAL_DISPLAY_HEIGHT = 1;
const $ = (id) => document.getElementById(id);
const canvas = $('stage'), cover = $('cover'), statusEl = $('status');
const params = new URLSearchParams(location.search);

// ---- renderer --------------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setClearColor(0x000000, 1);
renderer.setPixelRatio(1);
renderer.autoClear = false;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1d26, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.4, 0.8, 1.2); scene.add(key);
const root = new THREE.Group(); scene.add(root);
const appLayer = new THREE.Group(); root.add(appLayer);
const dimmer = new THREE.Mesh(new THREE.PlaneGeometry(4, 2.4), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
dimmer.position.z = 0.02; dimmer.renderOrder = 100; root.add(dimmer);

const eye = new EyeCamera(THREE);
const monoCam = new THREE.PerspectiveCamera(30, 16 / 9, 0.05, 20);
const monoDist = VIRTUAL_DISPLAY_HEIGHT / 2 / Math.tan(THREE.MathUtils.degToRad(15));
monoCam.position.set(0, 0, monoDist);

// ---- state -------------------------------------------------------------------------------------------
const policy = new PrivacyPolicy();
const ui = {
  master: $('master'), apps: $('c-apps'), pin: $('c-pin'), notes: $('c-notes'), max: $('c-max'),
  appBank: $('a-bank'), appHealth: $('a-health'), appMessages: $('a-messages'),
  owner: $('x-owner'), stereo: $('x-stereo'), anim: $('x-anim'), depth: $('x-depth'), cell: $('x-cell'), sim: $('sim'),
};
if (params.has('max')) ui.max.checked = true;
if (params.has('stereo')) ui.stereo.checked = true;

const sim = { x: 0, z: 0.62, ipd: 0.063, present: true, y: 0 };
let shuffleOn = () => ui.master.checked && ui.pin.checked;
const apps = {};
const appCtx = { shuffle: () => shuffleOn(), go: (id) => setApp(id) };
apps.lock = lockApp(appCtx);
apps.bank = bankApp();
apps.health = healthApp();
apps.messages = messagesApp();
const notes = notifications();
root.add(notes.group);
let current = null;

function setApp(id) {
  if (!apps[id]) id = 'lock';
  if (current) appLayer.remove(current.group);
  current = apps[id];
  current.enter();
  appLayer.add(current.group);
  for (const b of document.querySelectorAll('#apps button[data-app]')) b.setAttribute('aria-pressed', String(b.dataset.app === id));
  const u = new URL(location.href); u.searchParams.set('app', id); history.replaceState(null, '', u);
}

function appProtected(id) {
  if (!ui.apps.checked) return false;
  return ({ bank: ui.appBank, health: ui.appHealth, messages: ui.appMessages })[id]?.checked ?? false;
}
function covers(f) {
  if (!ui.master.checked) return false;
  if (f.group === 'pin') return ui.pin.checked;
  if (f.group === 'notifications') return ui.notes.checked;
  return appProtected(current?.id);
}

// ---- picking -----------------------------------------------------------------------------------------
const pickCam = new THREE.PerspectiveCamera(); pickCam.matrixAutoUpdate = false;
let havePickCam = false;
const _a = new THREE.Matrix4(), _b = new THREE.Matrix4(), _pa = new THREE.Vector3(), _pb = new THREE.Vector3();
function setPickCam(eyes) {
  _a.fromArray(eyes[0].xf); _b.fromArray(eyes[eyes.length - 1].xf);
  _pa.setFromMatrixPosition(_a).add(_pb.setFromMatrixPosition(_b)).multiplyScalar(0.5);
  _a.setPosition(_pa);
  pickCam.matrixWorld.copy(_a); pickCam.matrixWorldInverse.copy(_a).invert();
  pickCam.projectionMatrix.fromArray(eyes[0].proj); pickCam.projectionMatrixInverse.copy(pickCam.projectionMatrix).invert();
  havePickCam = true;
}
const camera = () => (sbs ? (havePickCam ? pickCam : null) : monoCam);
const ray = new THREE.Raycaster();
const pointer = { x: 0, y: 0, inside: false };
let hoverObj = null;
function pick() {
  const cam = camera();
  if (!cam || !pointer.inside || !current?.targets.length) return null;
  ray.setFromCamera(new THREE.Vector2(pointer.x, pointer.y), cam);
  return ray.intersectObjects(current.targets, true)[0] || null;
}
function setPointer(e) {
  const r = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
  pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  if (pairMode && !sbs) pointer.x = ((pointer.x + 1) % 1) * 2 - 1;  // either half of a cross-eye pair
  pointer.inside = true;
}
canvas.addEventListener('pointermove', setPointer);
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });
canvas.addEventListener('pointerdown', (e) => { setPointer(e); const h = pick(); if (h) current.click(h); });

// ---- eyes --------------------------------------------------------------------------------------------
let unitM = 0.1944;              // metres per stage unit (canvas height / virtual display height)
let realEyes = null;             // { left, right } in metres, from the last woven frame
let source = 'sim';
function readEyes() {
  if (ui.sim.checked || !sbs) {
    source = 'simulated';
    if (!sim.present) return { tracking: 'searching', left: null, right: null };
    const yaw = Math.atan2(sim.x, sim.z);          // the head faces the display
    const dx = Math.cos(yaw) * sim.ipd / 2, dz = -Math.sin(yaw) * sim.ipd / 2;
    return { tracking: 'tracking', left: [sim.x - dx, sim.y, sim.z - dz], right: [sim.x + dx, sim.y, sim.z + dz] };
  }
  source = 'eye tracker';
  const ts = handle?.trackingState || wall?.trackingState || 'unknown';
  if (!realEyes) return { tracking: 'searching', left: null, right: null };
  return { tracking: ts, left: realEyes.left, right: realEyes.right };
}

// ---- per-frame logic ---------------------------------------------------------------------------------
let allowed = false, frame = 0, last = 0, lastState = '';
function tick(dt, t) {
  frame++;
  policy.useOwner = ui.owner.checked;
  policy.setPreset(ui.master.checked && ui.max.checked ? 'maximum' : 'standard');
  const e = readEyes();
  allowed = policy.update(dt, e.tracking, e.left, e.right);
  const stereo = ui.master.checked && (ui.max.checked || ui.stereo.checked);
  if (ui.anim.checked && frame % 3 === 0) rdsShared.seed.value = (rdsShared.seed.value + 17.31) % 997;
  rdsShared.half = +ui.depth.value;
  rdsShared.cell = +ui.cell.value;

  const hit = pick();
  hoverObj = hit?.object || null;
  canvas.classList.toggle('hovering', !!hoverObj);
  current?.update(dt, t, hoverObj);
  notes.update(dt);
  for (const f of current?.fields || []) f.update(dt, { protect: covers(f), allowed, stereo });
  for (const f of notes.fields) f.update(dt, { protect: covers(f), allowed, stereo });
  const dim = ui.master.checked && ui.max.checked ? 1 - PRESETS.maximum.dim : 0;
  dimmer.material.opacity += (dim - dimmer.material.opacity) * Math.min(1, dt * 6);
  dimmer.visible = dimmer.material.opacity > 0.005;

  if (frame % 6 === 0) updateHud();
}

// ---- drawing -----------------------------------------------------------------------------------------
function drawEye(cam, vp, sign) {
  rdsShared.eye.value = sign;
  renderer.setViewport(vp.x, vp.y, vp.width, vp.height);
  renderer.setScissor(vp.x, vp.y, vp.width, vp.height);
  renderer.render(scene, cam);
}
function drawStereo(eyes) {
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, canvas.width, canvas.height);
  renderer.setScissor(0, 0, canvas.width, canvas.height);
  renderer.clear();
  const xs = eyes.map((e) => e.xf[12]);
  const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
  for (const e of eyes) drawEye(eye.setFromMatrices(e.proj, e.xf), e.vp, e.xf[12] < mid ? -1 : 1);
  renderer.setScissorTest(false);
}
let pairMode = params.has('pair');
// Cross-eye pairs are viewed small, so the camera separation is far below a real IPD in stage units.
const PAIR_SEP = 0.09;
function drawMono() {
  const w = canvas.width, h = canvas.height;
  renderer.setScissorTest(true);
  renderer.setViewport(0, 0, w, h); renderer.setScissor(0, 0, w, h);
  renderer.clear();
  if (pairMode) {
    // Cross-eye pair: the RIGHT eye's image on the left half.
    monoCam.aspect = (w / 2) / h; monoCam.updateProjectionMatrix();
    for (const [sign, x0] of [[1, 0], [-1, w / 2]]) {
      // Back off so the whole 16:9 stage fits each narrow half.
      const dist = monoDist * Math.max(1, (16 / 9) / monoCam.aspect);
      monoCam.position.set(mono.x + sign * PAIR_SEP / 2, mono.y, dist); monoCam.lookAt(0, 0, 0); monoCam.updateMatrixWorld();
      drawEye(monoCam, { x: x0, y: 0, width: w / 2, height: h }, sign);
    }
  } else {
    monoCam.aspect = (sbs ? w / 2 : w) / h; monoCam.updateProjectionMatrix();
    monoCam.position.set(mono.x, mono.y, monoDist); monoCam.lookAt(mono.x, mono.y, 0); monoCam.updateMatrixWorld();
    if (sbs) { drawEye(monoCam, { x: 0, y: 0, width: w / 2, height: h }, 0); drawEye(monoCam, { x: w / 2, y: 0, width: w / 2, height: h }, 0); }
    else drawEye(monoCam, { x: 0, y: 0, width: w, height: h }, 0);
  }
  renderer.setScissorTest(false);
}

let wall = null, handle = null, sbs = false, lastGood = null;
const mono = { x: 0, y: 0 };
const _m = new THREE.Matrix4(), _p = new THREE.Vector3();

function onXRFrame(views, layer) {
  const now = performance.now();
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60; last = now;
  let ok = views && views.length >= 2;
  const eyes = [];
  if (ok) {
    for (const v of views) {
      const vp = layer.getViewport(v);
      if (!vp) { ok = false; break; }
      eyes.push({ proj: Float32Array.from(v.projectionMatrix), xf: Float32Array.from(v.transform.matrix), vp: { x: vp.x, y: vp.y, width: vp.width, height: vp.height } });
    }
  }
  if (ok) {
    const ps = eyes.map((e) => { _p.setFromMatrixPosition(_m.fromArray(e.xf)); return [_p.x * unitM, _p.y * unitM, _p.z * unitM]; });
    ps.sort((a, b) => a[0] - b[0]);
    realEyes = { left: ps[0], right: ps[ps.length - 1] };
  }
  tick(dt, now / 1000);
  if (ok) { lastGood = eyes; setPickCam(eyes); drawStereo(eyes); }
  else if (lastGood) drawStereo(lastGood);
  else drawMono();
}

function onMonoFrame(now) {
  if (sbs) return;
  requestAnimationFrame(onMonoFrame);
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60; last = now;
  tick(dt, now / 1000);
  // A touch of parallax from the simulated head, so moving it on the map reads on screen too.
  const tx = sim.present ? (sim.x / unitM) * 0.06 : 0;
  mono.x += (tx - mono.x) * 0.08; mono.y += (0 - mono.y) * 0.08;
  drawMono();
}

// ---- sizing ------------------------------------------------------------------------------------------
const gl = renderer.getContext();
const glMax = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), gl.getParameter(gl.MAX_VIEWPORT_DIMS)[0]);
function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  let w = Math.round((canvas.clientWidth || 640) * dpr), h = Math.round((canvas.clientHeight || 360) * dpr);
  const totalW = sbs ? w * 2 : w;
  const maxW = sbs ? Math.min(glMax, Math.round(screen.width * dpr)) : glMax;
  const s = Math.min(1, maxW / totalW, glMax / h);
  w = Math.floor(w * s); h = Math.floor(h * s);
  const bw = sbs ? w * 2 : w;
  if (canvas.width !== bw || canvas.height !== h) renderer.setSize(bw, h, false);
  // Stage units -> metres: the canvas is VIRTUAL_DISPLAY_HEIGHT units tall.
  handle?.displayMetrics?.().then((m) => { if (m?.canvasSizeM?.[1] > 0) unitM = m.canvasSizeM[1] / VIRTUAL_DISPLAY_HEIGHT; }).catch(() => {});
}
new ResizeObserver(sizeCanvas).observe(canvas);
function setStatus(text, kind) { statusEl.textContent = text; statusEl.dataset.kind = kind || ''; }
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setStatus('WebGL context lost', 'warn'); console.warn('[privacy] webglcontextlost'); });
window.addEventListener('error', (e) => setStatus('Error: ' + e.message, 'warn'));

// ---- HUD: banner, stats, map, bystander, log ----------------------------------------------------------
const STATE_LABEL = { 'no-viewer': 'No viewer', enrolling: 'Enrolling', owner: 'Owner', viewer: 'Viewer', verifying: 'Verifying', stranger: 'Someone else', 'outside-cone': 'Off-axis', 'too-far': 'Too far' };
const map = $('map'), mctx = map.getContext('2d');
const MAP = { xr: 0.9, zr: 1.4 };   // metres shown: x -0.9..0.9, z 0..1.4
const toMap = (x, z) => [map.width / 2 + (x / MAP.xr) * (map.width / 2), 40 + (z / MAP.zr) * (map.height - 60)];
const fromMap = (px, py) => [((px - map.width / 2) / (map.width / 2)) * MAP.xr, ((py - 40) / (map.height - 60)) * MAP.zr];

function drawMap() {
  const W = map.width, H = map.height, p = policy.preset;
  mctx.clearRect(0, 0, W, H);
  // cone
  const [cx, cy] = toMap(0, 0);
  const on = ui.master.checked;
  mctx.save();
  mctx.beginPath(); mctx.moveTo(cx, cy);
  const a = (p.coneH * Math.PI) / 180, r = p.maxDist;
  for (let i = 0; i <= 40; i++) { const t = -a + (2 * a * i) / 40; const [x, y] = toMap(Math.sin(t) * r, Math.cos(t) * r); mctx.lineTo(x, y); }
  mctx.closePath();
  mctx.fillStyle = on ? 'rgba(111,224,164,0.10)' : 'rgba(143,151,170,0.06)'; mctx.fill();
  mctx.strokeStyle = on ? 'rgba(111,224,164,0.5)' : 'rgba(143,151,170,0.3)'; mctx.lineWidth = 2; mctx.stroke();
  mctx.restore();
  // distance rings
  mctx.fillStyle = '#5b6375'; mctx.font = '20px Inter, sans-serif'; mctx.textAlign = 'left';
  for (const d of [0.5, 1.0]) { const [, y] = toMap(0, d); mctx.fillText(`${d * 100} cm`, 12, y + 6); mctx.strokeStyle = 'rgba(255,255,255,0.05)'; mctx.beginPath(); mctx.moveTo(0, y); mctx.lineTo(W, y); mctx.stroke(); }
  // display
  const half = (unitM * (16 / 9)) / 2;
  const [d0] = toMap(-half, 0), [d1] = toMap(half, 0);
  mctx.fillStyle = '#cfd5e3'; mctx.fillRect(d0, cy - 10, d1 - d0, 8);
  mctx.fillStyle = '#8f97aa'; mctx.textAlign = 'center'; mctx.fillText('display', cx, cy - 16 < 14 ? cy + 26 : cy - 16);
  // viewer
  const g = policy.geo;
  if (g) {
    const col = allowed ? '#4ade80' : '#ff7a7a';
    const [hx, hy] = toMap(g.mid[0], g.mid[2]);
    mctx.strokeStyle = 'rgba(255,255,255,0.15)'; mctx.setLineDash([6, 6]); mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(hx, hy); mctx.stroke(); mctx.setLineDash([]);
    mctx.fillStyle = col + '33'; mctx.strokeStyle = col; mctx.lineWidth = 3;
    mctx.beginPath(); mctx.arc(hx, hy + 14, 26, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
    for (const e of [g.left, g.right]) { const [ex, ey] = toMap(e[0], e[2]); mctx.fillStyle = '#fff'; mctx.beginPath(); mctx.arc(ex, ey, 5, 0, Math.PI * 2); mctx.fill(); }
  } else {
    mctx.fillStyle = '#8f97aa'; mctx.textAlign = 'center'; mctx.fillText('nobody tracked', W / 2, H * 0.6);
  }
}

let dragMap = false;
function mapPointer(e) {
  const r = map.getBoundingClientRect();
  const [x, z] = fromMap(((e.clientX - r.left) / r.width) * map.width, ((e.clientY - r.top) / r.height) * map.height);
  sim.x = Math.max(-MAP.xr, Math.min(MAP.xr, x)); sim.z = Math.max(0.2, Math.min(MAP.zr, z)); sim.present = true;
}
map.addEventListener('pointerdown', (e) => { if (!ui.sim.checked && sbs) { ui.sim.checked = true; } dragMap = true; map.setPointerCapture(e.pointerId); mapPointer(e); });
map.addEventListener('pointermove', (e) => { if (dragMap) mapPointer(e); });
map.addEventListener('pointerup', () => { dragMap = false; });

const bys = $('bystander'), bctx = bys.getContext('2d');
function drawBystander() {
  if (!canvas.width) return;
  const half = sbs || pairMode;
  // In a cross-eye pair the left eye's image is on the right half.
  const sx = pairMode && !sbs ? canvas.width / 2 : 0, sw = half ? canvas.width / 2 : canvas.width;
  try { bctx.drawImage(canvas, sx, 0, sw, canvas.height, 0, 0, bys.width, bys.height); } catch {}
}

const logEl = $('log');
function updateHud() {
  const on = ui.master.checked;
  const pill = $('pill'), reasonEl = $('reason');
  const anyProtected = on && (current?.fields.some(covers) || notes.fields.some(covers));
  if (!on) { pill.className = 'pill off'; pill.textContent = 'Privacy off'; reasonEl.textContent = 'Everything is visible to everyone.'; }
  else if (allowed) {
    pill.className = 'pill show'; pill.textContent = 'Private content visible';
    const stereo = ui.max.checked || ui.stereo.checked;
    reasonEl.textContent = `${policy.reason}.` + (anyProtected ? (stereo ? ' Secrets are stereo-only: your two eyes see them, any single view sees noise.' : '') : ' This app is not protected.');
  } else { pill.className = 'pill hide'; pill.textContent = 'Private content hidden'; reasonEl.textContent = policy.reason + '.'; }

  const g = policy.geo;
  $('s-state').textContent = STATE_LABEL[policy.state] || policy.state;
  $('s-src').textContent = source;
  $('s-angle').textContent = g ? `${g.angleH.toFixed(0)}° / ${g.angleV.toFixed(0)}°` : '–';
  $('s-dist').textContent = g ? `${(g.dist * 100).toFixed(0)} cm` : '–';
  $('s-ipd').textContent = g ? `${(g.ipd * 1000).toFixed(1)} mm` : '–';
  $('s-owner').textContent = policy.ownerIpd ? `${(policy.ownerIpd * 1000).toFixed(1)} mm` : (policy.useOwner ? 'not enrolled' : 'off');
  drawMap();
  drawBystander();
  const sig = policy.events.map((e) => e.t + e.text).join('|');
  if (sig !== lastState) {
    lastState = sig;
    logEl.innerHTML = policy.events.map((e) => `<li><b>${new Date(e.t).toLocaleTimeString()}</b> ${e.text}</li>`).join('');
  }
}

// ---- controls ----------------------------------------------------------------------------------------
for (const b of document.querySelectorAll('#apps button[data-app]')) b.addEventListener('click', () => setApp(b.dataset.app));
$('notify').addEventListener('click', () => notes.trigger());
$('b-enrol').addEventListener('click', () => policy.enrolNow());
$('b-forget').addEventListener('click', () => policy.forgetOwner());
for (const b of document.querySelectorAll('[data-sim]')) b.addEventListener('click', () => {
  if (sbs) ui.sim.checked = true;
  const k = b.dataset.sim;
  if (k === 'away') sim.present = false;
  else { sim.present = true; sim.ipd = k === 'owner' ? 0.063 : 0.0575; sim.x += k === 'other' ? 0.18 : 0; if (k === 'owner') sim.x = 0; }
});
const syncControls = () => {
  for (const id of ['a-bank', 'a-health', 'a-messages']) $(id).disabled = !ui.apps.checked || !ui.master.checked;
  for (const id of ['c-apps', 'c-pin', 'c-notes', 'c-max']) $(id).disabled = !ui.master.checked;
  ui.stereo.disabled = ui.max.checked;
  if (ui.max.checked) ui.stereo.checked = true;
};
for (const el of document.querySelectorAll('aside input')) el.addEventListener('change', () => { syncControls(); if (el === ui.pin || el === ui.master) current?.id === 'lock' && current.enter(); });
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input')) return;
  const k = { 1: 'lock', 2: 'bank', 3: 'health', 4: 'messages' }[e.key];
  if (k) setApp(k);
  if (e.key === 'n') notes.trigger();
  if (e.key === 'p') { ui.master.checked = !ui.master.checked; syncControls(); }
});

// ---- boot ----------------------------------------------------------------------------------------------
async function boot() {
  try { await Promise.race([document.fonts.load('600 40px Inter'), new Promise((r) => setTimeout(r, 2500))]); } catch {}
  setApp(params.get('app') || 'lock');
  syncControls();
  sizeCanvas();

  if (params.has('selftest')) {
    const res = selfTest();
    const pass = res.every((r) => r.pass);
    $('selftest-box').hidden = false; $('selftest-box').open = true;
    $('selftest').textContent = (pass ? 'ALL PASS\n' : 'FAILURES\n') + res.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`).join('\n');
    window.__selftest = { pass, res };
    console.info('[privacy] selftest', pass ? 'PASS' : 'FAIL', res);
  }

  if (!params.has('mono')) {
    try { wall = await createInline3D({ lazy: false }); } catch (e) { console.warn('[privacy] inline-3D unavailable', e); }
  }
  if (wall?.supported) {
    sbs = true;
    if (params.has('sim')) ui.sim.checked = true;
    sizeCanvas();
    handle = wall.addScene(canvas, onXRFrame, {
      virtualDisplayHeight: VIRTUAL_DISPLAY_HEIGHT,
      rectCover: 'auto',
      onLayerLost: () => {
        sbs = false; lastGood = null; havePickCam = false; realEyes = null;
        sizeCanvas(); requestAnimationFrame(onMonoFrame);
        setStatus('3D layer lost: showing 2D', 'warn');
      },
    });
    const r = await handle.firstWoven;
    cover.remove();
    sizeCanvas();
    console.info(`[privacy] firstWoven woven=${r.woven} reason=${r.reason}`);
    setStatus(r.woven ? 'Glasses-free 3D on · eye tracking drives privacy' : '3D window not woven: ' + r.reason, r.woven ? 'ok' : 'warn');
  } else {
    ui.sim.checked = true; ui.sim.disabled = true;
    cover.remove();
    setStatus('2D preview · simulated viewer · open in the DisplayXR Browser for eye tracking', '');
    // ?step=N advances N simulated frames first (headless screenshots only get one real frame).
    for (let i = 0, n = +params.get('step') || 0; i < n; i++) tick(1 / 60, i / 60);
    onMonoFrame(performance.now());
  }
  window.privacy = { policy, sim, ui, setApp, get allowed() { return allowed; }, get app() { return current?.id; }, notes, get realEyes() { return realEyes; } };
}
boot().catch((e) => { console.error(e); setStatus('Could not start: ' + (e?.message || e), 'warn'); cover.textContent = 'Could not start.'; });
