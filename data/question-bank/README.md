# Learnmate question bank

Server-only data. Files here are never bundled into the web app or served as static files
(the production server serves `dist/` only; the Vite dev server denies `data/question-bank/**`).
Answer keys leave the server only after a student submits an attempt.

## Folders

| Folder | Purpose | Served to students? |
|---|---|---|
| `drafts/` | Questions being written or awaiting review | **Never** |
| `verified/` | Questions approved by the product owner | Only entries with `verification.status = "verified"` that pass validation |

The server loads `verified/*.json` only. Moving a question into `verified/` is not enough on its
own: its `verification` block must be completed by the reviewer.

## Workflow

1. **Author or import** questions into a JSON array in `drafts/` with `verification.status: "draft"`.
2. **Validate**: `npm run bank:validate` (schema, syllabus IDs, answer keys, provenance, duplicates).
3. **Submit for review**: set `verification.status` to `"pending_review"`.
4. **Owner review**: the reviewer independently solves each question, checks the answer key and
   (for PYQs) compares stem, options and key against the official NTA paper and **final** answer key.
   Approved questions get:
   ```json
   "verification": { "status": "verified", "reviewedBy": "<name>", "reviewedAt": "YYYY-MM-DD" }
   ```
   Rejected questions get `"status": "rejected"` with `notes`.
5. **Publish**: move verified questions into a file in `verified/` and run `npm run bank:validate`.

Importing a question never makes it verified. Learnmate never certifies answers automatically.

## Importing papers (admin only)

The import pipeline lives in `src/server/scraper/` and is run locally from the CLI. There is no
HTTP endpoint for it and no background scraper.

```
npm run questions:import -- sources                      # registered sources and their reuse status
npm run questions:import -- import-pdf --paper paper.pdf --key key.csv --paper-id "Mock 1" \
    --label curated --licence own_content --author "Name" [--key-type final] [--dry-run]
npm run questions:import -- review --job <jobId>         # failed / ambiguous questions
npm run bank:validate -- --details                       # every outstanding review item
npm run questions:import -- prepare-review --job <jobId> [--mark-pending]
```

- Output goes to a new file `drafts/imports/<source>/<paper>--<jobId>.json` (tracked in Git) plus
  `import-logs/<jobId>.json` and review sheets (local only, git-ignored). Existing files are never
  overwritten; re-imports skip questions already in the bank and report changed ones as conflicts.
- Every imported question keeps `importMeta` (source, file checksum, retrieval time, paper id,
  original question number, content checksum, answer-key version/type, extraction status) and a
  `licence`. Classification, difficulty and explanations are left for the reviewer.
- Uploading a file grants no reuse rights. Without `--licence` the basis is `unverified`, which
  can never be verified or served. Any declared basis is only a claim: an imported question can
  be verified only after a reviewer adds `licence.confirmedBy` and `licence.confirmedAt`.
- Drafts are validated in the *draft* stage (gaps are listed as review items); `verified/` uses
  strict validation. A question can only be verified once extraction is `complete`, its key is
  a `final` key and, for PYQs, `licence.basis` is `permission_granted` with a reference.
- `--mark-pending` only moves drafts with no outstanding items from `draft` to `pending_review`.
- NTA papers are registered but disabled: NTA's copyright policy requires prior permission.
  Answer-key CSV format: `question_number,answer` with `A`–`D`, integers, `A|C` for several
  accepted answers, or `DROPPED`.

## Source rules

- `"pyq"`: only questions from officially published NTA JEE (Main) papers, with `pyq` provenance
  (year, session, date, shift, question number, official paper URL and **final** answer key URL on an
  NTA host). Reuse rights for NTA papers must be confirmed by the product owner before any PYQ is
  verified. Memory-based or coaching-site papers are never PYQs.
- `"curated"`: original Learnmate questions with `curated.author` and `curated.createdAt`.
- AI-generated questions are never stored in the bank and are always labelled as AI practice.

## Question format

Common fields: `id` (lowercase, stable), `source`, `type` (`"mcq"` | `"numerical"`), `subjectId`,
`chapterId`, `topicIds` (IDs from `src/data/jeeMainSyllabus.ts`), `difficulty`, `stem`,
`explanation`, `verification`, optional `keyStatus` (`"dropped"` when the official final key drops
a question: every candidate gets full marks), optional `paperSetId` (curated full-length sets).

- MCQ: `options` = four entries with ids `A`–`D`; `correctOptionIds` = one id (more only when the
  official final key accepts several).
- Numerical (Section B): `acceptedIntegers` = the integer answer(s). JEE Main asks candidates to
  round to the nearest integer.

Text fields are Markdown with inline LaTeX (`$...$`).

## Full-length mocks

A full-length JEE Main mock is offered only when one paper set contains exactly 25 verified
questions per subject (20 MCQ + 5 numerical, 75 in total). Until then, only topic-wise practice
and sectional tests built from available verified questions are offered. AI questions are never
mixed into an official PYQ paper.
