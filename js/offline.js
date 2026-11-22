// «Мастер без ИИ»: движок сцен, проверок и пошагового боя. Работает полностью офлайн.
import { state, save } from './store.js';
import { ADVENTURES, MONSTERS, generateDungeon } from './adventures.js';
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
function blank() { return { advId: null, custom: null, sceneId: null, flags: {}, visited: {}, log: [], combat: null, ended: null, actor: null }; }
const adv = () => off().custom || ADVENTURES.find((a) => a.id === off().advId);
const scene = () => adv()?.scenes[off().sceneId];

function log(entry) { off().log.push(entry); if (off().log.length > 300) off().log.splice(0, 50); save(); }
function narrate(text, title) { log({ type: 'dm', title, text }); DM.speak(text); }
function sys(text) { log({ type: 'sys', text }); }

function actor() {
  const p = party();
  let c = byId(off().actor);
  if (!c || !p.includes(c)) c = p.find((x) => x.hpCur > 0) || p[0];
  return c;
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
  enterScene(adv().start);
}

function enterScene(id) {
  const o = off();
  const sc = adv().scenes[id];
  if (!sc) { sys('Ошибка сцены: ' + id); return; }
  o.sceneId = id;
  narrate(sc.text, sc.title);
  if (sc.effects && (!o.visited[id] || sc.once === false)) sc.effects.forEach((e) => applyEffect(e));
  o.visited[id] = true;
  if (sc.combat) startCombat(sc.combat);
  if (sc.end) {
    o.ended = sc.end;
    sys(sc.end === 'win' ? '🏆 Приключение пройдено!' : '💀 Приключение окончено');
  }
  save();
  H.rerender();
}

