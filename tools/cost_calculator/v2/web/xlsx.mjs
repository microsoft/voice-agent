// A minimal .xlsx writer with no dependencies: sheets of rows, each cell a number, a string, or
// {v, f, style} (a value, an Excel formula without '=', a style index from STYLES). The zip is stored, not
// compressed. Formulas carry their computed value, and the workbook asks Excel to recalculate on open.
const encoder = new TextEncoder();

// Cell styles, by index: general, bold, cents (4 decimals), tokens (thousands), rate (2 decimals), USD.
export const STYLES = Object.freeze({plain: 0, bold: 1, cents: 2, tokens: 3, rate: 4, usd: 5});
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
  + '<numFmts count="4"><numFmt numFmtId="164" formatCode="0.0000"/><numFmt numFmtId="165" formatCode="#,##0"/>'
  + '<numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="&quot;$&quot;#,##0.0000"/></numFmts>'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + [164, 165, 166, 167].map(id => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')
  + '</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const column = index => {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name;
  return name;
};

function cellXml(content, ref) {
  if (content === null || content === undefined || content === '') return '';
  const cell = typeof content === 'object' ? content : {v: content};
  const style = cell.style ? ` s="${cell.style}"` : '';
  const number = typeof cell.v === 'number' && Number.isFinite(cell.v);
  if (cell.f) return `<c r="${ref}"${style}><f>${escape(cell.f)}</f>${number ? `<v>${cell.v}</v>` : ''}</c>`;
  if (number) return `<c r="${ref}"${style}><v>${cell.v}</v></c>`;
  if (cell.v === null || cell.v === undefined || typeof cell.v === 'number') return '';
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escape(cell.v)}</t></is></c>`;
}

function sheetXml({rows, widths = []}) {
  const cols = widths.length ? `<cols>${widths.map((width, i) => `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const data = rows.map((row, r) => `<row r="${r + 1}">${row.map((content, c) => cellXml(content, `${column(c)}${r + 1}`)).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${data}</sheetData></worksheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// Stored zip: a local header and the data for each file, then the central directory and its end record.
function zip(files) {
  const parts = [], central = [];
  let offset = 0;
  for (const {name, data} of files) {
    const nameBytes = encoder.encode(name), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(12, 0x21, true); // 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(14, 0x21, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((total, bytes) => total + bytes.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((total, bytes) => total + bytes.length, 0));
  let at = 0;
  for (const bytes of all) { out.set(bytes, at); at += bytes.length; }
  return out;
}

// sheets: [{name, rows, widths}] -> the .xlsx file as bytes.
export function workbook(sheets) {
  const xml = text => encoder.encode(text);
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const main = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    {name: '[Content_Types].xml', data: xml(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
      + '</Types>')},
    {name: '_rels/.rels', data: xml(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)},
    {name: 'xl/workbook.xml', data: xml(`${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>`
      + sheets.map((sheet, i) => `<sheet name="${escape(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
      + '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>')},
    {name: 'xl/_rels/workbook.xml.rels', data: xml(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
      + sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
      + `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`)},
    {name: 'xl/styles.xml', data: xml(STYLES_XML)},
    ...sheets.map((sheet, i) => ({name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(sheetXml(sheet))})),
  ];
  return zip(files);
}
