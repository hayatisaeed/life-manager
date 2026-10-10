import { ENTITIES, type EntityDef } from '@lm/core';

// What goes into the full-text index (ADR-018).

const TITLE_FIELDS = ['title', 'name', 'text', 'idea', 'label', 'summary', 'front', 'payee', 'key'];
const EXTRA_BODY_FIELDS = ['back', 'transcript'];

export interface SearchFields {
  title: string | null;
  body: string[];
}

/** Which fields of an entity are indexed. Types with none (settings, logs) aren't searchable. */
export function searchFields(def: EntityDef): SearchFields | null {
  const keys = Object.keys(def.shape);
  const title = TITLE_FIELDS.find((f) => keys.includes(f)) ?? null;
  const body = keys.filter(
    (k) => k !== title && (def.merge[k] === 'text' || EXTRA_BODY_FIELDS.includes(k)),
  );
  return title === null && body.length === 0 ? null : { title, body };
}

export const SEARCHABLE: Readonly<Record<string, SearchFields>> = Object.fromEntries(
  Object.entries(ENTITIES as Record<string, EntityDef>)
    .filter(([type]) => type !== 'settings')
    .flatMap(([type, def]) => {
      const fields = searchFields(def);
      return fields ? [[type, fields] as const] : [];
    }),
);

const ZWNJ = /\u200c/g;

/**
 * Normalizes text for indexing and for queries, so both sides match:
 * - NFKC folds compatibility forms (e.g. Arabic presentation forms).
 * - Arabic yeh and kaf become their Persian forms, which keyboards mix.
 * - FTS5's tokenizer splits words at the zero-width non-joiner, but people
 *   type Persian words both with and without it. Index text gets the ZWNJ as a
 *   separator AND the joined word, so either spelling finds it.
 */
export function normalizeSearchText(text: string, forIndex: boolean): string {
  const base = text
    .normalize('NFKC')
    .replace(/[\u064A\u0649]/g, '\u06CC')
    .replace(/\u0643/g, '\u06A9');
  if (!forIndex) return base.replace(ZWNJ, '');
  const joined = base.match(/\S*\u200c\S*/g)?.map((w) => w.replace(ZWNJ, '')) ?? [];
  return [base.replace(ZWNJ, ' '), ...joined].join(' ');
}

/**
 * Builds an FTS5 MATCH expression: every word must appear, as a prefix.
 * Each word is quoted, so FTS5 operators typed by the user are plain text.
 */
export function toMatchQuery(query: string): string | null {
  const words = normalizeSearchText(query, false)
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((w) => w.length > 0);
  return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' ');
}

export function extractSearchText(
  fields: SearchFields,
  data: Readonly<Record<string, unknown>>,
): { title: string; body: string } {
  const str = (k: string) => {
    const v = data[k];
    return typeof v === 'string' ? v : '';
  };
  return {
    title: normalizeSearchText(fields.title ? str(fields.title) : '', true),
    body: normalizeSearchText(fields.body.map(str).filter(Boolean).join('\n'), true),
  };
}
