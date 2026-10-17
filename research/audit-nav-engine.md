# Audit: navigation engine and network failure paths

An audit of `main` at `614c798` (the app code is `hw-baseline-1` plus the pre-device OK-key and diagnostics changes), done on branch `audit/nav-engine`. `main`, the live site and `hw-baseline-1` are untouched.

## Method

- **Real engine, simulated world:** drives are replayed through the real `app/js/nav.js` in Node, with a fake clock and a scriptable mock routing server that can answer, delay, hang, return errors, or go offline.
- **GPS:** synthetic GPS comes from a seeded generator, with routes densified to a vertex every 10 m like OSRM's output.
- **Search:** search runs the real `app/js/search.js` in jsdom.
- **Code:** [tests/harness/world.js](../tests/harness/world.js), [tests/nav.test.js](../tests/nav.test.js), [tests/network.test.js](../tests/network.test.js), [tests/search.test.js](../tests/search.test.js).
- **Running it:** `npm install` once (for jsdom), then `node --test tests/`.

Every test states the behavior we want. Against the audited code, 6 of the 14 new tests fail. With the fixes on this branch, all pass (36 pass, plus 1 recorded as a known limitation).

Evidence classes:

- **Confirmed defect:** reproduced by a failing test.
- **Checked, holds:** a suspected problem that the test shows doesn't happen.
- **Demonstrated risk:** a plausible failure path that wasn't observed.
- **Hardware-dependent:** needs the TCL Flip 4.
- **External dependency:** depends on live services or KaiOS.

## Confirmed defects: 6 failing scenarios, 3 root causes

