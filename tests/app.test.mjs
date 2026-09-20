import test from 'node:test';
import assert from 'node:assert/strict';
import { answerVariants, createWheelSwipe, filterSets, gradeAnswer, mergeSets, mergeTombstones, maskHint, moveItem, nextCardState, parseImportedCards, pickOptions, pluralCards, progressSummary, shuffle, sortSets } from '../logic.js';

test('card import accepts Quizlet-style tab rows and ignores incomplete rows', () => {
  const cards = parseImportedCards('hello\tпривет\r\nworld\tмир\nonly term\n;missing term');
  assert.deepEqual(cards, [{ term: 'hello', definition: 'привет' }, { term: 'world', definition: 'мир' }]);
});

test('shuffle returns every original card without changing its input', () => {
  const cards = [{ term: 'one' }, { term: 'two' }, { term: 'three' }];
  const result = shuffle(cards);
  assert.notEqual(result, cards);
  assert.deepEqual(cards, [{ term: 'one' }, { term: 'two' }, { term: 'three' }]);
  assert.deepEqual([...result].sort((a, b) => a.term.localeCompare(b.term)), [...cards].sort((a, b) => a.term.localeCompare(b.term)));
});

test('one trackpad swipe with long momentum advances exactly one card', () => {
  const swipe = createWheelSwipe();
  const results = [];
  let time = 0;
  for (let i = 0; i < 150; i += 1) { time += 16; results.push(swipe({ deltaX: 30 * Math.exp(-i / 40) + 1, deltaY: 0, time })); }
  assert.equal(results.filter(Boolean).length, 1);
  time += 400;
  assert.equal(swipe({ deltaX: 60, deltaY: 0, time }), -1);
  assert.equal(swipe({ deltaX: 0, deltaY: 60, time: time + 500 }), 0);
});

test('moveItem reorders without mutating the original list', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 2), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveItem(list, 3, 1), ['a', 'd', 'b', 'c']);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

test('pluralCards follows Russian plural rules', () => {
  assert.deepEqual([1, 2, 5, 11, 12, 21, 22, 25, 111, 104].map(pluralCards),
    ['карточка', 'карточки', 'карточек', 'карточек', 'карточек', 'карточка', 'карточки', 'карточек', 'карточек', 'карточки']);
});

test('progressSummary counts each progression separately', () => {
  const cards = [{ learn: 'known', sort: 'learning' }, { learn: 'learning' }, { learn: 'known', sort: 'known' }, {}, { learn: 'nonsense' }];
  assert.deepEqual(progressSummary(cards), { new: 2, learning: 1, known: 2, total: 5 });
  assert.deepEqual(progressSummary(cards, 'sort'), { new: 3, learning: 1, known: 1, total: 5 });
});

test('maskHint reveals letters one by one and keeps spaces and punctuation', () => {
  assert.equal(maskHint('макароны', 0), '••••••••');
  assert.equal(maskHint('макароны', 2), 'ма••••••');
  assert.equal(maskHint('ещё раз', 1), 'е•• •••');
  assert.equal(maskHint('немного/чуть-чуть', 0), '•••••••/••••-••••');
});

test('gradeAnswer is strict about capitals and articles, forgiving about typos and dots', () => {
  assert.equal(gradeAnswer('der Koffer', 'der Koffer'), 'correct');
  assert.equal(gradeAnswer('  der Koffer.  ', 'der Koffer'), 'correct');
  assert.equal(gradeAnswer('Koffer', 'der Koffer'), 'wrong');
  assert.equal(gradeAnswer('der koffer', 'der Koffer'), 'almost');
  assert.equal(gradeAnswer('der Koffor', 'der Koffer'), 'almost');
  assert.equal(gradeAnswer('der Kofer', 'der Koffer'), 'almost');
  assert.equal(gradeAnswer('die Nudel', 'die Nudeln'), 'almost');
  assert.equal(gradeAnswer('макарон', 'макароны'), 'almost');
  assert.equal(gradeAnswer('', 'дом'), 'wrong');
  assert.equal(gradeAnswer('дым', 'дом'), 'wrong');
});

test('nextCardState walks a card up on correct answers and demotes on misses', () => {
  assert.equal(nextCardState('new', 'correct'), 'learning');
  assert.equal(nextCardState('learning', 'correct'), 'known');
  assert.equal(nextCardState('known', 'correct'), 'known');
  assert.equal(nextCardState('known', 'wrong'), 'learning');
  assert.equal(nextCardState('learning', 'wrong'), 'learning');
  assert.equal(nextCardState('new', 'wrong'), 'new');
  for (const state of ['new', 'learning', 'known']) assert.equal(nextCardState(state, 'almost'), state);
});

