// Расчёты и генерация персонажей
import { ABILITIES, SKILLS, RACES, CLASSES, BACKGROUNDS, ARMORS, SPELLS, ALIGNMENTS, STANDARD_ARRAY, randomName, spellSlots } from './data.js';
import { rnd } from './dice.js';
import { uid } from './store.js';

export const race = (c) => RACES.find((r) => r.id === c.raceId) || RACES[0];
export const klass = (c) => CLASSES.find((k) => k.id === c.classId) || CLASSES[0];
export const bg = (c) => BACKGROUNDS.find((b) => b.id === c.bgId) || BACKGROUNDS[0];
export const armor = (c) => ARMORS.find((a) => a.id === c.armorId) || ARMORS[0];
export const modOf = (score) => Math.floor((score - 10) / 2);
export const prof = (c) => 2 + Math.floor((Math.max(1, c.level) - 1) / 4);

export function racialBonus(c, ab) {
  return (race(c).bonus[ab] || 0);
}
export function score(c, ab) {
  return (Number(c.base[ab]) || 0) + racialBonus(c, ab) + (Number(c.extra[ab]) || 0);
}
export const mod = (c, ab) => modOf(score(c, ab));

export function allSkillProfs(c) {
  const set = new Set(c.skillProf);
  (race(c).skills || []).forEach((s) => set.add(s));
  bg(c).skills.forEach((s) => set.add(s));
  return set;
}
export function skillMod(c, id) {
  const sk = SKILLS.find((s) => s.id === id);
  const profs = allSkillProfs(c);
  let m = mod(c, sk.ab);
  if (profs.has(id)) m += prof(c) * (c.expertise.includes(id) ? 2 : 1);
  else if (c.classId === 'bard' && c.level >= 2) m += Math.floor(prof(c) / 2); // Мастер на все руки
  return m;
}
export function saveMod(c, ab) {
  return mod(c, ab) + (klass(c).saves.includes(ab) ? prof(c) : 0);
}
export function ac(c) {
  const a = armor(c);
  const k = klass(c);
  const dex = mod(c, 'dex');
  let v;
  if (a.id === 'none' && k.unarmored) v = 10 + dex + mod(c, k.unarmored);
  else if (a.id === 'none' && c.mageArmor) v = 13 + dex;
  else v = a.base + (a.dex ? (a.max ? Math.min(dex, a.max) : dex) : 0);
  if (c.shield && !(k.id === 'monk')) v += 2;
  return v + (Number(c.acMisc) || 0);
}
export const initiative = (c) => mod(c, 'dex') + (Number(c.initMisc) || 0);
export const passive = (c) => 10 + skillMod(c, 'perception');
export const speed = (c) => race(c).speed + (c.classId === 'monk' && c.level >= 2 ? 10 + Math.floor((c.level - 2) / 4) * 5 : 0) + (c.classId === 'barbarian' && c.level >= 5 ? 10 : 0);

export function autoHp(c) {
  const k = klass(c);
  const con = mod(c, 'con');
  const avg = k.hd / 2 + 1;
  let hp = k.hd + con + (c.level - 1) * (avg + con);
  hp += (race(c).hpPerLevel || 0) * c.level;
  return Math.max(1, hp);
}

export function spellInfo(c) {
  const k = klass(c);
  if (!k.spellAb) return null;
  const m = mod(c, k.spellAb);
  return { ab: k.spellAb, dc: 8 + prof(c) + m, atk: prof(c) + m, slots: spellSlots(k, c.level) || [] };
}

export function features(c) {
  return klass(c).features.filter((f) => f.lvl <= c.level);
}

export function attackLine(c, a) {
  const m = mod(c, a.ab);
  return { name: a.name, bonus: (m + prof(c) >= 0 ? '+' : '') + (m + prof(c)), dmg: `${a.dmg}${m ? (m > 0 ? '+' + m : m) : ''} ${a.type}` };
}
export function defaultAttacks(c) {
  return klass(c).attacks.map((a) => attackLine(c, a));
}

