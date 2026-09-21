import { SORT_MODES, blankCard, createWheelSwipe, filterSets, gradeAnswer, maskHint, mergeSets, mergeTombstones, moveItem, nextCardState, parseImportedCards, pickOptions, pluralCards, progressSummary, shuffle, sortSets } from './logic.js';
import { isConfigured, onSyncState, pushSets, signIn, signInWithGoogle, signOutUser, startSync, syncState } from './sync.js';

const STORAGE = 'recalo-sets-v1';
const SETTINGS = 'recalo-settings-v1';
const DELETED = 'recalo-deleted-v1';

// Приложение раньше называлось Cardflow: переносим данные на новые ключи один раз.
for (const [from, to] of [['cardflow-sets-v1', STORAGE], ['cardflow-settings-v1', SETTINGS], ['cardflow-deleted-v1', DELETED]]) {
  try {
    const legacy = localStorage.getItem(from);
    if (legacy !== null && localStorage.getItem(to) === null) localStorage.setItem(to, legacy);
  } catch { /* хранилище недоступно */ }
}
const app = document.querySelector('#app');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let sets = loadSets();
let screen = { page: 'sets' };
let editor = null;
let study = null;
let learn = null;
let toastTimer;
let query = '';

function cardState(value) {
  return ['new', 'learning', 'known'].includes(value) ? value : 'new';
}
function normalizeCard(card) {
  return {
    id: card.id ?? crypto.randomUUID(),
    term: card.term ?? '',
    definition: card.definition ?? '',
    learn: cardState(card.learn ?? card.state), // Заучивание
    sort: cardState(card.sort), // стопки режима карточек
  };
}
function loadSets() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (!Array.isArray(saved)) return [];
    // Older sets have no card ids; progress is stored per card, so every card needs one.
    return saved.map((set) => ({
      ...set,
      createdAt: set.createdAt ?? Date.now(),
      updatedAt: set.updatedAt ?? set.createdAt ?? Date.now(),
      openedAt: set.openedAt ?? null,
      cards: (set.cards ?? []).map(normalizeCard),
    }));
  } catch {
    return [];
  }
}
let lastSaved = null;
let deletedSets = loadDeleted();
function loadDeleted() {
  try { return JSON.parse(localStorage.getItem(DELETED) || '{}') ?? {}; } catch { return {}; }
}
function save() {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(sets));
    localStorage.setItem(DELETED, JSON.stringify(deletedSets));
    lastSaved = localStorage.getItem(STORAGE);
    pushSets(sets, deletedSets);
    return true;
  } catch {
    showToast('Не удалось сохранить: в браузере нет места или запись запрещена');
    return false;
  }
}
function applyRemote({ sets: remoteSets, deleted: remoteDeleted }) {
  const normalized = remoteSets.map((set) => ({ ...set, cards: (set.cards ?? []).map(normalizeCard) }));
  deletedSets = mergeTombstones(deletedSets, remoteDeleted);
  const merged = mergeSets(sets, normalized, deletedSets);
  const changed = JSON.stringify(merged) !== JSON.stringify(sets);
  sets = merged;
  try {
    localStorage.setItem(STORAGE, JSON.stringify(sets));
    localStorage.setItem(DELETED, JSON.stringify(deletedSets));
    lastSaved = localStorage.getItem(STORAGE);
  } catch { /* место кончилось, покажем при следующем сохранении */ }
  if (!changed) return;
  if (editor || screen.page === 'study' || screen.page === 'learn') return;
  render();
}

if (isConfigured()) {
  startSync({ onRemote: applyRemote });
  onSyncState((state) => { if (screen.page === 'sync') render(); });
}

// The same app may be open in another tab or window; whoever saves last would otherwise
// overwrite the other's sets. Reload whenever storage changes elsewhere.
window.addEventListener('storage', (event) => {
  if (event.key && event.key !== STORAGE && event.key !== SETTINGS) return;
  if (event.key === SETTINGS) { settings = loadSettings(); return; }
  if (localStorage.getItem(STORAGE) === lastSaved) return;
  sets = loadSets();
  if (editor) return showToast('Наборы изменились в другой вкладке. Ваши правки здесь ещё не сохранены');
  if (screen.page === 'study' || screen.page === 'learn') return;
  render();
  showToast('Наборы обновились: их изменили в другой вкладке');
});

let settings = loadSettings();
function loadSettings() {
  const defaults = { tracking: true, shuffle: true, front: 'term', sort: 'none' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS) || '{}') }; } catch { return defaults; }
}
function saveSettings() {
  try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { /* storage full or blocked */ }
}

const escape = (text = '') => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const getSet = (id) => sets.find((set) => set.id === id);
const countLabel = (count) => `${count} ${pluralCards(count)}`;
const setSummary = (set, key = 'learn') => progressSummary(set.cards, key);
const setSubtitle = (set) => {
  const { known, learning, total } = setSummary(set);
  if (!known && !learning) return countLabel(total);
  return `${known} из ${total} выучено`;
};
const sortSubtitle = (set) => {
  const { known, learning, total } = setSummary(set, 'sort');
  if (!known && !learning) return 'Ни одной карточки не разобрано';
  return `${known} из ${total} в стопке «Знаю»`;
};
const progressBars = (set, key = 'learn', title = '') => {
  const { known, learning, total } = setSummary(set, key);
  if (!total) return '';
  const words = key === 'learn' ? ['выучено', 'ещё учу', 'не изучено'] : ['знаю', 'ещё учу', 'не разобрано'];
  const percent = (part) => `${(part / total) * 100}%`;
  return `<div class="progress-groups ${key}">
    ${title ? `<h3 class="progress-title">${title}</h3>` : ''}
    <div class="progress-track" role="img" aria-label="${words[0]} ${known}, ${words[1]} ${learning}, ${words[2]} ${total - known - learning}"><i class="known" style="width: ${percent(known)}"></i><i class="learning" style="width: ${percent(learning)}"></i></div>
    <div class="progress-legend"><span class="known">${known} ${words[0]}</span><span class="learning">${learning} ${words[1]}</span><span class="new">${total - known - learning} ${words[2]}</span></div>
  </div>`;
};

const icons = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  grip: '<path d="M5 9.5h14M5 14.5h14"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  sets: '<rect x="3.5" y="8" width="17" height="12" rx="2.5"/><path d="M6.5 5h11"/>',
  modes: '<rect x="3.5" y="6.5" width="12.5" height="14" rx="2.5"/><path d="M8 3.5h10a2.5 2.5 0 0 1 2.5 2.5v10"/>',
  swap: '<path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5"/>',
  import: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  options: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  sort: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  bulb: '<path d="M9 17.5h6M10 20.5h4M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.5.4.8 1 .8 1.6h5c0-.6.3-1.2.8-1.6A5.5 5.5 0 0 0 12 3.5z"/>',
  export: '<path d="M12 20V9M7.5 13.5L12 9l4.5 4.5M5 4.5h14"/>',
  undo: '<path d="M9 6.5L4.5 11 9 15.5M4.5 11h9a6 6 0 0 1 0 12h-3"/>',
  reset: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4 4.5V10h5.5"/>',
  learn: '<path d="M12 4.5L21 9l-9 4.5L3 9z"/><path d="M6.5 11v5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5v-5"/>',
  cloud: '<path d="M7.5 18.5a4 4 0 0 1-.3-8A5.5 5.5 0 0 1 18 10.4a4 4 0 0 1-.5 8z"/>',
  google: '<path d="M21 12.2c0-.7-.06-1.36-.18-2H12v3.8h5.05a4.3 4.3 0 0 1-1.87 2.82v2.35h3.02C19.96 17.5 21 15.1 21 12.2z" fill="currentColor" stroke="none"/><path d="M12 21.5c2.52 0 4.63-.83 6.2-2.26l-3.02-2.35c-.84.56-1.9.9-3.18.9-2.44 0-4.5-1.65-5.24-3.87H3.63v2.42A9.36 9.36 0 0 0 12 21.5z" fill="currentColor" stroke="none"/><path d="M6.76 13.92a5.6 5.6 0 0 1 0-3.58V7.92H3.63a9.36 9.36 0 0 0 0 8.42l3.13-2.42z" fill="currentColor" stroke="none"/><path d="M12 6.47c1.38 0 2.61.47 3.58 1.4l2.68-2.68C16.63 3.7 14.52 2.8 12 2.8a9.36 9.36 0 0 0-8.37 5.12l3.13 2.42C7.5 8.12 9.56 6.47 12 6.47z" fill="currentColor" stroke="none"/>',
  person: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.6-5.5 7-5.5s6.3 1.9 7 5.5"/>',
  streak: '<path d="M13 3l-6.5 9H11l-1 9 7-9.5h-4.5z"/>',
};
const svg = (name, className = '') => `<svg class="icon ${className}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;

const bar = (left = '', right = '', center = '') => `<header class="bar"><div class="bar-side">${left}</div><div class="bar-center">${center}</div><div class="bar-side end">${right}</div></header>`;
const backButton = (action, label) => `<button class="bar-button" data-action="${action}">${svg('back')}${label}</button>`;
const tabBar = () => `<nav class="tab-bar" aria-label="Разделы"><div class="tab-bar-inner">
  <button class="tab ${screen.page === 'sets' || screen.page === 'detail' ? 'active' : ''}" data-action="sets">${svg('sets')}<span>Наборы</span></button>
  <button class="tab ${screen.page === 'modes' || screen.page === 'pick' ? 'active' : ''}" data-action="modes">${svg('modes')}<span>Режимы</span></button>
