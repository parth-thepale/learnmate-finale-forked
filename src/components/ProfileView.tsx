import React, { useMemo, useState } from 'react';
import {
  User as UserIcon,
  Mail,
  Award,
  Zap,
  Calendar,
  BarChart2,
  TrendingUp,
  AlertCircle,
  Clock,
  Sparkles,
  CheckCircle2,
  XCircle,
  BookOpen,
  ArrowRight,
  Target,
  FileText,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { StudentAcademicProfile, QuizAttempt } from '../types/study';
import { studyStorage } from '../services/storageService';
import { assessTopics } from '../utils/weakTopics';
import { AiUsageDashboard } from './AiUsageDashboard';

interface ProfileViewProps {
  user?: User | null;
  studentProfile?: StudentAcademicProfile;
  onOpenProfileModal?: () => void;
  initialTab?: 'identity' | 'analysis';
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  user,
  studentProfile,
  onOpenProfileModal,
  initialTab = 'identity',
}) => {
  const [activeTab, setActiveTab] = useState<'identity' | 'analysis'>(initialTab);
  const profile = studentProfile || studyStorage.getStudentProfile();
  const attempts = useMemo<QuizAttempt[]>(() => studyStorage.getQuizAttempts(), []);
  const topicEvidence = useMemo(() => assessTopics(attempts), [attempts]);

  const weakTopics = topicEvidence.filter((e) => e.status === 'weak');
  const strongTopics = topicEvidence.filter((e) => e.status === 'strong');
  const developingTopics = topicEvidence.filter((e) => e.status === 'developing');

  // Overall statistics computed from actual persisted quiz attempts
  const totalQuizzes = attempts.length;
  const totalQuestions = attempts.reduce(
    (acc, a) => acc + (a.totalQuestions || a.answers?.length || 0),
    0
  );
  const totalCorrect = attempts.reduce(
    (acc, a) =>
      acc +
      (a.answers
        ? a.answers.filter((ans) => ans.isCorrect).length
        : a.score || 0),
    0
  );
  const totalIncorrect = Math.max(0, totalQuestions - totalCorrect);
  const overallAccuracy =
    totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
  const averageScorePct =
    attempts.length > 0
      ? Math.round(
          attempts.reduce((acc, a) => acc + (a.percentage || 0), 0) /
            attempts.length
        )
      : 0;

  // Mistakes analysis: collect actual mistakes from attempts to form revision recommendations
  const mistakeAnalysis = useMemo(() => {
    const topicMistakeMap = new Map<
      string,
      { count: number; sampleQuestions: string[]; explanations: string[] }
    >();

    for (const att of attempts) {
      if (att.answers && att.answers.length > 0) {
        for (const ans of att.answers) {
          if (!ans.isCorrect && ans.topic) {
            const existing = topicMistakeMap.get(ans.topic) || {
              count: 0,
              sampleQuestions: [],
              explanations: [],
            };
            existing.count += 1;
            const matchedQ = att.questions?.find((q) => q.id === ans.questionId);
            if (matchedQ?.question && existing.sampleQuestions.length < 2) {
              existing.sampleQuestions.push(matchedQ.question);
            }
            if (matchedQ?.explanation && existing.explanations.length < 2) {
              existing.explanations.push(matchedQ.explanation);
            }
            topicMistakeMap.set(ans.topic, existing);
          }
        }
      }
    }

    return Array.from(topicMistakeMap.entries()).map(([topic, data]) => ({
      topic,
      mistakeCount: data.count,
      priority: data.count >= 2 ? ('High' as const) : ('Medium' as const),
      sampleQuestion: data.sampleQuestions[0] || 'Standard conceptual application',
      explanation:
        data.explanations[0] ||
        'Review the governing formula, sign conventions, and boundary assumptions for this topic.',
    }));
  }, [attempts]);

  // Study activity heatmap generation (last 28 days)
  const heatmapDays = useMemo(() => {
    const days: Array<{ date: string; count: number }> = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const iso = d.toISOString().slice(0, 10);
      const count = attempts.filter((a) => a.completedAt?.startsWith(iso)).length;
      days.push({ date: iso, count });
    }
    return days;
  }, [attempts]);

  const avatarInitial =
    user?.displayName?.[0]?.toUpperCase() ||
    profile?.fullName?.[0]?.toUpperCase() ||
    'S';

  return (
    <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-[var(--border-paper)] pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="paper-kicker mb-1">Student Profile & Analytics</div>
          <h1 className="paper-title text-3xl text-[var(--text-ink)]">
            Academic Identity & Performance
          </h1>
          <p className="text-sm text-[var(--text-ink-secondary)] mt-1 font-serif-editorial">
            Session-wise assessment history, diagnostic Bayesian trends, and personalized revision areas.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('identity')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer ${
              activeTab === 'identity'
                ? 'bg-[var(--accent-terracotta)] text-white shadow-xs'
                : 'text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
            }`}
          >
            Overview & Identity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('analysis')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'analysis'
                ? 'bg-[var(--accent-terracotta)] text-white shadow-xs'
                : 'text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)]'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Performance & Analysis</span>
          </button>
        </div>
      </div>

      {/* TAB 1: IDENTITY & OVERVIEW */}
      {activeTab === 'identity' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* LEFT (5 cols): Identity, Plan & Token Usage */}
          <div className="lg:col-span-5 space-y-6">
            {/* Identity Card */}
            <div className="paper-card p-6 space-y-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-[var(--accent-terracotta)] text-white flex items-center justify-center font-serif-editorial font-bold text-2xl shadow-sm">
                  {avatarInitial}
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif-editorial font-bold text-xl text-[var(--text-ink)] truncate">
                    {user?.displayName || profile?.fullName || 'JEE Aspirant'}
                  </h2>
                  <div className="text-xs text-[var(--text-ink-muted)] flex items-center gap-1.5 mt-0.5 truncate">
                    <Mail className="w-3.5 h-3.5" />
                    <span>{user?.email || 'Local Study Scope'}</span>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--border-paper)] grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[11px] text-[var(--text-ink-muted)]">Target Exam:</span>
                  <div className="font-bold text-[var(--text-ink)]">
                    {profile.targetExam ? 'JEE Main 2026' : 'JEE Main'}
                  </div>
                </div>
                <div>
                  <span className="text-[11px] text-[var(--text-ink-muted)]">Study Stage:</span>
                  <div className="font-bold text-[var(--text-ink)]">
                    {profile.schoolClass || 'Class 12'}
                  </div>
                </div>
              </div>

              {onOpenProfileModal && (
                <button
                  type="button"
                  onClick={onOpenProfileModal}
                  className="w-full py-2 rounded paper-btn-secondary text-xs font-semibold cursor-pointer"
                >
                  Edit Academic Target
                </button>
              )}
            </div>

            {/* Plan & Daily AI Quota Engine Dashboard */}
            <div className="paper-card p-6 space-y-4">
              <AiUsageDashboard />
            </div>
          </div>

          {/* RIGHT (7 cols): Heatmap & Diagnostic Weak Topics */}
          <div className="lg:col-span-7 space-y-6">
            {/* Study Activity Heatmap */}
            <div className="paper-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[var(--accent-terracotta)]" />
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Study Activity Heatmap
                  </h3>
                </div>
                <span className="text-xs text-[var(--text-ink-muted)]">Last 4 Weeks</span>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-2">
                  {heatmapDays.map((d) => {
                    const hasActivity = d.count > 0;
                    return (
                      <div
                        key={d.date}
                        className={`h-9 rounded-md border flex flex-col items-center justify-center text-[10px] transition-colors ${
                          hasActivity
                            ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] font-bold'
                            : 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] border-[var(--border-paper)]'
                        }`}
                        title={`${d.date}: ${d.count} quiz/focus session${d.count === 1 ? '' : 's'}`}
                      >
                        <span>{d.date.slice(8)}</span>
                        {hasActivity && <span className="text-[8px] opacity-80">●</span>}
                      </div>
                    );
                  })}
                </div>
                <div className="text-[11px] text-[var(--text-ink-muted)] text-right pt-1">
                  Active study sessions and verified quiz submissions.
                </div>
              </div>
            </div>

            {/* Weak-Topic Diagnostic Summary */}
            <div className="paper-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-[var(--accent-terracotta)]" />
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Diagnostic Weak-Topic Summary
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('analysis')}
                  className="text-xs font-semibold text-[var(--accent-terracotta)] hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <span>View Full Analysis</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-3">
                {weakTopics.length > 0 ? (
                  weakTopics.map((item) => (
                    <div
                      key={item.label}
                      className="p-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 flex items-center justify-between text-xs"
                    >
                      <div>
                        <div className="font-bold text-red-700 dark:text-red-300">
                          {item.label}
                        </div>
                        <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5">
                          Accuracy: {Math.round(item.accuracy * 100)}% ({item.attemptedQuestions} questions tested)
                        </div>
                      </div>
                      <span className="px-2 py-1 rounded bg-white dark:bg-red-900/50 text-[10px] font-bold text-red-700 dark:text-red-200 border border-red-200 dark:border-red-800">
                        Needs Revision
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-xs text-[var(--text-ink-secondary)] leading-relaxed">
                    <div className="font-semibold text-[var(--text-ink)] mb-1">
                      No confirmed weak topics yet
                    </div>
                    Learnmate requires at least 4 question outcomes on a specific syllabus topic before diagnosing a conceptual weakness. Take a 15-question quiz in Sessions to establish your baseline.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: DEEP PERFORMANCE & ANALYSIS */}
      {activeTab === 'analysis' && (
        <div className="space-y-8">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="paper-card p-4 space-y-1">
              <span className="text-[11px] text-[var(--text-ink-muted)] font-medium uppercase tracking-wider">
                Quizzes Completed
              </span>
              <div className="font-serif-editorial font-bold text-2xl text-[var(--text-ink)]">
                {totalQuizzes}
              </div>
              <div className="text-[10px] text-[var(--text-ink-muted)]">
                Recorded across all study sessions
              </div>
            </div>

            <div className="paper-card p-4 space-y-1">
              <span className="text-[11px] text-[var(--text-ink-muted)] font-medium uppercase tracking-wider">
                Overall Accuracy
              </span>
              <div className="font-serif-editorial font-bold text-2xl text-[var(--accent-terracotta)]">
                {overallAccuracy}%
              </div>
              <div className="text-[10px] text-[var(--text-ink-muted)]">
                {totalCorrect} correct of {totalQuestions} questions
              </div>
            </div>

            <div className="paper-card p-4 space-y-1">
              <span className="text-[11px] text-[var(--text-ink-muted)] font-medium uppercase tracking-wider">
                Average Score
              </span>
              <div className="font-serif-editorial font-bold text-2xl text-[var(--text-ink)]">
                {averageScorePct}%
              </div>
              <div className="text-[10px] text-[var(--text-ink-muted)]">
                Per completed quiz attempt
              </div>
            </div>

            <div className="paper-card p-4 space-y-1">
              <span className="text-[11px] text-[var(--text-ink-muted)] font-medium uppercase tracking-wider">
                Correct / Incorrect
              </span>
              <div className="font-serif-editorial font-bold text-2xl text-[var(--text-ink)] flex items-center gap-1.5">
                <span className="text-emerald-600">{totalCorrect}</span>
                <span className="text-xs text-[var(--text-ink-muted)]">/</span>
                <span className="text-red-500">{totalIncorrect}</span>
              </div>
              <div className="text-[10px] text-[var(--text-ink-muted)]">
                Official JEE marking metrics
              </div>
            </div>
          </div>

          {/* Accuracy Trend & Historical Progress */}
          <div className="paper-card p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[var(--accent-terracotta)]" />
                <h3 className="font-serif-editorial font-bold text-lg text-[var(--text-ink)]">
                  Historical Quiz Progress & Accuracy Trends
                </h3>
              </div>
              <span className="text-xs text-[var(--text-ink-muted)]">Chronological Attempts</span>
            </div>

            {attempts.length > 0 ? (
              <div className="space-y-4">
                <div className="flex items-end gap-2 h-36 pt-4 border-b border-[var(--border-paper)] pb-2 overflow-x-auto">
                  {attempts.slice(-12).map((att, idx) => {
                    const heightPct = Math.max(10, att.percentage || 10);
                    const isGood = (att.percentage || 0) >= 60;
                    return (
                      <div
                        key={att.id || idx}
                        className="flex-1 min-w-[36px] flex flex-col items-center gap-1 h-full justify-end group"
                      >
                        <span className="text-[9px] font-mono font-bold text-[var(--text-ink-muted)] opacity-0 group-hover:opacity-100 transition-opacity">
                          {att.percentage}%
                        </span>
                        <div
                          className={`w-full rounded-t transition-all ${
                            isGood ? 'bg-[var(--accent-terracotta)]' : 'bg-red-400'
                          }`}
                          style={{ height: `${heightPct}%` }}
                          title={`${att.documentTitle}: ${att.score}/${att.totalQuestions} (${att.percentage}%) on ${att.completedAt?.slice(0, 10)}`}
                        />
                        <span className="text-[9px] text-[var(--text-ink-muted)] font-mono">
                          #{idx + 1}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--text-ink-muted)]">
                  <span>Earliest Attempt</span>
                  <span>Latest Attempt</span>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-xs text-[var(--text-ink-muted)]">
                No historical attempts to plot yet. Complete a quiz in Sessions to see your accuracy trend.
              </div>
            )}
          </div>

          {/* Two-Column: Session-Wise Performance Table & Topic Mastery */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Session-Wise Performance Table (7 cols) */}
            <div className="lg:col-span-7 paper-card p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-[var(--accent-terracotta)]" />
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Session-Wise Performance History
                  </h3>
                </div>
                <span className="text-xs text-[var(--text-ink-muted)]">
                  {attempts.length} Total Attempt{attempts.length === 1 ? '' : 's'}
                </span>
              </div>

              {attempts.length > 0 ? (
                <div className="divide-y divide-[var(--border-paper)] overflow-x-auto">
                  {attempts.map((att, i) => (
                    <div key={att.id || i} className="py-3 flex items-center justify-between gap-4 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-[var(--text-ink)] truncate">
                          {att.documentTitle || 'JEE Study Session'}
                        </div>
                        <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5 flex items-center gap-2">
                          <span>{new Date(att.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                          <span>•</span>
                          <span className="capitalize">{att.mode || 'Adaptive'}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right">
                          <div className="font-mono font-bold text-[var(--text-ink)]">
                            {att.score} / {att.totalQuestions}
                          </div>
                          <div
                            className={`text-[10px] font-bold ${
                              (att.percentage || 0) >= 60 ? 'text-emerald-600' : 'text-red-500'
                            }`}
                          >
                            {att.percentage}%
                          </div>
                        </div>
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${
                            (att.percentage || 0) >= 60 ? 'bg-emerald-600' : 'bg-red-500'
                          }`}
                        >
                          {(att.percentage || 0) >= 60 ? '✓' : '✗'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 text-center text-xs text-[var(--text-ink-muted)]">
                  No session quizzes recorded yet.
                </div>
              )}
            </div>

            {/* Topic Strengths & Weaknesses (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Strong Topics */}
              <div className="paper-card p-6 space-y-3">
                <div className="flex items-center gap-2 border-b border-[var(--border-paper)] pb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Topic Strengths
                  </h3>
                </div>
                {strongTopics.length > 0 ? (
                  <div className="space-y-2">
                    {strongTopics.map((item) => (
                      <div
                        key={item.label}
                        className="p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 flex items-center justify-between text-xs"
                      >
                        <span className="font-bold text-emerald-800 dark:text-emerald-200">
                          {item.label}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                          {Math.round(item.accuracy * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-ink-muted)]">
                    Answer 4+ questions with high accuracy on a topic to confirm mastery.
                  </div>
                )}
              </div>

              {/* Weak Topics */}
              <div className="paper-card p-6 space-y-3">
                <div className="flex items-center gap-2 border-b border-[var(--border-paper)] pb-3">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Topic Weaknesses
                  </h3>
                </div>
                {weakTopics.length > 0 ? (
                  <div className="space-y-2">
                    {weakTopics.map((item) => (
                      <div
                        key={item.label}
                        className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/40 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-red-800 dark:text-red-200">
                            {item.label}
                          </div>
                          <div className="text-[10px] text-red-600 dark:text-red-400">
                            Accuracy: {Math.round(item.accuracy * 100)}%
                          </div>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-red-100 dark:bg-red-900/50 text-[10px] font-bold text-red-700 dark:text-red-200 border border-red-200">
                          Needs Fix
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-[var(--text-ink-muted)]">
                    No confirmed weak topics yet. Continue testing across syllabus units.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Suggested Revision Areas Based on Actual Mistakes */}
          <div className="paper-card p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent-terracotta)]" />
                <h3 className="font-serif-editorial font-bold text-lg text-[var(--text-ink)]">
                  Targeted Revision Areas (Derived from Actual Mistakes)
                </h3>
              </div>
              <span className="text-xs text-[var(--text-ink-muted)]">Actionable Insights</span>
            </div>

            {mistakeAnalysis.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {mistakeAnalysis.map((item, idx) => (
                  <div
                    key={idx}
                    className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--text-ink)] text-sm">
                        {item.topic}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                          item.priority === 'High'
                            ? 'bg-red-100 dark:bg-red-950/40 text-red-700 border border-red-300'
                            : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 border border-amber-300'
                        }`}
                      >
                        {item.priority} Priority
                      </span>
                    </div>

                    <div className="text-[11px] text-[var(--text-ink-muted)]">
                      {item.mistakeCount} incorrect answer{item.mistakeCount === 1 ? '' : 's'} recorded in past quizzes
                    </div>

                    <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-[11px] leading-relaxed">
                      <div className="font-semibold text-[var(--accent-terracotta)] mb-0.5">
                        💡 Key Revision Strategy:
                      </div>
                      {item.explanation}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-[var(--text-ink-muted)] leading-relaxed">
                No recorded conceptual mistakes yet. When you complete quizzes in Sessions, any missed questions will automatically populate this revision roadmap with concrete solution strategies.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

