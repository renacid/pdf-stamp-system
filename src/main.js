import './style.css';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { KEYS, validateSettings, defaultSlots, validateSlots, parseSlots, slotsUrl, exceedsPage } from './settings.js';
import { drawStamp, stampMultiplePdf, createSamplePdf } from './pdf.js';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
const $ = id => document.getElementById(id);
const form = $('stamp-form');
const assets = new URL(import.meta.env.DEV ? '/node_modules/pdfjs-dist/' : './pdfjs/', location.href).href;
const pdfOptions = { cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, isEvalSupported: false };
let originalBytes = null, originalDoc = null, outputBytes = null, fileName = '';
let revision = 0, loadId = 0, timer, running = false;
let slots = defaultSlots(), activeSlot = 0;

function status(message, type = '') {
  $('status').textContent = message;
  $('status').className = type;
}
function setForm(s) {
  for (const key of KEYS) $(key).value = s[key];
  $('enabled').checked = s.enabled;
  updateLabels();
  updateTabs();
}
function captureSlot() {
  slots[activeSlot] = { ...Object.fromEntries(KEYS.map(key => [key, $(key).value])), enabled: $('enabled').checked };
}
function updateTabs() {
  document.querySelectorAll('[data-slot]').forEach((tab, i) => {
    tab.textContent = `${i + 1} ${slots[i].text || '未入力'}`;
    tab.title = `枠${i + 1}：${slots[i].text || '未入力'}（${slots[i].enabled ? '使用中' : '使用しない'}）`;
    tab.setAttribute('aria-selected', String(i === activeSlot));
    tab.tabIndex = i === activeSlot ? 0 : -1;
    tab.classList.toggle('slot-enabled', slots[i].enabled);
  });
  $('stamp-editor').setAttribute('aria-labelledby', `stamp-tab-${activeSlot}`);
  $('stamp-count').textContent = `${slots.filter(s => s.enabled).length} / 4 使用中`;
}
function selectSlot(index) {
  captureSlot(); activeSlot = index; setForm(slots[index]); schedule();
}
function readForm() {
  return validateSettings(Object.fromEntries(KEYS.map(key => [key, $(key).value])));
}
function updateLabels() {
  document.querySelectorAll('.unit-label').forEach(el => { el.textContent = $('unit').value; });
  $('opacity-value').textContent = `${Math.round(Number($('opacity').value) * 100)}%`;
}
function updateUrl(s) {
  const url = slotsUrl(s, location.href);
  $('settings-url').value = url;
  $('copy-url').disabled = false;
  try { history.replaceState(null, '', url); } catch { /* URL copying still works in restrictive contexts. */ }
}
function invalidate() {
  revision++;
  outputBytes = null;
  $('download').disabled = true;
  $('preview').hidden = true;
  $('empty-state').hidden = false;
}
function schedule() {
  clearTimeout(timer);
  invalidate();
  updateLabels();
  captureSlot(); updateTabs();
  try {
    const settings = validateSlots(slots);
    updateUrl(settings);
    if (!originalDoc) return status('PDFを選択すると、捺印の仕上がりを確認できます。');
    status('捺印プレビューを作成しています…');
    timer = setTimeout(processLatest, 250);
  } catch (error) {
    $('copy-url').disabled = true;
    $('settings-url').value = '';
    status(error.message, 'error');
  }
}
async function processLatest() {
  if (running || !originalDoc) return;
  const current = revision;
  running = true;
  let renderedDoc;
  try {
    const settings = validateSlots(slots);
    const enabled = settings.map((s, i) => ({ s, i })).filter(({ s }) => s.enabled);
    if (!enabled.length) throw new Error('「このハンコを捺印する」を1枠以上オンにしてください。');
    const source = originalDoc, inputBytes = originalBytes;
    const entries = [], warnings = [];
    await document.fonts.ready;
    for (const { s, i } of enabled) {
      if (s.page > source.numPages) throw new Error(`枠${i + 1}（${s.text}）：このPDFは${source.numPages}ページです。ページ番号を変更してください。`);
      const viewport = (await source.getPage(s.page)).getViewport({ scale: 1 });
      const stamp = drawStamp(document.createElement('canvas'), s.text);
      entries.push({ pngBytes: stamp.toDataURL('image/png'), settings: s, viewport });
      if (exceedsPage(s, viewport)) warnings.push(`枠${i + 1}（${s.text}）が用紙からはみ出しています`);
      if (s.opacity === 0) warnings.push(`枠${i + 1}（${s.text}）は不透明度0で表示されません`);
    }
    const selected = settings[activeSlot];
    const previewPage = selected.enabled ? selected.page : enabled[0].s.page;
    const natural = entries.find(entry => entry.settings.page === previewPage).viewport;
    const bytes = await stampMultiplePdf(inputBytes, entries);
    if (current !== revision) return;
    renderedDoc = await pdfjs.getDocument({ ...pdfOptions, data: bytes.slice() }).promise;
    const stampedPage = await renderedDoc.getPage(previewPage);
    const scale = Math.min(1.6, 1600 / natural.width, 2200 / natural.height);
    const viewport = stampedPage.getViewport({ scale });
    const staging = document.createElement('canvas');
    staging.width = Math.ceil(viewport.width); staging.height = Math.ceil(viewport.height);
    await stampedPage.render({ canvasContext: staging.getContext('2d'), viewport }).promise;
    if (current !== revision) return;
    const visible = $('preview');
    visible.width = staging.width; visible.height = staging.height;
    visible.getContext('2d').drawImage(staging, 0, 0);
    visible.hidden = false;
    $('empty-state').hidden = true;
    $('page-info').textContent = `${previewPage} / ${source.numPages} ページ・${enabled.length}個捺印`;
    $('dimensions').textContent = `${(natural.width * 25.4 / 72).toFixed(1)} × ${(natural.height * 25.4 / 72).toFixed(1)} mm`;
    outputBytes = bytes;
    $('download').disabled = false;
    if (warnings.length) status(`${warnings.join('。')}。設定を確認してください。`, 'warning');
    else status(`${enabled.length}個のハンコを反映しました。保存すると、別ページのハンコもすべて含まれます。`);
  } catch (error) {
    if (current === revision) status(`処理できませんでした。${error.message || '別のPDFでお試しください。'}`, 'error');
  } finally {
    if (renderedDoc) await renderedDoc.loadingTask.destroy();
    running = false;
    if (current !== revision && originalDoc) timer = setTimeout(processLatest, 0);
  }
}
async function loadPdf(bytes, name, token) {
  let doc, loadingTask;
  try {
    // Fail explicitly for encrypted files instead of silently ignoring encryption.
    await PDFDocument.load(bytes, { updateMetadata: false });
    loadingTask = pdfjs.getDocument({ ...pdfOptions, data: bytes.slice() });
    doc = await loadingTask.promise;
    if (token !== loadId) { await doc.loadingTask.destroy(); return; }
    originalBytes = bytes; originalDoc = doc; fileName = name;
    $('file-info').textContent = `${name} ・ ${doc.numPages}ページ ・ ${(bytes.length / 1024 / 1024).toFixed(2)} MB`;
    $('page-info').textContent = `${doc.numPages}ページ`;
    schedule();
  } catch (error) {
    if (loadingTask) await loadingTask.destroy();
    if (token !== loadId) return;
    $('page-info').textContent = 'PDF未選択';
    $('file-info').textContent = 'ファイルを選び直してください。';
    status(/encrypt|password/i.test(`${error.name} ${error.message}`) ? 'パスワード保護されたPDFには対応していません。保護を解除したPDFを選択してください。' : 'PDFを読み込めませんでした。破損していないPDFファイルを選択してください。', 'error');
  }
}
function beginLoad() {
  loadId++;
  clearTimeout(timer);
  invalidate();
  const previous = originalDoc;
  originalDoc = null; originalBytes = null;
  if (previous) void previous.loadingTask.destroy();
  $('page-info').textContent = '読込中';
  $('dimensions').textContent = '—';
  $('file-info').textContent = 'PDFを読み込んでいます…';
  status('PDFを読み込んでいます…');
  return loadId;
}
async function selectFile(file) {
  if (!file) return;
  const token = beginLoad();
  if (file.size > 100 * 1024 * 1024) {
    $('page-info').textContent = 'PDF未選択';
    $('file-info').textContent = 'ファイルを選び直してください。';
    status('サンプル版では100MB以下のPDFを選択してください。', 'error'); return;
  }
  try { await loadPdf(new Uint8Array(await file.arrayBuffer()), file.name, token); }
  catch { if (token === loadId) status('ファイルを読み込めませんでした。もう一度選択してください。', 'error'); }
}
$('pdf-file').addEventListener('change', event => { void selectFile(event.target.files[0]); event.target.value = ''; });
const dropzone = document.querySelector('.file-picker');
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.add('dragover'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, event => { event.preventDefault(); dropzone.classList.remove('dragover'); });
dropzone.addEventListener('drop', event => { void selectFile(event.dataTransfer.files[0]); });
$('sample').addEventListener('click', async () => {
  const token = beginLoad();
  try { await loadPdf(await createSamplePdf(), 'サンプル書類.pdf', token); }
  catch { if (token === loadId) status('サンプルPDFを作成できませんでした。', 'error'); }
});
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', schedule);
$('reset').addEventListener('click', () => { slots[activeSlot] = defaultSlots()[activeSlot]; setForm(slots[activeSlot]); schedule(); });
document.querySelectorAll('[data-slot]').forEach((tab, i) => {
  tab.addEventListener('click', () => selectSlot(i));
  tab.addEventListener('keydown', event => {
    const next = { ArrowRight: (i + 1) % 4, ArrowLeft: (i + 3) % 4, Home: 0, End: 3 }[event.key];
    if (next === undefined) return;
    event.preventDefault(); selectSlot(next); $(`stamp-tab-${next}`).focus();
  });
});
$('download').addEventListener('click', () => {
  if (!outputBytes) return;
  const url = URL.createObjectURL(new Blob([outputBytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
});
$('copy-url').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('settings-url').value); $('url-status').textContent = '設定URLをコピーしました。ブックマークやメモに保存できます。'; }
  catch { $('settings-url').focus(); $('settings-url').select(); $('url-status').textContent = 'URLを選択しました。Ctrl+C（Macは⌘C）でコピーしてください。'; }
});
function restoreUrl() {
  try { slots = parseSlots(location.search); activeSlot = 0; setForm(slots[activeSlot]); schedule(); }
  catch (error) {
    slots = defaultSlots(); activeSlot = 0; setForm(slots[0]); invalidate(); $('settings-url').value = ''; $('copy-url').disabled = true;
    status(`URLの設定が不正です。${error.message} フォームを修正するか「初期値に戻す」を押してください。`, 'error');
  }
}
window.addEventListener('popstate', restoreUrl);
restoreUrl();

// Optional browser-agent access uses the same validated settings as the form.
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
  try {
    Promise.resolve(document.modelContext.registerTool({
      name: 'configure_pdf_stamp',
      description: '現在のPDFの捺印設定をフォームに反映する。ファイルの選択や保存は行わない。',
      inputSchema: { type: 'object', properties: Object.fromEntries(KEYS.map(key => [key, { type: ['text', 'unit'].includes(key) ? 'string' : 'number' }])), additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute(input) {
        const s = { ...validateSettings({ ...readForm(), ...input }), enabled: slots[activeSlot].enabled };
        setForm(s); schedule();
        return { settings: s, url: $('settings-url').value, preview: originalDoc ? 'updating' : 'no_pdf_selected' };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
  } catch { /* Optional API is not required for the application. */ }
}

