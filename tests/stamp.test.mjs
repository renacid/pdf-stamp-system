import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument, degrees, PDFName, PDFNumber } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, parseSettings, validateSettings, settingsUrl, inPoints, imagePlacement, exceedsPage } from '../src/settings.js';
import { drawStamp, stampPdf, stampMultiplePdf, createSamplePdf } from '../src/pdf.js';
import { defaultSlots, parseSlots, slotsUrl, validateSlots } from '../src/settings.js';

const near = (actual, expected, tolerance = 0.001) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);
const pdfOptions = { standardFontDataUrl: fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)).replaceAll('\\', '/') };
test('query defaults, Unicode, zeros and full URL round-trip', () => {
  assert.deepEqual(parseSettings(''), DEFAULTS);
  const settings = { ...DEFAULTS, text: '佐々木', page: 2, x: 0, y: 35.5, unit: 'pt', opacity: 0, rotation: -45 };
  const url = new URL(settingsUrl(settings, 'https://example.com/repository/?old=1#old'));
  assert.equal(url.pathname, '/repository/');
  assert.deepEqual(parseSettings(url.search), settings);
  assert.equal(url.hash, '');
  assert.equal(parseSettings('?text=%3Csvg%3E').text, '<svg>');
});
test('invalid query values fail instead of silently placing a wrong stamp', () => {
  for (const query of ['?page=0', '?page=1.5', '?x=-1', '?y=Infinity', '?size=0', '?unit=cm', '?opacity=2', '?rotation=361', '?text=', '?x=', '?page=NaN']) assert.throws(() => parseSettings(query), query);
  assert.throws(() => validateSettings({ text: 'あ'.repeat(13) }));
  near(inPoints({ ...DEFAULTS, x: 25.4 }).x, 72);
});
test('sample is a readable two-page A4 PDF', async () => {
  const doc = await PDFDocument.load(await createSamplePdf());
  assert.equal(doc.getPageCount(), 2);
  near(doc.getPage(0).getWidth(), 595.276);
});
test('four slots preserve legacy URLs, independent settings and disabled registrations', () => {
  const legacy = parseSlots('?text=山田&page=2&x=0&opacity=0');
  assert.equal(legacy[0].text, '山田');
  assert.equal(legacy[0].page, 2);
  assert.equal(legacy.filter(s => s.enabled).length, 1);
  const slots = defaultSlots().map((s, i) => ({ ...s, enabled: i !== 2, page: i + 1, unit: i % 2 ? 'pt' : 'mm', opacity: i / 4, rotation: i ? i * -15 : 0 }));
  const url = new URL(slotsUrl(slots, 'https://example.com/pdf-stamp-system/'));
  assert.deepEqual(parseSlots(url.search), slots);
  assert.equal(parseSlots('?text2=田中')[1].enabled, true);
  assert.equal(parseSlots('?text2=田中&enabled2=0')[1].enabled, false);
  assert.equal(parseSlots('?enabled=0')[0].enabled, false);
  assert.throws(() => parseSlots('?page3=0'), /枠3/);
  assert.throws(() => parseSlots('?enabled4=yes'), /枠4/);
  assert.throws(() => validateSlots([...slots, slots[0]]), /4枠/);
});
test('four distinct stamps export together on the same or different pages', async () => {
  const original = await fixture(90);
  const source = await pdfjs.getDocument({ ...pdfOptions, data: original.slice() }).promise;
  for (const targetPages of [[1, 1, 1, 1], [1, 2, 1, 2]]) {
    const entries = [];
    for (let i = 0; i < 4; i++) {
      const settings = { ...DEFAULTS, text: ['高橋', '田中', '佐々木', '鈴木'][i], page: targetPages[i], unit: 'pt', x: 15 + i * 85, y: 40, size: 45, rotation: i * 30 };
      entries.push({ settings, pngBytes: drawStamp(createCanvas(1, 1), settings.text).toBuffer('image/png'), viewport: (await source.getPage(settings.page)).getViewport({ scale: 1 }) });
    }
    const output = await stampMultiplePdf(original, entries);
    const doc = await pdfjs.getDocument({ ...pdfOptions, data: output }).promise;
    for (let pageNumber = 1; pageNumber <= 2; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const canvas = await render(page);
      for (let i = 0; i < 4; i++) {
        const area = createCanvas(50, 50);
        area.getContext('2d').drawImage(canvas, 13 + i * 85, 38, 50, 50, 0, 0, 50, 50);
        assert.equal(redBounds(area).count > 0, targetPages[i] === pageNumber, `slot ${i + 1}, page ${pageNumber}`);
      }
      assert.ok((await page.getTextContent()).items.some(item => item.str.includes('Original text')));
    }
    await assert.rejects(stampMultiplePdf(original, [...entries, entries[0]]), /1〜4/);
    await doc.loadingTask.destroy();
  }
  await source.loadingTask.destroy();
});

