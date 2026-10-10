/**
 * Table name for an entity type: `ent_` + the type in snake_case. SQLite
 * identifiers are case-insensitive, so camelCase names can't be used as is.
 */
export function entityTable(type: string): string {
  return `ent_${type.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`;
}
