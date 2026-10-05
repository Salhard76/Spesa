/* ============================================================
   Il Mio Budget - app.js v2.3
   Fix applicate:
   - Date TZ-safe (oggiISO / parseData / fmtData)
   - PBKDF2 + salt per il PIN (con migrazione dal vecchio SHA-256)
   - Rate-limiting PIN (5 tentativi -> 30s di blocco)
   - Service Worker con path relativo
   - crypto.randomUUID() per gli ID
   - bioSupported() booleano + try/catch
   - Debounce sulla ricerca
   - Chip categorie dinamiche
   - Pulsante "Rimuovi PIN" nascosto se non c'è PIN
   - crypto.subtle check (contesto sicuro)
   ============================================================ */

const STORAGE_KEY   = 'budget-app-data-v2';
const BALANCE_KEY   = 'budget-app-balance-v2';
const BUDGET_KEY    = 'budget-app-budget-v2';
const PIN_HASH_KEY  = 'budget-app-pinhash-v2';
const PIN_SALT_KEY  = 'budget-app-pinsalt-v2';
const BIO_KEY       = 'budget-app-bio-v2';
const BIO_CRED_KEY  = 'budget-app-bio-cred-v2';
const CRON_KEY      = 'budget-app-cron-open-v1';
const DEFAULT_BALANCE = 0;
const CATS = ['Spesa','Extra','Fissa','Stipendio','Prelievo','Altro'];

let movimenti = [];
let saldoIniziale = DEFAULT_BALANCE;
let budgetCategorie = {};
let filtroAttivo = 'all';
let meseAttivo = 'all';
let testoRicerca = '';
let pinBuffer = '', pinMode = 'unlock', pinTemp = '', unlocked = false;
let pinAttempts = 0, pinLockUntil = 0;

/* ---------- HELPERS ---------- */
const $ = (id) => document.getElementById(id);
const fmtEUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });
const pad2 = (n) => String(n).padStart(2, '0');
const oggiISO = () => {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
};
const parseData = (iso) => {
  const [a, m, g] = String(iso).split('-').map(Number);
  return new Date(a, (m || 1) - 1, g || 1);
};
const fmtData = (iso) => {
  const d = parseData(iso);
  return isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
};
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const meseKey = (iso) => String(iso).slice(0, 7);
const nomeMese = (k) => {
  const [a, m] = k.split('-');
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
};
const nomeMeseBreve = (k) => {
  const [a, m] = k.split('-');
  return new Date(Number(a), Number(m) - 1, 1).toLocaleDateString('it-IT', { month: 'short' });
};
const uid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Date.now() + '-' + Math.random().toString(36).slice(2, 10);
const cryptoAvail = () =>
  typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function';

