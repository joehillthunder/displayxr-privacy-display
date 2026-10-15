# Privacy Display 3D

A Samsung-style **Privacy Display** for DisplayXR glasses-free 3D panels, built on eye tracking instead of special pixels.

**Live:** https://joehillthunder.github.io/displayxr-privacy-display/. Open it in the DisplayXR Browser on a Leia SR display for real eye tracking. In any other browser it runs in 2D with a simulated viewer.

## The idea

Samsung's Privacy Display on the Galaxy S26 Ultra ([support page](https://www.samsung.com/us/support/answer/ANS10010349/)) narrows each pixel's viewing angle with Flex Magic Pixel hardware, so people beside you see a dark, unreadable screen. You can turn it on for chosen apps, for PIN/password entry or for notification pop-ups only, and a "maximum" level narrows and dims it further.

A DisplayXR panel cannot narrow its pixels, but it knows where the viewer's eyes are and sends a separate image to each eye. This demo builds four protections from that:

| Layer | What it uses | What it stops |
| --- | --- | --- |
| **Presence** | `session.trackingState` | Content stays up after you walk away. It hides within 80 ms of `searching`. |
| **Privacy cone** | The tracked eye midpoint gives the viewing angle and distance | Reading from the side or from across the room. ±30° and 120 cm by default; ±15° and 90 cm at maximum. |
| **Owner lock** | Interpupillary distance (IPD) measured from the two tracked eyes | Someone else sitting down. The first steady viewer enrols. A one-frame jump of the eyes, a tracking drop or an IPD mismatch over 3.5 mm hides content until the owner is verified again. |
| **Stereo-only secrets** | The left/right image pair itself | Shoulder-surfers and cameras while you are reading. The text is a dynamic random-dot stereogram: each eye's image is uniform noise, and the letters exist only as the disparity between the two eye images. |

### Samsung condition → this demo

- **Apps:** Bank and Health are protected by default. Messages can be turned on.
- **PIN, pattern, password:** the lock screen's keypad digits are private and the keypad shuffles on every entry, so watching where someone clicks reveals nothing. The demo PIN is 2580.
- **Notification pop-ups:** only the pop-up is private (partial-screen privacy).
- **Maximum privacy protection:** a narrower cone, a dimmer screen and stereo-only secrets for every protected field.

## Limits (honest version)

- The runtime tracks **one** face and never reports a second one, so a shoulder-surfer is not detected directly. Viewer locks protect when the owner is absent, off-axis or replaced. Stereo-only secrets protect while the owner is reading.
- A lenticular panel repeats its views. Someone standing exactly in a repeat zone could catch a usable stereo pair, and a two-lens camera can recover the text.
- IPD is a weak biometric: two people with IPDs within about 3 mm look the same to the owner lock. It is a tripwire, not authentication.
- Eye positions are converted to metres with the canvas height from `displayMetrics()`. Check the IPD readout on the panel; it should read about 55–70 mm.

## Run locally

Any static server works. On the demo PC there is no Python or Node, so use a PowerShell `HttpListener` on a free port.

URL options: `?app=lock|bank|health|messages`, `?max`, `?stereo`, `?sim` (simulated viewer even in 3D), `?mono` (force 2D), `?pair` (cross-eye stereo preview in 2D), `?selftest` (policy unit tests), `?step=N` (advance N frames at boot, for headless screenshots).

Keys: `1`–`4` switch apps, `n` sends a notification, `p` toggles privacy.

## Files

- `js/privacy.js`: the policy (presence, cone, owner lock). Pure functions with a self test.
- `js/fields.js`: `PrivateField`, which draws content clear, as a frosted veil, or as a random-dot stereogram (shader).
- `js/apps.js`: the lock screen, bank, health, messages and notification pop-ups.
- `js/main.js`: renderer, inline-3D session, eye extraction, HUD, simulator.
- `vendor/inline3d/`: `@displayxr/inline3d` 1.45.1, vendored.
