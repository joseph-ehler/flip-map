# Flip Map

Turn-by-turn navigation for the TCL Flip 4 5G (KaiOS 4.0). It's plain HTML, CSS, and JS in [app/](app/), with no libraries and nothing to build.

**What it does:**
- Live GPS position with a heading arrow, speed, and accuracy circle.
- Place search: type with T9, and recent destinations are one key away.
- Driving route drawn on the map.
- A turn banner that advances on its own: next turn, distance, arrival time.
- Spoken turns: an early warning, then "turn now". The phone vibrates if it can't speak.
- Automatic rerouting when you leave the route.
- Routes resume if the app closes. Reopen it within 6 hours and the route picks back up.
- Works without a connection once loaded, and remembers map tiles you've already seen.

Plus [probe.html](app/probe.html), a one-screen phone check to run on the device Monday.

**Live:**
- Map: https://joseph-ehler.github.io/flip-map/
- Phone check: https://joseph-ehler.github.io/flip-map/probe.html

Every push to `main` republishes `app/` there, via [pages.yml](.github/workflows/pages.yml).

## Keys

| Key | Map screen |
|---|---|
| Left soft key or 7 | Search |
| Right soft key or 9 | Options (zoom, voice on/off, end route, phone check) |
| Enter or 5 | Snap back to your position. If already following on a route, repeat the next turn out loud |
| D-pad or 2 / 4 / 6 / 8 | Pan |
| 1 / 3 | Zoom out / in |

On the search screen, type, then press OK to search. Use Down and OK to pick a result. Back deletes a letter, or closes the screen when the box is empty.

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
python3 -m http.server 8417 --directory app
```

Open `http://localhost:8417/index.html?sim`. `?sim` fakes a drive around downtown Chicago: search for a place there (e.g. "willis tower") and it drives the route at 30 mph. Press 0 to swerve off the route and watch it reroute.

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
| Map tiles | tile.openstreetmap.org | Show attribution. Bulk-downloading areas is not allowed, so tiles are only saved as you view them |
| Place search | nominatim.openstreetmap.org | At most one search per second, no search-as-you-type |
| Driving routes | router.project-osrm.org | Car only, demo server, no guarantees |

To switch providers, change the constant at the top of [map.js](app/js/map.js), [search.js](app/js/search.js), or [nav.js](app/js/nav.js).

## Files

| File | Job |
|---|---|
| [js/geo.js](app/js/geo.js) | Map math, distances, miles/feet formatting |
| [js/map.js](app/js/map.js) | Draws tiles, route line, your dot |
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
