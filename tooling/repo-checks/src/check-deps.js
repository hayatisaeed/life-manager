// Enforces the package dependency direction from docs/ARCHITECTURE.md §3:
// apps → ui → (core, db, sync, ai, calendar, importers, i18n) → (crypto, platform).
// Update ALLOWED together with that doc.

/** Which internal (@lm/*) packages each package may depend on. */
export const ALLOWED = {
  '@lm/core': [],
  '@lm/crypto': [],
  '@lm/platform': [],
  '@lm/i18n': [],
  '@lm/db': ['@lm/core', '@lm/crypto', '@lm/platform'],
  '@lm/sync': ['@lm/core', '@lm/crypto', '@lm/db', '@lm/platform'],
  '@lm/calendar': ['@lm/core', '@lm/platform'],
  '@lm/ai': ['@lm/core', '@lm/platform'],
  '@lm/importers': ['@lm/core'],
  '@lm/ui': [
    '@lm/core',
    '@lm/db',
    '@lm/sync',
    '@lm/ai',
    '@lm/calendar',
    '@lm/importers',
    '@lm/i18n',
    '@lm/platform',
  ],
  // The web app also starts @lm/db's SQLite worker, which must be bundled as
  // its own entry (ADR-021).
  '@lm/web': ['@lm/ui', '@lm/platform', '@lm/db'],
  '@lm/desktop': ['@lm/ui', '@lm/platform', '@lm/web'],
  '@lm/mobile': ['@lm/ui', '@lm/platform', '@lm/web'],
};

/** Tooling packages may be used as devDependencies anywhere. */
const TOOLING = new Set(['@lm/eslint-plugin', '@lm/repo-checks']);

/**
 * @param {{ name: string, dependencies?: Record<string,string>, devDependencies?: Record<string,string>, peerDependencies?: Record<string,string> }[]} manifests
 * @returns {string[]} human-readable violations
 */
export function checkDeps(manifests) {
  /** @type {string[]} */
  const errors = [];
  const allowed = /** @type {Record<string, string[] | undefined>} */ (ALLOWED);
  for (const m of manifests) {
    if (TOOLING.has(m.name)) continue;
    const rules = allowed[m.name];
    if (!rules) {
      errors.push(`${m.name}: not listed in ALLOWED (tooling/repo-checks/src/check-deps.js)`);
      continue;
    }
    const all = { ...m.dependencies, ...m.peerDependencies, ...m.devDependencies };
    for (const dep of Object.keys(all)) {
      if (!dep.startsWith('@lm/') || TOOLING.has(dep)) continue;
      if (!rules.includes(dep)) {
        errors.push(`${m.name} must not depend on ${dep} (see docs/ARCHITECTURE.md §3)`);
      }
    }
  }
  return errors;
}
