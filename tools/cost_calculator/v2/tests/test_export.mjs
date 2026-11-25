import assert from 'node:assert/strict';
import test from 'node:test';
import {buildCostTree} from '../web/cost-tree.mjs';
import {costWorkbook} from '../web/export.mjs';
import {priceCall} from '../web/pricing.mjs';
import {schemeById} from '../web/rate-card.mjs';
import {crc32} from '../web/xlsx.mjs';

// Reads a stored zip through its central directory and checks every file's CRC.
export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = new TextDecoder();
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  let at = view.getUint32(end + 16, true);
  const files = {};
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const crc = view.getUint32(at + 16, true), size = view.getUint32(at + 20, true), nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true), name = text.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    assert.equal(view.getUint32(offset, true), 0x04034b50, name);
    const start = offset + 30 + view.getUint16(offset + 26, true), data = bytes.subarray(start, start + size);
    assert.equal(crc32(data), crc, name);
    files[name] = text.decode(data);
    at += 46 + nameLength;
  }
  return files;
}

// Evaluates the Cost sheet's formulas from its own cells: SUM(refs), a*b/k, and $B$3.
function evaluate(sheet) {
  const cells = {}, formulas = {};
  for (const [, ref, body] of sheet.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(.*?)<\/c>/g)) {
    const f = body.match(/<f>(.*?)<\/f>/), v = body.match(/<v>(.*?)<\/v>/);
    if (f) formulas[ref] = f[1]; else if (v) cells[ref] = Number(v[1]);
  }
  const value = ref => {
    ref = ref.replace(/\$/g, '');
    if (!(ref in cells)) {
      const f = formulas[ref];
      assert.ok(f, `no value or formula in ${ref}`);
      const sum = f.match(/^SUM\((.*)\)$/);
      cells[ref] = sum ? sum[1].split(',').reduce((total, part) => total + value(part), 0)
        : f.split('/').map((part, i) => (i ? Number(part) : part.split('*').reduce((total, x) => total * value(x), 1))).reduce((a, b) => a / b);
    }
    return cells[ref];
  };
  return {value, formulas};
}

test('the Excel export holds the cost tree as live formulas, the settings, the nodes and the walk', () => {
  const scheme = schemeById('rt21-pro');
  const result = priceCall({promptDesign: 'stage'}, scheme), tree = buildCostTree(result, scheme);
  const files = unzip(costWorkbook({tree, result, scheme, option: scheme.id, params: result.params, url: 'http://127.0.0.1:8781/?option=x'}));
  assert.deepEqual([...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(match => match[1]), ['Cost', 'Settings', 'Nodes', 'Responses']);
  // Every cost on the Cost sheet comes out of its formula: the price row equals the page's price per minute.
  const {value, formulas} = evaluate(files['xl/worksheets/sheet1.xml']);
  const products = Object.values(formulas).filter(f => /^B\d+\*C\d+\/10000$/.test(f)).length;
  assert.ok(products >= 10, products);
  assert.ok(Math.abs(value('D8') - tree.value) < 1e-9, `${value('D8')} vs ${tree.value}`);
  assert.ok(Math.abs(value('E8') - result.perCall) < 1e-9);
  assert.match(files['xl/worksheets/sheet2.xml'], /promptDesign.*?stage/);
  assert.match(files['xl/worksheets/sheet3.xml'], /if-else branch, not taken/);
  assert.equal([...files['xl/worksheets/sheet4.xml'].matchAll(/<row /g)].length, result.breakdown.walk.trace.length + 1);
});
