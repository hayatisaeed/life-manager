import { describe, expect, it } from 'vitest';
import fixtureText from './__fixtures__/lm-v1.json?raw';
import { toB64, toHex, utf8 } from './encoding';
import {
  createLmJson,
  parseLmJson,
  rewrapPassphrase,
  rewrapRecoveryKey,
  serializeLmJson,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type LmJson,
} from './lm-json';
import { DEFAULT_KDF, asKey, deriveSubKey, randomKey, seal } from './primitives';
import { initCrypto } from './sodium';

const SMALL_KDF = { opslimit: 1, memlimit: 8 * 1024 * 1024 };
const hexKey = (s: string) =>
  asKey(
    Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.slice(2 * i, 2 * i + 2), 16)),
  );

await initCrypto();

describe('known-answer: a pinned v1 lm.json', () => {
  // Written by this module on 2026-10-10. If this test breaks, existing repos
  // can no longer be unlocked: that's a data-format change, not a test fix.
  const lm = parseLmJson(fixtureText);
  const dataKey = '0805b256d9f5fa19f9082c90d6d8b0b9fbdaec6dfc8f7b3f4c482988c2cf43c4';
  const recovery = '5b08f1425b603a76accabfd0106fb72270640f4de6fe711e718361db8344edc4';

  it('unlocks with the passphrase and with the recovery key', () => {
    expect(toHex(unlockWithPassphrase(lm, 'fixture passphrase'))).toBe(dataKey);
    expect(toHex(unlockWithRecoveryKey(lm, hexKey(recovery)))).toBe(dataKey);
  });

  it('rejects a wrong passphrase or recovery key with a specific code', () => {
    expect(() => unlockWithPassphrase(lm, 'fixture passphrasE')).toThrow(
      expect.objectContaining({ code: 'wrong-passphrase' }),
    );
    expect(() => unlockWithRecoveryKey(lm, randomKey())).toThrow(
      expect.objectContaining({ code: 'wrong-recovery-key' }),
    );
  });

  it('serializes back to the same text', () => {
    expect(serializeLmJson(lm)).toBe(fixtureText);
  });
});

describe('create, unlock, rewrap', () => {
  const { lmJson, dataKey, recoveryKey } = createLmJson({
    passphrase: 'pass one',
    createdAt: '2026-10-10',
    kdf: SMALL_KDF,
  });

  it('creates a valid header that both secrets unlock', () => {
    expect(lmJson.kdf).toMatchObject({ alg: 'argon2id', ...SMALL_KDF });
    expect(lmJson.wrappedKeys.map((k) => k.kind)).toEqual(['passphrase', 'recovery']);
    expect(parseLmJson(serializeLmJson(lmJson))).toEqual(lmJson);
    expect(unlockWithPassphrase(lmJson, 'pass one')).toEqual(dataKey);
    expect(unlockWithRecoveryKey(lmJson, recoveryKey)).toEqual(dataKey);
  });

  it('defaults to the ADR-016 parameters (one real 256 MiB derivation)', () => {
    expect(DEFAULT_KDF).toEqual({ opslimit: 3, memlimit: 256 * 1024 * 1024 });
    const made = createLmJson({ passphrase: 'p', createdAt: '2026-10-10' });
    expect(made.lmJson.kdf).toMatchObject({ opslimit: 3, memlimit: 268435456 });
  }, 30_000);

  it('changes the passphrase without touching the recovery wrap', () => {
    const next = rewrapPassphrase(lmJson, dataKey, 'pass two');
    expect(next.kdf.salt).not.toBe(lmJson.kdf.salt);
    expect(unlockWithPassphrase(next, 'pass two')).toEqual(dataKey);
    expect(() => unlockWithPassphrase(next, 'pass one')).toThrow(/wrong passphrase/);
    expect(unlockWithRecoveryKey(next, recoveryKey)).toEqual(dataKey);
    const stronger = rewrapPassphrase(lmJson, dataKey, 'pass two', {
      opslimit: 2,
      memlimit: 16 << 20,
    });
    expect(stronger.kdf).toMatchObject({ opslimit: 2, memlimit: 16 << 20 });
    expect(unlockWithPassphrase(stronger, 'pass two')).toEqual(dataKey);
  });

  it('issues a new recovery key and retires the old one', () => {
    const { lmJson: next, recoveryKey: fresh } = rewrapRecoveryKey(lmJson, dataKey);
    expect(unlockWithRecoveryKey(next, fresh)).toEqual(dataKey);
    expect(() => unlockWithRecoveryKey(next, recoveryKey)).toThrow(/wrong recovery key/);
    expect(unlockWithPassphrase(next, 'pass one')).toEqual(dataKey);
  });

  it('refuses to rewrap with another repo key or bad parameters', () => {
    expect(() => rewrapPassphrase(lmJson, randomKey(), 'x')).toThrow(/does not belong/);
    expect(() => rewrapRecoveryKey(lmJson, randomKey())).toThrow(/does not belong/);
    expect(() =>
      rewrapPassphrase(lmJson, dataKey, 'x', { opslimit: 0, memlimit: 8 << 20 }),
    ).toThrow(/out of range/);
  });
});

