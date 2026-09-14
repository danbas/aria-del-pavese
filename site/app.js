(function () {
  'use strict';
  const D = window.ARPA_DATA;
  const $ = (s) => document.querySelector(s);
  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const DOWS = ['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'];
  const STATIONS = D.stations;
  const SENS = D.sensors;
  const POLL = D.pollutants;
  const [MIN_DAY, MAX_DAY] = D.range;

  // ---------- date helpers (all UTC, strings YYYY-MM-DD) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const toStr = (dt) => dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  const toDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return toStr(d); };
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const clampDay = (s) => (s < MIN_DAY ? MIN_DAY : s > MAX_DAY ? MAX_DAY : s);
  const dayIndex = (s) => { const d = toDate(s); return { y: d.getUTCFullYear(), i: Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5) }; };
  const fmtLong = (s) => { const d = toDate(s); return DOWS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
  const fmtShort = (s) => { const d = toDate(s); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()].slice(0, 3); };

  // ---------- data access ----------
  function yearArr(sid, y) { const s = D.series[sid]; return s ? s[y] : null; }
  // returns {v, mean, hmax, partial} for a sensor on a day; v = regulatory metric value
  function reading(sid, day) {
    const { y, i } = dayIndex(day);
    const yr = yearArr(sid, y);
    if (!yr) return null;
    const mean = yr.a[i];
    if (mean == null) return null;
    const p = POLL[SENS[sid].p];
    const hmax = yr.m ? yr.m[i] : mean;
    const x8 = yr.x ? yr.x[i] : null;
    const v = p.metric === 'm' ? hmax : p.metric === 'x' ? x8 : mean;
    const partial = !!(yr.p && yr.p.includes(i));
    return { v, mean, hmax, x8, partial };
  }
  // 'law' | 'who' | 'ok' | null (null = no value for the metric)
  function level(pcode, r) {
    if (!r || r.v == null) return null;
    const p = POLL[pcode];
    if (pcode === 'SO2' && r.hmax > 350) return 'law';
    if (p.limit == null) return 'ok';
    if (r.v > p.limit) return p.kind === 'legge' ? 'law' : 'who';
    return 'ok';
  }
  const fmtV = (v, pcode) => v == null ? '—' : (pcode === 'CO' || pcode === 'C6H6' || pcode === 'BC' ? v.toFixed(1) : Math.round(v * 10) / 10 + '');
  const isActive = (sid) => !SENS[sid].stop;
  const stationActive = (st) => st.sensors.some(isActive);
  const stById = Object.fromEntries(STATIONS.map((s) => [s.id, s]));

  // ---------- state ----------
  const state = { day: MAX_DAY, visible: new Set(STATIONS.map((s) => s.id)), sel: null, pol: null, per: 'week', osm: false };
  try {
    const saved = JSON.parse(localStorage.getItem('aria-pv') || 'null');
    if (saved) {
      if (saved.day && saved.day >= MIN_DAY && saved.day <= MAX_DAY) state.day = saved.day;
      if (Array.isArray(saved.visible)) state.visible = new Set(saved.visible.filter((id) => stById[id]));
      if (saved.sel && stById[saved.sel]) state.sel = saved.sel;
      if (saved.per) state.per = saved.per;
      if (saved.pol) state.pol = saved.pol;
      if (typeof saved.osm === 'boolean') state.osm = saved.osm;
    }
  } catch (e) { /* storage unavailable */ }
  if (!state.sel) state.sel = STATIONS.find((s) => s.name.startsWith('Pavia p.zza'))?.id || STATIONS[0].id;
  function persist() { try { localStorage.setItem('aria-pv', JSON.stringify({ day: state.day, visible: [...state.visible], sel: state.sel, per: state.per, pol: state.pol, osm: state.osm })); } catch (e) { /* ignore */ } }

  // ---------- per-station day summary ----------
  function stationDay(st, day) {
    const rows = [];
    let worst = null; // 'law' > 'who' > 'ok' > null
    const rank = { law: 3, who: 2, ok: 1 };
    for (const sid of st.sensors) {
      const r = reading(sid, day);
      const lv = level(SENS[sid].p, r);
      rows.push({ sid, pcode: SENS[sid].p, r, lv });
      if (lv && (!worst || rank[lv] > rank[worst])) worst = lv;
    }
    return { rows, worst };
  }

  // ---------- theme tokens ----------
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const levelColor = (lv) => lv === 'law' ? css('--crit') : lv === 'who' ? css('--warn') : lv === 'ok' ? css('--accent') : css('--muted');

  // ---------- date controls ----------
  const selY = $('#sel-y'), selM = $('#sel-m'), selD = $('#sel-d');
  for (const y of D.years) selY.add(new Option(y, y));
  MONTHS.forEach((m, i) => selM.add(new Option(m, i + 1)));
  function syncDateControls() {
    const [y, m, d] = state.day.split('-').map(Number);
    selY.value = y; selM.value = m;
    const n = daysInMonth(y, m);
    if (selD.options.length !== n) { selD.innerHTML = ''; for (let i = 1; i <= n; i++) selD.add(new Option(i, i)); }
    selD.value = d;
    $('#dow').textContent = DOWS[toDate(state.day).getUTCDay()];
    $('#prev').disabled = state.day <= MIN_DAY; $('#next').disabled = state.day >= MAX_DAY;
    $('#date-hint').textContent = 'Dati disponibili dal ' + fmtShort(MIN_DAY) + ' ' + MIN_DAY.slice(0, 4) + ' al ' + fmtShort(MAX_DAY) + ' ' + MAX_DAY.slice(0, 4) + '.';
  }
  function setDay(s) { state.day = clampDay(s); render(); }
  function onSelect() {
    const y = +selY.value, m = +selM.value, d = Math.min(+selD.value, daysInMonth(y, m));
    setDay(y + '-' + pad(m) + '-' + pad(d));
  }
  selY.addEventListener('change', onSelect); selM.addEventListener('change', onSelect); selD.addEventListener('change', onSelect);
  $('#prev').addEventListener('click', () => setDay(addDays(state.day, -1)));
  $('#next').addEventListener('click', () => setDay(addDays(state.day, 1)));
  $('#q-last').addEventListener('click', () => setDay(MAX_DAY));
  $('#q-ym1').addEventListener('click', () => { const [y, m, d] = state.day.split('-').map(Number); setDay((y - 1) + '-' + pad(m) + '-' + pad(Math.min(d, daysInMonth(y - 1, m)))); });
  $('#q-worst').addEventListener('click', () => {
    // day of the selected year with the most legal exceedances across visible stations (ties: highest PM10)
    const y = +state.day.slice(0, 4);
    const n = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? 366 : 365;
    let best = null;
    for (let i = 0; i < n; i++) {
      const day = toStr(new Date(Date.UTC(y, 0, 1 + i)));
      if (day > MAX_DAY) break;
      let cnt = 0, pm = 0;
      for (const st of STATIONS) if (state.visible.has(st.id)) for (const { lv, r, pcode } of stationDay(st, day).rows) { if (lv === 'law') cnt++; if (pcode === 'PM10' && r && r.v > pm) pm = r.v; }
      if (!best || cnt > best.cnt || (cnt === best.cnt && pm > best.pm)) best = { day, cnt, pm };
    }
    if (best) setDay(best.day);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,select,textarea')) return;
    if (e.key === 'ArrowLeft') { setDay(addDays(state.day, -1)); e.preventDefault(); }
    if (e.key === 'ArrowRight') { setDay(addDays(state.day, 1)); e.preventDefault(); }
  });

  // ---------- station list ----------
  const list = $('#stlist');
  function buildList() {
    list.innerHTML = '';
    for (const st of STATIONS) {
      const li = document.createElement('li'); li.dataset.id = st.id;
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.id = 'st-' + st.id; cb.checked = state.visible.has(st.id);
      cb.setAttribute('aria-label', 'Mostra ' + st.name);
      cb.addEventListener('change', () => { if (cb.checked) state.visible.add(st.id); else state.visible.delete(st.id); render(); });
      const box = document.createElement('div');
      const nm = document.createElement('div'); nm.className = 'nm';
      const dot = document.createElement('span'); dot.className = 'dot';
      nm.append(dot, document.createTextNode(st.name));
      nm.title = 'Seleziona per il grafico';
      nm.addEventListener('click', () => { state.sel = st.id; state.visible.add(st.id); cb.checked = true; render(); });
      const cm = document.createElement('div'); cm.className = 'cm'; cm.textContent = st.comune + ' · ' + st.quota + ' m s.l.m.' + (stationActive(st) ? '' : ' · dismessa');
      const pol = document.createElement('div'); pol.className = 'pol';
      const seen = new Set();
      for (const sid of st.sensors) {
        const p = SENS[sid].p; if (seen.has(p)) continue; seen.add(p);
        const t = document.createElement('span'); t.className = 'tag' + (st.sensors.some((s) => SENS[s].p === p && isActive(s)) ? '' : ' off');
        t.textContent = POLL[p].label; t.title = POLL[p].label + ' — dal ' + SENS[sid].start + (SENS[sid].stop ? ' al ' + SENS[sid].stop : '');
        pol.append(t);
      }
      box.append(nm, cm, pol); li.append(cb, box); list.append(li);
    }
  }
  function syncList() {
    for (const li of list.children) {
      const st = stById[li.dataset.id];
      li.classList.toggle('sel', st.id === state.sel);
      li.querySelector('.dot').style.background = levelColor(state.visible.has(st.id) ? stationDay(st, state.day).worst : null);
      li.querySelector('.dot').style.opacity = state.visible.has(st.id) ? 1 : 0.35;
    }
  }
  $('#st-all').addEventListener('click', () => { STATIONS.forEach((s) => state.visible.add(s.id)); list.querySelectorAll('input').forEach((c) => (c.checked = true)); render(); });
  $('#st-none').addEventListener('click', () => { state.visible.clear(); list.querySelectorAll('input').forEach((c) => (c.checked = false)); render(); });
  $('#st-active').addEventListener('click', () => { state.visible = new Set(STATIONS.filter(stationActive).map((s) => s.id)); list.querySelectorAll('input').forEach((c) => (c.checked = state.visible.has(+c.id.slice(3)))); render(); });

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true, attributionControl: true, scrollWheelZoom: true, zoomSnap: 0.25 });
  map.attributionControl.setPrefix('').addAttribution('Confini ISTAT · Dati ARPA Lombardia');
  const comuni = L.geoJSON(D.geo, { style: () => ({ color: css('--map-line'), weight: 0.8, fillColor: css('--map-fill'), fillOpacity: 1 }), interactive: false }).addTo(map);
  const prov = L.geoJSON(D.prov, { style: () => ({ color: css('--map-prov'), weight: 1.6, fill: false }), interactive: false }).addTo(map);
  // town labels: comuni with a station are labelled just below their marker(s); the others at the centroid
  const LABELS = { 'Pavia': 'Pavia', 'Vigevano': 'Vigevano', 'Voghera': 'Voghera', 'Mortara': 'Mortara', 'Stradella': 'Stradella', 'Broni': 'Broni', 'Casteggio': 'Casteggio', 'Garlasco': 'Garlasco', 'Varzi': 'Varzi', 'Sannazzaro de\' Burgondi': 'Sannazzaro', 'Belgioioso': 'Belgioioso', 'Cornale e Bastida': 'Cornale', 'Parona': 'Parona', 'Ferrera Erbognone': 'Ferrera E.', 'Mezzana Bigli': 'Mezzana B.' };
  const labelLayer = L.layerGroup().addTo(map);
  comuni.eachLayer((l) => {
    const n = l.feature.properties.name, txt = LABELS[n];
    if (!txt) return;
    const here = STATIONS.filter((s) => s.comune === n || (n === 'Cornale e Bastida' && s.comune === 'Cornale'));
    let pos, anchor;
    const w = txt.length * 6.4;
    if (here.length) { pos = [here.reduce((a, s) => a + s.lat, 0) / here.length, here.reduce((a, s) => a + s.lng, 0) / here.length]; anchor = [w / 2, -9]; }
    else { pos = l.getBounds().getCenter(); anchor = [w / 2, 6]; }
    L.marker(pos, { icon: L.divIcon({ className: 'cl', html: txt, iconSize: null, iconAnchor: anchor }), interactive: false, keyboard: false }).addTo(labelLayer);
  });
  // sfondo OpenStreetMap opzionale (spento di default: le tile sono l'unica risorsa esterna pesante)
  const osmBox = $('#osm');
  let osm = null;
  function syncOsm() {
    const on = osmBox.checked;
    if (on) {
      if (!osm) osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' });
      if (!map.hasLayer(osm)) osm.addTo(map);
      osm.bringToBack();
      comuni.setStyle({ fillOpacity: 0.04, weight: 0.6 });
      labelLayer.remove();
    } else {
      if (osm && map.hasLayer(osm)) map.removeLayer(osm);
      comuni.setStyle({ fillOpacity: 1, weight: 0.8 });
      labelLayer.addTo(map);
    }
  }
  osmBox.addEventListener('change', () => { state.osm = osmBox.checked; syncOsm(); persist(); });
  const bounds = prov.getBounds();
  map.fitBounds(bounds, { padding: [10, 10] });
  map.setMinZoom(map.getZoom() - 0.5);
  map.setMaxBounds(bounds.pad(0.6));
  const markers = {};
  for (const st of STATIONS) {
    const m = L.circleMarker([st.lat, st.lng], { radius: 8, weight: 2, color: css('--surface'), fillOpacity: 1, fillColor: css('--muted') }).addTo(map);
    m.bindTooltip(st.name, { direction: 'top', offset: [0, -8], opacity: 1 });
    m.on('click', () => { state.sel = st.id; render(); m.bindPopup(popupHtml(st)).openPopup(); });
    markers[st.id] = m;
  }
  function popupHtml(st) {
    const { rows } = stationDay(st, state.day);
    const tr = rows.filter((r) => r.r).map((r) => `<tr><td>${POLL[r.pcode].label} <span style="color:var(--muted)">${SENS[r.sid].unit}</span></td><td class="v ${r.lv === 'law' ? 'over' : r.lv === 'who' ? 'who' : ''}">${fmtV(r.r.v, r.pcode)}</td></tr>`).join('');
    return `<div class="pop"><h3>${st.name}</h3><div class="cm">${st.comune} · ${fmtLong(state.day)}</div>${tr ? '<table>' + tr + '</table>' : '<div class="cm">Nessun dato in questa data.</div>'}</div>`;
  }
  function syncMap() {
    for (const st of STATIONS) {
      const m = markers[st.id];
      const vis = state.visible.has(st.id);
      if (vis && !map.hasLayer(m)) m.addTo(map);
      if (!vis && map.hasLayer(m)) map.removeLayer(m);
      if (!vis) continue;
      const { worst } = stationDay(st, state.day);
      const sel = st.id === state.sel;
      m.setStyle({ fillColor: levelColor(worst), fillOpacity: worst ? 1 : 0.55, radius: sel ? 10 : 7, color: sel ? css('--ink') : css('--surface'), weight: sel ? 2.5 : 2 });
      if (sel) m.bringToFront();
      if (m.isPopupOpen()) m.setPopupContent(popupHtml(st));
    }
    comuni.setStyle({ color: css('--map-line'), fillColor: css('--map-fill'), fillOpacity: osmBox.checked ? 0.04 : 1 });
    prov.setStyle({ color: css('--map-prov') });
  }

  // ---------- values table ----------
  const table = $('#vals');
  function syncTable() {
    const vis = STATIONS.filter((s) => state.visible.has(s.id));
    const cols = D.order.filter((p) => vis.some((st) => st.sensors.some((sid) => SENS[sid].p === p)));
    if (!vis.length) { table.innerHTML = '<tr><td class="empty">Nessuna centralina selezionata.</td></tr>'; $('#thr').innerHTML = ''; return; }
    let h = '<thead><tr><th>Centralina</th>' + cols.map((p) => `<th>${POLL[p].label}<small>${metricLabel(p)}</small></th>`).join('') + '</tr></thead><tbody>';
    for (const st of vis) {
      const { rows } = stationDay(st, state.day);
      h += `<tr data-id="${st.id}" class="${st.id === state.sel ? 'sel' : ''}" tabindex="0"><td>${st.name}<span class="cm">${st.comune}</span></td>`;
      for (const p of cols) {
        const cand = rows.filter((r) => r.pcode === p);
        if (!cand.length) { h += '<td class="na">·</td>'; continue; }
        const r = cand.find((c) => c.r) || cand[0];
        if (!r.r || r.r.v == null) { h += '<td class="v nd">—</td>'; continue; }
        const cls = 'v' + (r.lv === 'law' ? ' over' : r.lv === 'who' ? ' who' : '') + (r.r.partial ? ' partial' : '');
        const title = `${POLL[p].label} ${metricLabel(p)}: ${fmtV(r.r.v, p)} ${SENS[r.sid].unit}` + (POLL[p].metric !== 'a' ? ` · media ${fmtV(r.r.mean, p)}` : '') + (r.lv === 'law' ? ' · oltre il limite di legge' : r.lv === 'who' ? ' · oltre il riferimento OMS' : '');
        h += `<td class="${cls}" title="${title}">${fmtV(r.r.v, p)}</td>`;
      }
      h += '</tr>';
    }
    table.innerHTML = h + '</tbody>';
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const go = () => { state.sel = +tr.dataset.id; render(); };
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { go(); e.preventDefault(); } });
    });
    $('#thr').innerHTML = cols.map((p) => `<div><b>${POLL[p].label}</b> · ${POLL[p].desc}</div>`).join('');
  }
  const metricLabel = (p) => POLL[p].metric === 'm' ? 'max orario' : POLL[p].metric === 'x' ? 'max media 8 h' : 'media giorno';

  // ---------- header summary ----------
  function syncToday() {
    const vis = STATIONS.filter((s) => state.visible.has(s.id));
    let law = 0, who = 0, nd = 0, cells = 0;
    for (const st of vis) { const { worst, rows } = stationDay(st, state.day); if (worst === 'law') law++; else if (worst === 'who') who++; else if (!worst) nd++; cells += rows.filter((r) => r.lv === 'law').length; }
    $('#today').innerHTML =
      `<div><div class="k">${fmtLong(state.day)}</div><div class="v ${law ? 'crit' : who ? 'warn' : ''}">${law} <span style="font-size:13px;font-weight:500">su ${vis.length} centraline oltre i limiti</span></div></div>` +
      `<div><div class="k">Superamenti di legge</div><div class="v ${cells ? 'crit' : ''}">${cells}</div></div>` +
      `<div><div class="k">Oltre riferimento OMS</div><div class="v ${who ? 'warn' : ''}">${who}</div></div>` +
      `<div><div class="k">Senza dati</div><div class="v">${nd}</div></div>`;
  }

  // ---------- chart ----------
  let chart = null;
  const perButtons = document.querySelectorAll('.seg button');
  perButtons.forEach((b) => b.addEventListener('click', () => { state.per = b.dataset.per; render(); }));
  function periodDays(day, per) {
    const d = toDate(day);
    let start, end;
    if (per === 'week') { const dow = (d.getUTCDay() + 6) % 7; start = addDays(day, -dow); end = addDays(start, 6); }
    else if (per === 'month') { const y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; start = `${y}-${pad(m)}-01`; end = `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`; }
    else { const y = d.getUTCFullYear(); start = `${y}-01-01`; end = `${y}-12-31`; }
    const days = []; for (let s = start; s <= end; s = addDays(s, 1)) days.push(s);
    return days;
  }
  // dati della serie per una stazione+inquinante+periodo, indipendenti dal tema o dal rendering:
  // usati sia dal grafico a schermo sia dal report PDF, per non duplicare (e disallineare) il calcolo.
  function buildSeries(st, pcode, per, day) {
    const p = POLL[pcode];
    const sids = st.sensors.filter((sid) => SENS[sid].p === pcode);
    const unit = SENS[sids[0]].unit;
    const days = periodDays(day, per);
    const vals = days.map((d) => { for (const sid of sids) { const r = reading(sid, d); if (r && r.v != null) return r.v; } return null; });
    const n = vals.filter((v) => v != null).length;
    const over = vals.filter((v) => v != null && p.limit != null && v > p.limit).length;
    const max = n ? Math.max(...vals.filter((v) => v != null)) : null;
    const mean = n ? vals.filter((v) => v != null).reduce((a, b) => a + b, 0) / n : null;
    return { p, pcode, sids, unit, days, vals, n, over, max, mean };
  }
  // config Chart.js per una serie; colors è un set di colori concreti (tema a schermo, o palette fissa per il PDF).
  // opts.responsive=false è usato per il canvas offscreen del report: dimensioni fisse, niente ResizeObserver.
  function buildChartConfig(series, day, per, colors, opts) {
    opts = opts || {};
    const { p, pcode, unit, days, vals, n } = series;
    const overColor = p.kind === 'oms' ? colors.warn : colors.crit;
    const isYear = per === 'year';
    const selIdx = days.indexOf(day);
    const pointColors = vals.map((v, i) => (v != null && p.limit != null && v > p.limit) ? overColor : (i === selIdx ? colors.ink : colors.accent));
    const pointRadius = vals.map((v, i) => i === selIdx ? 5 : (v != null && p.limit != null && v > p.limit) ? (isYear ? 2.5 : 4) : (isYear ? 0 : 3));
    const datasets = [{
      label: p.label + ' (' + metricLabel(pcode) + ')', data: vals, borderColor: colors.accent, backgroundColor: colors.accent, borderWidth: 2, tension: 0.15, spanGaps: false,
      pointRadius, pointHoverRadius: 6, pointBackgroundColor: pointColors, pointBorderColor: pointColors, fill: false,
    }];
    if (p.limit != null) datasets.push({ label: (p.kind === 'legge' ? 'Limite di legge' : 'Riferimento OMS') + ' ' + p.limit, data: days.map(() => p.limit), borderColor: overColor, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false });
    const labels = days.map((d) => isYear ? d : fmtShort(d));
    const cfg = {
      type: 'line', data: { labels, datasets },
      options: {
        responsive: opts.responsive !== false, maintainAspectRatio: false, animation: false, devicePixelRatio: opts.responsive === false ? 1 : undefined, interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { color: colors.ink2, boxWidth: 18, boxHeight: 2, usePointStyle: false, font: { family: '"IBM Plex Sans", system-ui, sans-serif', size: 12 } } },
          tooltip: {
            backgroundColor: colors.surface, titleColor: colors.ink, bodyColor: colors.ink2, borderColor: colors.lineStrong, borderWidth: 1, padding: 8,
            titleFont: { family: '"IBM Plex Sans", system-ui, sans-serif', weight: '600' }, bodyFont: { family: '"IBM Plex Mono", monospace' },
            callbacks: {
              title: (items) => fmtLong(days[items[0].dataIndex]),
              label: (it) => it.datasetIndex === 0 ? (it.raw == null ? 'nessun dato' : ` ${fmtV(it.raw, pcode)} ${unit}` + (p.limit != null && it.raw > p.limit ? '  ▲ oltre ' + p.limit : '')) : null,
            },
            filter: (it) => it.datasetIndex === 0,
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: colors.lineStrong }, ticks: { color: colors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: isYear ? 12 : per === 'month' ? 16 : 7, font: { family: '"IBM Plex Mono", monospace', size: 11 },
            callback: (v, i) => isYear ? (days[i].endsWith('-01') ? MONTHS[+days[i].slice(5, 7) - 1].slice(0, 3) : null) : labels[i] } },
          y: { beginAtZero: true, grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.muted, font: { family: '"IBM Plex Mono", monospace', size: 11 } }, title: { display: true, text: unit, color: colors.muted, font: { size: 11 } } },
        },
        onClick: (e, els) => { if (els.length) { const d = days[els[0].index]; if (d >= MIN_DAY && d <= MAX_DAY) setDay(d); } },
      },
    };
    if (isYear) cfg.options.scales.x.ticks.autoSkip = false;
    return cfg;
  }
  function themeColors() {
    return { accent: css('--accent'), crit: css('--crit'), warn: css('--warn'), muted: css('--muted'), grid: css('--line'), lineStrong: css('--line-strong'), ink: css('--ink'), ink2: css('--ink-2'), surface: css('--surface') };
  }
  function syncChart() {
    const tabs = $('#poltabs'); tabs.innerHTML = '';
    // il grafico segue le centraline visibili: se quella selezionata è nascosta passa alla prima visibile
    if (!state.visible.has(state.sel)) state.sel = STATIONS.find((s) => state.visible.has(s.id))?.id ?? null;
    const st = stById[state.sel];
    if (!st) {
      $('#h-chart').textContent = 'Andamento';
      $('#chart-range').textContent = ''; $('#stats').innerHTML = '';
      const empty = $('#chart-empty'), box = $('.chartbox');
      empty.hidden = false; empty.textContent = 'Seleziona almeno una centralina per vedere l\'andamento.'; box.hidden = true;
      if (chart) { chart.destroy(); chart = null; }
      return;
    }
    const pcodes = D.order.filter((p) => st.sensors.some((sid) => SENS[sid].p === p));
    if (!pcodes.includes(state.pol)) state.pol = pcodes[0];
    for (const p of pcodes) {
      const b = document.createElement('button'); b.className = 'chip'; b.setAttribute('role', 'tab'); b.setAttribute('aria-pressed', p === state.pol); b.textContent = POLL[p].label;
      b.addEventListener('click', () => { state.pol = p; render(); }); tabs.append(b);
    }
    perButtons.forEach((b) => b.setAttribute('aria-pressed', b.dataset.per === state.per));
    const series = buildSeries(st, state.pol, state.per, state.day);
    const { p, unit, days, n, over, max, mean } = series;
    $('#h-chart').textContent = 'Andamento — ' + st.name;
    $('#chart-range').textContent = fmtShort(days[0]) + ' – ' + fmtShort(days[days.length - 1]) + ' ' + days[0].slice(0, 4);
    $('#stats').innerHTML =
      `<span>Giorni con dati <b>${n}/${days.length}</b></span>` +
      `<span>Media del periodo <b>${mean == null ? '—' : fmtV(mean, state.pol)}</b> ${unit}</span>` +
      `<span>Massimo <b>${max == null ? '—' : fmtV(max, state.pol)}</b> ${unit}</span>` +
      (p.limit != null ? `<span>Giorni oltre ${p.kind === 'legge' ? 'il limite' : 'il riferimento OMS'} (${p.limit}) <b class="${over ? 'crit' : ''}">${over}</b></span>` : '<span>Nessuna soglia giornaliera</span>');
    const empty = $('#chart-empty'), box = $('.chartbox');
    if (!n) { empty.hidden = false; empty.textContent = 'Nessun dato per ' + p.label + ' a ' + st.name + ' in questo periodo.'; box.hidden = true; if (chart) { chart.destroy(); chart = null; } return; }
    empty.hidden = true; box.hidden = false;
    const cfg = buildChartConfig(series, state.day, state.per, themeColors());
    if (chart) { chart.config.data = cfg.data; chart.config.options = cfg.options; chart.update(); } else chart = new Chart($('#chart'), cfg);
  }

  // ---------- report PDF ----------
  // palette fissa (chiara), indipendente dal tema del visitatore: il PDF deve restare leggibile
  // qualunque sia il tema a schermo, quindi non usa le variabili CSS ma valori concreti.
  const LIGHT = { accent: '#1f6f8b', crit: '#c4372f', critSoft: '#f8e1de', critInk: '#8f2721', warn: '#b8770a', warnSoft: '#f8ecd2', warnInk: '#7d5006', muted: '#7a8189', grid: '#d9ddd6', lineStrong: '#b9bfb8', ink: '#161a1d', ink2: '#4b535c', surface: '#fbfbfa' };
  const reportState = { station: null, pols: new Set() };
  let pdfLibsPromise = null;
  function loadPdfLibs() {
    if (pdfLibsPromise) return pdfLibsPromise;
    pdfLibsPromise = new Promise((resolve, reject) => {
      const s1 = document.createElement('script'); s1.src = 'vendor/jspdf.umd.min.js';
      s1.onerror = () => reject(new Error('jspdf'));
      s1.onload = () => {
        const s2 = document.createElement('script'); s2.src = 'vendor/jspdf.plugin.autotable.min.js';
        s2.onerror = () => reject(new Error('autotable'));
        s2.onload = resolve;
        document.head.append(s2);
      };
      document.head.append(s1);
    });
    return pdfLibsPromise;
  }
  const repPolsBox = $('#rep-pols'), repGo = $('#rep-go'), repStatus = $('#rep-status');
  function syncReportPanel() {
    const st = stById[state.sel];
    repPolsBox.innerHTML = '';
    if (!st) { repGo.disabled = true; return; }
    const pcodes = D.order.filter((p) => st.sensors.some((sid) => SENS[sid].p === p));
    const sameStation = reportState.station === st.id;
    for (const p of pcodes) {
      const label = document.createElement('label'); label.className = 'rep-check';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = p;
      cb.checked = sameStation ? reportState.pols.has(p) : p === state.pol;
      cb.addEventListener('change', () => { if (cb.checked) reportState.pols.add(p); else reportState.pols.delete(p); });
      label.append(cb, document.createTextNode(' ' + POLL[p].label));
      repPolsBox.append(label);
    }
    reportState.station = st.id;
    reportState.pols = new Set(pcodes.filter((p) => sameStation ? reportState.pols.has(p) : p === state.pol));
    repGo.disabled = false;
  }
  function nextFrame() { return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  async function renderChartImage(series, day, per) {
    if (!series.n) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1500; canvas.height = 560;
    canvas.style.width = '1500px'; canvas.style.height = '560px';
    canvas.style.position = 'fixed'; canvas.style.left = '-9999px'; canvas.style.top = '0';
    document.body.append(canvas);
    const cfg = buildChartConfig(series, day, per, LIGHT, { responsive: false });
    const ch = new Chart(canvas, cfg);
    await nextFrame();
    const img = ch.toBase64Image('image/png', 1);
    ch.destroy(); canvas.remove();
    return img;
  }
  const slugify = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  // il font "helvetica" standard di jsPDF (non incorporato) non rende alcuni caratteri Unicode:
  // µ e ³ restano invisibili, i pedici ₂ ₃ ₓ vengono sostituiti con glifi sbagliati. Si sostituiscono
  // con equivalenti ASCII solo nel testo destinato al PDF (a schermo restano quelli tipografici corretti).
  const pdfSafe = (s) => String(s).replace(/µ/g, 'u').replace(/³/g, '3').replace(/₂/g, '2').replace(/₃/g, '3').replace(/ₓ/g, 'x');
  async function buildReportPdf() {
    const st = stById[state.sel];
    if (!st || !reportState.pols.size) { repStatus.textContent = 'Seleziona almeno un inquinante.'; return; }
    const pcodes = D.order.filter((p) => st.sensors.some((sid) => SENS[sid].p === p)).filter((p) => reportState.pols.has(p));
    const blocks = { chart: $('#rep-chart').checked, table: $('#rep-table').checked, count: $('#rep-count').checked, meta: $('#rep-meta').checked };
    const prevLabel = repGo.textContent;
    repGo.disabled = true; repGo.textContent = 'Generazione…'; repStatus.textContent = '';
    try {
      await loadPdfLibs();
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
      const pageW = doc.internal.pageSize.getWidth();
      const M = 40; let y = M;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(LIGHT.ink);
      doc.text('Aria del Pavese', M, y); y += 20;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(LIGHT.ink2);
      doc.text(st.name + ' — ' + st.comune, M, y); y += 16;
      const days0 = periodDays(state.day, state.per);
      const perLabel = state.per === 'week' ? 'Settimana' : state.per === 'month' ? 'Mese' : 'Anno';
      doc.text(perLabel + ': ' + fmtLong(days0[0]) + ' – ' + fmtLong(days0[days0.length - 1]), M, y); y += 16;
      doc.setFontSize(9); doc.setTextColor(LIGHT.muted);
      doc.text('Generato il ' + new Date().toISOString().slice(0, 10) + ' · dati ARPA scaricati il ' + D.generated.slice(0, 10), M, y); y += 14;
      if (blocks.meta) {
        const note = 'Fonte: ARPA Lombardia, open data su dati.lombardia.it, licenza CC0 1.0 (pubblico dominio), attribuzione «ARPA LOMBARDIA». Sono usati solo i valori con stato «validato» (VA). I limiti sono quelli del D.Lgs. 155/2010; per il PM2.5, che ha solo un limite annuale, la soglia giornaliera mostrata è la linea guida OMS 2021 (15 µg/m³) e non un limite di legge. Le aggregazioni giornaliere e i conteggi dei superamenti sono elaborazioni proprie di questo progetto indipendente, non affiliato ad ARPA Lombardia; per usi ufficiali fare riferimento ad ARPA. Sito: danbas.github.io/aria-del-pavese/';
        const lines = doc.splitTextToSize(pdfSafe(note), pageW - 2 * M);
        doc.setFontSize(8.5); doc.text(lines, M, y); y += lines.length * 10 + 6;
      }
      doc.setDrawColor(LIGHT.grid); doc.line(M, y, pageW - M, y); y += 18;

      for (let i = 0; i < pcodes.length; i++) {
        if (i > 0) { doc.addPage(); y = M; }
        const series = buildSeries(st, pcodes[i], state.per, state.day);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(LIGHT.ink);
        doc.text(pdfSafe(series.p.label) + ' (' + metricLabel(pcodes[i]) + ')', M, y); y += 18;
        if (!series.n) {
          doc.setFont('helvetica', 'italic'); doc.setFontSize(10); doc.setTextColor(LIGHT.muted);
          doc.text('Nessun dato disponibile per questo inquinante nel periodo selezionato.', M, y); y += 20;
          continue;
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(LIGHT.ink2);
        const unit = pdfSafe(series.unit);
        const parts = [
          'Giorni con dati: ' + series.n + '/' + series.days.length,
          'Media: ' + (series.mean == null ? '—' : fmtV(series.mean, pcodes[i])) + ' ' + unit,
          'Massimo: ' + (series.max == null ? '—' : fmtV(series.max, pcodes[i])) + ' ' + unit,
        ];
        if (blocks.count && series.p.limit != null) parts.push('Giorni oltre ' + (series.p.kind === 'legge' ? 'il limite' : 'il riferimento OMS') + ' (' + series.p.limit + '): ' + series.over);
        doc.text(parts.join('   ·   '), M, y); y += 16;
        if (blocks.chart) {
          const img = await renderChartImage(series, state.day, state.per);
          if (img) { doc.addImage(img, 'PNG', M, y, pageW - 2 * M, 150); y += 164; }
        }
        if (blocks.table) {
          const rows = series.days.map((d, idx) => {
            const v = series.vals[idx];
            const lv = (v != null && series.p.limit != null && v > series.p.limit) ? (series.p.kind === 'legge' ? 'law' : 'who') : null;
            return { cells: [fmtLong(d), v == null ? '—' : fmtV(v, pcodes[i]) + ' ' + unit, lv === 'law' ? 'Oltre il limite di legge' : lv === 'who' ? 'Oltre il riferimento OMS' : ''], lv };
          });
          doc.autoTable({
            startY: y, margin: { left: M, right: M },
            head: [['Data', 'Valore', 'Esito']],
            body: rows.map((r) => r.cells),
            styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 3, textColor: LIGHT.ink2 },
            headStyles: { fillColor: LIGHT.ink, textColor: '#ffffff', fontStyle: 'bold' },
            didParseCell: (data) => {
              if (data.section !== 'body') return;
              const lv = rows[data.row.index].lv;
              if (lv === 'law') { data.cell.styles.fillColor = LIGHT.critSoft; data.cell.styles.textColor = LIGHT.critInk; data.cell.styles.fontStyle = 'bold'; }
              else if (lv === 'who') { data.cell.styles.fillColor = LIGHT.warnSoft; data.cell.styles.textColor = LIGHT.warnInk; data.cell.styles.fontStyle = 'bold'; }
            },
          });
          y = doc.lastAutoTable.finalY + 16;
        }
      }

      const fname = 'aria-pavese_' + slugify(st.name) + '_' + state.per + '_' + state.day + '.pdf';
      doc.save(fname);
      repStatus.textContent = 'PDF generato: ' + fname;
    } catch (e) {
      console.error(e);
      repStatus.textContent = 'Errore nella generazione del PDF. Riprova.';
    } finally {
      repGo.disabled = false; repGo.textContent = prevLabel;
    }
  }
  repGo.addEventListener('click', buildReportPdf);

  // ---------- render ----------
  function render() {
    syncDateControls(); syncToday(); syncList(); syncMap(); syncTable(); syncChart(); syncReportPanel(); persist();
  }
  $('#gen').textContent = 'Dati scaricati il ' + D.generated.replace('T', ' alle ').replace('Z', ' UTC') + '.';
  buildList();
  osmBox.checked = state.osm;
  syncOsm();
  render();
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', render);
  new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', () => map.invalidateSize());
})();
