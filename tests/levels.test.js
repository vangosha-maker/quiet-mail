import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEVELS } from '../dist/levels.js';
import { canPlace, emptyLayout, simulate } from '../dist/engine.js';

const solutions = JSON.parse(await readFile(new URL('./solutions.json', import.meta.url), 'utf8'));

function apply(level, solution) {
  const layout = emptyLayout(level);
  for (const cell of solution) layout[cell.r][cell.c] = cell.p;
  return layout;
}

function lanesThroughBridges(result, pieces) {
  const lanes = new Map();
  for (const piece of pieces) {
    if (piece.p === 'bridge') lanes.set(`${piece.r},${piece.c}`, new Set());
  }
  for (const frame of result.frames) {
    for (const letter of frame.letters) {
      const key = `${letter.r},${letter.c}`;
      if (lanes.has(key) && letter.lane) lanes.get(key).add(letter.lane);
    }
  }
  return lanes;
}

test('campaign has six levels inside the 5×5–6×6 scale', () => {
  assert.equal(LEVELS.length, 6);
  assert.deepEqual(LEVELS.map(level => level.size), [5, 5, 5, 6, 5, 6]);
  assert.deepEqual(LEVELS.map(level => level.sources.length), [1, 2, 2, 2, 2, 3]);
  const colors = LEVELS.map(level => new Set(level.sources.map(source => source.color)).size);
  assert.deepEqual(colors, [1, 2, 2, 2, 2, 3]);
});

for (const level of LEVELS) {
  test(`level ${level.id} ${level.name}: geometry is valid and the reference wins`, () => {
    const seen = new Set();
    for (const cell of [...level.walls, ...level.sources.map(item => [item.r, item.c]), ...level.boxes.map(item => [item.r, item.c])]) {
      const key = `${cell[0]},${cell[1]}`;
      assert.equal(seen.has(key), false, key);
      seen.add(key);
      assert.ok(cell[0] >= 0 && cell[1] >= 0 && cell[0] < level.size && cell[1] < level.size);
    }
    for (const source of level.sources) {
      assert.ok(['N', 'E', 'S', 'W'].includes(source.dir));
      const box = level.boxes.find(item => item.color === source.color && item.shape === source.shape);
      assert.ok(box, source.id);
      assert.notEqual(source.shape, undefined);
    }
    const solution = solutions[level.id];
    assert.ok(Array.isArray(solution) && solution.length > 0);
    for (const cell of solution) {
      assert.equal(canPlace(level, cell.r, cell.c), true, `${cell.r},${cell.c}`);
      assert.ok(['h', 'v', 'ne', 'se', 'sw', 'nw', 'bridge'].includes(cell.p));
    }
    const result = simulate(level, apply(level, solution));
    assert.equal(result.status, 'won', result.error?.message);
    assert.equal(simulate(level, apply(level, solution)).status, 'won');
  });
}

test('intro levels turn, and later references use bridges', () => {
  const corners = new Set(['ne', 'se', 'sw', 'nw']);
  assert.ok(solutions['1'].some(cell => corners.has(cell.p)));
  assert.equal(solutions['1'].some(cell => cell.p === 'bridge'), false);
  assert.equal(solutions['2'].some(cell => cell.p === 'bridge'), false);
  assert.ok(solutions['2'].some(cell => corners.has(cell.p)));
  assert.equal(solutions['3'].filter(cell => cell.p === 'bridge').length, 1);
  assert.equal(solutions['6'].filter(cell => cell.p === 'bridge').length, 2);
});

test('bridge levels actually cross, and a plain belt fails there', () => {
  for (const id of ['3', '4', '5', '6']) {
    const level = LEVELS.find(item => item.id === id);
    const won = simulate(level, apply(level, solutions[id]));
    const lanes = lanesThroughBridges(won, solutions[id]);
    assert.ok(lanes.size > 0, id);
    for (const [cell, used] of lanes) assert.deepEqual([...used].sort(), ['h', 'v'], `${id} ${cell}`);
    const broken = solutions[id].map(cell => cell.p === 'bridge' ? { ...cell, p: 'h' } : cell);
    const failed = simulate(level, apply(level, broken));
    assert.equal(failed.status, 'error');
    assert.notEqual(failed.error.type, 'won');
  }
});
