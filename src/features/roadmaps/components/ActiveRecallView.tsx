import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, HelpCircle, RotateCcw, XCircle } from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';
import { CapsuleBadge, CapsuleButton } from '../../../components/capsule';

interface ActiveRecallViewProps {
  checkpoint: Checkpoint;
  progress?: CheckpointProgress;
  onRecallComplete: (correct: number, total: number, weakTopics: string[]) => void;
  onClose: () => void;
}

export const ActiveRecallView: React.FC<ActiveRecallViewProps> = ({
  checkpoint,
  progress,
  onRecallComplete,
  onClose,
}) => {
  const prompts = checkpoint.activeRecallPrompts;
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [scoreCount, setScoreCount] = useState(0);
  const [weakTopics, setWeakTopics] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState(false);

  if (prompts.length === 0) {
    return (
      <div className="paper-card p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] flex items-center justify-center">
          <HelpCircle className="w-6 h-6 text-[var(--accent-terracotta)]" />
        </div>
        <h3 className="paper-title text-lg text-[var(--text-ink)]">
          Active Recall Prompts in Review
        </h3>
        <p className="text-xs text-[var(--text-ink-secondary)] max-w-md mx-auto">
          Active retrieval flashcards for this milestone are being reviewed by subject experts.
          You can proceed directly to Question Practice.
        </p>
        <CapsuleButton variant="accent" onClick={onClose}>
          Proceed to Practice
        </CapsuleButton>
      </div>
    );
  }

  const currentPrompt = prompts[currentIndex];

  const handleSelectOption = (optIndex: number) => {
    if (revealed) return;
    setSelectedOption(optIndex);
    setRevealed(true);

    const isCorrect = optIndex === currentPrompt.correctIndex;
    if (isCorrect) {
      setScoreCount((prev) => prev + 1);
    } else {
      const topic = currentPrompt.topicLabel || currentPrompt.topicId;
      setWeakTopics((prev) => (prev.includes(topic) ? prev : [...prev, topic]));
    }
  };

  const handleNext = () => {
    if (currentIndex + 1 < prompts.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
      setRevealed(false);
    } else {
      setIsFinished(true);
      onRecallComplete(scoreCount, prompts.length, weakTopics);
    }
  };

  if (isFinished) {
    const pct = Math.round((scoreCount / prompts.length) * 100);
    return (
      <div className="paper-card p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 flex items-center justify-center">
          <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="paper-title text-xl text-[var(--text-ink)]">
          Active Recall Complete: {pct}%
        </h3>
        <p className="text-xs text-[var(--text-ink-secondary)] max-w-md mx-auto">
          You answered {scoreCount} of {prompts.length} retrieval cards correctly. Active recall reinforces memory retention in long-term memory.
        </p>
        <CapsuleButton variant="accent" onClick={onClose}>
          Proceed to Question Practice
        </CapsuleButton>
      </div>
    );
  }

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex items-center justify-between">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
            Stage C — Active Recall Practice
          </span>
          <h2 className="paper-title text-xl text-[var(--text-ink)] mt-0.5">
            Card {currentIndex + 1} of {prompts.length}
          </h2>
        </div>
        <CapsuleBadge
          label={`Score: ${scoreCount}/${currentIndex + (revealed ? 1 : 0)}`}
          variant="subtle"
          size="sm"
        />
      </div>

      {/* Prompt Card */}
      <div className="space-y-4">
        <p className="text-base font-medium text-[var(--text-ink)] leading-relaxed">
          {currentPrompt.prompt}
        </p>

        {/* Options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {currentPrompt.options.map((opt, i) => {
            let optStyle =
              'border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-warm)] text-[var(--text-ink)]';

            if (selectedOption === i) {
              optStyle =
                'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold';
            }

            if (revealed) {
              if (i === currentPrompt.correctIndex) {
                optStyle =
                  'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-semibold';
              } else if (selectedOption === i && i !== currentPrompt.correctIndex) {
                optStyle =
                  'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300';
              }
            }

            return (
              <button
                key={i}
                type="button"
                disabled={revealed}
                onClick={() => handleSelectOption(i)}
                className={`text-left p-3.5 rounded-xl border text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${optStyle}`}
              >
                <span>{opt}</span>
                {revealed && i === currentPrompt.correctIndex && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                {revealed && selectedOption === i && i !== currentPrompt.correctIndex && (
                  <XCircle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation revealed after answer */}
        {revealed && (
          <div className="p-3.5 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-xs text-[var(--text-ink-secondary)] space-y-1">
            <span className="font-semibold text-[var(--text-ink)] block">Explanation:</span>
            <p>{currentPrompt.explanation}</p>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
          Exit
        </CapsuleButton>

        {revealed && (
          <CapsuleButton
            variant="accent"
            size="md"
            rightIcon={<ChevronRight className="w-4 h-4" />}
            onClick={handleNext}
          >
            {currentIndex + 1 === prompts.length ? 'Finish Recall' : 'Next Card'}
          </CapsuleButton>
        )}
      </div>
    </div>
  );
};
