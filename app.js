===== app.js =====
const STORAGE_KEY='budget-app-data-v2',BALANCE_KEY='budget-app-balance-v2',BUDGET_KEY='budget-app-budget-v2',PIN_HASH_KEY='budget-app-pinhash-v2',BIO_KEY='budget-app-bio-v2',BIO_CRED_KEY='budget-app-bio-cred-v2',DEFAULT_BALANCE=0,CATS=['Spesa','Extra','Fissa','Stipendio','Prelievo','Altro'];
let movimenti=[],saldoIniziale=DEFAULT_BALANCE,budgetCategorie={},filtroAttivo='all',meseAttivo='all',testoRicerca='',pinBuffer='',pinMode='unlock',pinTemp='',unlocked=false;
const fmtEUR=new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'});
const fmtData=(iso)=>{const d=new Date(iso);return isNaN(d)?'—':d.toLocaleDateString('it-IT',{day:'2-digit',month:'short',year:'numeric'});};
const parseData=(iso)=>new Date(iso);
const escapeHtml=(s)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const meseKey=(iso)=>String(iso).slice(0,7);
const nomeMese=(k)=>{const[a,m]=k.split('-');return new Date(Number(a),Number(m)-1,1).toLocaleDateString('it-IT',{month:'long',year:'numeric'});};
const nomeMeseBreve=(k)=>{const[a,m]=k.split('-');return new Date(Number(a),Number(m)-1,1).toLocaleDateString('it-IT',{month:'short'});};
function toast(msg,tipo='info'){const t=document.createElement('div');t.className=`toast toast-${tipo}`;t.textContent=msg;document.body.appendChild(t);requestAnimationFrame(()=>t.classList.add('show'));setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},2500);}

async function sha256(str){const buf=new TextEncoder().encode(str);const h=await crypto.subtle.digest('SHA-256',buf);return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function getPinHash(){return localStorage.getItem(PIN_HASH_KEY);}
function hasPinSet(){return!!getPinHash();}
async function setPin(pin){const h=await sha256('budget-pin-'+pin);localStorage.setItem(PIN_HASH_KEY,h);}
async function verifyPin(pin){const h=await sha256('budget-pin-'+pin);return h===getPinHash();}
function removePin(){localStorage.removeItem(PIN_HASH_KEY);removeBio();}

function bioSupported(){return window.PublicKeyCredential&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable;}
function isBioActive(){return localStorage.getItem(BIO_KEY)==='true'&&!!localStorage.getItem(BIO_CRED_KEY);}
async function activateBio(){
  if(!bioSupported())return toast('Biometria non supportata','error');
  try{
    const avail=await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if(!avail)return toast('Nessun sensore biometrico','error');
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const uid=new Uint8Array(16);crypto.getRandomValues(uid);
    const cred=await navigator.credentials.create({publicKey:{challenge,rp:{name:'Il Mio Budget',id:location.hostname},user:{id:uid,name:'utente@budget',displayName:'Budget'},pubKeyCredParams:[{type:'public-key',alg:-7},{type:'public-key',alg:-257}],authenticatorSelection:{authenticatorAttachment:'platform',userVerification:'required',residentKey:'preferred'},timeout:60000,attestation:'none'}});
    if(cred){localStorage.setItem(BIO_KEY,'true');const rawId=btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));localStorage.setItem(BIO_CRED_KEY,rawId);toast('Impronta attivata','success');updateSecurityModal();return true;}
  }catch(e){if(e.name==='NotAllowedError')toast('Operazione annullata','info');else toast('Errore: '+e.message,'error');}
  return false;
}
function removeBio(){localStorage.removeItem(BIO_KEY);localStorage.removeItem(BIO_CRED_KEY);}
async function unlockBio(){
  const rawId=localStorage.getItem(BIO_CRED_KEY);if(!rawId)return false;
  try{
    const challenge=new Uint8Array(32);crypto.getRandomValues(challenge);
    const idBin=Uint8Array.from(atob(rawId),c=>c.charCodeAt(0));
    const assertion=await navigator.credentials.get({publicKey:{challenge,allowCredentials:[{type:'public-key',id:idBin}],userVerification:'required',timeout:60000}});
    return!!assertion;
  }catch(e){return false;}
}

