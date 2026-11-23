import { state, save, resetGame, exportAll, importAll } from './store.js';
import { ABILITIES, SKILLS, RACES, CLASSES, BACKGROUNDS, ARMORS, SPELLS, ALIGNMENTS, STANDARD_ARRAY, POINT_BUY_COST, randomName } from './data.js';
import { RULES } from './rules.js';
import { rollFormula, parseFormula, fmtMod, d20 } from './dice.js';
import * as C from './character.js';
import * as DM from './dm.js';
import * as OFF from './offline.js';
import { genderOf, randomNameFor } from './backstory.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const ui = { tab: 'game', editId: null, speaker: null, busy: false, listening: false, diceMode: 'normal', diceCount: 1, diceMod: 0, diceToDm: false, rulesQuery: '' };

// ---------------- Общие ----------------
function toast(html, ms = 2200) {
  const t = $('#toast');
  t.innerHTML = html; t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
$('#toast').addEventListener('click', () => $('#toast').classList.add('hidden'));

function modal(html, onClick) {
  const m = $('#modal');
  m.innerHTML = `<div class="sheet">${html}</div>`;
  m.classList.remove('hidden');
  m.onclick = (e) => {
    if (e.target === m) return closeModal();
    onClick?.(e);
  };
}
function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

function switchTab(tab) {
  ui.tab = tab;
  OFF.closeSheet();
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((s) => s.classList.toggle('active', s.id === 'tab-' + tab));
  render();
}
document.querySelectorAll('#tabbar button').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

function render() {
  const titles = { game: 'Приключение', chars: 'Герои', dice: 'Кубики', rules: 'Правила D&D 5e', settings: 'Настройки' };
  $('#title').textContent = titles[ui.tab];
  $('#top-actions').innerHTML = '';
  ({ game: renderGame, chars: renderChars, dice: renderDice, rules: renderRules, settings: renderSettings })[ui.tab]();
}

const partyChars = () => state.party.map((id) => state.characters.find((c) => c.id === id)).filter(Boolean);
const charById = (id) => state.characters.find((c) => c.id === id);
function findCharByName(name) {
  const n = String(name).trim().toLowerCase();
  const party = partyChars();
  return party.find((c) => c.name.toLowerCase() === n)
    || party.find((c) => c.name.toLowerCase().split(' ')[0] === n.split(' ')[0])
    || party.find((c) => c.name.toLowerCase().includes(n) || n.includes(c.name.toLowerCase().split(' ')[0]));
}

// ======================================================================
// ИГРА
// ======================================================================
function partyHash() {
  return JSON.stringify(partyChars().map((c) => C.summary(c)));
}

function renderGame() {
  const root = $('#tab-game');
  const party = partyChars();
  const actions = $('#top-actions');
  actions.innerHTML = `
    <button class="btn icon" id="g-voice" title="Голос">${state.settings.voiceOn ? '🔊' : '🔇'}</button>
    <button class="btn icon" id="g-stop" title="Остановить">⏹</button>
    <button class="btn icon" id="g-menu" title="Меню">☰</button>`;
  $('#g-voice').onclick = () => { state.settings.voiceOn = !state.settings.voiceOn; if (!state.settings.voiceOn) DM.stopSpeaking(); save(); render(); };
  $('#g-stop').onclick = () => { DM.stopSpeaking(); DM.abortDm(); };
  $('#g-menu').onclick = gameMenu;
  root.onclick = null;

  if (!party.length) {
    root.innerHTML = `<div style="padding:16px">
      <div class="card center">
        <h2>Добро пожаловать, искатели приключений!</h2>
        <p>ИИ-мастер подземелий расскажет историю голосом, а вы говорите или пишете, что делают ваши герои.</p>
        <p class="muted">Сначала создайте до 4 персонажей и добавьте их в группу.</p>
        <p><b>⚡ Быстрый старт — сколько игроков?</b></p>
        <div class="row" style="justify-content:center;margin-bottom:12px">
          ${[1, 2, 3, 4].map((n) => `<button class="btn primary" data-quick="${n}" style="min-width:56px">${n}</button>`).join('')}
        </div>
        <button class="btn" id="g-tochars">🧝 Создать героев вручную</button>
      </div>
      <div class="card">
        <h3>Кто будет мастером?</h3>
        <div class="seg">
          <button id="m-off" class="${state.mode === 'offline' ? 'sel' : ''}">📖 Без ИИ (бесплатно, офлайн)</button>
          <button id="m-ai" class="${state.mode !== 'offline' ? 'sel' : ''}">🐉 ИИ-мастер</button>
        </div>
        <p class="muted">${state.mode === 'offline' ? 'Готовые и случайные приключения с озвучкой, проверками и боями. Ключ не нужен.' : 'ИИ сочиняет историю и отвечает на любые действия. Нужен API-ключ Anthropic (вкладка «Настройки»).'}</p>
      </div>
    </div>`;
    root.querySelectorAll('[data-quick]').forEach((b) => b.onclick = () => {
      const n = Number(b.dataset.quick);
      for (let i = 0; i < n; i++) {
        const c = C.randomCharacter();
        // имена в группе не повторяются
        const taken = () => state.characters.some((x) => x.id !== c.id && x.name.split(' ')[0] === c.name.split(' ')[0]);
        for (let k = 0; k < 30 && taken(); k++) c.name = randomNameFor(c.gender);
        c.player = `Игрок ${i + 1}`;
        state.characters.push(c); state.party.push(c.id);
      }
      save(); render();
      const word = n === 1 ? 'герой' : n < 5 ? 'героя' : 'героев';
      toast(`Создано: ${n} ${word}! Их можно отредактировать во вкладке «Герои».`, 3000);
    });
    $('#g-tochars').onclick = () => switchTab('chars');
    $('#m-off').onclick = () => { state.mode = 'offline'; save(); render(); };
    $('#m-ai').onclick = () => { state.mode = 'ai'; save(); render(); };
    return;
  }

  if (state.mode === 'offline') { OFF.render(root); return; }
  OFF.closeSheet();

  if (state.game.turnId) ui.speaker = state.game.turnId;
  if (!ui.speaker || (ui.speaker !== 'all' && !party.find((c) => c.id === ui.speaker))) ui.speaker = party[0].id;
  const strict = state.settings.turnOrder !== false && party.length > 1;
  const curName = ui.speaker === 'all' ? 'Вся группа' : (charById(ui.speaker)?.name.split(' ')[0] || '');
  const draft = $('#say')?.value || '';

  root.innerHTML = `
    <div id="party-bar">${party.map((c) => {
      const pct = Math.max(0, Math.min(100, (c.hpCur / Math.max(1, c.hpMax)) * 100));
      return `<button class="pchip mini ${c.id === ui.speaker ? 'sel' : ''}" data-pc="${c.id}">
        <b>${esc(c.emoji)} ${esc(c.name.split(' ')[0])} <span class="muted" style="font-weight:400">❤${c.hpCur}/${c.hpMax}${c.hpTemp ? '+' + c.hpTemp : ''}</span></b>
        ${c.location ? `<span class="muted loc">📍 ${esc(c.location)}</span>` : ''}
        <div class="hpbar"><i style="width:${pct}%;background:${pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--gold)' : 'var(--green)'}"></i></div>
      </button>`;
    }).join('')}</div>
    <div id="log"></div>
    <div id="composer">
      <div class="speaker-sel">
        ${strict ? '<span style="align-self:center">Ход:</span>' : ''}
        ${party.map((c) => `<button data-spk="${c.id}" class="${c.id === ui.speaker ? 'sel' : ''}" ${strict && c.id !== ui.speaker ? 'style="opacity:.45"' : ''}>${esc(c.name.split(' ')[0])}</button>`).join('')}
        <button data-spk="all" class="${ui.speaker === 'all' ? 'sel' : ''}">Вся группа</button>
        ${strict ? '<button data-spk="skip">⏭ Пропустить</button>' : ''}
      </div>
      <div class="row">
        <button class="btn icon ${ui.listening ? 'on' : ''}" id="mic" title="Сказать голосом">🎤</button>
        <textarea id="say" rows="1" placeholder="${state.game.started ? (ui.speaker === 'all' ? 'Что делает группа?' : `${esc(curName)}, что ты делаешь?`) : 'Нажмите «Начать приключение» или опишите, с чего начать…'}"></textarea>
        <button class="btn primary icon" id="send" ${ui.busy ? 'disabled' : ''}>➤</button>
      </div>
    </div>`;

  renderLog();
  $('#say').value = draft;

  root.querySelectorAll('[data-pc]').forEach((b) => b.onclick = () => showQuickSheet(b.dataset.pc));
  root.querySelectorAll('[data-spk]').forEach((b) => b.onclick = () => {
    const v = b.dataset.spk;
    if (v === 'skip') { const was = curName; nextTurn(); pushLog({ type: 'sys', text: `${was} пропускает ход` }); renderGame(); return; }
    if (strict && v !== 'all' && v !== ui.speaker) { toast(`Сейчас ход: ${esc(curName)}. Можно нажать «⏭ Пропустить».`); return; }
    setTurn(v); renderGame();
  });
  const say = $('#say');
  say.addEventListener('input', () => { say.style.height = 'auto'; say.style.height = Math.min(120, say.scrollHeight) + 'px'; });
  say.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) { e.preventDefault(); sendPlayer(); } });
  $('#send').onclick = sendPlayer;
  $('#mic').onclick = toggleMic;
}

// ---------- Очерёдность ходов (ИИ-мастер) ----------
function setTurn(id) { ui.speaker = id; state.game.turnId = id; save(); }
function nextTurn() {
  const party = partyChars();
  if (!party.length) return;
  const i = party.findIndex((c) => c.id === ui.speaker);
  for (let k = 1; k <= party.length; k++) {
    const c = party[((i < 0 ? -1 : i) + k) % party.length];
    if (c.hpCur > 0 || party.every((x) => x.hpCur <= 0)) { setTurn(c.id); return; }
  }
}

function renderLog() {
  const log = $('#log');
  if (!log) return;
  const entries = state.game.log;
  let html = '';
  if (!entries.length) {
    html = `<div class="card center" style="margin:auto">
      <h3>Новое приключение</h3>
      <p class="muted">Стиль кампании: ${esc(state.settings.style || 'на усмотрение мастера')}</p>
      <label class="f">Завязка (по желанию)</label>
      <textarea id="hook" placeholder="Например: таверна в портовом городе, пропала дочь мэра…"></textarea>
      <br><br><button class="btn primary" id="g-start" ${ui.busy ? 'disabled' : ''}>🐉 Начать приключение</button>
      ${!state.settings.apiKey ? '<p class="muted">🔑 Для ИИ-мастера нужен API-ключ (вкладка «Настройки»).</p>' : ''}
      <br><br><button class="btn" id="g-offline">📖 Играть без ИИ (бесплатно, офлайн)</button>
    </div>`;
  }
  entries.forEach((e, i) => { html += renderEntry(e, i); });
  log.innerHTML = html;
  const st = $('#g-start');
  if (st) st.onclick = () => startAdventure($('#hook').value.trim());
  const go = $('#g-offline');
  if (go) go.onclick = () => { state.mode = 'offline'; save(); renderGame(); };
  log.onclick = (e) => {
    const rq = e.target.closest('[data-req]');
    if (rq) {
      const [ei, ri] = rq.dataset.req.split(':').map(Number);
      if (state.game.log[ei]?.streaming) return toast('Дождитесь, пока мастер закончит');
      doRequestedRoll(ei, ri);
      return;
    }
    const sp = e.target.closest('[data-speak]');
    if (sp) DM.speak(state.game.log[+sp.dataset.speak].text, { flush: true });
  };
  log.scrollTop = log.scrollHeight;
}

