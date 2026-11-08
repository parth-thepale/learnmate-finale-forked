import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Lightbulb,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import type { Checkpoint } from '../types/checkpoint.types';
import type { CheckpointProgress } from '../types/progress.types';
import { CapsuleBadge, CapsuleButton } from '../../../components/capsule';

interface RevisionViewProps {
  checkpoint: Checkpoint;
  progress?: CheckpointProgress;
  onRevisionComplete: () => void;
  onClose: () => void;
}

export const RevisionView: React.FC<RevisionViewProps> = ({
  checkpoint,
  progress,
  onRevisionComplete,
  onClose,
}) => {
  const concepts = checkpoint.concepts;
  const [activeConceptIndex, setActiveConceptIndex] = useState(0);

  if (concepts.length === 0) {
    return (
      <div className="paper-card p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] flex items-center justify-center">
          <BookOpen className="w-6 h-6 text-[var(--accent-terracotta)]" />
        </div>
        <h3 className="paper-title text-lg text-[var(--text-ink)]">
          Curated Revision Notes Under Review
        </h3>
        <p className="text-xs text-[var(--text-ink-secondary)] max-w-md mx-auto">
          Detailed formula sheets and pitfall analyses for this milestone are being finalized by JEE educators.
          You can test your active recall or attempt practice problems.
        </p>
        <CapsuleButton variant="accent" onClick={onClose}>
          Proceed to Active Recall
        </CapsuleButton>
      </div>
    );
  }

  const currentConcept = concepts[activeConceptIndex] || concepts[0];

  return (
    <div className="paper-card p-6 space-y-6">
      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="text-[11px] font-mono uppercase tracking-wider text-[var(--accent-terracotta)] font-semibold">
            Stage B — Smart Revision
          </span>
          <h2 className="paper-title text-xl text-[var(--text-ink)] mt-0.5">
            {checkpoint.title}: Concept Mastery Notes
          </h2>
          <p className="text-xs text-[var(--text-ink-secondary)] mt-0.5">
            Concise, NCERT-grounded principles, high-yield formulas, and common exam traps.
          </p>
        </div>

        {progress?.revisionCompleted && (
          <CapsuleBadge label="Revision Completed" variant="success" size="sm" />
        )}
      </div>

      {/* Concept Selector Tabs if multiple concepts */}
      {concepts.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-paper)] pb-3">
          {concepts.map((concept, idx) => (
            <button
              key={concept.id}
              type="button"
              onClick={() => setActiveConceptIndex(idx)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                activeConceptIndex === idx
                  ? 'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold shadow-xs'
                  : 'border-[var(--border-paper)] bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
              }`}
            >
              {idx + 1}. {concept.title}
            </button>
          ))}
        </div>
      )}

      {/* Current Concept Details */}
      <div className="space-y-5">
        <div>
          <h3 className="paper-title text-lg text-[var(--text-ink)]">
            {currentConcept.title}
          </h3>
          <p className="text-xs text-[var(--text-ink-secondary)] mt-1.5 leading-relaxed">
            {currentConcept.summary}
          </p>
        </div>

        {/* Formulas Grid */}
        {currentConcept.keyFormulas && currentConcept.keyFormulas.length > 0 && (
          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-ink-muted)] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
              Essential JEE Formulas
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {currentConcept.keyFormulas.map((formula, i) => (
                <div
                  key={i}
                  className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] space-y-1.5"
                >
                  <span className="text-xs font-semibold text-[var(--text-ink)] block">
                    {formula.label}
                  </span>
                  <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] font-mono text-xs text-[var(--accent-terracotta)] overflow-x-auto">
                    {formula.formula}
                  </div>
                  {formula.description && (
                    <p className="text-[11px] text-[var(--text-ink-muted)]">
                      {formula.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Common Pitfalls & Traps */}
        {currentConcept.commonPitfalls && currentConcept.commonPitfalls.length > 0 && (
          <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/40 bg-amber-50/50 dark:bg-amber-950/20 space-y-2">
            <h4 className="text-xs font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              Common Exam Traps & Misconceptions
            </h4>
            <ul className="list-disc list-inside space-y-1 text-xs text-amber-800 dark:text-amber-300/90 leading-relaxed">
              {currentConcept.commonPitfalls.map((pitfall, i) => (
                <li key={i}>{pitfall}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Important Exceptions */}
        {currentConcept.importantExceptions && currentConcept.importantExceptions.length > 0 && (
          <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/40 bg-blue-50/50 dark:bg-blue-950/20 space-y-2">
            <h4 className="text-xs font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
              <Lightbulb className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              Critical NCERT Exceptions
            </h4>
            <ul className="list-disc list-inside space-y-1 text-xs text-blue-800 dark:text-blue-300/90 leading-relaxed">
              {currentConcept.importantExceptions.map((exc, i) => (
                <li key={i}>{exc}</li>
              ))}
            </ul>
          </div>
        )}

        {/* PYQ Trends */}
        {currentConcept.pyqTrends && (
          <div className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface)] flex items-start gap-3">
            <TrendingUp className="w-4 h-4 text-[var(--accent-terracotta)] shrink-0 mt-0.5" />
            <div className="text-xs leading-relaxed text-[var(--text-ink-secondary)]">
              <span className="font-semibold text-[var(--text-ink)]">JEE Main Trend: </span>
              {currentConcept.pyqTrends}
            </div>
          </div>
        )}
      </div>

      {/* Footer Controls */}
      <div className="pt-4 border-t border-[var(--border-paper)] flex items-center justify-between">
        <CapsuleButton variant="subtle" size="sm" onClick={onClose}>
          Close
        </CapsuleButton>

        <CapsuleButton
          variant="accent"
          size="md"
          rightIcon={<ArrowRight className="w-4 h-4" />}
          onClick={() => {
            onRevisionComplete();
            onClose();
          }}
        >
          Mark Revision Read & Continue
        </CapsuleButton>
      </div>
    </div>
  );
};