function showLockScreen(mode){pinMode=mode;pinBuffer='';pinTemp='';document.getElementById('lock-screen').classList.remove('hidden');document.body.style.overflow='hidden';updateLockUI();}
function hideLockScreen(){document.getElementById('lock-screen').classList.add('hidden');document.body.style.overflow='';unlocked=true;}
function updateLockUI(){
  const title=document.getElementById('lock-title'),sub=document.getElementById('lock-subtitle'),disp=document.getElementById('pin-display'),bioBtn=document.getElementById('btn-pin-bio');
  if(pinMode==='unlock'){title.textContent='Inserisci il PIN';sub.textContent='Sblocca per accedere al tuo budget';}
  else if(pinMode==='set'){title.textContent='Imposta un PIN';sub.textContent="Scegli 4 cifre per proteggere l'app";}
  else if(pinMode==='confirm'){title.textContent='Ripeti il PIN';sub.textContent='Conferma il PIN scelto';}
  bioBtn.classList.toggle('hidden',!(pinMode==='unlock'&&isBioActive()));
  disp.innerHTML='';for(let i=0;i<4;i++){const d=document.createElement('div');d.className='pin-dot'+(i<pinBuffer.length?' filled':'');disp.appendChild(d);}
}
async function handlePinDigit(n){
  if(n==='del'){pinBuffer=pinBuffer.slice(0,-1);return updateLockUI();}
  if(n==='bio'){const ok=await unlockBio();if(ok){hideLockScreen();}else toast('Impronta non riconosciuta','error');return;}
  if(pinBuffer.length>=4)return;
  pinBuffer+=n;updateLockUI();
  if(pinBuffer.length===4){
    setTimeout(async()=>{
      if(pinMode==='unlock'){if(await verifyPin(pinBuffer)){hideLockScreen();}else{toast('PIN errato','error');pinBuffer='';updateLockUI();}}
      else if(pinMode==='set'){pinTemp=pinBuffer;pinBuffer='';pinMode='confirm';updateLockUI();}
      else if(pinMode==='confirm'){
        if(pinBuffer===pinTemp){await setPin(pinBuffer);toast('PIN impostato','success');pinBuffer='';pinTemp='';hideLockScreen();}
        else{toast('I PIN non coincidono','error');pinBuffer='';pinTemp='';pinMode='set';updateLockUI();}
      }
    },120);
  }
}
function initLockScreen(){
  document.getElementById('pin-pad').addEventListener('click',(e)=>{const btn=e.target.closest('button');if(!btn)return;handlePinDigit(btn.dataset.num);});
  document.addEventListener('keydown',(e)=>{if(document.getElementById('lock-screen').classList.contains('hidden'))return;if(/^[0-9]$/.test(e.key))handlePinDigit(e.key);else if(e.key==='Backspace')handlePinDigit('del');});
  document.getElementById('btn-pin-reset').addEventListener('click',()=>{if(confirm("Cancellare PIN e TUTTI i dati dell'app? L'operazione è irreversibile.")){localStorage.clear();location.reload();}});
}
function initSecurity(){
  const btn=document.getElementById('btn-security');btn.classList.remove('hidden');
  const modale=document.getElementById('modale-security');
  btn.addEventListener('click',()=>{updateSecurityModal();modale.classList.remove('hidden');});
  document.getElementById('sec-close').addEventListener('click',()=>modale.classList.add('hidden'));
  modale.addEventListener('click',(e)=>{if(e.target===modale)modale.classList.add('hidden');});
  document.getElementById('form-security').addEventListener('submit',async(e)=>{
    e.preventDefault();
    const p1=document.getElementById('sec-pin1').value,p2=document.getElementById('sec-pin2').value,err=document.getElementById('sec-error');
    if(!/^\d{4}$/.test(p1)){err.textContent='Il PIN deve avere 4 cifre.';err.classList.remove('hidden');return;}
    if(p1!==p2){err.textContent='I PIN non coincidono.';err.classList.remove('hidden');return;}
    err.classList.add('hidden');await setPin(p1);toast('PIN salvato','success');updateSecurityModal();
    document.getElementById('sec-pin1').value='';document.getElementById('sec-pin2').value='';
  });
  document.getElementById('sec-remove').addEventListener('click',()=>{if(confirm("Rimuovere il PIN? L'app non sarà più protetta.")){removePin();toast('PIN rimosso','info');updateSecurityModal();}});
  document.getElementById('sec-bio-on').addEventListener('click',activateBio);
  document.getElementById('sec-bio-off').addEventListener('click',()=>{removeBio();toast('Impronta disattivata','info');updateSecurityModal();});
}
function updateSecurityModal(){
  const info=document.getElementById('sec-info'),bioRow=document.getElementById('sec-bio-row'),bioOn=document.getElementById('sec-bio-on'),bioOff=document.getElementById('sec-bio-off');
  info.textContent=hasPinSet()?'✓ PIN attivo':'Nessun PIN impostato.';
  if(hasPinSet()&&bioSupported()){bioRow.classList.remove('hidden');const active=isBioActive();bioOn.classList.toggle('hidden',active);bioOff.classList.toggle('hidden',!active);}
  else bioRow.classList.add('hidden');
}