</div></nav>`;
const searchField = (placeholder) => `<label class="search">${svg('search')}<input type="search" id="search" placeholder="${placeholder}" value="${escape(query)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>`;
const visibleSets = () => sortSets(filterSets(sets, query), settings.sort);
const nothingFound = () => `<div class="empty"><strong>Ничего не найдено</strong><p>Нет наборов с названием «${escape(query)}».</p></div>`;
const empty = (title, text, button = '') => `<div class="empty">${svg('folder', 'empty-icon')}<strong>${title}</strong><p>${text}</p>${button}</div>`;

// The browser's Back button and the iPhone's swipe-back gesture should step through the
// app's own screens instead of leaving it. Only the screen descriptor goes into history;
// a running round cannot be restored, so Back from it lands on the screen that started it.
function go(next, { push = true } = {}) {
  if (push) history.pushState({ screen: { ...next, from: undefined } }, '');
  if (next.page !== screen.page) query = '';
  if (next.setId && next.page === 'detail') {
    const opened = getSet(next.setId);
    if (opened) { opened.openedAt = Date.now(); save(); }
  }
  screen = next;
  if (next.page !== 'editor') editor = null;
  if (next.page !== 'study') study = null;
  if (next.page !== 'learn') learn = null;
  hideToast();
  render();
  window.scrollTo(0, 0);
  const heading = document.querySelector('.large-title') ?? document.querySelector('.bar-center');
  if (heading && !heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading?.focus({ preventScroll: true });
}

history.replaceState({ screen: { page: 'sets' } }, '');
window.addEventListener('popstate', async (event) => {
  const target = event.state?.screen;
  if (!target) return;
  if (editor?.dirty) {
    history.pushState({ screen: { page: 'editor', setId: editor.setId } }, '');
    const leave = await askConfirm({ title: 'Выйти без сохранения?', message: 'Изменения в наборе будут потеряны.', confirmLabel: 'Выйти без сохранения' });
    if (!leave) return;
    editor.dirty = false;
    history.back();
    return;
  }
  const safe = target.page === 'study' || target.page === 'learn'
    ? { page: 'pick', mode: target.page === 'study' ? 'study' : 'learn' }
    : target.page === 'editor'
      ? (target.setId ? { page: 'detail', setId: target.setId } : { page: 'sets' })
      : target;
  go(safe, { push: false });
});

function render() {
  const views = { sets: renderSets, detail: renderDetail, editor: renderEditor, modes: renderModes, pick: renderPick, study: renderStudy, learn: renderLearn, sync: renderSync };
  // The flashcard screen is locked in place: a swipe must move the card, never the page.
  document.documentElement.dataset.page = screen.page;
  views[screen.page]();
}

function renderSets() {
  const buttons = `<button class="bar-button round" data-action="sync" aria-label="Аккаунт и данные">${svg('person')}</button><button class="bar-button round" data-action="sort" aria-label="Сортировка">${svg('sort')}</button><button class="bar-button round" data-action="create" aria-label="Новый набор">${svg('plus')}</button>`;
  app.innerHTML = `${bar('', buttons)}
    <h1 class="large-title">Наборы</h1>
    ${sets.length ? searchField('Поиск по названию') : ''}
    ${settings.sort !== 'none' && sets.length ? `<p class="sort-note">${SORT_MODES[settings.sort]}</p>` : ''}
    <div id="set-list">${setList()}</div>${tabBar()}`;
}

function setList() {
  if (!sets.length) return empty('Пока нет наборов', 'Создайте первый набор карточек, чтобы начать учиться.', `<button class="button primary" data-action="create">${svg('plus')}Новый набор</button>`);
  const list = visibleSets();
  if (!list.length) return nothingFound();
  return `<ul class="list">${list.map((set) => `<li><button class="row" data-open="${set.id}"><span class="row-icon">${svg('folder')}</span><span class="row-text"><span class="row-title">${escape(set.title)}</span><span class="row-sub">${setSubtitle(set)}</span></span>${svg('chevron', 'chevron')}</button></li>`).join('')}</ul>`;
}

function renderDetail() {
  const set = getSet(screen.setId);
  if (!set) return go({ page: 'sets' });
  app.innerHTML = `${bar(backButton('sets', 'Наборы'), '<button class="bar-button strong" data-action="edit">Изменить</button>')}
    <h1 class="large-title">${escape(set.title)}</h1>
    <p class="title-sub">${countLabel(set.cards.length)}</p>
    ${progressBars(set, 'learn', 'Заучивание')}
    ${progressBars(set, 'sort', 'Карточки')}
    <button class="button primary wide" data-action="study-set">${svg('play')}Учить</button>
    <h2 class="section-title">Термины <span class="section-note">точка — ступень заучивания</span></h2>
    <ul class="list pairs">${set.cards.map((card) => `<li class="pair state-${card.learn}"><span>${escape(card.term)}</span><span>${escape(card.definition)}</span></li>`).join('')}</ul>
    <div class="detail-tools">
      <button class="button tinted" data-action="export-set">${svg('export')}Экспорт</button>
      ${setSummary(set).known || setSummary(set).learning || setSummary(set, 'sort').known || setSummary(set, 'sort').learning ? `<button class="button tinted" data-action="reset-progress">${svg('reset')}Сбросить прогресс</button>` : ''}
    </div>
    ${tabBar()}`;
}

const MODES = {
  study: {
    title: 'Карточки',
    icon: 'swap',
    note: 'Листайте и переворачивайте карточки. Можно раскладывать их на «Знаю» и «Ещё учу»',
    progress: (set) => sortSubtitle(set),
  },
  learn: {
    title: 'Заучивание',
    icon: 'learn',
    note: 'Вопросы раундами: варианты ответа и письменный ввод, пока набор не будет выучен',
    progress: (set) => (setSummary(set).known ? `${setSummary(set).known} из ${set.cards.length} выучено` : 'Ни одного слова пока не выучено'),
  },
};

function renderModes() {
  const content = sets.length
    ? `<div class="mode-tiles">${Object.entries(MODES).map(([mode, { title, icon, note }]) => `<button class="mode-tile ${mode}" data-pick="${mode}"><span class="mode-tile-icon">${svg(icon)}</span><span class="mode-tile-title">${title}</span><span class="mode-tile-note">${note}</span></button>`).join('')}</div>`
    : empty('Сначала создайте набор', 'После этого здесь появятся режимы повторения.', `<button class="button primary" data-action="create">${svg('plus')}Новый набор</button>`);
  app.innerHTML = `${bar()}<h1 class="large-title">Режимы</h1><p class="title-sub">Выберите режим, потом набор</p>${content}${tabBar()}`;
}

function renderPick() {
  const mode = MODES[screen.mode];
  app.innerHTML = `${bar(backButton('modes', 'Режимы'))}
    <h1 class="large-title">${mode.title}</h1>
    <p class="title-sub">Выберите набор</p>
    ${sets.length ? searchField('Поиск по названию') : ''}
    <div id="set-list">${pickList()}</div>${tabBar()}`;
}

function pickList() {
  const mode = MODES[screen.mode];
  if (!sets.length) return empty('Пока нет наборов', 'Создайте набор, чтобы начать учиться.', `<button class="button primary" data-action="create">${svg('plus')}Новый набор</button>`);
  const list = visibleSets();
  if (!list.length) return nothingFound();
  return `<ul class="list">${list.map((set) => `<li><button class="row" data-mode="${screen.mode}" data-set="${set.id}"><span class="row-icon ${screen.mode}">${svg(mode.icon)}</span><span class="row-text"><span class="row-title">${escape(set.title)}</span><span class="row-sub">${mode.progress(set)}</span></span>${svg('chevron', 'chevron')}</button></li>`).join('')}</ul>`;
}

/* ---------- Editor ---------- */

function openEditor(setId = null) {
  const set = setId ? getSet(setId) : null;
  editor = {
    setId,
    title: set?.title ?? '',
    cards: set ? set.cards.map((card) => ({ ...card })) : [blankCard(), blankCard()],
    dirty: false,
  };
  go({ page: 'editor' });
}

function renderEditor() {
  const isEdit = Boolean(editor.setId);
  app.innerHTML = `${bar(backButton('cancel-edit', isEdit ? 'Назад' : 'Наборы'), `<button class="bar-button strong" data-action="save">${isEdit ? 'Готово' : 'Создать'}</button>`)}
    <h1 class="large-title">${isEdit ? 'Изменить набор' : 'Новый набор'}</h1>
    <form id="set-form" class="editor" novalidate>
      <label class="field title-field"><textarea id="set-title" rows="1" placeholder="Например, «Немецкий: еда»">${escape(editor.title)}</textarea><span class="field-label">Название</span></label>
      <div class="editor-tools"><button type="button" class="button tinted small" data-action="open-import">${svg('import')}Импорт</button></div>
      <p class="form-error" id="form-error" role="alert" hidden></p>
      <ol class="card-editors" id="card-editors">${cardEditors()}</ol>
      <button type="button" class="add-card" data-action="add-card">${svg('plus')}Добавить карточку</button>
      ${isEdit ? '<button type="button" class="button destructive wide" data-action="delete-set">Удалить набор</button>' : ''}
    </form>`;
  growAll();
}

function cardEditors() {
  return editor.cards.map((card, index) => `<li class="card-editor" data-index="${index}">
    <div class="card-head">
      <span class="card-number">${index + 1}</span>
      <button type="button" class="icon-button drag-handle" aria-label="Переместить карточку ${index + 1}. Стрелки вверх и вниз меняют порядок">${svg('grip')}</button>
      <button type="button" class="icon-button delete" data-action="remove-card" aria-label="Удалить карточку ${index + 1}">${svg('trash')}</button>
    </div>
    <div class="card-fields">
      <label class="field"><textarea rows="1" name="term" placeholder="Введите термин">${escape(card.term)}</textarea><span class="field-label">Термин</span></label>
      <label class="field"><textarea rows="1" name="definition" placeholder="Введите определение">${escape(card.definition)}</textarea><span class="field-label">Определение</span></label>
    </div>
  </li>`).join('');
}

function renderCards() {
  document.querySelector('#card-editors').innerHTML = cardEditors();
  growAll();
}

function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
const growAll = () => document.querySelectorAll('.editor textarea').forEach(grow);

function focusCardField(index, name = 'term') {
  const field = document.querySelector(`.card-editor[data-index="${index}"] [name="${name}"]`);
  field?.focus();
  field?.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function addCard() {
  editor.cards.push(blankCard());
  editor.dirty = true;
  renderCards();
  focusCardField(editor.cards.length - 1);
}

function removeCard(index) {
  const [removed] = editor.cards.splice(index, 1);
  const addedBlank = editor.cards.length === 0;
  if (addedBlank) editor.cards.push(blankCard());
  editor.dirty = true;
  const item = document.querySelector(`.card-editor[data-index="${index}"]`);
  const finish = () => {
    renderCards();
    if (!removed.term.trim() && !removed.definition.trim()) return;
    showToast('Карточка удалена', 'Вернуть', () => {
      if (!editor) return;
      if (addedBlank && editor.cards.length === 1 && !editor.cards[0].term && !editor.cards[0].definition) editor.cards = [];
      editor.cards.splice(Math.min(index, editor.cards.length), 0, removed);
      renderCards();
    });
  };
  if (!item || reducedMotion.matches) return finish();
  item.style.height = `${item.offsetHeight}px`;
  item.offsetHeight; // commit the starting height before collapsing
  item.classList.add('removing');
  setTimeout(finish, 260);
}

function moveCard(from, to) {
  if (to < 0 || to >= editor.cards.length || from === to) return;
  editor.cards = moveItem(editor.cards, from, to);
  editor.dirty = true;
  renderCards();
}

function startCardDrag(event, handle) {
  const item = handle.closest('.card-editor');
  const list = item.parentElement;
  const items = [...list.children];
  const from = items.indexOf(item);
  const slots = items.map((element) => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top + window.scrollY, height: rect.height };
  });
  const gap = parseFloat(getComputedStyle(item).marginBottom) || 0;
  const shift = slots[from].height + gap;
  const startY = event.clientY + window.scrollY;
  let pointerY = event.clientY;
  let to = from;
  let frame = null;

  document.activeElement?.blur();
  handle.setPointerCapture(event.pointerId);
  list.classList.add('sorting');
  item.classList.add('dragging');

  const update = () => {
    frame = null;
    const dy = pointerY + window.scrollY - startY;
    item.style.transform = `translate3d(0, ${dy}px, 0)`;
    const center = slots[from].top + slots[from].height / 2 + dy;
    to = from;
    for (let i = from + 1; i < items.length; i += 1) if (center > slots[i].top + slots[i].height / 2) to = i;
    for (let i = from - 1; i >= 0; i -= 1) if (center < slots[i].top + slots[i].height / 2) to = i;
    items.forEach((element, i) => {
      if (element === item) return;
      const offset = i > from && i <= to ? -shift : i < from && i >= to ? shift : 0;
      element.style.transform = offset ? `translate3d(0, ${offset}px, 0)` : '';
    });
    const edge = 80;
    const speed = pointerY < edge ? -(edge - pointerY) / 5 : pointerY > window.innerHeight - edge ? (pointerY - window.innerHeight + edge) / 5 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      frame = requestAnimationFrame(update);
    }
  };
  const move = (moveEvent) => {
    pointerY = moveEvent.clientY;
    if (!frame) frame = requestAnimationFrame(update);
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    cancelAnimationFrame(frame);
    const finalTop = to > from ? slots[to].top + slots[to].height - slots[from].height : slots[to].top;
    item.classList.add('settling');
    item.style.transform = `translate3d(0, ${finalTop - slots[from].top}px, 0)`;
    setTimeout(() => {
      list.classList.remove('sorting');
      if (to !== from) moveCard(from, to);
      else items.forEach((element) => { element.style.transform = ''; element.classList.remove('dragging', 'settling'); });
      document.querySelector(`.card-editor[data-index="${to}"] .drag-handle`)?.focus({ preventScroll: true });
    }, reducedMotion.matches ? 0 : 240);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

function showError(message, field) {
  const error = document.querySelector('#form-error');
  error.textContent = message;
  error.hidden = false;
  field?.focus();
  (field ?? error).scrollIntoView({ block: 'center', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function saveEditor() {
  const title = editor.title.trim();
  if (!title) return showError('Введите название набора.', document.querySelector('#set-title'));
  const trimmed = editor.cards.map((card) => ({ ...card, term: card.term.trim(), definition: card.definition.trim() }));
  const halfIndex = trimmed.findIndex((card) => Boolean(card.term) !== Boolean(card.definition));
  if (halfIndex !== -1) {
    const missing = trimmed[halfIndex].term ? 'definition' : 'term';
    return showError(`В карточке ${halfIndex + 1} не заполнено ${missing === 'term' ? 'поле «Термин»' : 'поле «Определение»'}.`, document.querySelector(`.card-editor[data-index="${halfIndex}"] [name="${missing}"]`));
  }
  const cards = trimmed.filter((card) => card.term && card.definition).map(normalizeCard);
  if (!cards.length) return showError('Добавьте хотя бы одну карточку с термином и определением.', document.querySelector('.card-editor [name="term"]'));

  let id = editor.setId;
  const existing = id ? getSet(id) : null;
  if (existing) Object.assign(existing, { title, cards, updatedAt: Date.now() });
  else {
    id = crypto.randomUUID();
    sets.unshift({ id, title, cards, createdAt: Date.now(), updatedAt: Date.now(), openedAt: null });
  }
  save();
  go({ page: 'detail', setId: id });
}

// An in-app sheet instead of window.confirm: browsers may suppress system dialogs,
// and a destructive choice should look like the rest of the app.
const askConfirm = ({ title, message, confirmLabel, destructive = true }) =>
  askSheet({ title, message, actions: [{ label: confirmLabel, value: true, destructive }] }).then((value) => value === true);

function askSheet({ title, message, actions }) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'sheet-scrim';
    scrim.innerHTML = `<div class="sheet confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="grabber"></div>
      <h2 id="confirm-title">${escape(title)}</h2>
      <p>${escape(message)}</p>
      ${actions.map((action, index) => `<button class="button ${action.destructive ? 'danger' : 'primary'} wide" data-confirm="${index}">${escape(action.label)}</button>`).join('')}
      <button class="button tinted wide" data-cancel>Отмена</button>
    </div>`;
    document.body.append(scrim);
    const finish = (answer) => {
      document.removeEventListener('keydown', onKey);
      scrim.classList.add('closing');
      setTimeout(() => scrim.remove(), reducedMotion.matches ? 0 : 280);
      resolve(answer);
    };
    const onKey = (event) => { if (event.key === 'Escape') finish(null); };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', (event) => {
      const chosen = event.target.closest('[data-confirm]');
      if (chosen) return finish(actions[Number(chosen.dataset.confirm)].value);
      if (event.target === scrim || event.target.closest('[data-cancel]')) finish(null);
    });
    requestAnimationFrame(() => scrim.querySelector('[data-confirm]').focus());
  });
}

