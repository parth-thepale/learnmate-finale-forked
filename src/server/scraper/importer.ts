import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import type { BankQuestion } from '../../types/questionBank';
import { validateBankQuestionStaged } from '../../utils/questionValidation';
import { getAdapter, type AdapterLookup } from './adapters';
import { unmatchedKeyEntries } from './answerKeyExtractor';
import { BankIndex } from './deduplicator';
import { normalizeQuestion, slug } from './normalizer';
import { parsePdf } from './pdfParser';
import { assertSourceAllows, getSource, type SourceLookup } from './sourceRegistry';
import type { ImportRequest, ImportSummary } from './types';

/**
 * Draft-bank importer. Writes a NEW file under drafts/imports/ (exclusive create — never overwrites)
 * plus an import log. It never writes to verified/, never edits existing bank files and never
 * sets a question to verified.
 */

export class ImportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRequestError';
  }
}

export interface ImporterEnvironment {
  /** Root of the question bank, normally <repo>/data/question-bank. */
  bankRoot: string;
  now?: () => Date;
  jobId?: string;
  /** Run everything but do not write the draft file (the log is still written). */
  dryRun?: boolean;
  /** Source/adapter lookups; default to the reviewed registry. Injected in tests. */
  sources?: SourceLookup;
  adapters?: AdapterLookup;
}

function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsonFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out.sort();
}

/** Reads every question already in the bank (drafts and verified) for duplicate detection. */
export function readExistingBank(bankRoot: string): { questions: BankQuestion[]; problems: string[] } {
  const questions: BankQuestion[] = [];
  const problems: string[] = [];
  for (const folder of ['drafts', 'verified']) {
    for (const file of listJsonFiles(path.join(bankRoot, folder))) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) questions.push(...(parsed as BankQuestion[]));
        else problems.push(`${path.relative(bankRoot, file)} is not a JSON array.`);
      } catch (err) {
        problems.push(`${path.relative(bankRoot, file)}: ${err instanceof Error ? err.message : 'unreadable'}`);
      }
    }
  }
  return { questions, problems };
}

export function newJobId(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `imp-${stamp}-${randomBytes(3).toString('hex')}`;
}

function validateRequest(request: ImportRequest, adapterParsesPaper: boolean): void {
  const d = request.descriptor;
  if (!d.paperId || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{1,100}$/.test(d.paperId)) {
    throw new ImportRequestError('A paper id (letters, digits, space, ".", "_" or "-") is required.');
  }
  if (!request.licence || !['own_content', 'permission_granted', 'licensed', 'unverified'].includes(request.licence.basis)) {
    throw new ImportRequestError('Declare the licence basis: own_content, permission_granted, licensed or unverified.');
  }
  if ((request.licence.basis === 'permission_granted' || request.licence.basis === 'licensed') && !request.licence.reference) {
    throw new ImportRequestError('A licence/permission reference is required for permission_granted and licensed content.');
  }
  if (request.sourceLabel === 'pyq') {
    const missing = ['year', 'session', 'date', 'shift', 'paperUrl', 'answerKeyUrl'].filter(
      (k) => (d as unknown as Record<string, unknown>)[k] === undefined || (d as unknown as Record<string, unknown>)[k] === ''
    );
    if (missing.length) throw new ImportRequestError(`PYQ imports need: ${missing.join(', ')}.`);
  }
  if (request.sourceLabel === 'curated' && !request.author) {
    throw new ImportRequestError('Curated imports need an author.');
  }
  if (!adapterParsesPaper && request.paper.contentType !== 'application/pdf') throw new ImportRequestError('The question paper must be a PDF.');
}

