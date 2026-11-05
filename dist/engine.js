// Детерминированная модель «Тихой почты». Без DOM, таймера и случайности.
// Письма ходят одновременно. Первая ошибка — по порядку писем, затем столкновения.

export const DIRECTIONS = Object.freeze({
  N: Object.freeze([-1, 0]),
  E: Object.freeze([0, 1]),
  S: Object.freeze([1, 0]),
  W: Object.freeze([0, -1]),
});

export const OPPOSITE = Object.freeze({ N: 'S', E: 'W', S: 'N', W: 'E' });

export const PIECE_ORDER = Object.freeze([null, 'h', 'v', 'ne', 'se', 'sw', 'nw', 'bridge']);

export const PIECES = Object.freeze(['h', 'v', 'ne', 'se', 'sw', 'nw', 'bridge']);

const OPENINGS = Object.freeze({
  h: Object.freeze(['W', 'E']),
  v: Object.freeze(['N', 'S']),
  ne: Object.freeze(['N', 'E']),
  se: Object.freeze(['S', 'E']),
  sw: Object.freeze(['S', 'W']),
  nw: Object.freeze(['N', 'W']),
  bridge: Object.freeze(['N', 'E', 'S', 'W']),
});

export const LETTER_COLOR = Object.freeze({ red: 'красное', blue: 'синее', green: 'зелёное' });
export const LETTER_SHAPE = Object.freeze({ circle: 'круглое', square: 'квадратное', triangle: 'треугольное' });
export const BOX_COLOR = Object.freeze({ red: 'красный', blue: 'синий', green: 'зелёный' });
export const BOX_SHAPE = Object.freeze({ circle: 'круглый', square: 'квадратный', triangle: 'треугольный' });

export const PIECE_LABEL = Object.freeze({
  h: 'прямая лента по горизонтали',
  v: 'прямая лента по вертикали',
  ne: 'поворот на север и восток',
  se: 'поворот на юг и восток',
  sw: 'поворот на юг и запад',
  nw: 'поворот на север и запад',
  bridge: 'мост-развязка',
});

export const DIR_LABEL = Object.freeze({ N: 'север', E: 'восток', S: 'юг', W: 'запад' });

const HISTORY_LIMIT = 100;

export function letterName(entity) {
  return `${LETTER_COLOR[entity.color]} ${LETTER_SHAPE[entity.shape]} письмо`;
}

export function boxName(entity) {
  return `${BOX_COLOR[entity.color]} ${BOX_SHAPE[entity.shape]} ящик`;
}

export function inBounds(level, r, c) {
  return r >= 0 && c >= 0 && r < level.size && c < level.size;
}

export function isWall(level, r, c) {
  return level.walls.some(([wr, wc]) => wr === r && wc === c);
}

export function sourceAt(level, r, c) {
  return level.sources.find(item => item.r === r && item.c === c) ?? null;
}

export function boxAt(level, r, c) {
  return level.boxes.find(item => item.r === r && item.c === c) ?? null;
}

export function canPlace(level, r, c) {
  return inBounds(level, r, c) && !isWall(level, r, c) && !sourceAt(level, r, c) && !boxAt(level, r, c);
}

export function emptyLayout(level) {
  return Array.from({ length: level.size }, () => Array(level.size).fill(null));
}

export function cloneLayout(layout) {
  return layout.map(row => row.slice());
}

function sameLayout(a, b) {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r += 1) {
    if (a[r].length !== b[r].length) return false;
    for (let c = 0; c < a[r].length; c += 1) if (a[r][c] !== b[r][c]) return false;
  }
  return true;
}

export function nextPiece(piece) {
  const index = PIECE_ORDER.indexOf(piece ?? null);
  const safe = index < 0 ? 0 : index + 1;
  return PIECE_ORDER[safe % PIECE_ORDER.length];
}