async function leaveEditor() {
  if (editor.dirty && !await askConfirm({ title: 'Выйти без сохранения?', message: 'Изменения в наборе будут потеряны.', confirmLabel: 'Выйти без сохранения' })) return;
  const target = editor.setId && getSet(editor.setId) ? { page: 'detail', setId: editor.setId } : { page: 'sets' };
  go(target);
}

async function resetProgress() {
  const set = getSet(screen.setId);
  if (!set) return;
  const choice = await askSheet({
    title: 'Сбросить прогресс?',
    message: `Набор «${set.title}». Заучивание и стопки карточек считаются отдельно.`,
    actions: [
      { label: 'Сбросить всё', value: 'all', destructive: true },
      { label: 'Только заучивание', value: 'learn', destructive: true },
      { label: 'Только стопки карточек', value: 'sort', destructive: true },
    ],
  });
  if (!choice) return;
  set.cards.forEach((card) => {
    if (choice === 'all' || choice === 'learn') card.learn = 'new';
    if (choice === 'all' || choice === 'sort') card.sort = 'new';
  });
  touch(set.id);
  save();
  render();
  showToast('Прогресс сброшен', 'Понятно', () => {});
}

async function deleteSet() {
  const set = getSet(editor.setId);
  if (!set) return;
  if (!await askConfirm({ title: 'Удалить набор?', message: `Набор «${set.title}» и его карточки будут удалены. Это действие нельзя отменить.`, confirmLabel: 'Удалить набор' })) return;
  sets = sets.filter((item) => item.id !== set.id);
  deletedSets[set.id] = Date.now();
  save();
  go({ page: 'sets' });
}