function toast(msg, tipo = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

/* ---------- CRYPTO / PIN (PBKDF2 + salt) ---------- */
async function derivePin(pin, saltB64) {
  const enc = new TextEncoder();
  let salt;
  if (saltB64) salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  else salt = crypto.getRandomValues(new Uint8Array(16));

  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    key, 256
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
  const saltOut = btoa(String.fromCharCode(...salt));
  return { salt: saltOut, hash };
}
function getPinHash() { return localStorage.getItem(PIN_HASH_KEY); }
function hasPinSet()  { return !!getPinHash(); }

async function setPin(pin) {
  if (!cryptoAvail()) throw new Error('Crittografia non disponibile (serve HTTPS o localhost).');
  const { salt, hash } = await derivePin(pin);
  localStorage.setItem(PIN_HASH_KEY, hash);
  localStorage.setItem(PIN_SALT_KEY, salt);
}
async function legacyVerifyPin(pin) {
  if (!cryptoAvail()) return false;
  const buf = new TextEncoder().encode('budget-pin-' + pin);
  const h = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return hex === getPinHash();
}
async function verifyPin(pin) {
  const hash = getPinHash();
  if (!hash) return false;
  const salt = localStorage.getItem(PIN_SALT_KEY);
  if (!salt) {
    // migrazione trasparente dal vecchio SHA-256 senza salt
    if (await legacyVerifyPin(pin)) { try { await setPin(pin); } catch (e) {} return true; }
    return false;
  }
  try { const out = await derivePin(pin, salt); return out.hash === hash; }
  catch (e) { return false; }
}
function removePin() {
  localStorage.removeItem(PIN_HASH_KEY);
  localStorage.removeItem(PIN_SALT_KEY);
  removeBio();
}

/* ---------- BIOMETRIA ---------- */
const bioSupported = () =>
  typeof window.PublicKeyCredential !== 'undefined' &&
  typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';

function isBioActive() {
  return localStorage.getItem(BIO_KEY) === 'true' && !!localStorage.getItem(BIO_CRED_KEY);
}
async function activateBio() {
  if (!bioSupported()) return toast('Biometria non supportata', 'error');
  let avail = false;
  try { avail = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); } catch (e) {}
  if (!avail) return toast('Nessun sensore biometrico disponibile', 'error');
  try {
    const challenge = new Uint8Array(32); crypto.getRandomValues(challenge);
    const uidBuf = new Uint8Array(16);   crypto.getRandomValues(uidBuf);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Il Mio Budget', id: location.hostname },
        user: { id: uidBuf, name: 'utente@budget', displayName: 'Budget' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60000,
        attestation: 'none'
      }
    });
    if (cred) {
      localStorage.setItem(BIO_KEY, 'true');
      const rawId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
      localStorage.setItem(BIO_CRED_KEY, rawId);
      toast('Impronta attivata', 'success');
      updateSecurityModal();
      return true;
    }
  } catch (e) {
    if (e.name === 'NotAllowedError') toast('Operazione annullata', 'info');
    else toast('Errore: ' + e.message, 'error');
  }
  return false;
}
function removeBio() {
  localStorage.removeItem(BIO_KEY);
  localStorage.removeItem(BIO_CRED_KEY);
}
async function unlockBio() {
  const rawId = localStorage.getItem(BIO_CRED_KEY);
  if (!rawId) return false;
  try {
    const challenge = new Uint8Array(32); crypto.getRandomValues(challenge);
    const idBin = Uint8Array.from(atob(rawId), (c) => c.charCodeAt(0));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ type: 'public-key', id: idBin }],
        userVerification: 'required',
        timeout: 60000
      }
    });
    return !!assertion;
  } catch (e) { return false; }
}

/* ---------- LOCK SCREEN ---------- */
function showLockScreen(mode) {
  pinMode = mode; pinBuffer = ''; pinTemp = '';
  $('lock-screen').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  updateLockUI();
}
function hideLockScreen() {
  $('lock-screen').classList.add('hidden');
  document.body.style.overflow = '';
  unlocked = true;
}
function updateLockUI() {
  const title = $('lock-title'), sub = $('lock-subtitle');
  const disp = $('pin-display'), bioBtn = $('btn-pin-bio');
  if (pinMode === 'unlock')     { title.textContent = 'Inserisci il PIN'; sub.textContent = 'Sblocca per accedere al tuo budget'; }
  else if (pinMode === 'set')   { title.textContent = 'Imposta un PIN';   sub.textContent = 'Scegli 4 cifre per proteggere l\'app'; }
  else if (pinMode === 'confirm'){ title.textContent = 'Ripeti il PIN';   sub.textContent = 'Conferma il PIN scelto'; }
  bioBtn.classList.toggle('hidden', !(pinMode === 'unlock' && isBioActive()));
  disp.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i < pinBuffer.length ? ' filled' : '');
    disp.appendChild(d);
  }
}
async function handlePinDigit(n) {
  if (n === 'del') { pinBuffer = pinBuffer.slice(0, -1); return updateLockUI(); }
  if (n === 'bio') {
    const ok = await unlockBio();
    if (ok) hideLockScreen();
    else toast('Impronta non riconosciuta', 'error');
    return;
  }
  if (pinBuffer.length >= 4) return;
  pinBuffer += n; updateLockUI();

  if (pinBuffer.length === 4) {
    setTimeout(async () => {
      if (pinMode === 'unlock') {
        if (Date.now() < pinLockUntil) {
          const s = Math.ceil((pinLockUntil - Date.now()) / 1000);
          toast(`Troppi tentativi. Attendi ${s}s`, 'error');
          pinBuffer = ''; updateLockUI(); return;
        }
        if (await verifyPin(pinBuffer)) {
          pinAttempts = 0;
          hideLockScreen();
        } else {
          pinAttempts++;
          if (pinAttempts >= 5) {
            pinLockUntil = Date.now() + 30000;
            pinAttempts = 0;
            toast('Troppi tentativi: attendi 30 secondi', 'error');
          } else toast('PIN errato', 'error');
          pinBuffer = ''; updateLockUI();
        }
      } else if (pinMode === 'set') {
        pinTemp = pinBuffer; pinBuffer = ''; pinMode = 'confirm'; updateLockUI();
      } else if (pinMode === 'confirm') {
        if (pinBuffer === pinTemp) {
          try { await setPin(pinBuffer); toast('PIN impostato', 'success'); }
          catch (e) { toast('Errore: ' + e.message, 'error'); }
          pinBuffer = ''; pinTemp = ''; hideLockScreen();
        } else {
          toast('I PIN non coincidono', 'error');
          pinBuffer = ''; pinTemp = ''; pinMode = 'set'; updateLockUI();
        }
      }
    }, 120);
  }
}
function initLockScreen() {
  $('pin-pad').addEventListener('click', (e) => {
    const btn = e.target.closest('button'); if (!btn) return;
    handlePinDigit(btn.dataset.num);
  });
  document.addEventListener('keydown', (e) => {
    if ($('lock-screen').classList.contains('hidden')) return;
    if (/^[0-9]$/.test(e.key)) handlePinDigit(e.key);
    else if (e.key === 'Backspace') handlePinDigit('del');
  });
  $('btn-pin-reset').addEventListener('click', () => {
    if (confirm("Cancellare PIN e TUTTI i dati dell'app? L'operazione è irreversibile.")) {
      localStorage.clear(); location.reload();
    }
  });
}

