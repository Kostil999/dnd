// «Мастер без ИИ»: движок сцен, проверок и пошагового боя. Работает полностью офлайн.
import { state, save } from './store.js';
import { ADVENTURES, MONSTERS, PERSONAL_QUESTS, generateDungeon } from './adventures.js';
import { rollFormula, d20, fmtMod } from './dice.js';
import * as C from './character.js';
import * as DM from './dm.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
let H = { toast: () => {}, rerender: () => {}, openSheet: () => {} };
export function setHelpers(h) { H = { ...H, ...h }; }

const party = () => state.party.map((id) => state.characters.find((c) => c.id === id)).filter(Boolean);
const byId = (id) => state.characters.find((c) => c.id === id);
const off = () => state.offline || (state.offline = blank());
function blank() { return { advId: null, custom: null, sceneId: null, flags: {}, visited: {}, log: [], combats: [], focus: null, unit: null, ended: null, actor: null, quests: {}, progress: 0, pos: {}, done: {}, with: {} }; }
const adv = () => off().custom || ADVENTURES.find((a) => a.id === off().advId);
// У каждого героя своя позиция в истории: группа может разделяться
const posOf = (c) => (off().pos && off().pos[c.id]) || off().sceneId;
const active = () => party().filter((x) => !(off().done || {})[x.id]);
const here = (c) => active().filter((x) => posOf(x) === posOf(c));
const names = (list) => { const n = list.map((c) => c.name.split(' ')[0]); return n.length > 1 ? n.slice(0, -1).join(', ') + ' и ' + n[n.length - 1] : (n[0] || ''); };
// Бои: их может быть несколько одновременно в разных местах; focus — бой, который сейчас ходит
const CB = () => { const o = off(); return (o.combats || []).find((c) => c.id === o.focus) || null; };
const combatOf = (c) => (off().combats || []).find((cb) => cb.heroes.includes(c.id)) || null;
const cbHeroes = () => { const cb = CB(); return cb && cb.heroes ? cb.heroes.map(byId).filter(Boolean) : party(); };
const scene = () => { const a = actor(); return adv()?.scenes[a ? posOf(a) : off().sceneId]; };

function log(entry) { off().log.push(entry); if (off().log.length > 300) off().log.splice(0, 50); save(); }
function narrate(text, title) { log({ type: 'dm', title, text }); DM.speak(text); }
function sys(text) { log({ type: 'sys', text }); }

function actor() {
  const p = party();
  let c = byId(off().actor);
  const done = off().done || {};
  if (!c || !p.includes(c) || done[c.id]) c = p.find((x) => x.hpCur > 0 && !done[x.id]) || p.find((x) => !done[x.id]) || p[0];
  return c;
}

// ---------- Очерёдность ходов ----------
const turnOrderOn = () => state.settings.turnOrder !== false;
function units() {
  const list = []; const seen = new Set();
  party().forEach((c) => {
    if ((off().done || {})[c.id] || isDead(c)) return;
    const cb = combatOf(c);
    if (cb) { if (!seen.has(cb.id)) { seen.add(cb.id); list.push({ k: 'cb', id: cb.id }); } }
    else if (c.hpCur > 0) list.push({ k: 'h', id: c.id });
  });
  return list;
}
// Передать ход следующему: свободному герою или бою (бой делает один ход героя и уступает очередь)
function advance(announce = true) {
  const o = off();
  if (o.ended) return;
  const list = units();
  if (!list.length) return;
  const cur0 = o.unit && o.unit.k === 'h' ? byId(o.unit.id) : actor();
  const fromPos = cur0 ? posOf(cur0) : null;
  let i = list.findIndex((u) => o.unit && u.k === o.unit.k && u.id === o.unit.id);
  if (i < 0 && o.unit && o.unit.k === 'h') {
    // текущий герой ушёл в бой или выбыл — продолжаем по порядку группы
    const order = party().map((c) => c.id);
    const start = order.indexOf(o.unit.id);
    i = list.findIndex((u) => u.k === 'h' && order.indexOf(u.id) > start) - 1;
    if (i < -1) i = -1;
  }
  const next = list[(i + 1) % list.length];
  o.unit = next;
  if (next.k === 'cb') {
    o.focus = next.id;
    save(); H.rerender();
    setTimeout(processTurn, 500);
    return;
  }
  o.focus = null;
  const changed = o.actor !== next.id;
  o.actor = next.id;
  o.turnActs = 0;
  save();
  const a = byId(next.id);
  if (changed && party().length > 1 && a) log({ type: 'turn', text: `Ход: ${a.name.split(' ')[0]}` });
  if (!announce || !a || party().length < 2) return;
  if (posOf(a) !== fromPos || (o.combats || []).length) {
    const sc = adv().scenes[posOf(a)];
    const others = here(a).filter((x) => x !== a && !combatOf(x));
    const fights = (o.combats || []).map((cb) => `${names(cb.heroes.map(byId).filter(Boolean))} сражаются: ${adv().scenes[cb.scene]?.title || ''}`);
    narrate(`${a.name.split(' ')[0]}, тем временем ты — здесь: ${sc.title}.${others.length ? ` Рядом с тобой ${names(others)}.` : ' Рядом никого.'}${fights.length ? ' А в это время ' + fights.join('; ') + '.' : ''} Что ты делаешь?`, `📍 ${sc.title} · ${a.name.split(' ')[0]}`);
  } else DM.speak(`${a.name.split(' ')[0]}, твой ход.`);
}
const rotate = advance;
// Быстрые действия не заканчивают ход: за ход их можно сделать MAX_QUICK
const MAX_QUICK = 2;
const quickLeft = () => Math.max(0, MAX_QUICK - (off().turnActs || 0));
function quickDone() {
  const o = off();
  o.turnActs = (o.turnActs || 0) + 1;
  save();
  if (o._started) { o._started = false; save(); H.rerender(); return; }
  if (quickLeft() === 0 && units().length > 1) {
    sys(`У ${actor().name.split(' ')[0]} закончились быстрые действия — ход переходит дальше.`);
    advance();
  }
  H.rerender();
}
function endTurn() {
  const a = actor();
  if (units().length > 1) sys(`${a.name.split(' ')[0]} заканчивает ход.`);
  advance(); H.rerender();
}
// Если действие героя начало бой — очередь уже передана бою
function afterAction() {
  const o = off();
  if (o._started) { o._started = false; save(); H.rerender(); return; }
  advance(); H.rerender();
}

