// Private fields: one piece of sensitive content, drawn three ways.
//
//   clear  - ordinary text on the glass (z = 0, the sharpest plane of a light-field display).
//   veil   - a frosted "Private" plate. Nothing of the content leaks: it is not a blur of the
//            real text, so not even the text's length shows.
//   stereo - a random-dot stereogram. Every eye gets a plate of random dots. Inside the glyphs
//            the dots come from a second noise field that is shifted by +-shift/2 whole dot cells
//            per eye (crossed disparity), so to the tracked viewer the letters float in front of
//            the noise. ANY single image - one eye, a bystander who catches one view or a blend of
//            both, a phone camera - is uniform random dots: the text exists only in the
//            DIFFERENCE between the two eye images. Shifts are whole cells, so no dot is ever cut
//            at a glyph edge (a cut dot would trace the letter for a single eye). The dots
//            re-seed every few frames (a dynamic RDS), so a long exposure averages to flat grey.
//
// The eye sign is a shared uniform: main.js sets rdsShared.eye.value = -1 / +1 before it draws
// the left / right eye, and 0 for a 2D render (which is then pure noise, as a bystander sees it).

import * as THREE from 'three';

export const PX_PER_UNIT = 1100;
const FONT = '"Inter", "Segoe UI", system-ui, sans-serif';

