// ИИ-мастер подземелий (Claude API) + голос (озвучка и распознавание речи)
import { state, save } from './store.js';

const SDK_URL = './vendor/anthropic-sdk.js'; // официальный @anthropic-ai/sdk 1.12.0, собран для браузера
let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) sdkPromise = import(SDK_URL).then((m) => m.default);
  return sdkPromise;
}

export const SYSTEM_PROMPT = `Ты — опытный Мастер подземелий (ДМ) и ведёшь живую игру Dungeons & Dragons 5-й редакции для группы до четырёх игроков, которые сидят за одним телефоном. Всё общение — на русском языке.

Твой текст зачитывается вслух синтезатором речи, поэтому:
- Пиши как рассказчик: живо, образно, но без длинных вступлений. Обычно 60–180 слов за ход; в напряжённых сценах короче, в важных описаниях можно длиннее.
- Не используй markdown, заголовки, списки, звёздочки, эмодзи и таблицы. Только связный текст абзацами.
- Числа и игровую механику упоминай кратко и естественно («гоблин промахивается», «вы получаете 7 урона»).

Правила:
- Строго следуй правилам D&D 5e (SRD): проверки к20 против СЛ, преимущество и помеха, инициатива, действие/бонусное действие/реакция/перемещение, атаки против КД, спасброски, состояния, концентрация, ячейки заклинаний, спасброски от смерти, отдых.
- Ты бросаешь кубики за монстров и NPC сам и честно сообщаешь результат. За персонажей игроков ты НИКОГДА не бросаешь — ты просишь бросок специальной меткой, и приложение даст игроку кнопку броска.
- Следи за хитами, ресурсами и позициями врагов сам. Хиты, золото, опыт и предметы героев меняй только специальными метками.
- Не решай за игроков, что делают или чувствуют их персонажи. Давай каждому игроку время в центре внимания.
- Каждый герой действует сам за себя. Группа может разделяться: если один герой куда-то пошёл, остальные ОСТАЮТСЯ на месте, пока каждый сам в свой ход не решит, что делать. Никогда не перемещай героя, который сам об этом не сказал, и не считай, что «группа пошла за ним». Отслеживай, где находится каждый герой: при каждом перемещении ставь метку [[МЕСТО: Имя | где он сейчас]]. Если герои в разных местах, описывай сцены раздельно и начинай с имени («Торин, у ворот ты слышишь…», «Тем временем Лира в таверне…»). В ход героя описывай то, что видит и слышит именно он там, где он находится. Сообщение от «Вся группа» относится только к героям, которые сейчас вместе.
- Всегда обращайся к героям по именам. NPC тоже обращаются к конкретному герою по имени, если знают его, или по приметам («эй, гном с секирой!», «ты, девушка в синем плаще»). Не обращайся безлично ко «всем» или «вам», если реплика адресована одному герою; если ко всем — перечисли их имена.
- В бою: в начале попроси броски инициативы, затем веди бой по очереди и в конце каждого хода называй, чей ход следующий.
- Если игрок пытается сделать невозможное по правилам — мягко объясни и предложи вариант.
- Герои ходят ПО ОЧЕРЕДИ. Вне боя передавай ход по кругу в порядке состава группы; в бою — по инициативе. В конце каждого ответа обращайся к тому, чей ход следующий («Торин, что ты делаешь?») и ставь метку [[ХОД: Имя]]. Если действие касается всей группы, можно поставить [[ХОД: Все]].
- Одна общая история и одно приключение, но у КАЖДОГО героя своя личная сюжетная линия, связанная с его предысторией, привязанностями и слабостями (поиск родственника, проклятие, старый враг, долг, пророчество и т.п.). В начале кампании придумай каждому герою личную цель и объяви её меткой [[ЦЕЛЬ: Имя | краткое описание]]. Вплетай личные линии в общий сюжет: в ход героя давай ему зацепки, встречи и выборы, которые продвигают ЕГО историю, и связывай линии героев друг с другом и с главным злодеем. Когда линия продвигается, обновляй метку [[ЦЕЛЬ: Имя | новое состояние]], когда завершена — [[ЦЕЛЬ: Имя | ✅ итог]]. Кульминации личных линий приходи к финалу приключения.

Специальные метки (пиши их отдельно, каждую в двойных квадратных скобках; они не зачитываются вслух):
[[БРОСОК: Имя | что бросить | СЛ N]] — попросить бросок у персонажа. «что бросить»: название навыка («Скрытность»), характеристики («Сила»), спасброска («спасбросок Ловкости»), «инициатива», атака оружием («атака Длинный меч»), «атака заклинанием», «спасбросок от смерти» или формула урона («2к6+3»). Можно добавить «с преимуществом» или «с помехой». СЛ можно не указывать (например, для атак, инициативы и урона).
[[ХИТЫ: Имя | -7]] или [[ХИТЫ: Имя | +5]] — урон или лечение героя.
[[ВРЕМХИТЫ: Имя | 5]] — временные хиты.
[[ОПЫТ: Все | 150]] или [[ОПЫТ: Имя | 50]] — начислить опыт.
[[ЗОЛОТО: Имя | +10]] — изменить золото.
[[ПРЕДМЕТ: Имя | Зелье лечения]] — выдать предмет.
[[СОСТОЯНИЕ: Имя | Отравлен]] — наложить состояние; [[СОСТОЯНИЕ: Имя | -Отравлен]] — снять.
[[ЯЧЕЙКА: Имя | 1]] — потратить ячейку заклинания указанного уровня.
[[ОТДЫХ: короткий]] или [[ОТДЫХ: долгий]] — группа отдохнула.
[[ХОД: Имя]] — чей ход следующий (обязательно в конце каждого ответа).
[[ЦЕЛЬ: Имя | текст]] — личная цель героя и её текущее состояние.
[[МЕСТО: Имя | где]] — где сейчас находится герой (ставь при каждом перемещении; в начале — для всех).
Используй точные имена персонажей. После запроса броска остановись и жди результата — не описывай исход заранее.

Игроки присылают сообщения вида «Имя: действие». Сообщения в квадратных скобках от «Система» содержат результаты бросков и актуальные листы персонажей — доверяй им.`;

