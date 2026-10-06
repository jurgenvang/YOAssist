---
name: overview
description: YOAssist — purpose, stack, release workflow, and current state (v1.10.9) of the YO referee scheduling app
sources: [backfill]
aliases: [YOAssist, BVBL1125]
---
- [stated] Jurgen is the developer and primary admin of YOAssist, a Cloudflare Workers web application for managing Youth Official (YO) referee scheduling at Belgian basketball club AB InBev Leuven Bears (BVBL1125), built for Basketbal Vlaanderen.
- [stated] The app covers U10/U12 matches (where the federation never assigns referees) and matches from U14 onward where Basketbal Vlaanderen did not assign referees itself.
- [stated] A second admin, Fluppe Van Meerbeeck, also uses the system.
- [stated] Jurgen communicates in Dutch throughout and uses precise technical language.
- [stated] The Claude project holds authoritative versions of the four project documents: YOASSIST-BACKLOG.md, YOASSIST-CONTEXT.md, YOASSIST-DOCUMENTATIE.md, and the working agreements in `instructions.md` (called YOASSIST-INSTRUCTIES.md in the Claude project).

## Current state
- [stated] Most recent release is v1.10.9, which included: welcome email additions (Google/Apple sign-in note; match coverage explanation), a layout fix splitting combined `wedstrijd` fields into separate `thuis`/`uit` fields on the Regio page, and a catch-up sync of `YOASSIST-CONTEXT.md` and `YOASSIST-DOCUMENTATIE.md` (which had not been updated during v1.10.8).
- [stated] In the Claude project, all four project documents are in sync with v1.10.9. The copies in this repo's `.claude/` (CONTEXT, BACKLOG, DOCUMENTATIE) still say v1.8.0 and must be replaced with the project versions.

## On the horizon
- [stated] Backlog item V32: real-device testing of push notification tap behavior — whether tapping a notification opens Mijn berichten directly via `notificationclick` in `sw.js`.
- [stated] Ongoing backlog grooming: Jurgen prefers to fully clarify each backlog item before building begins.

## Approach & release workflow
- [stated] Release workflow: run `test/frontend.test.mjs` in-sandbox (reliable); full `npm test` (backend, `better-sqlite3`) must be run locally before pushing to GitHub. Increment version in `src/versie.js`, update all four project documents, produce both a full zip (excluding `.git*`) and a delta zip (changed files + `WIJZIGINGEN.md`).
- [stated] Backlog-first development: decisions are captured in `YOASSIST-BACKLOG.md` before building begins.
- [stated] Jurgen shares raw terminal output without explanation when correcting Claude's assumptions — Claude is expected to identify and fix discrepancies from the data itself.
- [stated] Prefers delta zips alongside full zips for every release.

## Tools & resources
- [stated] Repo access: full repo via `https://codeload.github.com/jurgenvang/YOAssist/tar.gz/refs/heads/main`; individual files via `https://raw.githubusercontent.com/jurgenvang/YOAssist/main/[path]`. The GitHub API tree endpoint (`api.github.com/.../git/trees/main?recursive=1`) is unreliable — avoid.
- [stated] Stack: Cloudflare Workers, Cloudflare Access (One-time PIN), Resend (email), VAPID (push notifications), `better-sqlite3` (local/test), iCalendar feed, external JSON API.
- [stated] Secrets in use: `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `RESEND_API_KEY`, `VAPID_PUBLIEK`, `VAPID_PRIVE`, `VAPID_CONTACT`, `EXTERN_API_SLEUTEL`.
- [stated] VBL API: `http://vblcb.wisseq.eu/VBLCB_WebService/data` — not reachable from Claude's sandbox (egress restriction); fall back to `--file` mode with locally saved JSON if needed. URL-encoding must use `quote_via=urllib.parse.quote` (`%20`), not default `+` encoding.
- [stated] Local dev: PyCharm at `C:\Users\geijsju\PycharmProjects\YOA\.venv` (Python scripts); Node for the YOAssist backend.
