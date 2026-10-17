// Serves the listening test on http://localhost:8419 (PORT=… for another). /manifest.json is built on
// each request from phrases.json and samples/*/meta.json, so newly rendered voices show up on reload.
// Only the page, its data and the samples are served: never keys.local or anything else in the folder.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const PORT = +(process.env.PORT || 8419);
const ALLOWED = /^\/(index\.html|listen\.css|listen\.js|phrases\.json|pronunciations\.json|samples\/[\w-]+\/[\w-]+\.mp3)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.mp3': 'audio/mpeg' };

function manifest() {
  const phrases = JSON.parse(fs.readFileSync(path.join(DIR, 'phrases.json'), 'utf8')).phrases;
  const root = path.join(DIR, 'samples');
  const voices = (fs.existsSync(root) ? fs.readdirSync(root) : []).map(id => {
    const metaFile = path.join(root, id, 'meta.json');
    if (!fs.existsSync(metaFile)) return null;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    const files = {};
    phrases.forEach(p => {
      if (meta.phrases[p.id] && fs.existsSync(path.join(root, id, p.id + '.mp3'))) files[p.id] = 'samples/' + id + '/' + p.id + '.mp3';
    });
    const all = Object.values(meta.phrases);
    return {
      id, label: meta.label, provider: meta.provider, model: meta.model, voice: meta.voice, pron: meta.pron,
      license: meta.license, generatedAt: meta.generatedAt, files, sent: Object.fromEntries(Object.entries(meta.phrases).map(([k, v]) => [k, v.sent])),
      opusKB: Math.round(all.reduce((s, x) => s + (x.opusBytes || 0), 0) / 1024)
    };
  }).filter(v => v && Object.keys(v.files).length);
  return { phrases, voices };
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  if (url === '/manifest.json') return send(200, TYPES['.json'], JSON.stringify(manifest()));
  const file = url === '/' ? '/index.html' : url;
  if (!ALLOWED.test(file)) return send(404, 'text/plain', 'not found');
  fs.readFile(path.join(DIR, file), (err, data) => {
    if (err) return send(404, 'text/plain', 'not found');
    send(200, TYPES[path.extname(file)] || 'application/octet-stream', data);
  });
}).listen(PORT, () => console.log('Voice test: http://localhost:' + PORT));