function exportSet(setId) {
  const set = getSet(setId);
  if (!set) return;
  const text = set.cards.map((card) => `${card.term};${card.definition}`).join('\n');
  const name = `${set.title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'recalo'}.txt`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  Object.assign(link, { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  navigator.clipboard?.writeText(text).then(
    () => showToast(`Файл «${name}» сохранён, а карточки скопированы в буфер обмена`),
    () => showToast(`Файл «${name}» сохранён`),
  );
}

function backupAll() {
  const payload = { app: 'recalo', version: 1, exportedAt: new Date().toISOString(), sets, deleted: deletedSets };
  const name = `recalo-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  Object.assign(link, { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Копия сохранена: ${name}`);
}

async function restoreBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    const incoming = Array.isArray(payload) ? payload : payload.sets;
    if (!Array.isArray(incoming) || !incoming.length) return showToast('В файле нет наборов');
    const yes = await askConfirm({
      title: 'Восстановить из копии?',
      message: `В файле ${incoming.length} ${pluralCards(incoming.length) === 'карточка' ? 'набор' : 'наборов'}. Наборы объединятся с тем, что уже есть: при совпадении останется более поздняя версия.`,
      confirmLabel: 'Восстановить',
      destructive: false,
    });
    if (!yes) return;
    deletedSets = mergeTombstones(deletedSets, payload.deleted ?? {});
    sets = mergeSets(sets, incoming.map((set) => ({ ...set, cards: (set.cards ?? []).map(normalizeCard) })), deletedSets);
    save();
    render();
    showToast(`Восстановлено наборов: ${sets.length}`);
  } catch {
    showToast('Не удалось прочитать файл: он повреждён или не от Recalo');
  }
}

function renderSync() {
  const state = syncState();
  const status = {
    off: ['Синхронизация не настроена', 'Данные хранятся только в этом браузере. Настройте Firebase по инструкции docs/setup-sync.md.'],
    connecting: ['Подключение…', 'Связываемся с облаком.'],
    'signed-out': ['Вход не выполнен', 'Войдите, чтобы наборы и прогресс синхронизировались между iPhone и Mac.'],
    syncing: ['Синхронизация…', 'Получаем данные из облака.'],
    ready: [`Вы вошли: ${escape(state.email ?? '')}`, 'Наборы и прогресс синхронизируются автоматически.'],
    error: ['Ошибка синхронизации', escape(state.error ?? '')],
  }[state.status] ?? ['Синхронизация не настроена', ''];

  app.innerHTML = `${bar(backButton('sets', 'Наборы'))}
    <h1 class="large-title">Аккаунт и данные</h1>
    <section class="sync-card">
      <span class="sync-icon ${state.status}">${svg('cloud')}</span>
      <h2>${status[0]}</h2>
      <p>${status[1]}</p>
      ${state.status === 'signed-out' ? `<div class="sync-form">
        <button class="button primary wide" data-action="sign-in-google">${svg('google')}Войти через Google</button>
        <p class="sync-or">или по ссылке на почту</p>
        <form id="sign-in-form">
          <label class="field"><input id="sign-in-email" type="email" inputmode="email" autocomplete="email" placeholder="Почта" required><span class="field-label">Почта для входа</span></label>
          <button class="button tinted wide" type="submit">Прислать ссылку</button>
        </form>
      </div>` : ''}
      ${state.status === 'ready' ? '<button class="button tinted wide" data-action="sign-out">Выйти</button>' : ''}
    </section>
    <h2 class="section-title">Резервная копия</h2>
    <p class="sync-note">Копия содержит все наборы, прогресс и даты. Её можно перенести на другое устройство или сохранить на всякий случай.</p>
    <div class="detail-tools">
      <button class="button tinted" data-action="backup">${svg('export')}Сохранить</button>
      <button class="button tinted" data-action="restore">${svg('import')}Восстановить</button>
    </div>
    <input type="file" id="restore-file" accept="application/json,.json" hidden>
    ${tabBar()}`;
}

/* ---------- Import sheet ---------- */