const TAG_RE = /\[\[\s*([А-ЯЁA-Z]+)\s*:\s*([^\]]*?)\s*\]\]/g;
function parseTags(text) {
  const tags = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text)) !== null) {
    tags.push({ kind: m[1].toUpperCase(), args: m[2].split('|').map((s) => s.trim()), raw: m[0] });
  }
  return tags;
}

function renderEntry(e, i) {
  if (e.type === 'dm') {
    let reqIdx = 0;
    const body = esc(e.text).replace(/\[\[\s*([А-ЯЁA-Z]+)\s*:\s*([^\]]*?)\s*\]\]/g, (all, kind, args) => {
      const a = args.split('|').map((s) => s.trim());
      if (kind.toUpperCase() === 'БРОСОК') {
        const ri = reqIdx++;
        const done = e.done && e.done[ri];
        let odds = '';
        const rc = findCharByName(a[0]);
        if (rc && !done && a[1] && !/\d+\s*[кd]\s*\d+/i.test(a[1])) {
          const chk = C.resolveCheck(rc, a[1].replace(/&[a-z]+;/g, ''));
          const dc = parseInt(String(a[2] || '').replace(/\D+/g, ''), 10);
          const pct = dc ? Math.max(0, Math.min(100, Math.round(((21 - (dc - chk.mod)) / 20) * 100))) : null;
          odds = ` <span style="opacity:.85">(${fmtMod(chk.mod)}${pct !== null ? `, шанс ${pct}%` : ''})</span>`;
        }
        return `<span class="req ${done ? 'done' : ''}"><button class="btn small" data-req="${i}:${ri}" ${done ? 'disabled' : ''}>🎲 ${a[0]}: ${a[1] || ''}${a[2] ? ' · ' + a[2] : ''}${odds}${done ? ' → ' + esc(done) : ''}</button></span>`;
      }
      return `<span class="tag">${kind}: ${a.join(' ')}</span>`;
    });
    return `<div class="msg dm" data-entry="${i}"><span class="who">🐉 Мастер <button class="btn small" data-speak="${i}" style="float:right;padding:0 6px">🔈</button></span>${body}${e.streaming ? '<span class="typing"></span>' : ''}</div>`;
  }
  if (e.type === 'player') return `<div class="msg player"><span class="who">${esc(e.who)}</span>${esc(e.text)}</div>`;
  if (e.type === 'roll') return `<div class="msg roll">${e.html}</div>`;
  if (e.type === 'err') return `<div class="msg err">⚠️ ${esc(e.text)}</div>`;
  return `<div class="msg sys">${esc(e.text)}</div>`;
}

function pushLog(entry) { state.game.log.push(entry); save(); }

function toggleMic() {
  if (ui.listening) { DM.stopListening(); return; }
  const say = $('#say');
  const before = say.value ? say.value + ' ' : '';
  const r = DM.listen({
    onText: (t) => { say.value = before + t; },
    onEnd: () => { ui.listening = false; $('#mic')?.classList.remove('on'); },
    onError: (msg) => { ui.listening = false; $('#mic')?.classList.remove('on'); toast(esc(msg), 4000); },
  });
  if (r) { ui.listening = true; $('#mic').classList.add('on'); }
}

function systemPrefix(force = false) {
  const parts = [];
  const h = partyHash();
  if (force || h !== state.game.partyHash) {
    parts.push('[Система: актуальные листы персонажей]\n' + partyChars().map((c) => '• ' + C.summary(c)).join('\n'));
    state.game.partyHash = h;
  }
  if (state.game.summary) {
    parts.push('[Система: краткое содержание прошлых событий]\n' + state.game.summary);
    state.game.summary = '';
  }
  if (state.game.pending?.length) {
    parts.push('[Система: результаты бросков]\n' + state.game.pending.join('\n'));
    state.game.pending = [];
  }
  return parts.join('\n\n');
}

async function startAdventure(hook) {
  state.game.started = true;
  const text = `${systemPrefix(true)}\n\n[Система] Начинаем новую кампанию.${hook ? ' Пожелания игроков к завязке: ' + hook : ''} Представь мир и начни с яркой завязки, которая сразу вовлекает всех героев. Кратко познакомь героев друг с другом через сцену. Придумай каждому герою личную сюжетную линию (метки [[ЦЕЛЬ: …]]), отметь, где находится каждый герой (метки [[МЕСТО: …]]), и передай ход первому герою (метка [[ХОД: …]]).`;
  pushLog({ type: 'sys', text: '— Начало приключения —' });
  await runDm(text);
}

async function sendPlayer() {
  if (ui.busy) return;
  if (ui.listening) DM.stopListening();
  const say = $('#say');
  if (!say) return;
  const raw = say.value.trim();
  const hasPending = state.game.pending?.length;
  if (!raw && !hasPending) return;
  say.value = '';
  let line = '';
  if (raw) {
    const who = ui.speaker === 'all' ? 'Вся группа' : (charById(ui.speaker)?.name || 'Игрок');
    pushLog({ type: 'player', who, text: raw });
    line = `${who}: ${raw}`;
    // ход переходит к следующему герою (мастер может переопределить меткой [[ХОД: …]])
    if (state.settings.turnOrder !== false && ui.speaker !== 'all') nextTurn();
  }
  if (!state.game.started) {
    state.game.started = true;
    const text = `${systemPrefix(true)}\n\n[Система] Начинаем новую кампанию. ${raw ? 'Пожелания игроков: ' + raw : ''} Начни с яркой завязки.`;
    await runDm(text);
    return;
  }
  const prefix = systemPrefix();
  await runDm([prefix, line].filter(Boolean).join('\n\n'));
}

async function runDm(userText) {
  ui.busy = true;
  DM.stopSpeaking();
  const turnStart = state.game.log.length;
  state.game.turns = state.game.turns || [];
  const entry = { type: 'dm', text: '', streaming: true, done: {} };
  state.game.log.push(entry);
  const idx = state.game.log.length - 1;
  renderGame();
  const speaker = DM.createStreamSpeaker();
  let raf = null;
  try {
    const full = await DM.askDm({
      userText,
      onDelta: (d) => {
        entry.text += d;
        speaker.push(d);
        if (!raf) raf = requestAnimationFrame(() => { raf = null; updateStreamingEntry(idx); });
      },
    });
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    entry.text = full;
    entry.streaming = false;
    speaker.end();
    state.game.turns.push({ logLen: turnStart });
    applyTags(entry);
  } catch (e) {
    DM.stopSpeaking();
    state.game.partyHash = '';
    state.game.log.splice(idx, 1);
    pushLog({ type: 'err', text: e.message });
  }
  ui.busy = false;
  save();
  if (ui.tab === 'game') renderGame();
}

function updateStreamingEntry(idx) {
  const log = $('#log');
  if (!log) return;
  const node = log.querySelector(`.msg[data-entry="${idx}"]`);
  if (!node || !state.game.log[idx]?.streaming) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderEntry(state.game.log[idx], idx);
  node.replaceWith(tmp.firstElementChild);
  log.scrollTop = log.scrollHeight;
}

function targetsFor(name) {
  if (/^(все|всем|группа|вся группа)$/i.test(name.trim())) return partyChars();
  const c = findCharByName(name);
  return c ? [c] : [];
}

function applyTags(entry) {
  const tags = parseTags(entry.text);
  const notes = [];
  for (const t of tags) {
    const [who, val] = t.args;
    switch (t.kind) {
      case 'ХИТЫ': {
        const n = parseInt(String(val).replace('−', '-'), 10);
        if (isNaN(n)) break;
        targetsFor(who).forEach((c) => {
          if (n < 0) {
            let dmg = -n;
            const fromTemp = Math.min(c.hpTemp || 0, dmg);
            c.hpTemp = (c.hpTemp || 0) - fromTemp; dmg -= fromTemp;
            c.hpCur = Math.max(0, c.hpCur - dmg);
            if (c.hpCur === 0 && !/без сознания/i.test(c.conditions)) c.conditions = [c.conditions, 'Без сознания'].filter(Boolean).join(', ');
            notes.push(`${c.name}: −${-n} хитов (${c.hpCur}/${c.hpMax})`);
          } else {
            const wasZero = c.hpCur === 0;
            c.hpCur = Math.min(c.hpMax, c.hpCur + n);
            if (wasZero && c.hpCur > 0) { c.conditions = removeCond(c.conditions, 'Без сознания'); c.deathS = 0; c.deathF = 0; }
            notes.push(`${c.name}: +${n} хитов (${c.hpCur}/${c.hpMax})`);
          }
        });
        break;
      }
      case 'ВРЕМХИТЫ': {
        const n = parseInt(val, 10) || 0;
        targetsFor(who).forEach((c) => { c.hpTemp = Math.max(c.hpTemp || 0, n); notes.push(`${c.name}: ${n} временных хитов`); });
        break;
      }
      case 'ОПЫТ': {
        const n = parseInt(val, 10) || 0;
        targetsFor(who).forEach((c) => {
          c.xp = (Number(c.xp) || 0) + n;
          const need = XP_TABLE[c.level];
          notes.push(`${c.name}: +${n} опыта${need && c.xp >= need ? ' — можно повысить уровень!' : ''}`);
        });
        break;
      }
      case 'ЗОЛОТО': {
        const n = parseInt(String(val).replace('−', '-'), 10) || 0;
        targetsFor(who).forEach((c) => { c.gold = Math.max(0, (Number(c.gold) || 0) + n); notes.push(`${c.name}: ${n >= 0 ? '+' : ''}${n} зм`); });
        break;
      }
      case 'ПРЕДМЕТ':
        targetsFor(who).forEach((c) => { c.equipment = (c.equipment ? c.equipment + '\n' : '') + val; notes.push(`${c.name} получает: ${val}`); });
        break;
      case 'СОСТОЯНИЕ':
        targetsFor(who).forEach((c) => {
          if (String(val).startsWith('-')) { c.conditions = removeCond(c.conditions, val.slice(1).trim()); notes.push(`${c.name}: снято «${val.slice(1).trim()}»`); }
          else { c.conditions = [c.conditions, val].filter(Boolean).join(', '); notes.push(`${c.name}: ${val}`); }
        });
        break;
      case 'ЯЧЕЙКА': {
        const lvl = parseInt(val, 10) || 1;
        targetsFor(who).forEach((c) => { c.slotsUsed = c.slotsUsed || []; c.slotsUsed[lvl - 1] = (c.slotsUsed[lvl - 1] || 0) + 1; notes.push(`${c.name}: потрачена ячейка ${lvl} ур.`); });
        break;
      }
      case 'ХОД': {
        if (/^(все|всем|группа|вся группа)$/i.test(String(who).trim())) { setTurn('all'); break; }
        const c = findCharByName(who);
        if (c) setTurn(c.id);
        break;
      }
      case 'МЕСТО':
        targetsFor(who).forEach((c) => { c.location = val || ''; });
        break;
      case 'ЦЕЛЬ':
        targetsFor(who).forEach((c) => { c.quest = val || ''; notes.push(`⭐ ${c.name}: ${val}`); });
        break;
      case 'ОТДЫХ':
        partyChars().forEach((c) => rest(c, /долг/i.test(who)));
        notes.push(/долг/i.test(who) ? 'Долгий отдых: хиты и ячейки восстановлены' : 'Короткий отдых');
        break;
      default: break;
    }
  }
  if (notes.length) { pushLog({ type: 'sys', text: notes.join(' · ') }); save(); }
}

