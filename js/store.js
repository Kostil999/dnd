// Хранилище состояния в localStorage
const KEY = 'dnd-master-v1';

const defaults = () => ({
  settings: {
    apiKey: '',
    model: 'claude-opus-5-5',
    effort: 'low',
    voiceOn: true,
    turnOrder: true,
    voiceName: '',
    rate: 1.05,
    pitch: 0.9,
    style: 'Классическое фэнтези, приключения, юмор и опасность в равной мере',
  },
  characters: [],
  party: [],          // id персонажей в игре (до 4)
  game: { messages: [], log: [], partyHash: '', started: false },
  diceHistory: [],
});

export const state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = defaults();
    const s = JSON.parse(raw);
    return { ...d, ...s, settings: { ...d.settings, ...(s.settings || {}) }, game: { ...d.game, ...(s.game || {}) } };
  } catch (e) {
    console.error(e);
    return defaults();
  }
}

let t = null;
export function save(now = false) {
  clearTimeout(t);
  const doSave = () => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { console.error('save failed', e); }
  };
  if (now) doSave(); else t = setTimeout(doSave, 250);
}

export function resetGame() {
  state.game = { messages: [], log: [], partyHash: '', started: false };
  save(true);
}

export function exportAll() {
  const copy = JSON.parse(JSON.stringify(state));
  copy.settings.apiKey = '';
  return JSON.stringify(copy, null, 1);
}

export function importAll(json) {
  const s = JSON.parse(json);
  const key = state.settings.apiKey;
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, defaults(), s);
  state.settings = { ...defaults().settings, ...(s.settings || {}), apiKey: key };
  save(true);
}

export const uid = () => Math.random().toString(36).slice(2, 10);
