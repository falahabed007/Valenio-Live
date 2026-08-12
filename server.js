/**
 * Premium-Pizzeria-Vorlage — Backend
 * --------------------------------------------------------------
 * Liefert die edle Praesentationsseite (index.html) aus und stellt
 * einen geschuetzten Inhaberbereich (/admin) bereit, ueber den die
 * Pizzeria ihre Speisekarte SELBST als PDF hochladen kann.
 *
 * - Keine Online-Bestellung (reine Praesentationsseite).
 * - PDFs werden in MongoDB gespeichert (Render-Filesystem ist fluechtig).
 * - Laeuft auch OHNE MongoDB: dann ist nur der Upload deaktiviert,
 *   die Seite selbst funktioniert normal (Vorschaumodus).
 *
 * Sprache: Deutsch. Secrets kommen aus der .env (siehe env-example.txt).
 */

require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const mongoose = require('mongoose');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const TOKEN_SECRET = process.env.ADMIN_TOKEN_SECRET || 'unsicheres-standardgeheimnis-bitte-aendern';
const MONGODB_URI = process.env.MONGODB_URI || '';

const SLOTS = ['togo', 'restaurant'];           // erlaubte Speisekarten-Slots
const MAX_PDF_BYTES = 10 * 1024 * 1024;          // 10 MB

const app = express();
app.use(cors());
app.use(express.json());

// ------------------------------------------------------------------
//  MongoDB (optional)
// ------------------------------------------------------------------
let dbReady = false;

const speisekarteSchema = new mongoose.Schema({
  slot:        { type: String, enum: SLOTS, unique: true, required: true },
  filename:    { type: String, default: 'speisekarte.pdf' },
  contentType: { type: String, default: 'application/pdf' },
  size:        { type: Number, default: 0 },
  data:        { type: Buffer, required: true },
  uploadedAt:  { type: Date, default: Date.now }
});
const Speisekarte = mongoose.model('Speisekarte', speisekarteSchema);

async function connectDb() {
  if (!MONGODB_URI) {
    console.warn('[DB] Keine MONGODB_URI gesetzt — Upload deaktiviert (Vorschaumodus).');
    return;
  }
  try {
    await mongoose.connect(MONGODB_URI);
    dbReady = true;
    console.log('[DB] MongoDB verbunden.');
  } catch (err) {
    console.error('[DB] Verbindung fehlgeschlagen:', err.message);
  }
}

