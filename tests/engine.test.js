import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PIECE_ORDER,
  canPlace,
  createCampaign,
  emptyLayout,
  nextPiece,
  paintStroke,
  pieceExit,
  simulate,
} from '../dist/engine.js';
import { LEVELS } from '../dist/levels.js';

const level = (patch) => ({
  id: 't',
  name: 'Проверка',
  hint: '',
  size: 3,
  walls: [],
  sources: [{ id: 'red', r: 1, c: 0, color: 'red', shape: 'circle', dir: 'E' }],
  boxes: [{ id: 'red', r: 1, c: 2, color: 'red', shape: 'circle' }],
  ...patch,
});

test('straight belt delivers one letter', () => {
  const puzzle = level();
  const layout = emptyLayout(puzzle);
  layout[1][1] = 'h';
  const result = simulate(puzzle, layout);
  assert.equal(result.status, 'won');
  assert.equal(result.error, null);
  assert.deepEqual(
    result.frames.map(frame => [frame.letters[0].c, frame.letters[0].delivered]),
    [[0, false], [1, false], [2, true]],
  );
});

test('corner ne turns a southbound letter east', () => {
  const puzzle = level({
    sources: [{ id: 'red', r: 0, c: 1, color: 'red', shape: 'circle', dir: 'S' }],
    boxes: [{ id: 'red', r: 1, c: 2, color: 'red', shape: 'circle' }],
  });
  const layout = emptyLayout(puzzle);
  layout[1][1] = 'ne';
  const result = simulate(puzzle, layout);
  assert.equal(result.status, 'won');
  assert.equal(result.frames[1].letters[0].dir, 'S');
  assert.equal(result.frames[2].letters[0].delivered, true);
  assert.equal(result.frames[2].letters[0].dir, 'E');
});

test('piece exits are deterministic for every belt', () => {
  assert.equal(pieceExit('h', 'E'), 'E');
  assert.equal(pieceExit('h', 'N'), null);
  assert.equal(pieceExit('v', 'S'), 'S');
  assert.equal(pieceExit('ne', 'S'), 'E');
  assert.equal(pieceExit('ne', 'W'), 'N');
  assert.equal(pieceExit('se', 'N'), 'E');
  assert.equal(pieceExit('sw', 'E'), 'S');
  assert.equal(pieceExit('nw', 'S'), 'W');
  assert.equal(pieceExit('bridge', 'N'), 'N');
  assert.equal(pieceExit('bridge', 'E'), 'E');
  assert.equal(pieceExit(null, 'E'), null);
});

test('empty cell, wall, wrong box, off-board and head-on collision', () => {
  const empty = simulate(level(), emptyLayout(level()));
  assert.equal(empty.status, 'error');
  assert.equal(empty.error.type, 'dead-end');
  assert.match(empty.error.message, /Тупик/);

  const walled = level({ walls: [[1, 1]] });
  const wallResult = simulate(walled, emptyLayout(walled));
  assert.equal(wallResult.error.type, 'dead-end');
  assert.match(wallResult.error.message, /стену/);
  assert.deepEqual([wallResult.error.r, wallResult.error.c], [1, 1]);

  const foreign = level({
    boxes: [{ id: 'blue', r: 1, c: 2, color: 'blue', shape: 'square' }],
  });
  const foreignLayout = emptyLayout(foreign);
  foreignLayout[1][1] = 'h';
  const wrong = simulate(foreign, foreignLayout);
  assert.equal(wrong.error.type, 'wrong-box');
  assert.match(wrong.error.message, /Чужой ящик/);

  const edge = level({
    sources: [{ id: 'red', r: 0, c: 0, color: 'red', shape: 'circle', dir: 'N' }],
  });
  const off = simulate(edge, emptyLayout(edge));
  assert.equal(off.error.type, 'off-board');
  assert.match(off.error.message, /Выход за поле/);

  const crash = level({
    size: 5,
    sources: [
      { id: 'red', r: 2, c: 0, color: 'red', shape: 'circle', dir: 'E' },
      { id: 'blue', r: 2, c: 4, color: 'blue', shape: 'square', dir: 'W' },
    ],
    boxes: [
      { id: 'red', r: 0, c: 0, color: 'red', shape: 'circle' },
      { id: 'blue', r: 0, c: 4, color: 'blue', shape: 'square' },
    ],
  });
  const crashLayout = emptyLayout(crash);
  crashLayout[2][1] = 'h';
  crashLayout[2][2] = 'h';
  crashLayout[2][3] = 'h';
  const hit = simulate(crash, crashLayout);
  assert.equal(hit.error.type, 'collision');
  assert.match(hit.error.message, /Столкновение/);
  assert.deepEqual([hit.error.r, hit.error.c], [2, 2]);
});

