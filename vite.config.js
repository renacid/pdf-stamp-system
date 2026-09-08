import { defineConfig } from 'vite';
import { cpSync, mkdirSync } from 'node:fs';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'local-pdf-assets',
    closeBundle() {
      for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
        mkdirSync(`dist/pdfjs/${folder}`, { recursive: true });
        cpSync(`node_modules/pdfjs-dist/${folder}`, `dist/pdfjs/${folder}`, { recursive: true });
      }
      mkdirSync('dist/licenses', { recursive: true });
      for (const [source, name] of [
        ['pdf-lib/LICENSE.md', 'pdf-lib.txt'],
        ['pdfjs-dist/LICENSE', 'pdfjs.txt'],
        ['@pdf-lib/standard-fonts/LICENSE.md', 'standard-fonts.txt'],
        ['@pdf-lib/upng/LICENSE', 'upng.txt'],
        ['pako/LICENSE', 'pako.txt'],
        ['tslib/LICENSE.txt', 'tslib.txt'],
      ]) cpSync(`node_modules/${source}`, `dist/licenses/${name}`);
    },
  }],
});
