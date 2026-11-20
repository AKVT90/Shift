(function () {
  'use strict';
  const C = window.Core;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = C.pad;
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const TYPE_ORDER = ['work', 'off_mand', 'off_comp', 'holiday_closed', 'holiday', 'off', 'none'];

  /* ---------- Estado e persistência ---------- */
  const VER = self.SHIFT_VERSION || 'dev';
  const KEY = 'shift.v1', SKEY = 'shift.secret', CKEY = 'shift.corrupt.', SCHEMA = 2;
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignorar */ } }
  };
  // A palavra-passe do Worker vive à parte: nunca vai para o código, para backups nem para cópias automáticas.
  const getSecret = () => store.get(SKEY) || '';
  const setSecret = v => (v ? store.set(SKEY, v) : store.del(SKEY));
  function defaults() {
    return {
      schema: SCHEMA, months: {}, imports: [],
      settings: {
        start: '11:00', end: '15:00', autoAlarms: true,
        alarms: { forStart: '11:00', first: '07:20', last: '08:00', step: 5 },
        refs: JSON.parse(JSON.stringify(C.DEFAULT_REFS)),
        shortcutName: 'SHIFT Alarms',
        worker: { url: '', token: '' }
      },
      icsSeq: 0, lastBackup: null, hintDismissed: false, sync: { pending: false, last: null }
    };
  }
  function normalize(o) {
    if (!o || typeof o !== 'object' || !o.months || typeof o.months !== 'object') throw new Error('estrutura inválida');
    const st = o.settings || {}, out = defaults(), ds = out.settings;
    if (st.worker && st.worker.secret) { if (!getSecret()) setSecret(st.worker.secret); }   // migração: v1 guardava o segredo no estado
    Object.assign(out, o);
    out.settings = Object.assign(ds, st);
    out.settings.alarms = Object.assign({}, defaults().settings.alarms, st.alarms || {});
    out.settings.refs = Object.assign({}, defaults().settings.refs, st.refs || {});
    out.settings.worker = { url: (st.worker && st.worker.url) || '', token: (st.worker && st.worker.token) || '' };
    out.sync = Object.assign({ pending: false, last: null }, o.sync || {});
    if (!Array.isArray(out.imports)) out.imports = [];
    if (out.settings.shortcutName === 'SHIFT Alarmes') out.settings.shortcutName = 'SHIFT Alarms';
    out.schema = SCHEMA; delete out.v;
    return out;
  }
  let startupIssue = null;
  function load() {
    const raw = store.get(KEY);
    if (raw) {
      try { const o = normalize(JSON.parse(raw)); return o; }
      catch (e) { store.set(CKEY + Date.now(), raw); startupIssue = 'corrupt'; }   // preserva o original ilegível
    } else startupIssue = 'empty';
    return defaults();
  }
  let S = load();
  if (!startupIssue) store.set(KEY, JSON.stringify(S));   // grava já a versão migrada (sem segredo)
  let lastSaveOk = true;
  function save() {
    S.savedAt = new Date().toISOString();
    if (store.set(KEY, JSON.stringify(S))) lastSaveOk = true;
    else { if (lastSaveOk) toast('⚠ Não consegui guardar neste iPhone (armazenamento cheio ou bloqueado). Guarda já uma cópia de segurança.'); lastSaveOk = false; }
    scheduleMirror();
  }

  /* Espelho em IndexedDB + cópias automáticas (7 diárias + 5 «antes de operações destrutivas») */
  const idb = {
    db: null,
    open() {
      return this.db || (this.db = new Promise(res => {
        try {
          const r = indexedDB.open('shift', 1);
          r.onupgradeneeded = () => r.result.createObjectStore('kv');
          r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
        } catch (e) { res(null); }
      }));
    },
    async tx(mode, fn) {
      const db = await this.open(); if (!db) return null;
      return new Promise(res => {
        try {
          const t = db.transaction('kv', mode), q = fn(t.objectStore('kv'));
          t.oncomplete = () => res(q && 'result' in q ? q.result : true); t.onerror = t.onabort = () => res(null);
        } catch (e) { res(null); }
      });
    },
    get(k) { return this.tx('readonly', st => st.get(k)); },
    put(k, v) { return this.tx('readwrite', st => st.put(v, k)); },
    del(k) { return this.tx('readwrite', st => st.delete(k)); },
    keys() { return this.tx('readonly', st => st.getAllKeys()); }
  };
  const snapRec = () => ({ at: new Date().toISOString(), json: JSON.stringify(S), months: Object.keys(S.months).length });
  async function prune(prefix, keep) {
    const ks = ((await idb.keys()) || []).filter(k => String(k).startsWith(prefix)).sort();
    for (const k of ks.slice(0, Math.max(0, ks.length - keep))) await idb.del(k);
  }
  let mirrorT;
  function scheduleMirror() { clearTimeout(mirrorT); mirrorT = setTimeout(mirror, 700); }
  async function mirror() {
    const rec = snapRec(), old = await idb.get('state');
    if (rec.months || !(old && old.months)) await idb.put('state', rec);   // nunca substitui o espelho com dados por um estado vazio
    if (rec.months) { await idb.put('snap-' + todayKey(), rec); await prune('snap-', 7); }
  }
  async function snapshotNow(tag) {
    if (!Object.keys(S.months).length) return;
    await idb.put('pre-' + Date.now() + '-' + tag, snapRec()); await prune('pre-', 5);
  }
  function validateBackup(o) {
    if (!o || typeof o !== 'object' || !o.months || typeof o.months !== 'object') throw new Error('não é uma cópia de segurança da SHIFT');
    for (const [k, m] of Object.entries(o.months)) {
      if (!/^\d{4}-\d{2}$/.test(k) || !m || typeof m !== 'object') throw new Error('mês inválido: ' + k);
      for (const [d, x] of Object.entries(m)) if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !x || !C.TYPES[x.type]) throw new Error('dia inválido: ' + d);
    }
  }
  async function restoreFromJson(json, from) {
    let o;
    try { o = typeof json === 'string' ? JSON.parse(json) : json; validateBackup(o); }
    catch (e) { toast('Ficheiro inválido: ' + e.message); return false; }
    await snapshotNow('antes-de-restaurar');
    const w0 = S.settings.worker, n = normalize(o);
    if (!n.settings.worker.url) n.settings.worker = w0;
    S = n; save(); render(); queueSync();
    toast(`Dados restaurados${from ? ' (' + from + ')' : ''}.`);
    return true;
  }
  async function recoverIfNeeded() {
    if (Object.keys(S.months).length) return;
    let cand = await idb.get('state');
    if (!cand || !cand.months) {
      const ks = ((await idb.keys()) || []).filter(k => /^(snap|pre)-/.test(k)).sort().reverse();
      cand = null;
      for (const k of ks) { const r = await idb.get(k); if (r && r.months) { cand = r; break; } }
    }
    if (!cand) { if (startupIssue === 'corrupt') toast('Os dados guardados estavam ilegíveis; guardei uma cópia do original.'); return; }
    const when = new Date(cand.at).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (await confirmBox(`Encontrei uma cópia dos teus horários guardada neste iPhone (${when}, ${cand.months} mês/meses). Restaurar?`, 'Restaurar')) restoreFromJson(cand.json, 'cópia automática');
  }
  const standalone = () => navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  async function exportBackup() {
    const data = Object.assign({}, S, { exportedAt: new Date().toISOString(), app: 'SHIFT', appVersion: VER });
    const name = `shift-backup-${todayKey()}.json`;
    const file = new File([JSON.stringify(data, null, 1)], name, { type: 'application/json' });
    const mark = () => { S.lastBackup = new Date().toISOString(); save(); };
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); mark(); return true; } }
    catch (e) { if (e.name === 'AbortError') return false; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    mark(); return true;
  }
  const ym = (y, m) => `${y}-${pad(m)}`;
  const allDays = () => Object.assign({}, ...Object.keys(S.months).sort().map(k => S.months[k]));
  const dim = (y, m) => new Date(y, m, 0).getDate();
  const todayKey = () => { const t = new Date(); return C.dateKey(t.getFullYear(), t.getMonth() + 1, t.getDate()); };
  const fmtDate = k => new Date(k + 'T12:00:00').toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short' });
  function label(d) {
    if (!d) return '—';
    let s = C.TYPES[d.type] || d.type;
    if (d.type === 'work') s += ` ${d.start}–${d.end}`;
    if (d.swap) s += ' · troca';
    return s;
  }

  /* ---------- UI utilitários ---------- */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 3200);
  }
  function sheet(html, onMount) {
    const root = $('#sheetRoot');
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
    root.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    bg.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
    if (onMount) onMount(bg.firstElementChild, close);
    return close;
  }
  function confirmBox(msg, ok) {
    return new Promise(res => {
      sheet(`<h2>Confirmar</h2><p>${esc(msg)}</p><div class="stack"><button class="btn" id="cOk">${esc(ok || 'Confirmar')}</button><button class="btn sec" data-close>Cancelar</button></div>`,
        (el, close) => { el.querySelector('#cOk').onclick = () => { close(); res(true); }; el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => res(false))); });
    });
  }

  /* ---------- Navegação ---------- */
  let tab = 'horarios';
  let cur = { y: new Date().getFullYear(), m: new Date().getMonth() + 1 };
  document.querySelectorAll('#tabs button').forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(); }));
  $('#btnSettings').addEventListener('click', openSettings);
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    const v = $('#view');
    ({ horarios: viewHorarios, importar: viewImportar, alarmes: viewAlarmes, historico: viewHistorico })[tab](v);
    window.scrollTo(0, 0);
  }

  /* ---------- Grelha mensal ---------- */
  function gridHTML(y, m, cellInfo) {
    const first = (new Date(y, m - 1, 1).getDay() + 6) % 7;
    let h = '<div class="grid">' + ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'].map(x => `<div class="dow">${x}</div>`).join('');
    for (let i = 0; i < first; i++) h += '<div class="cell empty"></div>';
    for (let d = 1; d <= dim(y, m); d++) {
      const k = C.dateKey(y, m, d), info = cellInfo(k, d) || {};
      const cls = ['cell', info.type ? 't-' + info.type : '', info.swap ? 'swap' : '', k === todayKey() ? 'today' : '', info.doubt ? 'doubt' : '', info.manual ? 'manual' : ''].join(' ');
      h += `<button class="${cls}" data-k="${k}" data-d="${d}"><span>${d}</span><i class="dot"></i></button>`;
    }
    return h + '</div>';
  }
  const LEGEND = `<div class="legend"><span><i style="background:var(--work)"></i>Trabalho</span><span><i style="background:var(--off_mand)"></i>Folga obrig.</span><span><i style="background:var(--off_comp)"></i>Folga compl.</span><span><i style="background:var(--holiday_closed)"></i>Feriado fechado</span><span><i class="sw"></i>Troca</span></div>`;

  /* ---------- Horários ---------- */
  function viewHorarios(v) {
    const days = S.months[ym(cur.y, cur.m)] || {};
    const keys = Object.keys(S.months).sort();
    const next = Object.values(allDays()).filter(d => d.type === 'work' && d.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
    v.innerHTML = `${noticesHTML()}
      <div class="monthbar"><button id="pm" aria-label="Mês anterior">‹</button><b>${MONTHS[cur.m - 1]} ${cur.y}</b><button id="nm" aria-label="Mês seguinte">›</button></div>
      <div class="card">${gridHTML(cur.y, cur.m, k => days[k])}${LEGEND}</div>
      ${keys.length ? `<div class="chips">${keys.map(k => `<button class="chip ${k === ym(cur.y, cur.m) ? 'on' : ''}" data-ym="${k}">${MONTHS[+k.slice(5) - 1].slice(0, 3)} ${k.slice(2, 4)}</button>`).join('')}</div>` : ''}
      <div id="syncBox" class="syncbox"></div>
      <h3>Próximos turnos</h3>
      ${next.length ? `<div class="list">${next.map(d => `<button class="item" data-k="${d.date}"><b>${fmtDate(d.date)}</b><span class="sp"></span><span>${d.start}–${d.end}</span>${d.swap ? '<span class="pill">troca</span>' : ''}</button>`).join('')}</div>`
        : `<div class="card muted">${keys.length ? 'Sem turnos futuros guardados.' : 'Ainda não importaste nenhum horário. Vai a Importar e escolhe um screenshot.'}</div>`}`;
    $('#pm').onclick = () => { cur.m--; if (cur.m < 1) { cur.m = 12; cur.y--; } render(); };
    $('#nm').onclick = () => { cur.m++; if (cur.m > 12) { cur.m = 1; cur.y++; } render(); };
    v.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { const [y, m] = b.dataset.ym.split('-').map(Number); cur = { y, m }; render(); });
    v.querySelectorAll('.cell[data-k], .item[data-k]').forEach(b => b.onclick = () => openDay(b.dataset.k));
    const nh = $('#nHintOk'); if (nh) nh.onclick = () => { S.hintDismissed = true; save(); render(); };
    const nb = $('#nBkGo'); if (nb) nb.onclick = async () => { if (await exportBackup()) render(); };
    refreshSyncBox();
  }
  function noticesHTML() {
    let h = '';
    if (isIOS && !standalone() && !S.hintDismissed) h += `<div class="warn">📲 Estás no Safari. Para usar como app: <b>Partilhar → Adicionar ao Ecrã Principal</b>. A app instalada tem dados <b>separados</b> dos do Safari: antes de instalar, guarda uma cópia de segurança (Definições → Dados) e restaura-a na app instalada.<div style="margin-top:8px"><button class="btn small sec" id="nHintOk">Percebi</button></div></div>`;
    if (Object.keys(S.months).length) {
      const age = S.lastBackup ? (Date.now() - Date.parse(S.lastBackup)) / 864e5 : Infinity;
      if (age > 14) h += `<div class="warn">${isFinite(age) ? `Última cópia de segurança há ${Math.floor(age)} dias.` : 'Ainda não fizeste nenhuma cópia de segurança.'}<div style="margin-top:8px"><button class="btn small" id="nBkGo">Guardar cópia agora</button></div></div>`;
    }
    return h;
  }
  function syncBoxHTML() {
    if (!S.settings.worker.url) return '';
    if (S.sync.pending) return '<button class="btn sec small" id="syncRetry">⚠ Calendário Apple por publicar — tentar agora</button>';
    const t = S.sync.last ? new Date(S.sync.last).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
    return `<div class="muted" style="margin-top:10px">Calendário Apple: ${t ? '✓ publicado ' + t : 'ainda não publicado'}</div>`;
  }
  function refreshSyncBox() {
    const b = $('#syncBox'); if (!b) return;
    b.innerHTML = syncBoxHTML();
    const r = $('#syncRetry'); if (r) r.onclick = async () => { r.disabled = true; r.textContent = 'A publicar…'; await flushSync(true); refreshSyncBox(); };
  }

  /* ---------- Editor de dia ---------- */
  function openDay(k) {
    const [y, m] = k.split('-').map(Number), key = ym(y, m);
    const d = Object.assign({ date: k, type: 'none', notes: '' }, (S.months[key] || {})[k]);
    const typeOpts = TYPE_ORDER.map(t => `<option value="${t}" ${d.type === t ? 'selected' : ''}>${t === 'none' ? 'Sem informação (remover)' : C.TYPES[t]}</option>`).join('');
    sheet(`<button class="btn sec small close" data-close>Fechar</button><h2>${fmtDate(k)}</h2>
      ${d.swap ? `<div class="warn">Troca de escala${d.orig ? ` — originalmente: ${d.orig === 'work' ? 'trabalho' : 'folga'}` : ''}.</div>` : ''}
      <label class="f">Tipo de dia</label><select id="eT">${typeOpts}</select>
      <div id="eW" class="two"><div><label class="f">Entrada</label><input id="eS" type="time" value="${d.start || S.settings.start}"></div><div><label class="f">Saída</label><input id="eE" type="time" value="${d.end || S.settings.end}"></div></div>
      <div class="switch"><span>Troca relativamente à escala original</span><input id="eSw" type="checkbox" ${d.swap ? 'checked' : ''}></div>
      <div id="eO"><label class="f">Estado original</label><select id="eOr"><option value="">Desconhecido</option><option value="work" ${d.orig === 'work' ? 'selected' : ''}>Trabalho</option><option value="off" ${d.orig === 'off' ? 'selected' : ''}>Folga</option></select></div>
      <div id="eA"><label class="f">Despertadores personalizados (horas separadas por vírgula; vazio = regra padrão)</label><input id="eAl" placeholder="07:30, 07:40" value="${esc((d.alarmCustom || []).join(', '))}"></div>
      <label class="f">Observações</label><textarea id="eN" rows="2">${esc(d.notes || '')}</textarea>
      <div class="stack" style="margin-top:16px"><button class="btn" id="eSave">Guardar</button></div>`, (el, close) => {
      const sync = () => {
        const t = el.querySelector('#eT').value;
        el.querySelector('#eW').style.display = t === 'work' ? '' : 'none';
        el.querySelector('#eA').style.display = t === 'work' ? '' : 'none';
        el.querySelector('#eO').style.display = el.querySelector('#eSw').checked ? '' : 'none';
      };
      el.querySelector('#eT').onchange = sync; el.querySelector('#eSw').onchange = sync; sync();
      el.querySelector('#eSave').onclick = () => {
        const t = el.querySelector('#eT').value;
        S.months[key] = S.months[key] || {};
        if (t === 'none') { delete S.months[key][k]; if (!Object.keys(S.months[key]).length) delete S.months[key]; }
        else {
          const n = Object.assign({}, S.months[key][k] || {}, { date: k, type: t, manual: true, notes: el.querySelector('#eN').value.trim() });
          n.swap = el.querySelector('#eSw').checked;
          n.orig = n.swap ? el.querySelector('#eOr').value || null : null;
          if (t === 'work') {
            n.start = el.querySelector('#eS').value || S.settings.start; n.end = el.querySelector('#eE').value || S.settings.end;
            const al = el.querySelector('#eAl').value.split(/[,\s]+/).filter(x => /^\d{1,2}:\d{2}$/.test(x)).map(x => { const [h, mi] = x.split(':'); return pad(h) + ':' + mi; });
            if (al.length) n.alarmCustom = al; else delete n.alarmCustom;
          } else { delete n.start; delete n.end; delete n.alarmCustom; }
          S.months[key][k] = n;
        }
        save(); close(); render(); autoSync();
      };
    });
  }

  /* ---------- Importar ---------- */
  let draft = null;
  function viewImportar(v) {
    if (draft) return viewPreview(v);
    v.innerHTML = `<h2>Importar horário</h2>
      <div class="card stack">
        <p style="margin:0">Escolhe um ou vários screenshots do calendário do Continente. A análise corre no teu iPhone — as imagens não são enviadas para lado nenhum.</p>
        <input id="files" type="file" accept="image/*" multiple hidden>
        <button class="btn" id="pick">Escolher screenshots</button>
        <div id="status" class="muted"></div><div class="progress" id="pg" hidden><i></i></div>
      </div>
      <div class="card muted" style="margin-top:12px">Nada é guardado sem a tua confirmação. Na primeira análise é descarregado o motor de OCR (precisa de Internet); depois fica em cache do navegador.</div>`;
    $('#pick').onclick = () => $('#files').click();
    $('#files').onchange = e => runImport([...e.target.files]);
  }
  const abs = p => new URL(p, location.href).href;
  let tessP;
  function loadTess() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return tessP || (tessP = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'vendor/tesseract/tesseract.min.js';
      sc.onload = () => res(window.Tesseract);
      sc.onerror = () => { tessP = null; rej(new Error('Não consegui carregar o motor de OCR (pasta vendor/tesseract). Confirma que foi publicada no GitHub e que tens ligação na primeira vez.')); };
      document.head.appendChild(sc);
    }));
  }
  async function toCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('não consegui abrir a imagem (formato não suportado?). Usa um screenshot PNG ou JPEG.')); i.src = url; });
      const sc = Math.min(1, 1400 / im.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height);
      return { c, g };
    } finally { URL.revokeObjectURL(url); }
  }
  async function runImport(files) {
    files = files.filter(f => !f.type || f.type.startsWith('image/'));
    if (!files.length) return toast('Escolhe imagens (screenshots).');
    const st = $('#status'), pg = $('#pg');
    const setP = (p, t) => { pg.hidden = false; pg.firstElementChild.style.width = Math.round(p * 100) + '%'; st.textContent = t; };
    $('#pick').disabled = true;
    let worker;
    try {
      setP(0.02, 'A carregar o motor de OCR…');
      const T = await loadTess();
      worker = await T.createWorker('por', 1, {
        workerPath: abs('vendor/tesseract/worker.min.js'), corePath: abs('vendor/tesseract/core'), langPath: abs('vendor/tesseract/lang'),
        workerBlobURL: false, logger: m => { if (m.status && /loading/.test(m.status)) st.textContent = 'A preparar o OCR…'; }
      });
      const results = [], failed = [];
      for (let i = 0; i < files.length; i++) {
        const base = i / files.length, span = 1 / files.length, tag = `Imagem ${i + 1}/${files.length}`;
        try {
          setP(base + span * 0.1, `${tag}: a preparar…`);
          const { c, g } = await toCanvas(files[i]);
          const imgData = g.getImageData(0, 0, c.width, c.height);
          setP(base + span * 0.2, `${tag}: a ler texto…`);
          await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: T.PSM.AUTO });
          const r1 = (await worker.recognize(c)).data;
          const words = (r1.words || []).map(w => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
          // Números em círculos coloridos: lê versões a preto e branco da imagem com dois limiares e junta os resultados.
          let k = 0;
          for (const thr of [45, 70]) {
            setP(base + span * (0.4 + 0.25 * k++), `${tag}: a ler números…`);
            const pr = C.ocrPrep(imgData, thr), pc = document.createElement('canvas');
            pc.width = pr.width; pc.height = pr.height; pc.getContext('2d').putImageData(new ImageData(pr.data, pr.width, pr.height), 0, 0);
            await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: T.PSM.SPARSE_TEXT });
            const r = (await worker.recognize(pc)).data;
            (r.words || []).forEach(w => words.push({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
          }
          const res = C.analyse(imgData, words, r1.text, S.settings.refs, new Date());
          const th = document.createElement('canvas'); th.width = 360; th.height = Math.round(360 * c.height / c.width);
          th.getContext('2d').drawImage(c, 0, 0, th.width, th.height);
          results.push({ res, thumb: th.toDataURL('image/jpeg', 0.6), name: files[i].name });
        } catch (e) { console.error(e); failed.push(`${files[i].name || tag}: ${e.message || e}`); }
      }
      if (!results.length) throw new Error(failed.join('\n') || 'Nenhuma imagem analisada.');
      draft = buildDraft(results);
      failed.forEach(f => draft.warnings.push('Não importada — ' + f));
      render();
    } catch (e) {
      console.error(e); st.textContent = '';
      toast(e.message || 'Falhou a análise.'); $('#pick').disabled = false; pg.hidden = true;
    } finally { if (worker) worker.terminate().catch(() => {}); }
  }
  function buildDraft(results) {
    const groups = {};
    const warnings = [];
    results.forEach((r, i) => {
      const res = r.res;
      res.warnings.forEach(w => warnings.push(`Imagem ${i + 1}: ${w}`));
      if (!res.ok) return;
      const key = ym(res.year, res.month);
      const g = groups[key] = groups[key] || { y: res.year, m: res.month, days: {}, thumbs: [], notes: [] };
      g.thumbs.push(r.thumb);
      for (let d = 1; d <= 31; d++) {
        const x = res.days[d];
        if (!x || x.type === 'none') continue;
        const prev = g.days[d];
        if (!prev) g.days[d] = Object.assign({}, x);
        else if (prev.type !== x.type || prev.swap !== x.swap) {
          if (prev.doubt && !x.doubt) g.days[d] = Object.assign({}, x);
          else if (!prev.doubt && !x.doubt) { prev.doubt = true; g.notes.push(`Dia ${d}: imagens com leituras diferentes — confirma.`); }
        } else if (prev.doubt && !x.doubt) prev.doubt = false;
      }
    });
    return { groups: Object.values(groups), warnings };
  }
  function draftToIncoming(g) {
    const out = {}, n = dim(g.y, g.m);
    for (let d = 1; d <= n; d++) {
      const x = g.days[d]; if (!x || x.type === 'none') continue;
      out[C.dateKey(g.y, g.m, d)] = C.mkIncoming(x, S.settings);
    }
    return out;
  }
  function viewPreview(v) {
    if (!draft.groups.length) {
      v.innerHTML = `<h2>Não consegui ler o calendário</h2>${draft.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}<p class="muted">Experimenta um screenshot que mostre o mês completo, sem zoom nem cortes.</p><button class="btn" id="dc">Voltar</button>`;
      $('#dc').onclick = () => { draft = null; render(); }; return;
    }
    v.innerHTML = `<h2>Confirmar leitura</h2>${draft.warnings.map(w => `<div class="warn">${esc(w)}</div>`).join('')}
      <p class="muted">Toca num dia para corrigir. Os dias com <b>?</b> ficaram em dúvida (OCR sem confiança ou cor ambígua).</p>
      ${draft.groups.map((g, gi) => `<div class="card" data-g="${gi}">
        ${g.thumbs.map(t => `<img class="thumb" src="${t}" alt="screenshot">`).join('')}
        <div class="two"><div><label class="f" style="margin-top:0">Mês</label><select data-mm>${MONTHS.map((n, i) => `<option value="${i + 1}" ${g.m === i + 1 ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
        <div><label class="f" style="margin-top:0">Ano</label><input data-yy type="number" value="${g.y}"></div></div>
        ${g.notes.map(n => `<div class="warn">${esc(n)}</div>`).join('')}
        <div style="margin-top:12px">${gridHTML(g.y, g.m, (k, d) => g.days[d] ? { type: g.days[d].type, swap: g.days[d].swap, doubt: g.days[d].doubt } : { doubt: false })}</div>${LEGEND}
        <button class="btn sec small" data-cal style="margin-top:12px">Calibrar cores com as minhas correções</button></div>`).join('<div style="height:12px"></div>')}
      <div class="stack" style="margin-top:14px"><button class="btn" id="goOn">Continuar</button><button class="btn danger" id="goCancel">Cancelar importação</button></div>`;
    v.querySelectorAll('[data-g]').forEach(card => {
      const g = draft.groups[+card.dataset.g];
      card.querySelector('[data-mm]').onchange = e => { g.m = +e.target.value; render(); };
      card.querySelector('[data-yy]').onchange = e => { g.y = +e.target.value || g.y; render(); };
      card.querySelectorAll('.cell[data-d]').forEach(b => b.onclick = () => editDraftDay(g, +b.dataset.d));
      card.querySelector('[data-cal]').onclick = () => {
        const by = {};
        Object.values(g.days).forEach(x => { if (x.rgb && C.DEFAULT_REFS[x.type] && !x.doubt) (by[x.type] = by[x.type] || []).push(x.rgb); });
        const fixed = Object.keys(by);
        if (!fixed.length) return toast('Sem dias fiáveis para calibrar.');
        fixed.forEach(t => { S.settings.refs[t] = [0, 1, 2].map(i => C.median(by[t].map(c => c[i]))); });
        save(); toast('Cores calibradas. Importa de novo para aplicar na leitura.');
      };
    });
    $('#goCancel').onclick = () => { draft = null; render(); };
    $('#goOn').onclick = reviewDiff;
  }
  function editDraftDay(g, d) {
    const x = g.days[d] || { type: 'none', swap: false };
    sheet(`<button class="btn sec small close" data-close>Fechar</button><h2>Dia ${d}</h2>
      <label class="f">Tipo</label><select id="dT">${TYPE_ORDER.map(t => `<option value="${t}" ${x.type === t ? 'selected' : ''}>${t === 'none' ? 'Ignorar este dia' : C.TYPES[t]}</option>`).join('')}</select>
      <div class="switch"><span>Troca (contorno tracejado)</span><input id="dS" type="checkbox" ${x.swap ? 'checked' : ''}></div>
      <label class="f">Estado original</label><select id="dO"><option value="">Desconhecido</option><option value="work" ${x.orig === 'work' ? 'selected' : ''}>Trabalho</option><option value="off" ${x.orig === 'off' ? 'selected' : ''}>Folga</option></select>
      <button class="btn" id="dOk" style="margin-top:16px">Aplicar</button>`, (el, close) => {
      el.querySelector('#dOk').onclick = () => {
        const t = el.querySelector('#dT').value;
        if (t === 'none') delete g.days[d];
        else g.days[d] = Object.assign({}, x, { type: t, swap: el.querySelector('#dS').checked, orig: el.querySelector('#dO').value || null, doubt: false });
        close(); render();
      };
    });
  }
  function reviewDiff() {
    const items = draft.groups.map(g => {
      const key = ym(g.y, g.m), inc = draftToIncoming(g), diff = C.diffMonth(S.months[key] || {}, inc);
      return { g, key, inc, diff };
    });
    const total = items.reduce((s, i) => s + i.diff.length, 0);
    const dbt = items.reduce((s, i) => s + Object.values(i.g.days).filter(x => x.doubt).length, 0);
    sheet(`<button class="btn sec small close" data-close>Voltar</button><h2>Resumo das alterações</h2>
      ${dbt ? `<div class="warn">${dbt} dia(s) ainda marcados com dúvida. Confirma-os antes de guardar.</div>` : ''}
      ${!total ? '<div class="card">Este horário já está guardado — não há nada de novo.</div>' : items.map((it, ii) => `<h3>${MONTHS[it.g.m - 1]} ${it.g.y} ${S.months[it.key] ? '(atualização)' : '(novo mês)'}</h3>
        <div class="list">${it.diff.map((c, ci) => `<label class="item"><input type="checkbox" data-i="${ii}" data-c="${ci}" ${c.manualConflict ? '' : 'checked'}><span class="sp"><b>${fmtDate(c.date)}</b><br>${c.kind === 'change' ? `<span class="diff-from">${esc(label(c.from))}</span> → ` : ''}${esc(label(c.to))}${c.manualConflict ? '<br><span class="muted">⚠ Editado manualmente — por defeito não é substituído.</span>' : ''}</span></label>`).join('')}</div>`).join('')}
      <div class="stack" style="margin-top:14px">${total ? '<button class="btn" id="apply">Guardar selecionados</button>' : ''}<button class="btn sec" data-close>${total ? 'Cancelar' : 'Fechar'}</button></div>`, (el, close) => {
      if (!total) { el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { draft = null; render(); })); return; }
      el.querySelector('#apply').onclick = () => {
        let applied = 0;
        items.forEach((it, ii) => {
          const picked = it.diff.filter((c, ci) => el.querySelector(`[data-i="${ii}"][data-c="${ci}"]`).checked);
          if (!picked.length) return;
          const before = JSON.parse(JSON.stringify(S.months[it.key] || {}));
          const id = 'i' + Date.now() + ii;
          S.months[it.key] = S.months[it.key] || {};
          picked.forEach(c => C.applyChange(S.months[it.key], c, id));
          S.imports.unshift({ id, at: new Date().toISOString(), ym: it.key, kind: 'import', added: picked.filter(c => c.kind === 'add').length, changed: picked.filter(c => c.kind === 'change').length, skipped: it.diff.length - picked.length, changes: picked.map(c => ({ date: c.date, kind: c.kind, from: c.from ? label(c.from) : null, to: label(c.to) })), snapshot: before });
          applied += picked.length;
          cur = { y: it.g.y, m: it.g.m };
        });
        S.imports = S.imports.slice(0, 60);
        save(); close(); draft = null; tab = 'horarios'; render();
        toast(applied ? `${applied} alteração(ões) guardadas.` : 'Nada selecionado.'); autoSync();
      };
    });
  }

  /* ---------- Despertadores ---------- */
  const shortcutURL = times => `shortcuts://run-shortcut?name=${encodeURIComponent(S.settings.shortcutName)}&input=text&text=${encodeURIComponent(times.join('\n'))}`;
  // Os alarmes criados pelo Atalho tocam na PRÓXIMA ocorrência de cada hora (a app não consegue escolher o dia).
  function ringDay(times) {
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes(), t = times.map(C.toMin);
    return m < Math.min(...t) ? 'today' : m >= Math.max(...t) ? 'tomorrow' : 'mixed';
  }
  async function sendToShortcut(times, forDate) {
    if (!times.length) return false;
    if (forDate) {
      const rd = ringDay(times), tom = new Date(); tom.setDate(tom.getDate() + 1);
      const tomKey = C.dateKey(tom.getFullYear(), tom.getMonth() + 1, tom.getDate());
      const ok = rd === 'today' ? forDate === todayKey() : rd === 'tomorrow' ? forDate === tomKey : false;
      if (!ok) {
        const when = rd === 'mixed' ? 'Alguns alarmes já passaram hoje (tocam amanhã) e outros ainda tocam hoje.' : `Os alarmes criados pelo Atalho tocam na próxima vez que cada hora chegar — ${rd === 'today' ? 'hoje' : 'amanhã'} — e não em ${fmtDate(forDate)}.`;
        if (!(await confirmBox(`${when} O ideal é enviar na véspera do turno (depois das ${times[times.length - 1]}) ou no próprio dia antes das ${times[0]}.`, 'Enviar mesmo assim'))) return false;
      }
    }
    location.href = shortcutURL(times);
    return true;
  }
  function openShortcutHelp() {
    const n = esc(S.settings.shortcutName);
    sheet(`<button class="btn sec small close" data-close>Fechar</button><h2>Como configurar o Atalho</h2>
      <p class="muted">Uma web app não pode criar alarmes no iPhone. Esta app entrega as horas ao Atalho <b>${n}</b>, e é o Atalho que cria os alarmes no Relógio. Configuras uma vez:</p>
      <ol style="padding-left:20px;line-height:1.6">
        <li>Abre a app <b>Atalhos</b> → <b>+</b> → dá-lhe o nome exato <b>${n}</b>.</li>
        <li>Adiciona <b>Dividir Texto</b> (Texto do Atalho, separador <i>Novas linhas</i>).</li>
        <li>Adiciona <b>Repetir com cada item</b> (item de «Texto dividido»).</li>
        <li>Dentro do ciclo: <b>Obter datas da entrada</b> (item repetido) e depois <b>Criar alarme</b> com a data obtida.</li>
        <li>Nas definições do Atalho ativa <b>Aceitar entrada de texto</b>.</li>
      </ol>
      <p class="muted">Ao carregar em «Criar no iPhone» a app abre o Atalho com as horas. O Atalho cria alarmes que tocam na <b>próxima</b> ocorrência de cada hora — por isso envia na véspera ou na manhã do turno. A app não consegue confirmar que o Atalho correu; evita reenviar para não duplicar alarmes (se mudar o turno, apaga os antigos no Relógio).</p>`);
  }
  function viewAlarmes(v) {
    const set = S.settings, seq = C.sequence(set.alarms);
    const up = Object.values(allDays()).filter(d => d.type === 'work' && d.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 14);
    v.innerHTML = `<h2>Despertadores</h2>
      <div class="warn">Uma web app <b>não pode criar alarmes no iPhone</b> (o AlarmKit só existe em apps nativas). A SHIFT prepara as horas e entrega-as ao Atalho <b>${esc(set.shortcutName)}</b>, que cria os alarmes no Relógio. <button class="btn sec small" id="aHelp" style="margin-top:8px">Como configurar o Atalho</button></div>
      <div class="card"><div class="switch"><span>Sugerir despertadores automaticamente</span><input type="checkbox" id="aAuto" ${set.autoAlarms ? 'checked' : ''}></div>
      <div class="muted">Regra: turno às ${esc(set.alarms.forStart)} → ${seq.length} alarmes (${esc(set.alarms.first)}–${esc(set.alarms.last)}, de ${set.alarms.step} em ${set.alarms.step} min). Outros horários: define-os no dia. Folgas e feriados fechados: nenhum.</div></div>
      <h3>Sequência padrão</h3>
      <div class="card"><div class="chips" style="margin-top:0">${seq.map(t => `<span class="chip on">${t}</span>`).join('')}</div>
      <div class="row" style="margin-top:10px"><button class="btn small" id="aSendStd">Enviar os ${seq.length} ao Atalho</button><button class="btn sec small" id="aCopyStd">Copiar horas</button></div></div>
      <h3>Próximos turnos</h3>
      ${up.length ? up.map(d => {
        const all = C.alarmTimes(d, set), act = C.activeAlarmTimes(d, set);
        return `<div class="card" style="margin-bottom:10px" data-k="${d.date}"><div class="row"><b>${fmtDate(d.date)}</b><span class="muted">${d.start}–${d.end}</span><span class="sp"></span>${all.length ? `<input type="checkbox" data-en ${d.alarmEnabled === false ? '' : 'checked'} aria-label="Ativar sequência">` : ''}</div>
          ${all.length ? `<div class="chips">${all.map(t => `<button class="chip ${act.includes(t) ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px"><span class="muted sp">${d.alarmSent ? 'Enviado ao Atalho em ' + new Date(d.alarmSent).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Ainda não enviado'}</span><button class="btn small" data-send ${act.length ? '' : 'disabled'}>Criar no iPhone</button></div>`
          : '<div class="muted" style="margin-top:6px">Sem sequência para este horário. Abre o dia para definir alarmes personalizados.</div>'}</div>`;
      }).join('') : '<div class="card muted">Sem turnos futuros.</div>'}`;
    $('#aAuto').onchange = e => { S.settings.autoAlarms = e.target.checked; save(); render(); };
    $('#aHelp').onclick = openShortcutHelp;
    $('#aSendStd').onclick = () => sendToShortcut(seq, null);
    $('#aCopyStd').onclick = async () => { try { await navigator.clipboard.writeText(seq.join('\n')); toast('Horas copiadas.'); } catch (e) { toast(seq.join(' · ')); } };
    v.querySelectorAll('[data-k]').forEach(card => {
      const k = card.dataset.k, getD = () => allDays()[k];
      const mut = fn => { const dd = S.months[k.slice(0, 7)][k]; fn(dd); save(); render(); };
      const en = card.querySelector('[data-en]'); if (en) en.onchange = () => mut(dd => { dd.alarmEnabled = en.checked; });
      card.querySelectorAll('[data-t]').forEach(b => b.onclick = () => mut(dd => {
        const off = dd.alarmsOff || []; const i = off.indexOf(b.dataset.t);
        if (i >= 0) off.splice(i, 1); else off.push(b.dataset.t); dd.alarmsOff = off;
      }));
      const send = card.querySelector('[data-send]');
      if (send) send.onclick = async () => {
        const dd = getD(), times = C.activeAlarmTimes(dd, S.settings);
        if (!times.length) return;
        if (dd.alarmSent && !(await confirmBox('Já enviaste estes alarmes ao Atalho. Enviar outra vez cria alarmes duplicados no iPhone. Continuar?', 'Enviar outra vez'))) return;
        if (await sendToShortcut(times, k)) mut(x => { x.alarmSent = Date.now(); });
      };
    });
  }

  /* ---------- Histórico ---------- */
  function viewHistorico(v) {
    v.innerHTML = `<h2>Histórico</h2>${S.imports.length ? S.imports.map((im, i) => `<div class="card" style="margin-bottom:10px">
      <div class="row"><b style="text-transform:capitalize">${MONTHS[+im.ym.slice(5) - 1]} ${im.ym.slice(0, 4)}</b><span class="sp"></span><span class="muted">${new Date(im.at).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
      <div class="muted">${im.kind === 'restore' ? 'Versão restaurada' : `${im.added} novos · ${im.changed} alterados${im.skipped ? ` · ${im.skipped} ignorados` : ''}`}</div>
      <details style="margin-top:8px"><summary>Detalhes</summary>${im.changes.length ? `<div class="list" style="box-shadow:none;margin-top:8px">${im.changes.map(c => `<div class="item"><b>${fmtDate(c.date)}</b><span class="sp"></span><span>${c.from ? `<span class="diff-from">${esc(c.from)}</span> → ` : ''}${esc(c.to)}</span></div>`).join('')}</div>` : '<p class="muted">—</p>'}</details>
      <button class="btn sec small" data-rs="${i}" style="margin-top:10px">Restaurar versão anterior a esta</button></div>`).join('') : '<div class="card muted">Ainda não há importações.</div>'}`;
    v.querySelectorAll('[data-rs]').forEach(b => b.onclick = async () => {
      const im = S.imports[+b.dataset.rs];
      if (!(await confirmBox(`Repor ${im.ym} como estava antes desta importação? O estado atual fica guardado no histórico.`, 'Restaurar'))) return;
      const cur0 = JSON.parse(JSON.stringify(S.months[im.ym] || {}));
      if (Object.keys(im.snapshot).length) S.months[im.ym] = JSON.parse(JSON.stringify(im.snapshot)); else delete S.months[im.ym];
      S.imports.unshift({ id: 'r' + Date.now(), at: new Date().toISOString(), ym: im.ym, kind: 'restore', added: 0, changed: 0, changes: [], snapshot: cur0 });
      save(); render(); toast('Versão restaurada.'); autoSync();
    });
  }

  /* ---------- Calendário (.ics) e sincronização ---------- */
  function icsText() { return C.buildICS(allDays(), S.icsSeq); }
  async function exportIcs() {
    S.icsSeq++; save();
    const text = icsText();
    const file = new File([text], 'shift.ics', { type: 'text/calendar' });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = 'shift.ics'; document.body.appendChild(a); a.click(); a.remove();
  }
  const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
  function workerBase(raw) {
    let u = String(raw || '').trim();
    if (!u) return { error: 'O URL do serviço está vazio.' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = 'https://' + u;
    let p;
    try { p = new URL(u); } catch (e) { return { error: `URL do serviço inválido: «${raw}».` }; }
    if (p.protocol !== 'https:' && !(p.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(p.hostname))) return { error: 'O URL do serviço tem de começar por https://.' };
    return { base: p.origin };
  }
  // Endereço público do calendário (não precisa da palavra-passe).
  function calTarget() {
    const w = S.settings.worker, b = workerBase(w.url);
    if (b.error) return { error: b.error };
    const tok = String(w.token || '').trim();
    if (!TOKEN_RE.test(tok)) return { error: `Token inválido (${tok.length} caracteres). Tem de ter entre 32 e 128 caracteres, só letras, números, «-» e «_». Carrega em «Gerar».` };
    return { base: b.base, url: `${b.base}/cal/${tok}.ics` };
  }
  // Endereço + credenciais para publicar.
  function syncTarget() {
    const t = calTarget(); if (t.error) return t;
    const sec = getSecret();
    if (!sec) return { error: 'Falta a palavra-passe de publicação.' };
    const bad = [...sec].find(c => c < ' ' || c > '~');
    if (bad) return { error: `A palavra-passe tem um carácter não permitido («${bad}», U+${bad.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}), provavelmente aspas ou travessão «inteligentes» do teclado. Usa só caracteres ASCII simples.` };
    return Object.assign(t, { secret: sec });
  }
  const subUrl = () => calTarget().url || '';
  let lastSync = '';
  async function syncNow(silent) {
    const fail = (msg, extra) => { lastSync = '✗ ' + msg; toast(silent ? 'Calendário não publicado: ' + msg.slice(0, 90) : msg.slice(0, 120)); console.error('SHIFT sync:', msg, extra || ''); return false; };
    const t = syncTarget();
    if (t.error) return fail(t.error);
    const text = icsText();
    S.icsSeq++; save();
    const head = `PUT ${t.url}\nOrigem da app: ${location.origin}\n`;
    let r;
    try {
      r = await fetch(t.url, { method: 'PUT', headers: { Authorization: 'Bearer ' + t.secret, 'Content-Type': 'text/calendar' }, body: text });
    } catch (e) {
      let reach = false;
      try { await fetch(t.base + '/', { mode: 'no-cors', cache: 'no-store' }); reach = true; } catch (e2) { /* sem rede */ }
      const why = reach
        ? `O Worker está acessível, mas o navegador bloqueou a resposta ao PUT (CORS) — o Worker devolveu um erro sem cabeçalhos CORS (ex.: 404 por caminho/token inválido ou erro interno) ou ALLOWED_ORIGIN não coincide com ${location.origin}. Atualiza o Worker com «wrangler deploy» para ver o código HTTP real.`
        : `Não consegui contactar ${t.base}: sem Internet, endereço/DNS errado, ou bloqueado por VPN/bloqueador de anúncios.`;
      return fail(head + `Erro de rede (${e.name}: ${e.message}).\n` + why, e);
    }
    const body = (await r.text().catch(() => '')).slice(0, 200);
    if (r.ok) {
      const n = (text.match(/BEGIN:VEVENT/g) || []).length;
      S.sync.last = new Date().toISOString();
      lastSync = `✓ Publicado — HTTP ${r.status}, ${n} turno(s), ${new Date().toLocaleTimeString('pt-PT')}.`;
      if (!silent) toast('Calendário publicado.');
      return true;
    }
    const hints = { 400: 'O Worker recusou o calendário (não começa por BEGIN:VCALENDAR ou excede 1 MB).', 401: 'Palavra-passe errada: não coincide com o secret SECRET do Worker.', 404: 'O Worker não aceitou o caminho: o token tem de ter 32–128 caracteres [A-Za-z0-9_-].', 405: 'Método não permitido pelo Worker.' };
    const hint = hints[r.status] || (r.status >= 500 ? 'Erro interno do Worker (verifica o binding CAL e os logs: npx wrangler tail).' : '');
    return fail(head + `HTTP ${r.status}${r.statusText ? ' ' + r.statusText : ''}. ${hint}${body ? '\nResposta: «' + body + '»' : ''}`);
  }
  // Publicação em fila: se falhar (sem rede, Worker em baixo), fica «pendente» e repete ao reabrir a app ou quando volta a rede.
  let syncing = false, again = false;
  function queueSync() { if (!S.settings.worker.url) return; S.sync.pending = true; save(); flushSync(); }
  const autoSync = queueSync;
  async function flushSync(force) {
    if (!S.sync.pending || !S.settings.worker.url) return;
    if (syncing) { again = true; return; }
    if (!force && navigator.onLine === false) return;
    syncing = true;
    try {
      do {
        again = false;
        const ok = await syncNow(true);
        if (!ok) break;
        if (!again) S.sync.pending = false;
      } while (again);
      save();
    } finally { syncing = false; refreshSyncBox(); }
  }

  /* ---------- Definições ---------- */
  function openSettings() {
    const s = S.settings, w = s.worker;
    sheet(`<button class="btn sec small close" data-close>Fechar</button><h2>Definições</h2>
      <h3>Horário padrão</h3><div class="two"><div><label class="f" style="margin-top:0">Entrada</label><input id="sS" type="time" value="${s.start}"></div><div><label class="f" style="margin-top:0">Saída</label><input id="sE" type="time" value="${s.end}"></div></div>
      <h3>Despertadores</h3><div class="card"><div class="two"><div><label class="f" style="margin-top:0">Turno que ativa</label><input id="aF" type="time" value="${s.alarms.forStart}"></div><div><label class="f" style="margin-top:0">Intervalo (min)</label><input id="aS" type="number" min="1" value="${s.alarms.step}"></div></div>
      <div class="two"><div><label class="f">Primeiro</label><input id="a1" type="time" value="${s.alarms.first}"></div><div><label class="f">Último</label><input id="a2" type="time" value="${s.alarms.last}"></div></div>
      <label class="f">Nome do Atalho do iOS</label><input id="aN" value="${esc(s.shortcutName)}"></div>
      <h3>Calendário Apple</h3><div class="card stack"><button class="btn sec" id="bIcs">Exportar .ics (adicionar ao Calendário)</button>
      <div class="muted">Importar o mesmo ficheiro de novo atualiza os eventos (o UID de cada dia é fixo), sem duplicar.</div>
      <div class="muted"><b>Subscrição com URL permanente</b> (opcional): precisa do pequeno serviço da pasta <code>worker/</code> (Cloudflare, gratuito). Ver README.</div>
      <label class="f">URL do serviço</label><input id="wU" placeholder="https://shift-cal.o-teu-nome.workers.dev" value="${esc(w.url)}">
      <label class="f">Token do calendário (fica sempre igual)</label><div class="row"><input id="wT" value="${esc(w.token)}"><button class="btn sec small" id="wG">Gerar</button></div>
      <label class="f">Palavra-passe de publicação</label><input id="wP" type="password" value="${esc(getSecret())}">
      <div class="code" id="wUrl">${esc(subUrl().replace(/^https?:/, 'webcal:') || '—')}</div>
      <button class="btn sec" id="wSync">Publicar agora</button>
      <div class="code" id="wLog" style="white-space:pre-wrap" ${lastSync ? '' : 'hidden'}>${esc(lastSync)}</div></div>
      <h3>Dados e cópias de segurança</h3><div class="card stack">
        <div class="muted" id="dInfo">A verificar…</div>
        <button class="btn sec" id="dEx">Guardar cópia de segurança (Ficheiros / AirDrop)</button>
        <button class="btn sec" id="dIm">Restaurar de um ficheiro</button><input id="dF" type="file" accept="application/json,.json" hidden>
        <button class="btn sec" id="dAuto">Cópias automáticas neste iPhone</button>
        <div class="muted">A cópia inclui horários, histórico, URL e token do calendário, mas <b>não</b> a palavra-passe do Worker.</div>
        <button class="btn danger" id="dDel">Apagar todos os dados</button></div>
      <h3>Aplicação</h3><div class="card stack"><div class="muted">Versão <b>${esc(VER)}</b> · ${standalone() ? 'instalada no ecrã principal' : 'aberta no navegador'}</div><button class="btn sec" id="uChk">Procurar atualizações</button></div>
      <button class="btn" id="sSave" style="margin-top:16px">Guardar definições</button>`, (el, close) => {
      const g = id => el.querySelector(id);
      const read = () => {
        s.start = g('#sS').value || s.start; s.end = g('#sE').value || s.end;
        s.alarms = { forStart: g('#aF').value || s.alarms.forStart, first: g('#a1').value || s.alarms.first, last: g('#a2').value || s.alarms.last, step: Math.max(1, +g('#aS').value || 5) };
        s.shortcutName = g('#aN').value.trim() || 'SHIFT Alarms';
        { const raw = g('#wU').value.trim(), nb = workerBase(raw); w.url = nb.base || raw; g('#wU').value = w.url; } w.token = g('#wT').value.trim(); setSecret(g('#wP').value);
        save();
      };
      g('#wG').onclick = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); g('#wT').value = [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };
      g('#sSave').onclick = () => { read(); close(); render(); toast('Definições guardadas.'); };
      g('#bIcs').onclick = exportIcs;
      g('#wSync').onclick = async () => { read(); const btn = g('#wSync'); btn.disabled = true; btn.textContent = 'A publicar…'; try { if (await syncNow(false)) { S.sync.pending = false; save(); } } finally { btn.disabled = false; btn.textContent = 'Publicar agora'; } g('#wUrl').textContent = subUrl().replace(/^https?:/, 'webcal:') || '—'; const lg = g('#wLog'); lg.textContent = lastSync; lg.hidden = !lastSync; };
      g('#dEx').onclick = async () => { if (await exportBackup()) { g('#dInfo').dataset.x = ''; fillInfo(); } };
      g('#dIm').onclick = () => g('#dF').click();
      g('#dF').onchange = async e => {
        const f = e.target.files[0]; e.target.value = ''; if (!f) return;
        let o; try { o = JSON.parse(await f.text()); validateBackup(o); } catch (x) { return toast('Ficheiro inválido: ' + x.message); }
        const n = Object.keys(o.months).length;
        if (await confirmBox(`Substituir os dados atuais por esta cópia (${n} mês/meses)? Os atuais ficam guardados como cópia automática «antes de restaurar».`, 'Restaurar')) { if (await restoreFromJson(o, 'ficheiro')) close(); }
      };
      g('#dAuto').onclick = openAutoCopies;
      g('#dDel').onclick = async () => {
        if (!(await confirmBox('Apagar horários, histórico, definições, palavra-passe e cópias automáticas deste iPhone? Não dá para desfazer (as cópias de segurança em ficheiro não são afetadas).', 'Apagar tudo'))) return;
        for (const k of ((await idb.keys()) || [])) await idb.del(k);
        setSecret(''); S = defaults(); save(); close(); render(); toast('Dados apagados.');
      };
      g('#uChk').onclick = checkUpdate;
      el.querySelectorAll('input:not([type=file]),select').forEach(i => i.addEventListener('change', read));   // guarda ao editar
      async function fillInfo() {
        const fmt = iso => iso ? new Date(iso).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
        let pers = null; try { pers = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* ignorar */ }
        g('#dInfo').innerHTML = `Última gravação: <b>${fmt(S.savedAt)}</b><br>Última cópia de segurança: <b>${fmt(S.lastBackup)}</b><br>Armazenamento protegido pelo iOS: <b>${pers === null ? 'n/d' : pers ? 'sim' : 'normal'}</b>`;
      }
      fillInfo();
    });
  }

  async function openAutoCopies() {
    const ks = ((await idb.keys()) || []).filter(k => /^(snap|pre)-/.test(k)).sort().reverse(), recs = [];
    for (const k of ks) { const r = await idb.get(k); if (r) recs.push([k, r]); }
    const fmt = iso => new Date(iso).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    sheet(`<button class="btn sec small close" data-close>Fechar</button><h2>Cópias automáticas</h2>
      <p class="muted">Guardadas só neste iPhone: uma por dia (7 dias) e outras criadas antes de restaurar. Não contêm a palavra-passe.</p>
      ${recs.length ? `<div class="list">${recs.map(([k, r], i) => `<div class="item"><span class="sp"><b>${fmt(r.at)}</b><br><span class="muted">${r.months} mês/meses · ${k.startsWith('pre-') ? esc(k.split('-').slice(2).join(' ')) : 'diária'}</span></span><button class="btn sec small" data-rc="${i}">Restaurar</button></div>`).join('')}</div>` : '<div class="card muted">Ainda não há cópias.</div>'}`, (el, close) => {
      el.querySelectorAll('[data-rc]').forEach(b => b.onclick = async () => {
        const r = recs[+b.dataset.rc][1];
        if (await confirmBox('Substituir os dados atuais por esta cópia? Os atuais ficam guardados como cópia «antes de restaurar».', 'Restaurar')) { close(); await restoreFromJson(r.json, 'cópia automática'); }
      });
    });
  }

  /* ---------- Atualizações da app ---------- */
  function showUpdate() { $('#upd').hidden = false; }
  async function checkUpdate() {
    try { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (e) { /* ignorar */ }
    try {
      const t = await (await fetch('version.js', { cache: 'no-store' })).text(), m = /SHIFT_VERSION\s*=\s*'([^']+)'/.exec(t);
      if (m && m[1] !== VER) { showUpdate(); toast('Há uma versão nova: ' + m[1]); } else toast('Já tens a versão mais recente (' + VER + ').');
    } catch (e) { toast('Sem ligação para procurar atualizações.'); }
  }

  /* ---------- Arranque ---------- */
  $('#updGo').onclick = () => location.reload();
  if ('serviceWorker' in navigator) {
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => reg.update()).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had) showUpdate(); });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(r => r && r.update()).catch(() => {});
    flushSync();
  });
  window.addEventListener('online', () => flushSync());
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.__shift = { get state() { return S; }, render, openDay, buildDraft, setDraft(d) { draft = d; }, restoreFromJson, exportBackup, flushSync, syncNow, idb, store, validateBackup, normalize, startupIssue: () => startupIssue };
  render();
  if (startupIssue) recoverIfNeeded();
  flushSync();
})();