function removeCond(list, cond) {
  return String(list || '').split(',').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== cond.toLowerCase()).join(', ');
}

function rest(c, long) {
  if (long) {
    c.hpCur = c.hpMax; c.hpTemp = 0; c.slotsUsed = []; c.deathS = 0; c.deathF = 0;
    c.hdUsed = Math.max(0, (c.hdUsed || 0) - Math.max(1, Math.floor(c.level / 2)));
    c.conditions = removeCond(c.conditions, 'Без сознания');
  } else if (c.classId === 'warlock') c.slotsUsed = [];
}

const XP_TABLE = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

function rollHtml(who, label, r, extra = '') {
  const cls = r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : '';
  return `<b>${esc(who)}</b> · ${esc(label)}${r.mode === 'adv' ? ' (преим.)' : r.mode === 'dis' ? ' (помеха)' : ''}<br>
    <span class="${cls}" style="font-size:1.6rem;font-weight:800;color:var(--gold)">${r.total}</span>
    <span class="muted">${r.details}</span>${r.nat === 20 ? ' <b class="crit">КРИТ!</b>' : r.nat === 1 ? ' <b class="fumble">Провал!</b>' : ''}${extra}`;
}

function doRequestedRoll(ei, ri) {
  const entry = state.game.log[ei];
  const reqs = parseTags(entry.text).filter((t) => t.kind === 'БРОСОК');
  const req = reqs[ri];
  if (!req || (entry.done && entry.done[ri])) return;
  const [name, whatRaw = '', dcRaw = ''] = req.args;
  const what = whatRaw;
  const mode = /преимущ/i.test(what) ? 'adv' : /помех/i.test(what) ? 'dis' : 'normal';
  const c = findCharByName(name);
  let r; let label;
  const formulaMatch = what.match(/\d*\s*[кd]\s*\d+(\s*[+\-−]\s*\d+)?/i);
  if (formulaMatch && !/к20/i.test(formulaMatch[0]) && parseFormula(formulaMatch[0])) {
    r = rollFormula(formulaMatch[0], 'normal'); label = what;
  } else if (c) {
    const chk = C.resolveCheck(c, what);
    r = d20(chk.mod, mode); label = chk.label;
  } else {
    r = d20(0, mode); label = what || 'к20';
  }
  const dc = parseInt(String(dcRaw).replace(/\D+/g, ''), 10);
  let verdict = '';
  if (!isNaN(dc) && dc) verdict = r.total >= dc ? ' ✅' : ' ❌';
  entry.done = entry.done || {}; entry.done[ri] = `${r.total}${verdict}`;
  const who = c ? c.name : name;
  pushLog({ type: 'roll', html: rollHtml(who, label, r) });
  state.game.pending = state.game.pending || [];
  state.game.pending.push(`${who} — ${label}: ${r.total} (${r.details.replace(/<\/?s>/g, '')})${r.nat === 20 ? ' натуральная 20!' : r.nat === 1 ? ' натуральная 1!' : ''}`);
  save();
  toast(`<div>${esc(who)} · ${esc(label)}</div><div class="big ${r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : ''}">${r.total}</div>`, 1600);
  // если это последний ДМ-ответ и все броски выполнены — отправляем автоматически
  const isLastDm = state.game.log.map((e) => e.type).lastIndexOf('dm') === ei;
  if (isLastDm && reqs.every((_, k) => entry.done[k]) && !ui.busy) {
    setTimeout(() => sendPlayer(), 700);
  }
  renderGame();
}

function gameMenu() {
  if (state.mode === 'offline') {
    modal(`<h3>Меню (мастер без ИИ)</h3><div style="display:grid;gap:8px">
      <button class="btn" data-m="help">❓ Как играть</button>
      <button class="btn" data-m="repeat">🔁 Повторить последний рассказ</button>
      <button class="btn" data-m="list">📚 Выбрать другое приключение</button>
      <button class="btn" data-m="ai">🐉 Переключиться на ИИ-мастера</button>
      <button class="btn" data-m="close">Закрыть</button></div>`, (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      closeModal();
      if (m === 'help') setTimeout(showOfflineHelp, 50);
      if (m === 'repeat') OFF.repeatLast();
      if (m === 'list' && confirm('Выйти из текущего приключения?')) { OFF.quit(); renderGame(); }
      if (m === 'ai') { DM.stopSpeaking(); state.mode = 'ai'; save(); renderGame(); }
    });
    return;
  }
  modal(`
    <h3>Меню игры</h3>
    <div style="display:grid;gap:8px">
      <button class="btn" data-m="repeat">🔁 Повторить последний рассказ</button>
      <button class="btn" data-m="undo">↩️ Отменить последний ход</button>
      <button class="btn" data-m="sheets">📋 Отправить мастеру листы персонажей</button>
      <button class="btn" data-m="offline">📖 Играть без ИИ</button>
      <button class="btn" data-m="compress">🗜 Сжать историю (дешевле и быстрее)</button>
      <button class="btn danger" data-m="new">🆕 Новое приключение</button>
      <button class="btn" data-m="close">Закрыть</button>
    </div>`, async (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    closeModal();
    if (m === 'repeat') {
      const last = [...state.game.log].reverse().find((x) => x.type === 'dm');
      if (last) DM.speak(last.text, { flush: true });
    } else if (m === 'undo') {
      undoTurn();
    } else if (m === 'sheets') {
      state.game.partyHash = '';
      toast('Листы будут отправлены с вашим следующим сообщением');
    } else if (m === 'offline') {
      DM.stopSpeaking(); state.mode = 'offline'; save(); renderGame();
    } else if (m === 'compress') {
      compressHistory();
    } else if (m === 'new') {
      if (confirm('Начать новое приключение? Текущая история будет удалена (персонажи останутся).')) { DM.stopSpeaking(); resetGame(); render(); }
    }
  });
}

function undoTurn() {
  const msgs = state.game.messages;
  const turns = state.game.turns || [];
  if (msgs.length < 2 || !turns.length) return toast('Нечего отменять');
  msgs.pop(); msgs.pop();
  const t = turns.pop();
  // вернуть видимый лог к состоянию до хода (оставив сообщение игрока на месте нельзя — убираем и его)
  let cut = t.logLen;
  while (cut > 0 && ['player', 'roll'].includes(state.game.log[cut - 1].type)) cut--;
  state.game.log.length = cut;
  state.game.pending = [];
  if (!msgs.length) state.game.started = false;
  save(); renderGame();
  toast('Ход отменён (изменения хитов/предметов не откатываются)');
}

async function compressHistory() {
  if (state.game.messages.length < 4) return toast('История ещё короткая');
  if (ui.busy) return;
  ui.busy = true;
  toast('Сжимаю историю…', 60000);
  try {
    // временно добавляем запрос пересказа (не сохраняем его в историю)
    const saved = state.game.messages.slice();
    const summary = await DM.askDm({ userText: '[Система] Сделай подробный, но сжатый пересказ всей истории кампании до текущего момента для продолжения игры: мир, ключевые NPC, сюжетные нити, текущая сцена, состояние врагов, что знают и чем владеют герои. Без меток [[...]]. Это служебный запрос — не продолжай сцену.' });
    state.game.messages = [];
    state.game.summary = summary + '\n\nПоследний рассказ мастера: ' + ([...saved].reverse().find((m) => m.role === 'assistant')?.content?.filter?.((b) => b.type === 'text').map((b) => b.text).join('') || '');
    state.game.partyHash = '';
    state.game.turns = [];
    pushLog({ type: 'sys', text: '— История сжата, игра продолжается —' });
    toast('Готово! История сжата.');
  } catch (e) {
    toast('Не получилось: ' + esc(e.message), 4000);
  }
  ui.busy = false; save(); renderGame();
}

// Предметы инвентаря: по строкам и запятым, без служебной строки предыстории
function invItems(c) {
  return String(c.equipment || '').split(/\n|,\s*/).map((x) => x.trim()).filter((x) => x && !/^Предыстория:/.test(x));
}