async function fixture(rotation, userUnit = 1) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage([400, 500]);
    page.setCropBox(20, 30, 300, 400);
    page.setRotation(degrees(rotation));
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(userUnit));
    page.drawText('Original text stays searchable', { x: 35, y: 220, size: 12 });
  }
  return doc.save();
}
async function render(page) {
  const viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}
function redBounds(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  const bounds = { left: Infinity, top: Infinity, right: -1, bottom: -1, count: 0 };
  for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
    const i = (y * canvas.width + x) * 4;
    if (data[i] > data[i + 1] + 30 && data[i] > data[i + 2] + 30) {
      bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y);
      bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y); bounds.count++;
    }
  }
  return bounds;
}
for (const pageRotation of [0, 90, 180, 270]) {
  test(`actual PDF export: CropBox and page rotation ${pageRotation}, clockwise stamp rotation`, async () => {
    const original = await fixture(pageRotation);
    const source = await pdfjs.getDocument({ ...pdfOptions, data: original.slice() }).promise;
    const viewport = (await source.getPage(2)).getViewport({ scale: 1 });
    const settings = { ...DEFAULTS, page: 2, unit: 'pt', x: 40, y: 50, size: 60, rotation: 35, opacity: .65 };
    const png = drawStamp(createCanvas(1, 1), '佐々木').toBuffer('image/png');
    const output = await stampPdf(original, png, settings, viewport);
    const doc = await pdfjs.getDocument({ ...pdfOptions, data: output }).promise;
    assert.equal(doc.numPages, 2);
    const first = await doc.getPage(1), second = await doc.getPage(2);
    assert.equal(redBounds(await render(first)).count, 0, 'unselected page must not be stamped');
    const bounds = redBounds(await render(second));
    near(bounds.left, 40, 2); near(bounds.top, 50, 2);
    near(bounds.right, 99, 2); near(bounds.bottom, 109, 2);
    const text = await second.getTextContent();
    assert.ok(text.items.some(item => item.str.includes('Original text')), 'original searchable text preserved');
    const placement = imagePlacement(settings, viewport);
    near(((placement.angle - pageRotation + 35) % 360 + 360) % 360, 0);
    assert.equal(exceedsPage(settings, viewport), false);
    assert.equal(exceedsPage({ ...settings, x: 1000 }, viewport), true);
    await doc.loadingTask.destroy(); await source.loadingTask.destroy();
  });
}
test('UserUnit scaling, fully transparent stamp and invalid target page', async () => {
  const original = await fixture(90, 2);
  const source = await pdfjs.getDocument({ ...pdfOptions, data: original.slice() }).promise;
  const viewport = (await source.getPage(1)).getViewport({ scale: 1 });
  const settings = { ...DEFAULTS, unit: 'pt', size: 60, opacity: 0 };
  near(imagePlacement(settings, viewport).width, 30);
  const png = drawStamp(createCanvas(1, 1), '高橋').toBuffer('image/png');
  const output = await stampPdf(original, png, settings, viewport);
  const doc = await pdfjs.getDocument({ ...pdfOptions, data: output }).promise;
  assert.equal(redBounds(await render(await doc.getPage(1))).count, 0);
  await assert.rejects(stampPdf(original, png, { ...settings, page: 3 }, viewport), /2ページ/);
  await doc.loadingTask.destroy(); await source.loadingTask.destroy();
});


