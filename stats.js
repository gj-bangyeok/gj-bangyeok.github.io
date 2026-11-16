/* 가축질병 발생 통계 화면.
   api/history(1995년 이후 전체 발생 자료)를 한 번 받아 브라우저 안에서 조건별로 집계하고, 엑셀(.xlsx)도 브라우저 안에서 만든다.
   서버로는 자료를 받는 요청 하나만 보낸다. */
(function () {
  'use strict';

  var HOME = { sido: '경상북도', sgg: '경주시' };
  var MAJOR = ['구제역', '고병원성조류인플루엔자', '아프리카돼지열병', '럼피스킨병', '결핵병', '브루셀라병'];
  var DISASTER = ['구제역', '고병원성조류인플루엔자', '아프리카돼지열병', '럼피스킨병'];
  var DISEASE_ALIAS = { '고병원성 조류인플루엔자': '고병원성조류인플루엔자', '가금티프스': '가금티푸스', '럼피스킨': '럼피스킨병' };
  var SIDO_ALIAS = {
    '서울': '서울특별시', '부산': '부산광역시', '대구': '대구광역시', '인천': '인천광역시', '광주': '광주광역시',
    '대전': '대전광역시', '울산': '울산광역시', '세종': '세종특별자치시', '경기': '경기도', '강원': '강원특별자치도',
    '강원도': '강원특별자치도', '충북': '충청북도', '충남': '충청남도', '전북': '전북특별자치도', '전라북도': '전북특별자치도',
    '전남': '전라남도', '경북': '경상북도', '경남': '경상남도', '제주': '제주특별자치도', '제주도': '제주특별자치도'
  };
  var SIDO_ORDER = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시',
    '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도'];
  var DIM_LABEL = { disease: '질병별', sido: '시도별', sgg: '시군구별', emd: '읍면동별', year: '연도별', ym: '월별(연-월)',
    month: '달별 계절성(1~12월 합계)', spg: '축종별(대분류)', sp: '축종별(세부)', cross: '교차표' };
  var UNKNOWN = '(미상)';
  // 발생 단계. 기본은 확진·종료만(현황판의 확진 건수와 같은 기준, 예전 통계와 같은 숫자).
  // 종료 = 종식일(이동제한 해제일)이 오늘이거나 지난 확진 건. 의심·항원·야생은 보도자료 자동 수집분(api/history 의 pre)과 수기 입력에만 있다.
  var STAGES = [['confirmed', '확진'], ['closed', '종료'], ['antigen', '항원'], ['suspect', '의심'], ['wild', '야생']];
  var STAGE_IX = {};
  STAGES.forEach(function (x, i) { STAGE_IX[x[0]] = i; });
  var DEFAULT_STAGES = ['confirmed', 'closed'];

  var H = null;          // 받아 온 원본 자료
  var D = null;          // 집계용 열 배열 (수기 포함 여부에 따라 다시 만듦)
  var state = { from: 0, to: 0, sido: '', sgg: '', dis: null, species: '', manual: false, press: true, dim: 'disease',
    crossRow: 'disease', crossCol: 'year', metric: 'n', sort: null, quick: null, stages: new Set(DEFAULT_STAGES) };
  var current = null;    // 마지막 집계 결과 (엑셀에 그대로 씀)

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function fmt(n) { return n == null ? '' : Number(n).toLocaleString('ko-KR'); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function intOfIso(s) { return s ? +s.replace(/-/g, '') : 0; }
  function isoOfInt(n) { if (!n) return ''; var s = String(n); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  function notice(msg, kind) {
    var n = $('notice');
    n.hidden = !msg;
    n.textContent = msg || '';
    n.className = 'notice' + (kind ? ' ' + kind : '');
  }

  // ---------------------------------------------------------------- 자료 읽기
  function load() {
    var t0 = performance.now();
    fetch('api/history', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (h) {
      if (!h || !h.rows || !h.dict) throw new Error(h && h.error ? h.error : '자료 형식이 올바르지 않습니다.');
      H = h;
      window.__statsLoadMs = Math.round(performance.now() - t0);
      init();
    }).catch(function (e) {
      $('dataInfo').textContent = '통계 자료를 불러오지 못했습니다';
      notice('통계 자료를 불러오지 못했습니다(' + e.message + '). 잠시 뒤 새로 고쳐 주세요.', 'err');
    });
  }

  function manualStore() {
    try {
      var raw = JSON.parse(localStorage.getItem('dash-manual') || '{"items":[]}');
      return Array.isArray(raw.items) ? raw.items : [];
    } catch (e) { return []; }
  }

  // 보도자료 보완 행(공공데이터에 아직 없는 발생). 서버가 원본과 같은 열·사전으로 만들어 둔다.
  function pressRows() { return H.supp && Array.isArray(H.supp.rows) ? H.supp.rows : []; }
  // 확진 전(의심·항원)·야생 검출 행: 같은 열 + 마지막 칸이 단계
  function preRows() {
    var p = H.pre;
    if (!p || !Array.isArray(p.rows)) return [];
    return p.rows.filter(function (r) { return Array.isArray(r) && r.length >= 10 && (r[9] === 'suspect' || r[9] === 'antigen' || r[9] === 'wild'); });
  }

  // 원본 + (선택 시) 보도자료 보완 + (선택 시) 수기 입력을 열 배열로 만든다. 구분: 0 공공데이터, 1 수기, 2 보도자료
  function buildData(withManual, withPress) {
    var dict = {};
    Object.keys(H.dict).forEach(function (k) { dict[k] = H.dict[k].slice(); });
    var idx = {};
    function id(kind, v) {
      var m = idx[kind] || (idx[kind] = new Map(dict[kind].map(function (x, i) { return [x, i]; })));
      var i = m.get(v);
      if (i === undefined) { i = dict[kind].length; dict[kind].push(v); m.set(v, i); }
      return i;
    }
    var man = withManual ? manualRows(id) : [];
    var press = withPress ? pressRows() : [];
    var pre = withPress ? preRows() : [];
    var n = H.rows.length + press.length + man.length + pre.length;
    var todayInt = intOfIso(isoOf(new Date()));
    var c = { n: n, date: new Int32Array(n), dis: new Uint16Array(n), sido: new Uint16Array(n), sgg: new Uint16Array(n),
      emd: new Uint16Array(n), sp: new Uint16Array(n), cnt: new Float64Array(n), ag: new Uint16Array(n), end: new Int32Array(n),
      manual: new Uint8Array(n), stg: new Uint8Array(n), dict: dict };
    function put(i, r, m) {
      c.date[i] = r[0]; c.dis[i] = r[1]; c.sido[i] = r[2]; c.sgg[i] = r[3]; c.emd[i] = r[4]; c.sp[i] = r[5];
      c.cnt[i] = r[6] == null ? NaN : r[6]; c.ag[i] = r[7]; c.end[i] = r[8] || 0; c.manual[i] = m;
      var st = r[9] === 'suspect' || r[9] === 'antigen' || r[9] === 'wild' ? r[9] : r[8] && r[8] <= todayInt ? 'closed' : 'confirmed';
      c.stg[i] = STAGE_IX[st];
    }
    H.rows.forEach(function (r, i) { put(i, r, 0); });
    press.forEach(function (r, j) { put(H.rows.length + j, r, 2); });
    man.forEach(function (r, j) { put(H.rows.length + press.length + j, r, 1); });
    pre.forEach(function (r, j) { put(H.rows.length + press.length + man.length + j, r, 2); });
    // 시군구는 같은 이름이 여러 시도에 있으므로(중구, 남구, 고성군 등) 시도와 묶어 키를 만든다
    var keyMap = new Map(), keys = [];
    c.sk = new Uint16Array(n);
    for (var i = 0; i < n; i++) {
      var k = c.sido[i] * 4096 + c.sgg[i], v = keyMap.get(k);
      if (v === undefined) { v = keys.length; keyMap.set(k, v); keys.push({ sido: dict.sido[c.sido[i]], sgg: dict.sgg[c.sgg[i]] }); }
      c.sk[i] = v;
    }
    c.sgKeys = keys;
    return c;
  }

  function manualRows(id) {
    // 시군구 이름 → 시도 (이름이 한 시도에만 있을 때만 씀)
    var sggSido = new Map();
    H.rows.forEach(function (r) {
      var s = H.dict.sgg[r[3]], d = H.dict.sido[r[2]];
      if (!sggSido.has(s)) sggSido.set(s, d);
      else if (sggSido.get(s) !== d) sggSido.set(s, null);
    });
    var out = [];
    manualStore().forEach(function (m) {
      if (!m || typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return;
      var a = areaOf(String(m.addr || ''), sggSido);
      var dis = String(m.disease || '').replace(/\s+/g, ' ').trim();
      dis = DISEASE_ALIAS[dis] || dis;
      var cnt = m.count == null || m.count === '' ? null : Number(m.count);
      out.push([intOfIso(m.date), id('disease', dis), id('sido', a.sido), id('sgg', a.sgg), id('emd', a.emd),
        id('species', String(m.species || '').trim()), isFinite(cnt) ? cnt : null, id('agency', ''),
        typeof m.end === 'string' ? intOfIso(m.end) : 0, m.stage === 'suspect' || m.stage === 'antigen' ? m.stage : '']);
    });
    return out;
  }

  // 수기 주소 → 시도, 시군구, 읍면동 (서버의 hist_area 와 같은 규칙)
  function areaOf(addr, sggSido) {
    var t = addr.split(/\s+/).filter(Boolean), sido = '', sgg = '', emd = '';
    if (t.length && (SIDO_ALIAS[t[0]] || SIDO_ORDER.indexOf(t[0]) >= 0 || t[0] === '전남광주통합특별시')) {
      sido = SIDO_ALIAS[t[0]] || t[0];
      t = t.slice(1);
      if (sido === '전남광주통합특별시') sido = t.length && /구$/.test(t[0]) ? '광주광역시' : '전라남도';
    }
    if (sido === '세종특별자치시') {
      if (t.length && /^세종(시|특별자치시)$/.test(t[0])) t = t.slice(1);
      sgg = '세종시';
    } else if (t.length && /(시|군|구)$/.test(t[0])) {
      sgg = t[0];
      t = t.slice(1);
      if (/시$/.test(sgg) && t.length && /구$/.test(t[0])) t = t.slice(1);
    }
    if (!sido && sgg && sggSido.get(sgg)) sido = sggSido.get(sgg);
    if (t.length && /(읍|면|동|가)$/.test(t[0])) emd = t[0];
    return { sido: sido, sgg: sgg, emd: emd };
  }

  // ---------------------------------------------------------------- 조건 화면
  function init() {
    state.press = pressRows().length > 0;
    D = buildData(false, state.press);
    var minD = H.rows.length ? H.rows[0][0] : 19950101;
    state.minDate = isoOfInt(minD);
    $('dataInfo').textContent = '자료 기준 ' + (H.updated || '').replace('T', ' ').slice(0, 16) + ' · 전체 ' + fmt(H.rows.length) +
      '건(' + state.minDate.slice(0, 4) + '년~) · 겹쳐 실린 ' + fmt(H.merged) + '행은 한 건으로 묶음' +
      (pressRows().length ? ' · 공공데이터에 아직 없는 ' + fmt(pressRows().length) + '건은 농식품부 보도자료로 보완' : '');

    // 시도 목록
    var sel = $('sido');
    sel.appendChild(new Option('전국', ''));
    var present = new Set(H.dict.sido);
    SIDO_ORDER.forEach(function (s) { if (present.has(s)) sel.appendChild(new Option(s, s)); });
    H.dict.sido.forEach(function (s) { if (s && SIDO_ORDER.indexOf(s) < 0) sel.appendChild(new Option(s, s)); });
    if (present.has('')) sel.appendChild(new Option(UNKNOWN, '\u0000'));
    sel.addEventListener('change', function () { state.sido = sel.value; state.sgg = ''; fillSgg(); update(); });
    $('sgg').addEventListener('change', function () { state.sgg = $('sgg').value; update(); });
    fillSgg();

    Array.prototype.forEach.call($('quickRegion').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        var r = b.getAttribute('data-r');
        state.sido = r === 'all' ? '' : HOME.sido;
        state.sgg = r === 'home' ? HOME.sgg : '';
        sel.value = state.sido;
        fillSgg();
        update();
      });
    });

    // 기간
    $('from').min = $('to').min = state.minDate;
    $('from').addEventListener('change', function () { state.quick = null; readDates(); update(); });
    $('to').addEventListener('change', function () { state.quick = null; readDates(); update(); });
    Array.prototype.forEach.call($('quickDates').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setQuick(b.getAttribute('data-q')); update(); });
    });

    // 질병
    buildDiseaseList();
    Array.prototype.forEach.call($('disPresets').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        var p = b.getAttribute('data-p');
        state.dis = new Set(p === 'all' ? D.dict.disease : p === 'none' ? [] : p === 'major' ? MAJOR : DISASTER);
        syncDiseaseChecks();
        update();
      });
    });

    // 축종
    fillSpecies();
    $('species').addEventListener('change', function () { state.species = $('species').value; update(); });

    // 수기 입력
    var mcount = manualStore().length;
    $('manualCount').textContent = mcount ? '(' + mcount + '건)' : '(없음)';
    $('manual').disabled = !mcount;
    $('manual').addEventListener('change', function () {
      state.manual = $('manual').checked;
      D = buildData(state.manual, state.press);
      var keep = state.dis;
      buildDiseaseList();
      // 수기에만 있는 질병은 새로 켠다
      state.dis = new Set(Array.from(keep).concat(D.dict.disease.filter(function (d) { return !H.dict.disease.includes(d); })));
      syncDiseaseChecks();
      fillSpecies();
      update();
    });

    // 발생 단계
    var stc = {};
    STAGES.forEach(function (x) { stc[x[0]] = 0; });
    H.rows.concat(pressRows()).forEach(function (r) { stc[r[8] && r[8] <= intOfIso(isoOf(new Date())) ? 'closed' : 'confirmed']++; });
    preRows().forEach(function (r) { stc[r[9]]++; });
    var sl = $('stageList');
    STAGES.forEach(function (x) {
      var li = el('li'), lab = el('label', 'st-check'), cb = el('input');
      cb.type = 'checkbox'; cb.value = x[0]; cb.checked = state.stages.has(x[0]);
      cb.addEventListener('change', function () {
        if (cb.checked) state.stages.add(x[0]); else state.stages.delete(x[0]);
        syncStagePresets();
        update();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(' ' + x[1] + ' '));
      lab.appendChild(el('span', 'muted', '(' + fmt(stc[x[0]]) + ')'));
      li.appendChild(lab);
      sl.appendChild(li);
    });
    Array.prototype.forEach.call($('stagePresets').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () {
        state.stages = new Set(b.getAttribute('data-s') === 'all' ? STAGES.map(function (x) { return x[0]; }) : DEFAULT_STAGES);
        Array.prototype.forEach.call(sl.querySelectorAll('input'), function (cb) { cb.checked = state.stages.has(cb.value); });
        syncStagePresets();
        update();
      });
    });
    syncStagePresets();

    // 보도자료 보완
    var pcount = pressRows().length;
    $('pressCount').textContent = pcount ? '(' + pcount + '건)' : '(없음)';
    $('press').checked = state.press;
    $('press').disabled = !pcount;
    $('press').addEventListener('change', function () {
      state.press = $('press').checked;
      D = buildData(state.manual, state.press);
      fillSpecies();
      update();
    });

    // 집계 기준
    $('dim').addEventListener('change', function () { state.dim = $('dim').value; state.sort = null; update(); });
    $('crossRow').addEventListener('change', function () { state.crossRow = $('crossRow').value; state.sort = null; update(); });
    $('crossCol').addEventListener('change', function () { state.crossCol = $('crossCol').value; state.sort = null; update(); });
    Array.prototype.forEach.call($('metric').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { state.metric = b.getAttribute('data-m'); update(); });
    });
    $('xlsxBtn').addEventListener('click', downloadXlsx);
    var rt = null, lastW = 0;
    window.addEventListener('resize', function () {
      clearTimeout(rt);
      rt = setTimeout(function () { var w = $('chart').clientWidth; if (current && w !== lastW) { lastW = w; drawChart(current.agg); } }, 120);
    });

    state.dis = new Set(D.dict.disease);
    setQuick('thisYear');
    state.sido = HOME.sido; state.sgg = HOME.sgg;
    sel.value = state.sido;
    fillSgg();
    syncDiseaseChecks();
    $('xlsxBtn').disabled = false;
    update();
  }

  function fillSgg() {
    var s = $('sgg');
    s.innerHTML = '';
    s.appendChild(new Option(state.sido ? '시군구 전체' : '시도를 먼저 고르세요', ''));
    s.disabled = !state.sido;
    if (!state.sido) { state.sgg = ''; return; }
    var sidoName = state.sido === '\u0000' ? '' : state.sido;
    var names = new Set();
    D.sgKeys.forEach(function (k) { if (k.sido === sidoName) names.add(k.sgg); });
    Array.from(names).sort(koSort).forEach(function (n) { s.appendChild(new Option(n || UNKNOWN, n || '\u0000')); });
    s.value = state.sgg;
    if (s.value !== state.sgg) state.sgg = '';
  }
  function koSort(a, b) { return a.localeCompare(b, 'ko'); }

  function buildDiseaseList() {
    var cnt = new Map();
    for (var i = 0; i < D.n; i++) cnt.set(D.dis[i], (cnt.get(D.dis[i]) || 0) + 1);
    var order = D.dict.disease.map(function (d, i) { return i; }).sort(function (a, b) {
      var ma = MAJOR.indexOf(D.dict.disease[a]), mb = MAJOR.indexOf(D.dict.disease[b]);
      if (ma >= 0 || mb >= 0) return (ma < 0 ? 99 : ma) - (mb < 0 ? 99 : mb);
      return (cnt.get(b) || 0) - (cnt.get(a) || 0);
    });
    var ul = $('disList');
    ul.innerHTML = '';
    order.forEach(function (i) {
      var name = D.dict.disease[i];
      var li = el('li'), lab = el('label'), cb = el('input');
      cb.type = 'checkbox';
      cb.value = name;
      cb.addEventListener('change', function () {
        if (cb.checked) state.dis.add(name); else state.dis.delete(name);
        update();
      });
      lab.appendChild(cb);
      lab.appendChild(el('span', null, name || UNKNOWN));
      lab.appendChild(el('span', 'n', fmt(cnt.get(i) || 0)));
      lab.title = '1995년 이후 전체 ' + fmt(cnt.get(i) || 0) + '건';
      li.appendChild(lab);
      ul.appendChild(li);
    });
  }
  function syncDiseaseChecks() {
    Array.prototype.forEach.call($('disList').querySelectorAll('input'), function (cb) { cb.checked = state.dis.has(cb.value); });
  }

  function speciesGroup(s) { return s ? s.split('-')[0] : ''; }
  function fillSpecies() {
    var s = $('species'), keep = state.species;
    s.innerHTML = '';
    s.appendChild(new Option('모든 축종', ''));
    var groups = new Map();
    D.dict.species.forEach(function (sp) {
      var g = speciesGroup(sp);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(sp);
    });
    Array.from(groups.keys()).sort(koSort).forEach(function (g) {
      var og = document.createElement('optgroup');
      og.label = g || UNKNOWN;
      og.appendChild(new Option((g || UNKNOWN) + ' 전체', 'g:' + g));
      groups.get(g).sort(koSort).forEach(function (sp) {
        if (sp !== g) og.appendChild(new Option(sp || UNKNOWN, 's:' + sp));
      });
      s.appendChild(og);
    });
    s.value = keep;
    if (s.value !== keep) { s.value = ''; state.species = ''; }
  }

  function setQuick(q) {
    var today = new Date(), y = today.getFullYear(), from, to = isoOf(today);
    if (q === '30d') { var d = new Date(today); d.setDate(d.getDate() - 29); from = isoOf(d); }
    else if (q === 'thisYear') from = y + '-01-01';
    else if (q === 'lastYear') { from = (y - 1) + '-01-01'; to = (y - 1) + '-12-31'; }
    else if (q === '5y') { var e = new Date(today); e.setFullYear(y - 5); e.setDate(e.getDate() + 1); from = isoOf(e); }
    else { from = state.minDate; }
    $('from').value = from;
    $('to').value = to;
    state.quick = q;
    readDates();
  }
  function readDates() {
    var f = $('from').value || state.minDate, t = $('to').value || isoOf(new Date());
    if (f > t) { var x = f; f = t; t = x; $('from').value = f; $('to').value = t; }
    state.from = intOfIso(f);
    state.to = intOfIso(t);
  }

  function regionLabel() {
    if (!state.sido) return '전국';
    var s = state.sido === '\u0000' ? UNKNOWN : state.sido;
    if (!state.sgg) return s;
    return s + ' ' + (state.sgg === '\u0000' ? UNKNOWN : state.sgg);
  }
  function diseaseLabel() {
    var all = D.dict.disease;
    if (state.dis.size === all.length) return '전체 질병(' + all.length + '종)';
    var list = all.filter(function (d) { return state.dis.has(d); });
    if (sameSet(list, MAJOR)) return '주요 6종(' + MAJOR.join(', ') + ')';
    if (sameSet(list, DISASTER)) return '재난형 4종(' + DISASTER.join(', ') + ')';
    return list.join(', ') || '없음';
  }
  function sameSet(a, b) { return a.length === b.length && b.every(function (x) { return a.indexOf(x) >= 0; }); }
  function speciesLabel() {
    if (!state.species) return '모든 축종';
    var v = state.species.slice(2);
    return state.species[0] === 'g' ? (v || UNKNOWN) + ' 전체' : (v || UNKNOWN);
  }

  // ---------------------------------------------------------------- 거르기와 집계
  function filterIdx() {
    var dict = D.dict, out = [];
    var disOk = new Uint8Array(dict.disease.length);
    dict.disease.forEach(function (d, i) { disOk[i] = state.dis.has(d) ? 1 : 0; });
    var sidoName = state.sido === '\u0000' ? '' : state.sido, sggName = state.sgg === '\u0000' ? '' : state.sgg;
    var sidoI = state.sido ? dict.sido.indexOf(sidoName) : -1;
    var skOk = null;
    if (state.sgg) {
      skOk = new Uint8Array(D.sgKeys.length);
      D.sgKeys.forEach(function (k, i) { skOk[i] = k.sido === sidoName && k.sgg === sggName ? 1 : 0; });
    }
    var spOk = null;
    if (state.species) {
      var kind = state.species[0], v = state.species.slice(2);
      spOk = new Uint8Array(dict.species.length);
      dict.species.forEach(function (s, i) { spOk[i] = (kind === 'g' ? speciesGroup(s) === v : s === v) ? 1 : 0; });
    }
    var stOk = new Uint8Array(STAGES.length);
    STAGES.forEach(function (x, i) { stOk[i] = state.stages.has(x[0]) ? 1 : 0; });
    for (var i = 0; i < D.n; i++) {
      var d = D.date[i];
      if (d < state.from || d > state.to) continue;
      if (!stOk[D.stg[i]]) continue;
      if (!disOk[D.dis[i]]) continue;
      if (state.sido && D.sido[i] !== sidoI) continue;
      if (skOk && !skOk[D.sk[i]]) continue;
      if (spOk && !spOk[D.sp[i]]) continue;
      out.push(i);
    }
    return out;
  }

  // 한 행의 집계 키와 표시 글자
  function keyer(dim) {
    var dict = D.dict;
    switch (dim) {
      case 'disease': return { key: function (i) { return D.dis[i]; }, cols: ['질병'], label: function (k) { return [dict.disease[k] || UNKNOWN]; } };
      case 'sido': return { key: function (i) { return D.sido[i]; }, cols: ['시도'], label: function (k) { return [dict.sido[k] || UNKNOWN]; },
        order: function (a, b) { return sidoRank(dict.sido[a]) - sidoRank(dict.sido[b]); } };
      case 'sgg': return { key: function (i) { return D.sk[i]; }, cols: ['시도', '시군구'],
        label: function (k) { return [D.sgKeys[k].sido || UNKNOWN, D.sgKeys[k].sgg || UNKNOWN]; } };
      case 'emd': return { key: function (i) { return D.sk[i] * 65536 + D.emd[i]; }, cols: ['시도', '시군구', '읍면동'],
        label: function (k) { var s = D.sgKeys[Math.floor(k / 65536)]; return [s.sido || UNKNOWN, s.sgg || UNKNOWN, dict.emd[k % 65536] || UNKNOWN]; } };
      case 'year': return { time: 'year', key: function (i) { return Math.floor(D.date[i] / 10000); }, cols: ['연도'], label: function (k) { return [String(k)]; } };
      case 'ym': return { time: 'ym', key: function (i) { return Math.floor(D.date[i] / 100); }, cols: ['연-월'],
        label: function (k) { var s = String(k); return [s.slice(0, 4) + '-' + s.slice(4)]; } };
      case 'month': return { time: 'month', key: function (i) { return Math.floor(D.date[i] / 100) % 100; }, cols: ['월'], label: function (k) { return [k + '월']; } };
      case 'spg': return { key: function (i) { return speciesGroup(dict.species[D.sp[i]]); }, cols: ['축종'], label: function (k) { return [k || UNKNOWN]; } };
      case 'sp': return { key: function (i) { return D.sp[i]; }, cols: ['축종(세부)'], label: function (k) { return [dict.species[k] || UNKNOWN]; } };
    }
  }
  function sidoRank(s) { var i = SIDO_ORDER.indexOf(s); return i < 0 ? 99 : i; }

  // 기간 안의 모든 연도·연월·월 (0건도 표에 나오게)
  function timeKeys(kind) {
    var keys = [], fy = Math.floor(state.from / 10000), ty = Math.floor(state.to / 10000);
    if (kind === 'year') for (var y = fy; y <= ty; y++) keys.push(y);
    else if (kind === 'month') for (var m = 1; m <= 12; m++) keys.push(m);
    else {
      var fm = Math.floor(state.from / 100), tm = Math.floor(state.to / 100);
      for (var k = fm; k <= tm; k = (k % 100 === 12) ? (Math.floor(k / 100) + 1) * 100 + 1 : k + 1) keys.push(k);
    }
    return keys;
  }

  function aggregate(idx) {
    var heads = function (i) { var c = D.cnt[i]; return c === c ? c : 0; };
    if (state.dim === 'cross') return crossTab(idx, heads);
    var k = keyer(state.dim), map = new Map();
    if (k.time) timeKeys(k.time).forEach(function (t) { map.set(t, { n: 0, heads: 0 }); });
    idx.forEach(function (i) {
      var key = k.key(i), v = map.get(key);
      if (!v) { v = { n: 0, heads: 0 }; map.set(key, v); }
      v.n++;
      v.heads += heads(i);
    });
    var totalN = idx.length, totalH = 0;
    map.forEach(function (v) { totalH += v.heads; });
    var rows = [];
    map.forEach(function (v, key) { rows.push({ key: key, label: k.label(key), n: v.n, heads: v.heads }); });
    if (k.time) rows.sort(function (a, b) { return a.key - b.key; });
    else if (k.order) rows.sort(function (a, b) { return k.order(a.key, b.key); });
    else rows.sort(function (a, b) { return b.n - a.n || koSort(a.label.join(' '), b.label.join(' ')); });
    var head = k.cols.concat(['발생 건수', '건수 비율', '발생 두수', '두수 비율']);
    var table = rows.map(function (r) {
      return r.label.concat([r.n, totalN ? r.n / totalN : 0, r.heads, totalH ? r.heads / totalH : 0]);
    });
    var types = k.cols.map(function () { return 'str'; }).concat(['num', 'pct', 'num', 'pct']);
    var totalRow = k.cols.map(function (_, i) { return i === 0 ? '합계' : ''; }).concat([totalN, totalN ? 1 : 0, totalH, totalH ? 1 : 0]);
    return { head: head, types: types, rows: table, total: totalRow, labelCols: k.cols.length, time: !!k.time,
      chart: rows.map(function (r) { return { label: r.label.join(' '), n: r.n, heads: r.heads }; }) };
  }

  function crossTab(idx, heads) {
    var rk = keyer(state.crossRow), ck = keyer(state.crossCol), metric = state.metric;
    var cols = timeKeys(ck.time), colPos = new Map(cols.map(function (c, i) { return [c, i]; }));
    var rows = new Map();
    idx.forEach(function (i) {
      var r = rk.key(i), c = colPos.get(ck.key(i));
      var v = rows.get(r);
      if (!v) { v = new Float64Array(cols.length); rows.set(r, v); }
      v[c] += metric === 'n' ? 1 : heads(i);
    });
    var list = [];
    rows.forEach(function (v, key) {
      var sum = 0;
      v.forEach(function (x) { sum += x; });
      list.push({ key: key, label: rk.label(key), vals: Array.from(v), sum: sum });
    });
    if (rk.order) list.sort(function (a, b) { return rk.order(a.key, b.key); });
    else list.sort(function (a, b) { return b.sum - a.sum || koSort(a.label.join(' '), b.label.join(' ')); });
    var colTot = cols.map(function (_, j) { return list.reduce(function (s, r) { return s + r.vals[j]; }, 0); });
    var grand = colTot.reduce(function (s, x) { return s + x; }, 0);
    var head = rk.cols.concat(cols.map(function (c) { return ck.label(c)[0]; }), ['합계']);
    return {
      head: head,
      types: rk.cols.map(function () { return 'str'; }).concat(cols.map(function () { return 'num'; }), ['num']),
      rows: list.map(function (r) { return r.label.concat(r.vals, [r.sum]); }),
      total: rk.cols.map(function (_, i) { return i === 0 ? '합계' : ''; }).concat(colTot, [grand]),
      labelCols: rk.cols.length, cross: true,
      chart: cols.map(function (c, j) { var v = { label: ck.label(c)[0] }; v[metric] = colTot[j]; return v; }), time: true
    };
  }

  // ---------------------------------------------------------------- 화면 그리기
  function update() {
    if (!H) return;
    pressed($('quickDates'), 'data-q', state.quick);
    pressed($('quickRegion'), 'data-r', !state.sido ? 'all' : state.sido === HOME.sido && !state.sgg ? 'sido' :
      state.sido === HOME.sido && state.sgg === HOME.sgg ? 'home' : null);
    var list = D.dict.disease.filter(function (d) { return state.dis.has(d); });
    pressed($('disPresets'), 'data-p', list.length === D.dict.disease.length ? 'all' : !list.length ? 'none' :
      sameSet(list, MAJOR) ? 'major' : sameSet(list, DISASTER) ? 'disaster' : null);
    pressed($('metric'), 'data-m', state.metric);
    $('disCount').textContent = list.length + ' / ' + D.dict.disease.length + '종';
    $('crossOpts').hidden = state.dim !== 'cross';

    var t0 = performance.now();
    var idx = filterIdx();
    current = { idx: idx, agg: aggregate(idx) };
    applySort(current.agg);
    var heads = 0, missing = 0;
    idx.forEach(function (i) { var c = D.cnt[i]; if (c === c) heads += c; else missing++; });
    current.heads = heads;
    current.missing = missing;
    current.pressN = idx.filter(function (i) { return D.manual[i] === 2 && D.stg[i] <= 1; }).length;

    $('sumN').textContent = fmt(idx.length) + '건';
    $('sumHeads').textContent = fmt(heads) + '두';
    $('sumCond').textContent = condText();
    if (!state.dis.size) notice('질병을 하나 이상 고르세요.', 'warn');
    else if (!state.stages.size) notice('발생 단계를 하나 이상 고르세요.', 'warn');
    else notice('');

    drawChart(current.agg);
    drawTable(current.agg);
    drawRaw(idx);
    window.__statsRenderMs = Math.round(performance.now() - t0);
  }
  function syncStagePresets() {
    var all = state.stages.size === STAGES.length;
    var def = state.stages.size === 2 && state.stages.has('confirmed') && state.stages.has('closed');
    pressed($('stagePresets'), 'data-s', all ? 'all' : def ? 'default' : null);
  }
  function pressed(box, attr, val) {
    Array.prototype.forEach.call(box.querySelectorAll('button'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute(attr) === val));
    });
  }
  function condText() {
    return isoOfInt(state.from) + ' ~ ' + isoOfInt(state.to) + ' · ' + regionLabel() + ' · ' + diseaseLabel() + ' · ' + speciesLabel() +
      (state.manual ? ' · 수기 입력 포함' : '') + (state.press && pressRows().length ? ' · 보도자료 보완 포함' : '') + ' · 단계: ' + stageLabel();
  }
  function stageLabel() {
    var on = STAGES.filter(function (x) { return state.stages.has(x[0]); }).map(function (x) { return x[1]; });
    if (!on.length) return '없음';
    var def = on.length === 2 && state.stages.has('confirmed') && state.stages.has('closed');
    return on.join('·') + (def ? '(기본)' : '');
  }
  function dimText() {
    if (state.dim !== 'cross') return DIM_LABEL[state.dim];
    return '교차표(행: ' + { disease: '질병', sido: '시도', sgg: '시군구' }[state.crossRow] + ', 열: ' +
      (state.crossCol === 'year' ? '연도' : '월') + ', 값: ' + (state.metric === 'n' ? '발생 건수' : '발생 두수') + ')';
  }

  function drawChart(agg) {
    var box = $('chart'), metric = state.metric, mName = metric === 'n' ? '발생 건수' : '발생 두수';
    box.innerHTML = '';
    $('chartTitle').textContent = mName + ' · ' + (state.dim === 'cross' ? (state.crossCol === 'year' ? '연도별' : '달별') + ' 합계' : DIM_LABEL[state.dim]);
    var data = agg.chart.filter(function (d) { return d[metric] != null; });
    var max = data.reduce(function (m, d) { return Math.max(m, d[metric]); }, 0);
    if (!data.length || !max) { box.appendChild(el('p', 'empty', '조건에 맞는 발생이 없습니다.')); $('chartNote').textContent = ''; return; }
    var NS = 'http://www.w3.org/2000/svg', W = Math.max(600, box.clientWidth || 900);
    function svgEl(tag, attrs, text) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text != null) e.textContent = text;
      return e;
    }
    var svg;
    if (agg.time) {
      // 세로 막대 (시간 순서)
      var Hh = 220, top = 16, bottom = 28, left = 56, right = 8, n = data.length;
      var bw = (W - left - right) / n;
      svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + Hh, height: Hh, role: 'img', 'aria-label': mName + ' 막대그래프' });
      ticks(max).forEach(function (t) {
        var y = top + (Hh - top - bottom) * (1 - t / max);
        svg.appendChild(svgEl('line', { class: 'grid', x1: left, x2: W - right, y1: y, y2: y }));
        svg.appendChild(svgEl('text', { x: left - 6, y: y + 4, 'text-anchor': 'end' }, fmtShort(t)));
      });
      var every = Math.ceil(n / Math.floor((W - left) / 56));
      data.forEach(function (d, i) {
        var h = (Hh - top - bottom) * d[metric] / max, x = left + i * bw;
        var r = svgEl('rect', { class: 'b', x: x + Math.min(2, bw * 0.15), y: Hh - bottom - h, width: Math.max(1, bw - Math.min(4, bw * 0.3)), height: h });
        r.appendChild(svgEl('title', {}, d.label + ': ' + fmt(d[metric])));
        svg.appendChild(r);
        if (i % every === 0) svg.appendChild(svgEl('text', { x: x + bw / 2, y: Hh - 8, 'text-anchor': 'middle' }, d.label));
      });
      $('chartNote').textContent = '';
    } else {
      // 가로 막대 (많은 순 상위 20)
      var rows = data.slice().sort(function (a, b) { return b[metric] - a[metric]; }).slice(0, 15);
      var lw = 170, rh = 24, Hh2 = rows.length * rh + 8;
      svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + Hh2, height: Hh2, role: 'img', 'aria-label': mName + ' 막대그래프' });
      rows.forEach(function (d, i) {
        var y = 4 + i * rh, w = (W - lw - 90) * d[metric] / max;
        svg.appendChild(svgEl('text', { class: 'lbl', x: lw - 10, y: y + 16, 'text-anchor': 'end' }, cut(d.label, 14)));
        var r = svgEl('rect', { class: 'b', x: lw, y: y + 3, width: Math.max(1, w), height: rh - 8, rx: 2 });
        r.appendChild(svgEl('title', {}, d.label + ': ' + fmt(d[metric])));
        svg.appendChild(r);
        svg.appendChild(svgEl('text', { class: 'val', x: lw + w + 6, y: y + 16 }, fmt(d[metric])));
      });
      $('chartNote').textContent = data.length > 15 ? '많은 순 상위 15개만 그립니다(전체 ' + data.length + '개는 표에 있음)' : '';
    }
    box.appendChild(svg);
  }
  function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function ticks(max) {
    var step = Math.pow(10, Math.floor(Math.log10(max))), out = [];
    if (max / step < 2) step /= 5; else if (max / step < 5) step /= 2;
    step = Math.max(step, 1);
    for (var t = 0; t <= max; t += step) out.push(t);
    return out;
  }
  function fmtShort(n) {
    if (n >= 1e8) return Math.round(n / 1e7) / 10 + '억';
    if (n >= 1e4) return Math.round(n / 1e3) / 10 + '만';
    return fmt(n);
  }

  function applySort(agg) {
    if (!state.sort) return;
    var c = state.sort.col, dir = state.sort.dir, t = agg.types[c];
    if (c >= agg.head.length) return;
    agg.rows.sort(function (a, b) {
      var x = a[c], y = b[c];
      var r = t === 'str' ? koSort(String(x), String(y)) : x - y;
      return dir * r;
    });
  }

  function drawTable(agg) {
    $('tableTitle').textContent = '집계표 · ' + dimText();
    var wrap = $('tableWrap');
    wrap.innerHTML = '';
    var t = el('table', agg.cross ? 'st cross' : 'st'), thead = el('thead'), tr = el('tr');
    agg.head.forEach(function (h, c) {
      var th = el('th', agg.types[c] === 'str' ? null : 'num', h);
      th.scope = 'col';
      if (state.sort && state.sort.col === c) th.setAttribute('aria-sort', state.sort.dir > 0 ? 'ascending' : 'descending');
      th.addEventListener('click', function () {
        var dir = state.sort && state.sort.col === c ? -state.sort.dir : (agg.types[c] === 'str' ? 1 : -1);
        state.sort = { col: c, dir: dir };
        update();
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody');
    var frag = document.createDocumentFragment();
    agg.rows.forEach(function (r) {
      var row = el('tr');
      r.forEach(function (v, c) { row.appendChild(cell(v, agg.types[c], c < agg.labelCols)); });
      frag.appendChild(row);
    });
    tb.appendChild(frag);
    t.appendChild(tb);
    var tf = el('tfoot'), fr = el('tr');
    agg.total.forEach(function (v, c) { fr.appendChild(cell(v, agg.types[c], false)); });
    tf.appendChild(fr);
    t.appendChild(tf);
    wrap.appendChild(t);
  }
  function cell(v, type, isLabel) {
    var td = el('td', type === 'str' ? (isLabel ? 'lbl' : null) : 'num');
    if (type === 'pct') td.textContent = (Math.round(v * 1000) / 10).toFixed(1) + '%';
    else if (type === 'num') { td.textContent = fmt(v); if (!v) td.classList.add('zero'); }
    else td.textContent = v;
    return td;
  }

  var RAW_PREVIEW = 300;
  var RAW_HEAD = ['발생일', '질병명', '시도', '시군구', '읍면동', '축종', '두수', '진단기관', '종료일', '구분', '단계'];
  function rawRow(i) {
    var d = D.dict, sk = D.sgKeys[D.sk[i]], c = D.cnt[i];
    return [isoOfInt(D.date[i]), d.disease[D.dis[i]], sk.sido, sk.sgg, d.emd[D.emd[i]], d.species[D.sp[i]],
      c === c ? c : null, d.agency[D.ag[i]], isoOfInt(D.end[i]), D.manual[i] === 1 ? '수기' : D.manual[i] === 2 ? '보도자료' : '공공데이터',
      STAGES[D.stg[i]][1]];
  }
  function drawRaw(idx) {
    var wrap = $('rawWrap');
    wrap.innerHTML = '';
    var shown = Math.min(RAW_PREVIEW, idx.length);
    $('rawNote').textContent = '조건에 맞는 ' + fmt(idx.length) + '건 중 최근 ' + fmt(shown) + '건 미리보기 · 전체는 엑셀 "원자료" 시트에 들어갑니다' +
      (current.missing ? ' · 두수 미기재 ' + fmt(current.missing) + '건' : '');
    if (!idx.length) { wrap.appendChild(el('p', 'hint', '조건에 맞는 발생이 없습니다.')).style.padding = '12px'; return; }
    var t = el('table', 'st raw'), thead = el('thead'), tr = el('tr');
    RAW_HEAD.forEach(function (h, c) { var th = el('th', c === 6 ? 'num' : null, h); th.scope = 'col'; tr.appendChild(th); });
    thead.appendChild(tr);
    t.appendChild(thead);
    var tb = el('tbody'), frag = document.createDocumentFragment();
    for (var j = idx.length - 1; j >= idx.length - shown; j--) {
      var r = rawRow(idx[j]), row = el('tr');
      r.forEach(function (v, c) {
        var td = el('td', c === 6 ? 'num' : c >= 7 ? 'sub' : null);
        if (c === 9) {
          if (v === '수기') td.appendChild(el('span', 'mtag', '수기'));
          else if (v === '보도자료') { var pt = td.appendChild(el('span', 'ptag', '보도')); pt.title = '농림축산식품부 보도자료로 보완(공공데이터에 아직 없음)'; }
          else td.textContent = '공공';
        }
        else td.textContent = c === 6 ? fmt(v) : (v || '');
        row.appendChild(td);
      });
      frag.appendChild(row);
    }
    tb.appendChild(frag);
    t.appendChild(tb);
    wrap.appendChild(t);
  }

  // ---------------------------------------------------------------- 엑셀
  function workbook() {
    var agg = current.agg, idx = current.idx;
    var H1 = function (s) { return { v: s, s: 'head' }; };
    var cond = [
      [H1('항목'), H1('내용')],
      ['기간', isoOfInt(state.from) + ' ~ ' + isoOfInt(state.to)],
      ['지역', regionLabel()],
      ['질병', diseaseLabel()],
      ['축종', speciesLabel()],
      ['집계 기준', dimText()],
      ['발생 단계', stageLabel() + '. 종료 = 종식일이 지난 확진 건. 의심·항원·야생은 보도자료 자동 수집과 수기 입력에만 있음(공공데이터는 확진만 제공). 원자료 시트 "단계" 열'],
      ['수기 입력', state.manual ? '포함(이 PC의 브라우저에 저장된 항목)' : '제외'],
      ['보도자료 보완', !pressRows().length ? '없음' : state.press ?
        '포함: 공공데이터에 아직 없는 ' + fmt(pressRows().length) + '건(이 조건에 ' + fmt(current.pressN) + '건). 원자료 시트 "구분" 열이 "보도자료"인 행' :
        '제외(공공데이터에 아직 없는 ' + fmt(pressRows().length) + '건이 있으나 빼고 집계)'],
      ['발생 건수', fmt(idx.length) + '건'],
      ['발생 두수 합계', fmt(current.heads) + '두'],
      ['두수 미기재', fmt(current.missing) + '건(두수 합계에서 0으로 셈)'],
      ['자료 기준 시각', (H.updated || '').replace('T', ' ')],
      ['출처', '농림축산검역본부 가축질병 발생정보' + (state.press && pressRows().length ?
        ' + ' + ((H.supp && H.supp.source) || '농림축산식품부 보도자료') + '(공공데이터에 같은 건이 들어오면 보완 항목은 자동으로 빠짐)' : '')],
      ['중복 처리', '같은 농장·같은 날·같은 질병으로 겹쳐 실린 행은 한 건으로 묶음(전체 자료에서 ' + fmt(H.merged) + '행)'],
      ['지역 표기', '시도는 현재 이름으로 통일, 일반구는 시로 합침, 전남광주통합특별시 주소는 광주광역시·전라남도로 나눔'],
      ['만든 시각', new Date().toLocaleString('ko-KR')]
    ];
    var stat = [agg.head.map(H1)];
    agg.rows.forEach(function (r) {
      stat.push(r.map(function (v, c) { var t = agg.types[c]; return t === 'str' ? v : { v: v, t: t }; }));
    });
    stat.push(agg.total.map(function (v, c) { var t = agg.types[c]; return { v: v, t: t === 'str' ? 'str' : t, s: 'total' }; }));
    var statCols = agg.head.map(function (h, c) { return c < agg.labelCols ? (h === '질병' || h === '축종(세부)' ? 26 : 16) : agg.cross ? 10 : 13; });

    var raw = [RAW_HEAD.map(H1)];
    idx.forEach(function (i) {
      var r = rawRow(i);
      raw.push([{ v: r[0], t: 'date' }, r[1], r[2], r[3], r[4], r[5], r[6] == null ? null : { v: r[6], t: 'num' }, r[7],
        r[8] ? { v: r[8], t: 'date' } : null, r[9], r[10]]);
    });
    return [
      { name: '조건', cols: [16, 90], rows: cond },
      { name: '통계', cols: statCols, rows: stat, freeze: 1 },
      { name: '원자료', cols: [12, 26, 16, 12, 12, 16, 10, 22, 12, 10, 8], rows: raw, freeze: 1, autoFilter: true }
    ];
  }
  function fileName() {
    var region = regionLabel().replace(/\s+/g, '_').replace(/[\\\/:*?"<>|()]/g, '');
    return '가축질병통계_' + state.from + '-' + state.to + '_' + region + '.xlsx';
  }
  function downloadXlsx() {
    if (!current) return;
    var btn = $('xlsxBtn');
    btn.disabled = true;
    btn.textContent = '만드는 중…';
    setTimeout(function () {
      try {
        var t0 = performance.now();
        var blob = XLSX.build(workbook());
        window.__xlsxMs = Math.round(performance.now() - t0);
        window.__xlsxSize = blob.size;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = fileName();
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      } catch (e) {
        notice('엑셀 파일을 만들지 못했습니다: ' + e.message, 'err');
      } finally {
        btn.disabled = false;
        btn.textContent = '엑셀 내려받기';
      }
    }, 20);
  }

  // 시험용: 화면 상태를 바꾸고 집계 결과를 돌려준다 (검산 스크립트가 사용)
  window.__stats = {
    set: function (o) {
      if (o.from) { $('from').value = o.from; }
      if (o.to) { $('to').value = o.to; }
      if (o.quick) setQuick(o.quick); else if (o.from || o.to) { state.quick = null; readDates(); }
      if ('sido' in o) { state.sido = o.sido; $('sido').value = o.sido; fillSgg(); }
      if ('sgg' in o) { state.sgg = o.sgg; fillSgg(); }
      if (o.dis) state.dis = new Set(o.dis === 'all' ? D.dict.disease : o.dis);
      if ('species' in o) { state.species = o.species; $('species').value = o.species; }
      if (o.dim) { state.dim = o.dim; $('dim').value = o.dim; }
      if (o.crossRow) { state.crossRow = o.crossRow; $('crossRow').value = o.crossRow; }
      if (o.crossCol) { state.crossCol = o.crossCol; $('crossCol').value = o.crossCol; }
      if (o.metric) state.metric = o.metric;
      state.sort = null;
      syncDiseaseChecks();
      update();
      return { n: current.idx.length, heads: current.heads, head: current.agg.head, rows: current.agg.rows, total: current.agg.total };
    },
    workbookParts: function () { return XLSX.parts(workbook()); },
    fileName: fileName
  };

  load();
})();
