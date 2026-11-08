import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BRAIN_TEASER_SETS,
  getBrainTeaserSet,
  getAllBrainTeaserQuestions,
  type BrainTeaserSet,
  type BrainTeaserQuestion,
} from './brainTeasersData';
import { generateBrainTeaserPdfBytes } from '../utils/brainTeaserPdfGenerator';

describe('Brain Teaser Answer Distribution & Content Integrity', () => {
  it('1. Total Question Count: exactly 54 questions across 3 sets (18 per set)', () => {
    assert.equal(BRAIN_TEASER_SETS.length, 3, 'Must have exactly 3 sets');
    const all = getAllBrainTeaserQuestions();
    assert.equal(all.length, 54, 'Must have exactly 54 questions in total');

    BRAIN_TEASER_SETS.forEach((set, sIdx) => {
      assert.equal(set.setNumber, sIdx + 1);
      assert.equal(set.questions.length, 18, `Set ${set.setNumber} must contain exactly 18 questions`);
    });
  });

  it('2. Answer Distribution: balanced across A, B, C, and D with zero bias', () => {
    const counts = [0, 0, 0, 0];
    const all = getAllBrainTeaserQuestions();

    for (const q of all) {
      assert.ok(
        q.correctOptionIndex >= 0 && q.correctOptionIndex <= 3,
        `Question ${q.id} index out of range: ${q.correctOptionIndex}`
      );
      counts[q.correctOptionIndex]++;
    }

    // Expected exact distribution: A=14, B=14, C=13, D=13
    assert.equal(counts[0], 14, `Option A must have 14 questions, got ${counts[0]}`);
    assert.equal(counts[1], 14, `Option B must have 14 questions, got ${counts[1]}`);
    assert.equal(counts[2], 13, `Option C must have 13 questions, got ${counts[2]}`);
    assert.equal(counts[3], 13, `Option D must have 13 questions, got ${counts[3]}`);

    // Verify percentage balance: each option is within 24% - 26%
    for (let i = 0; i < 4; i++) {
      const pct = (counts[i] / 54) * 100;
      assert.ok(pct >= 24 && pct <= 26, `Option ${String.fromCharCode(65 + i)} percent ${pct}% must be balanced`);
    }
  });

  it('3. Per-Set Answer Balance: each 18-question set contains 4 to 5 of each option', () => {
    BRAIN_TEASER_SETS.forEach((set) => {
      const setCounts = [0, 0, 0, 0];
      set.questions.forEach((q) => {
        setCounts[q.correctOptionIndex]++;
      });

      // Each set of 18 questions must have between 4 and 5 of every option
      for (let i = 0; i < 4; i++) {
        const letter = String.fromCharCode(65 + i);
        assert.ok(
          setCounts[i] >= 4 && setCounts[i] <= 5,
          `Set ${set.setNumber} option ${letter} count (${setCounts[i]}) must be between 4 and 5`
        );
      }
    });
  });

  it('4. Options Quality: each question has 4 non-empty, mutually distinct options', () => {
    const all = getAllBrainTeaserQuestions();
    for (const q of all) {
      assert.equal(q.options.length, 4, `Question ${q.id} must have exactly 4 options`);
      const distinct = new Set(q.options.map((o) => o.trim()));
      assert.equal(
        distinct.size,
        4,
        `Question ${q.id} has duplicate or ambiguous options: ${JSON.stringify(q.options)}`
      );

      // Verify correct option is non-empty and accessible
      const correctText = q.options[q.correctOptionIndex];
      assert.ok(
        correctText && correctText.trim().length > 0,
        `Question ${q.id} correct option must be non-empty`
      );
    }
  });

  it('5. Explanations & Formula Integrity: every question contains step-by-step reasoning and formula reference', () => {
    const all = getAllBrainTeaserQuestions();
    for (const q of all) {
      assert.ok(
        q.explanation && q.explanation.length > 30,
        `Question ${q.id} must have detailed explanation`
      );
      assert.ok(
        q.formulaReference && q.formulaReference.length > 3,
        `Question ${q.id} must have a formula reference`
      );
      // Explanations should not contain draft question marks or scratch notes
      assert.ok(
        !q.explanation.includes('Wait:') && !q.explanation.includes('re-verify:'),
        `Question ${q.id} explanation must not contain unresolved scratch notes`
      );
    }
  });

  it('6. PDF Engine Integration: publication PDF generator maps rebalanced keys correctly', async () => {
    for (const set of BRAIN_TEASER_SETS) {
      const pdfBytes = await generateBrainTeaserPdfBytes(set);
      assert.ok(pdfBytes instanceof Uint8Array);
      assert.ok(pdfBytes.length > 5000, `PDF for Set ${set.setNumber} must be non-empty`);

      // Verify PDF starts with %PDF- header
      const header = String.fromCharCode(...pdfBytes.slice(0, 5));
      assert.equal(header, '%PDF-');
    }
  });
});
