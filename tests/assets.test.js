import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = ['index.html', 'style.css', 'app.js', 'engine.js', 'levels.js', 'save.js'];

async function text(path) {
  return readFile(new URL(path, import.meta.url), 'utf8');
}

test('dist and docs ship the same game files', async () => {
  for (const file of files) {
    const [dist, docs] = await Promise.all([
      readFile(new URL(`../dist/${file}`, import.meta.url)),
      readFile(new URL(`../docs/${file}`, import.meta.url)),
    ]);
    assert.deepEqual(dist, docs, file);
  }
});

test('icons are inline svg and letters differ by shape', async () => {
  const html = await text('../dist/index.html');
  const app = await text('../dist/app.js');
  const css = await text('../dist/style.css');
  const shipped = `${html}\n${app}\n${css}`;
  for (const glyph of ['↑', '↓', '←', '→', '↶', '↻', '⌘', '✓', '▶', '■', '●', '▲']) {
    assert.equal(shipped.includes(glyph), false, glyph);
  }
  assert.match(html, /aria-live="polite"/);
  for (const label of ['Запустить', 'Шаг', 'Отменить', 'Заново']) assert.match(html, new RegExp(label));
  assert.match(app, /<circle/);
  assert.match(app, /<rect/);
  assert.match(app, /<polygon/);
  assert.match(css, /\.board\s*\{[^}]*touch-action:\s*none/s);
  assert.equal(/body\s*\{[^}]*touch-action:\s*none/s.test(css), false);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /minmax\(44px,\s*1fr\)/);
  assert.equal(app.includes('Math.random'), false);
  assert.equal(app.includes('setTimeout'), false);
  assert.equal(app.includes('setInterval'), false);
  assert.equal(app.includes('fetch('), false);
});
