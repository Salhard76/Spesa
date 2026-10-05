/* ============================================================
   IL MIO BUDGET - v2.0
   - Saldo iniziale dinamico
   - Grafico uscite per categoria (SVG puro)
   - Filtro mese/anno
   - Validazione form + import JSON
   ============================================================ */

const STORAGE_KEY = 'budget-app-data-v2';
const BALANCE_KEY = 'budget-app-balance-v2';
const DEFAULT_BALANCE = 0;

// ---------- Stato ----------
let movimenti = [];
let saldoIniziale = DEFAULT_BALANCE;
let filtroAttivo = 'all';
let meseAttivo = 'all';

// ---------- Utility ----------
const fmtEUR = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' });

const fmtData = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
};

const parseData = (iso) => new Date(iso);

const escapeHtml = (str) => String(str).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const meseKey = (iso) => String(iso).slice(0, 7); // "YYYY-MM"

const nomeMese = (key) => {
  const [anno, mese] = key.split('-');
  const d = new Date(Number(anno), Number(mese) - 1, 1);
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
};

// ---------- Toast ----------
function toast(msg, tipo = 'info') {
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ---------- Storage ----------
async function caricaDati() {
  // Saldo iniziale
  const savedBal = localStorage.getItem(BALANCE_KEY);
  saldoIniziale = savedBal !== null ? (parseFloat(savedBal) || 0) : DEFAULT_BALANCE;

  // Movimenti
  const salvato = localStorage.getItem(STORAGE_KEY);
  if (salvato) {
    try {
      const parsed = JSON.parse(salvato);
      if (Array.isArray(parsed)) {
        movimenti = parsed.map(validaMovimento).filter(Boolean);
        return;
      }
    } catch (e) {
      console.warn('localStorage corrotto, ricarico da data.json');
    }
  }
  try {
    const res = await fetch('data.json');
    const data = await res.json();
    movimenti = Array.isArray(data) ? data.map(validaMovimento).filter(Boolean) : [];
    salvaDati();
  } catch (e) {
    movimenti = [];
  }
}

function salvaDati() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(movimenti));
}

function salvaSaldo() {
  localStorage.setItem(BALANCE_KEY, String(saldoIniziale));
}

// ---------- Validazione movimento ----------
function validaMovimento(m) {
  if (!m || typeof m !== 'object') return null;
  const nota = String(m.nota || '').trim();
  const importo = parseFloat(m.importo);
  const data = String(m.data || '').trim();
  const tipo = m.tipo === 'entrata' ? 'entrata' : 'uscita';
  const categoria = String(m.categoria || 'Altro').trim() || 'Altro';

  if (!nota || nota.length > 80) return null;
  if (!isFinite(importo) || importo <= 0 || importo > 1e9) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;

  return {
    id: String(m.id || (Date.now().toString() + Math.random().toString(36).slice(2, 7))),
    data, nota, importo, tipo, categoria
  };
}

// ---------- Filtri ----------
function movimentiDelMese() {
  if (meseAttivo === 'all') return movimenti;
  return movimenti.filter(m => meseKey(m.data) === meseAttivo);
}

function movimentiVisibili() {
  return movimentiDelMese()
    .slice()
    .sort((a, b) => parseData(b.data) - parseData(a.data))
    .filter(m => {
      if (filtroAttivo === 'all') return true;
      if (filtroAttivo === 'entrata' || filtroAttivo === 'uscita') return m.tipo === filtroAttivo;
      return m.categoria === filtroAttivo;
    });
}

// ---------- Calcoli ----------
function calcolaTotali() {
  const lista = movimentiDelMese();
  let entrate = 0, uscite = 0, extra = 0, spesa = 0;

  for (const m of lista) {
    const imp = Number(m.importo) || 0;
    if (m.tipo === 'entrata') entrate += imp;
    else {
      uscite += imp;
      if (m.categoria === 'Extra') extra += imp;
      if (m.categoria === 'Spesa') spesa += imp;
    }
  }
  return { entrate, uscite, extra, spesa };
}

function saldoTotale() {
  let entrate = 0, uscite = 0;
  for (const m of movimenti) {
    const imp = Number(m.importo) || 0;
    if (m.tipo === 'entrata') entrate += imp;
    else uscite += imp;
  }
  return saldoIniziale + entrate - uscite;
}

