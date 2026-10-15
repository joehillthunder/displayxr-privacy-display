// Privacy policy: turns the tracked eyes into one decision per frame, "may private content show?".
//
// What the page can see: the runtime tracks ONE viewer and hands the page that viewer's two eye
// positions (the per-eye view transforms) plus session.trackingState ('tracking' | 'searching' |
// 'unknown'). It never reports a second face. So the policy protects with what one tracked viewer
// tells us:
//
//   1. Presence  - nobody tracked ('searching')            -> hide at once.
//   2. Cone      - the eyes' midpoint outside the privacy cone (too far off-axis, or too far away)
//                  -> hide. This is the software twin of Samsung's narrowed viewing angle.
//   3. Owner     - the interpupillary distance (IPD) is a stable per-person number the tracker
//                  measures in 3D (head turns do not change it). The first steady viewer enrols;
//                  a different IPD, a sudden jump of the tracked eyes (the tracker hopped to
//                  another face) or a tracking edge sends the policy back to "verifying".
//
// Everything here is pure (no DOM, no three.js) so ?selftest can drive it with synthetic eyes.

export const PRESETS = {
  standard: { coneH: 30, coneV: 25, maxDist: 1.2, dim: 1 },
  maximum: { coneH: 15, coneV: 15, maxDist: 0.9, dim: 0.78 },
};

export const DEFAULTS = {
  ipdTolerance: 0.0035,   // m: owners re-measure within about +-1.5 mm; strangers differ by more
  enrolSeconds: 1.0,      // steady, in-cone viewing before the owner is enrolled
  verifySeconds: 0.5,     // re-verification after a jump or tracking edge
  strangerSeconds: 0.35,  // an IPD mismatch must persist this long (filters tracker noise)
  jumpMeters: 0.09,       // eye-midpoint movement in ONE frame that means "a different face"
  minIpd: 0.045, maxIpd: 0.08,
};

const len = (v) => Math.hypot(v[0], v[1], v[2]);
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const deg = (r) => (r * 180) / Math.PI;

/** Eye geometry in metres, display-centred (+x right, +y up, +z toward the viewer). */
export function eyeGeometry(left, right) {
  const mid = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2, (left[2] + right[2]) / 2];
  const ipd = len(sub(left, right));
  const dist = len(mid);
  const z = Math.max(1e-4, mid[2]);
  return { mid, ipd, dist, angleH: deg(Math.atan2(mid[0], z)), angleV: deg(Math.atan2(mid[1], z)), left, right };
}

export class PrivacyPolicy {
  constructor(opts = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.preset = PRESETS.standard;
    this.useOwner = true;
    this.ownerIpd = null;        // enrolled IPD, metres
    this.state = 'no-viewer';    // no-viewer | enrolling | owner | verifying | stranger | outside-cone | too-far
    this.reason = 'Nobody is in front of the display';
    this.geo = null;
    this._ipdAvg = null;         // EMA of the IPD
    this._steady = 0;            // seconds of steady in-cone viewing (enrol / verify)
    this._mismatch = 0;          // seconds of IPD mismatch
    this._prevMid = null;
    this._prevTracking = null;
    this.events = [];            // short log for the HUD: { t, text }
  }

  setPreset(name) { this.preset = PRESETS[name] || PRESETS.standard; }
  forgetOwner() { this.ownerIpd = null; this._steady = 0; this._log('Owner forgotten: the next steady viewer enrols'); }
  enrolNow() { if (this._ipdAvg) { this.ownerIpd = this._ipdAvg; this._log(`Owner enrolled, IPD ${(this.ownerIpd * 1000).toFixed(1)} mm`); } }

  _log(text) { this.events.unshift({ t: Date.now(), text }); this.events.length = Math.min(this.events.length, 8); }
  _set(state, reason) {
    if (state !== this.state) this._log(reason);
    this.state = state; this.reason = reason;
  }