// ---------- Личные сюжетные линии ----------
const STEP_AT = [2, 5, 8]; // сколько сцен должно пройти, чтобы открылся шаг
function questOf(c) {
  const q = off().quests?.[c.id];
  if (!q) return null;
  return { q, tpl: PERSONAL_QUESTS.find((t) => t.id === q.qid) };
}
function questStatus(c) {
  const x = questOf(c);
  if (!x) return '';
  const { q, tpl } = x;
  if (q.done) return `${tpl.title}: ${q.success ? '✅ завершена' : '☑️ завершена не до конца'} — ${tpl.goal}`;
  return `${tpl.title} (шаг ${q.step + 1}/3): ${tpl.goal}`;
}
function personalAvailable(c) {
  const x = questOf(c);
  if (!x || x.q.done) return null;
  const o = off();
  if (o.progress < STEP_AT[x.q.step]) return null;
  if (x.q.lastAt === o.progress) return null; // не больше одного шага за сцену
  return x.tpl.steps[x.q.step];
}
function assignQuests() {
  const o = off();
  const pool = [...PERSONAL_QUESTS].sort(() => Math.random() - 0.5);
  party().forEach((c, i) => {
    const tpl = pool[i % pool.length];
    o.quests[c.id] = { qid: tpl.id, step: 0, done: false, success: 0 };
    c.quest = questStatus(c);
  });
  sys('⭐ Личные истории: ' + party().map((c) => `${c.name} — «${questOf(c).tpl.title}»`).join(' · '));
}
const nm = (t, c) => t.replace(/\{name\}/g, c.name.split(' ')[0]);
function choosePersonal() {
  const c = actor();
  const step = personalAvailable(c);
  if (!step) return;
  const { q, tpl } = questOf(c);
  DM.stopSpeaking();
  log({ type: 'player', who: c.name, text: `⭐ ${step.label}` });
  narrate(nm(step.text, c), `⭐ ${tpl.title}`);
  const chk = C.resolveCheck(c, step.what);
  const r = d20(chk.mod);
  const ok = r.total >= step.dc;
  log({ type: 'roll', html: rollLine(c, `${chk.label} (СЛ ${step.dc})`, r, step.dc) });
  H.toast(`<div>${esc(c.name)} · ${esc(chk.label)}</div><div class="big ${ok ? 'crit' : 'fumble'}">${r.total}</div><div>${ok ? 'Успех!' : 'Провал'}</div>`, 1800);
  narrate(nm(ok ? step.ok : step.fail, c), `⭐ ${tpl.title}`);
  if (!ok && step.failHp) { const n = rollFormula(step.failHp.replace('-', '')).total; damageHero(c, n); sys(`${c.name}: −${n} хитов`); }
  if (ok && step.okHeal) { const n = rollFormula(step.okHeal).total; healHero(c, n); sys(`${c.name}: +${n} хитов`); }
  const last = q.step === 2;
  const xp = ok ? (last ? 150 : 50) : 25;
  c.xp = (Number(c.xp) || 0) + xp;
  if (ok) q.success++;
  let note = `${c.name}: +${xp} опыта`;
  if (last && ok && step.reward) {
    const rw = step.reward;
    if (rw.item) { c.equipment = (c.equipment ? c.equipment + '\n' : '') + rw.item; note += ` · получает «${rw.item}»`; }
    if (rw.ac) { c.acMisc = (Number(c.acMisc) || 0) + rw.ac; note += ` · КД +${rw.ac}`; }
    if (rw.gold) { const g = rollFormula(rw.gold).total; c.gold = (Number(c.gold) || 0) + g; note += ` · +${g} зм`; }
    if (rw.inspiration) { c.inspiration = true; note += ' · вдохновение'; }
  }
  sys(note);
  q.lastAt = off().progress;
  if (last) { q.done = true; sys(`⭐ Личная история «${tpl.title}» героя ${c.name} завершена!`); }
  else q.step++;
  c.quest = questStatus(c);
  save(); quickDone();
}

function removeCond(list, cond) {
  return String(list || '').split(',').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== cond.toLowerCase()).join(', ');
}
function damageHero(c, n) {
  const fromTemp = Math.min(c.hpTemp || 0, n);
  c.hpTemp = (c.hpTemp || 0) - fromTemp;
  const wasUp = c.hpCur > 0;
  c.hpCur = Math.max(0, c.hpCur - (n - fromTemp));
  if (c.hpCur === 0 && wasUp) {
    if (!/без сознания/i.test(c.conditions)) c.conditions = [c.conditions, 'Без сознания'].filter(Boolean).join(', ');
    c.deathS = 0; c.deathF = 0;
  }
}
function healHero(c, n) {
  const wasDown = c.hpCur === 0;
  c.hpCur = Math.min(c.hpMax, c.hpCur + n);
  if (wasDown && c.hpCur > 0) { c.conditions = removeCond(c.conditions, 'Без сознания'); c.deathS = 0; c.deathF = 0; }
}
const isDead = (c) => (c.deathF || 0) >= 3;

// ---------------- Приключения ----------------
export function startAdventure(id) {
  DM.stopSpeaking();
  const o = blank();
  if (id === 'random') {
    const p = party();
    const lvl = Math.round(p.reduce((s, c) => s + c.level, 0) / Math.max(1, p.length));
    o.custom = generateDungeon(p.length, lvl);
  } else o.advId = id;
  state.offline = o;
  // перед новым приключением герои полностью отдохнули
  party().forEach((c) => {
    c.deathS = 0; c.deathF = 0; c.hpCur = c.hpMax; c.hpTemp = 0; c.slotsUsed = []; c.hdUsed = 0;
    c.conditions = removeCond(c.conditions, 'Без сознания');
  });
  sys(`— ${adv().title} —`);
  if (!state.helpSeen) { state.helpSeen = true; setTimeout(() => H.showHelp && H.showHelp(), 300); }
  assignQuests();
  o.actor = party()[0]?.id;
  o.unit = { k: 'h', id: o.actor };
  enterScene(adv().start, party());
}

function enterScene(id, movers) {
  const o = off();
  const sc = adv().scenes[id];
  if (!sc) { sys('Ошибка сцены: ' + id); return; }
  movers = (movers && movers.length ? movers : [actor()]).filter(Boolean);
  o.pos = o.pos || {}; o.done = o.done || {};
  movers.forEach((c) => { o.pos[c.id] = id; });
  o.sceneId = id;
  o.progress = (o.progress || 0) + 1;
  // мастер обращается к героям по именам
  narrate(`${names(movers)}. ${sc.text}`, `${sc.title} · ${names(movers)}`);
  if (sc.effects && (!o.visited[id] || sc.once === false)) sc.effects.forEach((e) => applyEffect(e, movers));
  o.visited[id] = true;
  if (sc.combat) startCombat(sc.combat, movers);
  if (sc.end === 'win') {
    o.ended = 'win';
    sys('🏆 Приключение пройдено!');
  } else if (sc.end) {
    movers.forEach((c) => { o.done[c.id] = sc.end; });
    if (!active().length) { o.ended = 'lose'; sys('💀 Приключение окончено'); }
    else { sys(`${names(movers)} выбывают из приключения… Остальные герои продолжают!`); }
  }
  save();
  H.rerender();
}