function openImport() {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="import-title">
    <div class="grabber"></div>
    <div class="sheet-bar"><button class="bar-button" data-close>Отмена</button><h2 id="import-title">Импорт</h2><button class="bar-button strong" id="import-confirm" disabled>Добавить</button></div>
    <p class="sheet-hint">Вставьте данные из Quizlet, Excel или Google Таблиц: одна карточка на строку, термин и определение через Tab или «;».</p>
    <textarea id="import-text" spellcheck="false" placeholder="die Nudeln&#9;макароны&#10;der Koffer&#9;чемодан"></textarea>
    <p class="sheet-count" id="import-count">Карточек не найдено</p>
  </div>`;
  document.body.append(scrim);
  const text = scrim.querySelector('#import-text');
  const confirmButton = scrim.querySelector('#import-confirm');
  const count = scrim.querySelector('#import-count');
  let rows = [];

  const close = () => {
    document.removeEventListener('keydown', onKey);
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), reducedMotion.matches ? 0 : 280);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (event) => { if (event.target === scrim || event.target.closest('[data-close]')) close(); });
  text.addEventListener('input', () => {
    rows = parseImportedCards(text.value);
    confirmButton.disabled = !rows.length;
    count.textContent = rows.length ? `Будет добавлено: ${countLabel(rows.length)}` : 'Карточек не найдено';
  });
  confirmButton.addEventListener('click', () => {
    if (!rows.length) return;
    editor.cards = [...editor.cards.filter((card) => card.term.trim() || card.definition.trim()), ...rows];
    editor.dirty = true;
    renderCards();
    close();
  });
  requestAnimationFrame(() => text.focus());
}

/* ---------- Toast ---------- */

function showToast(message, actionLabel, onAction) {
  hideToast();
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.innerHTML = `<span>${escape(message)}</span>${actionLabel ? `<button type="button">${escape(actionLabel)}</button>` : ''}`;
  toast.querySelector('button')?.addEventListener('click', () => { hideToast(); onAction(); });
  document.body.append(toast);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  clearTimeout(toastTimer);
  document.querySelector('.toast')?.remove();
}

/* ---------- Study ---------- */

function markOpened(setId) {
  const set = getSet(setId);
  if (!set) return;
  set.openedAt = Date.now();
  save();
}

function touch(setId) {
  const set = getSet(setId);
  if (set) set.updatedAt = Date.now();
}

function beginStudy(setId, only = null) {
  const set = getSet(setId);
  const pool = only ? set?.cards.filter((card) => only.includes(card.id)) : set?.cards;
  if (!pool?.length) return;
  markOpened(setId);
  study = {
    from: screen.page === 'study' || screen.page === 'learn' ? screen.from : { ...screen },
    setId,
    queue: settings.shuffle ? shuffle(pool) : [...pool],
    index: 0,
    leaving: false,
    hint: 0,
    sides: {},
    lastSort: null,
    round: { known: [], learning: [] },
    wheelSwipe: createWheelSwipe(),
  };
  go({ page: 'study', from: study.from });
}

// "Случайно" picks a side per card, so the choice has to be remembered while the card is on screen.
const resolveSide = () => (settings.front === 'random' ? (Math.random() < 0.5 ? 'term' : 'definition') : settings.front);
const sideOf = (card) => (study.sides[card.id] ??= resolveSide());
const faceLabels = (side) => (side === 'term' ? ['Термин', 'Определение'] : ['Определение', 'Термин']);
const cardFront = (card) => (sideOf(card) === 'term' ? card.term : card.definition);
const cardBack = (card) => (sideOf(card) === 'term' ? card.definition : card.term);

// Sorting a card is what moves it between the three progress groups.
function markCard(card, state) {
  const set = getSet(study.setId);
  const stored = set?.cards.find((item) => item.id === card.id);
  if (!stored) return;
  study.lastSort = { id: stored.id, before: stored.sort, index: study.index, state };
  stored.sort = state;
  touch(study.setId);
  save();
  const bucket = state === 'known' ? study.round.known : study.round.learning;
  if (!bucket.includes(card.id)) bucket.push(card.id);
}

function renderStudy() {
  const set = getSet(study.setId);
  if (!set) return go({ page: 'modes' });
  const total = study.queue.length;
  const back = backButton('back-to-pick', 'Назад');
  const options = `<button class="bar-button round" data-action="study-options" aria-label="Настройки режима">${svg('options')}</button>`;
  if (study.index >= total) return renderRoundSummary(set, total, back);

  const card = study.queue[study.index];
  const next = study.queue[study.index + 1];
  const [frontLabel, backLabel] = faceLabels(sideOf(card));
  const answer = cardBack(card);
  const hinted = study.hint > 0;
  app.innerHTML = `${bar(back, options, `<span class="counter">${study.index + 1} из ${total}</span>`)}
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${study.index}"><i style="transform: scaleX(${study.index / total})"></i></div>
    ${settings.tracking ? `<div class="sort-counts"><span class="learning">${study.round.learning.length} ещё учу</span>${study.lastSort ? `<button class="undo-sort" data-action="undo-sort">${svg('undo')}Отменить</button>` : ''}<span class="known">${study.round.known.length} знаю</span></div>` : ''}
    <div class="deck" id="deck">
      ${settings.tracking ? '<span class="stamp learning" aria-hidden="true">Ещё учу</span><span class="stamp known" aria-hidden="true">Знаю</span>' : ''}
      ${next ? `<div class="study-card is-next" aria-hidden="true"><div class="card-inner"><div class="face front"><span class="face-label">${faceLabels(sideOf(next))[0]}</span><p class="study-word">${escape(cardFront(next))}</p></div></div></div>` : ''}
      <div class="study-card" id="study-card" role="button" tabindex="0" aria-pressed="false" aria-label="${escape(cardFront(card))}. Нажмите, чтобы перевернуть">
        <div class="card-inner">
          <div class="face front">
            <span class="face-label">${frontLabel}</span>
            <p class="study-word">${escape(cardFront(card))}</p>
            ${hinted ? `<p class="hint-line" aria-live="polite">${escape(maskHint(answer, study.hint))}</p>` : ''}
          </div>
          <div class="face back"><span class="face-label">${backLabel}</span><p class="study-word">${escape(answer)}</p></div>
        </div>
      </div>
    </div>
    <div class="study-tools">
      <button class="button tinted small" data-action="hint" ${study.hint >= answer.length ? 'disabled' : ''}>${svg('bulb')}Подсказка</button>
    </div>
    <p class="study-hint">${settings.tracking ? 'Смахните влево — ещё учу · вправо — знаю' : 'Нажмите — перевернуть · Смахните — дальше'}</p>
    <p class="study-hint keys">Пробел — перевернуть · ← → — ${settings.tracking ? 'ещё учу и знаю' : 'следующая'}</p>`;
  bindStudyCard();
}

function renderRoundSummary(set, total, back) {
  const { learning, known } = study.round;
  app.innerHTML = `${bar(back)}<section class="done">
    <div class="done-mark">${svg('check')}</div>
    <h1>Раунд пройден</h1>
    <p>${settings.tracking ? `Знаю: ${known.length} · Ещё учу: ${learning.length}` : `Вы просмотрели ${countLabel(total)} из набора «${escape(set.title)}».`}</p>
    ${settings.tracking && learning.length ? `<button class="button primary wide" data-action="repeat-learning">Повторить, что ещё учу</button>` : ''}
    <button class="button ${settings.tracking && learning.length ? 'tinted' : 'primary'} wide" data-action="restart">Весь набор заново</button>
    <button class="button tinted wide" data-action="modes">К режимам</button>
  </section>`;
}

// Sides are remembered per card so "Случайно" stays stable while a card is on screen;
// changing the setting has to throw that memory away, or nothing visibly changes.
function applyFront(side) {
  settings.front = side;
  saveSettings();
  if (study) study.sides = {};
  if (learn?.current && learn.phase === 'question') {
    const set = getSet(learn.setId);
    const newSide = resolveSide();
    const answer = learnAnswer(learn.current.card, newSide);
    Object.assign(learn.current, {
      side: newSide,
      answer,
      given: '',
      hint: 0,
      options: learn.current.written ? [] : pickOptions(set.cards.map((item) => learnAnswer(item, newSide)), answer),
    });
  }
  render();
}

// A sheet body plus the usual scrim behaviour: click outside, Escape, closing animation.
function openSheet(html, wire) {
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = html;
  document.body.append(scrim);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), reducedMotion.matches ? 0 : 280);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (event) => { if (event.target === scrim || event.target.closest('[data-close]')) close(); });
  wire?.(scrim, close);
  return { scrim, close };
}

function openModePicker(setId) {
  const set = getSet(setId);
  if (!set) return;
  const rows = Object.entries(MODES).map(([mode, { title, icon, note, progress }]) => `<li><button class="row" data-start="${mode}"><span class="row-icon ${mode}">${svg(icon)}</span><span class="row-text"><span class="row-title">${title}</span><span class="row-sub">${note}</span><span class="row-sub">${progress(set)}</span></span>${svg('chevron', 'chevron')}</button></li>`).join('');
  openSheet(`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="modes-title">
    <div class="grabber"></div>
    <div class="sheet-bar"><span></span><h2 id="modes-title">Доступные режимы</h2><button class="bar-button" data-close>Отмена</button></div>
    <ul class="list options">${rows}</ul>
  </div>`, (scrim, close) => {
    scrim.addEventListener('click', (event) => {
      const mode = event.target.closest('[data-start]')?.dataset.start;
      if (!mode) return;
      close();
      (mode === 'learn' ? beginLearn : beginStudy)(setId);
    });
  });
}

function openSortSheet() {
  const rows = Object.entries(SORT_MODES).map(([value, label]) => `<li><button class="row" role="radio" aria-checked="${settings.sort === value}" data-sort="${value}"><span class="row-text"><span class="row-title">${label}</span></span>${settings.sort === value ? svg('check', 'row-check') : ''}</button></li>`).join('');
  openSheet(`<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sort-title">
    <div class="grabber"></div>
    <div class="sheet-bar"><span></span><h2 id="sort-title">Сортировка</h2><button class="bar-button" data-close>Готово</button></div>
    <ul class="list options sort-list" role="radiogroup">${rows}</ul>
  </div>`, (scrim, close) => {
    scrim.addEventListener('click', (event) => {
      const value = event.target.closest('[data-sort]')?.dataset.sort;
      if (!value) return;
      settings.sort = value;
      saveSettings();
      render();
      close();
    });
  });
}

function restartRound() {
  const set = getSet(learn.setId);
  const snapshot = learn.snapshot;
  if (!set || !snapshot) return;
  set.cards.forEach((card) => { card.learn = snapshot.levels[card.id] ?? card.learn; });
  save();
  Object.assign(learn, {
    round: snapshot.round,
    streak: snapshot.streak,
    stats: { ...snapshot.stats },
    roundStats: { correct: 0, wrong: 0 },
    queue: snapshot.ids.map((id) => ({ id, tries: 0 })),
  });
  askNext();
}

async function resetLearnProgress() {
  const set = getSet(learn.setId);
  if (!set) return;
  const yes = await askConfirm({
    title: 'Пройти набор заново?',
    message: `Прогресс заучивания набора «${set.title}» сбросится: все ${countLabel(set.cards.length)} снова станут неизученными. Стопки режима карточек не изменятся.`,
    confirmLabel: 'Сбросить и начать',
  });
  if (!yes) return;
  set.cards.forEach((card) => { card.learn = 'new'; });
  touch(set.id);
  save();
  beginLearn(set.id);
}

async function restartLearn() {
  const set = getSet(learn.setId);
  if (!set || !learn.snapshot) return;
  const { known, learning } = setSummary(set);
  const choice = await askSheet({
    title: `Начать раунд ${learn.round} заново?`,
    message: `Ответы этого раунда не засчитаются: набор вернётся к тому, что было в его начале. Сейчас в наборе «${set.title}»: ${known} выучено, ${learning} ещё учу.`,
    actions: [
      { label: `Начать раунд ${learn.round} заново`, value: 'round', destructive: false },
      { label: 'Сбросить весь прогресс заучивания', value: 'progress', destructive: true },
    ],
  });
  if (choice === 'round') return restartRound();
  if (choice !== 'progress') return;
  set.cards.forEach((card) => { card.learn = 'new'; });
  save();
  beginLearn(set.id);
}

function openStudyOptions({ tracking = true, restart = false } = {}) {
  const rows = [
    ['tracking', 'Отслеживать прогресс', 'Свайп вправо — «Знаю», влево — «Ещё учу». Выключено — просто листаете карточки.'],
    ['shuffle', 'Перемешивать карточки', 'Порядок случайный при каждом запуске режима.'],
  ].filter(([key]) => tracking || key !== 'tracking');
  const scrim = document.createElement('div');
  scrim.className = 'sheet-scrim';
  scrim.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="options-title">
    <div class="grabber"></div>
    <div class="sheet-bar"><span></span><h2 id="options-title">Настройки</h2><button class="bar-button strong" data-close>Готово</button></div>
    <ul class="list options">
      ${rows.map(([key, title, note]) => `<li><label class="row toggle"><span class="row-text"><span class="row-title">${title}</span><span class="row-sub">${note}</span></span><input type="checkbox" class="switch" data-setting="${key}" ${settings[key] ? 'checked' : ''}></label></li>`).join('')}
      <li><label class="row toggle"><span class="row-text"><span class="row-title">Сначала показывать</span><span class="row-sub">Какая сторона карточки лицевая.</span></span>
        <span class="segmented">
          ${[['term', 'Термин'], ['definition', 'Определение'], ['random', 'Случайно']].map(([value, label]) => `<button type="button" class="${settings.front === value ? 'active' : ''}" data-front="${value}">${label}</button>`).join('')}
        </span></label></li>
    </ul>
    ${restart ? `<button class="button tinted wide sheet-restart" data-restart>${svg('reset')}Начать заново</button>` : ''}
  </div>`;
  document.body.append(scrim);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    scrim.classList.add('closing');
    setTimeout(() => scrim.remove(), reducedMotion.matches ? 0 : 280);
  };
  const onKey = (event) => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  scrim.addEventListener('click', (event) => { if (event.target === scrim || event.target.closest('[data-close]')) close(); });
  scrim.addEventListener('change', (event) => {
    const key = event.target.dataset.setting;
    if (!key) return;
    settings[key] = event.target.checked;
    saveSettings();
    if (key === 'shuffle') return;
    render();
  });
  scrim.addEventListener('click', (event) => {
    if (event.target.closest('[data-restart]')) {
      close();
      setTimeout(restartLearn, reducedMotion.matches ? 0 : 300);
      return;
    }
    const side = event.target.closest('[data-front]')?.dataset.front;
    if (!side) return;
    applyFront(side);
    scrim.querySelectorAll('[data-front]').forEach((button) => button.classList.toggle('active', button.dataset.front === side));
  });
}

