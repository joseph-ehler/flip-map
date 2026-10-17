# Offline routing, the right road, and a voice backup

Research for what to build after the first test on the real phone. Nothing in `app/` was changed. The build under test stays frozen at `hw-baseline-1`.

Every number is labeled:

- **Measured:** run on this Mac (Apple M4 Max, Node 20) or against live data on 2026-10-16/17.
- **Estimated:** extrapolated from measurements. The usual step is "phone ≈ 5–10× slower than this Mac" (see [The phone](#the-phone)).
- **Sourced:** taken from documentation, with the link in [Sources](#sources).

Downloads and scripts stayed in a temporary folder outside the repo. The scripts are kept in the session notes folder (see [Reproducing](#reproducing)).

## Recommendations

| Area | Verdict | Why, in one line |
|---|---|---|
| 1a. Draw the dot on the route line while navigating | **Build** | Free: `nav.js` already computes the snap. Today the dot is drawn at the raw fix. |
| 1b. HMM matcher that favors the route, to catch missed turns | **Test first** | In simulation it noticed a missed turn in 4–8 s instead of 10–13 s (p90 35 s), with no false alarms at normal GPS noise. It needs a road graph. |
| 1c. Matching against the map tiles' roads | **Not worth it** | The geometry is excellent, but only 33% of junctions share a vertex. Repairing that is fiddly, and the offline graph (2) does the job better. |
| 2. Offline routing in plain JS | **Test first** | The Gainesville graph is 1.0 MB brotli and A* takes 5 ms here, so an estimated 25–50 ms on the phone (0.1–2 s with no JIT). The hard part is turn instructions, not the routing itself. |
| 3. Offline search (T9-aware) | **Build** (places and streets) / **Test first** (addresses) | About 140 KB gzipped for 9,420 places and streets, with sub-millisecond lookups. Addresses need county data with licensing still unconfirmed. |
| 4. Recorded voice clips | **Test first**, only if the phone has no English voice | The core library is 549 clips, 2.3 MB (Opus). The voice is public domain, and macOS `say` output may not be published. |
| 5. Speed limits | **Not worth it now**, comes free with 2 | The OSRM demo can't return speed limits. OSM tags them on 100% of primary/trunk/motorway road length in Gainesville. |

## The phone

- **Sourced:** TCL Flip 4 5G uses a Snapdragon 4s Gen 2 (2× Cortex-A78 at 2.0 GHz plus 6× A55). Phonescoop and T-Mobile list **2 GB RAM**, where the brief says about 1 GB. This plan budgets as if it were 1 GB: under 15 MB of data in memory for any feature here. The phone runs KaiOS 4.0 on Gecko 123, with a 240×320 screen.
- **Estimated:** for single-thread JS, the phone is 5–10× slower than this Mac. That combines roughly 4–5× in CPU single-core speed, SpiderMonkey vs V8 differences, and thermal throttling. It's an estimate; experiment E1 measures the real factor.
- **No-JIT worst case:** if an installed app runs without the JIT, timings get much worse. Node's `--jitless` (interpreter only) stands in for that case, then multiplied by the same factor. That is pessimistic, since even Gecko's baseline tiers beat a pure interpreter.
- **WebAssembly:** none of this needs it. The brief reports it blocked for installed apps. KaiOS's own docs list WASM for 3.0 and 4.0. Either way, everything below is plain JS with typed arrays.

## 1. Keeping the dot on the right road

### What the app does today

`app.js` `onFix` hands the raw fix to `map.setFix(fix)`, so the dot is drawn exactly where GPS says. `nav.js` `match()` snaps the fix to the route line, but only to track progress. Off-route means 3 fixes in a row farther than 40 m + min(accuracy, 50 m) from the line, or 50–90 m in practice.

### Can the map tiles serve as a road network? (measured)

Test: the OpenFreeMap TileJSON (`maxzoom` 14, build `20261011_080001_pt`), 3×3 z14 tiles over downtown Gainesville (x 4444–4446, y 6776–6778), decoded with the app's own `app/js/mvt.js`. The analysis looks at the center tile 14/4445/6777: 126 KB, extent 4096, so one tile unit is 0.52 m.

The comparison is against the OSM extract described in section 2: the same tile, all car roads.

| Check | Result |
|---|---|
| `transportation` layer | 332 features, made up of **1,604 line parts**. Lines with the same attributes are merged into multi-lines. 116.7 km of car road, mean segment 47 m. |
| Geometry vs OSM, 5,830 OSM vertices | Distance to the nearest tile line: median **0.11 m**, p99 0.57 m, max 0.8 m. 100% of the 108 km of OSM car road lies within 3 m of a tile line. |
| OSM junctions in the tile (1,193) | **393 (33%)** have a shared vertex in the tile. **629 (53%)** are T-junctions, where one line ends on another without a vertex. **161 (13.5%)** are crossings with no vertex on either line. 10 are missing a road. |
| Tile-only check | 566 crossings of same-level lines with no shared vertex. 628 line ends sit within 1 m of another line but aren't joined to it. |
| Tile edges | 202 of 202 line ends at the tile edge continue in the neighboring tile. Stitching works. |
| Attributes | Present: class, oneway (292 of 915 parts), ramp, brunnel (bridge/tunnel), layer, access, service. Absent: street names (those live in the separate `transportation_name` layer), maxspeed, turn lanes, turn restrictions. Feature ids exist, but a merged line carries just one id. |

**Conclusion:** at z14 the geometry is essentially unsimplified, which is good for drawing and snapping. But the tiles are not a connected graph. Two thirds of junctions would have to be rebuilt: join line ends to the line they touch, and split lines where they cross unless the brunnel or layer differs. Even repaired, they have no turn restrictions and no names on the same feature. Any matcher that needs connectivity should use the OSM graph from section 2 instead.

### Simulated drives (measured; GPS noise is synthetic)

Setup:
- 25 drives between random points in central Gainesville, on the routable OSM graph (43,663 nodes): 12,947 fixes at 1 per second.
- GPS error is correlated over time, the way phone GPS drifts (AR(1), ρ = 0.9 per second), at three noise levels.
- "Right road" means the matched position is on the OSM way actually being driven.

| Noise per axis | Raw error, median / p95 | Nearest road | HMM over all roads, live | Snap to route (corridor) |
|---|---|---|---|---|
| 4 m | 4.6 / 9.8 m | 88.7% | 94.7% | 96.5% |
| 8 m | 9.2 / 19.6 m | 74.8% | 89.9% | 93.0% |
| 12 m | 13.8 / 29.4 m | 65.1% | 83.2% | 89.8% |

The corridor's misses sit at intersections. Measured: when the corridor picks the wrong road, the true position is a median of 2–5 m (p90 5–15 m) from a junction, and the snap has landed on the route's next street. That looks fine on screen. Snapping to the nearest road is clearly not good enough.

**Missed turn (19 drives):** at a random turn in the middle of the route, the driver goes elsewhere.

| Method | Noticed after leaving, median / p90 | Never noticed before the drive ended | False alarm before the turn |
|---|---|---|---|
| Today's corridor rule (3 fixes past 40 m + accuracy, 46–59 m here) | 10–13 s / 35 s | 2 of 19 (the new road runs parallel, inside the threshold) | 0 |
| HMM over all roads, live | 2 s / 2–6 s | 0 | **9–18 of 19 drives**, so unusable alone |
| HMM that favors the route (+3 log-likelihood on route edges), off for 3 fixes | **4 / 5 s** (4 m), **6 / 8 s** (8 m), 8 / 13 s (12 m) | 0, 0, 1 | 0, 0, 2 |

The matcher is the Newson & Krumm model:
- Candidates are road edges within 60 m, in each allowed direction, about 15 per fix.
- Emission: Gaussian on distance to the road, σ = 1.2 × the noise level.
- Transition: exponential on the difference between route distance and straight-line distance, β = 5 m.
- Decoding is online (Viterbi, no lookahead). Route distance comes from a Dijkstra bounded to 3 × the straight-line hop plus 150 m.

**Cost (measured):** 0.02 ms per fix here, 0.17 ms with `--jitless`. **Estimated** on the phone: under 2 ms per fix even with no JIT, which is negligible at 1 fix per second.

**Caveats:**
- The truth and the matcher use the same map, so real-world map errors aren't modeled.
- The noise is synthetic. There are no multipath jumps, tunnels or GPS dropouts.
- Gainesville's tree canopy may push real error toward the 12 m row. Experiment E2 replays real drives.

### Recommendation

1. **Build:** while navigating and within tolerance, draw the dot at `route.snap` (already computed in `nav.js` `track()`), glided like today. Off the route, draw the raw fix. No new data, and roughly 10 lines in `app.js`/`map.js`. Also show the raw fix when accuracy is worse than the tolerance, so the dot never claims more than GPS knows.
2. **Test first:** the route-favoring HMM, only for detecting that you've left the route sooner. It needs the roads near the route: either the offline graph (2), or that graph sliced to a corridor about 150 m either side of each route (a few KB to fetch per route). Replay real drive logs (E2) before trusting the 4–8 s figure.
3. **Not worth it:** an HMM over repaired tile lines for free driving with no route.

## 2. Offline routing without WebAssembly

### Graph size (measured)

**Source:**
- Geofabrik `florida-latest.osm.pbf` (659 MB, dated 2026-10-17), clipped with pyosmium to an Alachua County box (29.40–29.95 N, 82.05–82.66 W). That covers Gainesville plus Alachua, Newberry, High Springs, Archer, Hawthorne and Waldo.
- A way is kept if any of its nodes is inside the box, so roads crossing the edge keep their full length.
- Overpass returned 504 Gateway Timeout for the same request, so Geofabrik is the source.

**Graph construction:**
- Nodes are junctions and way ends. Edges are the stretches between them, with shape points stored separately.
- Oneways are honored (`oneway`, roundabouts, motorways).
- Turn restrictions are stored as bans keyed on (in edge, out edge, via node). "Only" restrictions are stored as the single allowed out edge.

| Variant | OSM ways | Road km | Graph nodes | Edges | Directed arcs | Shape points | Raw | gzip | brotli |
|---|---|---|---|---|---|---|---|---|---|
| All car roads | 46,125 | 10,719 | 74,018 | 90,019 | 168,410 | 231,267 | 4.46 MB | 1.94 MB | 1.55 MB |
| **Routable** (no private/no-access, no parking aisles or driveways) | 28,850 | 8,555 | **43,663** | **54,636** | 99,869 | 156,322 | **2.79 MB** | 1.25 MB | **1.00 MB** |
| Major only (tertiary and up, plus links) | 5,628 | 2,340 | 5,520 | 6,748 | 9,160 | 29,206 | 0.37 MB | 0.18 MB | 0.15 MB |

The routable graph also carries:
- 4,947 street names (99 KB).
- 1,804 ways with `turn:lanes` (129 distinct lane strings).
- 469 turn-restriction relations, 325 of which map to a via node in this graph. The rest use a via way or involve excluded roads.

**Layout of the routable graph:**

| Part | Format | Bytes |
|---|---|---|
| Nodes | lat/lon as Uint16 offsets | 175 KB |
| Adjacency (CSR, compressed sparse rows) | Uint32 first-arc index + Uint32 arcs | 175 KB + 399 KB |
| Edge ends | Uint32 a, b | 437 KB |
| Length, travel time, name id | Uint16 each | 109 KB each |
| Flags (class, direction) | Uint8 | 55 KB |
| maxspeed | Uint8 | 55 KB |
| turn:lanes ids | 2× Uint16 | 219 KB |
| Shape offset | Uint32 | 219 KB |
| Shape deltas | Int16 | 625 KB |
| Strings | names + lanes | 102 KB |

Uint16 coordinates need about 1.3 m steps across this box, or ways clipped at the box edge, to fit. The size is the same either way.

The map tiles would be a far bigger way to carry this. About 800 z14 tiles cover the county box. The 9 downtown tiles measured 43–194 KB each, and rural tiles are smaller, so an estimated 20–60 MB, still without topology.

### Route times (measured here; phone estimated)

The router:
- Edge-based A*: it searches over directed edges, so it can apply turn costs and restrictions.
- Turn cost: up to about 7.5 s for sharp turns, 20 s for U-turns, and no U-turns except at dead ends.
- All 325 mapped turn restrictions are applied.
- The heuristic is straight-line distance (the cheap-ruler approximation) at 112 km/h.
- Speeds are OSRM car-profile class speeds, or 0.8 × the tagged maxspeed where present.

| Queries (routable graph) | Median | p95 | Max | Edges settled, median |
|---|---|---|---|---|
| A*, 200 random urban pairs | 4.7 ms | 18 ms | 52 ms | 10,488 |
| Dijkstra, 60 urban pairs | 11 ms | 27 ms | 43 ms | 24,728 |
| A*, 60 county-wide pairs | 12 ms | 44 ms | 46 ms | 22,700 |
| A*, urban, `--jitless` | 24 ms | 194 ms | 203 ms | |
| A*, county, `--jitless` | 46 ms | 127 ms | 142 ms | |
| A*, urban, major-only graph, `--jitless` | 1.4 ms | 4.9 ms | 6 ms | 1,020 |

- **Validation:** downtown (29.6516, −82.3248) to Butler Plaza (29.6215, −82.3815) came out 7,744 m and 598 s. The OSRM demo gives 7,773 m and 655 s for the same trip. OSRM's time is higher because it adds signal and turn penalties this prototype doesn't model.
- **Unreachable pairs:** 14 of 200 random urban pairs had no route. Their endpoints sat in small islands, like gated private streets or oneway artifacts. A real router snaps the start and end only to the main connected network.
- **Estimated on the phone:**
  - With JIT: median 25–50 ms, p95 0.1–0.2 s.
  - No JIT: median 0.1–0.25 s, p95 1–2 s.
  - Route alternatives (the ◀ ▶ preview) would take 2–3 more searches with penalized edges, so up to about 3× that.
  - Memory: about 9 MB (2.8 MB of graph plus about 6 MB of search arrays, sized from the typed arrays).

### JS libraries (sourced)

| Library | What it offers | Fit |
|---|---|---|
| `ngraph.path` (MIT) | A*, bidirectional NBA*, greedy A*, directed graphs. Reported on NYC (264k nodes): A* 55 ms, NBA* 44 ms on a desktop. | It wants `ngraph.graph`, one JS object per node and link, which is heavy on a phone. It has no turn restrictions or turn costs. |
| `geojson-path-finder` (ISC) | Shortest path over GeoJSON lines that share coordinates, with forward and backward weights. | It needs lines already joined at junctions, so it can't use the tiles as they are. No restrictions. Loading GeoJSON is slow. |
| `contraction-hierarchy-js` (MIT) | Contraction hierarchies (CH): 0.36 ms per query vs 123 ms Dijkstra on 135k nodes (desktop), after a 16-minute build. | It's built for undirected GeoJSON (directed edges only through a manual API). Turn restrictions need an edge-based CH. Not needed at county scale, since A* is already fast enough. |
| Custom A* over typed arrays (benchmarked above) | About 150 lines, with turn costs and restrictions. | **Best fit.** No dependencies, and memory is predictable. |

### Turn instructions and lanes offline

`nav.js` `build()` only reads this from OSRM:
- `r.duration`
- `r.legs[0].steps[]`, each with `maneuver.{type, modifier, bearing_after, exit}`, `name`, `ref`, `destinations`, `exits`, `geometry.coordinates`, and `intersections[0].lanes`.

`lanes.js` `guide(step)` reads `intersections[0].lanes[]` as `{indications, valid}`. So an offline router can return `{routes: [{duration, legs: [{steps}]}]}`, and `fetchRoutes` can fall back to it when the network fails. Nothing downstream changes.

Generating the steps:
1. Walk the route edge by edge. At each junction, compare the bearing in with the bearing out.
2. Emit a step where the name or ref changes, the turn exceeds a threshold (around 30°), or another road leaves at a similar angle (a fork).
3. Types:
   - `depart` / `arrive`
   - `turn` with a modifier from the angle: straight, slight, normal, sharp, uturn
   - `new name`, `continue`
   - `on ramp` / `off ramp`, from `*_link` classes
   - `fork`, `merge`
   - `roundabout`, counting exits along `junction=roundabout`
4. `destinations` comes from `destination` and `destination:ref`, which the extract already keeps.
5. Tune the angle thresholds against saved OSRM routes.

`tests/fixtures/gainesville-steps.json` is the start of a test set. Grow it to about 50 routes and diff offline steps against OSRM's. **Estimated:** 400–600 lines of code. OSRM's own guidance code is far larger, and most of that is edge cases.

**Lanes** are the risk. Offline, both `indications` and `valid` would come from the same `turn:lanes` tag. The `lanes.js` safety check ("OSRM recommends a lane whose markings don't allow this turn") would then always pass, because there's no second opinion. Ship offline routing **without** lane guidance at first. Add it only when it agrees with OSRM on a saved set, for example 95% or more identical lane choices on 200 Gainesville junctions, and only at junctions with clear tagging: the lane count matches `lanes`, and the junction is the end of the tagged way.

### Data pipeline

1. On the Mac: Geofabrik → pyosmium clip → Node graph build → `graph.bin` (about 1 MB brotli).
2. Host it **outside this repo**, for example a separate data repo on Pages or a release asset. The app downloads it once into the Cache API, and checks room first with `navigator.storage.estimate()`.
3. ODbL: the graph is a derived database, so it needs OSM attribution and the database offered under ODbL.
4. Refresh monthly.

## 3. Offline search

### What's available (measured)

**OSM, county box:**
- 4,519 named places: amenity 1,600, bus stops 943, buildings 575, shops 436, leisure 296, tourism 221, office 154, place 140, and others.
- Only **7,677 address points**, of which 7,619 have a street. That's a small fraction of real addresses.

**Alachua County E911 address points** (public ArcGIS layer):
- **153,394 points**, credited to "911 Communications Office of Alachua County".
- In one 2,000-record sample page, 49% had a unit number and 51% were distinct number + street. **Estimated:** 80–120k distinct addresses.
- No license is stated in the service metadata. Florida public-records law generally allows reuse, but confirm with the county, or check whether OpenAddresses already carries it, before republishing.
- **Fallback:** Census TIGER/Line address ranges (public domain). These interpolate along street segments, the way Nominatim does in the US.

**Tiles the app already caches:** a `poi` layer (916 in the downtown tile) and a `housenumber` layer (87). House numbers there have no street, so they're no use for address search.

### Prototype index (measured)

The index holds 9,420 entries: 4,580 places plus 4,840 street names. Their words reduce to a vocabulary of 4,086 tokens, which collapse to 3,767 distinct keypad-digit strings. 529 tokens share their digits with another, for example `st/rv`, `dr/er`, `half/gale`, `moon/momo`.

| Part | gzip |
|---|---|
| Names | 51 KB |
| Coordinates | 37 KB |
| Vocabulary | 15 KB |
| Postings | 33 KB |
| **Places + streets** | **≈ 136 KB** |
| 100k addresses (synthetic: sorted by street, delta-coded numbers and coordinates) | 385 KB |
| **Everything** | **≈ 0.52 MB** |

### Lookup

Every token, in the index and in the query, is turned into its **keypad digits** (a, b, c → 2; …).
- The last token matches as a prefix.
- Tokens of 5 or more digits may be one edit off.
- Every query token must match something.
- Results rank by match strength, then distance.

Why digits:
- KaiOS predictive T9 can pick the wrong word for the same keys. "home" and "good" are both 4663. In digit form, the word T9 picked doesn't matter.
- Digits typed directly ("13th" → 1, 3, 8, 4) land on the same keys as letters.
- Abbreviations are normalized both ways: northwest ↔ nw, street ↔ st.

| Query | Top result |
|---|---|
| `good` (T9's other word for "home") | Milam Funeral Home, Good Bike, … |
| `hone depot` | The Home Depot |
| `pubkix` (wrong key) | Publix |
| `walmrt` (missing letter) | Walmart Supercenter |
| `airpprt` | Gainesville Regional Airport |
| `starbu` (prefix) | Starbucks, 0.2 km |
| `nw 13th st` / `northwest 13th street` | Places on NW 13th St |

The 15 base queries took a median of 0.26 ms and a max of 0.92 ms here, and 0.48 / 1.36 ms with `--jitless`. The three typo and wrong-word queries added later took 0.15–0.17 ms each. **Estimated** on the phone: under 15 ms per query, and around 0.1 s to load the index.

**Still to do:**
- Demote bus stops ("X @ Y Southbound") and collapse duplicate names.
- Put the street itself first for street queries.
- Parse "1234 nw 13th st" as a house number plus a street.

### Recommendation

**Build** the places + streets index (about 140 KB) as the fallback when Nominatim fails or you're offline. **Test first** for addresses: confirm the county data license, or use TIGER ranges.

## 4. Voice backup if there's no English speech voice

The phone check (`probe.html`, key 2) reports the voices and plays a test sentence. If the phone has no English voice, the alternative is recorded clips joined in sequence.

### Licensing (sourced)

**macOS `say`: no.** The macOS Sequoia license, section 2.F, allows the system voices only "for your personal, non-commercial use". It forbids "recording, publishing or redistribution" in "a profit, non-profit, public sharing or commercial context". Hosting the clips on GitHub Pages is public sharing.

**Piper:** the engine (`piper-tts` 1.8, OHF-Voice/piper1-gpl) is GPL-3. That only matters if the engine itself ships, and it wouldn't: only rendered audio would. What matters is each voice's training data:

| Voice | Data, license | Use |
|---|---|---|
| `en_US-kristin` | LibriVox, public domain, trained from scratch | **Recommended** (used for the sizes below) |
| `en_US-norman` (male), `en_US-ljspeech`, `en_GB-cori` | Public domain, from scratch | Clean alternatives |
| `en_US-john` | Public domain, fine-tuned from kristin | Clean |
| `en_US-lessac` | Blizzard 2013 Lessac license: research only, no commercial use, no redistribution | **Avoid** |
| amy, joe, libritts_r, sam, alba, hfc_*, reza_ibrahim | Fine-tuned from lessac, so they inherit its terms whatever their own data's license | Avoid |
| ryan, hfc_female/male | CC BY-NC-SA | Avoid |

Credit the voice in the app even where it's public domain.

### The library (measured)

The library was rendered with Piper `en_US-kristin-medium`. The wording follows exactly what `nav.js` `instruction()`, `geo.spokenDistance()` and `lanes.js` `describe()` say, with silence trimmed. Sizes are for Opus at 24 kb/s in Ogg, and MP3 at 32 kb/s mono.

| Group | Clips | Audio | Opus | MP3 |
|---|---|---|---|---|
| Maneuvers and route phrases (turn, keep, merge, ramps, exits, roundabout 1st–8th, head N…NW, arrive left/right, "You have arrived", starting/resuming route) | 49 | 81 s | 247 KB | 337 KB |
| Connectors ("In", "onto", "on", "toward", "Then", "the road") | 6 | 4 s | 14 KB | 20 KB |
| Distances (50–950 ft, ¼ mi, ½ mi, 1 mi, 1.3–9.9 mi, 10–60 mi) | 160 | 253 s | 786 KB | 1,061 KB |
| Lane phrases (left/right/center, 1–4 lanes, "highlighted") | 13 | 20 s | 62 KB | 84 KB |
| Street-name parts (8 directions, 13 street types, 1st–300th) | 321 | 391 s | 1,217 KB | 1,670 KB |
| **Core library** | **549** | | **2.3 MB** | **3.1 MB** |
| + whole names of the 174 major roads that don't fit the grid (Archer Road, Waldo Road, Hawthorne Road, US Highway 27, …) | 174 | 310 s | 961 KB | 1,291 KB |
| For comparison: every street name in the county | 4,840 | 2.8 h | 30.8 MB | 41.4 MB |

**Street names, handled generically.** Measured:
- **59% of named road length** in the county follows the Gainesville grid pattern: direction + number + type, like "Northwest 13th Street", up to 298th. Three clips compose any of them.
- Whole-name clips cover the other major roads.
- Everything else says the maneuver alone ("Turn left") or "the road". The turn card still shows the full name.

**Trims if size matters:**
- Speak distances in clip mode only as 50–950 ft, ¼, ½, 1, 1.5, 2, 3, 5, 10 mi, about 30 clips. That saves about 600 KB.
- Compose ordinals 1st–300th from parts. That saves about 1 MB, but sounds choppier.

**Playback:**
- Join the clips with Web Audio: decode each, then schedule the buffers back to back. Sequential `<audio>` elements leave a gap between clips.
- The phone needs checking for: Opus vs MP3 support, playback with the flip closed, and whether the joined phrases sound natural. **The clips haven't been listened to by a person yet.**
- `nav.js` passes plain sentences to `say()`. Clip mode works better if `instruction()` also returns its parts, such as `['m/turn_right', 'c/onto', 'g/northwest', 'g/13th', 'g/street']`, so nothing has to parse sentences.

**Recommendation:** **Test first**, and only if the probe shows no English voice. Experiment E3 decides Opus or MP3 and gapless or not.

## 5. Speed limits

### OSM coverage on Gainesville's major roads (measured)

Urban box 29.58–29.72 N, 82.25–82.42 W, km of road with a `maxspeed` tag:

| Class | With maxspeed |
|---|---|
| motorway | 20 / 20 km, 100% |
| trunk | 53 / 53 km, 100% |
| primary | 118 / 118 km, 100% |
| secondary | 54 / 73 km, 75% |
| tertiary | 31 / 139 km, 22% |
| **All major** | **69% of 403 km** |
| County-wide residential / unclassified / service | 2% / 13% / 1% |

Well covered (99–100%):
- I-75: 70 mph
- Archer Rd: 45 mph
- University Ave: 30–45 mph
- NW/SW 13th St: 30–45 mph
- SW 34th St: 35/45 mph
- NW 39th Ave: 45 mph
- Waldo Rd: 35–60 mph
- Hawthorne Rd: 35–65 mph
- Williston Rd: 35–60 mph
- S Main St: 30–45 mph

Gaps:
- NE 15th St: 0%
- NW 8th Ave: 8%
- N Main St: 13%
- NW 53rd Ave: 21%

### Can OSRM return them? (measured)

No. `annotations=maxspeed` gets **400 InvalidQuery** from the OSRM demo server. OSRM's annotations are `nodes`, `distance`, `duration`, `datasources`, `weight` and `speed`, and `speed` is the profile's travel speed, not the posted limit.

There is a workaround: request `annotations=nodes`, then look up each consecutive pair of OSM node ids in a way-to-maxspeed table. On the downtown → Butler Plaza route, 85% of the node pairs matched the 2026-10-17 extract, and **81% of the distance** had a posted limit. Valhalla (`speed_limit`) and GraphHopper (`details=max_speed`) are documented to return posted limits, but they'd need hosting or an API key. That wasn't tried here.

**Recommendation:** **Not worth it now.** It comes free with the offline graph (2), which already stores maxspeed per edge (1 byte each, 55 KB). When shown, show only tagged limits, never guessed ones. Never warn about speeding from OSM data, which can be out of date.

## Experiment plan, after the device test

Run these only once the Monday checklist is done, as separate pages or offline replays. None of it goes into the frozen app.

| # | Experiment | Measures | Decides |
|---|---|---|---|
| E1 | **Bench page:** a one-screen page, like `probe.html`, that downloads the routable graph (1 MB) and the search index, then runs 50 A* routes, 1,000 HMM steps and 30 searches. It also reports `WebAssembly` presence, `navigator.storage.estimate()`, `deviceMemory`, and `canPlayType` for Opus and MP3. | The real phone-vs-Mac factor, load time, memory headroom | Go/no-go for 2 and 3. Pass if the A* p95 is under 1 s. |
| E2 | **Drive logs:** record raw fixes (lat, lon, accuracy, speed, heading, time) on 3 Gainesville drives (downtown grid, Archer Rd, I-75) and save them as a file. Replay them on the Mac through corridor snapping, the plain HMM and the route-favoring HMM. | Real GPS error, right-road rate, how fast a missed turn is noticed | Whether to build 1b. Pass if it notices within 8 s at the median, with zero false alarms. |
| E3 | **Clip playback:** 20 joined phrases, played with Web Audio and with `<audio>`, flip open and closed, Opus and MP3 | Gaps, failures, whether a listener understands them | Format and method for 4 |
| E4 | **Offline steps vs OSRM:** 50 saved Gainesville routes, comparing the step lists, duration and distance | How often the instructions differ | Whether offline routing can ship, and without lanes |
| E5 | **Search on the keypad:** 30 real destinations typed with T9, logging both the text and the digits | Hit rate in the top 3, keystrokes | Index ranking. Pass if 90% or more land in the top 3. |

## Risks

- **JS speed on the phone is unknown.** Every phone figure is an estimate until E1. If the JIT is off for installed apps, A* is up to about 2 s at p95. That's still acceptable for planning a route, but borderline for rerouting.
- **Memory.** Listings say 2 GB, the brief says about 1 GB, and a page gets much less than either. Keep the graph about 9 MB in memory and load it only while navigating offline.
- **Storage quota.** Cache API space on KaiOS 4 is unmeasured. The total proposed is about 1 MB of graph + 0.5 MB of search + 2.3–3.3 MB of clips, about 4–5 MB.
- **Instruction quality.** Home-made steps will differ from OSRM's at complex junctions. If lanes are inferred from the same tags they're checked against, the safety check becomes circular. Mitigation: offline mode without lanes, and diff against saved OSRM routes (E4).
- **The simulation may not hold up.** Synthetic noise and a perfect map flatter every matcher, so E2 decides.
- **Data rights.**
  - The ODbL needs attribution and the derived database offered under ODbL.
  - The county address license is unconfirmed.
  - Voices must stay on the public-domain list.
  - macOS `say` output is out.
- **Data goes stale.** OSM and speed limits change, so the graph needs a monthly rebuild. Old speed limits are a liability if shown as fact.
- **Offline routing still needs map tiles to look right.** The service worker caches only the tiles you've already viewed. An offline route through new territory would draw over blank map unless tiles are prefetched along the corridor.
- **A route-favoring matcher can hide a real departure** on roads parallel to the route, which the corridor rule also misses today. The route bonus must stay small enough that a clear divergence wins within a few fixes.

## Reproducing

Scripts and small result files are in the session notes folder: `~/Library/Application Support/Claude/side-session-notes/local_3a0fd6f9-a9de-4428-8805-21cc6cb24670/offline-research/`. They are:

- `tiles.js` / `tilecmp.js`: tile connectivity
- `extract.py`: pyosmium clip
- `graph.js`: graph, sizes, A*
- `mm.js`: map-matching simulation
- `maxspeed.py`
- `search.js`
- `synth.py` / `encode.sh` / `sizes.py`: voice clips

They read data downloaded into a temporary folder: the Geofabrik extract, tiles, a Piper voice. None of that data is in this repo.

## Sources

- OpenFreeMap TileJSON: https://tiles.openfreemap.org/planet
- Geofabrik Florida extract: https://download.geofabrik.de/north-america/us/florida.html
- OSRM HTTP API (annotations): https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md
- Newson & Krumm, "Hidden Markov Map Matching Through Noise and Sparseness", ACM SIGSPATIAL GIS 2009
- ngraph.path: https://github.com/anvaka/ngraph.path
- geojson-path-finder: https://github.com/perliedman/geojson-path-finder
- contraction-hierarchy-js: https://github.com/royhobbstn/contraction-hierarchy-js
- Piper voices and model cards: https://huggingface.co/rhasspy/piper-voices · engine: https://github.com/OHF-Voice/piper1-gpl
- Blizzard 2013 Lessac license: https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html
- macOS Sequoia license, §2.F: https://www.apple.com/legal/sla/docs/macOSSequoia.pdf
- TCL Flip 4 5G specs: https://www.phonescoop.com/phones/phone.php?p=7260
- KaiOS 4.0 overview (Gecko 123, WebAssembly): https://developer.kaiostech.com/docs/sfp-4.0/introduction/overview · KaiOS WASM notes: https://kaios.dev/2024/03/webassembly-wasm-on-kaios/
- Alachua County E911 address points: https://services1.arcgis.com/MiBZ4u97DWldovjI/ArcGIS/rest/services/AddressPoint/FeatureServer
- TIGER/Line address ranges, Alachua County: https://catalog.data.gov/dataset/tiger-line-shapefile-current-county-alachua-county-fl-address-range-feature
