// Number formats and the cost lines of one priceCall() result, shared by the page,
// its diagrams and the Agent's functions.

const int = n => Math.round(n).toLocaleString('en-US');
const num = (n, digits = 2) => n.toLocaleString('en-US', {maximumFractionDigits: digits});
const usd = (n, digits = 4) => `$${n.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits})}`;
const rate = n => Number.isInteger(n) ? `$${int(n)}` : `$${n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
const cents = n => `${(n * 100).toFixed(2)} ¢`;
const centsSpoken = n => `${(n * 100).toFixed(2)} cents`;
const pct = (n, digits = 0) => `${num(n * 100, digits)}%`;

export const format = {int, num, usd, rate, cents, centsSpoken, pct};

// The four cost lines of a priceCall() result: STT, TTS, model input and model output.
export const costLines = priced => priced.lines;
