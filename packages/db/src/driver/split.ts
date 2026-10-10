/**
 * Splits a migration script into statements on `;`, ignoring semicolons inside
 * quotes and comments. For platforms whose API runs one statement per call.
 * Our migrations don't use triggers, whose bodies contain `;`.
 */
export function splitSqlScript(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (quote) {
      current += c;
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      current += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? sql.length : end;
      current += '\n';
    } else if (c === ';') {
      if (current.trim()) out.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}