function applyEffect(e, movers) {
  const group = movers && movers.length ? movers : party();
  const a = actor();
  const targets = e.who === 'all' ? group : [group.includes(a) ? a : group[0]].filter(Boolean);
  switch (e.type) {
    case 'hp': {
      const notes = targets.map((c) => {
        const r = rollFormula(String(e.amount).replace('-', ''));
        const n = r ? r.total : 0;
        if (String(e.amount).startsWith('-')) { damageHero(c, n); return `${c.name}: −${n} хитов (${c.hpCur}/${c.hpMax})`; }
        healHero(c, n); return `${c.name}: +${n} хитов`;
      });
      sys(notes.join(' · '));
      break;
    }
    case 'xp': {
      const p = group;
      p.forEach((c) => { c.xp = (Number(c.xp) || 0) + e.amount; });
      sys(`${names(p)}: +${e.amount} опыта` + (p.some((c) => XP[c.level] && c.xp >= XP[c.level]) ? ' — кто-то может повысить уровень!' : ''));
      break;
    }
    case 'gold': {
      sys(targets.map((c) => { const n = rollFormula(String(e.amount))?.total || 0; c.gold = (Number(c.gold) || 0) + n; return `${c.name}: +${n} зм`; }).join(' · '));
      break;
    }
    case 'item':
      targets.forEach((c) => { c.equipment = (c.equipment ? c.equipment + '\n' : '') + e.item; });
      sys(`${targets.map((c) => c.name).join(', ')} получает: ${e.item}`);
      break;
    case 'buy': {
      const c = actor();
      if ((Number(c.gold) || 0) < e.cost) { sys(`${c.name}: не хватает золота (${c.gold} зм)`); break; }
      c.gold -= e.cost; c.equipment = (c.equipment ? c.equipment + '\n' : '') + e.item;
      if (e.flag) off().flags[e.flag] = true;
      sys(`${c.name} покупает ${e.item} (осталось ${c.gold} зм)`);
      break;
    }
    case 'flag': off().flags[e.flag] = true; break;
    case 'rest':
      group.forEach((c) => {
        if (e.long) { c.hpCur = c.hpMax; c.slotsUsed = []; c.hdUsed = Math.max(0, (c.hdUsed || 0) - Math.max(1, Math.floor(c.level / 2))); c.conditions = removeCond(c.conditions, 'Без сознания'); }
        else if (c.classId === 'warlock') c.slotsUsed = [];
        if (c.hpCur === 0) healHero(c, 1);
        c.deathS = 0; c.deathF = 0;
      });
      sys(e.long ? 'Долгий отдых: хиты и ячейки восстановлены' : 'Короткий отдых');
      break;
    default: break;
  }
  save();
}

const XP = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];

// Местные действия: добавляются, если сюжетных вариантов меньше 4
const GENERIC = [
  { gen: 'search', icon: '🔍', label: 'Обыскать место', check: { what: 'Анализ', dc: 12 } },
  { gen: 'listen', icon: '👂', label: 'Прислушаться', check: { what: 'Внимательность', dc: 12 } },
  { gen: 'heal', icon: '🩹', label: 'Перевязать раны', check: { what: 'Медицина', dc: 10 } },
  { gen: 'cheer', icon: '📣', label: 'Подбодрить', check: { what: 'Убеждение', dc: 12 } },
  { gen: 'plan', icon: '🧠', label: 'Обдумать план', repeat: true },
  { gen: 'gear', icon: '🎒', label: 'Проверить снаряжение', repeat: true },
  { gen: 'wait', label: 'Подождать и понаблюдать', repeat: true },
];
const MIN_CHOICES = 4;
const genKey = (g) => `${posOf(actor())}|${actor()?.id}|${g}`;
function visibleChoices(sc) {
  const f = off().flags;
  return (sc.choices || []).filter((ch) => (!ch.if || f[ch.if]) && (!ch.ifnot || !f[ch.ifnot]));
}
function quickActions() {
  const used = off().genUsed || {};
  return GENERIC.filter((g) => g.gen !== 'wait' && (g.repeat || !used[genKey(g.gen)]));
}

const FINDS = ['Факел', 'Моток верёвки', 'Старинная монета', 'Огниво', 'Кусок мела', 'Бурдюк с водой', 'Зелье лечения'];
const HINTS = [
  'Где-то впереди капает вода и скребутся когти — там кто-то есть.',
  'Сквозняк тянет справа: похоже, там есть ещё один проход.',
  'На полу свежие следы — кто-то прошёл здесь совсем недавно.',
  'Вдалеке слышны голоса. Слов не разобрать, но говорящих несколько.',
  'Пахнет дымом и жареным мясом. Чей-то лагерь неподалёку.',
  'Тишина такая, что слышно собственное сердце. Слишком тихо.',
];
function doGeneric(g) {
  const o = off();
  const a = actor();
  const name = a.name.split(' ')[0];
  const others = here(a).filter((x) => x !== a);
  o.genUsed = o.genUsed || {};
  if (!g.repeat) o.genUsed[genKey(g.gen)] = true;
  log({ type: 'player', who: a.name, text: g.label });
  let ok = true;
  if (g.check) {
    const chk = C.resolveCheck(a, g.check.what);
    const r = d20(chk.mod);
    ok = r.total >= g.check.dc;
    log({ type: 'roll', html: rollLine(a, `${chk.label} (СЛ ${g.check.dc})`, r, g.check.dc) });
  }
  let text = '';
  if (g.gen === 'search') {
    if (ok) {
      const item = Math.random() < 0.5 ? null : pick(FINDS);
      const gold = rollFormula('1к6').total;
      a.gold = (Number(a.gold) || 0) + gold;
      if (item) a.equipment = (a.equipment ? a.equipment + '\n' : '') + item;
      text = `${name} обыскивает каждый угол и находит ${gold} зм${item ? ` и ещё кое-что: ${item.toLowerCase()}` : ''}.`;
    } else text = `${name} обыскивает всё вокруг, но находит лишь пыль и паутину.`;
  } else if (g.gen === 'listen') {
    if (ok) { a.xp = (Number(a.xp) || 0) + 10; text = `${name} замирает и прислушивается. ${pick(HINTS)}`; }
    else text = `${name} прислушивается, но ничего не может разобрать.`;
  } else if (g.gen === 'heal') {
    const t = [a, ...others].filter((x) => !isDead(x)).sort((x, y) => x.hpCur / x.hpMax - y.hpCur / y.hpMax)[0];
    if (t.hpCur >= t.hpMax) text = `${name} проверяет повязки, но все целы и невредимы.`;
    else if (ok) { const n = rollFormula('1к4+1').total; healHero(t, n); text = `${name} перевязывает раны${t === a ? '' : ` — ${t.name.split(' ')[0]} получает помощь`}. +${n} хитов.`; }
    else text = `${name} пытается наложить повязку, но она тут же сползает.`;
  } else if (g.gen === 'cheer') {
    const ts = [a, ...others];
    if (ok) { const n = rollFormula('1к4').total; ts.forEach((x) => { x.hpTemp = Math.max(x.hpTemp || 0, n); }); text = others.length ? `${name} подбадривает друзей, и ${names(ts)} чувствуют прилив сил: ${n} временных хитов.` : `${name} собирается с духом: ${n} временных хитов.`; }
    else text = others.length ? `${name} пытается всех подбодрить, но шутка выходит неудачной.` : `${name} пытается собраться с духом, но тревога не отпускает.`;
  } else if (g.gen === 'plan') {
    const sc = scene();
    const real = (sc.choices || []).filter((ch) => ch.check);
    const hard = real.sort((x, y) => (y.check.dc || 0) - (x.check.dc || 0))[0];
    text = hard ? `${name} обдумывает план. Самое рискованное здесь — «${hard.label}»: понадобится ${hard.check.what.toLowerCase()}.` : `${name} обдумывает следующий шаг. Похоже, здесь нужно просто решиться.`;
  } else if (g.gen === 'gear') {
    const items = String(a.equipment || '').split(/\n|,\s*/).map((x) => x.trim()).filter(Boolean);
    const potions = items.filter((x) => /зелье лечения/i.test(x)).length;
    text = `${name} проверяет снаряжение: ${items.length} предметов, ${Number(a.gold) || 0} золотых${potions ? `, зелий лечения: ${potions}` : ', зелий лечения нет'}. Хиты: ${a.hpCur} из ${a.hpMax}.`;
  } else {
    text = `${name} ждёт и наблюдает, давая другим время действовать.`;
  }
  narrate(text, `${scene().title} · ${name}`);
  save();
  quickDone();
}

