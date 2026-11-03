/**
 * Administrative question import CLI (developer/admin only; there is no HTTP endpoint).
 *
 *   npm run questions:import -- sources
 *   npm run questions:import -- discover --source <id>
 *   npm run questions:import -- import-pdf --paper <file.pdf> --paper-id <id> --label curated|pyq \
 *        [--licence own_content|permission_granted|licensed|unverified (default)] [--licence-ref <ref>] \
 *        [--author <name>] [--key <file.csv|txt|pdf>] [--key-type final|provisional] [--key-version <v>] \
 *        [--option-numbering letters|numbers] [--year --session --date --shift --paper-url --key-url] [--dry-run]
 *   npm run questions:import -- review --job <jobId>
 *   npm run questions:import -- prepare-review --job <jobId> [--mark-pending]
 *
 * Imports always land in data/question-bank/drafts/imports/. Nothing here can mark a question
 * verified; that remains a manual reviewer step (see data/question-bank/README.md).
 */
import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { parseArgs } from 'util';
import { getAdapter } from '../src/server/scraper/adapters/index.ts';
import { PoliteFetcher } from '../src/server/scraper/fetcher.ts';
import { runImport } from '../src/server/scraper/importer.ts';
import { PDF_LIMITS } from '../src/server/scraper/pdfParser.ts';
import { assertSourceAllows, SOURCE_REGISTRY } from '../src/server/scraper/sourceRegistry.ts';
import type { ImportRequest, SourceDocument } from '../src/server/scraper/types.ts';
import { validateBankQuestionStaged } from '../src/utils/questionValidation.ts';
import type { BankQuestion, LicenceBasis } from '../src/types/questionBank.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bankRoot = path.join(repoRoot, 'data', 'question-bank');
const USER_AGENT = 'LearnmateQuestionImporter/1.0 (+manual admin import)';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    paper: { type: 'string' },
    key: { type: 'string' },
    'paper-id': { type: 'string' },
    label: { type: 'string' },
    licence: { type: 'string' },
    'licence-ref': { type: 'string' },
    author: { type: 'string' },
    'key-type': { type: 'string' },
    'key-version': { type: 'string' },
    'option-numbering': { type: 'string' },
    year: { type: 'string' },
    session: { type: 'string' },
    date: { type: 'string' },
    shift: { type: 'string' },
    'paper-url': { type: 'string' },
    'key-url': { type: 'string' },
    job: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'mark-pending': { type: 'boolean' },
  },
});

function die(message: string): never {
  console.error(`✖ ${message}`);
  process.exit(1);
}

function readLocalDocument(file: string, sourceId: string): SourceDocument {
  const full = path.resolve(file);
  const stat = fs.statSync(full, { throwIfNoEntry: false });
  if (!stat || !stat.isFile()) die(`File not found: ${file}`);
  if (stat.size > PDF_LIMITS.maxBytes) die(`${file} is larger than ${PDF_LIMITS.maxBytes} bytes.`);
  const ext = path.extname(full).toLowerCase();
  const contentType =
    ext === '.pdf' ? 'application/pdf' : ext === '.csv' || ext === '.tsv' ? 'text/csv' : ext === '.txt' ? 'text/plain' : null;
  if (!contentType) die(`${file}: only .pdf, .csv, .tsv or .txt files are accepted.`);
  const bytes = new Uint8Array(fs.readFileSync(full));
  return {
    sourceId,
    fileName: path.basename(full),
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    retrievedAt: new Date().toISOString(),
    contentType,
  };
}

function optionalInt(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) die(`--${name} must be a whole number.`);
  return n;
}

