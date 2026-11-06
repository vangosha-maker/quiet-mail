import { DIRECTIONS, canPlace, emptyLayout, isWall, simulate } from '../dist/engine.js';

const NAMES = Object.keys(DIRECTIONS);

function stepDir(from, to) {
  if (to.r === from.r && to.c === from.c + 1) return 'E';
  if (to.r === from.r && to.c === from.c - 1) return 'W';
  if (to.c === from.c && to.r === from.r + 1) return 'S';
  if (to.c === from.c && to.r === from.r - 1) return 'N';
  return null;
}

function ownBox(level, source) {
  return level.boxes.find(box => box.color === source.color && box.shape === source.shape);
}

function blocked(level, source, r, c) {
  if (r < 0 || c < 0 || r >= level.size || c >= level.size) return true;
  if (isWall(level, r, c)) return true;
  const foreignSource = level.sources.find(item => item.r === r && item.c === c);
  if (foreignSource && foreignSource.id !== source.id) return true;
  const box = level.boxes.find(item => item.r === r && item.c === c);
  if (box && (box.color !== source.color || box.shape !== source.shape)) return true;
  if (!box && !canPlace(level, r, c) && !(foreignSource && foreignSource.id === source.id)) return true;
  return false;
}

function pieceFrom(openings) {
  const has = dir => openings.has(dir);
  const horizontal = has('E') || has('W');
  const vertical = has('N') || has('S');
  if (openings.size === 2 && horizontal && !vertical) return 'h';
  if (openings.size === 2 && vertical && !horizontal) return 'v';
  if (openings.size === 2 && horizontal && vertical) {
    const key = [...openings].sort().join(',');
    return { 'E,N': 'ne', 'E,S': 'se', 'S,W': 'sw', 'N,W': 'nw' }[key] ?? null;
  }
  if (openings.size === 4 && horizontal && vertical && [...openings].every(dir => NAMES.includes(dir))) return 'bridge';
  return null;
}

export function layoutFromPaths(paths) {
  const openings = new Map();
  for (const path of paths) {
    for (let index = 1; index < path.length - 1; index += 1) {
      const prev = path[index - 1];
      const cur = path[index];
      const next = path[index + 1];
      const key = `${cur.r},${cur.c}`;
      if (!openings.has(key)) openings.set(key, new Set());
      const set = openings.get(key);
      set.add(stepDir(cur, prev));
      set.add(stepDir(cur, next));
    }
  }
  const pieces = [];
  for (const [key, set] of openings) {
    if ([...set].some(dir => !dir)) return null;
    const piece = pieceFrom(set);
    if (!piece) return null;
    const [r, c] = key.split(',').map(Number);
    pieces.push({ r, c, p: piece });
  }
  return pieces;
}

function applyPieces(level, pieces) {
  const layout = emptyLayout(level);
  for (const piece of pieces) layout[piece.r][piece.c] = piece.p;
  return layout;
}

export function collectPaths(level, source, { extra = 2, cap = 400 } = {}) {
  const box = ownBox(level, source);
  const [dr, dc] = DIRECTIONS[source.dir];
  const first = { r: source.r + dr, c: source.c + dc };
  if (blocked(level, source, first.r, first.c) || (first.r === box.r && first.c === box.c && blocked(level, source, first.r, first.c))) {
    return { paths: [], shortest: null, truncated: false, expanded: 0 };
  }
  let shortest = null;
  const queue = [[{ r: source.r, c: source.c }, first]];
  const paths = [];
  let expanded = 0;
  let truncated = false;
  let queueGuard = 0;
  while (queue.length) {
    const path = queue.shift();
    expanded += 1;
    if (expanded > 50000) {
      truncated = true;
      break;
    }
    const head = path.at(-1);
    const belts = path.length - 2;
    if (head.r === box.r && head.c === box.c) {
      if (shortest === null) shortest = belts;
      if (belts <= shortest + extra) paths.push(path);
      if (paths.length >= cap) {
        truncated = true;
        break;
      }
      continue;
    }
    if (shortest !== null && belts > shortest + extra) continue;
    queueGuard += 1;
    if (queueGuard > 20000) {
      truncated = true;
      break;
    }
    const seen = new Set(path.map(cell => `${cell.r},${cell.c}`));
    for (const delta of Object.values(DIRECTIONS)) {
      const next = { r: head.r + delta[0], c: head.c + delta[1] };
      if (seen.has(`${next.r},${next.c}`)) continue;
      if (blocked(level, source, next.r, next.c)) continue;
      queue.push([...path, next]);
    }
  }
  return { paths, shortest, truncated, expanded };
}

export function analyzeLevel(level, options = {}) {
  const extra = options.extra ?? 2;
  const cap = options.cap ?? 250;
  const perLetter = level.sources.map(source => ({ source, ...collectPaths(level, source, { extra, cap }) }));
  let truncated = perLetter.some(item => item.truncated);
  const lists = perLetter.map(item => item.paths);
  let examined = 0;
  let wins = 0;
  let winsWithoutBridge = 0;
  let straightWins = 0;
  let minBridges = Infinity;
  let best = null;
  const consider = pieces => {
    examined += 1;
    if (!pieces) return;
    const result = simulate(level, applyPieces(level, pieces));
    if (result.status !== 'won') return;
    wins += 1;
    const bridges = pieces.filter(piece => piece.p === 'bridge').length;
    const bridge = bridges > 0;
    const straight = pieces.every(piece => piece.p === 'h' || piece.p === 'v');
    if (!bridge) winsWithoutBridge += 1;
    if (straight) straightWins += 1;
    if (bridges < minBridges) minBridges = bridges;
    if (!best || pieces.length < best.pieces.length) best = { pieces, bridge, straight, ticks: result.frames.length - 1 };
  };
  const walk = (index, chosen) => {
    if (index === lists.length) {
      consider(layoutFromPaths(chosen));
      return;
    }
    for (const path of lists[index]) walk(index + 1, [...chosen, path]);
  };
  if (lists.every(list => list.length > 0) && lists.reduce((product, list) => product * list.length, 1) <= (options.maxCombos ?? 200000)) {
    walk(0, []);
  } else if (lists.some(list => list.length === 0)) {
    examined = 0;
  } else {
    truncated = true;
  }
  const shortestPieces = lists.every(list => list.length) ? layoutFromPaths(lists.map(list => list[0])) : null;
  const shortestResult = shortestPieces ? simulate(level, applyPieces(level, shortestPieces)) : null;
  return {
    id: level.id,
    truncated,
    examined,
    wins,
    winsWithoutBridge,
    straightWins,
    minBridges: Number.isFinite(minBridges) ? minBridges : null,
    best,
    shortestBelts: perLetter.map(item => item.shortest),
    pathCounts: perLetter.map(item => item.paths.length),
    shortestStatus: shortestResult?.status ?? 'none',
    shortestError: shortestResult?.error?.type ?? null,
    shortestMessage: shortestResult?.error?.message ?? null,
    shortestPieces,
  };
}

export function piecesToLayout(level, pieces) {
  return applyPieces(level, pieces);
}
