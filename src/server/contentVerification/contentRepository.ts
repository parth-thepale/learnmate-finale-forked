import { getCheckpointById } from '../../features/roadmaps/data/checkpointRegistry.ts';
import type { Checkpoint } from '../../features/roadmaps/types/checkpoint.types.ts';
import type {
  AuthoritativeContentRepository,
  StagedQuestionRecord,
  SubjectDomain,
} from './types.ts';

/**
 * Authoritative Content Repository backed by the official Roadmap Checkpoint Catalogue.
 *
 * Guarantees that:
 * 1. Questions must pre-exist in the authoritative curriculum structure.
 * 2. Arbitrary or un-staged question definitions from the client cannot be approved.
 * 3. Unknown question IDs or checkpoint IDs are rejected with null.
 */
export class CatalogueCheckpointContentRepository implements AuthoritativeContentRepository {
  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    if (!checkpointId || typeof checkpointId !== 'string') {
      return null;
    }
    const cleanId = checkpointId.trim();
    return getCheckpointById(cleanId) || null;
  }

  async getStagedQuestion(
    checkpointId: string,
    questionId: string
  ): Promise<StagedQuestionRecord | null> {
    if (!checkpointId || !questionId) {
      return null;
    }

    const checkpoint = await this.getCheckpoint(checkpointId);
    if (!checkpoint) {
      return null;
    }

    const cleanQuestionId = questionId.trim();

    // Check assessment questions
    const assessmentQ = (checkpoint.assessmentQuestions || []).find(
      (q) => q.id === cleanQuestionId
    );
    if (assessmentQ) {
      return {
        question: assessmentQ,
        checkpointId: checkpoint.id,
        subject: checkpoint.subject as SubjectDomain,
        topicId: assessmentQ.topicId,
        stageStatus: 'staged',
        stagedAt: '2026-11-01T00:00:00.000Z',
        stagingAuthor: 'curriculum-team',
      };
    }

    // Check practice questions
    const practiceQ = (checkpoint.practiceQuestions || []).find(
      (q) => q.id === cleanQuestionId
    );
    if (practiceQ) {
      return {
        question: practiceQ,
        checkpointId: checkpoint.id,
        subject: checkpoint.subject as SubjectDomain,
        topicId: practiceQ.topicId,
        stageStatus: 'staged',
        stagedAt: '2026-11-01T00:00:00.000Z',
        stagingAuthor: 'curriculum-team',
      };
    }

    return null;
  }
}

/**
 * In-Memory Staged Content Repository for unit testing and controlled test harnesses.
 */
export class MemoryStagedContentRepository implements AuthoritativeContentRepository {
  private readonly stagedQuestions = new Map<string, StagedQuestionRecord>();
  private readonly checkpoints = new Map<string, Checkpoint>();

  constructor(initialStaged: readonly StagedQuestionRecord[] = [], initialCheckpoints: readonly Checkpoint[] = []) {
    for (const record of initialStaged) {
      this.registerStagedQuestion(record);
    }
    for (const cp of initialCheckpoints) {
      this.checkpoints.set(cp.id, cp);
    }
  }

  registerStagedQuestion(record: StagedQuestionRecord): void {
    const key = `${record.checkpointId}::${record.question.id}`;
    this.stagedQuestions.set(key, record);
  }

  registerCheckpoint(checkpoint: Checkpoint): void {
    this.checkpoints.set(checkpoint.id, checkpoint);
  }

  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    if (!checkpointId) return null;
    return this.checkpoints.get(checkpointId.trim()) || null;
  }

  async getStagedQuestion(
    checkpointId: string,
    questionId: string
  ): Promise<StagedQuestionRecord | null> {
    if (!checkpointId || !questionId) return null;
    const key = `${checkpointId.trim()}::${questionId.trim()}`;
    return this.stagedQuestions.get(key) || null;
  }
}
