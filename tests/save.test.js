import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { LEVELS } from '../dist/levels.js';
import { createCampaign, emptyLayout } from '../dist/engine.js';
import { SAVE_KEY, restoreCampaign, saveCampaign } from '../dist/save.js';

const solutions = JSON.parse(await readFile(new URL('./solutions.json', import.meta.url), 'utf8'));

function memory(seed) {
  const values = new Map(seed);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    dump: () => values,
  };
}

function place(campaign, id) {
  campaign.selectLevel(id);
  for (const cell of solutions[id]) {
    let guard = 0;
    while (campaign.layout[cell.r][cell.c] !== cell.p) {
      campaign.cycle(cell.r, cell.c);
      guard += 1;
      assert.ok(guard < 10);
    }
  }
}

test('save keeps the level, solved set, draft and undo across reload', () => {
  const store = memory();
  const campaign = createCampaign(LEVELS);
  place(campaign, '1');
  assert.equal(campaign.run().status, 'won');
  campaign.selectLevel('2');
  campaign.cycle(0, 0);
  campaign.cycle(0, 0);
  assert.equal(saveCampaign(store, campaign), true);
  const restored = restoreCampaign(store);
  assert.equal(restored.level.id, '2');
  assert.deepEqual(restored.completed, ['1']);
  assert.equal(restored.layout[0][0], 'v');
  restored.undo();
  assert.equal(restored.layout[0][0], 'h');
  restored.selectLevel('1');
  assert.equal(restored.layout[2][1], 'h');
  assert.equal(restored.layout[2][2], 'h');
  assert.equal(restored.layout[2][3], 'h');
  const again = memory();
  saveCampaign(again, restored);
  const reloaded = restoreCampaign(again);
  assert.equal(reloaded.level.id, '1');
  assert.equal(reloaded.layout[2][2], 'h');
  reloaded.undo();
  assert.equal(reloaded.layout[2][3], null);
  assert.equal(reloaded.layout[2][2], 'h');
});

test('broken, incompatible and oversized saves reset to the start', () => {
  const blanks = emptyLayout(LEVELS[0]);
  const bad = [
    null,
    '{',
    'null',
    '[]',
    '"quiet"',
    JSON.stringify({ version: 2, levelId: '1', completed: [], drafts: {} }),
    JSON.stringify({ version: 1, levelId: '9', completed: [], drafts: {} }),
    JSON.stringify({ version: 1, levelId: '1', completed: '1', drafts: {} }),
    JSON.stringify({ version: 1, levelId: '1', completed: ['1', '1'], drafts: {} }),
    JSON.stringify({ version: 1, levelId: '1', completed: ['nope'], drafts: {} }),
    JSON.stringify({ version: 1, levelId: '1', completed: [], drafts: [] }),
    JSON.stringify({ version: 1, levelId: '1', completed: [], drafts: { 9: { layout: blanks } } }),
    JSON.stringify({ version: 1, levelId: '1', completed: [], drafts: { 1: { layout: [['h']] } } }),
    JSON.stringify({
      version: 1,
      levelId: '1',
      completed: [],
      drafts: { 1: { layout: blanks.map((row, r) => row.map((cell, c) => (r === 2 && c === 0 ? 'h' : cell))) } },
    }),
    JSON.stringify({
      version: 1,
      levelId: '1',
      completed: [],
      drafts: { 1: { layout: blanks, history: [[['switch']]] } },
    }),
    JSON.stringify({
      version: 1,
      levelId: '1',
      completed: [],
      drafts: { 1: { layout: blanks, history: Array.from({ length: 101 }, () => blanks) } },
    }),
    ' '.repeat(100_001),
  ];
  for (const raw of bad) {
    const store = memory(raw == null ? [] : [[SAVE_KEY, raw]]);
    const campaign = restoreCampaign(store);
    assert.equal(campaign.level.id, '1');
    assert.deepEqual(campaign.completed, []);
    assert.deepEqual(campaign.layout, emptyLayout(LEVELS[0]));
    assert.equal(campaign.canUndo, false);
  }
});

test('missing, denied and full storage still lets the puzzle run', () => {
  const denied = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('denied'); },
  };
  for (const store of [undefined, null, denied]) {
    const campaign = restoreCampaign(store);
    assert.equal(campaign.cycle(0, 0), true);
    assert.equal(campaign.layout[0][0], 'h');
    assert.equal(saveCampaign(store, campaign), false);
    assert.equal(campaign.layout[0][0], 'h');
  }
  const quota = memory();
  quota.setItem = () => { throw new Error('quota'); };
  const campaign = createCampaign(LEVELS);
  campaign.cycle(0, 0);
  assert.equal(saveCampaign(quota, campaign), false);
  assert.equal(campaign.view().status, 'editing');
});

test('fresh storage starts at level 1 without throwing', () => {
  const campaign = restoreCampaign(memory());
  assert.equal(campaign.level.id, '1');
  assert.equal(saveCampaign(memory(), campaign), true);
});
