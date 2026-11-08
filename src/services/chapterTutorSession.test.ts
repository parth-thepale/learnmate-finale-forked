import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getChapterContent,
  getCheckpointsForChapter,
  type ChapterEducationalContent,
} from './chapterContentProvider';
import {
  JEE_MAIN_SYLLABUS,
  getChapter,
  getSubject,
  type SyllabusChapter,
} from '../data/jeeMainSyllabus';
import { ALL_CHECKPOINTS } from '../features/roadmaps/data/checkpointRegistry';
import { HybridCloudStudyRepository } from './storageService';
import { MemoryStorage } from './testDoubles';
import type { StudyDocument } from '../types/study';

test('1. Launch Session opens tutor without requiring document upload', () => {
  const repo = new HybridCloudStudyRepository({ storage: new MemoryStorage() });
  repo.activateAccount(null);

  // User starts with zero uploaded documents
  assert.equal(repo.getDocuments().length, 0);

  // Student clicks "Launch Session" for Physics Unit 2 (Kinematics)
  const chapter = getChapter('physics.kinematics');
  assert.ok(chapter);

  const session = repo.createStudySession({
    name: `${chapter.name} Session`,
    subjectId: 'physics',
    chapterId: chapter.id,
    topicIds: chapter.topics.map((t) => t.id),
    resourceIds: [],
  });

  assert.equal(session.chapterId, 'physics.kinematics');
  assert.equal(session.subjectId, 'physics');

  // Educational content is immediately delivered to the tutor without document upload
  const content = getChapterContent('physics', chapter);
  assert.ok(content);
  assert.equal(content.chapterName, 'Kinematics');
  assert.equal(content.unitNumber, 2);

  const pages = content.toStudyPages();
  assert.equal(pages.length, 5);
  // All 5 pages have valid sequential numbers 1 to 5
  pages.forEach((p, idx) => {
    assert.equal(p.pageNumber, idx + 1);
    assert.ok(p.title.length > 0);
    assert.ok(p.content.length > 100);
  });

  const topics = content.toStudyTopics();
  assert.ok(topics.length > 0);
  assert.equal(topics[0].id.startsWith('physics.kinematics'), true);
});

test('2. Selected chapter content delivers real educational content (formulas, definitions, derivations, misconceptions)', () => {
  // Test Physics Unit 2: Kinematics (Authored via PHY-01-CP1 / PHY-01-CP2)
  const phyChapter = getChapter('physics.kinematics');
  assert.ok(phyChapter);
  const phyContent = getChapterContent('physics', phyChapter);

  assert.equal(phyContent.isComprehensiveAuthored, true);
  assert.ok(phyContent.definitions.length >= 2);
  assert.ok(phyContent.concepts.length >= 2);

  // Check definitions
  const hasHomoDef = phyContent.definitions.some((d) =>
    d.term.toLowerCase().includes('homogeneity') || d.term.toLowerCase().includes('least count')
  );
  assert.ok(hasHomoDef, 'Expected dimensional homogeneity or least count definition in Kinematics');

  // Check derivations
  const hasDerivation = phyContent.concepts.some((c) => Boolean(c.stepByStepDerivation));
  assert.ok(hasDerivation, 'Expected step-by-step derivation in authored physics module');

  // Check misconceptions
  const hasMistakes = phyContent.concepts.some(
    (c) => c.commonMistakes && c.commonMistakes.length > 0
  );
  assert.ok(hasMistakes, 'Expected common student traps and misconceptions in Kinematics');

  // Test Chemistry Unit 1: Some Basic Concepts in Chemistry
  const chemChapter = getChapter('chemistry.basic-concepts');
  assert.ok(chemChapter);
  const chemContent = getChapterContent('chemistry', chemChapter);
  assert.equal(chemContent.isComprehensiveAuthored, true);
  assert.ok(chemContent.definitions.some((d) => d.term.toLowerCase().includes('mole') || d.term.toLowerCase().includes('molarity')));

  // Test Mathematics Unit 1: Sets, Relations and Functions
  const mathChapter = getChapter('mathematics.sets-relations-functions');
  assert.ok(mathChapter);
  const mathContent = getChapterContent('mathematics', mathChapter);
  assert.equal(mathContent.isComprehensiveAuthored, true);
  assert.ok(mathContent.definitions.some((d) => d.term.toLowerCase().includes('relation') || d.term.toLowerCase().includes('equivalence')));
});

