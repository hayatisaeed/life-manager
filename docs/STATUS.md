# Status

**Update this file at the end of every working session.** Keep "Current state"
short and current. Add new log entries at the top.

## Current state

- **Phase:** planning complete. No code yet.
- **Next milestone:** **P0.1 Monorepo & tooling**, then **P0.2 Spikes**. The
  GitHub/GitLab API spikes are the highest-risk item; do them before building
  `packages/sync`.
- **Blockers / needs owner input:** none.
- **Known risks:**
  - GitLab commit concurrency (`last_commit_id`) and archive-download CORS
    have not been verified yet.
  - API rate limits during the first sync of large repos.

## Session log

### 2026-10-09 — Planning session
- Gathered requirements from the owner and recorded them as decisions
  ADR-001…008.
- Wrote ARCHITECTURE, SYNC, SECURITY, DATA-MODEL, DESIGN, TECH-STACK, RELEASE
  and ROADMAP, plus AGENTS.md and CLAUDE.md.
- Owner's answers: sync through GitHub/GitLab, including from the web; iOS
  eventually; installers without app stores; usable by anyone with their own
  repo; importers wanted; minimal modern design with dark and light modes; en
  + fa (RTL); Jalali; multi-currency; Claude + Ollama; all four calendar
  source types.
