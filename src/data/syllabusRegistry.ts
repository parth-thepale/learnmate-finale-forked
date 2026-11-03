import type { ExamTypeId } from '../types/study';
import { JEE_MAIN_SYLLABUS, JEE_MAIN_SYLLABUS_META } from './jeeMainSyllabus';

/**
 * Registry of syllabi that attempts and practice sets may reference. The shared attempt model
 * stores plain string ids (syllabusId, syllabusRevision, subjectId, chapterId, topicIds); this
 * registry is the only place that knows which ids exist, so adding another exam (e.g. NEET UG)
 * means registering its syllabus here rather than changing the attempt model.
 *
 * Revisions are immutable. Each (syllabusId, revision) entry is a deep-frozen snapshot of its
 * subjects/chapters/topics, pinned by `idsFingerprint` (sha256 over its sorted
 * "subject|chapter|topic" id lines; verified by tests). Attempts are always resolved against their
 * exact revision. Changing Learnmate's grouping means adding a new revision; old revisions stay
 * registered so historical attempts keep their original meaning.
 */

export interface RegistryTopic {
  readonly id: string;
  readonly name: string;
}

export interface RegistryChapter {
  readonly id: string;
  readonly subjectId: string;
  readonly name: string;
  readonly topics: readonly RegistryTopic[];
}

export interface RegistrySubject {
  readonly id: string;
  readonly name: string;
  readonly chapters: readonly RegistryChapter[];
}

export interface RegistrySyllabus {
  readonly id: string;
  readonly revision: number;
  readonly examType: ExamTypeId;
  readonly title: string;
  readonly subjects: readonly RegistrySubject[];
  /** sha256 over the sorted "subjectId|chapterId|topicId" lines of this revision. */
  readonly idsFingerprint: string;
  readonly source: Readonly<{ title: string; url: string; sha256: string; retrievedOn: string; groupingReview: string }>;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** Immutable copy of a subject tree (only the fields the registry exposes). */
function snapshot(subjects: readonly RegistrySubject[]): readonly RegistrySubject[] {
  return deepFreeze(
    subjects.map((s) => ({
      id: s.id,
      name: s.name,
      chapters: s.chapters.map((c) => ({
        id: c.id,
        subjectId: c.subjectId,
        name: c.name,
        topics: c.topics.map((t) => ({ id: t.id, name: t.name })),
      })),
    }))
  );
}

const JEE_MAIN_2026_R1: RegistrySyllabus = deepFreeze({
  id: 'jee_main_2026',
  revision: 1,
  examType: 'jee_main' as const,
  title: JEE_MAIN_SYLLABUS_META.exam,
  subjects: snapshot(JEE_MAIN_SYLLABUS),
  idsFingerprint: '8ec51ed44bcb89a75df173f98a9a1a14a57a3f436761596966b7b98a27d0c402',
  source: {
    title: JEE_MAIN_SYLLABUS_META.sourceTitle,
    url: JEE_MAIN_SYLLABUS_META.sourceUrl,
    sha256: JEE_MAIN_SYLLABUS_META.sourceSha256,
    retrievedOn: JEE_MAIN_SYLLABUS_META.retrievedOn,
    groupingReview: JEE_MAIN_SYLLABUS_META.topicGroupingReview,
  },
});

/** Every registered revision of every syllabus (never remove an entry). */
export const SYLLABUS_REGISTRY: readonly RegistrySyllabus[] = deepFreeze([JEE_MAIN_2026_R1]);

interface SyllabusIndex {
  subjects: Map<string, RegistrySubject>;
  chapters: Map<string, RegistryChapter>;
  topics: Map<string, { topic: RegistryTopic; chapter: RegistryChapter }>;
}

const indexes = new Map<RegistrySyllabus, SyllabusIndex>();

function indexFor(syllabus: RegistrySyllabus): SyllabusIndex {
  let index = indexes.get(syllabus);
  if (!index) {
    index = { subjects: new Map(), chapters: new Map(), topics: new Map() };
    for (const subject of syllabus.subjects) {
      index.subjects.set(subject.id, subject);
      for (const chapter of subject.chapters) {
        index.chapters.set(chapter.id, chapter);
        for (const topic of chapter.topics) index.topics.set(topic.id, { topic, chapter });
      }
    }
    indexes.set(syllabus, index);
  }
  return index;
}

/** The exact registered revision, or undefined (never falls back to another revision). */
export function getSyllabusRevision(id: unknown, revision: unknown): RegistrySyllabus | undefined {
  if (typeof id !== 'string' || !Number.isInteger(revision)) return undefined;
  return SYLLABUS_REGISTRY.find((s) => s.id === id && s.revision === revision);
}

/** Latest revision of a syllabus: use only when creating new practice, never to read history. */
export function getCurrentSyllabus(id: unknown): RegistrySyllabus | undefined {
  if (typeof id !== 'string') return undefined;
  return SYLLABUS_REGISTRY.filter((s) => s.id === id).sort((a, b) => b.revision - a.revision)[0];
}

export function isRegisteredSyllabusId(id: unknown): boolean {
  return getCurrentSyllabus(id) !== undefined;
}

export function findSyllabusSubject(syllabus: RegistrySyllabus, subjectId: unknown): RegistrySubject | undefined {
  return typeof subjectId === 'string' ? indexFor(syllabus).subjects.get(subjectId) : undefined;
}

export function findSyllabusChapter(syllabus: RegistrySyllabus, chapterId: unknown): RegistryChapter | undefined {
  return typeof chapterId === 'string' ? indexFor(syllabus).chapters.get(chapterId) : undefined;
}

export function findSyllabusTopic(
  syllabus: RegistrySyllabus,
  topicId: unknown
): { topic: RegistryTopic; chapter: RegistryChapter } | undefined {
  return typeof topicId === 'string' ? indexFor(syllabus).topics.get(topicId) : undefined;
}

/** True when the topic id exists in any registered revision of any syllabus. */
export function isRegisteredTopicId(topicId: unknown): boolean {
  return SYLLABUS_REGISTRY.some((s) => Boolean(findSyllabusTopic(s, topicId)));
}

/** Canonical id lines used for `idsFingerprint` (hashing is done by tests and tooling). */
export function syllabusIdLines(syllabus: Pick<RegistrySyllabus, 'subjects'>): string[] {
  const lines: string[] = [];
  for (const s of syllabus.subjects) for (const c of s.chapters) for (const t of c.topics) lines.push(`${s.id}|${c.id}|${t.id}`);
  return lines.sort();
}