async function caricaDati(){
  const b=localStorage.getItem(BALANCE_KEY);saldoIniziale=b!==null?(parseFloat(b)||0):DEFAULT_BALANCE;
  const bg=localStorage.getItem(BUDGET_KEY);if(bg){try{budgetCategorie=JSON.parse(bg);}catch(e){budgetCategorie={};}}
  const s=localStorage.getItem(STORAGE_KEY);
  if(s){try{const p=JSON.parse(s);if(Array.isArray(p)){movimenti=p.map(validaMovimento).filter(Boolean);return;}}catch(e){}}
  try{const res=await fetch('data.json');const d=await res.json();movimenti=Array.isArray(d)?d.map(validaMovimento).filter(Boolean):[];salvaDati();}catch(e){movimenti=[];}
}
function salvaDati(){localStorage.setItem(STORAGE_KEY,JSON.stringify(movimenti));}
function salvaSaldo(){localStorage.setItem(BALANCE_KEY,String(saldoIniziale));}
function salvaBudget(){localStorage.setItem(BUDGET_KEY,JSON.stringify(budgetCategorie));}
function validaMovimento(m){
  if(!m||typeof m!=='object')return null;
  const nota=String(m.nota||'').trim(),imp=parseFloat(m.importo),data=String(m.data||'').trim(),tipo=m.tipo==='entrata'?'entrata':'uscita',cat=String(m.categoria||'Altro').trim()||'Altro';
  if(!nota||nota.length>80)return null;if(!isFinite(imp)||imp<=0||imp>1e9)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(data))return null;
  return{id:String(m.id||(Date.now().toString()+Math.random().toString(36).slice(2,7))),data,nota,importo:imp,tipo,categoria:cat};
}

function movimentiDelMese(){return meseAttivo==='all'?movimenti:movimenti.filter(m=>meseKey(m.data)===meseAttivo);}
function movimentiVisibili(){
  return movimentiDelMese().slice().sort((a,b)=>parseData(b.data)-parseData(a.data)).filter(m=>{
    if(filtroAttivo!=='all'){if(filtroAttivo==='entrata'||filtroAttivo==='uscita'){if(m.tipo!==filtroAttivo)return false;}else if(m.categoria!==filtroAttivo)return false;}
    if(testoRicerca){const q=testoRicerca.toLowerCase();if(!m.nota.toLowerCase().includes(q)&&!m.categoria.toLowerCase().includes(q))return false;}
    return true;
  });
}
function calcolaTotali(){const l=movimentiDelMese();let e=0,u=0,x=0,s=0;for(const m of l){const i=Number(m.importo)||0;if(m.tipo==='entrata')e+=i;else{u+=i;if(m.categoria==='Extra')x+=i;if(m.categoria==='Spesa')s+=i;}}return{entrate:e,uscite:u,extra:x,spesa:s};}
function saldoTotale(){let e=0,u=0;for(const m of movimenti){const i=Number(m.importo)||0;if(m.tipo==='entrata')e+=i;else u+=i;}return saldoIniziale+e-u;}
function totaleCategoria(cat,mese){return movimenti.filter(m=>m.tipo==='uscita'&&m.categoria===cat&&(!mese||meseKey(m.data)===mese)).reduce((s,m)=>s+Number(m.importo),0);}