// Apple's momentum projection: where a flick would come to rest.
const project = (velocity, rate = 0.995) => (velocity / 1000) * rate / (1 - rate);

function bindStudyCard() {
  const card = document.querySelector('#study-card');
  let start = null;
  let dragging = false;
  let moved = 0;
  let history = [];

  card.addEventListener('pointerdown', (event) => {
    if (study.leaving || event.button > 0) return;
    start = { x: event.clientX, y: event.clientY };
    dragging = false;
    moved = 0;
    history = [{ x: event.clientX, t: event.timeStamp }];
    card.setPointerCapture(event.pointerId);
    card.classList.add('pressing');
  });
  card.addEventListener('pointermove', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    moved = Math.max(moved, Math.hypot(dx, dy));
    if (!dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      dragging = true;
      card.classList.remove('pressing');
      card.classList.add('dragging');
    }
    if (!dragging) return;
    history = [...history, { x: event.clientX, t: event.timeStamp }].filter((point) => event.timeStamp - point.t < 100);
    card.style.transform = `translate3d(${dx}px, ${dy * 0.1}px, 0) rotate(${dx / 20}deg)`;
    setNextProgress(Math.min(1, Math.abs(dx) / (card.offsetWidth * 0.6)));
    if (settings.tracking) {
      const deck = document.querySelector('#deck');
      deck.classList.toggle('to-known', dx > 0);
      deck.classList.toggle('to-learning', dx < 0);
      deck.style.setProperty('--sort-progress', Math.min(1, Math.abs(dx) / (card.offsetWidth * 0.35)));
    }
  });
  const release = (event) => {
    if (!start) return;
    card.classList.remove('pressing', 'dragging');
    document.querySelector('#deck')?.classList.remove('to-known', 'to-learning');
    const dx = event.clientX - start.x;
    start = null;
    if (!dragging) {
      // Only a real tap flips the card; a vertical drag across it is not a tap.
      if (event.type === 'pointerup' && moved < 12) flipCard(card);
      return;
    }
    const first = history[0];
    const last = history[history.length - 1];
    const velocity = last && first && last.t > first.t ? ((last.x - first.x) / (last.t - first.t)) * 1000 : 0;
    const projected = dx + project(velocity);
    if (event.type === 'pointerup' && Math.abs(projected) > card.offsetWidth * 0.35) fling(Math.sign(projected), dx, velocity);
    else springBack(card);
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
}

function revealHint() {
  const card = document.querySelector('#study-card');
  const answer = cardBack(study.queue[study.index]);
  if (!card || study.hint >= answer.length) return;
  study.hint += 1;
  let line = card.querySelector('.hint-line');
  if (!line) {
    line = document.createElement('p');
    line.className = 'hint-line';
    line.setAttribute('aria-live', 'polite');
    card.querySelector('.face.front').append(line);
  }
  line.textContent = maskHint(answer, study.hint);
  const button = document.querySelector('[data-action="hint"]');
  if (button) button.disabled = study.hint >= answer.length;
}

// One wrong flick should not silently change a card's pile.
function undoSort() {
  const undo = study?.lastSort;
  const set = getSet(study?.setId);
  if (!undo || !set) return;
  const card = set.cards.find((item) => item.id === undo.id);
  if (card) card.sort = undo.before;
  save();
  const bucket = undo.state === 'known' ? study.round.known : study.round.learning;
  const at = bucket.indexOf(undo.id);
  if (at !== -1) bucket.splice(at, 1);
  study.index = undo.index;
  study.hint = 0;
  study.lastSort = null;
  render();
  showToast('Свайп отменён');
}

function flipCard(card = document.querySelector('#study-card')) {
  if (!card) return;
  const flipped = card.classList.toggle('flipped');
  card.setAttribute('aria-pressed', String(flipped));
  const text = flipped ? cardBack(study.queue[study.index]) : cardFront(study.queue[study.index]);
  card.setAttribute('aria-label', `${text}. Нажмите, чтобы перевернуть`);
}

