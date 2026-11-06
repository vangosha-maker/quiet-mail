import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_KEY } from '../dist/save.js';

class ClassList {
  constructor() { this.set = new Set(); }
  add(...names) { for (const name of names) if (name) this.set.add(name); }
  remove(...names) { for (const name of names) this.set.delete(name); }
  contains(name) { return this.set.has(name); }
  clear() { this.set.clear(); }
}

class Node {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = {};
    this.listeners = {};
    this.classList = new ClassList();
    this._text = '';
    this._html = '';
    this.style = {};
    this.disabled = false;
    this.tabIndex = 0;
    this.type = '';
    const node = this;
    this.dataset = new Proxy({}, {
      get: (_, prop) => node.getAttribute(`data-${prop}`),
      set: (_, prop, value) => { node.setAttribute(`data-${prop}`, value); return true; },
    });
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(value) {
    this.classList.clear();
    for (const part of String(value).split(/\s+/)) if (part) this.classList.add(part);
  }
  get textContent() {
    if (this.children.length) return this.children.map(child => child.textContent).join('');
    return this._text;
  }
  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }
  get innerHTML() { return this._html; }
  set innerHTML(value) {
    this._html = String(value);
    this.children = [];
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; }
  matches(selector) {
    if (selector.startsWith('#')) return this.getAttribute('id') === selector.slice(1);
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const body = selector.slice(1, -1);
      const eq = body.indexOf('=');
      if (eq === -1) return this.getAttribute(body) !== null;
      const value = body.slice(eq + 1).replace(/^"|"$/g, '');
      return this.getAttribute(body.slice(0, eq)) === value;
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const walk = node => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches?.(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      node.parentElement = this;
      this.children.unshift(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  dispatch(event) {
    for (const fn of [...(this.listeners[event.type] ?? [])]) fn(event);
  }
  bubble(event) {
    let node = this;
    while (node) {
      node.dispatch(event);
      node = node.parentElement;
    }
  }
  click() {
    if (this.disabled) return;
    this.bubble({ type: 'click', target: this, detail: 1, button: 0 });
  }
  focus() { this.owner.active = this; }
}

function memoryStorage(seed = []) {
  const values = new Map(seed);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

test('board, keyboard, drawing, run, errors and level switch work without a browser', async () => {
  const body = new Node('body');
  const listeners = {};
  const storage = memoryStorage([[SAVE_KEY, '{']]);
  const document = {
    body,
    active: body,
    createElement: tag => {
      const node = new Node(tag);
      node.owner = document;
      return node;
    },
    querySelector: selector => body.querySelector(selector),
    querySelectorAll: selector => body.querySelectorAll(selector),
  };
  Object.defineProperty(document, 'activeElement', { get: () => document.active });
  const window = {
    localStorage: storage,
    addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
  };
  const el = (tag, attrs = {}, parent = body) => {
    const node = document.createElement(tag);
    if (attrs.text) node.textContent = attrs.text;
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') continue;
      if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    parent.append(node);
    return node;
  };
  const main = el('main');
  el('p', { id: 'level-tag' }, main);
  el('strong', { id: 'level-name' }, main);
  el('span', { id: 'level-hint' }, main);
  el('div', { id: 'level-options' }, main);
  const status = el('div', { id: 'status' }, main);
  status.setAttribute('aria-live', 'polite');
  el('span', { class: 'status-icon' }, status);
  el('strong', { id: 'status-title' }, status);
  el('p', { id: 'status-text' }, status);
  const board = el('div', { id: 'board' }, main);
  for (const [id, label] of [['run', 'Запустить'], ['step', 'Шаг'], ['undo', 'Отменить'], ['reset', 'Заново']]) {
    const button = el('button', { id }, main);
    el('span', { class: 'ico' }, button);
    el('span', { class: 'lbl', text: label }, button);
  }
  el('p', { id: 'save-status' }, main);
  const legend = el('div', { id: 'legend' }, main);

  globalThis.document = document;
  globalThis.window = window;
  await import('../dist/app.js');

  const cell = (r, c) => board.children.find(node => node.dataset.r === String(r) && node.dataset.c === String(c));
  const press = (key, target = body) => {
    let prevented = false;
    for (const fn of listeners.keydown) {
      fn({
        key,
        target,
        repeat: false,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        preventDefault() { prevented = true; },
      });
    }
    return prevented;
  };

  assert.equal(document.querySelector('#level-tag').textContent, 'Уровень 1');
  assert.equal(board.children.length, 25);
  assert.match(board.style.gridTemplateColumns, /minmax\(44px, 1fr\)/);
  assert.equal(document.querySelector('#status').getAttribute('aria-live'), 'polite');
  assert.match(document.querySelector('.status-icon').innerHTML, /<svg/);
  assert.match(legend.innerHTML, /<circle/);
  assert.match(legend.innerHTML, /<rect/);
  assert.match(legend.innerHTML, /<polygon/);
  assert.match(document.querySelector('#save-status').textContent, /сохранён/);
  assert.equal(JSON.parse(storage.values.get(SAVE_KEY)).version, 1);
  assert.equal(document.querySelectorAll('[data-level]').length, 6);
  assert.equal(document.querySelector('[data-level="1"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('#undo').disabled, true);

  assert.equal(press('ArrowRight'), true);
  assert.equal(cell(0, 1).classList.contains('cursor'), true);
  press(' ');
  assert.equal(cell(0, 1).getAttribute('data-piece'), 'h');
  assert.equal(document.querySelector('#undo').disabled, false);
  press('Enter', document.querySelector('#run'));
  assert.equal(cell(0, 1).getAttribute('data-piece'), 'h');
  document.querySelector('#undo').click();
  assert.equal(cell(0, 1).getAttribute('data-piece'), '');

  const origin = cell(0, 0);
  origin.bubble({ type: 'pointerdown', target: origin, pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  const next = cell(0, 1);
  next.bubble({ type: 'pointermove', target: next, pointerId: 1, button: 0, clientX: 1, clientY: 0 });
  const end = cell(0, 1);
  end.bubble({ type: 'pointerup', target: end, pointerId: 1, button: 0, clientX: 1, clientY: 0 });
  assert.equal(cell(0, 0).getAttribute('data-piece'), 'h');
  assert.equal(cell(0, 1).getAttribute('data-piece'), 'h');
  cell(0, 0).click();
  document.querySelector('#reset').click();
  assert.equal(cell(0, 0).getAttribute('data-piece'), '');

  document.querySelector('#run').click();
  assert.match(document.querySelector('#status-title').textContent, /Тупик/);
  assert.match(document.querySelector('#status-text').textContent, /не может ехать дальше|упёрлось/);
  assert.equal(cell(2, 1).classList.contains('is-error'), true);
  assert.equal(document.querySelector('#step').disabled, true);

  for (const [r, c] of [[2, 1], [2, 2], [2, 3]]) cell(r, c).click();
  document.querySelector('#run').click();
  assert.equal(document.querySelector('#status-title').textContent, 'Почта дошла');
  assert.match(document.querySelector('#status-text').textContent, /Все письма в своих ящиках/);
  assert.equal(document.querySelector('[data-level="1"]').getAttribute('aria-label').includes('пройден'), true);
  assert.match(document.querySelector('[data-level="1"]').innerHTML, /<svg/);

  document.querySelector('#reset').click();
  cell(2, 1).click();
  cell(2, 2).click();
  document.querySelector('#step').click();
  assert.match(document.querySelector('#status-title').textContent, /Доставка/);
  assert.equal(cell(2, 1).getAttribute('aria-label').includes('красное круглое письмо'), true);

  document.querySelector('[data-level="6"]').click();
  assert.equal(document.querySelector('#level-tag').textContent, 'Уровень 6');
  assert.equal(board.children.length, 36);
  assert.equal(board.querySelectorAll('.source').length, 3);
  const shapes = board.children.map(node => node.innerHTML).join('');
  assert.match(shapes, /<circle/);
  assert.match(shapes, /<rect/);
  assert.match(shapes, /<polygon/);

  delete globalThis.document;
  delete globalThis.window;
});
