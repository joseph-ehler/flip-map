# Flip Map design

A map for a 240×320 screen with no touch, used mostly while driving. The design follows from that.

## Principles

1. **The map is the interface.** It fills the screen. Cards float over it only when they have a job, and the map frames itself in the space between them.
2. **One glance.** While driving, the turn card answers three questions at once: which way (the arrow), how far (the big number), and onto what (the street). Everything else is secondary.
3. **Every key keeps its meaning.** Left soft key is the screen's main side action. OK is the main action. Right soft key is More. **Back always goes up one level.** The labels always say what the key will do right now.
4. **Calm by default.** No permanent status bar. GPS, signal, and connection problems appear as one small pill, only while they're true. Confirmations flash and leave.
5. **Motion explains change.** The map glides between GPS updates, zooms by scaling, and turns to face the road. Cards rise in, sheets slide up, and nothing just pops. Motion is off when the system asks for reduced motion.

## States

| State | On screen | Left | OK | Right | Back |
|---|---|---|---|---|---|
| Explore | Map, you, status pill, compass if rotated | Search | Locate me, or reset north | More | Exit app |
| Search (sheet) | Field, recents or results | Cancel | Search / Select | | Delete letter, else close |
| Preview | Route choices framed, card with time · distance · arrival | Back | **Go** (green) | | Back to results |
| Navigate | Turn card, "Then" hint, trip bar, speed | Overview | Repeat instruction / Resume | More | Resume if panned, else press twice to exit |
| Overview | Remaining route framed, north up | Resume | Resume | More | Resume |
| Arrived | Arrival card | | Done | | Done |
| Settings (sheet) | Voice, Appearance, Rotate Map, Phone Check, End Route | | Select | Done | Close |

D-pad (or 2/4/6/8) pans and 1/3 zoom in every map state. In Preview, ◀ ▶ switch between routes. A map panned while driving snaps back after 12 seconds.

## Visual system

- **Color:** iOS system colors, with separate light and dark values (blue `#007AFF`/`#0A84FF`, green, red, orange…). The turn card is always dark, like an instrument cluster.
- **Appearance:** Automatic follows the sun at your location (dark from dusk), or set Light or Dark by hand.
- **Type:** Inter (an open-source cousin of San Francisco), with tighter letter spacing at large sizes and tabular numbers wherever digits change.

  | Role | Size and weight |
  |---|---|
  | Turn distance | 26 bold |
  | Street | 15 semibold |
  | Card title | 16 semibold |
  | Body | 14 |
  | Secondary | 12 |
  | Captions | 10.5 |

- **Materials:** cards are near-opaque system materials. On browsers that support blur they become translucent glass. KaiOS probably doesn't, so the solid fallback is the design, not a degraded version of it.
- **Shape:** 16 px cards, 10 px rows, 13 px pills, and 7 px icon tiles. Sheets have 14 px top corners and a dimmed map behind them.
- **Motion:** a single curve, `cubic-bezier(0.32, 0.72, 0, 1)`.

  | Movement | Timing |
  |---|---|
  | Cards rising in | 420 ms |
  | Zoom | 320 ms |
  | Panning | 240 ms |
  | Between GPS fixes | Linear, timed to the GPS rate |

- **Glyphs:** turn arrows are drawn in code. The road comes up from the bottom, your path is bold, and the other roads at the junction are faint. There are variants for slight, normal, and sharp turns, U-turns, roundabouts (counterclockwise), forks, T-junctions, and arrival.

## Map: Flip Cartography

The map is drawn on the phone from vector data (OpenFreeMap, built from OpenStreetMap) in our own style, using plain 2D canvas rather than WebGL. Picture tiles were dropped because a filter can only recolor them: it can't remove clutter, set road hierarchy, or keep labels upright.

- **Two appearances.** Day is warm and quiet: off-white ground, white streets with soft edges, sage parks, soft blue water, and amber highways. Night is deep charcoal with the roads lifted out of it. It isn't an inverted day map. Automatic switches at dusk where you are.
- **Two densities.** Explore shows buildings (from zoom 15), footpaths (from 16), rail, neighborhood names, and street names. Drive drops buildings, paths, rail, and place names, softens parks and water, and keeps only street names.

  | | Explore | Drive |
  |---|---|---|
  | Labels | Up to 14 | Up to 6 |
  | Buildings, paths, rail | Shown | Hidden |
  | Place names | Shown | Hidden |
  | Parks and water | Full color | Softened |

- **Road hierarchy.** Ten classes, each with its own width (scaling 2^0.8 per zoom step), edge color, and the zoom it first appears at. All edges are drawn before all fills, so junctions merge cleanly. Tunnels are drawn faint and bridges on top.
- **Labels.** Labels are page text over the map, not painted into it, so they stay upright and sharp however the map turns.
  - Street names run along their road, flipping as needed so they never read upside down.
  - They're placed by importance. They never overlap each other, your position, or the cards.
  - Names are abbreviated the way signs do it: N Lake Shore Dr.
  - While driving, the street of the next turn gets a blue tag on the map.
- **Camera while driving.**
  - The map turns to face your direction of travel. The heading is eased, and wobbles under 4° are ignored, so it doesn't jitter.
  - You sit 68–78% of the way down the free space (lower the faster you go), so more road ahead shows.
  - Zoom follows speed, and zooms back in as a turn approaches.
  - The route widens with zoom so it always covers its road, and is drawn only from your position forward.

