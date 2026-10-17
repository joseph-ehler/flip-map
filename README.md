# Flip Map

Turn-by-turn navigation for the TCL Flip 4 5G (KaiOS 4.0). It's plain HTML, CSS, and JS in [app/](app/), with no libraries and nothing to build.

**What it does:**
- A full-screen map that glides between GPS updates and turns to face the road while you drive.
- Light and dark appearance, switching automatically at dusk.
- Place search: type with T9, and recent destinations are one key away. Results show icons by kind of place.
- Route preview before you start: time, distance, and arrival. ◀ ▶ switch between alternative routes, and Go starts.
- A turn card with a drawn arrow, the distance, and the street. A "Then" hint appears when two turns come close together.
- Lane guidance from OpenStreetMap's lane data, shown and spoken only when the data agrees with the turn.
- A Drive Report (More > Drive Report) that records how the phone performed on a trip: GPS rhythm, slow frames, key response, spoken prompts, reroutes, and battery.
- A trip bar showing arrival time, time left, and miles left.
- Overview of the whole remaining route.
- Spoken turns: an early warning, then "turn now" with a buzz.
- Automatic rerouting, speed-based zoom, and a speed readout.
- Routes resume if the app closes. Reopen it within 6 hours and the route picks back up.
- Works without a connection once loaded, and remembers map tiles you've already seen.