export function pieceExit(piece, moving) {
  const openings = OPENINGS[piece];
  if (!openings || !DIRECTIONS[moving]) return null;
  const entry = OPPOSITE[moving];
  if (!openings.includes(entry)) return null;
  if (piece === 'h' || piece === 'v' || piece === 'bridge') return moving;
  return openings.find(side => side !== entry) ?? null;
}

function laneOf(piece, moving) {
  if (piece !== 'bridge') return null;
  if (moving === 'E' || moving === 'W') return 'h';
  if (moving === 'N' || moving === 'S') return 'v';
  return null;
}

function cloneLetters(letters) {
  return letters.map(letter => ({ ...letter }));
}

function placeName(r, c) {
  return `строка ${r + 1}, столбец ${c + 1}`;
}

function errorMessage(error, letters, level) {
  const letter = letters.find(item => item.id === error.letterId);
  const name = letter ? letterName(letter) : 'Письмо';
  const where = placeName(error.r, error.c);
  if (error.type === 'off-board') return `Выход за поле: ${name} выехало за край (${where}).`;
  if (error.type === 'wrong-box') {
    const box = boxAt(level, error.r, error.c);
    const target = box ? boxName(box) : 'чужой ящик';
    return `Чужой ящик: ${name} попало в ${target} (${where}).`;
  }
  if (error.type === 'collision') {
    const other = letters.find(item => item.id === error.otherId);
    const otherName = other ? letterName(other) : 'другое письмо';
    return `Столкновение: ${name} и ${otherName} встретились (${where}).`;
  }
  if (error.reason === 'wall') return `Тупик: ${name} упёрлось в стену (${where}).`;
  if (error.reason === 'loop') return `Тупик: ${name} ходит по кругу (${where}).`;
  return `Тупик: ${name} не может ехать дальше (${where}).`;
}

function fail(error, letters, level) {
  return { ...error, message: errorMessage(error, letters, level) };
}

function initialLetters(level) {
  return level.sources.map(source => ({
    id: source.id,
    color: source.color,
    shape: source.shape,
    r: source.r,
    c: source.c,
    dir: null,
    lane: null,
    delivered: false,
  }));
}

function planLetter(level, layout, letter) {
  const source = level.sources.find(item => item.id === letter.id);
  let moving;
  if (!letter.dir) {
    moving = source?.dir ?? null;
  } else {
    moving = pieceExit(layout[letter.r]?.[letter.c] ?? null, letter.dir);
  }
  if (!moving || !DIRECTIONS[moving]) {
    return { error: { type: 'dead-end', r: letter.r, c: letter.c, letterId: letter.id, reason: 'blocked' } };
  }
  const [dr, dc] = DIRECTIONS[moving];
  const nr = letter.r + dr;
  const nc = letter.c + dc;
  if (!inBounds(level, nr, nc)) {
    return { error: { type: 'off-board', r: letter.r, c: letter.c, letterId: letter.id } };
  }
  if (isWall(level, nr, nc)) {
    return { error: { type: 'dead-end', r: nr, c: nc, letterId: letter.id, reason: 'wall' } };
  }
  const box = boxAt(level, nr, nc);
  if (box) {
    if (box.color !== letter.color || box.shape !== letter.shape) {
      return { error: { type: 'wrong-box', r: nr, c: nc, letterId: letter.id } };
    }
    return { plan: { letter, nr, nc, dir: moving, deliver: true, lane: null } };
  }
  if (sourceAt(level, nr, nc)) {
    return { error: { type: 'dead-end', r: nr, c: nc, letterId: letter.id, reason: 'blocked' } };
  }
  const piece = layout[nr]?.[nc] ?? null;
  if (!pieceExit(piece, moving)) {
    return { error: { type: 'dead-end', r: nr, c: nc, letterId: letter.id, reason: piece ? 'blocked' : 'empty' } };
  }
  return { plan: { letter, nr, nc, dir: moving, deliver: false, lane: laneOf(piece, moving) } };
}

