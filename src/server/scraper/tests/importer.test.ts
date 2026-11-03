import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { BankQuestion } from '../../../types/questionBank';
import { loadVerifiedQuestionBank } from '../../questionBankLoader';
import { isServableBankQuestion, validateBankQuestion, validateBankQuestionStaged } from '../../../utils/questionValidation';
import type { SourceAdapter } from '../adapters';
import { BankIndex } from '../deduplicator';
import { ImportRequestError, runImport } from '../importer';
import { contentChecksum } from '../normalizer';
import { SOURCE_REGISTRY, SourceNotPermittedError } from '../sourceRegistry';
import type { ImportRequest, ParsedPdf } from '../types';
import { documentFrom, makePdf, SAMPLE_KEY_CSV, SAMPLE_PAPER, testSource, textDocument } from './fixtures';

const EXISTING_DRAFT = `${JSON.stringify([{ id: 'existing-curated-1', note: 'pre-existing content must not change' }], null, 2)}\n`;

function tempBank(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-bank-'));
  fs.mkdirSync(path.join(root, 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'verified'), { recursive: true });
  fs.writeFileSync(path.join(root, 'verified', '.gitkeep'), '');
  fs.writeFileSync(path.join(root, 'drafts', 'existing.json'), EXISTING_DRAFT);
  return root;
}

let paperBytes: Uint8Array | null = null;
async function request(overrides: Partial<ImportRequest> = {}): Promise<ImportRequest> {
  paperBytes ??= await makePdf(SAMPLE_PAPER);
  return {
    sourceId: 'manual-upload',
    paper: documentFrom(paperBytes, 'application/pdf', 'sample-paper.pdf'),
    answerKey: textDocument(SAMPLE_KEY_CSV),
    answerKeyType: 'final',
    answerKeyVersion: 'final-v1',
    descriptor: { paperId: 'Sample Paper 1', title: 'Sample Paper 1' },
    sourceLabel: 'curated',
    licence: { basis: 'own_content' },
    author: 'Learnmate test author',
    ...overrides,
  };
}

const fixedNow = () => new Date('2026-11-03T10:00:00.000Z');

function readDrafts(root: string, rel: string): BankQuestion[] {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}