/* ---------- SICUREZZA (modale) ---------- */
function initSecurity() {
  const btn = $('btn-security'); btn.classList.remove('hidden');
  const modale = $('modale-security');
  btn.addEventListener('click', () => { updateSecurityModal(); modale.classList.remove('hidden'); });
  $('sec-close').addEventListener('click', () => modale.classList.add('hidden'));
  modale.addEventListener('click', (e) => { if (e.target === modale) modale.classList.add('hidden'); });

  $('form-security').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('sec-pin1').value, p2 = $('sec-pin2').value, err = $('sec-error');
    if (!/^\d{4}$/.test(p1)) { err.textContent = 'Il PIN deve avere 4 cifre.'; err.classList.remove('hidden'); return; }
    if (p1 !== p2) { err.textContent = 'I PIN non coincidono.'; err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    try {
      await setPin(p1);
      toast('PIN salvato', 'success');
      updateSecurityModal();
      $('sec-pin1').value = ''; $('sec-pin2').value = '';
    } catch (ex) {
      err.textContent = ex.message; err.classList.remove('hidden');
    }
  });

  $('sec-remove').addEventListener('click', () => {
    if (confirm("Rimuovere il PIN? L'app non sarà più protetta.")) {
      removePin(); toast('PIN rimosso', 'info'); updateSecurityModal();
    }
  });
  $('sec-bio-on').addEventListener('click', activateBio);
  $('sec-bio-off').addEventListener('click', () => { removeBio(); toast('Impronta disattivata', 'info'); updateSecurityModal(); });
}
function updateSecurityModal() {
  const info = $('sec-info'), bioRow = $('sec-bio-row');
  const bioOn = $('sec-bio-on'), bioOff = $('sec-bio-off'), removeBtn = $('sec-remove');
  const hasPin = hasPinSet();
  info.textContent = hasPin ? '✓ PIN attivo' : 'Nessun PIN impostato.';
  removeBtn.classList.toggle('hidden', !hasPin);
  if (hasPin && bioSupported()) {
    bioRow.classList.remove('hidden');
    const active = isBioActive();
    bioOn.classList.toggle('hidden', active);
    bioOff.classList.toggle('hidden', !active);
  } else {
    bioRow.classList.add('hidden');
  }
}

/* ---------- DATI ---------- */
async function caricaDati() {
  const b = localStorage.getItem(BALANCE_KEY);
  saldoIniziale = b !== null ? (parseFloat(b) || 0) : DEFAULT_BALANCE;

  const bg = localStorage.getItem(BUDGET_KEY);
  if (bg) { try { budgetCategorie = JSON.parse(bg); } catch (e) { budgetCategorie = {}; } }

  const s = localStorage.getItem(STORAGE_KEY);
  if (s) {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) { movimenti = p.map(validaMovimento).filter(Boolean); return; }
    } catch (e) {}
  }
  try {
    const res = await fetch('data.json', { cache: 'no-store' });
    const d = await res.json();
    movimenti = Array.isArray(d) ? d.map(validaMovimento).filter(Boolean) : [];
    salvaDati();
  } catch (e) { movimenti = []; }
}
function salvaDati()   { localStorage.setItem(STORAGE_KEY, JSON.stringify(movimenti)); }
function salvaSaldo()  { localStorage.setItem(BALANCE_KEY, String(saldoIniziale)); }
function salvaBudget() { localStorage.setItem(BUDGET_KEY, JSON.stringify(budgetCategorie)); }

