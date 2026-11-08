import React, { useState } from 'react';
import {
  HelpCircle,
  Lightbulb,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ShieldCheck,
  AlertCircle,
  Layers,
} from 'lucide-react';
import type { Checkpoint, PracticeQuestion, PracticeTier } from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';
import { CapsuleBadge, CapsuleButton, CapsuleSegmentedControl } from '../../../components/capsule';
import { PHY01_DRAFT_PRACTICE_QUESTIONS } from '../data/draftContent/phy01DraftContent';

interface PracticeViewProps {
  checkpoint: Checkpoint;
  progress?: CheckpointProgress;
  onPracticeRecorded: (attempted: number, correct: number, tier: PracticeTier) => void;
  onClose: () => void;
}

export const PracticeView: React.FC<PracticeViewProps> = ({
  checkpoint,
  progress,
  onPracticeRecorded,
  onClose,
}) => {
  const [selectedTier, setSelectedTier] = useState<PracticeTier>('foundation');
  const [revealedHints, setRevealedHints] = useState<Record<string, boolean>>({});
  const [submittedAnswers, setSubmittedAnswers] = useState<Record<string, number | string>>({});
  const [revealedSolutions, setRevealedSolutions] = useState<Record<string, boolean>>({});

  const allQuestions = checkpoint.practiceQuestions || [];
  const verifiedQuestions = allQuestions.filter((q) => q.isVerified);
  const draftForCheckpoint = PHY01_DRAFT_PRACTICE_QUESTIONS.filter(
    (q) => checkpoint.officialChapterIds.includes(q.chapterId) && q.tier === selectedTier
  );

  const displayQuestions = verifiedQuestions.filter((q) => q.tier === selectedTier);
  const activeQuestions = displayQuestions.length > 0 ? displayQuestions : draftForCheckpoint;
  const isViewingDrafts = displayQuestions.length === 0 && draftForCheckpoint.length > 0;

  const handleToggleHint = (qId: string) => {
    setRevealedHints((prev) => ({ ...prev, [qId]: !prev[qId] }));
  };

  const handleRevealSolution = (qId: string) => {
    setRevealedSolutions((prev) => ({ ...prev, [qId]: true }));
  };

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
            Stage D — Progressive Question Practice
          </span>
          <h2 className="paper-title text-xl text-[var(--text-ink)] mt-0.5">
            {checkpoint.title}: Problem Solving
          </h2>
          <p className="text-xs text-[var(--text-ink-secondary)] mt-0.5">
            Convert concept understanding into JEE problem-solving capability across 3 progressive tiers.
          </p>
        </div>

        {/* Tier Selector */}
        <div className="flex items-center gap-1.5 p-1 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)]">
          {(['foundation', 'application', 'jee_main'] as PracticeTier[]).map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => setSelectedTier(tier)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                selectedTier === tier
                  ? 'bg-[var(--bg-surface)] text-[var(--accent-terracotta)] font-semibold shadow-xs border border-[var(--border-paper)]'
                  : 'text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
              }`}
            >
              {tier === 'foundation' ? '1. Foundation' : tier === 'application' ? '2. Application' : '3. JEE Main'}
            </button>
          ))}
        </div>
      </div>

      {/* Honest Content Pending Banner if No Questions Available */}
      {activeQuestions.length === 0 && (
        <div className="p-6 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-200">
                Verified Question Bank Pending for {selectedTier.toUpperCase()}
              </h4>
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                In strict adherence to Learnmate’s authenticity policy, questions are never fabricated or served unreviewed.
                Questions for <strong>{checkpoint.title}</strong> ({checkpoint.officialChapterIds.join(', ')}) are currently in the human-verification pipeline.
              </p>
              <div className="pt-2 text-[11px] text-amber-700 dark:text-amber-400/90 flex flex-wrap items-center gap-2">
                <span className="font-semibold">Required:</span>
                <span>5–8 verified {selectedTier} items mapped to NTA Unit(s) {checkpoint.officialUnitNumbers.join(', ')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Draft Content Pipeline Notification for Pilot */}
      {isViewingDrafts && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/40 dark:bg-blue-950/20 flex items-start gap-3 text-xs">
          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-blue-900 dark:text-blue-200">
              Pilot Roadmap Draft Pipeline (Pending Expert Review)
            </span>
            <p className="text-blue-800 dark:text-blue-300/90 leading-relaxed text-[11px]">
              You are practicing with original curriculum drafts for <strong>{checkpoint.title}</strong>.
              These items are staged for review and have not yet been signed off into the verified question bank.
            </p>
          </div>
        </div>
      )}

      {/* If questions exist (verified or draft pilot) */}
      {activeQuestions.length > 0 && (
        <div className="space-y-6">
          {activeQuestions.map((q, qIndex) => {
            const hasRevealedHint = revealedHints[q.id];
            const hasRevealedSol = revealedSolutions[q.id];
            const isDraft = !('isVerified' in q) || !q.isVerified;

            return (
              <div
                key={q.id}
                className="p-5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] space-y-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold text-[var(--accent-terracotta)]">
                      #{qIndex + 1}
                    </span>
                    <CapsuleBadge
                      label={q.tier.toUpperCase()}
                      variant="subtle"
                      size="sm"
                    />
                    {isDraft ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                        Draft: Pending Review
                      </span>
                    ) : (
                      <span className="text-[11px] text-[var(--text-ink-muted)]">
                        {typeof q.provenance === 'string' ? q.provenance : (q.provenance as { sourceType: string }).sourceType}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleToggleHint(q.id)}
                    className="inline-flex items-center gap-1 text-xs text-[var(--text-ink-muted)] hover:text-[var(--accent-terracotta)] transition-colors cursor-pointer"
                  >
                    <Lightbulb className="w-3.5 h-3.5" />
                    <span>{hasRevealedHint ? 'Hide Hint' : 'Hint'}</span>
                  </button>
                </div>

                <p className="text-sm font-medium text-[var(--text-ink)] leading-relaxed">
                  {q.stem}
                </p>

                {/* Hint reveal */}
                {hasRevealedHint && (
                  <div className="p-3 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-xs text-[var(--text-ink-secondary)]">
                    <span className="font-semibold text-[var(--text-ink)]">Hint: </span>
                    {q.hint}
                  </div>
                )}

                {/* Options if MCQ */}
                {q.type === 'mcq' && q.options && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {q.options.map((opt, optIndex) => (
                      <button
                        key={optIndex}
                        type="button"
                        onClick={() => handleRevealSolution(q.id)}
                        className="text-left p-3 rounded-lg border border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] text-xs transition-all cursor-pointer"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}

                {/* Solution Reveal */}
                {hasRevealedSol && (
                  <div className="p-3.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                    <span className="font-semibold block">Step-by-Step Solution:</span>
                    <p className="leading-relaxed">{q.explanation}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
          Back to Checkpoint
        </CapsuleButton>

        <CapsuleButton
          variant="accent"
          size="md"
          rightIcon={<ChevronRight className="w-4 h-4" />}
          onClick={onClose}
        >
          Proceed to Assessment
        </CapsuleButton>
      </div>
    </div>
  );
};