## Lane guidance

The routing service passes along OpenStreetMap's turn lanes at each junction (left to right, which ones suit the route). The app shows them only when the data can be trusted.

- **When it shows:** the junction has at least two lanes, some lanes are not recommended, and every recommended lane really allows this turn. If any of that fails, the card shows the turn alone. It never shows a guess.
- **Where:** one row under the street name, appearing about 500 m out (or 25 seconds at highway speed) and disappearing after the turn. It also disappears the moment you leave the route.
- **Look:** the lanes to use are solid blue tiles with white arrows, so they're marked by shape as well as color. The others are quiet gray. The lane is also named in words ("Right lane").
- **Voice:** the early warning adds the lane: "In half a mile, turn right onto SW 34th Street. Use the right lane."
- **Wording:** it describes lanes by position ("the left lane", "the 2 right lanes"). Phone GPS can't tell which lane you're in, so it never says "you're in the wrong lane".
- **Tested:** [tests/lanes.test.js](tests/lanes.test.js) covers shared turn lanes, lane counts that change before the junction, missing and incomplete data, recommendations that conflict with the maneuver, and real Gainesville junctions saved from the routing service. Run `node --test tests/`.
- **Not attempted:** drawing individual lanes on the moving map. A road's centerline and lane count aren't enough geometry to draw lanes honestly, and turn pockets and medians are mostly missing from the data.

## Turn card and camera

- **Turn card:** one row of arrow, distance, and street. "Then" folds in at its right edge instead of adding a row. The lane row appears only near a junction. A simple turn takes 55 px of the 320 px screen.
- **Camera:** you sit lower on screen as a turn approaches (80% of the free space within 300 m), a little higher on long straight stretches (66–70% beyond 1.5 km), and in between otherwise, so more road ahead shows when it matters.
- **Route preview:** where you're going comes first, then the time, distance, and arrival. Each route has a time tag on the map:
  - Tags sit on their own route, never on another route's line.
  - The chosen route's tag is blue and pops when it changes.
  - ◀ ▶ switch routes, and "‹ 1/2 ›" shows which one is chosen.
- **Into driving:** Go is one camera move of 700 ms. It zooms in, centers on you, and turns to face the route's first stretch, rather than a pan and then a separate zoom.
- **Color rule:** blue is for navigation (route, Go, Resume, the lane to use). Green means done (arrival). Red is for destructive actions and location problems.

## GPS states

| State | What shows | Way out |
|---|---|---|
| Finding your location | Pill with a pulsing dot. After 20 s it says "Still Looking — Try Outside" | Wait, or go outside |
| Location off (permission) | A card explaining how to allow it | OK becomes **Retry** |
| Location unavailable | Pill | OK retries |
| Approximate (worse than 65 m) | Pill and a wide accuracy halo | — |
| Signal lost (no fix for 15 s) | Gray position marker and pill | — |
| Offline | Pill. Cached map areas still draw; search and routing say they need a connection | — |

## Judged on the phone, not the desktop

Peak frame rate on a Mac means nothing for the Flip. These are the measures. The "watch for" column is a starting guess: we'll set real expectations once we've seen what this phone does.

| Measure | Watch for | Where |
|---|---|---|
| Works with the flip closed | Phone check flip test (keys 6 and 7): timer ticks and **new** polled positions while hidden. The Drive Report's "fixes while off" is expected to be 0 on KaiOS 4 (no `watchPosition` to hidden pages, per the engine source), so it only proves the page was hidden | Phone check; Drive Report |
| GPS rhythm | gaps of several seconds | Phone check, key 1; Drive Report |
| GPS spread | worst accuracy and the share of fixes vaguer than 20 m. An average hides the bad moments, and none of it says which lane you're in | Drive Report |
| Frame pacing while the map moves | a noticeable share of frames over 50 ms, or single long stalls | Phone check, key 5; Drive Report |
| Key response | a press that visibly lags | Drive Report |
| Voice | failed prompts. "Played" is only the speech engine's word; whether it was heard is the passenger's call | Drive Report; listen |
| Battery | per hour of driving | Drive Report (if the phone reports it) |

- **Drive Report** (More > Drive Report): records a trip as it happens and is kept until the next one, so a passenger can read it out afterwards. It samples frame pacing for 3 seconds every 30, which keeps its own cost small. It reports numbers without labeling them good or bad.
- **Reduce Motion** (More): turns off gliding, the zoom animation, and the fly-in when starting a route. If the phone stutters, compare with it on before changing any code.
- **When the screen comes back** (flip opened, app back in front): screen-on is requested again. If GPS went quiet while hidden, it's restarted rather than trusted.

## Needs the phone to confirm

- **Performance:** drawing the vector map on the Flip 4's chip. On a Mac, a downtown Chicago tile draws in 0–6 ms, so 10–20× slower would still be fine. Also whether the gliding transforms run smoothly.
- **Fonts:** whether the arrows and symbols render in Inter on KaiOS, with nothing falling back to boxes.
- **Keys:** whether the browser passes the soft keys and Back to the page. If not, use the app from a pinned shortcut, or rely on the digit keys.
