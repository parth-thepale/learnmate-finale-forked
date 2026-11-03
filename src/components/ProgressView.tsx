import React, { useState } from 'react';
import {
  BarChart2,
  TrendingUp,
  Award,
  AlertCircle,
  Clock,
  ArrowRight,
  CheckCircle2,
  BookOpen,
  RotateCcw,
  Download,
  Printer,
  Timer,
} from 'lucide-react';
import type { StudyDocument, QuizAttempt, RevisionTask } from '../types/study';
import {
  computeTopicProgress,
  computeOverallProgressSummary,
  generateStudyProgressReportText,
} from '../utils/quizGrading';
import { assessTopics } from '../utils/weakTopics';
import { studyStorage } from '../services/storageService';

interface ProgressViewProps {
  documents: StudyDocument[];
  attempts: QuizAttempt[];
  onStartQuizForDocument: (doc: StudyDocument, mode: 'quiz' | 'adaptive') => void;
  onResetProgress: () => void;
}

export const ProgressView: React.FC<ProgressViewProps> = ({
  documents,
  attempts,
  onStartQuizForDocument,
  onResetProgress,
}) => {
  const [selectedDocFilter, setSelectedDocFilter] = useState<string>('all');

  const filteredAttempts =
    selectedDocFilter === 'all'
      ? attempts
      : attempts.filter((a) => a.documentId === selectedDocFilter);

  const allFocusSessions = studyStorage.getFocusSessions();
  const filteredFocusSessions =
    selectedDocFilter === 'all'
      ? allFocusSessions
      : allFocusSessions.filter((s) => s.documentId === selectedDocFilter);

  const totalFocusMinutes = filteredFocusSessions.reduce(
    (sum, s) => sum + (s.durationMinutes || 0),
    0
  );

  const summary = computeOverallProgressSummary(filteredAttempts);
  const topicComparisons = computeTopicProgress(filteredAttempts);
  // Mastery and weakness are only claimed with enough evidence across attempts.
  const topicEvidence = assessTopics(filteredAttempts);
  const evidenceByLabel = new Map(topicEvidence.map((e) => [e.label.trim().toLowerCase(), e]));
  const strongTopicCount = topicEvidence.filter((e) => e.status === 'strong').length;
  const weakTopicCount = topicEvidence.filter((e) => e.status === 'weak').length;
  const insufficientTopicCount = topicEvidence.filter((e) => e.status === 'insufficient_evidence').length;

  const handleDownloadReport = () => {
    const targetDocs =
      selectedDocFilter === 'all'
        ? documents
        : documents.filter((d) => d.id === selectedDocFilter);

    const revisionTasks: RevisionTask[] = [];
    for (const doc of targetDocs) {
      revisionTasks.push(...studyStorage.getRevisionPlan(doc.id));
    }

    const filterLabel =
      selectedDocFilter === 'all'
        ? 'All Study Materials'
        : targetDocs[0]?.title || 'Selected Study Material';

    const reportContent = generateStudyProgressReportText({
      attempts: filteredAttempts,
      revisionTasks,
      focusSessions: filteredFocusSessions,
      filterLabel,
    });

    const blob = new Blob([reportContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeSlug = filterLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    link.download = `LearnMate_Progress_Report_${safeSlug}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-[1160px] mx-auto px-4 sm:px-8 py-8 space-y-8">
      {/* Header & Material Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Learning Progress
          </h1>
          <p className="text-base text-slate-500 mt-1">
            Real quiz attempts, adaptive practice scores, focus timer sessions, and topic-level improvement.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 lm-no-print">
          <label htmlFor="progress-doc-filter" className="text-sm font-medium text-slate-600">
            Material:
          </label>
          <select
            id="progress-doc-filter"
            value={selectedDocFilter}
            onChange={(e) => setSelectedDocFilter(e.target.value)}
            className="px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-[14px] font-medium text-slate-800 focus:outline-none focus:border-[#4285F4]"
          >
            <option value="all">All Study Materials ({attempts.length} attempts)</option>
            {documents.map((doc) => (
              <option key={doc.id} value={doc.id}>
                {doc.title}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[14px] font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>Print / Save PDF</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadReport}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] text-white text-[14px] font-semibold shadow-2xs transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4285F4]"
          >
            <Download className="w-4 h-4" />
            <span>Download Report</span>
          </button>

          {(attempts.length > 0 || allFocusSessions.length > 0) && (
            <button
              type="button"
              onClick={onResetProgress}
              title="Clear saved quiz history"
              className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-slate-200 text-[14px] font-medium text-slate-500 hover:text-red-600 hover:border-red-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Real Focus Timer Sessions Strip when available */}
      {filteredFocusSessions.length > 0 && (
        <div className="p-4 rounded-2xl bg-[#F3F7FE] border border-blue-100 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#DCE8FD] text-[#4285F4] flex items-center justify-center shrink-0">
              <Timer className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#172033]">
                {filteredFocusSessions.length} Completed Focus{' '}
                {filteredFocusSessions.length === 1 ? 'Session' : 'Sessions'} ({totalFocusMinutes}{' '}
                mins)
              </p>
              <p className="text-xs text-[#64748B]">
                Recorded from real Study Timer focus sessions
              </p>
            </div>
          </div>
          <span className="text-xs font-semibold text-[#1A73E8] bg-white px-3 py-1 rounded-full border border-blue-200/80">
            Latest: {new Date(filteredFocusSessions[0].completedAt).toLocaleDateString()}
          </span>
        </div>
      )}

      {/* Honest Empty State when no quizzes have been submitted yet */}
      {filteredAttempts.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-10 sm:p-14 text-center max-w-xl mx-auto space-y-5 shadow-xs">
          <div className="w-16 h-16 rounded-2xl bg-[#F2FBF6] text-[#34A853] flex items-center justify-center mx-auto">
            <BarChart2 className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-slate-900">
              No Quiz Attempts Recorded Yet
            </h2>
            <p className="text-base text-slate-500 leading-relaxed">
              LearnMate never fabricates statistics. Complete a Diagnostic Quiz or Adaptive Practice session on your study material to track real scores and topic-level improvement over time.
            </p>
          </div>
          {documents[0] && (
            <div className="pt-2">
              <button
                type="button"
                onClick={() => onStartQuizForDocument(documents[0], 'quiz')}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-[#1A73E8] hover:bg-[#1557B0] text-white text-[15px] font-semibold shadow-sm transition-colors cursor-pointer"
              >
                <BookOpen className="w-4 h-4" />
                <span>Take Diagnostic Quiz on {documents[0].title}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 4 Summary Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-5 rounded-2xl bg-[#F3F7FE] border border-blue-100 space-y-1">
              <span className="text-xs font-semibold text-slate-500">Total Completed Quizzes</span>
              <p className="text-3xl font-extrabold text-slate-900 tabular-nums">
                {summary.totalAttempts}
              </p>
              <p className="text-xs text-slate-600 tabular-nums">
                {summary.diagnosticCount} diagnostic · {summary.adaptiveCount} adaptive
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#F2FBF6] border border-emerald-100 space-y-1">
              <span className="text-xs font-semibold text-slate-500">Average Accuracy</span>
              <p className="text-3xl font-extrabold text-[#16A34A] tabular-nums">
                {summary.averageScorePct}%
              </p>
              <p className="text-xs text-slate-600 tabular-nums">
                Latest score: {summary.latestAttemptPct}%
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#FEF9EE] border border-amber-100 space-y-1">
              <span className="text-xs font-semibold text-slate-500">First → Latest Improvement</span>
              <p className="text-3xl font-extrabold text-slate-900 tabular-nums flex items-center gap-1.5">
                <span>
                  {summary.overallDeltaPct !== null && summary.overallDeltaPct >= 0
                    ? `+${summary.overallDeltaPct}%`
                    : `${summary.overallDeltaPct ?? 0}%`}
                </span>
                <TrendingUp className="w-5 h-5 text-[#16A34A]" />
              </p>
              <p className="text-xs text-slate-600 tabular-nums">
                {summary.firstAttemptPct}% initial → {summary.latestAttemptPct}% latest
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-[#FDF4F4] border border-red-100 space-y-1">
              <span className="text-xs font-semibold text-slate-500">Topic Mastery Status</span>
              <p className="text-3xl font-extrabold text-slate-900 tabular-nums">
                {strongTopicCount} Strong
              </p>
              <p className="text-xs text-slate-600 tabular-nums">
                {weakTopicCount} topic(s) need focused review
                {insufficientTopicCount > 0 ? ` · ${insufficientTopicCount} need more practice data` : ''}
              </p>
            </div>
          </div>

          {/* Topic-Level Improvement Breakdown */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-5 shadow-xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Topic-Level Mastery & Improvement
                </h2>
                <p className="text-xs text-slate-500">
                  Comparing your first attempt on each topic against your most recent attempt.
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              {topicComparisons.map((item) => (
                <div
                  key={item.topic}
                  className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-slate-900">{item.topic}</span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        · {item.totalCorrect}/{item.totalQuestions} correct across {item.attemptsCount}{' '}
                        {item.attemptsCount === 1 ? 'attempt' : 'attempts'}
                      </span>
                      {evidenceByLabel.get(item.topic.trim().toLowerCase())?.status === 'strong' && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Strong
                        </span>
                      )}
                      {evidenceByLabel.get(item.topic.trim().toLowerCase())?.status === 'insufficient_evidence' && (
                        <span className="text-xs font-medium text-slate-500">Not enough data yet</span>
                      )}
                      {item.status === 'improved' && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#1A73E8]">
                          <Award className="w-3.5 h-3.5" /> Improved (+{item.deltaPct}%)
                        </span>
                      )}
                      {evidenceByLabel.get(item.topic.trim().toLowerCase())?.status === 'weak' && (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-red-600">
                          <AlertCircle className="w-3.5 h-3.5" /> Needs Practice
                        </span>
                      )}
                    </div>

                    {/* Visual Progress Bar */}
                    <div className="w-full max-w-md h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          item.latestScorePct >= 80
                            ? 'bg-[#16A34A]'
                            : item.latestScorePct >= 50
                            ? 'bg-[#FBBC05]'
                            : 'bg-[#EA4335]'
                        }`}
                        style={{ width: `${Math.max(6, item.latestScorePct)}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-right tabular-nums">
                      <p className="text-xs text-slate-500">First → Latest</p>
                      <p className="text-sm font-bold text-slate-900">
                        {item.firstScorePct}% → {item.latestScorePct}%
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Attempt History Log */}
          <div className="bg-white rounded-2xl border border-slate-200/90 p-6 space-y-4 shadow-xs">
            <h2 className="text-lg font-bold text-slate-900">Attempt History</h2>
            <div className="divide-y divide-slate-100">
              {filteredAttempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        {attempt.documentTitle}
                      </span>
                      <span className="text-xs font-semibold text-[#1A73E8]">
                        · {attempt.mode === 'adaptive' ? 'Adaptive Practice' : 'Diagnostic Quiz'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      <span>{new Date(attempt.completedAt).toLocaleString()}</span>
                      {attempt.weakTopics.length > 0 && (
                        <span>· Missed in this attempt: {attempt.weakTopics.join(', ')}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 tabular-nums">
                    <span
                      className={`text-sm font-extrabold ${
                        attempt.percentage >= 80
                          ? 'text-emerald-700'
                          : attempt.percentage >= 50
                          ? 'text-amber-700'
                          : 'text-red-600'
                      }`}
                    >
                      {attempt.score}/{attempt.totalQuestions} ({attempt.percentage}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
