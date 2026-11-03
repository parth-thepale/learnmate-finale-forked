/**
 * Validates every question file under data/question-bank/ (drafts and verified).
 * Usage: npm run bank:validate        Exit code 1 when any problem is found.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readQuestionFiles } from '../src/server/questionBankLoader.ts';
import { computeAvailability, loadBank, summarizePaperSets } from '../src/utils/questionBank.ts';
import type { BankQuestion } from '../src/types/questionBank.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let problems = 0;
const allIds = new Map<string, string>();

for (const folder of ['drafts', 'verified']) {
  const dir = path.join(root, 'data', 'question-bank', folder);
  const { records, files, errors } = readQuestionFiles(dir);
  const loaded = loadBank(records);
  const statusCounts: Record<string, number> = {};
  for (const q of loaded.questions) statusCounts[q.verification.status] = (statusCounts[q.verification.status] ?? 0) + 1;

  console.log(`\n[${folder}] ${files.length} file(s), ${records.length} record(s), ${loaded.questions.length} valid`);
  console.log(`  status: ${JSON.stringify(statusCounts)}`);
  for (const e of [...errors, ...loaded.errors]) {
    console.log(`  ✖ ${e}`);
    problems++;
  }
  for (const q of loaded.questions) {
    const previous = allIds.get(q.id);
    if (previous) {
      console.log(`  ✖ ${q.id}: id also used in ${previous}`);
      problems++;
    }
    allIds.set(q.id, folder);
  }
  if (folder === 'verified') {
    const notVerified = loaded.questions.filter((q: BankQuestion) => q.verification.status !== 'verified');
    for (const q of notVerified) {
      console.log(`  ✖ ${q.id}: in verified/ but status is "${q.verification.status}" (it will not be served)`);
      problems++;
    }
    const availability = computeAvailability(loaded.questions);
    console.log(`  servable by subject: ${JSON.stringify(availability.bySubject)}`);
    const papers = summarizePaperSets(loaded.questions);
    for (const p of papers) console.log(`  paper ${p.paperId}: ${p.complete ? 'COMPLETE' : 'incomplete'} ${JSON.stringify(p.counts)}`);
    if (papers.length === 0) console.log('  no full-length paper sets (full mocks stay unavailable)');
  }
}

console.log(problems === 0 ? '\nQuestion bank OK.' : `\n${problems} problem(s) found.`);
process.exit(problems === 0 ? 0 : 1);
