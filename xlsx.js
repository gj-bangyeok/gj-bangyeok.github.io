/* 최소한의 .xlsx 작성기. 외부 라이브러리 없이 브라우저 안에서 엑셀 파일을 만든다.
   구조: 무압축(stored) ZIP + SpreadsheetML. 글자는 sharedStrings 로 한 번만 적는다.
   사용: var blob = XLSX.build([{ name: '시트', cols: [12, 20], freeze: 1, autoFilter: true, rows: [[{v:'머리', s:'head'}], ['값', 123, {v: '2025-01-02', t: 'date'}]] }]);
   셀 값: 문자열, 숫자, null(빈칸), 또는 { v: 값, t: 'date'|'num'|'pct'|'str', s: 'head'|'total' } */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- CRC32
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // ---------------------------------------------------------------- ZIP (무압축)
  function zip(files) {
    var enc = new TextEncoder(), parts = [], central = [], offset = 0;
    var now = new Date();
    var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    files.forEach(function (f) {
      var name = enc.encode(f.name);
      var data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      var crc = crc32(data);
      var h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);       // 필요한 버전
      h.setUint16(6, 0x0800, true);   // 파일 이름 UTF-8
      h.setUint16(8, 0, true);        // 무압축
      h.setUint16(10, dosTime, true);
      h.setUint16(12, dosDate, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true);
      c.setUint16(14, dosDate, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), name);
      offset += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (s, p) { return s + p.length; }, 0);
    var e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    return parts.concat(central, [new Uint8Array(e.buffer)]);
  }

  // ---------------------------------------------------------------- SpreadsheetML
  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function colName(i) {
    var s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }
  // 스타일 번호 (styles.xml 의 cellXfs 순서)
  var ST = { str: 0, head: 1, num: 2, date: 3, totalStr: 4, totalNum: 5, pct: 6, totalPct: 7 };
  var EPOCH = Date.UTC(1899, 11, 30);
  function dateSerial(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    return (Date.UTC(+m[1], +m[2] - 1, +m[3]) - EPOCH) / 86400000;
  }

  function sheetXml(sheet, sst) {
    var out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
    var rows = sheet.rows, ncol = 0;
    rows.forEach(function (r) { if (r.length > ncol) ncol = r.length; });
    if (rows.length && ncol) out.push('<dimension ref="A1:' + colName(ncol - 1) + rows.length + '"/>');
    if (sheet.freeze) {
      out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sheet.freeze + '" topLeftCell="A' + (sheet.freeze + 1) +
        '" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>');
    } else {
      out.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    }
    out.push('<sheetFormatPr defaultRowHeight="15"/>');
    if (sheet.cols && sheet.cols.length) {
      out.push('<cols>');
      sheet.cols.forEach(function (w, i) { out.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'); });
      out.push('</cols>');
    }
    out.push('<sheetData>');
    for (var ri = 0; ri < rows.length; ri++) {
      var r = rows[ri], cells = [];
      for (var ci = 0; ci < r.length; ci++) {
        var c = r[ci];
        if (c == null || c === '') continue;
        var o = typeof c === 'object' ? c : { v: c };
        if (o.v == null || o.v === '') continue;
        var ref = colName(ci) + (ri + 1), total = o.s === 'total';
        var t = o.t || (typeof o.v === 'number' ? 'num' : 'str');
        if (t === 'date') {
          var ser = dateSerial(o.v);
          if (ser == null) t = 'str';
          else { cells.push('<c r="' + ref + '" s="' + ST.date + '"><v>' + ser + '</v></c>'); continue; }
        }
        if ((t === 'num' || t === 'pct') && isFinite(Number(o.v))) {
          var st = t === 'pct' ? (total ? ST.totalPct : ST.pct) : (total ? ST.totalNum : ST.num);
          cells.push('<c r="' + ref + '" s="' + st + '"><v>' + Number(o.v) + '</v></c>');
        } else {
          var st2 = o.s === 'head' ? ST.head : total ? ST.totalStr : ST.str;
          cells.push('<c r="' + ref + '" s="' + st2 + '" t="s"><v>' + sst.id(String(o.v)) + '</v></c>');
        }
      }
      out.push('<row r="' + (ri + 1) + '">' + cells.join('') + '</row>');
    }
    out.push('</sheetData>');
    if (sheet.autoFilter && rows.length > 1 && ncol) out.push('<autoFilter ref="A1:' + colName(ncol - 1) + rows.length + '"/>');
    out.push('<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
    return out.join('');
  }

  var STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="맑은 고딕"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE7EBEF"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color rgb="FF8B96A1"/></top><bottom style="thin"><color rgb="FF8B96A1"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  function sheetName(n) { return String(n).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || 'Sheet'; }

  // 자동 필터는 숨은 이름(_FilterDatabase)을 함께 적어야 엑셀이 경고 없이 연다
  function definedNames(sheets) {
    var names = [];
    sheets.forEach(function (sh, i) {
      if (!sh.autoFilter || sh.rows.length < 2) return;
      var ncol = sh.rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0);
      names.push('<definedName name="_xlnm._FilterDatabase" localSheetId="' + i + '" hidden="1">\'' +
        esc(sheetName(sh.name).replace(/'/g, "''")) + '\'!$A$1:$' + colName(ncol - 1) + '$' + sh.rows.length + '</definedName>');
    });
    return names.length ? '<definedNames>' + names.join('') + '</definedNames>' : '';
  }

  function build(sheets) {
    var sst = { list: [], map: new Map(), count: 0, id: function (s) {
      this.count++;
      var i = this.map.get(s);
      if (i === undefined) { i = this.list.length; this.list.push(s); this.map.set(s, i); }
      return i;
    } };
    var sheetFiles = sheets.map(function (sh, i) { return { name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(sh, sst) }; });
    var sstXml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' +
      sst.count + '" uniqueCount="' + sst.list.length + '">'];
    sst.list.forEach(function (s) {
      sstXml.push(/^\s|\s$/.test(s) ? '<si><t xml:space="preserve">' + esc(s) + '</t></si>' : '<si><t>' + esc(s) + '</t></si>');
    });
    sstXml.push('</sst>');

    var ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(function (_, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';
    var stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    var core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>가축질병 발생 통계</dc:title><dc:creator>가축방역 상황실</dc:creator>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + stamp + '</dcterms:modified></cp:coreProperties>';
    var app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>가축방역 상황실 현황판</Application></Properties>';
    var wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView/></bookViews><sheets>' +
      sheets.map(function (sh, i) { return '<sheet name="' + esc(sheetName(sh.name)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
      '</sheets>' + definedNames(sheets) + '</workbook>';
    var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (_, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '<Relationship Id="rId' + (sheets.length + 2) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
      '</Relationships>';

    return zip([
      { name: '[Content_Types].xml', data: ct },
      { name: '_rels/.rels', data: rels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      { name: 'xl/workbook.xml', data: wb },
      { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
      { name: 'xl/styles.xml', data: STYLES },
      { name: 'xl/sharedStrings.xml', data: sstXml.join('') }
    ].concat(sheetFiles));
  }

  var api = {
    parts: build,  // Uint8Array 조각 배열 (시험용)
    build: function (sheets) {
      return new Blob(build(sheets), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    },
    crc32: crc32
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLSX = api;
})(this);
