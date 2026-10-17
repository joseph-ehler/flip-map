# KaiOS 4 on the TCL Flip 4 5G: what an installed app can do that a browser tab can't

Research for Flip Map, written 2026-10-16 while development is frozen at `hw-baseline-1`. It is read-only: nothing in `app/` was changed.

**Device:** TCL Flip 4 5G (also sold as "Go Flip 4 5G"), model T440W, KaiOS 4.0 on an Android 14 base, build `gflip5gtmo … user/test-keys`.

## How to read this

Each answer gives what was found, a confidence level, the sources, and the exact device test that would settle it. Confidence levels:

- **Confirmed in source.** Read in KaiOS's public source: `kaiostech/gecko-b2g` branch `gonk` at [`5e53066`](https://github.com/kaiostech/gecko-b2g/tree/5e5306693a90c9fc6c9b4a6e12cebb64d9e9a20c) (Aug 2024, `config/milestone.txt` = 123) and `kaiostech/api-daemon` at [`a3e068f`](https://github.com/kaiostech/api-daemon/tree/a3e068fb58aaa785c10a6c72e25731ccb76ebd41). kaios.dev reports that KaiOS 4.0 is "Upgraded to Gecko 123 engine", which matches. Caveats: the shipping build may carry later or closed patches, and the **system app (Gaia) is closed source**. That app sets policy for screen-off, audio competition and app visibility, so "confirmed in source" covers the mechanism, not always the policy.
- **Documented.** KaiOS developer docs (developer.kaiostech.com, SFP 3.0/4.0, marked unmaintained) or manufacturer material.
- **Community report.** kaios.dev, BananaHackers, GitHub write-ups.
- **Unknown.** No evidence either way. The reason is given.

Short source links below use these bases:
`G` = `https://github.com/kaiostech/gecko-b2g/blob/5e5306693a90c9fc6c9b4a6e12cebb64d9e9a20c`,
`A` = `https://github.com/kaiostech/api-daemon/blob/a3e068fb58aaa785c10a6c72e25731ccb76ebd41`.

---

## The findings that matter most