function validaMovimento(m) {
  if (!m || typeof m !== 'object') return null;
  const nota = String(m.nota || '').trim();
  const imp  = parseFloat(m.importo);
  const data = String(m.data || '').trim();
  const tipo = m.tipo === 'entrata' ? 'entrata' : 'uscita';
  const cat  = String(m.categoria || 'Altro').trim() || 'Altro';
  if (!nota || nota.length > 80) return null;
  if (!isFinite(imp) || imp <= 0 || imp > 1e9) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  return { id: String(m.id || uid()), data, nota, importo: imp, tipo, categoria: cat };
}

/* ---------- CALCOLI ---------- */
function movimentiDelMese() {
  return meseAttivo === 'all' ? movimenti : movimenti.filter((m) => meseKey(m.data) === meseAttivo);
}
function movimentiVisibili() {
  return movimentiDelMese().slice()
    .sort((a, b) => parseData(b.data) - parseData(a.data))
    .filter((m) => {
      if (filtroAttivo !== 'all') {
        if (filtroAttivo === 'entrata' || filtroAttivo === 'uscita') {
          if (m.tipo !== filtroAttivo) return false;
        } else if (m.categoria !== filtroAttivo) return false;
      }
      if (testoRicerca) {
        const q = testoRicerca.toLowerCase();
        if (!m.nota.toLowerCase().includes(q) && !m.categoria.toLowerCase().includes(q)) return false;
      }
      return true;
    });
}
function calcolaTotali() {
  const l = movimentiDelMese(); let e = 0, u = 0, x = 0, s = 0;
  for (const m of l) {
    const i = Number(m.importo) || 0;
    if (m.tipo === 'entrata') e += i;
    else { u += i; if (m.categoria === 'Extra') x += i; if (m.categoria === 'Spesa') s += i; }
  }
  return { entrate: e, uscite: u, extra: x, spesa: s };
}
function saldoTotale() {
  let e = 0, u = 0;
  for (const m of movimenti) {
    const i = Number(m.importo) || 0;
    if (m.tipo === 'entrata') e += i; else u += i;
  }
  return saldoIniziale + e - u;
}
function totaleCategoria(cat, mese) {
  return movimenti
    .filter((m) => m.tipo === 'uscita' && m.categoria === cat && (!mese || meseKey(m.data) === mese))
    .reduce((s, m) => s + Number(m.importo), 0);
}

