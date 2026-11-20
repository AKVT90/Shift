(function () {
  'use strict';
  const C = window.Core;
  const KEY = 'shift.v1';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = C.pad;
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const TYPE_ORDER = ['work', 'off_mand', 'off_comp', 'holiday_closed', 'holiday', 'off', 'none'];

  /* ---------- Estado ---------- */
  function defaults() {
    return {
      v: 1, months: {}, imports: [],
      settings: {
        start: '11:00', end: '15:00', autoAlarms: true,
        alarms: { forStart: '11:00', first: '07:20', last: '08:00', step: 5 },
        refs: JSON.parse(JSON.stringify(C.DEFAULT_REFS)),
        shortcutName: 'SHIFT Alarmes',
        worker: { url: '', token: '', secret: '' }
      },
      icsSeq: 0
    };
  }
  let S = load();
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const o = JSON.parse(raw), d = defaults();
        o.settings = Object.assign(d.settings, o.settings || {});
        o.settings.alarms = Object.assign(d.settings.alarms, (o.settings || {}).alarms || {});
        o.settings.worker = Object.assign(d.settings.worker, (o.settings || {}).worker || {});
        o.settings.refs = Object.assign(d.settings.refs, (o.settings || {}).refs || {});
        return Object.assign(d, o, { settings: o.settings });
      }
    } catch (e) { console.warn(e); }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('Não foi possível guardar (armazenamento cheio ou bloqueado).'); }
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
    v.innerHTML = `
      <div class="monthbar"><button id="pm" aria-label="Mês anterior">‹</button><b>${MONTHS[cur.m - 1]} ${cur.y}</b><button id="nm" aria-label="Mês seguinte">›</button></div>
      <div class="card">${gridHTML(cur.y, cur.m, k => days[k])}${LEGEND}</div>
      ${keys.length ? `<div class="chips">${keys.map(k => `<button class="chip ${k === ym(cur.y, cur.m) ? 'on' : ''}" data-ym="${k}">${MONTHS[+k.slice(5) - 1].slice(0, 3)} ${k.slice(2, 4)}</button>`).join('')}</div>` : ''}
      <h3>Próximos turnos</h3>
      ${next.length ? `<div class="list">${next.map(d => `<button class="item" data-k="${d.date}"><b>${fmtDate(d.date)}</b><span class="sp"></span><span>${d.start}–${d.end}</span>${d.swap ? '<span class="pill">troca</span>' : ''}</button>`).join('')}</div>`
        : `<div class="card muted">${keys.length ? 'Sem turnos futuros guardados.' : 'Ainda não importaste nenhum horário. Vai a Importar e escolhe um screenshot.'}</div>`}`;
    $('#pm').onclick = () => { cur.m--; if (cur.m < 1) { cur.m = 12; cur.y--; } render(); };
    $('#nm').onclick = () => { cur.m++; if (cur.m > 12) { cur.m = 1; cur.y++; } render(); };
    v.querySelectorAll('[data-ym]').forEach(b => b.onclick = () => { const [y, m] = b.dataset.ym.split('-').map(Number); cur = { y, m }; render(); });
    v.querySelectorAll('.cell[data-k], .item[data-k]').forEach(b => b.onclick = () => openDay(b.dataset.k));
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
  let tessP;
  function loadTess() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return tessP || (tessP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => res(window.Tesseract); s.onerror = () => { tessP = null; rej(new Error('Sem ligação para carregar o OCR.')); };
      document.head.appendChild(s);
    }));
  }
  async function toCanvas(file) {
    const url = URL.createObjectURL(file);
    try {
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida.')); i.src = url; });
      const sc = Math.min(1, 1400 / im.naturalWidth);
      const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0, c.width, c.height);
      return { c, g };
    } finally { URL.revokeObjectURL(url); }
  }
  async function runImport(files) {
    if (!files.length) return;
    const st = $('#status'), pg = $('#pg');
    const setP = (p, t) => { pg.hidden = false; pg.firstElementChild.style.width = Math.round(p * 100) + '%'; st.textContent = t; };
    $('#pick').disabled = true;
    try {
      setP(0.02, 'A carregar o motor de OCR…');
      const T = await loadTess();
      const worker = await T.createWorker('por');
      const results = [];
      for (let i = 0; i < files.length; i++) {
        const base = i / files.length, span = 1 / files.length;
        setP(base + span * 0.1, `Imagem ${i + 1}/${files.length}: a preparar…`);
        const { c, g } = await toCanvas(files[i]);
        const imgData = g.getImageData(0, 0, c.width, c.height);
        setP(base + span * 0.25, `Imagem ${i + 1}/${files.length}: a ler texto…`);
        await worker.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: T.PSM.AUTO });
        const r1 = (await worker.recognize(c)).data;
        setP(base + span * 0.6, `Imagem ${i + 1}/${files.length}: a ler números…`);
        await worker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: T.PSM.SPARSE_TEXT });
        const r2 = (await worker.recognize(c)).data;
        const words = [...(r2.words || []), ...(r1.words || [])].map(w => ({ text: w.text, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1, conf: w.confidence }));
        const res = C.analyse(imgData, words, r1.text, S.settings.refs, new Date());
        const th = document.createElement('canvas'); th.width = 360; th.height = Math.round(360 * c.height / c.width);
        th.getContext('2d').drawImage(c, 0, 0, th.width, th.height);
        results.push({ res, thumb: th.toDataURL('image/jpeg', 0.6), name: files[i].name });
      }
      await worker.terminate();
      draft = buildDraft(results);
      render();
    } catch (e) {
      console.error(e); st.textContent = '';
      toast(e.message || 'Falhou a análise.'); $('#pick').disabled = false; pg.hidden = true;
    }
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
  function viewAlarmes(v) {
    const set = S.settings;
    const up = Object.values(allDays()).filter(d => d.type === 'work' && d.date >= todayKey()).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 14);
    v.innerHTML = `<h2>Despertadores</h2>
      <div class="warn">Uma app instalada a partir do navegador <b>não pode criar alarmes no iPhone</b> (a API AlarmKit só existe em apps nativas). A alternativa que funciona de verdade: um Atalho do iOS cria os alarmes quando carregas em «Criar no iPhone». Passos no README.</div>
      <div class="card"><div class="switch"><span>Sugerir despertadores automaticamente</span><input type="checkbox" id="aAuto" ${set.autoAlarms ? 'checked' : ''}></div>
      <div class="muted">Regra: turno às ${esc(set.alarms.forStart)} → ${C.sequence(set.alarms).length} alarmes (${esc(set.alarms.first)}–${esc(set.alarms.last)}, de ${set.alarms.step} em ${set.alarms.step} min). Outros horários: define-os no dia. Folgas e feriados fechados: nenhum.</div></div>
      <h3>Próximos turnos</h3>
      ${up.length ? up.map(d => {
        const all = C.alarmTimes(d, set), act = C.activeAlarmTimes(d, set);
        return `<div class="card" style="margin-bottom:10px" data-k="${d.date}"><div class="row"><b>${fmtDate(d.date)}</b><span class="muted">${d.start}–${d.end}</span><span class="sp"></span>${all.length ? `<input type="checkbox" data-en ${d.alarmEnabled === false ? '' : 'checked'} aria-label="Ativar sequência">` : ''}</div>
          ${all.length ? `<div class="chips">${all.map(t => `<button class="chip ${act.includes(t) ? 'on' : ''}" data-t="${t}">${t}</button>`).join('')}</div>
          <div class="row" style="margin-top:10px"><span class="muted sp">${d.alarmSent ? 'Enviado ao Atalho em ' + new Date(d.alarmSent).toLocaleString('pt-PT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Ainda não enviado'}</span><button class="btn small" data-send ${act.length ? '' : 'disabled'}>Criar no iPhone</button></div>`
          : '<div class="muted" style="margin-top:6px">Sem sequência para este horário. Abre o dia para definir alarmes personalizados.</div>'}</div>`;
      }).join('') : '<div class="card muted">Sem turnos futuros.</div>'}`;
    $('#aAuto').onchange = e => { S.settings.autoAlarms = e.target.checked; save(); render(); };
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
        mut(x => { x.alarmSent = Date.now(); });
        const url = `shortcuts://run-shortcut?name=${encodeURIComponent(S.settings.shortcutName)}&input=text&text=${encodeURIComponent(times.join('\n'))}`;
        location.href = url;
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
  const subUrl = () => { const w = S.settings.worker; return w.url && w.token ? `${w.url.replace(/\/$/, '')}/cal/${w.token}.ics` : ''; };
  async function syncNow(silent) {
    const w = S.settings.worker, u = subUrl();
    if (!u || !w.secret) { if (!silent) toast('Define o URL, o token e a palavra-passe do serviço.'); return false; }
    S.icsSeq++; save();
    try {
      const r = await fetch(u, { method: 'PUT', headers: { Authorization: 'Bearer ' + w.secret, 'Content-Type': 'text/calendar' }, body: icsText() });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      if (!silent) toast('Calendário publicado.'); return true;
    } catch (e) { toast('Falhou a sincronização: ' + e.message); return false; }
  }
  function autoSync() { if (subUrl() && S.settings.worker.secret) syncNow(true); }

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
      <label class="f">Palavra-passe de publicação</label><input id="wP" type="password" value="${esc(w.secret)}">
      <div class="code" id="wUrl">${esc(subUrl().replace(/^https?:/, 'webcal:') || '—')}</div>
      <button class="btn sec" id="wSync">Publicar agora</button></div>
      <h3>Dados</h3><div class="stack"><button class="btn sec" id="dEx">Exportar cópia de segurança</button><button class="btn sec" id="dIm">Importar cópia de segurança</button><input id="dF" type="file" accept="application/json" hidden><button class="btn danger" id="dDel">Apagar todos os dados</button></div>
      <button class="btn" id="sSave" style="margin-top:16px">Guardar definições</button>`, (el, close) => {
      const g = id => el.querySelector(id);
      const read = () => {
        s.start = g('#sS').value || s.start; s.end = g('#sE').value || s.end;
        s.alarms = { forStart: g('#aF').value || s.alarms.forStart, first: g('#a1').value || s.alarms.first, last: g('#a2').value || s.alarms.last, step: Math.max(1, +g('#aS').value || 5) };
        s.shortcutName = g('#aN').value.trim() || 'SHIFT Alarmes';
        w.url = g('#wU').value.trim(); w.token = g('#wT').value.trim(); w.secret = g('#wP').value;
        save();
      };
      g('#wG').onclick = () => { const a = new Uint8Array(24); crypto.getRandomValues(a); g('#wT').value = [...a].map(b => b.toString(16).padStart(2, '0')).join(''); };
      g('#sSave').onclick = () => { read(); close(); render(); toast('Definições guardadas.'); };
      g('#bIcs').onclick = exportIcs;
      g('#wSync').onclick = async () => { read(); await syncNow(false); g('#wUrl').textContent = subUrl().replace(/^https?:/, 'webcal:') || '—'; };
      g('#dEx').onclick = () => { const f = new File([JSON.stringify(S)], `shift-backup-${todayKey()}.json`, { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); };
      g('#dIm').onclick = () => g('#dF').click();
      g('#dF').onchange = async e => {
        try { const o = JSON.parse(await e.target.files[0].text()); if (!o.months || !o.settings) throw 0; if (!(await confirmBox('Substituir todos os dados atuais por esta cópia?', 'Substituir'))) return; S = Object.assign(defaults(), o); save(); close(); render(); toast('Cópia restaurada.'); }
        catch (x) { toast('Ficheiro inválido.'); }
      };
      g('#dDel').onclick = async () => { if (await confirmBox('Apagar horários, histórico e definições deste dispositivo? Não dá para desfazer.', 'Apagar')) { S = defaults(); save(); close(); render(); } };
    });
  }

  /* ---------- Arranque ---------- */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  window.__shift = { get state() { return S; }, render, openDay, buildDraft, setDraft(d) { draft = d; } };
  render();
})();