function showQuickSheet(id, keepScroll = false) {
  const c = charById(id);
  if (!c) return;
  const k = C.klass(c); const r = C.race(c); const b = C.bg(c);
  const si = C.spellInfo(c);
  const tab = ui.sheetTab || 'stats';
  const prevScroll = keepScroll ? ($('#modal .sheet')?.scrollTop || 0) : 0;
  const pct = Math.max(0, Math.min(100, (c.hpCur / Math.max(1, c.hpMax)) * 100));
  const tabs = [['stats', '💪 Характеристики'], ['abil', '✨ Способности'], ['inv', '🎒 Инвентарь']];

  let body = '';
  if (tab === 'stats') {
    body = `
      <div class="abil-grid">${ABILITIES.map((a) => `<button class="abil" data-q="ab:${a.id}"><div class="nm">${a.name}</div><div class="mod">${fmtMod(C.mod(c, a.id))}</div><div class="det">${C.score(c, a.id)}</div></button>`).join('')}</div>
      <h4>Спасброски</h4>
      ${ABILITIES.map((a) => `<div class="skill-row" data-q="sv:${a.id}"><span class="val">${fmtMod(C.saveMod(c, a.id))}</span><span class="nm">${k.saves.includes(a.id) ? '● ' : ''}${a.name}</span></div>`).join('')}
      <h4>Навыки <span class="muted">(● — владение, нажмите, чтобы бросить)</span></h4>
      ${SKILLS.map((s) => `<div class="skill-row" data-q="sk:${s.id}"><span class="val">${fmtMod(C.skillMod(c, s.id))}</span><span class="nm">${C.allSkillProfs(c).has(s.id) ? '● ' : ''}${s.name}${c.expertise.includes(s.id) ? ' ★' : ''}</span><span class="ab">${ABILITIES.find((a) => a.id === s.ab).short}</span></div>`).join('')}
      <h4>Атаки <span class="muted">(нажмите — атака и урон)</span></h4>
      ${c.attacks.map((a, i) => `<div class="skill-row" data-q="atk:${i}"><span class="val">${esc(a.bonus)}</span><span class="nm">${esc(a.name)}</span><span class="ab">${esc(a.dmg)}</span></div>`).join('') || '<p class="muted">Нет атак</p>'}
      <p class="muted">Владения: доспехи — ${esc(k.armor)}; оружие — ${esc(k.weapons)}.</p>`;
  } else if (tab === 'abil') {
    const spells = c.spells.map((n) => SPELLS.find((x) => x.name === n) || { name: n, lvl: '?', desc: '' });
    body = `
      ${c.quest ? `<div class="card" style="border-color:var(--gold)"><b>⭐ Личная история</b><br>${esc(c.quest)}</div>` : ''}
      ${si ? `<h4>Заклинания</h4>
        <p>${ABILITIES.find((a) => a.id === si.ab).name} · СЛ спасброска <b>${si.dc}</b> · атака <b>${fmtMod(si.atk)}</b></p>
        <div class="slots">${si.slots.map((n, i) => n ? `<div class="slot">${i + 1} ур.: <span class="pips">${Array.from({ length: n }, (_, j) => `<span class="pip ${j < ((c.slotsUsed || [])[i] || 0) ? 'used' : ''}" data-q="slot:${i}:${j}"></span>`).join('')}</span></div>` : '').join('') || '<span class="muted">Ячеек пока нет</span>'}</div>
        <p class="muted">Нажмите на кружок, чтобы отметить потраченную ячейку.</p>
        ${[0, 1].map((l) => spells.filter((x) => x.lvl === l).length ? `<p class="muted">${l === 0 ? 'Заговоры' : '1 уровень'}</p>` + spells.filter((x) => x.lvl === l).map((x) => `<div class="spell-item"><span><b>${esc(x.name)}</b><br><span class="muted">${esc(x.desc)}</span></span></div>`).join('') : '').join('')}
        ${c.customSpells ? `<p><b>Другие:</b> ${esc(c.customSpells)}</p>` : ''}
        ${!spells.length && !c.customSpells ? '<p class="muted">Заклинания не выбраны</p>' : ''}` : ''}
      <h4>${esc(k.name)} ${c.level} ур.</h4>
      <ul>${C.features(c).map((f) => `<li><span class="muted">${f.lvl} ур.</span> ${esc(f.name)}</li>`).join('')}</ul>
      <h4>${esc(r.name)}</h4>
      <ul>${r.traits.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      <h4>Предыстория: ${esc(b.name)}</h4>
      <p>Умение «${esc(b.feature)}». ${esc(b.extra)}.</p>
      ${[['Черты характера', c.traits], ['Идеалы', c.ideals], ['Привязанности', c.bonds], ['Слабости', c.flaws], ['Внешность', c.appearance], ['История', c.backstory], ['Заметки', c.notes]].filter(([, v]) => v).map(([t, v]) => `<p><b>${t}:</b> ${esc(v)}</p>`).join('')}`;
  } else {
    const items = invItems(c);
    body = `
      <div class="grid2">
        <div class="stat-box"><div class="v">${Number(c.gold) || 0}</div><div class="l">Золото (зм)</div></div>
        <div class="stat-box"><div class="v">${items.length}</div><div class="l">Предметов</div></div>
      </div>
      <div class="row" style="margin:8px 0">
        <button class="btn small" data-q="gold:-10">−10 зм</button><button class="btn small" data-q="gold:-1">−1</button>
        <button class="btn small" data-q="gold:1">+1</button><button class="btn small" data-q="gold:10">+10 зм</button>
      </div>
      <h4>Предметы</h4>
      ${items.map((it, i) => `<div class="skill-row"><span class="nm">• ${esc(it)}</span>${/зелье лечения/i.test(it) ? `<button class="btn small" data-q="potion:${i}">🧪 Выпить</button>` : ''}<button class="btn small" data-q="delitem:${i}">✕</button></div>`).join('') || '<p class="muted">Пусто</p>'}
      <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input type="text" id="newitem" placeholder="Новый предмет"><button class="btn small" data-q="additem">+ Добавить</button></div>
      <p class="muted">Доспех: ${esc(C.armor(c).name)}${c.shield ? ' + щит' : ''}.</p>`;
  }

  modal(`
    <div class="row" style="flex-wrap:nowrap"><div class="char-card"><div class="av">${esc(c.emoji)}</div></div>
      <div class="grow"><h3 style="margin:0">${esc(c.name)}</h3>
      <div class="muted">${esc(r.name)} · ${esc(k.name)} ${c.level} ур.${c.player ? ' · ' + esc(c.player) : ''}</div>
      ${c.location ? `<div class="muted">📍 ${esc(c.location)}</div>` : ''}</div>
      <button class="btn icon" data-q="close">✕</button></div>
    <div class="grid3" style="margin:10px 0">
      <div class="stat-box"><div class="v">${c.hpCur}/${c.hpMax}${c.hpTemp ? '+' + c.hpTemp : ''}</div><div class="l">Хиты</div><div class="hpbar"><i style="width:${pct}%;background:${pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--gold)' : 'var(--green)'}"></i></div></div>
      <div class="stat-box"><div class="v">${C.ac(c)}</div><div class="l">КД</div></div>
      <div class="stat-box" data-q="init"><div class="v">${fmtMod(C.initiative(c))}</div><div class="l">Инициатива 🎲</div></div>
      <div class="stat-box"><div class="v">${C.speed(c)}</div><div class="l">Скорость, фт.</div></div>
      <div class="stat-box"><div class="v">+${C.prof(c)}</div><div class="l">Бонус мастерства</div></div>
      <div class="stat-box"><div class="v">${C.passive(c)}</div><div class="l">Пасс. внимат.</div></div>
    </div>
    <div class="row" style="margin-bottom:8px">
      <button class="btn small" data-q="hp:-5">−5</button><button class="btn small" data-q="hp:-1">−1</button>
      <button class="btn small" data-q="hp:1">+1</button><button class="btn small" data-q="hp:5">+5</button>
      <span class="muted">Опыт: ${c.xp || 0}</span>
    </div>
    ${c.conditions ? `<p>⚠️ Состояния: <b>${esc(c.conditions)}</b></p>` : ''}
    <div class="seg" style="position:sticky;top:-16px;z-index:2;margin-bottom:10px">${tabs.map(([t, l]) => `<button data-q="tab:${t}" class="${tab === t ? 'sel' : ''}">${l}</button>`).join('')}</div>
    <div class="rules-body">${body}</div>
    <br><button class="btn" style="width:100%" data-q="close">Закрыть</button>`, (e) => {
    const q = e.target.closest('[data-q]')?.dataset.q;
    if (!q) return;
    const [cmd, a1, a2] = q.split(':');
    const refresh = () => { save(); showQuickSheet(id, true); if (ui.tab === 'game') renderGame(); };
    if (cmd === 'close') return closeModal();
    if (cmd === 'tab') { ui.sheetTab = a1; showQuickSheet(id); return; }
    if (cmd === 'hp') {
      const n = Number(a1);
      if (n < 0) { const fromTemp = Math.min(c.hpTemp || 0, -n); c.hpTemp = (c.hpTemp || 0) - fromTemp; c.hpCur = Math.max(0, c.hpCur + n + fromTemp); }
      else c.hpCur = Math.min(c.hpMax, c.hpCur + n);
      return refresh();
    }
    if (cmd === 'gold') { c.gold = Math.max(0, (Number(c.gold) || 0) + Number(a1)); return refresh(); }
    if (cmd === 'slot') {
      const i = Number(a1); const j = Number(a2);
      c.slotsUsed = c.slotsUsed || [];
      c.slotsUsed[i] = j < (c.slotsUsed[i] || 0) ? j : j + 1;
      return refresh();
    }
    if (cmd === 'delitem' || cmd === 'potion') {
      const items = invItems(c);
      const [removed] = items.splice(Number(a1), 1);
      c.equipment = items.join('\n');
      if (cmd === 'potion') {
        const heal = rollFormula('2к4+2').total;
        c.hpCur = Math.min(c.hpMax, c.hpCur + heal);
        if (c.hpCur > 0) c.conditions = removeCond(c.conditions, 'Без сознания');
        toast(`🧪 ${esc(c.name)}: +${heal} хитов`);
      } else toast(`Убрано: ${esc(removed)}`);
      return refresh();
    }
    if (cmd === 'additem') {
      const v = $('#newitem').value.trim();
      if (!v) return;
      c.equipment = (c.equipment ? c.equipment + '\n' : '') + v;
      return refresh();
    }
    quickRoll(c, q);
  });
  const sh = $('#modal .sheet');
  if (sh) sh.scrollTop = prevScroll;
}

// Бросок со страницы персонажа (лист или быстрый лист)
function quickRoll(c, q) {
  let label; let r;
  if (q === 'init') { label = 'Инициатива'; r = d20(C.initiative(c)); }
  else if (q.startsWith('ab:')) { const a = ABILITIES.find((x) => x.id === q.slice(3)); label = `Проверка: ${a.name}`; r = d20(C.mod(c, a.id)); }
  else if (q.startsWith('sv:')) { const a = ABILITIES.find((x) => x.id === q.slice(3)); label = `Спасбросок: ${a.name}`; r = d20(C.saveMod(c, a.id)); }
  else if (q.startsWith('sk:')) { const s = SKILLS.find((x) => x.id === q.slice(3)); label = s.name; r = d20(C.skillMod(c, s.id)); }
  else if (q.startsWith('atk:')) {
    const a = c.attacks[+q.slice(4)]; if (!a) return;
    label = `Атака: ${a.name}`; r = d20(parseInt(String(a.bonus).replace('−', '-'), 10) || 0);
    const dmgF = String(a.dmg).match(/\d*\s*[кd]\s*\d+(\s*[+\-−]\s*\d+)?/i);
    if (dmgF) {
      let f = dmgF[0];
      if (r.nat === 20) f = f.replace(/(\d*)\s*[кd]/i, (m0, n) => `${(parseInt(n, 10) || 1) * 2}к`);
      const dr = rollFormula(f);
      if (dr) label += ` · урон ${dr.total}${r.nat === 20 ? ' (крит)' : ''}`;
    }
  } else if (q === 'death') {
    r = d20(0); label = 'Спасбросок от смерти';
    if (r.nat === 20) { c.hpCur = 1; c.deathS = 0; c.deathF = 0; c.conditions = removeCond(c.conditions, 'Без сознания'); }
    else if (r.nat === 1) c.deathF = Math.min(3, (c.deathF || 0) + 2);
    else if (r.total >= 10) c.deathS = Math.min(3, (c.deathS || 0) + 1);
    else c.deathF = Math.min(3, (c.deathF || 0) + 1);
  }
  if (!r) return;
  toast(`<div>${esc(c.name)} · ${esc(label)}</div><div class="big ${r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : ''}">${r.total}</div><div class="muted">${r.details}</div>`, 2600);
  logRollToGame(c.name, label, r);
}