// ---------- Rendering ----------
function renderSaldo() {
  const saldo = saldoTotale();
  const el = document.getElementById('saldo-attuale');
  el.textContent = fmtEUR.format(saldo);
  el.classList.toggle('positive', saldo >= 0);
  el.classList.toggle('negative', saldo < 0);

  document.getElementById('saldo-updated').textContent =
    'aggiornato ' + new Date().toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function renderRiepilogo() {
  const t = calcolaTotali();
  document.getElementById('tot-entrate').textContent = fmtEUR.format(t.entrate);
  document.getElementById('tot-uscite').textContent  = fmtEUR.format(t.uscite);
  document.getElementById('tot-extra').textContent   = fmtEUR.format(t.extra);
  document.getElementById('tot-spesa').textContent   = fmtEUR.format(t.spesa);
}

function renderGrafico() {
  const container = document.getElementById('grafico-categorie');
  const uscite = movimentiDelMese().filter(m => m.tipo === 'uscita');

  if (uscite.length === 0) {
    container.innerHTML = '<p style="text-align:center;color:var(--text-muted);font-size:0.85rem;padding:0.5rem">Nessuna spesa nel periodo</p>';
    return;
  }

  const perCategoria = {};
  for (const m of uscite) {
    perCategoria[m.categoria] = (perCategoria[m.categoria] || 0) + Number(m.importo);
  }

  const voci = Object.entries(perCategoria).sort((a, b) => b[1] - a[1]);
  const max = voci[0][1];

  const colors = {
    'Spesa': '#22c55e',
    'Extra': '#f59e0b',
    'Fissa': '#3b82f6',
    'Prelievo': '#8b5cf6',
    'Stipendio': '#06b6d4',
    'Altro': '#94a3b8'
  };

  let html = '<div class="chart-bars">';
  for (const [cat, importo] of voci) {
    const pct = (importo / max) * 100;
    const color = colors[cat] || '#94a3b8';
    html += `
      <div class="chart-row">
        <span class="chart-label">${escapeHtml(cat)}</span>
        <div class="chart-bar-wrapper">
          <div class="chart-bar" style="width:${pct}%; background:${color}"></div>
        </div>
        <span class="chart-value">${fmtEUR.format(importo)}</span>
      </div>`;
  }
  html += '</div>';
  container.innerHTML = html;
}

function renderLista() {
  const ul = document.getElementById('lista-movimenti');
  ul.innerHTML = '';

  const filtrati = movimentiVisibili();

  if (filtrati.length === 0) {
    ul.innerHTML = '<li style="text-align:center;color:var(--text-muted);padding:1rem">Nessun movimento</li>';
    return;
  }

  for (const m of filtrati) {
    const li = document.createElement('li');
    const classeExtra = m.categoria === 'Extra' ? ' extra' : '';
    li.className = `movimento ${m.tipo}${classeExtra}`;
    const segno = m.tipo === 'entrata' ? '+' : '−';
    const id = m.id;

    li.innerHTML = `
      <div class="mov-info">
        <span class="mov-nota">${escapeHtml(m.nota)}</span>
        <span class="mov-meta">${fmtData(m.data)} · ${escapeHtml(m.categoria)}</span>
      </div>
      <div style="display:flex;align-items:center">
        <span class="mov-importo ${m.tipo}">${segno} ${fmtEUR.format(m.importo)}</span>
        <button class="mov-modifica" data-id="${id}" title="Modifica">✎</button>
        <button class="mov-elimina" data-id="${id}" title="Elimina">✕</button>
      </div>`;

    ul.appendChild(li);
  }

  ul.querySelectorAll('.mov-elimina').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const m = movimenti.find(x => String(x.id) === String(id));
      if (!m) return;
      if (confirm(`Eliminare "${m.nota}"?`)) {
        movimenti = movimenti.filter(x => String(x.id) !== String(id));
        salvaDati();
        renderTutto();
        toast('Movimento eliminato', 'success');
      }
    });
  });

  ul.querySelectorAll('.mov-modifica').forEach(btn => {
    btn.addEventListener('click', () => apriModaleEdit(btn.dataset.id));
  });
}

