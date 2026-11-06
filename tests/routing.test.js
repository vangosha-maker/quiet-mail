import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../dist/levels.js';
import { emptyLayout, simulate } from '../dist/engine.js';
import { analyzeLevel } from './route-search.js';

const bounds = {
  1: { extra: 2, cap: 80 },
  2: { extra: 2, cap: 80 },
  3: { extra: 6, cap: 200 },
  4: { extra: 4, cap: 120 },
  5: { extra: 3, cap: 80 },
  6: { extra: 4, cap: 80 },
};

test('short routes have no straight-only or bridge-free bypass where the level forbids one', () => {
  for (const level of LEVELS) {
    const report = analyzeLevel(level, { ...bounds[level.id], maxCombos: 250000 });
    assert.equal(report.truncated, false, `${level.id} search truncated ${report.pathCounts}`);
    assert.ok(report.wins > 0, level.id);
    assert.equal(report.straightWins, 0, level.id);
    if (level.id === '1' || level.id === '2') {
      assert.equal(report.shortestStatus, 'won', level.id);
      assert.equal(report.minBridges, 0, level.id);
    } else {
      assert.equal(report.winsWithoutBridge, 0, level.id);
      assert.equal(report.minBridges, level.id === '6' ? 2 : 1, level.id);
    }
  }
});

test('level 4 head-on along the top row collides', () => {
  const level = LEVELS.find(item => item.id === '4');
  const layout = emptyLayout(level);
  for (const cell of [[1, 1], [1, 2], [1, 3], [1, 4]]) layout[cell[0]][cell[1]] = 'h';
  const result = simulate(level, layout);
  assert.equal(result.status, 'error');
  assert.equal(result.error.type, 'collision');
});
