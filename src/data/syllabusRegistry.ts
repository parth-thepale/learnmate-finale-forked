import type { ExamTypeId } from '../types/study';
import { JEE_MAIN_SYLLABUS, JEE_MAIN_SYLLABUS_META } from './jeeMainSyllabus';

/**
 * Registry of syllabi that attempts and practice sets may reference. The shared attempt model
 * stores plain string ids (syllabusId, subjectId, chapterId, topicIds); this registry is the only
 * place that knows which ids exist, so adding another exam (e.g. NEET UG) means registering its
 * syllabus here rather than changing the attempt model.
 *
 * `revision` changes whenever Learnmate's chapter/topic grouping for a syllabus changes. Ids of a
 * retired revision must stay resolvable (list them in `supportedRevisions` and keep their ids), so
 * older attempts never become unreadable.
 */

export interface RegistryTopic {
  id: string;
  name: string;
}

export interface RegistryChapter {
  id: string;
  subjectId: string;
  name: string;
  topics: readonly RegistryTopic[];
}

export interface RegistrySubject {
  id: string;
  name: string;
  chapters: readonly RegistryChapter[];
}

export interface RegistrySyllabus {
  id: string;
  examType: ExamTypeId;
  title: string;
  /** Current revision of the chapter/topic grouping. */
  revision: number;
  /** Revisions whose ids are still resolvable (always includes `revision`). */
  supportedRevisions: readonly number[];
  subjects: readonly RegistrySubject[];
  source: { title: string; url: string; sha256: string; retrievedOn: string; groupingReview: string };
}

const JEE_MAIN_2026: RegistrySyllabus = Object.freeze({
  id: 'jee_main_2026',
  examType: 'jee_main' as const,
  title: JEE_MAIN_SYLLABUS_META.exam,
  revision: 1,
  supportedRevisions: Object.freeze([1]),
  subjects: JEE_MAIN_SYLLABUS,
  source: Object.freeze({
    title: JEE_MAIN_SYLLABUS_META.sourceTitle,
    url: JEE_MAIN_SYLLABUS_META.sourceUrl,
    sha256: JEE_MAIN_SYLLABUS_META.sourceSha256,
    retrievedOn: JEE_MAIN_SYLLABUS_META.retrievedOn,
    groupingReview: JEE_MAIN_SYLLABUS_META.topicGroupingReview,
  }),
});

export const SYLLABUS_REGISTRY: readonly RegistrySyllabus[] = Object.freeze([JEE_MAIN_2026]);

interface SyllabusIndex {
  subjects: Map<string, RegistrySubject>;
  chapters: Map<string, RegistryChapter>;
  topics: Map<string, { topic: RegistryTopic; chapter: RegistryChapter }>;
}

const indexes = new Map<string, SyllabusIndex>();

function indexFor(syllabus: RegistrySyllabus): SyllabusIndex {
  let index = indexes.get(syllabus.id);
  if (!index) {
    index = { subjects: new Map(), chapters: new Map(), topics: new Map() };
    for (const subject of syllabus.subjects) {
      index.subjects.set(subject.id, subject);
      for (const chapter of subject.chapters) {
        index.chapters.set(chapter.id, chapter);
        for (const topic of chapter.topics) index.topics.set(topic.id, { topic, chapter });
      }
    }
    indexes.set(syllabus.id, index);
  }
  return index;
}

export function getSyllabus(id: unknown): RegistrySyllabus | undefined {
  return typeof id === 'string' ? SYLLABUS_REGISTRY.find((s) => s.id === id) : undefined;
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

/** True when the topic id exists in any registered syllabus. */
export function isRegisteredTopicId(topicId: unknown): boolean {
  return SYLLABUS_REGISTRY.some((s) => Boolean(findSyllabusTopic(s, topicId)));
}