test('pickOptions always includes the right answer and never repeats one', () => {
  const answers = ['макароны', 'чемодан', 'ещё раз', 'немного', 'дом', 'макароны'];
  for (let run = 0; run < 30; run += 1) {
    const options = pickOptions(answers, 'чемодан');
    assert.equal(options.length, 4);
    assert.equal(new Set(options).size, 4);
    assert.ok(options.includes('чемодан'));
  }
  assert.deepEqual(pickOptions(['один', 'два'], 'один').sort(), ['два', 'один']);
  assert.deepEqual(pickOptions(['один'], 'один'), ['один']);
});

test('answerVariants splits a definition into every accepted answer', () => {
  assert.deepEqual(answerVariants('автобан, скоростная трасса'), ['автобан, скоростная трасса', 'автобан', 'скоростная трасса']);
  assert.deepEqual(answerVariants('немного/чуть-чуть'), ['немного/чуть-чуть', 'немного', 'чуть-чуть']);
  assert.deepEqual(answerVariants('дом'), ['дом']);
});

test('gradeAnswer accepts any one of several comma-separated answers', () => {
  const expected = 'автобан, скоростная трасса';
  assert.equal(gradeAnswer('автобан', expected), 'correct');
  assert.equal(gradeAnswer('скоростная трасса', expected), 'correct');
  assert.equal(gradeAnswer('автобан, скоростная трасса', expected), 'correct');
  assert.equal(gradeAnswer('автобон', expected), 'almost');
  assert.equal(gradeAnswer('шоссе', expected), 'wrong');
  assert.equal(gradeAnswer('чуть-чуть', 'немного/чуть-чуть'), 'correct');
  assert.equal(gradeAnswer('koffer', 'der Koffer, чемодан'), 'wrong');
  assert.equal(gradeAnswer('чемодан', 'der Koffer, чемодан'), 'correct');
});

test('filterSets matches titles case-insensitively', () => {
  const sets = [{ title: 'Английский B1' }, { title: 'немецкий' }, { title: 'Deutsch A2' }];
  assert.deepEqual(filterSets(sets, 'ий').map((s) => s.title), ['Английский B1', 'немецкий']);
  assert.deepEqual(filterSets(sets, 'DEUT').map((s) => s.title), ['Deutsch A2']);
  assert.deepEqual(filterSets(sets, '  ').map((s) => s.title), ['Английский B1', 'немецкий', 'Deutsch A2']);
  assert.deepEqual(filterSets(sets, 'zzz'), []);
});

test('sortSets orders by title or by date, newest first, without mutating', () => {
  const sets = [
    { title: 'Немецкий', createdAt: 3, updatedAt: 10, openedAt: 1 },
    { title: 'английский', createdAt: 1, updatedAt: 30, openedAt: undefined },
    { title: 'Español', createdAt: 2, updatedAt: 20, openedAt: 5 },
  ];
  const titles = (mode) => sortSets(sets, mode).map((s) => s.title);
  assert.deepEqual(titles('none'), ['Немецкий', 'английский', 'Español']);
  assert.deepEqual(titles('title'), ['английский', 'Немецкий', 'Español']); // в русской локали кириллица идёт перед латиницей
  assert.deepEqual(titles('created'), ['Немецкий', 'Español', 'английский']);
  assert.deepEqual(titles('updated'), ['английский', 'Español', 'Немецкий']);
  assert.deepEqual(titles('opened'), ['Español', 'Немецкий', 'английский']);
  assert.equal(sets[0].title, 'Немецкий');
});

test('mergeSets keeps the newer version of every set', () => {
  const local = [{ id: 'a', title: 'дома', updatedAt: 20, createdAt: 1 }, { id: 'b', title: 'только тут', updatedAt: 5, createdAt: 2 }];
  const remote = [{ id: 'a', title: 'в облаке', updatedAt: 30, createdAt: 1 }, { id: 'c', title: 'только там', updatedAt: 7, createdAt: 3 }];
  const merged = mergeSets(local, remote);
  assert.deepEqual(merged.map((s) => s.title), ['только там', 'только тут', 'в облаке']);
});

test('mergeSets respects deletions, but a newer edit wins over an older deletion', () => {
  const local = [{ id: 'a', updatedAt: 10, createdAt: 1 }, { id: 'b', updatedAt: 50, createdAt: 2 }];
  const remote = [{ id: 'a', updatedAt: 10, createdAt: 1 }, { id: 'b', updatedAt: 50, createdAt: 2 }];
  const merged = mergeSets(local, remote, { a: 20, b: 40 });
  assert.deepEqual(merged.map((s) => s.id), ['b']);
});

test('mergeTombstones keeps the latest deletion time for every set', () => {
  assert.deepEqual(mergeTombstones({ a: 5, b: 9 }, { a: 11, c: 3 }), { a: 11, b: 9, c: 3 });
  const local = { a: 1 };
  mergeTombstones(local, { b: 2 });
  assert.deepEqual(local, { a: 1 });
});