// ---------- Озвучка ----------
let voices = [];
function loadVoices() { voices = window.speechSynthesis ? speechSynthesis.getVoices() : []; }
if (window.speechSynthesis) { loadVoices(); speechSynthesis.onvoiceschanged = loadVoices; }
const isRu = (v) => (v.lang && v.lang.toLowerCase().replace('_', '-').startsWith('ru')) || /милена|юрий|milena|yuri|katya|катя/i.test(v.name);
// Качество голоса по идентификатору (на iPhone улучшенные голоса называются так же, как обычные)
export function voiceQuality(v) {
  const id = `${v.voiceURI} ${v.name}`.toLowerCase();
  if (/premium|neural|natural/.test(id)) return 3;
  if (/enhanced|улучш|siri/.test(id)) return 2;
  if (/compact|eloquence|novelty|superstar|grandpa|grandma|bad news|bubbles|cellos|zarvox|whisper|jester|organ|trinoids|wobble|bells|boing|albert|fred|junior|kathy|ralph/.test(id)) return 0;
  return 1;
}
export const voiceLabel = (v) => `${v.name}${['', '', ' — улучшенный', ' — премиум'][voiceQuality(v)]}${v.localService === false ? ' (онлайн)' : ''}`;
export const voiceId = (v) => v.voiceURI || v.name;
export const ruVoices = () => voices.filter(isRu).sort((a, b) => voiceQuality(b) - voiceQuality(a));
export const allVoicesCount = () => voices.length;
export function refreshVoices() { loadVoices(); return ruVoices(); }
// Список с уникальными ключами: на iPhone у разных вариантов голоса бывают одинаковые имя и идентификатор
export function voiceList() {
  const seen = {};
  return ruVoices().map((v) => {
    const base = voiceId(v);
    seen[base] = (seen[base] || 0) + 1;
    const n = seen[base];
    return { v, key: `${base}#${n}`, label: voiceLabel(v) + (n > 1 || ruVoices().filter((x) => x.name === v.name).length > 1 ? ` · вариант ${ruVoices().filter((x) => x.name === v.name).indexOf(v) + 1}` : ''), uri: v.voiceURI || '' };
  });
}
function pickVoice(key) {
  const list = voiceList();
  if (!key) return list[0]?.v;
  return (list.find((x) => x.key === key) || list.find((x) => x.key.split('#')[0] === key) || list.find((x) => x.v.name === key) || list[0])?.v;
}

export function cleanForSpeech(text) {
  return text.replace(/\[\[[^\]]*\]\]/g, ' ').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
}

let speakQueueBusy = false;
const queue = [];
export function speak(text, { flush = false, voiceKey = null, force = false } = {}) {
  if ((!state.settings.voiceOn && !force) || !window.speechSynthesis) return;
  if (flush) stopSpeaking();
  const clean = cleanForSpeech(text);
  if (!clean) return;
  // Делим на куски по предложениям (длинные фразы обрываются в некоторых браузерах)
  const parts = clean.match(/[^.!?…]+[.!?…]*\s*/g) || [clean];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > 220 && buf) { queue.push({ text: buf, voiceKey }); buf = ''; }
    buf += p;
  }
  if (buf.trim()) queue.push({ text: buf, voiceKey });
  pump();
}
function pump() {
  if (speakQueueBusy || !queue.length) return;
  const item = queue.shift();
  const u = new SpeechSynthesisUtterance(item.text);
  u.lang = 'ru-RU';
  const v = pickVoice(item.voiceKey || state.settings.voiceName);
  if (v) { try { u.voice = v; u.lang = v.lang || 'ru-RU'; } catch (e) { /* голос недоступен — говорим голосом по умолчанию */ } }
  u.rate = Number(state.settings.rate) || 1;
  u.pitch = Number(state.settings.pitch) || 1;
  speakQueueBusy = true;
  u.onend = u.onerror = () => { speakQueueBusy = false; pump(); };
  speechSynthesis.speak(u);
}
export function stopSpeaking() {
  queue.length = 0;
  speakQueueBusy = false;
  if (window.speechSynthesis) speechSynthesis.cancel();
}
export const isSpeaking = () => speakQueueBusy || queue.length > 0;