test('3. Chapter content matches the expected official NTA 2026 syllabus', () => {
  assert.equal(JEE_MAIN_SYLLABUS.length, 3);

  const physicsSub = getSubject('physics');
  const chemSub = getSubject('chemistry');
  const mathSub = getSubject('mathematics');

  assert.equal(physicsSub?.chapters.length, 20);
  assert.equal(chemSub?.chapters.length, 20);
  assert.equal(mathSub?.chapters.length, 14);

  // Check chemistry section metadata
  const physicalChem = chemSub!.chapters.find((c) => c.id === 'chemistry.basic-concepts');
  assert.equal(physicalChem?.section, 'physical');
  const organicChem = chemSub!.chapters.find((c) => c.id === 'chemistry.purification-characterisation');
  assert.equal(organicChem?.section, 'organic');

  // Verify all 54 chapters map cleanly to checkpoints
  for (const subject of JEE_MAIN_SYLLABUS) {
    for (const ch of subject.chapters) {
      const linked = getCheckpointsForChapter(subject.id, ch);
      assert.ok(
        linked.length > 0,
        `Expected at least one linked roadmap checkpoint for ${subject.id} chapter ${ch.id}`
      );

      const content = getChapterContent(subject.id, ch);
      assert.equal(content.unitNumber, ch.unitNumber);
      assert.equal(content.subtopics.length, ch.topics.length);
    }
  }
});

test('4. Tutor handles questions using chapter context with verified page numbers', () => {
  const chapter = getChapter('physics.laws-of-motion');
  assert.ok(chapter);
  const content = getChapterContent('physics', chapter);

  const pages = content.toStudyPages();
  const validPageNumbers = new Set(pages.map((p) => p.pageNumber));

  // The server expects page numbers to match valid uploaded page numbers
  assert.equal(validPageNumbers.has(1), true);
  assert.equal(validPageNumbers.has(2), true);
  assert.equal(validPageNumbers.has(3), true);
  assert.equal(validPageNumbers.has(4), true);
  assert.equal(validPageNumbers.has(5), true);
  assert.equal(validPageNumbers.has(6), false);

  // Page 1 contains overview & NTA syllabus topics
  assert.ok(pages[0].content.includes('Chapter Overview'));
  assert.ok(pages[0].content.includes('Official Syllabus Subtopics'));

  // Page 2 contains definitions and foundational principles
  assert.ok(pages[1].content.includes('Formal Definitions'));
  assert.ok(pages[1].content.includes('Foundational Principles'));

  // Page 3 contains key formulas and derivations
  assert.ok(pages[2].content.includes('Key Formulas & Notation'));

  // Page 4 contains solved exemplars
  assert.ok(pages[3].content.includes('Solved Exemplars'));

  // Page 5 contains traps and key takeaways
  assert.ok(pages[4].content.includes('Conceptual Traps'));
  assert.ok(pages[4].content.includes('Key Takeaways'));
});

