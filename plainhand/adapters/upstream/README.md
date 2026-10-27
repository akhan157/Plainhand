# Selected Career Ops helpers

These unmodified MIT-licensed modules were extracted from
`career-ops-hq/career-ops`, tag `career-ops-v1.37.0`, commit
`373aba4` (2026-10-16 release). Original paths:
`web/src/lib/apply/{option-match,resume-label,submit-guard}.mjs`.
The original license is retained here. Plainhand wraps these helpers; it does
not require the upstream web server or CLI workflow to apply their rules.

- Exact/whole-word dropdown matching avoids selecting Australia for “US”.
- Shared multilingual resume labels identify resume upload fields.
- Submit-control classification checks accessible labels and default button types.

This is selective reuse, not a complete upstream system update. Do not overwrite
these files automatically; compare a pinned release and rerun browser tests.

## Browser extraction and drive additions

`drive-action.mjs` is also copied unmodified from the same pinned release.
`extract.mjs` is generated from that release's `extract.ts` using build-time
TypeScript erasure, then adapted to exclude passwords and include contenteditable
and ARIA combobox controls and hidden upload inputs. No TypeScript compiler or
upstream Next.js runtime is needed to run Plainhand. The MIT license above applies.
Plainhand wraps the executor with a narrower navigation vocabulary and fresh refs;
its DOM submission interlock and network guard remain separate boundaries.
