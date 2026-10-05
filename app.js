/* ============================================================
   IL MIO BUDGET - App logic
   Salva i dati in localStorage. Esporta/importa via JSON.
   ============================================================ */

const STORAGE_KEY = 'budget-app-data-v1';
const INITIAL_BALANCE = 1364.22;

// ---------- Stato applicazione ----------
let movimenti = [];
let filtroAttivo = 'all';

// ---------- Utility ----------
const fmtEUR = new Intl.NumberFormat('it-IT', {
  style: 'currency', currency: 'EUR'
});

const fmtData = (iso) => {
  const d = new Date(iso);
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
};

const parseData = (iso) => new Date(iso);

// ---------- Caricamento / salvataggio ----------
async function caricaDati() {
  const salvato = localStorage.getItem(STORAGE_KEY);
  if (salvato) {
    movimenti = JSON.parse(salvato);
    return;
  }
  // Primo avvio: carica data.json di default
  try {
    const res = await fetch('data.json');
    movimenti = await res.json();
    salvaDati();
  } catch (e) {
    movimenti = [];
  }
}

function salvaDati() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(movimenti));
}

// ---------- Calcoli ----------
function calcolaTotali() {
  let entrate = 0, uscite = 0, extra = 0, spesa = 0;

  for (const m of movimenti) {
    const imp = Number(m.importo) || 0;
    if (m.tipo === 'entrata') {
      entrate += imp;
    } else {
      uscite += imp;
      if (m.categoria === 'Extra') extra += imp;
      if (m.categoria === 'Spesa') spesa += imp;
    }
  }

  const saldo = INITIAL_BALANCE + entrate - uscite;

  return { entrate, uscite, extra, spesa, saldo };
}

// ---------- Rendering ----------
function renderSaldo() {
  const t = calcolaTotali();
  const el = document.getElementById('saldo-attuale');
  el.textContent = fmtEUR.format(t.saldo);
  el.classList.toggle('positive', t.saldo >= 0);
  el.classList.toggle('negative', t.saldo < 0);

  document.getElementById('tot-entrate').textContent = fmtEUR.format(t.entrate);
  document.getElementById('tot-uscite').textContent  = fmtEUR.format(t.uscite);
  document.getElementById('tot-extra').textContent   = fmtEUR.format(t.extra);
  document.getElementById('tot-spesa').textContent   = fmtEUR.format(t.spesa);

  document.getElementById('saldo-updated').textContent =
    'aggiornato ' + new Date().toLocaleString('it-IT', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
    });
}

function renderLista() {
  const ul = document.getElementById('lista-movimenti');
  ul.innerHTML = '';

  const filtrati = movimenti
    .slice()
    .sort((a, b) => parseData(b.data) - parseData(a.data))
    .filter(m => {
      if (filtroAttivo === 'all') return true;
      if (filtroAttivo === 'entrata' || filtroAttivo === 'uscita') return m.tipo === filtroAttivo;
      return m.categoria === filtroAttivo;
    });

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
        <span class="mov-meta">${fmtData(m.data)} · ${m.categoria}</span>
      </div>
      <div style="display:flex;align-items:center">
        <span class="mov-importo ${m.tipo}">${segno} ${fmtEUR.format(m.importo)}</span>
        <button class="mov-modifica" data-id="${id}" title="Modifica">✎</button>
        <button class="mov-elimina" data-id="${id}" title="Elimina">✕</button>
      </div>
    `;

    ul.appendChild(li);
  }

  // Eliminazione
  ul.querySelectorAll('.mov-elimina').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (confirm('Eliminare questo movimento?')) {
        movimenti = movimenti.filter(m => String(m.id) !== String(id));
        salvaDati();
        renderTutto();
      }
    });
  });

  // Modifica
  ul.querySelectorAll('.mov-modifica').forEach(btn => {
    btn.addEventListener('click', () => {
      apriModaleEdit(btn.dataset.id);
    });
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderTutto() {
  renderSaldo();
  renderLista();
}

// ---------- Form nuovo movimento ----------
function initForm() {
  const form = document.getElementById('form-movimento');
  const inputData = document.getElementById('input-data');
  inputData.valueAsDate = new Date();

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const tipo = document.getElementById('input-tipo').value;
    const nota = document.getElementById('input-nota').value.trim();
    const importo = parseFloat(document.getElementById('input-importo').value);
    const categoria = document.getElementById('input-categoria').value;
    const data = inputData.value;

    if (!nota || !importo || importo <= 0 || !data) return;

    movimenti.push({
      id: Date.now().toString(),
      data,
      nota,
      importo,
      tipo,
      categoria
    });

    salvaDati();
    renderTutto();
    form.reset();
    inputData.valueAsDate = new Date();
  });
}

// ---------- Modale modifica ----------
function apriModaleEdit(id) {
  const m = movimenti.find(x => String(x.id) === String(id));
  if (!m) return;

  document.getElementById('edit-id').value = m.id;
  document.getElementById('edit-data').value = m.data;
  document.getElementById('edit-tipo').value = m.tipo;
  document.getElementById('edit-nota').value = m.nota;
  document.getElementById('edit-importo').value = m.importo;
  document.getElementById('edit-categoria').value = m.categoria;

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

  // Chiudi cliccando fuori dal riquadro
  modale.addEventListener('click', (e) => {
    if (e.target === modale) chiudiModaleEdit();
  });

  // Chiudi con ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modale.classList.contains('hidden')) {
      chiudiModaleEdit();
    }
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const id = document.getElementById('edit-id').value;
    const idx = movimenti.findIndex(x => String(x.id) === String(id));
    if (idx === -1) return;

    movimenti[idx] = {
      ...movimenti[idx],
      data: document.getElementById('edit-data').value,
      tipo: document.getElementById('edit-tipo').value,
      nota: document.getElementById('edit-nota').value.trim(),
      importo: parseFloat(document.getElementById('edit-importo').value),
      categoria: document.getElementById('edit-categoria').value
    };

    salvaDati();
    renderTutto();
    chiudiModaleEdit();
  });
}

// ---------- Filtri ----------
function initFiltri() {
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filtroAttivo = chip.dataset.filter;
      renderLista();
    });
  });
}

// ---------- Export / Reset ----------
function initAzioni() {
  document.getElementById('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(movimenti, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `budget-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Vuoi davvero cancellare tutti i dati? L\'operazione è irreversibile.')) {
      localStorage.removeItem(STORAGE_KEY);
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

// ---------- Avvio ----------
async function init() {
  await caricaDati();
  initForm();
  initFiltri();
  initAzioni();
  initPWA();
  initModaleEdit();
  renderTutto();
}

document.addEventListener('DOMContentLoaded', init);