test('5. Switching chapters cleanly replaces tutor context without residual leaks', () => {
  const chapter1 = getChapter('physics.units-measurements');
  const chapter2 = getChapter('physics.thermodynamics');
  assert.ok(chapter1 && chapter2);

  const content1 = getChapterContent('physics', chapter1);
  const content2 = getChapterContent('physics', chapter2);

  // Content 1 is Unit 1 Units & Measurements
  assert.equal(content1.chapterId, 'physics.units-measurements');
  assert.equal(content1.unitNumber, 1);
  const p1 = content1.toStudyPages();
  assert.ok(p1[0].content.includes('Units and Measurements'));
  assert.equal(p1[0].content.includes('Thermodynamics'), false);

  // Content 2 is Unit 8 Thermodynamics
  assert.equal(content2.chapterId, 'physics.thermodynamics');
  assert.equal(content2.unitNumber, 8);
  const p2 = content2.toStudyPages();
  assert.ok(p2[0].content.includes('Thermodynamics'));
  assert.equal(p2[0].content.includes('Units and Measurements'), false);

  // Topics are completely disjoint
  const topics1 = new Set(content1.subtopics.map((t) => t.id));
  const topics2 = new Set(content2.subtopics.map((t) => t.id));
  for (const t of topics1) {
    assert.equal(topics2.has(t), false, `Topic ${t} should not leak into chapter 2`);
  }
});

test('6. Missing or unauthored content does not crash the session and provides structured fallback', () => {
  // Test completely unknown chapter ID
  const unknownContent = getChapterContent('physics', 'physics.quantum-teleportation-2040');
  assert.ok(unknownContent);
  assert.equal(unknownContent.chapterName, 'Quantum Teleportation 2040');
  assert.equal(unknownContent.isComprehensiveAuthored, false);

  const pages = unknownContent.toStudyPages();
  assert.equal(pages.length, 5);
  assert.ok(pages[0].content.includes('Syllabus Reference'));
  assert.ok(pages[1].content.includes('Core Concepts & Definitions'));

  // Test unauthored official chapter (e.g. chemistry.d-f-block-elements)
  const dfChapter = getChapter('chemistry.d-f-block-elements');
  assert.ok(dfChapter);
  const dfContent = getChapterContent('chemistry', dfChapter);
  assert.equal(dfContent.chapterName, 'd- and f-Block Elements');
  assert.equal(dfContent.isComprehensiveAuthored, false);
  assert.ok(dfContent.scopeDescription.includes('Official NTA Curriculum Scope'));
  assert.equal(dfContent.toStudyPages().length, 5);
});

test('7. Existing document ingestion and switching between documents and chapters still works', () => {
  const repo = new HybridCloudStudyRepository({ storage: new MemoryStorage() });
  repo.activateAccount(null);

  // 1. Create a chapter session
  const chapter = getChapter('physics.kinematics');
  assert.ok(chapter);
  const chapterContent = getChapterContent('physics', chapter);

  // 2. Add an uploaded PDF document
  const sampleDoc: StudyDocument = {
    id: 'doc-hc-verma-optics',
    title: 'HC Verma Ray Optics.pdf',
    sourceType: 'pdf',
    pageCount: 3,
    pages: [
      { pageNumber: 1, title: 'Reflection at Spherical Mirrors', content: 'Focal length is f = R/2.' },
      { pageNumber: 2, title: 'Refraction and Snell Law', content: 'n1 sin(i) = n2 sin(r).' },
      { pageNumber: 3, title: 'Prism Dispersion', content: 'Delta = i + e - A.' },
    ],
    topics: [
      { id: 'optics-reflection', name: 'Reflection', summary: 'Mirror formula', keyConcepts: ['Mirrors'], sourcePages: [1] },
      { id: 'optics-refraction', name: 'Refraction', summary: 'Snell law', keyConcepts: ['Lenses'], sourcePages: [2, 3] },
    ],
    overview: 'HC Verma Volume 2 Chapter 18 Ray Optics Notes',
    createdAt: new Date().toISOString(),
    lastStudiedAt: new Date().toISOString(),
  };

  repo.saveDocument(sampleDoc);
  repo.setActiveDocumentId(sampleDoc.id);

  // Both the document and chapter content coexist independently
  const loadedDoc = repo.getDocuments().find((d) => d.id === sampleDoc.id);
  assert.ok(loadedDoc);
  assert.equal(loadedDoc.title, 'HC Verma Ray Optics.pdf');
  assert.equal(loadedDoc.pages.length, 3);

  // Chapter content is unchanged and independent
  assert.equal(chapterContent.chapterName, 'Kinematics');
  assert.equal(chapterContent.toStudyPages().length, 5);
});
