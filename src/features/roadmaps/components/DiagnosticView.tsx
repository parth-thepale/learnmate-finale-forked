import React, { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronRight, HelpCircle, Sparkles, XCircle } from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';
import { evaluateDiagnostic } from '../engine/diagnosticEngine';
import { CapsuleBadge, CapsuleButton } from '../../../components/capsule';

interface DiagnosticViewProps {
  checkpoint: Checkpoint;
  progress?: CheckpointProgress;
  onDiagnosticComplete: (
    diagnosticCleared: boolean,
    scorePct: number,
    weakTopics: string[]
  ) => void;
  onClose: () => void;
}

export const DiagnosticView: React.FC<DiagnosticViewProps> = ({
  checkpoint,
  progress,
  onDiagnosticComplete,
  onClose,
}) => {
  const questions = checkpoint.diagnosticQuestions;
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof evaluateDiagnostic> | null>(null);

  // If already cleared previously
  const isAlreadyCleared = progress?.diagnosticCleared;

  const handleSelectOption = (qIndex: number, optIndex: number) => {
    if (submitted) return;
    setSelectedAnswers((prev) => ({ ...prev, [qIndex]: optIndex }));
  };

  const handleSubmit = () => {
    if (questions.length === 0) return;

    let correctCount = 0;
    const questionTopicMap = questions.map((q, idx) => {
      const selected = selectedAnswers[idx];
      const isCorrect = selected === q.correctIndex;
      if (isCorrect) correctCount += 1;
      return {
        topicId: q.topicId,
        topicName: q.topicLabel || q.topicId.split('.').pop()?.replace(/-/g, ' ') || q.topicId,
        isCorrect,
      };
    });

    const evaluated = evaluateDiagnostic({
      totalQuestions: questions.length,
      correctCount,
      questionTopicMap,
      timeTakenSeconds: 120, // Estimated
    });

    setResult(evaluated);
    setSubmitted(true);
    onDiagnosticComplete(evaluated.canSkipIntroRevision, evaluated.score.percentage, evaluated.weakTopics);
  };

  if (questions.length === 0) {
    return (
      <div className="paper-card p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] flex items-center justify-center">
          <HelpCircle className="w-6 h-6 text-[var(--text-ink-secondary)]" />
        </div>
        <h3 className="paper-title text-lg text-[var(--text-ink)]">Diagnostic Pending Verification</h3>
        <p className="text-xs text-[var(--text-ink-secondary)] max-w-md mx-auto">
          The verified diagnostic question set for this milestone is currently undergoing faculty review.
          You may proceed directly to Smart Revision.
        </p>
        <CapsuleButton variant="accent" onClick={onClose}>
          Proceed to Revision
        </CapsuleButton>
      </div>
    );
  }

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
              Stage A — Diagnostic Assessment
            </span>
            {isAlreadyCleared && (
              <CapsuleBadge label="Previously Cleared (Skip Allowed)" variant="success" size="sm" />
            )}
          </div>
          <h2 className="paper-title text-xl text-[var(--text-ink)]">
            {checkpoint.title}: Prior Knowledge Check
          </h2>
          <p className="text-xs text-[var(--text-ink-secondary)] mt-0.5">
            Answer {questions.length} baseline questions to evaluate what you already know. Scoring $\ge 80\%$ lets you skip introductory theory!
          </p>
        </div>
      </div>

      {/* Result Banner if Submitted */}
      {submitted && result && (
        <div
          className={`p-4 rounded-xl border ${
            result.canSkipIntroRevision
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
              : 'bg-[var(--bg-surface-warm)] border-[var(--border-paper)] text-[var(--text-ink)]'
          }`}
        >
          <div className="flex items-start gap-3">
            {result.canSkipIntroRevision ? (
              <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-[var(--accent-terracotta)] shrink-0 mt-0.5" />
            )}
            <div className="space-y-1">
              <h4 className="font-semibold text-sm">
                Score: {result.score.percentage}% ({result.score.correct}/{result.score.total} Correct)
              </h4>
              <p className="text-xs leading-relaxed">{result.message}</p>
              {result.weakTopics.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-medium text-[var(--text-ink-muted)]">Focus areas:</span>
                  {result.weakTopics.map((topic, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900/40"
                    >
                      {topic}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Questions List */}
      <div className="space-y-6">
        {questions.map((q, qIndex) => {
          const selected = selectedAnswers[qIndex];
          const isCorrect = selected === q.correctIndex;

          return (
            <div
              key={q.id}
              className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-3"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="text-xs font-mono font-bold text-[var(--text-ink-muted)]">
                  Q{qIndex + 1}.
                </span>
                <p className="text-sm font-medium text-[var(--text-ink)] flex-1 leading-relaxed">
                  {q.prompt}
                </p>
              </div>

              {/* Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {q.options.map((opt, optIndex) => {
                  let optStyle =
                    'border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-warm)] text-[var(--text-ink)]';

                  if (selected === optIndex) {
                    optStyle =
                      'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold';
                  }

                  if (submitted) {
                    if (optIndex === q.correctIndex) {
                      optStyle =
                        'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold';
                    } else if (selected === optIndex && !isCorrect) {
                      optStyle =
                        'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300';
                    }
                  }

                  return (
                    <button
                      key={optIndex}
                      type="button"
                      disabled={submitted}
                      onClick={() => handleSelectOption(qIndex, optIndex)}
                      className={`text-left p-3 rounded-lg border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${optStyle}`}
                    >
                      <span>{opt}</span>
                      {submitted && optIndex === q.correctIndex && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      )}
                      {submitted && selected === optIndex && !isCorrect && (
                        <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Explanation after submission */}
              {submitted && (
                <div className="mt-2.5 p-3 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-xs text-[var(--text-ink-secondary)]">
                  <span className="font-semibold text-[var(--text-ink)]">Explanation: </span>
                  {q.explanation}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer Submit / Proceed */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
          Close
        </CapsuleButton>

        {!submitted ? (
          <CapsuleButton
            variant="accent"
            size="md"
            disabled={Object.keys(selectedAnswers).length < questions.length}
            onClick={handleSubmit}
          >
            Submit Diagnostic ({Object.keys(selectedAnswers).length}/{questions.length})
          </CapsuleButton>
        ) : (
          <CapsuleButton
            variant="accent"
            size="md"
            rightIcon={<ChevronRight className="w-4 h-4" />}
            onClick={onClose}
          >
            {result?.canSkipIntroRevision ? 'Proceed to Practice' : 'Proceed to Smart Revision'}
          </CapsuleButton>
        )}
      </div>
    </div>
  );
};