// Потоковая озвучка: отдаём текст по мере прихода, произносим готовые предложения
export function createStreamSpeaker() {
  let pending = '';
  let inTag = false;
  return {
    push(delta) {
      for (const ch of delta) {
        // пропускаем содержимое [[...]]
        if (ch === '[') { inTag = true; continue; }
        if (inTag) { if (ch === ']') inTag = false; continue; }
        pending += ch;
      }
      const m = pending.match(/^[\s\S]*[.!?…]\s/);
      if (m && m[0].length > 40) { speak(m[0]); pending = pending.slice(m[0].length); }
    },
    end() { if (pending.trim()) speak(pending); pending = ''; },
  };
}

// ---------- Распознавание речи ----------
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
let rec = null;
export function listen({ onText, onEnd, onError }) {
  if (!SR) { onError?.('Распознавание речи не поддерживается этим браузером. Попробуйте Chrome (Android) или Safari (iOS).'); return null; }
  stopSpeaking();
  rec = new SR();
  rec.lang = 'ru-RU';
  rec.interimResults = true;
  rec.continuous = true;
  let finalText = '';
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' ';
      else interim += r[0].transcript;
    }
    onText?.((finalText + interim).trim());
  };
  rec.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') onError?.('Ошибка микрофона: ' + e.error); };
  rec.onend = () => { rec = null; onEnd?.(finalText.trim()); };
  rec.start();
  return rec;
}
export function stopListening() { if (rec) rec.stop(); }

// ---------- Запрос к Claude ----------
// Убираем из ответа блоки до границы fallback, которые нельзя возвращать (thinking/tool_use)
function echoContent(content) {
  const lastFb = content.map((b) => b.type).lastIndexOf('fallback');
  if (lastFb < 0) return content;
  return content.filter((b, i) => i >= lastFb || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

let currentStream = null;
export function abortDm() { try { currentStream?.abort(); } catch (e) { /* ignore */ } }

export async function askDm({ userText, onDelta }) {
  const s = state.settings;
  if (!s.apiKey) throw new Error('Добавьте API-ключ Anthropic в «Настройках», чтобы ИИ-мастер заработал.');
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true });

  const messages = state.game.messages;
  messages.push({ role: 'user', content: userText });
  save();

  const system = SYSTEM_PROMPT + (s.style ? `\n\nСтиль и тон кампании, заданный игроками: ${s.style}` : '');
  const params = {
    model: s.model,
    max_tokens: 16000,
    system: [{ type: 'text', text: system }],
    cache_control: { type: 'ephemeral' },
    output_config: { effort: s.effort || 'low' },
    messages,
  };
  // Серверный откат на другую модель, если сработает фильтр безопасности
  if (/^claude-(opus|sonnet|fable)/.test(s.model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  try {
    const stream = client.beta.messages.stream(params);
    currentStream = stream;
    stream.on('text', (delta) => onDelta?.(delta));
    const msg = await stream.finalMessage();
    currentStream = null;
    if (msg.stop_reason === 'refusal') {
      messages.pop();
      save();
      const err = new Error('Мастер отказался продолжать эту сцену (сработал фильтр безопасности). Попробуйте сформулировать действие иначе.');
      err.refusal = true;
      throw err;
    }
    messages.push({ role: 'assistant', content: echoContent(msg.content) });
    save();
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  } catch (e) {
    currentStream = null;
    if (messages.length && messages[messages.length - 1].role === 'user') { messages.pop(); save(); }
    if (e.refusal) throw e;
    let text = e?.message || String(e);
    if (e?.status === 401) text = 'Неверный API-ключ. Проверьте его в «Настройках».';
    else if (e?.status === 429) text = 'Слишком много запросов или закончился лимит. Подождите немного.';
    else if (e?.status === 529 || e?.status >= 500) text = 'Сервер ИИ перегружен. Попробуйте ещё раз через минуту.';
    else if (e?.name === 'APIUserAbortError') text = 'Остановлено.';
    else if (/Failed to fetch|NetworkError|import/i.test(text)) text = 'Нет соединения с интернетом или с сервером ИИ.';
    throw new Error(text);
  }
}
