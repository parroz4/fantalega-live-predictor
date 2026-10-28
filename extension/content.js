/* Fantalega Live Predictor 1.0 — content script per leghe.fantacalcio.it
 * - pagine /live: proiezione del risultato (chi deve giocare = 6) con le regole della lega
 * - pagina "Opzioni di Lega": legge e salva automaticamente le regole della lega
 */
(() => {
  if (window.__fantalegaLivePredictor) return;
  window.__fantalegaLivePredictor = true;

  // ====================== Regole / impostazioni ======================
  const DEFAULTS = {
    soglie: [66, 72, 78, 84, 90], passo: 6,
    limitaPareggio: false, limitaPareggioPt: 6, limitaPareggioSottoSoglia: false,
    limitaVittoria: false, limitaVittoriaPt: 1,
    autogol: false, autogolPt: 59,
    maxCambi: 5, cambiIllimitati: false, cambioModulo: true,
    modDifesa: false, modIncludiPortiere: true,
    modTabella: [0, 0, 0, 0, 0, 1, 1, 3, 3, 6], // fasce: <5 | 5 | 5.25 | 5.5 | 5.75 | 6 | 6.25 | 6.5 | 6.75 | ≥7
    portaInviolata: false, portaInviolataPt: 0.5,
    bonusGol: 3, bonusAssist: 1, malusGolSubito: -1, malusAmm: -0.5,
    ammonitoSV: false,
    bonusCasa: 0, votoAttesa: 6,
    fonte: 'Regole standard'
  };
  // Preset opzionali per lega (slug URL -> regole). Vuoto: le regole si leggono da Opzioni di Lega.
  const PRESETS = {};
  const MOD_FASCE = [5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, 7];
  const MODULI = new Set(['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1']);

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync;
  const league = () => location.pathname.split('/')[1] || 'default';
  const storeKey = (l) => 'flp_' + l;
  let S = { ...DEFAULTS };
  let loadedFor = null;

  function loadLeague(cb) {
    const l = league();
    const base = { ...DEFAULTS, ...(PRESETS[l] || {}) };
    if (!hasStorage) { S = base; loadedFor = l; return cb(); }
    chrome.storage.sync.get(storeKey(l), (o) => {
      S = { ...base, ...((o && o[storeKey(l)]) || {}) };
      loadedFor = l; cb();
    });
  }
  function saveLeague() { if (hasStorage) chrome.storage.sync.set({ [storeKey(league())]: S }); }

  const RUOLI = { P: 1, D: 1, C: 1, A: 1 };

  const num = (t) => {
    if (t == null) return null;
    const n = parseFloat(String(t).trim().replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  // ====================== Parsing pagina live ======================
  function parsePlayer(card) {
    const row = card.parentElement;
    const st = row && row.querySelector('ui-match-player-status');
    const name = (card.querySelector('.player-name')?.textContent || '?').trim();
    const roleRaw = card.querySelector('[data-role]')?.dataset.role || 'C';
    const role = RUOLI[roleRaw] ? roleRaw : 'C';
    const ev = {};
    card.querySelectorAll('[data-icon-key]').forEach((i) => { ev[i.dataset.iconKey] = (ev[i.dataset.iconKey] || 0) + 1; });
    const gradeEl = st?.querySelector('ui-match-grade');
    const fgEl = st?.querySelector('ui-match-fantagrade');
    const icon = st?.querySelector('ui-player-status-icon');
    const fg = num(fgEl?.textContent);
    const grade = num(gradeEl?.textContent);
    if (fg != null) return { name, role, state: 'voto', fv: fg, voto: grade, ev };
    if (gradeEl || fgEl) return { name, role, state: ev.yellowCards ? 'amm' : 'sv', ev };
    if (icon) return { name, role, state: 'out', status: icon.dataset.status };
    return { name, role, state: 'attesa' }; // deve ancora giocare
  }
  const playersIn = (el) => (el ? [...el.querySelectorAll('ui-player-card')].map(parsePlayer) : []);

  function parseMatch() {
    const art = document.querySelector('article.current-match-card') || document.querySelector('article');
    const mp = art?.querySelector('ui-match-players');
    if (!mp) return null;
    const blocks = [...mp.children].filter((c) => c.tagName === 'DIV' && c.querySelector('ui-player-card'));
    if (blocks.length < 2) return null;
    const [tit, pan] = blocks;
    const titCols = [...tit.children].filter((c) => c.querySelector('ui-player-card'));
    const panCols = [...pan.children].filter((c) => c.querySelector('ui-player-card'));
    if (titCols.length < 2) return null;
    const show = art.querySelector('ui-match-showcase');
    const names = show ? [...show.querySelectorAll('span.font-bold')].map((s) => s.textContent.trim()) : [];
    const scores = show
      ? [...show.querySelectorAll('span')].filter((s) => /^\d+([.,]\d+)?$/.test(s.textContent.trim()) && String(s.className).includes('text-3xl')).map((s) => num(s.textContent))
      : [];
    const mk = (i) => ({ nome: names[i] || (i ? 'Ospite' : 'Casa'), parziale: scores[i] ?? null, titolari: playersIn(titCols[i]), panchina: playersIn(panCols[i]) });
    return { casa: mk(0), ospite: mk(1) };
  }

  // ====================== Calcolo (deterministico) ======================
  // Fantavoto di un giocatore che ha già il voto, con eventuale porta inviolata aggiunta
  function playedFV(pl) {
    let fv = pl.fv;
    if (pl.role === 'P' && S.portaInviolata && !pl.ev.concededGoals && pl.voto != null) {
      const e = pl.ev;
      const atteso = pl.voto + S.bonusGol * ((e.scoredGoals || 0) + (e.scoredPenalties || 0)) + S.bonusAssist * (e.assists || 0) + S.malusAmm * (e.yellowCards || 0);
      const giaIncluso = Math.abs(fv - (atteso + S.portaInviolataPt)) < 0.01;
      if (!giaIncluso) fv += S.portaInviolataPt;
    }
    return fv;
  }
  // -> {v, fv, stimato} oppure null se senza voto
  function valuta(pl) {
    if (pl.state === 'voto') return { v: pl.voto, fv: playedFV(pl), stimato: false };
    if (pl.state === 'amm' && S.ammonitoSV) return { v: null, fv: 5.5, stimato: false };
    if (pl.state === 'attesa') return { v: S.votoAttesa, fv: S.votoAttesa, stimato: true };
    return null;
  }
  const modulo = (roles) => {
    const c = { D: 0, C: 0, A: 0 };
    roles.forEach((r) => { if (c[r] != null) c[r]++; });
    return `${c.D}-${c.C}-${c.A}`;
  };
  // -> {val, media, usati:[{name, v, stimato}], motivo}
  function modDifesa(field) {
    const gk = field.find((x) => x.role === 'P');
    const difs = field.filter((x) => x.role === 'D' && x.v != null).sort((a, b) => b.v - a.v);
    if (difs.length < 4) return { val: null, motivo: `solo ${difs.length} difensori a voto` };
    let usati;
    if (S.modIncludiPortiere) {
      if (!gk || gk.v == null) return { val: null, motivo: 'portiere senza voto' };
      usati = [gk, ...difs.slice(0, 3)];
    } else usati = difs.slice(0, 4);
    const media = usati.reduce((a, x) => a + x.v, 0) / usati.length;
    let idx = 0;
    while (idx < MOD_FASCE.length && media >= MOD_FASCE[idx] - 1e-9) idx++;
    return { val: S.modTabella[idx] ?? 0, media, usati };
  }

  function calcolaSquadra(team, extra) {
    const tit = team.titolari.map(valuta);
    const pan = team.panchina.map(valuta);
    const sostituto = new Array(tit.length).fill(-1); // indice panchinaro che entra
    const entraPer = new Array(pan.length).fill(-1);  // indice titolare sostituito
    const roles = team.titolari.map((p) => p.role);
    const field = [];
    const maxC = S.cambiIllimitati ? 99 : S.maxCambi;
    let cambi = 0;
    for (let i = 0; i < tit.length; i++) {
      const pl = team.titolari[i];
      if (tit[i]) { field.push({ name: pl.name, role: roles[i], ...tit[i] }); continue; }
      if (cambi >= maxC) continue;
      const r = roles[i];
      let j = pan.findIndex((x, k) => entraPer[k] < 0 && x && team.panchina[k].role === r);
      if (j < 0 && S.cambioModulo && r !== 'P') {
        j = pan.findIndex((x, k) => {
          const r2 = team.panchina[k].role;
          if (entraPer[k] >= 0 || !x || r2 === 'P' || r2 === r) return false;
          const test = roles.slice(); test[i] = r2;
          return MODULI.has(modulo(test));
        });
        if (j >= 0) roles[i] = team.panchina[j].role;
      }
      if (j >= 0) {
        entraPer[j] = i; sostituto[i] = j; cambi++;
        field.push({ name: team.panchina[j].name, role: team.panchina[j].role, ...pan[j] });
      }
    }
    let tot = extra + field.reduce((a, x) => a + x.fv, 0);
    const mod = S.modDifesa ? modDifesa(field) : null;
    if (mod && mod.val != null) tot += mod.val;
    const stimati = field.filter((x) => x.stimato).length;
    return { tot, tit, pan, sostituto, entraPer, mod, extra, stimati, inCampo: field.length, modulo: modulo(roles) };
  }

  function goalsOf(pt) {
    const T = S.soglie.length ? S.soglie : [66];
    let g = 0;
    for (const t of T) if (pt >= t) g++;
    const last = T[T.length - 1];
    if (pt >= last && S.passo > 0) g += Math.floor((pt - last) / S.passo);
    return g;
  }
  // -> [golA, golB, nota]
  function risultato(a, b) {
    let ga = goalsOf(a), gb = goalsOf(b), nota = '';
    const diff = Math.abs(a - b);
    let pareggioScattato = false;
    if (S.limitaVittoria && Math.abs(ga - gb) === 1 && diff <= S.limitaVittoriaPt) {
      if (ga > gb) ga--; else gb--;
      nota = 'limita vittoria';
    } else if (S.limitaPareggio && ga === gb && diff >= S.limitaPareggioPt && (ga > 0 || S.limitaPareggioSottoSoglia)) {
      if (a > b) ga++; else gb++;
      pareggioScattato = true; nota = `limita pareggio (scarto ≥ ${S.limitaPareggioPt})`;
    }
    const s0 = S.soglie[0] ?? 66;
    if (S.autogol && !pareggioScattato && a < s0 && b < s0) {
      if (a <= S.autogolPt) { gb++; nota = 'autogol'; }
      if (b <= S.autogolPt) { ga++; nota = 'autogol'; }
    }
    return [ga, gb, nota];
  }

  function calcola(match) {
    const A = calcolaSquadra(match.casa, S.bonusCasa);
    const B = calcolaSquadra(match.ospite, 0);
    return { A, B, ris: risultato(A.tot, B.tot) };
  }

  // ====================== Lettura "Opzioni di Lega" ======================
  function scrapeSettings() {
    const out = {};
    const body = document.body.innerText.replace(/\s+/g, ' ');
    if (!/Opzioni di Lega/i.test(body)) return out;

    // Soglie gol
    if (/Soglie gol/i.test(body)) {
      const map = {};
      for (const m of body.matchAll(/(\d+)°\s*GOL\s*(\d+(?:[.,]\d+)?)\s*pt/gi)) map[+m[1]] = num(m[2]);
      const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
      if (keys.length && keys[0] === 1) out.soglie = keys.map((k) => map[k]);
      const p = body.match(/ogni\s*(\d+(?:[.,]\d+)?)\s*punti\s*si otterr/i);
      if (p) out.passo = num(p[1]);
    }

    // Switch: etichetta = testo dell'antenato più vicino
    const sw = new Map();
    const swList = [...document.querySelectorAll('nz-switch')];
    swList.forEach((e) => {
      let p = e, txt = '';
      for (let k = 0; k < 4 && p && !txt; k++) { p = p.parentElement; txt = (p?.innerText || '').trim(); }
      const on = !!e.querySelector('button')?.className.includes('checked');
      const lab = txt.replace(/\s+/g, ' ');
      if (lab) sw.set(e, { lab, on });
    });
    const findSw = (label) => [...sw.entries()].find(([, v]) => v.lab.startsWith(label));
    const ctrlOrder = [...document.querySelectorAll('nz-switch, input:not([type=radio])')];
    const valAfterSw = (el) => {
      const i = ctrlOrder.indexOf(el);
      const nx = ctrlOrder[i + 1];
      return nx && nx.tagName === 'INPUT' ? num(nx.value) : null;
    };
    const swBool = (label, key, valKey) => {
      const f = findSw(label);
      if (!f) return;
      out[key] = f[1].on;
      if (valKey && f[1].on) { const v = valAfterSw(f[0]); if (v != null) out[valKey] = v; }
    };
    swBool('Limita vittoria', 'limitaVittoria', 'limitaVittoriaPt');
    swBool('Limita pareggio', 'limitaPareggio', 'limitaPareggioPt');
    swBool('Attiva anche sotto soglia', 'limitaPareggioSottoSoglia');
    swBool('Autogol', 'autogol', 'autogolPt');
    swBool('Ammonito senza voto', 'ammonitoSV');
    swBool('Modificatore difesa', 'modDifesa');
    swBool('Includi portiere', 'modIncludiPortiere');
    swBool('Numero sostituzioni', 'cambiIllimitati');
    if (out.cambiIllimitati === undefined) swBool('Illimitate', 'cambiIllimitati');

    // Input con etichetta testuale vicina (tabella bonus/malus)
    const inputLabel = (e) => {
      let p = e, lab = '';
      for (let k = 0; k < 6 && p; k++) {
        p = p.parentElement;
        const tx = (p?.innerText || '').trim();
        if (tx && tx.length < 120) lab = tx.replace(/\s+/g, ' ');
        else if (tx.length >= 120) break;
      }
      return lab;
    };
    if (/Tabella BONUS\/MALUS/i.test(body)) {
      const inputs = [...document.querySelectorAll('input:not([type=radio])')];
      const byLab = (l) => { const e = inputs.find((i) => inputLabel(i) === l); return e ? num(e.value) : null; };
      const pi = byLab('Porta inviolata');
      if (pi != null) { out.portaInviolataPt = pi; out.portaInviolata = pi !== 0; }
      const g = byLab('Gol segnato'); if (g != null) out.bonusGol = g;
      const a = byLab('Assist'); if (a != null) out.bonusAssist = a;
      const gs = byLab('Gol subito'); if (gs != null) out.malusGolSubito = gs;
      const am = byLab('Ammonizione'); if (am != null) out.malusAmm = am;
    }

    // Tabella modificatore difesa
    const tab = [...document.querySelectorAll('div,table,section')].find((e) => /^MEDIA VOTO/i.test((e.innerText || '').trim()) && e.querySelectorAll('input').length >= 10);
    if (tab) {
      const v = [...tab.querySelectorAll('input')].slice(0, 10).map((i) => num(i.value));
      if (v.every((x) => x != null)) out.modTabella = v;
    }

    // Numero e tipo sostituzioni
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.trim();
      if (t === 'Numero sostituzioni') {
        const inp = [...document.querySelectorAll('input:not([type=radio])')].find((i) => n.parentElement.compareDocumentPosition(i) & Node.DOCUMENT_POSITION_FOLLOWING);
        const v = inp ? num(inp.value) : null;
        if (v != null) out.maxCambi = v;
      }
    }
    if (/Tipo di sostituzioni/i.test(body)) {
      out.cambioModulo = /cambio modulo/i.test(body.slice(body.search(/Tipo di sostituzioni/i), body.search(/Tipo di sostituzioni/i) + 300));
    }
    return out;
  }

  // ====================== Pannello UI ======================
  const host = document.createElement('div');
  host.id = 'fanta-live-predictor';
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host{all:initial}
    .box{font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;background:#fff;border-radius:14px;
      box-shadow:0 10px 30px rgba(15,23,42,.25);width:370px;max-width:calc(100vw - 32px);overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#1E74F5,#4A0BD1);color:#fff;cursor:pointer;user-select:none}
    .hd b{flex:1;font-size:13px}
    .hd button{all:unset;cursor:pointer;opacity:.85;font-size:15px;padding:0 4px}
    .hd button:hover{opacity:1}
    .bd{padding:12px}
    .min .bd,.min .cfg,.min .chips{display:none}
    .chips{display:flex;flex-wrap:wrap;gap:6px;padding:10px 12px 0}
    .chip{all:unset;cursor:pointer;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;border:1px solid #cbd5e1;color:#64748b}
    .chip.on{background:#1E74F5;border-color:#1E74F5;color:#fff}
    .teams{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;text-align:center;gap:6px}
    .tn{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .gl{font-size:30px;font-weight:700;letter-spacing:1px}
    .pt{font-size:12px;color:#475569}
    .rg{font-size:11px;color:#94a3b8}
    .md{font-size:11px;color:#1E74F5}
    .nota{margin-top:8px;text-align:center;font-size:11px;font-weight:600;color:#7c3aed}
    .est{color:#d97706;font-weight:600}
    .hint{margin-top:10px;font-size:11.5px;background:#fef3c7;color:#92400e;border-radius:8px;padding:8px 10px}
    .st{font-size:11px;color:#64748b;margin-top:10px}
    .cfg{display:none;padding:10px 12px;border-top:1px solid #e2e8f0;background:#f8fafc;max-height:55vh;overflow:auto}
    .open .cfg{display:block}
    .cfg h5{margin:10px 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
    .cfg h5:first-child{margin-top:0}
    .cfg label{display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0;font-size:12px}
    .cfg input[type=number]{width:64px}
    .cfg input[type=text]{width:150px}
    .cfg input{padding:3px 5px;border:1px solid #cbd5e1;border-radius:5px;font:inherit}
    .cfg input[type=checkbox]{width:auto}
    .cfg .row{display:flex;gap:8px;margin-top:10px}
    .cfg button{all:unset;cursor:pointer;background:#1E74F5;color:#fff;border-radius:6px;padding:4px 10px;font-size:12px}
    .cfg button.sec{background:#e2e8f0;color:#0f172a}
    .muted{color:#64748b;font-size:12px}
    .ok{color:#15803d;font-size:12px}
    .tabs{display:flex;gap:4px;margin:-2px 0 10px;background:#f1f5f9;border-radius:8px;padding:3px}
    .tabs button{all:unset;cursor:pointer;flex:1;min-width:0;text-align:center;font-size:11px;font-weight:600;padding:4px 6px;border-radius:6px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .tabs button.on{background:#fff;color:#1E74F5;box-shadow:0 1px 2px rgba(0,0,0,.08)}
    .det{max-height:50vh;overflow:auto;margin:0 -4px;padding:0 4px}
    .det table{width:100%;border-collapse:collapse;font-size:12px}
    .det td{padding:4px 3px;border-bottom:1px solid #f1f5f9;vertical-align:top}
    .det .nm{font-weight:600;white-space:nowrap;max-width:95px;overflow:hidden;text-overflow:ellipsis}
    .det .in{color:#334155}
    .det .xp{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap}
    .det .sub{font-size:10.5px;color:#64748b;margin-top:1px}
    .det .sep{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;padding-top:10px}
    .det .out{color:#dc2626;font-weight:600}
    .det .tag{font-size:10px;background:#dcfce7;color:#15803d;border-radius:4px;padding:0 4px}
    .det tr.tot td{background:#f8fafc}
    .det tr.grand td{border-top:2px solid #cbd5e1;font-size:13px}
    .ro{display:inline-block;width:16px;height:16px;line-height:16px;text-align:center;border-radius:4px;font-size:10px;font-weight:700;color:#fff}
    .ro-P{background:#f59e0b}.ro-D{background:#16a34a}.ro-C{background:#2563eb}.ro-A{background:#dc2626}
  </style>
  <div class="box">
    <div class="hd"><b class="ttl">⚽ Proiezione live</b><button class="rf" title="Ricalcola">↻</button><button class="gear" title="Regole della lega">⚙</button><button class="mn" title="Riduci">–</button></div>
    <div class="chips">
      <button class="chip" data-t="modDifesa">Mod. difesa</button>
      <button class="chip" data-t="portaInviolata">Porta inviolata</button>
      <button class="chip" data-t="limitaPareggio">Limita pareggio</button>
      <button class="chip" data-t="cambioModulo">Cambio modulo</button>
    </div>
    <div class="bd"><div class="muted">In attesa del match…</div></div>
    <div class="cfg">
      <h5>Fasce gol</h5>
      <label>Soglie (pt) <input data-k="soglie" type="text" placeholder="66,72,78"></label>
      <label>Poi un gol ogni <input data-k="passo" type="number" step="0.5"></label>
      <label><span><input data-k="limitaPareggio" type="checkbox"> Limita pareggio, scarto ≥</span><input data-k="limitaPareggioPt" type="number" step="0.5"></label>
      <label><span><input data-k="limitaPareggioSottoSoglia" type="checkbox"> …anche sotto il 1° gol</span></label>
      <label><span><input data-k="limitaVittoria" type="checkbox"> Limita vittoria, scarto ≤</span><input data-k="limitaVittoriaPt" type="number" step="0.5"></label>
      <label><span><input data-k="autogol" type="checkbox"> Autogol se totale ≤</span><input data-k="autogolPt" type="number" step="0.5"></label>
      <h5>Modificatore difesa</h5>
      <label><span><input data-k="modDifesa" type="checkbox"> Attivo (min. 4 difensori)</span></label>
      <label><span><input data-k="modIncludiPortiere" type="checkbox"> Includi portiere (P + 3 migliori D)</span></label>
      <label>Bonus per fascia media <input data-k="modTabella" type="text" title="<5, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5, 6.75, ≥7"></label>
      <div class="muted" style="font-size:10px">10 valori per media: &lt;5 · 5 · 5.25 · 5.5 · 5.75 · 6 · 6.25 · 6.5 · 6.75 · ≥7</div>
      <h5>Bonus / malus</h5>
      <label><span><input data-k="portaInviolata" type="checkbox"> Porta inviolata</span><input data-k="portaInviolataPt" type="number" step="0.5"></label>
      <label>Gol segnato <input data-k="bonusGol" type="number" step="0.5"></label>
      <label>Assist <input data-k="bonusAssist" type="number" step="0.5"></label>
      <label>Gol subito <input data-k="malusGolSubito" type="number" step="0.5"></label>
      <label>Ammonizione <input data-k="malusAmm" type="number" step="0.5"></label>
      <label><span><input data-k="ammonitoSV" type="checkbox"> Ammonito senza voto = 5.5</span></label>
      <h5>Sostituzioni</h5>
      <label>Numero massimo <input data-k="maxCambi" type="number" min="0" max="11"></label>
      <label><span><input data-k="cambiIllimitati" type="checkbox"> Illimitate</span></label>
      <label><span><input data-k="cambioModulo" type="checkbox"> Cambio modulo se manca il pari ruolo</span></label>
      <h5>Altro</h5>
      <label>Bonus casa (squadra a sx) <input data-k="bonusCasa" type="number" step="0.5"></label>
      <label>Voto a chi deve ancora giocare <input data-k="votoAttesa" type="number" step="0.5"></label>
      <div class="muted src"></div>
      <div class="row"><button class="save">Salva per questa lega</button><button class="sec reset">Ripristina</button></div>
      <h5>Backup (tutte le leghe)</h5>
      <div class="row"><button class="sec exp">Esporta backup</button><button class="sec imp">Importa backup</button><input class="impf" type="file" accept=".json,application/json" style="display:none"></div>
      <div class="muted bkmsg" style="font-size:11px;margin-top:4px"></div>
    </div>
  </div>`;
  const $ = (s) => root.querySelector(s);
  const box = $('.box');
  const body = $('.bd');

  $('.mn').addEventListener('click', (e) => { e.stopPropagation(); box.classList.toggle('min'); });
  $('.hd').addEventListener('click', () => box.classList.remove('min'));
  $('.gear').addEventListener('click', (e) => { e.stopPropagation(); fillCfg(); box.classList.toggle('open'); });
  $('.rf').addEventListener('click', (e) => { e.stopPropagation(); lastSig = ''; tick(); });
  root.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    S[c.dataset.t] = !S[c.dataset.t]; saveLeague(); syncChips(); fillCfg(); lastSig = ''; tick();
  }));
  $('.save').addEventListener('click', () => {
    root.querySelectorAll('.cfg input[data-k]').forEach((i) => {
      const k = i.dataset.k;
      if (i.type === 'checkbox') S[k] = i.checked;
      else if (k === 'soglie' || k === 'modTabella') {
        const arr = i.value.split(/[;,\s]+/).map(num).filter((x) => x != null);
        if (arr.length) S[k] = k === 'soglie' ? arr.sort((a, b) => a - b) : arr;
      } else { const v = num(i.value); if (v != null) S[k] = v; }
    });
    S.fonte = 'Modificate a mano';
    saveLeague(); syncChips(); box.classList.remove('open'); lastSig = ''; tick();
  });
  $('.reset').addEventListener('click', () => {
    if (hasStorage) chrome.storage.sync.remove(storeKey(league()));
    S = { ...DEFAULTS, ...(PRESETS[league()] || {}) };
    fillCfg(); syncChips(); lastSig = ''; tick();
  });

  // Backup / ripristino di tutte le regole salvate
  const bkmsg = (t) => { $('.bkmsg').textContent = t; };
  $('.exp').addEventListener('click', () => {
    const done = (all) => {
      const data = {};
      Object.keys(all || {}).filter((k) => k.startsWith('flp_')).forEach((k) => { data[k] = all[k]; });
      const blob = new Blob([JSON.stringify({ app: 'fantalega-live-predictor', v: 1, data }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'fantalega-live-backup.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      bkmsg(`Esportate ${Object.keys(data).length} leghe.`);
    };
    if (hasStorage) chrome.storage.sync.get(null, done); else done({ [storeKey(league())]: S });
  });
  $('.imp').addEventListener('click', () => $('.impf').click());
  $('.impf').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const data = {};
      Object.entries((j && j.data) || {}).forEach(([k, v]) => { if (k.startsWith('flp_') && v && typeof v === 'object') data[k] = v; });
      if (!Object.keys(data).length) throw new Error('nessuna lega nel file');
      if (hasStorage) chrome.storage.sync.set(data, () => { loadedFor = null; lastSig = ''; tick(); setTimeout(fillCfg, 300); });
      bkmsg(`Importate ${Object.keys(data).length} leghe.`);
    } catch (err) { bkmsg('File non valido: ' + err.message); }
  });

  function fillCfg() {
    root.querySelectorAll('.cfg input[data-k]').forEach((i) => {
      const v = S[i.dataset.k];
      if (i.type === 'checkbox') i.checked = !!v;
      else i.value = Array.isArray(v) ? v.join(', ') : v;
    });
    $('.src').textContent = `Lega: ${league()} · fonte regole: ${S.fonte}`;
  }
  function syncChips() { root.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', !!S[c.dataset.t])); }

  const f1 = (x) => (Math.round(x * 2) / 2).toFixed(1).replace('.0', '');
  const pc = (x) => Math.round(x * 100) + '%';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sgn = (x) => (x > 0 ? '+' : '') + String(Math.round(x * 10) / 10).replace('.', ',');

  let view = 'sum', lastRender = null;
  const vv = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
  function render(match, r) {
    lastRender = [match, r];
    const tabs = `<div class="tabs">
      <button data-v="sum" class="${view === 'sum' ? 'on' : ''}">Proiezione</button>
      <button data-v="A" class="${view === 'A' ? 'on' : ''}" title="${esc(match.casa.nome)}">${esc(match.casa.nome)}</button>
      <button data-v="B" class="${view === 'B' ? 'on' : ''}" title="${esc(match.ospite.nome)}">${esc(match.ospite.nome)}</button></div>`;
    if (view === 'A') body.innerHTML = tabs + detail(match.casa, r.A);
    else if (view === 'B') body.innerHTML = tabs + detail(match.ospite, r.B);
    else body.innerHTML = tabs + renderSum(match, r);
    body.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; render(...lastRender); }));
  }

  function detail(team, c) {
    const role = (r) => `<span class="ro ro-${r}">${r}</span>`;
    const val = (x) => (x.stimato ? `<span class="est">${vv(x.fv)}</span>` : vv(x.fv));
    const rows = team.titolari.map((pl, i) => {
      const x = c.tit[i];
      let info, pts = '';
      if (pl.state === 'voto') {
        info = `${pl.voto != null ? vv(pl.voto) : 's.v.'} → ${vv(x.fv)}${x.fv !== pl.fv ? ' <span class="tag">+' + vv(S.portaInviolataPt) + ' P.I.</span>' : ''}`;
        pts = vv(x.fv);
      } else if (pl.state === 'attesa') {
        info = `<span class="est">deve giocare → ${vv(S.votoAttesa)}</span>`; pts = val(x);
      } else if (pl.state === 'amm' && S.ammonitoSV) {
        info = 's.v. ammonito → 5,5'; pts = '5,5';
      } else {
        info = `<span class="out">${pl.state === 'out' ? 'non gioca' : 's.v.'}</span>`;
        const j = c.sostituto[i];
        info += j >= 0
          ? `<div class="sub">↳ entra ${esc(team.panchina[j].name)} (${team.panchina[j].role})</div>`
          : `<div class="sub">↳ nessun cambio disponibile → 0</div>`;
        pts = '–';
      }
      return `<tr><td>${role(pl.role)}</td><td class="nm">${esc(pl.name)}</td><td class="in">${info}</td><td class="xp">${pts}</td></tr>`;
    }).join('');
    const bench = team.panchina.map((pl, j) => {
      const i = c.entraPer[j];
      if (i < 0) return '';
      const x = c.pan[j];
      const base = pl.state === 'voto' ? `${pl.voto != null ? vv(pl.voto) : 's.v.'} → ${vv(x.fv)}` : pl.state === 'amm' ? 's.v. ammonito → 5,5' : `<span class="est">deve giocare → ${vv(S.votoAttesa)}</span>`;
      return `<tr><td>${role(pl.role)}</td><td class="nm">${esc(pl.name)}</td><td class="in">${base}<div class="sub">al posto di ${esc(team.titolari[i].name)}</div></td><td class="xp">${val(x)}</td></tr>`;
    }).join('');
    let modRow = '';
    if (S.modDifesa && c.mod) {
      const m = c.mod;
      const info = m.val == null
        ? `non si applica: ${esc(m.motivo)}`
        : `media ${m.usati.map((u) => `${esc(u.name)} ${u.stimato ? '<span class="est">' + vv(u.v) + '</span>' : vv(u.v)}`).join(' + ')}<div class="sub">= ${vv(m.media)} → ${sgn(m.val)}</div>`;
      modRow = `<tr class="tot"><td></td><td class="nm">Mod. difesa</td><td class="in">${info}</td><td class="xp">${m.val == null ? '0' : sgn(m.val)}</td></tr>`;
    }
    return `<div class="det"><table>
      ${rows}
      ${bench ? `<tr><td colspan="4" class="sep">Cambi dalla panchina</td></tr>${bench}` : ''}
      ${modRow}
      ${c.extra ? `<tr class="tot"><td></td><td class="nm">Bonus casa</td><td></td><td class="xp">${sgn(c.extra)}</td></tr>` : ''}
      <tr class="grand"><td></td><td class="nm">Totale</td><td class="in">${c.inCampo}/11 in campo · ${c.modulo}</td><td class="xp">${vv(c.tot)}</td></tr>
    </table>
    <div class="st"><span class="est">In arancione</span> i voti stimati (${vv(S.votoAttesa)} a chi deve ancora giocare). Parziale sito: ${team.parziale != null ? vv(team.parziale) : '–'}.</div></div>`;
  }

  function renderSum(match, r) {
    const [gA, gB, nota] = r.ris;
    const side = (team, c) => {
      const mod = S.modDifesa && c.mod ? `<div class="md">Mod. dif. ${c.mod.val == null ? 'no' : sgn(c.mod.val)}</div>` : '';
      return `<div><div class="tn" title="${esc(team.nome)}">${esc(team.nome)}</div><div class="pt">${vv(c.tot)} pt</div>
        <div class="rg">${c.stimati} voti stimati · ${c.inCampo}/11</div>${mod}</div>`;
    };
    return `
      <div class="teams">${side(match.casa, r.A)}<div class="gl">${gA} - ${gB}</div>${side(match.ospite, r.B)}</div>
      ${nota ? `<div class="nota">Applicato: ${esc(nota)}</div>` : ''}
      <div class="st">Chi deve ancora giocare prende ${vv(S.votoAttesa)}; out e s.v. sostituiti dalla panchina.<br>
      Parziale sito: ${match.casa.parziale != null ? vv(match.casa.parziale) : '–'} - ${match.ospite.parziale != null ? vv(match.ospite.parziale) : '–'} · fasce ${S.soglie.join('/')} poi +${S.passo}<br>
      Regole: ${esc(S.fonte)}</div>
      ${S.fonte === DEFAULTS.fonte ? `<div class="hint">Stai usando regole standard. Apri <b>Menu → Opzioni di Lega</b> e scorri le sezioni Sostituzioni, Calcolo e Modificatori: le regole della tua lega verranno lette e salvate in automatico.</div>` : ''}`;
  }

  function showSettingsSaved(found) {
    const names = {
      soglie: 'fasce gol', limitaPareggio: 'limita pareggio', limitaVittoria: 'limita vittoria', autogol: 'autogol',
      modDifesa: 'modificatore difesa', modTabella: 'tabella modificatore', portaInviolata: 'porta inviolata',
      maxCambi: 'n° sostituzioni', cambioModulo: 'tipo sostituzioni', ammonitoSV: 'ammonito s.v.', bonusGol: 'bonus/malus'
    };
    const list = Object.keys(found).filter((k) => names[k]).map((k) => names[k]);
    $('.chips').style.display = 'none';
    $('.ttl').textContent = '⚽ Regole lega';
    body.innerHTML = list.length
      ? `<div class="ok">✓ Salvate per <b>${esc(league())}</b>: ${esc(list.join(', '))}.</div><div class="muted" style="margin-top:6px">Apri le altre sezioni (Sostituzioni, Calcolo, Modificatori) per leggerle tutte.</div>`
      : `<div class="muted">Apri le sezioni Sostituzioni, Calcolo e Modificatori: le regole vengono lette e salvate da sole.</div>`;
  }

  // ====================== Ciclo di aggiornamento ======================
  let lastSig = '', lastScrape = '';
  function tick() {
    if (loadedFor !== league()) { loadLeague(() => { syncChips(); lastSig = ''; tick(); }); return; }
    const path = location.pathname;

    // Pagina Opzioni di Lega: leggi e salva
    if (/\/settings/.test(path) || /Opzioni di Lega/.test(document.title)) {
      const found = scrapeSettings();
      const sig = JSON.stringify(found);
      if (Object.keys(found).length) {
        if (!host.isConnected) document.body.appendChild(host);
        if (sig !== lastScrape) {
          lastScrape = sig;
          const d = new Date().toLocaleDateString('it-IT');
          S = { ...S, ...found, fonte: `Opzioni di Lega (${d})` };
          saveLeague();
          window.__flpFound = { ...(window.__flpFound || {}), ...found };
          showSettingsSaved(window.__flpFound);
        }
      }
      return;
    }

    const match = /\/live/.test(path) ? parseMatch() : null;
    if (!match) { host.remove(); lastSig = ''; return; }
    if (!host.isConnected) { document.body.appendChild(host); }
    $('.chips').style.display = ''; $('.ttl').textContent = '⚽ Proiezione live';
    const sig = JSON.stringify(match);
    if (sig === lastSig) return;
    lastSig = sig;
    try { render(match, calcola(match)); }
    catch (err) { body.innerHTML = `<div class="muted">Errore nel calcolo: ${esc(err.message)}</div>`; }
  }

  let timer = null;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(tick, 600); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'value'] });
  document.addEventListener('input', schedule, true);
  setInterval(tick, 15000);
  loadLeague(() => { syncChips(); tick(); });
})();
