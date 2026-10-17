# Audit: keys, screens, lifecycle and long drives

This continues [audit-nav-engine.md](audit-nav-engine.md) into the areas it left open:
- **Keys and screen state:** duplicate and held keys, fast presses, Back while something loads, switching routes, Settings during a trip.
- **Lifecycle:** reloads, requests that are cut off or never answered, losing and regaining the connection.
- **Long-drive stability.**

It tests `main` at `614c798` (the live build) and the `audit/nav-engine` fixes. The work is on branch `audit/reliability`, which builds on `audit/nav-engine`. `main`, the live site and `hw-baseline-1` are untouched.

## Method

- **The real app, unchanged, in Firefox 123** at 240×320: Playwright 1.42.1's build of Gecko 123, KaiOS 4.0's engine version. Playwright's build has its own patches, so it's the same engine generation, not KaiOS's exact Gecko.
- **Stand-ins for the phone,** injected before the app's scripts ([page-init.js](../devtools/compat/lib/page-init.js)):
  - GPS that the test drives, with course and speed
  - speech that's recorded and "spoken" at about a real voice's pace, so a queue can build up
  - vibration
  - an optional faster clock for long replays
  - counters for timers, listeners, requests, frames, and the time each GPS fix costs
- **Recorded answers** ([network.js](../devtools/compat/lib/network.js), [fixtures/](../devtools/compat/fixtures)):
  - Routing, search and map data are recorded once and replayed, so third-party changes can't make the same code behave differently on different days.
  - A reroute from an unrecorded position gets the recorded route to the same place, joined from where you are.
  - Faults can be switched on per service: answer late, never answer, fail, or act offline.
- **No service worker in these runs:** Firefox doesn't let Playwright see the requests a service worker makes. Offline caching is left to the phone.
- **Keys** are sent as the phone sends them: OK as `MicrophoneToggle`, soft keys as `SoftLeft`/`SoftRight`, held keys as key-repeat events.
- **Each test states the behavior we want; a failing test is a finding.** Every test ran against `main`'s app and against this branch.
- **Code:** [keys.spec.js](../devtools/compat/keys.spec.js), [lifecycle.spec.js](../devtools/compat/lifecycle.spec.js), [long-drive.spec.js](../devtools/compat/long-drive.spec.js), and the [README](../devtools/compat/README.md) for running them.

## Results

### Summary

22 key, screen and lifecycle tests, plus the long drive:

