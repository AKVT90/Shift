(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- Tipos de dia ---------- */
  const TYPES = {
    work: 'Trabalho',
    off_mand: 'Folga obrigatória',
    off_comp: 'Folga complementar',
    holiday_closed: 'Feriado (loja fechada)',
    holiday: 'Feriado',
    off: 'Folga',
    none: 'Sem informação'
  };
  const OFF_TYPES = ['off_mand', 'off_comp', 'holiday_closed', 'off'];
  const DEFAULT_REFS = {
    work: [244, 163, 163],
    off_mand: [155, 123, 224],
    off_comp: [169, 212, 245],
    holiday_closed: [168, 36, 47]
  };

  const pad = n => String(n).padStart(2, '0');
  const median = a => {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const dateKey = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

  /* ---------- Cor ---------- */
  function rgb2lab(c) {
    const f = v => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
    const R = f(c[0]), G = f(c[1]), B = f(c[2]);
    const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
    const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
    const g = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const fx = g(X), fy = g(Y), fz = g(Z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }
  function dE(a, b) {
    const A = rgb2lab(a), B = rgb2lab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
  }
  function getPx(img, x, y) {
    x = clamp(Math.round(x), 0, img.width - 1);
    y = clamp(Math.round(y), 0, img.height - 1);
    const i = (y * img.width + x) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  }
  function medianColor(list) {
    return [0, 1, 2].map(k => median(list.map(c => c[k])));
  }
  function ringColor(img, cx, cy, r, n) {
    const list = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      list.push(getPx(img, cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
    return medianColor(list);
  }
  function classifyColor(rgb, refs, bg) {
    let best = { type: 'none', d: dE(rgb, bg) };
    for (const t of Object.keys(refs)) {
      const d = dE(rgb, refs[t]);
      if (d < best.d) best = { type: t, d };
    }
    return best;
  }

  /* ---------- Contorno tracejado ---------- */
  function dashedScore(img, cx, cy, p, bg) {
    let best = 0;
    const n = 144;
    for (let k = 0.28; k <= 0.461; k += 0.02) {
      const r = k * p;
      const ink = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        let on = false;
        for (let dr = -1; dr <= 1 && !on; dr++) {
          const px = getPx(img, cx + Math.cos(a) * (r + dr), cy + Math.sin(a) * (r + dr));
          if (dE(px, bg) > 20) on = true;
        }
        ink.push(on);
      }
      const frac = ink.filter(Boolean).length / n;
      let trans = 0;
      for (let i = 0; i < n; i++) if (ink[i] !== ink[(i + 1) % n]) trans++;
      if (frac > 0.3 && frac < 0.82 && trans > best) best = trans;
    }
    return best;
  }


  /* ---------- Pré-processamento para OCR ----------
     Números dentro de círculos coloridos (claro sobre escuro ou escuro sobre claro) confundem o OCR.
     Devolve uma imagem preto/branco em que só ficam a preto os pixels que diferem da média local. */
  function ocrPrep(img, thr) {
    const w = img.width, h = img.height, d = img.data;
    const rad = Math.max(8, Math.round(w * 0.01)), W1 = w + 1;
    const g = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = (299 * d[i * 4] + 587 * d[i * 4 + 1] + 114 * d[i * 4 + 2]) / 1000;
    const I = new Int32Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - rad), y1 = Math.min(h, y + rad + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - rad), x1 = Math.min(w, x + rad + 1);
        const m = (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / ((x1 - x0) * (y1 - y0));
        const v = Math.abs(g[y * w + x] - m) > thr ? 0 : 255, o = (y * w + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v; out[o + 3] = 255;
      }
    }
    return { width: w, height: h, data: out };
  }

  /* ---------- Grelha ---------- */
  function candidatesFromWords(words) {
    const out = [];
    for (const w of words) {
      const t = String(w.text || '').trim().replace(/[Oo]/g, '0').replace(/[lI|]/g, '1');
      if (!/^\d{1,2}$/.test(t)) continue;
      const v = +t;
      if (v < 1 || v > 31) continue;
      const h = w.y1 - w.y0;
      if (h < 6) continue;
      out.push({ v, x: (w.x0 + w.x1) / 2, y: (w.y0 + w.y1) / 2, h, conf: w.conf || 0 });
    }
    out.sort((a, b) => b.conf - a.conf);
    const keep = [];
    for (const c of out) {
      if (!keep.some(k => k.v === c.v && Math.hypot(k.x - c.x, k.y - c.y) < 0.8 * Math.max(k.h, c.h))) keep.push(c);
    }
    return keep;
  }

  function fitGrid(cs) {
    if (cs.length < 6) return { error: 'Foram detetados poucos números de dias.' };
    const hMed = median(cs.map(c => c.h));
    const dxs = [], dys = [];
    for (const a of cs) for (const b of cs) {
      if (b.v === a.v + 1 && Math.abs(b.y - a.y) < hMed * 0.6 && b.x - a.x > hMed * 0.8) dxs.push(b.x - a.x);
      if (b.v === a.v + 7 && b.y - a.y > hMed * 0.8 && Math.abs(b.x - a.x) < hMed * 0.6) dys.push(b.y - a.y);
    }
    if (dxs.length < 2 || dys.length < 2) return { error: 'Não consegui detetar a grelha do calendário.' };
    const pX = median(dxs), pY = median(dys);
    let best = null;
    for (const a of cs) {
      const inl = [];
      for (const b of cs) {
        const dcol = Math.round((b.x - a.x) / pX), drow = Math.round((b.y - a.y) / pY);
        if (Math.abs(b.x - a.x - dcol * pX) > 0.3 * pX || Math.abs(b.y - a.y - drow * pY) > 0.3 * pY) continue;
        if (7 * drow + dcol !== b.v - a.v) continue;
        inl.push(Object.assign({}, b, { dcol, drow }));
      }
      const score = inl.length + inl.reduce((s, c) => s + c.conf, 0) / 100000;
      if (!best || score > best.score) best = { a, inl, score };
    }
    const byV = new Map();
    for (const c of best.inl) if (!byV.has(c.v) || byV.get(c.v).conf < c.conf) byV.set(c.v, c);
    const inl = [...byV.values()];
    if (inl.length < 6) return { error: 'A grelha detetada é pouco fiável.' };
    const a = best.a;
    const dmin = Math.min(...inl.map(c => c.dcol)), dmax = Math.max(...inl.map(c => c.dcol));
    const cA = -dmin;
    const colsKnown = dmax - dmin >= 6;
    const colXs = Array.from({ length: 7 }, () => []);
    const rowYs = {};
    for (const c of inl) {
      const col = cA + c.dcol;
      if (col >= 0 && col < 7) colXs[col].push(c.x);
      (rowYs[c.drow] = rowYs[c.drow] || []).push(c.y);
    }
    const colX = colXs.map(l => (l.length ? l.reduce((s, v) => s + v, 0) / l.length : null));
    const knownCol = colX.findIndex(v => v != null);
    for (let c = 0; c < 7; c++) if (colX[c] == null) colX[c] = colX[knownCol] + (c - knownCol) * pX;
    const rowY = r => {
      const l = rowYs[r];
      return l ? l.reduce((s, v) => s + v, 0) / l.length : a.y + r * pY;
    };
    const firstCol = (((cA - (a.v - 1)) % 7) + 7) % 7;
    const found = new Set(inl.map(c => c.v));
    return {
      pX, pY, h: hMed, firstCol, colsKnown, inliers: inl.length,
      dayPos(d) {
        const idx = cA + (d - a.v);
        const row = Math.floor(idx / 7), col = ((idx % 7) + 7) % 7;
        return { x: colX[col], y: rowY(row), found: found.has(d) };
      }
    };
  }

  function estimateBg(img, grid) {
    const list = [];
    for (let d = 1; d < 31; d++) {
      const a = grid.dayPos(d), b = grid.dayPos(d + 1);
      if (Math.abs(a.y - b.y) < 2 && b.x > a.x) {
        const mx = (a.x + b.x) / 2;
        if (mx > 0 && mx < img.width && a.y > 0 && a.y < img.height) list.push(getPx(img, mx, a.y));
      }
    }
    return list.length ? medianColor(list) : [255, 255, 255];
  }

  /* ---------- Mês e ano ---------- */
  const MONTH_NAMES = [
    ['janeiro', 'january'], ['fevereiro', 'february'], ['marco', 'march'], ['abril', 'april'],
    ['maio', 'may'], ['junho', 'june'], ['julho', 'july'], ['agosto', 'august'],
    ['setembro', 'september'], ['outubro', 'october'], ['novembro', 'november'], ['dezembro', 'december']
  ];
  function lev(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i].concat(Array(n).fill(0)));
    for (let j = 0; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function matchMonth(word) {
    const w = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
    if (w.length < 3) return 0;
    for (let i = 0; i < 12; i++) {
      for (const name of MONTH_NAMES[i]) {
        if (w === name || (w.length >= 5 && lev(w, name) <= 2)) return i + 1;
      }
    }
    return 0;
  }
  function parseMonthYear(text) {
    text = String(text || '');
    let m = 0, y = 0;
    const re = /([A-Za-zÀ-ÿ]{4,12})\s*(?:de\s*)?(20\d\d)/g;
    let x;
    while ((x = re.exec(text))) {
      const mm = matchMonth(x[1]);
      if (mm) { m = mm; y = +x[2]; break; }
    }
    if (!m) {
      for (const w of text.split(/[\s,.;:]+/)) {
        const mm = matchMonth(w);
        if (mm) { m = mm; break; }
      }
    }
    if (!y) {
      const yy = /\b(20\d\d)\b/.exec(text);
      if (yy) y = +yy[1];
    }
    return { m, y };
  }

  /* ---------- Análise completa de um screenshot ---------- */
  function analyse(img, words, text, refs, now) {
    now = now || new Date();
    const cands = candidatesFromWords(words);
    const grid = fitGrid(cands);
    const my = parseMonthYear(text);
    const res = { year: my.y || now.getFullYear(), month: my.m || now.getMonth() + 1, monthFound: !!(my.m && my.y), warnings: [], days: {}, ok: false };
    if (grid.error) { res.warnings.push(grid.error); return res; }
    const bg = estimateBg(img, grid);
    const p = grid.pX;
    for (let d = 1; d <= 31; d++) {
      const pos = grid.dayPos(d);
      const out = { type: 'none', swap: false, orig: null, found: pos.found, doubt: true, rgb: null };
      if (pos.x > 0 && pos.x < img.width && pos.y > 0 && pos.y < img.height) {
        const r = clamp(grid.h * 0.95, 0.16 * p, 0.3 * p);
        const rgb = ringColor(img, pos.x, pos.y, r, 16);
        const cl = classifyColor(rgb, refs, bg);
        out.rgb = rgb; out.type = cl.type; out.dist = cl.d;
        out.doubt = !pos.found || cl.d > 28;
        if (cl.type !== 'none') {
          const sc = dashedScore(img, pos.x, pos.y, p, bg);
          out.dashScore = sc;
          if (sc >= 18) {
            out.swap = true;
            out.orig = cl.type === 'work' ? 'off' : 'work';
          }
        }
      }
      res.days[d] = out;
    }
    res.grid = { pX: grid.pX, pY: grid.pY, firstCol: grid.firstCol, inliers: grid.inliers };
    res.ok = true;
    if (!res.monthFound) res.warnings.push('Não consegui ler o mês/ano — confirma-os antes de guardar.');
    if (grid.inliers < 20) res.warnings.push('Poucos dias reconhecidos por OCR; verifica a grelha com atenção.');
    return res;
  }

  /* ---------- Modelo de dias, diff ---------- */
  function mkIncoming(x, settings) {
    const o = { type: x.type };
    if (x.type === 'work') { o.start = x.start || settings.start; o.end = x.end || settings.end; }
    o.swap = !!x.swap;
    o.orig = x.swap ? x.orig || null : null;
    return o;
  }
  function sameDay(a, b) {
    return a.type === b.type && (a.start || '') === (b.start || '') && (a.end || '') === (b.end || '') && !!a.swap === !!b.swap;
  }
  // existing: {date: day}, incoming: {date: day}
  function diffMonth(existing, incoming) {
    const out = [];
    for (const date of Object.keys(incoming).sort()) {
      const n = incoming[date], o = existing[date];
      if (n.type === 'none') continue;
      if (!o) { out.push({ date, kind: 'add', to: n }); continue; }
      if (sameDay(o, n)) continue;
      out.push({ date, kind: 'change', from: o, to: n, manualConflict: !!o.manual });
    }
    return out;
  }
  function applyChange(days, ch, importId) {
    const old = days[ch.date] || {};
    days[ch.date] = Object.assign({}, old, ch.to, { date: ch.date, manual: false, src: importId, notes: old.notes || '' });
    if (ch.to.type !== 'work') { delete days[ch.date].start; delete days[ch.date].end; }
    if (!ch.to.swap) delete days[ch.date].orig;
  }

  /* ---------- Alarmes ---------- */
  function toMin(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
  function fromMin(n) { return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; }
  function sequence(a) {
    const out = [];
    const step = Math.max(1, +a.step || 5);
    for (let t = toMin(a.first); t <= toMin(a.last); t += step) out.push(fromMin(t));
    return out;
  }
  function alarmTimes(day, settings) {
    if (!day || day.type !== 'work') return [];
    if (day.alarmCustom && day.alarmCustom.length) return day.alarmCustom.slice().sort();
    if (day.start === settings.alarms.forStart) return sequence(settings.alarms);
    return [];
  }
  function activeAlarmTimes(day, settings) {
    if (!settings.autoAlarms || (day && day.alarmEnabled === false)) return [];
    const off = (day && day.alarmsOff) || [];
    return alarmTimes(day, settings).filter(t => !off.includes(t));
  }

  /* ---------- iCalendar ---------- */
  const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  function fold(line) {
    const out = [];
    while (line.length > 72) { out.push(line.slice(0, 72)); line = ' ' + line.slice(72); }
    out.push(line);
    return out.join('\r\n');
  }
  function buildICS(days, seq, now) {
    now = now || new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SHIFT//Personal Work Schedule//PT', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:SHIFT — Trabalho', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'];
    for (const date of Object.keys(days).sort()) {
      const d = days[date];
      if (d.type !== 'work' || !d.start || !d.end) continue;
      const ymd = date.replace(/-/g, '');
      let endDate = date;
      if (toMin(d.end) <= toMin(d.start)) {
        const dt = new Date(date + 'T12:00:00'); dt.setDate(dt.getDate() + 1);
        endDate = dateKey(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
      }
      const desc = [];
      if (d.swap) desc.push(d.orig === 'off' ? 'Troca: folga trocada por trabalho.' : 'Troca de escala.');
      if (d.notes) desc.push(d.notes);
      L.push('BEGIN:VEVENT', `UID:shift-${date}@shift.local`, `DTSTAMP:${stamp}`, `SEQUENCE:${seq || 0}`,
        `DTSTART:${ymd}T${d.start.replace(':', '')}00`, `DTEND:${endDate.replace(/-/g, '')}T${d.end.replace(':', '')}00`,
        `SUMMARY:${icsEsc(d.swap ? 'Trabalho (troca)' : 'Trabalho')}`, 'LOCATION:Continente',
        ...(desc.length ? [`DESCRIPTION:${icsEsc(desc.join(' '))}`] : []), 'TRANSP:OPAQUE', 'END:VEVENT');
    }
    L.push('END:VCALENDAR');
    return L.map(fold).join('\r\n') + '\r\n';
  }

  return {
    TYPES, OFF_TYPES, DEFAULT_REFS, pad, dateKey, median, dE,
    candidatesFromWords, fitGrid, ocrPrep, analyse, parseMonthYear, mkIncoming, diffMonth, sameDay, applyChange,
    sequence, alarmTimes, activeAlarmTimes, buildICS, toMin
  };
});