function renderSaldo(){const s=saldoTotale(),el=document.getElementById('saldo-attuale');el.textContent=fmtEUR.format(s);el.classList.toggle('positive',s>=0);el.classList.toggle('negative',s<0);document.getElementById('saldo-updated').textContent='aggiornato '+new Date().toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderRiepilogo(){const t=calcolaTotali();document.getElementById('tot-entrate').textContent=fmtEUR.format(t.entrate);document.getElementById('tot-uscite').textContent=fmtEUR.format(t.uscite);document.getElementById('tot-extra').textContent=fmtEUR.format(t.extra);document.getElementById('tot-spesa').textContent=fmtEUR.format(t.spesa);}
function renderTrend(){
  const c=document.getElementById('trend-chart'),oggi=new Date(),mesi=[];
  for(let i=5;i>=0;i--){const d=new Date(oggi.getFullYear(),oggi.getMonth()-i,1);mesi.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);}
  const dati=mesi.map(k=>{const l=movimenti.filter(m=>meseKey(m.data)===k);return{key:k,entrate:l.filter(m=>m.tipo==='entrata').reduce((s,m)=>s+Number(m.importo),0),uscite:l.filter(m=>m.tipo==='uscita').reduce((s,m)=>s+Number(m.importo),0)};});
  const max=Math.max(...dati.flatMap(d=>[d.entrate,d.uscite]),1);
  let h='<div class="trend-bars">';
  for(const d of dati){const hE=Math.max((d.entrate/max)*80,2),hU=Math.max((d.uscite/max)*80,2);h+=`<div class="trend-col"><div class="trend-bar-group"><div class="trend-bar entrata" style="height:${hE}px" title="Entrate: ${fmtEUR.format(d.entrate)}"></div><div class="trend-bar uscita" style="height:${hU}px" title="Uscite: ${fmtEUR.format(d.uscite)}"></div></div><span class="trend-label">${nomeMeseBreve(d.key)}</span></div>`;}
  h+='</div><div class="trend-legend"><span><span style="background:var(--success)"></span>Entrate</span><span><span style="background:var(--danger)"></span>Uscite</span></div>';
  c.innerHTML=h;
}
function renderGrafico(){
  const c=document.getElementById('grafico-categorie'),u=movimentiDelMese().filter(m=>m.tipo==='uscita');
  if(u.length===0){c.innerHTML='<p style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:.5rem">Nessuna spesa nel periodo</p>';return;}
  const per={};for(const m of u)per[m.categoria]=(per[m.categoria]||0)+Number(m.importo);
  const voci=Object.entries(per).sort((a,b)=>b[1]-a[1]),max=voci[0][1];
  const colors={Spesa:'#22c55e',Extra:'#f59e0b',Fissa:'#3b82f6',Prelievo:'#8b5cf6',Stipendio:'#06b6d4',Altro:'#94a3b8'};
  let h='<div class="chart-bars">';
  for(const[cat,imp]of voci){const pct=(imp/max)*100,col=colors[cat]||'#94a3b8';h+=`<div class="chart-row"><span class="chart-label">${escapeHtml(cat)}</span><div class="chart-bar-wrapper"><div class="chart-bar" style="width:${pct}%;background:${col}"></div></div><span class="chart-value">${fmtEUR.format(imp)}</span></div>`;}
  h+='</div>';c.innerHTML=h;
}
function renderBudget(){
  const c=document.getElementById('budget-list'),cats=Object.keys(budgetCategorie).filter(k=>budgetCategorie[k]>0);
  if(cats.length===0){c.innerHTML='<p style="text-align:center;color:var(--text-muted);font-size:.8rem;padding:.5rem">Nessun budget impostato. Clicca ⚙️ per configurarlo.</p>';return;}
  const meseC=meseAttivo==='all'?`${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`:meseAttivo;
  let h='';const superati=[];
  for(const cat of cats){const lim=budgetCategorie[cat],sp=totaleCategoria(cat,meseC),pct=Math.min((sp/lim)*100,100);
    let col;if(sp>lim){col='var(--danger)';superati.push(cat);}else if(pct>=80)col='var(--warning)';else col='var(--success)';
    h+=`<div class="budget-item"><span class="budget-label">${escapeHtml(cat)}</span><div class="budget-bar-wrapper"><div class="budget-bar" style="width:${pct}%;background:${col}"></div></div><span class="budget-value ${sp>lim?'exceeded':''}">${fmtEUR.format(sp)} / ${fmtEUR.format(lim)}</span></div>`;}
  if(superati.length>0)h+=`<p style="margin-top:.5rem;font-size:.75rem;color:var(--danger);text-align:center">⚠️ Budget superato: ${superati.join(', ')}</p>`;
  c.innerHTML=h;
}
function renderCronologico(){
  const body=document.getElementById('cron-body'),foot=document.getElementById('cron-foot'),hint=document.getElementById('cron-hint'),wrap=document.getElementById('cron-wrapper');
  if(!wrap||wrap.classList.contains('hidden'))return;
  const tutti=movimenti.slice().sort((a,b)=>{const d=parseData(a.data)-parseData(b.data);return d!==0?d:String(a.id).localeCompare(String(b.id));});
  let saldo=saldoIniziale;
  const conSaldo=tutti.map(m=>{const imp=Number(m.importo)||0;saldo+=m.tipo==='entrata'?imp:-imp;return{...m,_saldo:saldo};});
  let filtrati=conSaldo;
  if(meseAttivo!=='all')filtrati=filtrati.filter(m=>meseKey(m.data)===meseAttivo);
  if(testoRicerca){const q=testoRicerca.toLowerCase();filtrati=filtrati.filter(m=>m.nota.toLowerCase().includes(q)||m.categoria.toLowerCase().includes(q));}
  if(filtrati.length===0){body.innerHTML='<tr><td colspan="5" class="cron-empty">Nessun movimento nel periodo</td></tr>';foot.innerHTML='';hint.textContent='';return;}
  const primo=filtrati[0],idxPrimo=conSaldo.indexOf(primo),saldoInizioPeriodo=idxPrimo>0?conSaldo[idxPrimo-1]._saldo:saldoIniziale;
  let h='',sommaE=0,sommaU=0;
  for(const m of filtrati){const e=m.tipo==='entrata'?Number(m.importo):0,u=m.tipo==='uscita'?Number(m.importo):0;sommaE+=e;sommaU+=u;const cls=m._saldo<0?'neg':'pos';
    h+=`<tr><td>${fmtData(m.data)}</td><td class="desc">${escapeHtml(m.nota)}<br><span style="color:var(--text-muted);font-size:.7rem">${escapeHtml(m.categoria)}</span></td><td class="right in">${e?fmtEUR.format(e):'—'}</td><td class="right out">${u?fmtEUR.format(u):'—'}</td><td class="right saldo ${cls}">${fmtEUR.format(m._saldo)}</td></tr>`;}
  body.innerHTML=h;
  const saldoFinale=filtrati[filtrati.length-1]._saldo;
  foot.innerHTML=`<tr><td colspan="2">Totale periodo</td><td class="right in">${fmtEUR.format(sommaE)}</td><td class="right out">${fmtEUR.format(sommaU)}</td><td class="right saldo ${saldoFinale<0?'neg':'pos'}">${fmtEUR.format(saldoFinale)}</td></tr>`;
  const netto=sommaE-sommaU;
  hint.textContent=`Saldo inizio periodo: ${fmtEUR.format(saldoInizioPeriodo)} · Netto: ${netto>=0?'+':''}${fmtEUR.format(netto)} · Movimenti: ${filtrati.length}`;
}
function renderLista(){
  const ul=document.getElementById('lista-movimenti');ul.innerHTML='';
  const f=movimentiVisibili();
  if(f.length===0){ul.innerHTML='<li style="text-align:center;color:var(--text-muted);padding:1rem">Nessun movimento</li>';return;}
  for(const m of f){const li=document.createElement('li'),cE=m.categoria==='Extra'?' extra':'';li.className=`movimento ${m.tipo}${cE}`;
    const seg=m.tipo==='entrata'?'+':'−';
    li.innerHTML=`<div class="mov-info"><span class="mov-nota">${escapeHtml(m.nota)}</span><span class="mov-meta">${fmtData(m.data)} · ${escapeHtml(m.categoria)}</span></div><div style="display:flex;align-items:center"><span class="mov-importo ${m.tipo}">${seg} ${fmtEUR.format(m.importo)}</span><button class="mov-modifica" data-id="${m.id}" title="Modifica">✎</button><button class="mov-elimina" data-id="${m.id}" title="Elimina">✕</button></div>`;
    ul.appendChild(li);}
  ul.querySelectorAll('.mov-elimina').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.id,m=movimenti.find(x=>String(x.id)===String(id));if(!m)return;if(confirm(`Eliminare "${m.nota}"?`)){movimenti=movimenti.filter(x=>String(x.id)!==String(id));salvaDati();renderTutto();toast('Movimento eliminato','success');}}));
  ul.querySelectorAll('.mov-modifica').forEach(b=>b.addEventListener('click',()=>apriModaleEdit(b.dataset.id)));
}
function renderSelettoreMese(){
  const s=document.getElementById('selettore-mese');
  const mesi=Array.from(new Set(movimenti.map(m=>meseKey(m.data)))).filter(k=>/^\d{4}-\d{2}$/.test(k)).sort((a,b)=>b.localeCompare(a));
  const cur=s.value;s.innerHTML='<option value="all">Tutti i mesi</option>';
  for(const k of mesi){const o=document.createElement('option');o.value=k;o.textContent=nomeMese(k);s.appendChild(o);}
  if([...s.options].some(o=>o.value===cur)){s.value=cur;meseAttivo=cur;}else{meseAttivo='all';s.value='all';}
}
function renderTutto(){renderSaldo();renderRiepilogo();renderTrend();renderGrafico();renderBudget();renderLista();renderSelettoreMese();renderCronologico();}