function renderSelettoreMese() {
  const sel = document.getElementById('selettore-mese');
  const mesi = Array.from(new Set(movimenti.map(m => meseKey(m.data))))
    .filter(k => /^\d{4}-\d{2}$/.test(k))
    .sort((a, b) => b.localeCompare(a));

  const valueAttuale = sel.value;
  sel.innerHTML = '<option value="all">Tutti i mesi</option>';
  for (const k of mesi) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = nomeMese(k);
    sel.appendChild(opt);
  }

  // Prova a ripristinare la selezione precedente, altrimenti "all"
  if ([...sel.options].some(o => o.value === valueAttuale)) {
    sel.value = valueAttuale;
    meseAttivo = valueAttuale;
  } else {
    meseAttivo = 'all';
    sel.value = 'all';
  }
}

function renderTutto() {
  renderSaldo();
  renderRiepilogo();
  renderGrafico();
  renderLista();
  renderSelettoreMese();
}

// ---------- Form nuovo movimento ----------
function mostraErroreForm(idEl, msg) {
  const el = document.getElementById(idEl);
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

function initForm() {
  const form = document.getElementById('form-movimento');
  const inputData = document.getElementById('input-data');
  inputData.valueAsDate = new Date();

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const tipo = document.getElementById('input-tipo').value;
    const nota = document.getElementById('input-nota').value.trim();
    const importoStr = document.getElementById('input-importo').value;
    const categoria = document.getElementById('input-categoria').value;
    const data = inputData.value;

    if (!data) return mostraErroreForm('form-error', 'Inserisci una data valida.');
    if (!nota) return mostraErroreForm('form-error', 'Inserisci una descrizione.');
    if (nota.length > 80) return mostraErroreForm('form-error', 'Descrizione troppo lunga (max 80).');

    const importo = parseFloat(importoStr);
    if (!isFinite(importo) || importo <= 0) {
      return mostraErroreForm('form-error', 'Inserisci un importo maggiore di 0.');
    }
    if (importo > 1e9) return mostraErroreForm('form-error', 'Importo troppo grande.');

    const nuovo = validaMovimento({
      id: Date.now().toString() + Math.random().toString(36).slice(2, 7),
      data, nota, importo, tipo, categoria
    });
    if (!nuovo) return mostraErroreForm('form-error', 'Dati non validi.');

    movimenti.push(nuovo);
    salvaDati();
    renderTutto();
    form.reset();
    inputData.valueAsDate = new Date();
    toast('Movimento aggiunto', 'success');
  });
}

// ---------- Modale modifica movimento ----------
function apriModaleEdit(id) {
  const m = movimenti.find(x => String(x.id) === String(id));
  if (!m) return;

  document.getElementById('edit-id').value = m.id;
  document.getElementById('edit-data').value = m.data;
  document.getElementById('edit-tipo').value = m.tipo;
  document.getElementById('edit-nota').value = m.nota;
  document.getElementById('edit-importo').value = m.importo;
  document.getElementById('edit-categoria').value = m.categoria;

  document.getElementById('edit-error').classList.add('hidden');
  document.getElementById('modale-edit').classList.remove('hidden');
}

function chiudiModaleEdit() {
  document.getElementById('modale-edit').classList.add('hidden');
}

function initModaleEdit() {
  const form = document.getElementById('form-edit');
  const btnAnnulla = document.getElementById('edit-annulla');
  const modale = document.getElementById('modale-edit');

  btnAnnulla.addEventListener('click', chiudiModaleEdit);
  modale.addEventListener('click', (e) => {
    if (e.target === modale) chiudiModaleEdit();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const idx = movimenti.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return;

    const nota = document.getElementById('edit-nota').value.trim();
    const importo = parseFloat(document.getElementById('edit-importo').value);
    const data = document.getElementById('edit-data').value;

    if (!data || !nota) return mostraErroreForm('edit-error', 'Compila tutti i campi.');
    if (!isFinite(importo) || importo <= 0) return mostraErroreForm('edit-error', 'Importo non valido.');

    const aggiornato = validaMovimento({
      ...movimenti[idx],
      data,
      tipo: document.getElementById('edit-tipo').value,
      nota,
      importo,
      categoria: document.getElementById('edit-categoria').value
    });
    if (!aggiornato) return mostraErroreForm('edit-error', 'Dati non validi.');

    movimenti[idx] = aggiornato;
    salvaDati();
    renderTutto();
    chiudiModaleEdit();
    toast('Movimento aggiornato', 'success');
  });
}

