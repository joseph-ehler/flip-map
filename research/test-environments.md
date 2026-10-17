# Test environments for Flip Map: what can stand in for the TCL Flip 4

Research from 2026-10-16. The question: can anything off the phone reproduce the Flip 4's KaiOS 4.0 runtime (gecko-b2g, Gecko 123) well enough to test against? The development machine is an Apple M4 Max (arm64, macOS 26.6) with Docker.

## Short answer

**Nothing public reproduces KaiOS 4.0.** There is no KaiOS 4.0 or Gecko 123 simulator to download:
- KaiOS's 4.0 documentation links to the 3.0 simulator.
- KaiOS's download bucket holds no 4.0 build.
- The only prebuilt Gecko 123 "b2g desktop" builds, Capyloon's (including a Mac arm64 one), are gone: the host no longer resolves, and nothing is archived.

So the setup is three layers, each for what it's good at:

| Layer | What it answers | Effort | Verdict |
|---|---|---|---|
| **The real Flip 4** | Everything KaiOS-specific: `navigator.b2g` and wake locks, flip-closed behavior, GPS, voice, keys, the packaged-app security policy, performance, battery | — | **Essential.** No substitute |
| **Firefox 123 via Playwright 1.42.1** | Gecko-engine differences: JS, CSS layout, transforms and transitions, SVG, Canvas 2D, service worker, AbortController, TextDecoder, geolocation flows, key logic at 240×320 | ~15 min to set up, 1–2 h for first tests | **Do it.** Cheapest high-value check |
| **A custom Flip 4 simulator** | Repeatable drives and failures through the real app: GPS traces, network faults, the flip closed, KaiOS API behavior as switchable policies, screenshots across versions | ~4 days minimum, 8–10 days full | **Do it after Monday,** with the phone's results setting its policies |

## Options considered

### KaiOS's own simulators

- **2.5 simulator ("Kaiosrt"):** Gecko 48, a 2019 build, Ubuntu x86_64. It's still downloadable, but the engine is 75 versions behind and the APIs are the old ones (`navigator.mozX`). **Not worth it.**
- **3.0 simulator** (the one the 4.0 docs link to): `developer-portal/simulator/Kaiosrtv3.0_ubuntu.zip`, 146.8 MB, July 2021, still downloadable (verified). It runs Gecko 84 and needs Ubuntu 18.04 on x86_64. It has the KaiOS shell, soft keys, `navigator.b2g` and packaged-app install through `appscmd --socket`. It emulates no hardware, so there's no GPS. On this Mac it would run in an amd64 container (OrbStack or Docker with Rosetta, plus Xvfb and noVNC), about half a day to set up. **Maybe, low priority.**
  - **Good for:** the shell and soft keys, and the installed-app flow.
  - **Misses:** the Gecko 84 → 123 differences, and the hidden-page GPS rule, which is new in Gecko 123.

### Building gecko-b2g 123 from source

KaiOS's engine is public (`kaiostech/gecko-b2g`, branch `gonk`, milestone 123), and it includes a desktop configuration. But:
- **The system app is missing:** KaiOS's system UI (Gaia) is closed, so a stand-in shell would be needed.
- **Mac builds are unproven:** a native macOS arm64 build is undocumented (Capyloon cross-compiled from Linux).
- **The emulator target is stale and heavy:** last updated 2021, needs a custom NDK and 120 GB or more of disk.

Expect 30–40 GB, hours of compiling, and days of integration work. **Not worth it**, unless we someday need `navigator.b2g` behavior off the phone, and the custom simulator's shim covers that more cheaply.

### Firefox 123 (recommended)

- **The build:** Playwright 1.42.0 and 1.42.1 bundle **Firefox 123.0** (build 1440). 1.41 has 121 and 1.43 has 124, so the version pin matters. The Apple Silicon build is still on Playwright's CDN (verified), but the default mirror fails, so install with `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.playwright.dev`. Playwright 1.42.1 runs on Node 20.
- **What it emulates:**
  - The 240×320 viewport and devicePixelRatio.
  - Scripted geolocation, with `setGeolocation` to move.
  - Trusted key presses for arrows, digits, Enter and Backspace.
  - KaiOS-only keys (`SoftLeft`, `SoftRight`, `MicrophoneToggle`) aren't in Playwright's key list. Send them as synthetic events, which is enough because the app reads `e.key`.
