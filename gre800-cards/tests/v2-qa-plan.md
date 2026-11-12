# GRE 800 v2 acceptance coverage

This checklist is maintained by QA independently of the implementation. Browser automation starts only after integration is ready. Test browsers and the temporary static file server must close in `finally`.

| Priority | Area | Required evidence |
| --- | --- | --- |
| P0 | Complete entry | Answer for `discursive` shows both meanings and every original English definition, example and synonym; `zealous` shows its derivative; collapsing and expanding does not drop content. |
| P0 | Synonyms | Word matching, Chinese reverse matching and odd-word selection are playable; options use only original word IDs; explanation cites a specific definition and avoids claiming absolute interchangeability. |
| P0 | Data quality | Original five data artifacts have unchanged SHA-256 hashes; 800 unique IDs, 815 definitions, eight Lists of 100; suspicious source text is explicitly marked rather than silently rewritten. |
| P1 | Reverse recall | Chinese and English definition modes hide the answer until reveal; known/unsure give four options; unknown reveals directly; uncertain correct stays in review; multi-definition prompt matches selected sense. |
| P1 | Migration | Seed exact v1 KEY `gre800-word-studio-v1` with attempts/correct/history, basic prompt and unfinished test choices; upgrade preserves old fields/counts and resumes safely; reload does not duplicate answers. |
| P1 | Scheduling | Due and forget-prone records rank ahead of fresh words; nextReviewAt, streak, last wrong and review counts advance; examination date compresses future intervals; uncertain correctness never clears review. |
| P1 | Analytics | Eight List mastery rows; stable/review/unlearned totals cover all 800; forgetting list reflects misses/uncertainty; daily activity and accuracy reflect new events without inventing historical dates. |
| P1 | Portability | Downloaded export can be imported in another browser context; repeated import is idempotent; malformed data fails without changing saved progress; simulated storage write failure does not discard current data. |
| P2 | GRE modules | TC, SE and RC have separate navigation or module panels with explicit future status and no fabricated question set. |
| Regression | Baseline | Random basic flow, test count bounds 1–800, exact test scoring, unfinished session restore, keyboard controls, mobile layout without horizontal overflow and zero browser errors. |

Automated data checks: `node --test tests/v2-data.test.cjs`.
Browser suite: `node tests/v2-browser-qa.cjs` (requires existing Playwright package and Chrome, configurable through environment variables).

## Completed acceptance — 2026-11-06

- Final unit/data run: **42 passed, 0 failed** (`logic` 9, `lexicon` 9, `progress` 22, `v2-data` 2). This includes source hashes, all 800 question entries, all 815 definitions, direct sense-specific synonym evidence, count boundaries, local-date handling in positive/negative UTC offsets, scheduling and strict import validation.
- Final local Chrome browser run: **13 groups passed, 0 failed**, with no uncaught page errors. Desktop viewport was 1440 × 1000; phone viewport was 375 × 812.
- Browser migration used actual version-1 records under `gre800-word-studio-v1`, verified the unchanged v1 backup, cumulative counts and history, and resumed a pending four-option test without double-counting on reload.
- Answer-page samples verified both `discursive` senses, every provided Chinese/English definition/example/synonym, `zealous` derivatives, and functional collapse/expand controls. Both reverse modes and all three synonym modes completed known-correct, unsure-correct and unknown paths; unsure correctness remained in review. New-mode sessions also survived reload.
- Browser scheduling/analytics checks verified due ordering, compressed review dates, eight List cards, stable/review/unlearned counts, forgetful-word access and 14 daily table rows. Real downloaded JSON was previewed and imported into another browser context; empty test/training slots restored unfinished sessions. Duplicate import stayed idempotent. Invalid JSON and simulated localStorage write failure preserved both stored and in-memory progress.
- Data-quality annotations and separate empty TC/SE/RC modules were exercised. Phone pages for entries, analytics, recall setup, synonym setup, quality and exam modules had no document-level horizontal overflow. Inner navigation/chart regions intentionally scroll.
- Final visual capture: `node tests/v2-visual-qa.cjs`, with finite animations disabled for settled screenshots. Artifacts are in `C:/Temp/gre800-v2-qa`: `desktop-full-entry.png`, `desktop-progress.png`, `desktop-synonym-choices.png`, `desktop-synonym-answer.png`, equivalent mobile captures, and `mobile-navigation.png`. Browser results are recorded in `results.txt`.
- Both browser scripts closed all QA browser contexts, Chrome and their temporary local static servers in `finally`; no QA service remains running. These checks validate the local project before publication.
- Targeted follow-up after the trend default-scroll fix: `node tests/v2-visual-qa.cjs --trend-only` passed at both 1440px and 375px with browser timezone `Asia/Shanghai`. Both charts opened at their rightmost position, today's complete column was inside each visible chart, and actual learning showed 2 attempts / 50% accuracy. `desktop-progress.png` and `mobile-progress.png` were refreshed. The targeted browser and temporary server closed normally; the full suite was not unnecessarily repeated.