function logRollToGame(who, label, r) {
  state.diceHistory.unshift({ t: Date.now(), text: `${who}: ${label} = ${r.total} (${r.details.replace(/<\/?s>/g, '')})` });
  state.diceHistory.length = Math.min(state.diceHistory.length, 60);
  if (state.game.started) {
    pushLog({ type: 'roll', html: rollHtml(who, label, r) });
    state.game.pending = state.game.pending || [];
    state.game.pending.push(`${who} — ${label}: ${r.total}`);
  }
  save();
}

// ======================================================================
// ПЕРСОНАЖИ
// ======================================================================
function renderChars() {
  const root = $('#tab-chars');
  if (ui.editId && charById(ui.editId)) return renderEditor(root, charById(ui.editId));
  ui.editId = null;
  root.innerHTML = `
    <div class="row" style="margin-bottom:10px">
      <button class="btn primary grow" data-a="random">🎲 Случайный герой</button>
      <button class="btn grow" data-a="new">✏️ Создать вручную</button>
    </div>
    <p class="muted">В группе: ${state.party.length}/4. Нажмите ⭐, чтобы добавить героя в игру или убрать из неё.</p>
    ${state.characters.map((c) => `
      <div class="card char-card ${state.party.includes(c.id) ? 'inparty' : ''}">
        <div class="av">${esc(c.emoji)}</div>
        <div class="grow" data-a="open:${c.id}">
          <b>${esc(c.name)}</b><br>
          <span class="muted">${esc(C.race(c).name)} · ${esc(C.klass(c).name)} ${c.level} ур.${c.player ? ' · ' + esc(c.player) : ''}</span><br>
          <span class="muted">❤ ${c.hpCur}/${c.hpMax} · 🛡 ${C.ac(c)}</span>
        </div>
        <button class="btn icon" data-a="party:${c.id}">${state.party.includes(c.id) ? '⭐' : '☆'}</button>
      </div>`).join('') || '<div class="card center muted">Пока нет героев. Создайте первого!</div>'}
  `;
  root.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    if (a === 'random') { openRandomDialog(); return; }
    if (a === 'new') { const c = C.blankCharacter(); state.characters.push(c); if (state.party.length < 4) state.party.push(c.id); save(); ui.editId = c.id; renderChars(); return; }
    if (a.startsWith('open:')) { ui.editId = a.slice(5); renderChars(); return; }
    if (a.startsWith('party:')) { toggleParty(a.slice(6)); renderChars(); }
  };
  root.onchange = null; root.oninput = null;
}

function toggleParty(id) {
  if (state.party.includes(id)) state.party = state.party.filter((x) => x !== id);
  else if (state.party.length >= 4) { toast('В группе максимум 4 героя'); return; }
  else state.party.push(id);
  save();
}

function openRandomDialog() {
  modal(`
    <h3>🎲 Случайный герой</h3>
    <label class="f">Раса</label><select id="rr"><option value="">Любая</option>${RACES.map((r) => `<option value="${r.id}">${r.name}</option>`).join('')}</select>
    <label class="f">Класс</label><select id="rc"><option value="">Любой</option>${CLASSES.map((k) => `<option value="${k.id}">${k.name}</option>`).join('')}</select>
    <label class="f">Пол</label><select id="rg"><option value="">Любой</option><option value="m">Мужской</option><option value="f">Женский</option></select>
    <label class="f">Уровень</label><input type="number" id="rl" min="1" max="20" value="1">
    <label class="f">Имя игрока</label><input type="text" id="rp" placeholder="необязательно">
    <br><br><div class="row"><button class="btn primary grow" data-r="go">Создать</button><button class="btn" data-r="x">Отмена</button></div>`, (e) => {
    const r = e.target.closest('[data-r]')?.dataset.r;
    if (r === 'x') return closeModal();
    if (r === 'go') {
      const c = C.randomCharacter({ raceId: $('#rr').value || undefined, classId: $('#rc').value || undefined, gender: $('#rg').value || undefined, level: Math.max(1, Math.min(20, +$('#rl').value || 1)) });
      c.player = $('#rp').value.trim();
      state.characters.push(c);
      if (state.party.length < 4) state.party.push(c.id);
      save(); closeModal(); ui.editId = c.id; renderChars();
    }
  });
}

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