function mostraErr(id,msg){const el=document.getElementById(id);el.textContent=msg;el.classList.remove('hidden');setTimeout(()=>el.classList.add('hidden'),4000);}
function initForm(){
  const f=document.getElementById('form-movimento'),d=document.getElementById('input-data');d.valueAsDate=new Date();
  f.addEventListener('submit',(e)=>{
    e.preventDefault();
    const tipo=document.getElementById('input-tipo').value,nota=document.getElementById('input-nota').value.trim(),impStr=document.getElementById('input-importo').value,cat=document.getElementById('input-categoria').value,data=d.value;
    if(!data)return mostraErr('form-error','Inserisci una data.');
    if(!nota)return mostraErr('form-error','Inserisci una descrizione.');
    if(nota.length>80)return mostraErr('form-error','Descrizione troppo lunga.');
    const imp=parseFloat(impStr);
    if(!isFinite(imp)||imp<=0)return mostraErr('form-error','Importo > 0.');
    if(imp>1e9)return mostraErr('form-error','Importo troppo grande.');
    const nv=validaMovimento({id:Date.now().toString()+Math.random().toString(36).slice(2,7),data,nota,importo:imp,tipo,categoria:cat});
    if(!nv)return mostraErr('form-error','Dati non validi.');
    movimenti.push(nv);salvaDati();renderTutto();f.reset();d.valueAsDate=new Date();toast('Movimento aggiunto','success');
  });
}
function apriModaleEdit(id){
  const m=movimenti.find(x=>String(x.id)===String(id));if(!m)return;
  document.getElementById('edit-id').value=m.id;
  document.getElementById('edit-data').value=m.data;
  document.getElementById('edit-tipo').value=m.tipo;
  document.getElementById('edit-nota').value=m.nota;
  document.getElementById('edit-importo').value=m.importo;
  document.getElementById('edit-categoria').value=m.categoria;
  document.getElementById('edit-error').classList.add('hidden');
  document.getElementById('modale-edit').classList.remove('hidden');
}
function chiudiModaleEdit(){document.getElementById('modale-edit').classList.add('hidden');}
function initModaleEdit(){
  const f=document.getElementById('form-edit'),a=document.getElementById('edit-annulla'),mod=document.getElementById('modale-edit');
  a.addEventListener('click',chiudiModaleEdit);
  mod.addEventListener('click',(e)=>{if(e.target===mod)chiudiModaleEdit();});
  f.addEventListener('submit',(e)=>{
    e.preventDefault();
    const id=document.getElementById('edit-id').value,idx=movimenti.findIndex(x=>String(x.id)===String(id));if(idx===-1)return;
    const nota=document.getElementById('edit-nota').value.trim(),imp=parseFloat(document.getElementById('edit-importo').value),data=document.getElementById('edit-data').value;
    if(!data||!nota)return mostraErr('edit-error','Compila tutti i campi.');
    if(!isFinite(imp)||imp<=0)return mostraErr('edit-error','Importo non valido.');
    const up=validaMovimento({...movimenti[idx],data,tipo:document.getElementById('edit-tipo').value,nota,importo:imp,categoria:document.getElementById('edit-categoria').value});
    if(!up)return mostraErr('edit-error','Dati non validi.');
    movimenti[idx]=up;salvaDati();renderTutto();chiudiModaleEdit();toast('Movimento aggiornato','success');
  });
}
function initModaleSaldo(){
  document.getElementById('btn-edit-saldo').addEventListener('click',()=>{document.getElementById('saldo-iniziale-input').value=saldoIniziale;document.getElementById('saldo-error').classList.add('hidden');document.getElementById('modale-saldo').classList.remove('hidden');});
  document.getElementById('saldo-annulla').addEventListener('click',()=>document.getElementById('modale-saldo').classList.add('hidden'));
  const mod=document.getElementById('modale-saldo');
  mod.addEventListener('click',(e)=>{if(e.target===mod)mod.classList.add('hidden');});
  document.getElementById('form-saldo').addEventListener('submit',(e)=>{
    e.preventDefault();
    const v=parseFloat(document.getElementById('saldo-iniziale-input').value);
    if(!isFinite(v)){mostraErr('saldo-error','Inserisci un numero valido.');return;}
    saldoIniziale=v;salvaSaldo();renderTutto();mod.classList.add('hidden');toast('Saldo aggiornato','success');
  });
}
function initModaleBudget(){
  const mod=document.getElementById('modale-budget');
  document.getElementById('btn-edit-budget').addEventListener('click',()=>{
    const cont=document.getElementById('budget-inputs');cont.innerHTML='';
    for(const cat of CATS){const val=budgetCategorie[cat]||'',row=document.createElement('div');row.className='budget-input-row';row.innerHTML=`<label>${cat}</label><input type="number" data-cat="${cat}" step="0.01" min="0" placeholder="0" value="${val}">`;cont.appendChild(row);}
    mod.classList.remove('hidden');
  });
  document.getElementById('budget-annulla').addEventListener('click',()=>mod.classList.add('hidden'));
  mod.addEventListener('click',(e)=>{if(e.target===mod)mod.classList.add('hidden');});
  document.getElementById('form-budget').addEventListener('submit',(e)=>{
    e.preventDefault();budgetCategorie={};
    document.querySelectorAll('#budget-inputs input').forEach(inp=>{const v=parseFloat(inp.value);if(isFinite(v)&&v>0)budgetCategorie[inp.dataset.cat]=v;});
    salvaBudget();renderBudget();mod.classList.add('hidden');toast('Budget salvato','success');
  });
}
function initFiltri(){
  document.querySelectorAll('.chip').forEach(c=>c.addEventListener('click',()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');filtroAttivo=c.dataset.filter;renderLista();renderCronologico();}));
  document.getElementById('selettore-mese').addEventListener('change',(e)=>{meseAttivo=e.target.value;renderRiepilogo();renderGrafico();renderBudget();renderLista();renderCronologico();});
  document.getElementById('search-input').addEventListener('input',(e)=>{testoRicerca=e.target.value.trim();renderLista();renderCronologico();});
}
function initCronologico(){
  const btn=document.getElementById('btn-toggle-cron'),wrap=document.getElementById('cron-wrapper'),KEY='budget-app-cron-open-v1';
  if(localStorage.getItem(KEY)==='true'){wrap.classList.remove('hidden');btn.textContent='▴';}
  btn.addEventListener('click',()=>{const open=wrap.classList.contains('hidden');wrap.classList.toggle('hidden',!open);btn.textContent=open?'▴':'▾';localStorage.setItem(KEY,String(open));if(open)renderCronologico();});
}
function initAzioni(){
  document.getElementById('btn-export').addEventListener('click',()=>{
    const p={versione:2.2,esportato_il:new Date().toISOString(),saldo_iniziale:saldoIniziale,budget:budgetCategorie,movimenti};
    const b=new Blob([JSON.stringify(p,null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a');
    a.href=u;a.download=`budget-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(u);toast('Backup esportato','success');
  });
  const fi=document.createElement('input');fi.type='file';fi.accept='.json,application/json';
  fi.addEventListener('change',async(ev)=>{
    const file=ev.target.files[0];if(!file)return;
    try{
      const t=await file.text(),d=JSON.parse(t);let nm=[],nb=saldoIniziale,nbudg=budgetCategorie;
      if(Array.isArray(d))nm=d.map(validaMovimento).filter(Boolean);
      else if(d&&Array.isArray(d.movimenti)){nm=d.movimenti.map(validaMovimento).filter(Boolean);if(typeof d.saldo_iniziale==='number')nb=d.saldo_iniziale;if(d.budget)nbud=d.budget;}
      else throw new Error('Formato non riconosciuto');
      if(nm.length===0)throw new Error('Nessun movimento valido');
      if(!confirm(`Importare ${nm.length} movimenti? I dati attuali verranno sostituiti.`))return;
      movimenti=nm;saldoIniziale=nb;budgetCategorie=nbud;salvaDati();salvaSaldo();salvaBudget();renderTutto();toast(`Importati ${nm.length} movimenti`,'success');
    }catch(err){toast('Errore: '+err.message,'error');}finally{ev.target.value='';}
  });
  document.getElementById('btn-import').addEventListener('click',()=>fi.click());
  document.getElementById('btn-reset').addEventListener('click',()=>{if(confirm("Cancellare TUTTI i dati? L'operazione è irreversibile.")){localStorage.clear();location.reload();}});
}
let deferredPrompt=null;
function initPWA(){
  const b=document.getElementById('btn-install');
  window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;b.classList.remove('hidden');});
  b.addEventListener('click',async()=>{if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;b.classList.add('hidden');});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
}
document.addEventListener('keydown',(e)=>{if(e.key==='Escape'){chiudiModaleEdit();document.getElementById('modale-saldo').classList.add('hidden');document.getElementById('modale-budget').classList.add('hidden');document.getElementById('modale-security').classList.add('hidden');}});
async function init(){
  await caricaDati();initForm();initFiltri();initAzioni();initPWA();initModaleEdit();initModaleSaldo();initModaleBudget();initLockScreen();initSecurity();initCronologico();
  if(hasPinSet())showLockScreen('unlock');else unlocked=true;
  renderTutto();
}
document.addEventListener('DOMContentLoaded',init);