| | `main` (live) | This branch (with fixes) |
|---|---|---|
| Key and screen tests (12) | 7 pass, **5 fail** | 12 pass |
| Lifecycle tests (10) | 7 pass, **3 fail** | 10 pass |
| Long drive (one test) | See [Long drive](#long-drive) | See [Long drive](#long-drive) |

The 8 failures come from 7 root causes, listed below. The same tests fail on `audit/nav-engine`: none of its fixes cover these.

A review of where the two audits' fixes meet found one more defect: `audit/nav-engine` turns a slow route answer into extra reroutes. It's fixed here; see [Where the two audits meet](#where-the-two-audits-meet).

The [compatibility check](../devtools/compat/check.spec.js) against the live services still passes with the fixes (5 of 5), including the phone check's map-speed test.

### Confirmed defects: 8 failing tests, 7 root causes

| # | What happened (test) | Severity | Root cause | Fixed on branch |
|---|---|---|---|---|
| 1 | **Ending a trip while its reroute loads, then starting another:** the new trip showed "Rerouting" from its first second. On `main`, if the old request hangs, the new trip can't reroute until the browser itself gives up on that request. On `audit/nav-engine` this lasts 12 s, then the old request's "Routing is not answering" appears on the new trip | **High on `main`** (a hung request). Moderate otherwise | One "request in flight" flag for every trip; ending or starting a trip doesn't release it. From the code, arriving during a reroute, or starting a new trip while a saved one resumes, does the same | Yes |
| 2 | **A map download that never answers:** after 2 stalled downloads, 9 of the screen's tiles were still blank 45 s later. They stay blank until the browser itself gives up on the download (in the test, the stall never ends) | **Moderate.** Stalled connections are common on a phone changing cells. Guidance is unaffected | Map-data requests have no time limit, so a stalled one is never given up, retried or cleared. Every tile that needs it waits, and the waiting list keeps growing | Yes: redrawn in ~32 s |
| 3 | **Holding OK on the preview:** the route started, then 8 "In … miles" prompts queued up | Moderate, *if* the Flip 4 repeats held keys (Firefox does) | A held key sends repeated key presses. Each one counts as a new press | Yes |
| 4 | **Holding OK while driving:** 9 prompts queued for one hold | Same | Same | Yes |
| 5 | **Typing a new search while the last one loads:** when the answer arrived, the first result took the focus, and the letters typed after that were lost ("ben hill gr", not "ben hill griff") | Low to moderate | Results always take the focus when they arrive | Yes |
| 6 | **After a reload mid-trip, the Drive Report stopped sampling frames:** fixes kept counting (40 → 110), frames stayed at 712 | Low. **Matters for Monday** if the page reloads mid-drive: the slow-frame numbers would cover only the part before the reload | The frame sampler starts only when a trip starts | Yes |
| 7 | **A trip too old to resume (over 6 h) left the Drive Report saying "(driving)"**, and counting any later use of the app as part of that trip | Low (diagnostics) | Navigation drops the stale trip, but the report isn't told | Yes |
| 8 | **Arriving while Settings is open, then choosing End Route:** "Route Ended" for a trip that had already ended | Low (cosmetic) | The sheet's End Route row is built when it opens | Yes |

### The fixes (branch only, not merged)

- **Route requests belong to their trip** (`nav.js`): each request is numbered. Starting or ending a trip lets any request still out go, so its answer, error or spinner can't reach the next trip.
- **A slow route answer is matched as of when it was asked** (`nav.js`): see [Where the two audits meet](#where-the-two-audits-meet).
- **Map data has a time limit** (`carto.js`, `net.js`):
  - Tiles and the map's data address now give up after 15 s, through the same helper routing and search use (`FM.net.getBytes`, `FM.net.getJSON`).
  - A tile that gives up is retried by the existing rules.
  - `net.js` now loads before the map code, in the app and in the phone check.
- **Held keys** (`app.js`): only moving the map, moving through a list, and typing repeat. OK, the soft keys and Back act once per press.
- **Search** (`search.js`): the first result takes the focus only if the field still holds what was searched.
- **Drive Report** (`report.js`, `app.js`): the frame sampler restarts when the app reopens mid-trip. Opening with no trip to resume closes the report at its last fix.
- **End Route** (`app.js`): does nothing once the trip has already ended.

The Node tests from the first audit still pass with these changes. With the interaction tests below, that's 43 pass, plus 1 recorded as a todo.

### Behavior changes to review before merging

- **Holding a key:** if the Flip 4 repeats held keys, holding OK now does one thing. Holding an arrow still keeps moving, and holding Backspace in the search field still deletes.
- **A slow map tile is abandoned after 15 s and asked for again,** instead of waiting as long as the browser lets it.
- **Search:** if you change the search text before the answer comes back, the results still appear, but the cursor stays in the field.

## Checked, holds (no change needed)

These pass on `main` and on this branch:

| Concern | Result |
|---|---|
| OK arriving as `MicrophoneToggle` and then `Enter` for one press | **Holds.** The route starts once, and the second event is dropped (the `614c798` change) |
| Back while a search loads | **Holds.** The late answer changes nothing, and search works afterwards |
| Choosing a recent place while a search loads | **Holds.** The preview stays on the recent place |
| Back from the preview while its routes load | **Holds.** The late routes aren't drawn |
| Switching routes before and after they load (3 presses before, 5 after), then Go | **Holds.** The route driven is the one chosen |
| Settings during a trip | **Holds.** Voice off silences prompts, and Done goes back to the trip, which carries on following |
| 300 random key presses, starting mid-trip | **Holds.** At every check, one known screen, with the right sheet and soft keys. No script errors |
| Reload mid-trip | **Holds.** It resumes to the same place, says "Resuming route" once, and the distance left is within 150 m |
| Reload after arriving, after End Route, or while previewing | **Holds.** No trip restarts, and nothing stays saved |
| Offline mid-trip, off the route | **Holds.** It says "No connection", then reroutes once back online |
| A reroute answer arriving after End Route | **Holds.** It doesn't restart the trip |
| Phone Check in the middle of a trip, then Back | **Holds.** The trip carries on |

## Where the two audits meet

Before merging, I reviewed where the two audits' fixes interact: request time limits and request numbering (this branch), plausible GPS matching (`audit/nav-engine`), trip identity, and resuming a saved trip. Each fix passed its own tests; [tests/interactions.test.js](../tests/interactions.test.js) checks them together, in the Node harness, against all three versions:

| Scenario | `main` | `audit/nav-engine` | This branch |
|---|---|---|---|
| A saved trip takes 10 s to resume while you drive on at 30 m/s | Pass | **Fail:** 3 extra reroutes | Pass |
| A reroute takes 10 s to answer while you drive the new way | Pass | **Fail:** 2 extra reroutes | Pass |
| A route request times out, and the retry answers in 8 s while you drive on | **Fail:** the hung request is never retried | Pass | Pass |
| A stray fix by the destination right after a slow resume | **Fail:** false arrival | Pass | Pass |
| Arriving while a reroute loads; its answer comes after | Pass | Pass | Pass |
| Starting a new trip while a saved trip resumes | **Fail:** "Rerouting" on the new trip | **Fail:** same | Pass |
| A reroute answered just before you reach the destination | Pass | Pass | Pass |

`main`'s three failures are defects the audits already fixed. The new finding is the first two rows, an interaction defect in `audit/nav-engine`:

- **What happens:** a route answer that arrives after a few seconds is matched at the position it was asked from, but timed as if it were taken when the answer arrived. Plausible matching then measures how far you could have driven from the wrong moment. The next fixes, already a few hundred meters on, look implausible and count as off the route.
- **What follows:** at highway speed, an answer taking 7 s or more brings a needless reroute. Its answer is just as slow, so it repeats. Guidance stands still meanwhile.
- **How likely:** OSRM usually answers in under 2 s, but slower answers happen on a weak signal. That's exactly when a phone is resuming a trip or rerouting. `main` doesn't have this, because it matches against the whole route.
- **Fix (`nav.js`, this branch):** a route answer is matched as of when it was asked for, so the plausible window grows by the time the answer took. The stray-fix protection still holds: row 4 passes.

**Checked by reading, and holding:**
- **OK key:** the duplicate-OK filter runs before the held-key filter, so a held `MicrophoneToggle` acts once.
- **Search:** the result-focus rule only ever sees the latest search's answer.
- **Time limits:** map data and routing use the same time-limit helper, with separate timers.
- **Drive Report:** a trip still waiting to resume counts as a trip, so reopening mid-trip keeps its report.

**Noted, not changed:** after a slow reroute, the first spoken distance ("In half a mile…") is measured from where the reroute was asked. It's off by the distance driven while waiting, and the banner corrects itself on the next fix. `main` does the same.

## Long drive

**The drive:** Gainesville to the Jacksonville Zoo, 77 miles. OSRM's estimate is 102 minutes, and the replay is 103 minutes of driving. It covers Gainesville streets, SR 24, US 301, I-10 and I-95 into Jacksonville. The GPS is second by second, from [drive.js](../devtools/compat/lib/drive.js):
- Each stretch at its own pace, slowing for turns, with a stop at a light.
- Course and speed with every fix, so the map turns with the road the whole way.
- Drifting error of about ±4 m, worsening to ±12–15 m with poor reported accuracy for the last 2.5 km.

**Scripted trouble:**

| When | What |
|---|---|
| 15, 46 and 76 min | A stray fix 180 m off the road |
| 22 min | A wrong turn: 25 s away from the route, 25 s back. The first reroute request gets a server error |
| 31 min, 61 min | No signal for 30 s, then 45 s |
| 36 min | Offline for 2.5 minutes |
| 51 min | Map tiles take 4 s each for 5 minutes |
| Every 5 to 10 min | Keys: Repeat, Overview and back, and Settings opened once |

**Runs**, all on this branch's app and on recorded answers:
- **Firefox 123 in real time:** 103 minutes of wall-clock time, the main result
- Firefox 123 at 16× speed (page clock and timers sped up; frames and drawing in real time)
- Chromium 123 at 8×, for the JavaScript heap
- `main`'s app in Firefox at 16×, for comparison

| Measure (5-minute buckets, 5 min → end) | Firefox 123, real time | Firefox 123, 16× | Chromium 123, 8× |
|---|---|---|---|
| Arrival | Announced once, at the zoo | Same | Same |
| Reroutes | 3, all at the wrong turn (mile 14.6): one hit the server error, then two more as the car kept going, 128 m and 257 m out. None from the stray fixes, gaps or offline stretch | Same | Same |
| Voice prompts | 47 | 47 | 47 |
| Script errors | None | None | None |
| Page elements (outside the sheets) | 144 → 147 | 144 → 147 | flat\* |
| Event listeners | 21 → 21 | 21 → 21 | 21 → 21 |
| Repeating timers / pending timers | 3 / 0–1 the whole way | Same | Same |
| JS heap after garbage collection | (Firefox can't read it) | (Firefox can't read it) | 3–13 MB, no trend; 7.8 MB at the end |
| GPS fix: work per fix, average per bucket | 1.2–2.1 ms; worst single fix 29 ms (5 min in, Gainesville) | 1.0–1.8 ms; worst 22 ms | 1.1–1.7 ms; worst 8 ms |
| Frames over 50 ms | **0 of 743,523**; worst 42 ms | 0 of 46,434; worst 33 ms | 0 of 92,948; worst 42 ms |
| Key press to the screen updating (43 presses) | median 14 ms, slowest 17 ms | median 14 ms, slowest 22 ms | median 13 ms, slowest 17 ms |
| Whole browser's memory (all processes) | **826 MB → 832 MB**, between 797 and 884 the whole way, no trend | 802 MB → 884 MB; peak 949 MB | 572 MB → 666 MB |

\* The Chromium run also counted the sheets' contents. Its count rose once, by about 60, when Settings was first built at 41 minutes, and stayed there.

After the slow-answer fix ([Where the two audits meet](#where-the-two-audits-meet)), the drive was run again at 16× with the same results: arrived once, 3 reroutes, 47 prompts, no errors, nothing growing.

`main` in Firefox drove the same way: arrived once, 3 reroutes, 47 prompts, flat listeners and timers, 0.9–1.9 ms per fix. The long drive doesn't trip over the defects above, because nothing in it hangs or reloads.

**What it shows:**
- **No leaks:** over 103 minutes, the app grew nothing it keeps. Page elements, labels, timers and listeners stayed flat, and so did the JS heap in Chromium. In real time, so did the whole browser's memory.
- **No slowdown:** work per fix, frame pacing and key response were the same at the end as in the first 5 minutes. They rose a little where the map is densest (Gainesville at the start, Jacksonville at the end), and that's map content, not time.
- **Guidance held:** through the stray fixes, the gaps, the offline stretch and the slow tiles, it gave no false reroutes, no early arrival and no stuck "Rerouting".

**What it doesn't show:**
- **The phone's memory limit:** in real time the browser's memory was flat. The sped-up runs rose 80–100 MB with no JS or page growth behind them: the browser's own caches under the sped-up workload. The phone's limit is unknown, so on Monday's drive, watch for the page reloading by itself.
- **Phone timings:** desktop timings are a lower bound. The phone check's map speed (key 5) gives the phone's multiple. At 10× slower, a fix's work would be 12–21 ms, with the worst moments near 300 ms.

## What this can't show

- **The phone itself:** its speed, its memory limit, real GPS, audible voice, and the flip closed. Desktop timings show trends, not phone numbers. Monday's phone check (key 5) sets the scale.
- **Held keys:** whether the Flip 4 repeats them, and whether OK arrives once or twice.
- **The service worker and offline map cache:** Firefox doesn't let the test see the service worker's requests, so these ran without it.
- **Real roads:** GPS error here is synthetic. Parallel roads and real drift need traces recorded on the phone.

## Recommendation

1. **Keep Monday's plan:** drive the live build (`main`) as planned.
   - Only defect 6 touches Monday's measurements: if the page reloads mid-drive, the Drive Report's frame numbers stop at the reload. The fix is small and diagnostic-only.
2. **After Monday,** merge this branch, not `audit/nav-engine` on its own: that one carries the slow-answer interaction defect, which only this branch fixes. This branch contains `audit/nav-engine`, so one merge brings both sets of fixes.
   - Then re-run `npm run audit` and `npm run check`, and compare a Drive Report from the new build with Monday's.
3. **Then:** replay GPS traces recorded on the phone through the long-drive harness, in place of the synthetic drive. Settle offline caching on the phone itself.