// Как герой развит в нужной проверке: модификатор и шанс успеха
function chanceOf(c, what, dc) {
  const chk = C.resolveCheck(c, what);
  const need = dc - chk.mod;
  const pct = Math.max(0, Math.min(100, Math.round(((21 - need) / 20) * 100)));
  return { mod: chk.mod, label: chk.label, pct };
}
function chanceHtml(list, what, dc) {
  return list.map((c) => {
    const x = chanceOf(c, what, dc);
    const col = x.pct >= 60 ? 'var(--green)' : x.pct >= 35 ? 'var(--gold)' : 'var(--red)';
    return `<span style="white-space:nowrap">${esc(c.name.split(' ')[0])}: <b>${fmtMod(x.mod)}</b> <b style="color:${col}">${x.pct}%</b></span>`;
  }).join(' · ');
}

function rollLine(c, label, r, dc) {
  const ok = dc ? r.total >= dc : null;
  return `<b>${esc(c.name)}</b> · ${esc(label)}: <b class="${r.nat === 20 ? 'crit' : r.nat === 1 ? 'fumble' : ''}" style="font-size:1.3rem;color:var(--gold)">${r.total}</b> <span class="muted">${r.details}</span>${dc ? (ok ? ' ✅' : ' ❌') : ''}`;
}

function choose(i) {
  const sc = scene();
  const ch = visibleChoices(sc)[i];
  if (!ch) return;
  DM.stopSpeaking();
  if (ch.gen) { doGeneric(ch); return; }
  off().turnActs = 0;
  const a = actor();
  const isGroup = ch.check && ch.check.group;
  // кто идёт: сам герой + те, кого он позвал с собой; групповое действие — все, кто рядом
  const movers = isGroup ? here(a) : [a, ...here(a).filter((x) => x !== a && off().with?.[x.id])];
  off().with = {};
  log({ type: 'player', text: ch.label, who: names(movers) });
  if (ch.go) { enterScene(ch.go, movers); afterAction(); return; }
  if (ch.check) {
    const { what, dc, group } = ch.check;
    let success;
    if (group) {
      const p = movers.filter((c) => c.hpCur > 0);
      const lines = []; let okCount = 0;
      p.forEach((c) => {
        const chk = C.resolveCheck(c, what);
        const r = d20(chk.mod);
        if (r.total >= dc) okCount++;
        lines.push(rollLine(c, chk.label, r, dc));
      });
      success = okCount >= Math.ceil(p.length / 2);
      log({ type: 'roll', html: `Групповая проверка (СЛ ${dc}):<br>${lines.join('<br>')}<br><b>${success ? 'Успех!' : 'Провал!'}</b>` });
    } else {
      const c = actor();
      const chk = C.resolveCheck(c, what);
      const r = d20(chk.mod);
      success = r.total >= dc;
      log({ type: 'roll', html: rollLine(c, `${chk.label} (СЛ ${dc})`, r, dc) });
      H.toast(`<div>${esc(c.name)} · ${esc(chk.label)}</div><div class="big ${success ? 'crit' : 'fumble'}">${r.total}</div><div>${success ? 'Успех!' : 'Провал'}</div>`, 1800);
    }
    setTimeout(() => { enterScene(success ? ch.ok : ch.fail, movers); afterAction(); }, 600);
    save(); H.rerender();
  }
}

// ---------------- Бой ----------------
const HIT = ['наносит точный удар', 'бьёт со всей силы', 'находит брешь в защите', 'обрушивает удар', 'ранит противника'];
const MISS = ['промахивается', 'удар приходится в пустоту', 'противник уворачивается', 'оружие скользит по броне'];
const MON_HIT = ['бросается и ранит', 'с рыком атакует и задевает', 'наносит жестокий удар по', 'вгрызается в'];
const MON_MISS = ['атакует, но промахивается по', 'замахивается, но не попадает по', 'бьёт мимо —'];

function startCombat(def, heroes) {
  const o = off();
  const p = (heroes && heroes.length ? heroes : party()).filter((c) => !isDead(c));
  const n = p.length;
  const lvl = p.reduce((s2, c) => s2 + c.level, 0) / Math.max(1, n);
  // Сколько врагов в тексте — столько и в бою. Для большой группы добавляется ещё один (мастер об этом говорит).
  const keys = [...def.monsters];
  let extra = null;
  if (def.scale && n >= 4) { keys.push(keys[0]); extra = MONSTERS[keys[0]].name; }
  // Баланс: меньше героев и низкий уровень — враги слабее, но их столько же
  const hpMult = (lvl >= 5 ? 2 : lvl >= 3 ? 1.5 : 1) * (n === 1 ? 0.5 : n === 2 ? 0.75 : 1);
  const atkMod = (lvl >= 5 ? 2 : lvl >= 3 ? 1 : 0) - (lvl < 2 ? 1 : 0) - (n === 1 ? 1 : 0);
  const dmgMult = lvl < 2 ? (n === 1 ? 0.5 : n === 2 ? 0.65 : 0.8) : (n === 1 ? 0.75 : 1);
  const counts = {};
  const mons = keys.map((k, i) => {
    const m = MONSTERS[k];
    counts[k] = (counts[k] || 0) + 1;
    const total = keys.filter((x) => x === k).length;
    const hp = Math.max(3, Math.round(m.hp * hpMult));
    return { id: 'm' + i, key: k, name: total > 1 ? `${m.name} ${counts[k]}` : m.name, ac: m.ac + (lvl >= 5 ? 1 : 0), hp, max: hp, atk: m.atk + atkMod, dmg: m.dmg, dmgMult, dex: m.dex, xp: m.xp, boss: m.boss };
  });
  const order = [
    ...p.map((c) => ({ kind: 'hero', id: c.id, init: d20(C.initiative(c)).total, name: c.name })),
    ...mons.map((m) => ({ kind: 'mon', id: m.id, init: d20(m.dex).total, name: m.name })),
  ].sort((a, b) => b.init - a.init);
  const cb = { id: 'cb' + Date.now() + Math.floor(Math.random() * 1000), scene: posOf(p[0]), mons, order, turn: 0, round: 1, win: def.win, lose: def.lose, target: mons[0].id, dodge: {}, used: {}, heroes: p.map((c) => c.id) };
  o.combats = o.combats || [];
  o.combats.push(cb);
  o.focus = cb.id;
  o.unit = { k: 'cb', id: cb.id };
  o._started = true;
  const enemyList = mons.map((m) => m.name).join(', ');
  log({ type: 'roll', html: `⚔️ <b>Бой!</b> ${esc(names(p))} против: ${esc(enemyList)}<br>Инициатива: ${order.map((x) => `${esc(x.name)} ${x.init}`).join(' · ')}` });
  DM.speak(`${extra ? `К ним присоединяется ещё один: ${extra}! ` : ''}Врагов: ${mons.length}. Бросайте инициативу! Первым ходит ${order[0].name}.`);
  save();
  setTimeout(processTurn, 400);
}

