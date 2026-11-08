import type { RoadmapId } from './roadmap.types';

export interface CheckpointDefinition {
  term: string;
  definition: string;
  context?: string;
}

export interface CheckpointFormula {
  label: string;
  formula: string;
  description?: string;
  units?: string;
}

export interface CheckpointDerivationStep {
  stepNumber: number;
  text: string;
  math?: string;
  note?: string;
}

export interface CheckpointDerivation {
  title: string;
  startingPoint: string;
  steps: CheckpointDerivationStep[];
  conclusion: string;
}

export interface CheckpointSolvedExample {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  problemStatement: string;
  approach: string;
  solutionSteps: string[];
  finalAnswer: string;
}

export interface CheckpointCommonMistake {
  mistake: string;
  correction: string;
  why: string;
}

export interface CheckpointConceptModule {
  id: string;
  title: string;
  explanation: string;
  diagramSvg?: string;
  diagramCaption?: string;
  keyFormulas: CheckpointFormula[];
  derivations?: CheckpointDerivation[];
  solvedExamples?: CheckpointSolvedExample[];
  commonMistakes: CheckpointCommonMistake[];
}

export interface CheckpointTheoryModule {
  checkpointId: string;
  roadmapId: RoadmapId;
  subject: 'physics' | 'chemistry' | 'mathematics';
  title: string;
  subtitle: string;
  estimatedMinutes: number;
  learningObjectives: string[];
  definitions: CheckpointDefinition[];
  concepts: CheckpointConceptModule[];
  keyTakeaways: string[];
}
