import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allTopicIds,
  describeTopic,
  getChapter,
  getTopic,
  isKnownTopicId,
  JEE_MAIN_SYLLABUS,
  JEE_MAIN_SYLLABUS_META,
} from './jeeMainSyllabus';

test('syllabus matches the NTA 2026 unit structure (Physics 20, Chemistry 20, Mathematics 14)', () => {
  const counts = Object.fromEntries(JEE_MAIN_SYLLABUS.map((s) => [s.id, s.chapters.length]));
  assert.deepEqual(counts, { physics: 20, chemistry: 20, mathematics: 14 });
  for (const subject of JEE_MAIN_SYLLABUS) {
    assert.deepEqual(
      subject.chapters.map((c) => c.unitNumber),
      Array.from({ length: subject.chapters.length }, (_, i) => i + 1),
      `${subject.id} units must be numbered 1..n in order`
    );
  }
  assert.match(JEE_MAIN_SYLLABUS_META.sourceUrl, /^https:\/\/cdnbbsr\.s3waas\.gov\.in\//);
  assert.equal(JEE_MAIN_SYLLABUS_META.sourceSha256.length, 64);
});

test('subject, chapter and topic ids are unique, hierarchical and lowercase', () => {
  const chapterIds = new Set<string>();
  const topicIds = new Set<string>();
  for (const subject of JEE_MAIN_SYLLABUS) {
    for (const chapter of subject.chapters) {
      assert.ok(!chapterIds.has(chapter.id), `duplicate chapter ${chapter.id}`);
      chapterIds.add(chapter.id);
      assert.ok(chapter.id.startsWith(`${subject.id}.`));
      assert.match(chapter.id, /^[a-z]+\.[a-z0-9-]+$/);
      assert.ok(chapter.topics.length >= 2, `${chapter.id} should list topics`);
      for (const topic of chapter.topics) {
        assert.ok(!topicIds.has(topic.id), `duplicate topic ${topic.id}`);
        topicIds.add(topic.id);
        assert.ok(topic.id.startsWith(`${chapter.id}.`));
        assert.match(topic.id, /^[a-z]+\.[a-z0-9-]+\.[a-z0-9-]+$/);
        assert.ok(topic.name.trim().length > 0);
      }
    }
  }
  assert.equal(allTopicIds().length, topicIds.size);
});

test('chemistry chapters carry their NTA section; lookups work', () => {
  const chemistry = JEE_MAIN_SYLLABUS.find((s) => s.id === 'chemistry')!;
  assert.deepEqual(
    chemistry.chapters.map((c) => c.section),
    [...Array(8).fill('physical'), ...Array(4).fill('inorganic'), ...Array(8).fill('organic')]
  );
  assert.equal(getChapter('physics.kinematics')?.name, 'Kinematics');
  assert.equal(getTopic('physics.kinematics.relative-velocity')?.chapter.id, 'physics.kinematics');
  assert.equal(isKnownTopicId('physics.kinematics.made-up'), false);
  assert.equal(describeTopic('mathematics.statistics-probability.bayes-theorem'), "Mathematics › Statistics and Probability › Bayes' theorem");
});