function applyEffect(e) {
  const targets = e.who === 'all' ? party() : [actor()].filter(Boolean);
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
      const p = party();
      p.forEach((c) => { c.xp = (Number(c.xp) || 0) + e.amount; });
      sys(`Каждый герой получает ${e.amount} опыта` + (p.some((c) => XP[c.level] && c.xp >= XP[c.level]) ? ' — кто-то может повысить уровень!' : ''));
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
      sys(`${c.name} покупает ${e.item} (осталось ${c.gold} зм)`);
      break;
    }
    case 'flag': off().flags[e.flag] = true; break;
    case 'rest':
      party().forEach((c) => {
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

function visibleChoices(sc) {
  const f = off().flags;
  return (sc.choices || []).filter((ch) => (!ch.if || f[ch.if]) && (!ch.ifnot || !f[ch.ifnot]));
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
  log({ type: 'player', text: ch.label, who: ch.check && ch.check.group ? 'Вся группа' : actor().name });
  if (ch.go) return enterScene(ch.go);
  if (ch.check) {
    const { what, dc, group } = ch.check;
    let success;
    if (group) {
      const p = party().filter((c) => c.hpCur > 0);
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
    setTimeout(() => enterScene(success ? ch.ok : ch.fail), 600);
    save(); H.rerender();
  }
}

// ---------------- Бой ----------------
const HIT = ['наносит точный удар', 'бьёт со всей силы', 'находит брешь в защите', 'обрушивает удар', 'ранит противника'];
const MISS = ['промахивается', 'удар приходится в пустоту', 'противник уворачивается', 'оружие скользит по броне'];
const MON_HIT = ['бросается и ранит', 'с рыком атакует и задевает', 'наносит жестокий удар по', 'вгрызается в'];
const MON_MISS = ['атакует, но промахивается по', 'замахивается, но не попадает по', 'бьёт мимо —'];

function startCombat(def) {
  const p = party();
  const lvl = p.reduce((s, c) => s + c.level, 0) / Math.max(1, p.length);
  let keys = [...def.monsters];
  if (def.scale && p.length >= 4) keys.push(keys[0]);
  // меньше героев — меньше врагов
  if (p.length === 1) keys = keys.slice(0, 1);
  else if (p.length === 2 && keys.length > 1) keys = keys.slice(0, keys.length - 1);
  else if (p.length === 3 && keys.length > 3) keys = keys.slice(0, 3);
  const solo = p.length === 1 ? 0.6 : 1;
  const counts = {};
  const mons = keys.map((k, i) => {
    const m = MONSTERS[k];
    counts[k] = (counts[k] || 0) + 1;
    const total = keys.filter((x) => x === k).length;
    const mult = lvl >= 5 ? 2 : lvl >= 3 ? 1.5 : 1;
    const hp = Math.max(3, Math.round(m.hp * mult * solo));
    return { id: 'm' + i, key: k, name: total > 1 ? `${m.name} ${counts[k]}` : m.name, ac: m.ac + (lvl >= 5 ? 1 : 0), hp, max: hp, atk: m.atk + (lvl >= 5 ? 2 : lvl >= 3 ? 1 : 0), dmg: m.dmg, dex: m.dex, xp: m.xp, boss: m.boss };
  });
  const order = [
    ...p.map((c) => ({ kind: 'hero', id: c.id, init: d20(C.initiative(c)).total, name: c.name })),
    ...mons.map((m) => ({ kind: 'mon', id: m.id, init: d20(m.dex).total, name: m.name })),
  ].sort((a, b) => b.init - a.init);
  off().combat = { mons, order, turn: 0, round: 1, win: def.win, lose: def.lose, target: mons[0].id, dodge: {}, used: {} };
  log({ type: 'roll', html: `⚔️ <b>Бой!</b> Инициатива: ${order.map((x) => `${esc(x.name)} ${x.init}`).join(' · ')}` });
  DM.speak(`Бросайте инициативу! Первым ходит ${order[0].name}.`);
  save();
  setTimeout(processTurn, 400);
}

function cur() { const cb = off().combat; return cb && cb.order[cb.turn]; }
const monById = (id) => off().combat.mons.find((m) => m.id === id);

function processTurn() {
  const cb = off().combat;
  if (!cb) return;
  if (checkEnd()) return;
  const t = cur();
  if (t.kind === 'mon') {
    const m = monById(t.id);
    if (m.hp <= 0) return nextTurn();
    H.rerender();
    setTimeout(() => monsterAct(m), 1100);
  } else {
    const c = byId(t.id);
    if (!c || isDead(c) || (c.hpCur === 0 && (c.deathS || 0) >= 3)) return nextTurn();
    delete cb.dodge[c.id];
    cb.used[c.id] = {};
    off().actor = c.id;
    save(); H.rerender();
  }
}

function nextTurn() {
  const cb = off().combat;
  if (!cb) return;
  cb.turn++;
  if (cb.turn >= cb.order.length) { cb.turn = 0; cb.round++; }
  save();
  processTurn();
}

function checkEnd() {
  const cb = off().combat;
  if (!cb) return true;
  if (cb.mons.every((m) => m.hp <= 0)) {
    const xp = cb.mons.reduce((s, m) => s + m.xp, 0);
    const each = Math.floor(xp / Math.max(1, party().length));
    party().forEach((c) => { c.xp = (Number(c.xp) || 0) + each; c.deathS = 0; c.deathF = 0; if (c.hpCur === 0) { healHero(c, 1); } });
    off().combat = null;
    sys(`🏆 Победа! Каждый получает ${each} опыта.` + (party().some((c) => XP[c.level] && c.xp >= XP[c.level]) ? ' Кто-то может повысить уровень!' : ''));
    save();
    setTimeout(() => enterScene(cb.win), 900);
    H.rerender();
    return true;
  }
  if (party().every((c) => c.hpCur <= 0)) {
    off().combat = null;
    sys('Все герои пали…');
    save();
    setTimeout(() => enterScene(cb.lose), 900);
    H.rerender();
    return true;
  }
  return false;
}

function monsterAct(m) {
  const cb = off().combat;
  if (!cb || m.hp <= 0) return;
  const targets = party().filter((c) => c.hpCur > 0);
  if (!targets.length) return checkEnd();
  const t = pick(targets);
  const mode = cb.dodge[t.id] ? 'dis' : 'normal';
  const r = d20(m.atk, mode);
  const ac = C.ac(t);
  if (r.nat !== 1 && (r.total >= ac || r.nat === 20)) {
    let f = m.dmg;
    if (r.nat === 20) f = f.replace(/^(\d+)/, (n) => String(Number(n) * 2));
    const dmg = rollFormula(f).total;
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
  const cb = off().combat;
  const used = cb.used[c.id] || {};
  if (c.hpCur === 0) return [{ id: 'death', label: '💀 Спасбросок от смерти' }];
  if (!used.action) {
    c.attacks.forEach((a, i) => { if (a.name) acts.push({ id: 'atk:' + i, label: `⚔️ ${a.name} (${a.bonus})` }); });
    const si = C.spellInfo(c);
    if (si && CASTER_ATTACK.includes(c.classId)) acts.push({ id: 'spell', label: `✨ Боевой заговор (${fmtMod(si.atk)}, ${c.level >= 5 ? '2к10' : '1к10'})` });
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
  const cb = off().combat;
  const t = cur();
  if (!cb || !t || t.kind !== 'hero') return;
  const c = byId(t.id);
  const used = cb.used[c.id] || (cb.used[c.id] = {});
  let target = monById(cb.target);
  if (!target || target.hp <= 0) { target = cb.mons.find((m) => m.hp > 0); cb.target = target?.id; }
  DM.stopSpeaking();
  const say = (html, text) => { log({ type: 'roll', html }); DM.speak(text); };

  if (id === 'end') return nextTurn();
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
    return nextTurn();
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
    const ally = party().filter((x) => !isDead(x)).sort((a, b) => a.hpCur / a.hpMax - b.hpCur / b.hpMax)[0];
    const si = C.spellInfo(c);
    const n = rollFormula('1к8').total + C.mod(c, si.ab);
    healHero(ally, Math.max(1, n));
    c.slotsUsed = c.slotsUsed || []; c.slotsUsed[0] = (c.slotsUsed[0] || 0) + 1;
    used.action = true;
    say(`💚 ${esc(c.name)} лечит ${esc(ally.name)}: +${n} хитов (${ally.hpCur}/${ally.hpMax})`, `${c.name} касается ${ally.name}, и раны затягиваются. Плюс ${n} хитов.`);
  } else if (id === 'potion') {
    const ally = party().filter((x) => !isDead(x)).sort((a, b) => a.hpCur / a.hpMax - b.hpCur / b.hpMax)[0];
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
  if (used.action && (used.bonus || !heroActions(c).some((a) => ['wind', 'rage'].includes(a.id)))) return nextTurn();
  H.rerender();
}

// ---------------- Интерфейс ----------------
export function render(root) {
  const o = off();
  const p = party();
  const cb = o.combat;
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
      return `<button class="pchip ${active ? 'sel' : ''}" data-o="sheet:${c.id}">
        <b>${esc(c.emoji)} ${esc(c.name.split(' ')[0])}</b>
        <span class="muted">${isDead(c) ? '☠️ погиб' : `❤ ${c.hpCur}/${c.hpMax} · 🛡 ${C.ac(c)}`}</span>
        <div class="hpbar"><i style="width:${pct}%;background:${pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--gold)' : 'var(--green)'}"></i></div></button>`;
    }).join('')}</div>
    <div id="log">${o.log.slice(-80).map(entryHtml).join('')}</div>
    <div id="composer" style="max-height:48dvh;overflow-y:auto">${panelHtml(sc, cb, t)}</div>`;
  const lg = $('#log', root); lg.scrollTop = lg.scrollHeight;
  bind(root);
}

function entryHtml(e, i) {
  if (e.type === 'dm') return `<div class="msg dm"><span class="who">📖 ${esc(e.title || 'Мастер')} <button class="btn small" data-o="say:${i}" style="float:right;padding:0 6px">🔈</button></span>${esc(e.text)}</div>`;
  if (e.type === 'player') return `<div class="msg player"><span class="who">${esc(e.who)}</span>${esc(e.text)}</div>`;
  if (e.type === 'roll') return `<div class="msg roll">${e.html}</div>`;
  return `<div class="msg sys">${esc(e.text)}</div>`;
}

function panelHtml(sc, cb, t) {
  const o = off();
  if (o.ended) {
    return `<div class="center"><h3>${o.ended === 'win' ? '🏆 Победа!' : '💀 Конец'}</h3>
      <div class="row" style="justify-content:center"><button class="btn primary" data-o="menu">📚 К списку приключений</button></div></div>`;
  }
  if (cb) {
    const mons = cb.mons.map((m) => `<button class="pchip ${cb.target === m.id ? 'sel' : ''}" data-o="target:${m.id}" ${m.hp <= 0 ? 'disabled style="opacity:.4"' : ''}>
      <b>${m.boss ? '💀' : '👹'} ${esc(m.name)}</b><span class="muted">${m.hp > 0 ? `❤ ${m.hp}/${m.max} · 🛡 ${m.ac}` : 'повержен'}</span>
      <div class="hpbar"><i style="width:${(m.hp / m.max) * 100}%;background:var(--red)"></i></div></button>`).join('');
    let actions = '';
    if (t.kind === 'hero') {
      const c = byId(t.id);
      actions = `<div class="muted" style="margin:6px 0">Ход: <b style="color:var(--gold)">${esc(c.name)}</b> · раунд ${cb.round} · цель: нажмите на врага</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${heroActions(c).map((a) => `<button class="btn small" data-o="act:${a.id}">${esc(a.label)}</button>`).join('')}</div>`;
    } else actions = `<div class="muted center" style="margin:8px 0">Ходит ${esc(t.name)}…</div>`;
    return `<div style="display:flex;gap:6px;overflow-x:auto;padding-bottom:4px">${mons}</div>${actions}`;
  }
  const chs = visibleChoices(sc);
  const a = actor();
  return `<div class="speaker-sel">Действует: ${party().map((c) => `<button data-o="actor:${c.id}" class="${a && a.id === c.id ? 'sel' : ''}">${esc(c.name.split(' ')[0])}</button>`).join('')}</div>
    <div style="display:grid;gap:6px">${chs.map((ch, i) => `<button class="btn" style="text-align:left" data-o="choose:${i}">${ch.check ? '🎲 ' : '➤ '}${esc(ch.label)}${ch.check ? ` <span class="muted">(${esc(ch.check.what)}, СЛ ${ch.check.dc}${ch.check.group ? ', вся группа' : ''})</span>` : ''}</button>`).join('')}</div>`;
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
      case 'actor': off().actor = arg; save(); H.rerender(); break;
      case 'sheet': H.openSheet(arg); break;
      case 'choose': choose(+arg); break;
      case 'target': off().combat.target = arg; save(); H.rerender(); break;
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
  const cb = off().combat;
  if (cb && cur()?.kind === 'mon') setTimeout(processTurn, 500);
}
export function quit() { DM.stopSpeaking(); state.offline = blank(); save(); }
