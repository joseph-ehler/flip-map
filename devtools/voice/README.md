# Flip Map voice test

A blind listening test for choosing Flip Map's navigation voice. The same driving instructions are rendered in each candidate voice, evened out for loudness and timing, and played shuffled and unnamed. For each clip, it scores:
- **Understood:** did you pick the right maneuver?
- **Time:** how fast you knew what to do.
- **Clear and Natural:** how it sounded, from 1 to 5.

Development tool only. Nothing here ships with the app, and the app is unchanged.

## What's here

| File | What it is |
|---|---|
| [phrases.json](phrases.json) | 19 instructions, worded exactly as the app says them, on real Gainesville-area roads. Each has the right answer and 3 plausible wrong ones for the "what do you do?" question |
| [pronunciations.json](pronunciations.json) | Regional names and road numbers: Alachua, Micanopy, Lemerand, I-75, US-301. Entries marked `"sure": false` need a local ear |
| [voices.json](voices.json) | The candidates and the voice brief. Ready: 2 Piper voices. Waiting for keys: 2 OpenAI, 3 ElevenLabs, 2 Google |
| [generate.js](generate.js) | Renders the phrases with each voice, then trims silence, adds a 0.1 s lead-in, and brings every clip to −16 LUFS |
| [index.html](index.html), [listen.js](listen.js), [listen.css](listen.css) | The listening test, plus a "Browse" view of every clip with names |
| [serve.js](serve.js) | Serves the test on http://localhost:8419. It serves only the page, its data and the clips, never `keys.local` |
| `samples/` | The rendered clips. Only the Piper ones are committed (see [Licenses](#licenses)) |

## Setup

You need Node 18+ and ffmpeg (`brew install ffmpeg`). Piper also needs Python (3.13 was used; the setup picks it if installed), and about 130 MB for its two voices, which git ignores:

```bash
npm run setup-piper
```

The Piper samples are already rendered. To render them again:

```bash
node generate.js piper --force
```

## Adding the premium voices

1. Copy the key template. Git ignores `keys.local`, and the keys are sent only to their own service:

   ```bash
   cp keys.example keys.local
   ```

2. Fill in the keys for the services you want:
   - **OpenAI:** an API key from platform.openai.com.
   - **ElevenLabs:** an API key from your ElevenLabs profile. Commercial use needs a paid plan.
   - **Google:** in a Google Cloud project, enable the Text-to-Speech API, then create an API key, ideally restricted to that API.
3. Check what your accounts offer. Model names change; I couldn't confirm an ElevenLabs "v4" model ID, so check before adding one to `voices.json`:

   ```bash
   node generate.js --list elevenlabs
   ```

4. Review exactly what each voice will be sent, without spending anything:

   ```bash
   node generate.js --dry
   ```

5. Render. Voices without a key are skipped:

   ```bash
   node generate.js
   ```

A full set is 19 short phrases per voice, so the cost per voice should be small; current prices weren't checked. Re-running skips clips that already exist; `--force` replaces them, and `--voice <id>` renders just one voice. To hear what the pronunciation list changes, render a voice with `--pron none` into a copy of its entry under another `id`.

## Taking the test

```bash
npm run listen
```

Open http://localhost:8419, or the `voice-test` entry in Claude's browser pane.

- **Quick:** 8 phrases in every voice: 72 clips with all 9 voices, under 10 minutes. **Full:** all 19.
- **Got it:** press it (or Space) the moment you know what to do. Then pick the maneuver (keys 1 to 4), rate Clear and Natural, and press Next (Enter).
- **Order:** every phrase plays once in each voice, all shuffled, so later hearings are quicker. The order is random, which spreads that evenly across voices, and each answer records how many times the phrase was heard before.
- **Run it several ways:** through headphones, laptop speakers and a car, and with **Flip phone speaker** (a telephone-band filter) and **Road noise** switched on. Saved sessions are combined on the start page and can be downloaded as JSON.
- **The real phone:** to hear the clips through the Flip 4's own speaker, its browser could open the Browse view at `http://<this Mac's address>:8419` over the same Wi-Fi. That hasn't been tried.

## Licenses

The repository and the live site are public, so a voice pack there is downloadable by anyone.

| Voice | Published here? |
|---|---|
| Piper Kristin, Norman | **Yes.** Their training data is public domain (see [offline-and-accuracy.md](../../research/offline-and-accuracy.md)). Piper's Lessac voice and those built from it are research-only, so they aren't used |
| OpenAI | Output is yours, but OpenAI requires telling listeners the voice is AI-generated |
| ElevenLabs | Needs a paid plan for commercial use, and the terms limit publishing generated clips as a collection. Check before shipping a pack |
| Google Cloud | Output is yours to use |

Premium samples stay local (`.gitignore`) until a voice is chosen and its terms are checked.

## What this doesn't settle

- **Flip-closed playback:** whether clips play at all with the flip closed. Monday's phone check (key 4) answers that for a plain clip.
- **Road names:** they can't all be pre-rendered. The routing service can name any road, so a voice pack covers prominent ones. For the rest, the choice is between saying just the maneuver and switching to the phone's own voice.
- **Joining clips:** this tests complete phrases. Joining a phrase to a separate road-name clip is a later test, experiment E3 in the offline research.
