/** EAN-13 barcodes drawn as SVG, for printing shelf and pack labels. No library needed. */
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const flip = (s: string) => [...s].map((c) => (c === '0' ? '1' : '0')).join('');
const G = L.map((p) => [...flip(p)].reverse().join(''));
const R = L.map(flip);
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The check digit for the first 12 digits of an EAN-13. */
export function ean13Check(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10;
}

/** True for a valid 13-digit EAN-13 (the kind most medicine packs and our own labels carry). */
export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13Check(code.slice(0, 12)) === Number(code[12]);
}

/** The 95 bars and gaps of an EAN-13 as a string of 1 (bar) and 0 (gap). */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new Error('Not a valid EAN-13');
  const parity = PARITY[Number(code[0])];
  let m = '101';
  for (let i = 0; i < 6; i++) m += (parity[i] === 'L' ? L : G)[Number(code[i + 1])];
  m += '01010';
  for (let i = 7; i < 13; i++) m += R[Number(code[i])];
  return m + '101';
}

/** An SVG of the bars (with the quiet space either side). Size it with CSS; it keeps its shape. */
export function ean13Svg(code: string): string {
  const m = ean13Modules(code);
  const quiet = 9;
  let bars = '';
  for (let i = 0; i < m.length; ) {
    if (m[i] === '1') {
      let j = i;
      while (m[j] === '1') j++;
      bars += `<rect x="${i + quiet}" y="0" width="${j - i}" height="60"/>`;
      i = j;
    } else i++;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.length + quiet * 2} 60" preserveAspectRatio="none" shape-rendering="crispEdges" fill="#000">${bars}</svg>`;
}
