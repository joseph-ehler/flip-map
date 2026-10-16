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

## Map

- OpenStreetMap tiles, toned down with a CSS filter: desaturated by day, inverted with hues restored by night.
- While driving, the map turns to face your direction of travel. You sit at 72% of the free space, so more road ahead shows. Zoom follows speed: close in town, farther out on highways, close again as a turn approaches.
- The route is drawn from your position forward only. Alternative routes in Preview are muted.

## Needs the phone to confirm

- **Performance:** whether the CSS filter and transform transitions run smoothly on the Flip 4's chip. If not, drop the filter by day first.
- **Fonts:** whether the arrows and symbols render in Inter on KaiOS, with nothing falling back to boxes.
- **Keys:** whether the browser passes the soft keys and Back to the page. If not, use the app from a pinned shortcut, or rely on the digit keys.