export function blankCharacter() {
  const c = {
    id: uid(), name: 'Новый герой', player: '', raceId: 'human', classId: 'fighter', level: 1, bgId: 'soldier',
    alignment: ALIGNMENTS[4], xp: 0, method: 'standard',
    base: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    extra: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skillProf: [], expertise: [], armorId: 'chainmail', shield: true, acMisc: 0, initMisc: 0, mageArmor: false,
    hpAuto: true, hpMax: 0, hpCur: 0, hpTemp: 0, hdUsed: 0, deathS: 0, deathF: 0,
    attacks: [], spells: [], customSpells: '', slotsUsed: [], equipment: '', gold: 10,
    traits: '', ideals: '', bonds: '', flaws: '', appearance: '', backstory: '', notes: '', conditions: '', inspiration: false,
    emoji: '🛡️',
  };
  applyClassDefaults(c);
  return c;
}

const CLASS_EMOJI = { barbarian: '🪓', bard: '🎻', cleric: '✨', druid: '🌿', fighter: '🛡️', monk: '👊', paladin: '⚔️', ranger: '🏹', rogue: '🗡️', sorcerer: '🔥', warlock: '👁️', wizard: '🧙' };

export function applyClassDefaults(c) {
  const k = klass(c);
  c.armorId = k.defaultArmor || 'none';
  if (k.id === 'fighter' || k.id === 'paladin') c.armorId = 'chainmail';
  c.shield = !!k.shield;
  c.equipment = k.equipment + '\n' + 'Предыстория: ' + bg(c).extra;
  c.attacks = defaultAttacks(c);
  c.emoji = CLASS_EMOJI[k.id] || '🛡️';
  // убрать навыки, которых нет в списке класса
  if (k.skills !== 'any') c.skillProf = c.skillProf.filter((s) => k.skills.includes(s));
  c.skillProf = c.skillProf.slice(0, k.skillCount + (race(c).freeSkills || 0));
  if (c.hpAuto) { c.hpMax = autoHp(c); c.hpCur = c.hpMax; }
}

export function roll4d6() {
  const r = [rnd(6), rnd(6), rnd(6), rnd(6)].sort((a, b) => b - a);
  return r[0] + r[1] + r[2];
}

