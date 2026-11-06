// Шесть уровней по нарастающей: прямые, повороты, цвета, стены, мост, три письма.

function keepWalls(size, cells) {
  const open = new Set(cells.map(([r, c]) => `${r},${c}`));
  const walls = [];
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!open.has(`${r},${c}`)) walls.push([r, c]);
    }
  }
  return walls;
}

function define(level) {
  return Object.freeze({
    ...level,
    walls: Object.freeze(level.walls.map(cell => Object.freeze([...cell]))),
    sources: Object.freeze(level.sources.map(item => Object.freeze({ ...item }))),
    boxes: Object.freeze(level.boxes.map(item => Object.freeze({ ...item }))),
  });
}

const red = (id, r, c, dir) => ({ id, r, c, dir, color: 'red', shape: 'circle' });
const blue = (id, r, c, dir) => ({ id, r, c, dir, color: 'blue', shape: 'square' });
const green = (id, r, c, dir) => ({ id, r, c, dir, color: 'green', shape: 'triangle' });
const box = (id, r, c, color, shape) => ({ id, r, c, color, shape });

export const LEVELS = Object.freeze([
  define({
    id: '1',
    name: 'Прямая лента',
    hint: 'Одна линия от письма до ящика.',
    size: 5,
    sources: [red('red', 2, 0, 'E')],
    boxes: [box('red', 2, 4, 'red', 'circle')],
    walls: [],
  }),
  define({
    id: '2',
    name: 'Один поворот',
    hint: 'Лента умеет сворачивать.',
    size: 5,
    sources: [red('red', 0, 1, 'S')],
    boxes: [box('red', 3, 4, 'red', 'circle')],
    walls: [[0, 4], [1, 4], [4, 0]],
  }),
  define({
    id: '3',
    name: 'Два цвета',
    hint: 'У каждого письма свой ящик.',
    size: 5,
    sources: [red('red', 0, 0, 'E'), blue('blue', 3, 0, 'E')],
    boxes: [box('red', 0, 4, 'red', 'circle'), box('blue', 4, 4, 'blue', 'square')],
    walls: [[1, 2], [2, 2]],
  }),
  define({
    id: '4',
    name: 'Обход',
    hint: 'Стена закрывает прямой путь.',
    size: 6,
    sources: [red('red', 1, 0, 'E'), blue('blue', 5, 0, 'E')],
    boxes: [box('red', 1, 5, 'red', 'circle'), box('blue', 5, 5, 'blue', 'square')],
    walls: [[1, 2], [1, 3]],
  }),
  define({
    id: '5',
    name: 'Развязка',
    hint: 'Две ленты пересекаются мостом и не мешают друг другу.',
    size: 5,
    sources: [red('red', 2, 0, 'E'), blue('blue', 0, 2, 'S')],
    boxes: [box('red', 2, 4, 'red', 'circle'), box('blue', 4, 2, 'blue', 'square')],
    walls: keepWalls(5, [
      [2, 0], [2, 4], [0, 2], [4, 2],
      [2, 1], [2, 2], [2, 3], [1, 2], [3, 2],
    ]),
  }),
  define({
    id: '6',
    name: 'Три адреса',
    hint: 'Три письма: поворот, прямые и один мост.',
    size: 6,
    sources: [green('green', 5, 0, 'N'), red('red', 2, 1, 'E'), blue('blue', 0, 3, 'S')],
    boxes: [
      box('green', 1, 1, 'green', 'triangle'),
      box('red', 2, 5, 'red', 'circle'),
      box('blue', 5, 3, 'blue', 'square'),
    ],
    walls: keepWalls(6, [
      [5, 0], [1, 1], [2, 1], [2, 5], [0, 3], [5, 3],
      [4, 0], [3, 0], [2, 0], [1, 0],
      [2, 2], [2, 3], [2, 4],
      [1, 3], [3, 3], [4, 3],
    ]),
  }),
]);
