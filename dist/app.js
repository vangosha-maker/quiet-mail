import { LEVELS } from './levels.js';
import {
  DIR_LABEL,
  PIECE_LABEL,
  boxName,
  canPlace,
  letterName,
  paintStroke,
} from './engine.js';
import { restoreCampaign, saveCampaign } from './save.js';

const INK = { red: '#c83c32', blue: '#1f6fbf', green: '#1e8a56' };

const svg = (body, box = '0 0 24 24') =>
  `<svg viewBox="${box}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  play: svg('<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>'),
  step: svg('<path d="M7 5v14" /><path d="M11 7l8 5-8 5z" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M8 8H4v4"/><path d="M4.5 8a8 8 0 1 1-1.2 5"/>'),
  reset: svg('<path d="M20 12a8 8 0 1 1-2.2-5.5L20 8"/><path d="M20 4v4h-4"/>'),
  check: svg('<path d="M5 12.5l4.2 4.2L19 7"/>'),
  mail: svg('<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M4 7l8 6 8-6"/>'),
  alert: svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v5"/><path d="M12 16.5h.01"/>'),
};

const BELT = {
  h: 'M6 22H38',
  v: 'M22 6V38',
  ne: 'M22 6V22H38',
  se: 'M38 22H22V38',
  sw: 'M6 22H22V38',
  nw: 'M22 6V22H6',
  bridge: 'M6 22H38M22 6V15M22 29V38',
};

const NUB = {
  N: '22,3 27,10 17,10',
  E: '41,22 34,17 34,27',
  S: '22,41 17,34 27,34',
  W: '3,22 10,17 10,27',
};

function shapeMarkup(kind, x, y, size, fill, stroke) {
  if (kind === 'circle') {
    return `<circle cx="${x}" cy="${y}" r="${size / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
  }
  if (kind === 'square') {
    const half = size / 2;
    return `<rect x="${x - half}" y="${y - half}" width="${size}" height="${size}" rx="1.5" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>`;
  }
  const half = size / 2;
  return `<polygon points="${x},${y - half} ${x + half},${y + half} ${x - half},${y + half}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
}

function beltMarkup(piece) {
  if (!BELT[piece]) return '';
  return `<path d="${BELT[piece]}" fill="none" stroke="#3c4650" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function wallMarkup() {
  return '<path d="M-6 34L34 -6M-6 18L18 -6M10 50L50 10M26 50L50 26" stroke="#8a8175" stroke-width="3"/>';
}

function anchor(lane, index, total) {
  if (lane === 'h') return [22, 13];
  if (lane === 'v') return [31, 24];
  if (total > 1) return [14 + index * 16, 22];
  return [22, 22];
}

function statusCopy(view) {
  if (view.status === 'won') {
    const extra = view.level.id === LEVELS.at(-1).id
      ? 'Это последний уровень.'
      : 'Можно открыть следующий уровень.';
    return ['Почта дошла', `Все письма в своих ящиках. ${extra}`, 'check'];
  }
  if (view.status === 'error') {
    const titles = {
      'dead-end': 'Тупик',
      'wrong-box': 'Чужой ящик',
      collision: 'Столкновение',
      'off-board': 'Выход за поле',
    };
    return [titles[view.error.type] ?? 'Ошибка', view.error.message, 'alert'];
  }
  if (view.status === 'stepping') {
    const bits = view.letters.map(letter => (
      letter.delivered
        ? `${letterName(letter)} уже в ящике`
        : `${letterName(letter)} на строке ${letter.r + 1}, столбце ${letter.c + 1}`
    ));
    const total = Math.max(1, view.frameCount - 1);
    return ['Доставка', `Шаг ${view.frame} из ${total}. ${bits.join('. ')}.`, 'mail'];
  }
  const solved = view.completed.includes(view.level.id);
  const text = solved
    ? 'Этот уровень уже пройден. Ленты можно поменять и запустить снова.'
    : 'Клик меняет деталь, протяжка рисует ленту. Затем нажмите «Запустить».';
  return ['Разложите ленты', text, 'mail'];
}

