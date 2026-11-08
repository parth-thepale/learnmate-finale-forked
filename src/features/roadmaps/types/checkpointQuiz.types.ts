export type QuizQuestionType = 'single_correct' | 'numerical';

export interface CheckpointQuizQuestion {
  id: string;
  checkpointId: string;
  type: QuizQuestionType;
  stem: string;
  options?: string[]; // exactly 4 options for single_correct
  correctOptionIndex?: number; // 0, 1, 2, or 3
  correctNumericalAnswer?: number; // exact or reference numerical value
  numericalTolerance?: number; // e.g. 0.05
  explanation: string;
  formulaReference?: string;
  conceptReference?: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizQuestionOutcome {
  questionId: string;
  type: QuizQuestionType;
  isCorrect: boolean;
  studentAnswer: string;
  correctAnswer: string;
  explanation: string;
  formulaReference?: string;
  conceptReference?: string;
}

export interface QuizGradingResult {
  checkpointId: string;
  totalQuestions: number;
  correctCount: number;
  incorrectCount: number;
  unansweredCount: number;
  rawMarks: number; // +4 for correct, -1 for incorrect in single_correct; +4 / 0 for numerical
  maxMarks: number;
  scorePercentage: number; // accuracy percentage (0 - 100)
  passed: boolean; // meets passing criteria (>= 60%)
  completedAt: string;
  outcomes: Record<string, QuizQuestionOutcome>;
}
