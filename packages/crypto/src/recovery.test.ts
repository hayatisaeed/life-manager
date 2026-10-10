import { describe, expect, it } from 'vitest';
import { asKey } from './primitives';
import {
  generateRecoveryKey,
  parseRecoveryKey,
  recoveryKeyToBase32,
  recoveryKeyToWords,
} from './recovery';
import { initCrypto } from './sodium';

await initCrypto();

const fill = (b: number) => asKey(new Uint8Array(32).fill(b));
const seqKey = asKey(Uint8Array.from({ length: 32 }, (_, i) => i));

describe('BIP-39 words', () => {
  it('matches the reference BIP-39 vectors for 256-bit entropy', () => {
    expect(recoveryKeyToWords(fill(0))).toBe(`${'abandon '.repeat(23)}art`);
    expect(recoveryKeyToWords(fill(0xff))).toBe(`${'zoo '.repeat(23)}vote`);
  });

  it('round-trips, ignoring case and extra whitespace', () => {
    const key = generateRecoveryKey();
    const words = recoveryKeyToWords(key);
    expect(parseRecoveryKey(`  ${words.toUpperCase().replace(/ /g, '\n  ')} `)).toEqual(key);
  });

  it('rejects a wrong word or a broken checksum', () => {
    const words = recoveryKeyToWords(seqKey).split(' ');
    expect(() => parseRecoveryKey([...words.slice(0, 23), 'notaword'].join(' '))).toThrow(
      expect.objectContaining({ code: 'invalid-input' }),
    );
    const swapped = [...words.slice(0, 22), words[23], words[22]].join(' ');
    expect(() => parseRecoveryKey(swapped)).toThrow(/not valid/);
  });
});

describe('base32 form', () => {
  it('pins the encoding of a fixed key', () => {
    expect(recoveryKeyToBase32(seqKey)).toBe(
      '000G-40R4-0M30-E209-185G-R38E-1W81-24GK-2GAH-C5RR-34D1-P70X-3RFW-PBTH',
    );
    expect(recoveryKeyToBase32(seqKey)).toMatch(
      /^([0-9A-HJKMNP-TV-Z]{4}-){13}[0-9A-HJKMNP-TV-Z]{4}$/,
    );
  });

  it('round-trips with any separators, lowercase and confusables', () => {
    for (let i = 0; i < 50; i++) {
      const key = generateRecoveryKey();
      const s = recoveryKeyToBase32(key);
      expect(parseRecoveryKey(s)).toEqual(key);
      expect(parseRecoveryKey(s.toLowerCase().replace(/-/g, ' '))).toEqual(key);
    }
    const s = recoveryKeyToBase32(seqKey);
    expect(parseRecoveryKey(s.replace(/0/g, 'O').replace(/1/g, 'l'))).toEqual(seqKey);
  });

  it('rejects typos, wrong length and invalid characters', () => {
    const s = recoveryKeyToBase32(seqKey);
    const typo = (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    expect(() => parseRecoveryKey(typo)).toThrow(/checksum/);
    expect(() => parseRecoveryKey(s.slice(0, -1))).toThrow(/length/);
    expect(() => parseRecoveryKey(`U${s.slice(1)}`)).toThrow(/invalid character/);
  });
});