test('imports a manual PDF into drafts/imports with provenance, never verified', async () => {
  const root = tempBank();
  try {
    const summary = await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-a' });
    assert.equal(summary.extracted, 7);
    assert.equal(summary.imported, 7);
    assert.equal(summary.complete, 4);
    assert.equal(summary.needsReview, 3);
    assert.equal(summary.failed, 0);
    assert.equal(summary.draftFile, 'drafts/imports/manual-upload/sample-paper-1--job-a.json');
    assert.equal(summary.logFile, 'import-logs/job-a.json');
    assert.ok(summary.problems.includes('paper: Question 7 was not found in the text layer.'));
    assert.ok(summary.problems.includes('answer key: entry for question 9 has no matching question.'));

    const drafts = readDrafts(root, summary.draftFile!);
    const byNumber = new Map(drafts.map((q) => [q.importMeta!.originalQuestionNumber, q]));
    for (const q of drafts) {
      assert.equal(q.verification.status, 'draft');
      assert.equal(q.source, 'curated');
      assert.deepEqual(validateBankQuestionStaged(q, 'draft').errors, [], q.id);
      assert.ok(validateBankQuestion(q).length > 0, 'imported drafts are never publishable as-is');
      assert.equal(q.importMeta!.sourceId, 'manual-upload');
      assert.equal(q.importMeta!.paperId, 'Sample Paper 1');
      assert.equal(q.importMeta!.sourceFileSha256, documentFrom(paperBytes!, 'application/pdf', 'x').sha256);
      assert.equal(q.importMeta!.answerKey!.type, 'final');
      assert.equal(q.importMeta!.answerKey!.version, 'final-v1');
      assert.equal(q.importMeta!.contentChecksum.length, 64);
      assert.equal(q.chapterId, '', 'classification is left to the reviewer');
    }
    const q1 = byNumber.get(1)!;
    assert.equal(q1.id, 'imp-sample-paper-1-q01');
    assert.equal(q1.type === 'mcq' && q1.correctOptionIds.join(), 'B');
    assert.equal(q1.importMeta!.extraction.status, 'complete');
    const q3 = byNumber.get(3)!;
    assert.equal(q3.type === 'mcq' && q3.correctOptionIds.join(), 'A,B', 'multiple accepted answers are kept');
    assert.equal(q3.importMeta!.extraction.status, 'needs_review');
    const q5 = byNumber.get(5)!;
    assert.equal(q5.type, 'numerical');
    assert.deepEqual(q5.type === 'numerical' && q5.acceptedIntegers, [12]);
    assert.equal(byNumber.get(8)!.keyStatus, 'dropped');

    assert.deepEqual(fs.readdirSync(path.join(root, 'verified')), ['.gitkeep'], 'verified/ is never written');
    assert.equal(fs.readFileSync(path.join(root, 'drafts', 'existing.json'), 'utf8'), EXISTING_DRAFT);
    const log = JSON.parse(fs.readFileSync(path.join(root, summary.logFile), 'utf8'));
    assert.equal(log.summary.jobId, 'job-a');
    assert.equal(log.questions.length, 7);
    assert.ok(!JSON.stringify(log).includes('"bytes":{'), 'raw file bytes are not logged');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('re-importing the same paper skips existing questions and never overwrites files', async () => {
  const root = tempBank();
  try {
    const first = await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-1' });
    const before = fs.readFileSync(path.join(root, first.draftFile!), 'utf8');
    const second = await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-2' });
    assert.equal(second.imported, 0);
    assert.equal(second.skippedExisting, 7);
    assert.equal(second.draftFile, null);
    assert.equal(fs.readFileSync(path.join(root, first.draftFile!), 'utf8'), before);
    await assert.rejects(runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-1' }), /EEXIST/, 'job logs are never overwritten');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('changed content for an existing source question is a conflict, not an overwrite', async () => {
  const root = tempBank();
  try {
    const first = await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-1' });
    const file = path.join(root, first.draftFile!);
    const edited = readDrafts(root, first.draftFile!).map((q) =>
      q.importMeta!.originalQuestionNumber === 2 ? { ...q, stem: 'Edited by a reviewer', importMeta: { ...q.importMeta!, contentChecksum: 'e'.repeat(64) } } : q
    );
    fs.writeFileSync(file, JSON.stringify(edited));
    const second = await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-2' });
    assert.equal(second.conflicts, 1);
    assert.equal(second.skippedExisting, 6);
    assert.equal(readDrafts(root, first.draftFile!).find((q) => q.importMeta!.originalQuestionNumber === 2)!.stem, 'Edited by a reviewer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the same content in a different paper is kept separately and annotated, not merged', async () => {
  const root = tempBank();
  try {
    await runImport(await request(), { bankRoot: root, now: fixedNow, jobId: 'job-1' });
    const other = await runImport(await request({ descriptor: { paperId: 'Sample Paper 2', title: 'Sample Paper 2' } }), {
      bankRoot: root,
      now: fixedNow,
      jobId: 'job-2',
    });
    assert.equal(other.imported, 7);
    const drafts = readDrafts(root, other.draftFile!);
    assert.equal(drafts[0].id, 'imp-sample-paper-2-q01');
    assert.deepEqual(drafts[0].importMeta!.possibleDuplicateOf, ['imp-sample-paper-1-q01']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('imports are refused for disabled sources, undeclared licences and incomplete PYQ provenance', async () => {
  const root = tempBank();
  try {
    const env = { bankRoot: root, now: fixedNow };
    await assert.rejects(runImport(await request({ sourceId: 'nta-jee-main' }), env), SourceNotPermittedError);
    await assert.rejects(runImport(await request({ sourceId: 'random-site' }), env), SourceNotPermittedError);
    await assert.rejects(runImport(await request({ licence: { basis: 'permission_granted' } }), env), ImportRequestError);
    await assert.rejects(runImport(await request({ licence: { basis: 'whatever' as never } }), env), ImportRequestError);
    await assert.rejects(runImport(await request({ sourceLabel: 'pyq' }), env), /PYQ imports need/);
    await assert.rejects(runImport(await request({ author: undefined }), env), /author/);
    await assert.rejects(runImport(await request({ descriptor: { paperId: '../../verified/x', title: 'x' } }), env), ImportRequestError);
    await assert.rejects(runImport(await request({ paper: textDocument('not a pdf', 'p.csv') }), env), ImportRequestError);
    assert.deepEqual(fs.readdirSync(path.join(root, 'drafts')), ['existing.json']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PYQ imports carry official provenance; provisional keys and incomplete extraction block verification', async () => {
  const root = tempBank();
  try {
    const summary = await runImport(
      await request({
        sourceLabel: 'pyq',
        licence: { basis: 'unverified' },
        answerKeyType: 'provisional',
        answerKeyVersion: 'provisional-2026-02-04',
        descriptor: {
          paperId: 'JEE Main 2026 S1 21 Jan Shift 1',
          title: 'x',
          exam: 'JEE Main',
          year: 2026,
          session: 1,
          date: '2026-01-21',
          shift: 1,
          paperUrl: 'https://jeemain.nta.nic.in/paper.pdf',
          answerKeyUrl: 'https://jeemain.nta.nic.in/key.pdf',
        },
      }),
      { bankRoot: root, now: fixedNow, jobId: 'job-pyq' }
    );
    assert.equal(summary.complete, 0, 'every answer from a provisional key needs review');
    const drafts = readDrafts(root, summary.draftFile!);
    const q1 = drafts.find((q) => q.importMeta!.originalQuestionNumber === 1)!;
    assert.equal(q1.id, 'pyq-20260121-s1-q01');
    assert.equal(q1.pyq!.questionNumber, 1);
    assert.equal(q1.importMeta!.answerKey!.type, 'provisional');

    const attempt = {
      ...q1,
      verification: { status: 'verified', reviewedBy: 'Reviewer', reviewedAt: '2026-11-03' },
    };
    const errors = validateBankQuestion(attempt);
    assert.ok(errors.some((e) => e.includes('final answer key')));
    assert.ok(errors.some((e) => e.includes('extraction is complete')));
    assert.ok(errors.some((e) => e.includes('permission_granted')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('duplicate index decisions: skip, conflict, possible duplicate', () => {
  const base = {
    id: 'a-1',
    source: 'curated',
    type: 'numerical',
    stem: 'Find  N',
    acceptedIntegers: [1],
    verification: { status: 'draft' },
  } as unknown as BankQuestion;
  const index = new BankIndex([base]);
  assert.equal(index.decide({ ...base } as BankQuestion).action, 'skip_existing');
  assert.equal(index.decide({ ...base, stem: 'Different' } as BankQuestion).action, 'conflict');
  const elsewhere = index.decide({ ...base, id: 'b-1', stem: 'find n' } as BankQuestion);
  assert.deepEqual(elsewhere, { action: 'import', possibleDuplicateOf: ['a-1'] });
  assert.notEqual(contentChecksum({ type: 'mcq', stem: 'x', options: [] }), contentChecksum({ type: 'numerical', stem: 'x', options: [] }));
});

/** Imports the sample paper and returns question 2 completed by a reviewer (but licence unconfirmed). */
async function reviewedImport(licence: ImportRequest['licence']): Promise<BankQuestion> {
  const root = tempBank();
  try {
    const summary = await runImport(await request({ licence }), { bankRoot: root, now: fixedNow, jobId: 'job-lic' });
    const q2 = readDrafts(root, summary.draftFile!).find((q) => q.importMeta!.originalQuestionNumber === 2)!;
    return {
      ...q2,
      chapterId: 'physics.units-measurements',
      topicIds: ['physics.units-measurements.units-si'],
      difficulty: 'easy',
      explanation: 'Velocity has both magnitude and direction.',
      verification: { status: 'verified', reviewedBy: 'Reviewer', reviewedAt: '2026-11-03' },
    } as BankQuestion;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('uploading a file never makes it publishable: licences must be declared, not unverified, and reviewer-confirmed', async () => {
  const unverified = await reviewedImport({ basis: 'unverified' });
  assert.equal(unverified.licence?.basis, 'unverified');
  assert.equal(unverified.licence?.confirmedBy, undefined, 'the importer never confirms a licence');
  const confirmedButUnverified = { ...unverified, licence: { ...unverified.licence!, confirmedBy: 'Owner', confirmedAt: '2026-11-03' } };
  assert.ok(validateBankQuestion(confirmedButUnverified).some((e) => e.includes('unverified licence')));
  assert.equal(isServableBankQuestion(confirmedButUnverified), false);

  const declared = await reviewedImport({ basis: 'own_content' });
  assert.ok(validateBankQuestion(declared).some((e) => e.includes('licence.confirmedBy')), 'a declaration alone is not enough');
  assert.equal(isServableBankQuestion(declared), false);

  const stripped = { ...declared } as Partial<BankQuestion>;
  delete stripped.licence;
  assert.ok(validateBankQuestion(stripped).some((e) => e.includes('must record a licence')));
  assert.ok(validateBankQuestionStaged(stripped, 'draft').errors.some((e) => e.includes('must record a licence')));

  const confirmed = { ...declared, licence: { ...declared.licence!, confirmedBy: 'Owner', confirmedAt: '2026-11-03' } };
  assert.deepEqual(validateBankQuestion(confirmed), []);
  assert.equal(isServableBankQuestion(confirmed), true);

  // Publication path: the student-facing loader skips the unconfirmed and unverified-licence copies.
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-bank-'));
  try {
    const verifiedDir = path.join(repo, 'data', 'question-bank', 'verified');
    fs.mkdirSync(verifiedDir, { recursive: true });
    const unconfirmedCopy = { ...declared, id: 'imp-sample-paper-1-q02-copy' };
    fs.writeFileSync(path.join(verifiedDir, 'set.json'), JSON.stringify([confirmed, unconfirmedCopy, { ...confirmedButUnverified, id: 'imp-x-q02' }]));
    const served = loadVerifiedQuestionBank(repo);
    assert.deepEqual(served.questions.map((q) => q.id), [confirmed.id]);
    assert.ok(served.errors.length >= 2);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a new permitted source plugs in through the registry and an adapter without importer changes', async () => {
  const root = tempBank();
  try {
    const source = testSource({ id: 'licensed-mock-provider', kind: 'third_party_mock', adapterId: 'test-structured', reuse: { status: 'permission_granted', summary: 'test', permissionReference: 'AGREEMENT-1' } });
    const parsed: ParsedPdf = { pageCount: 1, lines: [], images: [], pageHeights: [842] };
    const adapter: SourceAdapter = {
      id: 'test-structured',
      parsePaper: async () => parsed,
      extract: () => ({
        problems: [],
        questions: [
          {
            questionNumber: 1,
            sourceQuestionId: 'Q-901',
            subjectId: 'chemistry',
            section: 'A',
            type: 'mcq',
            stem: 'Which gas is noble?',
            options: ['Neon', 'Nitrogen', 'Oxygen', 'Hydrogen'].map((text, i) => ({
              label: (['A', 'B', 'C', 'D'] as const)[i],
              originalLabel: String(i + 1),
              text,
              sourceOptionId: `O-90${i + 1}`,
            })),
            hasFigure: false,
            issues: [],
            pages: [1, 1],
          },
        ],
      }),
      parseAnswerKey: async (document, meta) => ({
        ...meta,
        fileSha256: document.sha256,
        problems: [],
        entries: [{ sourceQuestionId: 'Q-901', answer: { kind: 'option_ids', ids: ['O-901'] }, raw: 'O-901' }],
      }),
    };
    const summary = await runImport(
      await request({
        sourceId: source.id,
        paper: textDocument('{"structured":true}', 'paper.json'),
        licence: { basis: 'licensed', reference: 'AGREEMENT-1' },
      }),
      {
        bankRoot: root,
        now: fixedNow,
        jobId: 'job-ext',
        sources: (id) => (id === source.id ? source : undefined),
        adapters: (id) => (id === adapter.id ? adapter : undefined),
      }
    );
    assert.equal(summary.imported, 1);
    const [q] = readDrafts(root, summary.draftFile!);
    assert.equal(summary.draftFile, 'drafts/imports/licensed-mock-provider/sample-paper-1--job-ext.json');
    assert.equal(q.type === 'mcq' && q.correctOptionIds.join(), 'A', 'option-id answer keys map through sourceOptionId');
    assert.equal(q.importMeta!.sourceQuestionId, 'Q-901');
    assert.equal(q.verification.status, 'draft');
    assert.deepEqual(SOURCE_REGISTRY.map((s) => s.id), ['manual-upload', 'nta-jee-main'], 'the reviewed registry is unchanged');
    await assert.rejects(runImport(await request({ sourceId: source.id }), { bankRoot: root }), SourceNotPermittedError, 'unregistered sources stay blocked by default');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