function inp(c, path, type = 'text', attrs = '') {
  const v = getPath(c, path);
  return `<input type="${type}" data-f="${path}" value="${esc(v)}" ${attrs}>`;
}
function ta(c, path, ph = '') { return `<textarea data-f="${path}" placeholder="${esc(ph)}">${esc(getPath(c, path))}</textarea>`; }
function sel(c, path, opts) {
  const v = getPath(c, path);
  return `<select data-f="${path}">${opts.map(([val, label]) => `<option value="${esc(val)}" ${String(val) === String(v) ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
}

function renderEditor(root, c) {
  if (c.gender !== 'm' && c.gender !== 'f') c.gender = genderOf(c);
  const k = C.klass(c); const r = C.race(c); const b = C.bg(c);
  const profs = C.allSkillProfs(c);
  const fixedSkills = new Set([...(r.skills || []), ...b.skills]);
  const maxSkills = k.skillCount + (r.freeSkills || 0);
  const si = C.spellInfo(c);
  const pbSpent = ABILITIES.reduce((s, a) => s + (POINT_BUY_COST[c.base[a.id]] ?? 99), 0);
  const scroll = root.scrollTop;
  const avail = SPELLS.filter((s) => s.classes.includes(k.id) || c.spells.includes(s.name));
  const openSecs = ui.openSecs || (ui.openSecs = new Set(['main', 'abil', 'persona']));
  const sec = (id, title, body) => `<details class="sec" data-sec="${id}" ${openSecs.has(id) ? 'open' : ''}><summary>${title}</summary><div class="body">${body}</div></details>`;

  root.innerHTML = `
  <div id="editor-top" class="row">
    <button class="btn" data-a="back">← Назад</button>
    <span class="grow"></span>
    <button class="btn icon" data-a="party">${state.party.includes(c.id) ? '⭐' : '☆'}</button>
    <button class="btn icon" data-a="more">⋯</button>
  </div>
  <div class="card">
    <div class="row"><div class="char-card"><div class="av">${esc(c.emoji)}</div></div>
      <div class="grow"><label class="f">Имя персонажа</label><div class="row" style="flex-wrap:nowrap">${inp(c, 'name')}<button class="btn icon" data-a="rname">🎲</button></div></div></div>
    <div class="grid3" style="margin-top:10px">
      <div class="stat-box"><div class="v">${c.hpCur}/${c.hpMax}</div><div class="l">Хиты</div></div>
      <div class="stat-box"><div class="v">${C.ac(c)}</div><div class="l">КД</div></div>
      <div class="stat-box"><div class="v">${fmtMod(C.initiative(c))}</div><div class="l">Инициатива</div></div>
      <div class="stat-box"><div class="v">${C.speed(c)}</div><div class="l">Скорость, фт.</div></div>
      <div class="stat-box"><div class="v">+${C.prof(c)}</div><div class="l">Бонус мастерства</div></div>
      <div class="stat-box"><div class="v">${C.passive(c)}</div><div class="l">Пасс. внимат.</div></div>
    </div>
  </div>

  ${sec('main', '📜 Основное', `
    <div class="grid2">
      <div><label class="f">Игрок</label>${inp(c, 'player')}</div>
      <div><label class="f">Пол</label>${sel(c, 'gender', [['m', 'Мужской'], ['f', 'Женский']])}</div>
      <div><label class="f">Уровень</label><div class="row" style="flex-wrap:nowrap"><button class="btn small" data-a="lvl:-1">−</button>${inp(c, 'level', 'number', 'min="1" max="20"')}<button class="btn small" data-a="lvl:1">+</button></div></div>
      <div><label class="f">Раса</label>${sel(c, 'raceId', RACES.map((x) => [x.id, x.name]))}</div>
      <div><label class="f">Класс</label>${sel(c, 'classId', CLASSES.map((x) => [x.id, x.name]))}</div>
      <div><label class="f">Предыстория</label>${sel(c, 'bgId', BACKGROUNDS.map((x) => [x.id, x.name]))}</div>
      <div><label class="f">Мировоззрение</label>${sel(c, 'alignment', ALIGNMENTS.map((x) => [x, x]))}</div>
      <div><label class="f">Опыт${XP_TABLE[c.level] ? ` (до ${c.level + 1} ур.: ${XP_TABLE[c.level]})` : ''}</label>${inp(c, 'xp', 'number')}</div>
      <div><label class="f">Значок</label>${inp(c, 'emoji')}</div>
    </div>
    <p class="muted">Кость хитов: к${k.hd} · Спасброски: ${k.saves.map((s) => ABILITIES.find((a) => a.id === s).name).join(', ')}<br>
    Доспехи: ${esc(k.armor)} · Оружие: ${esc(k.weapons)}<br>
    Размер: ${r.size} · Предыстория: умение «${esc(b.feature)}», ${esc(b.extra)}</p>
    ${XP_TABLE[c.level] && c.xp >= XP_TABLE[c.level] ? '<button class="btn primary" data-a="lvl:1">⬆️ Повысить уровень!</button>' : ''}
  `)}

  ${sec('abil', '💪 Характеристики', `
    <div class="row" style="margin-bottom:8px">
      <button class="btn small" data-a="std">Стандартный набор</button>
      <button class="btn small" data-a="roll">🎲 4к6 (бросок)</button>
      <button class="btn small" data-a="pb">Покупка очков: 8</button>
    </div>
    <p class="muted">Покупка очков: потрачено ${pbSpent > 99 ? '— (значения вне 8–15)' : pbSpent + ' / 27'}. Итог = база + раса + доп.</p>
    <div class="abil-grid">${ABILITIES.map((a) => `
      <div class="abil">
        <div class="nm">${a.name}</div>
        <div class="mod" data-a="rab:${a.id}">${fmtMod(C.mod(c, a.id))}</div>
        <div class="det">= ${C.score(c, a.id)}</div>
        <label class="det">база</label>${inp(c, 'base.' + a.id, 'number', 'min="1" max="30"')}
        <div class="det">раса ${C.racialBonus(c, a.id) ? '+' + C.racialBonus(c, a.id) : '0'}</div>
        <label class="det">доп.</label>${inp(c, 'extra.' + a.id, 'number', 'min="-5" max="10"')}
      </div>`).join('')}</div>
    ${r.choice ? `<p class="muted">${r.name}: распределите +1 к ${r.choice.count} характеристикам (кроме Харизмы) в поле «доп.».</p>` : ''}
    <p class="muted">Увеличения характеристик на 4, 8, 12, 16 и 19 уровнях тоже вносите в «доп.». Нажмите на модификатор, чтобы бросить проверку.</p>
  `)}

  ${sec('skills', '🎯 Спасброски и навыки', `
    <h4>Спасброски</h4>
    ${ABILITIES.map((a) => `<div class="skill-row" data-a="rsv:${a.id}"><span class="val">${fmtMod(C.saveMod(c, a.id))}</span><span class="nm">${k.saves.includes(a.id) ? '● ' : ''}${a.name}</span></div>`).join('')}
    <h4>Навыки <span class="muted">(выбрано ${c.skillProf.length}/${maxSkills}${k.skills === 'any' ? ', любые' : ''})</span></h4>
    <p class="muted">☑ — владение, ★ — компетентность. Серые — от расы/предыстории. Нажмите на название, чтобы бросить.</p>
    ${SKILLS.map((s) => {
      const fixed = fixedSkills.has(s.id);
      const allowed = k.skills === 'any' || k.skills.includes(s.id) || (r.freeSkills);
      return `<div class="skill-row">
        <input type="checkbox" data-skill="${s.id}" ${profs.has(s.id) ? 'checked' : ''} ${fixed ? 'disabled' : ''} ${!allowed && !profs.has(s.id) ? 'title="Не из списка класса"' : ''}>
        <input type="checkbox" data-exp="${s.id}" ${c.expertise.includes(s.id) ? 'checked' : ''} title="Компетентность" style="accent-color:var(--blue)">
        <span class="val">${fmtMod(C.skillMod(c, s.id))}</span>
        <span class="nm" data-a="rsk:${s.id}">${s.name}${!fixed && !(k.skills === 'any' || k.skills.includes(s.id)) ? ' <span class="muted">(не класс.)</span>' : ''}</span>
        <span class="ab">${ABILITIES.find((a) => a.id === s.ab).short}</span>
      </div>`;
    }).join('')}
  `)}

  ${sec('combat', '⚔️ Бой: хиты, КД, атаки', `
    <div class="grid3">
      <div><label class="f">Хиты сейчас</label>${inp(c, 'hpCur', 'number')}</div>
      <div><label class="f">Максимум</label>${inp(c, 'hpMax', 'number')}</div>
      <div><label class="f">Временные</label>${inp(c, 'hpTemp', 'number')}</div>
    </div>
    <div class="row" style="margin:8px 0">
      <button class="btn small" data-a="hp:-1">−1</button><button class="btn small" data-a="hp:-5">−5</button>
      <button class="btn small" data-a="hp:1">+1</button><button class="btn small" data-a="hp:5">+5</button>
      <button class="btn small" data-a="hpauto">↻ Хиты по классу (${C.autoHp(c)})</button>
    </div>
    <div class="row muted">Кости хитов: ${c.level - (c.hdUsed || 0)}/${c.level} к${k.hd}
      <button class="btn small" data-a="hd">Потратить кость</button>
      <button class="btn small" data-a="short">Короткий отдых</button>
      <button class="btn small" data-a="long">Долгий отдых</button>
    </div>
    ${c.hpCur === 0 ? `<div class="card" style="margin-top:8px">💀 Спасброски от смерти: успехи ${c.deathS || 0}/3, провалы ${c.deathF || 0}/3 <button class="btn small" data-a="death">🎲 Бросить</button></div>` : ''}
    <div class="grid2" style="margin-top:8px">
      <div><label class="f">Доспех</label>${sel(c, 'armorId', ARMORS.map((a) => [a.id, a.name]))}</div>
      <div><label class="f">Прочий бонус КД</label>${inp(c, 'acMisc', 'number')}</div>
    </div>
    <div class="row" style="margin-top:8px">
      <label><input type="checkbox" data-bool="shield" ${c.shield ? 'checked' : ''}> Щит (+2)</label>
      ${k.spellAb ? `<label><input type="checkbox" data-bool="mageArmor" ${c.mageArmor ? 'checked' : ''}> Доспехи мага</label>` : ''}
      <label><input type="checkbox" data-bool="inspiration" ${c.inspiration ? 'checked' : ''}> Вдохновение</label>
    </div>
    <label class="f">Состояния (через запятую)</label>${inp(c, 'conditions')}
    <h4>Атаки</h4>
    ${c.attacks.map((a, i) => `<div class="attack-row">
      <input type="text" data-f="attacks.${i}.name" value="${esc(a.name)}" placeholder="Оружие">
      <input type="text" data-f="attacks.${i}.bonus" value="${esc(a.bonus)}" placeholder="+5">
      <input type="text" data-f="attacks.${i}.dmg" value="${esc(a.dmg)}" placeholder="1к8+3 рубящий">
      <div class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn small" data-a="ratk:${i}">🎲</button><button class="btn small" data-a="datk:${i}">✕</button></div>
    </div>`).join('')}
    <div class="row"><button class="btn small" data-a="addatk">+ Атака</button><button class="btn small" data-a="recalcatk">↻ Пересчитать по классу</button></div>
  `)}

  ${si ? sec('spells', '✨ Заклинания', `
    <p>Характеристика: <b>${ABILITIES.find((a) => a.id === si.ab).name}</b> · СЛ спасброска <b>${si.dc}</b> · Атака заклинанием <b>${fmtMod(si.atk)}</b></p>
    <div class="slots">${si.slots.map((n, i) => n ? `<div class="slot">${i + 1} ур.: <span class="pips">${Array.from({ length: n }, (_, j) => `<span class="pip ${j < (c.slotsUsed[i] || 0) ? 'used' : ''}" data-a="slot:${i}:${j}"></span>`).join('')}</span></div>` : '').join('') || '<span class="muted">Ячеек пока нет (появятся со 2 уровня)</span>'}</div>
    <h4>Известные / подготовленные</h4>
    ${[0, 1].map((lvl) => `<p class="muted">${lvl === 0 ? 'Заговоры' : '1 уровень'}</p>` + avail.filter((s) => s.lvl === lvl).map((s) => `
      <label class="spell-item"><input type="checkbox" data-spell="${esc(s.name)}" ${c.spells.includes(s.name) ? 'checked' : ''}>
      <span><b>${esc(s.name)}</b><br><span class="muted">${esc(s.desc)}</span></span></label>`).join('')).join('')}
    <label class="f">Другие заклинания (вручную, напр. 2+ уровня)</label>${ta(c, 'customSpells', 'Паутина, Огненный шар…')}
  `) : ''}

  ${sec('feat', '🌟 Особенности и умения', `
    <h4>${esc(r.name)}</h4><ul>${r.traits.map((t) => `<li>${esc(t)}</li>`).join('')}<li>Скорость ${r.speed} фт.</li></ul>
    <h4>${esc(k.name)}</h4><ul>${C.features(c).map((f) => `<li><span class="muted">${f.lvl} ур.</span> ${esc(f.name)}</li>`).join('')}</ul>
    <h4>Предыстория: ${esc(b.name)}</h4><p>Умение: ${esc(b.feature)}. ${esc(b.extra)}.</p>
  `)}

  ${sec('gear', '🎒 Снаряжение', `
    <label class="f">Золото (зм)</label>${inp(c, 'gold', 'number')}
    <label class="f">Снаряжение и предметы</label>${ta(c, 'equipment')}
  `)}

  ${sec('persona', '🎭 Личность и история', `
    <div class="card" style="background:var(--bg2)">
      <div class="muted" style="margin-bottom:8px">Генератор придумает историю по расе, классу, предыстории, полу и характеру героя. Каждый раз — новая.</div>
      <div style="display:grid;gap:6px">
        <button class="btn primary" data-a="story">✨ Придумать историю</button>
        <button class="btn" data-a="storyall">🎲 Новая личность, внешность и история</button>
      </div>
    </div>
    ${c.backstory ? `<div class="story-preview">${esc(c.backstory)}</div>` : ''}
    <label class="f">Черты характера</label>${ta(c, 'traits')}
    <label class="f">Идеалы</label>${ta(c, 'ideals')}
    <label class="f">Привязанности</label>${ta(c, 'bonds')}
    <label class="f">Слабости</label>${ta(c, 'flaws')}
    <label class="f">Внешность</label>${ta(c, 'appearance')}
    <label class="f">История персонажа (можно править)</label><textarea data-f="backstory" rows="7">${esc(c.backstory)}</textarea>
    <label class="f">Заметки</label>${ta(c, 'notes')}
  `)}
  `;
  root.scrollTop = scroll;

  root.querySelectorAll('details.sec').forEach((d) => d.addEventListener('toggle', () => {
    if (d.open) openSecs.add(d.dataset.sec); else openSecs.delete(d.dataset.sec);
  }));

  root.oninput = (e) => {
    const f = e.target.dataset.f;
    if (!f || e.target.tagName === 'SELECT') return;
    if (e.target.type === 'number') return; // числа — по change
    setPath(c, f, e.target.value);
    if (f.startsWith('attacks.')) c.attacksAuto = false;
    save();
  };
  root.onchange = (e) => {
    const t = e.target;
    if (t.dataset.f) {
      let v = t.value;
      if (t.type === 'number') v = Number(v) || 0;
      const f = t.dataset.f;
      const prevHpAuto = c.hpAuto;
      setPath(c, f, v);
      if (f === 'level') c.level = Math.max(1, Math.min(20, c.level));
      if (f === 'hpMax') { c.hpAuto = false; c.hpCur = Math.min(c.hpCur, c.hpMax); }
      if (f === 'classId') { C.applyClassDefaults(c); c.attacksAuto = true; c.spells = c.spells.filter((n) => SPELLS.find((s) => s.name === n)?.classes.includes(c.classId)); }
      if (f === 'bgId' || f === 'raceId') {
        c.skillProf = c.skillProf.filter((s) => !(C.race(c).skills || []).includes(s) && !C.bg(c).skills.includes(s));
      }
      afterStatChange(c, prevHpAuto);
      save(); renderEditor(root, c);
      return;
    }
    if (t.dataset.skill) {
      const id = t.dataset.skill;
      if (t.checked) {
        if (c.skillProf.length >= maxSkills) { t.checked = false; toast(`Можно выбрать не больше ${maxSkills} навыков (класс${r.freeSkills ? ' + раса' : ''})`); return; }
        c.skillProf.push(id);
      } else c.skillProf = c.skillProf.filter((s) => s !== id);
      save(); renderEditor(root, c); return;
    }
    if (t.dataset.exp) {
      const id = t.dataset.exp;
      if (t.checked) c.expertise.push(id); else c.expertise = c.expertise.filter((s) => s !== id);
      save(); renderEditor(root, c); return;
    }
    if (t.dataset.bool) { c[t.dataset.bool] = t.checked; save(); renderEditor(root, c); return; }
    if (t.dataset.spell) {
      const n = t.dataset.spell;
      if (t.checked) c.spells.push(n); else c.spells = c.spells.filter((x) => x !== n);
      save(); return;
    }
  };
  root.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    const [cmd, p1, p2] = a.split(':');
    switch (cmd) {
      case 'back': ui.editId = null; renderChars(); return;
      case 'party': toggleParty(c.id); break;
      case 'more': editorMore(c); return;
      case 'rname': c.name = randomNameFor(genderOf(c)); break;
      case 'story': C.generateBackstoryOnly(c); toast('✨ Новая история готова'); break;
      case 'storyall': C.generateStory(c, true); toast('✨ Новая личность, внешность и история'); break;
      case 'lvl': {
        const prevHpAuto = c.hpAuto;
        const old = c.level;
        c.level = Math.max(1, Math.min(20, c.level + Number(p1)));
        if (c.level > old) {
          if (!c.hpAuto) { const gain = Math.max(1, C.klass(c).hd / 2 + 1 + C.mod(c, 'con')); c.hpMax += gain; c.hpCur += gain; }
          toast(`Уровень ${c.level}!` + (C.klass(c).features.filter((f) => f.lvl === c.level).map((f) => '<br>• ' + esc(f.name)).join('')), 3500);
        }
        afterStatChange(c, prevHpAuto);
        break;
      }
      case 'std': C.assignScores(c, STANDARD_ARRAY); afterStatChange(c, c.hpAuto); break;
      case 'roll': {
        const vals = Array.from({ length: 6 }, C.roll4d6);
        C.assignScores(c, vals); afterStatChange(c, c.hpAuto);
        toast('Выпало: ' + vals.sort((x, y) => y - x).join(', '), 2500);
        break;
      }
      case 'pb': ABILITIES.forEach((x) => { c.base[x.id] = 8; }); afterStatChange(c, c.hpAuto); break;
      case 'rab': quickRoll(c, 'ab:' + p1); return;
      case 'rsv': quickRoll(c, 'sv:' + p1); return;
      case 'rsk': quickRoll(c, 'sk:' + p1); return;
      case 'ratk': quickRoll(c, 'atk:' + p1); return;
      case 'death': quickRoll(c, 'death'); break;
      case 'hp': c.hpCur = Math.max(0, Math.min(c.hpMax, c.hpCur + Number(p1))); break;
      case 'hpauto': c.hpAuto = true; c.hpMax = C.autoHp(c); c.hpCur = c.hpMax; break;
      case 'hd': {
        if ((c.hdUsed || 0) >= c.level) { toast('Костей хитов не осталось'); return; }
        const rr = rollFormula(`1d${C.klass(c).hd}`);
        const heal = Math.max(0, rr.total + C.mod(c, 'con'));
        c.hdUsed = (c.hdUsed || 0) + 1; c.hpCur = Math.min(c.hpMax, c.hpCur + heal);
        toast(`Восстановлено ${heal} хитов`);
        break;
      }
      case 'short': rest(c, false); toast('Короткий отдых'); break;
      case 'long': rest(c, true); toast('Долгий отдых: всё восстановлено'); break;
      case 'addatk': c.attacks.push({ name: '', bonus: fmtMod(C.prof(c)), dmg: '' }); c.attacksAuto = false; break;
      case 'datk': c.attacks.splice(Number(p1), 1); c.attacksAuto = false; break;
      case 'recalcatk': c.attacks = C.defaultAttacks(c); c.attacksAuto = true; break;
      case 'slot': {
        const i = Number(p1); const j = Number(p2);
        c.slotsUsed = c.slotsUsed || [];
        c.slotsUsed[i] = j < (c.slotsUsed[i] || 0) ? j : j + 1;
        break;
      }
      default: return;
    }
    save(); renderEditor(root, c);
  };
}