// ---------- Modale saldo iniziale ----------
function apriModaleSaldo() {
  document.getElementById('saldo-iniziale-input').value = saldoIniziale;
  document.getElementById('saldo-error').classList.add('hidden');
  document.getElementById('modale-saldo').classList.remove('hidden');
}

function chiudiModaleSaldo() {
  document.getElementById('modale-saldo').classList.add('hidden');
}

function initModaleSaldo() {
  document.getElementById('btn-edit-saldo').addEventListener('click', apriModaleSaldo);
  document.getElementById('saldo-annulla').addEventListener('click', chiudiModaleSaldo);

  const modale = document.getElementById('modale-saldo');
  modale.addEventListener('click', (e) => {
    if (e.target === modale) chiudiModaleSaldo();
  });

  document.getElementById('form-saldo').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseFloat(document.getElementById('saldo-iniziale-input').value);
    if (!isFinite(v)) {
      const err = document.getElementById('saldo-error');
      err.textContent = 'Inserisci un numero valido (può essere negativo).';
      err.classList.remove('hidden');
      return;
    }
    saldoIniziale = v;
    salvaSaldo();
    renderTutto();
    chiudiModaleSaldo();
    toast('Saldo iniziale aggiornato', 'success');
  });
}

// ---------- Filtri categoria e mese ----------
function initFiltri() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filtroAttivo = chip.dataset.filter;
      renderLista();
    });
  });

  document.getElementById('selettore-mese').addEventListener('change', (e) => {
    meseAttivo = e.target.value;
    renderRiepilogo();
    renderGrafico();
    renderLista();
  });
}

// ---------- Export / Import / Reset ----------
function initAzioni() {
  document.getElementById('btn-export').addEventListener('click', () => {
    const payload = {
      versione: 2,
      esportato_il: new Date().toISOString(),
      saldo_iniziale: saldoIniziale,
      movimenti
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup esportato', 'success');
  });

  // Import
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      let nuoviMov = [];
      let nuovoSaldo = saldoIniziale;

      if (Array.isArray(data)) {
        nuoviMov = data.map(validaMovimento).filter(Boolean);
      } else if (data && Array.isArray(data.movimenti)) {
        nuoviMov = data.movimenti.map(validaMovimento).filter(Boolean);
        if (typeof data.saldo_iniziale === 'number') nuovoSaldo = data.saldo_iniziale;
      } else {
        throw new Error('Formato non riconosciuto');
      }

      if (nuoviMov.length === 0) throw new Error('Nessun movimento valido');

      if (!confirm(`Importare ${nuoviMov.length} movimenti? I dati attuali verranno sostituiti.`)) return;

      movimenti = nuoviMov;
      saldoIniziale = nuovoSaldo;
      salvaDati();
      salvaSaldo();
      renderTutto();
      toast(`Importati ${nuoviMov.length} movimenti`, 'success');
    } catch (err) {
      toast('Errore import: ' + err.message, 'error');
    } finally {
      ev.target.value = '';
    }
  });

  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Cancellare TUTTI i dati (movimenti e saldo iniziale)? L\'operazione è irreversibile.')) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(BALANCE_KEY);
      location.reload();
    }
  });
}

// ---------- PWA install ----------
let deferredPrompt = null;
function initPWA() {
  const btn = document.getElementById('btn-install');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    btn.classList.remove('hidden');
  });

  btn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    btn.classList.add('hidden');
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ---------- ESC chiude i modali ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    chiudiModaleEdit();
    chiudiModaleSaldo();
  }
});

// ---------- Avvio ----------
async function init() {
  await caricaDati();
  initForm();
  initFiltri();
  initAzioni();
  initPWA();
  initModaleEdit();
  initModaleSaldo();
  renderTutto();
}

document.addEventListener('DOMContentLoaded', init);