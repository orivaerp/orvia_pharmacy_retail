/** GST state codes (the first two digits of a GSTIN), as used on the GST portal and in e-invoices. */
export const STATE_CODES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan',
  '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory',
};

const GSTIN_RX = /^(0[1-9]|[1-2][0-9]|3[0-8]|97)[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character of a GSTIN is a check character over the first 14. */
function checkChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(g) {
  const s = String(g ?? '').trim().toUpperCase();
  return GSTIN_RX.test(s) && checkChar(s.slice(0, 14)) === s[14];
}

export const stateCodeOfGstin = (g) => (g && /^\d{2}/.test(g) ? g.slice(0, 2) : undefined);

const norm = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const BY_NAME = new Map(Object.entries(STATE_CODES).map(([code, name]) => [norm(name), code]));
BY_NAME.set('orissa', '21');
BY_NAME.set('jammuandkashmir', '01');
BY_NAME.set('andamanandnicobar', '35');
BY_NAME.set('pondicherry', '34');
BY_NAME.set('uttaranchal', '05');

/** "Maharashtra" -> "27". Undefined when the name is not recognised. */
export const stateCodeOfName = (name) => BY_NAME.get(norm(name));
