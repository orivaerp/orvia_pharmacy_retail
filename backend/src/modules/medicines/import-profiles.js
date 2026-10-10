/**
 * Import profiles turn a supplier's product list into our catalog columns.
 * A profile is chosen automatically from the CSV header. Whatever the file does not say is filled from
 * `defaults` or guessed from the name, and EVERY row from a profile is imported as "pending" so a person
 * checks schedule, GST and HSN before shops can see it.
 */

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// Groups that are not medicines in the strict sense: no salt, no schedule, form "other".
const CONSUMABLE_GROUPS = /surgical|consumable|devices?\b/i;
// Groups usually sold without a prescription (a starting guess only; a person verifies it).
const OTC_GROUPS = /consumable|supplement|vitamin|mineral|nutraceutical|derma care|antiseptic|disinfectant|ayurved|burn relief|electrolyte/i;

const FORM_RULES = [
  [/\b(inhaler|mdi|rotacaps?|rotahaler)\b/i, 'inhaler'],
  [/\b(injection|infusion|inj)\b/i, 'injection'],
  [/\b(tablets?|caplets?)\b/i, 'tablet'],
  [/\bcapsules?\b/i, 'capsule'],
  [/\b(syrup|elixir)\b/i, 'syrup'],
  [/\bsuspension\b/i, 'suspension'],
  [/\bdrops?\b/i, 'drops'],
  [/\bcream\b/i, 'cream'],
  [/\bointment\b/i, 'ointment'],
  [/\bgel\b/i, 'gel'],
  [/\blotion\b/i, 'lotion'],
  [/\bspray\b/i, 'spray'],
  [/\b(sachets?)\b/i, 'sachet'],
  [/\b(powder|granules)\b/i, 'powder'],
];

export function guessForm(name, unitSize, group) {
  if (CONSUMABLE_GROUPS.test(group)) return 'other';
  for (const [rx, form] of FORM_RULES) if (rx.test(name)) return form;
  if (/vial|ampoule/i.test(unitSize)) return 'injection';
  return 'other';
}

const STRENGTH_RX = /(\d+(?:\.\d+)?)\s?(mg|mcg|µg|g|kg|ml|iu|units?|%\s?(?:w\/w|w\/v|v\/v)?)(?![a-z])/gi;

export function guessStrength(name) {
  const found = [];
  for (const m of name.matchAll(STRENGTH_RX)) {
    const t = `${m[1]}${m[2].replace(/\s/g, '').toLowerCase()}`;
    if (!found.includes(t)) found.push(t);
  }
  return found.join(' + ').slice(0, 60);
}

const NOISE =
  /\b(tablets?|capsules?|caplets?|injection|infusion|syrup|suspension|solution|drops?|eye|ear|nasal|oral|cream|ointment|gel|lotion|spray|powder|granules|sachets?|inhaler|rotacaps?|ip|bp|usp|film|coated|enteric|gastro-?resistant|sustained|prolonged|extended|modified|delayed|release|dispersible|chewable|soluble|sterile|sterilized|forte|per|w\/w|w\/v|v\/v)\b/gi;

/** Salts from the name: split on "and" / "," / "+", drop strengths and dosage-form words. Approximate by design. */
export function guessComposition(name, group) {
  if (CONSUMABLE_GROUPS.test(group)) return ['Not applicable'];
  const noBrackets = name.replace(/\([^)]*\)/g, ' ');
  const parts = noBrackets.split(/,|\band\b|\s\+\s|&/i).map((p) =>
    clean(p.replace(STRENGTH_RX, ' ').replace(NOISE, ' ').replace(/[-/]+\s*$/g, '').replace(/^\W+|\W+$/g, '')),
  );
  const salts = [...new Set(parts.filter((p) => p.length > 1))].map((p) => p.slice(0, 100));
  return salts.length ? salts : [clean(name).slice(0, 60)];
}

