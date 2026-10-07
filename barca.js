/* ================= CONFIG (unico punto da modificare) ================= */
const CONFIG = {
  CHANNEL_ID: '3151316',
  // la Read API Key NON sta nel codice in chiaro: e' cifrata in chiavi-cifrate.js e si
  // sblocca con la password delle dashboard (cassaforte.js), una volta per dispositivo
  MAX_RESULTS: 8000,           // massimo consentito da ThingSpeak per richiesta
  REFRESH_MS:  5 * 60 * 1000,  // ricarica i dati ogni 5 minuti
  TZ: 'Europe/Rome',

  // inizio dei dati "puliti" (assestamento batteria IoT escluso): 22/09/2026 ore 03:00
  CLEAN_START: '2026-09-22T03:00:00+02:00',

  // soglie batteria IoT (come nel firmware)
  IOT_ALERT: 3500, IOT_CRIT: 3300,

  // Modello consumo IoT:  consumo(N) [mV/giorno] = P_SLEEP + (24/N) * E_CICLO   (N = intervallo in ore)
  // I due parametri vengono RICALCOLATI DAI DATI a ogni aggiornamento (calibraModello): si misura il
  // consumo in ogni periodo con intervallo costante e si adatta la retta. Questi valori servono solo
  // finche' non ci sono almeno due intervalli diversi misurati (test 6h e 3h di settembre-ottobre 2026).
  P_SLEEP: 12.72,   // mV/giorno consumati dal solo deep sleep
  E_CICLO: 1.863,   // mV consumati da ogni ciclo di lavoro (risveglio, rete, GPS, invii)
  // MASTER: consumo "pulito" di riferimento, FISSO. Calcolato l'08/10/2026 da periodi di almeno 5 giorni
  // senza consumi anomali: 6 h dal 22/09 03:00 al 28/09 03:00 (5,8 gg, 17,5 mV/g) e 3 h dal 28/09 03:00
  // al 03/10 15:00 (5,3 gg, 25,7 mV/g). Le misure reali vengono confrontate con questo;
  // da aggiornare quando si analizzano 12 h e 24 h.
  MASTER: { P: 9.28, E: 2.053, rif: { 6: 17.5, 3: 25.7 }, nota: '6 h 22-28/09 · 3 h 28/09-03/10, 5+ giorni ciascuno' },
  SCOSTAMENTO_PCT: 15,   // oltre questa differenza dal master una misura viene evidenziata
  CAL_MIN_DAYS: 5, CAL_MIN_POINTS: 6,   // periodo minimo per misurare il consumo di un intervallo
  RICARICA_MV: 60,  // salita della batteria IoT oltre cui si considera una ricarica
  ASSESTAMENTO_H: 12, // ore dopo una ricarica escluse dalle misure (tensione che si assesta)
  PICCO_MV: 6,      // scarto minimo (mV) dalla tendenza oltre cui una lettura IoT e' un picco da scartare

  // soglie batterie barca (AGM 12 V): ALERT ~50%, CRITICA ~10%
  BOAT_ALERT: 12.2, BOAT_CRIT: 11.8,
  // la linea ALERT e' sempre visibile; la CRITICA compare quando la tensione arriva al livello ALERT

  // capacità batterie barca (Ah) — Motore da confermare
  CAP_AH: { v1: 80, v2: 160 },

  // campi GPS: null = automatico (latitude/longitude del feed, oppure campi chiamati "lat"/"lon");
  // altrimenti es. ['field4','field5']
  GPS_FIELDS: null,

  MAP_POINTS: 20,
  TREND_DAYS_IOT: 5,
  TREND_DAYS_BOAT: 7,

  // link alla chat Telegram del bot (pagina consumi, pulsante "Apri Telegram"); lascia '' per nasconderlo
  TELEGRAM_URL: ''
};

/* ================= UTIL ================= */
const $ = id => document.getElementById(id);
const nf = (x, d = 1) => (x == null || !isFinite(x)) ? '--' :
  x.toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