function readLog(jobId: string): Record<string, any> {
  if (!/^[A-Za-z0-9-]{4,80}$/.test(jobId)) die('Invalid job id.');
  const file = path.join(bankRoot, 'import-logs', `${jobId}.json`);
  if (!fs.existsSync(file)) die(`No import log for job ${jobId}.`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function draftFileFor(log: Record<string, any>): string {
  const rel = log.summary?.draftFile;
  if (!rel) die('This job did not write a draft file.');
  const full = path.resolve(bankRoot, rel);
  if (!full.startsWith(path.resolve(bankRoot, 'drafts') + path.sep)) die('Draft file path is outside drafts/.');
  if (!fs.existsSync(full)) die(`Draft file ${rel} no longer exists.`);
  return full;
}

async function main(): Promise<void> {
  const command = positionals[0];
  switch (command) {
    case 'sources': {
      for (const s of SOURCE_REGISTRY) {
        console.log(`\n${s.id} — ${s.name}`);
        console.log(`  kind: ${s.kind}   reuse: ${s.reuse.status}   fetch: ${s.fetchEnabled ? 'on' : 'off'}   import: ${s.importEnabled ? 'on' : 'off'}`);
        console.log(`  ${s.reuse.summary}`);
        if (s.notes) console.log(`  note: ${s.notes}`);
      }
      return;
    }
    case 'discover': {
      if (!values.source) die('--source is required.');
      const source = assertSourceAllows(values.source, 'fetch');
      const adapter = getAdapter(source.adapterId);
      if (!adapter?.discover) die(`Source "${source.id}" has no discovery adapter.`);
      const papers = await adapter.discover(source, new PoliteFetcher({ userAgent: USER_AGENT }));
      if (papers.length === 0) console.log('No papers found.');
      for (const p of papers) console.log(`${p.paperId}\t${p.title}\t${p.paperUrl ?? ''}\t${p.answerKeyUrl ?? ''}`);
      return;
    }
    case 'import-pdf': {
      const sourceId = values.source ?? 'manual-upload';
      if (!values.paper) die('--paper is required.');
      if (!values['paper-id']) die('--paper-id is required.');
      const label = values.label;
      if (label !== 'pyq' && label !== 'curated') die('--label must be "pyq" or "curated".');
      const keyType = values['key-type'] ?? 'final';
      if (keyType !== 'final' && keyType !== 'provisional') die('--key-type must be final or provisional.');
      const numbering = values['option-numbering'] ?? 'letters';
      if (numbering !== 'letters' && numbering !== 'numbers') die('--option-numbering must be letters or numbers.');
      const session = optionalInt('session', values.session);
      const shift = optionalInt('shift', values.shift);
      const request: ImportRequest = {
        sourceId,
        paper: readLocalDocument(values.paper, sourceId),
        ...(values.key ? { answerKey: readLocalDocument(values.key, sourceId) } : {}),
        answerKeyType: keyType,
        answerKeyVersion: values['key-version'] ?? (values.key ? path.basename(values.key) : 'none'),
        descriptor: {
          paperId: values['paper-id'],
          title: values['paper-id'],
          ...(label === 'pyq' ? { exam: 'JEE Main' as const } : {}),
          ...(values.year ? { year: optionalInt('year', values.year) } : {}),
          ...(session === 1 || session === 2 ? { session } : {}),
          ...(values.date ? { date: values.date } : {}),
          ...(shift === 1 || shift === 2 ? { shift } : {}),
          ...(values['paper-url'] ? { paperUrl: values['paper-url'] } : {}),
          ...(values['key-url'] ? { answerKeyUrl: values['key-url'] } : {}),
        },
        sourceLabel: label,
        // An upload proves nothing about reuse rights: without a declaration the licence is
        // "unverified", which keeps every imported question out of verification and publication.
        licence: { basis: (values.licence ?? 'unverified') as LicenceBasis, ...(values['licence-ref'] ? { reference: values['licence-ref'] } : {}) },
        ...(values.author ? { author: values.author } : {}),
        optionNumbering: numbering,
      };
      const summary = await runImport(request, { bankRoot, dryRun: Boolean(values['dry-run']) });
      console.log(JSON.stringify(summary, null, 2));
      if (request.licence.basis === 'unverified') {
        console.log('\nLicence: unverified. These drafts can be reviewed but never verified or published until reuse rights are recorded and confirmed.');
      }
      console.log(`\nNext: npm run questions:import -- review --job ${summary.jobId}`);
      return;
    }
    case 'review': {
      if (!values.job) die('--job is required.');
      const log = readLog(values.job);
      const s = log.summary;
      console.log(`Job ${s.jobId}  source=${s.sourceId}  paper=${s.paperId}${log.dryRun ? '  (dry run)' : ''}`);
      console.log(
        `extracted ${s.extracted} · imported ${s.imported} (complete ${s.complete}, needs review ${s.needsReview}) · failed ${s.failed} · skipped existing ${s.skippedExisting} · conflicts ${s.conflicts}`
      );
      console.log(`draft file: ${s.draftFile ?? '(none)'}`);
      for (const p of s.problems as string[]) console.log(`  ! ${p}`);
      for (const q of log.questions as Array<Record<string, any>>) {
        if (q.extractionStatus === 'complete' && q.decision === 'import' && !(q.reviewItems ?? []).length) continue;
        console.log(`\nQ${q.questionNumber} ${q.id ?? ''} — ${q.decision} / ${q.extractionStatus}`);
        for (const i of q.issues ?? []) console.log(`    issue: ${i}`);
        for (const e of q.validationErrors ?? []) console.log(`    error: ${e}`);
        if (q.reason) console.log(`    ${q.reason} (existing ${q.existingId})`);
        const items = (q.reviewItems ?? []) as string[];
        if (items.length) console.log(`    ${items.length} review item(s): ${items.map((i) => i.replace(/^[^:]+: /, '')).join(' · ')}`);
      }
      console.log('\nRun `npm run bank:validate -- --details` for the full review-item list.');
      return;
    }
    case 'prepare-review': {
      if (!values.job) die('--job is required.');
      const log = readLog(values.job);
      const file = draftFileFor(log);
      const questions = JSON.parse(fs.readFileSync(file, 'utf8')) as BankQuestion[];
      const ready: string[] = [];
      const lines: string[] = [`# Review sheet — ${log.summary.paperId} (job ${log.jobId})`, '', `Draft file: \`${path.relative(bankRoot, file).split(path.sep).join('/')}\``, ''];
      for (const q of questions) {
        const result = validateBankQuestionStaged(q, 'draft');
        const outstanding = [...result.errors, ...result.reviewItems];
        if (outstanding.length === 0 && q.verification.status === 'draft') ready.push(q.id);
        lines.push(`## ${q.id} (original Q${q.importMeta?.originalQuestionNumber ?? '?'})`, '', q.stem || '_(no stem text)_', '');
        if (q.type === 'mcq') for (const o of q.options ?? []) lines.push(`- **${o.id}** ${o.text}`);
        const keyText = q.keyStatus === 'dropped' ? 'DROPPED' : q.type === 'mcq' ? (q.correctOptionIds ?? []).join(', ') : (q.acceptedIntegers ?? []).join(' | ');
        lines.push('', `Key: ${keyText || '_missing_'} · key source: ${q.importMeta?.answerKey ? `${q.importMeta.answerKey.type} ${q.importMeta.answerKey.version}` : 'none'}`);
        lines.push(outstanding.length ? `Outstanding:\n${outstanding.map((o) => `- [ ] ${o}`).join('\n')}` : 'Outstanding: none', '');
      }
      const sheet = path.join(bankRoot, 'import-logs', `${log.jobId}-review.md`);
      fs.writeFileSync(sheet, `${lines.join('\n')}\n`);
      console.log(`Review sheet written: ${path.relative(repoRoot, sheet)}`);
      console.log(`${ready.length} of ${questions.length} drafts have no outstanding items.`);
      if (values['mark-pending'] && ready.length > 0) {
        const updated = questions.map((q) => (ready.includes(q.id) ? { ...q, verification: { ...q.verification, status: 'pending_review' as const } } : q));
        fs.writeFileSync(file, `${JSON.stringify(updated, null, 2)}\n`);
        console.log(`Marked pending_review (draft → pending_review only): ${ready.join(', ')}`);
      } else if (ready.length > 0) {
        console.log('Re-run with --mark-pending to move those drafts to pending_review. Verification stays manual.');
      }
      return;
    }
    default:
      die('Usage: questions:import <sources | discover | import-pdf | review | prepare-review> (see scripts/question-import.ts).');
  }
}

main().catch((err) => die(err instanceof Error ? `${err.name}: ${err.message}` : 'Import failed.'));
