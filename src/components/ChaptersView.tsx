import React, { useState } from 'react';
import {
  BookOpen,
  ChevronRight,
  ChevronDown,
  Sparkles,
  Play,
  Award,
  CheckCircle2,
  Clock,
  Layers,
  Search,
} from 'lucide-react';
import { JEE_MAIN_SYLLABUS, type JeeSubjectId, type SyllabusChapter } from '../data/jeeMainSyllabus';
import { studyStorage } from '../services/storageService';
import type { ActiveTab } from './Navbar';

interface ChaptersViewProps {
  onStartSessionForChapter: (subjectId: JeeSubjectId, chapter: SyllabusChapter) => void;
  onNavigateTab: (tab: ActiveTab) => void;
}

export const ChaptersView: React.FC<ChaptersViewProps> = ({
  onStartSessionForChapter,
  onNavigateTab,
}) => {
  const [selectedSubject, setSelectedSubject] = useState<JeeSubjectId>('physics');
  const [expandedChapterId, setExpandedChapterId] = useState<string | null>('physics_unit_01');
  const [filterQuery, setFilterQuery] = useState('');

  const currentSubject = JEE_MAIN_SYLLABUS.find((s) => s.id === selectedSubject)!;

  const filteredChapters = currentSubject.chapters.filter((c) =>
    c.name.toLowerCase().includes(filterQuery.toLowerCase()) ||
    c.topics.some((t) => t.name.toLowerCase().includes(filterQuery.toLowerCase()))
  );

  return (
    <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-8 space-y-6">
      
      {/* Header with Founder Blueprint Guidance (Page 3) */}
      <div className="border-b border-[var(--border-paper)] pb-5">
        <div className="paper-kicker mb-1">NTA Official Curriculum</div>
        <h1 className="paper-title text-3xl text-[var(--text-ink)]">
          Chapters & JEE 2026 Syllabus Explorer
        </h1>
        <p className="text-sm text-[var(--text-ink-secondary)] mt-1 font-serif-editorial">
          Complete subject units with dynamic edge learning recommendations and topic-level breakdown.
        </p>
      </div>

      {/* Subject Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {(['physics', 'chemistry', 'mathematics'] as JeeSubjectId[]).map((subj) => (
            <button
              key={subj}
              type="button"
              onClick={() => {
                setSelectedSubject(subj);
                const first = JEE_MAIN_SYLLABUS.find((s) => s.id === subj)?.chapters[0];
                if (first) setExpandedChapterId(first.id);
              }}
              className={`px-4 py-2 rounded-lg text-xs font-semibold capitalize border transition-all cursor-pointer ${
                selectedSubject === subj
                  ? 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] shadow-xs'
                  : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
              }`}
            >
              {subj} ({JEE_MAIN_SYLLABUS.find((s) => s.id === subj)?.chapters.length} Units)
            </button>
          ))}
        </div>

        <div className="w-full sm:w-64 relative">
          <Search className="w-3.5 h-3.5 text-[var(--text-ink-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter units and topics..."
            className="w-full pl-8 pr-3 py-1.5 text-xs paper-input"
          />
        </div>
      </div>

      {/* Chapters Accordion List */}
      <div className="space-y-3">
        {filteredChapters.map((chapter) => {
          const isExpanded = expandedChapterId === chapter.id;
          return (
            <div
              key={chapter.id}
              className="paper-card overflow-hidden transition-all"
            >
              <div
                onClick={() => setExpandedChapterId(isExpanded ? null : chapter.id)}
                className="p-4 flex items-center justify-between cursor-pointer hover:bg-[var(--bg-subtle)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] flex items-center justify-center font-mono text-xs font-bold text-[var(--accent-terracotta)]">
                    {chapter.unitNumber}
                  </span>
                  <div>
                    <div className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                      {chapter.name}
                    </div>
                    <div className="text-xs text-[var(--text-ink-muted)] mt-0.5">
                      {chapter.topics.length} Syllabus Topics {chapter.section ? `• ${chapter.section} chemistry` : ''}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartSessionForChapter(selectedSubject, chapter);
                    }}
                    className="px-3 py-1 rounded paper-btn-accent text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>Launch Session</span>
                  </button>
                  <ChevronDown
                    className={`w-4 h-4 text-[var(--text-ink-muted)] transition-transform duration-200 ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </div>
              </div>

              {isExpanded && (
                <div className="p-4 bg-[var(--bg-surface-warm)] border-t border-[var(--border-paper)] space-y-3">
                  <div className="text-xs font-semibold text-[var(--text-ink)] uppercase tracking-wider">
                    Core Topics Breakdown:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {chapter.topics.map((topic) => (
                      <div
                        key={topic.id}
                        className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-xs text-[var(--text-ink-secondary)] flex items-center justify-between"
                      >
                        <span className="truncate pr-2">{topic.name}</span>
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
