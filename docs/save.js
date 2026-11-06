import { LEVELS } from './levels.js';
import { PIECES, createCampaign } from './engine.js';

export const SAVE_KEY = 'quiet-mail:save:v1';
export const SAVE_VERSION = 1;
const MAX_CHARS = 100_000;
const MAX_HISTORY = 100;

const pieceOk = piece => piece === null || PIECES.includes(piece);

function layoutOk(layout, level) {
  if (!Array.isArray(layout) || layout.length !== level.size) return false;
  for (const row of layout) {
    if (!Array.isArray(row) || row.length !== level.size) return false;
    for (let c = 0; c < row.length; c += 1) {
      if (!pieceOk(row[c])) return false;
    }
  }
  for (let r = 0; r < level.size; r += 1) {
    for (let c = 0; c < level.size; c += 1) {
      const fixed = level.walls.some(([wr, wc]) => wr === r && wc === c)
        || level.sources.some(item => item.r === r && item.c === c)
        || level.boxes.some(item => item.r === r && item.c === c);
      if (fixed && layout[r][c] !== null) return false;
    }
  }
  return true;
}

function draftOk(draft, level) {
  if (!draft || typeof draft !== 'object' || !layoutOk(draft.layout, level)) return false;
  if (draft.history === undefined) return true;
  if (!Array.isArray(draft.history) || draft.history.length > MAX_HISTORY) return false;
  return draft.history.every(layout => layoutOk(layout, level));
}

export function validSave(data, levels = LEVELS) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (data.version !== SAVE_VERSION) return false;
  if (!levels.some(level => level.id === data.levelId)) return false;
  if (!Array.isArray(data.completed) || data.completed.length > levels.length) return false;
  if (!data.completed.every(id => levels.some(level => level.id === id))) return false;
  if (new Set(data.completed).size !== data.completed.length) return false;
  if (data.drafts === undefined) return true;
  if (!data.drafts || typeof data.drafts !== 'object' || Array.isArray(data.drafts)) return false;
  for (const [id, draft] of Object.entries(data.drafts)) {
    const level = levels.find(item => item.id === id);
    if (!level || !draftOk(draft, level)) return false;
  }
  return true;
}

export function restoreCampaign(storage, levels = LEVELS) {
  const fresh = () => createCampaign(levels);
  try {
    if (!storage || typeof storage.getItem !== 'function') return fresh();
    const raw = storage.getItem(SAVE_KEY);
    if (raw == null) return fresh();
    if (typeof raw !== 'string' || raw.length > MAX_CHARS) return fresh();
    const data = JSON.parse(raw);
    if (!validSave(data, levels)) return fresh();
    const campaign = fresh();
    campaign.load({
      levelId: data.levelId,
      completed: data.completed,
      drafts: data.drafts ?? {},
    });
    return campaign;
  } catch {
    return fresh();
  }
}

function payload(campaign, withHistory) {
  const snap = campaign.snapshot();
  if (!withHistory) {
    for (const draft of Object.values(snap.drafts)) draft.history = [];
  }
  return JSON.stringify({ version: SAVE_VERSION, ...snap });
}

export function saveCampaign(storage, campaign) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    let raw = payload(campaign, true);
    if (raw.length > MAX_CHARS) raw = payload(campaign, false);
    if (raw.length > MAX_CHARS) {
      storage.removeItem?.(SAVE_KEY);
      return false;
    }
    storage.setItem(SAVE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}