function cur() { const cb = CB(); return cb && cb.order[cb.turn]; }
const monById = (id) => CB().mons.find((m) => m.id === id);

function processTurn() {
  const cb = CB();
  if (!cb || off().unit?.k !== 'cb' || off().unit.id !== cb.id) return;
  if (checkEnd()) return;
  const t = cur();
  if (!t) return;
  if (t.kind === 'mon') {
    const m = monById(t.id);
    if (m.hp <= 0) return nextTurn();
    if (cb._busy) return;
    cb._busy = true;
    H.rerender();
    setTimeout(() => { const c2 = CB(); if (c2) c2._busy = false; monsterAct(m); }, 1100);
  } else {
    const c = byId(t.id);
    if (!c || isDead(c) || (c.hpCur === 0 && (c.deathS || 0) >= 3)) return nextTurn();
    delete cb.dodge[c.id];
    cb.used[c.id] = {};
    off().actor = c.id;
    save(); H.rerender();
  }
}

// heroDone: герой закончил свой ход в бою — очередь может перейти к героям вне боя
function nextTurn(heroDone = false) {
  const cb = CB();
  if (!cb) return;
  cb.turn++;
  if (cb.turn >= cb.order.length) { cb.turn = 0; cb.round++; }
  save();
  if (heroDone && units().length > 1) { advance(); H.rerender(); return; }
  processTurn();
}
function endCombat(cb) {
  const o = off();
  o.combats = (o.combats || []).filter((x) => x.id !== cb.id);
  if (o.focus === cb.id) o.focus = null;
}

function checkEnd() {
  const cb = CB();
  if (!cb) return true;
  if (cb.mons.every((m) => m.hp <= 0)) {
    const xp = cb.mons.reduce((s, m) => s + m.xp, 0);
    const hs = cbHeroes();
    const each = Math.floor(xp / Math.max(1, hs.length));
    hs.forEach((c) => { c.xp = (Number(c.xp) || 0) + each; c.deathS = 0; c.deathF = 0; if (c.hpCur === 0) { healHero(c, 1); } });
    endCombat(cb);
    off().unit = { k: 'h', id: hs[0].id }; off().actor = hs[0].id;
    sys(`🏆 Победа! ${names(hs)}: +${each} опыта каждому.` + (hs.some((c) => XP[c.level] && c.xp >= XP[c.level]) ? ' Кто-то может повысить уровень!' : ''));
    save();
    setTimeout(() => { enterScene(cb.win, hs); if (!off()._started && units().length > 1) advance(); off()._started = false; save(); H.rerender(); }, 900);
    H.rerender();
    return true;
  }
  if (cbHeroes().every((c) => c.hpCur <= 0)) {
    const hs = cbHeroes();
    endCombat(cb);
    sys(`${names(hs)} ${hs.length > 1 ? 'пали' : 'пал(а)'} в бою…`);
    save();
    setTimeout(() => { enterScene(cb.lose, hs); off()._started = false; if (!off().ended) advance(); save(); H.rerender(); }, 900);
    H.rerender();
    return true;
  }
  return false;
}

function monsterAct(m) {
  const cb = CB();
  if (!cb || m.hp <= 0) return;
  const targets = cbHeroes().filter((c) => c.hpCur > 0);
  if (!targets.length) return checkEnd();
  const t = pick(targets);
  const mode = cb.dodge[t.id] ? 'dis' : 'normal';
  const r = d20(m.atk, mode);
  const ac = C.ac(t);
  if (r.nat !== 1 && (r.total >= ac || r.nat === 20)) {
    let f = m.dmg;
    if (r.nat === 20) f = f.replace(/^(\d+)/, (n) => String(Number(n) * 2));
    const dmg = Math.max(1, Math.floor(rollFormula(f).total * (m.dmgMult || 1)));
    damageHero(t, dmg);
    const txt = `${m.name} ${pick(MON_HIT)} ${t.name}${r.nat === 20 ? ' критическим ударом' : ''}: ${dmg} урона.${t.hpCur === 0 ? ` ${t.name} падает без сознания!` : ''}`;
    log({ type: 'roll', html: `👹 ${esc(txt)} <span class="muted">(атака ${r.total} против КД ${ac})</span>` });
    DM.speak(txt);
  } else {
    const txt = `${m.name} ${pick(MON_MISS)} ${t.name}.`;
    log({ type: 'roll', html: `👹 ${esc(txt)} <span class="muted">(атака ${r.total} против КД ${ac})</span>` });
    DM.speak(txt);
  }
  save();
  nextTurn();
}

function parseBonus(b) { return parseInt(String(b).replace('−', '-'), 10) || 0; }
function dmgFormula(s) { const m = String(s).match(/\d*\s*[кd]\s*\d+(\s*[+\-−]\s*\d+)?/i); return m ? m[0].replace('−', '-') : '1к4'; }

const HEAL_CLASSES = ['cleric', 'druid', 'bard', 'paladin', 'ranger'];
const CASTER_ATTACK = ['wizard', 'sorcerer', 'warlock', 'cleric', 'druid', 'bard'];

function heroActions(c) {
  const acts = [];
  const cb = CB();
  const used = cb.used[c.id] || {};
  if (c.hpCur === 0) return [{ id: 'death', label: '💀 Спасбросок от смерти' }];
  if (!used.action) {
    const tg = cb.mons.find((m) => m.id === cb.target && m.hp > 0) || cb.mons.find((m) => m.hp > 0);
    const hit = (b) => (tg ? ` · шанс ${Math.max(5, Math.min(95, Math.round(((21 - (tg.ac - b)) / 20) * 100)))}%` : '');
    c.attacks.forEach((a, i) => { if (a.name) acts.push({ id: 'atk:' + i, label: `⚔️ ${a.name} (${a.bonus}${hit(parseBonus(a.bonus))})` }); });
    const si = C.spellInfo(c);
    if (si && CASTER_ATTACK.includes(c.classId)) acts.push({ id: 'spell', label: `✨ Боевой заговор (${fmtMod(si.atk)}${hit(si.atk)}, ${c.level >= 5 ? '2к10' : '1к10'})` });
    const slots = si ? si.slots : [];
    const free = (slots[0] || 0) - ((c.slotsUsed || [])[0] || 0);
    if (si && HEAL_CLASSES.includes(c.classId) && free > 0) acts.push({ id: 'heal', label: `💚 Лечение ран (ячеек ${free})` });
    if (/зелье лечения/i.test(c.equipment || '')) acts.push({ id: 'potion', label: '🧪 Выпить/дать зелье (2к4+2)' });
    acts.push({ id: 'dodge', label: '🛡 Уклонение' });
  }
  if (c.classId === 'fighter' && !used.bonus && !(cb.used2 || {})[c.id] && c.hpCur < c.hpMax) acts.push({ id: 'wind', label: `💨 Второе дыхание (1к10+${c.level})` });
  if (c.classId === 'barbarian' && !(cb.rage || {})[c.id] && !used.bonus) acts.push({ id: 'rage', label: '😡 Ярость' });
  acts.push({ id: 'end', label: '⏭ Закончить ход' });
  return acts;
}

