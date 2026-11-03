import type { BankQuestion } from '../../types/questionBank';
import { contentChecksum } from './normalizer';

/**
 * Duplicate detection against everything already in the bank (drafts and verified).
 *  - Same stable source identity (id, or source+paper+question number) and same content → skip.
 *  - Same stable identity but different content → conflict: reported, never overwritten.
 *  - Same content in a different paper/year/shift → imported, annotated `possibleDuplicateOf`.
 * Questions are never merged because their text looks similar.
 */

export type DedupeDecision =
  | { action: 'import'; possibleDuplicateOf: string[] }
  | { action: 'skip_existing'; existingId: string }
  | { action: 'conflict'; existingId: string; reason: string };

function stableKey(q: BankQuestion): string | null {
  if (q.importMeta) return `${q.importMeta.sourceId}|${q.importMeta.paperId}|${q.importMeta.originalQuestionNumber}`;
  if (q.source === 'pyq' && q.pyq) return `pyq|${q.pyq.date}|${q.pyq.shift}|${q.pyq.questionNumber}`;
  return null;
}

function checksumOf(q: BankQuestion): string {
  if (q.importMeta?.contentChecksum) return q.importMeta.contentChecksum;
  return contentChecksum({ type: q.type, stem: q.stem ?? '', options: q.type === 'mcq' ? q.options ?? [] : [] });
}

export class BankIndex {
  private readonly byId = new Map<string, BankQuestion>();
  private readonly byStableKey = new Map<string, BankQuestion>();
  private readonly byChecksum = new Map<string, BankQuestion[]>();

  constructor(existing: BankQuestion[]) {
    for (const q of existing) this.add(q);
  }

  add(q: BankQuestion): void {
    if (typeof q?.id !== 'string') return;
    this.byId.set(q.id, q);
    const key = stableKey(q);
    if (key) this.byStableKey.set(key, q);
    const sum = checksumOf(q);
    const list = this.byChecksum.get(sum) ?? [];
    list.push(q);
    this.byChecksum.set(sum, list);
  }

  decide(candidate: BankQuestion): DedupeDecision {
    const sum = checksumOf(candidate);
    const key = stableKey(candidate);
    const sameIdentity = this.byId.get(candidate.id) ?? (key ? this.byStableKey.get(key) : undefined);
    if (sameIdentity) {
      if (checksumOf(sameIdentity) === sum) return { action: 'skip_existing', existingId: sameIdentity.id };
      return {
        action: 'conflict',
        existingId: sameIdentity.id,
        reason: 'The bank already has this source question with different content; it was not overwritten.',
      };
    }
    const sameContent = (this.byChecksum.get(sum) ?? []).map((q) => q.id);
    return { action: 'import', possibleDuplicateOf: sameContent };
  }
}
