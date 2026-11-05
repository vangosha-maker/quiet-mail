import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeBin = process.env.CHROME || '/usr/bin/google-chrome';
const shots = process.env.QUIET_MAIL_SHOTS || path.join(tmpdir(), 'quiet-mail-qa');
const artifacts = '/opt/cursor/artifacts';

function fail(message) {
  throw new Error(message);
}

function startServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
  };
  const dist = path.join(root, 'dist');
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = path.normalize(path.join(dist, pathname));
    if (!file.startsWith(dist)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function launchChrome(userData) {
  const chrome = spawn(chromeBin, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${userData}`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const stderr = [];
  const port = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome не открыл DevTools:\n${stderr.join('')}`)), 15000);
    const watch = chunk => {
      const text = chunk.toString();
      stderr.push(text);
      const match = text.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    };
    chrome.stderr.on('data', watch);
    chrome.stdout.on('data', watch);
    chrome.once('exit', code => {
      clearTimeout(timer);
      reject(new Error(`Chrome завершился с кодом ${code}:\n${stderr.join('')}`));
    });
  });
  return { chrome, port };
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let next = 0;
  const pending = new Map();
  const events = [];
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`Не удалось открыть ${wsUrl}`)));
  });
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}`));
      else resolve(message.result);
      return;
    }
    if (message.method) events.push(message);
  });
  return {
    events,
    ready: opened,
    send(method, params = {}) {
      const id = ++next;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { ws.close(); },
  };
}

async function openPage(port, url) {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!created.ok) fail(`json/new ${created.status}`);
  const target = await created.json();
  const page = connect(target.webSocketDebuggerUrl);
  await page.ready;
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Network.enable');
  return page;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function evaluate(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    fail(exceptionDetails.exception?.description || exceptionDetails.text || 'evaluate failed');
  }
  return result.value;
}

async function waitFor(page, expression, label) {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await evaluate(page, expression)) return;
    await sleep(40);
  }
  fail(`таймаут: ${label}`);
}

async function setViewport(page, width, height) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
}

async function screenshot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  const buffer = Buffer.from(data, 'base64');
  await mkdir(shots, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(shots, name), buffer);
  await writeFile(path.join(artifacts, name), buffer);
  return buffer.length;
}

function overlaps(a, b) {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

async function layoutReport(page) {
  return evaluate(page, `(() => {
    const rect = el => {
      const box = el.getBoundingClientRect();
      return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
    };
    const cells = [...document.querySelectorAll('.cell')].map(rect);
    const buttons = ['#run', '#step', '#undo', '#reset'].map(sel => ({ sel, ...rect(document.querySelector(sel)) }));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      board: rect(document.querySelector('#board')),
      status: rect(document.querySelector('#status')),
      cells,
      buttons,
      boardTouch: getComputedStyle(document.querySelector('#board')).touchAction,
      bodyTouch: getComputedStyle(document.body).touchAction,
      rulesTouch: getComputedStyle(document.querySelector('.rules')).touchAction,
      shapes: {
        circle: document.querySelectorAll('#board circle, #legend circle').length,
        rect: document.querySelectorAll('#board rect, #legend rect').length,
        polygon: document.querySelectorAll('#board polygon, #legend polygon').length,
      },
    };
  })()`);
}

function assertLayout(report, width, height) {
  if (report.scrollWidth > report.innerWidth + 1) fail(`горизонтальная прокрутка на ${width}: ${report.scrollWidth} > ${report.innerWidth}`);
  if (report.boardTouch !== 'none') fail(`touch-action поля = ${report.boardTouch}`);
  if (report.bodyTouch === 'none') fail('touch-action: none стоит на всей странице');
  if (report.rulesTouch === 'none') fail('правила тоже блокируют прокрутку');
  if (report.cells.length === 0) fail('на поле нет клеток');
  for (const cell of report.cells) {
    if (cell.width < 44 || cell.height < 44) fail(`клетка ${cell.width.toFixed(1)}×${cell.height.toFixed(1)} меньше 44 px`);
  }
  const blocks = [report.board, report.status, ...report.buttons];
  for (const block of blocks) {
    if (block.right > report.innerWidth + 1 || block.left < -1) fail(`блок вылезает по горизонтали ${JSON.stringify(block)}`);
    if (block.width < 44 || block.height < 44) fail(`слишком мелкая цель ${JSON.stringify(block)}`);
  }
  if (overlaps(report.board, report.status)) fail('поле перекрывает сообщение');
  for (const button of report.buttons) {
    if (overlaps(report.board, button)) fail(`поле перекрывает ${button.sel}`);
    if (overlaps(report.status, button)) fail(`сообщение перекрывает ${button.sel}`);
  }
  for (let i = 0; i < report.buttons.length; i += 1) {
    for (let j = i + 1; j < report.buttons.length; j += 1) {
      if (overlaps(report.buttons[i], report.buttons[j])) fail(`${report.buttons[i].sel} перекрывает ${report.buttons[j].sel}`);
    }
  }
  if (report.scrollHeight <= height) fail(`страница не прокручивается на ${width}×${height}: высота ${report.scrollHeight}`);
  console.log(`PASS layout ${width}×${height}: cells ${report.cells.length}, min cell ${Math.min(...report.cells.map(cell => cell.width)).toFixed(1)} px, scrollWidth ${report.scrollWidth}, page ${report.scrollHeight}`);
}

async function touchDrag(page, x, y, dy) {
  const point = step => ({ x: Math.round(x), y: Math.round(y + dy * step), id: 1 });
  await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0)] });
  for (let step = 1; step <= 6; step += 1) {
    await page.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(step / 6)] });
  }
  await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(80);
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const userData = await mkdtemp(path.join(tmpdir(), 'quiet-mail-chrome-'));
  const { chrome, port: portReady } = launchChrome(userData);
  let page;
  try {
    const port = await portReady;
    page = await openPage(port, base);
    const errors = [];
    const watch = setInterval(() => {
      for (const event of page.events.splice(0)) {
        if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails?.exception?.description || 'exception');
      }
    }, 20);
    await waitFor(page, 'document.querySelectorAll(".cell").length === 25', 'поле 5×5');

    for (const [width, height] of [[360, 640], [390, 844]]) {
      await setViewport(page, width, height);
      await evaluate(page, `document.querySelector('[data-level="6"]').click()`);
      await waitFor(page, 'document.querySelectorAll(".cell").length === 36', 'поле 6×6');
      const report = await layoutReport(page);
      assertLayout(report, width, height);
      if (report.shapes.circle < 1 || report.shapes.rect < 1 || report.shapes.polygon < 1) {
        fail(`на уровне 6 не все формы писем: ${JSON.stringify(report.shapes)}`);
      }
      const bytes = await screenshot(page, `quiet-mail-${width}x${height}.png`);
      console.log(`PASS screenshot ${width}×${height}: ${bytes} bytes`);
    }

    await evaluate(page, `document.documentElement.style.filter = 'grayscale(1)'`);
    const grayBytes = await screenshot(page, 'quiet-mail-390x844-gray.png');
    await evaluate(page, `document.documentElement.style.filter = ''`);
    console.log(`PASS grayscale screenshot: ${grayBytes} bytes, circle/rect/polygon remain separate shapes`);

    await setViewport(page, 390, 844);
    await evaluate(page, 'window.scrollTo(0, 0)');
    const beforeHeader = await evaluate(page, 'window.scrollY');
    const header = await evaluate(page, `(() => { const b = document.querySelector('header').getBoundingClientRect(); return {x: b.left + b.width / 2, y: b.top + b.height / 2}; })()`);
    await touchDrag(page, header.x, header.y, -180);
    const afterHeader = await evaluate(page, 'window.scrollY');
    if (afterHeader <= beforeHeader) fail(`протяжка вне поля не прокрутила страницу (${beforeHeader} → ${afterHeader})`);
    await evaluate(page, 'window.scrollTo(0, 0)');
    await sleep(500);
    await evaluate(page, 'window.scrollTo(0, 0)');
    const board = await evaluate(page, `(() => {
      const b = document.querySelector('#board').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.bottom - 30);
      return {
        x: b.left + b.width / 2,
        y: b.bottom - 30,
        top: b.top,
        bottom: b.bottom,
        touch: el ? getComputedStyle(el).touchAction : null,
        cls: el?.className || null,
      };
    })()`);
    const beforeBoard = await evaluate(page, 'window.scrollY');
    const dy = -Math.min(120, board.y - board.top - 24);
    if (board.y + dy <= board.top) fail('жест проверки выходит за поле');
    await touchDrag(page, board.x, board.y, dy);
    await sleep(300);
    const afterBoard = await evaluate(page, 'window.scrollY');
    if (afterBoard !== beforeBoard) {
      fail(`протяжка по полю прокрутила страницу на ${afterBoard - beforeBoard}px (touch=${board.touch}, ${board.cls}, y ${beforeBoard}→${afterBoard})`);
    }
    console.log(`PASS touch: вне поля scrollY ${beforeHeader}→${afterHeader}, по полю остался 0`);

    await evaluate(page, `document.querySelector('[data-level="1"]').click()`);
    await waitFor(page, `document.querySelector('#level-tag').textContent === 'Уровень 1'`, 'уровень 1');
    await evaluate(page, `['ArrowRight',' '].forEach(() => {});
      window.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight', bubbles:true}));
      window.dispatchEvent(new KeyboardEvent('keydown', {key:' ', bubbles:true}));
      const piece = document.querySelector('.cell.cursor')?.dataset.piece;
      if (piece !== 'h') throw new Error('клавиатура не сменила деталь: ' + piece);
      document.querySelector('#undo').click();
    `);
    console.log('PASS keyboard: стрелка и пробел');

    await evaluate(page, `(() => {
      const cell = (r, c) => document.querySelector(\`.cell[data-r="\${r}"][data-c="\${c}"]\`);
      const down = (r, c) => {
        const node = cell(r, c);
        const box = node.getBoundingClientRect();
        node.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, clientX: box.x + 8, clientY: box.y + 8}));
        return box;
      };
      down(0, 0);
      const mid = cell(0, 1).getBoundingClientRect();
      document.querySelector('#board').dispatchEvent(new PointerEvent('pointermove', {bubbles:true, button:0, pointerId:1, clientX: mid.x + 8, clientY: mid.y + 8}));
      document.querySelector('#board').dispatchEvent(new PointerEvent('pointerup', {bubbles:true, button:0, pointerId:1, clientX: mid.x + 8, clientY: mid.y + 8}));
      if (cell(0, 0).dataset.piece !== 'h' || cell(0, 1).dataset.piece !== 'h') throw new Error('протяжка не нарисовала прямую');
      document.querySelector('#reset').click();
    })()`);
    console.log('PASS drag: протяжка ставит прямую и «Заново» её убирает');

    await evaluate(page, `document.querySelector('#run').click()`);
    await waitFor(page, `document.querySelector('#status-title').textContent.includes('Тупик')`, 'тупик');
    const errorText = await evaluate(page, `document.querySelector('#status-text').textContent`);
    if (!/не может ехать дальше|упёрлось/.test(errorText)) fail(`нет объяснения ошибки: ${errorText}`);
    console.log('PASS error:', errorText);

    const placed = await evaluate(page, `(() => {
      const tap = (r, c) => {
        const node = document.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
        node.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerId:1, clientX:8, clientY:8}));
        node.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, button:0, pointerId:1, clientX:8, clientY:8}));
        node.click();
        return node.dataset.piece;
      };
      const pieces = [[2,1],[2,2],[2,3]].map(([r,c]) => r + ',' + c + ':' + tap(r, c));
      document.querySelector('#run').click();
      return { pieces, title: document.querySelector('#status-title').textContent, text: document.querySelector('#status-text').textContent };
    })()`);
    if (placed.title !== 'Почта дошла') fail(`уровень 1 не решён: ${JSON.stringify(placed)}`);
    await screenshot(page, 'quiet-mail-390x844-win.png');
    console.log('PASS level 1 reference via clicks');

    await page.send('Page.reload', { ignoreCache: true });
    await waitFor(page, `document.querySelectorAll('.cell').length === 25`, 'перезагрузка');
    const kept = await evaluate(page, `document.querySelector('.cell[data-r="2"][data-c="2"]').dataset.piece === 'h' && document.querySelector('[data-level="1"]').getAttribute('aria-label').includes('пройден')`);
    if (!kept) fail('после перезагрузки черновик или отметка уровня пропали');
    console.log('PASS reload keeps draft and solved level');

    await evaluate(page, `localStorage.setItem('quiet-mail:save:v1', '{'); location.reload()`);
    await waitFor(page, `document.querySelector('#level-tag')?.textContent === 'Уровень 1' && document.querySelector('.cell[data-r="2"][data-c="1"]')?.dataset.piece === ''`, 'сброс битого сохранения');
    console.log('PASS corrupt save resets to level 1');

    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `Object.defineProperty(window, 'localStorage', {configurable:true, get(){ throw new Error('denied'); }});`,
    });
    await page.send('Page.navigate', { url: base });
    await waitFor(page, `document.querySelectorAll('.cell').length === 25`, 'старт без хранилища');
    await evaluate(page, `document.querySelector('.cell[data-r="0"][data-c="0"]').click()`);
    const saveText = await evaluate(page, `document.querySelector('#save-status').textContent`);
    const piece = await evaluate(page, `document.querySelector('.cell[data-r="0"][data-c="0"]').dataset.piece`);
    if (piece !== 'h') fail('без localStorage клетка не меняется');
    if (!saveText.includes('недоступно')) fail(`нет сообщения о сохранении: ${saveText}`);
    console.log('PASS denied localStorage:', saveText);

    clearInterval(watch);
    for (const event of page.events) {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails?.exception?.description || 'exception');
    }
    if (errors.length) fail(`ошибки страницы:\n${errors.join('\n')}`);
    console.log('PASS no page exceptions');
    console.log(`Screenshots: ${shots}`);
    console.log(`Artifacts: ${artifacts}`);
  } finally {
    page?.close();
    chrome.kill();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
