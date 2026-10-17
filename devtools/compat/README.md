# Flip Map test bench (Firefox 123 at 240×320)

Runs the real app, unchanged, in Firefox 123.0: the Gecko version of KaiOS 4.0 on the TCL Flip 4. It uses Playwright 1.42.1's build, which carries Playwright's own patches, so it's the same engine generation, not KaiOS's exact Gecko. The app is served from `../../app`, or from any folder given in `FLIPMAP_APP`.

Development tool only. Nothing here ships with the app.

## Setup

```bash
npm install
npm run install-firefox
```

The Chromium step is only needed for the long drive's heap reading:

```bash
npm run install-chromium
```

## What to run

| Command | What it does | Network |
|---|---|---|
| `npm run check` | The compatibility check: map, search, preview, Go, driving, settings, Drive Report, phone check | Live services |
| `npm run audit` | Key, screen and lifecycle tests (`keys.spec.js`, `lifecycle.spec.js`) | Recorded answers, with injected faults |
| `npm run long-drive` | A ~100-minute drive with GPS and network trouble, measured every 5 minutes. `LONG_SPEEDUP=8` replays 8× faster | Recorded answers |
| `npx playwright test --project=long-drive-chromium` | The same drive in Chromium 123, adding the JS heap after garbage collection | Recorded answers |
| `npm run record` | Re-records the answers from the live services | Live services |

To run any of these against `main`'s app instead of this checkout's, copy `main`'s app and point at it:

```bash
npm run main-app
```

```bash
FLIPMAP_APP=results/main-app/app npm run audit
```

## How it stands in for the phone

[`lib/page-init.js`](lib/page-init.js) is injected before the app's scripts. It replaces only the browser features the app calls:

- **GPS:** the test pushes each fix (with course and speed) to every `watchPosition` watcher.
- **Speech:** recorded, and "spoken" one at a time at about a real voice's pace, so a queue can build up.
- **Vibration:** counted.
- **Clock (optional):** runs faster for long replays. Frame timing stays real.
- **Counters:** timers, listeners, requests in flight, frames, and the time each fix costs.

[`lib/network.js`](lib/network.js) answers every outside request from [`fixtures/`](fixtures):
- **Routing** (OSRM), **search** (Nominatim), and **map data** (OpenFreeMap's TileJSON and vector tiles).
- **Reroutes from unrecorded positions** get the recorded route to the same place, joined from where you are.
- **Faults per service:** late, never answering, failing, or offline.

The audit and long-drive tests run without the service worker. That's because Firefox doesn't let Playwright see the requests a service worker makes. Offline caching is left to the phone.

[`lib/drive.js`](lib/drive.js) turns a route into second-by-second GPS:
- each stretch at its own pace, slowing for turns, with stops at some lights
- drifting receiver error, and poorer GPS downtown
- scripted trouble: stray fixes, signal gaps, a wrong turn

## What it can't tell you

- **Phone-only behavior:** the phone's speed, memory limits, real GPS, audible voice, flip-closed behavior, and which keys KaiOS passes through. Desktop timings show trends, not phone numbers.
- **Held keys:** whether the Flip 4 repeats a held key the way Firefox does.

## Fixture data

The recorded map data and answers are from OpenStreetMap contributors (ODbL), via OpenMapTiles, OpenFreeMap, OSRM and Nominatim. They're kept for testing, with that attribution.