/* ---------- RENDER ---------- */
function renderSaldo() {
  const s = saldoTotale(), el = $('saldo-attuale');
  el.textContent = fmtEUR.format(s);
  el.classList.toggle('positive', s >= 0);
  el.classList.toggle('negative', s < 0);
  $('saldo-updated').textContent = 'aggiornato ' + new Date().toLocaleString('it-IT',
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function renderRiepilogo() {
  const t = calcolaTotali();
  $('tot-entrate').textContent = fmtEUR.format(t.entrate);
  $('tot-uscite').textContent  = fmtEUR.format(t.uscite);
  $('tot-extra').textContent   = fmtEUR.format(t.extra);
  $('tot-spesa').textContent   = fmtEUR.format(t.spesa);
}
function renderTrend() {
  const c = $('trend-chart'), oggi = new Date(), mesi = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(oggi.getFullYear(), oggi.getMonth() - i, 1);
    mesi.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`);
  }
  const dati = mesi.map((k) => {
    const l = movimenti.filter((m) => meseKey(m.data) === k);
    return {
      key: k,
      entrate: l.filter((m) => m.tipo === 'entrata').reduce((s, m) => s + Number(m.importo), 0),
      uscite:  l.filter((m) => m.tipo === 'uscita').reduce((s, m) => s + Number(m.importo), 0)
    };
  });
  const max = Math.max(...dati.flatMap((d) => [d.entrate, d.uscite]), 1);
  let h = '<div class="trend-bars">';
  for (const d of dati) {
    const hE = Math.max((d.entrate / max) * 80, 2);
    const hU = Math.max((d.uscite / max) * 80, 2);
    h += `<div class="trend-col"><div class="trend-bar-group"><div class="trend-bar entrata" style="height:${hE}px" title="Entrate: ${fmtEUR.format(d.entrate)}"></div><div class="trend-bar uscita" style="height:${hU}px" title="Uscite: ${fmtEUR.format(d.uscite)}"></div></div><span class="trend-label">${nomeMeseBreve(d.key)}</span></div>`;
  }
  h += '</div><div class="trend-legend"><span><span style="background:var(--success)"></span>Entrate</span><span><span style="background:var(--danger)"></span>Uscite</span></div>';
  c.innerHTML = h;
}
function renderGrafico() {
  const c = $('grafico-categorie');
  const u = movimentiDelMese().filter((m) => m.tipo === 'uscita');
  if (u.length === 0) {
    c.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:.5rem">Nessuna spesa nel periodo</p>';
    return;
  }
  const per = {};
  for (const m of u) per[m.categoria] = (per[m.categoria] || 0) + Number(m.importo);
  const voci = Object.entries(per).sort((a, b) => b[1] - a[1]);
  const max = voci[0][1];
  const colors = { Spesa:'#22c55e', Extra:'#f59e0b', Fissa:'#3b82f6', Prelievo:'#8b5cf6', Stipendio:'#06b6d4', Altro:'#94a3b8' };
  let h = '<div class="chart-bars">';
  for (const [cat, imp] of voci) {
    const pct = (imp / max) * 100, col = colors[cat] || '#94a3b8';
    h += `<div class="chart-row"><span class="chart-label">${escapeHtml(cat)}</span><div class="chart-bar-wrapper"><div class="chart-bar" style="width:${pct}%;background:${col}"></div></div><span class="chart-value">${fmtEUR.format(imp)}</span></div>`;
  }
  h += '</div>'; c.innerHTML = h;
}
function renderBudget() {
  const c = $('budget-list');
  const cats = Object.keys(budgetCategorie).filter((k) => budgetCategorie[k] > 0);
  if (cats.length === 0) {
    c.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:.8rem;padding:.5rem">Nessun budget impostato. Clicca ⚙️ per configurarlo.</p>';
    return;
  }
  const meseC = meseAttivo === 'all'
    ? `${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`
    : meseAttivo;
  let h = ''; const superati = [];
  for (const cat of cats) {
    const lim = budgetCategorie[cat];
    const sp = totaleCategoria(cat, meseC);
    const pct = Math.min((sp / lim) * 100, 100);
    let col;
    if (sp > lim) { col = 'var(--danger)'; superati.push(cat); }
    else if (pct >= 80) col = 'var(--warning)';
    else col = 'var(--success)';
    h += `<div class="budget-item"><span class="budget-label">${escapeHtml(cat)}</span><div class="budget-bar-wrapper"><div class="budget-bar" style="width:${pct}%;background:${col}"></div></div><span class="budget-value ${sp > lim ? 'exceeded' : ''}">${fmtEUR.format(sp)} / ${fmtEUR.format(lim)}</span></div>`;
  }
  if (superati.length > 0) h += `<p style="margin-top:.5rem;font-size:.75rem;color:var(--danger);text-align:center">⚠️ Budget superato: ${superati.join(', ')}</p>`;
  c.innerHTML = h;
}
function renderCronologico() {
  const body = $('cron-body'), foot = $('cron-foot'), hint = $('cron-hint'), wrap = $('cron-wrapper');
  if (!wrap || wrap.classList.contains('hidden')) return;

  const tutti = movimenti.slice().sort((a, b) => {
    const d = parseData(a.data) - parseData(b.data);
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id));
  });
  let saldo = saldoIniziale;
  const conSaldo = tutti.map((m) => {
    const imp = Number(m.importo) || 0;
    saldo += m.tipo === 'entrata' ? imp : -imp;
    return { ...m, _saldo: saldo };
  });

  let filtrati = conSaldo;
  if (meseAttivo !== 'all') filtrati = filtrati.filter((m) => meseKey(m.data) === meseAttivo);
  if (testoRicerca) {
    const q = testoRicerca.toLowerCase();
    filtrati = filtrati.filter((m) => m.nota.toLowerCase().includes(q) || m.categoria.toLowerCase().includes(q));
  }
  if (filtrati.length === 0) {
    body.innerHTML = '<tr><td colspan="5" class="cron-empty">Nessun movimento nel periodo</td></tr>';
    foot.innerHTML = ''; hint.textContent = '';
    return;
  }
  const primo = filtrati[0], idxPrimo = conSaldo.indexOf(primo);
  const saldoInizioPeriodo = idxPrimo > 0 ? conSaldo[idxPrimo - 1]._saldo : saldoIniziale;

  let h = '', sommaE = 0, sommaU = 0;
  for (const m of filtrati) {
    const e = m.tipo === 'entrata' ? Number(m.importo) : 0;
    const u = m.tipo === 'uscita'  ? Number(m.importo) : 0;
    sommaE += e; sommaU += u;
    const cls = m._saldo < 0 ? 'neg' : 'pos';
    h += `<tr><td>${fmtData(m.data)}</td><td class="desc">${escapeHtml(m.nota)}<br><span style="color:var(--text-muted);font-size:.7rem">${escapeHtml(m.categoria)}</span></td><td class="right in">${e ? fmtEUR.format(e) : '—'}</td><td class="right out">${u ? fmtEUR.format(u) : '—'}</td><td class="right saldo ${cls}">${fmtEUR.format(m._saldo)}</td></tr>`;
  }
  body.innerHTML = h;
  const saldoFinale = filtrati[filtrati.length - 1]._saldo;
  foot.innerHTML = `<tr><td colspan="2">Totale periodo</td><td class="right in">${fmtEUR.format(sommaE)}</td><td class="right out">${fmtEUR.format(sommaU)}</td><td class="right saldo ${saldoFinale < 0 ? 'neg' : 'pos'}">${fmtEUR.format(saldoFinale)}</td></tr>`;
  const netto = sommaE - sommaU;
  hint.textContent = `Saldo inizio periodo: ${fmtEUR.format(saldoInizioPeriodo)} · Netto: ${netto >= 0 ? '+' : ''}${fmtEUR.format(netto)} · Movimenti: ${filtrati.length}`;
}
function renderLista() {
  const ul = $('lista-movimenti'); ul.innerHTML = '';
  const f = movimentiVisibili();
  if (f.length === 0) {
    ul.innerHTML = '<li style="text-align:center;color:var(--text-muted);padding:1rem">Nessun movimento</li>';
    return;
  }
  for (const m of f) {
    const li = document.createElement('li');
    const cE = m.categoria === 'Extra' ? ' extra' : '';
    li.className = `movimento ${m.tipo}${cE}`;
    const seg = m.tipo === 'entrata' ? '+' : '−';
    li.innerHTML = `<div class="mov-info"><span class="mov-nota">${escapeHtml(m.nota)}</span><span class="mov-meta">${fmtData(m.data)} · ${escapeHtml(m.categoria)}</span></div><div style="display:flex;align-items:center"><span class="mov-importo ${m.tipo}">${seg} ${fmtEUR.format(m.importo)}</span><button class="mov-modifica" data-id="${m.id}" title="Modifica">✎</button><button class="mov-elimina" data-id="${m.id}" title="Elimina">✕</button></div>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll('.mov-elimina').forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.id;
    const m = movimenti.find((x) => String(x.id) === String(id));
    if (!m) return;
    if (confirm(`Eliminare "${m.nota}"?`)) {
      movimenti = movimenti.filter((x) => String(x.id) !== String(id));
      salvaDati(); renderTutto();
      toast('Movimento eliminato', 'success');
    }
  }));
  ul.querySelectorAll('.mov-modifica').forEach((b) =>
    b.addEventListener('click', () => apriModaleEdit(b.dataset.id))
  );
}
function renderSelettoreMese() {
  const s = $('selettore-mese');
  const mesi = Array.from(new Set(movimenti.map((m) => meseKey(m.data))))
    .filter((k) => /^\d{4}-\d{2}$/.test(k))
    .sort((a, b) => b.localeCompare(a));
  const cur = s.value;
  s.innerHTML = '<option value="all">Tutti i mesi</option>';
  for (const k of mesi) {
    const o = document.createElement('option');
    o.value = k; o.textContent = nomeMese(k);
    s.appendChild(o);
  }
  if ([...s.options].some((o) => o.value === cur)) { s.value = cur; meseAttivo = cur; }
  else { meseAttivo = 'all'; s.value = 'all'; }
}
function renderTutto() {
  renderSaldo(); renderRiepilogo(); renderTrend(); renderGrafico();
  renderBudget(); renderLista(); renderSelettoreMese(); renderCronologico();
}