export function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export function makeTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Text in stage units on a context already scaled to PX_PER_UNIT. */
export function drawText(ctx, str, x, y, size, { weight = 500, color = '#eef1f7', align = 'left' } = {}) {
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100);
  ctx.font = `${weight} 100px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillText(str, 0, 0); ctx.restore();
}

/** A canvas w x h units, context scaled so drawing is in units. */
export function unitCanvas(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(w * PX_PER_UNIT)); c.height = Math.max(8, Math.round(h * PX_PER_UNIT));
  const ctx = c.getContext('2d'); ctx.scale(PX_PER_UNIT, PX_PER_UNIT);
  fn(ctx, c);
  return c;
}

const RDS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const RDS_FRAG = /* glsl */`
uniform sampler2D uMask; uniform vec2 uCells; uniform float uSeed; uniform float uEye; uniform float uHalf;
uniform vec3 uA; uniform vec3 uB; uniform float uOpacity;
varying vec2 vUv;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void main() {
  vec2 c = floor(vUv * uCells);
  vec2 cm = c + vec2(uEye * uHalf, 0.0);               // where this cell's foreground came from
  float m = texture2D(uMask, (cm + 0.5) / uCells).r;
  float n = m > 0.5 ? hash(cm + vec2(uSeed * 13.7 + 401.0, uSeed * 5.3)) : hash(c + vec2(uSeed * 7.1, uSeed * 11.9 + 97.0));
  gl_FragColor = vec4(mix(uA, uB, step(0.5, n)), uOpacity);
}`;

// Shared knobs: dot cell (units), half the disparity in cells, the dot palette and the eye sign.
export const rdsShared = {
  cell: 0.0036, half: 2, seed: { value: 0 }, eye: { value: 0 },
  a: new THREE.Color(0x10131a), b: new THREE.Color(0xc9d6ec),
};

export class PrivateField {
  /**
   * @param {object} o
   * @param {number} o.w @param {number} o.h  size in stage units (1 unit = display height)
   * @param {Array<{text:string,x?:number,y:number,size:number,weight?:number,color?:string,align?:string}>} o.lines
   *        positions in units from the field's top-left; y is the baseline.
   * @param {string} [o.group]  which privacy condition protects it ('apps' | 'pin' | 'notifications')
   * @param {string} [o.label]  veil label ('' for a lock only)
   */
  constructor(o) {
    this.o = o; this.group = o.group || 'apps';
    this.object = new THREE.Group();
    this.reveal = 1;      // 1 = content showing, 0 = veiled (animated)
    this.stereo = 0;      // 1 = stereo-only (animated cross-fade)
    this.mode = 'clear';
    this._build();
  }

  _text(ctx, mask) {
    for (const l of this.o.lines) {
      drawText(ctx, l.text, l.x ?? 0, l.y, l.size, { weight: mask ? 800 : (l.weight || 600), color: mask ? '#fff' : (l.color || '#eef1f7'), align: l.align || 'left' });
    }
  }

  _build() {
    const { w, h } = this.o;
    const geo = new THREE.PlaneGeometry(w, h);
    geo.translate(w / 2, -h / 2, 0);     // origin at the field's top-left, like the canvas

    this.clearTex = makeTex(unitCanvas(w, h, (ctx) => this._text(ctx, false)));
    this.clear = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.clearTex, transparent: true, depthWrite: false, toneMapped: false }));
    this.clear.position.z = 0.002; this.clear.renderOrder = 4;

    const label = this.o.label ?? 'Private';
    this.veilTex = makeTex(unitCanvas(w, h, (ctx) => {
      const r = Math.min(0.022, h / 3);
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'rgba(118,130,158,0.62)'); g.addColorStop(1, 'rgba(66,76,100,0.62)');
      rr(ctx, 0.002, 0.002, w - 0.004, h - 0.004, r); ctx.fillStyle = g; ctx.fill();
      ctx.lineWidth = 0.002; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.stroke();
      ctx.save(); rr(ctx, 0.002, 0.002, w - 0.004, h - 0.004, r); ctx.clip();
      for (let i = 0, n = Math.round(w * h * 12000); i < n; i++) { ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.09})`; ctx.fillRect(Math.random() * w, Math.random() * h, 0.0018, 0.0018); }
      ctx.restore();
      const s = Math.min(h * 0.4, 0.04);
      const showLabel = label && w > s * 5;
      const tw = showLabel ? s * 0.62 * label.length * 0.55 : 0;
      const lx = w / 2 - (s * 0.7 + (showLabel ? s * 0.35 + tw : 0)) / 2, ly = h / 2 - s * 0.12;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      rr(ctx, lx, ly, s * 0.7, s * 0.55, s * 0.08); ctx.fill();
      ctx.beginPath(); ctx.lineWidth = s * 0.11; ctx.arc(lx + s * 0.35, ly, s * 0.22, Math.PI, 0); ctx.stroke();
      if (showLabel) drawText(ctx, label, lx + s * 1.05, ly + s * 0.5, s * 0.62, { weight: 600, color: 'rgba(255,255,255,0.92)' });
    }));
    this.veil = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.veilTex, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
    this.veil.position.z = 0.003; this.veil.renderOrder = 5;

    const maskTex = new THREE.CanvasTexture(unitCanvas(w, h, (ctx) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h); this._text(ctx, true); }));
    maskTex.minFilter = THREE.LinearFilter; maskTex.generateMipmaps = false;
    this.rds = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: RDS_VERT, fragmentShader: RDS_FRAG, transparent: true, depthWrite: false, toneMapped: false,
      uniforms: {
        uMask: { value: maskTex }, uCells: { value: new THREE.Vector2(1, 1) }, uSeed: rdsShared.seed, uEye: rdsShared.eye,
        uHalf: { value: rdsShared.half }, uA: { value: rdsShared.a }, uB: { value: rdsShared.b }, uOpacity: { value: 0 },
      },
    }));
    this.rds.position.z = 0.004; this.rds.renderOrder = 6; this.rds.visible = false;
    this.maskTex = maskTex;

    this.object.add(this.clear, this.veil, this.rds);
  }

  /** Per frame. protect: a privacy condition covers this field; allowed: the policy lets content show; stereo: stereo-only mode. */
  update(dt, { protect, allowed, stereo }) {
    const show = !protect || allowed;
    this.mode = !protect ? 'clear' : !allowed ? 'veil' : stereo ? 'stereo' : 'clear';
    // Hide fast (80 ms), reveal gently (250 ms).
    const k = show ? dt / 0.25 : dt / 0.08;
    this.reveal = Math.max(0, Math.min(1, this.reveal + (show ? k : -k)));
    const sk = dt / 0.15;
    this.stereo = Math.max(0, Math.min(1, this.stereo + (protect && stereo ? sk : -sk)));

    const r = this.reveal, s = this.stereo;
    this.clear.material.opacity = r * (1 - s);
    this.clear.visible = this.clear.material.opacity > 0.002;
    this.veil.material.opacity = 1 - r;
    this.veil.visible = r < 0.998;
    const u = this.rds.material.uniforms;
    u.uOpacity.value = r * s;
    this.rds.visible = u.uOpacity.value > 0.002;
    if (this.rds.visible) {
      u.uCells.value.set(Math.round(this.o.w / rdsShared.cell), Math.round(this.o.h / rdsShared.cell));
      u.uHalf.value = rdsShared.half;
    }
  }

  dispose() {
    for (const m of [this.clear, this.veil, this.rds]) { m.material.map?.dispose?.(); m.material.dispose(); }
    this.maskTex.dispose(); this.clear.geometry.dispose();
  }
}
