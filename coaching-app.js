const SHEET_ID = '1WowoJFXuMa50JErnnUsqeR0eetzZ10pxmjRB4jbpbo0';
const SHEET_URL = `https://docs.google.com/spreadsheets/d/e/2PACX-1vSxUmFBnlhbPFNJKskxL93gLd5uOMus6m7cnyWinCVVHeORYsFdhzSvufIm3pElPbUJQMeosCjX1QUW/pub?gid=0&single=true&output=csv`;
const DEFAULT_RECUPERO = '1.45';

let lists = { esercizi:[], metodologie:[], utenti:[], consigli:{} };
let giorni = [];
let csvData = [];
let acIdx = -1;
let dragSrc = null;


// ── HTML ESCAPE FOR ATTRIBUTES ───────────────────────────────────────────────
function esc(v){ return String(v||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
// ── LOAD SHEET (da localStorage) ─────────────────────────────────────────────
function parseTSVData(text) {
  lists.esercizi = [];
  lists.metodologie = [];
  lists.utenti = [];
  const lines = text.trim().split('\n');
  lines.forEach(line => {
    const cols = line.split('\t');
    if (cols[0]&&cols[0].trim()) lists.esercizi.push({
      nome:cols[0].trim(), blocco:(cols[1]||'').trim(),
      categoria:(cols[5]||'').trim(), gruppo:(cols[6]||'').trim()
    });
    if (cols[2]&&cols[2].trim()) lists.metodologie.push(cols[2].trim());
    if (cols[3]&&cols[3].trim()) lists.utenti.push({nome:cols[3].trim(),email:(cols[4]||'').trim()});
  });
  lists.metodologie = [...new Set(lists.metodologie)];
}

function loadSheet() {
  const saved = localStorage.getItem('coaching_sheet_data');
  if (saved) {
    parseTSVData(saved);
    document.getElementById('sync-dot').className='sync-dot ok';
    document.getElementById('sync-label').textContent=lists.esercizi.length+' esercizi · '+lists.metodologie.length+' metod.';
    // Deduplicazione: usa email se presente, altrimenti nome
    window._sheetUsers = lists.utenti.filter((u,i,arr)=>{
      const key = u.email || u.nome;
      return arr.findIndex(x=>(x.email||x.nome)===key)===i;
    });
  } else {
    document.getElementById('sync-dot').className='sync-dot err';
    document.getElementById('sync-label').textContent='Nessun dato — clicca per importare';
  }
}

function openImport() {
  document.getElementById('import-overlay').classList.add('open');
  document.getElementById('import-status').textContent='';
}

function closeImport() {
  document.getElementById('import-overlay').classList.remove('open');
}

function importData() {
  const text = document.getElementById('import-textarea').value.trim();
  if (!text) {
    document.getElementById('import-status').textContent = 'Incolla i dati prima di procedere.';
    return;
  }
  // Salva in localStorage
  localStorage.setItem('coaching_sheet_data', text);
  // Ricarica liste
  lists.esercizi = [];
  lists.metodologie = [];
  lists.utenti = [];
  parseTSVData(text);
  document.getElementById('sync-dot').className='sync-dot ok';
  document.getElementById('sync-label').textContent=lists.esercizi.length+' esercizi · '+lists.metodologie.length+' metod.';
  document.getElementById('import-status').textContent = '✓ ' + lists.esercizi.length + ' esercizi, ' + lists.utenti.length + ' utenti caricati.';
  setTimeout(closeImport, 1200);
}

function parseCSVLine(line) {
  const cols=[]; let cur='',inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){
      if(inQ && line[i+1]==='"'){cur+='"';i++;continue;}
      inQ=!inQ; continue;
    }
    if(ch===','&&!inQ){cols.push(cur);cur='';continue;}
    cur+=ch;
  }
  cols.push(cur);
  return cols;
}