/* ---------- FORM ---------- */
function mostraErr(id, msg) {
  const el = $(id);
  el.textContent = msg; el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}
function initForm() {
  const f = $('form-movimento'), d = $('input-data');
  d.value = oggiISO();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const tipo = $('input-tipo').value;
    const nota = $('input-nota').value.trim();
    const impStr = $('input-importo').value;
    const cat = $('input-categoria').value;
    const data = d.value;

    if (!data) return mostraErr('form-error', 'Inserisci una data.');
    if (!nota) return mostraErr('form-error', 'Inserisci una descrizione.');
    if (nota.length > 80) return mostraErr('form-error', 'Descrizione troppo lunga.');
    const imp = parseFloat(impStr);
    if (!isFinite(imp) || imp <= 0) return mostraErr('form-error', 'Importo > 0.');
    if (imp > 1e9) return mostraErr('form-error', 'Importo troppo grande.');

    const nv = validaMovimento({ id: uid(), data, nota, importo: imp, tipo, categoria: cat });
    if (!nv) return mostraErr('form-error', 'Dati non validi.');

    movimenti.push(nv); salvaDati(); renderTutto();
    f.reset(); d.value = oggiISO();
    toast('Movimento aggiunto', 'success');
  });
}
function apriModaleEdit(id) {
  const m = movimenti.find((x) => String(x.id) === String(id)); if (!m) return;
  $('edit-id').value = m.id;
  $('edit-data').value = m.data;
  $('edit-tipo').value = m.tipo;
  $('edit-nota').value = m.nota;
  $('edit-importo').value = m.importo;
  $('edit-categoria').value = m.categoria;
  $('edit-error').classList.add('hidden');
  $('modale-edit').classList.remove('hidden');
}
function chiudiModaleEdit() { $('modale-edit').classList.add('hidden'); }
function initModaleEdit() {
  const f = $('form-edit'), a = $('edit-annulla'), mod = $('modale-edit');
  a.addEventListener('click', chiudiModaleEdit);
  mod.addEventListener('click', (e) => { if (e.target === mod) chiudiModaleEdit(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = $('edit-id').value;
    const idx = movimenti.findIndex((x) => String(x.id) === String(id));
    if (idx === -1) return;
    const nota = $('edit-nota').value.trim();
    const imp = parseFloat($('edit-importo').value);
    const data = $('edit-data').value;
    if (!data || !nota) return mostraErr('edit-error', 'Compila tutti i campi.');
    if (!isFinite(imp) || imp <= 0) return mostraErr('edit-error', 'Importo non valido.');
    const up = validaMovimento({
      ...movimenti[idx], data, tipo: $('edit-tipo').value, nota, importo: imp, categoria: $('edit-categoria').value
    });
    if (!up) return mostraErr('edit-error', 'Dati non validi.');
    movimenti[idx] = up; salvaDati(); renderTutto(); chiudiModaleEdit();
    toast('Movimento aggiornato', 'success');
  });
}
function initModaleSaldo() {
  $('btn-edit-saldo').addEventListener('click', () => {
    $('saldo-iniziale-input').value = saldoIniziale;
    $('saldo-error').classList.add('hidden');
    $('modale-saldo').classList.remove('hidden');
  });
  $('saldo-annulla').addEventListener('click', () => $('modale-saldo').classList.add('hidden'));
  const mod = $('modale-saldo');
  mod.addEventListener('click', (e) => { if (e.target === mod) mod.classList.add('hidden'); });
  $('form-saldo').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseFloat($('saldo-iniziale-input').value);
    if (!isFinite(v)) { mostraErr('saldo-error', 'Inserisci un numero valido.'); return; }
    saldoIniziale = v; salvaSaldo(); renderTutto();
    mod.classList.add('hidden'); toast('Saldo aggiornato', 'success');
  });
}
function initModaleBudget() {
  const mod = $('modale-budget');
  $('btn-edit-budget').addEventListener('click', () => {
    const cont = $('budget-inputs'); cont.innerHTML = '';
    for (const cat of CATS) {
      const val = budgetCategorie[cat] || '';
      const row = document.createElement('div');
      row.className = 'budget-input-row';
      row.innerHTML = `<label>${cat}</label><input type="number" data-cat="${cat}" step="0.01" min="0" placeholder="0" value="${val}">`;
      cont.appendChild(row);
    }
    mod.classList.remove('hidden');
  });
  $('budget-annulla').addEventListener('click', () => mod.classList.add('hidden'));
  mod.addEventListener('click', (e) => { if (e.target === mod) mod.classList.add('hidden'); });
  $('form-budget').addEventListener('submit', (e) => {
    e.preventDefault();
    budgetCategorie = {};
    document.querySelectorAll('#budget-inputs input').forEach((inp) => {
      const v = parseFloat(inp.value);
      if (isFinite(v) && v > 0) budgetCategorie[inp.dataset.cat] = v;
    });
    salvaBudget(); renderBudget(); mod.classList.add('hidden');
    toast('Budget salvato', 'success');
  });
}
function initFiltri() {
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    filtroAttivo = c.dataset.filter;
    renderLista(); renderCronologico();
  }));
  $('selettore-mese').addEventListener('change', (e) => {
    meseAttivo = e.target.value;
    renderRiepilogo(); renderGrafico(); renderBudget(); renderLista(); renderCronologico();
  });
  // Debounce ricerca
  let to;
  $('search-input').addEventListener('input', (e) => {
    clearTimeout(to);
    to = setTimeout(() => {
      testoRicerca = e.target.value.trim();
      renderLista(); renderCronologico();
    }, 150);
  });
}
function initCronologico() {
  const btn = $('btn-toggle-cron'), wrap = $('cron-wrapper');
  if (localStorage.getItem(CRON_KEY) === 'true') { wrap.classList.remove('hidden'); btn.textContent = '▴'; }
  btn.addEventListener('click', () => {
    const open = wrap.classList.contains('hidden');
    wrap.classList.toggle('hidden', !open);
    btn.textContent = open ? '▴' : '▾';
    localStorage.setItem(CRON_KEY, String(open));
    if (open) renderCronologico();
  });
}
function initAzioni() {
  $('btn-export').addEventListener('click', () => {
    const p = {
      versione: 2.3,
      esportato_il: new Date().toISOString(),
      saldo_iniziale: saldoIniziale,
      budget: budgetCategorie,
      movimenti
    };
    const b = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
    const u = URL.createObjectURL(b), a = document.createElement('a');
    a.href = u;
    a.download = `budget-backup-${oggiISO()}.json`;
    a.click(); URL.revokeObjectURL(u);
    toast('Backup esportato', 'success');
  });
  const fi = document.createElement('input');
  fi.type = 'file'; fi.accept = '.json,application/json';
  fi.addEventListener('change', async (ev) => {
    const file = ev.target.files[0]; if (!file) return;
    try {
      const t = await file.text(), d = JSON.parse(t);
      let nm = [], nb = saldoIniziale, nbudg = budgetCategorie;
      if (Array.isArray(d)) nm = d.map(validaMovimento).filter(Boolean);
      else if (d && Array.isArray(d.movimenti)) {
        nm = d.movimenti.map(validaMovimento).filter(Boolean);
        if (typeof d.saldo_iniziale === 'number') nb = d.saldo_iniziale;
        if (d.budget) nbudg = d.budget;
      } else throw new Error('Formato non riconosciuto');
      if (nm.length === 0) throw new Error('Nessun movimento valido');
      if (!confirm(`Importare ${nm.length} movimenti? I dati attuali verranno sostituiti.`)) return;
      movimenti = nm; saldoIniziale = nb; budgetCategorie = nbudg;
      salvaDati(); salvaSaldo(); salvaBudget(); renderTutto();
      toast(`Importati ${nm.length} movimenti`, 'success');
    } catch (err) { toast('Errore: ' + err.message, 'error'); }
    finally { ev.target.value = ''; }
  });
  $('btn-import').addEventListener('click', () => fi.click());
  $('btn-reset').addEventListener('click', () => {
    if (confirm("Cancellare TUTTI i dati? L'operazione è irreversibile.")) { localStorage.clear(); location.reload(); }
  });
}

/* ---------- PWA ---------- */
let deferredPrompt = null;
function initPWA() {
  const b = $('btn-install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e; b.classList.remove('hidden');
  });
  b.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null; b.classList.add('hidden');
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

/* ---------- GLOBALI ---------- */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    chiudiModaleEdit();
    $('modale-saldo').classList.add('hidden');
    $('modale-budget').classList.add('hidden');
    $('modale-security').classList.add('hidden');
  }
});

async function init() {
  await caricaDati();
  initForm(); initFiltri(); initAzioni(); initPWA();
  initModaleEdit(); initModaleSaldo(); initModaleBudget();
  initLockScreen(); initSecurity(); initCronologico();
  updateSecurityModal();
  if (hasPinSet()) showLockScreen('unlock'); else unlocked = true;
  renderTutto();
}
document.addEventListener('DOMContentLoaded', init);