// ------------------------------------------------------------------
//  Auth (Passwort -> signiertes Token)
// ------------------------------------------------------------------
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function makeToken() {
  const payload = `admin.${Date.now()}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

function verifyToken(token) {
  try {
    const decoded = Buffer.from(String(token), 'base64').toString('utf8');
    const cut = decoded.lastIndexOf('.');
    if (cut < 0) return false;
    const payload = decoded.slice(0, cut);
    const sig = decoded.slice(cut + 1);
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
    if (!safeEqual(sig, expected)) return false;
    const ts = parseInt(payload.split('.')[1], 10);
    if (!ts || Date.now() - ts > 1000 * 60 * 60 * 24 * 30) return false; // 30 Tage gueltig
    return true;
  } catch {
    return false;
  }
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!verifyToken(token)) return res.status(401).json({ ok: false, error: 'Nicht angemeldet.' });
  next();
}

// ------------------------------------------------------------------
//  Upload-Handling (multer, nur PDF, max 10 MB)
// ------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Nur PDF-Dateien sind erlaubt.'));
  }
});

// ------------------------------------------------------------------
//  Statische Auslieferung (gezielt — NICHT das ganze Verzeichnis,
//  sonst waere die .env abrufbar!)
// ------------------------------------------------------------------
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Health-Check — von Render angepingt und zur schnellen Sichtpruefung im Browser.
app.get('/api/health', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    db: dbReady ? 'connected' : 'offline',
    upload: dbReady,
    zeit: new Date().toISOString()
  });
});

// ------------------------------------------------------------------
//  Oeffentliche Speisekarten-API
// ------------------------------------------------------------------
app.get('/api/speisekarte/meta', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const meta = { dbConnected: dbReady, slots: {} };
  for (const slot of SLOTS) meta.slots[slot] = null;
  if (dbReady) {
    try {
      const docs = await Speisekarte.find({}, { data: 0 }).lean();
      for (const d of docs) {
        meta.slots[d.slot] = {
          filename: d.filename,
          size: d.size,
          uploadedAt: d.uploadedAt
        };
      }
    } catch (err) {
      console.error('[meta]', err.message);
    }
  }
  res.json(meta);
});

app.get('/api/speisekarte/:file', async (req, res) => {
  const slot = String(req.params.file).replace(/\.pdf$/i, '');
  if (!SLOTS.includes(slot)) return res.status(404).send('Unbekannte Speisekarte.');
  if (!dbReady) return res.status(503).send('Speisekarte aktuell nicht verfuegbar.');
  try {
    const doc = await Speisekarte.findOne({ slot });
    if (!doc || !doc.data) return res.status(404).send('Noch keine Speisekarte hinterlegt.');
    res.set('Content-Type', doc.contentType || 'application/pdf');
    res.set('Content-Disposition', `inline; filename="${doc.filename || slot + '.pdf'}"`);
    res.set('Cache-Control', 'no-cache');
    res.send(doc.data);
  } catch (err) {
    console.error('[pdf]', err.message);
    res.status(500).send('Fehler beim Laden der Speisekarte.');
  }
});

// ------------------------------------------------------------------
//  Inhaber-API (geschuetzt)
// ------------------------------------------------------------------
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (!ADMIN_PASSWORD) {
    return res.status(500).json({ ok: false, error: 'ADMIN_PASSWORD ist nicht gesetzt.' });
  }
  if (!password || !safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ ok: false, error: 'Falsches Passwort.' });
  }
  res.json({ ok: true, token: makeToken() });
});

app.post('/api/admin/menu-upload', requireAuth, (req, res) => {
  if (!dbReady) {
    return res.status(503).json({ ok: false, error: 'Keine Datenbank verbunden — Upload nicht moeglich.' });
  }
  upload.single('datei')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Datei zu gross (max. 10 MB).' : err.message;
      return res.status(400).json({ ok: false, error: msg });
    }
    const slot = String(req.body.slot || '').trim();
    if (!SLOTS.includes(slot)) return res.status(400).json({ ok: false, error: 'Unbekannter Slot.' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'Keine Datei empfangen.' });
    try {
      await Speisekarte.findOneAndUpdate(
        { slot },
        {
          slot,
          filename: req.file.originalname || `${slot}.pdf`,
          contentType: 'application/pdf',
          size: req.file.size,
          data: req.file.buffer,
          uploadedAt: new Date()
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      res.json({ ok: true, slot, filename: req.file.originalname, size: req.file.size });
    } catch (e) {
      console.error('[upload]', e.message);
      res.status(500).json({ ok: false, error: 'Speichern fehlgeschlagen.' });
    }
  });
});

app.delete('/api/admin/menu/:slot', requireAuth, async (req, res) => {
  const slot = String(req.params.slot);
  if (!SLOTS.includes(slot)) return res.status(400).json({ ok: false, error: 'Unbekannter Slot.' });
  if (!dbReady) return res.status(503).json({ ok: false, error: 'Keine Datenbank verbunden.' });
  try {
    await Speisekarte.deleteOne({ slot });
    res.json({ ok: true, slot });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Loeschen fehlgeschlagen.' });
  }
});

// ------------------------------------------------------------------
//  Geschuetzte Upload-Oberflaeche (/admin)
// ------------------------------------------------------------------
app.get('/admin', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.type('html').send(adminPage());
});

function adminPage() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="robots" content="noindex,nofollow" />
<title>Speisekarte verwalten</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --bg:#14110f; --panel:#1d1916; --line:#332c25;
    --gold:#c9a227; --gold-soft:#e0c878; --text:#f3ead9; --muted:#a99d8b;
  }
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;background:
        radial-gradient(1200px 600px at 80% -10%,rgba(201,162,39,.12),transparent 60%),var(--bg);
        color:var(--text);font-family:'Jost',system-ui,sans-serif;
        display:flex;align-items:flex-start;justify-content:center;padding:48px 18px}
  .wrap{width:100%;max-width:620px}
  h1{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:2.4rem;margin:.2em 0;letter-spacing:.5px}
  .sub{color:var(--muted);margin:0 0 28px;font-weight:300}
  .gold{color:var(--gold-soft)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:26px;margin-bottom:20px}
  label{display:block;font-size:.85rem;color:var(--muted);margin:0 0 7px;letter-spacing:.04em;text-transform:uppercase}
  input[type=password]{width:100%;padding:13px 15px;background:#0f0d0b;border:1px solid var(--line);
        border-radius:10px;color:var(--text);font-size:1rem;font-family:inherit}
  input[type=file]{width:100%;color:var(--muted);font-family:inherit;margin-top:6px}
  input[type=file]::file-selector-button{background:#0f0d0b;color:var(--gold-soft);border:1px solid var(--line);
        padding:9px 14px;border-radius:8px;margin-right:12px;cursor:pointer;font-family:inherit}
  button{cursor:pointer;font-family:inherit}
  .btn{display:inline-flex;align-items:center;gap:8px;background:linear-gradient(135deg,var(--gold),#a9851d);
        color:#1a1408;border:none;padding:12px 22px;border-radius:999px;font-weight:500;font-size:.98rem;
        letter-spacing:.03em;transition:transform .15s ease,box-shadow .15s ease}
  .btn:hover{transform:translateY(-2px);box-shadow:0 10px 24px -10px rgba(201,162,39,.6)}
  .btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line)}
  .btn.ghost:hover{color:var(--text);box-shadow:none}
  .slot{border:1px solid var(--line);border-radius:13px;padding:18px;margin-top:16px}
  .slot h3{margin:0 0 4px;font-family:'Cormorant Garamond',serif;font-weight:600;font-size:1.45rem}
  .state{font-size:.88rem;color:var(--muted);margin:0 0 12px}
  .state.has{color:var(--gold-soft)}
  .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px}
  .msg{margin-top:14px;font-size:.9rem;min-height:1.2em}
  .msg.ok{color:#8fce9b}.msg.err{color:#e58a7a}
  .hidden{display:none}
  a.small{color:var(--muted);font-size:.85rem;text-decoration:none;border-bottom:1px dotted var(--line)}
  .top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
</style>
</head>
<body>
<div class="wrap">

  <div id="loginView">
    <h1>Speisekarte <span class="gold">verwalten</span></h1>
    <p class="sub">Melde dich an, um die Speisekarte deiner Pizzeria hochzuladen oder zu ersetzen.</p>
    <div class="card">
      <label for="pw">Passwort</label>
      <input id="pw" type="password" placeholder="Inhaber-Passwort" autocomplete="current-password" />
      <div class="row"><button class="btn" id="loginBtn">Anmelden</button></div>
      <div class="msg" id="loginMsg"></div>
    </div>
    <p><a class="small" href="/">&larr; Zurueck zur Website</a></p>
  </div>

  <div id="panelView" class="hidden">
    <div class="top">
      <div>
        <h1>Speisekarte <span class="gold">verwalten</span></h1>
        <p class="sub" style="margin:0">Lade dein PDF hoch — es erscheint sofort auf der Website.</p>
      </div>
      <button class="btn ghost" id="logoutBtn">Abmelden</button>
    </div>
    <div id="dbWarn" class="card hidden" style="border-color:#5a3a2a;background:#241813">
      <strong class="gold">Hinweis:</strong> Es ist keine Datenbank verbunden — der Upload ist deaktiviert.
      Bitte <code>MONGODB_URI</code> in der Server-Umgebung setzen.
    </div>
    <div class="card">
      <div id="slots"></div>
    </div>
    <p><a class="small" href="/">&larr; Zur Website ansehen</a></p>
  </div>

</div>

<script>
const SLOTS = [
  { key:'restaurant', titel:'Speisekarte Restaurant', hint:'Karte fuer den Verzehr vor Ort' },
  { key:'togo',       titel:'Speisekarte TO GO',      hint:'Karte fuer Abholung / Lieferung' }
];
const tokenKey = 'pizzeria_admin_token';

function token(){ return localStorage.getItem(tokenKey) || ''; }
function setToken(t){ t ? localStorage.setItem(tokenKey,t) : localStorage.removeItem(tokenKey); }
function fmtDate(d){ try{ return new Date(d).toLocaleString('de-DE'); }catch{ return ''; } }
function fmtSize(b){ return b ? (b/1024/1024).toFixed(1).replace('.',',')+' MB' : ''; }

async function login(){
  const msg = document.getElementById('loginMsg'); msg.textContent=''; msg.className='msg';
  const password = document.getElementById('pw').value;
  try{
    const r = await fetch('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},
                body:JSON.stringify({password})});
    const j = await r.json();
    if(!r.ok || !j.ok){ msg.textContent = j.error || 'Anmeldung fehlgeschlagen.'; msg.className='msg err'; return; }
    setToken(j.token); showPanel();
  }catch(e){ msg.textContent='Verbindungsfehler.'; msg.className='msg err'; }
}

function logout(){ setToken(''); document.getElementById('panelView').classList.add('hidden');
  document.getElementById('loginView').classList.remove('hidden'); document.getElementById('pw').value=''; }

async function showPanel(){
  document.getElementById('loginView').classList.add('hidden');
  document.getElementById('panelView').classList.remove('hidden');
  await renderSlots();
}

async function renderSlots(){
  let meta = { slots:{}, dbConnected:true };
  try{ meta = await (await fetch('/api/speisekarte/meta',{cache:'no-store'})).json(); }catch{}
  document.getElementById('dbWarn').classList.toggle('hidden', meta.dbConnected !== false);
  const host = document.getElementById('slots');
  host.innerHTML = SLOTS.map(s=>{
    const m = meta.slots && meta.slots[s.key];
    const has = !!m;
    const state = has
      ? '<p class="state has">Hochgeladen: '+(m.filename||'')+' &middot; '+fmtSize(m.size)+' &middot; '+fmtDate(m.uploadedAt)+'</p>'
      : '<p class="state">Noch keine Karte hinterlegt.</p>';
    return '<div class="slot">'
      + '<h3>'+s.titel+'</h3>'
      + '<p class="state">'+s.hint+'</p>'
      + state
      + '<input type="file" accept="application/pdf" id="file_'+s.key+'" />'
      + '<div class="row">'
      +   '<button class="btn" data-up="'+s.key+'">'+(has?'Ersetzen':'Hochladen')+'</button>'
      +   (has?'<a class="btn ghost" href="/api/speisekarte/'+s.key+'.pdf" target="_blank" rel="noopener">Ansehen</a>':'')
      +   (has?'<button class="btn ghost" data-del="'+s.key+'">Entfernen</button>':'')
      + '</div>'
      + '<div class="msg" id="msg_'+s.key+'"></div>'
      + '</div>';
  }).join('');

  host.querySelectorAll('[data-up]').forEach(b=>b.onclick=()=>doUpload(b.getAttribute('data-up')));
  host.querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>doDelete(b.getAttribute('data-del')));
}

async function doUpload(slot){
  const msg = document.getElementById('msg_'+slot); msg.textContent=''; msg.className='msg';
  const input = document.getElementById('file_'+slot);
  const file = input.files && input.files[0];
  if(!file){ msg.textContent='Bitte zuerst eine PDF-Datei waehlen.'; msg.className='msg err'; return; }
  const fd = new FormData(); fd.append('slot', slot); fd.append('datei', file);
  msg.textContent='Lade hoch…';
  try{
    const r = await fetch('/api/admin/menu-upload',{method:'POST',
                headers:{'Authorization':'Bearer '+token()}, body:fd});
    const j = await r.json();
    if(r.status===401){ logout(); return; }
    if(!r.ok || !j.ok){ msg.textContent = j.error || 'Upload fehlgeschlagen.'; msg.className='msg err'; return; }
    msg.textContent='Erfolgreich hochgeladen.'; msg.className='msg ok';
    await renderSlots();
  }catch(e){ msg.textContent='Verbindungsfehler.'; msg.className='msg err'; }
}

async function doDelete(slot){
  const msg = document.getElementById('msg_'+slot); msg.textContent=''; msg.className='msg';
  if(!confirm('Diese Speisekarte wirklich entfernen?')) return;
  try{
    const r = await fetch('/api/admin/menu/'+slot,{method:'DELETE',headers:{'Authorization':'Bearer '+token()}});
    if(r.status===401){ logout(); return; }
    const j = await r.json();
    if(!r.ok || !j.ok){ msg.textContent = j.error || 'Entfernen fehlgeschlagen.'; msg.className='msg err'; return; }
    await renderSlots();
  }catch(e){ msg.textContent='Verbindungsfehler.'; msg.className='msg err'; }
}

document.getElementById('loginBtn').onclick = login;
document.getElementById('pw').addEventListener('keydown',e=>{ if(e.key==='Enter') login(); });
document.getElementById('logoutBtn').onclick = logout;

// Bereits angemeldet? Direkt Panel zeigen.
if(token()) showPanel();
</script>
</body>
</html>`;
}

// ------------------------------------------------------------------
//  Start
// ------------------------------------------------------------------
connectDb().finally(() => {
  app.listen(PORT, () => console.log(`[server] laeuft auf http://localhost:${PORT}`));
});