function collision(plans) {
  for (let i = 0; i < plans.length; i += 1) {
    for (let j = i + 1; j < plans.length; j += 1) {
      const a = plans[i];
      const b = plans[j];
      const sameCell = a.nr === b.nr && a.nc === b.nc;
      if (sameCell) {
        const crossed = !a.deliver && !b.deliver && a.lane && b.lane && a.lane !== b.lane;
        if (!crossed) {
          return { type: 'collision', r: a.nr, c: a.nc, letterId: a.letter.id, otherId: b.letter.id };
        }
      }
      const swap = a.nr === b.letter.r && a.nc === b.letter.c && b.nr === a.letter.r && b.nc === a.letter.c;
      if (swap) {
        return { type: 'collision', r: a.letter.r, c: a.letter.c, letterId: a.letter.id, otherId: b.letter.id };
      }
    }
  }
  return null;
}

export function simulate(level, layout) {
  let letters = initialLetters(level);
  const frames = [{ letters: cloneLetters(letters) }];
  const cap = level.size * level.size * Math.max(1, letters.length) + 2;
  for (let tick = 0; tick < cap; tick += 1) {
    if (letters.every(letter => letter.delivered)) return { status: 'won', frames, error: null };
    const plans = [];
    for (const letter of letters) {
      if (letter.delivered) continue;
      const result = planLetter(level, layout, letter);
      if (result.error) return { status: 'error', frames, error: fail(result.error, letters, level) };
      plans.push(result.plan);
    }
    const hit = collision(plans);
    if (hit) return { status: 'error', frames, error: fail(hit, letters, level) };
    const moved = new Map(plans.map(plan => [plan.letter.id, plan]));
    letters = letters.map(letter => {
      const plan = moved.get(letter.id);
      if (!plan) return letter;
      return {
        ...letter,
        r: plan.nr,
        c: plan.nc,
        dir: plan.dir,
        lane: plan.lane,
        delivered: plan.deliver,
      };
    });
    frames.push({ letters: cloneLetters(letters) });
  }
  const stuck = letters.find(letter => !letter.delivered) ?? letters[0];
  const loop = { type: 'dead-end', r: stuck.r, c: stuck.c, letterId: stuck.id, reason: 'loop' };
  return { status: 'error', frames, error: fail(loop, letters, level) };
}

function cornerFrom(dirs) {
  const key = [...dirs].sort().join(',');
  return { 'E,N': 'ne', 'E,S': 'se', 'S,W': 'sw', 'N,W': 'nw' }[key] ?? null;
}

function pieceFromOpenings(dirs) {
  const horizontal = dirs.has('E') || dirs.has('W');
  const vertical = dirs.has('N') || dirs.has('S');
  if (horizontal && vertical) {
    if (dirs.size === 2) return cornerFrom(dirs);
    return 'bridge';
  }
  if (horizontal) return 'h';
  if (vertical) return 'v';
  return null;
}

function combinePieces(existing, stroke) {
  if (!stroke) return existing ?? null;
  if (!existing) return stroke;
  if (existing === stroke || existing === 'bridge' || stroke === 'bridge') return existing === 'bridge' || stroke === 'bridge' ? 'bridge' : existing;
  const straight = piece => piece === 'h' || piece === 'v';
  if (straight(existing) && straight(stroke) && existing !== stroke) return 'bridge';
  return stroke;
}

function directionBetween(from, to) {
  if (from.r === to.r && to.c === from.c + 1) return 'E';
  if (from.r === to.r && to.c === from.c - 1) return 'W';
  if (from.c === to.c && to.r === from.r + 1) return 'S';
  if (from.c === to.c && to.r === from.r - 1) return 'N';
  return null;
}

export function paintStroke(level, layout, path) {
  const next = cloneLayout(layout);
  if (!Array.isArray(path) || path.length < 2) return next;
  const openings = new Map();
  const add = (r, c, dir) => {
    const key = `${r},${c}`;
    if (!openings.has(key)) openings.set(key, new Set());
    openings.get(key).add(dir);
  };
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const dir = directionBetween(from, to);
    if (!dir || !canPlace(level, from.r, from.c) || !canPlace(level, to.r, to.c)) continue;
    add(from.r, from.c, dir);
    add(to.r, to.c, OPPOSITE[dir]);
  }
  for (const [key, dirs] of openings) {
    const [r, c] = key.split(',').map(Number);
    next[r][c] = combinePieces(layout[r][c], pieceFromOpenings(dirs));
  }
  return next;
}

