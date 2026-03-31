/* Running Diary v3 — rd-app.js */
/* Firebase imports handled via ESM in HTML */

/* ── Utilities ── */
export function pad(n){ return String(n).padStart(2,'0'); }
export function fmtDate(d){ const[y,m,dd]=d.split('-'); return`${dd}/${m}/${y}`; }
export function paceSecFromDistDur(dist,dur){ return(!dist||!dur||dist===0)?null:(dur/dist)*60; }
export function fmtPace(sec){ if(!sec)return'—'; const m=Math.floor(sec/60),s=Math.round(sec%60); return`${m}:${pad(s)}`; }
export function getWeekMonday(dateStr){
  const d=new Date(dateStr), day=d.getDay()||7;
  d.setDate(d.getDate()-day+1);
  return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
export function today(){ const d=new Date(); return`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

export function fmtDur(min){
  if(!min)return'—';
  const h=Math.floor(min/60), m=Math.round(min%60);
  return h>0?`${h}h ${m}m`:`${m}min`;
}

/* ── Zone engine (Karvonen) ── */
export function calcZones(hrmax, hrrest){
  if(!hrmax || hrmax<100) return null;
  const rest = hrrest||0;
  const hhr  = hrmax - rest; // heart rate reserve
  // Z1 <60%, Z2 60-70%, Z3 70-80%, Z4 80-90%, Z5 >90%
  const z = pct => Math.round(rest + hhr * pct);
  return [
    { label:'Z1', name:'Recupero attivo',    min: rest,  max: z(0.60)-1, color:'var(--z1)', bg:'var(--z1-bg)' },
    { label:'Z2', name:'Resistenza aerobica',min: z(0.60),max: z(0.70)-1,color:'var(--z2)', bg:'var(--z2-bg)' },
    { label:'Z3', name:'Aerobico avanzato',  min: z(0.70),max: z(0.80)-1,color:'var(--z3)', bg:'var(--z3-bg)' },
    { label:'Z4', name:'Soglia anaerobica',  min: z(0.80),max: z(0.90)-1,color:'var(--z4)', bg:'var(--z4-bg)' },
    { label:'Z5', name:'VO2max / Intervalli',min: z(0.90),max: hrmax,    color:'var(--z5)', bg:'var(--z5-bg)' },
  ];
}

export function getZoneForHR(hr, zones){
  if(!hr||!zones) return null;
  return zones.find(z=> hr>=z.min && hr<=z.max) || null;
}

/* ── Profile persistence (localStorage for profile only) ── */
export function loadProfile(){
  try{ return JSON.parse(localStorage.getItem('rd-profile')||'{}'); }catch{ return {}; }
}
export function saveProfile(p){
  localStorage.setItem('rd-profile', JSON.stringify(p));
}

/* ── Date range filter ── */
export function filterByPeriod(sessions, period){
  if(period==='all') return sessions;
  const now=new Date();
  let from=new Date();
  if(period==='week')  from.setDate(now.getDate()-7);
  if(period==='month') from.setMonth(now.getMonth()-1);
  if(period==='6m')    from.setMonth(now.getMonth()-6);
  if(period==='year')  from.setFullYear(now.getFullYear()-1);
  const fromStr=`${from.getFullYear()}-${pad(from.getMonth()+1)}-${pad(from.getDate())}`;
  return sessions.filter(s=>s.date>=fromStr);
}

/* ── Zone distribution from sessions ── */
export function calcZoneDist(sessions, zones){
  if(!zones) return null;
  const counts=[0,0,0,0,0];
  const times=[0,0,0,0,0];
  let total=0;
  for(const s of sessions){
    if(!s.hr) continue;
    const zi=zones.findIndex(z=>s.hr>=z.min && s.hr<=z.max);
    if(zi>=0){ counts[zi]++; times[zi]+=(s.dur||0); total+=(s.dur||0); }
  }
  return zones.map((z,i)=>({
    ...z,
    sessions: counts[i],
    minutes:  Math.round(times[i]),
    pct:      total>0 ? Math.round(times[i]/total*100) : 0
  }));
}

/* ── Type labels & classes ── */
export const TYPE_LABELS={ z2:'Zona 2', threshold:'Threshold', interval:'Intervalli', long:'Long run' };
export const TYPE_CLASS={ z2:'badge-z2', threshold:'badge-threshold', interval:'badge-interval', long:'badge-long' };
export const TYPE_COLOR={ z2:'var(--col-z2)', threshold:'var(--col-threshold)', interval:'var(--col-interval)', long:'var(--col-long)' };
