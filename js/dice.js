// Движок бросков кубиков
export function rnd(sides) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return (a[0] % sides) + 1;
}

// Разбор формулы вида "2к6+3", "1d20-1", "4d6kh3", "к20+к4+2"
export function parseFormula(text) {
  const s = String(text).toLowerCase().replace(/\s+/g, '').replace(/к/g, 'd').replace(/д/g, 'd').replace(/−/g, '-');
  if (!s) return null;
  const re = /([+-]?)(\d*)d(\d+|%)(kh\d+|kl\d+)?|([+-]?)(\d+)/g;
  const parts = [];
  let m; let consumed = 0;
  while ((m = re.exec(s)) !== null) {
    if (m.index !== consumed) return null;
    consumed = re.lastIndex;
    if (m[3]) {
      const sides = m[3] === '%' ? 100 : parseInt(m[3], 10);
      const count = m[2] ? parseInt(m[2], 10) : 1;
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null;
      let keep = null;
      if (m[4]) keep = { hi: m[4].startsWith('kh'), n: parseInt(m[4].slice(2), 10) };
      parts.push({ sign: m[1] === '-' ? -1 : 1, count, sides, keep });
    } else {
      parts.push({ sign: m[5] === '-' ? -1 : 1, value: parseInt(m[6], 10) });
    }
  }
  if (consumed !== s.length || !parts.length) return null;
  return parts;
}

// mode: 'normal' | 'adv' | 'dis' — применяется к первому к20
export function rollFormula(text, mode = 'normal') {
  const parts = parseFormula(text);
  if (!parts) return null;
  let total = 0; const details = []; let nat = null; let usedMode = false;
  for (const p of parts) {
    if (p.value !== undefined) { total += p.sign * p.value; details.push((p.sign < 0 ? '−' : '+') + p.value); continue; }
    if (p.sides === 20 && p.count === 1 && mode !== 'normal' && !usedMode) {
      usedMode = true;
      const a = rnd(20), b = rnd(20);
      const v = mode === 'adv' ? Math.max(a, b) : Math.min(a, b);
      nat = v;
      total += p.sign * v;
      details.push(`${p.sign < 0 ? '−' : ''}к20[${a}, ${b}${mode === 'adv' ? ' ↑' : ' ↓'}]`);
      continue;
    }
    const rolls = Array.from({ length: p.count }, () => rnd(p.sides));
    let kept = rolls.map((v, i) => ({ v, i }));
    if (p.keep) {
      kept = [...kept].sort((x, y) => (p.keep.hi ? y.v - x.v : x.v - y.v)).slice(0, p.keep.n);
    }
    const keptIdx = new Set(kept.map((k) => k.i));
    const sum = kept.reduce((a, k) => a + k.v, 0);
    if (p.sides === 20 && p.count === 1 && nat === null) nat = rolls[0];
    total += p.sign * sum;
    details.push(`${p.sign < 0 ? '−' : ''}${p.count}к${p.sides}[${rolls.map((v, i) => keptIdx.has(i) ? v : `<s>${v}</s>`).join(', ')}]`);
  }
  return { total, details: details.join(' '), nat, formula: text, mode };
}

export const fmtMod = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);
export const d20 = (mod, mode = 'normal') => rollFormula(`1d20${mod >= 0 ? '+' : ''}${mod}`, mode);