export function guessUnits(unitSize) {
  const u = clean(unitSize);
  const strip = u.match(/^(\d+)'?s\b/i) ?? u.match(/pack of (\d+)/i);
  return strip ? Math.max(1, Number(strip[1])) : 1;
}

/** Jan Aushadhi style list: Sr No, Drug Code, Generic Name, Unit Size, MRP, Group Name. */
const genericList = {
  id: 'generic-list',
  label: 'Generic product list (Generic Name, Unit Size, MRP, Group Name)',
  matches: (headers) => ['Generic Name', 'Unit Size', 'Group Name'].every((h) => headers.includes(h)),
  defaults: { manufacturer: 'Generic (unbranded)', hsn: '3004', gstPercent: 5 },
  map(raw, defaults) {
    const name = clean(raw['Generic Name']);
    const group = clean(raw['Group Name']);
    const unit = clean(raw['Unit Size']);
    const consumable = CONSUMABLE_GROUPS.test(group);
    return {
      name,
      composition: guessComposition(name, group),
      strength: consumable ? '' : guessStrength(name),
      form: guessForm(name, unit, group),
      unitsPerPack: guessUnits(unit),
      manufacturer: defaults.manufacturer,
      hsn: defaults.hsn,
      gstPercent: defaults.gstPercent,
      // not in the file: assume prescription-only unless the group is usually over-the-counter. A person verifies it.
      schedule: OTC_GROUPS.test(group) ? 'OTC' : 'H',
      category: group,
      externalCode: clean(raw['Drug Code']),
      referenceMrp: clean(raw['MRP']),
      barcodes: '',
      status: 'pending',
    };
  },
};

const FORM_WORDS = new RegExp(FORM_RULES.map(([rx]) => rx.source.replace(/\b/g, '')).join('|'), 'gi');

/** "Dolo 650 Tablet" -> "Dolo 650": the brand is the name without strengths and dosage-form words. */
export function brandOf(name) {
  const stripped = clean(name.replace(STRENGTH_RX, ' ').replace(FORM_WORDS, ' ').replace(/[()+/,-]/g, ' '));
  return stripped || clean(name);
}

const pick = (raw, ...keys) => {
  for (const k of keys) if (clean(raw[k])) return clean(raw[k]);
  return '';
};

/**
 * Branded medicine list from a company or distributor. Recognised columns (any of the listed spellings):
 * Brand Name, Manufacturer, Composition / Salt, Strength, Form, Pack / Pack Size, MRP, Barcode / EAN, HSN, GST, Schedule, Category.
 */
const brandList = {
  id: 'brand-list',
  label: 'Branded medicine list (Brand Name, Manufacturer, Composition, ...)',
  matches: (headers) => headers.includes('Brand Name') && headers.includes('Manufacturer') && ['Composition', 'Salt', 'Salts'].some((h) => headers.includes(h)),
  defaults: { manufacturer: 'Unknown', hsn: '3004', gstPercent: 5 },
  map(raw, defaults) {
    let name = pick(raw, 'Brand Name');
    const strength = pick(raw, 'Strength') || guessStrength(name);
    const pack = pick(raw, 'Pack', 'Pack Size', 'Unit Size');
    const formText = pick(raw, 'Form').toLowerCase();
    const form = FORM_RULES.some(([, f]) => f === formText) ? formText : guessForm(name, pack, '');
    // keep the name self-explanatory: add the form if the brand name does not already say it
    if (form !== 'other' && !new RegExp(form, 'i').test(name)) name = clean(`${name} ${form[0].toUpperCase()}${form.slice(1)}`);
    return {
      name,
      brand: brandOf(pick(raw, 'Brand Name')),
      composition: pick(raw, 'Composition', 'Salt', 'Salts'),
      strength,
      form,
      unitsPerPack: guessUnits(pack),
      manufacturer: pick(raw, 'Manufacturer') || defaults.manufacturer,
      hsn: pick(raw, 'HSN') || defaults.hsn,
      gstPercent: pick(raw, 'GST', 'GST %') || defaults.gstPercent,
      // when the file does not say, assume prescription-only until a person verifies it
      schedule: pick(raw, 'Schedule') || 'H',
      category: pick(raw, 'Category', 'Group'),
      barcodes: pick(raw, 'Barcode', 'EAN'),
      referenceMrp: pick(raw, 'MRP'),
      externalCode: pick(raw, 'Code', 'Product Code'),
      status: 'pending',
    };
  },
};

export const PROFILES = [genericList, brandList];

export function detectProfile(headers) {
  return PROFILES.find((p) => p.matches(headers)) ?? null;
}