function heroAct(id) {
  const cb = CB();
  const t = cur();
  if (!cb || !t || t.kind !== 'hero') return;
  const c = byId(t.id);
  const used = cb.used[c.id] || (cb.used[c.id] = {});
  let target = monById(cb.target);
  if (!target || target.hp <= 0) { target = cb.mons.find((m) => m.hp > 0); cb.target = target?.id; }
  DM.stopSpeaking();
  const say = (html, text) => { log({ type: 'roll', html }); DM.speak(text); };

  if (id === 'end') return nextTurn(true);
  if (id === 'death') {
    const r = d20(0);
    let res;
    if (r.nat === 20) { healHero(c, 1); res = `${c.name} чудом приходит в себя с 1 хитом!`; }
    else if (r.nat === 1) { c.deathF = (c.deathF || 0) + 2; res = `Натуральная единица! Два провала.`; }
    else if (r.total >= 10) { c.deathS = (c.deathS || 0) + 1; res = `Успех (${c.deathS}/3).`; }
    else { c.deathF = (c.deathF || 0) + 1; res = `Провал (${c.deathF}/3).`; }
    if ((c.deathS || 0) >= 3 && c.hpCur === 0) res += ` ${c.name} стабилизирован.`;
    if (isDead(c)) res += ` ${c.name} погибает…`;
    say(`💀 ${esc(c.name)}: спасбросок от смерти ${r.total}. ${esc(res)}`, `${c.name}: спасбросок от смерти. ${res}`);
    save();
    return nextTurn(true);
  }
  if (id.startsWith('atk:') || id === 'spell') {
    if (!target) return;
    let bonus; let f; let name;
    if (id === 'spell') { const si = C.spellInfo(c); bonus = si.atk; f = c.level >= 5 ? '2к10' : '1к10'; name = 'заклинание'; }
    else { const a = c.attacks[+id.slice(4)]; bonus = parseBonus(a.bonus); f = dmgFormula(a.dmg); name = a.name; }
    const r = d20(bonus);
    used.action = true;
    if (r.nat !== 1 && (r.total >= target.ac || r.nat === 20)) {
      if (r.nat === 20) f = f.replace(/^(\d*)\s*[кd]/i, (m0, n) => `${(parseInt(n, 10) || 1) * 2}к`);
      let dmg = rollFormula(f).total;
      if ((cb.rage || {})[c.id] && id !== 'spell') dmg += 2;
      if (c.classId === 'rogue' && !used.sneak && id !== 'spell') { used.sneak = true; dmg += rollFormula(`${Math.ceil(c.level / 2)}к6`).total; }
      dmg = Math.max(1, dmg);
      target.hp = Math.max(0, target.hp - dmg);
      const killed = target.hp === 0;
      const txt = `${c.name} ${id === 'spell' ? 'обрушивает магию на' : pick(HIT) + ':'} ${target.name}${r.nat === 20 ? ', критическое попадание' : ''}! ${dmg} урона.${killed ? ` ${target.name} повержен!` : ''}`;
      say(`⚔️ ${esc(txt)} <span class="muted">(${esc(name)}: ${r.total} против КД ${target.ac}; ${r.details})</span>`, txt);
    } else {
      const txt = `${c.name} атакует ${target.name}, но ${pick(MISS)}.`;
      say(`⚔️ ${esc(txt)} <span class="muted">(${r.total} против КД ${target.ac})</span>`, txt);
    }
  } else if (id === 'heal') {
    const ally = cbHeroes().filter((x) => !isDead(x)).sort((a, b) => a.hpCur / a.hpMax - b.hpCur / b.hpMax)[0];
    const si = C.spellInfo(c);
    const n = rollFormula('1к8').total + C.mod(c, si.ab);
    healHero(ally, Math.max(1, n));
    c.slotsUsed = c.slotsUsed || []; c.slotsUsed[0] = (c.slotsUsed[0] || 0) + 1;
    used.action = true;
    say(`💚 ${esc(c.name)} лечит ${esc(ally.name)}: +${n} хитов (${ally.hpCur}/${ally.hpMax})`, `${c.name} касается ${ally.name}, и раны затягиваются. Плюс ${n} хитов.`);
  } else if (id === 'potion') {
    const ally = cbHeroes().filter((x) => !isDead(x)).sort((a, b) => a.hpCur / a.hpMax - b.hpCur / b.hpMax)[0];
    const n = rollFormula('2к4+2').total;
    healHero(ally, n);
    c.equipment = c.equipment.replace(/зелье лечения\n?/i, '').trim();
    used.action = true;
    say(`🧪 ${esc(ally.name)} выпивает зелье: +${n} хитов (${ally.hpCur}/${ally.hpMax})`, `${ally.name} выпивает зелье лечения. Плюс ${n} хитов.`);
  } else if (id === 'dodge') {
    cb.dodge[c.id] = true; used.action = true;
    say(`🛡 ${esc(c.name)} уходит в глухую оборону`, `${c.name} уходит в оборону.`);
  } else if (id === 'wind') {
    const n = rollFormula(`1к10+${c.level}`).total;
    healHero(c, n); used.bonus = true; cb.used2 = cb.used2 || {}; cb.used2[c.id] = true;
    say(`💨 ${esc(c.name)}: второе дыхание, +${n} хитов`, `${c.name} переводит дух и получает ${n} хитов.`);
  } else if (id === 'rage') {
    cb.rage = cb.rage || {}; cb.rage[c.id] = true; used.bonus = true;
    say(`😡 ${esc(c.name)} впадает в ярость! (+2 к урону)`, `${c.name} впадает в ярость!`);
  }
  save();
  if (checkEnd()) return;
  if (used.action && (used.bonus || !heroActions(c).some((a) => ['wind', 'rage'].includes(a.id)))) return nextTurn(true);
  H.rerender();
}

// Свободный герой прибегает на помощь и вступает в идущий бой
function joinCombat(cbId) {
  const o = off();
  const cb = (o.combats || []).find((x) => x.id === cbId);
  const a = actor();
  if (!cb || !a || combatOf(a)) return;
  DM.stopSpeaking();
  const init = d20(C.initiative(a)).total;
  const entry = { kind: 'hero', id: a.id, init, name: a.name };
  let idx = cb.order.findIndex((x) => x.init < init);
  if (idx < 0) idx = cb.order.length;
  cb.order.splice(idx, 0, entry);
  if (idx <= cb.turn) cb.turn++;
  cb.heroes.push(a.id);
  o.pos[a.id] = cb.scene;
  const sc = adv().scenes[cb.scene];
  log({ type: 'player', who: a.name, text: `⚔️ Бежать на помощь (${sc?.title || ''})` });
  narrate(`${a.name.split(' ')[0]} врывается в бой рядом с ${names(cb.heroes.filter((id) => id !== a.id).map(byId).filter(Boolean))}! Инициатива: ${init}.`, `⚔️ ${sc?.title || 'Бой'} · ${a.name.split(' ')[0]}`);
  save();
  advance(false);
  H.rerender();
}

