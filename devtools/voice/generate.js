#!/usr/bin/env node
// Renders every phrase in phrases.json with each voice in voices.json, then makes the clips comparable:
// silence trimmed, a 0.1 s lead-in, and the same loudness (-16 LUFS), so the listening test compares
// voices rather than volume or timing. Writes samples/<voice>/<phrase>.mp3 and samples/<voice>/meta.json.
//
//   node generate.js                       every voice whose service key is in keys.local (Piper needs none)
//   node generate.js piper openai          only these services
//   node generate.js --voice openai-marin  one voice
//   node generate.js --force               render again, replacing existing clips
//   node generate.js --pron none           ignore pronunciations.json (to hear the difference)
//   node generate.js --dry openai           show what each voice would be sent, without sending it
//   node generate.js --list elevenlabs     what your account offers (models, voices); also google, openai
//
// Keys come from keys.local (see keys.example), or from the environment. They're sent only to their
// own service and never printed. Needs Node 18+ and ffmpeg; Piper needs `npm run setup-piper` once.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DIR = __dirname;
const SAMPLES = path.join(DIR, 'samples');
const WORK = path.join(DIR, 'work');
const LUFS = -16;
const KEY = { openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY', google: 'GOOGLE_API_KEY' };

const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const phrases = read('phrases.json').phrases;
const config = read('voices.json');
const prons = read('pronunciations.json').entries;

// --- Arguments and keys ---

const args = process.argv.slice(2);
const opt = { services: [], voice: null, force: false, pron: null, list: null, dry: false };
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--voice') opt.voice = args[++i];
  else if (args[i] === '--force') opt.force = true;
  else if (args[i] === '--pron') opt.pron = args[++i];
  else if (args[i] === '--list') opt.list = args[++i];
  else if (args[i] === '--dry') opt.dry = true;
  else opt.services.push(args[i]);
}

function loadKeys() {
  const keys = {};
  const file = path.join(DIR, 'keys.local');
  if (fs.existsSync(file)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && m[2]) keys[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    });
  }
  Object.values(KEY).forEach(k => { if (!keys[k] && process.env[k]) keys[k] = process.env[k]; });
  return keys;
}

// --- Pronunciations: each engine gets them the way it can take them ---

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function prepare(text, voice) {
  const mode = opt.pron || voice.pron || 'none';
  const found = mode === 'none' ? [] : prons.filter(e => new RegExp('(^|[^\\w-])' + escapeRe(e.text) + '($|[^\\w-])').test(text));
  const out = { text, instructions: config.brief, custom: [], applied: found.map(e => e.text), mode };
  const respell = e => { out.text = out.text.replace(new RegExp(escapeRe(e.text), 'g'), e.respell); };
  const tricky = found.filter(e => e.respell); // ordinary names ('sounds' only) are left to the engine
  if (mode === 'respell') tricky.forEach(respell);
  if (mode === 'ipa') {
    found.forEach(e => {
      if (e.ipa) out.custom.push({ phrase: e.text, phoneticEncoding: 'PHONETIC_ENCODING_IPA', pronunciation: e.ipa });
      else if (e.respell) respell(e);
    });
  }
  if (mode === 'instructions' && tricky.length) {
    out.instructions += ' Pronounce ' + tricky.map(e => '"' + e.text + '" as "' + e.respell + '"' + (e.ipa ? ' (IPA ' + e.ipa + ')' : '')).join(', ') + '.';
  }
  out.applied = mode === 'respell' || mode === 'instructions' ? tricky.map(e => e.text) : out.applied;
  return out;
}

// --- The services ---

async function request(url, init, what) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 300);
    const err = new Error(what + ': HTTP ' + res.status + ' ' + body);
    err.status = res.status;
    throw err;
  }
  return res;
}

const ELEVEN = 'https://api.elevenlabs.io/v1/';
let elevenVoices = null;

async function elevenVoiceId(voice, keys) {
  if (voice.voiceId) return voice.voiceId;
  if (!elevenVoices) {
    const res = await request(ELEVEN + 'voices', { headers: { 'xi-api-key': keys.ELEVENLABS_API_KEY } }, 'ElevenLabs voices');
    elevenVoices = (await res.json()).voices || [];
  }
  const want = voice.voiceName.toLowerCase();
  const hit = elevenVoices.find(v => v.name.toLowerCase() === want) || elevenVoices.find(v => v.name.toLowerCase().startsWith(want));
  if (!hit) throw new Error('No ElevenLabs voice named "' + voice.voiceName + '". Yours: ' + elevenVoices.map(v => v.name).join(', '));
  return hit.voice_id;
}