| # | Scenario (test) | What happened | Root cause | Fixed on branch |
|---|---|---|---|---|
| 1 | One stray fix 2 m from the destination, while still 500 m+ away (nav #25) | **The trip ended**: "You have arrived" | GPS matching accepts any position on the route, however far from the last one | Yes |
| 2 | One GPS jump onto the return leg of a route that doubles back 100 m away (nav #26) | **The next instruction became "arrive", and stayed wrong after good fixes resumed** | Same | Yes |
| 3 | A reroute request that never answers (network #31) | **Rerouting stops for the rest of the trip**: the "busy" flag is never cleared, and "Rerouting" shows for ever | No time limit on route requests | Yes |
| 4 | A route preview request that never answers (network #32) | **The preview spins for ever** | Same | Yes |
| 5 | A saved trip whose first request hangs after the app reopens (network #33) | **The trip never resumes** | Same | Yes |
| 6 | Search A answers after a newer search B (search #37) | **A's results replace B's** | Answers aren't tied to the latest query | Yes |

### The fixes (branch only, not merged)

- **Plausible matching** (`nav.js`): a fix is matched only against the part of the route we could plausibly have reached since the last matched fix. That's 60 m plus the GPS accuracy behind, and up to max(speed, 15 m/s) × elapsed time × 1.5, plus the same slack, ahead. A fix outside that stretch counts as off the route and leaves progress alone, so one stray fix can't skip turns or end the trip. If it persists for 3 fixes, the existing reroute takes over. Arrival now needs a plausible match within 30 m of the end. The first fix after a route starts still searches the whole route.
- **Time limits** (new `net.js`, `FM.net.getJSON`): route requests give up after 12 s, and searches after 10 s, aborting the request where the browser supports `AbortController`. The existing retry rules then apply: a reroute retries after 15 s if you're still off the route, a saved trip retries on the next fix after 15 s, and the preview shows "No Route · Routing is not answering".
- **Latest search wins** (`search.js`): each search is numbered, and only the latest one's answer, error or spinner is applied.

### Behavior changes to review before merging

- **Off the route:** the banner's distance and the trimmed route line now hold still until the reroute arrives. They used to keep updating against whatever part of the route was nearest.
- **Long GPS gaps:** a gap longer than 2 minutes is treated as 2 minutes when judging how far you could have gone. After a very long gap far ahead (you kept driving with no signal for minutes), the app may need its normal 3-fix reroute to catch up, instead of jumping ahead.

## Checked, holds (no change needed)

| Concern | Test | Result |
|---|---|---|
| A reroute answer arriving after the trip ended restarts navigation | network #34 | **Doesn't happen.** `request()` already ignores answers for a trip that's no longer current |
| Server errors and going offline leave navigation stuck | network #35, #36 | Says "Routing is unavailable" or "No connection" and retries |
| A 25 s GPS gap (tunnel) causes a reroute or a false arrival | nav #27 | Catches up cleanly |
| Three turns within 150 m: prompts out of order or late | nav #28 | Every "turn now" spoken in order, before its turn |
| ±100 m GPS (±45 m noise) causes reroutes or an early arrival | nav #29 | Neither |
| A clean drive with ±5 m noise | nav #24 | Turns announced early, one arrival, no reroutes |

## Demonstrated risks (not fixed)

| Risk | Why it matters | What would address it |
|---|---|---|
| **A parallel road 15 m away isn't noticed** (nav #30, recorded as a todo) | On a frontage road beside the route, the app believes you're on the route until the roads separate by more than 40 m plus the GPS accuracy | A road graph to match against: [offline-and-accuracy.md](offline-and-accuracy.md) §1b, and trace-based testing |
| Heading isn't used in matching | At junctions and on roads that double back, direction would help separate candidates | Partly covered by the plausibility window. A heading term is worth adding once real traces exist |
| Leaving the route is detected after 3 consecutive fixes beyond 40 m plus the accuracy | About 7–8 s at 30 mph in the harness | The route-favoring matcher in the offline research found 4–8 s. Validate on real traces first |
| Offline caches are limited by entry count, not bytes (`sw.js`: 600 vector tiles, 2,000 picture tiles) | Dense downtown tiles are about 300 KB, Gainesville's a few KB, so the cache could hold 3–180 MB. The phone's storage quota is unknown | Trim by `navigator.storage.estimate()` instead of counts. Hardware-dependent |
| Spoken prompts queue in the speech engine and are never cancelled | A slow engine could speak a prompt after the turn it describes | Measure on the phone (Drive Report, passenger). Possibly cancel queued prompts when a newer one is due |

## Hardware-dependent (needs the Flip 4)

- **Vector tile decoding** runs on the main thread, about 6 ms for the densest Chicago tile on a Mac. It could delay key presses on the phone. Measure with the phone check (key 5) and the Drive Report's key response. Move decoding to a Worker if needed.
- **Memory over a 60–120 minute drive:** 14 decoded tiles are cached, plus the label pool and route geometry. There's no memory API on KaiOS, so watch for crashes or reloads on a long drive.
- **Screen off and flip closed:** covered by the flip test (phone check keys 6 and 7) and [kaios4-platform.md](kaios4-platform.md).

## External dependencies

- **Services:** OSRM demo routing, Nominatim search, and OpenFreeMap tiles. All are best-effort public services with fair-use limits and no guarantees. The time limits above make their outages recoverable, but don't remove them.
- **Map data:** OpenFreeMap publishes new data versions. `hw-baseline-1` records the version in use when it was tagged.

## Not yet tested

- **The app's screen and key logic** (`app.js`): Back during loading, switching routes before the routes load, rapid and duplicate keys, re-entering search and settings. Code reading shows the preview ignores answers for a superseded trip (`trip !== t`). Testing the rest needs a DOM harness for `app.js`, which is the next audit step.
- **Memory growth and cache eviction under 1,000+ tile loads.** This is better measured on the phone.

## Recommendation

1. **Don't merge before Monday.** The matching change affects guidance timing, and Monday's drive should run on the current live build (the baseline plus the OK-key and diagnostics changes) as planned.
2. **After Monday,** merge this branch if the drive shows no conflicting evidence. Then re-run the Drive Report on the new build and compare it with the baseline drive.
3. **Next audit steps:** a DOM harness for `app.js`, then GPS traces recorded on the phone and replayed through the harness. That replaces synthetic noise with real data and is the only way to judge road snapping and parallel roads.