function afterStatChange(c, hpAutoWas) {
  if (c.hpAuto && hpAutoWas) {
    const diff = c.hpMax - c.hpCur;
    c.hpMax = C.autoHp(c);
    c.hpCur = Math.max(0, c.hpMax - diff);
  }
  if (c.attacksAuto !== false) c.attacks = C.defaultAttacks(c);
}

function editorMore(c) {
  modal(`<h3>${esc(c.name)}</h3><div style="display:grid;gap:8px">
    <button class="btn" data-x="reroll">🎲 Перегенерировать полностью (случайно)</button>
    <button class="btn" data-x="dup">📄 Дублировать</button>
    <button class="btn" data-x="export">📤 Скопировать как текст</button>
    <button class="btn danger" data-x="del">🗑 Удалить</button>
    <button class="btn" data-x="close">Закрыть</button></div>`, (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    closeModal();
    if (x === 'reroll') {
      if (!confirm('Заменить все данные персонажа случайными?')) return;
      const n = C.randomCharacter({ level: c.level }); n.id = c.id; n.player = c.player;
      Object.assign(c, n);
    } else if (x === 'dup') {
      const n = JSON.parse(JSON.stringify(c)); n.id = Math.random().toString(36).slice(2, 10); n.name += ' (копия)';
      state.characters.push(n); ui.editId = n.id;
    } else if (x === 'export') {
      navigator.clipboard?.writeText(C.summary(c)).then(() => toast('Скопировано'), () => toast('Не удалось скопировать'));
    } else if (x === 'del') {
      if (!confirm(`Удалить ${c.name}?`)) return;
      state.characters = state.characters.filter((y) => y.id !== c.id);
      state.party = state.party.filter((y) => y !== c.id);
      ui.editId = null;
    }
    save(); renderChars();
  });
}