const SYNTH = {
  // Piper, locally: WAV.
  async piper(voice, prep) {
    const py = path.join(DIR, '.venv', 'bin', 'python');
    const model = path.join(DIR, 'models', voice.model + '.onnx');
    if (!fs.existsSync(py) || !fs.existsSync(model)) throw new Error('Piper isn\'t set up: run `npm run setup-piper`');
    const out = path.join(WORK, 'piper.wav');
    const r = spawnSync(py, ['-m', 'piper', '-m', model, '-f', out], { input: prep.text, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Piper: ' + (r.stderr || '').slice(-300));
    return { data: fs.readFileSync(out), ext: 'wav' };
  },

  // OpenAI speech: WAV. The voice brief and any pronunciations go in `instructions`.
  async openai(voice, prep, keys) {
    const res = await request('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + keys.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: voice.model, voice: voice.voice, input: prep.text, instructions: prep.instructions, response_format: 'wav' })
    }, 'OpenAI');
    return { data: Buffer.from(await res.arrayBuffer()), ext: 'wav' };
  },

  // ElevenLabs: MP3 (available on every plan).
  async elevenlabs(voice, prep, keys) {
    const id = await elevenVoiceId(voice, keys);
    const body = { text: prep.text, model_id: voice.model };
    if (voice.settings) body.voice_settings = voice.settings;
    const res = await request(ELEVEN + 'text-to-speech/' + id + '?output_format=mp3_44100_128', {
      method: 'POST',
      headers: { 'xi-api-key': keys.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, 'ElevenLabs');
    return { data: Buffer.from(await res.arrayBuffer()), ext: 'mp3' };
  },

  // Google Cloud Text-to-Speech: WAV. Custom pronunciations in IPA where the voice accepts them; if it
  // refuses them, the phrase is rendered without (and meta.json says so).
  async google(voice, prep, keys) {
    const call = custom => request('https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(keys.GOOGLE_API_KEY), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: custom.length ? { text: prep.text, customPronunciations: { pronunciations: custom } } : { text: prep.text },
        voice: { languageCode: voice.languageCode || 'en-US', name: voice.voice },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: voice.speakingRate || 1.0 }
      })
    }, 'Google');
    let res;
    try {
      res = await call(prep.custom);
    } catch (e) {
      if (!prep.custom.length || e.status !== 400) throw e;
      prep.note = 'custom pronunciations refused: ' + e.message.slice(0, 120);
      prep.applied = prep.applied.filter(t => !prep.custom.some(c => c.phrase === t));
      res = await call([]);
    }
    return { data: Buffer.from((await res.json()).audioContent, 'base64'), ext: 'wav' };
  }
};

// --- Making clips comparable ---

function ffmpeg(argv) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-y'].concat(argv), { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg: ' + (r.stderr || '').slice(-400));
  return r.stderr;
}

// Trim silence at both ends, measure loudness (EBU R128, which holds up on clips of a second or two),
// then apply one fixed gain to reach LUFS, with a limiter keeping peaks under -1.5 dBFS.
const TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,' +
  'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse';

function loudness(input, filters) {
  const log = ffmpeg(['-i', input, '-af', (filters ? filters + ',' : '') + 'ebur128=framelog=quiet', '-f', 'null', '-']);
  const m = log.match(/Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/);
  return m ? parseFloat(m[1]) : null;
}

function even(input, wavOut) {
  const chain = gain => TRIM + ',volume=' + gain.toFixed(2) + 'dB,alimiter=limit=0.84:level=false';
  const level = loudness(input, TRIM);
  let gain = level === null || !isFinite(level) ? 0 : LUFS - level;
  // The limiter takes a little off loud clips; measure once more and make up the difference.
  const after = loudness(input, chain(gain));
  if (after !== null && isFinite(after)) gain += LUFS - after;
  ffmpeg(['-i', input, '-af', chain(gain) + ',adelay=100:all=1', '-ac', '1', '-ar', '24000', wavOut]);
}

function seconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Math.round(parseFloat(r.stdout) * 100) / 100;
}

// --- Rendering ---