test('bridge lets perpendicular letters share a cell', () => {
  const puzzle = level({
    size: 5,
    sources: [
      { id: 'red', r: 2, c: 0, color: 'red', shape: 'circle', dir: 'E' },
      { id: 'blue', r: 0, c: 2, color: 'blue', shape: 'square', dir: 'S' },
    ],
    boxes: [
      { id: 'red', r: 2, c: 4, color: 'red', shape: 'circle' },
      { id: 'blue', r: 4, c: 2, color: 'blue', shape: 'square' },
    ],
  });
  const layout = emptyLayout(puzzle);
  layout[2][1] = 'h';
  layout[2][2] = 'bridge';
  layout[2][3] = 'h';
  layout[1][2] = 'v';
  layout[3][2] = 'v';
  const result = simulate(puzzle, layout);
  assert.equal(result.status, 'won');
  const shared = result.frames.find(frame => frame.letters[0].r === frame.letters[1].r
    && frame.letters[0].c === frame.letters[1].c
    && !frame.letters[0].delivered);
  assert.ok(shared);
  assert.notEqual(shared.letters[0].lane, shared.letters[1].lane);

  layout[2][2] = 'h';
  const blocked = simulate(puzzle, layout);
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.error.type, 'dead-end');
});

test('same input simulates the same trace twice', () => {
  const puzzle = level();
  const layout = emptyLayout(puzzle);
  layout[1][1] = 'h';
  assert.deepEqual(simulate(puzzle, layout), simulate(puzzle, layout));
});

test('a closed-looking belt still finishes instead of hanging', () => {
  const puzzle = level({ size: 4, walls: [] });
  const layout = emptyLayout(puzzle);
  layout[1][1] = 'ne';
  layout[1][2] = 'sw';
  layout[2][2] = 'nw';
  layout[2][1] = 'se';
  const result = simulate(puzzle, layout);
  assert.equal(result.status, 'error');
  assert.ok(result.frames.length < 80);
});

test('click cycle and stroke draw straights, corners and bridges', () => {
  assert.deepEqual(PIECE_ORDER, [null, 'h', 'v', 'ne', 'se', 'sw', 'nw', 'bridge']);
  assert.equal(nextPiece(null), 'h');
  assert.equal(nextPiece('bridge'), null);
  assert.equal(nextPiece('nope'), null);

  const puzzle = LEVELS[0];
  const straight = paintStroke(puzzle, emptyLayout(puzzle), [
    { r: 2, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 },
  ]);
  assert.equal(straight[2][1], 'h');
  assert.equal(straight[2][2], 'h');
  assert.equal(straight[2][3], 'h');

  const bend = paintStroke(puzzle, emptyLayout(puzzle), [
    { r: 0, c: 0 }, { r: 0, c: 1 }, { r: 1, c: 1 },
  ]);
  assert.equal(bend[0][0], 'h');
  assert.equal(bend[0][1], 'sw');
  assert.equal(bend[1][1], 'v');

  const crossed = paintStroke(puzzle, straight, [
    { r: 0, c: 2 }, { r: 1, c: 2 }, { r: 2, c: 2 }, { r: 3, c: 2 },
  ]);
  assert.equal(crossed[2][2], 'bridge');
  assert.equal(crossed[2][1], 'h');
  assert.equal(crossed[1][2], 'v');

  const blocked = paintStroke(puzzle, emptyLayout(puzzle), [
    { r: 2, c: 0 }, { r: 2, c: 1 },
  ]);
  assert.equal(blocked[2][0], null);
  assert.equal(blocked[2][1], null);
  assert.equal(canPlace(puzzle, 2, 0), false);
  assert.equal(canPlace(puzzle, 2, 4), false);
  assert.equal(canPlace(puzzle, 2, 1), true);
});

test('campaign undo, reset, level drafts, step and run', () => {
  const campaign = createCampaign(LEVELS);
  assert.equal(campaign.level.id, '1');
  assert.equal(campaign.cycle(2, 0), false);
  assert.equal(campaign.stroke([{ r: 2, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 }]), true);
  assert.equal(campaign.layout[2][2], 'h');
  campaign.undo();
  assert.equal(campaign.layout[2][2], null);
  assert.equal(campaign.canUndo, false);
  campaign.stroke([{ r: 2, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 }]);
  const first = campaign.step();
  assert.equal(first.status, 'stepping');
  assert.equal(first.letters[0].c, 1);
  campaign.step();
  campaign.step();
  const won = campaign.step();
  assert.equal(won.status, 'won');
  assert.deepEqual(campaign.completed, ['1']);
  campaign.selectLevel('2');
  assert.equal(campaign.level.id, '2');
  assert.equal(campaign.layout[2][1], null);
  campaign.cycle(0, 0);
  campaign.selectLevel('1');
  assert.equal(campaign.layout[2][1], 'h');
  assert.equal(campaign.view().status, 'editing');
  campaign.selectLevel('2');
  assert.equal(campaign.layout[0][0], 'h');
  campaign.reset();
  assert.equal(campaign.layout[0][0], null);
  campaign.selectLevel('1');
  assert.equal(campaign.run().status, 'won');
  campaign.cycle(0, 0);
  assert.equal(campaign.view().status, 'editing');
  assert.deepEqual(campaign.completed, ['1']);
});

test('engine source has no randomness, clock or network', async () => {
  const src = await readFile(new URL('../dist/engine.js', import.meta.url), 'utf8');
  assert.equal(src.includes('Math.random'), false);
  assert.equal(src.includes('Date.now'), false);
  assert.equal(src.includes('fetch('), false);
  assert.equal(src.includes('document'), false);
  assert.equal(src.includes('localStorage'), false);
});