The design system (principles, every screen's keys, colors, type, motion) is in [DESIGN.md](DESIGN.md).

Plus [probe.html](app/probe.html), a one-screen phone check to run on the device Monday.

**Live:**
- Map: https://joseph-ehler.github.io/flip-map/
- Phone check: https://joseph-ehler.github.io/flip-map/probe.html

Every push to `main` republishes `app/` there, via [pages.yml](.github/workflows/pages.yml).

## Keys

| Key | Map | While driving |
|---|---|---|
| Left soft key or 7 | Search | Overview of the route |
| OK or 5 | Locate me (or reset north) | Repeat the next turn out loud, or Resume after panning |
| Right soft key or 9 | More: voice, appearance, map rotation, phone check | Same, plus End Route |
| D-pad or 2 / 4 / 6 / 8 | Pan | Pan (snaps back after 12 s) |
| 1 / 3 | Zoom out / in | Zoom out / in |
| Back | Exit | Press twice to exit, so a bump doesn't end your trip |

In search, type and press OK. Use Down and OK to pick a place. That opens the route preview, where ◀ ▶ switch routes, OK is Go, and Back returns to the results. Back always goes up one level.

The digit keys duplicate the soft keys and D-pad because the regular KaiOS browser may keep those keys for itself. The phone check tells us whether it does.

## Monday checklist

No code changes until this is done. Each step answers a question the computer can't. Note anything that feels awkward on the keypad as you go.

1. **Phone check.** On the phone's browser, open `joseph-ehler.github.io/flip-map/probe.html` and allow location. Wait 15 seconds while it times GPS updates. Press every key once. Then press 2 for voice, 3 for vibrate, 4 for sound, and 5 for map speed (it draws real map tiles and turns them). While the sound plays, close the flip and listen for whether it keeps beeping. **Write down the blue summary line** and send it back. It covers:
   - GPS accuracy, time to first fix, and how often fixes arrive
   - how fast the map draws and how smoothly it turns
   - whether there's an English speech voice
   - which keys reach a web page
   - whether the screen can be kept on
   - whether Apple Music full songs are even possible (needs Widevine DRM)
2. **Phone identity.** Settings > Device > Device Info: write down the model (T440W?) and software version. Device-specific findings (developer mode, rooting notes) depend on the exact build.
3. **Map, standing still.** Open the map outside and wait for the blue dot. Check that it's where you are.
4. **Keys.** If the D-pad moves a mouse cursor instead of panning, use 2/4/6/8. Then look in the browser's menu for **Pin to Apps Menu**: a pinned app may get the D-pad.
5. **A short, familiar drive with a route.** Have a passenger hold the phone, or mount it. Four questions matter most:
   - **Right road:** does the dot follow the road you're actually on?
   - **Voice:** are the prompts delivered reliably, and early enough? (The passenger confirms they were heard. The phone can only say it played them.)
   - **Missed turn:** miss one on purpose. Is the reroute quick and understandable?
   - **Glanceable:** can you read the next step without a long look? In sunlight?

   Also: does lane advice (where it appears) come early enough to change lanes calmly, and does it match the paint on the road?
6. **Flip closed, with a turn coming.** Partway through, close the flip about half a mile before a turn, so a prompt is due while it's closed. A long straight stretch proves nothing: no prompt would be due anyway. Did the turn prompt play? Open it after the turn: did the map catch up?
7. **Interruptions.** Have someone call you mid-route, then hang up. Does navigation come back? Let the screen time out once. Does it resume on the right step?
8. **Afterwards:** open More > Drive Report and read out every line.
   - "Screen off" shows whether GPS fixes arrived and prompts finished while the flip was closed. Zero of both, *with a turn due*, strongly suggests the browser suspends the page. That is a limit of the browser tab, not necessarily of an installed KaiOS app.
   - If the map stuttered, turn on More > Reduce Motion, drive a little more, and note whether it helps.

What the results decide: rank failures by consequence, not by which happened first.

- **Changes the plan:** no English voice, no GPS or prompts with the flip closed, or the dot not following the right road. These decide how Flip Map is delivered: browser tab, installed KaiOS app, or "works with the flip open".
- **Calls for tuning:** stutter, slow keys, small text, awkward keypad moments. Targeted fixes within the current design.

Then, in order: compare with an installed (packaged) app, which may get different permissions, audio, and background behavior than a browser tab, even running the same code. After that, decide on a backend, adding only the services the measurements justify.

The build being tested is tagged `hw-baseline-1` in git, with its configuration in the tag message, so later changes can be compared against it.

Optional, if you're curious: dial `*#*333284#*#*` to turn on developer mode, install the Android tools on the Mac (`brew install android-platform-tools`), connect by USB, and run `adb devices`. If the phone is listed, installing Flip Map as a real app becomes possible to try. If not, the KaiStore test-device route is the next option.

## Try it on the computer

```bash
npx http-server app -p 8417 -c-1
```

Open `http://localhost:8417/index.html?sim`. `?sim` fakes a drive around downtown Chicago. `?sim=29.652,-82.325` starts anywhere else (that one is downtown Gainesville). Search for a nearby place and it drives the route at 30 mph. Press 0 to swerve off the route and watch it reroute. `-c-1` turns off caching so edits show up on reload.

## Tests

```bash
node --test tests/
```

Lane guidance is the one place a mistake could change how someone drives, so it has its own tests, including real Gainesville junctions saved from the routing service.

## Getting it onto the phone

### Option 1: host it and open it in the phone's browser (recommended)

No developer mode, no rooting. Websites can only use GPS over **HTTPS**, which GitHub Pages provides. Open `joseph-ehler.github.io/flip-map` on the phone, allow location, and bookmark it (or pin it if the browser offers that).

### Option 2: install it as a real KaiOS app (experimental, unverified on this phone)

This uses KaiOS's [appscmd](https://github.com/kaiostech/appscmd). It needs ADB with root access, which has **not** been confirmed on the Flip 4 5G. Remote debugging is reported blocked by SELinux. To try:

1. Turn on developer mode: dial `*#*333284#*#*`.
2. `brew install android-platform-tools`
3. Connect over USB, then run:

```bash
adb root
```

```bash
adb forward tcp:6000 localfilesystem:/data/local/debugger-socket
```

```bash
./appscmd install app
```

If `adb root` fails, stop and use Option 1. Don't root your only working phone.

## Free services it uses

All three are free community servers. Light personal use is within their rules. Heavy use isn't.

| What | Service | Rule that matters |
|---|---|---|
| Map data | tiles.openfreemap.org (vector, drawn on the phone) | Free and no key. Show attribution. Tiles are saved as you view them |
| Fallback map pictures | tile.openstreetmap.org | Used only if the vector data can't be reached. Show attribution, no bulk downloading |
| Place search | nominatim.openstreetmap.org | At most one search per second, no search-as-you-type |
| Driving routes | router.project-osrm.org | Car only, demo server, no guarantees |

To switch providers, change the constant at the top of [carto.js](app/js/carto.js), [search.js](app/js/search.js), or [nav.js](app/js/nav.js).

## Files

| File | Job |
|---|---|
| [js/geo.js](app/js/geo.js) | Map math, distances, miles/feet formatting |
| [js/map.js](app/js/map.js) | Camera and motion: tiles, route line, your position |
| [js/mvt.js](app/js/mvt.js) | Decodes vector map tiles |
| [js/carto.js](app/js/carto.js) | Flip Cartography: draws the map in our day/night, explore/drive styles |
| [js/labels.js](app/js/labels.js) | Places upright street and place names without overlaps |
| [js/lanes.js](app/js/lanes.js) | Decides lane guidance, or stays silent (tested in [tests/](tests/)) |
| [js/icons.js](app/js/icons.js) | Turn arrows and interface icons |
| [js/nav.js](app/js/nav.js) | Gets routes, tracks progress, speaks turns, reroutes |
| [js/search.js](app/js/search.js) | Search screen and recent places |
| [js/app.js](app/js/app.js) | Keys, soft keys, status bar, turn banner, options menu, GPS |
| [js/sim.js](app/js/sim.js) | Fake GPS for desktop testing (`?sim`) |
| [sw.js](app/sw.js) | Offline support and tile cache |
| [probe.html](app/probe.html), [js/probe.js](app/js/probe.js) | Phone check |

## Not done (needs the phone first)

- Whether spoken turns, screen-on, and background audio actually work on KaiOS 4. The phone check answers this.
- Whether the arrow glyphs in the turn banner (← → ↖ ↗ ↻ ↶ ◉) exist in the phone's font.
- Apple Music. If the phone check shows Widevine, the next step is a MusicKit test page, which needs an Apple Developer membership ($99/yr) for the token. If not, the web route stops at 30-second previews.