function legendMarkup() {
  const letters = [
    ['circle', 'red', 'круглое письмо'],
    ['square', 'blue', 'квадратное письмо'],
    ['triangle', 'green', 'треугольное письмо'],
  ];
  const items = letters.map(([kind, color, label]) => (
    `<span class="legend-item">${svg(shapeMarkup(kind, 12, 12, 14, INK[color], INK[color]))}<span>${label}</span></span>`
  ));
  items.push(`<span class="legend-item">${svg(beltMarkup('h'), '0 0 44 44')}<span>лента</span></span>`);
  items.push(`<span class="legend-item">${svg(beltMarkup('bridge'), '0 0 44 44')}<span>мост</span></span>`);
  items.push(`<span class="legend-item">${svg(wallMarkup(), '0 0 44 44')}<span>стена</span></span>`);
  return items.join('');
}

export function boot(doc, win, storage) {
  const $ = selector => doc.querySelector(selector);
  const campaign = restoreCampaign(storage);
  const board = $('#board');
  const options = $('#level-options');
  let cursor = { r: 0, c: 0 };
  let drawing = null;
  let swallow = false;

  const ownedCell = node => {
    const cell = node?.closest?.('[data-r]');
    if (!cell) return null;
    let parent = cell;
    while (parent && parent !== board) parent = parent.parentElement;
    if (parent !== board) return null;
    return { r: Number(cell.dataset.r), c: Number(cell.dataset.c) };
  };

  const pointCell = event => ownedCell(doc.elementFromPoint?.(event.clientX, event.clientY)) || ownedCell(event.target);

  function ensureIcon(button, markup) {
    let icon = button.querySelector('.ico');
    if (!icon) {
      icon = doc.createElement('span');
      icon.classList.add('ico');
      icon.setAttribute('aria-hidden', 'true');
      button.prepend(icon);
    }
    icon.innerHTML = markup;
  }

  ensureIcon($('#run'), ICONS.play);
  ensureIcon($('#step'), ICONS.step);
  ensureIcon($('#undo'), ICONS.undo);
  ensureIcon($('#reset'), ICONS.reset);

  options.addEventListener('click', event => {
    const button = event.target?.closest?.('[data-level]');
    if (!button) return;
    campaign.selectLevel(button.dataset.level);
    render();
  });

  board.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return;
    swallow = false;
    const cell = ownedCell(event.target);
    if (!cell || !canPlace(campaign.level, cell.r, cell.c)) return;
    drawing = { id: event.pointerId, path: [cell], moved: false };
    try { board.setPointerCapture?.(event.pointerId); } catch { /* захват необязателен */ }
  });

  board.addEventListener('pointermove', event => {
    if (!drawing || event.pointerId !== drawing.id) return;
    const cell = pointCell(event);
    if (!cell) return;
    const last = drawing.path.at(-1);
    if (cell.r === last.r && cell.c === last.c) return;
    const prev = drawing.path.at(-2);
    if (prev && prev.r === cell.r && prev.c === cell.c) {
      drawing.path.pop();
      drawing.moved = drawing.path.length > 1;
      render();
      return;
    }
    const adjacent = Math.abs(cell.r - last.r) + Math.abs(cell.c - last.c) === 1;
    if (!adjacent || !canPlace(campaign.level, cell.r, cell.c)) return;
    if (drawing.path.some(item => item.r === cell.r && item.c === cell.c)) return;
    drawing.path.push(cell);
    drawing.moved = true;
    render();
  });

  const finishDraw = event => {
    if (!drawing || (event?.pointerId !== undefined && event.pointerId !== drawing.id)) return;
    const stroke = drawing;
    drawing = null;
    if (!stroke.moved) return;
    swallow = true;
    campaign.stroke(stroke.path);
    render();
  };

  board.addEventListener('pointerup', finishDraw);
  board.addEventListener('pointercancel', () => {
    if (!drawing) return;
    drawing = null;
    render();
  });
  win.addEventListener('pointerup', finishDraw);

  board.addEventListener('click', event => {
    if (swallow) {
      swallow = false;
      return;
    }
    if (event.detail === 0 && event.isTrusted) return;
    const cell = ownedCell(event.target);
    if (!cell) return;
    cursor = cell;
    campaign.cycle(cell.r, cell.c);
    render();
  });

  $('#run').addEventListener('click', () => { campaign.run(); render(); });
  $('#step').addEventListener('click', () => { campaign.step(); render(); });
  $('#undo').addEventListener('click', () => { campaign.undo(); render(); });
  $('#reset').addEventListener('click', () => { campaign.reset(); render(); });

  win.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[event.key]) {
      event.preventDefault();
      const [dr, dc] = arrows[event.key];
      const size = campaign.level.size;
      cursor = {
        r: Math.max(0, Math.min(size - 1, cursor.r + dr)),
        c: Math.max(0, Math.min(size - 1, cursor.c + dc)),
      };
      render({ focusBoard: true });
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
      const button = event.target?.closest?.('button');
      if (button && !button.classList.contains('cell')) return;
      event.preventDefault();
      campaign.cycle(cursor.r, cursor.c);
      render({ focusBoard: true });
    }
  });

  function cellLabel(level, layout, r, c, letters, error) {
    const source = level.sources.find(item => item.r === r && item.c === c);
    const box = level.boxes.find(item => item.r === r && item.c === c);
    const piece = layout[r][c];
    let text = `Строка ${r + 1}, столбец ${c + 1}. `;
    if (level.walls.some(([wr, wc]) => wr === r && wc === c)) text += 'Стена.';
    else if (source) text += `Источник: ${letterName(source)}, выход на ${DIR_LABEL[source.dir]}.`;
    else if (box) text += `Ящик: ${boxName(box)}.`;
    else text += piece ? `${PIECE_LABEL[piece]}.` : 'Пустая клетка.';
    const here = letters.filter(letter => letter.r === r && letter.c === c);
    if (here.length) text += ` ${here.map(letter => letterName(letter)).join(', ')}.`;
    if (error && error.r === r && error.c === c) text += ' Здесь первая ошибка.';
    return text;
  }

  function cellMarkup(level, layout, r, c, letters) {
    const source = level.sources.find(item => item.r === r && item.c === c);
    const mailbox = level.boxes.find(item => item.r === r && item.c === c);
    const piece = layout[r][c];
    const here = letters.filter(letter => letter.r === r && letter.c === c);
    const parts = [];
    if (level.walls.some(([wr, wc]) => wr === r && wc === c)) parts.push(wallMarkup());
    if (piece) parts.push(beltMarkup(piece));
    if (source) {
      const home = here.some(letter => letter.id === source.id && !letter.delivered);
      const color = INK[source.color];
      parts.push(shapeMarkup(source.shape, 22, 22, 16, home ? color : 'none', color));
      parts.push(`<polygon points="${NUB[source.dir]}" fill="${color}"/>`);
    }
    if (mailbox) {
      const color = INK[mailbox.color];
      parts.push(shapeMarkup(mailbox.shape, 22, 22, 18, 'none', color));
      const delivered = here.filter(letter => letter.delivered);
      delivered.forEach((letter, index) => {
        const [x, y] = anchor(null, index, delivered.length);
        parts.push(shapeMarkup(letter.shape, x, y, 12, INK[letter.color], INK[letter.color]));
      });
    }
    const moving = here.filter(letter => !letter.delivered && !source);
    moving.forEach((letter, index) => {
      const [x, y] = anchor(letter.lane, index, moving.length);
      parts.push(shapeMarkup(letter.shape, x, y, 14, INK[letter.color], INK[letter.color]));
    });
    if (!parts.length) return '';
    return `<svg viewBox="0 0 44 44" aria-hidden="true">${parts.join('')}</svg>`;
  }

  function render({ focusBoard = false } = {}) {
    const view = campaign.view();
    const level = view.level;
    if (cursor.r >= level.size || cursor.c >= level.size) cursor = { r: 0, c: 0 };
    const layout = drawing?.moved ? paintStroke(level, view.layout, drawing.path) : view.layout;
    const letters = drawing ? level.sources.map(source => ({
      id: source.id,
      color: source.color,
      shape: source.shape,
      r: source.r,
      c: source.c,
      delivered: false,
      lane: null,
    })) : (view.letters ?? level.sources.map(source => ({
      id: source.id,
      color: source.color,
      shape: source.shape,
      r: source.r,
      c: source.c,
      delivered: false,
      lane: null,
    })));
    const [title, text, icon] = statusCopy(drawing ? { ...view, status: 'editing', letters: null } : view);
    const keepFocus = !drawing && (focusBoard || Boolean(doc.activeElement?.closest?.('#board')));

    $('#level-tag').textContent = `Уровень ${level.id}`;
    $('#level-name').textContent = level.name;
    $('#level-hint').textContent = level.hint;
    const mode = drawing ? 'editing' : view.status === 'error' ? 'error' : view.status;
    $('#status').className = `status ${mode}`;
    $('.status-icon').innerHTML = ICONS[icon];
    $('#status-title').textContent = title;
    $('#status-text').textContent = text;
    $('#undo').disabled = !view.canUndo;
    $('#step').disabled = !drawing && (view.status === 'won' || view.status === 'error');
    $('#save-status').textContent = saveCampaign(storage, campaign)
      ? 'Черновик сохранён в этом браузере.'
      : 'Сохранение недоступно — игра продолжается без него.';

    const buttons = LEVELS.map(item => {
      const button = doc.createElement('button');
      button.type = 'button';
      button.classList.add('level-button');
      button.setAttribute('data-level', item.id);
      const solved = view.completed.includes(item.id);
      button.setAttribute('aria-pressed', String(item.id === level.id));
      button.setAttribute('aria-label', solved ? `${item.name}, пройден` : item.name);
      button.innerHTML = `<span class="lvl-num">${item.id}</span>${solved ? ICONS.check : ''}`;
      return button;
    });
    options.replaceChildren(...buttons);

    board.style['--size'] = String(level.size);
    board.style.gridTemplateColumns = `repeat(${level.size}, minmax(44px, 1fr))`;
    board.setAttribute('aria-label', `Поле ${level.size} на ${level.size}, ${level.name}`);
    const cells = [];
    for (let r = 0; r < level.size; r += 1) {
      for (let c = 0; c < level.size; c += 1) {
        const cell = doc.createElement('button');
        cell.type = 'button';
        cell.classList.add('cell');
        const source = level.sources.find(item => item.r === r && item.c === c);
        const mailbox = level.boxes.find(item => item.r === r && item.c === c);
        if (level.walls.some(([wr, wc]) => wr === r && wc === c)) cell.classList.add('wall');
        if (source) cell.classList.add('source');
        if (mailbox) cell.classList.add('box');
        if (layout[r][c]) cell.classList.add('belt');
        if (r === cursor.r && c === cursor.c) cell.classList.add('cursor');
        if (!drawing && view.error && view.error.r === r && view.error.c === c) cell.classList.add('is-error');
        cell.setAttribute('data-r', String(r));
        cell.setAttribute('data-c', String(c));
        cell.setAttribute('data-piece', layout[r][c] ?? '');
        if (source) cell.setAttribute('data-color', source.color);
        if (mailbox) cell.setAttribute('data-color', mailbox.color);
        cell.tabIndex = r === cursor.r && c === cursor.c ? 0 : -1;
        if (r === cursor.r && c === cursor.c) cell.setAttribute('aria-current', 'true');
        cell.setAttribute('aria-label', cellLabel(level, layout, r, c, letters, drawing ? null : view.error));
        cell.innerHTML = cellMarkup(level, layout, r, c, letters);
        cells.push(cell);
      }
    }
    board.replaceChildren(...cells);
    $('#legend').innerHTML = legendMarkup();
    if (keepFocus) {
      cells.find(cell => cell.dataset.r === String(cursor.r) && cell.dataset.c === String(cursor.c))?.focus();
    }
  }

  render();
  return { campaign, render };
}

const documentRef = globalThis.document;
const windowRef = globalThis.window;
if (documentRef?.querySelector?.('#board') && windowRef?.addEventListener) {
  let storage;
  try { storage = windowRef.localStorage; } catch { storage = undefined; }
  boot(documentRef, windowRef, storage);
}
