import { isSafeNumber, parse, splitNumber } from 'lossless-json';

const MAX_NUMBER_LENGTH = 4096;
/** Convert the ORIGINAL token, before any floating point rounding occurs. */
export function parseJsonNumber(text: string): number | bigint {
  if (text.length > MAX_NUMBER_LENGTH) throw new Error('JSON sayısı güvenli işlem sınırını aşıyor.');
  const number = Number(text);
  if (/^-?\d+$/.test(text)) return Number.isSafeInteger(number) ? number : BigInt(text);
  if (!Number.isFinite(number)) throw new Error('Sonlu JSON sayısı gerekli; üslü/ondalıklı sayı taşması desteklenmiyor.');
  if (Number.isFinite(number) && !(Number.isInteger(number) && !Number.isSafeInteger(number)) && String(number) === text) return number;
  const { sign, digits, exponent } = splitNumber(text);
  // Exponent/decimal notation can also describe an exact large integer.
  if (digits !== '0' && exponent >= digits.length - 1 && (!Number.isSafeInteger(number) || !Number.isFinite(number))) {
    if (!Number.isSafeInteger(exponent) || exponent >= MAX_NUMBER_LENGTH) throw new Error('JSON sayısının üssü güvenli işlem sınırını aşıyor.');
    return BigInt(sign + digits + '0'.repeat(exponent - digits.length + 1));
  }
  if (!Number.isFinite(number) || !isSafeNumber(text)) {
    throw new Error('JSON kesirli sayısı hassasiyet kaybı olmadan işlenemiyor; veri değiştirilmedi.');
  }
  return number;
}

type ExactParse = (text: string, reviver: (key: string, value: unknown, context?: { source?: string }) => unknown) => unknown;
const nativeParse = JSON.parse as ExactParse;
let hasSource = false;
nativeParse('1', (_key, value, context) => { hasSource = context?.source === '1'; return value; });
const rawJson = (JSON as unknown as { rawJSON?: (text: string) => unknown }).rawJSON;

/** Fallback must reject decoded prototype-setter keys BEFORE object creation. */
export function parseJsonFallback(text: string): unknown {
  for (const token of text.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g)) {
    let index = token.index! + token[0].length;
    while (' \t\n\r'.includes(text[index] ?? '\0')) index++;
    // Parsing a STRING token here never converts a JSON number.
    if (text[index] === ':' && JSON.parse(token[0]) === '__proto__') throw new Error('Desteklenmeyen __proto__ alanı.');
  }
  return parse(text, (key, value) => {
    if (key === '__proto__') throw new Error('Desteklenmeyen __proto__ alanı.');
    return value;
  }, { parseNumber: parseJsonNumber });
}

export function parseJson(text: string): unknown {
  if (!hasSource) return parseJsonFallback(text);
  return nativeParse(text, (key, value, context) => {
    if (key === '__proto__') throw new Error('Desteklenmeyen __proto__ alanı.');
    return typeof value === 'number' ? parseJsonNumber(context!.source!) : value;
  });
}

function inspectNumbers(value: unknown, depth = 0): boolean {
  if (typeof value === 'number' && (!Number.isFinite(value) || Number.isInteger(value) && !Number.isSafeInteger(value))) {
    throw new Error('Güvenli aralık dışında bir JavaScript sayısı geldi; özgün değer doğrulanamıyor. Sayıyı özgün JSON metninden veya bigint olarak sağlayın.');
  }
  if (typeof value === 'bigint' && value.toString().length > MAX_NUMBER_LENGTH) throw new Error('JSON sayısı güvenli işlem sınırını aşıyor.');
  if (typeof value === 'bigint') return true;
  if (value && typeof value === 'object') {
    if (depth > 512) throw new Error('JSON döngüsü veya derinlik sınırı aşıldı.');
    let large = false;
    if (Array.isArray(value)) {
      for (let i=0;i<value.length;i++) if (inspectNumbers(value[i], depth+1)) large=true;
    } else {
      const prototype=Object.getPrototypeOf(value);
      if(prototype!==Object.prototype&&prototype!==null)throw new Error('Yalnızca düz JSON nesneleri ve dizileri destekleniyor.');
      for(const key of Object.keys(value)) {
        if(key==='__proto__')throw new Error('Desteklenmeyen __proto__ alanı.');
        if(inspectNumbers((value as Record<string,unknown>)[key],depth+1))large=true;
      }
    }
    return large;
  }
  if(typeof value==='function'||typeof value==='symbol')throw new Error('Yalnızca JSON değerleri destekleniyor.');
  return false;
}
export function assertJsonNumbers(value: unknown): void { inspectNumbers(value); }

/** BigInt is internal only. The wire/file representation stays a JSON NUMBER. */
export function stringifyJson(value: unknown, space?: number): string {
  return serialize(value, space, !!rawJson);
}
export function stringifyJsonFallback(value: unknown, space?: number): string { return serialize(value, space, false); }
function serialize(value: unknown, space: number | undefined, native: boolean): string {
  const large = inspectNumbers(value);
  if(!large){
    const result=JSON.stringify(value,null,space);
    if(result===undefined)throw new Error('Geçerli JSON verisi gerekli.');
    return result;
  }
  const replacer = (_key: string, item: unknown) => {
    if (typeof item === 'number' && (!Number.isFinite(item) || Number.isInteger(item) && !Number.isSafeInteger(item))) {
      throw new Error('Güvenli aralık dışında bir JavaScript sayısı geldi; özgün değer doğrulanamıyor. Sayıyı özgün JSON metninden veya bigint olarak sağlayın.');
    }
    if (typeof item === 'bigint' && item.toString().length > MAX_NUMBER_LENGTH) throw new Error('JSON sayısı güvenli işlem sınırını aşıyor.');
    return native && typeof item === 'bigint' ? rawJson!(item.toString()) : item;
  };
  // Do not duck-type user objects as LosslessNumber/marker objects. A property
  // named isLosslessNumber is ordinary data, including on the fallback path.
  const indent = ' '.repeat(Math.max(0, Math.min(10, Math.floor(space ?? 0))));
  const ancestors = new Set<object>();
  const fallback = (input: unknown, depth: number): string | undefined => {
    const item = replacer('', input);
    if (typeof item === 'bigint') return item.toString();
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number') return JSON.stringify(item);
    if (item === undefined) return undefined;
    if (typeof item !== 'object') throw new Error('Yalnızca JSON değerleri destekleniyor.');
    if (item instanceof Date) return JSON.stringify(item);
    if (item instanceof Number || item instanceof String || item instanceof Boolean) return fallback(item.valueOf(), depth);
    if (depth > 512 || ancestors.has(item)) throw new Error('JSON döngüsü veya derinlik sınırı aşıldı.');
    ancestors.add(item);
    try {
      const entries = Array.isArray(item)
        ? Array.from(item, child => fallback(child, depth + 1) ?? 'null')
        : Object.entries(item).flatMap(([key, child]) => { const text=fallback(child,depth+1);return text===undefined?[]:[JSON.stringify(key)+(indent?': ':':')+text]; });
      const [open, close] = Array.isArray(item) ? ['[', ']'] : ['{', '}'];
      return entries.length && indent
        ? open+'\n'+indent.repeat(depth+1)+entries.join(',\n'+indent.repeat(depth+1))+'\n'+indent.repeat(depth)+close
        : open+entries.join(',')+close;
    } finally { ancestors.delete(item); }
  };
  const result = native ? JSON.stringify(value, replacer, space) : fallback(value, 0);
  if (result === undefined) throw new Error('Geçerli JSON verisi gerekli.');
  return result;
}
