# CLAUDE.md

Privacy Display 3D: a Samsung-style privacy display for DisplayXR (Leia SR) glasses-free 3D panels. It is a static site with no build step and no package manager. It is served by GitHub Pages from the `main` branch root at https://joehillthunder.github.io/displayxr-privacy-display/ and linked from DisplayXR HQ (`joehillthunder/joehillthunder.github.io`, `home/demos.js` + `home/office.js`).

## Architecture

- `index.html`: page, sidebar controls, and an import map (three 0.161.0 from jsDelivr, inline3d from `./vendor/inline3d/`).
- `js/main.js`: one `THREE.WebGLRenderer` on one persistent canvas. In the DisplayXR Browser, `createInline3D()` + `wall.addScene(canvas, onXRFrame, { virtualDisplayHeight: 1 })` makes it a woven inline-3D window: draw each eye into its viewport from `views`, move content, never a camera. Elsewhere `onMonoFrame` renders 2D.
- **Eye positions** come from the per-eye `view.transform.matrix` translation (stage units), times `unitM` (canvas height in metres from `handle.displayMetrics()`). `handle.trackingState` gives 'tracking' | 'searching' | 'unknown'. The runtime tracks ONE face only, and there is no second-face signal.
- `js/privacy.js`: `PrivacyPolicy.update(dt, tracking, leftEye, rightEye)` returns true when private content may show. It covers presence, the cone (PRESETS), and the owner lock (IPD enrolment, jump and tracking-edge re-verification). It is pure, with no DOM or three.js. `selfTest()` covers it.
- `js/fields.js`: `PrivateField` renders one private item three ways: clear, veil (frosted, leaks nothing), or stereo (random-dot stereogram shader). The stereo mode needs `rdsShared.eye.value` set to -1 or +1 per eye before each eye's render (`drawEye` does it), and 0 for 2D. Disparity is in whole dot cells, so glyph edges never cut a dot.
- `js/apps.js`: window-space layout (units, top-left origin, +y down, mapped by `place()`). Window size is `WIN_W` x `WIN_H` = 1.56 x 0.86 on a stage 1 unit tall. Each app has `group`, `fields`, `targets` (pickable), `update`, `click` and `enter`. Field `group` ('apps' | 'pin' | 'notifications') maps to Samsung's "Conditions for turning on".

## Conventions

- Keep content near z = 0 (the glass is sharpest there). Pop-ups sit at z ≈ 0.05.
- Stereo-only text must be big: glyph strokes need to be at least 3 dot cells (`rdsShared.cell`, default 0.0036 units), so text is about 0.045 units or larger.
- The woven canvas and its ancestors get no border, radius, shadow or filter.
- Pin versions: three 0.161.0 and inline3d 1.45.1 (vendored, because jsDelivr has returned 503 for some inline3d files).
- Debug hooks: `window.privacy` (policy, sim, ui, setApp, allowed). URL flags are listed in README.md.

## Testing

- No Python or Node on the demo PC. Serve with a PowerShell `System.Net.HttpListener` on a free port: 8765 is the Muse bridge, and 8790/8811 are often taken by other sessions.
- `?selftest` runs the policy tests (check `#selftest` says ALL PASS, or `window.__selftest.pass`).
- Headless screenshots: `msedge --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot ... --virtual-time-budget=7000`. Headless gets only ONE real frame, so add `?step=N` to advance the simulation N frames (about 120 to enrol the owner, about 200 for the first notification). Large windows (1600x1300) with many textures sometimes come out black under SwiftShader. Use a smaller `--window-size` before suspecting the code.
- Real check: the DisplayXR Browser on the Leia panel. GDI screenshots of a woven panel come out blank. The IPD readout should be about 55–70 mm if `unitM` is right.

## Git

Commit to `main` (Pages serves it). Other Claude sessions often work in sibling repos under `~/Documents/GitHub`. Don't edit them from here, and use a worktree for HQ homepage changes.