// ---------------- Интерфейс ----------------
export function render(root) {
  const o = off();
  const p = party();
  const cb = o.unit?.k === 'cb' ? CB() : null;
  const t = cb && cur();
  if (!o.sceneId) {
    root.innerHTML = `<div style="padding:12px;overflow-y:auto">
      <div class="card"><h2>📖 Мастер без ИИ</h2>
      <p class="muted">Готовые и случайные приключения: мастер озвучивает историю голосом, вы выбираете действия, бросаете проверки и сражаетесь по правилам D&D 5e. Интернет и API-ключ не нужны.</p></div>
      ${ADVENTURES.map((a) => `<div class="card"><h3>${esc(a.title)}</h3><p class="muted">${esc(a.desc)}</p><button class="btn primary" data-o="start:${a.id}">▶️ Играть</button></div>`).join('')}
      <div class="card"><h3>🎲 Случайное подземелье</h3><p class="muted">Каждый раз новое: ловушки, загадки, встречи, сокровища, бои и главарь в конце. Сложность подстраивается под группу.</p><button class="btn primary" data-o="start:random">🎲 Создать и играть</button></div>
      <button class="btn" data-o="ai" style="width:100%">🐉 Переключиться на ИИ-мастера</button>
    </div>`;
    bind(root);
    return;
  }
  const sc = scene();
  root.innerHTML = `
    <div id="party-bar">${p.map((c) => {
      const pct = Math.max(0, Math.min(100, (c.hpCur / Math.max(1, c.hpMax)) * 100));
      const active = cb ? (t && t.kind === 'hero' && t.id === c.id) : actor()?.id === c.id;
      const fighting = combatOf(c);
      return `<button class="pchip ${active ? 'sel' : ''}" data-o="sheet:${c.id}">
        <b>${esc(c.emoji)} ${esc(c.name.split(' ')[0])}</b>
        ${o.sceneId ? `<span class="muted" style="display:block;font-size:.7rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px">${o.done?.[c.id] ? '⛓ выбыл(а)' : (fighting ? '⚔️ ' : '📍 ') + esc(adv().scenes[posOf(c)]?.title || '')}</span>` : ''}
        <span class="muted">${isDead(c) ? '☠️ погиб' : `❤ ${c.hpCur}/${c.hpMax} · 🛡 ${C.ac(c)}`}</span>
        <div class="hpbar"><i style="width:${pct}%;background:${pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--gold)' : 'var(--green)'}"></i></div></button>`;
    }).join('')}</div>
    <div id="log">${o.log.slice(-80).map(entryHtml).join('')}</div>
    <div id="composer" class="off-panel">${panelHtml(sc, cb, t)}</div>`;
  const lg = $('#log', root); lg.scrollTop = lg.scrollHeight;
  bind(root);
}

function entryHtml(e, i) {
  if (e.type === 'turn') return `<div class="turn-divider"><span>🎯 ${esc(e.text)}</span></div>`;
  if (e.type === 'dm') return `<div class="msg dm"><span class="who">📖 ${esc(e.title || 'Мастер')} <button class="btn small" data-o="say:${i}" style="float:right;padding:0 6px">🔈</button></span>${esc(e.text)}</div>`;
  if (e.type === 'player') return `<div class="msg player"><span class="who">${esc(e.who)}</span>${esc(e.text)}</div>`;
  if (e.type === 'roll') return `<div class="msg roll">${e.html}</div>`;
  return `<div class="msg sys">${esc(e.text)}</div>`;
}

const pill = (pct) => `<span class="pill ${pct >= 60 ? 'good' : pct >= 35 ? 'mid' : 'bad'}">${pct}%</span>`;
function oddsLine(list, what, dc) {
  return list.map((c) => { const x = chanceOf(c, what, dc); return `<span class="odds">${esc(c.name.split(' ')[0])} ${fmtMod(x.mod)} ${pill(x.pct)}</span>`; }).join(' ');
}
export const HELP_HTML = `<h3>❓ Как играть</h3>
  <p><b>Ход и действия.</b> Герои ходят по очереди. В свой ход можно сделать до ${MAX_QUICK} <b>быстрых действий</b> (обыскать, прислушаться, перевязать раны, шаг личной истории ⭐) — они не заканчивают ход. <b>Главное действие</b> — сюжетный выбор — двигает историю и передаёт ход следующему. Можно и просто нажать «Закончить ход».</p>
  <p><b>Проверки.</b> 🎲 — нужен бросок к20 + модификатор героя против сложности (СЛ). Цветная метка — шанс успеха именно у этого героя: <span class="pill good">60%+</span> хорошо, <span class="pill mid">35–60%</span> рискованно, <span class="pill bad">до 35%</span> лучше поручить другому.</p>
  <p><b>Разделение.</b> Если герой уходит — остальные остаются. Чтобы пойти вместе, отметьте спутников в «Взять с собой».</p>
  <p><b>Бой.</b> Ходят по инициативе. Нажмите на врага, чтобы выбрать цель, затем — атаку. Герои вне боя ходят между ходами бойцов и могут прибежать на помощь.</p>
  <p><b>Лист героя.</b> Нажмите на карточку героя вверху — откроются характеристики, способности и инвентарь.</p>
  <p class="muted">Эта подсказка всегда есть в меню ☰ → «Как играть».</p>`;

