/**
 * Validates every question file under data/question-bank/.
 *  - drafts/ (recursive, including drafts/imports/**): draft-stage validation. Integrity problems
 *    are errors; incomplete content (no topic yet, image-only stem, missing key...) is listed as
 *    review items, which do not fail the run.
 *  - verified/ (flat, exactly what the server loads): strict publish-stage validation.
 * Usage: npm run bank:validate [-- --details]   Exit code 1 when any error is found.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readQuestionFiles } from '../src/server/questionBankLoader.ts';
import { computeAvailability, loadBank, summarizePaperSets } from '../src/utils/questionBank.ts';
import { validateBankQuestionStaged } from '../src/utils/questionValidation.ts';
import type { BankQuestion } from '../src/types/questionBank.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bankRoot = path.join(root, 'data', 'question-bank');
const showDetails = process.argv.includes('--details');
let problems = 0;
const allIds = new Map<string, string>();

function fail(message: string): void {
  console.log(`  ✖ ${message}`);
  problems++;
}

function trackId(id: string, folder: string): void {
  const previous = allIds.get(id);
  if (previous) fail(`${id}: id also used in ${previous}`);
  else allIds.set(id, folder);
}

// --- drafts (draft stage) ---------------------------------------------------
{
  const dir = path.join(bankRoot, 'drafts');
  const { records, files, errors } = readQuestionFiles(dir, { recursive: true });
  const statusCounts: Record<string, number> = {};
  const extractionCounts: Record<string, number> = {};
  const reviewItems: string[] = [];
  let valid = 0;
  for (const e of errors) fail(e);
  for (const record of records) {
    const result = validateBankQuestionStaged(record, 'draft');
    for (const e of result.errors) fail(e);
    reviewItems.push(...result.reviewItems);
    if (result.errors.length > 0) continue;
    valid++;
    const q = record as BankQuestion;
    statusCounts[q.verification.status] = (statusCounts[q.verification.status] ?? 0) + 1;
    if (q.importMeta) extractionCounts[q.importMeta.extraction.status] = (extractionCounts[q.importMeta.extraction.status] ?? 0) + 1;
    if (q.verification.status === 'verified') {
      console.log(`  ! ${q.id}: marked verified but still in drafts/ (it is not served until moved to verified/)`);
    }
    trackId(q.id, 'drafts');
  }
  console.log(`\n[drafts] ${files.length} file(s), ${records.length} record(s), ${valid} structurally valid`);
  console.log(`  status: ${JSON.stringify(statusCounts)}`);
  if (Object.keys(extractionCounts).length) console.log(`  imported extraction: ${JSON.stringify(extractionCounts)}`);
  console.log(`  review items (must be resolved before verification): ${reviewItems.length}`);
  if (showDetails) for (const item of reviewItems) console.log(`    · ${item}`);
  else if (reviewItems.length) console.log('    (run with -- --details to list them)');
}

// --- verified (publish stage; identical to what the server loads) -----------
{
  const dir = path.join(bankRoot, 'verified');
  const { records, files, errors } = readQuestionFiles(dir);
  const loaded = loadBank(records);
  const statusCounts: Record<string, number> = {};
  for (const q of loaded.questions) statusCounts[q.verification.status] = (statusCounts[q.verification.status] ?? 0) + 1;
  console.log(`\n[verified] ${files.length} file(s), ${records.length} record(s), ${loaded.questions.length} valid`);
  console.log(`  status: ${JSON.stringify(statusCounts)}`);
  for (const e of [...errors, ...loaded.errors]) fail(e);
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) fail(`verified/${entry.name}/: sub-folders are not loaded by the server; keep verified files flat.`);
    }
  }
  for (const q of loaded.questions) trackId(q.id, 'verified');
  for (const q of loaded.questions.filter((x: BankQuestion) => x.verification.status !== 'verified')) {
    fail(`${q.id}: in verified/ but status is "${q.verification.status}" (it will not be served)`);
  }
  const availability = computeAvailability(loaded.questions);
  console.log(`  servable by subject: ${JSON.stringify(availability.bySubject)}`);
  const papers = summarizePaperSets(loaded.questions);
  for (const p of papers) console.log(`  paper ${p.paperId}: ${p.complete ? 'COMPLETE' : 'incomplete'} ${JSON.stringify(p.counts)}`);
  if (papers.length === 0) console.log('  no full-length paper sets (full mocks stay unavailable)');
}

console.log(problems === 0 ? '\nQuestion bank OK.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