const dtRome = new Intl.DateTimeFormat('sv-SE', { timeZone: CONFIG.TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
const romeStr  = d => dtRome.format(d);                      // "2026-10-04 20:59:47"
const fmtShort = d => { const s = romeStr(d); return s.slice(8,10)+'/'+s.slice(5,7)+' '+s.slice(11,16); };
const fmtFull  = d => { const s = romeStr(d); return s.slice(8,10)+'/'+s.slice(5,7)+'/'+s.slice(0,4)+' '+s.slice(11,16); };
const num = x => { if (x === null || x === undefined || x === '') return null; const n = parseFloat(x); return isFinite(n) ? n : null; };
const DAY = 86400000;
const median = a => { const s = [...a].sort((x,y)=>x-y), m = s.length>>1; return s.length ? (s.length%2 ? s[m] : (s[m-1]+s[m])/2) : null; };
const isTouch = matchMedia('(pointer:coarse)').matches;
const daysStr = d => (d == null || !isFinite(d)) ? '--' : d > 365 ? '> 1 anno' : d >= 10 ? nf(d,0)+' gg' : nf(d,1)+' gg';
const distStr = d => d == null ? '--' : d < 1000 ? nf(d,0)+' m' : nf(d/1000,2)+' km';

// SoC AGM da tensione (stessa tabella del firmware, interpolata)
const SOC_TBL = [[11.6,0],[11.7,5],[11.8,10],[11.9,20],[12.0,30],[12.1,40],[12.2,50],[12.3,60],[12.4,70],[12.5,80],[12.6,90],[12.7,95],[12.8,100]];
function soc(v){
  if (v <= SOC_TBL[0][0]) return 0;
  if (v >= 12.8) return 100;
  for (let i = 1; i < SOC_TBL.length; i++){
    const [v1,s1] = SOC_TBL[i-1], [v2,s2] = SOC_TBL[i];
    if (v <= v2) return s1 + (s2-s1)*(v-v1)/(v2-v1);
  }
  return 100;
}
// regressione lineare: pendenza per giorno ed errore standard
function linfit(pts){ // pts = [{t:Date, y:number}]
  const n = pts.length; if (n < 3) return null;
  const t0 = pts[0].t.getTime();
  const xs = pts.map(p => (p.t.getTime()-t0)/DAY), ys = pts.map(p => p.y);
  const mx = xs.reduce((a,b)=>a+b,0)/n, my = ys.reduce((a,b)=>a+b,0)/n;
  let sxx = 0, sxy = 0;
  for (let i=0;i<n;i++){ sxx += (xs[i]-mx)**2; sxy += (xs[i]-mx)*(ys[i]-my); }
  if (sxx === 0) return null;
  const slope = sxy/sxx, ic = my - slope*mx;
  let sse = 0; for (let i=0;i<n;i++) sse += (ys[i]-(ic+slope*xs[i]))**2;
  const se = n > 2 ? Math.sqrt(sse/(n-2)/sxx) : null;
  return { slope, se, n, spanDays: xs[n-1]-xs[0] };
}
// Come linfit, ma scarta i picchi: ogni lettura viene confrontata con il valore atteso dalla retta
// delle 2 letture precedenti e delle 2 successive (tiene conto dei tempi); se se ne discosta piu' di
// 3 volte la dispersione tipica (MAD), e comunque piu' di PICCO_MV, e' un picco e non entra nel calcolo.
// Le prime e le ultime 2 letture non vengono mai scartate (manca il confronto da un lato).
function linfitRobusto(pts, minScarto = CONFIG.PICCO_MV){
  if (pts.length < 7) return linfit(pts);
  const dev = pts.map((p,i) => {
    if (i < 2 || i > pts.length-3) return 0;
    const v = [pts[i-2], pts[i-1], pts[i+1], pts[i+2]], f = linfit(v);
    if (!f) return 0;
    const t0 = v[0].t.getTime(), xs = v.map(q => (q.t.getTime()-t0)/DAY);
    const mx = xs.reduce((a,b)=>a+b,0)/4, my = v.reduce((a,q)=>a+q.y,0)/4;
    return p.y - (my + f.slope*((p.t.getTime()-t0)/DAY - mx));
  });
  const mad = median(dev.slice(2, -2).map(Math.abs));
  const soglia = Math.max(3 * 1.4826 * mad, minScarto);
  const buoni = pts.filter((p,i) => Math.abs(dev[i]) <= soglia);
  const f = linfit(buoni);
  return f ? Object.assign(f, { scartati: pts.length - buoni.length }) : linfit(pts);
}
function haversine(a,b){
  const R = 6371000, r = x => x*Math.PI/180;
  const dLat = r(b.lat-a.lat), dLon = r(b.lon-a.lon);
  const h = Math.sin(dLat/2)**2 + Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
// parametri del modello in uso (aggiornati da calibraModello dopo ogni caricamento dati)
let MODEL = { P: CONFIG.P_SLEEP, E: CONFIG.E_CICLO, auto: false, misure: {} };
const master = N => CONFIG.MASTER.P + (24/N)*CONFIG.MASTER.E;   // consumo master (mV/giorno)
const snapN = h => [3,6,12,24].find(k => Math.abs(h-k)/k < 0.2) || null;
// consumo master atteso su una serie di letture: si costruisce la tensione che avrebbe una batteria
// "master" negli stessi istanti (con gli intervalli realmente usati) e la si misura con la stessa
// regressione delle letture vere, cosi' il confronto e' alla pari anche quando l'intervallo cambia.
function masterAtteso(pts){
  if (pts.length < 3) return null;
  const Ns = intervalliTratti(pts);
  let v = 0, ok = 0; const sint = [{ t: pts[0].t, y: 0 }];
  for (let i = 1; i < pts.length; i++){
    const N = Ns[i-1];
    if (N){ v -= master(N) * (pts[i].t - pts[i-1].t) / DAY; ok++; }
    sint.push({ t: pts[i].t, y: v });
  }
  const f = ok ? linfit(sint) : null;
  return f ? -f.slope : null;
}
// Intervallo di invio di ogni tratto tra due letture consecutive (array lungo pts.length-1).
// Un tratto piu' lungo del normale e' un invio mancato (rete assente): l'intervallo non cambia e il
// consumo di quel risveglio resta nel calo di tensione. L'intervallo cambia solo se compare un tratto
// piu' corto (un invio mancato non puo' accorciarlo) o se due tratti di fila valgono un intervallo piu'
// lungo (come dopo un comando INTERVALLO).
function intervalliTratti(pts){
  const g = []; for (let i = 1; i < pts.length; i++) g.push((pts[i].t - pts[i-1].t) / 3600000);
  const out = []; let cur = null;
  for (let i = 0; i < g.length; i++){
    const sN = snapN(g[i]);
    if (!cur) cur = sN;
    else if (sN && sN < cur) cur = sN;
    else if (sN && sN > cur && i + 1 < g.length && snapN(g[i+1]) === sN) cur = sN;
    out.push(cur);
  }
  return out;
}
// Consumo previsto per un intervallo, unica regola per tabella, grafici e data di ricarica:
// se l'intervallo e' gia' stato misurato (almeno CAL_MIN_DAYS giorni) si usa il misurato reale,
// altrimenti il master (prudente: a 12 e 24 h prevede piu' consumo del modello automatico).
const previsto = N => MODEL.misure[N] ? MODEL.misure[N].rate : master(N);
const fontePrevisto = N => MODEL.misure[N] ? 'misurato' : 'master';
// composizione di una finestra di letture: giorni per intervallo, es. "4,0 gg a 3 h + 1,0 gg a 12 h"
function composizione(pts){
  const NT = intervalliTratti(pts), gg = {};
  for (let i = 1; i < pts.length; i++) if (NT[i-1]) gg[NT[i-1]] = (gg[NT[i-1]] || 0) + (pts[i].t - pts[i-1].t) / DAY;
  return Object.keys(gg).map(Number).sort((a,b) => a-b).map(N => `${nf(gg[N],1)} gg a ${N} h`).join(' + ');
}
const scostamento = (mis, rif) => rif ? (mis / rif - 1) * 100 : null;
const fuoriMaster = pct => pct != null && Math.abs(pct) > CONFIG.SCOSTAMENTO_PCT;
const model = N => ({ sleep: MODEL.P, work: (24/N)*MODEL.E, total: MODEL.P + (24/N)*MODEL.E });

// Ricariche della batteria IoT: una lettura sale di oltre RICARICA_MV rispetto al minimo delle 3
// precedenti. La ricarica finisce all'ultima lettura ancora in salita (caricatore attaccato); da li'
// partono ASSESTAMENTO_H ore escluse dalle misure. Dal file del 21/09/2026: dopo lo stacco la tensione
// cala di 30-60 mV/giorno per circa 12 ore, poi torna al regime normale.
let RICARICHE = [], IN_CARICA = new Set();
function trovaRicariche(){
  const p = ROWS.filter(r => r.iot != null);
  RICARICHE = []; IN_CARICA = new Set();
  for (let i = 1; i < p.length; i++){
    const ultima = RICARICHE.length ? RICARICHE[RICARICHE.length-1] : -Infinity;
    if (p[i].t - ultima < DAY) continue;   // subito dopo una ricarica
    const prec = p.slice(Math.max(0, i-3), i).filter(r => r.t.getTime() >= ultima);   // solo dopo l'ultima ricarica
    if (!prec.length) continue;
    const prima = Math.min(...prec.map(r => r.iot));
    if (p[i].iot - prima <= CONFIG.RICARICA_MV) continue;
    let j = i;
    while (j + 1 < p.length && p[j+1].iot >= p[j].iot - 2) j++;   // ancora in carica
    for (let k = i; k <= j; k++) IN_CARICA.add(p[k].t.getTime());  // letture in carica: mai usate
    RICARICHE.push(p[j].t.getTime());
    i = j;
  }
}
// inizio dei dati validi per una misura che arriva fino al tempo t: dopo CLEAN_START e dopo
// l'assestamento dell'ultima ricarica precedente
function inizioPulito(t){
  let s = new Date(CONFIG.CLEAN_START).getTime();
  for (const r of RICARICHE) if (r <= t) s = Math.max(s, r + CONFIG.ASSESTAMENTO_H*3600000);
  return s;
}
const valida = r => r.iot != null && !IN_CARICA.has(r.t.getTime()) && r.t.getTime() >= inizioPulito(r.t.getTime());
const epoca = t => RICARICHE.filter(r => r <= t).length;   // quante ricariche (finite) prima di t

// Divide le letture (dopo CLEAN_START) in periodi con intervallo costante, misura il consumo di
// ciascuno e ricava P_SLEEP ed E_CICLO con una regressione pesata sulla durata dei periodi.
function calibraModello(){
  const pts = ROWS.filter(valida);
  // periodi = tratti consecutivi con lo stesso intervallo (gli invii mancati non li spezzano),
  // mai a cavallo di una ricarica
  const NT = intervalliTratti(pts), seg = [];
  for (let i = 1; i < pts.length; i++){
    const N = NT[i-1], last = seg[seg.length-1];
    if (!N) continue;
    if (last && last.N === N && last.end === i-1 && epoca(last.pts[0].t.getTime()) === epoca(pts[i].t.getTime())){ last.pts.push(pts[i]); last.end = i; }
    else seg.push({ N, pts: [pts[i-1], pts[i]], end: i });
  }
  const misure = {};
  for (const s of seg){
    const f = linfitRobusto(s.pts.map(p => ({ t:p.t, y:p.iot })));
    if (!f || f.spanDays < CONFIG.CAL_MIN_DAYS || f.n < CONFIG.CAL_MIN_POINTS) continue;
    const m = misure[s.N] || (misure[s.N] = { w:0, sum:0, n:0 });
    m.w += f.spanDays; m.sum += -f.slope * f.spanDays; m.n += f.n;
  }
  for (const N in misure){ misure[N].rate = misure[N].sum / misure[N].w; misure[N].giorni = misure[N].w; }
  const Ns = Object.keys(misure).map(Number);
  MODEL = { P: CONFIG.P_SLEEP, E: CONFIG.E_CICLO, auto: false, misure };
  if (Ns.length >= 2){
    // retta rate = P + c*E con c = cicli al giorno, pesata con i giorni di misura
    let W=0, Sx=0, Sy=0, Sxx=0, Sxy=0;
    for (const N of Ns){ const w = misure[N].w, x = 24/N, y = misure[N].rate; W+=w; Sx+=w*x; Sy+=w*y; Sxx+=w*x*x; Sxy+=w*x*y; }
    const E = (W*Sxy - Sx*Sy) / (W*Sxx - Sx*Sx), P = (Sy - E*Sx) / W;
    if (isFinite(E) && isFinite(P) && E > 0 && P > 0) MODEL = { P, E, auto: true, misure };
  }
}

/* ================= DATI ================= */
let ROWS = [];
let CHANNEL = {};
let currentRange = '7';
let currentEnd = null;   // fine della finestra dei grafici; null = adesso. Cambia trascinando un grafico
const viewEnd = () => currentEnd ? currentEnd.getTime() : Date.now();
try { const s = localStorage.getItem('barca-range'); if (s) currentRange = s; } catch(e){}

/* ---------- accesso: password unica (cassaforte.js), chiave salvata solo in questo browser ---------- */
function readKey(){ try { return localStorage.getItem(CASSAFORTE_BARCA) || ''; } catch(e){ return ''; } }
function logout(){ cassaforteEsci(); }
document.querySelectorAll('[data-logout]').forEach(b => b.addEventListener('click', logout));
function askKey(msg){ cassaforteForm(msg); }
class LoginNeeded extends Error {}

async function loadData(){
  const key = readKey();
  if (!key){ askKey(); throw new LoginNeeded('chiave mancante'); }
  const url = `https://api.thingspeak.com/channels/${CONFIG.CHANNEL_ID}/feeds.json?api_key=${encodeURIComponent(key)}&results=${CONFIG.MAX_RESULTS}&location=true`;
  const res = await fetch(url, { cache: 'no-store' });
  const j = res.ok ? await res.json() : null;
  if (res.status === 400 || res.status === 401 || res.status === 403 || j === -1 || (j && !j.feeds)){
    try { localStorage.removeItem(CASSAFORTE_BARCA); } catch(e){}
    askKey('La chiave ThingSpeak salvata non funziona più (rigenerata?). Inserisci la password; se il problema resta, le chiavi sono state rigenerate: <a href="cifra-chiavi.html" style="color:#6aa6ff">aggiorna le chiavi</a>.');
    throw new LoginNeeded('chiave non valida');
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  CHANNEL = j.channel || {};
  const [kLat, kLon] = gpsKeys(j.feeds || []);
  ROWS = (j.feeds || []).map(f => {
    let v1 = num(f.field1), v2 = num(f.field2), iot = num(f.field3);
    let lat = num(f[kLat]), lon = num(f[kLon]);
    if (v1 != null && (v1 < 8 || v1 > 16)) v1 = null;
    if (v2 != null && (v2 < 8 || v2 > 16)) v2 = null;
    if (iot != null && (iot < 2500 || iot > 4500)) iot = null;
    if (lat == null || lon == null || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180){ lat = lon = null; }
    return { t: new Date(f.created_at), v1, v2, iot, lat, lon };
  }).filter(r => !isNaN(r.t)).sort((a,b) => a.t - b.t);
  trovaRicariche();
  calibraModello();
}
// dove stanno latitudine e longitudine nel canale
function gpsKeys(feeds){
  if (CONFIG.GPS_FIELDS) return CONFIG.GPS_FIELDS;
  if (feeds.some(f => num(f.latitude) && num(f.longitude))) return ['latitude','longitude'];
  const names = Object.keys(CHANNEL).filter(k => /^field\d$/.test(k));
  const lat = names.find(k => /lat/i.test(CHANNEL[k])), lon = names.find(k => /lon|lng/i.test(CHANNEL[k]));
  return lat && lon ? [lat, lon] : ['latitude','longitude'];
}
function channelFields(){
  return Object.keys(CHANNEL).filter(k => /^field\d$/.test(k)).sort().map(k => `${k} "${CHANNEL[k]}"`).join(', ');
}
function showError(e){
  const b = $('banner'); if (!b || e instanceof LoginNeeded) return;
  b.style.display = 'block';
  b.textContent = 'Impossibile leggere i dati da ThingSpeak (' + e.message + '). Riprovo tra poco' + (ROWS.length ? '; sono mostrati gli ultimi dati scaricati.' : '.');
}
function clearError(){ const b = $('banner'); if (b) b.style.display = 'none'; }

function lastN(key, n = 3){
  const v = ROWS.filter(r => r[key] != null).slice(-n).map(r => r[key]);
  return v.length ? median(v) : null;
}
// Intervallo di invio dagli ultimi 3 valori (2 intervalli): si prende il piu' breve, perche' un invio
// saltato puo' solo allungare un intervallo; se e' vicino (±20%) a 3, 6, 12 o 24 h e' quello.
// Dopo un cambio di INTERVALLO il nuovo valore compare dopo 2 invii.
function detectInterval(){
  const r = ROWS.slice(-3), diffs = [];
  for (let i = 1; i < r.length; i++) diffs.push((r[i].t - r[i-1].t)/3600000);
  if (!diffs.length) return { raw:null, N:null };
  const min = Math.min(...diffs);
  const snap = [3,6,12,24].find(k => Math.abs(min-k)/k < 0.2);
  return { raw: min, N: snap || min, snapped: !!snap };
}
// Quando ricaricare la batteria IoT: giorni fino a ALERT (3500) e CRITICA (3300).
// Consumo usato: il piu' alto tra quello misurato (ultimi giorni) e il modello per l'intervallo attuale,
// cosi' la data e' prudente.
function iotRecharge(){
  const iot = lastN('iot');
  if (iot == null || !ROWS.length) return null;
  const lastT = ROWS[ROWS.length-1].t.getTime(), cs = inizioPulito(lastT);
  const pts = ROWS.filter(r => valida(r) && r.t.getTime() >= Math.max(cs, lastT - CONFIG.TREND_DAYS_IOT*DAY));
  const fit = linfitRobusto(pts.map(p => ({ t:p.t, y:p.iot })));
  const meas = fit && fit.spanDays >= 1.5 && fit.n >= 6 ? -fit.slope : null;
  if (meas != null && meas <= 1) return { iot, charging:true };
  const itv = detectInterval(), N = itv.N && itv.N >= 1 ? itv.N : null;
  const mod = N ? previsto(N) : null;
  const rate = Math.max(meas || 0, mod || 0);
  if (!rate) return { iot, rate:null };
  const at = mv => new Date(lastT + Math.max(0, (iot - mv) / rate) * DAY);
  const dAlert = at(CONFIG.IOT_ALERT), dCrit = at(CONFIG.IOT_CRIT);
  return { iot, rate, meas, mod, N, src: meas != null && meas >= (mod || 0) ? 'misurato ultimi giorni' : 'previsto ' + (N ? fontePrevisto(N) : ''),
    dAlert, dCrit, daysAlert: (dAlert - Date.now()) / DAY, daysCrit: (dCrit - Date.now()) / DAY };
}
const fmtDay = new Intl.DateTimeFormat('it-IT', { timeZone: CONFIG.TZ, weekday:'short', day:'2-digit', month:'2-digit' });
const dayStr = d => fmtDay.format(d);   // "mar 14/10"

function iotState(mv){
  if (mv == null) return { cls:'', badge:'' };
  if (mv >= 3700) return { cls:'good', badge:'<span class="badge ok">OK</span>' };
  if (mv >= CONFIG.IOT_ALERT) return { cls:'warn', badge:'<span class="badge warn">BASSA</span>' };
  if (mv >= CONFIG.IOT_CRIT) return { cls:'bad', badge:'<span class="badge bad">ALERT</span>' };
  return { cls:'bad', badge:'<span class="badge bad">CRITICA</span>' };
}
function rangeDays(){ return currentRange === 'all' ? Infinity : parseFloat(currentRange); }
const RANGES = { '3':'3d', '7':'1w', '14':'2w', '30':'1m', 'all':'Tutto' };
if (!RANGES[currentRange]) currentRange = '7';   // es. '1' (1d) salvato prima che venisse tolto
function rangeLabel(){ return RANGES[currentRange] || currentRange; }
function setupRangeButtons(onChange){
  document.querySelectorAll('.btn[data-range]').forEach(b => {
    b.classList.toggle('active', b.dataset.range === currentRange);
    b.addEventListener('click', () => {
      document.querySelectorAll('.btn[data-range]').forEach(x => x.classList.remove('active'));
      b.classList.add('active'); currentRange = b.dataset.range; currentEnd = null;   // torna ad adesso
      try { localStorage.setItem('barca-range', currentRange); } catch(e){}
      if (ROWS.length) onChange();
    });
  });
}
function tickClock(){
  const el = $('clock'); if (!el) return;
  el.innerHTML = romeStr(new Date()).slice(11,19);
}

/* ================= GRAFICI ================= */
// Trascinando un grafico si sposta la fine della finestra di tempo: al rilascio
// tutti i grafici vengono ridisegnati sul nuovo periodo (come meteo-dashboard).
let isDragging = false, onPan = null;
function setupPanHandler(el, tmin, tmax){
  el.removeAllListeners && el.removeAllListeners('plotly_relayout');
  el.removeAllListeners && el.removeAllListeners('plotly_relayouting');
  el.on('plotly_relayouting', () => { isDragging = true; });
  el.on('plotly_relayout', ev => {
    if (!isDragging || !ev['xaxis.range[1]']) return;
    isDragging = false;
    // l'asse e' in ora italiana: riporta lo spostamento sul tempo reale
    const shift = toMs(ev['xaxis.range[1]']) - toMs(romeStr(new Date(tmax)));
    let newEnd = tmax + shift;
    if (newEnd >= Date.now() - 60000) newEnd = null;                 // trascinato fino ad adesso: torna live
    else if (ROWS.length && newEnd < ROWS[0].t.getTime() + (tmax - tmin) / 2) newEnd = ROWS[0].t.getTime() + (tmax - tmin) / 2;
    if (newEnd !== null && Math.abs(newEnd - viewEnd()) < 1000) return;
    currentEnd = newEnd === null ? null : new Date(newEnd);
    if (onPan) onPan();
  });
}
const toMs = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
function windowLabel(){
  return `Range: ${rangeLabel()} | Fine: ${currentEnd ? fmtFull(currentEnd) : 'adesso'}`;
}
function plotSeries(divId, rngId, key, color, unit, dec, opts = {}){
  const days = rangeDays();
  const tmax = viewEnd();
  const tmin = isFinite(days) ? tmax - days*DAY : (ROWS.length ? ROWS[0].t.getTime() : tmax - DAY);
  const pts = ROWS.filter(r => r[key] != null && r.t.getTime() >= tmin && r.t.getTime() <= tmax);
  const el = $(divId);
  if (!pts.length){ Plotly.purge(el); el.innerHTML = '<div class="note" style="padding:20px">Nessun dato nel periodo selezionato.</div>'; if ($(rngId)) $(rngId).textContent=''; return; }
  const x = pts.map(p => romeStr(p.t)), y = pts.map(p => p[key]);
  const ymin = Math.min(...y), ymax = Math.max(...y), imin = y.indexOf(ymin), imax = y.indexOf(ymax);
  if ($(rngId)) $(rngId).textContent = `Min: ${nf(ymin,dec)} ${unit} | Max: ${nf(ymax,dec)} ${unit}`;

  const traces = [
    { x, y, type:'scatter', mode:'lines+markers', line:{color, width:2}, marker:{size:4, color}, connectgaps:true,
      fill:'tozeroy', fillcolor: opts.fill || 'rgba(0,0,0,0)',
      hovertemplate:`%{x|%d/%m %H:%M}<br><b>%{y:.${dec}f} ${unit}</b><extra></extra>` },
    { x:[x[imin],x[imax]], y:[ymin,ymax], type:'scatter', mode:'markers+text', showlegend:false, hoverinfo:'skip', cliponaxis:false,
      marker:{size:8, color:['#ff8a8a','#6dd96d'], line:{color:'#fff',width:1}},
      // etichette min/max verso l'interno del grafico, cosi' non coprono l'asse o i bordi
      text:[nf(ymin,dec), nf(ymax,dec)], textfont:{size:11, color:'#fff'},
      textposition:[imin, imax].map((k, j) => (j ? 'top ' : 'bottom ') + (k < pts.length*0.15 ? 'right' : k > pts.length*0.85 ? 'left' : 'center')) }
  ];
  const shapes = [], annots = [];
  let lo = ymin, hi = ymax;
  if (opts.thresholds && ymin < opts.thresholds.nearBelow){
    for (const th of opts.thresholds.lines){
      if (th.below != null && ymin > th.below) continue;   // linea mostrata solo quando i valori arrivano a 'below'
      shapes.push({ type:'line', xref:'paper', x0:0, x1:1, yref:'y', y0:th.v, y1:th.v, line:{color:th.c, width:1, dash:'dot'} });
      annots.push({ xref:'paper', x:0.995, xanchor:'right', yref:'y', y:th.v, yanchor:'bottom', text:th.t, showarrow:false, font:{size:10, color:th.c} });
      lo = Math.min(lo, th.v);
    }
  }
  const cs = new Date(CONFIG.CLEAN_START);
  if (cs >= pts[0].t){
    shapes.push({ type:'line', xref:'x', yref:'paper', x0:romeStr(cs), x1:romeStr(cs), y0:0, y1:1, line:{color:'#888', width:1, dash:'dash'} });
    annots.push({ xref:'x', x:romeStr(cs), yref:'paper', y:0, yanchor:'bottom', xanchor:'left', text:' inizio test', showarrow:false, font:{size:10, color:'#aaa'} });
  }
  if (key === 'iot') for (const r of RICARICHE){   // ricariche della batteria IoT
    if (r < tmin || r > tmax) continue;
    const x = romeStr(new Date(r));
    shapes.push({ type:'line', xref:'x', yref:'paper', x0:x, x1:x, y0:0, y1:1, line:{color:'#4cd38a', width:1, dash:'dash'} });
    annots.push({ xref:'x', x, yref:'paper', y:1, yanchor:'top', xanchor:'left', text:' ricarica', showarrow:false, font:{size:10, color:'#4cd38a'} });
  }
  let pad = (hi - lo) * 0.14 || (dec >= 2 ? 0.02 : 10);
  if (opts.yFixed){   // scala fissa, allargata solo se i dati escono
    const p2 = (opts.yFixed[1] - opts.yFixed[0]) * 0.03;
    lo = Math.min(opts.yFixed[0], ymin - p2); hi = Math.max(opts.yFixed[1], ymax + p2); pad = 0;
  }
  const spanH = (tmax - tmin) / 3600000;
  const small = innerWidth <= 600;
  const layout = {
    autosize:true, separators:',.',
    paper_bgcolor:'rgba(0,0,0,0)', plot_bgcolor:'rgba(0,0,0,0)',
    font:{ color:'#ffffff', size: small ? 10 : 12 },
    margin: small ? {l:44, r:8, t:8, b:26} : {l:52, r:12, t:8, b:28},
    xaxis:{ type:'date', range:[romeStr(new Date(tmin)), romeStr(new Date(tmax))], gridcolor:'#555555', linecolor:'#cfd2da', tickformat: spanH <= 49 ? '%H:%M' : '%d/%m', hoverformat:'%d/%m %H:%M' },
    yaxis:{ gridcolor:'#555555', linecolor:'#cfd2da', range:[lo - pad, hi + pad], fixedrange:true, tickformat:`.${opts.tickDec ?? dec}f`, zeroline:false },
    shapes, annotations: annots, showlegend:false, dragmode:'pan', hovermode:'closest'
  };
  if (el.querySelector('.note')) el.innerHTML = '';
  Plotly.react(el, traces, layout, { displayModeBar:false, responsive:true, scrollZoom:false });
  setupPanHandler(el, tmin, tmax);
}

/* ================= MAPPA ================= */
let map, mapLayer;
function initMap(){
  map = L.map('map', { zoomControl:true, attributionControl:true }).setView([42.1, 14.4], 9);
  const esri = n => `https://server.arcgisonline.com/ArcGIS/rest/services/${n}/MapServer/tile/{z}/{y}/{x}`;
  const dark = L.layerGroup([
    L.tileLayer(esri('Canvas/World_Dark_Gray_Base'), { attribution:'Tiles © Esri', maxZoom:19, maxNativeZoom:16 }),
    L.tileLayer(esri('Canvas/World_Dark_Gray_Reference'), { maxZoom:19, maxNativeZoom:16 })
  ]);
  const osm  = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution:'© OpenStreetMap', maxZoom:19 });
  const sat  = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution:'Tiles © Esri', maxZoom:19 });
  const sea  = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { attribution:'© OpenSeaMap', maxZoom:18 });
  const bases = { 'Scura':dark, 'Mappa':osm, 'Satellite':sat };
  let saved = null; try { saved = localStorage.getItem('barca-map'); } catch(e){}
  (bases[saved] || dark).addTo(map);
  map.on('baselayerchange', e => { try { localStorage.setItem('barca-map', e.name); } catch(err){} });
  L.control.layers(bases, { 'Segnali nautici':sea }, { collapsed:true }).addTo(map);
  mapLayer = L.layerGroup().addTo(map);
}
function gpsFixes(){ return ROWS.filter(r => r.lat != null).slice(-CONFIG.MAP_POINTS); }
function renderMap(){
  const fixes = gpsFixes();
  mapLayer.clearLayers();
  const rng = $('r-map');
  if (!fixes.length){
    const f = channelFields();
    $('mapinfo').textContent = 'Nessuna posizione GPS nei dati ThingSpeak (latitudine/longitudine vuote negli ultimi ' + ROWS.length + ' invii).' + (f ? ' Campi del canale: ' + f + '.' : '');
    if (rng) rng.textContent = ''; return;
  }
  const coords = fixes.map(f => [f.lat, f.lon]);
  if (fixes.length > 1) L.polyline(coords, { color:'#3d7cff', weight:3, opacity:.85, dashArray:'6 6' }).addTo(mapLayer);
  fixes.forEach((f, i) => {
    const last = i === fixes.length-1;
    const icon = L.divIcon({ className:'', html:`<div class="pt${last?' last':''}">${i+1}</div>`, iconSize: last ? [28,28] : [22,22], iconAnchor: last ? [14,14] : [11,11] });
    L.marker([f.lat, f.lon], { icon, zIndexOffset: last ? 1000 : 0 })
      .bindPopup(`<b>#${i+1}${last ? ' · ultima posizione' : ''}</b><br>${fmtFull(f.t)}<br>${f.lat.toFixed(6)}, ${f.lon.toFixed(6)}`)
      .addTo(mapLayer);
  });
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(coords).pad(0.25), { maxZoom:16 });
  const L1 = fixes[fixes.length-1];
  if (rng) rng.textContent = `${fixes.length} punti | ultimo: ${fmtShort(L1.t)}`;
  const moved = fixes.length > 1 ? ` · da #1: <b>${distStr(haversine(fixes[0], L1))}</b>` : '';
  $('mapinfo').innerHTML = `<span class="mono">${L1.lat.toFixed(5)}, ${L1.lon.toFixed(5)}</span> · <a target="_blank" rel="noopener" href="https://www.google.com/maps?q=${L1.lat},${L1.lon}">Google Maps</a>${moved}`;
}
