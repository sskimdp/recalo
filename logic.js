export const blankCard = () => ({ term: '', definition: '' });

export function parseImportedCards(source) {
  return source.split(/\r?\n/).map((row) => row.trim()).filter(Boolean).map((row) => {
    const [term, ...rest] = row.split(/\t|;/);
    return { term: term?.trim(), definition: rest.join(' ').trim() };
  }).filter((card) => card.term && card.definition);
}

export function shuffle(cards) {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

// Trackpad swipes arrive as a stream of wheel events followed by momentum events.
// One continuous stream (no pause longer than quietMs) may trigger at most one swipe.
export function createWheelSwipe({ threshold = 50, quietMs = 180 } = {}) {
  let distance = 0;
  let locked = false;
  let lastTime = -Infinity;
  return ({ deltaX, deltaY, time }) => {
    if (time - lastTime > quietMs) { locked = false; distance = 0; }
    lastTime = time;
    if (locked || Math.abs(deltaX) <= Math.abs(deltaY)) return 0;
    distance += deltaX;
    if (Math.abs(distance) < threshold) return 0;
    locked = true;
    const direction = -Math.sign(distance);
    distance = 0;
    return direction;
  };
}

export function moveItem(list, from, to) {
  const result = [...list];
  const [item] = result.splice(from, 1);
  result.splice(to, 0, item);
  return result;
}

export function pluralCards(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'карточка';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'карточки';
  return 'карточек';
}

export const CARD_STATES = ['new', 'learning', 'known'];

// Two independent progressions live on a card: `learn` (Заучивание) and `sort` (стопки в карточках).
export function progressSummary(cards = [], key = 'learn') {
  const summary = { new: 0, learning: 0, known: 0, total: cards.length };
  for (const card of cards) summary[CARD_STATES.includes(card[key]) ? card[key] : 'new'] += 1;
  return summary;
}

// A hint reveals the answer letter by letter; spaces and punctuation stay visible.
export function maskHint(text = '', revealed = 0) {
  return [...String(text)].map((char, index) => (index < revealed || !/\p{L}|\p{N}/u.test(char) ? char : '•')).join('');
}

const levenshtein = (a, b) => {
  let previous = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length];
};

// A definition may list several accepted answers: "автобан, скоростная трасса" or
// "немного/чуть-чуть". Any single one of them counts, as does the whole line.
export function answerVariants(expected = '') {
  const whole = String(expected).trim();
  const parts = whole.split(/[,;/]|\bили\b/).map((part) => part.trim()).filter(Boolean);
  return [...new Set([whole, ...parts])].filter(Boolean);
}

// Strict grading: capitals and articles matter (German nouns), but a trailing period
// and surrounding whitespace do not, and a single typo counts as "almost right".
export function gradeAnswer(answer, expected) {
  const clean = (text = '') => String(text).trim().replace(/\s+/g, ' ').replace(/[.…]+$/, '').trim();
  const given = clean(answer);
  if (!given) return 'wrong';
  let best = 'wrong';
  for (const variant of answerVariants(expected)) {
    const target = clean(variant);
    if (!target) continue;
    if (given === target) return 'correct';
    if (target.length >= 4 && levenshtein(given, target) === 1) best = 'almost';
  }
  return best;
}

// Learn mode: a correct answer moves a card one step up, a miss drops a mastered card
// back to "learning". "almost" (a single typo) keeps the level, so mastering a card
// always requires typing it exactly.
export function nextCardState(state, verdict) {
  if (verdict === 'correct') return state === 'new' ? 'learning' : 'known';
  if (verdict === 'wrong') return state === 'known' ? 'learning' : state;
  return state;
}

export function pickOptions(answers, correct, count = 4, random = Math.random) {
  const others = [...new Set(answers)].filter((answer) => answer !== correct);
  for (let i = others.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [others[i], others[j]] = [others[j], others[i]];
  }
  const options = [correct, ...others.slice(0, Math.max(0, count - 1))];
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

export const SORT_MODES = {
  none: 'Не выбрано',
  title: 'По названию',
  created: 'По дате добавления',
  opened: 'По дате открытия',
  updated: 'По дате изменения',
};

export function filterSets(sets = [], query = '') {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...sets];
  return sets.filter((set) => String(set.title).toLowerCase().includes(needle));
}

// Newest first for the date orders; sets never opened or never edited sink to the bottom.
export function sortSets(sets = [], mode = 'none') {
  const list = [...sets];
  if (mode === 'title') return list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ru', { sensitivity: 'base' }));
  const field = { created: 'createdAt', opened: 'openedAt', updated: 'updatedAt' }[mode];
  if (!field) return list;
  return list.sort((a, b) => (b[field] ?? 0) - (a[field] ?? 0));
}

// ---------- Синхронизация ----------
// Два устройства правят одни и те же наборы офлайн. Побеждает более поздняя версия
// набора, а удаление живёт отдельным «надгробием», иначе удалённый набор вернулся бы
// со второго устройства. Любое изменение, включая прогресс, поднимает updatedAt.
export function mergeSets(local = [], remote = [], deleted = {}) {
  const byId = new Map();
  for (const set of [...local, ...remote]) {
    if (!set?.id) continue;
    const existing = byId.get(set.id);
    if (!existing || (set.updatedAt ?? 0) > (existing.updatedAt ?? 0)) byId.set(set.id, set);
  }
  for (const [id, removedAt] of Object.entries(deleted)) {
    const set = byId.get(id);
    if (set && (set.updatedAt ?? 0) <= removedAt) byId.delete(id);
  }
  return [...byId.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export function mergeTombstones(local = {}, remote = {}) {
  const merged = { ...local };
  for (const [id, at] of Object.entries(remote)) merged[id] = Math.max(merged[id] ?? 0, at);
  return merged;
}