1. **A hidden page never gets `watchPosition` fixes on KaiOS 4. This is true in a browser tab and in an installed app.** Gecko 123 drops position updates for any hidden document. Firefox 84 (KaiOS 3.x) did not. If closing the flip hides the page, Monday's "GPS fixes while off" will read 0 by design. That proves the page was *hidden*, not necessarily that it was *suspended*, and an installed app wouldn't change it. The README's line "That is a limit of the browser tab, not necessarily of an installed KaiOS app" is therefore probably wrong for GPS.
2. **The source has an untested way around it, and it works in a tab too.** Hold `navigator.b2g.requestWakeLock('gps')`, which keeps the GPS running while hidden. Hold `'cpu'` as well, which keeps the process at a protected priority. Then poll `getCurrentPosition({maximumAge})` once a second while hidden. The cached-position path has no visibility check. See [§1](#1-running-with-the-screen-off-or-flip-closed).
3. **Wake locks need no permission and no install.** `navigator.b2g.requestWakeLock(topic)` is exposed to every page, browser tabs included, and accepts any topic. The W3C `navigator.wakeLock` is gated on a nightly-only pref and is probably absent.
4. **Background voice is where installing really helps.** An installed app, even an installed PWA, may play `<audio>`/Web Audio on the `content` channel, which keeps playing when the app is in the background. A tab can't. `speechSynthesis` is hard-wired to the default `normal` channel, so it can't be moved to `content`. A robust background voice probably means pre-rendered audio clips played on the `content` channel.
5. **The features that look exciting are core-only.** Flip state (`flip`), brightness and outer-screen control (`power`), and pushing text to a car stereo's display (`bluetooth-privileged`) all need a **core** app. KaiOS says core is for OEM system apps. The public source honors `"core": true` in a sideloaded manifest without a signature check, but sideloading itself needs `adb root`, and the stock T440W refuses that (`ro.debuggable=0`).
6. **Media Session does nothing on this OS.** `navigator.mediaSession` exists, but Gonk's media-key bridge is an unimplemented stub, so nothing reaches Bluetooth AVRCP. Car stereo *buttons* do reach apps, as a `media-button` system message that needs no permission.
7. **The realistic install path is the KaiStore "Test Device" (by IMEI) route, not appscmd.** appscmd needs root, and the remote debugger is blocked by SELinux on this phone.

---

## 1. Running with the screen off or flip closed

### Wake locks

**What I found**

- `navigator.b2g.requestWakeLock(topic)` exists in KaiOS 3/4 and returns a lock object with `topic` and `unlock()`. There are also `navigator.b2g.getWakeLockState(topic)`, which returns `"unlocked"`, `"locked-foreground"` or `"locked-background"`, and `add/removeWakeLockListener`. The pref `dom.wakelock.enabled` is `true` on B2G. The KaiOS 2.5 `navigator.requestWakeLock` is gone. **Confirmed in source.**
- **No permission or app type is required.** `B2G::RequestWakeLock` performs no permission check and accepts any topic string. The only gate, `HasWakeLockSupport`, checks that the power service exists. `navigator.b2g` is exposed to every window through `Navigator includes NavigatorB2G` with no condition, so browser tabs have it too. **Confirmed in source.**
- W3C `navigator.wakeLock` (Screen Wake Lock) is gated on `dom.screenwakelock.enabled`, which defaults to `@IS_NIGHTLY_BUILD@` in Gecko 123, and B2G doesn't override it. It's probably absent on a release build. **Confirmed in source (default); device unknown.** The app already falls back to `navigator.b2g.requestWakeLock('screen')`, which is the right order.
- Which topics do something:

| Topic | Who acts on it | Effect | Confidence |
|---|---|---|---|
| `screen` | The closed system app (reads lock state through wake-lock listeners) | Keeps the display on. The IDL comment warns the manager "might decide to ignore 'screen' wake locks held by pages which are not visible." Whether closing the flip turns the inner screen off anyway is system-app policy | Mechanism confirmed in source; policy unknown |
| `cpu` | Gecko's `ProcessPriorityManager`, plus the system app, which drives the power service's `cpuSleepAllowed` | The holding process is raised to `BACKGROUND_PERCEIVABLE` (OOM adj 400, `bg_perceivable` cgroup, 2× the CPU share of plain background). Gecko's own alarm, FM radio, system-message and audio code take `cpu` locks to stay awake | Priority confirmed in source; CPU-sleep policy belongs to the closed system app |
| `gps` | Gecko geolocation | **Keeps the GPS device running for a hidden page.** It doesn't deliver callbacks (see below) | Confirmed in source |
| `high-priority` | `ProcessPriorityManager` | Same as `cpu` for priority | Confirmed in source |
| `audio-playing` | `ProcessPriorityManager` | Holding it makes the process **FOREGROUND** priority. Media elements normally take it themselves. Because `requestWakeLock` accepts any topic, a page could request it directly. That's a hack; test before relying on it | Confirmed in source |
| `wifi` | Nothing in Gecko (Wi-Fi code takes `cpu` locks internally) | Possibly ignored | Unknown |

### Does geolocation keep delivering fixes to a hidden app?

**What I found**

- **No, not through `watchPosition` callbacks.** In Gecko 123, `Geolocation::Update` returns early when `document->Hidden()` and holds pending callbacks "waiting for the next update". Every fix reaches the page through this function (`ContentChild::RecvGeolocationUpdate` → `nsGeolocationService::Update` → each `Geolocation::Update`). Firefox 84, the base of KaiOS 3.0/3.1, has no such check, so this is new in KaiOS 4. It applies to every content document, app or tab. **Confirmed in source** (gecko-b2g and upstream Firefox 84 vs 123).
- **What the `gps` lock adds:** `nsGeolocationService::HasActiveLocator()` keeps the device alive for a locator that is visible **or** whose process holds a `gps` wake lock. Without the lock, the service stops the GPS within `geo.timeout` (6 s) of hiding, and restarts it on `visibilitychange` back to visible. With it, the GPS keeps running and `nsGeolocationService::Update` keeps refreshing the cached position (`SetCachedPosition`) while the page is hidden. **Confirmed in source.**
- **The likely workaround:** `getCurrentPosition` with `maximumAge > 0` is answered from that cache through `nsGeolocationRequest::Allow` → `nsGeolocationRequest::Update` → `SendLocation`, and **none of those check visibility**. They only check `IsFullyActive`, which concerns navigation and bfcache, not visibility. So a hidden page holding `gps` (to keep the cache fresh) and `cpu` (to keep its timers running) could poll `getCurrentPosition({maximumAge: 2000, enableHighAccuracy: true})` every second and keep navigating. **Confirmed in source as a code path; not tried on a device.** Risks:
  - It assumes the stored geolocation permission is a real "allow". A "this time only" grant might re-prompt invisibly.
  - It assumes the system app honors `cpu` with the screen off.
  - Hidden timers run at most once per second, with a small CPU budget after 30 s (`dom.min_background_timeout_value` 1000, budget throttling on). That's enough for a 1 Hz poll.
- **Is the page hidden when the flip closes?** On screen-off, Gonk sends every top window a "minimized" size mode (`ScreenHelperGonk.cpp`), and `shell.js` responds by setting the system app's `docShellIsActive = false`. Each app lives in a `<web-view>` (a remote `xul:browser`) whose `active` flag sets the app's `docShellIsActive`, and therefore `document.hidden`. The closed system app toggles that flag. Firefox OS hid the foreground app on screen-off, and a gecko-b2g comment says web content "should be paused when this browser tab has sent back to background or phone has flip closed". **Mechanism confirmed in source; whether a foreground app goes hidden on flip close is unknown until the device test.** The drive report's "Screen off" figure measures this directly.

### Service workers, alarms and system messages

**What I found**

- **Service workers can't navigate.** There is no geolocation in workers (`WorkerNavigator` has none) and no `speechSynthesis` either. A worker woken by an event runs for 30 s (`dom.serviceWorkers.idle_timeout`), which `waitUntil` can stretch to 5 min on B2G (`idle_extended_timeout` 300000). **Confirmed in source.**
- **Alarms:** `navigator.b2g.alarmManager.add({date, ignoreTimezone, data})` needs the `alarms` permission (granted to PWA and signed apps). The alarm arrives as an `alarm` system message to the app's service worker, and `AlarmService` holds a `cpu` lock while dispatching. kaios.dev found alarms "unreliable when setting intervals". They're good for "wake me at a time", useless for 1 Hz navigation. **Confirmed in source; reliability is a community report.**
- **System messages:** subscribe in the manifest (`b2g_features.messages`) or through `registration.systemMessageManager.subscribe(name)`, and they arrive as `systemmessage` events in the service worker. No message carries location. The useful one is `media-button`, covered in [§6](#6-car-integration-media-session-and-bluetooth). **Confirmed in source.**

**Sources:** `G/dom/webidl/B2G.webidl#L216-L267` · `G/dom/b2g/B2G.cpp#L886-L911` · `G/dom/webidl/Navigator.webidl#L310-L314` · `G/dom/webidl/WakeLock.webidl` + `G/modules/libpref/init/StaticPrefList.yaml#L3643-L3646` · `G/dom/power/WakeLock.cpp` · `G/dom/ipc/ProcessPriorityManager.cpp#L761-L780` · `G/b2g/app/b2g.js#L627-L685` (priorities), `#L959`, `#L1001` · `G/dom/geolocation/Geolocation.cpp#L259-L296` (cached path), `#L417-L421`, `#L752-L770` (`gps` lock), `#L943-L957`, `#L1029-L1045` (hidden check) · upstream [Firefox 84 Geolocation.cpp](https://github.com/mozilla-firefox/firefox/blob/FIREFOX_84_0_RELEASE/dom/geolocation/Geolocation.cpp) (no hidden check) · `G/widget/gonk/ScreenHelperGonk.cpp#L67-L92` · `G/b2g/chrome/content/shell.js#L216-L224` · `G/b2g/chrome/content/embedding/web-view.js#L788-L817` · `G/dom/b2g/messages/README.md` · `G/dom/b2g/alarm/AlarmService.sys.mjs#L279` · [kaios.dev: Running in the Background on KaiOS](https://kaios.dev/2023/10/running-in-the-background-on-kaios/) · [kaios.dev: What's coming in KaiOS 4.0](https://kaios.dev/2024/12/whats-coming-in-kaios-4.0/)

**Exactly what to test on the device** (the snippets are in the [test plan](#device-test-plan); run them from any page, since no install is needed):

1. Is `navigator.wakeLock` present? Do `navigator.b2g.requestWakeLock('gps')` and `('cpu')` return objects? With the flip closed, does `getWakeLockState('gps')` read `locked-background`?
2. With `watchPosition` running and `gps`+`cpu` held, close the flip for 2 minutes while driving. Count: hidden timer ticks (the CPU stayed awake), `watchPosition` callbacks while hidden (expected 0), and cached `getCurrentPosition` fixes while hidden (the workaround). Also check whether the cached fixes' timestamps advance.
3. Repeat without the `gps` lock. Fixes while hidden should drop to 0, and the first fix after reopening should take longer.
4. With the `screen` lock held, does closing the flip still turn the inner screen off and make `document.hidden` true?

---

## 2. Voice in the background

### Do audio channels apply to `speechSynthesis`?

**What I found**

- **Not selectably.** `nsSpeechTask` creates its audio-channel agent with `AudioChannelService::GetDefaultAudioChannel()`, which reads the pref `media.defaultAudioChannel` and falls back to `normal`. There is no per-utterance or per-app setting. Its output track is also created as `AudioChannel::Normal`. **Confirmed in source.**
- Channels *are* selectable for `<audio>`/`<video>` (`mozAudioChannelType`, pref `media.useAudioChannelAPI` = true on B2G), for Web Audio (`new AudioContext({audioChannel: 'content'})`), and through KaiOS's `new AudioChannelClient(channel)`. Any channel other than `normal` needs the matching `audio-channel-*` permission. Without it, the media element silently stays on `normal`, and `AudioChannelClient` throws. **Confirmed in source.**
- Permissions by app type (from the permission table): `normal` and `content` → PWA and signed; `notification`, `alarm`, `system` → signed; `telephony`, `ringer`, `publicnotification` → core. A **browser tab has no manifest, so it gets none of them** and is stuck on `normal`. **Confirmed in source; matches the KaiOS docs.**
- Every channel agent starts **muted** (`dom.audiochannel.mutedByDefault` = true) until the system app's audio policy un-mutes it. That policy is closed source. Firefox OS's policy, which kaios.dev describes for KaiOS, was: `content` keeps playing in the background, `normal` doesn't, and `notification` interrupts `content`. **Mechanism confirmed in source; policy is a community report.**
- A gecko-b2g comment in `shell.js` (citing "bug 4657") says web-site media "should be paused when this browser tab has sent back to background or phone has flip closed". That suggests tabs are deliberately silenced. **Documented in a source comment.**

### Flip closed, over other music, and Bluetooth

**What I found**

- **Flip closed:** an installed app playing on `content` should keep playing, exactly as a music app does when you press Back. `speechSynthesis` (`normal`) in a hidden page is **probably muted**, because the closed policy decides. A tab is probably paused. **Community report / unknown.** The report counts an utterance's `onend` as "finished" even if it was muted, so only a listener can confirm this.
- **Over other music (ducking):** kaios.dev says `content` playback "will still get paused via the 'notification'" channel, which is pause-and-resume, not ducking. Two apps on `content` compete, and normally the foreground one wins. Whether KaiOS 4 ducks at all is **unknown** (closed policy).
- **Bluetooth:** Gonk maps `normal` and `content` to Android's `AUDIO_STREAM_MUSIC`, which Android's audio policy routes to A2DP when a Bluetooth audio device is connected. `notification` maps to `AUDIO_STREAM_NOTIFICATION`, which Android may also play on the phone speaker. Stream mapping **confirmed in source**; actual routing on this phone **unknown**.

### Voices and engine

**What I found**

- Gecko's only TTS engine on Gonk is **SVOX Pico** (`synth/moz.build` builds `pico` for `gonk`). It loads voice files from **`/system/tts/lang_pico`** and registers each language as a local voice named `"Pico <lang>"`. **Confirmed in source.**
- KaiOS's Pico fork ships lingware for **en-US, en-GB, de-DE, es-ES, fr-FR, it-IT** (the stock SVOX set). There is no Spanish (US), Portuguese or Hindi. **Confirmed in source** (kaiostech/platform_external_svox). Whether TCL put these files on the T440W is **unknown**. The phone check's voice row answers it.
- Pico produces 16 kHz mono, clear but robotic. There's no second engine unless TCL added a closed one. **Unknown.**

### Speech recognition and assistant (voice destination entry)

**What I found**

- `SpeechRecognition` is compiled in and its pref is on, with a default service called `"adaptor"` that isn't in the public tree. But the constructor is only exposed to principals holding the **`speech-recognition` permission, which is not in the KaiOS permission table**, so no app manifest (PWA, signed or core) can request it. **Confirmed in source.**
- kaios.dev reports that KaiOS 4.0 has "no system-wide speech-to-text": `voice-input.enabled` is false and no preinstalled app handles the `voice-input` activity. The Google Assistant of KaiOS 2.5 devices isn't there. **Community report.**
- **What remains:** record with `getUserMedia({audio:true})` + `MediaRecorder` (`audio-capture` prompts the user for PWA and signed apps; tabs use the normal browser prompt), then send the audio to a server speech-to-text service. **Inference from source; the cost and privacy trade-off is a product decision.**

**Sources:** `G/dom/media/webspeech/synth/nsSpeechTask.cpp#L136-L145`, `#L465-L487` · `G/dom/audiochannel/AudioChannelService.cpp#L776-L790` · `G/dom/audiochannel/AudioChannelClient.cpp` · `G/dom/html/HTMLMediaElement.cpp#L4879-L4905` · `G/dom/webidl/HTMLMediaElement.webidl#L143-L156` · `G/dom/webidl/AudioContext.webidl#L13-L31` · `G/b2g/components/PermissionsTable.sys.mjs#L51-L90` · `G/b2g/app/b2g.js#L840`, `#L909-L912`, `#L1034`, `#L1103` · `G/dom/system/gonk/AudioManager.cpp#L144-L152` · `G/dom/media/webspeech/synth/moz.build#L52-L53` · `G/dom/media/webspeech/synth/pico/nsPicoService.cpp#L56` · [kaiostech/platform_external_svox `pico/lang`](https://github.com/kaiostech/platform_external_svox/tree/HEAD/pico/lang) · `G/dom/media/webspeech/recognition/SpeechRecognition.cpp#L194-L218` · [kaios.dev: Audio and Volume Control](https://kaios.dev/2023/03/audio-and-volume-control-in-kaios/) · [kaios.dev: TCL Go Flip 4 5G and KaiOS 4.0](https://kaios.dev/2026/03/a-closer-look-at-the-tcl-go-flip-4-5g-and-kaios-4.0/) (Voice Input section) · [KaiOS docs: App Permissions (SFP 4.0)](https://developer.kaiostech.com/docs/sfp-4.0/core-developer-topics/permissions)

**Exactly what to test on the device**

1. `speechSynthesis.getVoices()`: record each `name`, `lang` and `localService`. Expect `Pico en-US` and similar, or nothing.
2. Speak an utterance 20 s after closing the flip. Have a person listen and note whether it was heard. Repeat with music playing in the KaiOS Music app, and again with a Bluetooth car or headset connected.
3. In a tab, play a short Web Audio tone (normal channel) 20 s after closing the flip. Was it heard?
4. Once an installed build exists, repeat 2 and 3 with `new AudioContext({audioChannel: 'content'})` or `<audio mozAudioChannelType="content">`.
5. Check that `typeof SpeechRecognition` and `typeof webkitSpeechRecognition` are both `undefined` (they should be).

---

## 3. Flip state

**What I found**

- KaiOS 2.5's `navigator.mozFlipManager` became **`navigator.b2g.getFlipManager()`**. It returns a `Promise<FlipManager>`, where `FlipManager` is an `EventTarget` with `flipOpened` (boolean) and `onflipchange`. It's backed by the HAL flip observer, and `dom.flip.enabled` is true on B2G. **Confirmed in source.**
- **Who may use it:** `B2G::GetFlipManager` throws `SecurityError` unless the caller holds the **`flip`** permission, and the permission table grants `flip` to **core apps only** (`pwa: DENY, signed: DENY, core: ALLOW`). Because the method returns a promise, the error arrives as a rejection. **Confirmed in source.**
- **What a non-core page can observe instead:** `visibilitychange`/`document.hidden`, if the system app hides the foreground app on flip close ([§1](#1-running-with-the-screen-off-or-flip-closed)). Possibly also key events; no flip key was found in source. **Unknown.**

**Sources:** `G/dom/webidl/FlipManager.webidl` · `G/dom/webidl/B2G.webidl#L44-L48` · `G/dom/b2g/B2G.cpp#L335-L358` · `G/dom/b2g/flipmanager/FlipManager.cpp#L30-L50` · `G/b2g/components/PermissionsTable.sys.mjs#L224-L227` · `G/b2g/app/b2g.js#L1043-L1044`

**Exactly what to test on the device**

1. `navigator.b2g.getFlipManager().then(m => m.flipOpened, e => e.name)`. Expect `SecurityError` from a tab or a non-core app.
2. Log `keydown`/`keyup` `e.key` while closing and opening the flip, and log `visibilitychange` with timestamps.

---

## 4. Outer (cover) screen

**What I found**

- When a second display connects, Gecko opens a separate top-level chrome window on it (`MultiscreenHandler`, with `b2g.multiscreen.enabled` true). That window's shell (`shell_remote.js`) loads **only the system app's own page**, `chrome://system/content/index_remote.html`. There is no hook for third-party content, and nothing in Gecko's WebIDL lets an app draw on or target another display. **Confirmed in source.** (The latest gonk commit, "Fix sub panel can not display boot animation", refers to this outer "sub panel".)
- The only programmatic controls are `extScreenEnabled` and `extScreenBrightness` on the api-daemon **PowerManager** service, gated by **`power`, which is core-only**. **Confirmed in source.**
- **What shows there today:** TCL says the 1.77″ external display is for notifications and caller ID ("Check your notifications or see who is calling", and "for easy-to-read notifications"). **Documented.** Whether a third-party app's `Notification` title or body appears there is **unknown**, because the closed system app decides. If it does, turn instructions on the cover screen become possible with no special permission. `desktop-notification` prompts for PWAs and is allowed by default for signed apps.

**Sources:** `G/b2g/components/MultiscreenHandler.sys.mjs` · `G/b2g/chrome/content/shell_remote.js` · `G/b2g/app/b2g.js#L1055-L1058` · `A/services/powermanager/src/powermanager.sidl#L25-L62` · `G/b2g/components/PermissionsTable.sys.mjs#L134-L141` · [TCL FLIP 4 5G product page](https://us.tcl.com/products/flip-4-5g) · [gecko-b2g commit log](https://github.com/kaiostech/gecko-b2g/commits/gonk)

**Exactly what to test on the device**

1. Note what the outer screen shows at rest, during a call, with music playing, and after an SMS arrives.
2. From a page, post `new Notification('Flip Map', {body: 'In 500 ft, turn right onto Main St', tag: 'turn'})` 15 s after closing the flip. Does the outer screen show the title, the body, or only an icon? Post again with the same `tag`: does it replace the old one or stack?
3. Try the `show-toast` activity, which kaios.dev says any app or site can use, with the flip closed.

---

## 5. Screen brightness

**What I found**

- KaiOS 3/4 moved `navigator.mozPower` into the api-daemon **PowerManager** service. It has `screenBrightness` (0–100), `extScreenBrightness`, `keyLightBrightness`, `screenEnabled`, `extScreenEnabled`, `cpuSleepAllowed` and `control_screen({state, brightness, isExternal})`. Pages reach it through the shared client libraries (`http://shared.localhost/...`, which the packaged-app CSP allowlists) and a session token from `navigator.b2g.externalapi.getToken()`. The service is declared **`#[permission=power]`**, and `power` is **core-only**. **Confirmed in source; the API change is documented.**
- There is no web-standard brightness API in Gecko. A non-core app can only open the Settings app's display page with a `configure` WebActivity and choose its own colors (the app already has day and night styles). **Confirmed in source.** The exact Settings section name for display is **unknown**; `section: "volume"` and `"developer"` are documented.

**Sources:** `A/services/powermanager/src/powermanager.sidl` · `A/services/powermanager/client/test/tests.html` · `A/daemon/config-device.toml#L16` (CSP) · `G/dom/webidl/ExternalAPI.webidl` · `G/b2g/components/PermissionsTable.sys.mjs#L267-L270` · [KaiOS docs: API Changes (SFP 4.0)](https://developer.kaiostech.com/docs/sfp-4.0/api/api-change)

**Exactly what to test on the device:** nothing is needed for the non-core answer. To find a deep link, try `new WebActivity('configure', {target: 'device', section: 'display'}).start()` and see which Settings page opens.

---

## 6. Car integration: Media Session and Bluetooth

**What I found**

- `navigator.mediaSession` (metadata, action handlers, playback state) is exposed with no pref in Gecko 123. **Confirmed in source.**
- **It isn't connected to anything on Gonk.** Gecko forwards Media Session state to the OS through `widget::CreateMediaControlKeySource()`, and the Gonk version is `// TODO : implement support. return nullptr;`. So metadata never leaves Gecko, and OS media keys never reach a page's action handlers. **Confirmed in source.**
- **AVRCP metadata (text on the car stereo):** the B2G route is `navigator.b2g.bluetooth.defaultAdapter.sendMediaMetaData({title, artist, …})` / `sendMediaPlayStatus()` (AVRCP 1.3). Both are gated by `bluetooth-privileged`, which is **core-only**. With core access, the "track title" on a car display could read "Turn right onto Main St in 500 ft". **Confirmed in source.**
- **Car and headset buttons:** `BluetoothAvrcpManager` broadcasts AVRCP pass-through presses as the **`media-button` system message** (values such as `media-play-pause-button-press` and `media-next-track-button-press`), and that message **needs no permission**. An installed app with a service worker can subscribe and, for example, map Play/Pause to "repeat the last instruction". kaios.dev warns the preinstalled Music and FM apps also react to these keys. **Confirmed in source; the conflict is a community report.** Foreground pages also get `MediaPlayPause` and similar as key events. **Community report.**

**Sources:** `G/dom/webidl/MediaSession.webidl` · `G/dom/webidl/Navigator.webidl#L345-L350` · `G/widget/gonk/MediaKeysEventSourceFactory.cpp#L10-L13` · `G/dom/media/mediacontrol/MediaControlKeyManager.cpp#L81` · `G/dom/webidl/BluetoothAdapter.webidl#L215-L219` · `G/dom/b2g/bluetooth/common/webapi/BluetoothManager.cpp#L189-L199` · `G/dom/b2g/bluetooth/bluedroid/BluetoothAvrcpManager.cpp#L538-L570`, `#L893-L896` · `G/dom/b2g/messages/SystemMessageService.cpp#L83` · [kaios.dev: Audio and Volume Control](https://kaios.dev/2023/03/audio-and-volume-control-in-kaios/) (Key Events)

**Exactly what to test on the device:** with a Bluetooth car or headset connected, set `navigator.mediaSession.metadata = new MediaMetadata({title: 'Flip Map test'})` while playing audio. Expect nothing on the stereo display. Then press the stereo's play, next and previous buttons while a page logs `keydown` `e.key`, and note which keys arrive in the foreground.

---

## 7. Installing a packaged app on KaiOS 4

### App types: hosted vs packaged vs privileged

| KaiOS 2.5 name | KaiOS 3/4 name | Where the code lives | Origin | How Gecko classifies it | Extra permissions over a plain web page |
|---|---|---|---|---|---|
| (none) | **Browser tab** | Remote website | `https://…` | No app, no manifest permissions | None, but `navigator.b2g` (wake locks, alarm manager object) is still exposed |
| hosted / web | **PWA** (hosted) | Remote; only the manifest is installed | `https://…` | `pwa` | `audio-channel-content`, `alarms`, `geolocation` (prompt), `desktop-notification` (prompt), `audio-capture` (prompt) |
| privileged | **Signed** (packaged) | ZIP served locally by api-daemon | `http://<origin>.localhost` | `signed` (any manifest URL on `*.localhost`) | Plus `audio-channel-notification/alarm/system`, `systemXHR`, `tcp-socket`, `bluetooth`, `speaker-control`, `volumemanager`, `desktop-notification` allowed by default, special keys you can `preventDefault` |
| certified | **Signed + `"core": true`** | Same | Same | `signed` + core | Plus `flip`, `power`, `bluetooth-privileged`, `settings`, `webapps-manage`, `permissions`… KaiOS docs: "System apps and services only; not intended for third-party applications" |

- Gecko decides `signed` purely by the manifest host ending in `.localhost`, and decides core purely by `b2g_features.core === true`. **Confirmed in source** (`PermissionsInstaller`). The signature check lives in api-daemon. Store downloads are verified against the production certificate (`verify_zip` with `cert_type = "production"`). **The appscmd sideload path (`install_package`) runs no signature check in the public source.** So a sideloaded `"core": true` app would get core permissions, *if* you can sideload. **Confirmed in public source (2023); the shipping api-daemon is unknown.**
- Packaged apps get api-daemon's single CSP: `default-src * data: blob:; script-src 'self' http://127.0.0.1 http://shared.localhost; object-src 'none'; style-src 'self' 'unsafe-inline' http://shared.localhost`. That means no inline scripts, no `eval` and no WebAssembly. `fetch` to any host is allowed by CSP (CORS still applies unless the app is signed and uses `systemXHR`). **Confirmed in source and community report.** This matches the earlier audit.
- Note: Flip Map's current `app/manifest.webmanifest` already says `"core": true`, as KaiOS's own sample manifest does. That's harmless for a sideload test, but a KaiStore submission would presumably need it removed. **Inference.**

### Manifest format (KaiOS 3/4)

`manifest.webmanifest` (W3C fields) plus a required default-language file such as `manifest.en-US.webmanifest`. KaiOS-specific keys go in `b2g_features`. The api-daemon parser accepts `version`, `core`, `origin`, `permissions` (`{name: {description, access?}}`), `developer`, `subtitle`, `focus_color`, `default_locale`, `locales`, `activities`, `messages` (system message names), `serviceworker` (`{script_url}`), `deeplinks`, `redirects`, `inputs`, `cursor`, `role` and `dependencies`. `id` is the store's update key. **Confirmed in source; documented.** Flip Map's manifest already follows this shape.

**Permission names relevant to Flip Map:** `geolocation`, `audio-channel-content`, `audio-channel-notification` (signed), `alarms`, `desktop-notification`, `audio-capture` (voice entry), and, informational only, the core-only `flip`, `power` and `bluetooth-privileged`. A name that isn't in the table is logged as "not a valid app permission name" and skipped. **Confirmed in source.**

### Install routes

| Route | What it needs | Status on a stock T440W |
|---|---|---|
| **appscmd** (`appscmd install <dir>`) | KaiOS docs: `adb root`, then `adb forward …`. The appscmd 0.3.2 binary pushes the zip to `/data/local/tmp/sideloaded_application.zip`, talks to api-daemon's `/data/local/tmp/apps-uds.sock`, and checks for root (`id`, "Device is unrooted", `su -c`) | **Blocked as documented.** The stock build has `ro.debuggable=0`, and adbd refuses root ("adbd cannot run as root in production builds"). Whether appscmd works without root depends on the socket's permissions and SELinux. **Unknown**, and a two-minute test |
| **Developer mode** `*#*333284#*#*` | Dialer | **Works on this phone** (kaios.dev), as do W2D (`new WebActivity('configure', {target:'device', section:'developer'})`) and a soft-key code in Settings › Device › Device Info › More Info. It exposes the Developer menu (ADB and DevTools toggles). The Firefox remote debugger is **blocked by SELinux** (`avc: denied { write } … firefox-debugger-socket`) |
| **KaiStore "Test Device" (by IMEI)** | Submit the app on the KaiOS Submission Portal, click "Test Device", enter the phone's IMEI; "after 5 minutes" the app appears in the phone's KaiStore | **Most realistic signed path. Documented.** Produces a properly signed (`signed`) app, not core. Caveats: KaiStore's guideline says it is "only accepting apps that are monetized using KaiAds SDK" (it's unclear whether this applies to test-device submissions); KaiStore must be present on the T-Mobile build (kaios.dev mentions KaiStore and its silent-install activity; Kids Mode removes it); the app must ship without `"core": true` |
| **PWA install** | `appscmd install-pwa <url>` (same socket), or a browser "add to apps" option if the KaiOS 4 browser has one | **Unknown.** It would give `pwa` permissions, which is enough for the `content` audio channel, and keeps GitHub Pages hosting |
| JScalated (browser → system-app JavaScript → ADB authorization, plus a "Sideload" tool using the AppsManager API) | KaiOS 3.x | **Community report, KaiOS 3.x only.** It relies on Gecko 84's `window.name` surviving cross-origin navigation; Firefox changed that in v88. Likely inapplicable to KaiOS 4 (inference). It's an exploit; don't build on it |
| EDL root (ambercaravalho/tcl-flip-4-root) | Qualcomm EDL flash of `odm`/`vbmeta_b`, re-signed with the public AOSP test key | **Community report:** worked on one T440W, giving permissive SELinux and `adb root`. **Not recommended:** it can brick the only test phone |

**Sources:** `G/b2g/components/PermissionsInstaller.sys.mjs#L142-L151` · `G/b2g/components/PermissionsTable.sys.mjs` · `A/services/apps/src/manifest.rs#L35-L72` · `A/services/apps/src/apps_actor.rs#L372-L440` · `A/services/apps/src/apps_request.rs#L563-L566` · `A/daemon/config-device.toml#L16-L24` · [kaiostech/appscmd](https://github.com/kaiostech/appscmd) (binary strings) · [KaiOS docs: Testing your apps (SFP 3.0)](https://developer.kaiostech.com/docs/sfp-3.0/getting-started/build-your-first-package-app/test-your-apps) · [KaiOS docs: Manifest (SFP 4.0)](https://developer.kaiostech.com/docs/sfp-4.0/getting-started/main-concepts/manifest) · [KaiOS docs: Security access level (SFP 4.0)](https://developer.kaiostech.com/docs/sfp-4.0/getting-started/main-concepts/security-access-level) · [KaiOS docs: Submission Portal](https://developer.kaiostech.com/docs/sfp-4.0/distribution/submission-portal) · [KaiOS docs: Submission Guideline](https://developer.kaiostech.com/docs/sfp-4.0/distribution/submission-guideline) · [KaiOS docs: 3.0 Overview](https://developer.kaiostech.com/docs/sfp-3.0/introduction/overview) · [kaios.dev: TCL Go Flip 4 5G and KaiOS 4.0](https://kaios.dev/2026/03/a-closer-look-at-the-tcl-go-flip-4-5g-and-kaios-4.0/) · [kaios.dev: JScalated](https://kaios.dev/2026/06/jscalated-from-the-browser-to-adb-on-kaios-3.x/) · [ambercaravalho/tcl-flip-4-root](https://github.com/ambercaravalho/tcl-flip-4-root) (README, `docs/ROOT.md` "Why `odm` gets us both permissive and adb root") · [BananaHackers: Debug mode](https://sites.google.com/view/bananahackers/development/debug-mode)

**Exactly what to test on the device**

1. Dial `*#*333284#*#*`, enable ADB in the Developer menu, then from the Mac run `adb devices`. Is the phone listed as `device` or `unauthorized`?
2. `adb shell getprop ro.debuggable` (expect `0`) and `adb root` (expect the refusal).
3. `adb shell ls -lZ /data/local/tmp/`: does `apps-uds.sock` exist, and who may connect to it?
4. `./appscmd list`: copy down the exact error.
5. On the phone: is KaiStore in the app list? Does the browser's options menu offer anything like "Add to Apps" or "Pin"?

---

## Browser tab vs installed app at a glance

| Capability | Browser tab | Installed PWA | Signed (KaiStore) | Core |
|---|---|---|---|---|
| `navigator.b2g.requestWakeLock('screen'/'cpu'/'gps')` | Yes | Yes | Yes | Yes |
| `watchPosition` fixes while hidden | **No** (Gecko 123) | **No** | **No** | **No** |
| Cached `getCurrentPosition` while hidden (workaround) | Probably (untested) | Probably | Probably | Probably |
| `<audio>`/Web Audio on `content` (background audio) | No | **Yes** | Yes | Yes |
| `notification`/`alarm` channel | No | No | Yes | Yes |
| `speechSynthesis` in the background | Probably paused or muted | `normal` channel; policy unknown | Same | Same |
| Notifications | Browser prompt (unknown) | Prompt | Allowed by default | Allowed by default |
| `media-button` system message (car buttons) | No (no service worker subscription) | Yes | Yes | Yes |
| `preventDefault` on special keys (QdCall, Message, …) | No (kaios.dev) | Presumably | Yes (kaios.dev: "Apps can also preventDefault") | Yes |
| Flip state, brightness, outer screen, AVRCP text | No | No | No | **Yes** |

---

## Opportunities, ranked by impact × feasibility

1. **Keep navigating with the flip closed using `gps` + `cpu` wake locks and polling the cached position while hidden.** Impact: high, since this is the open risk. Feasibility: high. No install is needed, about 30 lines, and the source says the path exists. It must be proven on the device first ([test plan](#device-test-plan), step 2).
2. **Keep the GPS warm across a flip close (`gps` wake lock alone).** Impact: medium-high, since it gives an instant fix and catch-up on reopen. Feasibility: very high (one line, works in a tab). It costs battery, so hold the lock only while a route is active.
3. **Background voice on the `content` channel with pre-rendered prompt clips.** Impact: high if the test shows `speechSynthesis` is muted while hidden. Feasibility: medium. It needs an installed app (PWA or KaiStore-signed) and an audio-prompt pipeline (a small set of recorded phrases, or clips made by a TTS service ahead of time). If `speechSynthesis` turns out to be audible while hidden, skip this.
4. **Turn text on the cover screen via notifications** (one tagged notification per maneuver). Impact: medium-high for a flip phone. Feasibility: high *if* the cover screen shows notification text, which is unknown ([§4 test](#4-outer-cover-screen)).
5. **Choose the install path:** KaiStore Test Device for a signed build, or a PWA install if the browser or appscmd allows one. Impact: unlocks 3, 6 and 7. Feasibility: medium, because of the KaiStore account and the KaiAds condition.
6. **Car or headset Play/Pause repeats the last instruction**, via the `media-button` system message in a service worker. Impact: medium. Feasibility: medium (installed app plus service worker; conflicts with the Music app).
7. **Voice destination entry: microphone recording plus server speech-to-text.** Impact: medium on a keypad. Feasibility: medium-low (needs a backend, costs money, privacy).
8. **Core-only features** (flip events, brightness, outer-screen brightness, AVRCP turn text on the car display). Impact: medium. Feasibility: very low on stock firmware (needs root or OEM signing). Revisit only if appscmd unexpectedly works without root.

---

## Device test plan

Run this right after the first browser test (Monday's protocol). Steps 1–7 run as a page in the browser with location already allowed. They don't need app changes: paste the snippets into a scratch page hosted next to the app *after* the freeze, or into the address bar as `javascript:` if the browser allows it. Steps 8–9 are the install probes.

**Read Monday's drive report through this lens first.** If "Screen off" time is above zero, the page was hidden, and "GPS fixes while off = 0" is Gecko 123's rule, not proof of suspension. "Prompts finished while off" counts `onend`, which fires even when the audio was muted; only the passenger's ears count.

1. **Basics (1 min):** `!!navigator.wakeLock`, `typeof navigator.b2g.requestWakeLock`, `speechSynthesis.getVoices().map(v => v.name + ' ' + v.lang)`, `typeof webkitSpeechRecognition`, and `navigator.b2g.getFlipManager().then(() => 'ok', e => e.name)` (expect `SecurityError`).
2. **Hidden GPS (2 min with the flip closed, while moving):**
   ```js
   var L = ['gps', 'cpu'].map(function (t) { return navigator.b2g.requestWakeLock(t); });
   var s = { ticks: 0, watch: 0, polled: 0, last: 0, state: '' };
   navigator.geolocation.watchPosition(function () { if (document.hidden) s.watch++; }, null, { enableHighAccuracy: true });
   setInterval(function () {
     if (!document.hidden) return;
     s.ticks++;
     s.state = navigator.b2g.getWakeLockState('gps');
     navigator.geolocation.getCurrentPosition(function (p) {
       if (p.timestamp > s.last) { s.polled++; s.last = p.timestamp; }
     }, function () {}, { maximumAge: 3000, timeout: 1500, enableHighAccuracy: true });
   }, 1000);
   document.addEventListener('visibilitychange', function () {
     if (!document.hidden) alert(JSON.stringify(s));
   });
   ```
   - `ticks` ≈ 120 means the CPU stayed awake.
   - `watch` = 0 is expected.
   - `polled` ≈ 100+ means the workaround works.
   - `state` should read `locked-background`.
3. **Same as step 2 without the `gps` lock.** Expect `polled` to drop to about 0 and a slower first fix after reopening.
4. **Voice while closed:** `setTimeout(function () { speechSynthesis.speak(new SpeechSynthesisUtterance('Test, flip closed')); }, 20000)`, then close the flip. Was it heard? Repeat with the Music app playing, and with Bluetooth audio connected.
5. **Tone while closed (normal channel):** a 1-second `OscillatorNode` from `new AudioContext()` 20 s after closing. Was it heard?
6. **Cover screen:** request notification permission, then `setTimeout(function () { new Notification('Flip Map', { body: 'In 500 ft, turn right onto Main St', tag: 'turn' }); }, 15000)` and close the flip. What does the outer screen show?
7. **Keys:** log `e.key` for OK, the soft keys, the side and shortcut keys, the flip close and open, and car stereo buttons. kaios.dev reports that on this phone the center OK key sends `MicrophoneToggle` instead of `Enter`. Flip Map maps `Enter` and `5`, so confirm OK still works.
8. **ADB and appscmd probe (5 min):** follow steps 1–4 of the [§7 tests](#7-installing-a-packaged-app-on-kaios-4).
9. **Store and PWA probe (2 min):** check that KaiStore is present and look for an "add to apps" option in the browser.

**How the results decide the next step:**

- If step 2 shows `polled` > 0 and step 4 is heard → stay a browser tab and add the wake-lock polling.
- If step 2 works but step 4 is silent → install (KaiStore Test Device, or a PWA install) for the `content` channel, plus audio clips.
- If step 2 shows `ticks` ≈ 0 → the CPU sleeps with the flip closed. Nothing short of a system-level `cpu` exemption helps, so "works with the flip open" becomes the plan.

---

## Other things found along the way

- kaios.dev reports that installed apps (not websites) can `preventDefault` the T440W's shortcut keys (QdCall, Message, FavoriteContacts, MicrophoneToggle). This is relevant to README's note that the browser may keep keys for itself. **Community report.**
- `tctweb_server` (root, `127.0.0.1:2929`) and an eSIM HTTP server are reachable from any page on this phone. kaios.dev calls them hardened, but this is worth knowing for privacy. **Community report.**
- Cookies and storage are partitioned per origin in Gecko 123. A packaged `http://flipmap.localhost` app and the GitHub Pages site won't share `localStorage` (recent places, tile cache). **Community report** (kaios.dev KaiOS 4.0 preview) plus upstream Firefox behavior.
