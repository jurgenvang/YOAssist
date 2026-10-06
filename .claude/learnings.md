---
name: learnings
description: Hard-won YOAssist engineering rules and VBL API quirks — read before editing code, schemas, or API shapes
sources: [backfill]
aliases: [VBL API quirks]
---
- [stated] Text replacements: always verify count == 1 before applying.
- [stated] Schema migrations: specify whether `ALTER TABLE` suffices or a `DROP` is needed.
- [stated] API response shape changes (e.g., splitting a combined field): check both `test/aandacht.test.mjs` and `test/frontend.test.mjs` for field-name references before finalizing.
- [stated] Project documents must be updated in sync with `src/versie.js` at every release — the v1.10.8 release skipped this, caught and corrected in v1.10.9.

## VBL API quirks (from earlier exploration)
- [stated] `gespeeld` uses `"G"`, not `"J"`.
- [stated] `wedOff` can be a list of names.
- [stated] `jsDTCode` encodes local Belgian wall-clock time as a UTC epoch — timezone conversion must account for this.
- [stated] `TeamMatchesByGuid` mixes competitions.
- [stated] GUID normalization must handle percent-encoded, plus-notation, and trailing `#` variants.