// Распределить значения по приоритету класса
export function assignScores(c, values) {
  const k = klass(c);
  const sorted = [...values].sort((a, b) => b - a);
  const order = [...k.primary];
  const rest = ['con', 'dex', 'wis', 'str', 'cha', 'int'].filter((a) => !order.includes(a));
  // немного случайности в остальных
  rest.sort(() => Math.random() - 0.5);
  [...order, ...rest].forEach((ab, i) => { c.base[ab] = sorted[i]; });
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => [...arr].sort(() => Math.random() - 0.5);

const TRAITS = ['Всегда держу слово.', 'Шучу в самые неподходящие моменты.', 'Не доверяю магам.', 'Коллекционирую странные безделушки.', 'Говорю громко и прямо.', 'Читаю всё, что попадается под руку.', 'Мне трудно усидеть на месте.', 'Я спокоен даже перед лицом смерти.'];
const IDEALS = ['Свобода: никто не должен жить в цепях.', 'Честь: я не отступлю от данного слова.', 'Знание: путь к силе лежит через понимание.', 'Семья: ради близких я пойду на всё.', 'Сила: побеждает сильнейший.', 'Милосердие: помогать нуждающимся — долг.'];
const BONDS = ['Ищу пропавшего брата.', 'Должен вернуть долг старому наставнику.', 'Защищаю родную деревню.', 'Храню фамильную реликвию.', 'Хочу отомстить тому, кто сжёг мой дом.'];
const FLAWS = ['Не могу устоять перед азартной игрой.', 'Слишком доверчив.', 'Вспыльчив.', 'Жаден до золота.', 'Боюсь темноты, хотя никому не признаюсь.', 'Высокомерен с простолюдинами.'];

export function randomCharacter(opts = {}) {
  const c = blankCharacter();
  c.name = randomName();
  c.raceId = opts.raceId || pick(RACES).id;
  c.classId = opts.classId || pick(CLASSES).id;
  c.bgId = pick(BACKGROUNDS).id;
  c.level = opts.level || 1;
  c.alignment = pick(ALIGNMENTS.slice(0, 6));
  c.method = 'roll';
  const vals = Array.from({ length: 6 }, roll4d6);
  assignScores(c, vals);
  const r = race(c);
  if (r.choice) {
    shuffle(ABILITIES.map((a) => a.id).filter((a) => !r.choice.exclude.includes(a)))
      .sort((a, b) => (klass(c).primary.includes(b) ? 1 : 0) - (klass(c).primary.includes(a) ? 1 : 0))
      .slice(0, r.choice.count).forEach((a) => { c.extra[a] = r.choice.amount; });
  }
  const k = klass(c);
  const taken = new Set([...(r.skills || []), ...bg(c).skills]);
  const pool = (k.skills === 'any' ? SKILLS.map((s) => s.id) : k.skills).filter((s) => !taken.has(s));
  c.skillProf = shuffle(pool).slice(0, k.skillCount);
  if (r.freeSkills) {
    const pool2 = SKILLS.map((s) => s.id).filter((s) => !taken.has(s) && !c.skillProf.includes(s));
    c.skillProf.push(...shuffle(pool2).slice(0, r.freeSkills));
  }
  if (k.id === 'rogue') c.expertise = shuffle([...c.skillProf, ...bg(c).skills]).slice(0, 2);
  c.hpAuto = true;
  applyClassDefaults(c);
  c.skillProf = c.skillProf; // уже обрезано
  // заклинания
  if (k.spellAb && k.caster !== 'half') {
    const avail = SPELLS.filter((s) => s.classes.includes(k.id));
    const cantrips = shuffle(avail.filter((s) => s.lvl === 0)).slice(0, k.id === 'warlock' || k.id === 'bard' || k.id === 'druid' ? 2 : 3);
    const first = shuffle(avail.filter((s) => s.lvl === 1)).slice(0, k.id === 'warlock' ? 2 : 4);
    c.spells = [...cantrips, ...first].map((s) => s.name);
  }
  c.traits = pick(TRAITS); c.ideals = pick(IDEALS); c.bonds = pick(BONDS); c.flaws = pick(FLAWS);
  c.gold = 5 + rnd(20);
  return c;
}

// Краткое описание персонажа для мастера
export function summary(c) {
  const k = klass(c); const r = race(c);
  const ab = ABILITIES.map((a) => `${a.short} ${score(c, a.id)}(${mod(c, a.id) >= 0 ? '+' : ''}${mod(c, a.id)})`).join(', ');
  const sk = [...allSkillProfs(c)].map((id) => SKILLS.find((s) => s.id === id)?.name).filter(Boolean).join(', ');
  const si = spellInfo(c);
  let s = `${c.name}${c.player ? ` (игрок: ${c.player})` : ''} — ${r.name}, ${k.name} ${c.level} ур., ${bg(c).name}, ${c.alignment}. ` +
    `Хиты ${c.hpCur}/${c.hpMax}${c.hpTemp ? ` (+${c.hpTemp} врем.)` : ''}, КД ${ac(c)}, скорость ${speed(c)} фт., БМ +${prof(c)}. ${ab}. ` +
    `Навыки: ${sk || '—'}. Атаки: ${c.attacks.map((a) => `${a.name} ${a.bonus} (${a.dmg})`).join('; ') || '—'}.`;
  if (si) s += ` Заклинания (СЛ ${si.dc}, атака +${si.atk}): ${[...c.spells, c.customSpells].filter(Boolean).join(', ') || '—'}.`;
  if (c.conditions) s += ` Состояния: ${c.conditions}.`;
  if (c.equipment) s += ` Снаряжение: ${c.equipment.replace(/\n/g, '; ')}. Золото: ${c.gold} зм.`;
  return s;
}

// Модификатор для запроса броска от мастера
export function resolveCheck(c, what) {
  const w = what.toLowerCase();
  const STEM = { str: 'сил', dex: 'ловк', con: 'телосл', int: 'интел', wis: 'мудр', cha: 'хариз' };
  const ab = ABILITIES.find((a) => w.includes(STEM[a.id]));
  if (w.includes('инициатив')) return { label: 'Инициатива', mod: initiative(c) };
  if (w.includes('спас') && ab) return { label: `Спасбросок ${ab.name}`, mod: saveMod(c, ab.id) };
  if (w.includes('смерт')) return { label: 'Спасбросок от смерти', mod: 0 };
  const sk = SKILLS.find((s) => w.includes(s.name.toLowerCase()));
  if (sk) return { label: sk.name, mod: skillMod(c, sk.id) };
  const atk = c.attacks.find((a) => a.name && w.includes(a.name.toLowerCase()));
  if (atk) return { label: `Атака: ${atk.name}`, mod: parseInt(String(atk.bonus).replace('−', '-'), 10) || 0, dmg: atk.dmg };
  if (w.includes('заклин') && spellInfo(c)) return { label: 'Атака заклинанием', mod: spellInfo(c).atk };
  if (ab) return { label: ab.name, mod: mod(c, ab.id) };
  return { label: what, mod: 0 };
}