// ── STRUTTURA PARSING (replica logica App Script) ────────────────────────────
function parseStruttura(val) {
  if (!val) return { serie:'', ripetizioni:'', percentuale:'', carico:'', recupero:'', consiglio:'' };

  // Normalizza: · → * (punto medio usato nell'app → asterisco per il parser)
  const valNorm = val.trim().replace(/·/g, '*');
  const s  = valNorm.toUpperCase();
  // Normalizza virgola decimale: 77,5 → 77.5
  const sn = s.replace(/(\d),(\d)/g, '$1.$2');

  // ── 1) FOR TIME  "30 for time" ───────────────────────────────────────────────
  const mFT = s.match(/^(\d+)\s*FOR\s*TIME/);
  if (mFT) {
    return { serie:'', ripetizioni:mFT[1], percentuale:'', carico:'', recupero:'', consiglio:'' };
  }

  // ── 2) MAV con @  "MAV3@8, 90% 3*4" → niente ────────────────────────────────
  if (s.match(/MAV\d+@\d+/)) {
    return { serie:'', ripetizioni:'', percentuale:'', carico:'', recupero:'', consiglio:'' };
  }

  // ── 3) REST-PAUSE  "5 + 20" + MAX*4"  o  "5 + 20" + MAX·4" ─────────────────
  // Contiene + e (virgolette doppie o ") e termina con *N
  if (s.includes('+') && (s.includes('\"') || s.includes('\u201d') || s.includes('"')) && s.match(/\*\s*\d+\s*$/)) {
    const m = s.match(/\*\s*(\d+)\s*$/);
    return { serie: m ? m[1] : '', ripetizioni:'', percentuale:'', carico:'', recupero:'', consiglio:'' };
  }

  // ── 4) MONOLATERALE / STRIPPING  (+ con * finale) ────────────────────────────
  // Es: "8+8*4" monolaterale, "5+5+5*4" stripping
  if (s.includes('+') && s.match(/\*\s*\d+$/)) {
    const starIdx = s.lastIndexOf('*');
    const repPart = s.substring(0, starIdx);
    const serPart = s.substring(starIdx + 1);
    const parts   = repPart.split('+').map(x => x.trim()).filter(Boolean);
    const serN    = parseInt(serPart.trim(), 10);

    if (parts.length === 2) {
      // monolaterale → primo numero = rip per lato
      const r = parseInt(parts[0], 10);
      return { serie: isNaN(serN)?'':String(serN), ripetizioni: isNaN(r)?'':String(r), percentuale:'', carico:'', recupero:'', consiglio:'' };
    }
    if (parts.length >= 3) {
      // stripping → somma tutto
      const tot = parts.reduce((t,v) => t + (parseInt(v,10)||0), 0);
      return { serie: isNaN(serN)?'':String(serN), ripetizioni: String(tot), percentuale:'', carico:'', recupero:'', consiglio:'' };
    }
  }

  // ── 5) EMOM  "20\'5RPM"  o  "80% 9\' 1RPM" ──────────────────────────────────
  if (s.match(/\d+'\s*\d*RPM/)) {
    const minM  = s.match(/(\d+)'/);
    const rpmM  = s.match(/(\d+)RPM/);
    const percM = sn.match(/(\d+(?:\.\d+)?)\s*%/);
    const kgM   = sn.match(/(\d+(?:\.\d+)?)\s*KG/);
    return {
      serie:       minM  ? minM[1]  : '',
      ripetizioni: rpmM  ? rpmM[1]  : '',
      percentuale: percM ? percM[1]+'%' : '',
      carico:      kgM   ? kgM[1]   : '',
      recupero: '', consiglio: ''
    };
  }

  // ── 6) PROGRESSIONE INTERNA con virgola  "100kg 3*3, 110kg 2*2" ──────────────
  // Dopo normalizzazione decimale la virgola che rimane è separatore blocchi
  // Ma attenzione: sn ha già sostituito virgole decimali, quindi virgole rimaste = separatori
  if (sn.includes(',')) {
    const blocchi = sn.split(/\s*,\s*/);
    let tot = 0;
    blocchi.forEach(b => { const m = b.match(/\*(\d+)/); if (m) tot += parseInt(m[1],10); });
    return { serie: tot>0?String(tot):'', ripetizioni:'', percentuale:'', carico:'', recupero: DEFAULT_RECUPERO, consiglio:'Segna RPE' };
  }

  // ── 7) STANDARD: estrai kg, %, serie*rip, piramidale ─────────────────────────
  let serie='', rip='', perc='', carico='', consiglio='';

  const kgM   = sn.match(/(\d+(?:\.\d+)?)\s*KG/);
  if (kgM)   carico = kgM[1];

  const percM = sn.match(/(\d+(?:\.\d+)?)\s*%/);
  if (percM) perc = percM[1] + '%';

  // Rimuovi kg e % dalla stringa per estrarre serie*rip
  let sp = sn
    .replace(/\d+(?:\.\d+)?\s*KG/gi, '')
    .replace(/\d+(?:\.\d+)?\s*%/gi, '');

  // Rimuovi minuti tipo "20'" se non è EMOM
  if (sp.includes("'") && !sp.includes('RPM')) sp = sp.replace(/\d+'\s*/g, '');

  if (sp.includes('*')) {
    // es. "5*4" → rip=5, serie=4
    const parti = sp.split('*');
    const r  = parti[0].match(/\d+/);
    const s2 = parti[1] ? parti[1].match(/\d+/) : null;
    if (r)  rip   = r[0];
    if (s2) serie = s2[0];
  } else if (sp.includes('-')) {
    // piramidale "12-10-8-8" → serie = numero di elementi
    const nums = sp.split('-').filter(x => x.match(/\d+/));
    if (nums.length > 1) serie = String(nums.length);
  }

  return { serie, ripetizioni: rip, percentuale: perc, carico, recupero: DEFAULT_RECUPERO, consiglio };
}

// ── GIORNI ────────────────────────────────────────────────────────────────────
function addDay() {
  const id = uid();
  const num = giorni.length+1;
  giorni.push({id, nome:'Giorno '+num, esercizi:[]});
  renderDay(giorni[giorni.length-1]);
}

function removeDay(dayId) {
  if (!confirm('Eliminare questo giorno?')) return;
  giorni = giorni.filter(d=>d.id!==dayId);
  document.getElementById('day-'+dayId).remove();
}

function renderDay(day) {
  const sw = parseInt(document.getElementById('settimane').value)||4;
  const container = document.getElementById('giorni-container');
  const div = document.createElement('div');
  div.className='giorno-block'; div.id='day-'+day.id;
  div.innerHTML=`
    <div class="giorno-header">
      <div class="giorno-title">
        <input type="text" value="${day.nome}" onclick="event.stopPropagation()"
          onchange="updateDayName('${day.id}',this.value)"
          style="background:transparent;border:none;color:var(--accent);font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:0.08em;width:110px;outline:none;">
        <span class="giorno-count" id="day-count-${day.id}">0 esercizi</span>
      </div>
      <div style="display:flex;gap:4px">
        <button class="btn-ghost" onclick="removeDay('${day.id}')" style="font-size:11px">✕ Elimina</button>
      </div>
    </div>
    <div class="giorno-body" id="day-body-${day.id}">
      <div id="col-head-${day.id}"></div>
      <div id="ex-list-${day.id}"></div>
      <button class="btn-add-ex" onclick="addExercise('${day.id}')">+ Aggiungi esercizio</button>
    </div>`;
  container.appendChild(div);
  renderColHeaders(day.id, sw);
}

function gt(sw) {
  // drag | esercizio+mini | note | metodologia | prog-button
  return '18px 18px 220px 130px 130px 60px';
}

function renderColHeaders(dayId, sw) {
  const head = document.getElementById('col-head-'+dayId);
  let h = `<div class="col-heads" style="grid-template-columns:${gt(sw)}">`;
  h += '<div></div><div></div><div class="col-h">Esercizio</div><div class="col-h">Note</div><div class="col-h">Metodologia</div><div class="col-h">Prog.</div>';
  h += '</div>';
  head.innerHTML = h;
}

function updateDayName(dayId,val) {
  const d=giorni.find(d=>d.id===dayId); if(d) d.nome=val;
}

// ── EXERCISES ─────────────────────────────────────────────────────────────────
function addExercise(dayId) {
  const sw = parseInt(document.getElementById('settimane').value)||4;
  const day = giorni.find(d=>d.id===dayId); if(!day) return;
  const exId = uid();
  const ex = {
    id:exId, esercizio:'', blocco:'', metodologia:'', note:'',
    settimane: Array.from({length:sw},()=>({struttura:'',recupero:'',consiglio:'',serie:'',ripetizioni:'',percentuale:'',carico:''}))
  };
  day.esercizi.push(ex);
  renderExRow(dayId, ex, sw);
  updateDayCount(dayId);
  scheduleAutosave();
}

function renderExRow(dayId, ex, sw) {
  const list = document.getElementById('ex-list-'+dayId);
  const row = document.createElement('div');
  row.className='ex-row'; row.id='ex-'+ex.id;
  row.style.gridTemplateColumns=gt(sw);
  row.draggable=true;
  row.addEventListener('dragstart', e=>{ dragSrc={dayId,exId:ex.id}; row.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
  row.addEventListener('dragend', ()=>{ row.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over')); });
  row.addEventListener('dragover', e=>{ e.preventDefault(); row.classList.add('drag-over'); });
  row.addEventListener('dragleave', ()=>row.classList.remove('drag-over'));
  row.addEventListener('drop', e=>{ e.preventDefault(); row.classList.remove('drag-over'); dropExercise(dayId,ex.id); });

  let weekCols='';
  for(let w=0;w<sw;w++){
    const sw_data = ex.settimane[w]||{struttura:'',recupero:'',consiglio:''};
    const sepClass = w===0?'week-sep-col':'week-sep-col';
    weekCols+=`
      <div class="ex-field ${sepClass}">
        <input type="text" value="${sw_data.struttura}" placeholder="es. 70% 5*4"
          oninput="onStrutturaInput(this,'${ex.id}',${w})"
          onchange="onStrutturaChange(this,'${ex.id}',${w})">
      </div>
      <div class="ex-field">
        <input type="text" value="${sw_data.recupero}" placeholder="${DEFAULT_RECUPERO}"
          onchange="updateWeek('${ex.id}',${w},'recupero',this.value)">
      </div>
      <div class="ex-field" style="position:relative">
        <input type="text" value="${sw_data.consiglio}" placeholder="RPE8" autocomplete="off"
          oninput="acConsiglio(this,'${ex.id}',${w})"
          onkeydown="acKey(event,this)" onblur="acBlur(this)"
          onchange="updateWeek('${ex.id}',${w},'consiglio',this.value)">
        <div class="ac-list" id="ac-cons-${ex.id}-${w}"></div>
      </div>`;
  }

  // add hover tooltip events
  row.addEventListener('mouseenter', ()=>showTooltip(ex.id, row));
  row.addEventListener('mouseleave', ()=>hideTooltip());

  row.innerHTML=`
    <div class="drag-handle" title="Trascina per riordinare">⠿</div>
    <div class="del-btn-wrap">
      <button class="del-btn" onclick="removeExercise('${dayId}','${ex.id}')" title="Elimina esercizio">✕</button>
    </div>
    <div class="ex-field" style="position:relative">
      <input type="text" value="${esc(ex.esercizio)}" placeholder="Esercizio..." autocomplete="off"
        oninput="acExercise(this,'${ex.id}')" onkeydown="acKey(event,this)" onblur="acBlur(this)"
        onchange="updateEx('${ex.id}','esercizio',this.value)">
      <div class="ac-list" id="ac-ex-${ex.id}"></div>
    </div>
    <div class="ex-field" style="position:relative">
      <input type="text" value="${esc(ex.note)}" placeholder="Note..." autocomplete="off"
        oninput="acMetNote(this,'${ex.id}','note')" onkeydown="acKey(event,this)" onblur="acBlur(this)"
        onchange="updateEx('${ex.id}','note',this.value)">
      <div class="ac-list" id="ac-note-${ex.id}"></div>
    </div>
    <div class="ex-field" style="position:relative">
      <input type="text" value="${esc(ex.metodologia)}" placeholder="Metodologia..." autocomplete="off"
        oninput="acMetNote(this,'${ex.id}','metodologia')" onkeydown="acKey(event,this)" onblur="acBlur(this)"
        onchange="onMetodologiaChange(this,'${ex.id}')">
      <div class="ac-list" id="ac-met-${ex.id}"></div>
    </div>
    <div class="prog-btn-wrap">
      <button class="prog-btn" onclick="openProg('${ex.id}',this)" title="Progressioni">prog</button>
    </div>`;
  list.appendChild(row);
}

function dropExercise(dayId, targetExId) {
  if (!dragSrc || dragSrc.dayId !== dayId || dragSrc.exId === targetExId) return;
  const day = giorni.find(d=>d.id===dayId); if(!day) return;
  const srcIdx = day.esercizi.findIndex(e=>e.id===dragSrc.exId);
  const tgtIdx = day.esercizi.findIndex(e=>e.id===targetExId);
  if (srcIdx<0||tgtIdx<0) return;
  const [moved] = day.esercizi.splice(srcIdx,1);
  day.esercizi.splice(tgtIdx,0,moved);
  // re-render list
  const sw = parseInt(document.getElementById('settimane').value)||4;
  const list = document.getElementById('ex-list-'+dayId);
  list.innerHTML='';
  day.esercizi.forEach(ex=>renderExRow(dayId,ex,sw));
  dragSrc=null;
  scheduleAutosave();
}

function removeExercise(dayId, exId) {
  const day=giorni.find(d=>d.id===dayId); if(day) day.esercizi=day.esercizi.filter(e=>e.id!==exId);
  const el=document.getElementById('ex-'+exId); if(el) el.remove();
  updateDayCount(dayId);
  scheduleAutosave();
}

function updateEx(exId, field, value) {
  for(const day of giorni){ const ex=day.esercizi.find(e=>e.id===exId); if(ex){ex[field]=value;break;} }
  scheduleAutosave();
}

function updateWeek(exId, wIdx, field, value) {
  for(const day of giorni){ const ex=day.esercizi.find(e=>e.id===exId); if(ex){ex.settimane[wIdx][field]=value;break;} }
  scheduleAutosave();
}

function updateDayCount(dayId) {
  const day=giorni.find(d=>d.id===dayId);
  const el=document.getElementById('day-count-'+dayId);
  if(el&&day) el.textContent=day.esercizi.length+' esercizi';
}

// ── STRUTTURA HANDLERS ────────────────────────────────────────────────────────
function onStrutturaInput(input, exId, wIdx) {
  updateWeek(exId, wIdx, 'struttura', input.value);
}

function onStrutturaChange(input, exId, wIdx) {
  const val = input.value;
  updateWeek(exId, wIdx, 'struttura', val);
  const parsed = parseStruttura(val);

  // Update parsed fields in state
  for(const day of giorni){
    const ex=day.esercizi.find(e=>e.id===exId);
    if(ex){
      Object.assign(ex.settimane[wIdx], parsed, {struttura:val});
      // if W1 changed: propagate recupero and consiglio to other weeks if they are empty
      if(wIdx===0){
        const sw = ex.settimane.length;
        for(let w=1;w<sw;w++){
          const row = document.getElementById('ex-'+exId);
          if(!row) continue;
          const allInputs = row.querySelectorAll('input');
          // recupero: col index = 4 + w*3 + 1 (0-based: drag,es,note,met then per week: str,rec,cons)
          // easier: update state and sync inputs
          if(!ex.settimane[w].recupero) {
            ex.settimane[w].recupero = parsed.recupero;
          }
          if(!ex.settimane[w].consiglio && parsed.consiglio) {
            ex.settimane[w].consiglio = parsed.consiglio;
          }
        }
        syncRowInputs(exId);
      }
      break;
    }
  }
}

function syncRowInputs(exId) {
  for(const day of giorni){
    const ex=day.esercizi.find(e=>e.id===exId);
    if(!ex) continue;
    ex.settimane.forEach((sw,w)=>{
      // find inputs by their onchange attributes
      const recInput = document.querySelector(`input[onchange="updateWeek('${exId}',${w},'recupero',this.value)"]`);
      const consInput = document.querySelector(`input[onchange="updateWeek('${exId}',${w},'consiglio',this.value)"]`);
      if(recInput && !recInput.value) recInput.value = sw.recupero||'';
      if(consInput && !consInput.value) consInput.value = sw.consiglio||'';
    });
    break;
  }
}

// ── METODOLOGIA → CONSIGLIO DEFAULT ──────────────────────────────────────────
function onMetodologiaChange(input, exId) {
  const val = input.value;
  updateEx(exId,'metodologia',val);
  // Set consiglio default for W1 if empty
  const consiglioDefault = getConsiglioDefault(val);
  if (!consiglioDefault) return;
  for(const day of giorni){
    const ex=day.esercizi.find(e=>e.id===exId);
    if(!ex) continue;
    ex.settimane.forEach((sw,w)=>{
      if(!sw.consiglio){
        sw.consiglio = consiglioDefault;
        const inp = document.querySelector(`input[onchange="updateWeek('${exId}',${w},'consiglio',this.value)"]`);
        if(inp) inp.value = consiglioDefault;
      }
    });
    break;
  }
}

function getConsiglioDefault(metodologia) {
  // Basic defaults — can be extended with _Liste_dinamiche data
  const m = metodologia.toLowerCase();
  if (m.includes('trova carico')) return 'Segna RPE';
  if (m.includes('rest pause')) return 'Segna RPE';
  if (m.includes('cluster')) return 'Intensità crescente';
  if (m.includes('bw')) return 'Segna RPE';
  if (m.includes('for time')) return 'Segna tempo';
  if (m.includes('amrap')) return 'Segna reps';
  if (m.includes('stripping')) return 'Scala 10%';
  return 'Segna RPE';
}

// ── AUTOCOMPLETE ──────────────────────────────────────────────────────────────
function acSidebar(input) {
  const val=input.value.toLowerCase();
  const listEl=document.getElementById('ac-nome_cliente');
  listEl.innerHTML='';
  // Unisci utenti dal foglio + clienti DB locale
  const dbClienti = getClientiDB();
  const dbUtenti = Object.entries(dbClienti)
    .filter(([email, d])=>d.nome)
    .map(([email, d])=>({nome:d.nome, email}));
  // Deduplicazione per email se presente, altrimenti per nome
  const tuttiUtenti = [...lists.utenti, ...dbUtenti]
    .filter((u,i,arr)=>{
      const key = u.email || u.nome;
      return arr.findIndex(x=>(x.email||x.nome)===key)===i;
    });
  const items=tuttiUtenti.filter(u=>u.nome && u.nome.toLowerCase().includes(val)).slice(0,8);
  if(!val||!items.length){listEl.classList.remove('open');return;}
  items.forEach(item=>{
    const d=document.createElement('div'); d.className='ac-item';
    d.innerHTML=`<span>${item.nome}</span><span class="ac-badge">${item.email||'—'}</span>`;
    d.onmousedown=()=>{
      input.value=item.nome;
      document.getElementById('email_cliente').value=item.email||'';
      listEl.classList.remove('open');
    };
    listEl.appendChild(d);
  });
  listEl.classList.add('open');
}

function acExercise(input, exId) {
  const val=input.value.toLowerCase();
  const listEl=document.getElementById('ac-ex-'+exId);
  listEl.innerHTML=''; acIdx=-1;
  const items=lists.esercizi.filter(e=>e.nome.toLowerCase().includes(val)).slice(0,8);
  if(!val||!items.length){listEl.classList.remove('open');return;}
  items.forEach(item=>{
    const d=document.createElement('div'); d.className='ac-item';
    d.innerHTML=`<span>${item.nome}</span><span class="ac-badge">${item.blocco}</span>`;
    d.onmousedown=()=>{
      input.value=item.nome;
      updateEx(exId,'esercizio',item.nome);
      updateEx(exId,'blocco',item.blocco);
      listEl.classList.remove('open'); acIdx=-1;
    };
    listEl.appendChild(d);
  });
  listEl.classList.add('open');
}

function acMetNote(input, exId, field) {
  const val=input.value.toLowerCase();
  const listId=field==='metodologia'?'ac-met-'+exId:'ac-note-'+exId;
  const listEl=document.getElementById(listId);
  listEl.innerHTML=''; acIdx=-1;
  const items=lists.metodologie.filter(m=>m.toLowerCase().includes(val)).slice(0,8);
  if(!val||!items.length){listEl.classList.remove('open');return;}
  items.forEach(item=>{
    const d=document.createElement('div'); d.className='ac-item'; d.textContent=item;
    d.onmousedown=()=>{
      input.value=item;
      if(field==='metodologia') onMetodologiaChange(input,exId);
      else updateEx(exId,field,item);
      listEl.classList.remove('open'); acIdx=-1;
    };
    listEl.appendChild(d);
  });
  listEl.classList.add('open');
}

function acConsiglio(input, exId, wIdx) {
  const val=input.value.toLowerCase();
  const listEl=document.getElementById(`ac-cons-${exId}-${wIdx}`);
  if(!listEl){return;}
  listEl.innerHTML=''; acIdx=-1;
  const consigli=['Segna RPE','Segna tempo','Segna reps','Buffer 1','Buffer 2','Buffer 3','RPE 7','RPE 8','RPE 8.5','RPE 9','Intensità crescente','Scala 10%','Segna kg'];
  const items=consigli.filter(c=>c.toLowerCase().includes(val)).slice(0,8);
  if(!val||!items.length){listEl.classList.remove('open');return;}
  items.forEach(item=>{
    const d=document.createElement('div'); d.className='ac-item'; d.textContent=item;
    d.onmousedown=()=>{ input.value=item; updateWeek(exId,wIdx,'consiglio',item); listEl.classList.remove('open'); acIdx=-1; };
    listEl.appendChild(d);
  });
  listEl.classList.add('open');
}

function acKey(e,input){
  const list = input.parentElement.querySelector('.ac-list');
  const listOpen = list && list.classList.contains('open');

  // If autocomplete is open, handle it first
  if(listOpen){
    const items = list.querySelectorAll('.ac-item');
    if(e.key==='ArrowDown'){acIdx=Math.min(acIdx+1,items.length-1);acHi(items);e.preventDefault();return;}
    if(e.key==='ArrowUp'){acIdx=Math.max(acIdx-1,-1);acHi(items);e.preventDefault();return;}
    if(e.key==='Enter'){
      if(acIdx>=0) items[acIdx].dispatchEvent(new MouseEvent('mousedown'));
      else if(items.length>0) items[0].dispatchEvent(new MouseEvent('mousedown'));
      acIdx=-1; e.preventDefault(); return;
    }
    if(e.key==='Escape'){list.classList.remove('open');acIdx=-1;return;}
    acIdx=-1;
  }

  // Arrow/Tab navigation between inputs — works in popup AND in ex-rows
  if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='ArrowRight'||e.key==='ArrowLeft'||e.key==='Tab'){
    // collect navigable inputs: popup first, then fallback to all row inputs
    const popup = document.getElementById('prog-popup');
    let scope = null;
    if(popup.classList.contains('open')) scope = popup;
    else {
      // find parent ex-row
      let el = input;
      while(el && !el.classList.contains('ex-row')) el = el.parentElement;
      if(el) scope = el;
    }
    if(scope){
      const allInputs = Array.from(scope.querySelectorAll('input'));
      const idx = allInputs.indexOf(input);
      if(idx>=0){
        let delta = 0;
        if(e.key==='ArrowDown'||e.key==='ArrowRight'||e.key==='Tab') delta=1;
        if(e.key==='ArrowUp'||e.key==='ArrowLeft') delta=-1;
        // ArrowRight/Left: only navigate if at end/start of text
        if(e.key==='ArrowRight'&&input.selectionStart!==input.value.length) return;
        if(e.key==='ArrowLeft'&&input.selectionStart!==0) return;
        let next = idx + delta;
        if(next<0) next=allInputs.length-1;
        if(next>=allInputs.length) next=0;
        allInputs[next].focus();
        e.preventDefault();
      }
    }
  }
}
function acHi(items){items.forEach((el,i)=>el.classList.toggle('hi',i===acIdx));}
function acBlur(input){setTimeout(()=>{const list=input.parentElement.querySelector('.ac-list');if(list){list.classList.remove('open');acIdx=-1;}},160);}

// ── SETTIMANE CHANGE ──────────────────────────────────────────────────────────
function onSettimaneChange(){
  const sw=parseInt(document.getElementById('settimane').value)||4;
  giorni.forEach(day=>{
    day.esercizi.forEach(ex=>{
      while(ex.settimane.length<sw) ex.settimane.push({struttura:'',recupero:'',consiglio:'',serie:'',ripetizioni:'',percentuale:'',carico:''});
      ex.settimane=ex.settimane.slice(0,sw);
    });
  });
  const saved=[...giorni]; document.getElementById('giorni-container').innerHTML=''; giorni=[];
  saved.forEach(day=>{
    giorni.push(day); renderDay(day);
    day.esercizi.forEach(ex=>renderExRow(day.id,ex,sw));
    updateDayCount(day.id);
  });
}

// ── BUILD CSV ─────────────────────────────────────────────────────────────────
function buildCSV(){
  const nome=document.getElementById('nome_cliente').value.trim();
  const email=document.getElementById('email_cliente').value.trim();
  const nomeProg=document.getElementById('nome_programma').value.trim();
  const dataProg=document.getElementById('data_programma').value;
  const sw=parseInt(document.getElementById('settimane').value);
  if(!nome||!nomeProg){showError('Compila Nome cliente e Nome programma.');return false;}
  const dataF=dataProg?dataProg:'';
  csvData=[];
  for(let w=1;w<=sw;w++){
    let slot=1;
    giorni.forEach(day=>{
      day.esercizi.forEach(ex=>{
        if(!ex.esercizio)return;
        const swData=ex.settimane[w-1]||{};
        // Parsing on-the-fly se i campi derivati sono vuoti
        const parsed = parseStruttura(swData.struttura||'');
        const serie     = swData.serie       || parsed.serie       || '';
        const rip       = swData.ripetizioni || parsed.ripetizioni || '';
        const perc      = swData.percentuale || parsed.percentuale || '';
        const carico    = swData.carico      || parsed.carico      || '';
        const recupero  = swData.recupero    || parsed.recupero    || '';
        const consiglio = swData.consiglio   || parsed.consiglio   || '';
        // struttura: replace * with ·
        const strutFix=(swData.struttura||'').replace(/\*/g,'·');
        const esercizio = swData.esercizio !== undefined ? swData.esercizio : ex.esercizio;
        const nota      = swData.note !== undefined ? swData.note : (ex.note||'');
        const metod     = swData.metodologia !== undefined ? swData.metodologia : (ex.metodologia||'');
        csvData.push({
          'email':email,'Nome':nome,'Nome programma':nomeProg,'Data programma':dataF,
          'Settimana':w,'Giorno':giorni.indexOf(day)+1,'Esercizio':esercizio,'Blocco':ex.blocco,
          'Note':nota,'Metodologia':metod,'Carico':carico,
          'Struttura':strutFix,'Ripetizioni':rip,'Serie':serie,
          'Percentuale %':perc,'Recupero':recupero,
          'Consiglio':consiglio,'Posizione':slot,'Attivo':'TRUE'
        });
        slot++;
      });
    });
  }
  renderPreview();
  document.getElementById('preview-wrap').style.display='block';
  hideError(); return true;
}

function renderPreview(){
  if(!csvData.length)return;
  const cols=Object.keys(csvData[0]);
  document.getElementById('prev-head').innerHTML='<tr>'+cols.map(c=>'<th>'+c+'</th>').join('')+'</tr>';
  document.getElementById('prev-body').innerHTML=csvData.slice(0,30).map(row=>
    '<tr>'+cols.map(c=>'<td>'+(row[c]??'')+'</td>').join('')+'</tr>'
  ).join('')+(csvData.length>30?'<tr><td colspan="'+cols.length+'" style="color:var(--muted);text-align:center;padding:8px">...+'+(csvData.length-30)+' righe</td></tr>':'');
}

// ── AUTOSAVE ─────────────────────────────────────────────────────────────────
let saveTimer = null;
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    autosave();
    updateSidePanel();
  }, 800);
}

function autosave() {
  const state = {
    nome:     document.getElementById('nome_cliente').value,
    email:    document.getElementById('email_cliente').value,
    programma:document.getElementById('nome_programma').value,
    data:     document.getElementById('data_programma').value,
    settimane:document.getElementById('settimane').value,
    giorni:   giorni
  };
  localStorage.setItem('coaching_program', JSON.stringify(state));
  const ind = document.getElementById('save-indicator');
  ind.textContent = 'salvato ' + new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});
  ind.classList.add('show');
  clearTimeout(ind._t);
  ind._t = setTimeout(()=>ind.classList.remove('show'), 2500);
}

function restoreProgram() {
  const saved = localStorage.getItem('coaching_program');
  if (!saved) return;
  try {
    const s = JSON.parse(saved);
    if (s.nome)      document.getElementById('nome_cliente').value  = s.nome;
    if (s.email)     document.getElementById('email_cliente').value = s.email;
    if (s.programma) document.getElementById('nome_programma').value= s.programma;
    if (s.data)      document.getElementById('data_programma').value= s.data;
    if (s.settimane) document.getElementById('settimane').value     = s.settimane;
    if (s.giorni && s.giorni.length) {
      giorni = s.giorni;
      document.getElementById('giorni-container').innerHTML = '';
      const sw = parseInt(s.settimane)||4;
      giorni.forEach(day => {
        renderDay(day);
        day.esercizi.forEach(ex => renderExRow(day.id, ex, sw));
        updateDayCount(day.id);
      });
    }
  } catch(e) { console.warn('Ripristino programma fallito', e); }
  setTimeout(updateSidePanel, 100);
}

function nuovoProgramma() {
  if (!confirm('Sei sicuro? Il programma corrente verrà cancellato.')) return;
  localStorage.removeItem('coaching_program');
  document.getElementById('nome_cliente').value  = '';
  document.getElementById('email_cliente').value = '';
  document.getElementById('nome_programma').value= '';
  document.getElementById('data_programma').value= '';
  document.getElementById('settimane').value     = '4';
  giorni = [];
  document.getElementById('giorni-container').innerHTML = '';
  csvData = [];
  document.getElementById('preview-wrap').style.display='none';
  defaultTemplate();
}

function defaultTemplate() {
  const sw = parseInt(document.getElementById('settimane').value)||4;
  for(let d=0; d<3; d++){
    addDay();
    const day = giorni[giorni.length-1];
    for(let e=0; e<5; e++){
      const exId = uid();
      const ex = {
        id:exId, esercizio:'', blocco:'', metodologia:'', note:'',
        settimane: Array.from({length:sw},()=>({struttura:'',recupero:'',consiglio:'',serie:'',ripetizioni:'',percentuale:'',carico:''}))
      };
      day.esercizi.push(ex);
      renderExRow(day.id, ex, sw);
      updateDayCount(day.id);
    }
  }
  scheduleAutosave();
}

// ── VALIDAZIONE ───────────────────────────────────────────────────────────────
function validateProgram() {
  const errors = [];
  const warnings = [];
  const nome    = document.getElementById('nome_cliente').value.trim();
  const programma = document.getElementById('nome_programma').value.trim();

  const email = document.getElementById('email_cliente').value.trim();
  const data  = document.getElementById('data_programma').value.trim();

  if (!nome)      errors.push('Nome cliente mancante');
  if (!email)     errors.push('Email cliente mancante');
  if (!programma) errors.push('Nome programma mancante');
  if (!data)      errors.push('Data programma mancante');

  const sw = parseInt(document.getElementById('settimane').value)||4;
  let totEsercizi = 0;
  giorni.forEach((day, di) => {
    const nomeGiorno = 'Giorno ' + (di+1);
    const esValidi = day.esercizi.filter(e=>e.esercizio);
    if (!esValidi.length) {
      warnings.push(nomeGiorno + ': nessun esercizio inserito');
      return;
    }
    totEsercizi += esValidi.length;
    esValidi.forEach(ex => {
      if (!ex.metodologia) errors.push(nomeGiorno + ' - ' + ex.esercizio + ': metodologia mancante');
      if (!ex.blocco) warnings.push(nomeGiorno + ' - ' + ex.esercizio + ': blocco mancante');
      for (let w=0; w<sw; w++) {
        const sd = ex.settimane[w]||{};
        if (!sd.struttura) warnings.push(nomeGiorno + ' - ' + ex.esercizio + ': struttura W'+(w+1)+' vuota');
      }
    });
  });
  if (totEsercizi === 0) errors.push('Nessun esercizio inserito nel programma');

  return { errors, warnings };
}

function buildAndExport() {
  const { errors, warnings } = validateProgram();
  if (errors.length || warnings.length) {
    showValModal(errors, warnings, true);
  } else {
    if(buildCSV()) downloadCSV();
  }
}

function showValModal(errors, warnings, withExport) {
  const errSec  = document.getElementById('val-errors-section');
  const warnSec = document.getElementById('val-warnings-section');
  const errDiv  = document.getElementById('val-errors');
  const warnDiv = document.getElementById('val-warnings');
  const expBtn  = document.getElementById('val-export-btn');

  errDiv.innerHTML  = errors.map(e=>'<div class="val-item err">'+e+'</div>').join('');
  warnDiv.innerHTML = warnings.map(w=>'<div class="val-item warn">'+w+'</div>').join('');
  errSec.style.display  = errors.length   ? 'block' : 'none';
  warnSec.style.display = warnings.length ? 'block' : 'none';
  // Esporta comunque solo se non ci sono errori bloccanti
  expBtn.style.display  = (withExport && !errors.length) ? 'inline-flex' : 'none';
  document.getElementById('val-overlay').classList.add('open');
}

function closeValModal() {
  document.getElementById('val-overlay').classList.remove('open');
}

function closeValAndExport() {
  closeValModal();
  if(buildCSV()) downloadCSV();
}

function downloadCSV(){
  if(!csvData.length){buildCSV();return;}
  const cols=Object.keys(csvData[0]);
  const sep=',';
  const escapeCSV = v => {
    const s = String(v??'');
    // Sostituisci · con * per compatibilità Glide
    const clean = s;
    if(clean.includes(sep)||clean.includes('"')||clean.includes('\n')){
      return '"'+clean.replace(/"/g,'""')+'"';
    }
    return clean;
  };
  const lines=[cols.join(sep),...csvData.map(row=>cols.map(col=>escapeCSV(row[col])).join(sep))];
  const nome = document.getElementById('nome_cliente').value.trim().replace(/\s+/g,'_') || 'cliente';
  const data = document.getElementById('data_programma').value.replace(/-/g,'') || '';
  const filename = [nome, data].filter(Boolean).join('_') + '.csv';
  const blob=new Blob(['\uFEFF'+lines.join('\n')],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url;
  a.download=filename;
  a.click(); URL.revokeObjectURL(url);
}

function toggleExport(){document.getElementById('export-panel').classList.toggle('open');}






// ── STATS SIDEBAR ─────────────────────────────────────────────────────────────
function parseDataIT(dataStr) {
  if(!dataStr) return null;
  const p = dataStr.split('/');
  if(p.length!==3) return null;
  return new Date(p[2], p[1]-1, p[0]);
}

function clienteCategoria(email) {
  const pagDB = getPagamentiDB();
  const pags = pagDB[email];
  if(!pags || !pags.length) return 'inattivo';
  const last = pags[pags.length-1];
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const treM = new Date(oggi); treM.setDate(treM.getDate()-90);
  const scad = parseDataIT(last.scadenza);

  // Scadenza futura
  if(scad && scad >= oggi) {
    if(!last.pagato) return 'pend'; // attivo ma non saldato
    const diff = Math.round((scad-oggi)/86400000);
    if(diff<=7) return 'warn';
    return 'ok';
  }
  // Scadenza passata
  if(scad && scad < treM) return 'inattivo'; // scaduto da 90+ giorni
  return 'scaduto'; // scaduto da 1 a 89 giorni
}

function computeStats() {
  const pagDB = getPagamentiDB();
  const clientiDB = getClientiDB();

  const tuttiEmail = new Set([
    ...Object.keys(pagDB),
    ...Object.keys(clientiDB),
    ...(window._sheetUsers||[]).map(u=>u.email).filter(Boolean)
  ]);

  let attivi=0, scadenza=0, inattivi=0, scaduti=0;
  let incassoTeorico=0, incassoReale=0;
  const listAttivi=[], listScadenza=[], listInattivi=[], listScaduti=[], listPending=[];

  tuttiEmail.forEach(email=>{
    const pags = pagDB[email]||[];
    const nome = pags[0]?.nome || clientiDB[email]?.nome || email;
    const cat = clienteCategoria(email);
    if(cat==='ok') { attivi++; listAttivi.push({email,nome}); }
    else if(cat==='warn') { scadenza++; listScadenza.push({email,nome}); }
    else if(cat==='pend') { scadenza++; listScadenza.push({email,nome}); }
    else if(cat==='scaduto') { scaduti++; listScaduti.push({email,nome}); }
    else { inattivi++; listInattivi.push({email,nome}); }
    // Pending: tutti i pagamenti non saldati
    pags.filter(p=>!p.pagato).forEach(p=>{
      listPending.push({email, nome, data:p.data, importo:p.importo, scadenza:p.scadenza});
    });

    pags.forEach(p=>{
      incassoTeorico += parseFloat(p.importo)||0;
      if(p.pagato) incassoReale += parseFloat(p.importo)||0;
    });
  });

  const totali = tuttiEmail.size;
  const delta = incassoTeorico - incassoReale;

  return { totali, attivi, scadenza, inattivi, scaduti, incassoTeorico, incassoReale, delta,
           listAttivi, listScadenza, listInattivi, listScaduti, listPending };
}

let _lastStats = null;

function renderStats(prefix) {
  const s = computeStats();
  _lastStats = s;
  const set = (id, val) => { const el = document.getElementById(prefix+id); if(el) el.textContent = val; };
  set('totali', s.totali);
  set('attivi', s.attivi);
  set('scadenza', s.scadenza);
  set('inattivi', s.inattivi);
  set('scaduti', s.scaduti);
  set('incasso-teorico', '€'+s.incassoTeorico.toFixed(0));
  set('incasso-reale', '€'+s.incassoReale.toFixed(0));
  set('delta', s.delta > 0 ? '-€'+s.delta.toFixed(0) : '—');
}

function apriStatLista(tipo) {
  if(!_lastStats) { renderStats('stat-'); }
  const s = _lastStats;
  const labels = { totali:'Tutti i clienti', attivi:'Clienti attivi', scadenza:'In scadenza',
                   inattivi:'Clienti inattivi', scaduti:'Clienti scaduti', pending:'Da incassare' };
  const liste = {
    totali: [...s.listAttivi, ...s.listScadenza, ...s.listInattivi, ...s.listScaduti],
    attivi: s.listAttivi, scadenza: s.listScadenza,
    inattivi: s.listInattivi, scaduti: s.listScaduti, pending: s.listPending
  };
  const lista = (liste[tipo]||[]).sort((a,b)=>a.nome.localeCompare(b.nome));
  document.getElementById('stat-lista-title').textContent = labels[tipo]||tipo + ' ('+lista.length+')';
  const body = document.getElementById('stat-lista-body');
  body.innerHTML = '';
  if(!lista.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0;">Nessun cliente.</div>';
  } else {
    lista.forEach(u=>{
      const div = document.createElement('div');
      div.style.cssText = 'padding:7px 0;border-bottom:1px solid var(--border);cursor:pointer;';
      const extra = u.importo ? ' · €'+u.importo+(u.data?' · '+u.data:'') : '';
      div.innerHTML = '<div style="font-size:11px;">'+u.nome+'<span style="font-family:DM Mono,monospace;font-size:9px;color:#ff5555;margin-left:6px;">'+extra+'</span></div><div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted);">'+u.email+'</div>';
      div.onclick = ()=>{ closeStatLista(); apriPagCliente(u.email); };
      body.appendChild(div);
    });
  }
  document.getElementById('stat-lista-overlay').classList.add('open');
}

function closeStatLista(e) {
  if(!e || e.target===document.getElementById('stat-lista-overlay'))
    document.getElementById('stat-lista-overlay').classList.remove('open');
}

// ── PAGAMENTI ─────────────────────────────────────────────────────────────────

function esportaPagamentiCSV() {
  const db = getPagamentiDB();
  const clientiDB = getClientiDB();
  const rows = [];
  rows.push('Nome membro,Email,Data pagamento,Importo,Mensilità,Pagato,Data scadenza');
  Object.entries(db).forEach(([email, pags])=>{
    pags.forEach(p=>{
      const nome = p.nome || clientiDB[email]?.nome || '';
      rows.push([
        nome, email, p.data||'',
        p.importo||'', p.mesi||1,
        p.pagato?'TRUE':'FALSE',
        p.scadenza||''
      ].join(','));
    });
  });
  const blob = new Blob(['﻿'+rows.join('\n')], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pagamenti_backup_'+new Date().toLocaleDateString('it-IT').replace(/\//g,'-')+'.csv';
  a.click();
}

function getPagamentiDB() {
  try { return JSON.parse(localStorage.getItem('coaching_pagamenti')||'{}'); } catch(e){ return {}; }
}
function setPagamentiDB(db) { localStorage.setItem('coaching_pagamenti', JSON.stringify(db)); }

function pagStatus(scadenza, pagato) {
  if(!scadenza) return 'none';
  const parts = scadenza.split('/');
  if(parts.length !== 3) return 'none';
  const d = new Date(parts[2], parts[1]-1, parts[0]);
  const oggi = new Date(); oggi.setHours(0,0,0,0);
  const diff = Math.round((d - oggi) / 86400000);
  if(diff < 0) return 'exp';
  if(!pagato) return 'pend';
  if(diff <= 7) return 'warn';
  return 'ok';
}

function calcolaScadenza(dataPag, durata) {
  const parts = dataPag.split('/');
  if(parts.length !== 3) return '';
  const d = new Date(parts[2], parts[1]-1, parts[0]);
  d.setDate(d.getDate() + parseInt(durata||30));
  return d.toLocaleDateString('it-IT');
}

function renderPagClientiList() {
  const query = (document.getElementById('pag-search')?.value||'').toLowerCase();
  const pagDB = getPagamentiDB();
  const clientiDB = getClientiDB();
  const list = document.getElementById('pag-clienti-list');
  if(!list) return;
  list.innerHTML = '';

  // Unisci clienti da pagamenti + anagrafica
  const clienti = {};
  // Prima da anagrafica
  Object.entries(clientiDB).forEach(([email, data])=>{
    clienti[email] = { email, nome: data.nome||email, scadenza:'', pagato:null };
  });
  // Poi da pagamenti (sovrascrive con dati più aggiornati)
  Object.entries(pagDB).forEach(([email, pags])=>{
    const last = pags[pags.length-1];
    const nome = last?.nome || clientiDB[email]?.nome || email;
    clienti[email] = { email, nome, scadenza: last?.scadenza||'', pagato: last?.pagato };
  });
  // Aggiungi anche da sheet users se non già presenti
  if(window._sheetUsers) {
    window._sheetUsers.forEach(u=>{
      if(u.email && !clienti[u.email]) clienti[u.email] = { email:u.email, nome:u.nome||u.email, scadenza:'', pagato:null };
    });
  }

  const keys = Object.keys(clienti)
    .filter(k=>!query || clienti[k].nome.toLowerCase().includes(query) || k.toLowerCase().includes(query))
    .sort((a,b)=>clienti[a].nome.localeCompare(clienti[b].nome));

  if(!keys.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:10px;">Nessun cliente.</div>';
    return;
  }

  keys.forEach(email=>{
    const u = clienti[email];
    const st = pagStatus(u.scadenza, u.pagato);
    const item = document.createElement('div');
    item.className = 'pag-cliente-item';
    item.innerHTML = `
      <div style="display:flex;align-items:center;gap:7px;">
        <div class="pag-status-dot ${st}"></div>
        <div>
          <div class="pag-cliente-nome">${u.nome}</div>
          <div class="pag-cliente-email">${email}</div>
        </div>
      </div>`;
    item.onclick = ()=>apriPagCliente(email);
    list.appendChild(item);
  });
}

let pagClienteSelezionato = null;

function apriPagCliente(email) {
  pagClienteSelezionato = email;
  const db = getPagamentiDB();
  const pags = db[email] || [];
  const nome = pags[0]?.nome || email;
  const main = document.getElementById('pag-main');

  const totPagato = pags.filter(p=>p.pagato).reduce((s,p)=>s+(parseFloat(p.importo)||0),0);
  const totDaPagare = pags.filter(p=>!p.pagato).reduce((s,p)=>s+(parseFloat(p.importo)||0),0);
  const lastPag = pags[pags.length-1];
  const lastScad = lastPag?.scadenza||'';
  const st = pagStatus(lastScad, lastPag?.pagato);
  const stLabel = {ok:'Attivo',warn:'Scade presto',exp:'Scaduto',pend:'In attesa pagamento',none:'—'}[st];

  main.innerHTML = `
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:4px;">
      <div class="scheda-title">${esc(nome)}</div>
      <span class="pag-badge ${st}">${stLabel}${lastScad?' · '+lastScad:''}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px;">
      <div class="scheda-email" style="margin-bottom:0;">${esc(email)}</div>
      <input id="pag-email-edit" value="${esc(email)}" style="background:var(--surface2);border:1px solid var(--border);color:var(--muted);font-family:'DM Mono',monospace;font-size:9px;padding:2px 7px;border-radius:3px;outline:none;width:180px;" placeholder="Aggiorna email...">
      <button class="btn btn-ghost" id="btn-update-email" style="height:22px;font-size:9px;padding:0 8px;">✓</button>
    </div>

    <div class="pag-summary" style="grid-template-columns:1fr 1fr;">
      <div class="pag-summary-card">
        <div class="pag-summary-val">€${totPagato.toFixed(0)}</div>
        <div class="pag-summary-label">Totale versato</div>
      </div>
      <div class="pag-summary-card" style="${totDaPagare>0?'border-color:#ff5555;':''}">
        <div class="pag-summary-val" style="${totDaPagare>0?'color:#ff5555;':'color:var(--muted);'}">${totDaPagare>0?'-€'+totDaPagare.toFixed(0):'—'}</div>
        <div class="pag-summary-label">Da saldare</div>
      </div>
    </div>

    <div class="pag-add-form">
      <div style="font-family:'DM Mono',monospace;font-size:8px;color:var(--muted);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">Nuovo pagamento</div>
      <div class="pag-form-grid">
        <div>
          <div class="scheda-label" style="margin-bottom:3px;">Data pagamento</div>
          <input class="pag-input" id="np-data" type="date">
        </div>
        <div>
          <div class="scheda-label" style="margin-bottom:3px;">Importo (€)</div>
          <input class="pag-input" id="np-importo" type="number" placeholder="37">
        </div>
        <div>
          <div class="scheda-label" style="margin-bottom:3px;">Mensilià</div>
          <input class="pag-input" id="np-durata" type="number" placeholder="1" value="1" min="1">
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;">
        <label style="display:flex;align-items:center;gap:6px;font-size:11px;cursor:pointer;">
          <input type="checkbox" id="np-pagato" checked style="accent-color:var(--accent);"> Pagato
        </label>
        <button class="btn btn-accent" id="btn-aggiungi-pag" style="height:28px;font-size:10px;padding:0 16px;">+ Aggiungi</button>
      </div>
    </div>

    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;overflow:hidden;">
      <div class="pag-row header">
        <div>Data</div><div>Importo</div><div>Mesi</div><div>Scadenza</div><div>Stato</div><div></div>
      </div>
      <div id="pag-storico"></div>
    </div>`;

  // Bind via JS — niente email interpolata negli onclick inline
  document.getElementById('btn-aggiungi-pag').onclick = () => aggiungiPagamento(email);
  document.getElementById('btn-update-email').onclick = () => aggiornaPagEmail(email);

  renderPagStorico(email);

  const oggi = new Date();
  document.getElementById('np-data').value = oggi.toISOString().split('T')[0];
}
function aggiornaPagEmail(oldEmail) {
  const newEmail = document.getElementById('pag-email-edit').value.trim();
  if(!newEmail || newEmail === oldEmail) return;
  const db = getPagamentiDB();
  if(db[oldEmail]) {
    db[newEmail] = db[oldEmail];
    delete db[oldEmail];
    setPagamentiDB(db);
    pagClienteSelezionato = newEmail;
    renderPagClientiList();
    apriPagCliente(newEmail);
  }
}

function renderPagStorico(email) {
  const db = getPagamentiDB();
  const pags = [...(db[email]||[])].reverse();
  const el = document.getElementById('pag-storico');
  if(!el) return;
  el.innerHTML = '';
  if(!pags.length) {
    el.innerHTML = '<div style="padding:12px;color:var(--muted);font-size:11px;">Nessun pagamento registrato.</div>';
    return;
  }
  pags.forEach((p, i)=>{
    const realIdx = (db[email].length-1) - i;
    const st = pagStatus(p.scadenza, p.pagato);
    const stLabel = {ok:'Attivo',warn:'Scade presto',exp:'Scaduto',none:'—'}[st];
    const row = document.createElement('div');
    row.className = 'pag-row';
    // Colonne: data | importo | mesi | scadenza | stato (badge cliccabile) | azioni (elimina)
    row.innerHTML = `
      <div>${p.data||'—'}</div>
      <div>€${parseFloat(p.importo||0).toFixed(2)}</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;">${p.mesi||Math.round((p.durata||30)/30)} mes${(p.mesi||1)===1?'e':'i'}</div>
      <div style="font-family:'DM Mono',monospace;font-size:9px;">${p.scadenza||'—'}</div>
      <div>
        <span class="pag-badge ${st}" id="badge-pag-${realIdx}" style="${!p.pagato?'cursor:pointer;border:1px dashed #f0c040;':''}" title="${!p.pagato?'Clicca per segnare come pagato':''}">
          ${p.pagato?stLabel:'In attesa ✓?'}
        </span>
      </div>
      <div style="display:flex;gap:4px;align-items:center;">
        <button id="del-pag-${realIdx}" style="background:none;border:none;color:var(--accent2);cursor:pointer;font-size:11px;padding:2px 4px;">✕</button>
      </div>`;
    // Bind via JS — nessuna email inline
    if(!p.pagato) {
      row.querySelector('#badge-pag-'+realIdx).onclick = () => togglePagato(email, realIdx);
    }
    row.querySelector('#del-pag-'+realIdx).onclick = () => eliminaPagamento(email, realIdx);
    el.appendChild(row);
  });
}

function togglePagato(email, idx) {
  const db = getPagamentiDB();
  if(!db[email] || !db[email][idx]) return;
  db[email][idx].pagato = true;
  setPagamentiDB(db);
  apriPagCliente(email);
  renderPagClientiList();
  renderStats('stat-');
}
function aggiungiPagamento(email) {
  const dataISO = document.getElementById('np-data').value;
  const importo = document.getElementById('np-importo').value;
  const mensilitaN = parseInt(document.getElementById('np-durata').value) || 1;
  const pagato  = document.getElementById('np-pagato').checked;
  // Validazione con feedback visivo
  let valid = true;
  const npData   = document.getElementById('np-data');
  const npImporto = document.getElementById('np-importo');
  const npDurata  = document.getElementById('np-durata');
  [npData, npImporto, npDurata].forEach(el=>{
    if(!el.value) { el.style.borderColor='var(--accent2)'; valid=false; }
    else el.style.borderColor='';
  });
  if(!valid) return;

  const nome = getPagamentiDB()[email]?.[0]?.nome || getClientiDB()[email]?.nome || email;
  const db = getPagamentiDB();
  if(!db[email]) db[email] = [];

  // Genera una riga per ogni mensilità
  let dataCorrente = dataISO; // ISO per calcoli
  for(let i = 0; i < mensilitaN; i++) {
    const [y,m,d] = dataCorrente.split('-');
    const dataIT = `${d}/${m}/${y}`;
    const scadenza = calcolaScadenza(dataIT, 30);
    db[email].push({ nome, data: dataIT, importo: parseFloat(importo), mesi: 1, pagato, scadenza });
    // Prossima mensilità: avanza di 30 giorni
    const next = new Date(dataCorrente);
    next.setDate(next.getDate() + 30);
    dataCorrente = next.toISOString().split('T')[0];
  }

  db[email].sort((a,b)=>a.data.split('/').reverse().join('').localeCompare(b.data.split('/').reverse().join('')));
  setPagamentiDB(db);
  apriPagCliente(email);
  renderPagClientiList();
  renderStats('stat-');
}

function eliminaPagamento(email, idx) {
  const db = getPagamentiDB();
  if(!db[email]) return;
  db[email].splice(idx,1);
  setPagamentiDB(db);
  apriPagCliente(email);
  renderPagClientiList();
  renderStats('stat-');
}

function trovEmailDaNome(nome) {
  // Cerca nei clienti DB
  const db = getClientiDB();
  const match = Object.entries(db).find(([email, d])=>
    (d.nome||'').toLowerCase() === nome.toLowerCase()
  );
  if(match) return match[0];
  // Cerca nei dati sheet
  if(window._sheetUsers) {
    const u = window._sheetUsers.find(u=>u.nome.toLowerCase()===nome.toLowerCase());
    if(u && u.email) return u.email;
  }
  // Fallback: usa nome come chiave
  return nome.toLowerCase().replace(/\s+/g,'.');
}

function importaPagamenti() {
  const text = document.getElementById('pag-import-area').value.trim();
  const status = document.getElementById('pag-import-status');
  if(!text) { status.textContent='Incolla prima il CSV.'; return; }

  const lines = text.split('\n').map(l=>l.trim().replace(/^,/,'')).filter(l=>l);
  if(lines.length < 2) { status.textContent='CSV non valido.'; return; }

  const sep = lines[0].includes('\t') ? '\t' : ',';
  const parseLine = sep==='\t' ? l=>l.split('\t').map(v=>v.trim()) : parseCSVLine;
  const header = parseLine(lines[0].replace(/^\uFEFF/,'')).map(h=>h.trim());
  const rows = lines.slice(1).map(l=>{ const cols=parseLine(l); const obj={}; header.forEach((h,i)=>{ obj[h]=(cols[i]||'').trim(); }); return obj; });

  const db = getPagamentiDB();
  let count = 0;
  rows.forEach(r=>{
    const nome  = (r['Nome membro']||r['Nome membro']||r['Nome']||'').trim();
    if(!nome) return;
    // Email: dalla colonna se presente, altrimenti cerca per nome
    const email = r['Email']||r['email'] || trovEmailDaNome(nome);
    if(!db[email]) db[email]=[];
    const data     = r['Data pagamento']||'';
    const importo  = parseFloat((r['Importo']||'0').replace('€','').replace(',','.'))||0;
    const durata   = parseInt(r['Durata (giorni)']||'30')||30;
    const pagatoVal = (r['Pagato']||r['Pagato?']||'').trim(); const pagato = pagatoVal.toLowerCase().includes('true')||pagatoVal==='1'||pagatoVal==='✓'||pagatoVal==='TRUE';
    const scadenza = (r['Data scadenza']||r['Data scadenza ']||'').trim() || calcolaScadenza(data, durata);
    const mesiN = Math.round(durata/30) || 1;
    // Espandi in righe mensili
    let dataCorrenteIT = data;
    for(let i=0; i<mesiN; i++){
      const [dd,mm,yy] = dataCorrenteIT.split('/');
      const scad = calcolaScadenza(dataCorrenteIT, 30);
      const exists = db[email].find(p=>p.data===dataCorrenteIT && p.importo===importo);
      if(!exists){ db[email].push({ nome, data:dataCorrenteIT, importo, mesi:1, pagato, scadenza:scad }); count++; }
      // Avanza 30 giorni
      const next = new Date(yy,mm-1,dd); next.setDate(next.getDate()+30);
      dataCorrenteIT = next.toLocaleDateString('it-IT');
    }
  });

  Object.keys(db).forEach(k=>db[k].sort((a,b)=>a.data.split('/').reverse().join('').localeCompare(b.data.split('/').reverse().join(''))));
  setPagamentiDB(db);
  status.textContent = '✓ '+count+' pagamenti importati';
  document.getElementById('pag-import-area').value='';
  renderPagClientiList();
}

// ── PAGINA CLIENTI ────────────────────────────────────────────────────────────
let clienteSelezionato = null;

function renderClientiList() {
  const query = (document.getElementById('clienti-search')?.value||'').toLowerCase();
  const db = getClientiDB();

  // Raccogli clienti da DB + da sheet data
  const tuttiClienti = {};
  Object.entries(db).forEach(([email, data])=>{
    tuttiClienti[email] = { email, nome: data.nome||'' };
  });
  // Aggiungi clienti dal foglio Google
  if(window._sheetUsers) {
    window._sheetUsers.forEach(u=>{
      if(!tuttiClienti[u.email]) tuttiClienti[u.email] = { email: u.email, nome: u.nome||'' };
    });
  }

  const list = document.getElementById('clienti-list');
  if(!list) return;
  list.innerHTML = '';

  const keys = Object.keys(tuttiClienti)
    .filter(k=>{
      const u = tuttiClienti[k];
      return !query || u.nome.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
    })
    .sort((a,b)=>(tuttiClienti[a].nome||a).localeCompare(tuttiClienti[b].nome||b));

  if(!keys.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:10px;padding:8px 0">Nessun cliente.</div>';
    return;
  }

  keys.forEach(email=>{
    const u = tuttiClienti[email];
    const item = document.createElement('div');
    item.className = 'cliente-list-item' + (clienteSelezionato===email?' active':'');
    const nome = document.createElement('div');
    nome.className = 'cliente-list-nome';
    nome.textContent = u.nome || email;
    const mail = document.createElement('div');
    mail.className = 'cliente-list-email';
    mail.textContent = email;
    item.appendChild(nome);
    item.appendChild(mail);
    item.onclick = (e)=>{ if(e.target.classList.contains('cliente-del')) return; apriScheda(email, u.nome); };

    const del = document.createElement('button');
    del.className = 'cliente-del';
    del.textContent = '✕';
    del.style.cssText = 'position:absolute;top:6px;right:6px;background:none;border:none;color:var(--accent2);cursor:pointer;font-size:10px;padding:2px;opacity:0;transition:opacity 0.15s;';
    del.onclick = (e)=>{ e.stopPropagation(); eliminaCliente(email); };
    item.style.position = 'relative';
    item.onmouseenter = ()=>del.style.opacity='1';
    item.onmouseleave = ()=>del.style.opacity='0';
    item.appendChild(del);
    list.appendChild(item);
  });
}

function apriScheda(email, nomeDefault) {
  clienteSelezionato = email;
  renderClientiList();

  const db = getClientiDB();
  const data = db[email] || DEMO_CLIENTI[email] || {};
  const nome = data.nome || nomeDefault || email;

  const main = document.getElementById('clienti-main');
  main.innerHTML = `
    <div class="scheda-title">${nome}</div>
    <div class="scheda-email">${email}</div>

    <div class="scheda-grid">
      <div class="scheda-field">
        <div class="scheda-label">Nome</div>
        <input class="scheda-input" id="sc-nome" value="${data.nome||nomeDefault||''}" placeholder="Nome completo">
      </div>
      <div class="scheda-field">
        <div class="scheda-label">Frequenza settimanale</div>
        <input class="scheda-input" id="sc-frequenza" value="${data.frequenza||''}" placeholder="es. 4 giorni/settimana">
      </div>
      <div class="scheda-field">
        <div class="scheda-label">Obiettivo breve termine</div>
        <input class="scheda-input" id="sc-obj-breve" value="${data.obj_breve||''}" placeholder="es. Perdere 5kg entro marzo">
      </div>
      <div class="scheda-field">
        <div class="scheda-label">Obiettivo lungo termine</div>
        <input class="scheda-input" id="sc-obj-lungo" value="${data.obj_lungo||''}" placeholder="es. Costruire una base di forza">
      </div>
      <div class="scheda-field full">
        <div class="scheda-label">Limitazioni / attrezzatura mancante</div>
        <textarea class="scheda-input" id="sc-limitazioni" rows="2" placeholder="es. No leg curl · Spalla destra problematica">${data.limitazioni||''}</textarea>
      </div>
      <div class="scheda-field full">
        <div class="scheda-label">Esercizi problematici</div>
        <textarea class="scheda-input" id="sc-problemi" rows="2" placeholder="es. Evitare squat bulgaro · Dolore al ginocchio">${data.problemi||''}</textarea>
      </div>
    </div>

    <div class="scheda-label" style="margin-bottom:8px;">Massimali</div>
    <div class="massimali-grid">
      <div class="max-card">
        <div class="max-card-label">Squat</div>
        <input class="max-card-input" id="sc-max-squat" type="number" placeholder="—" value="${data.massimali?.squat||''}">
        <div class="max-card-unit">kg</div>
      </div>
      <div class="max-card">
        <div class="max-card-label">Panca</div>
        <input class="max-card-input" id="sc-max-panca" type="number" placeholder="—" value="${data.massimali?.panca||''}">
        <div class="max-card-unit">kg</div>
      </div>
      <div class="max-card">
        <div class="max-card-label">Stacco</div>
        <input class="max-card-input" id="sc-max-stacco" type="number" placeholder="—" value="${data.massimali?.stacco||''}">
        <div class="max-card-unit">kg</div>
      </div>
      <div class="max-card">
        <div class="max-card-label">Military Press</div>
        <input class="max-card-input" id="sc-max-mp" type="number" placeholder="—" value="${data.massimali?.mp||''}">
        <div class="max-card-unit">kg</div>
      </div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
      <div class="scheda-label">Note dinamiche</div>
    </div>
    <div id="sc-note-list" style="margin-bottom:10px;"></div>
    <div style="display:flex;gap:6px;margin-bottom:20px;">
      <input class="scheda-input" id="sc-nota-input" placeholder="Aggiungi nota..." style="height:30px;flex:1;">
      <button class="btn btn-outline" onclick="addSchedaNota('${email}')" style="height:30px;font-size:10px;padding:0 12px;flex-shrink:0;">+ Nota</button>
    </div>

    <button class="btn btn-accent" onclick="saveScheda('${email}')" style="width:200px;height:32px;font-size:11px;">Salva scheda</button>
  `;

  renderSchedaNote(data.note||[], email);
}

function renderSchedaNote(note, email) {
  const list = document.getElementById('sc-note-list');
  if(!list) return;
  list.innerHTML = '';
  [...note].reverse().forEach((n,i)=>{
    const realIdx = note.length - 1 - i;
    const div = document.createElement('div');
    div.className = 'note-scheda-item';
    const del = document.createElement('button');
    del.className = 'note-scheda-del';
    del.textContent = '✕';
    del.onclick = ()=>deleteSchedaNota(email, realIdx);
    const date = document.createElement('div');
    date.className = 'note-scheda-date';
    date.textContent = n.data;
    const text = document.createElement('div');
    text.className = 'note-scheda-text';
    text.textContent = n.testo;
    div.appendChild(del);
    div.appendChild(date);
    div.appendChild(text);
    list.appendChild(div);
  });
}

function addSchedaNota(email) {
  const inp = document.getElementById('sc-nota-input');
  const testo = inp.value.trim();
  if(!testo) return;
  const db = getClientiDB();
  if(!db[email]) db[email] = {};
  if(!db[email].note) db[email].note = [];
  const oggi = new Date().toLocaleDateString('it-IT');
  db[email].note.push({ data:oggi, testo });
  setClientiDB(db);
  inp.value = '';
  renderSchedaNote(db[email].note, email);
  updateClientBar();
}

function deleteSchedaNota(email, idx) {
  const db = getClientiDB();
  if(!db[email]?.note) return;
  db[email].note.splice(idx, 1);
  setClientiDB(db);
  renderSchedaNote(db[email].note, email);
  updateClientBar();
}

function saveScheda(email) {
  const db = getClientiDB();
  const existing = db[email] || {};
  db[email] = {
    ...existing,
    nome:        document.getElementById('sc-nome').value.trim(),
    frequenza:   document.getElementById('sc-frequenza').value.trim(),
    obj_breve:   document.getElementById('sc-obj-breve').value.trim(),
    obj_lungo:   document.getElementById('sc-obj-lungo').value.trim(),
    limitazioni: document.getElementById('sc-limitazioni').value.trim(),
    problemi:    document.getElementById('sc-problemi').value.trim(),
    massimali: {
      squat:  parseFloat(document.getElementById('sc-max-squat').value)||null,
      panca:  parseFloat(document.getElementById('sc-max-panca').value)||null,
      stacco: parseFloat(document.getElementById('sc-max-stacco').value)||null,
      mp:     parseFloat(document.getElementById('sc-max-mp').value)||null,
    }
  };
  setClientiDB(db);
  // Sincronizza nome anche nei pagamenti
  const pagDB = getPagamentiDB();
  if(pagDB[email] && db[email].nome) {
    pagDB[email].forEach(p=>p.nome = db[email].nome);
    setPagamentiDB(pagDB);
  }
  updateClientBar();
  // Feedback visivo
  const btn = document.querySelector('#clienti-main .btn-accent');
  if(btn){ btn.textContent='✓ Salvato'; setTimeout(()=>btn.textContent='Salva scheda', 1500); }
}

function toggleNuovoClienteForm() {
  const form = document.getElementById('nuovo-cliente-form');
  const btn  = document.getElementById('btn-nuovo-cliente');
  const open = form.style.display === 'none';
  form.style.display = open ? 'block' : 'none';
  btn.textContent = open ? '✕' : '+';
  if(open) document.getElementById('nc-nome').focus();
}

function confermaNuovoCliente() {
  const nome  = document.getElementById('nc-nome').value.trim();
  const email = document.getElementById('nc-email').value.trim();
  if(!email || !email.includes('@')) {
    document.getElementById('nc-email').style.borderColor = 'var(--accent2)';
    return;
  }
  const db = getClientiDB();
  if(!db[email]) db[email] = { nome, note:[] };
  else if(nome) db[email].nome = nome;
  setClientiDB(db);
  document.getElementById('nc-nome').value = '';
  document.getElementById('nc-email').value = '';
  toggleNuovoClienteForm();
  renderClientiList();
  apriScheda(email, nome);
}

function eliminaCliente(email) {
  if(!confirm('Eliminare la scheda di ' + email + '?\nI dati non potranno essere recuperati.')) return;
  const db = getClientiDB();
  delete db[email];
  setClientiDB(db);
  if(clienteSelezionato === email) {
    clienteSelezionato = null;
    document.getElementById('clienti-main').innerHTML = '<div class="scheda-placeholder">← Seleziona un cliente</div>';
  }
  renderClientiList();
}

function nuovoCliente() {
  const email = prompt('Email del nuovo cliente:');
  if(!email || !email.includes('@')) return;
  const db = getClientiDB();
  if(!db[email]) db[email] = { nome:'', note:[] };
  setClientiDB(db);
  renderClientiList();
  apriScheda(email, '');
}

// ── NAVIGAZIONE ───────────────────────────────────────────────────────────────
function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('open');
  document.getElementById('menu-overlay').classList.toggle('open');
}

function goTo(page) {
  toggleMenu();
  document.querySelectorAll('.side-menu-item').forEach(el=>el.classList.remove('active'));
  event.currentTarget.classList.add('active');
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.getElementById('page-'+page).classList.add('active');
  // Nascondi barra cliente nella pagina clienti
  const bar = document.getElementById('client-bar');
  if(bar) bar.style.display = (page==='clienti'||page==='pagamenti') ? 'none' : '';
  if(page==='clienti') { renderClientiList(); }
  if(page==='pagamenti') { renderPagClientiList(); renderStats('stat-'); }
}

// ── DATI CLIENTE ─────────────────────────────────────────────────────────────
// Dati demo per esempio visivo
const DEMO_CLIENTI = {
  'digiuseppeantonello8@gmail.com': {
    frequenza: '4 giorni/settimana',
    obj_breve: 'Half marathon entro luglio',
    obj_lungo: 'Hybrid athlete — forza + resistenza',
    limitazioni: 'Dolore Achille mattutino · Tendinopatia rotulea',
    problemi: 'Attenzione squat bulgaro · Evitare volume alto corsa in salita',
    massimali: { squat: 235, panca: 160, stacco: 250, mp: 100 },
    note: [
      { data: '10/03/2025', testo: 'Vuole tirare una singola di stacco nel prossimo blocco' },
      { data: '24/02/2025', testo: 'Sente che il lavoro sui quad sta funzionando' },
      { data: '10/02/2025', testo: 'Prossimo programma: più volume aerobico, mantenere forza' }
    ]
  }
};

function getClientiDB() {
  try { return JSON.parse(localStorage.getItem('coaching_clienti')||'{}'); }
  catch(e) { return {}; }
}
function setClientiDB(db) {
  localStorage.setItem('coaching_clienti', JSON.stringify(db));
}
function getClienteData(email) {
  if(!email) return null;
  const db = getClientiDB();
  return db[email] || DEMO_CLIENTI[email] || null;
}

function updateClientBar() {
  const email = document.getElementById('email_cliente').value.trim();
  const nome  = document.getElementById('nome_cliente').value.trim();
  const bar   = document.getElementById('client-bar');
  const pills = document.getElementById('client-pills');
  pills.innerHTML = '';

  if(!email && !nome) { bar.classList.remove('visible'); return; }

  const data = getClienteData(email);
  bar.classList.add('visible');

  if(!data) {
    const p = document.createElement('span');
    p.className = 'client-pill freq';
    p.textContent = 'Nessun dato cliente — clicca + dettagli per aggiungere';
    pills.appendChild(p);
    return;
  }

  if(data.frequenza) addPill(pills, '📅 '+data.frequenza, 'freq');
  if(data.obj_breve) addPill(pills, '🎯 '+data.obj_breve, 'goal');
  if(data.limitazioni) data.limitazioni.split('·').forEach(l=>{ if(l.trim()) addPill(pills, '⚠ '+l.trim(), 'warn'); });
  if(data.note && data.note.length) addPill(pills, '📝 '+data.note[0].testo, 'note');
  if(data.massimali) {
    const m = data.massimali;
    const parts = [];
    if(m.squat) parts.push('SQ '+m.squat);
    if(m.panca) parts.push('BP '+m.panca);
    if(m.stacco) parts.push('DL '+m.stacco);
    if(parts.length) addPill(pills, parts.join(' · ')+' kg', 'freq');
  }
}

function addPill(container, text, type) {
  const p = document.createElement('span');
  p.className = 'client-pill '+type;
  p.textContent = text;
  container.appendChild(p);
}

function openClientModal() {
  const email = document.getElementById('email_cliente').value.trim();
  const nome  = document.getElementById('nome_cliente').value.trim();
  document.getElementById('client-modal-name').textContent = nome || email || 'Cliente';

  const data = getClienteData(email) || {};
  document.getElementById('cm-frequenza').value   = data.frequenza||'';
  document.getElementById('cm-obj-breve').value   = data.obj_breve||'';
  document.getElementById('cm-obj-lungo').value   = data.obj_lungo||'';
  document.getElementById('cm-limitazioni').value = data.limitazioni||'';
  document.getElementById('cm-problemi').value    = data.problemi||'';
  document.getElementById('cm-max-squat').value   = data.massimali?.squat||'';
  document.getElementById('cm-max-panca').value   = data.massimali?.panca||'';
  document.getElementById('cm-max-stacco').value  = data.massimali?.stacco||'';
  document.getElementById('cm-max-mp').value      = data.massimali?.mp||'';

  renderNoteList(data.note||[]);
  document.getElementById('client-modal-overlay').classList.add('open');
}

function closeClientModal() {
  document.getElementById('client-modal-overlay').classList.remove('open');
}
function closeClientModalIfOutside(e) {
  if(e.target===document.getElementById('client-modal-overlay')) closeClientModal();
}

function renderNoteList(note) {
  const list = document.getElementById('cm-note-list');
  list.innerHTML = '';
  [...note].reverse().forEach((n,i)=>{
    const div = document.createElement('div');
    div.className = 'note-item';
    const date = document.createElement('div');
    date.className = 'note-item-date';
    date.textContent = n.data;
    const text = document.createElement('div');
    text.textContent = n.testo;
    div.appendChild(date);
    div.appendChild(text);
    list.appendChild(div);
  });
}

function addClientNota() {
  const inp = document.getElementById('cm-nota-input');
  const testo = inp.value.trim();
  if(!testo) return;
  const email = document.getElementById('email_cliente').value.trim();
  const db = getClientiDB();
  if(!db[email]) db[email] = {};
  if(!db[email].note) db[email].note = [];
  const oggi = new Date().toLocaleDateString('it-IT');
  db[email].note.push({ data:oggi, testo });
  setClientiDB(db);
  inp.value='';
  renderNoteList(db[email].note);
  updateClientBar();
}

function saveClientData() {
  const email = document.getElementById('email_cliente').value.trim();
  if(!email) { alert('Seleziona prima un cliente'); return; }
  const db = getClientiDB();
  const existing = db[email]||{};
  db[email] = {
    ...existing,
    frequenza:   document.getElementById('cm-frequenza').value.trim(),
    obj_breve:   document.getElementById('cm-obj-breve').value.trim(),
    obj_lungo:   document.getElementById('cm-obj-lungo').value.trim(),
    limitazioni: document.getElementById('cm-limitazioni').value.trim(),
    problemi:    document.getElementById('cm-problemi').value.trim(),
    massimali: {
      squat:  parseFloat(document.getElementById('cm-max-squat').value)||null,
      panca:  parseFloat(document.getElementById('cm-max-panca').value)||null,
      stacco: parseFloat(document.getElementById('cm-max-stacco').value)||null,
      mp:     parseFloat(document.getElementById('cm-max-mp').value)||null,
    }
  };
  setClientiDB(db);
  closeClientModal();
  updateClientBar();
}

// ── PROGRAMMI SALVATI ─────────────────────────────────────────────────────────
function getSavedPrograms() {
  try { return JSON.parse(localStorage.getItem('coaching_saved_programs')||'[]'); }
  catch(e) { return []; }
}
function setSavedPrograms(list) {
  localStorage.setItem('coaching_saved_programs', JSON.stringify(list));
}

function salvaPrograma() {
  const nome    = document.getElementById('nome_cliente').value.trim();
  const programma = document.getElementById('nome_programma').value.trim();
  if(!nome || !programma) { alert('Compila nome cliente e nome programma prima di salvare.'); return; }
  if(!buildCSV()) return; // genera csvData
  const list = getSavedPrograms();
  const id = Date.now().toString();
  const label = programma + ' — ' + nome;
  const data  = document.getElementById('data_programma').value;
  list.unshift({ id, label, nome, programma, data, rows: JSON.parse(JSON.stringify(csvData)) });
  setSavedPrograms(list);
  alert('Programma salvato: ' + label);
  toggleFab();
}

function openProgList() {
  renderProgList();
  document.getElementById('prog-list-overlay').classList.add('open');
  toggleFab();
}
function closeProgList() {
  document.getElementById('prog-list-overlay').classList.remove('open');
  document.getElementById('import-csv-status').textContent = '';
  document.getElementById('import-csv-area').value = '';
}

function renderProgList() {
  const list = getSavedPrograms();
  const body = document.getElementById('prog-list-body');
  const searchEl = document.getElementById('prog-search');
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';
  body.innerHTML = '';

  if(!list.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0">Nessun programma salvato.</div>';
    return;
  }

  // Raggruppa per email
  const utenti = {};
  list.forEach(p=>{
    // Estrai email dal primo row se disponibile
    const email = (p.rows && p.rows[0] && p.rows[0]['email']) ? p.rows[0]['email'].trim() : (p.email||'');
    const nome  = p.nome || (p.rows && p.rows[0] ? p.rows[0]['Nome']||'' : '');
    const key   = email || nome;
    if(!utenti[key]) utenti[key] = { email, nome, programmi:[] };
    utenti[key].programmi.push(p);
  });

  // Filtra per ricerca
  const keys = Object.keys(utenti).filter(k=>{
    if(!query) return true;
    const u = utenti[k];
    return u.nome.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
  }).sort((a,b)=>utenti[a].nome.localeCompare(utenti[b].nome));

  if(!keys.length) {
    body.innerHTML = '<div style="color:var(--muted);font-size:11px;padding:8px 0">Nessun risultato.</div>';
    return;
  }

  keys.forEach(key=>{
    const u = utenti[key];
    const card = document.createElement('div');
    card.className = 'utente-card';

    // Header card
    const header = document.createElement('div');
    header.className = 'utente-card-header';
    header.onclick = ()=>{ card.classList.toggle('open'); };

    const infoDiv = document.createElement('div');
    const nameDiv = document.createElement('div');
    nameDiv.className = 'utente-card-name';
    nameDiv.textContent = u.nome || u.email;
    const emailDiv = document.createElement('div');
    emailDiv.className = 'utente-card-email';
    emailDiv.textContent = u.email;
    infoDiv.appendChild(nameDiv);
    if(u.email && u.nome) infoDiv.appendChild(emailDiv);

    const rightDiv = document.createElement('div');
    rightDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
    const countDiv = document.createElement('div');
    countDiv.className = 'utente-card-count';
    countDiv.textContent = u.programmi.length + ' prog.';
    const arrow = document.createElement('div');
    arrow.className = 'utente-card-arrow';
    arrow.textContent = '▶';
    rightDiv.appendChild(countDiv);
    rightDiv.appendChild(arrow);

    header.appendChild(infoDiv);
    header.appendChild(rightDiv);

    // Lista programmi
    const progList = document.createElement('div');
    progList.className = 'utente-prog-list';

    // Ordina per data decrescente
    u.programmi.sort((a,b)=>{
      const parseData = d=>{ if(!d) return 0; const p=d.split('/'); return p.length===3?new Date(p[2],p[1]-1,p[0]).getTime():0; };
      return parseData(b.data)-parseData(a.data);
    });

    u.programmi.forEach(p=>{
      const item = document.createElement('div');
      item.className = 'utente-prog-item';

      const left = document.createElement('div');
      const pName = document.createElement('div');
      pName.className = 'utente-prog-name';
      pName.textContent = p.programma;
      const pDate = document.createElement('div');
      pDate.className = 'utente-prog-date';
      pDate.textContent = p.data||'';
      left.appendChild(pName);
      left.appendChild(pDate);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:6px;flex-shrink:0;';

      const btnC = document.createElement('button');
      btnC.className = 'btn btn-outline';
      btnC.style.cssText = 'height:22px;font-size:9px;padding:0 8px;';
      btnC.textContent = 'Confronta';
      btnC.onclick = (e)=>{ e.stopPropagation(); apriConfronto(p.id); };

      const btnE = document.createElement('button');
      btnE.className = 'btn btn-ghost';
      btnE.style.cssText = 'height:22px;font-size:9px;padding:0 6px;color:var(--accent2);';
      btnE.textContent = '✕';
      btnE.onclick = (e)=>{ e.stopPropagation(); eliminaPrograma(p.id); };

      actions.appendChild(btnC);
      actions.appendChild(btnE);
      item.appendChild(left);
      item.appendChild(actions);
      progList.appendChild(item);
    });

    card.appendChild(header);
    card.appendChild(progList);
    body.appendChild(card);
  });
}

function eliminaPrograma(id) {
  if(!confirm('Eliminare questo programma?')) return;
  const list = getSavedPrograms().filter(p=>p.id!==id);
  setSavedPrograms(list);
  renderProgList();
}

// ── IMPORT CSV ────────────────────────────────────────────────────────────────
function importaCSV() {
  const text = document.getElementById('import-csv-area').value.trim();
  if(!text) { document.getElementById('import-csv-status').textContent='Incolla prima il CSV.'; return; }

  const lines = text.split('\n').filter(l=>l.trim());
  if(lines.length < 2) { document.getElementById('import-csv-status').textContent='CSV non valido.'; return; }

  // Rileva separatore automaticamente: tab (da Excel) o virgola (CSV)
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const parseLine = sep === '\t'
    ? (l => l.split('\t').map(v => v.trim()))
    : parseCSVLine;

  const header = parseLine(lines[0].replace(/^\uFEFF/, ''));
  const allRows = lines.slice(1).map(l=>{ const cols=parseLine(l); const obj={}; header.forEach((h,i)=>{ obj[h]=(cols[i]||'').trim(); }); return obj; });

  // Raggruppa per email + nome programma + data — importa tutto in un colpo
  const gruppi = {};
  allRows.forEach(row=>{
    const key = (row['email']||'') + '|' + (row['Nome programma']||'') + '|' + (row['Data programma']||'');
    if(!gruppi[key]) gruppi[key] = [];
    gruppi[key].push(row);
  });

  const list = getSavedPrograms();
  const keys = Object.keys(gruppi);
  keys.forEach((key, i)=>{
    const rows = gruppi[key];
    const nomeP = rows[0]['Nome programma']||'Programma importato';
    const nomeC = rows[0]['Nome']||'';
    const dataP = rows[0]['Data programma']||'';
    const label = nomeP + (nomeC ? ' — '+nomeC : '');
    // Evita duplicati (stesso label + data)
    const exists = list.find(p=>p.label===label && p.data===dataP);
    if(!exists) {
      list.unshift({ id:(Date.now()+i).toString(), label, nome:nomeC, programma:nomeP, data:dataP, rows });
    }
  });
  setSavedPrograms(list);

  const imported = keys.length;
  document.getElementById('import-csv-status').textContent = '✓ ' + imported + ' programm' + (imported===1?'a':'i') + ' importat' + (imported===1?'o':'i');
  document.getElementById('import-csv-area').value='';
  renderProgList();
}

// ── PANNELLO CONFRONTO ────────────────────────────────────────────────────────
function apriConfronto(id) {
  const prog = getSavedPrograms().find(p=>p.id===id);
  if(!prog) return;
  closeProgList();

  document.getElementById('confronto-title').textContent = prog.programma;
  document.getElementById('confronto-meta').textContent  = prog.nome + (prog.data?' · '+prog.data:'');

  // Raggruppa per giorno → settimana → esercizi
  const giorni_map = {};
  prog.rows.forEach(row=>{
    const g = row['Giorno']||'?';
    const w = row['Settimana']||'?';
    const pos = parseInt(row['Posizione'])||0;
    if(!giorni_map[g]) giorni_map[g] = {};
    if(!giorni_map[g][pos]) giorni_map[g][pos] = { esercizio:row['Esercizio'], blocco:row['Blocco'], note:row['Note']||'', settimane:{} };
    giorni_map[g][pos].settimane[w] = {
      struttura: row['Struttura']||'',
      recupero:  row['Recupero']||'',
      consiglio: row['Consiglio']||''
    };
  });

  const sw_list = [...new Set(prog.rows.map(r=>r['Settimana']))].sort((a,b)=>a-b);

  let html = '';
  Object.keys(giorni_map).sort((a,b)=>a-b).forEach(g=>{
    html += `<div class="confronto-day">
      <div class="confronto-day-title">Giorno ${g}</div>
      <table class="confronto-table">
        <thead><tr>
          <th>Esercizio</th>
          ${sw_list.map(w=>`<th>W${w}</th>`).join('')}
        </tr></thead><tbody>`;
    const posizioni = Object.keys(giorni_map[g]).sort((a,b)=>a-b);
    posizioni.forEach(pos=>{
      const ex = giorni_map[g][pos];
      html += `<tr>
        <td class="ex-name">${ex.esercizio}${ex.note?`<br><span style="color:var(--muted);font-size:8px">${ex.note}</span>`:''}</td>
        ${sw_list.map(w=>{
          const sd = ex.settimane[w]||{};
          return `<td class="struttura">${sd.struttura||'—'}<br><span style="font-size:8px;color:#555">${sd.recupero||''}</span></td>`;
        }).join('')}
      </tr>`;
    });
    html += '</tbody></table></div>';
  });

  document.getElementById('confronto-body').innerHTML = html;
  document.getElementById('confronto-panel').classList.add('open');
}

function closeConfronto() {
  document.getElementById('confronto-panel').classList.remove('open');
}

function toggleFab(){
  const menu = document.getElementById('fab-menu');
  const btn = document.getElementById('fab-btn');
  const open = menu.style.display === 'none';
  menu.style.display = open ? 'flex' : 'none';
  btn.style.transform = open ? 'rotate(45deg)' : '';
}

// ── VOLUME TABLE ─────────────────────────────────────────────────────────────
const VOL_RANGES = {
  forza:        { min:6,  opt_lo:10, opt_hi:15, max:18 },
  ipertrofia:   { min:10, opt_lo:16, opt_hi:22, max:30 },
  powerbuilding:{ min:8,  opt_lo:12, opt_hi:18, max:22 }
};

const GRUPPI_WATCH = ['Gambe','Glutei','Catena posteriore','Catena anteriore',
                      'Petto','Dorso','Spalle','Braccia','Core','Addome'];

function getSeriePerGruppoSettimana() {
  const sw = parseInt(document.getElementById('settimane').value)||4;
  // result[gruppo][w] = serie totali
  const result = {};
  GRUPPI_WATCH.forEach(g=>{ result[g] = Array(sw).fill(0); });

  giorni.forEach(day=>{
    day.esercizi.forEach(ex=>{
      if(!ex.esercizio) return;
      const exData = lists.esercizi.find(e=>e.nome.toLowerCase()===ex.esercizio.toLowerCase());
      const gruppo = exData ? exData.gruppo : '';
      if(!gruppo || !result[gruppo]) return;
      for(let w=0;w<sw;w++){
        const sd = ex.settimane[w]||{};
        const {serie} = countSerieFromStruttura(sd.struttura);
        result[gruppo][w] += serie;
      }
    });
  });
  return result;
}

function cellClass(val, range) {
  if(val === 0) return 'vol-cell-zero';
  if(val < range.min) return 'vol-cell-low';
  if(val > range.max) return 'vol-cell-high';
  return 'vol-cell-ok';
}

function renderVolTable() {
  const sw = parseInt(document.getElementById('settimane').value)||4;
  const obj = currentVolObj || 'powerbuilding';
  const range = VOL_RANGES[obj];
  const data = getSeriePerGruppoSettimana();

  // Header
  let html = '<thead><tr><th class="left">Gruppo</th>';
  for(let w=0;w<sw;w++) html += `<th>W${w+1}</th>`;
  html += '</tr></thead><tbody>';

  // Righe — mostra solo gruppi con almeno 1 serie o in WATCH primari
  const PRIMARY = ['Gambe','Petto','Dorso','Spalle','Braccia'];
  GRUPPI_WATCH.forEach(g=>{
    const totale = data[g].reduce((a,b)=>a+b,0);
    if(totale === 0 && !PRIMARY.includes(g)) return;
    html += `<tr><td class="group-name">${g}</td>`;
    data[g].forEach(val=>{
      const cls = cellClass(val, range);
      html += `<td class="${cls}">${val||'—'}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';

  document.getElementById('vol-table').innerHTML = html;

  // Note range
  const objLabel = {forza:'Forza',ipertrofia:'Ipertrofia',powerbuilding:'Powerbuilding'}[obj];
  document.getElementById('vol-range-note').innerHTML =
    `Range ${objLabel}: min ${range.min} · ottimale ${range.opt_lo}–${range.opt_hi} · max ${range.max} serie/gruppo/settimana<br>
    Fonte: Israetel (RP Strength) per ipertrofia · Sheiko/Tuchscherer per forza`;
}

let currentVolObj = 'powerbuilding';

function setVolObj(btn, obj) {
  currentVolObj = obj;
  document.querySelectorAll('.vol-obj-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderVolTable();
}

// ── SIDE PANEL ───────────────────────────────────────────────────────────────
function getMuscleGroup(nomEx) {
  const ex = lists.esercizi.find(e=>e.nome.toLowerCase()===nomEx.toLowerCase());
  return ex ? ex.gruppo : '';
}

function countSerieFromStruttura(struttura) {
  if (!struttura) return { serie: 0, mav: false };
  const s = struttura.toUpperCase();
  // MAV
  if (s.includes('MAV')) {
    const m = s.match(/\*\s*(\d+)/);
    return { serie: m ? parseInt(m[1]) : 0, mav: true };
  }
  // FOR TIME
  if (s.includes('FOR TIME')) return { serie: 1, mav: false };
  // piramidale "10-8-6-4"
  if (s.includes('-') && !s.includes('*') && !s.includes('·')) {
    const nums = struttura.split('-').filter(x=>/^\d+$/.test(x.trim()));
    if (nums.length > 1) return { serie: nums.length, mav: false };
  }
  // standard: numero dopo * o ·
  const m = struttura.match(/[*·]\s*(\d+)\s*$/);
  if (m) return { serie: parseInt(m[1]), mav: false };
  // progressione interna "8*3, 6*3" → somma serie
  if (struttura.includes(',')) {
    let tot = 0;
    struttura.split(',').forEach(b=>{ const mm=b.match(/[*·]\s*(\d+)/); if(mm) tot+=parseInt(mm[1]); });
    if (tot > 0) return { serie: tot, mav: false };
  }
  return { serie: 0, mav: false };
}

function updateSidePanel() {
  const sw = parseInt(document.getElementById('settimane').value)||4;

  // ── MUSCOLI ──
  const gruppi = {};
  const ORDINE = ['Gambe','Glutei','Catena posteriore','Catena anteriore','Adduttori',
                  'Petto','Dorso','Schiena','Spalle','Braccia','Core','Addome','Rehab','Mobilità lombare','Mobilità torace','Mobilità bacino'];
  giorni.forEach(day=>{
    day.esercizi.forEach(ex=>{
      if(!ex.esercizio) return;
      const g = getMuscleGroup(ex.esercizio);
      if(!g) return;
      gruppi[g] = (gruppi[g]||0) + 1;
    });
  });

  // Gruppi rilevanti per controllo buchi
  const WATCH = ['Gambe','Glutei','Petto','Dorso','Spalle','Braccia','Core'];
  const allGruppi = [...new Set([...WATCH, ...Object.keys(gruppi)])].filter(g=>WATCH.includes(g)||gruppi[g]);
  const maxCount = Math.max(1, ...Object.values(gruppi));

  const muscHtml = allGruppi.map(g=>{
    const n = gruppi[g]||0;
    const zero = n===0;
    const pct = Math.round((n/maxCount)*100);
    return `<div class="muscle-row ${zero?'muscle-zero':''}">
      <span class="muscle-label">${g}</span>
      <div class="muscle-bar-wrap"><div class="muscle-bar" style="width:${pct}%"></div></div>
      <span class="muscle-count">${n}</span>
    </div>`;
  }).join('');
  document.getElementById('panel-muscles').innerHTML = muscHtml || '<span style="color:var(--muted);font-size:11px">Nessun esercizio</span>';

  // ── VOLUME ──
  const volHtml = giorni.map((day, di)=>{
    let totSerie = 0;
    const mavList = [];
    day.esercizi.forEach(ex=>{
      if(!ex.esercizio) return;
      // Usa W1 come riferimento, oppure media settimane
      let maxS = 0, hasMav = false;
      ex.settimane.slice(0,sw).forEach(sd=>{
        const {serie, mav} = countSerieFromStruttura(sd.struttura);
        if(mav) hasMav=true;
        if(serie>maxS) maxS=serie;
      });
      totSerie += maxS;
      if(hasMav) mavList.push(ex.esercizio);
    });
    const mavNote = mavList.length ? `<span class="vol-mav">+MAV</span>` : '';
    return `<div>
      <div class="vol-row">
        <span class="vol-label">G${di+1}</span>
        <span><span class="vol-num">${totSerie}</span><span style="font-size:10px;color:var(--muted)"> serie</span>${mavNote}</span>
      </div>
    </div>`;
  }).join('');
  document.getElementById('panel-volume').innerHTML = volHtml || '<span style="color:var(--muted);font-size:11px">Nessun dato</span>';

  // ── VOLUME SETTIMANALE ──
  const weekVols = [];
  for(let w=0; w<sw; w++){
    let tot = 0;
    const mavNames = [];
    giorni.forEach(day=>{
      day.esercizi.forEach(ex=>{
        if(!ex.esercizio) return;
        const sd = ex.settimane[w]||{};
        const {serie, mav} = countSerieFromStruttura(sd.struttura);
        tot += serie;
        if(mav) mavNames.push(ex.esercizio);
      });
    });
    weekVols.push({w:w+1, tot, mavNames});
  }
  const maxVol = Math.max(1, ...weekVols.map(v=>v.tot));
  const weekHtml = weekVols.map(v=>{
    const pct = Math.round((v.tot/maxVol)*100);
    const mav = v.mavNames.length ? `<span class="vol-mav">+MAV</span>` : '';
    return `<div style="margin-bottom:8px">
      <div class="vol-row">
        <span class="vol-label">W${v.w}</span>
        <span><span class="vol-num">${v.tot}</span><span style="font-size:10px;color:var(--muted)"> serie</span>${mav}</span>
      </div>
      <div class="vol-bar-wrap"><div class="vol-bar" style="width:${pct}%"></div></div>
    </div>`;
  }).join('');
  document.getElementById('panel-volume-week').innerHTML = weekHtml || '<span style="color:var(--muted);font-size:11px">Nessun dato</span>';

  // Aggiorna tabella volume per gruppo
  renderVolTable();
}

function uid(){return Math.random().toString(36).substr(2,9);}
function showError(msg){const el=document.getElementById('error-bar');el.textContent=msg;el.style.display='block';}
function hideError(){document.getElementById('error-bar').style.display='none';}

// Imposta data solo se non c'è un programma salvato
if (!localStorage.getItem('coaching_program')) {
  document.getElementById('data_programma').value=new Date().toISOString().split('T')[0];
}
loadSheet();

// Ripristina programma salvato, oppure avvia con un giorno vuoto
if (localStorage.getItem('coaching_program')) {
  restoreProgram();
} else {
  document.getElementById('data_programma').value=new Date().toISOString().split('T')[0];
  defaultTemplate();
}

// Autosave su modifiche topbar
['nome_cliente','email_cliente'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateClientBar);
  document.getElementById(id).addEventListener('change', updateClientBar);
});
['nome_cliente','email_cliente','nome_programma','data_programma','settimane'].forEach(id=>{
  document.getElementById(id).addEventListener('input', scheduleAutosave);
  document.getElementById(id).addEventListener('change', scheduleAutosave);
});
// Init barra cliente
updateClientBar();

// ── POPUP PROGRESSIONI ────────────────────────────────────────────────────────
let currentPopupExId = null;


function getRecuperoDefault(esercizio, metodologia, blocco) {
  const es  = (esercizio||'').toLowerCase().trim();
  const met = (metodologia||'').toLowerCase().trim();
  // Corsa + lavoro a tempo → vuoto
  if(es.includes('corsa') && met.includes('lavoro a tempo')) return '';
  // Corsa + ripetute → 2.00
  if(es.includes('corsa') && met.includes('ripetute')) return '2.00';
  // For time → vuoto
  if(met.includes('for time')) return '';
  // AMRAP → vuoto
  if(met.includes('amrap')) return '';
  // Blocco A → 2.00
  if((blocco||'').toUpperCase() === 'A') return '2.00';
  // Default
  return '1.45';
}

function openProg(exId, btn) {
  currentPopupExId = exId;
  let ex = null;
  for(const day of giorni){ ex=day.esercizi.find(e=>e.id===exId); if(ex) break; }
  if(!ex) return;

  const sw = parseInt(document.getElementById('settimane').value)||4;
  document.getElementById('popup-title').textContent = ex.esercizio || 'Progressioni';
  document.getElementById('popup-subtitle').textContent = [ex.metodologia, ex.note].filter(Boolean).join(' · ');

  const container = document.getElementById('popup-rows');
  container.innerHTML = '';

  for(let w=0;w<sw;w++){
    // Assicura che la settimana esista
    while(ex.settimane.length<=w) ex.settimane.push({struttura:'',recupero:'',consiglio:'',serie:'',ripetizioni:'',percentuale:'',carico:''});
    const sd = ex.settimane[w];

    const row = document.createElement('div');
    row.className = 'popup-row';
    row.id = 'popup-row-' + w;

    // Label W
    const wLabel = document.createElement('div');
    wLabel.className='popup-week-label'; wLabel.textContent='W'+(w+1);

    // Esercizio (pre-compilato, modificabile, con autocomplete)
    const inpEs = document.createElement('input');
    inpEs.type='text';
    inpEs.value = sd.esercizio !== undefined ? sd.esercizio : (ex.esercizio||'');
    inpEs.placeholder='Esercizio';
    inpEs.setAttribute('autocomplete','off');
    inpEs.oninput = ()=>{
      popupUpdate(w,'esercizio',inpEs.value);
      // autocomplete esercizi
      showPopupAC(inpEs, w, 'esercizio');
    };
    inpEs.onkeydown = (e)=>{ if(e.key==='Enter'){inpEs.blur();e.preventDefault();} };

    // Note
    const inpNote = document.createElement('input');
    inpNote.type='text';
    inpNote.value = sd.note !== undefined ? sd.note : (ex.note||'');
    inpNote.placeholder='Note';
    inpNote.oninput = ()=>popupUpdate(w,'note',inpNote.value);

    // Metodologia
    const inpMet = document.createElement('input');
    inpMet.type='text';
    inpMet.value = sd.metodologia !== undefined ? sd.metodologia : (ex.metodologia||'');
    inpMet.placeholder='Metodologia';
    inpMet.setAttribute('autocomplete','off');
    inpMet.oninput = ()=>{
      popupUpdate(w,'metodologia',inpMet.value);
      showPopupAC(inpMet, w, 'metodologia');
    };

    // Struttura
    const inpStr = document.createElement('input');
    inpStr.type='text'; inpStr.value=sd.struttura||''; inpStr.placeholder='es. 70% 5·4';
    inpStr.oninput = ()=>popupUpdate(w,'struttura',inpStr.value);
    inpStr.onkeydown = (e)=>{
      if(e.key==='Enter'){
        // propaga alle settimane vuote sotto
        propagaStruttura(w, inpStr.value);
        e.preventDefault();
      }
    };
    inpStr.onblur = ()=>propagaStruttura(w, inpStr.value);

    // Recupero — default intelligente
    const _esNome = ex.esercizio||'';
    const _met    = sd.metodologia !== undefined && sd.metodologia !== '' ? sd.metodologia : (ex.metodologia||'');
    // Cerca blocco: prima da ex, poi dal foglio
    let _blocco = ex.blocco||'';
    if(!_blocco && _esNome) {
      const exSheet = lists.esercizi.find(e=>e.nome.toLowerCase()===_esNome.toLowerCase());
      if(exSheet) _blocco = exSheet.blocco||'';
    }
    const recDefault = getRecuperoDefault(_esNome, _met, _blocco);
    const inpRec = document.createElement('input');
    inpRec.type='text';
    // Usa valore salvato solo se esplicitamente impostato dall'utente
    inpRec.value = (sd.recupero !== undefined && sd.recupero !== null && sd.recupero !== '') ? sd.recupero : recDefault;
    inpRec.placeholder = recDefault !== '' ? recDefault : 'es. 1.45';
    inpRec.oninput = ()=>popupUpdate(w,'recupero',inpRec.value);

    // Consiglio
    const inpCons = document.createElement('input');
    inpCons.type='text'; inpCons.value=sd.consiglio||''; inpCons.placeholder='RPE8';
    inpCons.oninput = ()=>popupUpdate(w,'consiglio',inpCons.value);

    row.appendChild(wLabel);
    row.appendChild(inpEs);
    row.appendChild(inpNote);
    row.appendChild(inpMet);
    row.appendChild(inpStr);

    // Wrapper recupero + pulsante propaga (solo W1)
    if(w === 0) {
      const wrapRec = document.createElement('div');
      wrapRec.className = 'popup-field-wrap';
      const btnPropagaRec = document.createElement('button');
      btnPropagaRec.type='button';
      btnPropagaRec.className='btn-propaga';
      btnPropagaRec.title='Copia in tutte le settimane';
      btnPropagaRec.textContent='↓';
      btnPropagaRec.onclick = ()=>{
        const val = inpRec.value;
        const allRec = container.querySelectorAll('.popup-row input.input-rec');
        allRec.forEach((inp, i)=>{ if(i>0){ inp.value=val; popupUpdate(i,'recupero',val); } });
      };
      wrapRec.appendChild(inpRec);
      inpRec.classList.add('input-rec');
      wrapRec.appendChild(btnPropagaRec);
      row.appendChild(wrapRec);
    } else {
      inpRec.classList.add('input-rec');
      row.appendChild(inpRec);
    }

    // Wrapper consiglio + pulsante propaga (solo W1)
    if(w === 0) {
      const wrapCons = document.createElement('div');
      wrapCons.className = 'popup-field-wrap';
      const btnPropagaCons = document.createElement('button');
      btnPropagaCons.type='button';
      btnPropagaCons.className='btn-propaga';
      btnPropagaCons.title='Copia in tutte le settimane';
      btnPropagaCons.textContent='↓';
      btnPropagaCons.onclick = ()=>{
        const val = inpCons.value;
        const allCons = container.querySelectorAll('.popup-row input.input-cons');
        allCons.forEach((inp, i)=>{ if(i>0){ inp.value=val; popupUpdate(i,'consiglio',val); } });
      };
      wrapCons.appendChild(inpCons);
      inpCons.classList.add('input-cons');
      wrapCons.appendChild(btnPropagaCons);
      row.appendChild(wrapCons);
    } else {
      inpCons.classList.add('input-cons');
      row.appendChild(inpCons);
    }

    container.appendChild(row);
  }

  document.getElementById('prog-popup').classList.add('open');
  document.getElementById('popup-overlay').classList.add('open');

  document.querySelectorAll('.ex-row.prog-active').forEach(r=>r.classList.remove('prog-active'));
  const activeRow = document.getElementById('ex-'+exId);
  if(activeRow) activeRow.classList.add('prog-active');

  const first = container.querySelector('input');
  if(first) setTimeout(()=>first.focus(),50);
}

function propagaStruttura(wIdx, value) {
  if(!currentPopupExId || !value) return;
  const parsed = parseStruttura(value);
  let ex = null;
  for(const day of giorni){ ex=day.esercizi.find(e=>e.id===currentPopupExId); if(ex) break; }
  if(!ex) return;

  // Calcola recupero smart per questo esercizio
  const _metW = ex.settimane[wIdx].metodologia || ex.metodologia || '';
  let _bloccoW = ex.blocco||'';
  if(!_bloccoW && ex.esercizio) {
    const exS = lists.esercizi.find(e=>e.nome.toLowerCase()===(ex.esercizio||'').toLowerCase());
    if(exS) _bloccoW = exS.blocco||'';
  }
  const recSmart = getRecuperoDefault(ex.esercizio||'', _metW, _bloccoW);

  // Salva la settimana corrente — non sovrascrivere campi già compilati
  ex.settimane[wIdx].struttura = value;
  // Recupero: usa smart se non già impostato manualmente
  if(!ex.settimane[wIdx].recupero) {
    ex.settimane[wIdx].recupero = recSmart !== '' ? recSmart : (parsed.recupero||'');
  }
  if(!ex.settimane[wIdx].consiglio && parsed.consiglio) ex.settimane[wIdx].consiglio = parsed.consiglio;
  // campi derivati sempre aggiornati
  ex.settimane[wIdx].serie = parsed.serie;
  ex.settimane[wIdx].ripetizioni = parsed.ripetizioni;
  ex.settimane[wIdx].percentuale = parsed.percentuale;
  ex.settimane[wIdx].carico = parsed.carico;

  // Propaga alle settimane sotto se vuote
  const sw = ex.settimane.length;
  for(let w=wIdx+1;w<sw;w++){
    if(!ex.settimane[w].struttura){
      ex.settimane[w].struttura = value;
      if(!ex.settimane[w].recupero) ex.settimane[w].recupero = recSmart !== '' ? recSmart : (parsed.recupero||DEFAULT_RECUPERO);
      if(!ex.settimane[w].consiglio && parsed.consiglio) ex.settimane[w].consiglio = parsed.consiglio;
    }
  }

  // Aggiorna tutti gli input nel popup
  refreshPopupInputs(ex);
}

function refreshPopupInputs(ex) {
  const rows = document.querySelectorAll('#popup-rows .popup-row');
  rows.forEach((row, w)=>{
    const inputs = row.querySelectorAll('input');
    if(!inputs.length || !ex.settimane[w]) return;
    const sd = ex.settimane[w];
    // inputs: esercizio, note, metod, struttura, recupero, consiglio
    if(inputs[0]) inputs[0].value = sd.esercizio !== undefined ? sd.esercizio : (ex.esercizio||'');
    if(inputs[1]) inputs[1].value = sd.note !== undefined ? sd.note : (ex.note||'');
    if(inputs[2]) inputs[2].value = sd.metodologia !== undefined ? sd.metodologia : (ex.metodologia||'');
    if(inputs[3]) inputs[3].value = sd.struttura||'';
    if(inputs[4]) inputs[4].value = sd.recupero||'';
    if(inputs[5]) inputs[5].value = sd.consiglio||'';
  });
}

// Autocomplete semplice negli input del popup
function showPopupAC(input, wIdx, field) {
  // rimuovi dropdown esistenti nel popup
  document.querySelectorAll('.popup-ac-drop').forEach(d=>d.remove());
  const val = input.value.trim().toLowerCase();
  if(!val || val.length < 1) return;

  let items = [];
  if(field==='esercizio') items = lists.esercizi.map(e=>e.nome);
  if(field==='metodologia') items = lists.metodologie;
  const filtered = items.filter(i=>i.toLowerCase().includes(val)).slice(0,6);
  if(!filtered.length) return;

  const drop = document.createElement('div');
  drop.className='ac-list popup-ac-drop';
  drop.style.cssText='display:block;position:absolute;z-index:9999;min-width:180px;';
  filtered.forEach(item=>{
    const div=document.createElement('div');
    div.className='ac-item';
    div.textContent=item;
    div.onmousedown=(e)=>{
      e.preventDefault();
      input.value=item;
      popupUpdate(wIdx,field,item);
      drop.remove();
    };
    drop.appendChild(div);
  });
  input.parentElement.style.position='relative';
  input.parentElement.appendChild(drop);
  input.onblur=()=>setTimeout(()=>drop.remove(),200);
}

function popupUpdate(wIdx, field, value) {
  if(!currentPopupExId) return;
  updateWeek(currentPopupExId, wIdx, field, value);
}

// popupOnStrutturaChange → sostituita da propagaStruttura

function closeProg() {
  document.getElementById('prog-popup').classList.remove('open');
  document.getElementById('popup-overlay').classList.remove('open');
  document.querySelectorAll('.ex-row.prog-active').forEach(r=>r.classList.remove('prog-active'));
  currentPopupExId = null;
}
function closeProgIfOutside(e) {
  if(e.target === document.getElementById('popup-overlay')) closeProg();
}


// ── MINI TABLE + TOOLTIP ──────────────────────────────────────────────────────
function getMiniTable(ex, sw) {
  let html = '<div class="mini-prog">';
  for(let w=0;w<sw;w++){
    const sd = ex.settimane[w]||{};
    const val = sd.struttura ? sd.struttura.replace(/\*/g,'·') : '';
    html += `<div class="mini-week">
      <div class="mini-w-label">W${w+1}</div>
      <div class="mini-w-val${val?'':' empty'}">${val||'—'}</div>
    </div>`;
  }
  html += '</div>';
  return html;
}

function updateMiniTable(exId) {
  const el = document.getElementById('mini-'+exId);
  if(!el) return;
  let ex=null;
  for(const day of giorni){ex=day.esercizi.find(e=>e.id===exId);if(ex)break;}
  if(!ex) return;
  const sw = parseInt(document.getElementById('settimane').value)||4;
  el.innerHTML = getMiniTable(ex, sw);
}

let ttTimeout = null;
function showTooltip(exId, anchorEl) {
  let ex=null;
  for(const day of giorni){ex=day.esercizi.find(e=>e.id===exId);if(ex)break;}
  if(!ex) return;
  const sw = parseInt(document.getElementById('settimane').value)||4;
  const tt = document.getElementById('prog-tooltip');

  let html = `<div class="tt-title">${ex.esercizio||'—'}</div>`;
  html += `<div class="tt-sub">${[ex.metodologia,ex.note].filter(Boolean).join(' · ')||'nessuna nota'}</div>`;
  html += `<div class="tt-heads"><div class="tt-col-h"></div><div class="tt-col-h">Struttura</div><div class="tt-col-h">Rec.</div><div class="tt-col-h">Consiglio</div></div>`;
  for(let w=0;w<sw;w++){
    const sd=ex.settimane[w]||{};
    const s=sd.struttura?sd.struttura.replace(/\*/g,'·'):'';
    html += `<div class="tt-row">
      <div class="tt-wlabel">W${w+1}</div>
      <div class="tt-val${s?'':' empty'}">${s||'—'}</div>
      <div class="tt-val${sd.recupero?'':' empty'}">${sd.recupero||'—'}</div>
      <div class="tt-val${sd.consiglio?'':' empty'}">${sd.consiglio||'—'}</div>
    </div>`;
  }
  tt.innerHTML = html;

  // Position to the right of the row
  const rect = anchorEl.getBoundingClientRect();
  const ttW = 320;
  let left = rect.right + 12;
  if(left + ttW > window.innerWidth - 10) left = rect.left - ttW - 12;
  let top = rect.top - 10;
  if(top + 200 > window.innerHeight - 10) top = window.innerHeight - 220;
  tt.style.left = left + 'px';
  tt.style.top = top + 'px';
  tt.classList.add('visible');
}

function hideTooltip() {
  document.getElementById('prog-tooltip').classList.remove('visible');
}

// ── VIDEO LOOKUP TABLE ────────────────────────────────────────────────────────
const VIDEO_LINKS = {
  "Stacco regular":"https://drive.google.com/file/d/1k7XlNUfDMCKt8vb4Pw02W_iLKhbnIvy7/view?usp=sharing",
  "Pull up":"https://drive.google.com/file/d/1XQ0MZBBRI5d1KBufNH3Pqnuo79BcfGqi/view?usp=sharing",
  "Dip":"https://drive.google.com/file/d/1Z1ZmSLVaYS-8wdhYc6EhpdISinh8nfL8/view?usp=sharing",
  "Stacco Sumo":"https://drive.google.com/file/d/1im15J5r5xWVRdlieqxg7qhks_ii4Z8MB/view?usp=drive_link",
  "Squat bulgaro bilanciere":"https://drive.google.com/file/d/1AqwyOPzzXaMP4TxLqyp7nqYgUJr6aV1f/view?usp=sharing",
  "Squat HB":"https://drive.google.com/file/d/1fc46IJ9X6jMQvur0SqLDWWkt-kDQCgwZ/view?usp=sharing",
  "Panca piana":"https://drive.google.com/file/d/1WGf9sBMNpIuJd3loD8BNpSiytb6M8mT5/view?usp=sharing",
  "Squat LB":"https://drive.google.com/file/d/1xVkHw5eXNrJtB-xs_whvS5Zzx32a2qPl/view?usp=sharing",
  "Panca piana presa stretta":"https://drive.google.com/file/d/1Zr3DxQkljo8v53MPbOjw7rOpMVMkfAvK/view?usp=sharing",
  "Panca piana larsen":"https://drive.google.com/file/d/1m_NGHq9UJOizKBn4tlo7UtLtFDvXZzOc/view?usp=sharing",
  "Pendulum squat":"https://drive.google.com/file/d/13m55I6FWI7X_JRV7awq5dPRSPf_2QMPF/view?usp=sharing",
  "Overhead extension al cavo":"https://drive.google.com/file/d/1qzAU8e2e0e5izi7ufpmWxG66ETHR_Y2r/view?usp=drive_link",
  "Reverse pec deck":"https://drive.google.com/file/d/1Ho2CCQwHZkUBBGCzEFe4vYrYuQIQj0_l/view?usp=sharing",
  "Military press":"https://drive.google.com/file/d/1HZ62h2ebWQ4fFNVncDS7rPFos04wL/view?usp=sharing",
  "Squat bulgaro manubri":"https://drive.google.com/file/d/1pvcX2KT3VzM3q7Egb7vFlZ5n31E966i1/view?usp=sharing",
  "High row machine":"https://drive.google.com/file/d/12zfJSxnZzIyJ5tSqb9pUQ_e4VW4iNsEc/view?usp=sharing",
  "Rowing machine inclinata":"https://drive.google.com/file/d/1b5pb1LTPTjihWqE6kF360uYflgQkHRCN/view?usp=sharing",
  "Dip machine":"https://drive.google.com/file/d/1I-zGKl6UBEw1cOwLyyYVfZKxv7l0f4gS/view?usp=sharing",
  "Alzate laterali al cavo":"https://drive.google.com/file/d/1PYBfz55kXn82HmINVx90ZaRiv0cPf-3Y/view?usp=sharing",
  "Alzate laterali":"https://drive.google.com/file/d/1L8XxeTRCGBFg96OJHAYn39-JM7nbRa2z/view?usp=sharing",
  "Alzate laterali seduto":"https://drive.google.com/file/d/1L8XxeTRCGBFg96OJHAYn39-JM7nbRa2z/view?usp=sharing&t=134",
  "Lento avanti MP":"https://drive.google.com/file/d/1XxPB9KZxfKmge3-m0Ezzs1N2e1Hyx3EE/view?usp=sharing",
  "Chin up":"https://drive.google.com/file/d/1j1Y8mKMv7Y-xDRuLiYnwQfLdSV74LExK/view?usp=sharing",
  "Croci con manubri su panca":"https://drive.google.com/file/d/1dC4N06Z9V9g0riCHGTJDoGwScVf5feIt/view?usp=sharing",
  "Croci con manubri su panca inclinata":"https://drive.google.com/file/d/1dC4N06Z9V9g0riCHGTJDoGwScVf5feIt/view?usp=sharing",
  "Strict curl":"https://drive.google.com/file/d/1QMXPPUSlqtCy0JAdBHqFZDa-Rv_QCj8q/view?usp=sharing",
  "Preacher curl":"https://drive.google.com/file/d/1TtiIRT1b_tLk9eml94VY1W-Bz8DDWgSx/view?usp=sharing",
  "Pendlay row":"https://drive.google.com/file/d/1rbiThBReGbbvjLbRNLz2TslT8LFOgnQB/view?usp=sharing",
  "Arnold Press":"https://drive.google.com/file/d/1UyE4xIDoMtyuRRN880OEX7huDdLA2wyc/view?usp=sharing",
  "Australian pull up":"https://drive.google.com/file/d/1sPLCXpJrhsfCNrjBCAT_i0evyBJMtyEY/view?usp=sharing",
  "Chest press":"https://drive.google.com/file/d/1Yyz0W92pamb22secJpHLU01YKU2b_9wp/view?usp=sharing",
  "Croci ai cavi":"https://drive.google.com/file/d/1YqGLt1Ra59So76aXTxiowzmpHPRxnX_z/view?usp=sharing",
  "Croci ai cavi dal basso":"https://drive.google.com/file/d/1YqGLt1Ra59So76aXTxiowzmpHPRxnX_z/view?usp=sharing",
  "Croci ai cavi altezza spalla":"https://drive.google.com/file/d/1YqGLt1Ra59So76aXTxiowzmpHPRxnX_z/view?usp=sharing",
  "Croci ai cavi su panca piana":"https://drive.google.com/file/d/1Yu3U-pTEtquTPF8iWQcyuBdUUgLMLnMU/view?usp=sharing",
  "Croci ai cavi su panca inclinata":"https://drive.google.com/file/d/1Yu3U-pTEtquTPF8iWQcyuBdUUgLMLnMU/view?usp=sharing",
  "Curl manubri":"https://drive.google.com/file/d/1W_4TBGtQZiCFkw_M6GEsVLolzjXAlFZz/view?usp=sharing",
  "Dorsy bar":"https://drive.google.com/file/d/1pIq9-C_YkxJeQUEQQVHUC4xhwMajM2rG/view?usp=sharing",
  "Kick back al cavo":"https://drive.google.com/file/d/1Jfb3cHhorvjvG0YUvJwZKpbXRD-vJGxW/view?usp=sharing",
  "Kick back":"https://drive.google.com/file/d/1Jfb3cHhorvjvG0YUvJwZKpbXRD-vJGxW/view?usp=sharing",
  "Lat machine presa supina":"https://drive.google.com/file/d/1uUXNw8_zBd01udFdCmzS_GMfxjTBrv3g/view?usp=sharing",
  "Lat machine presa V":"https://drive.google.com/file/d/1uUXNw8_zBd01udFdCmzS_GMfxjTBrv3g/view?usp=sharing",
  "Lat machine trazy bar":"https://drive.google.com/file/d/1uUXNw8_zBd01udFdCmzS_GMfxjTBrv3g/view?usp=sharing",
  "Panca inclinata con bilanciere":"https://drive.google.com/file/d/1HhxgyJih9aASM1r283Drns0M_UsSj1_p/view?usp=sharing",
  "Panca paralimpica":"https://drive.google.com/file/d/1ZtLoWdvgXFuKW7u5-6GsZLLOFzlvwn_Ei/view?usp=sharing",
  "Pectoral machine":"https://drive.google.com/file/d/1Z-oij0yxfiyQNunTiMgBDwyqJEVG0MFU/view?usp=sharing",
  "Pull down al cavo":"https://drive.google.com/file/d/1rzMUT8vMucEP7vZ9aNqIDYouuuY7F8pP/view?usp=sharing",
  "Pull over con manubrio":"https://drive.google.com/file/d/1s-Q1gIk0p6kXbvmWtvsFRGsBlwLBFsgp/view?usp=sharing",
  "Pulley presa V":"https://drive.google.com/file/d/1pJf8yLjc6DWnyJNhdk_xME2w0mVKMQor/view?usp=sharing",
  "Pulley monolaterale":"https://drive.google.com/file/d/1pJf8yLjc6DWnyJNhdk_xME2w0mVKMQor/view?usp=sharing",
  "Pulley trazy bar":"https://drive.google.com/file/d/1pJf8yLjc6DWnyJNhdk_xME2w0mVKMQor/view?usp=sharing",
  "Push down":"https://drive.google.com/file/d/1IUIL4VunijaGQ9JlS0d2XC_PZYytVXv0/view?usp=sharing",
  "Push down schiena al pacco pesi":"https://drive.google.com/file/d/1IUIL4VunijaGQ9JlS0d2XC_PZYytVXv0/view?usp=sharing&t=50",
  "Push up":"https://drive.google.com/file/d/1ZluoVmgS6lgtXWcMaGV9wixKEtm50hxY/view?usp=sharing",
  "Rematore con bilanciere":"https://drive.google.com/file/d/1WbU-30EY-eigrTNqJuXsp1hjYgUa2tMc/view?usp=sharing",
  "Rowing machine":"https://drive.google.com/file/d/1pKTA-LGN32J2TIKlKfySn8vUArpktVYS/view?usp=sharing",
  "Skull crusher":"https://drive.google.com/file/d/1Jh0NwG8lEMDIiwVlnJ7u3B8XNh7V4ABh/view?usp=sharing",
  "Rematore cavo basso":"https://drive.google.com/file/d/1ryiKNbP43Hu7F2kDZ3u0QKgw9BaEnQ_N/view?usp=sharing",
  "Spinte manubri su panca piana":"https://drive.google.com/file/d/1UwaQPyH3QIFLxxcwsdtaAlLeJe6P_klx/view?usp=sharing",
  "Leg extension":"https://drive.google.com/file/d/1oyULGyTVVQmDoq9acxnQr8atUI9sX-C7/view?usp=sharing",
  "Leg press":"https://drive.google.com/file/d/1oyULGyTVVQmDoq9acxnQr8atUI9sX-C7/view?usp=sharing",
  "Leg curl":"https://drive.google.com/file/d/1WMeAEgfkD-JQz74cY9iO_cPq3NnubILi/view?usp=sharing",
  "Leg curl seduto":"https://drive.google.com/file/d/1WMeAEgfkD-JQz74cY9iO_cPq3NnubILi/view?usp=sharing",
  "Calf raise":"https://drive.google.com/file/d/1oyULGyTVVQmDoq9acxnQr8atUI9sX-C7/view?usp=sharing",
  "Glute bridge":"https://youtube.com/shorts/G2L9xQXLRgI?feature=share",
  "Glute bridge 1 leg":"https://youtube.com/shorts/aH6G8alY-Uc?feature=share",
  "Heel bridge":"https://youtube.com/shorts/bGxUxoxaGnE?feature=share",
  "Plank":"https://youtube.com/shorts/FRuOvqn7uoE?feature=share",
  "Plank +":"https://youtube.com/shorts/vBrR-ZZqZqo?feature=share",
  "Plank shoulder tap":"https://youtube.com/shorts/0ai0aMk_Q-Q?feature=share",
  "Push ups":"https://youtube.com/shorts/VETzQ9hRvhY?feature=share",
  "Cat-Cow":"https://youtube.com/shorts/6aVDN2Gi5sk?feature=share",
  "Cobra":"https://youtube.com/shorts/MrytE2GlcBw?feature=share",
  "Tilt pelvico":"https://youtube.com/shorts/iMYrrBwVvmw?feature=share",
  "Child pose":"https://youtube.com/shorts/fabDnaLZRBc?feature=share",
  "Wall sit":"https://www.youtube.com/shorts/xv_12e2JaEs?feature=share",
  "Affondo sul posto":"https://youtube.com/shorts/5ZyWPcKg15A?feature=share",
  "Stretching gambe posteriori seduto 1":"https://youtube.com/shorts/0plN_yvansU?feature=share",
  "Stretching gambe posteriori in ginocchio 1":"https://youtube.com/shorts/DNfz6UZag-g?feature=share",
  "Stretching gambe anteriori in ginocchio 1":"https://youtube.com/shorts/qKbLkM4l4Gk?feature=share",
  "Stretching gambe anteriori in piedi 1":"https://youtube.com/shorts/AxPzNE0INLg?feature=share",
  "Respirazione diaframmatica":"https://youtube.com/shorts/i7M0J0QGVxg?feature=share",
  "Side stretch seduto 90/90":"https://youtube.com/shorts/TKGtFLpItU0?feature=share",
  "Advanced plank":"https://youtube.com/shorts/25klpecccII?feature=share",
  "Aperture laterali elastico":"https://youtube.com/shorts/PWaERRJSaWc?feature=share",
  "Pull down elastico":"https://youtube.com/shorts/9xeYNtzK53c?feature=share",
  "Alzate frontali elastico":"https://youtube.com/shorts/07mg4LvFOHs?feature=share",
  "Croci elastico":"https://youtube.com/shorts/q4dGF4hKoYs?feature=share",
  "Croci elastico dal basso":"https://youtube.com/shorts/MRr2rX9JpxQ?feature=share",
  "Alzate laterali bastone":"https://youtube.com/shorts/dED3R7z3OvM?feature=share",
  "Alzate frontali bastone":"https://youtube.com/shorts/i2CtLlQY9Ww?feature=share",
  "Alzate laterali elastico":"https://youtube.com/shorts/Y0lXJh-oays?feature=share",
  "Mobilità spalla con bastone in piedi":"https://youtube.com/shorts/fcPTsWw1gxI?feature=share",
  "Mobilità spalla con bastone steso":"https://youtube.com/shorts/jqgu6zdp7t0?feature=share",
  "Rematore bilanciere presa supina":"https://drive.google.com/file/d/1WbU-30EY-eigrTNqJuXsp1hjYgUa2tMc/view?usp=sharing&t=41",
  "Leg press focus quadricipiti":"https://drive.google.com/file/d/1oyULGyTVVQmDoq9acxnQr8atUI9sX-C7/view?usp=sharing&t=57",
  "Leg press orizzontale":"https://drive.google.com/file/d/1oyULGyTVVQmDoq9acxnQr8atUI9sX-C7/view?usp=sharing",
  "Lateral raise machine":"https://youtube.com/shorts/1pGaTwiHGp8?feature=share",
  "Hammer curl":"https://drive.google.com/file/d/1W_4TBGtQZiCFkw_M6GEsVLolzjXAlFZz/view?usp=sharing&t=31",
  "Push up fermo a terra mani staccate":"https://drive.google.com/file/d/1_8QkuEy9vVSbaObs1qk4hvrCqYgh8S02/view?usp=sharing",
  "Pull up solo eccentrica":"https://drive.google.com/file/d/1Z3iGCahrAK2vbUeQ_x1PK--bfbgsMMnP/view?usp=sharing",
  "Hyperextension":"https://drive.google.com/file/d/1ci2en5kQ1VoWNToXl1cIJRW_kSYj44GD/view?usp=sharing",
  "Chin up easy power":"https://drive.google.com/file/d/18o6JMuTMUqMEVaiRiujk06F2zfvAp1Cf/view?usp=sharing",
  "Chin up chest to bar":"https://drive.google.com/file/d/1j1Y8mKMv7Y-xDRuLiYnwQfLdSV74LExK/view?usp=sharing&t=138",
  "Push up declinati":"https://drive.google.com/file/d/1zp6mdO9WLh-s_cHw9MuDRX6fiv1M4X5q/view?usp=sharing",
  "Panca larsen presa stretta":"https://drive.google.com/file/d/1m_NGHq9UJOizKBn4tlo7UtLtFDvXZzOc/view?usp=sharing",
  "Panca piana larsen presa stretta":"https://drive.google.com/file/d/1m_NGHq9UJOizKBn4tlo7UtLtFDvXZzOc/view?usp=sharing",
  "High row al cavo":"https://drive.google.com/file/d/1R_kM4L6JfX2RNSlRrSVWcl9-2FG62KFR/view?usp=sharing",
  "Rematore con manubrio su panca a 30°":"https://drive.google.com/file/d/1jrP_jaNq5Yx93UFYxO0U3MfMPlnQNy2P/view?usp=drive_link",
  "Pull up easy power":"https://drive.google.com/file/d/1Sk0BMwBcHEtFZJDZEkaKcEg1KjcZzc59/view?usp=drive_link",
  "Trazioni presa neutra easy power":"https://drive.google.com/file/d/18o6JMuTMUqMEVaiRiujk06F2zfvAp1Cf/view?usp=drive_link",
  "Dip easy power":"https://drive.google.com/file/d/1TihMe7kLZqWN7u5-6GsZLLOFzlvwn_Ei/view?usp=sharing",
  "Curl su panca a 45°":"https://drive.google.com/file/d/1qi7ywdeVtFk3yVzC0RIo1AP-TtSoasu_/view?usp=drive_link",
  "Curl hammer su panca a 45°":"https://drive.google.com/file/d/1qi7ywdeVtFk3yVzC0RIo1AP-TtSoasu_/view?usp=drive_link",
  "Overhead extension con manubrio":"https://drive.google.com/file/d/1E5bLfKLL77qrFViEpl-_XVwtba8-kHkA/view?usp=drive_link"
};

function getVideoLink(nomeEsercizio) {
  if(!nomeEsercizio) return null;
  const key = nomeEsercizio.trim();
  // Exact match first
  if(VIDEO_LINKS[key]) return VIDEO_LINKS[key];
  // Case-insensitive fallback
  const lower = key.toLowerCase();
  const found = Object.keys(VIDEO_LINKS).find(k => k.toLowerCase() === lower);
  return found ? VIDEO_LINKS[found] : null;
}

// ── EXPORT HTML ───────────────────────────────────────────────────────────────
const EXPORT_PAGE_SCRIPT = [
  '<scr','ipt>',
  'function showWeek(idx){',
  'document.querySelectorAll(".week-panel").forEach(function(p,i){p.classList.toggle("active",i===idx);});',
  'document.querySelectorAll(".week-tab").forEach(function(t,i){t.classList.toggle("active",i===idx);});',
  'window.scrollTo({top:0,behavior:"smooth"});',
  '}',
  '<\/scr','ipt>'
].join('');
function exportHTML() {
  const nome     = document.getElementById('nome_cliente').value.trim();
  const email    = document.getElementById('email_cliente').value.trim();
  const nomeProg = document.getElementById('nome_programma').value.trim();
  const dataProg = document.getElementById('data_programma').value;
  const sw       = parseInt(document.getElementById('settimane').value) || 4;

  if(!nome || !nomeProg) {
    alert('Compila Nome cliente e Nome programma prima di esportare.');
    return;
  }

  const dataF = dataProg ? dataProg.split('-').reverse().join('/') : '';

  // Raccoglie tutti gli esercizi validi per giorno
  const giorniValidi = giorni.map(day => ({
    nome: day.nome,
    esercizi: day.esercizi.filter(ex => ex.esercizio)
  })).filter(day => day.esercizi.length > 0);

  if(!giorniValidi.length) {
    alert('Nessun esercizio nel programma.');
    return;
  }

  // Costruisce le settimane disponibili (solo quelle con almeno una struttura)
  const settimaneAttive = [];
  for(let w = 0; w < sw; w++) {
    const hasDati = giorniValidi.some(day =>
      day.esercizi.some(ex => (ex.settimane[w]||{}).struttura)
    );
    if(hasDati) settimaneAttive.push(w);
  }
  // Se nessuna settimana ha struttura, mostra tutte
  const settimane = settimaneAttive.length > 0 ? settimaneAttive : Array.from({length:sw},(_,i)=>i);

  // ── HTML OUTPUT ──
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escH(nomeProg)} — ${escH(nome)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500&display=swap');
  :root {
    --bg:#0d0d0d; --surface:#141414; --surface2:#1c1c1c;
    --border:#2a2a2a; --accent:#c8f135; --accent2:#ff4d4d;
    --text:#e8e8e8; --muted:#666; --radius:4px;
  }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg); color: var(--text);
    font-family: 'DM Sans', sans-serif; font-weight: 300;
    min-height: 100vh; padding: 0 0 60px;
  }

  /* HEADER */
  .header {
    background: var(--surface); border-bottom: 1px solid var(--border);
    padding: 20px 24px 16px; position: sticky; top: 0; z-index: 100;
  }
  .header-logo {
    font-family: 'Bebas Neue', sans-serif; font-size: 13px;
    letter-spacing: 0.1em; color: var(--muted); margin-bottom: 6px;
  }
  .header-logo span { color: var(--text); opacity: 0.3; }
  .header-prog {
    font-family: 'Bebas Neue', sans-serif; font-size: 28px;
    letter-spacing: 0.05em; color: var(--accent); line-height: 1;
  }
  .header-meta {
    font-family: 'DM Mono', monospace; font-size: 10px;
    color: var(--muted); margin-top: 4px; letter-spacing: 0.05em;
  }

  /* WEEK TABS */
  .week-tabs {
    display: flex; gap: 6px; padding: 12px 24px;
    background: var(--surface); border-bottom: 1px solid var(--border);
    overflow-x: auto; position: sticky; top: 88px; z-index: 99;
  }
  .week-tab {
    font-family: 'DM Mono', monospace; font-size: 11px; letter-spacing: 0.08em;
    padding: 5px 14px; border-radius: 20px; cursor: pointer; flex-shrink: 0;
    border: 1px solid var(--border); background: transparent; color: var(--muted);
    transition: all 0.15s;
  }
  .week-tab.active { background: var(--accent); border-color: var(--accent); color: #000; font-weight: 500; }
  .week-tab:hover:not(.active) { border-color: var(--accent); color: var(--accent); }

  /* CONTENT */
  .content { padding: 20px 24px; max-width: 720px; }

  /* WEEK PANEL */
  .week-panel { display: none; }
  .week-panel.active { display: block; }

  /* GIORNO */
  .giorno {
    margin-bottom: 24px; border: 1px solid var(--border);
    border-radius: 6px; overflow: hidden;
  }
  .giorno-header {
    background: var(--surface2); padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; gap: 10px;
  }
  .giorno-title {
    font-family: 'Bebas Neue', sans-serif; font-size: 16px;
    letter-spacing: 0.08em; color: var(--accent);
  }
  .giorno-count {
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: var(--muted); letter-spacing: 0.06em;
  }

  /* ESERCIZIO */
  .ex-card {
    padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.04);
    display: flex; gap: 12px; align-items: flex-start;
  }
  .ex-card:last-child { border-bottom: none; }
  .ex-num {
    font-family: 'DM Mono', monospace; font-size: 11px;
    color: var(--muted); flex-shrink: 0; width: 20px;
    padding-top: 2px;
  }
  .ex-body { flex: 1; min-width: 0; }
  .ex-name-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
  .ex-name {
    font-size: 14px; font-weight: 400; color: var(--text); line-height: 1.2;
  }
  .ex-blocco {
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: var(--accent); background: rgba(200,241,53,0.1);
    border: 1px solid rgba(200,241,53,0.2); border-radius: 3px;
    padding: 1px 6px; flex-shrink: 0;
  }
  .ex-metod {
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: var(--muted); flex-shrink: 0;
  }
  .ex-details {
    display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 4px;
  }
  .ex-detail {
    display: flex; flex-direction: column; gap: 2px;
  }
  .ex-detail-label {
    font-family: 'DM Mono', monospace; font-size: 8px;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);
  }
  .ex-detail-val {
    font-family: 'DM Mono', monospace; font-size: 13px;
    color: var(--text); letter-spacing: 0.02em;
  }
  .ex-detail-val.accent { color: var(--accent); }
  .ex-note-row { margin-top: 6px; }
  .ex-note {
    font-size: 11px; color: var(--muted); font-style: italic;
    border-left: 2px solid var(--border); padding-left: 8px;
  }
  .ex-consiglio {
    display: inline-block; margin-top: 6px;
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: #f5a623; background: rgba(245,166,35,0.1);
    border: 1px solid rgba(245,166,35,0.2); border-radius: 3px;
    padding: 2px 8px;
  }
  .ex-video-col { flex-shrink: 0; padding-top: 2px; }
  .ex-video-btn {
    display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border-radius: 50%;
    background: rgba(200,241,53,0.1); border: 1px solid rgba(200,241,53,0.25);
    color: var(--accent); font-size: 14px; text-decoration: none;
    transition: all 0.15s; flex-shrink: 0;
  }
  .ex-video-btn:hover { background: rgba(200,241,53,0.25); border-color: var(--accent); }
  .ex-no-video {
    width: 36px; height: 36px; display: flex; align-items: center;
    justify-content: center; opacity: 0.15; font-size: 14px;
  }

  /* FOOTER */
  .footer {
    margin-top: 40px; padding: 16px 24px;
    font-family: 'DM Mono', monospace; font-size: 9px;
    color: var(--muted); letter-spacing: 0.06em; text-align: center;
    border-top: 1px solid var(--border);
  }

  @media (max-width: 480px) {
    .header { padding: 14px 16px 12px; }
    .content { padding: 14px 12px; }
    .week-tabs { padding: 10px 12px; }
    .ex-card { padding: 10px 12px; gap: 8px; }
    .ex-detail-val { font-size: 12px; }
  }
</style>
</head>
<body>

<div class="header">
  <div class="header-logo">Trainer<span>/</span>Tascabile</div>
  <div class="header-prog">${escH(nomeProg)}</div>
  <div class="header-meta">${escH(nome)}${email?' · '+escH(email):''}${dataF?' · '+escH(dataF):''}</div>
</div>

<div class="week-tabs" id="week-tabs">
${settimane.map((w,i) => `  <button class="week-tab${i===0?' active':''}" onclick="showWeek(${i})" id="tab-${i}">Settimana ${w+1}</button>`).join('\n')}
</div>

<div class="content">
${settimane.map((w, wi) => {
  return `<div class="week-panel${wi===0?' active':''}" id="panel-${wi}">
${giorniValidi.map(day => {
    const exValidi = day.esercizi.filter(ex => (ex.settimane[w]||{}).struttura || ex.esercizio);
    if(!exValidi.length) return '';
    return `  <div class="giorno">
    <div class="giorno-header">
      <div class="giorno-title">${escH(day.nome)}</div>
      <div class="giorno-count">${exValidi.length} esercizi</div>
    </div>
${exValidi.map((ex, ei) => {
      const sd = ex.settimane[w] || {};
      const esNome = (sd.esercizio !== undefined && sd.esercizio !== '') ? sd.esercizio : ex.esercizio;
      const nota   = (sd.note !== undefined && sd.note !== '') ? sd.note : (ex.note||'');
      const metod  = (sd.metodologia !== undefined && sd.metodologia !== '') ? sd.metodologia : (ex.metodologia||'');
      const struttura = (sd.struttura||'').replace(/\*/g,'·');
      const recupero  = sd.recupero || '';
      const consiglio = sd.consiglio || '';
      const videoUrl  = getVideoLink(esNome);
      return `    <div class="ex-card">
      <div class="ex-num">${ei+1}</div>
      <div class="ex-body">
        <div class="ex-name-row">
          <span class="ex-name">${escH(esNome)}</span>
          ${ex.blocco ? `<span class="ex-blocco">${escH(ex.blocco)}</span>` : ''}
          ${metod ? `<span class="ex-metod">${escH(metod)}</span>` : ''}
        </div>
        <div class="ex-details">
          ${struttura ? `<div class="ex-detail"><div class="ex-detail-label">Struttura</div><div class="ex-detail-val accent">${escH(struttura)}</div></div>` : ''}
          ${recupero ? `<div class="ex-detail"><div class="ex-detail-label">Recupero</div><div class="ex-detail-val">${escH(recupero)}'</div></div>` : ''}
        </div>
        ${nota ? `<div class="ex-note-row"><div class="ex-note">${escH(nota)}</div></div>` : ''}
        ${consiglio ? `<span class="ex-consiglio">📌 ${escH(consiglio)}</span>` : ''}
      </div>
      <div class="ex-video-col">
        ${videoUrl
          ? `<a class="ex-video-btn" href="${videoUrl}" target="_blank" rel="noopener" title="Guarda video">▶</a>`
          : `<div class="ex-no-video">▶</div>`}
      </div>
    </div>`;
    }).join('\n')}
  </div>`;
  }).join('\n')}
</div>`;
}).join('\n')}
</div>

<div class="footer">
  Trainer Tascabile · ${escH(nomeProg)} · ${escH(nome)} · Generato il ${new Date().toLocaleDateString('it-IT')}
</div>

${EXPORT_PAGE_SCRIPT}

</body>
</html>`;

  // Download
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (nomeProg.replace(/\s+/g,'_') + '_' + nome.replace(/\s+/g,'_') + '.html');
  a.click();
  URL.revokeObjectURL(url);
  toggleFab();
}

function escH(v) {
  return String(v||'')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ────────────────────────────────────────────────────────────────────────────

// ── BACKUP & RESTORE ──────────────────────────────────────────────────────────
function openBackup() {
  document.getElementById('backup-overlay').style.display = 'flex';
  document.getElementById('backup-status').textContent = '';
  toggleMenu();
}
function closeBackup() {
  document.getElementById('backup-overlay').style.display = 'none';
}
function esportaBackup() {
  const data = {
    coaching_clienti: localStorage.getItem('coaching_clienti'),
    coaching_pagamenti: localStorage.getItem('coaching_pagamenti'),
    coaching_saved_programs: localStorage.getItem('coaching_saved_programs'),
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'trainer-tascabile-backup-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
  document.getElementById('backup-status').textContent = '\u2713 Backup esportato';
}
function importaBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = JSON.parse(e.target.result);
      const keys = ['coaching_clienti', 'coaching_pagamenti', 'coaching_saved_programs'];
      let restored = 0;
      keys.forEach(key => {
        if (data[key]) {
          localStorage.setItem(key, data[key]);
          restored++;
        }
      });
      if (typeof renderClientiList === 'function') renderClientiList();
      if (typeof renderPagClientiList === 'function') renderPagClientiList();
      if (typeof renderStats === 'function') renderStats('stat-');
      document.getElementById('backup-status').textContent = '\u2713 Ripristinati ' + restored + ' archivi';
    } catch(err) {
      document.getElementById('backup-status').textContent = '\u2715 File non valido';
    }
  };
  reader.readAsText(file);
}
