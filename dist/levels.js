// Шесть уровней. Масштаб прежний: 5×5 и 6×6.
// Сложность не в длине ленты, а в конфликте маршрутов: стена, чужой ящик, встречный ход, мост.

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
    name: 'Поворот у стены',
    hint: 'Прямая по ряду упирается в стену.',
    size: 5,
    sources: [red('red', 2, 0, 'E')],
    boxes: [box('red', 4, 4, 'red', 'circle')],
    walls: [[2, 3], [2, 4]],
  }),
  define({
    id: '2',
    name: 'Два адреса',
    hint: 'Каждое письмо сворачивает к своему ящику. Середина поля закрыта.',
    size: 5,
    sources: [red('red', 0, 0, 'E'), blue('blue', 3, 0, 'E')],
    boxes: [box('red', 1, 4, 'red', 'circle'), box('blue', 4, 4, 'blue', 'square')],
    walls: [[0, 3], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4]],
  }),
  define({
    id: '3',
    name: 'Перекрёсток',
    hint: 'Короткие пути красного и синего пересекаются.',
    size: 5,
    sources: [red('red', 2, 0, 'E'), blue('blue', 0, 2, 'S')],
    boxes: [box('red', 1, 4, 'red', 'circle'), box('blue', 4, 2, 'blue', 'square')],
    walls: [[0, 0], [0, 4], [4, 0], [4, 4], [3, 0], [1, 0]],
  }),
  define({
    id: '4',
    name: 'Встречная',
    hint: 'По верхнему ряду письма едут друг на друга.',
    size: 6,
    sources: [red('red', 1, 0, 'E'), blue('blue', 1, 5, 'W')],
    boxes: [box('red', 4, 4, 'red', 'circle'), box('blue', 4, 1, 'blue', 'square')],
    walls: keepWalls(6, [
      [1, 0], [1, 5], [4, 4], [4, 1],
      [1, 1], [1, 2], [1, 3], [1, 4],
      [2, 2], [3, 2], [2, 3], [3, 3],
      [4, 2], [4, 3],
      [0, 2], [2, 1], [3, 1], [3, 4], [2, 4],
    ]),
  }),
  define({
    id: '5',
    name: 'Чужой ящик',
    hint: 'Клетка справа от красного источника — чужой ящик.',
    size: 5,
    sources: [red('red', 4, 1, 'N'), blue('blue', 0, 2, 'S')],
    boxes: [box('red', 0, 4, 'red', 'circle'), box('blue', 4, 2, 'blue', 'square')],
    walls: keepWalls(5, [
      [4, 1], [0, 4], [0, 2], [4, 2],
      [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [1, 4],
      [2, 2], [3, 2],
      [2, 3], [2, 4], [3, 4],
      [3, 3],
    ]),
  }),
  define({
    id: '6',
    name: 'Два моста',
    hint: 'Синий столбец пересекает две чужие ленты.',
    size: 6,
    sources: [red('red', 1, 0, 'E'), blue('blue', 0, 2, 'S'), green('green', 5, 0, 'N')],
    boxes: [
      box('red', 1, 5, 'red', 'circle'),
      box('blue', 5, 2, 'blue', 'square'),
      box('green', 2, 5, 'green', 'triangle'),
    ],
    walls: keepWalls(6, [
      [1, 0], [0, 2], [5, 0], [1, 5], [5, 2], [2, 5],
      [1, 1], [1, 2], [1, 3], [1, 4],
      [2, 2], [3, 2], [4, 2],
      [4, 0], [3, 0], [2, 0], [2, 1], [2, 3], [2, 4],
      [3, 1], [3, 3],
    ]),
  }),
]);