  /**
   * One frame. `tracking` is 'tracking' | 'searching' | 'unknown' | null; `left`/`right` are eye
   * positions in metres (or null). Returns true when private content may show.
   */
  update(dt, tracking, left, right) {
    const o = this.o, p = this.preset;
    const tracked = tracking !== 'searching' && !!left && !!right;
    const edge = this._prevTracking !== null && tracking !== this._prevTracking;
    this._prevTracking = tracking;

    if (!tracked) {
      this.geo = null; this._prevMid = null; this._steady = 0; this._mismatch = 0;
      this._set('no-viewer', 'Nobody is in front of the display');
      return false;
    }

    const g = (this.geo = eyeGeometry(left, right));
    const plausible = g.ipd > o.minIpd && g.ipd < o.maxIpd;
    const jumped = this._prevMid && len(sub(g.mid, this._prevMid)) > o.jumpMeters;
    this._prevMid = g.mid;

    if (jumped || edge) {
      // Someone else may have taken the tracker: re-verify before showing anything.
      this._steady = 0; this._mismatch = 0; this._ipdAvg = plausible ? g.ipd : null;
      if (this.ownerIpd) { this._set('verifying', jumped ? 'Tracked eyes jumped: verifying the viewer' : 'Tracking re-acquired: verifying the viewer'); return false; }
    }
    if (plausible) this._ipdAvg = this._ipdAvg == null ? g.ipd : this._ipdAvg + (g.ipd - this._ipdAvg) * Math.min(1, dt / 0.25);

    // Cone and distance first: outside them nobody sees private content, owner or not.
    if (Math.abs(g.angleH) > p.coneH || Math.abs(g.angleV) > p.coneV) {
      this._steady = 0;
      this._set('outside-cone', `Viewer is ${Math.round(Math.abs(g.angleH))}° off-axis (cone ±${p.coneH}°)`);
      return false;
    }
    if (g.dist > p.maxDist) {
      this._steady = 0;
      this._set('too-far', `Viewer is ${(g.dist * 100).toFixed(0)} cm away (limit ${(p.maxDist * 100).toFixed(0)} cm)`);
      return false;
    }

    // Owner lock off: anyone tracked inside the cone may see.
    if (!this.useOwner) { this._set('viewer', 'Viewer inside the privacy cone'); return true; }

    // Enrol the first steady viewer.
    if (!this.ownerIpd) {
      this._steady += dt;
      if (this._steady >= o.enrolSeconds && this._ipdAvg) {
        this.ownerIpd = this._ipdAvg;
        this._set('owner', `Owner enrolled, IPD ${(this.ownerIpd * 1000).toFixed(1)} mm`);
        return true;
      }
      this._set('enrolling', 'Hold still: enrolling the owner');
      return false;
    }

    const match = this._ipdAvg != null && Math.abs(this._ipdAvg - this.ownerIpd) <= o.ipdTolerance;
    if (this.state !== 'owner') {
      // Not yet showing: require a steady match.
      if (match) {
        this._steady += dt;
        if (this._steady >= o.verifySeconds) { this._mismatch = 0; this._set('owner', 'Owner verified'); return true; }
        this._set('verifying', 'Verifying the viewer');
        return false;
      }
      this._steady = 0;
      this._mismatch += dt;
      if (this._mismatch >= o.strangerSeconds) {
        this._set('stranger', `Someone else is viewing (IPD ${(this._ipdAvg * 1000).toFixed(1)} mm, owner ${(this.ownerIpd * 1000).toFixed(1)} mm)`);
        return false;
      }
      this._set('verifying', 'Verifying the viewer');
      return false;
    }

    // Showing: keep showing until a mismatch persists.
    if (!match) {
      this._mismatch += dt;
      if (this._mismatch >= o.strangerSeconds) {
        this._steady = 0;
        this._set('stranger', `Someone else is viewing (IPD ${(this._ipdAvg * 1000).toFixed(1)} mm, owner ${(this.ownerIpd * 1000).toFixed(1)} mm)`);
        return false;
      }
    } else this._mismatch = 0;
    this._set('owner', 'Owner verified');
    return true;
  }
}

// ---- self test (?selftest) ------------------------------------------------------------------------
export function selfTest() {
  const out = [];
  const ok = (name, cond) => out.push({ name, pass: !!cond });
  const eyes = (x, z, ipd = 0.063, y = 0) => [[x - ipd / 2, y, z], [x + ipd / 2, y, z]];
  const run = (pol, secs, tracking, e) => { let r = false; for (let t = 0; t < secs; t += 1 / 60) r = pol.update(1 / 60, tracking, ...(e || [null, null])); return r; };

  const pol = new PrivacyPolicy();
  ok('nobody tracked hides', run(pol, 0.2, 'searching') === false && pol.state === 'no-viewer');
  ok('enrolling hides at first', run(pol, 0.5, 'tracking', eyes(0, 0.65)) === false && pol.state === 'enrolling');
  ok('owner enrols after ~1 s', run(pol, 0.7, 'tracking', eyes(0, 0.65)) === true && pol.state === 'owner');
  ok('enrolled IPD ~63 mm', Math.abs(pol.ownerIpd - 0.063) < 0.0005);
  ok('owner moving a little keeps showing', run(pol, 1, 'tracking', eyes(0.08, 0.6)) === true);
  ok('owner off-axis 40° hides', run(pol, 0.1, 'tracking', eyes(Math.tan(40 * Math.PI / 180) * 0.6, 0.6)) === false && pol.state === 'outside-cone');
  run(pol, 0.05, 'tracking', eyes(0.08, 0.6));
  ok('owner back in cone re-verifies then shows', run(pol, 0.8, 'tracking', eyes(0.08, 0.6)) === true);
  ok('different IPD (stranger) hides', run(pol, 0.9, 'tracking', eyes(0.08, 0.6, 0.0575)) === false && pol.state === 'stranger');
  ok('owner returns: shows again', run(pol, 1.2, 'tracking', eyes(0.0, 0.6)) === true);
  ok('jump to another face hides at once', pol.update(1 / 60, 'tracking', ...eyes(0.25, 0.7)) === false && pol.state === 'verifying');
  ok('tracking lost hides', run(pol, 0.05, 'searching') === false);
  ok('too far hides', run(pol, 0.8, 'tracking', eyes(0, 1.5)) === false && pol.state === 'too-far');
  pol.setPreset('maximum');
  ok('maximum preset narrows the cone (20° hides)', run(pol, 0.8, 'tracking', eyes(Math.tan(20 * Math.PI / 180) * 0.6, 0.6)) === false);
  return out;
}