function setNextProgress(progress, transition = '') {
  const next = document.querySelector('.study-card.is-next');
  if (!next) return;
  next.style.transition = transition;
  next.style.transform = `translate3d(0, ${12 * (1 - progress)}px, 0) scale(${0.94 + 0.06 * progress})`;
}

function springBack(card) {
  card.style.transition = 'transform 450ms cubic-bezier(.2, 1.3, .4, 1)';
  card.style.transform = '';
  setNextProgress(0, 'transform 450ms cubic-bezier(.2, 1, .4, 1)');
  setTimeout(() => { card.style.transition = ''; }, 450);
}

function fling(direction, fromX = 0, velocity = 0) {
  const card = document.querySelector('#study-card');
  if (!card || study.leaving) return;
  study.leaving = true;
  if (settings.tracking) markCard(study.queue[study.index], direction > 0 ? 'known' : 'learning');
  const finish = () => { study.index += 1; study.hint = 0; study.leaving = false; render(); };
  if (reducedMotion.matches) return finish();
  const target = direction * (window.innerWidth * 0.5 + card.offsetWidth);
  const speed = Math.max(Math.abs(velocity), 1400);
  const duration = Math.min(380, Math.max(200, (Math.abs(target - fromX) / speed) * 1000));
  card.style.transition = `transform ${duration}ms cubic-bezier(.25, .7, .4, 1), opacity ${duration}ms ease-in`;
  card.style.transform = `translate3d(${target}px, 0, 0) rotate(${direction * 18}deg)`;
  card.style.opacity = '0';
  setNextProgress(1, `transform ${duration}ms cubic-bezier(.2, 1, .4, 1)`);
  setTimeout(finish, duration);
}

/* ---------- Learn ---------- */

const ROUND_SIZE = 7;
const STREAK_FROM = 5;

function beginLearn(setId) {
  const set = getSet(setId);
  if (!set?.cards.length) return;
  markOpened(setId);
  learn = { from: screen.page === 'study' || screen.page === 'learn' ? screen.from : { ...screen }, setId, round: 0, queue: [], streak: 0, bestStreak: 0, stats: { correct: 0, wrong: 0 }, roundStats: { correct: 0, wrong: 0 }, phase: 'round', current: null };
  go({ page: 'learn', from: learn.from });
  nextRound();
}

const learnPrompt = (card, side = learn.current.side) => (side === 'term' ? card.term : card.definition);
const learnAnswer = (card, side = learn.current.side) => (side === 'term' ? card.definition : card.term);
const remainingCards = () => getSet(learn.setId)?.cards.filter((card) => card.learn !== 'known') ?? [];

function nextRound() {
  const remaining = remainingCards();
  if (!remaining.length) {
    learn.phase = 'done';
    return render();
  }
  learn.round += 1;
  learn.roundStats = { correct: 0, wrong: 0 };
  learn.queue = shuffle(remaining).slice(0, ROUND_SIZE).map((card) => ({ id: card.id, tries: 0 }));
  learn.snapshot = {
    round: learn.round,
    streak: learn.streak,
    stats: { ...learn.stats },
    ids: learn.queue.map((entry) => entry.id),
    levels: Object.fromEntries(getSet(learn.setId).cards.map((card) => [card.id, card.learn])),
  };
  askNext();
}

function askNext() {
  if (!learn.queue.length) {
    learn.phase = 'round';
    return render();
  }
  const set = getSet(learn.setId);
  const card = set.cards.find((item) => item.id === learn.queue[0].id);
  if (!card) {
    learn.queue.shift();
    return askNext();
  }
  const side = resolveSide();
  const answer = learnAnswer(card, side);
  // A brand-new card is recognised from four options; once it is familiar it must be typed.
  const written = card.learn !== 'new' || set.cards.length < 3;
  learn.current = {
    card,
    side,
    answer,
    written,
    options: written ? [] : pickOptions(set.cards.map((item) => learnAnswer(item, side)), answer),
    given: '',
    verdict: null,
    hint: 0,
  };
  learn.phase = 'question';
  render();
  if (written) requestAnimationFrame(() => document.querySelector('#learn-input')?.focus());
}

function submitAnswer(given) {
  if (!learn?.current || learn.phase !== 'question') return;
  const entry = learn.queue[0];
  const verdict = gradeAnswer(given, learn.current.answer);
  learn.current.given = given;
  learn.current.verdict = verdict;
  learn.phase = 'feedback';

  const hinted = learn.current.hint > 0;
  const card = getSet(learn.setId).cards.find((item) => item.id === learn.current.card.id);
  if (card) {
    card.learn = nextCardState(card.learn, hinted && verdict === 'correct' ? 'almost' : verdict);
    touch(learn.setId);
    save();
  }
  if (verdict === 'correct') {
    learn.stats.correct += 1;
    learn.roundStats.correct += 1;
    if (entry.tries === 0 && !hinted) {
      learn.streak += 1;
      learn.bestStreak = Math.max(learn.bestStreak, learn.streak);
    }
  } else if (verdict === 'wrong') {
    learn.stats.wrong += 1;
    learn.roundStats.wrong += 1;
    learn.streak = 0;
  }
  entry.tries += 1;
  render();
  if (verdict === 'correct' && !hinted) setTimeout(() => { if (learn?.phase === 'feedback') continueLearn(); }, reducedMotion.matches ? 0 : 750);
}

function revealLearnHint() {
  if (!learn?.current || learn.phase !== 'question' || learn.current.hint >= learn.current.answer.length) return;
  learn.current.hint += 1;
  learn.current.given = document.querySelector('#learn-input')?.value ?? '';
  render();
  const input = document.querySelector('#learn-input');
  if (input) { input.value = learn.current.given; input.focus(); }
}

function continueLearn() {
  if (!learn || learn.phase !== 'feedback') return;
  const entry = learn.queue.shift();
  // A missed card comes back a couple of questions later, inside the same round.
  if (learn.current.verdict !== 'correct' || learn.current.hint > 0) learn.queue.splice(Math.min(2, learn.queue.length), 0, entry);
  askNext();
}

function renderLearn() {
  const set = getSet(learn.setId);
  if (!set) return go({ page: 'modes' });
  const back = backButton('back-to-pick', 'Назад');
  const options = `<button class="bar-button round" data-action="learn-options" aria-label="Настройки режима">${svg('options')}</button>`;
  const { known, learning, total } = setSummary(set);

  if (learn.phase === 'done') {
    app.innerHTML = `${bar(back)}<section class="done">
      <div class="done-mark">${svg('check')}</div>
      <h1>Набор выучен</h1>
      <p>Все ${countLabel(total)} в группе «Выучено». Верных ответов: ${learn.stats.correct}, ошибок: ${learn.stats.wrong}${learn.bestStreak >= STREAK_FROM ? `, лучшая серия: ${learn.bestStreak}` : ''}.</p>
      <button class="button primary wide" data-action="learn-reset">Пройти заново</button>
      <button class="button tinted wide" data-action="modes">К режимам</button>
    </section>`;
    return;
  }

  if (learn.phase === 'round') {
    app.innerHTML = `${bar(back, '', `<span class="counter">Раунд ${learn.round}</span>`)}<section class="done">
      <div class="done-mark">${svg('check')}</div>
      <h1>Раунд ${learn.round} пройден</h1>
      <p>Верных ответов: ${learn.roundStats.correct} · ошибок: ${learn.roundStats.wrong}</p>
      ${progressBars(set)}
      <button class="button primary wide" data-action="learn-next">Продолжить</button>
      <button class="button tinted wide" data-action="modes">Закончить</button>
    </section>`;
    return;
  }

  const { card, answer, written, options: choices, given, verdict } = learn.current;
  const feedback = learn.phase === 'feedback';
  const streak = learn.streak >= STREAK_FROM ? `<span class="streak">${svg('streak')}Серия ${learn.streak}</span>` : '';
  const [promptLabel, answerLabel] = faceLabels(learn.current.side);
  app.innerHTML = `${bar(back, options, `<span class="counter">Раунд ${learn.round}</span>`)}
    <div class="progress-track slim" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${known}" aria-label="Выучено ${known} из ${total}"><i class="known" style="width: ${(known / total) * 100}%"></i><i class="learning" style="width: ${(learning / total) * 100}%"></i></div>
    <div class="learn-top"><span class="counter"><b class="known">${known}</b> выучено · <b class="learning">${learning}</b> ещё учу · ${total - known - learning} не изучено</span>${streak}</div>
    <section class="prompt"><span class="face-label">${promptLabel}</span><p class="study-word">${escape(learnPrompt(card))}</p>${learn.current.hint ? `<p class="hint-line" aria-live="polite">${escape(maskHint(answer, learn.current.hint))}</p>` : ''}</section>
    ${written ? `<form class="learn-form" id="learn-form">
        <label class="field"><input id="learn-input" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Введите ответ" value="${escape(given)}" ${feedback ? 'disabled' : ''}><span class="field-label">${answerLabel}</span></label>
        ${feedback ? '' : `<div class="learn-actions"><button type="button" class="button tinted" data-action="learn-hint" ${learn.current.hint >= answer.length ? 'disabled' : ''}>${svg('bulb')}Подсказка</button><button type="button" class="button tinted" data-action="learn-skip">Не знаю</button><button type="submit" class="button primary">Ответить</button></div>`}
      </form>`
    : `<div class="choices">${choices.map((option, index) => {
        const mark = feedback && option === answer ? ' correct' : feedback && option === given ? ' wrong' : '';
        return `<button class="choice${mark}" data-choice="${escape(option)}" ${feedback ? 'disabled' : ''}><span class="choice-key">${index + 1}</span>${escape(option)}</button>`;
      }).join('')}</div>
      ${feedback ? '' : '<button class="button tinted wide" data-action="learn-skip">Не знаю</button>'}`}
    ${feedback ? `<div class="verdict ${verdict}">
        <strong>${verdict === 'correct' ? (learn.current.hint ? 'Верно, с подсказкой' : 'Верно') : verdict === 'almost' ? 'Почти верно' : 'Правильный ответ'}</strong>
        <p>${escape(answer)}${verdict === 'almost' ? ' — так пишется правильно, карточка вернётся' : verdict === 'correct' && learn.current.hint ? ' — карточка вернётся, ступень не засчитана' : ''}</p>
        ${verdict === 'correct' && !learn.current.hint ? '' : '<button class="button primary wide" data-action="learn-continue">Продолжить</button>'}
      </div>` : ''}
    <p class="study-hint keys">${written ? 'Enter — ответить · H — подсказка' : 'Клавиши 1–4 — выбрать вариант'}</p>`;
}

