// The page's settings as URL query parameters, so a link opens the same calculation:
// ?option=<model@hosting>&<input>=<value>…, listing only the inputs that differ from the defaults. Input names are
// the keys of DEFAULTS (inputs.mjs). Unknown or invalid parameters are ignored and reported, never fatal.
import {DEFAULTS, validateParams} from './inputs.mjs';
import {schemeById} from './rate-card.mjs';

export function settingsQuery(option, params) {
  const query = new URLSearchParams({option});
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (key in params && params[key] !== value) query.set(key, String(params[key]));
  }
  return query.toString();
}

function parse(key, raw) {
  const kind = typeof DEFAULTS[key];
  if (kind === 'number') return raw.trim() === '' ? NaN : Number(raw);
  if (kind === 'boolean') return raw === 'true' || raw === '1' ? true : raw === 'false' || raw === '0' ? false : null;
  return raw;
}

export function settingsFromQuery(search, fallbackOption) {
  const query = new URLSearchParams(search);
  const ignored = [];
  let option = fallbackOption;
  if (query.has('option')) {
    try { option = schemeById(query.get('option')).id; } catch { ignored.push('option'); }
  }
  const patch = {};
  for (const [key, raw] of query) {
    if (key === 'option') continue;
    if (Object.hasOwn(DEFAULTS, key)) patch[key] = parse(key, raw); else ignored.push(key);
  }
  // All together first (talk time is checked as a pair), then one by one, keeping each value that passes.
  let params = {...DEFAULTS, ...patch};
  try {
    validateParams(params);
  } catch {
    params = {...DEFAULTS};
    for (const [key, value] of Object.entries(patch)) {
      try { validateParams({...params, [key]: value}); params[key] = value; } catch { ignored.push(key); }
    }
  }
  return {option, params, ignored};
}

// The link that opens these settings, without the section anchor.
export const settingsUrl = (location, option, params) => `${location.origin}${location.pathname}?${settingsQuery(option, params)}`;