// ======================================================================
// КУБИКИ
// ======================================================================
function renderDice() {
  const root = $('#tab-dice');
  const party = partyChars();
  root.innerHTML = `
    <div class="card">
      <div id="dice-result">${ui.lastRoll ? ui.lastRoll.total : '🎲'}</div>
      <div class="center muted" id="dice-detail">${ui.lastRoll ? esc(ui.lastRoll.formula) + ': ' + ui.lastRoll.details : 'Нажмите на кубик'}</div>
    </div>
    <div class="seg" style="margin-bottom:10px">
      <button data-mode="normal" class="${ui.diceMode === 'normal' ? 'sel' : ''}">Обычный</button>
      <button data-mode="adv" class="${ui.diceMode === 'adv' ? 'sel' : ''}">Преимущество</button>
      <button data-mode="dis" class="${ui.diceMode === 'dis' ? 'sel' : ''}">Помеха</button>
    </div>
    <div class="row" style="margin-bottom:10px">
      <span>Кол-во:</span><button class="btn small" data-c="-1">−</button><b style="min-width:24px;text-align:center">${ui.diceCount}</b><button class="btn small" data-c="1">+</button>
      <span class="grow"></span>
      <span>Мод:</span><button class="btn small" data-m="-1">−</button><b style="min-width:30px;text-align:center">${fmtMod(ui.diceMod)}</b><button class="btn small" data-m="1">+</button>
    </div>
    <div class="dice-grid">
      ${[4, 6, 8, 10, 12, 20, 100].map((d) => `<button class="die" data-d="${d}">к${d}</button>`).join('')}
      <button class="die" data-f="4d6kh3" style="font-size:.8rem">4к6<br>без мин.</button>
    </div>
    <div class="row" style="margin-top:12px;flex-wrap:nowrap">
      <input type="text" id="formula" placeholder="Формула: 2к6+3, 1к20+5, 8к6" value="${esc(ui.formula || '')}">
      <button class="btn primary" id="froll">Бросить</button>
    </div>
    ${party.length ? `<label class="row" style="margin-top:10px"><input type="checkbox" id="todm" ${ui.diceToDm ? 'checked' : ''}> Сообщать результат мастеру от имени:
      <select id="dicewho" style="width:auto">${party.map((c) => `<option value="${c.id}" ${ui.diceWho === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
    <h3>История</h3>
    ${state.diceHistory.slice(0, 30).map((h) => `<div class="hist">${h.text}</div>`).join('') || '<p class="muted">Пусто</p>'}
    ${state.diceHistory.length ? '<button class="btn small" id="dclear">Очистить историю</button>' : ''}
  `;
  root.onclick = (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.mode) { ui.diceMode = t.dataset.mode; renderDice(); return; }
    if (t.dataset.c) { ui.diceCount = Math.max(1, Math.min(20, ui.diceCount + Number(t.dataset.c))); renderDice(); return; }
    if (t.dataset.m) { ui.diceMod = Math.max(-20, Math.min(20, ui.diceMod + Number(t.dataset.m))); renderDice(); return; }
    if (t.dataset.d) {
      const d = Number(t.dataset.d);
      const f = `${ui.diceCount}d${d}${ui.diceMod ? (ui.diceMod > 0 ? '+' : '') + ui.diceMod : ''}`;
      doDiceRoll(f.replace('d', 'к'), d === 20 && ui.diceCount === 1 ? ui.diceMode : 'normal');
      return;
    }
    if (t.dataset.f) { doDiceRoll('4к6kh3'); return; }
    if (t.id === 'froll') {
      ui.formula = $('#formula').value.trim();
      if (!parseFormula(ui.formula)) return toast('Не понимаю формулу. Пример: 2к6+3');
      doDiceRoll(ui.formula, ui.diceMode);
      return;
    }
    if (t.id === 'dclear') { state.diceHistory = []; save(); renderDice(); }
  };
  root.onchange = (e) => {
    if (e.target.id === 'todm') ui.diceToDm = e.target.checked;
    if (e.target.id === 'dicewho') ui.diceWho = e.target.value;
  };
}

function doDiceRoll(formula, mode = 'normal') {
  const r = rollFormula(formula, mode);
  if (!r) return;
  ui.lastRoll = r;
  if (navigator.vibrate) navigator.vibrate(30);
  const party = partyChars();
  if (ui.diceToDm && party.length) {
    const c = charById(ui.diceWho) || party[0];
    logRollToGame(c.name, formula, r);
  } else {
    state.diceHistory.unshift({ t: Date.now(), text: `${esc(formula)}${mode !== 'normal' ? (mode === 'adv' ? ' (преим.)' : ' (помеха)') : ''} = <b>${r.total}</b> <span class="muted">${r.details}</span>` });
    state.diceHistory.length = Math.min(state.diceHistory.length, 60);
    save();
  }
  renderDice();
  const el = $('#dice-result');
  el.classList.remove('rolling'); void el.offsetWidth; el.classList.add('rolling');
  el.classList.toggle('crit', r.nat === 20); el.classList.toggle('fumble', r.nat === 1);
}

// ======================================================================
// ПРАВИЛА
// ======================================================================
function dynamicRules(kind) {
  if (kind === 'races') {
    return RACES.map((r) => `<h4>${r.name}</h4><p class="muted">${Object.entries(r.bonus).map(([k, v]) => `${ABILITIES.find((a) => a.id === k).name} +${v}`).join(', ')}${r.choice ? `, +1 к двум другим` : ''} · Скорость ${r.speed} фт. · ${r.size}</p><ul>${r.traits.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`).join('');
  }
  if (kind === 'classes') {
    return CLASSES.map((k) => `<h4>${k.name}</h4>
      <p class="muted">Кость хитов к${k.hd} · Спасброски: ${k.saves.map((s) => ABILITIES.find((a) => a.id === s).name).join(', ')} · Навыки: ${k.skillCount} из ${k.skills === 'any' ? 'любых' : k.skills.map((s) => SKILLS.find((x) => x.id === s).name).join(', ')}<br>
      Доспехи: ${esc(k.armor)} · Оружие: ${esc(k.weapons)}${k.spellAb ? ` · Заклинания: ${ABILITIES.find((a) => a.id === k.spellAb).name}` : ''}<br>Снаряжение: ${esc(k.equipment)}</p>
      <ul>${k.features.map((f) => `<li><b>${f.lvl}</b> — ${esc(f.name)}</li>`).join('')}</ul>`).join('');
  }
  if (kind === 'backgrounds') {
    return BACKGROUNDS.map((b) => `<p><b>${b.name}</b>: ${b.skills.map((s) => SKILLS.find((x) => x.id === s).name).join(', ')}. Умение «${esc(b.feature)}». ${esc(b.extra)}.</p>`).join('');
  }
  if (kind === 'spells') {
    const cls = (ids) => ids.map((id) => CLASSES.find((k) => k.id === id).name).join(', ');
    return [0, 1].map((l) => `<h4>${l === 0 ? 'Заговоры' : '1 уровень'}</h4>` + SPELLS.filter((s) => s.lvl === l).map((s) => `<p><b>${esc(s.name)}</b> — ${esc(s.desc)} <span class="muted">(${cls(s.classes)})</span></p>`).join('')).join('')
      + `<h4>Ячейки заклинаний полного заклинателя</h4><table><tr><th>Ур.</th>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => `<th>${i}</th>`).join('')}</tr>${
        Array.from({ length: 20 }, (_, i) => `<tr><td>${i + 1}</td>${[0, 1, 2, 3, 4, 5, 6, 7, 8].map((j) => `<td>${(C.spellInfo({ ...C.blankCharacter(), classId: 'wizard', level: i + 1 }).slots[j]) || '—'}</td>`).join('')}</tr>`).join('')}</table>
        <p class="muted">Полузаклинатели (паладин, следопыт) получают ячейки как полный заклинатель половины своего уровня (округление вверх), начиная со 2 уровня. Колдун: все ячейки одного уровня, восстанавливаются после короткого отдыха.</p>`;
  }
  return '';
}

function renderRules() {
  const root = $('#tab-rules');
  const q = (ui.rulesQuery || '').toLowerCase();
  const sections = RULES.map((r) => ({ title: r.title, body: r.dynamic ? dynamicRules(r.dynamic) : r.body }));
  const hl = (html) => {
    if (!q) return html;
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return html.replace(/>([^<]+)</g, (m, txt) => '>' + txt.replace(re, '<mark>$1</mark>') + '<');
  };
  const shown = sections.filter((s) => !q || (s.title + ' ' + s.body.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(q));
  root.innerHTML = `
    <input type="text" id="rq" placeholder="🔍 Поиск по правилам (например: захват, отдых, невидимый)" value="${esc(ui.rulesQuery || '')}">
    <div style="height:10px"></div>
    ${shown.map((s) => `<details class="sec" ${q ? 'open' : ''}><summary>${esc(s.title)}</summary><div class="body rules-body">${hl(s.body)}</div></details>`).join('') || '<p class="muted">Ничего не найдено</p>'}
    <p class="muted">Справочник основан на SRD 5.1 (Creative Commons). ИИ-мастер также знает полные правила D&D 5e.</p>`;
  const rq = $('#rq');
  rq.oninput = () => {
    ui.rulesQuery = rq.value;
    clearTimeout(renderRules._t);
    renderRules._t = setTimeout(() => { renderRules(); const n = $('#rq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 300);
  };
}

// ======================================================================
// НАСТРОЙКИ
// ======================================================================
function renderSettings() {
  const root = $('#tab-settings');
  const s = state.settings;
  const vs = DM.ruVoices();
  root.innerHTML = `
    <div class="card">
      <h3>🔑 ИИ-мастер (Claude)</h3>
      <label class="f">API-ключ Anthropic</label>
      <input type="password" data-s="apiKey" value="${esc(s.apiKey)}" placeholder="sk-ant-..." autocomplete="off">
      <p class="muted">Ключ можно получить на console.anthropic.com → API Keys. Он хранится только на этом телефоне и отправляется напрямую в Anthropic.</p>
      <label class="f">Модель</label>
      <select data-s="model">
        ${[['claude-opus-5-5', 'Claude Opus 5.5 — лучший рассказчик (рекомендуется)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 — быстрее и дешевле'], ['claude-haiku-5-5', 'Claude Haiku 5.5 — самый быстрый и дешёвый']].map(([v, l]) => `<option value="${v}" ${s.model === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="f">Глубина обдумывания</label>
      <select data-s="effort">
        ${[['low', 'Быстро (рекомендуется для живой игры)'], ['medium', 'Средне'], ['high', 'Глубоко (медленнее)']].map(([v, l]) => `<option value="${v}" ${s.effort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <label class="f">Стиль кампании</label>
      <textarea data-s="style">${esc(s.style)}</textarea>
    </div>
    <div class="card">
      <h3>🔊 Голос</h3>
      <label class="row"><input type="checkbox" data-sb="voiceOn" ${s.voiceOn ? 'checked' : ''}> Мастер говорит вслух</label>
      <label class="row" style="margin-top:6px"><input type="checkbox" data-sb="turnOrder" ${s.turnOrder !== false ? 'checked' : ''}> Ходить по очереди (ход передаётся следующему герою)</label>
      <label class="f">Голос ${vs.length ? '' : '(русские голоса не найдены — установите русский голос в настройках телефона)'}</label>
      <p class="muted">Нажмите ▶️, чтобы послушать, и выберите понравившийся голос.</p>
      <label class="spell-item" style="align-items:center"><input type="radio" name="voice" data-voice="" ${!s.voiceName ? 'checked' : ''}><span class="grow">Авто (лучший из найденных)</span></label>
      ${DM.voiceList().map((x) => `<label class="spell-item" style="align-items:center">
        <input type="radio" name="voice" data-voice="${esc(x.key)}" ${s.voiceName === x.key || (s.voiceName && s.voiceName === x.key.split('#')[0] && x.key.endsWith('#1')) ? 'checked' : ''}>
        <span class="grow">${esc(x.label)}<br><span class="muted" style="font-size:.7rem;word-break:break-all">${esc(x.uri)}</span></span>
        <button class="btn small" data-play="${esc(x.key)}">▶️</button></label>`).join('')}
      <div class="row" style="margin:6px 0"><button class="btn small" id="vrefresh">🔄 Обновить список</button><span class="muted">Русских голосов: ${vs.length} (всего в телефоне: ${DM.allVoicesCount()})</span></div>
      <p class="muted">Хотите голос приятнее? На iPhone: Настройки → Универсальный доступ → Устная речь → Голоса → Русский → скачайте «Милена (улучшенный)». Затем полностью закройте игру (смахните из списка приложений), откройте снова и выберите голос с пометкой «улучшенный».</p>
      <label class="f">Скорость речи: ${s.rate}</label><input type="range" min="0.6" max="1.6" step="0.05" data-s="rate" value="${s.rate}" style="width:100%">
      <label class="f">Высота голоса: ${s.pitch}</label><input type="range" min="0.5" max="1.5" step="0.05" data-s="pitch" value="${s.pitch}" style="width:100%">
      <button class="btn" id="vtest">▶️ Проверить голос</button>
      <p class="muted">Микрофон: ${DM.canListen ? 'доступен ✅ (нажмите 🎤 в игре)' : 'этот браузер не поддерживает распознавание речи ❌ — используйте Chrome на Android или Safari на iPhone'}</p>
    </div>
    <div class="card">
      <h3>📱 Установка на телефон</h3>
      <p><b>Android (Chrome):</b> меню ⋮ → «Добавить на главный экран» / «Установить приложение».<br>
      <b>iPhone (Safari):</b> кнопка «Поделиться» → «На экран Домой».</p>
    </div>
    <div class="card">
      <h3>💾 Данные</h3>
      <div class="row">
        <button class="btn" id="exp">📤 Экспорт</button>
        <button class="btn" id="imp">📥 Импорт</button>
        <button class="btn danger" id="newgame">Сбросить приключение</button>
      </div>
      <p class="muted">Экспорт сохраняет героев и историю в файл (без API-ключа).</p>
      <p class="muted">Версия приложения: 17</p>
      <button class="btn" id="forceupd" style="width:100%">🔄 Обновить приложение до последней версии</button>
      <input type="file" id="impfile" accept=".json,application/json" style="display:none">
    </div>`;
  root.oninput = (e) => {
    const k = e.target.dataset.s;
    if (!k) return;
    s[k] = e.target.type === 'range' ? Number(e.target.value) : (k === 'style' ? e.target.value : e.target.value.trim());
    save();
    if (e.target.type === 'range') e.target.previousElementSibling.textContent = e.target.previousElementSibling.textContent.replace(/[\d.]+$/, s[k]);
  };
  root.onchange = (e) => {
    if (e.target.name === 'voice') { s.voiceName = e.target.dataset.voice; save(); }
    if (e.target.dataset.sb) { s[e.target.dataset.sb] = e.target.checked; save(); }
    if (e.target.dataset.s && e.target.tagName === 'SELECT') { s[e.target.dataset.s] = e.target.value; save(); }
    if (e.target.id === 'impfile') {
      const f = e.target.files[0];
      if (!f) return;
      f.text().then((txt) => { importAll(txt); toast('Импортировано'); render(); }).catch(() => toast('Ошибка импорта'));
    }
  };
  root.onclick = (e) => {
    const id = e.target.id;
    const play = e.target.closest('[data-play]');
    if (play) { e.preventDefault(); DM.speak('Приветствую, искатели приключений! Ваша история начинается в таверне.', { flush: true, voiceKey: play.dataset.play, force: true }); return; }
    if (id === 'vtest') { const was = s.voiceOn; s.voiceOn = true; DM.speak('Приветствую, искатели приключений! Ваша история начинается в таверне «Гарцующий грифон».', { flush: true }); s.voiceOn = was; }
    if (id === 'forceupd') { toast('Обновляю…'); forceUpdate(); return; }
    if (id === 'vrefresh') { DM.refreshVoices(); renderSettings(); toast('Список голосов обновлён'); return; }
    if (id === 'exp') {
      const blob = new Blob([exportAll()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'dnd-master-save.json'; a.click();
    }
    if (id === 'imp') $('#impfile').click();
    if (id === 'newgame' && confirm('Удалить историю текущего приключения? Герои останутся.')) { resetGame(); toast('Приключение сброшено'); }
  };
}

// ---------------- Запуск ----------------
if (window.speechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', () => { if (ui.tab === 'settings') renderSettings(); });
// Обновления: всегда проверяем свежую версию; когда она установилась — один раз перезагружаем страницу
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}
async function forceUpdate() {
  try {
    if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
    if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
  } catch (e) { /* ignore */ }
  location.reload();
}
// продолжить незаконченный стрим после перезагрузки нельзя — убираем «висящие» записи
state.game.log = state.game.log.filter((e) => !e.streaming);
if (!state.mode) state.mode = state.settings.apiKey ? 'ai' : 'offline';
const showOfflineHelp = () => modal(`<div class="rules-body">${OFF.HELP_HTML}</div><button class="btn primary" style="width:100%" data-x="ok">Понятно</button>`, (e) => { if (e.target.closest('[data-x]')) closeModal(); });
OFF.setHelpers({ toast, rerender: () => { if (ui.tab === 'game') renderGame(); }, openSheet: (id) => showQuickSheet(id), showHelp: showOfflineHelp });
OFF.resume();
render();
