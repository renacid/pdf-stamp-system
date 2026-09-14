import { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';
import { imagePlacement } from './settings.js';

export function drawStamp(canvas, text) {
  canvas.width = canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 1024);
  ctx.strokeStyle = ctx.fillStyle = '#bd252d';
  ctx.lineWidth = 24;
  ctx.beginPath(); ctx.arc(512, 512, 496, 0, Math.PI * 2); ctx.stroke();
  const chars = [...text];
  const fontSize = Math.min(530, 720 / chars.length);
  ctx.font = `600 ${fontSize}px "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif CJK JP", "MS Mincho", serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const spacing = Math.min(fontSize * 1.05, 710 / chars.length);
  chars.forEach((char, i) => ctx.fillText(char, 512, 512 + (i - (chars.length - 1) / 2) * spacing, 720));
  return canvas;
}
export async function stampPdf(originalBytes, pngBytes, settings, viewport) {
  return stampMultiplePdf(originalBytes, [{ pngBytes, settings, viewport }]);
}
export async function stampMultiplePdf(originalBytes, entries) {
  if (entries.length < 1 || entries.length > 4) throw new Error('捺印するハンコは1〜4個にしてください。');
  const pdf = await PDFDocument.load(originalBytes, { updateMetadata: false });
  for (const { pngBytes, settings, viewport } of entries) {
  if (settings.page > pdf.getPageCount()) throw new Error(`このPDFは${pdf.getPageCount()}ページです。ページ番号を変更してください。`);
  const stamp = await pdf.embedPng(pngBytes);
  const { angle, ...placement } = imagePlacement(settings, viewport);
  pdf.getPage(settings.page - 1).drawImage(stamp, { ...placement, rotate: degrees(angle) });
  }
  return pdf.save();
}
export async function createSamplePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const page = pdf.addPage([595.276, 841.89]);
    page.drawText('SAMPLE DOCUMENT', { x: 56, y: 720, size: 23, font, color: rgb(.14, .22, .3) });
    page.drawText(`Page ${i + 1} / 2     |     A4 portrait`, { x: 56, y: 690, size: 11, font });
    page.drawText('Use this page to check stamp position, size and rotation.', { x: 56, y: 650, size: 11, font });
    for (let row = 0; row < 10; row++) page.drawLine({ start: { x: 56, y: 600 - row * 40 }, end: { x: 539, y: 600 - row * 40 }, color: rgb(.82, .86, .9), thickness: .6 });
    page.drawRectangle({ x: 430, y: 95, width: 90, height: 90, borderColor: rgb(.6, .65, .7), borderWidth: .7 });
    page.drawText('STAMP', { x: 453, y: 77, size: 10, font, color: rgb(.4, .45, .5) });
  }
  return pdf.save();
}
