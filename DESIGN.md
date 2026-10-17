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

## GPS states

| State | What shows | Way out |
|---|---|---|
| Finding your location | Pill with a pulsing dot. After 20 s it says "Still Looking — Try Outside" | Wait, or go outside |
| Location off (permission) | A card explaining how to allow it | OK becomes **Retry** |
| Location unavailable | Pill | OK retries |
| Approximate (worse than 65 m) | Pill and a wide accuracy halo | — |
| Signal lost (no fix for 15 s) | Gray position marker and pill | — |
| Offline | Pill. Cached map areas still draw; search and routing say they need a connection | — |

## Needs the phone to confirm

- **Performance:** drawing the vector map on the Flip 4's chip. On a Mac, a downtown Chicago tile draws in 0–6 ms, so 10–20× slower would still be fine. Also whether the gliding transforms run smoothly.
- **Fonts:** whether the arrows and symbols render in Inter on KaiOS, with nothing falling back to boxes.
- **Keys:** whether the browser passes the soft keys and Back to the page. If not, use the app from a pinned shortcut, or rely on the digit keys.
