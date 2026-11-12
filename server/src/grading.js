function toNumber(s) {
  const t = String(s).trim().replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/,/g, '');
  if (!t) return null;
  const frac = /^(-?\d*\.?\d+)\/(-?\d*\.?\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  if (/^-?\d*\.?\d+$/.test(t)) return Number(t);
  return null;
}

function normalize(s) {
  return String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/[−–]/g, '-');
}

export function grade(question, answer) {
  if (!question.correct || !question.correct.length) return null;
  if (answer === undefined || answer === null || String(answer).trim() === '') return false;
  if (question.type === 'mcq') return question.correct.map((c) => String(c).toUpperCase()).includes(String(answer).toUpperCase());
  const n = toNumber(answer);
  for (const c of question.correct) {
    if (normalize(c) === normalize(answer)) return true;
    const cn = toNumber(c);
    if (n !== null && cn !== null && Math.abs(n - cn) < 1e-3 * Math.max(1, Math.abs(cn))) {
      const a = String(answer).trim();
      if (/^-?\d*\.\d+$/.test(a) && !/^-?\d*\.?\d+$/.test(String(c).trim())) {
        const dec = a.split('.')[1].length;
        if (dec < 3 && Math.abs(n - cn) > 1e-9) continue;
      }
      return true;
    }
  }
  return false;
}

export function scaled(correct, total) {
  if (!total) return null;
  return Math.max(200, Math.min(800, Math.round((200 + (600 * correct) / total) / 10) * 10));
}