/* ---------- Events ---------- */

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action], [data-open], [data-mode], [data-pick], [data-choice]');
  if (!target) return;
  if (target.dataset.open) return go({ page: 'detail', setId: target.dataset.open });
  if (target.dataset.choice !== undefined) return submitAnswer(target.dataset.choice);
  if (target.dataset.pick) return go({ page: 'pick', mode: target.dataset.pick });
  if (target.dataset.mode) return target.dataset.mode === 'learn' ? beginLearn(target.dataset.set) : beginStudy(target.dataset.set);
  const actions = {
    sets: () => go({ page: 'sets' }),
    modes: () => go({ page: 'modes' }),
    'back-to-pick': () => go(screen.from ?? { page: 'modes' }),
    'study-set': () => openModePicker(screen.setId),
    sort: openSortSheet,
    create: () => openEditor(),
    edit: () => openEditor(screen.setId),
    'cancel-edit': leaveEditor,
    save: saveEditor,
    'add-card': addCard,
    'remove-card': () => removeCard(Number(target.closest('.card-editor').dataset.index)),
    'open-import': openImport,
    'delete-set': deleteSet,
    restart: () => beginStudy(study.setId),
    'repeat-learning': () => beginStudy(study.setId, [...study.round.learning]),
    'study-options': openStudyOptions,
    'learn-options': () => openStudyOptions({ tracking: false, restart: true }),
    'learn-next': nextRound,
    'learn-continue': continueLearn,
    'learn-skip': () => submitAnswer(''),
    'learn-hint': revealLearnHint,
    'learn-reset': resetLearnProgress,
    hint: revealHint,
    'reset-progress': resetProgress,
    'export-set': () => exportSet(screen.setId),
    sync: () => go({ page: 'sync' }),
    backup: backupAll,
    restore: () => document.querySelector('#restore-file').click(),
    'sign-in-google': async () => {
      try { await signInWithGoogle(); } catch (error) { showToast(`Не удалось войти: ${error.message}`); }
    },
    'sign-out': async () => { await signOutUser(); showToast('Вы вышли из аккаунта'); },
    'undo-sort': undoSort,
  };
  actions[target.dataset.action]?.();
});

document.addEventListener('input', (event) => {
  if (event.target.id === 'search') {
    query = event.target.value;
    const list = document.querySelector('#set-list');
    if (list) list.innerHTML = screen.page === 'pick' ? pickList() : setList();
    return;
  }
  if (!editor) return;
  const field = event.target;
  if (field.id === 'set-title') editor.title = field.value;
  const item = field.closest('.card-editor');
  if (item && field.name) editor.cards[Number(item.dataset.index)][field.name] = field.value;
  if (field.tagName !== 'TEXTAREA' || !field.closest('.editor')) return;
  editor.dirty = true;
  grow(field);
  const error = document.querySelector('#form-error');
  if (error) error.hidden = true;
});

document.addEventListener('pointerdown', (event) => {
  const handle = event.target.closest('.drag-handle');
  if (handle && editor && event.button === 0) {
    event.preventDefault();
    startCardDrag(event, handle);
  }
});

document.addEventListener('change', (event) => {
  const file = event.target.id === 'restore-file' ? event.target.files?.[0] : null;
  if (file) restoreBackup(file);
});

document.addEventListener('submit', async (event) => {
  if (event.target.id === 'sign-in-form') {
    event.preventDefault();
    const email = document.querySelector('#sign-in-email').value.trim();
    if (!email) return;
    try {
      await signIn(email);
      showToast(`Письмо отправлено на ${email}. Откройте ссылку из него на этом устройстве`);
    } catch (error) {
      showToast(`Не удалось отправить письмо: ${error.message}`);
    }
    return;
  }
  if (event.target.id !== 'learn-form') return;
  event.preventDefault();
  submitAnswer(document.querySelector('#learn-input').value);
});

document.addEventListener('keydown', (event) => {
  if (screen.page === 'learn' && learn && !event.metaKey && !event.ctrlKey) {
    if (learn.phase === 'feedback' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      return continueLearn();
    }
    if (learn.phase === 'question' && !learn.current.written && /^[1-9]$/.test(event.key)) {
      const option = learn.current.options[Number(event.key) - 1];
      if (option !== undefined) return submitAnswer(option);
    }
    if (learn.phase === 'question' && learn.current.written && (event.key === 'h' || event.key === 'р') && event.target.tagName !== 'INPUT') {
      event.preventDefault();
      return revealLearnHint();
    }
    if (event.key === 'Escape') return go({ page: 'modes' });
  }
  if (editor) {
    const handle = event.target.closest?.('.drag-handle');
    if (handle && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const from = Number(handle.closest('.card-editor').dataset.index);
      const to = from + (event.key === 'ArrowUp' ? -1 : 1);
      moveCard(from, to);
      document.querySelector(`.card-editor[data-index="${Math.max(0, Math.min(to, editor.cards.length - 1))}"] .drag-handle`)?.focus();
      return;
    }
    // Enter moves through the fields like Quizlet; a new card appears after the last one.
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.target.tagName === 'TEXTAREA') {
      event.preventDefault();
      const item = event.target.closest('.card-editor');
      if (!item) return focusCardField(0);
      const index = Number(item.dataset.index);
      if (event.target.name === 'term') return focusCardField(index, 'definition');
      if (index === editor.cards.length - 1) return addCard();
      return focusCardField(index + 1);
    }
  }
  if (screen.page === 'study' && study && study.index < study.queue.length && !event.metaKey && !event.ctrlKey) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      flipCard();
    } else if (event.key === 'h' || event.key === 'р') {
      event.preventDefault();
      revealHint();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      fling(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'Escape') go({ page: 'modes' });
  }
});

document.addEventListener('wheel', (event) => {
  if (screen.page !== 'study' || !study || study.index >= study.queue.length) return;
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) event.preventDefault();
  const direction = study.wheelSwipe({ deltaX: event.deltaX, deltaY: event.deltaY, time: event.timeStamp });
  if (direction) fling(direction);
}, { passive: false });

window.addEventListener('resize', () => { if (editor) growAll(); });
window.addEventListener('beforeunload', (event) => {
  if (!editor?.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

// Card ids created during migration must be persisted, or they change on every load.
if (sets.some((set) => set.cards.length)) save();
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js'));
render();
