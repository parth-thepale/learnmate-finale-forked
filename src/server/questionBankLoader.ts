import fs from 'fs';
import path from 'path';
import type { BankQuestion } from '../types/questionBank';
import { loadBank, servableQuestions } from '../utils/questionBank';

export interface LoadedQuestionBankFiles {
  questions: BankQuestion[];
  errors: string[];
  files: string[];
  skippedUnverified: number;
}

/**
 * Reads JSON arrays of bank questions from a directory. Non-recursive by default (the served
 * verified bank is flat); `recursive` is used for drafts, where imports live in sub-folders.
 */
export function readQuestionFiles(
  dir: string,
  options: { recursive?: boolean } = {}
): { records: unknown[]; files: string[]; errors: string[] } {
  const records: unknown[] = [];
  const files: string[] = [];
  const errors: string[] = [];
  if (!fs.existsSync(dir)) return { records, files, errors };
  const collect = (folder: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory() && options.recursive) out.push(...collect(full));
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
    }
    return out;
  };
  for (const file of collect(dir)) {
    const name = path.relative(dir, file).split(path.sep).join('/');
    files.push(file);
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!Array.isArray(parsed)) {
        errors.push(`${name}: file must contain a JSON array of questions.`);
        continue;
      }
      records.push(...parsed);
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : 'unreadable JSON'}`);
    }
  }
  return { records, files, errors };
}

/**
 * Loads the student-facing bank: only `verified/` files, and only questions that are both valid and
 * marked verified by a reviewer. Drafts are never loaded.
 */
export function loadVerifiedQuestionBank(rootDir: string): LoadedQuestionBankFiles {
  const dir = path.resolve(rootDir, 'data', 'question-bank', 'verified');
  const { records, files, errors: fileErrors } = readQuestionFiles(dir);
  const loaded = loadBank(records);
  const servable = servableQuestions(loaded.questions);
  return {
    questions: servable,
    errors: [...fileErrors, ...loaded.errors],
    files,
    skippedUnverified: loaded.questions.length - servable.length,
  };
}