function panelHtml(sc, cb, t) {
  const o = off();
  if (o.ended) {
    return `<div class="center"><h3>${o.ended === 'win' ? '🏆 Победа!' : '💀 Конец'}</h3>
      <div class="row" style="justify-content:center"><button class="btn primary" data-o="menu">📚 К списку приключений</button></div></div>`;
  }
  // ---------- бой ----------
  if (cb) {
    const fighters = cb.heroes.map(byId).filter(Boolean);
    const freeH = active().filter((x) => !combatOf(x) && x.hpCur > 0);
    const mons = cb.mons.map((m) => `<button class="enemy ${cb.target === m.id && m.hp > 0 ? 'target' : ''} ${m.hp <= 0 ? 'dead' : ''}" data-o="target:${m.id}" ${m.hp <= 0 ? 'disabled' : ''}>
      <div class="en-name">${m.boss ? '💀' : '👹'} ${esc(m.name)}${cb.target === m.id && m.hp > 0 ? ' 🎯' : ''}</div>
      <div class="muted">${m.hp > 0 ? `❤ ${m.hp}/${m.max} · 🛡 КД ${m.ac}` : 'повержен'}</div>
      <div class="hpbar"><i style="width:${(m.hp / m.max) * 100}%;background:var(--red)"></i></div></button>`).join('');
    let actions = '';
    if (t.kind === 'hero') {
      const c = byId(t.id);
      const acts = heroActions(c);
      const main = acts.filter((x) => x.id !== 'end');
      actions = `<div class="turn-card"><div class="tc-av">${esc(c.emoji)}</div><div class="grow"><div class="tc-title">Ходит ${esc(c.name.split(' ')[0])}</div>
          <div class="muted">❤ ${c.hpCur}/${c.hpMax} · 🛡 КД ${C.ac(c)} · раунд ${cb.round}</div></div></div>
        ${c.hpCur > 0 ? '<div class="sec-title">🎯 Выберите цель (нажмите на врага), затем действие</div>' : '<div class="sec-title">💀 Герой без сознания</div>'}
        <div class="act-grid">${main.map((a) => `<button class="btn" data-o="act:${a.id}">${esc(a.label)}</button>`).join('')}</div>
        <button class="btn end-btn" data-o="act:end">✅ Закончить ход</button>`;
    } else actions = `<div class="turn-card enemy-turn"><div class="tc-av">👹</div><div class="grow"><div class="tc-title">Ходит ${esc(t.name)}…</div><div class="muted">Подождите, враг действует</div></div></div>`;
    return `<div class="sec-title">⚔️ Бой: ${esc(adv().scenes[cb.scene]?.title || '')} · ${esc(names(fighters))}</div>
      ${freeH.length ? `<div class="muted small-note">Вне боя: ${esc(names(freeH))} — ходят между ходами бойцов и могут прибежать на помощь.</div>` : ''}
      <div class="enemy-row">${mons}</div>${actions}`;
  }
  // ---------- исследование ----------
  const a = actor();
  if (!a) return '';
  const chs = visibleChoices(sc);
  const qs = quickActions();
  const ps = personalAvailable(a);
  const pq = questOf(a);
  const others = here(a).filter((x) => x !== a && !combatOf(x));
  const away = active().filter((x) => posOf(x) !== posOf(a) || combatOf(x));
  const multi = party().length > 1;
  const left = quickLeft();
  let h = `<div class="turn-card compact"><div class="tc-av">${esc(a.emoji)}</div><div class="grow">
      <div class="tc-title">${multi ? 'Ходит ' : ''}${esc(a.name.split(' ')[0])} <span class="muted" style="font-family:sans-serif;font-size:.8rem;font-weight:400">❤ ${a.hpCur}/${a.hpMax}</span></div>
      <div class="muted tc-sub">📍 ${esc(sc.title)}${others.length ? ` · рядом: ${esc(names(others))}` : ''}${away.length ? ` · отдельно: ${esc(names(away))}` : ''}</div></div>
      ${multi ? `<div class="tc-left" title="Быстрые действия за ход">⚡ ${left}/${MAX_QUICK}</div>` : ''}</div>`;
  if (multi && !turnOrderOn()) {
    h += `<div class="with-row"><span class="muted">Кто действует:</span> ${active().filter((x) => !combatOf(x)).map((x) => `<button class="chip ${x.id === a.id ? 'on' : ''}" data-o="actor:${x.id}">${esc(x.name.split(' ')[0])}</button>`).join('')}</div>`;
  }
  // бои рядом
  (o.combats || []).forEach((f) => {
    h += `<button class="choice fight" data-o="join:${f.id}"><span class="ch-ic">⚔️</span><span class="grow"><b>${posOf(a) === f.scene ? 'Вступить в бой' : 'Бежать на помощь'}</b>: ${esc(names(f.heroes.map(byId).filter(Boolean)))} — ${esc(adv().scenes[f.scene]?.title || '')}<br><span class="muted">врагов осталось: ${f.mons.filter((m) => m.hp > 0).length} · заканчивает ход</span></span></button>`;
  });
  // главное действие
  h += `<div class="sec-title">➤ Главное действие <span class="muted">— ${multi ? 'передаёт ход' : 'двигает историю'}</span></div>`;
  if (others.length) {
    h += `<div class="with-row"><span class="muted">Взять с собой:</span> ${others.map((x) => `<button class="chip ${o.with?.[x.id] ? 'on' : ''}" data-o="with:${x.id}">${o.with?.[x.id] ? '✓ ' : '+ '}${esc(x.name.split(' ')[0])}</button>`).join('')}</div>`;
  }
  h += chs.map((ch, i) => {
    const ic = ch.check ? '🎲' : '➤';
    let sub = '';
    if (ch.check) {
      const list = ch.check.group ? [a, ...others] : [a];
      sub = `<div class="ch-sub"><span class="muted">${esc(ch.check.what)} · СЛ ${ch.check.dc}${ch.check.group ? ' · бросают все рядом' : ''}</span> ${oddsLine(list, ch.check.what, ch.check.dc)}</div>`;
    }
    return `<button class="choice" data-o="choose:${i}"><span class="ch-ic">${ic}</span><span class="grow"><b>${esc(ch.label)}</b>${sub}</span></button>`;
  }).join('');
  // быстрые действия
  h += `<div class="sec-title">⚡ Быстрые действия <span class="muted">— ход не заканчивают${multi ? ` (осталось ${left})` : ''}</span></div>`;
  if (pq && !pq.q.done) {
    h += ps ? `<button class="choice personal" data-o="personal" ${left === 0 ? 'disabled' : ''}><span class="ch-ic">⭐</span><span class="grow"><b>${esc(ps.label)}</b><div class="ch-sub"><span class="muted">Личная история «${esc(pq.tpl.title)}» · ${esc(ps.what)} · СЛ ${ps.dc}</span> ${oddsLine([a], ps.what, ps.dc)}</div></span></button>`
      : `<div class="muted small-note">⭐ «${esc(pq.tpl.title)}» — шаг ${pq.q.step + 1}/3 откроется дальше по сюжету.</div>`;
  }
  h += `<div class="quick-grid">${qs.map((g) => `<button class="quick" data-o="quick:${g.gen}" ${left === 0 && multi ? 'disabled' : ''}>${g.icon} ${esc(g.label)}${g.check ? `<br>${pill(chanceOf(a, g.check.what, g.check.dc).pct)}` : ''}</button>`).join('')}</div>`;
  if (multi) h += `<button class="btn end-btn" data-o="endturn">✅ Закончить ход</button>`;
  return h;
}

function bind(root) {
  root.onclick = (e) => {
    const v = e.target.closest('[data-o]')?.dataset.o;
    if (!v) return;
    const [cmd, arg] = [v.slice(0, v.indexOf(':') < 0 ? v.length : v.indexOf(':')), v.includes(':') ? v.slice(v.indexOf(':') + 1) : ''];
    switch (cmd) {
      case 'start': startAdventure(arg); break;
      case 'ai': state.mode = 'ai'; save(); H.rerender(); break;
      case 'menu': DM.stopSpeaking(); state.offline = blank(); save(); H.rerender(); break;
      case 'actor':
        if (turnOrderOn() && party().length > 1 && arg !== actor().id) { H.toast(`Сейчас ход: ${esc(actor().name)}. Можно нажать «⏭ Пропустить».`); break; }
        off().actor = arg; save(); H.rerender(); break;
      case 'skip': sys(`${actor().name} пропускает ход`); advance(); H.rerender(); break;
      case 'personal': if (quickLeft() > 0 || party().length < 2) choosePersonal(); break;
      case 'quick': { const g = GENERIC.find((x) => x.gen === arg); if (g && (quickLeft() > 0 || party().length < 2)) doGeneric(g); break; }
      case 'endturn': endTurn(); break;
      case 'with': { const w = off().with || (off().with = {}); w[arg] = !w[arg]; save(); H.rerender(); break; }
      case 'sheet': H.openSheet(arg); break;
      case 'choose': choose(+arg); break;
      case 'target': { const c2 = CB(); if (c2) c2.target = arg; save(); H.rerender(); break; }
      case 'join': joinCombat(arg); break;
      case 'act': heroAct(arg); break;
      case 'say': { const e2 = off().log.slice(-80)[+arg]; if (e2) DM.speak(e2.text, { flush: true }); break; }
      default: break;
    }
  };
}

export function repeatLast() {
  const last = [...off().log].reverse().find((x) => x.type === 'dm');
  if (last) DM.speak(last.text, { flush: true });
}
export function resume() {
  // после перезагрузки страницы: продолжить ход монстра, если он прервался
  const o = off();
  (o.combats || []).forEach((c) => { c._busy = false; });
  if (o.unit?.k === 'cb' && CB() && cur()?.kind === 'mon') setTimeout(processTurn, 500);
}
export function quit() { DM.stopSpeaking(); state.offline = blank(); save(); }
