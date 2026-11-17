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
  // 발생 단계. 모든 항목에 st 를 매긴다(stageOf). 질병 색·모양은 그대로 두고 단계는 표식의 테두리·채움으로 나눈다.
  // 건수·통계·상황 판정·그래프는 확진(confirmed)과 종료(closed)만 센다. 의심·항원·야생은 따로 센다.
  var STAGES = [
    { id: 'confirmed', name: '확진', tip: '확진된 발생(공공데이터, 보도자료 보완, 수기 입력)' },
    { id: 'antigen', name: '항원', tip: '항원·양성 검출, 고병원성 여부 등 정밀검사 중(확진 전)' },
    { id: 'suspect', name: '의심', tip: '의심 신고(의사환축) 접수, 검사 중(확진 전)' },
    { id: 'closed', name: '종료', tip: '종식일(이동제한 해제일)이 지난 확진 건' },
    { id: 'wild', name: '야생', tip: '야생동물 검출(농장 발생이 아님)' }
  ];
  var STAGE_NAME = {};
  STAGES.forEach(function (x) { STAGE_NAME[x.id] = x.name; });
  var PRE = { suspect: true, antigen: true };
  var STAGE_DATE = { confirmed: '확진일 ', closed: '확진일 ', antigen: '항원 확인 ', suspect: '의심 신고 ', wild: '검출 ' };
  function stageOf(it, today) {
    if (it.stage === 'suspect' || it.stage === 'antigen' || it.stage === 'wild') return it.stage;
    return it.end && it.end <= today ? 'closed' : 'confirmed';
  }
  function isCase(it) { return it.st === 'confirmed' || it.st === 'closed'; }
  function stageBadge(st) {
    var b = el('span', 'stg stg-' + st, STAGE_NAME[st] || st);
    STAGES.forEach(function (x) { if (x.id === st) b.title = x.tip; });
    return b;
  }
  var HOME_GUESS_KM = 15;      // 시군 이름 없이 입력한 수기 주소를 관내로 볼 시청 거리
  var ZONE_DAYS = 30;          // 방역대와 경보 단계를 보는 기간
  var WATCH_KM = 50;           // 주의: 도내 또는 50km 안
  var ALERT_KM = 10;           // 비상: 관내 또는 10km 안
  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 90 * 60 * 1000; // 30분마다 갱신. 90분(세 번 거름)이 넘으면 지연 띠
  var IS_PUBLIC = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var SVGNS = 'http://www.w3.org/2000/svg';

  // 조회 기간. mode: rel(오늘까지 최근 days일), mon(오늘까지 최근 months개월), ytd(올해), fixed(start~end 고정)
  // rel·mon·ytd 는 날짜가 바뀌면 종료일이 오늘로 따라간다.
  var QUICK = {
    '30': { mode: 'rel', days: 30, name: '최근 30일' },
    '90': { mode: 'rel', days: 90, name: '최근 90일' },
    '6m': { mode: 'mon', months: 6, name: '최근 6개월' },
    '1y': { mode: 'rel', days: 365, name: '최근 1년' },
    'ytd': { mode: 'ytd', name: '올해' }
  };
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

  var state = { range: { mode: 'rel', days: 30 }, rangeMsg: null, dayKey: null, shown: {}, facShown: {}, data: null, map: null, layer: null, facLayer: null, markers: {},
    manual: [], storeOk: true, editId: null, pick: null, pickPrev: null, picking: false, pickMarker: null, flash: null,
    saving: false };
  GROUPS.forEach(function (g) { state.shown[g.id] = g.core; });
  state.stageShown = {};
  STAGES.forEach(function (x) { state.stageShown[x.id] = true; });
  // 왼쪽 열 접기 상태: fac = 시설 목록 접힘, zero = 기간 안 0건 질병 펼침(기본은 접힘)
  state.fold = { fac: false, zero: false };
  try {
    var saved = JSON.parse(localStorage.getItem('dash') || '{}');
    state.range = cleanRange(saved.range) || (Number.isInteger(saved.days) && saved.days > 0 ? { mode: 'rel', days: saved.days } : state.range);
    if (saved.shown) Object.keys(saved.shown).forEach(function (k) { if (k in state.shown) state.shown[k] = !!saved.shown[k]; });
    // 시설은 종류(type) 이름으로 기억한다. 처음 보는 종류는 켜진 상태로 시작한다.
    if (saved.facShown && typeof saved.facShown === 'object') Object.keys(saved.facShown).forEach(function (k) { state.facShown[k] = !!saved.facShown[k]; });
    if (saved.stageShown && typeof saved.stageShown === 'object') Object.keys(saved.stageShown).forEach(function (k) { if (k in state.stageShown) state.stageShown[k] = !!saved.stageShown[k]; });
    if (saved.fold && typeof saved.fold === 'object') { state.fold.fac = saved.fold.fac === true; state.fold.zero = saved.fold.zero === true; }
  } catch (e) { /* 저장값이 없어도 동작 */ }

  function save() {
    try { localStorage.setItem('dash', JSON.stringify({ range: state.range, shown: state.shown, facShown: state.facShown, stageShown: state.stageShown, fold: state.fold })); } catch (e) { /* 무시 */ }
  }
  // 저장해 둔 기간 값 검사(형식이 틀리면 null)
  function cleanRange(r) {
    if (!r || typeof r !== 'object') return null;
    if (r.mode === 'rel' && Number.isInteger(r.days) && r.days >= 1 && r.days <= 3660) return { mode: 'rel', days: r.days };
    if (r.mode === 'mon' && Number.isInteger(r.months) && r.months >= 1 && r.months <= 120) return { mode: 'mon', months: r.months };
    if (r.mode === 'ytd') return { mode: 'ytd' };
    if (r.mode === 'fixed' && ISO_RE.test(r.start) && ISO_RE.test(r.end) && r.start <= r.end) return { mode: 'fixed', start: r.start, end: r.end };
    return null;
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
  // 기본 모양과 색 이름(PALETTE id). 실제 g.shape, g.color 는 applyIcons() 가 아이콘 설정 표에서 정한다
  var DEF_COLOR = { '--d-fmd': 'red', '--d-hpai': 'orange', '--d-asf': 'blue', '--d-lsd': 'teal', '--d-tb': 'light', '--d-bru': 'gray', '--d-etc': 'dark' };
  GROUPS.forEach(function (g) { g.defShape = g.shape; g.defColor = DEF_COLOR[g.token]; g.color = token(g.token); });

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

  // 정다각형·별 꼭짓점 (위쪽 꼭짓점부터 시계 방향). inner 가 있으면 별(안쪽 꼭짓점 비율)
  function polyPts(n, cx, cy, r, inner) {
    var pts = [], k = inner ? 2 * n : n;
    for (var i = 0; i < k; i++) {
      var a = -Math.PI / 2 + i * 2 * Math.PI / k, rr = inner && i % 2 ? r * inner : r;
      pts.push((cx + rr * Math.cos(a)).toFixed(2), (cy + rr * Math.sin(a)).toFixed(2));
    }
    return pts.join(' ');
  }
  function fx(list) { return list.map(function (v) { return Number(v.toFixed(2)); }).join(' '); }

  // 질병 모양 아이콘 (색과 모양을 함께 써서 구분). g 는 { shape, color } 를 가진 값(GROUPS 항목 또는 미리보기용)
  // st(발생 단계)는 모양·색을 바꾸지 않고 채움과 테두리로 나눈다: 확진 = 채움+실선, 항원 = 옅은 채움+굵은 점선,
  // 의심 = 속 빈 흰 바탕+가는 점선, 종료 = 흐리게, 야생 = 속 빈 흰 바탕+실선+가운데 점
  function shapeIcon(g, size, faded, st) {
    var s = size, h = s / 2, w = Math.max(1.5, s / 9);
    if (st === 'antigen') w = Math.max(2.6, s / 6.5);
    var box = svg('svg', { width: s, height: s, viewBox: '0 0 ' + s + ' ' + s, 'aria-hidden': 'true', 'class': 'shape' });
    var m = w / 2 + 0.5, node, R = h - m;
    if (g.shape === 'circle') node = svg('circle', { cx: h, cy: h, r: h - m });
    else if (g.shape === 'triangle') node = svg('polygon', { points: [h, m + 0.5, s - m, s - m, m, s - m].join(' ') });
    else if (g.shape === 'square') node = svg('rect', { x: m + 1, y: m + 1, width: s - 2 * m - 2, height: s - 2 * m - 2, rx: 1.5 });
    else if (g.shape === 'diamond') node = svg('polygon', { points: [h, m, s - m, h, h, s - m, m, h].join(' ') });
    else if (g.shape === 'pentagon') node = svg('polygon', { points: polyPts(5, h, h + R * 0.1, R * 1.02) });
    else if (g.shape === 'hexagon') node = svg('polygon', { points: polyPts(6, h, h, R) });
    else if (g.shape === 'star') node = svg('polygon', { points: polyPts(5, h, h + R * 0.12, R * 1.08, 0.48) });
    else if (g.shape === 'invtri') node = svg('polygon', { points: fx([m, m + 0.5, s - m, m + 0.5, h, s - m]) });
    else if (g.shape === 'plus') {
      var a = (s - 2 * m) * 0.19, lo = m + 0.5, hi = s - m - 0.5;
      node = svg('polygon', { points: fx([h - a, lo, h + a, lo, h + a, h - a, hi, h - a, hi, h + a, h + a, h + a,
        h + a, hi, h - a, hi, h - a, h + a, lo, h + a, lo, h - a, h - a, h - a]) });
    } else if (g.shape === 'pin') { // 물방울(핀): 위쪽 원과 아래 끝점을 접선으로 잇는다
      var pr = (s - 2 * m) * 0.36, pcx = h, pcy = m + pr, tip = s - m, th = Math.acos(pr / (tip - pcy));
      var lx = pcx - pr * Math.sin(th), rx = pcx + pr * Math.sin(th), ty = pcy + pr * Math.cos(th);
      node = svg('path', { d: 'M' + fx([pcx, tip]) + 'L' + fx([lx, ty]) + 'A' + fx([pr, pr]) + ' 0 1 1 ' + fx([rx, ty]) + 'Z' });
    }
    else node = svg('circle', { cx: h, cy: h, r: h * 0.62 }); // dot(작은 원)
    node.setAttribute('fill', g.color);
    node.setAttribute('stroke', token('--marker-edge'));
    node.setAttribute('stroke-width', w);
    node.setAttribute('stroke-linejoin', 'round');
    if (faded) node.setAttribute('fill-opacity', '0.5');
    var ink = isLight(g.color) ? token('--marker-edge') : g.color;
    if (st === 'antigen') {
      node.setAttribute('fill-opacity', '0.35');
      node.setAttribute('stroke', ink);
      node.setAttribute('stroke-dasharray', fx([w * 1.1, w * 0.8]));
    } else if (st === 'suspect') {
      node.setAttribute('fill', token('--surface'));
      node.setAttribute('fill-opacity', '0.9');
      node.setAttribute('stroke', ink);
      node.setAttribute('stroke-width', Math.max(1.4, s / 13));
      node.setAttribute('stroke-dasharray', fx([Math.max(1.6, s / 11), Math.max(1.6, s / 11)]));
    } else if (st === 'closed') {
      node.setAttribute('fill-opacity', '0.22');
      node.setAttribute('stroke-opacity', '0.45');
    } else if (st === 'wild') {
      node.setAttribute('fill', token('--surface'));
      node.setAttribute('stroke', ink);
    }
    box.appendChild(node);
    if (st === 'wild') box.appendChild(svg('circle', { cx: h, cy: h + (g.shape === 'triangle' ? s * 0.1 : g.shape === 'invtri' ? -s * 0.1 : 0), r: Math.max(1.6, s * 0.13), fill: ink }));
    return box;
  }

  // 시설 표지: 흰 바탕에 색 테두리·무늬의 둥근 사각형이고(질병 표지는 색을 채운 도형), 안쪽 무늬로 종류를 나눈다.
  // 흰색·밝은 회색처럼 밝은 색은 흰 바탕에서 보이지 않으므로, 짙은 회색(--fac-inv) 바탕에 그 색 무늬로 뒤집어 그린다.
  // config.json facilities 의 type 이 FAC_TYPES 에 없으면 아직 쓰지 않은 무늬를 나오는 순서대로 쓴다.
  // 무늬 칸: path(선), circle(고리 반지름), dot(가운데 점 반지름), dots(작은 점 [x, y, r] 목록), sw(선 굵기)
  var DEFAULT_FAC_TYPE = '거점소독시설';
  var FAC_GLYPHS = {
    cross: { path: 'M11 6v10M6 11h10' },          // 십자
    roof: { path: 'M6.5 15.5v-5L11 6.5l4.5 4v5' }, // 지붕(집 모양)
    ring: { circle: 4.2 },                         // 고리
    bars: { path: 'M7.5 7v8M11 7v8M14.5 7v8' },    // 세로줄 셋
    slash: { path: 'M7 15L15 7' },                 // 빗금
    dot: { dot: 3.2 },                             // 가운데 점
    flag: { path: 'M7.5 16.5v-11l8 3.3-8 3.3', sw: 2.3 },                              // 깃발(삼각 깃발)
    truck: { path: 'M5 13.2V7.5h7.2v5.7zM12.2 9.8h2.4l2.3 2.5v.9h-4.7', sw: 2, dots: [[7.8, 15.8, 1.6], [14.6, 15.8, 1.6]] }, // 트럭
    drop: { path: 'M11 5.6c2.3 2.9 3.7 4.9 3.7 6.9a3.7 3.7 0 0 1-7.4 0c0-2 1.4-4 3.7-6.9z', sw: 2.2 }, // 물방울
    shield: { path: 'M11 5.6l4.6 1.7v3.4c0 2.9-1.9 4.8-4.6 5.8-2.7-1-4.6-2.9-4.6-5.8V7.3z', sw: 2.2 } // 방패
  };
  var FAC_ORDER = ['cross', 'roof', 'ring', 'bars', 'slash', 'dot'];
  var FAC_TYPES = { '거점소독시설': 'cross', '도축장': 'roof', '가축시장': 'ring', '사료공장': 'bars' };
  var facGlyphMemo = {};
  function facType(f) { var t = f && typeof f.type === 'string' ? f.type.trim() : ''; return t || DEFAULT_FAC_TYPE; }
  function facGlyph(type) { // 기본 무늬
    if (FAC_TYPES[type]) return FAC_TYPES[type];
    if (!facGlyphMemo[type]) {
      var used = Object.keys(FAC_TYPES).map(function (k) { return FAC_TYPES[k]; })
        .concat(Object.keys(facGlyphMemo).map(function (k) { return facGlyphMemo[k]; }));
      var free = FAC_ORDER.filter(function (g) { return used.indexOf(g) < 0; });
      facGlyphMemo[type] = free.length ? free[0] : FAC_ORDER[Object.keys(facGlyphMemo).length % FAC_ORDER.length];
    }
    return facGlyphMemo[type];
  }
  // 색이 바탕(흰색)과 비슷하게 밝은가(상대 휘도 0.6 이상). '#rrggbb' 만 판단하고 그 밖은 밝지 않다고 본다
  function isLight(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return false;
    var n = parseInt(m[1], 16), c = [n >> 16, (n >> 8) & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] >= 0.6;
  }
  function facIcon(size, type) { return facIconOf(size, facSpec(type || DEFAULT_FAC_TYPE)); }
  // spec 은 { glyph, color }. color 는 색 이름(PALETTE id)
  function facIconOf(size, spec) {
    var ink = colorOf(spec.color), g = FAC_GLYPHS[spec.glyph] || FAC_GLYPHS.cross;
    var bg = isLight(ink) ? token('--fac-inv') : token('--fac-bg');
    var box = svg('svg', { width: size, height: size, viewBox: '0 0 22 22', 'aria-hidden': 'true', 'class': 'shape fac' });
    box.appendChild(svg('rect', { x: 1.5, y: 1.5, width: 19, height: 19, rx: 4, fill: bg, stroke: isLight(ink) ? bg : ink, 'stroke-width': 2 }));
    if (g.path) box.appendChild(svg('path', { d: g.path, fill: 'none', stroke: ink, 'stroke-width': g.sw || 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    if (g.circle) box.appendChild(svg('circle', { cx: 11, cy: 11, r: g.circle, fill: 'none', stroke: ink, 'stroke-width': 2.4 }));
    if (g.dot) box.appendChild(svg('circle', { cx: 11, cy: 11, r: g.dot, fill: ink }));
    (g.dots || []).forEach(function (d) { box.appendChild(svg('circle', { cx: d[0], cy: d[1], r: d[2], fill: ink })); });
    return box;
  }

  // ---------------------------------------------------------------- 아이콘 설정 표
  // 질병·시설 표지의 모양과 색은 모두 여기서 읽는다(지도 표지, 왼쪽 목록, 가까운·최근 발생 목록, 막대그래프, 그래프 풍선 도움말).
  // 기본값: 질병은 GROUPS 의 shape 와 token 색, 시설은 FAC_TYPES 무늬와 흰색(--fac). 방역대 원은 질병과 관계없이 --zone 색.
  // 사용자가 바꾼 값만 이 브라우저의 localStorage('dash-icons')에 저장하고, 수기 입력 내보내기 파일에도 담는다.
  var PALETTE = [ // token 이 있으면 style.css 의 값을 읽는다(기본 화면과 같은 색)
    { id: 'red', name: '빨강', token: '--d-fmd', hex: '#e2433a' },
    { id: 'orange', name: '주황', token: '--d-hpai', hex: '#ee8c0b' },
    { id: 'yellow', name: '노랑', hex: '#e9c315' },
    { id: 'teal', name: '청록', token: '--d-lsd', hex: '#0e9c84' },
    { id: 'blue', name: '파랑', token: '--d-asf', hex: '#2a74e0' },
    { id: 'purple', name: '보라', hex: '#8a5ae8' },
    { id: 'white', name: '흰색', token: '--fac', hex: '#ffffff' },
    { id: 'light', name: '밝은 회색', token: '--d-tb', hex: '#b8bfc7' },
    { id: 'gray', name: '회색', token: '--d-bru', hex: '#838d98' },
    { id: 'dark', name: '어두운 회색', token: '--d-etc', hex: '#59636e' }
  ];
  var D_SHAPES = [
    { id: 'circle', name: '원' }, { id: 'triangle', name: '삼각형' }, { id: 'square', name: '사각형' },
    { id: 'diamond', name: '마름모' }, { id: 'pentagon', name: '오각형' }, { id: 'hexagon', name: '육각형' },
    { id: 'star', name: '별' }, { id: 'plus', name: '십자' }, { id: 'invtri', name: '역삼각형' },
    { id: 'pin', name: '물방울(핀)' }, { id: 'dot', name: '작은 원' }
  ];
  var F_GLYPHS = [
    { id: 'cross', name: '십자' }, { id: 'roof', name: '지붕(건물)' }, { id: 'ring', name: '고리' },
    { id: 'bars', name: '세로줄' }, { id: 'flag', name: '깃발' }, { id: 'truck', name: '트럭' },
    { id: 'drop', name: '물방울' }, { id: 'shield', name: '방패' }, { id: 'slash', name: '빗금' }, { id: 'dot', name: '점' }
  ];
  var ICON_KEY = 'dash-icons';
  var FAC_ICON_MAX = 50;
  function inList(list, id) { return list.some(function (x) { return x.id === id; }); }
  function nameIn(list, id) { var x = list.filter(function (y) { return y.id === id; })[0]; return x ? x.name : id; }
  function colorOf(id) {
    var p = PALETTE.filter(function (x) { return x.id === id; })[0] || PALETTE[6];
    return (p.token && token(p.token)) || p.hex;
  }
  // 저장값·가져온 값 검사. 틀린 칸은 버리고(기본값 사용) 나머지만 남긴다
  function cleanIcons(raw) {
    var out = { disease: {}, facility: {} };
    if (!raw || typeof raw !== 'object') return out;
    var d = raw.disease, f = raw.facility;
    if (d && typeof d === 'object') GROUPS.forEach(function (g) {
      var v = d[g.id], o = {};
      if (!v || typeof v !== 'object') return;
      if (inList(D_SHAPES, v.shape)) o.shape = v.shape;
      if (inList(PALETTE, v.color)) o.color = v.color;
      if (o.shape || o.color) out.disease[g.id] = o;
    });
    if (f && typeof f === 'object' && !Array.isArray(f)) Object.keys(f).slice(0, FAC_ICON_MAX).forEach(function (t) {
      var v = f[t], o = {}, name = String(t).trim();
      if (!name || name.length > 40 || !v || typeof v !== 'object') return;
      if (inList(F_GLYPHS, v.glyph)) o.glyph = v.glyph;
      if (inList(PALETTE, v.color)) o.color = v.color;
      if (o.glyph || o.color) out.facility[name] = o;
    });
    return out;
  }
  var icons = { disease: {}, facility: {} };
  try { icons = cleanIcons(JSON.parse(localStorage.getItem(ICON_KEY) || 'null')); } catch (e) { /* 저장값이 없거나 깨져도 기본값으로 동작 */ }
  function saveIcons() {
    try { localStorage.setItem(ICON_KEY, JSON.stringify({ version: 1, disease: icons.disease, facility: icons.facility })); return true; } catch (e) { return false; }
  }
  function iconCount() { return Object.keys(icons.disease).length + Object.keys(icons.facility).length; }
  function diseaseDefault(g) { return { shape: g.defShape, color: g.defColor }; }
  function diseaseSpec(g) { var o = icons.disease[g.id] || {}, d = diseaseDefault(g); return { shape: o.shape || d.shape, color: o.color || d.color }; }
  function facDefault(type) { return { glyph: facGlyph(type), color: 'white' }; }
  function facSpec(type) { var o = icons.facility[type] || {}, d = facDefault(type); return { glyph: o.glyph || d.glyph, color: o.color || d.color }; }
  // 설정 표를 GROUPS 의 shape·color 에 반영한다(그림 그리는 곳은 모두 g.shape, g.color 를 읽음)
  function applyIcons() {
    GROUPS.forEach(function (g) { var sp = diseaseSpec(g); g.shape = sp.shape; g.color = colorOf(sp.color); });
  }
  applyIcons();

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
  function dateOf(iso) { return new Date(iso + 'T00:00:00'); }
  function addDays(iso, n) { var d = dateOf(iso); d.setDate(d.getDate() + n); return isoOf(d); }
  function spanDays(a, b) { return Math.round((dateOf(b) - dateOf(a)) / 86400000) + 1; }
  function addMonths(iso, n) { // 말일 넘침은 그 달 말일로
    var d = dateOf(iso), day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return isoOf(d);
  }
  function dotDate(iso, withYear) { return (withYear ? iso.slice(0, 4) + '.' : '') + iso.slice(5, 7) + '.' + iso.slice(8, 10); }

  // 지도 자료(api/outbreaks)가 들어 있는 가장 이른 날짜. 수기 입력은 따지지 않는다.
  function dataMin() {
    var items = (state.data && state.data.items) || [], m = null;
    items.forEach(function (it) { if (it.date && (!m || it.date < m)) m = it.date; });
    return m;
  }

  // 지금 조회할 실제 구간을 계산한다(오늘 기준)
  function currentRange() {
    var r = state.range, today = isoOf(today0()), start, end = today, follow = true, quick = null;
    if (r.mode === 'rel') start = addDays(today, -(r.days - 1));
    else if (r.mode === 'mon') start = addDays(addMonths(today, -r.months), 1);
    else if (r.mode === 'ytd') start = today.slice(0, 4) + '-01-01';
    else { start = r.start; end = r.end > today ? today : r.end; follow = false; }
    if (start > end) start = end;
    Object.keys(QUICK).forEach(function (k) {
      var q = QUICK[k];
      if (follow && q.mode === r.mode && q.days === r.days && q.months === r.months) quick = k;
    });
    var min = dataMin(), want = start;
    if (min && start < min) start = min > end ? end : min;
    var name;
    if (quick) name = QUICK[quick].name;
    else if (follow && r.mode === 'rel') name = '최근 ' + r.days + '일';
    else if (follow && r.mode === 'mon') name = '최근 ' + r.months + '개월';
    else {
      var y = today.slice(0, 4), wy = start.slice(0, 4) !== y || end.slice(0, 4) !== y;
      name = dotDate(start, wy) + '~' + dotDate(end, wy);
    }
    return { start: start, end: end, today: today, follow: follow, quick: quick, name: name,
      clipped: want < start, wanted: want, min: min, past: end < today, days: spanDays(start, end) };
  }

  // 사용자가 날짜 칸을 바꿨을 때
  function setRangeFromInputs(which) {
    var cur = currentRange(), today = cur.today, min = cur.min;
    var v = $(which === 'start' ? 'rangeStart' : 'rangeEnd').value;
    if (!ISO_RE.test(v)) { syncRangeInputs(cur); return; } // 지운 경우 되돌림
    if (Number(v.slice(0, 4)) < 1990) return; // 연도를 입력하는 중(예: 0202)
    var start = which === 'start' ? v : cur.start, end = which === 'end' ? v : cur.end, msg = null;
    if (end > today) { end = today; msg = '미래 날짜는 고를 수 없어 종료일을 오늘로 맞췄습니다.'; }
    if (start > today) { start = today; msg = '미래 날짜는 고를 수 없어 시작일을 오늘로 맞췄습니다.'; }
    if (min && start < min) {
      start = min > end ? end : min;
      msg = { link: true, text: '지도는 ' + dotDate(min, true) + ' 이후 자료만 표시합니다. 그 이전은 통계 화면에서 조회하세요.' };
    }
    if (min && end < min) end = min;
    if (start > end) {
      if (which === 'start') { end = start; msg = '시작일이 종료일보다 늦어 종료일을 시작일과 같게 맞췄습니다.'; }
      else { start = end; msg = '종료일이 시작일보다 빨라 시작일을 종료일과 같게 맞췄습니다.'; }
    }
    // 종료일이 오늘이면 '오늘 추종'으로 두고 구간 길이로 기억한다
    if (end !== today) state.range = { mode: 'fixed', start: start, end: end };
    else if (!(cur.follow && start === cur.start && !cur.clipped)) state.range = { mode: 'rel', days: spanDays(start, end) };
    rangeMsg(msg);
    save();
    render();
  }
  var rangeMsgT = null;
  function rangeMsg(msg) {
    clearTimeout(rangeMsgT);
    if (!msg) { state.rangeMsg = null; return; }
    if (typeof msg === 'string') msg = { text: msg };
    msg.until = Date.now() + 12000;
    state.rangeMsg = msg;
    rangeMsgT = setTimeout(function () { if (state.data) render(); }, 12100);
  }

  function syncRangeInputs(cur) {
    var s = $('rangeStart'), e = $('rangeEnd');
    [s, e].forEach(function (x) { x.max = cur.today; x.min = cur.min || ''; });
    s.value = cur.start;
    e.value = cur.end;
    s.title = '조회 시작일' + (cur.min ? '. 지도는 ' + dotDate(cur.min, true) + ' 이후 자료만 표시합니다. 그 이전은 통계 화면에서 조회하세요.' : '');
    e.title = cur.follow ? '조회 종료일: 오늘(날짜가 바뀌면 따라갑니다). 바꾸면 그 날짜로 고정됩니다.' : '조회 종료일: ' + dotDate(cur.end, true) + '로 고정됨';
    $('range').setAttribute('data-fixed', cur.follow ? 'false' : 'true');
    $('rangeToday').hidden = cur.follow;
    Array.prototype.forEach.call($('rangeQuick').children, function (b) {
      b.setAttribute('aria-pressed', b.dataset.q === cur.quick ? 'true' : 'false');
    });
  }

  function renderRangeNote(cur) {
    var m = state.rangeMsg && state.rangeMsg.until > Date.now() ? state.rangeMsg : null;
    if (!m && cur.clipped) {
      m = { link: true, text: '고른 시작일(' + dotDate(cur.wanted, true) + ')보다 지도 자료가 짧습니다. 지도는 ' +
        dotDate(cur.min, true) + ' 이후 자료만 표시합니다. 그 이전은 통계 화면에서 조회하세요.' };
    }
    $('rangeNote').hidden = !m;
    $('rangeNoteText').textContent = m ? m.text : '';
    $('rangeNoteLink').hidden = !(m && m.link);
    var tag = $('pastTag');
    tag.hidden = !cur.past;
    tag.textContent = cur.past ? '과거 구간 조회 중 · ' + dotDate(cur.start, true) + '~' + dotDate(cur.end, true) : '';
  }

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
    // 시청 바로 옆에 거점소독시설이 있어서, 이름표는 점 오른쪽(바다 쪽)으로 비켜 둔다
    var pin = el('div', 'home-mark');
    pin.appendChild(el('span', 'home-dot'));
    pin.appendChild(el('span', 'home-pin', home.name + '청'));
    L.marker([home.lat, home.lng], {
      icon: L.divIcon({ className: '', html: pin, iconSize: null, iconAnchor: [0, 0] }),
      interactive: false, zIndexOffset: 2000, keyboard: false
    }).addTo(state.map);
    state.facLayer = L.layerGroup().addTo(state.map);
    state.layer = L.layerGroup().addTo(state.map);
    state.map.on('click', function (e) { if (state.picking) placePick(e.latlng); });
  }

  // ---------------------------------------------------------------- 방역 자원
  function facOn(type) { return state.facShown[type] !== false; }

  // 시설 종류의 위치가 모두 보이게 지도를 옮긴다(꺼져 있으면 켠다)
  function goFacilities(type) {
    var pts = ((state.data && state.data.resources && state.data.resources.facilities) || []).filter(function (f) {
      return facType(f) === type && f.lat != null && f.lng != null;
    }).map(function (f) { return [f.lat, f.lng]; });
    if (!pts.length || !state.map) return;
    if (!facOn(type)) { state.facShown[type] = true; save(); render(); }
    if (pts.length === 1) state.map.setView(pts[0], 14);
    else state.map.fitBounds(pts, { padding: [80, 80], maxZoom: 14 });
  }

  function drawResources(res) {
    var fac = ((res && res.facilities) || []).filter(function (f) { return f && typeof f === 'object'; });
    var veh = (res && res.vehicles) || [];
    // 종류별로 묶는다(config.json 에 나온 순서 유지)
    var types = [], byType = {};
    fac.forEach(function (f) {
      var t = facType(f);
      if (!byType[t]) { byType[t] = []; types.push(t); }
      byType[t].push(f);
    });

    state.facLayer.clearLayers();
    fac.forEach(function (f) {
      var t = facType(f);
      if (f.lat == null || f.lng == null || !facOn(t)) return;
      var icon = facIcon(18, t);
      icon.setAttribute('class', 'mk');
      var box = el('div');
      box.appendChild(el('b', null, f.name || t));
      if (f.name && f.name.indexOf(t) < 0) box.appendChild(el('div', null, t));
      box.appendChild(el('div', null, f.addr));
      if (f.geo === 'road') box.appendChild(el('div', null, '도로 위치 기준이라 실제 건물과 조금 다를 수 있습니다'));
      L.marker([f.lat, f.lng], {
        icon: L.divIcon({ className: '', html: icon, iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 2500, title: f.name || t, alt: f.name || t
      }).bindPopup(box).addTo(state.facLayer);
    });

    // 왼쪽 '시설' 목록 (켜고 끄기, 위치로 이동)
    var ul = $('facCounts');
    ul.textContent = '';
    types.forEach(function (t) {
      var list = byType[t], located = list.filter(function (f) { return f.lat != null && f.lng != null; });
      var li = el('li', 'fac-row');
      var wrap = el('div', 'count-wrap' + (facOn(t) ? '' : ' off'));
      var b = el('button', 'count');
      b.type = 'button';
      b.setAttribute('aria-pressed', facOn(t) ? 'true' : 'false');
      b.title = (facOn(t) ? '지도에서 숨기기' : '지도에 표시하기') + '\n' + list.map(function (f) { return (f.name || t) + ': ' + (f.addr || '주소 없음'); }).join('\n') +
        (located.length < list.length ? '\n위치를 모르는 ' + (list.length - located.length) + '곳은 지도에 나오지 않습니다' : '');
      b.appendChild(el('span', 'ico-slot'));
      b.appendChild(el('span', 'name', t));
      b.appendChild(el('span', 'n', String(list.length)));
      b.addEventListener('click', function () { state.facShown[t] = !facOn(t); save(); render(); });
      wrap.appendChild(b);
      wrap.appendChild(iconButton('f', t, t, facIcon(22, t)));
      li.appendChild(wrap);
      var go = el('button', 'fac-go', '위치');
      go.type = 'button';
      go.title = '지도를 ' + t + ' 위치로 옮깁니다';
      go.setAttribute('aria-label', t + ' 위치로 지도 이동');
      go.disabled = !located.length;
      go.addEventListener('click', function () { goFacilities(t); });
      li.appendChild(go);
      ul.appendChild(li);
    });
    $('facPanel').hidden = !types.length;
    state.facTypes = types;
    var facFold = $('facFold');
    facFold.setAttribute('aria-expanded', state.fold.fac ? 'false' : 'true');
    facFold.title = state.fold.fac ? '시설 목록 펼치기' : '시설 목록 접기(지도 표시는 그대로)';
    $('facPanel').classList.toggle('folded', state.fold.fac);
    $('facSum').textContent = state.fold.fac ? types.map(function (t) { return t + ' ' + byType[t].length + (facOn(t) ? '' : '(숨김)'); }).join(' · ') : '';

    // 오른쪽 '방역 자원' 한 줄 요약
    var parts = types.map(function (t) {
      var n = byType[t].length, unloc = byType[t].filter(function (f) { return f.lat == null; }).length;
      return t + ' ' + n + '곳' + (unloc ? '(지도 ' + (n - unloc) + '곳)' : '');
    });
    if (veh.length) {
      parts.push('소독차량 ' + veh.map(function (v) {
        return v.name.replace('경주시 소유', '시').replace('축협 공동방제단', '공동방제단') + '\u00a0' + v.count + '대';
      }).join(' · '));
    }
    $('resPanel').hidden = !parts.length;
    $('resLine').textContent = parts.join(', ');
    $('resLine').title = fac.map(function (f) { return (f.name || facType(f)) + ': ' + f.addr; }).concat(
      veh.map(function (v) { return v.name + ' ' + v.count + '대'; })).join('\n');
  }

  function popup(it) {
    var box = el('div');
    var st = it.st || 'confirmed', pre = !!PRE[st];
    box.appendChild(el('b', null, it.disease));
    box.appendChild(document.createTextNode(' '));
    box.appendChild(stageBadge(st));
    var press = it.source === 'press';
    if (press) { box.appendChild(document.createTextNode(' ')); box.appendChild(el('span', 'ptag', '보도자료')); }
    var zoneNote = '';
    if (pre && it.g && it.g.core && it.ago < ZONE_DAYS) zoneNote = '점선 원은 확진되면 적용될 방역대의 예정 범위입니다(아직 확정 아님)';
    var lines = [
      (it.source === 'press' || it.source === 'manual' || pre || st === 'wild' ? STAGE_DATE[st] : '발생일 ') + it.date +
        (it.end && !pre && st !== 'wild' ? ', 종식 ' + it.end : ''),
      it.addr,
      press ? pressHeads(it) :
      it.species ? it.species + (Number(it.count) > 0 ? ' ' + Number(it.count).toLocaleString('ko-KR') + '마리' : '') : '',
      it.farm ? '농장 ' + it.farm : '',
      it.km != null ? '시청에서 ' + fmtKm(it.km) : '',
      it.geo === 'area' ? '읍면동 중심 좌표라 실제 위치와 다를 수 있습니다' : '',
      it.geo === 'sgg' ? '보도자료에 시군구까지만 나와 시군구 중심에 표시했습니다' : '',
      pre ? '확진 전 단계라 발생 건수와 통계에 넣지 않습니다. 확진되면 확진으로 바뀝니다.' : '',
      st === 'wild' ? '야생동물 검출이라 농장 발생 건수에 넣지 않습니다.' : '',
      st === 'closed' ? '종식(이동제한 해제)된 건이라 방역대를 그리지 않습니다.' : '',
      zoneNote,
      press && it.note ? it.note : '',
      it.source === 'manual' ? '수기 입력, 이 PC에만 저장' + (it.api_match ? ' (공공데이터에 반영됨)' : '') : '',
      it.source === 'manual' && it.mgeo ? GEO_TEXT[it.mgeo] + (it.mgeo !== 'pick' && it.geo_name ? ': ' + it.geo_name : '') : '',
      it.source === 'manual' && approxGeo(it) && !pre ? '주소로 찾은 대략의 위치라 방역대 원(점선)이 실제 범위와 다를 수 있습니다' : '',
      it.memo ? '메모: ' + it.memo : ''
    ];
    lines.filter(Boolean).forEach(function (t) { box.appendChild(el('div', null, t)); });
    var hist = (it.history || []).filter(function (h) { return h && STAGE_NAME[h.stage] && ISO_RE.test(h.date); });
    if (hist.length) {
      var hb = el('div', 'phist');
      hb.appendChild(el('span', 'k', '단계 이력 '));
      hist.forEach(function (h, i) {
        if (i) hb.appendChild(document.createTextNode(' → '));
        var t = STAGE_NAME[h.stage] + '\u00a0' + shortDate(h.date);
        if (h.url && /^https:\/\//.test(h.url)) {
          var a = el('a', null, t);
          a.href = h.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
          a.title = (h.source || '출처') + ' 보기';
          hb.appendChild(a);
        } else {
          var sp = el('span', null, t);
          if (h.source) sp.title = h.source;
          hb.appendChild(sp);
        }
      });
      box.appendChild(hb);
    }
    if (press) {
      var src = el('div', 'psrc', '출처: ');
      if (it.url) {
        var a = el('a', null, it.source_name || '농림축산식품부 보도자료');
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        src.appendChild(a);
      } else src.appendChild(document.createTextNode(it.source_name || '농림축산식품부 보도자료'));
      if (isCase(it)) src.appendChild(document.createTextNode(' (공공데이터에 아직 없음)'));
      box.appendChild(src);
    }
    return box;
  }

  // 보도자료 보완 항목의 두수 문구: 공개된 값만 씀
  function pressHeads(it) {
    var p = [];
    if (it.species) p.push(it.species);
    if (Number(it.herd) > 0) p.push('사육 ' + Number(it.herd).toLocaleString('ko-KR') + '마리');
    if (Number(it.count) > 0) p.push('양성 ' + Number(it.count).toLocaleString('ko-KR') + '마리');
    return p.length ? p.join(', ') : '축종·두수 확인 안 됨';
  }

  function drawMap(shown) {
    state.layer.clearLayers();
    state.markers = {};
    var zone = token('--zone');
    // 오래된 것부터 그려 최근 발생이 위에 오도록
    // 방역대: 확진(미종식)은 실선(주소로 찾은 대략의 위치면 점선), 확진 전(의심·항원)은 예정 범위라 세 원 모두 성긴 점선, 종료·야생은 없음
    shown.slice().reverse().forEach(function (it) {
      if (it.lat == null || it.lng == null) return;
      var g = it.g, fresh = it.ago < ZONE_DAYS, st = it.st || 'confirmed', pre = !!PRE[st];
      if (g.core && fresh && ((st === 'confirmed' && !it.end) || pre)) {
        var rough = approxGeo(it); // 주소로 찾은 대략의 위치면 세 원을 모두 점선으로
        [[10000, 0.04, '6 6', 1], [3000, 0.08, null, 1.5], [500, 0.3, null, 1]].forEach(function (z) {
          L.circle([it.lat, it.lng], {
            radius: z[0], color: zone, weight: pre ? 1.5 : z[3], opacity: pre ? 0.7 : 0.75, dashArray: pre ? '2 8' : rough ? '4 6' : z[2],
            fillColor: zone, fillOpacity: pre ? z[1] * 0.4 : z[1], interactive: false
          }).addTo(state.layer);
        });
      }
      var size = st === 'wild' ? 16 : g.core ? 22 : 14;
      var icon = shapeIcon(g, size, st === 'confirmed' && !fresh, st);
      icon.setAttribute('class', 'mk');
      var m = L.marker([it.lat, it.lng], {
        icon: L.divIcon({ className: '', html: icon, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
        // 확진 전 표식은 시청 핀·시설 표지(2000~2500)보다 위에 둔다(시군구 중심 좌표면 시청과 겹침)
        zIndexOffset: pre ? 2600 : st === 'confirmed' && g.core ? 500 : st === 'wild' ? 300 : 0,
        title: it.disease + ' ' + STAGE_NAME[st] + ' ' + it.date, alt: it.disease + ' ' + STAGE_NAME[st]
      }).bindPopup(popup(it)).addTo(state.layer);
      state.markers[it.id] = m;
    });
  }

  // ---------------------------------------------------------------- 확진 전(의심·항원), 야생동물 검출 알림 띠
  // 지도 표식은 drawMap 이 단계 모양으로 그린다. 여기서는 위쪽 띠만: 확진 전 건(보도자료 자동 수집분 최근 21일 + 수기 입력)과
  // 최근 30일 야생동물 검출. 관내 확진 전 건이 있으면 빨간 띠로 맨 위에 둔다.
  var EXTRA_WILD_DAYS = 30;
  function drawExtras(list, home) {
    var box = $('extraNote');
    box.textContent = '';
    var homeHit = false, nPre = 0;
    function line(it) {
      var st = it.st, pre = !!PRE[st];
      var inHome = (it.addr || '').indexOf(home.name) >= 0;
      if (inHome && pre) homeHit = true;
      if (pre) nPre++;
      var row = el('div', 'check-row' + (inHome ? ' home' : ''));
      var t = el('span', null, '');
      t.appendChild(el('b', null, (inHome ? home.name + ' 관내 ' : '') + (pre ? '확진 전(' + STAGE_NAME[st] + '): ' : '야생동물 검출: ')));
      t.appendChild(document.createTextNode(it.disease + ' · ' + (it.addr || '') + (it.species ? ' · ' + it.species : '') + ' · ' + md(it.date) +
        (it.source === 'manual' ? ' · 수기 입력' : '')));
      t.appendChild(el('span', 'check-sub', pre ? ' (확진 건수에 넣지 않음)' : ' (농장 발생 건수에 넣지 않음)'));
      row.appendChild(t);
      if (it.lat != null) {
        var go = el('button', null, '지도에서 보기');
        go.type = 'button';
        go.addEventListener('click', function () {
          var m = state.markers[it.id];
          state.map.setView([it.lat, it.lng], Math.max(state.map.getZoom(), 11));
          if (m) m.openPopup();
        });
        row.appendChild(go);
      }
      if (it.url) {
        var a = el('a', null, '보도자료 보기');
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
        row.appendChild(a);
      }
      return row;
    }
    var rows = list.filter(function (it) { return PRE[it.st] || (it.st === 'wild' && it.ago <= EXTRA_WILD_DAYS); }).map(line);
    rows.sort(function (a, b) { return (b.classList.contains('home') ? 1 : 0) - (a.classList.contains('home') ? 1 : 0); });
    rows.forEach(function (r) { box.appendChild(r); });
    box.hidden = !rows.length;
    box.className = 'notice check-note extra-note' + (homeHit ? ' alert' : nPre ? ' warn' : '');
    box.title = '보도자료에서 자동으로 읽은 확진 전 건(최근 21일)과 수기 입력한 확진 전 건, 야생동물 검출(최근 ' + EXTRA_WILD_DAYS + '일). 공식 집계가 아닙니다.';
  }

  // ---------------------------------------------------------------- 막대그래프
  // 단위: auto(구간 길이에 따라 일·주·월), day·week(조회 기간), month(조회 기간 6개월 이상이면 그 기간, 아니면 최근 24개월),
  // year(조회 기간과 관계없이 최근 10년). 지도 자료(약 400일)보다 오래된 구간이 필요할 때만 통계 자료(api/history)를 받는다.
  var UNIT_KEY = 'dash-chart';
  var UNIT_NAMES = { day: '날짜별', week: '주별', month: '월별', year: '연도별' };
  var HIST_TTL = 6 * 60 * 60 * 1000; // 통계 자료를 다시 받는 주기(종일 켜 두는 단말기용)
  state.unit = 'auto';
  state.hist = null;      // null | { status: 'loading'|'ok'|'error', rows, at, msg }
  state.chartArgs = null; // 마지막으로 그린 { shown, all }
  try {
    var savedUnit = (JSON.parse(localStorage.getItem(UNIT_KEY) || '{}') || {}).unit;
    if (savedUnit in UNIT_NAMES || savedUnit === 'auto') state.unit = savedUnit;
  } catch (e) { /* 저장값이 없어도 동작 */ }
  function saveUnit() {
    try { localStorage.setItem(UNIT_KEY, JSON.stringify({ unit: state.unit })); } catch (e) { /* 무시 */ }
  }

  // 통계 자료를 한 번 받아 날짜와 질병 묶음만 남긴다. 받은 뒤에는 그래프만 다시 그린다.
  function loadHist() {
    var h = state.hist;
    if (h && (h.status === 'loading' || h.status === 'error')) return;
    if (h && h.status === 'ok' && Date.now() - h.at < HIST_TTL) return;
    var old = h && h.status === 'ok' ? h : null;
    state.hist = old ? { status: 'ok', rows: old.rows, at: old.at, refreshing: true } : { status: 'loading' };
    fetch('api/history', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (h) {
      var cols = (h && h.cols) || [], di = cols.indexOf('date'), ni = cols.indexOf('disease');
      if (!h || !Array.isArray(h.rows) || !h.dict || !Array.isArray(h.dict.disease) || di < 0 || ni < 0) {
        throw new Error(h && h.error ? h.error : '자료 형식이 올바르지 않습니다');
      }
      var gs = h.dict.disease.map(groupOf), rows = [];
      var supp = h.supp && Array.isArray(h.supp.rows) ? h.supp.rows : [];
      h.rows.concat(supp).forEach(function (r) {
        var s = String(r[di]);
        if (s.length === 8 && gs[r[ni]]) rows.push({ date: s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8), g: gs[r[ni]] });
      });
      state.hist = { status: 'ok', rows: rows, at: Date.now() };
    }).catch(function (e) {
      state.hist = old ? { status: 'ok', rows: old.rows, at: Date.now() } : { status: 'error', msg: e.message, at: Date.now() };
    }).then(function () {
      if (state.chartArgs && !state.picking) drawChart(state.chartArgs.shown, state.chartArgs.all);
    });
  }

  function monthKey(iso) { return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1; }
  function monthFirst(k) { return Math.floor(k / 12) + '-' + pad(k % 12 + 1) + '-01'; }
  function dotMonth(iso) { return iso.slice(0, 4) + '.' + iso.slice(5, 7); }

  // 무엇을 어느 구간으로 그릴지 정한다
  function chartPlan(cur) {
    var u = state.unit, today = cur.today;
    if (u === 'auto' || u === 'day' || u === 'week') return { unit: u, start: cur.start, end: cur.end, byRange: true };
    if (u === 'month') {
      if (cur.days >= spanDays(addDays(addMonths(cur.end, -6), 1), cur.end)) return { unit: 'month', start: cur.start, end: cur.end, byRange: true };
      return { unit: 'month', start: monthFirst(monthKey(today) - 23), end: today, wide: '최근 24개월' };
    }
    var y = Number(today.slice(0, 4));
    return { unit: 'year', start: (y - 9) + '-01-01', end: today, wide: '최근 10년' };
  }

  // 막대 구간 목록. maxLabels 는 축에 적을 수 있는 라벨 수
  function buckets(cur, unit, maxLabels) {
    var out = [], i, n, step, d, start = cur.start, end = cur.end;
    if (unit === 'auto') { unit = cur.days <= 45 ? 'aday' : cur.days <= 210 ? 'aweek' : 'month'; maxLabels = 14; }
    if (unit === 'aday') { // 자동(45일 이하): 이전과 같은 모양
      step = Math.max(1, Math.ceil(cur.days / 7));
      for (i = cur.days - 1; i >= 0; i--) {
        d = addDays(end, -i);
        out.push({ from: d, to: d, label: Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)), title: md(d), mark: i % step === 0 });
      }
      return { unit: 'day', list: out };
    }
    if (unit === 'aweek') { // 자동(210일 이하): 종료일에 맞춘 7일 묶음
      n = Math.ceil(cur.days / 7);
      step = Math.max(1, Math.ceil(n / 9));
      for (i = n - 1; i >= 0; i--) {
        var to = addDays(end, -7 * i), from = addDays(to, -6);
        if (from < start) from = start;
        out.push({ from: from, to: to, label: Number(from.slice(5, 7)) + '/' + Number(from.slice(8, 10)),
          title: md(from) + '부터 ' + md(to) + '까지', mark: i % step === 0 });
      }
      return { unit: 'week', list: out };
    }
    var multiYear = start.slice(0, 4) !== end.slice(0, 4);
    function tday(iso) { return (multiYear ? iso.slice(0, 4) + '년 ' : '') + md(iso); }
    if (unit === 'day') {
      n = spanDays(start, end);
      for (i = 0; i < n; i++) {
        d = addDays(start, i);
        out.push({ from: d, to: d, label: Number(d.slice(5, 7)) + '/' + Number(d.slice(8, 10)), title: tday(d) });
      }
    } else if (unit === 'week') { // 월요일 시작. 조회 기간 밖의 날은 세지 않는다
      var mon = addDays(start, -((dateOf(start).getDay() + 6) % 7));
      for (; mon <= end; mon = addDays(mon, 7)) {
        var sun = addDays(mon, 6), f = mon < start ? start : mon, t = sun > end ? end : sun;
        out.push({ from: f, to: t, label: Number(mon.slice(5, 7)) + '/' + Number(mon.slice(8, 10)),
          title: tday(mon) + '(월) 시작 주' + (f !== mon || t !== sun ? ' · ' + md(f) + (f !== t ? '~' + md(t) : '') + '만 집계' : '') });
      }
    } else if (unit === 'month') {
      var first = monthKey(start), last = monthKey(end);
      n = last - first + 1;
      for (i = 0; i < n; i++) {
        var k = first + i, yy = Math.floor(k / 12), mm = k % 12 + 1;
        var mEnd = isoOf(new Date(yy, mm, 0)), mf = monthFirst(k), mt = mEnd;
        if (mf < start) mf = start;
        if (mt > end) mt = end;
        var part = mf.slice(8) !== '01' || mt !== mEnd;
        out.push({ from: mf, to: mt, label: (n > 12 && (mm === 1 || i === 0) ? String(yy).slice(2) + '.' : '') + mm + '월',
          title: yy + '년 ' + mm + '월' + (part ? ' (' + md(mf) + '~' + md(mt) + (mt === cur.today ? ', 진행 중' : '') + ')' : '') });
      }
    } else { // year
      for (var y = Number(start.slice(0, 4)); y <= Number(end.slice(0, 4)); y++) {
        var yf = y + '-01-01', yt = y + '-12-31', now = yt > end;
        if (yf < start) yf = start;
        if (now) yt = end;
        var fromPart = yf.slice(5) !== '01-01';
        out.push({ from: yf, to: yt, label: y + (now ? ' 진행 중' : ''), now: now,
          title: y + '년' + (fromPart || now ? ' (' + (fromPart ? md(yf) + '부터' : '') + (fromPart && now ? ' ' : '') + (now ? '진행 중, ' + md(yt) + '까지' : '') + ')' : '') });
      }
    }
    n = out.length;
    step = Math.max(1, Math.ceil(n / Math.max(1, maxLabels)));
    out.forEach(function (b, j) { b.mark = (n - 1 - j) % step === 0; });
    return { unit: unit, list: out };
  }

  function findBucket(bs, iso) { // 구간이 날짜순으로 이어져 있으므로 이분 탐색
    var lo = 0, hi = bs.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (iso < bs[mid].from) hi = mid - 1;
      else if (iso > bs[mid].to) lo = mid + 1;
      else return bs[mid];
    }
    return null;
  }

  function drawChart(shown, all) {
    state.chartArgs = { shown: shown, all: all };
    var box = $('chart'), tip = $('tip'), note = $('chartNote');
    box.textContent = '';
    tip.hidden = true;
    Array.prototype.forEach.call($('chartUnit').children, function (b) {
      b.setAttribute('aria-pressed', b.dataset.u === state.unit ? 'true' : 'false');
    });
    var cur = currentRange(), plan = chartPlan(cur);
    var W = Math.max(box.clientWidth, 200), H = box.clientHeight || 168;
    var left = 36, right = 4, top = 8, bottom = 24;
    var plotW = W - left - right, plotH = H - top - bottom;

    // 자료 고르기: 조회 기간 안이면 지도 자료, 그 밖이 필요하면 통계 자료(전 구간을 통계 자료로)
    var src = shown, status = null, span = { start: plan.start, end: plan.end, days: spanDays(plan.start, plan.end), today: cur.today };
    var min = dataMin();
    if (!plan.byRange) {
      var manual = all.filter(function (it) { return it.source === 'manual' && state.shown[it.g.id]; });
      if (min && plan.start >= min) {
        src = all.filter(function (it) { return state.shown[it.g.id]; });
      } else {
        loadHist();
        var h = state.hist;
        if (h.status === 'ok') {
          src = h.rows.filter(function (r) { return r.date >= plan.start && state.shown[r.g.id]; }).concat(manual);
          status = 'hist';
        } else if (h.status === 'loading') {
          src = []; status = 'loading';
        } else { // 실패: 지도 자료가 있는 범위만
          span.start = min && min > plan.start ? min : plan.start;
          span.days = spanDays(span.start, span.end);
          src = all.filter(function (it) { return state.shown[it.g.id]; });
          status = 'error';
        }
      }
    }
    var bk = buckets(plan.byRange ? cur : span, plan.unit, Math.floor(plotW / (plan.unit === 'year' ? 52 : 46)));
    var title = UNIT_NAMES[bk.unit] + ' 발생 건수';
    $('chartTitle').textContent = title;

    var text, short, tipText = '', warn = false;
    if (plan.byRange) { text = cur.name + ', 왼쪽에서 켜 둔 질병만 쌓아서 표시'; short = cur.name + ' · 켜 둔 질병만'; }
    else {
      var shownRange = plan.unit === 'year' ? span.start.slice(0, 4) + '~' + span.end.slice(0, 4)
        : dotMonth(span.start) + '~' + dotMonth(span.end);
      short = (status === 'error' ? '지도 자료 범위만 ' : plan.wide + ' ') + shownRange + ' · 조회 기간과 무관';
      text = short.replace(shownRange, shownRange + (plan.unit === 'year' ? '(올해 진행 중)' : '')) + ' · 켜 둔 질병만';
      if (status === 'hist') {
        text += ' · 중복 묶음 기준';
        tipText = '통계 화면과 같은 자료(1995년 이후 전체)로 셉니다. 같은 농장·같은 날·같은 질병의 중복 신고는 1건으로 묶으므로 ' +
          '왼쪽 질병별 건수(지도 자료 기준)보다 조금 적을 수 있습니다. 수기 입력은 함께 셉니다.';
      } else if (status === 'error') {
        warn = true;
        tipText = '통계 자료(api/history)를 불러오지 못해 지도 자료가 있는 ' + dotDate(min, true) + ' 이후만 표시합니다. ' +
          '단위 단추를 다시 누르면 다시 불러옵니다. (' + state.hist.msg + ')';
      } else if (status === 'loading') tipText = '통계 자료를 불러오는 중입니다.';
    }
    note.textContent = text;
    note.title = text + (tipText ? '\n' + tipText : '');
    if (note.scrollWidth > note.clientWidth + 1) note.textContent = short; // 좁은 화면: 짧은 문구(전체는 도움말)
    note.classList.toggle('warn', warn);

    var bs = bk.list;
    var groups = GROUPS.filter(function (g) { return state.shown[g.id]; });
    bs.forEach(function (b) { b.n = {}; b.total = 0; groups.forEach(function (g) { b.n[g.id] = 0; }); });
    src.forEach(function (it) {
      var b = findBucket(bs, it.date);
      if (b && it.g.id in b.n) { b.n[it.g.id]++; b.total++; }
    });

    var root = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': title + ', ' + (plan.byRange ? cur.name : text) });
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
    var bw = slot >= 8 ? Math.min(24, slot - 4) : Math.max(1, slot * 0.7); // 막대가 많으면 얇게
    bs.forEach(function (b, i) {
      var x = left + i * slot + (slot - bw) / 2, y0 = top + plotH;
      groups.forEach(function (g) {
        var n = b.n[g.id];
        if (!n) return;
        var hgt = (n / ceil) * plotH;
        y0 -= hgt;
        root.appendChild(svg('rect', { x: x, y: y0, width: bw, height: Math.max(hgt - 1, 1), fill: g.color, 'fill-opacity': b.now ? 0.6 : 1 }));
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
      none.textContent = status === 'loading' ? '통계 자료(' + plan.wide + ')를 불러오는 중입니다…'
        : groups.length ? '이 기간에 켜 둔 질병의 발생이 없습니다' : '왼쪽 목록에서 표시할 질병을 켜 주세요';
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

  function row(it, right, parts, side, withActions) {
    var li = el('li');
    var hasPos = state.markers[it.id] != null;
    var r = el(hasPos ? 'button' : 'div', 'row');
    if (hasPos) r.type = 'button';
    r.appendChild(shapeIcon(it.g, 18, false, it.st));
    var t = el('span', 't', label(it));
    t.appendChild(document.createTextNode(' '));
    t.appendChild(stageBadge(it.st || 'confirmed'));
    if (it.source === 'manual') { t.appendChild(document.createTextNode(' ')); t.appendChild(el('span', 'mtag', '수기')); }
    if (it.source === 'press') {
      t.appendChild(document.createTextNode(' '));
      var pt = el('span', 'ptag', '보도');
      pt.title = (it.source_name || '농림축산식품부 보도자료') + '로 보완한 항목입니다(공공데이터에 아직 없음)' +
        (it.auto ? '. 보도자료에서 자동으로 읽었습니다' : '');
      t.appendChild(pt);
    }
    r.appendChild(t);
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
    if (it.source === 'manual' && withActions) li.appendChild(manualActions(it));
    return li;
  }

  function manualActions(it) {
    var box = el('div', 'mact');
    if (it.api_match) box.appendChild(el('span', 'tag', '공공데이터에 반영됨'));
    if (it.lat == null && it.inDialog) {
      var fb = el('button', 'ghost sm', '위치 찾기');
      fb.type = 'button';
      fb.title = '주소로 위치를 찾습니다. 지명 좌표표에 없으면 주소의 행정구역 이름만 OpenStreetMap 주소 검색으로 보냅니다.';
      fb.addEventListener('click', function () { findForItem(it.id, fb); });
      box.appendChild(fb);
    }
    var e = el('button', 'ghost sm', '수정');
    e.type = 'button';
    e.addEventListener('click', function () { openDialog(it.id); });
    var d = el('button', 'ghost sm danger', '삭제');
    d.type = 'button';
    d.addEventListener('click', function () { removeManual(it.id); });
    box.appendChild(e);
    box.appendChild(d);
    return box;
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
    var home = data.home, todayIso = isoOf(today0());
    // 확진·종료(items, 수기 확진) + 확진 전·야생(suspects, wild, 수기 의심·항원)을 한 목록으로 만든 뒤 단계로 나눈다
    var every = (data.items || []).concat(manualItems(), data.suspects || [], data.wild || []).filter(function (it) {
      return it && it.date;
    }).map(function (it) {
      it.g = groupOf(it.disease);
      it.ago = daysAgo(it.date);
      it.addr = it.addr || '';
      it.km = it.lat != null && it.lng != null ? km(home.lat, home.lng, it.lat, it.lng) : null;
      it.st = stageOf(it, todayIso);
      return it;
    }).filter(function (it) { return it.ago >= 0; });
    markApiMatch(every);
    every.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    var all = every.filter(isCase), preAll = every.filter(function (it) { return !isCase(it); });
    var cur = currentRange();
    state.dayKey = cur.today;
    function inRange(it) { return it.date >= cur.start && it.date <= cur.end; }
    var items = all.filter(inRange), preItems = preAll.filter(inRange);

    var rs = regionShortOf(home.region);
    // 수기 주소에 시군 이름이 없으면(예: "안강읍 산대리") 찍은 위치로 관내를 짐작한다
    function noCity(it) { return it.source === 'manual' && !/(^|\s)\S+(시|군)(\s|$)/.test(it.addr); }
    function inHome(it) { return it.addr.indexOf(home.name) >= 0 || (noCity(it) && it.km != null && it.km <= HOME_GUESS_KM); }
    function inRegion(it) { return it.addr.indexOf(home.region) >= 0 || it.addr.indexOf(rs + ' ') === 0 || inHome(it); }

    renderStatus(all, home, inHome, inRegion);

    Array.prototype.forEach.call(document.querySelectorAll('.homeName'), function (e) { e.textContent = home.name; });
    $('regionLabel').textContent = rs + ' 도내';
    $('periodLabel').textContent = cur.name;
    $('statLabel').textContent = cur.name + ', 모든 질병';
    syncRangeInputs(cur);
    renderRangeNote(cur);
    $('source').textContent = data.source ? '자료: ' + data.source : '';
    var sp = data.supplement, sn = $('suppNote');
    if (sp && sp.count > 0) {
      var sline = '공공데이터에 아직 없는 ' + sp.count + '건은 농식품부 보도자료로 보완';
      if (sp.auto) sline += '(자동 수집 ' + sp.auto + '건 포함)';
      $('source').textContent += ' · ' + sline + '(목록과 지도에 "보도" 표시)';
      sn.textContent = sline;
      sn.title = Object.keys(sp.by_disease || {}).map(function (k) { return k + ' ' + sp.by_disease[k] + '건'; }).join(', ') +
        '\n출처: ' + (sp.source || '농림축산식품부 보도자료') + '. 같은 건이 공공데이터에 들어오면 자동으로 빠집니다.';
      sn.hidden = false;
    } else { sn.hidden = true; sn.textContent = ''; }
    renderCheck(data.mode === 'live' ? data.check : null);

    updateNotice();

    // 질병별 건수 (켜고 끄기)
    var counts = {};
    GROUPS.forEach(function (g) { counts[g.id] = 0; });
    items.forEach(function (it) { counts[it.g.id]++; });
    var ul = $('counts');
    ul.textContent = '';
    var zeroGroups = GROUPS.filter(function (g) { return !counts[g.id]; });
    GROUPS.forEach(function (g) {
      if (!counts[g.id] && !state.fold.zero) return;
      var li = el('li', 'count-wrap' + (state.shown[g.id] ? '' : ' off') + (g.name.replace(/ /g, '').length > 7 ? ' long' : ''));
      var b = el('button', 'count' + (counts[g.id] ? '' : ' zero'));
      b.type = 'button';
      b.setAttribute('aria-pressed', state.shown[g.id] ? 'true' : 'false');
      b.title = g.name + ' ' + counts[g.id] + '건\n' + (state.shown[g.id] ? '지도에서 숨기기' : '지도에 표시하기');
      b.appendChild(el('span', 'ico-slot'));
      b.appendChild(el('span', 'name', g.name));
      b.appendChild(el('span', 'n', String(counts[g.id])));
      b.addEventListener('click', function () { state.shown[g.id] = !state.shown[g.id]; save(); render(); });
      li.appendChild(b);
      li.appendChild(iconButton('d', g.id, g.name, shapeIcon(g, 22)));
      ul.appendChild(li);
    });
    var moreBox = $('countsMore');
    moreBox.textContent = '';
    if (zeroGroups.length) {
      var mb = el('button', 'more-btn', state.fold.zero ? '0건 접기' : '0건 ' + zeroGroups.length + '개 더 보기');
      mb.type = 'button';
      mb.setAttribute('aria-expanded', state.fold.zero ? 'true' : 'false');
      mb.title = '조회 기간에 발생이 없는 질병: ' + zeroGroups.map(function (g) { return g.name + (state.shown[g.id] ? '' : '(숨김)'); }).join(', ') +
        '\n' + (state.fold.zero ? '목록에서 접습니다' : '목록에 펼쳐 켜고 끄기와 아이콘 설정을 할 수 있습니다');
      mb.addEventListener('click', function () { state.fold.zero = !state.fold.zero; save(); render(); });
      moreBox.appendChild(mb);
    }

    // 발생 단계별 건수 (켜고 끄기). 건수는 질병 켜고 끄기와 관계없이 조회 기간 안 전체
    var stc = {};
    STAGES.forEach(function (x) { stc[x.id] = 0; });
    items.concat(preItems).forEach(function (it) { stc[it.st]++; });
    var su = $('stageCounts');
    su.textContent = '';
    STAGES.forEach(function (x) {
      var on = state.stageShown[x.id] !== false;
      var li = el('li', 'count-wrap' + (on ? '' : ' off'));
      var b = el('button', 'count stage-count' + (stc[x.id] ? '' : ' zero'));
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.title = x.tip + '\n' + (on ? '지도와 최근 발생 목록에서 숨기기' : '지도와 최근 발생 목록에 표시하기');
      b.appendChild(shapeIcon({ shape: 'circle', color: token('--map-ink') }, 14, false, x.id));
      b.appendChild(el('span', 'name', x.name));
      b.appendChild(el('span', 'n', String(stc[x.id])));
      b.addEventListener('click', function () { state.stageShown[x.id] = !on; save(); render(); });
      li.appendChild(b);
      su.appendChild(li);
    });
    var nPre = stc.suspect + stc.antigen;
    var key = $('stageKey');
    key.textContent = '';
    STAGES.forEach(function (x) {
      var sk = el('span', 'sk');
      sk.title = x.tip;
      sk.appendChild(shapeIcon({ shape: 'circle', color: token('--map-ink') }, 16, false, x.id));
      sk.appendChild(document.createTextNode(x.name));
      key.appendChild(sk);
    });
    $('stageLine').textContent = '확진 ' + (stc.confirmed + stc.closed) + '건' + (stc.closed ? '(종료 ' + stc.closed + ' 포함)' : '') +
      ' · 확진 전 ' + nPre + '건(의심 ' + stc.suspect + ', 항원 ' + stc.antigen + ') · 야생 검출 ' + stc.wild + '건';
    $('stageLine').title = cur.name + ' 기준. 확진 건수·통계·상황 판정에는 확진(종료 포함)만 셉니다. 확진 전(의심·항원)과 야생 검출은 따로 셉니다. ' +
      '확진 전 단계는 보도자료 자동 수집과 수기 입력에서만 나옵니다(공공데이터는 확진만 제공).';

    // 지도와 막대그래프. 그래프와 건수는 확진·종료만(단계 켜고 끄기와 무관), 지도와 목록은 단계 켜고 끄기를 따른다
    function stageOn(it) { return state.stageShown[it.st] !== false; }
    var caseShown = items.filter(function (it) { return state.shown[it.g.id]; });
    var shown = caseShown.filter(stageOn).concat(preItems.filter(function (it) { return state.shown[it.g.id] && stageOn(it); }));
    shown.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    drawMap(shown);
    drawExtras(preAll.filter(function (it) { return !PRE[it.st] || it.ago <= 21; }), home);
    drawChart(caseShown, all);

    // 최근 발생 (좌표가 없어도 목록에는 표시)
    var recent = $('recent');
    recent.textContent = '';
    shown.slice(0, 40).forEach(function (it) {
      var tag = it.lat == null ? el('span', 'tag', '위치 미확인') : approxGeo(it) ? el('span', 'tag', GEO_SHORT[it.mgeo]) : null;
      if (tag && it.lat != null) tag.title = GEO_TEXT[it.mgeo] + (it.geo_name ? ': ' + it.geo_name : '');
      recent.appendChild(row(it, el('span', 'd', shortDate(it.date)), [it.addr, it.species, tag], null, true));
    });
    $('recentCount').textContent = shown.length > 40 ? shown.length + '건 중 40건' : shown.length + '건';
    if (!shown.length) recent.appendChild(el('li', 'empty', '선택한 기간과 질병·단계에 해당하는 발생이 없습니다'));

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
    core.slice(0, 4).forEach(function (it) {
      near.appendChild(row(it, el('span', 'km', fmtKm(it.km)), [it.addr], shortDate(it.date)));
    });
    if (!core.length) {
      var anyCore = items.some(function (it) { return it.g.core; });
      near.appendChild(el('li', 'empty', anyCore
        ? '주요 질병 발생은 있지만 위치를 아직 찾지 못해 거리를 계산하지 못했습니다'
        : '선택한 기간에 주요 질병 발생이 없습니다'));
    }

    drawResources(data.resources);
    renderManualList(every);
    if (pop.el) fillIconPop();

    var unloc = shown.filter(function (it) { return it.lat == null; }).length;
    $('unlocated').textContent = unloc ? '위치를 아직 찾지 못한 ' + unloc + '건은 지도에서 빠지고 목록에만 나옵니다.' : '';
  }

  // ---------------------------------------------------------------- 수기 입력 (이 PC의 브라우저에만 저장)
  // 공공데이터에 아직 안 올라온 발생을 담당자가 먼저 넣는다. 서버나 외부로 아무것도 보내지 않는다.
  var STORE_KEY = 'dash-manual';
  var MANUAL_STAGES = { suspect: '의심 신고', antigen: '항원 검출', confirmed: '확진' };
  var MANUAL_MAX = 500;
  var DISEASE_OF = { fmd: '구제역', hpai: '고병원성조류인플루엔자', asf: '아프리카돼지열병', lsd: '럼피스킨병', tb: '결핵병', bru: '브루셀라병' };
  var CORE_WORDS = ['구제역', '고병원성', '아프리카돼지열병', '럼피스킨', '결핵', '브루셀라'];
  var PHONE = /(01[016789]|0\d{1,2})[-. ]?\d{3,4}[-. ]?\d{4}/;

  function storeLoad() {
    try {
      localStorage.setItem('dash-test', '1');
      localStorage.removeItem('dash-test');
      var raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{"items":[]}');
      state.manual = (raw.items || []).map(function (x) { try { return checkItem(x, true); } catch (e) { return null; } }).filter(Boolean);
      state.storeOk = true;
    } catch (e) {
      state.storeOk = false;
    }
  }
  function storeSave() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, items: state.manual }));
      state.storeOk = true;
    } catch (e) {
      state.storeOk = false;
    }
    $('storeWarn').hidden = state.storeOk;
    return state.storeOk;
  }

  function newId() {
    var b = new Uint8Array(3);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(b) : b.forEach(function (_, i) { b[i] = Math.random() * 256; });
    return 'M-' + Date.now().toString(36) + '-' + Array.prototype.map.call(b, function (x) { return pad16(x); }).join('');
  }
  function pad16(x) { return (x < 16 ? '0' : '') + x.toString(16); }

  // 입력값 검사. 화면 입력과 가져오기에 똑같이 쓴다. 틀리면 Error(안내 문구)
  function checkItem(x, loose) {
    if (!x || typeof x !== 'object') throw new Error('형식이 올바르지 않습니다.');
    function text(k, label, max, required) {
      var v = x[k] == null ? '' : x[k];
      if (typeof v !== 'string' && typeof v !== 'number') throw new Error(label + ' 값이 올바르지 않습니다.');
      v = String(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (required && !v) throw new Error(label + josa(label, '을', '를') + ' 입력해 주세요.');
      if (v.length > max) throw new Error(label + josa(label, '은', '는') + ' ' + max + '자 이내로 입력해 주세요.');
      if (PHONE.test(v) || PHONE.test(v.replace(/\s/g, ''))) throw new Error(label + '에 전화번호로 보이는 숫자가 있습니다. 개인정보는 적지 마세요.');
      return v;
    }
    function date(k, label, required) {
      var v = x[k] || '';
      if (!v) { if (required) throw new Error(label + josa(label, '을', '를') + ' 입력해 주세요.'); return null; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isoOf(new Date(v + 'T00:00:00')) !== v) throw new Error(label + josa(label, '이', '가') + ' 올바른 날짜가 아닙니다.');
      if (!loose && v > isoOf(new Date())) throw new Error(label + josa(label, '이', '가') + ' 오늘보다 뒤입니다.');
      return v;
    }
    var key = x.disease_key;
    if (!(key in DISEASE_OF) && key !== 'etc') throw new Error('질병을 목록에서 골라 주세요.');
    var disease = DISEASE_OF[key];
    if (key === 'etc') {
      disease = text(x.disease_text != null ? 'disease_text' : 'disease', '질병명', 30, true);
      if (CORE_WORDS.some(function (w) { return disease.indexOf(w) >= 0; })) throw new Error('이 질병은 목록에서 골라 주세요.');
    }
    var d = date('date', '발생일', true), end = date('end', '종료일', false);
    if (end && end < d) throw new Error('종료일이 발생일보다 앞섭니다.');
    // 단계: 의심 신고·항원 검출·확진. 이 칸이 없는 예전 항목과 예전 내보내기 파일은 확진으로 읽는다
    var stage = x.stage == null || x.stage === '' ? 'confirmed' : x.stage;
    if (!MANUAL_STAGES[stage]) { if (!loose) throw new Error('단계를 목록에서 골라 주세요.'); stage = 'confirmed'; }
    var stageDate = typeof x.stage_date === 'string' && ISO_RE.test(x.stage_date) ? x.stage_date : d;
    var history = (Array.isArray(x.history) ? x.history : []).filter(function (h) {
      return h && MANUAL_STAGES[h.stage] && typeof h.date === 'string' && ISO_RE.test(h.date);
    }).slice(-10).map(function (h) { return { stage: h.stage, date: h.date }; });
    var count = x.count == null || x.count === '' ? null : Number(String(x.count).replace(/,/g, ''));
    if (count != null && !(Number.isInteger(count) && count >= 0 && count <= 10000000)) throw new Error('두수는 0 이상의 정수로 입력해 주세요.');
    var lat = x.lat == null || x.lat === '' ? null : Number(x.lat), lng = x.lng == null || x.lng === '' ? null : Number(x.lng);
    if ((lat == null) !== (lng == null) || (lat != null && !(lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 132))) throw new Error('지정한 위치가 국내 범위를 벗어났습니다.');
    // 위치 정밀도. 이 칸이 없는 예전 항목(좌표가 있으면 지도에서 직접 지정한 것)도 그대로 읽는다
    var geo = lat == null ? null : (typeof x.geo === 'string' && GEO_TEXT[x.geo] ? x.geo : 'pick');
    function plain(k, max) { return lat == null || geo === 'pick' || typeof x[k] !== 'string' ? '' : x[k].replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
    return {
      id: typeof x.id === 'string' && /^M-[0-9a-z]{6,12}-[0-9a-f]{6}$/.test(x.id) ? x.id : newId(),
      disease_key: key, disease: disease, date: d, end: end, stage: stage, stage_date: stageDate, history: history,
      addr: text('addr', '주소', 60, true), species: text('species', '축종', 20, true),
      count: count, memo: text('memo', '메모', 200, false),
      lat: lat == null ? null : Math.round(lat * 1e6) / 1e6, lng: lng == null ? null : Math.round(lng * 1e6) / 1e6,
      geo: geo, geo_name: plain('geo_name', 80), geo_addr: plain('geo_addr', 60),
      created: typeof x.created === 'string' ? x.created.slice(0, 25) : new Date().toISOString(),
      updated: typeof x.updated === 'string' ? x.updated.slice(0, 25) : null
    };
  }

  // 화면 자료 형태로 바꾼다 (API 자료와 같은 칸)
  function manualItems() {
    return state.manual.map(function (m) {
      return { id: m.id, disease: m.disease, farm: '', addr: m.addr, date: m.date, species: m.species, count: m.count,
        agency: '', end: m.end, lat: m.lat, lng: m.lng, geo: m.lat == null ? null : 'manual', source: 'manual', memo: m.memo,
        mgeo: m.geo, geo_name: m.geo_name, stage: m.stage || 'confirmed',
        history: m.history && m.history.length ? m.history.concat([{ stage: m.stage || 'confirmed', date: m.stage_date || m.date, source: '수기 입력' }]) : null };
    });
  }

  // 읍면동 글자 (예: "경상북도 경주시 안강읍 산대리" → 시군 "경주시", 읍면동 "안강읍")
  function areaOf(addr) {
    var t = (addr || '').split(/\s+/), city = null, emd = null;
    t.forEach(function (w) {
      if (!emd && /(시|군)$/.test(w) && !/(특별시|광역시|특별자치시)$/.test(w)) city = w;
      else if (!emd && /(읍|면|동|가)$/.test(w) && !/(시|군|구)$/.test(w)) emd = w;
    });
    return { city: city, emd: emd };
  }
  // 같은 질병, 발생일 ±3일, 3km 이내 또는 같은 읍면동의 API 건이 있으면 표시만 한다(자동 삭제 없음)
  function markApiMatch(all) {
    var api = all.filter(function (it) { return it.source !== 'manual' && it.source !== 'press'; });
    all.forEach(function (m) {
      if (m.source !== 'manual') return;
      var a0 = areaOf(m.addr), t0 = new Date(m.date + 'T00:00:00').getTime();
      m.api_match = api.some(function (a) {
        if (a.g !== m.g || (m.g.id === 'etc' && a.disease.replace(/\s/g, '') !== m.disease.replace(/\s/g, ''))) return false;
        if (Math.abs(new Date(a.date + 'T00:00:00').getTime() - t0) > 3 * 86400000) return false;
        if (m.lat != null && a.lat != null && km(m.lat, m.lng, a.lat, a.lng) <= 3) return true;
        var a1 = areaOf(a.addr);
        return !!a0.emd && a0.emd === a1.emd && (!a0.city || !a1.city || a0.city === a1.city);
      });
    });
  }

  // ---------------------------------------------------------------- 주소 → 좌표 (수기 입력용)
  // 1) 지명 좌표표(api/places: 시군구·읍면동·리 이름과 중심 좌표)에서 리 → 읍면동 → 시군구 순으로 찾는다.
  // 2) 표에서 읍면동 이하를 못 찾았을 때만, 사용자가 저장·찾기 단추를 누르면 OpenStreetMap 주소 검색(Nominatim)에
  //    주소의 행정구역 부분(시도, 시군구, 읍면동, 리. 도로명 주소는 도로 이름)만 보낸다. 번지·건물·농장명은 보내지 않는다.
  //    실패하거나 막히면(행정망 등) 조용히 1)의 결과를 쓴다. 찾은 결과는 이 브라우저에 저장해 다시 묻지 않는다.
  var GEO_TEXT = { pick: '지도에서 직접 지정한 위치', ri: '주소로 찾은 위치(리·동)', road: '주소로 찾은 위치(도로 기준)',
    emd: '주소로 찾은 위치(읍면동 중심)', sgg: '주소로 찾은 위치(시군구 중심)' };
  var GEO_SHORT = { ri: '리 위치', road: '도로 위치', emd: '읍면동 중심', sgg: '시군구 중심' };
  var GEO_RANK = { sgg: 1, emd: 2, ri: 3, road: 3 };
  var SIDO_NAMES = { 서울: '서울특별시 서울시', 부산: '부산광역시 부산시', 대구: '대구광역시 대구시', 인천: '인천광역시 인천시',
    광주: '광주광역시', 대전: '대전광역시 대전시', 울산: '울산광역시 울산시', 세종: '세종특별자치시', 경기: '경기도',
    강원: '강원특별자치도 강원도', 충북: '충청북도', 충남: '충청남도', 전북: '전북특별자치도 전라북도', 전남: '전라남도',
    경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도 제주도' };
  var SIDO_FULL = { 서울: '서울특별시', 부산: '부산광역시', 대구: '대구광역시', 인천: '인천광역시', 광주: '광주광역시',
    대전: '대전광역시', 울산: '울산광역시', 세종: '세종특별자치시', 경기: '경기도', 강원: '강원특별자치도', 충북: '충청북도',
    충남: '충청남도', 전북: '전북특별자치도', 전남: '전라남도', 경북: '경상북도', 경남: '경상남도', 제주: '제주특별자치도' };
  var SIDO_OF = {};
  Object.keys(SIDO_NAMES).forEach(function (k) { SIDO_OF[k] = k; SIDO_NAMES[k].split(' ').forEach(function (n) { SIDO_OF[n] = k; }); });
  var MERGED_JN = ['전남광주통합특별시', '전남광주특별시', '전남광주'];
  var OLD_SGG = { '충북 청원군': '청주시', '경기 여주군': '여주시', '충남 당진군': '당진시', '경남 마산시': '창원시', '경남 진해시': '창원시' };
  var NOMI_URL = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=kr&limit=1&accept-language=ko&q=';
  var NET_GAP_MS = 1100, NET_TIMEOUT_MS = 8000, NET_PAUSE_MS = 5 * 60 * 1000, NET_TRIES = 3;
  var GEO_CACHE_KEY = 'dash-geo', GEO_CACHE_MAX = 300;
  var places = { p: null, promise: null, error: null };
  var net = { last: 0, downUntil: 0 };

  function approxGeo(it) { return it.source === 'manual' && it.lat != null && !!it.mgeo && it.mgeo !== 'pick'; }
  function sidoShort(word, next) {
    if (MERGED_JN.indexOf(word) >= 0) return /구$/.test(next || '') ? '광주' : '전남';
    return SIDO_OF[word] || null;
  }

  function loadPlaces() {
    if (!places.promise) {
      places.promise = fetch('api/places', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (t) {
        places.p = t && t.p && typeof t.p === 'object' ? t.p : {};
      }).catch(function (e) {
        places.p = {}; places.error = e.message; // 표가 없어도 주소 검색과 지도 지정은 그대로 쓸 수 있다
      });
    }
    return places.promise;
  }

  // 주소 → 행정구역 토막. 번지·도로명·건물명 등 행정구역이 아닌 말을 만나면 멈춘다(도로명은 road 로 따로 둠).
  function parseAddr(addr) {
    var t = String(addr || '').replace(/[,()\[\]]/g, ' ').split(/\s+/).filter(Boolean), i = 0;
    var pa = { sido: null, sgg: null, emd: null, ri: null, road: null, hinted: false };
    if (t.length && sidoShort(t[0], t[1])) { pa.sido = sidoShort(t[0], t[1]); i = 1; }
    if (pa.sido === '세종') { if (t[i] === '세종시' || t[i] === '세종특별자치시') i++; pa.sgg = '세종시'; }
    else if (t[i] && /(시|군|구)$/.test(t[i])) {
      pa.sgg = t[i]; i++;
      if (/시$/.test(pa.sgg) && t[i] && /구$/.test(t[i])) i++; // 일반구(포항시 남구 등)는 시로 합친다
      if (pa.sido && OLD_SGG[pa.sido + ' ' + pa.sgg]) pa.sgg = OLD_SGG[pa.sido + ' ' + pa.sgg];
    }
    if (t[i] && /(읍|면|동|가)$/.test(t[i]) && !/^\d/.test(t[i])) {
      pa.emd = t[i]; i++;
      if (t[i] && /리$/.test(t[i]) && /(읍|면)$/.test(pa.emd)) { pa.ri = t[i]; i++; }
    }
    if (!pa.emd && t[i] && /(로|길)$/.test(t[i]) && !/^\d/.test(t[i])) pa.road = t[i];
    // 시군구 없이 읍면동부터 적었으면 현황판 기준 시군(예: 경주시) 안에서 찾는다
    var home = state.data && state.data.home;
    if (!pa.sgg && (pa.emd || pa.road) && home && home.name) {
      pa.sgg = home.name; pa.sido = pa.sido || sidoShort((home.region || '').split(' ')[0]); pa.hinted = true;
    }
    return pa;
  }
  function wantRank(pa) { return pa.ri || pa.road ? 3 : pa.emd ? 2 : pa.sgg ? 1 : 0; }

  // 1) 지명 좌표표에서 찾기. 반환 {lat, lng, geo, name, sido} 또는 null
  function tableFind(pa) {
    var P = places.p;
    if (!P || !pa.sgg) return null;
    var home = state.data && state.data.home, homeSido = home ? sidoShort((home.region || '').split(' ')[0]) : null;
    var sidos = pa.sido ? [pa.sido] : Object.keys(P);
    var tries = [];
    if (pa.ri) tries.push([pa.sgg + ' ' + pa.emd + ' ' + pa.ri, 'ri']);
    if (pa.emd) tries.push([pa.sgg + ' ' + pa.emd, 'emd']);
    tries.push([pa.sgg, 'sgg']);
    for (var i = 0; i < tries.length; i++) {
      var key = tries[i][0];
      var hits = sidos.filter(function (s) { return P[s] && P[s][key]; });
      if (hits.length > 1 && homeSido && hits.indexOf(homeSido) >= 0) hits = [homeSido];
      if (hits.length === 1) {
        var ll = P[hits[0]][key];
        return { lat: ll[0], lng: ll[1], geo: tries[i][1], name: SIDO_FULL[hits[0]] + ' ' + key, sido: hits[0], via: 'table' };
      }
    }
    return null;
  }

  function geoCache() {
    try { var c = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}'); return c && typeof c.q === 'object' ? c : { v: 1, q: {} }; }
    catch (e) { return { v: 1, q: {} }; }
  }
  function geoCachePut(q, val) {
    try {
      var c = geoCache(), keys = Object.keys(c.q);
      delete c.q[q];
      if (keys.length >= GEO_CACHE_MAX) keys.slice(0, keys.length - GEO_CACHE_MAX + 1).forEach(function (k) { delete c.q[k]; });
      c.q[q] = val;
      localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* 저장 못 해도 찾기는 된다 */ }
  }

  // Nominatim 한 번 묻기. 결과: [lat, lng], 0(없음), 또는 null(통신 실패·차단 → 이후 5분간 묻지 않음)
  function askNominatim(q) {
    var cached = geoCache().q[q];
    if (cached !== undefined) return Promise.resolve(cached);
    if (Date.now() < net.downUntil) return Promise.resolve(null);
    var wait = Math.max(0, net.last + NET_GAP_MS - Date.now());
    return new Promise(function (res) { setTimeout(res, wait); }).then(function () {
      net.last = Date.now();
      var ctl = window.AbortController ? new AbortController() : null;
      var to = ctl ? setTimeout(function () { ctl.abort(); }, NET_TIMEOUT_MS) : null;
      return fetch(NOMI_URL + encodeURIComponent(q), ctl ? { signal: ctl.signal, credentials: 'omit' } : { credentials: 'omit' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (res) {
          clearTimeout(to);
          net.last = Date.now();
          var v = 0;
          if (Array.isArray(res) && res[0]) {
            var lat = Number(res[0].lat), lng = Number(res[0].lon);
            if (lat >= 33 && lat <= 38.7 && lng >= 124.5 && lng <= 132) v = [Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
          }
          geoCachePut(q, v);
          return v;
        })
        .catch(function () { clearTimeout(to); net.last = Date.now(); net.downUntil = Date.now() + NET_PAUSE_MS; return null; });
    });
  }

  // 2) 표에서 읍면동 이하를 못 찾았을 때 주소 검색. base: 표에서 찾은 결과(없으면 null)
  function netFind(pa, base) {
    var sido = pa.sido || (base && base.sido);
    if (!pa.sgg && !pa.emd) return Promise.resolve(null); // 행정구역을 알아보지 못한 주소는 보내지 않는다
    var parts = [], ranks = [];
    if (sido) { parts.push(sido === '세종' ? '세종특별자치시' : SIDO_FULL[sido]); ranks.push(0); }
    if (pa.sgg && sido !== '세종') { parts.push(pa.sgg); ranks.push(1); }
    if (pa.emd) { parts.push(pa.emd); ranks.push(2); }
    if (pa.ri) { parts.push(pa.ri); ranks.push(3); }
    else if (pa.road) { parts.push(pa.road); ranks.push(3); }
    var floor = base ? GEO_RANK[base.geo] : 0, queries = [];
    for (var n = parts.length; n > 0 && queries.length < NET_TRIES; n--) {
      var r = ranks[n - 1];
      if (r <= floor || r < 2) break; // 표가 이미 아는 단계나 시군구 이하로는 묻지 않는다
      queries.push({ q: parts.slice(0, n).join(' '), geo: r === 2 ? 'emd' : pa.ri ? 'ri' : 'road' });
    }
    var center = sido && places.p && places.p[sido] ? places.p[sido][pa.sgg] : null;
    function next(i) {
      if (i >= queries.length) return Promise.resolve(null);
      return askNominatim(queries[i].q).then(function (v) {
        if (v === null) return null; // 통신 실패·차단: 더 묻지 않음
        if (v && (!center || km(center[0], center[1], v[0], v[1]) <= 60)) {
          return { lat: v[0], lng: v[1], geo: queries[i].geo, name: queries[i].q, sido: sido, via: 'osm' };
        }
        return next(i + 1);
      });
    }
    return next(0);
  }

  // 주소 → 위치. useNet 이 거짓이면 표만 쓴다(외부 호출 없음). 결과 {lat, lng, geo, name, addr, via} 또는 null
  function geocodeAddr(addr, useNet) {
    addr = String(addr || '').replace(/\s+/g, ' ').trim();
    return loadPlaces().then(function () {
      var pa = parseAddr(addr), base = tableFind(pa);
      if (pa.hinted && base && base.geo === 'sgg') base = null; // 기준 시군을 짐작해 넣은 경우 시군 중심만으로는 쓰지 않음
      var done = function (g) { if (g) g.addr = addr; return g; };
      if (!useNet || (base && GEO_RANK[base.geo] >= wantRank(pa))) return done(base);
      return netFind(pa, base).then(function (g) { return done(g || base); });
    });
  }

  // 좌표가 없는 예전 수기 항목을 표로만 채운다(화면을 열 때 한 번, 외부 호출 없음)
  function autoFillManual() {
    var todo = state.manual.filter(function (m) { return m.lat == null; });
    if (!todo.length) return;
    loadPlaces().then(function () {
      var n = 0;
      todo.forEach(function (m) {
        // 읍면동까지 적은 주소가 표에 시군구까지만 있으면 채우지 않는다(목록의 "위치 찾기"로 더 자세히 찾게)
        var pa = parseAddr(m.addr), g = tableFind(pa);
        if (!g || GEO_RANK[g.geo] < Math.min(wantRank(pa), 2)) return;
        m.lat = g.lat; m.lng = g.lng; m.geo = g.geo; m.geo_name = g.name; m.geo_addr = m.addr; n++;
      });
      if (!n) return;
      storeSave();
      flash('위치가 없던 수기 항목 ' + n + '건을 주소로 찾아 지도에 표시했습니다(지명 좌표표 기준).');
      if (state.data && !state.picking) render();
      if ($('manualDlg').open) renderManualList();
    });
  }

  // 목록의 "위치 찾기": 표와 주소 검색으로 찾는다
  function findForItem(id, btn) {
    var m = state.manual.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    btn.disabled = true; btn.textContent = '찾는 중…';
    geocodeAddr(m.addr, true).then(function (g) {
      btn.disabled = false; btn.textContent = '위치 찾기';
      if (!g) { $('dlgErr').textContent = '"' + m.addr + '"의 위치를 찾지 못했습니다. 수정을 눌러 지도에서 위치를 지정해 주세요.'; return; }
      m.lat = g.lat; m.lng = g.lng; m.geo = g.geo; m.geo_name = g.name; m.geo_addr = g.addr;
      m.updated = new Date().toISOString();
      storeSave();
      $('dlgErr').textContent = m.addr + ': ' + GEO_TEXT[g.geo] + '에 표시했습니다(' + g.name + ').';
      render();
      renderManualList();
    });
  }

  function form() { return $('manualForm'); }

  // ---------- 보도자료 대조 감시 (서버의 data/check.json 요약) ----------
  // 농식품부 보도자료의 누적 발표 건수와 현황판 건수가 다르면 위쪽 띠에 경고, 같으면 갱신 시각 아래에 작게 표시.
  var CHECK_STALE_MS = 12 * 3600 * 1000; // 보도자료 수집·대조는 2시간마다. 12시간 넘게 멈추면 경고
  function stamp(iso) { return iso ? shortDate(iso.slice(0, 10)) + ' ' + iso.slice(11, 16) : ''; }
  function renderCheck(c) {
    var box = $('checkNote'), small = $('checkOk');
    box.textContent = ''; small.textContent = '';
    if (!c || !c.items) { box.hidden = true; small.hidden = true; return; }
    // 이 PC의 수기 입력은 서버가 모르므로 화면에서 더해 본다(같은 질병, 같은 기간, 보도자료 다음 날까지)
    function manualIn(it) {
      var y = parseInt(it.period, 10), from, to;
      if (it.kind === 'season') { from = y + '-09-01'; to = (y + 1) + '-08-31'; }
      else { from = y + '-01-01'; to = y + '-12-31'; }
      var d = new Date(it.press_date + 'T00:00:00'); d.setDate(d.getDate() + 1);
      var upto = isoOf(d) < to ? isoOf(d) : to;
      return state.manual.filter(function (m) { return m.disease_key === it.key && m.date >= from && m.date <= upto; }).length;
    }
    var items = c.items.map(function (it0) {  // 서버 값은 그대로 두고 사본에 더한다(다시 그릴 때 겹쳐 더하지 않게)
      var it = {}; Object.keys(it0).forEach(function (k) { it[k] = it0[k]; });
      it.manual = it.press == null ? 0 : manualIn(it);
      if (it.status === 'missing' && it.ours + it.manual >= it.press) it.status = 'ok';
      else if (it.status === 'missing') it.missing = it.press - it.ours - it.manual;
      return it;
    });
    var miss = items.filter(function (it) { return it.status === 'missing'; });
    var stale = !c.last_ok || Date.now() - new Date(c.last_ok).getTime() > CHECK_STALE_MS;
    var failed = c.status === 'fail' || stale;
    var detail = items.map(function (it) {
      var p = it.kind === 'season' ? "'" + it.period.slice(2, 4) + "/'" + it.period.slice(5) + ' 동절기' : it.period + '년';
      return it.label + ' ' + p + ': ' + (it.press == null ? '발표 누적 없음' : '발표 ' + it.press + '건(' + shortDate(it.press_date) + ' 보도자료)') +
        ', 현황판 ' + it.ours_total + '건' + (it.manual ? '(이 PC 수기 ' + it.manual + '건 별도)' : '');
    }).join('\n') + '\n농식품부 보도자료의 누적 문구와 비교합니다. 하루 4번 확인합니다.';
    miss.forEach(function (it) {
      var row = el('div', 'check-row');
      var t = el('span', null, '');
      t.appendChild(el('b', null, '자료 점검: '));
      t.appendChild(document.createTextNode(it.label + ' 발표 ' + it.press + '건, 현황판 ' + it.ours + '건' +
        (it.manual ? '(+이 PC 수기 ' + it.manual + '건)' : '') + '. ' + it.missing + '건 미반영'));
      t.appendChild(el('span', 'check-sub', ' (' + shortDate(it.press_date) + ' 보도자료 기준)'));
      row.appendChild(t);
      if (it.url) {
        var a = el('a', null, '보도자료 보기');
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
        a.title = it.title || '';
        row.appendChild(a);
      }
      var b = el('button', null, '발생 입력');
      b.type = 'button';
      b.setAttribute('data-disease', it.key);
      b.title = '빠진 발생을 이 PC에 직접 입력합니다';
      row.appendChild(b);
      box.appendChild(row);
    });
    var fd = c.feeds, feedFail = !!fd && (fd.status === 'fail' ||
      (fd.last_ok && Date.now() - new Date(fd.last_ok).getTime() > CHECK_STALE_MS));
    if (feedFail) {
      var ff = el('div', 'check-row');
      ff.appendChild(el('b', null, '보도자료 수집 실패: '));
      ff.appendChild(document.createTextNode('보도자료 자동 수집이 ' + (fd.status === 'fail' ? '실패했습니다(' + stamp(fd.checked) + '). ' : '오래 멈춰 있습니다. ') +
        (fd.last_ok ? '마지막 성공 ' + stamp(fd.last_ok) + '.' : '아직 성공한 적이 없습니다.')));
      ff.title = fd.error || '';
      box.appendChild(ff);
    }
    if (failed) {
      var fr = el('div', 'check-row');
      fr.appendChild(el('b', null, '대조 실패: '));
      fr.appendChild(document.createTextNode(
        (c.status === 'fail' ? '농식품부 보도자료를 읽지 못했습니다(' + stamp(c.checked) + '). ' : '보도자료 대조가 오래 멈춰 있습니다. ') +
        (c.last_ok ? '마지막 대조 ' + stamp(c.last_ok) + '.' : '아직 대조한 적이 없습니다.')));
      fr.title = c.error || '';
      box.appendChild(fr);
    }
    box.hidden = !box.childNodes.length;
    box.className = 'notice check-note' + (miss.length || failed || feedFail ? ' warn' : '');
    box.title = detail;
    if (!miss.length && !failed && !feedFail) {
      small.textContent = '마지막 대조 ' + stamp(c.last_ok) + ', 발표와 일치';
      small.title = detail;
      small.hidden = false;
    } else small.hidden = true;
  }

  function setupManual() {
    storeLoad();
    $('storeWarn').hidden = state.storeOk;
    form().elements.disease_key.addEventListener('change', syncEtc);
    form().addEventListener('submit', function (e) { e.preventDefault(); submitManual(); });
    Array.prototype.forEach.call($('manualDlg').querySelectorAll('[data-close]'), function (b) {
      b.addEventListener('click', function () { $('manualDlg').close(); });
    });
    $('manualBtn').addEventListener('click', function () { openDialog(null); });
    $('facFold').addEventListener('click', function () { state.fold.fac = !state.fold.fac; save(); if (state.data) render(); });
    // 보도자료 대조 경고의 "발생 입력" 단추: 그 질병을 골라 둔 입력 창을 연다
    $('checkNote').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-disease]');
      if (!b) return;
      openDialog(null);
      form().elements.disease_key.value = b.getAttribute('data-disease');
      syncEtc();
    });
    $('dlgNew').addEventListener('click', function () { openDialog(null); });
    $('pickBtn').addEventListener('click', function () { startPick(null); });
    $('findBtn').addEventListener('click', findByAddr);
    form().elements.addr.addEventListener('input', syncPick);
    $('pickClear').addEventListener('click', function () { state.pick = null; syncPick(); });
    $('pickOk').addEventListener('click', function () {
      if (state.pickMarker) {
        var ll = state.pickMarker.getLatLng(), p = state.pick;
        // 주소로 찾은 위치를 그대로 두면 그 정밀도를 유지하고, 옮겼으면 직접 지정한 위치로 본다
        var same = p && p.geo !== 'pick' && Math.abs(p.lat - ll.lat) < 1e-7 && Math.abs(p.lng - ll.lng) < 1e-7;
        if (!same) state.pick = { lat: ll.lat, lng: ll.lng, geo: 'pick' };
      }
      endPick();
    });
    $('pickCancel').addEventListener('click', function () { state.pick = state.pickPrev; endPick(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.picking) { state.pick = state.pickPrev; endPick(); } });
    autoFillManual();
    $('exportBtn').addEventListener('click', exportManual);
    $('importBtn').addEventListener('click', function () { $('importFile').value = ''; $('importFile').click(); });
    $('importFile').addEventListener('change', importManual);
  }

  function syncEtc() { $('etcWrap').hidden = form().elements.disease_key.value !== 'etc'; }
  function addrNow() { return form().elements.addr.value.replace(/\s+/g, ' ').trim(); }
  function syncPick() {
    var p = state.pick, geo = p ? p.geo || 'pick' : null;
    var stale = p && geo !== 'pick' && p.addr !== addrNow();
    $('pickText').textContent = !p
      ? '위치를 지정하지 않으면 저장할 때 주소로 위치를 찾아 지도에 표시합니다.'
      : stale ? '주소를 고쳤으므로 저장할 때 위치를 다시 찾습니다.'
      : GEO_TEXT[geo] + (geo !== 'pick' && p.name ? ' (' + p.name + ')' : '') + ': ' + p.lat.toFixed(5) + ', ' + p.lng.toFixed(5);
    $('pickClear').hidden = !p;
  }

  // "주소로 위치 찾기": 찾은 위치를 지도에 미리 보여 주고, 맞으면 정하고 다르면 지도를 눌러 고치게 한다
  function findByAddr() {
    var addr = addrNow(), btn = $('findBtn');
    if (!addr) { $('dlgErr').textContent = '주소를 먼저 적어 주세요.'; return; }
    btn.disabled = true; btn.textContent = '찾는 중…';
    $('dlgErr').textContent = '';
    geocodeAddr(addr, true).then(function (g) {
      btn.disabled = false; btn.textContent = '주소로 위치 찾기';
      if (!g) { $('dlgErr').textContent = '주소로 위치를 찾지 못했습니다. 지도를 눌러 위치를 지정해 주세요.'; return; }
      startPick(g);
    });
  }

  function openDialog(id) {
    var f = form(), m = id ? state.manual.filter(function (x) { return x.id === id; })[0] : null;
    f.reset();
    state.editId = m ? m.id : null;
    state.pick = m && m.lat != null ? { lat: m.lat, lng: m.lng, geo: m.geo || 'pick', name: m.geo_name, addr: m.geo_addr || m.addr } : null;
    $('dlgTitle').textContent = m ? '수기 입력 수정' : '발생 수기 입력';
    $('dlgSave').textContent = m ? '고친 내용 저장' : '저장';
    $('dlgNew').hidden = !m;
    $('dlgErr').textContent = '';
    if (m) {
      ['disease_key', 'date', 'addr', 'species', 'memo'].forEach(function (k) { f.elements[k].value = m[k] || ''; });
      f.elements.disease_text.value = m.disease_key === 'etc' ? m.disease : '';
      f.elements.end.value = m.end || '';
      f.elements.count.value = m.count == null ? '' : m.count;
      f.elements.stage.value = m.stage || 'confirmed';
    } else {
      f.elements.stage.value = 'confirmed';
      f.elements.date.value = isoOf(new Date());
      var h = state.data && state.data.home;
      f.elements.addr.value = h ? h.region + ' ' + h.name + ' ' : '';
    }
    f.elements.date.max = isoOf(new Date());
    f.elements.end.max = isoOf(new Date());
    syncEtc();
    syncPick();
    renderManualList();
    if (!$('manualDlg').open) $('manualDlg').showModal();
  }

  // found: 주소로 찾은 위치(미리 보기). 없으면 지도에서 직접 지정
  function startPick(found) {
    if (!state.map) return;
    state.picking = true;
    state.pickPrev = state.pick;
    $('manualDlg').close();
    $('pickBar').hidden = false;
    $('pickOk').disabled = true;
    $('pickMsg').textContent = found
      ? GEO_TEXT[found.geo] + ' (' + found.name + ')입니다. 맞으면 "이 위치로 정하기"를, 다르면 지도를 누르거나 표지를 끌어 고치세요.'
      : '지도에서 발생 위치를 누르세요. 표지는 끌어서 옮길 수 있습니다.';
    document.body.classList.add('picking');
    if (found) state.pick = found;
    if (state.pick) {
      placePick(state.pick);
      state.map.setView([state.pick.lat, state.pick.lng], Math.max(state.map.getZoom(), found && found.geo === 'sgg' ? 10 : 12));
    }
  }
  function placePick(ll) {
    if (!state.pickMarker) {
      var icon = el('div', 'pick-pin');
      state.pickMarker = L.marker(ll, {
        draggable: true, zIndexOffset: 3000, title: '끌어서 위치 조정', alt: '지정할 위치',
        icon: L.divIcon({ className: '', html: icon, iconSize: [26, 26], iconAnchor: [13, 13] })
      }).addTo(state.map);
    } else {
      state.pickMarker.setLatLng(ll);
    }
    $('pickOk').disabled = false;
  }
  function endPick() {
    state.picking = false;
    if (state.pickMarker) { state.map.removeLayer(state.pickMarker); state.pickMarker = null; }
    $('pickBar').hidden = true;
    document.body.classList.remove('picking');
    syncPick();
    $('manualDlg').showModal();
  }

  // 저장: 지도에서 직접 지정한 위치가 항상 우선. 없으면(또는 주소를 고쳤으면) 주소로 위치를 찾은 뒤 저장한다.
  function submitManual() {
    if (state.saving) return;
    var f = form(), body = {};
    ['disease_key', 'disease_text', 'date', 'end', 'addr', 'species', 'count', 'memo', 'stage'].forEach(function (k) { body[k] = f.elements[k].value.trim(); });
    var old = state.editId ? state.manual.filter(function (x) { return x.id === state.editId; })[0] : null;
    if (old) { body.id = old.id; body.created = old.created; body.updated = new Date().toISOString(); }
    // 단계를 바꾸면 앞 단계와 그 날짜를 이력으로 남기고, 새 단계의 날짜는 오늘로 둔다
    var oldStage = old ? old.stage || 'confirmed' : null;
    if (old && oldStage !== body.stage) {
      body.history = (old.history || []).concat([{ stage: oldStage, date: old.stage_date || old.date }]);
      body.stage_date = isoOf(new Date()) < body.date ? body.date : isoOf(new Date());
    } else if (old) {
      body.history = old.history || [];
      body.stage_date = old.history && old.history.length ? old.stage_date : null;
    }
    if (!old && state.manual.length >= MANUAL_MAX) { $('dlgErr').textContent = '수기 항목이 너무 많습니다. 오래된 항목을 지워 주세요.'; return; }
    var item;
    try { item = checkItem(body, false); } catch (e) { $('dlgErr').textContent = e.message; return; }
    var p = state.pick, keep = p && ((p.geo || 'pick') === 'pick' || p.addr === item.addr);
    state.saving = true;
    $('dlgSave').disabled = true;
    if (!keep) { $('dlgSave').textContent = '위치 찾는 중…'; $('dlgErr').textContent = ''; }
    (keep ? Promise.resolve(p) : geocodeAddr(item.addr, true)).then(function (g) {
      state.saving = false;
      $('dlgSave').disabled = false;
      $('dlgSave').textContent = old ? '고친 내용 저장' : '저장';
      if (g) {
        body.lat = g.lat; body.lng = g.lng; body.geo = g.geo || 'pick';
        body.geo_name = g.name || ''; body.geo_addr = body.geo === 'pick' ? '' : g.addr || item.addr;
      }
      try { item = checkItem(body, false); } catch (e) { $('dlgErr').textContent = e.message; return; }
      if (old) state.manual = state.manual.map(function (x) { return x.id === old.id ? item : x; });
      else state.manual.push(item);
      var ok = storeSave();
      if (!ok) {
        $('manualDlg').close();
        flash('이 브라우저에 저장하지 못했습니다. 화면을 새로 고치면 입력한 내용이 사라집니다.');
      } else if (item.lat == null) {
        // 저장은 했지만 위치를 못 찾음: 창을 그 항목의 수정 상태로 두고 지도에서 지정하도록 안내
        openDialog(item.id);
        $('dlgErr').textContent = '저장했습니다. 다만 주소로 위치를 찾지 못했습니다. 지도를 눌러 위치를 지정해 주세요.';
      } else {
        $('manualDlg').close();
        flash(item.geo === 'pick' ? '저장했습니다.' : '저장했습니다. ' + GEO_TEXT[item.geo] + '(' + item.geo_name + ')에 표시했습니다.');
      }
      render();
    });
  }

  function removeManual(id) {
    var m = state.manual.filter(function (x) { return x.id === id; })[0];
    if (!m || !window.confirm('수기 입력 항목을 지울까요?\n' + m.disease + ', ' + m.addr + ', ' + m.date)) return;
    state.manual = state.manual.filter(function (x) { return x.id !== id; });
    storeSave();
    if (state.editId === id) state.editId = null;
    flash('수기 입력 항목을 지웠습니다.');
    render();
    if ($('manualDlg').open) openDialog(null);
  }

  function exportManual() {
    // icons: 아이콘 설정(바꾼 값만). 이 칸이 없는 예전 파일도 그대로 가져올 수 있다
    var body = JSON.stringify({ format: 'dash-manual', version: 1, exported: new Date().toISOString(), items: state.manual,
      icons: { version: 1, disease: icons.disease, facility: icons.facility } }, null, 1);
    var url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    var a = el('a');
    a.href = url;
    a.download = '발생수기입력-' + isoOf(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importManual() {
    var file = $('importFile').files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { $('dlgErr').textContent = '파일이 너무 큽니다(1MB 이하).'; return; }
    var rd = new FileReader();
    rd.onload = function () {
      var items, obj, ic = null;
      try { obj = JSON.parse(rd.result) || {}; items = obj.items; } catch (e) { items = null; }
      if (obj && obj.icons && typeof obj.icons === 'object') ic = cleanIcons(obj.icons);
      if (!Array.isArray(items) && ic) items = [];
      if (!Array.isArray(items)) { $('dlgErr').textContent = '이 현황판에서 내보낸 파일이 아닙니다.'; return; }
      // 아이콘 설정은 파일에 바꾼 값이 있을 때만 이 PC 설정을 파일 내용으로 바꾼다
      var icMsg = '';
      if (ic && Object.keys(ic.disease).length + Object.keys(ic.facility).length) {
        icons = ic; applyIcons(); saveIcons();
        icMsg = ', 아이콘 설정 ' + iconCount() + '개 항목 적용';
      }
      var added = 0, replaced = 0, skipped = 0;
      items.forEach(function (x) {
        var it;
        try { it = checkItem(x, true); } catch (e) { skipped++; return; }
        var i = state.manual.map(function (m) { return m.id; }).indexOf(it.id);
        if (i >= 0) { state.manual[i] = it; replaced++; }
        else if (state.manual.length < MANUAL_MAX) { state.manual.push(it); added++; }
        else skipped++;
      });
      storeSave();
      autoFillManual(); // 좌표 없이 들어온 항목은 지명 좌표표로만 채운다(외부 호출 없음)
      render();
      openDialog(null);
      $('dlgErr').textContent = '가져오기: 새 항목 ' + added + '건, 같은 항목 덮어쓰기 ' + replaced + '건' + (skipped ? ', 건너뜀 ' + skipped + '건' : '') + icMsg;
    };
    rd.onerror = function () { $('dlgErr').textContent = '파일을 읽지 못했습니다.'; };
    rd.readAsText(file);
  }

  var flashT = null;
  function flash(msg) {
    state.flash = { msg: msg, until: Date.now() + 8000 };
    clearTimeout(flashT);
    flashT = setTimeout(function () { if (state.data) render(); }, 8100);
  }

  function renderManualList(all) {
    var ol = $('manualList');
    ol.textContent = '';
    if (all) { state.match = {}; all.forEach(function (it) { if (it.source === 'manual') state.match[it.id] = it.api_match; }); }
    var match = state.match || {};
    state.manual.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }).forEach(function (m) {
      var li = el('li', state.editId === m.id ? 'on' : null);
      var line = el('div', 'ml');
      line.appendChild(el('b', null, m.disease));
      line.appendChild(stageBadge(m.stage || 'confirmed'));
      line.appendChild(el('span', 'muted', m.date + ' · ' + m.addr + ' · ' + m.species));
      var gl = el('span', 'mgeo' + (m.lat == null ? ' none' : m.geo !== 'pick' ? ' rough' : ''),
        m.lat == null ? '위치 미확인' : GEO_TEXT[m.geo] + (m.geo !== 'pick' && m.geo_name ? ' · ' + m.geo_name : ''));
      if (m.lat != null && m.geo !== 'pick') gl.title = '방역대 원이 실제 위치와 다를 수 있습니다. 정확한 위치를 알면 수정에서 지도로 지정하세요.';
      line.appendChild(gl);
      li.appendChild(line);
      li.appendChild(manualActions({ id: m.id, api_match: match[m.id], lat: m.lat, inDialog: true }));
      ol.appendChild(li);
    });
    $('manualCount').textContent = state.manual.length + '건';
    if (!state.manual.length) ol.appendChild(el('li', 'empty', '아직 입력한 항목이 없습니다'));
  }

  // ---------------------------------------------------------------- 아이콘 바꾸기 창
  // 왼쪽 목록의 아이콘을 누르면 열린다. 고르는 즉시 화면 전체에 반영하고 이 브라우저에 저장한다. Esc, 바깥 누르기로 닫는다.
  var pop = { el: null, kind: null, key: null, name: null };

  function iconButton(kind, key, name, icon) {
    var b = el('button', 'ico-btn');
    b.type = 'button';
    b.dataset.iconKind = kind;
    b.dataset.iconKey = key;
    b.dataset.tip = '아이콘 바꾸기';
    b.setAttribute('aria-label', name + ' 아이콘 바꾸기');
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-expanded', pop.el && pop.kind === kind && pop.key === key ? 'true' : 'false');
    b.appendChild(icon);
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (pop.el && pop.kind === kind && pop.key === key) closeIconPop(true);
      else openIconPop(kind, key, name, b);
    });
    return b;
  }
  function iconAnchor() {
    var list = document.querySelectorAll('.ico-btn');
    for (var i = 0; i < list.length; i++) if (list[i].dataset.iconKind === pop.kind && list[i].dataset.iconKey === pop.key) return list[i];
    return null;
  }

  function openIconPop(kind, key, name, anchor) {
    closeIconPop(false);
    var box = el('div', 'icon-pop');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', name + ' 아이콘 바꾸기');
    box.tabIndex = -1;
    pop = { el: box, kind: kind, key: key, name: name };
    document.body.appendChild(box);
    fillIconPop();
    placeIconPop(anchor);
    anchor.setAttribute('aria-expanded', 'true');
    var first = box.querySelector('.ip-opt[aria-pressed="true"]') || box;
    first.focus();
  }
  function placeIconPop(anchor) {
    var r = anchor.getBoundingClientRect(), box = pop.el, gap = 10, vw = window.innerWidth, vh = window.innerHeight;
    var w = box.offsetWidth, hgt = box.offsetHeight;
    // 왼쪽 열 바로 오른쪽(지도 위)에 띄워 목록을 가리지 않는다. 자리가 없으면 아이콘 옆
    var col = anchor.closest('.col'), cr = col ? col.getBoundingClientRect() : r;
    var left = cr.right + gap;
    if (left + w > vw - 8) left = r.right + gap;
    if (left + w > vw - 8) left = Math.max(8, r.left - w - gap);
    var top = Math.min(r.top - 12, vh - hgt - 8);
    box.style.left = Math.max(8, Math.min(left, vw - w - 8)) + 'px';
    box.style.top = Math.max(8, top) + 'px';
  }
  function closeIconPop(focusBack) {
    if (!pop.el) return;
    pop.el.remove();
    var a = iconAnchor();
    pop = { el: null, kind: null, key: null, name: null };
    if (a) { a.setAttribute('aria-expanded', 'false'); if (focusBack) a.focus(); }
  }

  // 지금 고른 값, 기본값, 같은 아이콘을 쓰는 다른 항목
  function popState() {
    if (pop.kind === 'd') {
      var g = GROUPS.filter(function (x) { return x.id === pop.key; })[0];
      var cur = diseaseSpec(g), dup = GROUPS.filter(function (x) {
        if (x === g) return false;
        var o = diseaseSpec(x);
        return o.shape === cur.shape && o.color === cur.color;
      }).map(function (x) { return x.name; });
      return { cur: cur, def: diseaseDefault(g), dup: dup, mapSize: g.core ? 22 : 14, g: g };
    }
    var t = pop.key, fc = facSpec(t);
    var fdup = (state.facTypes || []).filter(function (x) {
      if (x === t) return false;
      var o = facSpec(x);
      return o.glyph === fc.glyph && o.color === fc.color;
    });
    return { cur: fc, def: facDefault(t), dup: fdup, mapSize: 18 };
  }
  function drawSpec(kind, spec, size, faded) {
    return kind === 'd' ? shapeIcon({ shape: spec.shape, color: colorOf(spec.color) }, size, faded) : facIconOf(size, spec);
  }

  function setIcon(patch) {
    var ps = popState(), next = {}, def = ps.def, store = pop.kind === 'd' ? icons.disease : icons.facility;
    Object.keys(ps.cur).forEach(function (k) { next[k] = k in patch ? patch[k] : ps.cur[k]; });
    var diff = {};
    Object.keys(next).forEach(function (k) { if (next[k] !== def[k]) diff[k] = next[k]; });
    if (Object.keys(diff).length) store[pop.key] = diff; else delete store[pop.key];
    afterIconChange();
  }
  function afterIconChange() {
    var ok = saveIcons();
    applyIcons();
    if (!ok) flash('이 브라우저에 아이콘 설정을 저장하지 못했습니다. 화면을 새로 고치면 기본 아이콘으로 돌아갑니다.');
    if (state.data) render(); else fillIconPop();
    var a = iconAnchor();
    if (a && pop.el) placeIconPop(a);
  }

  function fillIconPop() {
    var box = pop.el, kind = pop.kind, ps = popState(), cur = ps.cur;
    if (kind === 'f' && (state.facTypes || []).indexOf(pop.key) < 0 && state.facTypes) { closeIconPop(false); return; }
    var keepFocus = document.activeElement && box.contains(document.activeElement) ? document.activeElement.dataset.opt : null;
    box.textContent = '';

    var head = el('div', 'ip-head');
    head.appendChild(el('h3', null, pop.name + ' 아이콘'));
    var x = el('button', 'ghost sm', '닫기');
    x.type = 'button';
    x.addEventListener('click', function () { closeIconPop(true); });
    head.appendChild(x);
    box.appendChild(head);

    function section(title, list, field) {
      var sec = el('div', 'ip-sec');
      sec.appendChild(el('div', 'ip-lab', title));
      var grid = el('div', 'ip-grid' + (field === 'color' ? ' cols5' : ''));
      grid.setAttribute('role', 'group');
      grid.setAttribute('aria-label', title);
      list.forEach(function (o) {
        var isDef = ps.def[field] === o.id;
        var b = el('button', 'ip-opt' + (isDef ? ' is-def' : ''));
        b.type = 'button';
        b.dataset.opt = field + ':' + o.id;
        var spec = {}; Object.keys(cur).forEach(function (k) { spec[k] = cur[k]; });
        spec[field] = o.id;
        b.appendChild(drawSpec(kind, spec, 22));
        b.title = o.name + (isDef ? ' (기본값)' : '');
        b.setAttribute('aria-label', title + ' ' + o.name + (isDef ? ', 기본값' : ''));
        b.setAttribute('aria-pressed', cur[field] === o.id ? 'true' : 'false');
        b.addEventListener('click', function () { var p = {}; p[field] = o.id; setIcon(p); });
        grid.appendChild(b);
      });
      sec.appendChild(grid);
      box.appendChild(sec);
    }
    section('모양', kind === 'd' ? D_SHAPES : F_GLYPHS, kind === 'd' ? 'shape' : 'glyph');
    section('색', PALETTE, 'color');
    box.appendChild(el('p', 'ip-note', '점선 칸이 처음 값입니다. 색각 이상이 있어도 구분되도록 색만 바꾸지 말고 모양도 다른 항목과 다르게 고르세요.'));

    var prev = el('div', 'ip-prev');
    function cell(label, size, cls, withFaded) {
      var c = el('div', 'ip-cell');
      var tile = el('div', 'ip-tile ' + cls);
      tile.appendChild(drawSpec(kind, cur, size));
      if (withFaded) tile.appendChild(drawSpec(kind, cur, size, true));
      c.appendChild(tile);
      c.appendChild(el('span', null, label));
      prev.appendChild(c);
    }
    var fd = kind === 'd';
    cell('목록', 22, 'list', false);
    cell('지도(어두운 곳)', ps.mapSize, 'dark', fd);
    cell('지도(밝은 곳)', ps.mapSize, 'light', fd);
    box.appendChild(prev);
    if (fd) box.appendChild(el('p', 'ip-hint', '지도 미리보기의 오른쪽 흐린 표지는 30일이 지난 발생입니다.'));

    var dup = el('p', 'ip-dup');
    dup.setAttribute('role', 'status');
    if (ps.dup.length) {
      var last = ps.dup[ps.dup.length - 1];
      dup.textContent = ps.dup.join(', ') + josa(last, '과', '와') + ' 같은 아이콘입니다. 지도에서 구분하기 어렵습니다.';
    }
    dup.hidden = !ps.dup.length;
    box.appendChild(dup);

    var act = el('div', 'ip-actions');
    var isDefault = Object.keys(cur).every(function (k) { return cur[k] === ps.def[k]; });
    var reset = el('button', 'ghost sm', '기본값으로');
    reset.type = 'button';
    reset.disabled = isDefault;
    reset.title = '이 항목만 처음 아이콘으로 되돌립니다';
    reset.addEventListener('click', function () { setIcon(ps.def); });
    act.appendChild(reset);
    box.appendChild(act);

    var foot = el('div', 'ip-foot');
    var all = el('button', 'ghost sm danger', '모든 아이콘 기본값으로');
    all.type = 'button';
    all.disabled = !iconCount();
    all.addEventListener('click', function () {
      if (!window.confirm('질병과 시설의 아이콘을 모두 처음 모양과 색으로 되돌릴까요?')) return;
      icons = { disease: {}, facility: {} };
      afterIconChange();
    });
    foot.appendChild(all);
    foot.appendChild(el('span', 'muted', '이 PC 브라우저에 저장'));
    box.appendChild(foot);

    if (keepFocus) {
      var again = box.querySelector('[data-opt="' + keepFocus + '"]');
      if (again) again.focus();
    } else if (!box.contains(document.activeElement)) box.focus();
  }

  document.addEventListener('pointerdown', function (e) {
    if (!pop.el || pop.el.contains(e.target) || e.target.closest('.ico-btn')) return;
    closeIconPop(false);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && pop.el) { e.stopPropagation(); closeIconPop(true); }
  }, true);

  // 서버가 쓰는 시각은 시간대 표시 없는 한국 시각이다. PC 시간대 설정과 무관하게 한국 시각으로 읽는다.
  function parseKst(s) {
    if (!s || typeof s !== 'string') return NaN;
    return new Date(/([zZ]|[+-]\d\d:?\d\d)$/.test(s) ? s : s + '+09:00').getTime();
  }
  function agoText(ms) {
    var m = Math.floor(ms / 60000);
    return m < 120 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + m % 60 + '분' : '');
  }
  function kstLabel(s) {
    var u = String(s).replace('T', ' ');
    return (u.slice(0, 10) === isoOf(new Date()) ? '' : shortDate(u.slice(0, 10)) + ' ') + u.slice(11, 16);
  }

  // 안내 띠. 자료를 새로 받을 때와 10초마다(tick) 다시 따진다. 공개본에서도 자료의 갱신 시각과 지금 시각을 비교한다.
  function updateNotice() {
    var data = state.data;
    if (!data) return;
    var notice = $('notice'), msg = '', cls = 'notice';
    var t = parseKst(data.updated), age = isFinite(t) ? Date.now() - t : 0;
    var h = data.health || {}, stale = data.mode === 'live' && age > STALE_MS;
    var lastOk = data.updated ? ' 마지막 갱신 ' + kstLabel(data.updated) + '(' + agoText(Math.max(0, age)) + ' 전).' : '';
    if (state.netErr && !IS_PUBLIC) {
      msg = '서버에 연결하지 못했습니다. 서버가 꺼졌을 수 있습니다(' + state.netErr + ').' + lastOk; cls += ' err';
    } else if (h.sync_fail > 0) {
      msg = '자료 수집이 ' + (h.sync_fail > 1 ? h.sync_fail + '회 연속 ' : '') + '실패했습니다' + (h.sync_error ? '(' + h.sync_error + ')' : '') + '.' + lastOk +
        ' 다음 주기에 자동으로 다시 시도합니다.'; cls += (stale || h.sync_fail >= 2) ? ' err' : ' warn';
    } else if (data.error && !h.sync_fail) { msg = data.error; cls += ' err'; }
    else if (data.mode === 'demo') { msg = data.message || '가상 데이터로 표시 중입니다. 실제 발생 정보가 아닙니다.'; cls += ' warn'; }
    else if (stale) {
      msg = '갱신 지연: 마지막 갱신이 ' + kstLabel(data.updated) + '(' + agoText(age) + ' 전)입니다. 30분마다 갱신되어야 하는데 늦어지고 있습니다. ' + (IS_PUBLIC
        ? '현황판 서버(시청 맥북)가 꺼졌거나 잠자기 중일 수 있습니다. 화면의 내용이 최신이 아닐 수 있습니다.'
        : '서버 창이 열려 있는지, 맥북이 잠자기 중이 아니었는지 확인해 주세요.');
      cls += ' err';
    } else if (!IS_PUBLIC && h.publish_fail >= 2) {
      msg = '공개본(행정망 PC용) 올리기가 ' + h.publish_fail + '회 연속 실패했습니다' + (h.publish_error ? '(' + h.publish_error + ')' : '') +
        '. 이 화면은 최신이지만 공개본은 늦어지고 있습니다.'; cls += ' warn';
    }
    else if (state.netErr) { msg = '자료를 새로 받지 못했습니다. 잠시 뒤 다시 시도합니다(' + state.netErr + ').' + lastOk; cls += ' warn'; }
    else if (state.flash && state.flash.until > Date.now()) { msg = state.flash.msg; }
    else if (data.message) { msg = data.message; }
    notice.hidden = !msg;
    if (notice.className !== cls) notice.className = cls;
    if (notice.textContent !== msg) notice.textContent = msg; // 같은 글을 10초마다 다시 넣으면 화면 낭독기가 되풀이해 읽음
    if (data.updated) {
      var up = $('updated');
      var ut = '자료 갱신 ' + kstLabel(data.updated) + (stale ? ' · 지연' : '');
      if (up.textContent !== ut) up.textContent = ut;
      up.classList.toggle('stale', stale);
      up.title = '농림축산검역본부 발생정보를 마지막으로 받은 시각입니다. 30분마다 갱신됩니다.';
    }
  }

  function load() {
    return fetch('api/outbreaks', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (state.picking) return; // 위치를 지정하는 동안에는 화면을 다시 그리지 않음
        if (!data.home) { // 서버가 첫 자료를 받는 중
          var n = $('notice');
          n.hidden = false; n.className = 'notice'; n.textContent = data.message || '자료를 받는 중입니다.';
          setTimeout(load, 5000);
          return;
        }
        if (!state.map) initMap(data.home);
        state.data = data;
        state.netErr = null;
        render();
      })
      .catch(function (e) {
        state.netErr = e.message;
        if (state.data) { updateNotice(); return; }
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
    // 자정이 지나면 '오늘 추종' 구간과 상황 판정을 새 날짜로 다시 계산
    if (state.data && state.dayKey && state.dayKey !== isoOf(d) && !state.picking) render();
    else if (state.data && !state.picking) updateNotice(); // 자료를 못 받아도 시간이 흐르면 지연 띠가 뜨게
  }

  $('rangeQuick').addEventListener('click', function (e) {
    var b = e.target.closest('button'), q = b && QUICK[b.dataset.q];
    if (!q) return;
    state.range = q.mode === 'rel' ? { mode: 'rel', days: q.days } : q.mode === 'mon' ? { mode: 'mon', months: q.months } : { mode: 'ytd' };
    rangeMsg(null); save(); render();
  });
  $('chartUnit').addEventListener('click', function (e) {
    var b = e.target.closest('button'), u = b && b.dataset.u;
    if (!u || !state.data) return;
    if (state.hist && state.hist.status === 'error') state.hist = null; // 실패했으면 다시 시도
    state.unit = u;
    saveUnit();
    if (state.chartArgs) drawChart(state.chartArgs.shown, state.chartArgs.all);
  });
  $('rangeToday').addEventListener('click', function () {
    // 고정했던 구간 길이를 유지한 채 종료일만 오늘로
    state.range = { mode: 'rel', days: currentRange().days };
    rangeMsg(null); save(); render();
  });
  ['start', 'end'].forEach(function (w) {
    var inp = $(w === 'start' ? 'rangeStart' : 'rangeEnd');
    inp.addEventListener('change', function () { setRangeFromInputs(w); });
    inp.addEventListener('blur', function () { if (state.data) syncRangeInputs(currentRange()); });
  });
  var rt = null;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (state.map) state.map.invalidateSize();
      if (state.data) render();
      var a = pop.el && iconAnchor();
      if (a) placeIconPop(a); else if (pop.el) closeIconPop(false);
    }, 200);
  });
  tick(); setInterval(tick, 10000);
  setupManual();
  load(); setInterval(load, REFRESH_MS);
})();