export function createCampaign(levels) {
  if (!Array.isArray(levels) || levels.length === 0) throw new Error('Нужен хотя бы один уровень');
  const drafts = new Map();
  const completed = new Set();
  let currentId = levels[0].id;
  let trace = null;
  let frame = 0;

  const level = () => levels.find(item => item.id === currentId);
  const ensure = () => {
    if (!drafts.has(currentId)) drafts.set(currentId, { layout: emptyLayout(level()), history: [] });
    return drafts.get(currentId);
  };
  const clearTrace = () => {
    trace = null;
    frame = 0;
  };
  const noteProgress = () => {
    if (trace?.status === 'won' && frame === trace.frames.length - 1) completed.add(currentId);
  };
  const commit = next => {
    const draft = ensure();
    if (sameLayout(draft.layout, next)) return false;
    draft.history.push(cloneLayout(draft.layout));
    if (draft.history.length > HISTORY_LIMIT) draft.history.shift();
    draft.layout = next;
    clearTrace();
    return true;
  };

  return {
    get levels() { return levels; },
    get level() { return level(); },
    get layout() { return cloneLayout(ensure().layout); },
    get canUndo() { return ensure().history.length > 0; },
    get completed() { return [...completed]; },
    cycle(r, c) {
      if (!canPlace(level(), r, c)) return false;
      const next = this.layout;
      next[r][c] = nextPiece(next[r][c]);
      return commit(next);
    },
    stroke(path) {
      return commit(paintStroke(level(), ensure().layout, path));
    },
    undo() {
      const draft = ensure();
      if (draft.history.length === 0) return false;
      draft.layout = draft.history.pop();
      clearTrace();
      return true;
    },
    reset() {
      drafts.set(currentId, { layout: emptyLayout(level()), history: [] });
      clearTrace();
    },
    selectLevel(id) {
      const next = levels.find(item => item.id === String(id));
      if (!next || next.id === currentId) return false;
      currentId = next.id;
      clearTrace();
      return true;
    },
    step() {
      if (!trace) {
        trace = simulate(level(), ensure().layout);
        frame = Math.min(1, trace.frames.length - 1);
      } else if (frame < trace.frames.length - 1) frame += 1;
      noteProgress();
      return this.view();
    },
    run() {
      trace = simulate(level(), ensure().layout);
      frame = trace.frames.length - 1;
      noteProgress();
      return this.view();
    },
    load(state) {
      const next = levels.find(item => item.id === state.levelId);
      if (!next) throw new Error('Неизвестный уровень');
      currentId = next.id;
      completed.clear();
      for (const id of state.completed) completed.add(id);
      drafts.clear();
      for (const [id, draft] of Object.entries(state.drafts ?? {})) {
        drafts.set(id, {
          layout: cloneLayout(draft.layout),
          history: (draft.history ?? []).map(cloneLayout),
        });
      }
      clearTrace();
    },
    snapshot() {
      return {
        levelId: currentId,
        completed: [...completed],
        drafts: Object.fromEntries([...drafts].map(([id, draft]) => [id, {
          layout: cloneLayout(draft.layout),
          history: draft.history.map(cloneLayout),
        }])),
      };
    },
    view() {
      const atEnd = Boolean(trace) && frame === trace.frames.length - 1;
      return {
        level: level(),
        layout: cloneLayout(ensure().layout),
        canUndo: ensure().history.length > 0,
        completed: [...completed],
        frame,
        frameCount: trace ? trace.frames.length : 0,
        letters: trace ? cloneLetters(trace.frames[frame].letters) : null,
        error: atEnd ? trace.error : null,
        status: !trace ? 'editing' : atEnd ? trace.status : 'stepping',
      };
    },
  };
}