async function render(voice, keys) {
  const out = path.join(SAMPLES, voice.id);
  const work = path.join(WORK, voice.id);
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const metaFile = path.join(out, 'meta.json');
  const old = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : { phrases: {} };
  const meta = {
    id: voice.id, label: voice.label, provider: voice.provider, model: voice.model || null, voice: voice.voice || voice.voiceName || null,
    settings: voice.settings || null, pron: opt.pron || voice.pron || 'none', license: voice.license || '',
    loudness: LUFS + ' LUFS', generatedAt: new Date().toISOString(), phrases: {}
  };
  let made = 0;
  for (const p of phrases) {
    const mp3 = path.join(out, p.id + '.mp3');
    if (!opt.force && fs.existsSync(mp3) && old.phrases[p.id]) {
      meta.phrases[p.id] = old.phrases[p.id];
      continue;
    }
    const prep = prepare(p.text, voice);
    const raw = await SYNTH[voice.provider](voice, prep, keys);
    const rawFile = path.join(work, p.id + '.raw.' + raw.ext);
    const wav = path.join(work, p.id + '.wav');
    const opus = path.join(work, p.id + '.opus');
    fs.writeFileSync(rawFile, raw.data);
    even(rawFile, wav);
    ffmpeg(['-i', wav, '-c:a', 'libmp3lame', '-b:a', '64k', mp3]);
    ffmpeg(['-i', wav, '-c:a', 'libopus', '-b:a', '24k', opus]); // for the size of a phone voice pack
    meta.phrases[p.id] = {
      sent: prep.text,
      lufs: loudness(mp3),
      instructions: voice.provider === 'openai' ? prep.instructions : undefined,
      pronounced: prep.applied,
      note: prep.note,
      seconds: seconds(mp3),
      mp3Bytes: fs.statSync(mp3).size,
      opusBytes: fs.statSync(opus).size
    };
    made++;
    process.stdout.write('.');
    if (voice.provider !== 'piper') await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  const all = Object.values(meta.phrases);
  const kb = k => Math.round(all.reduce((s, x) => s + x[k], 0) / 1024);
  console.log(' ' + voice.id + ': ' + made + ' rendered, ' + all.length + '/' + phrases.length + ' present, ' +
    kb('opusBytes') + ' KB as Opus 24 kb/s');
}

// --- Listing what an account offers ---

async function list(service, keys) {
  if (!keys[KEY[service]]) throw new Error('No ' + KEY[service] + ' in keys.local');
  if (service === 'elevenlabs') {
    const h = { headers: { 'xi-api-key': keys.ELEVENLABS_API_KEY } };
    const models = await (await request(ELEVEN + 'models', h, 'ElevenLabs models')).json();
    console.log('Models:');
    models.forEach(m => console.log('  ' + m.model_id + '  ' + m.name));
    const voices = (await (await request(ELEVEN + 'voices', h, 'ElevenLabs voices')).json()).voices;
    console.log('Voices:');
    voices.forEach(v => console.log('  ' + v.name + '  (' + v.voice_id + ', ' + v.category + ')'));
  } else if (service === 'google') {
    const res = await request('https://texttospeech.googleapis.com/v1/voices?languageCode=en-US&key=' + encodeURIComponent(keys.GOOGLE_API_KEY), {}, 'Google voices');
    (await res.json()).voices.filter(v => /Chirp3-HD|Chirp-HD|Studio|Neural2/.test(v.name))
      .forEach(v => console.log('  ' + v.name + '  ' + v.ssmlGender));
  } else if (service === 'openai') {
    const res = await request('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + keys.OPENAI_API_KEY } }, 'OpenAI models');
    (await res.json()).data.filter(m => /tts/.test(m.id)).forEach(m => console.log('  ' + m.id));
    console.log('Voices are listed in OpenAI\'s text-to-speech guide (marin and cedar are its recommended ones).');
  } else {
    throw new Error('--list takes elevenlabs, google or openai');
  }
}

async function main() {
  const keys = loadKeys();
  if (opt.list) return list(opt.list, keys);
  const chosen = config.voices.filter(v => (opt.voice ? v.id === opt.voice : !opt.services.length || opt.services.includes(v.provider)));
  if (!chosen.length) throw new Error('No voices match. Ids in voices.json: ' + config.voices.map(v => v.id).join(', '));
  if (opt.dry) {
    chosen.forEach(v => {
      console.log(v.id + ' (' + (opt.pron || v.pron) + '):');
      phrases.forEach(p => {
        const prep = prepare(p.text, v);
        if (!prep.applied.length) return;
        console.log('  ' + p.id + ': ' + prep.text);
        if (prep.custom.length) console.log('    custom: ' + prep.custom.map(c => c.phrase + ' = ' + c.pronunciation).join(', '));
        if (v.provider === 'openai') console.log('    instructions: ' + prep.instructions);
      });
    });
    return;
  }
  fs.mkdirSync(WORK, { recursive: true });
  for (const v of chosen) {
    if (KEY[v.provider] && !keys[KEY[v.provider]]) {
      console.log('skip ' + v.id + ': no ' + KEY[v.provider] + ' in keys.local');
      continue;
    }
    process.stdout.write(v.id + ' ');
    try {
      await render(v, keys);
    } catch (e) {
      console.log('\n  ' + v.id + ' failed: ' + e.message);
    }
  }
}

main().catch(e => {
  console.error(e.message);
  process.exit(1);
});
