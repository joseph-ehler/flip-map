# Flip Map

Turn-by-turn navigation for the TCL Flip 4 5G (KaiOS 4.0). It's plain HTML, CSS, and JS in [app/](app/), with no libraries and nothing to build.

**What it does:**
- A full-screen map that glides between GPS updates and turns to face the road while you drive.
- Light and dark appearance, switching automatically at dusk.
- Place search: type with T9, and recent destinations are one key away. Results show icons by kind of place.
- Route preview before you start: time, distance, and arrival. ◀ ▶ switch between alternative routes, and Go starts.
- A turn card with a drawn arrow, the distance, and the street. A "Then" hint appears when two turns come close together.
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

Do these in order. Each one answers a question the computer can't.

1. **Phone check.** On the phone's browser, open `joseph-ehler.github.io/flip-map/probe.html` and allow location. Press every key once. Then press 2 for voice, 3 for vibrate, and 4 for sound. While the sound plays, close the flip and listen for whether it keeps beeping. **Write down the blue summary line** and send it back. It covers:
   - GPS accuracy and time to first fix
   - whether there's a speech voice
   - which keys reach a web page
   - whether the screen can be kept on
   - whether Apple Music full songs are even possible (needs Widevine DRM)
2. **Map, standing still.** Open the map outside and wait for the blue dot. Check that it's where you are.
3. **Keys.** If the D-pad moves a mouse cursor instead of panning, use 2/4/6/8. Then look in the browser's menu for **Pin to Apps Menu**: a pinned app may get the D-pad.
4. **A short drive with a route.** Have someone else hold the phone, or mount it. Do the turn prompts come early enough? Does the screen stay on? Does the dot keep up?

## Try it on the computer

```bash
npx http-server app -p 8417 -c-1
```

Open `http://localhost:8417/index.html?sim`. `?sim` fakes a drive around downtown Chicago. `?sim=29.652,-82.325` starts anywhere else (that one is downtown Gainesville). Search for a nearby place and it drives the route at 30 mph. Press 0 to swerve off the route and watch it reroute. `-c-1` turns off caching so edits show up on reload.

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
