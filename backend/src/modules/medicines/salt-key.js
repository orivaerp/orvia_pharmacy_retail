/**
 * A "salt key" says two medicines are the same thing underneath: same salts, strength and form.
 * Dolo 650, Crocin 650 and a generic "Paracetamol 650mg Tablets" share one key, which is how substitutes are found.
 */
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

export function saltKeyOf(m) {
  const salts = [...new Set((m.composition ?? []).map(norm).filter(Boolean))].sort();
  if (!salts.length || (salts.length === 1 && salts[0] === 'not applicable')) return undefined; // devices etc. have no substitutes
  const strength = norm(m.strength).replace(/\s+/g, '');
  return `${salts.join('+')}|${strength}|${norm(m.form)}`;
}