- **How it differs from the phone:**
  - It's desktop Firefox with Playwright's patches: no `navigator.b2g`, no KaiOS permissions or audio channels, and macOS voices instead of SVOX Pico.
  - It renders through WebRender, while gecko-b2g uses the older layers compositor. So screenshots won't match the phone pixel for pixel, and blur and Canvas may look different.
- **Stock Firefox 123.0** is also still on Mozilla's archive (verified), driven by geckodriver 0.34. It's a cross-check only: without Playwright, the viewport and geolocation are awkward to control.
- **Gecko 84 (KaiOS 3.x) testing:** skip it. The app's JavaScript is ES5 and its newer CSS sits behind `@supports`, and there's no practical Apple Silicon Playwright build for it.

Setup, for when we do it (in its own folder, so the app stays untouched):

```bash
mkdir -p devtools/compat && cd devtools/compat && npm init -y && npm i -D -E @playwright/test@1.42.1
```

```bash
PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.playwright.dev npx playwright install firefox
```

### A custom Flip 4 simulator (recommended, after Monday)

No maintained tool covers this. KaiUI is a 2021 React kit, the Firefox "KaiOS Keyboard" add-on is only a keyboard, and there's no `navigator.b2g` mock anywhere. Wikipedia's KaiOS app takes the same approach we would: a normal browser at a fixed small screen size. The design:

1. **`devtools/kaios-shim.js`**, injected before the app's scripts (Playwright's `addInitScript`, or a dev server when `?harness` is in the URL). It changes no app code and provides:
   - **Clock:** fake timers, stepped in tests and run at real time ×N by hand.
   - **GPS:** a virtual GPS fed by a trace player. It encodes the Gecko 123 rule from [kaios4-platform.md](kaios4-platform.md): no `watchPosition` updates while hidden, cached `getCurrentPosition` answers, and GPS stops 6 s after hiding unless a `gps` wake lock is held.
   - **Wake locks:** `navigator.b2g.requestWakeLock` and `getWakeLockState`.
   - **A flip switch** that drives `document.hidden` and `visibilitychange`.
   - **Switches for what's unknown until the phone answers:** does closing the flip hide the page; do timers run when hidden, only with a `cpu` lock, or not at all; is speech audible.
   - **Speech, vibration and battery stand-ins.**
   - **Network faults per host:** delay, hang, error, offline, flaky.
   - **An event log.**
2. **`devtools/simulator.html`:** the app in a 240×320 frame, with a keypad (soft keys, OK as `MicrophoneToggle`, the double-press case), a flip switch, a trace player (GPX, GeoJSON or our JSONL; synthetic drives with correlated drift, jumps and dropouts), fault toggles, and a panel comparing true position with the blue dot.
3. **Playwright scenarios** in Chromium and Firefox 123, with map tiles and routing answers served from local fixtures so runs are deterministic. They include screenshot comparisons per engine.

**Reuse:**
- the audit harness's fake clock, mock router and route builder (branch `audit/nav-engine`)
- the app's `?sim` mode
- the phone check's flip test, which can run unchanged under the shim as a self-test

**First scenarios:**
1. Flip closed half a mile before a turn, under each policy. This is the spec for the wake-lock workaround.
2. Key flows through `app.js`: search, preview, routes, Go, Back, Back while loading, the double OK press.
3. A missed turn while rerouting hangs, errors or goes offline, then recovers.
4. A recorded drive with dropouts, run on both `hw-baseline-1` and the audit branch.
5. A reload mid-trip, plus day and night screenshots of the turn card, preview and Drive Report.

**GPS traces:** OpenStreetMap has public traces around downtown Gainesville, but their license is unclear. Use them locally if at all, and commit only drives we record ourselves on the phone.