export async function runImport(request: ImportRequest, env: ImporterEnvironment): Promise<ImportSummary> {
  const now = env.now ? env.now() : new Date();
  const jobId = env.jobId ?? newJobId(now);
  const source = assertSourceAllows(request.sourceId, 'import', env.sources ?? getSource);
  const adapter = (env.adapters ?? getAdapter)(source.adapterId);
  if (!adapter) throw new ImportRequestError(`No adapter is available for source "${source.id}".`);
  validateRequest(request, Boolean(adapter.parsePaper));

  const draftsRoot = path.resolve(env.bankRoot, 'drafts');
  const logsRoot = path.resolve(env.bankRoot, 'import-logs');

  const parsed = adapter.parsePaper ? await adapter.parsePaper(request.paper) : await parsePdf(request.paper.bytes);
  const extraction = adapter.extract(parsed);
  const key = request.answerKey
    ? await adapter.parseAnswerKey(request.answerKey, { type: request.answerKeyType, version: request.answerKeyVersion })
    : undefined;

  const existing = readExistingBank(env.bankRoot);
  const index = new BankIndex(existing.questions);
  const accepted: BankQuestion[] = [];
  const records: Array<Record<string, unknown>> = [];
  let complete = 0;
  let needsReview = 0;
  let failed = 0;
  let skippedExisting = 0;
  let conflicts = 0;

  for (const extracted of extraction.questions) {
    const normalized = normalizeQuestion({ extracted, request, source, key, jobId, now });
    const record: Record<string, unknown> = {
      questionNumber: extracted.questionNumber,
      extractionStatus: normalized.extraction.status,
      issues: normalized.extraction.issues.map((i) => `${i.code}: ${i.message}`),
    };
    records.push(record);
    if (!normalized.question) {
      failed++;
      record.decision = 'failed';
      continue;
    }
    const q = normalized.question;
    record.id = q.id;
    const validation = validateBankQuestionStaged(q, 'draft');
    record.reviewItems = validation.reviewItems;
    if (validation.errors.length > 0) {
      failed++;
      record.decision = 'failed';
      record.validationErrors = validation.errors;
      continue;
    }
    const decision = index.decide(q);
    record.decision = decision.action;
    if (decision.action === 'skip_existing') {
      skippedExisting++;
      record.existingId = decision.existingId;
      continue;
    }
    if (decision.action === 'conflict') {
      conflicts++;
      record.existingId = decision.existingId;
      record.reason = decision.reason;
      continue;
    }
    if (decision.possibleDuplicateOf.length > 0 && q.importMeta) {
      q.importMeta.possibleDuplicateOf = decision.possibleDuplicateOf;
      record.possibleDuplicateOf = decision.possibleDuplicateOf;
    }
    index.add(q);
    accepted.push(q);
    if (normalized.extraction.status === 'complete') complete++;
    else needsReview++;
  }

  const problems = [
    ...extraction.problems.map((p) => `paper: ${p}`),
    ...(key ? key.problems.map((p) => `answer key: ${p}`) : ['answer key: none supplied']),
    ...(key ? unmatchedKeyEntries(key, extraction.questions).map((n) => `answer key: entry for question ${n} has no matching question.`) : []),
    ...existing.problems.map((p) => `bank: ${p}`),
  ];

  let draftFile: string | null = null;
  if (!env.dryRun && accepted.length > 0) {
    const dir = path.join(draftsRoot, 'imports', slug(source.id));
    const target = path.resolve(dir, `${slug(request.descriptor.paperId)}--${jobId}.json`);
    if (!target.startsWith(draftsRoot + path.sep)) throw new ImportRequestError('Refusing to write outside drafts/.');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(accepted, null, 2)}\n`, { flag: 'wx' });
    draftFile = target;
  }

  fs.mkdirSync(logsRoot, { recursive: true });
  const logFile = path.join(logsRoot, `${jobId}.json`);
  const bankRelative = (file: string) => path.relative(env.bankRoot, file).split(path.sep).join('/');
  const summary: ImportSummary = {
    jobId,
    sourceId: source.id,
    paperId: request.descriptor.paperId,
    draftFile: draftFile ? bankRelative(draftFile) : null,
    logFile: bankRelative(logFile),
    extracted: extraction.questions.length,
    imported: accepted.length,
    complete,
    needsReview,
    failed,
    skippedExisting,
    conflicts,
    problems,
  };
  const log = {
    jobId,
    createdAt: now.toISOString(),
    dryRun: Boolean(env.dryRun),
    source: { id: source.id, name: source.name, reuseStatus: source.reuse.status },
    request: {
      descriptor: request.descriptor,
      sourceLabel: request.sourceLabel,
      licence: request.licence,
      author: request.author,
      answerKeyType: request.answerKeyType,
      answerKeyVersion: request.answerKeyVersion,
      optionNumbering: request.optionNumbering ?? 'letters',
    },
    files: {
      paper: { fileName: request.paper.fileName, url: request.paper.url, sha256: request.paper.sha256, bytes: request.paper.bytes.byteLength },
      answerKey: request.answerKey
        ? { fileName: request.answerKey.fileName, url: request.answerKey.url, sha256: request.answerKey.sha256, bytes: request.answerKey.bytes.byteLength }
        : null,
    },
    summary,
    questions: records,
  };
  fs.writeFileSync(logFile, `${JSON.stringify(log, null, 2)}\n`, { flag: 'wx' });
  return summary;
}
