export const DEFAULTS = Object.freeze({ text: '高橋', page: 1, x: 20, y: 20, size: 20, unit: 'mm', opacity: 1, rotation: 0 });
export const KEYS = Object.keys(DEFAULTS);
export function validateSettings(input) {
  const s = { ...DEFAULTS, ...input };
  s.text = String(s.text).trim();
  if (!s.text || [...s.text].length > 12 || /[\r\n\t\x00-\x1f]/u.test(s.text)) throw new Error('捺印する文字は、改行を含まない1〜12文字で入力してください。');
  if (!['mm', 'pt'].includes(s.unit)) throw new Error('単位は mm または pt を指定してください。');
  for (const key of ['page', 'x', 'y', 'size', 'opacity', 'rotation']) {
    if (String(s[key]).trim() === '') throw new Error(`${key} に数値を入力してください。`);
    s[key] = Number(s[key]);
    if (!Number.isFinite(s[key])) throw new Error(`${key} に有効な数値を入力してください。`);
  }
  if (!Number.isSafeInteger(s.page) || s.page < 1) throw new Error('ページ番号は1以上の整数で指定してください。');
  if (s.x < 0 || s.y < 0 || s.x > 100000 || s.y > 100000) throw new Error('X・Yは0〜100000で指定してください。');
  if (s.size <= 0 || s.size > 1000) throw new Error('サイズは0より大きく、1000以下で指定してください。');
  if (s.opacity < 0 || s.opacity > 1) throw new Error('不透明度は0〜1で指定してください。');
  if (Math.abs(s.rotation) > 360) throw new Error('回転角度は−360〜360度で指定してください。');
  return s;
}
export function parseSettings(search) {
  const params = new URLSearchParams(search);
  return validateSettings(Object.fromEntries(KEYS.filter(k => params.has(k)).map(k => [k, params.get(k)])));
}
export function settingsUrl(settings, href) {
  const url = new URL(href);
  url.search = new URLSearchParams(Object.entries(validateSettings(settings))).toString();
  url.hash = '';
  return url.href;
}
export function inPoints(s) {
  const factor = s.unit === 'mm' ? 72 / 25.4 : 1;
  return { x: s.x * factor, y: s.y * factor, size: s.size * factor };
}
// PDF.js's inverse viewport handles CropBox origin, page rotation and UserUnit.
export function imagePlacement(s, viewport) {
  const { x, y, size } = inPoints(s);
  const theta = s.rotation * Math.PI / 180;
  const center = [x + size / 2, y + size / 2];
  const map = (dx, dy) => viewport.convertToPdfPoint(center[0] + dx * Math.cos(theta) - dy * Math.sin(theta), center[1] + dx * Math.sin(theta) + dy * Math.cos(theta));
  const bl = map(-size / 2, size / 2);
  const br = map(size / 2, size / 2);
  const tl = map(-size / 2, -size / 2);
  return { x: bl[0], y: bl[1], width: Math.hypot(br[0] - bl[0], br[1] - bl[1]), height: Math.hypot(tl[0] - bl[0], tl[1] - bl[1]), angle: Math.atan2(br[1] - bl[1], br[0] - bl[0]) * 180 / Math.PI, opacity: s.opacity };
}
export function exceedsPage(s, viewport) {
  const p = inPoints(s);
  return p.x + p.size > viewport.width + 0.001 || p.y + p.size > viewport.height + 0.001;
}
