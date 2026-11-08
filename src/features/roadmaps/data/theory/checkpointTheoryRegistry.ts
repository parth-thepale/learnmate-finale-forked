import type { CheckpointTheoryModule } from '../../types/checkpointTheory.types';
import { PHYSICS_THEORY_MODULES } from './physicsTheory';
import { CHEMISTRY_THEORY_MODULES } from './chemistryTheory';
import { MATHEMATICS_THEORY_MODULES } from './mathematicsTheory';
import { getCheckpointById } from '../checkpointRegistry';

const COMPILED_THEORY_MODULES: Record<string, CheckpointTheoryModule> = {
  ...PHYSICS_THEORY_MODULES,
  ...CHEMISTRY_THEORY_MODULES,
  ...MATHEMATICS_THEORY_MODULES,
};

export function getCheckpointTheory(checkpointId: string): CheckpointTheoryModule {
  if (COMPILED_THEORY_MODULES[checkpointId]) {
    return COMPILED_THEORY_MODULES[checkpointId];
  }

  // Graceful fallback for any checkpoint in the catalogue:
  // Build a structured, educational module from checkpoint metadata
  const cp = getCheckpointById(checkpointId);
  const subject = cp?.subject ?? 'physics';
  const title = cp?.title ?? checkpointId;
  const description = cp?.description ?? 'Comprehensive curriculum notes and problem-solving strategies.';
  const objectives = cp?.learningObjectives && cp.learningObjectives.length > 0
    ? [...cp.learningObjectives]
    : [
        `Understand the fundamental principles and laws of ${title}.`,
        'Apply mathematical equations and standard relations to solve JEE Main problems.',
        'Identify standard pitfalls, boundary limits, and conceptual edge cases.',
        'Master application-oriented problem solving techniques.',
      ];

  const concepts = (cp?.concepts && cp.concepts.length > 0)
    ? cp.concepts.map((c, i) => ({
        id: c.id || `concept-${i}`,
        title: c.title,
        explanation: c.summary,
        keyFormulas: (c.keyFormulas || []).map((f) => ({
          label: f.label,
          formula: f.formula,
          description: f.description,
        })),
        commonMistakes: (c.commonPitfalls || []).map((p) => ({
          mistake: p,
          correction: 'Review the underlying fundamental theorem and avoid hasty algebraic substitutions.',
          why: 'JEE Main distractors specifically target this common algebraic or conceptual oversight.',
        })),
      }))
    : [
        {
          id: `${checkpointId}-core-concepts`,
          title: `Core Conceptual Foundations: ${title}`,
          explanation: `${description}\n\nKey topics covered in this milestone include: ${(cp?.topicIds || []).map((t) => t.split('.').pop()?.replace(/-/g, ' ')).join(', ')}. Review the formal mathematical expressions below and focus on operational definitions.`,
          keyFormulas: [
            {
              label: 'Governing Formula',
              formula: `\\text{Core Law of } ${title.split(' ')[0]}`,
              description: 'Standard formula applicable under uniform boundary conditions.',
            },
          ],
          commonMistakes: [
            {
              mistake: 'Applying formulas outside their domain of validity (e.g. non-inertial frames without pseudo forces).',
              correction: 'Always verify whether underlying assumptions (constant mass, uniform field, ideal conditions) hold.',
              why: 'Standard equations are derived under ideal constraints.',
            },
          ],
        },
      ];

  return {
    checkpointId,
    roadmapId: (cp?.roadmapId as any) ?? 'PHY-01',
    subject,
    title,
    subtitle: description,
    estimatedMinutes: cp?.estimatedWorkloadMinutes || 60,
    learningObjectives: objectives,
    definitions: [
      {
        term: title.split('&')[0].trim(),
        definition: description,
        context: 'Official NTA JEE 2026 curriculum milestone.',
      },
    ],
    concepts,
    keyTakeaways: [
      `Review all core definitions and formulas for ${title}.`,
      'Practice dimensional homogeneity and boundary value analysis.',
      'Check assumptions before applying shortcut equations.',
    ],
  };
}

export function hasAuthoredTheory(checkpointId: string): boolean {
  return Boolean(COMPILED_THEORY_MODULES[checkpointId]);
}
