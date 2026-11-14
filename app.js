/* 가축방역 상황실 현황판 화면 */
(function () {
  'use strict';

  // 질병 분류. core=true 는 방역대를 그리고 경보 단계를 정하는 주요 질병.
  // match 는 API 의 질병명(LKNTS_NM)에 들어 있는 글자. 실제 이름 예: 럼피스킨병, 고병원성조류인플루엔자,
  // 아프리카돼지열병, 결핵병, 브루셀라병. 나머지(돼지생식기호흡기증후군, 낭충봉아부패병 등)는 기타.
  var GROUPS = [
    { id: 'fmd', name: '구제역', token: '--d-fmd', shape: 'circle', core: true, match: ['구제역'] },
    { id: 'hpai', name: '고병원성 AI', token: '--d-hpai', shape: 'triangle', core: true, match: ['고병원성'] },
    { id: 'asf', name: '아프리카돼지열병', token: '--d-asf', shape: 'square', core: true, match: ['아프리카돼지열병'] },
    { id: 'lsd', name: '럼피스킨', token: '--d-lsd', shape: 'diamond', core: true, match: ['럼피스킨'] },
    { id: 'tb', name: '결핵', token: '--d-tb', shape: 'dot', core: false, match: ['결핵'] },
    { id: 'bru', name: '브루셀라', token: '--d-bru', shape: 'dot', core: false, match: ['브루셀라'] },
    { id: 'etc', name: '기타 전염병', token: '--d-etc', shape: 'dot', core: false, match: [] }
  ];
  var ZONE_DAYS = 30;          // 방역대와 경보 단계를 보는 기간
  var WATCH_KM = 50;           // 주의: 도내 또는 50km 안
  var ALERT_KM = 10;           // 비상: 관내 또는 10km 안
  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 3 * 60 * 60 * 1000;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var state = { days: 30, shown: {}, data: null, map: null, layer: null, markers: {} };
  GROUPS.forEach(function (g) { state.shown[g.id] = g.core; });
  try {
    var saved = JSON.parse(localStorage.getItem('dash') || '{}');
    if ([30, 90, 365].indexOf(saved.days) >= 0) state.days = saved.days;
    if (saved.shown) Object.keys(saved.shown).forEach(function (k) { if (k in state.shown) state.shown[k] = !!saved.shown[k]; });
  } catch (e) { /* 저장값이 없어도 동작 */ }

  function save() {
    try { localStorage.setItem('dash', JSON.stringify({ days: state.days, shown: state.shown })); } catch (e) { /* 무시 */ }
  }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svg(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    return e;
  }
  var css = getComputedStyle(document.documentElement);
  function token(name) { return css.getPropertyValue(name).trim(); }
  GROUPS.forEach(function (g) { g.color = token(g.token); });

  function groupOf(name) {
    name = name || '';
    if (name.indexOf('저병원성') >= 0) return GROUPS[GROUPS.length - 1];
    for (var i = 0; i < GROUPS.length - 1; i++) {
      for (var j = 0; j < GROUPS[i].match.length; j++) {
        if (name.indexOf(GROUPS[i].match[j]) >= 0) return GROUPS[i];
      }
    }
    return GROUPS[GROUPS.length - 1];
  }

  // 질병 모양 아이콘 (색과 모양을 함께 써서 구분)
  function shapeIcon(g, size, faded) {
    var s = size, h = s / 2, w = Math.max(1.5, s / 9);
    var box = svg('svg', { width: s, height: s, viewBox: '0 0 ' + s + ' ' + s, 'aria-hidden': 'true', 'class': 'shape' });
    var m = w / 2 + 0.5, node;
    if (g.shape === 'circle') node = svg('circle', { cx: h, cy: h, r: h - m });
    else if (g.shape === 'triangle') node = svg('polygon', { points: [h, m + 0.5, s - m, s - m, m, s - m].join(' ') });
    else if (g.shape === 'square') node = svg('rect', { x: m + 1, y: m + 1, width: s - 2 * m - 2, height: s - 2 * m - 2, rx: 1.5 });
    else if (g.shape === 'diamond') node = svg('polygon', { points: [h, m, s - m, h, h, s - m, m, h].join(' ') });
    else node = svg('circle', { cx: h, cy: h, r: h * 0.62 });
    node.setAttribute('fill', g.color);
    node.setAttribute('stroke', token('--marker-edge'));
    node.setAttribute('stroke-width', w);
    node.setAttribute('stroke-linejoin', 'round');
    if (faded) node.setAttribute('fill-opacity', '0.5');
    box.appendChild(node);
    return box;
  }

  function today0() { var t = new Date(); t.setHours(0, 0, 0, 0); return t; }
  function daysAgo(iso) { return Math.round((today0() - new Date(iso + 'T00:00:00')) / 86400000); }
  function km(a, b, c, d) {
    var R = 6371, p = Math.PI / 180;
    var x = Math.sin((c - a) * p / 2), y = Math.sin((d - b) * p / 2);
    var hh = x * x + Math.cos(a * p) * Math.cos(c * p) * y * y;
    return 2 * R * Math.asin(Math.sqrt(hh));
  }
  function fmtKm(v) { return v < 10 ? v.toFixed(1) + 'km' : Math.round(v) + 'km'; }
  function md(iso) { return Number(iso.slice(5, 7)) + '월\u00a0' + Number(iso.slice(8, 10)) + '일'; }
  function shortDate(iso) { return iso.slice(5).replace('-', '.'); }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // 받침에 따라 조사 고르기 (예: 럼피스킨이, 고병원성 AI가)
  function josa(word, withFinal, noFinal) {
    var c = word.charCodeAt(word.length - 1);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 ? withFinal : noFinal;
    return /[lmnr0136789]$/i.test(word) ? withFinal : noFinal;
  }
  function periodName(days) { return days === 365 ? '최근 1년' : '최근 ' + days + '일'; }

  // ---------------------------------------------------------------- 지도
  function initMap(home) {
    // 시청 동쪽은 바다라서, 시청이 지도 오른쪽에 오도록 중심을 서쪽으로 옮긴다
    state.map = L.map('map', { zoomControl: true, attributionControl: true }).setView([home.lat + 0.15, home.lng - 0.75], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, attribution: '&copy; OpenStreetMap 기여자'
    }).addTo(state.map);
    L.circle([home.lat, home.lng], {
      radius: WATCH_KM * 1000, color: token('--map-ink'), weight: 2, opacity: 0.75, dashArray: '10 8',
      fill: false, interactive: false
    }).addTo(state.map);
    var pin = el('div', 'home-pin', home.name + '청');
    L.marker([home.lat, home.lng], {
      icon: L.divIcon({ className: '', html: pin, iconSize: null, iconAnchor: [0, 0] }),
      interactive: false, zIndexOffset: 2000, keyboard: false
    }).addTo(state.map);
    state.layer = L.layerGroup().addTo(state.map);
  }

  function popup(it) {
    var box = el('div');
    box.appendChild(el('b', null, it.disease));
    var lines = [
      '발생일 ' + it.date + (it.end ? ', 종식 ' + it.end : ''),
      it.addr,
      it.species ? it.species + (Number(it.count) > 0 ? ' ' + Number(it.count).toLocaleString('ko-KR') + '마리' : '') : '',
      it.farm ? '농장 ' + it.farm : '',
      it.km != null ? '시청에서 ' + fmtKm(it.km) : '',
      it.geo === 'area' ? '읍면동 중심 좌표라 실제 위치와 다를 수 있습니다' : ''
    ];
    lines.filter(Boolean).forEach(function (t) { box.appendChild(el('div', null, t)); });
    return box;
  }

  function drawMap(shown) {
    state.layer.clearLayers();
    state.markers = {};
    var zone = token('--zone');
    // 오래된 것부터 그려 최근 발생이 위에 오도록
    shown.slice().reverse().forEach(function (it) {
      if (it.lat == null || it.lng == null) return;
      var g = it.g, fresh = it.ago < ZONE_DAYS;
      if (g.core && fresh && !it.end) {
        [[10000, 0.04, '6 6', 1], [3000, 0.08, null, 1.5], [500, 0.3, null, 1]].forEach(function (z) {
          L.circle([it.lat, it.lng], {
            radius: z[0], color: zone, weight: z[3], opacity: 0.75, dashArray: z[2],
            fillColor: zone, fillOpacity: z[1], interactive: false
          }).addTo(state.layer);
        });
      }
      var size = g.core ? 22 : 14;
      var icon = shapeIcon(g, size, !fresh);
      icon.setAttribute('class', 'mk');
      var m = L.marker([it.lat, it.lng], {
        icon: L.divIcon({ className: '', html: icon, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        zIndexOffset: g.core ? 500 : 0, title: it.disease + ' ' + it.date, alt: it.disease
      }).bindPopup(popup(it)).addTo(state.layer);
      state.markers[it.id] = m;
    });
  }

  // ---------------------------------------------------------------- 막대그래프
  function buckets(days) {
    var t = today0(), out = [], i;
    if (days === 30) {
      for (i = days - 1; i >= 0; i--) {
        var d = new Date(t); d.setDate(t.getDate() - i);
        out.push({ from: i, to: i, label: (d.getMonth() + 1) + '/' + d.getDate(), title: md(isoOf(d)), mark: i % 5 === 0 });
      }
    } else if (days === 90) {
      for (i = 12; i >= 0; i--) {
        var end = new Date(t); end.setDate(t.getDate() - i * 7);
        var start = new Date(end); start.setDate(end.getDate() - 6);
        out.push({ from: i * 7 + 6, to: i * 7, label: (start.getMonth() + 1) + '/' + start.getDate(),
          title: md(isoOf(start)) + '부터 ' + md(isoOf(end)) + '까지', mark: i % 2 === 0 });
      }
    } else {
      for (i = 11; i >= 0; i--) {
        var m0 = new Date(t.getFullYear(), t.getMonth() - i, 1);
        out.push({ month: m0.getFullYear() * 12 + m0.getMonth(), label: (m0.getMonth() + 1) + '월',
          title: m0.getFullYear() + '년 ' + (m0.getMonth() + 1) + '월', mark: true });
      }
    }
    return out;
  }

  function drawChart(shown) {
    var box = $('chart'), tip = $('tip');
    box.textContent = '';
    tip.hidden = true;
    var titles = { 30: '날짜별 발생 건수', 90: '주별 발생 건수', 365: '월별 발생 건수' };
    $('chartTitle').textContent = titles[state.days];
    $('chartNote').textContent = '왼쪽에서 켜 둔 질병만 쌓아서 표시';

    var bs = buckets(state.days);
    var groups = GROUPS.filter(function (g) { return state.shown[g.id]; });
    bs.forEach(function (b) { b.n = {}; b.total = 0; groups.forEach(function (g) { b.n[g.id] = 0; }); });
    shown.forEach(function (it) {
      var b = null, i;
      if (state.days === 365) {
        var key = Number(it.date.slice(0, 4)) * 12 + Number(it.date.slice(5, 7)) - 1;
        for (i = 0; i < bs.length; i++) if (bs[i].month === key) { b = bs[i]; break; }
      } else {
        for (i = 0; i < bs.length; i++) if (it.ago <= bs[i].from && it.ago >= bs[i].to) { b = bs[i]; break; }
      }
      if (b && it.g.id in b.n) { b.n[it.g.id]++; b.total++; }
    });

    var W = Math.max(box.clientWidth, 200), H = box.clientHeight || 168;
    var left = 36, right = 4, top = 8, bottom = 24;
    var plotW = W - left - right, plotH = H - top - bottom;
    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': titles[state.days] });
    var max = 0;
    bs.forEach(function (b) { if (b.total > max) max = b.total; });
    var step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 20 : Math.ceil(max / 4 / 50) * 50;
    var ceil = Math.max(step, Math.ceil(max / step) * step);
    for (var v = 0; v <= ceil; v += step) {
      var y = top + plotH - (v / ceil) * plotH;
      root.appendChild(svg('line', { x1: left, x2: W - right, y1: y, y2: y, 'class': 'grid' }));
      var lab = svg('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', 'class': 'axis' });
      lab.textContent = String(v);
      root.appendChild(lab);
    }
    var slot = plotW / bs.length;
    var bw = Math.min(24, Math.max(4, slot - 4));
    bs.forEach(function (b, i) {
      var x = left + i * slot + (slot - bw) / 2, y0 = top + plotH;
      groups.forEach(function (g) {
        var n = b.n[g.id];
        if (!n) return;
        var hgt = (n / ceil) * plotH;
        y0 -= hgt;
        root.appendChild(svg('rect', { x: x, y: y0, width: bw, height: Math.max(hgt - 1, 1), fill: g.color }));
      });
      if (b.mark) {
        var t = svg('text', { x: left + i * slot + slot / 2, y: H - 6, 'text-anchor': 'middle', 'class': 'axis' });
        t.textContent = b.label;
        root.appendChild(t);
      }
      var hit = svg('rect', { x: left + i * slot, y: top, width: slot, height: plotH, 'class': 'hit' });
      hit.addEventListener('mouseenter', function (e) { showTip(b, groups, e); });
      hit.addEventListener('mousemove', moveTip);
      hit.addEventListener('mouseleave', function () { tip.hidden = true; });
      root.appendChild(hit);
    });
    if (!max) {
      var none = svg('text', { x: left + plotW / 2, y: top + plotH / 2, 'text-anchor': 'middle', 'class': 'none' });
      none.textContent = groups.length ? '이 기간에 켜 둔 질병의 발생이 없습니다' : '왼쪽 목록에서 표시할 질병을 켜 주세요';
      root.appendChild(none);
    }
    box.appendChild(root);
  }

  function showTip(b, groups, e) {
    var tip = $('tip');
    tip.textContent = '';
    tip.appendChild(el('b', null, b.title));
    groups.forEach(function (g) {
      if (!b.n[g.id]) return;
      var line = el('div', 'tl');
      line.appendChild(shapeIcon(g, 12));
      line.appendChild(el('span', null, g.name));
      line.appendChild(el('span', 'v', b.n[g.id] + '건'));
      tip.appendChild(line);
    });
    var sum = el('div', 'tl sum');
    sum.appendChild(el('span', null, '합계'));
    sum.appendChild(el('span', 'v', b.total + '건'));
    tip.appendChild(sum);
    tip.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    var tip = $('tip'), panel = $('chartPanel').getBoundingClientRect();
    var x = e.clientX - panel.left + 14, y = e.clientY - panel.top - tip.offsetHeight - 10;
    if (x + tip.offsetWidth > panel.width - 8) x = e.clientX - panel.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(8, x) + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }

  // ---------------------------------------------------------------- 목록
  // 주요 질병은 왼쪽 목록과 같은 짧은 이름으로, 나머지는 원래 질병명으로 보인다
  function label(it) { return it.g.core ? it.g.name : it.disease; }

  function row(it, right, parts, side) {
    var li = el('li');
    var hasPos = state.markers[it.id] != null;
    var r = el(hasPos ? 'button' : 'div', 'row');
    if (hasPos) r.type = 'button';
    r.appendChild(shapeIcon(it.g, 18));
    r.appendChild(el('span', 't', label(it)));
    r.appendChild(right);
    var a = el('span', 'a');
    parts.filter(Boolean).forEach(function (p) { a.appendChild(typeof p === 'string' ? el('span', null, p) : p); });
    r.appendChild(a);
    r.appendChild(el('span', 's', side || ''));
    if (hasPos) {
      r.title = '지도에서 위치 보기';
      r.addEventListener('click', function () {
        var m = state.markers[it.id];
        if (m) { state.map.setView(m.getLatLng(), Math.max(state.map.getZoom(), 11)); m.openPopup(); }
      });
    }
    li.appendChild(r);
    return li;
  }

  // ---------------------------------------------------------------- 상단 상황 문장
  function regionShortOf(region) {
    var mm = /^(경상|전라|충청)(북|남)도$/.exec(region);
    if (mm) return mm[1][0] + mm[2];
    return region.replace(/(특별자치도|광역시|특별시|도)$/, '');
  }

  function renderStatus(all, home, inHome, inRegion) {
    var fresh = all.filter(function (it) { return it.g.core && it.ago < ZONE_DAYS && !it.end; });
    var alertHits = fresh.filter(function (it) { return inHome(it) || (it.km != null && it.km <= ALERT_KM); });
    var watchHits = fresh.filter(function (it) { return inRegion(it) || (it.km != null && it.km <= WATCH_KM); });
    var rs = regionShortOf(home.region);
    function names(list) {
      var ids = {};
      list.forEach(function (it) { ids[it.g.id] = true; });
      var ns = GROUPS.filter(function (g) { return ids[g.id]; }).map(function (g) { return g.name; });
      return ns.join(', ') + josa(ns[ns.length - 1], '이', '가');
    }
    var level, head, pool;
    if (alertHits.length) {
      level = 'alert'; pool = alertHits;
      head = home.name + ' 관내 또는 ' + ALERT_KM + 'km 안에서 ' + names(alertHits) + ' 발생했습니다';
    } else if (watchHits.length) {
      level = 'watch'; pool = watchHits;
      head = rs + ' 도내 또는 ' + WATCH_KM + 'km 안에서 ' + names(watchHits) + ' 발생했습니다';
    } else {
      level = 'calm'; pool = fresh;
      head = rs + ' 도내와 ' + WATCH_KM + 'km 안에서는 최근 ' + ZONE_DAYS + '일 동안 주요 질병 발생이 없습니다';
    }
    var located = pool.filter(function (it) { return it.km != null; }).sort(function (a, b) { return a.km - b.km; });
    var sub;
    if (located.length) {
      var n = located[0];
      sub = '가장 가까운 곳은 시청에서 ' + fmtKm(n.km) + ' 떨어진 ' + n.addr + '입니다\u00a0(' + label(n) + ',\u00a0' + md(n.date) + ')';
    } else if (pool.length) {
      var l = pool[0];
      sub = '가장 최근 발생지는 ' + l.addr + '입니다 (' + label(l) + ', ' + md(l.date) + '). 위치를 아직 찾지 못해 거리는 모릅니다';
    } else {
      sub = '최근 ' + ZONE_DAYS + '일 동안 전국에서 종식되지 않은 주요 질병 발생이 없습니다';
    }
    $('status').setAttribute('data-level', level);
    $('badge').textContent = { calm: '평시', watch: '주의', alert: '비상' }[level];
    var why = '이 화면의 자체 기준이며 정부의 공식 위기경보 단계가 아닙니다. ' +
      '최근 ' + ZONE_DAYS + '일 안에 발생해 종식되지 않은 구제역, 고병원성 AI, 아프리카돼지열병, 럼피스킨만 봅니다. ' +
      '비상은 ' + home.name + ' 관내 또는 시청 ' + ALERT_KM + 'km 안, 주의는 ' + rs + ' 도내 또는 ' + WATCH_KM + 'km 안, 평시는 그 밖입니다.';
    $('badge').title = why;
    $('status').title = why;
    $('headline').textContent = head;
    $('subline').textContent = sub;
  }

  // ---------------------------------------------------------------- 전체 그리기
  function render() {
    var data = state.data;
    if (!data) return;
    var home = data.home;
    var all = (data.items || []).map(function (it) {
      it.g = groupOf(it.disease);
      it.ago = daysAgo(it.date);
      it.addr = it.addr || '';
      it.km = it.lat != null && it.lng != null ? km(home.lat, home.lng, it.lat, it.lng) : null;
      return it;
    }).filter(function (it) { return it.ago >= 0; });
    var items = all.filter(function (it) { return it.ago < state.days; });

    var rs = regionShortOf(home.region);
    function inHome(it) { return it.addr.indexOf(home.name) >= 0; }
    function inRegion(it) { return it.addr.indexOf(home.region) >= 0 || it.addr.indexOf(rs + ' ') === 0; }

    renderStatus(all, home, inHome, inRegion);

    Array.prototype.forEach.call(document.querySelectorAll('.homeName'), function (e) { e.textContent = home.name; });
    $('regionLabel').textContent = rs + ' 도내';
    $('periodLabel').textContent = periodName(state.days);
    $('statLabel').textContent = periodName(state.days) + ', 모든 질병';
    Array.prototype.forEach.call($('periods').children, function (b) {
      b.setAttribute('aria-pressed', Number(b.dataset.days) === state.days ? 'true' : 'false');
    });
    $('source').textContent = data.source ? '자료: ' + data.source : '';

    // 안내 띠
    var notice = $('notice'), msg = '', cls = 'notice';
    var age = data.updated ? Date.now() - new Date(data.updated).getTime() : 0;
    if (data.error) { msg = data.error; cls += ' err'; }
    else if (data.mode === 'demo') { msg = data.message || '가상 데이터로 표시 중입니다. 실제 발생 정보가 아닙니다.'; cls += ' warn'; }
    else if (age > STALE_MS) { msg = '자료가 ' + Math.floor(age / 3600000) + '시간 전에 마지막으로 갱신되었습니다. 서버 상태를 확인해 주세요.'; cls += ' warn'; }
    else if (data.message) { msg = data.message; }
    notice.hidden = !msg;
    notice.className = cls;
    notice.textContent = msg;
    if (data.updated) {
      var u = data.updated.replace('T', ' ');
      $('updated').textContent = '자료 갱신 ' + (u.slice(0, 10) === isoOf(new Date()) ? '' : shortDate(u.slice(0, 10)) + ' ') + u.slice(11, 16);
    }

    // 질병별 건수 (켜고 끄기)
    var counts = {};
    GROUPS.forEach(function (g) { counts[g.id] = 0; });
    items.forEach(function (it) { counts[it.g.id]++; });
    var ul = $('counts');
    ul.textContent = '';
    GROUPS.forEach(function (g) {
      var li = el('li');
      var b = el('button', 'count' + (counts[g.id] ? '' : ' zero'));
      b.type = 'button';
      b.setAttribute('aria-pressed', state.shown[g.id] ? 'true' : 'false');
      b.title = state.shown[g.id] ? '지도에서 숨기기' : '지도에 표시하기';
      b.appendChild(shapeIcon(g, 22));
      b.appendChild(el('span', 'name', g.name));
      b.appendChild(el('span', 'n', String(counts[g.id])));
      b.addEventListener('click', function () { state.shown[g.id] = !state.shown[g.id]; save(); render(); });
      li.appendChild(b);
      ul.appendChild(li);
    });

    // 지도와 막대그래프
    var shown = items.filter(function (it) { return state.shown[it.g.id]; });
    drawMap(shown);
    drawChart(shown);

    // 최근 발생 (좌표가 없어도 목록에는 표시)
    var recent = $('recent');
    recent.textContent = '';
    shown.slice(0, 40).forEach(function (it) {
      var tag = it.lat == null ? el('span', 'tag', '위치 미확인') : null;
      recent.appendChild(row(it, el('span', 'd', shortDate(it.date)), [it.addr, it.species, tag]));
    });
    $('recentCount').textContent = shown.length > 40 ? shown.length + '건 중 40건' : shown.length + '건';
    if (!shown.length) recent.appendChild(el('li', 'empty', '선택한 기간과 질병에 해당하는 발생이 없습니다'));

    // 기준 지역 숫자
    var nHome = items.filter(inHome).length;
    $('statHome').textContent = nHome;
    $('statRegion').textContent = items.filter(inRegion).length;
    $('statAll').textContent = items.length;
    $('statHomeBox').className = 'stat' + (nHome ? ' hot' : '');

    // 가까운 주요 질병
    var core = items.filter(function (it) { return it.g.core && it.km != null; }).sort(function (a, b) { return a.km - b.km; });
    var near = $('nearest');
    near.textContent = '';
    core.slice(0, 5).forEach(function (it) {
      near.appendChild(row(it, el('span', 'km', fmtKm(it.km)), [it.addr], shortDate(it.date)));
    });
    if (!core.length) {
      var anyCore = items.some(function (it) { return it.g.core; });
      near.appendChild(el('li', 'empty', anyCore
        ? '주요 질병 발생은 있지만 위치를 아직 찾지 못해 거리를 계산하지 못했습니다'
        : '선택한 기간에 주요 질병 발생이 없습니다'));
    }

    var unloc = items.filter(function (it) { return it.lat == null; }).length;
    $('unlocated').textContent = unloc ? '위치를 아직 찾지 못한 ' + unloc + '건은 지도에서 빠지고 목록에만 나옵니다.' : '';
  }

  function load() {
    fetch('api/outbreaks', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data.home) { // 서버가 첫 자료를 받는 중
          var n = $('notice');
          n.hidden = false; n.className = 'notice'; n.textContent = data.message || '자료를 받는 중입니다.';
          setTimeout(load, 5000);
          return;
        }
        if (!state.map) initMap(data.home);
        state.data = data;
        render();
      })
      .catch(function (e) {
        var n = $('notice');
        n.hidden = false; n.className = 'notice err';
        n.textContent = '서버에 연결하지 못했습니다. 잠시 뒤 다시 시도합니다. (' + e.message + ')';
      });
  }

  function tick() {
    var d = new Date();
    var w = '일월화수목금토'[d.getDay()];
    $('clock').textContent = (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + w + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    $('clock').setAttribute('datetime', d.toISOString());
  }

  $('periods').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    var days = b && Number(b.dataset.days);
    if (days) { state.days = days; save(); render(); }
  });
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (state.map) state.map.invalidateSize();
      if (state.data) render();
    }, 200);
  });
  tick(); setInterval(tick, 10000);
  load(); setInterval(load, REFRESH_MS);
})();