**What it can never reproduce** (the phone stays essential):
- whether the flip hides the page, sleeps the CPU or honors wake locks
- real GPS behavior
- audible voice
- the phone's speed, memory, battery and storage quota
- which keys the KaiOS browser passes through
- the real viewport and fonts
- readability in sunlight
- calls, Bluetooth and the cover screen

### Remote real devices

None found. BrowserStack, Sauce Labs and LambdaTest cover only Android and iOS, and KaiOS has no remote device lab. One aside: `appscmd` ships an Apple Silicon binary, for installing packaged apps on the real Flip 4 if its debugging connection allows it.

## Recommended sequence

1. **Before Monday (optional, read-only):** run the current build in Firefox 123 at 240×320 through a few flows (load, search, preview, Go, settings) to catch any Gecko-engine problem before the phone shows it. This needs no app changes.
   - **Done 2026-10-16** in [`devtools/compat`](../devtools/compat) (`npm run install-firefox`, then `npm run check`): all 5 checks pass on `614c798` with no page or console errors. Covered: day and night maps, labels, search, preview, Go with OK as `MicrophoneToggle`, progress and voice prompts from `watchPosition`, settings, the Drive Report, and the phone check (2.7 ms per tile, no slow frames).
   - **Not covered:** the map turning with the road. Playwright's positions carry no course or speed, and the map only turns on a fix with both. The phone check and the Drive Report don't record whether the phone's fixes include them, so watch for it on the drive.
2. **Monday:** the phone check, the flip test and the drive.
3. **After Monday:** build the shim and simulator, setting their unknown-behavior switches from Monday's measurements. Then automate the first scenarios in both engines.
4. **The KaiOS 3.0 simulator** only if we pursue an installed app before the phone's debugging connection works.

## Sources

- **KaiOS simulators:** [docs (2.5)](https://developer.kaiostech.com/docs/getting-started/env-setup/simulator), [docs (SFP 3.0)](https://developer.kaiostech.com/docs/sfp-3.0/getting-started/env-setup/simulator), [docs (SFP 4.0)](https://developer.kaiostech.com/docs/sfp-4.0/getting-started/env-setup/simulator), KaiOS's download bucket `kaicloudsimulatordl.s3.amazonaws.com` (listing checked 2026-10-16)
- **KaiOS source and builds:** [kaiostech/gecko-b2g](https://github.com/kaiostech/gecko-b2g), [kaiostech/manifests](https://github.com/kaiostech/manifests), [Capyloon prebuilts](https://github.com/capyloon/nutria/blob/main/builder/prebuilts.json), [kaiostech/appscmd](https://github.com/kaiostech/appscmd)
- **Firefox 123:** Playwright `browsers.json` for [1.42.1](https://unpkg.com/playwright-core@1.42.1/browsers.json) (Firefox 123.0, build 1440, verified), [Playwright 1.42.0 release](https://github.com/microsoft/playwright/releases/tag/v1.42.0), [Firefox 123.0 archive](https://archive.mozilla.org/pub/firefox/releases/123.0/mac/en-US/)
- **Playwright features:** [setGeolocation and setOffline](https://playwright.dev/docs/api/class-browsercontext), [network routing](https://playwright.dev/docs/network), [service workers](https://playwright.dev/docs/service-workers), [screenshots](https://playwright.dev/docs/test-snapshots)
- **GPS replay prior art:** [Android emulator routes](https://developer.android.com/studio/run/emulator-extended-controls), [OsmAnd development plugin](https://osmand.net/docs/user/plugins/development), [Mapbox route replay](https://docs.mapbox.com/android/navigation/guides/route-replay/), [OSM GPS trace visibility](https://wiki.openstreetmap.org/wiki/Visibility_of_GPS_traces)
- **Other tools:** [KaiUI](https://github.com/leocs2417/KaiUI), [KaiOS Keyboard add-on](https://addons.mozilla.org/addon/kaios-keyboard/), [kaios.dev open-source list](https://kaios.dev/2024/01/kaios-open-source-resources/)
- **Device farms:** [Sauce Labs supported devices](https://docs.saucelabs.com/mobile-apps/supported-devices)