describe('parse and tamper rejection', () => {
  type Wrap = LmJson['wrappedKeys'][number];
  interface Fixture {
    [k: string]: unknown;
    kdf: LmJson['kdf'];
    wrappedKeys: Wrap[];
  }
  const base = (): Fixture => JSON.parse(fixtureText) as Fixture;
  const firstWrap = (f: Fixture): Wrap => {
    const w = f.wrappedKeys[0];
    if (!w) throw new Error('fixture has no wraps');
    return w;
  };
  const parse = (o: unknown) => parseLmJson(JSON.stringify(o));

  it('rejects non-JSON, other formats and schema violations as malformed', () => {
    const malformed = expect.objectContaining({ code: 'malformed' });
    expect(() => parseLmJson('{')).toThrow(malformed);
    expect(() => parse(null)).toThrow(malformed);
    expect(() => parse({ ...base(), format: 'other' })).toThrow(malformed);
    expect(() => parse({ ...base(), createdAt: '10/10/2026' })).toThrow(malformed);
    expect(() => parse({ ...base(), kdf: { ...base().kdf, memlimit: 2 ** 31 } })).toThrow(
      malformed,
    );
    expect(() => parse({ ...base(), kdf: { ...base().kdf, alg: 'scrypt' } })).toThrow(malformed);
    expect(() => parse({ ...base(), keyCheck: 'not base64!' })).toThrow(malformed);
    const dup = base();
    dup.wrappedKeys = [firstWrap(dup), firstWrap(dup)];
    expect(() => parse(dup)).toThrow(malformed);
  });

  it('reports a newer version as unsupported', () => {
    expect(() => parse({ ...base(), version: 2 })).toThrow(
      expect.objectContaining({ code: 'unsupported-version' }),
    );
    expect(() => parse({ ...base(), version: '2' })).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
  });

  it('keeps unknown fields so a rewrap does not drop them', () => {
    const lm = parse({ ...base(), futureField: { a: 1 } });
    const dataKey = unlockWithPassphrase(lm, 'fixture passphrase');
    expect(rewrapRecoveryKey(lm, dataKey).lmJson).toHaveProperty('futureField', { a: 1 });
  });

  it('rejects a missing wrap, a tampered wrap and a foreign key check', () => {
    const noRecovery = base();
    noRecovery.wrappedKeys = noRecovery.wrappedKeys.filter((k) => k.kind !== 'recovery');
    expect(() => unlockWithRecoveryKey(parse(noRecovery), randomKey())).toThrow(/no recovery key/);

    const tampered = base();
    const ct = firstWrap(tampered).ct;
    firstWrap(tampered).ct = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => unlockWithPassphrase(parse(tampered), 'fixture passphrase')).toThrow(
      /wrong passphrase/,
    );

    // A key check from a different repo: the wrap opens but the check fails.
    const other = createLmJson({
      passphrase: 'other',
      createdAt: '2026-10-10',
      kdf: SMALL_KDF,
    }).lmJson;
    expect(() =>
      unlockWithPassphrase(parse({ ...base(), keyCheck: other.keyCheck }), 'fixture passphrase'),
    ).toThrow(/key check failed/);

    // A key check under the right key but with the wrong constant.
    const dataKey = unlockWithPassphrase(parse(base()), 'fixture passphrase');
    const wrongConstant = toB64(
      seal(deriveSubKey(dataKey, 'check'), utf8('nope'), 'lmc1|key-check'),
    );
    expect(() =>
      unlockWithPassphrase(parse({ ...base(), keyCheck: wrongConstant }), 'fixture passphrase'),
    ).toThrow(/key check failed/);

    // A wrap too short to hold a tag is malformed, not a wrong passphrase.
    const short = base();
    firstWrap(short).ct = 'AAAA';
    expect(() => unlockWithPassphrase(parse(short), 'fixture passphrase')).toThrow(
      expect.objectContaining({ code: 'malformed' }),
    );
  });
});
