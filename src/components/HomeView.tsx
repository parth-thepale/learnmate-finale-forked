import React, { useRef, useState } from 'react';
import {
  FileText,
  BookOpen,
  ClipboardCheck,
  Compass,
  ArrowRight,
  ChevronRight,
  Loader2,
  AlertCircle,
  X,
  Mic,
  Youtube,
  Upload,
  Camera,
  Layers,
  Clock,
  CheckCircle2,
  HelpCircle,
} from 'lucide-react';
import type { StudyDocument } from '../types/study';
import type { ActiveTab } from './Navbar';
import type { StudySubMode } from './StudyView';

interface HomeViewProps {
  documents: StudyDocument[];
  onUploadPdf: (file: File) => Promise<void>;
  onSubmitTextNotes: (title: string, rawText: string) => Promise<void>;
  onSubmitYouTubeUrl: (url: string) => Promise<void>;
  onSelectDocument: (
    doc: StudyDocument,
    targetMode?: StudySubMode
  ) => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onOpenVoiceTutor?: () => void;
  onOpenNotebookModal?: (tab?: 'scan' | 'voice' | 'notebook' | 'planner') => void;
  isProcessing: boolean;
  errorMessage: string | null;
  onClearError: () => void;
}

type IngestTab = 'pdf' | 'notes' | 'youtube';

function formatRelativeTime(isoDate: string, index: number): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 2) return 'Studied just now';
  if (diffMins < 60) return `Studied ${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `Studied ${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Studied yesterday';
  if (diffDays < 30) return `Studied ${diffDays}d ago`;
  return index === 0 ? 'Studied today' : `Studied ${index + 1}d ago`;
}

export const HomeView: React.FC<HomeViewProps> = ({
  documents,
  onUploadPdf,
  onSubmitTextNotes,
  onSubmitYouTubeUrl,
  onSelectDocument,
  onNavigateTab,
  onOpenVoiceTutor,
  onOpenNotebookModal,
  isProcessing,
  errorMessage,
  onClearError,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [ingestTab, setIngestTab] = useState<IngestTab>('pdf');
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);

  // Ingest form states
  const [notesTitle, setNotesTitle] = useState('');
  const [notesContent, setNotesContent] = useState('');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await onUploadPdf(file);
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await onUploadPdf(file);
    }
  };

  const handleNotesSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = notesContent.trim();
    if (!content) return;
    const title =
      notesTitle.trim() ||
      content.split('\n')[0]?.replace(/^[#*\-\s]+/, '').trim().slice(0, 48) ||
      `Study Notes (${new Date().toLocaleDateString()})`;
    await onSubmitTextNotes(title, content);
    setNotesContent('');
    setNotesTitle('');
    setPasteModalOpen(false);
  };

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = youtubeUrlInput.trim();
    if (!trimmed) return;
    await onSubmitYouTubeUrl(trimmed);
  };

  // Close modal on Escape
  React.useEffect(() => {
    if (!pasteModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPasteModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pasteModalOpen]);

  const recentDocs = showAllRecent ? documents : documents.slice(0, 4);

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#FCFBF9] text-[#121827]">
      <div className="max-w-[1240px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-10">
        {/* Masthead Header */}
        <div className="space-y-4 max-w-3xl">
          <div className="lm-kicker">ACADEMIC STUDY WORKSPACE</div>
          <h1 className="font-serif-editorial text-4xl sm:text-5xl font-bold tracking-tight text-[#121827] leading-[1.12]">
            Read deeply. Practice with purpose.
          </h1>
          <p className="text-base sm:text-lg text-[#606B7C] font-normal leading-relaxed">
            Bring your textbooks, lecture notes, or video classes into one quiet studio.
            LearnMate indexes page-accurate concepts, builds adaptive practice sets, and explains difficult derivations on demand.
          </p>

          {/* Quick Access Tools */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => onOpenNotebookModal?.('scan')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-[#F7F5F0] border border-[#E8E6E2] text-xs font-semibold text-[#121827] transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-[#C84428]" />
              <span>Scan Handwritten Notes</span>
            </button>
            <button
              type="button"
              onClick={() => onOpenNotebookModal?.('voice')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-[#F7F5F0] border border-[#E8E6E2] text-xs font-semibold text-[#121827] transition-colors cursor-pointer"
            >
              <Mic className="w-3.5 h-3.5 text-[#C84428]" />
              <span>Record Voice Lecture</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab('explore')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-white hover:bg-[#F7F5F0] border border-[#E8E6E2] text-xs font-semibold text-[#121827] transition-colors cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-[#2E7D52]" />
              <span>Research Papers &amp; Courses</span>
            </button>

            {documents.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectDocument(documents[0], 'explain')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#FBECE6] hover:bg-[#F8E0D7] text-xs font-semibold text-[#C84428] transition-colors cursor-pointer"
              >
                <span>Continue: {documents[0].title.replace(/\.pdf$/i, '')}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Master Document Ingestion Hub */}
        <section aria-labelledby="ingest-heading" className="bg-white border border-[#E8E6E2] rounded-2xl p-6 sm:p-8 shadow-xs space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E8E6E2] pb-5">
            <div>
              <h2 id="ingest-heading" className="font-serif-editorial text-2xl font-bold text-[#121827]">
                Import Study Material
              </h2>
              <p className="text-xs sm:text-sm text-[#606B7C] mt-0.5">
                Select your source material to index into your personal study space.
              </p>
            </div>

            {/* Ingestion Source Tabs */}
            <div role="tablist" aria-label="Ingestion Source" className="inline-flex p-1 rounded-xl bg-[#F7F5F0] border border-[#E8E6E2] self-start sm:self-auto">
              <button
                type="button"
                role="tab"
                aria-selected={ingestTab === 'pdf'}
                onClick={() => setIngestTab('pdf')}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  ingestTab === 'pdf'
                    ? 'bg-white text-[#121827] shadow-xs'
                    : 'text-[#606B7C] hover:text-[#121827]'
                }`}
              >
                <Upload className="w-3.5 h-3.5" />
                <span>PDF Chapter</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={ingestTab === 'notes'}
                onClick={() => setIngestTab('notes')}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  ingestTab === 'notes'
                    ? 'bg-white text-[#121827] shadow-xs'
                    : 'text-[#606B7C] hover:text-[#121827]'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Lecture Notes</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={ingestTab === 'youtube'}
                onClick={() => setIngestTab('youtube')}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  ingestTab === 'youtube'
                    ? 'bg-white text-[#121827] shadow-xs'
                    : 'text-[#606B7C] hover:text-[#121827]'
                }`}
              >
                <Youtube className="w-3.5 h-3.5 text-[#C84428]" />
                <span>YouTube Lecture</span>
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
            aria-label="Upload PDF file"
          />

          {/* Mode 1: PDF Dropzone */}
          {ingestTab === 'pdf' && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 sm:p-12 text-center space-y-3 cursor-pointer transition-colors ${
                isDragOver
                  ? 'border-[#C84428] bg-[#FBECE6]/40'
                  : 'border-[#D2CFC7] hover:border-[#C84428] bg-[#FAF8F5]/60 hover:bg-[#FAF8F5]'
              }`}
            >
              <div className="w-12 h-12 rounded-xl bg-white border border-[#E8E6E2] text-[#C84428] flex items-center justify-center mx-auto shadow-2xs">
                {isProcessing ? (
                  <Loader2 className="w-6 h-6 animate-spin text-[#C84428]" />
                ) : (
                  <Upload className="w-6 h-6" />
                )}
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-[#121827]">
                  {isProcessing ? 'Processing PDF document...' : 'Drop your PDF here, or click to browse'}
                </p>
                <p className="text-xs text-[#606B7C]">
                  Textbook chapters, lecture slides, research papers, or syllabus documents (up to 20 pages)
                </p>
              </div>
              <button
                type="button"
                disabled={isProcessing}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs font-semibold cursor-pointer"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Extracting Text &amp; Pages...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3.5 h-3.5" />
                    <span>Choose PDF File</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* Mode 2: Lecture Notes Inline Form */}
          {ingestTab === 'notes' && (
            <form onSubmit={handleNotesSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label htmlFor="home-notes-title" className="block text-xs font-semibold text-[#121827] mb-1">
                    Document Title (Optional)
                  </label>
                  <input
                    id="home-notes-title"
                    type="text"
                    value={notesTitle}
                    onChange={(e) => setNotesTitle(e.target.value)}
                    placeholder="e.g. Thermodynamics: First Law and Carnot Cycles"
                    className="w-full h-10 px-3.5 rounded-lg border border-[#E8E6E2] bg-[#FAF8F5]/40 text-xs font-medium text-[#121827] focus:outline-none focus:border-[#C84428]"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => setPasteModalOpen(true)}
                    className="w-full h-10 px-3 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#F7F5F0] text-xs font-semibold text-[#606B7C] hover:text-[#121827] transition-colors cursor-pointer"
                  >
                    Open Full-Screen Notes Editor
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="home-notes-body" className="block text-xs font-semibold text-[#121827] mb-1">
                  Lecture Content or Markdown Notes
                </label>
                <textarea
                  id="home-notes-body"
                  rows={6}
                  value={notesContent}
                  onChange={(e) => setNotesContent(e.target.value)}
                  placeholder="Paste lecture excerpts, definitions, or revision notes here (minimum 25 characters)..."
                  className="w-full p-3.5 rounded-lg border border-[#E8E6E2] bg-[#FAF8F5]/40 text-xs text-[#121827] focus:outline-none focus:border-[#C84428] leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-[11px] text-[#606B7C]">
                  {notesContent.trim().length} characters • Paginated automatically on save
                </span>
                <button
                  type="submit"
                  disabled={isProcessing || notesContent.trim().length < 25}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Indexing Notes...</span>
                    </>
                  ) : (
                    <>
                      <span>Save &amp; Open Study Space</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Mode 3: YouTube URL Form */}
          {ingestTab === 'youtube' && (
            <form onSubmit={handleYouTubeSubmit} className="space-y-4">
              <div className="space-y-1">
                <label htmlFor="home-youtube-url" className="block text-xs font-semibold text-[#121827]">
                  Public YouTube Lecture URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Youtube className="w-4 h-4 text-[#C84428] absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      id="home-youtube-url"
                      type="url"
                      value={youtubeUrlInput}
                      onChange={(e) => setYoutubeUrlInput(e.target.value)}
                      placeholder="https://www.youtube.com/watch?v=..."
                      disabled={isProcessing}
                      className="w-full h-10 pl-10 pr-3.5 rounded-lg border border-[#E8E6E2] bg-[#FAF8F5]/40 text-xs text-[#121827] focus:outline-none focus:border-[#C84428]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isProcessing || !youtubeUrlInput.trim()}
                    className="h-10 px-5 rounded-lg lm-btn-accent text-xs font-semibold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Transcribing &amp; Indexing...</span>
                      </>
                    ) : (
                      <>
                        <span>Extract &amp; Study</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-[#606B7C]">
                LearnMate retrieves the lecture transcript, formats timestamped study sections, and prepares conceptual questions.
              </p>
            </form>
          )}

          {/* Error Alert with Dismiss & Retry */}
          {errorMessage && (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-left text-xs text-red-800"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-[#C84428] shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onClearError();
                    if (ingestTab === 'pdf') fileInputRef.current?.click();
                  }}
                  className="px-2.5 py-1 rounded-md bg-white border border-red-200 text-[11px] font-semibold text-red-800 hover:bg-red-100 transition-colors cursor-pointer"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={onClearError}
                  aria-label="Dismiss error"
                  className="text-red-600 hover:text-red-900 p-1 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>

        {/* 4 Core Academic Study Pillars */}
        <section aria-labelledby="pillars-heading" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="pillars-heading" className="font-serif-editorial text-2xl font-bold text-[#121827]">
              Study Workspaces
            </h2>
            <span className="text-xs text-[#606B7C]">Choose your task</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Study Space */}
            <button
              type="button"
              onClick={() => {
                if (documents[0]) onSelectDocument(documents[0], 'explain');
                else onNavigateTab('study');
              }}
              className="group text-left rounded-xl bg-white border border-[#E8E6E2] p-5 hover:border-[#C84428]/60 transition-all shadow-xs cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-[#FBECE6] text-[#C84428] flex items-center justify-center">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-editorial text-base font-bold text-[#121827] group-hover:text-[#C84428] transition-colors">
                    Study Space
                  </h3>
                  <p className="text-xs text-[#606B7C] leading-relaxed mt-1">
                    Socratic AI tutor, multi-page chapter summaries, flashcards, and audio lectures.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#C84428]">
                <span>Open Space</span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>

            {/* 2. Practice & Mock Exams */}
            <button
              type="button"
              onClick={() => onNavigateTab('practice')}
              className="group text-left rounded-xl bg-white border border-[#E8E6E2] p-5 hover:border-[#2E7D52]/60 transition-all shadow-xs cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-[#EBF6EE] text-[#2E7D52] flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-editorial text-base font-bold text-[#121827] group-hover:text-[#2E7D52] transition-colors">
                    Practice &amp; Mock Exams
                  </h3>
                  <p className="text-xs text-[#606B7C] leading-relaxed mt-1">
                    Timed diagnostic tests for JEE, NEET, CUET, Boards, and University courses with proctored full screen.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2E7D52]">
                <span>Start Practice</span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>

            {/* 3. PDF Annotation Studio */}
            <button
              type="button"
              onClick={() => onNavigateTab('pdf-workspace')}
              className="group text-left rounded-xl bg-white border border-[#E8E6E2] p-5 hover:border-[#D97706]/60 transition-all shadow-xs cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-[#FEF6E0] text-[#D97706] flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-editorial text-base font-bold text-[#121827] group-hover:text-[#D97706] transition-colors">
                    PDF Annotation Studio
                  </h3>
                  <p className="text-xs text-[#606B7C] leading-relaxed mt-1">
                    Read, highlight passages, sketch diagrams in margins, and export annotated lecture notes.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#D97706]">
                <span>Open Reader</span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>

            {/* 4. Explore & Research */}
            <button
              type="button"
              onClick={() => onNavigateTab('explore')}
              className="group text-left rounded-xl bg-white border border-[#E8E6E2] p-5 hover:border-[#2563EB]/60 transition-all shadow-xs cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="w-10 h-10 rounded-lg bg-[#EFF6FF] text-[#2563EB] flex items-center justify-center">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-serif-editorial text-base font-bold text-[#121827] group-hover:text-[#2563EB] transition-colors">
                    Explore &amp; Research
                  </h3>
                  <p className="text-xs text-[#606B7C] leading-relaxed mt-1">
                    Daily student newspaper, ArXiv papers, OpenAlex search, and campus study maps.
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#2563EB]">
                <span>Browse Library</span>
                <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </button>
          </div>
        </section>

        {/* Recent Study Materials Library */}
        {documents.length > 0 && (
          <section aria-labelledby="recent-heading" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8E6E2] pb-3">
              <div className="flex items-center gap-2.5">
                <h2 id="recent-heading" className="font-serif-editorial text-2xl font-bold text-[#121827]">
                  Recent Materials
                </h2>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-[#F7F5F0] text-[#606B7C] border border-[#E8E6E2]">
                  {documents.length} {documents.length === 1 ? 'file' : 'files'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {documents.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setShowAllRecent((prev) => !prev)}
                    className="text-xs font-semibold text-[#606B7C] hover:text-[#121827] transition-colors cursor-pointer"
                  >
                    {showAllRecent ? 'Show Less' : `View All (${documents.length})`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigateTab('dashboard')}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#C84428] hover:underline cursor-pointer"
                >
                  <span>Student Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {recentDocs.map((doc, idx) => {
                const isPdf = doc.sourceType === 'pdf';
                const isYt = doc.sourceType === 'youtube';
                const pageCount = doc.pageCount || doc.pages?.length || 1;

                return (
                  <div
                    key={doc.id}
                    className="bg-white border border-[#E8E6E2] rounded-xl p-4 shadow-2xs hover:border-[#C84428]/50 transition-all flex flex-col justify-between space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-[#FAF8F5] border border-[#E8E6E2] text-[#606B7C] flex items-center justify-center shrink-0 mt-0.5">
                          {isYt ? (
                            <Youtube className="w-4 h-4 text-[#C84428]" />
                          ) : (
                            <FileText className="w-4 h-4 text-[#606B7C]" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectDocument(doc, 'explain')}
                            className="text-left font-serif-editorial text-sm font-bold text-[#121827] hover:text-[#C84428] transition-colors truncate block max-w-sm sm:max-w-md cursor-pointer"
                          >
                            {doc.title.replace(/\.pdf$/i, '')}
                          </button>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-[#606B7C]">
                            <span className="font-medium">
                              {pageCount} {pageCount === 1 ? 'page' : 'pages'}
                            </span>
                            <span>•</span>
                            <span>{formatRelativeTime(doc.lastStudiedAt, idx)}</span>
                          </div>
                        </div>
                      </div>

                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#FAF8F5] text-[#606B7C] border border-[#E8E6E2] shrink-0">
                        {isYt ? 'Video' : isPdf ? 'PDF' : 'Notes'}
                      </span>
                    </div>

                    {/* Quick Document Actions */}
                    <div className="flex items-center gap-1.5 pt-2 border-t border-[#F2EFE9] text-xs">
                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc, 'explain')}
                        className="px-2.5 py-1 rounded-md bg-[#FAF8F5] hover:bg-[#FBECE6] text-[#121827] hover:text-[#C84428] font-medium transition-colors cursor-pointer"
                      >
                        Explain
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc, 'quick-revise')}
                        className="px-2.5 py-1 rounded-md bg-[#FAF8F5] hover:bg-[#FBECE6] text-[#121827] hover:text-[#C84428] font-medium transition-colors cursor-pointer"
                      >
                        Quick Revise
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectDocument(doc, 'quiz')}
                        className="px-2.5 py-1 rounded-md bg-[#FAF8F5] hover:bg-[#EBF6EE] text-[#121827] hover:text-[#2E7D52] font-medium transition-colors cursor-pointer"
                      >
                        Quiz
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectDocument(doc);
                          onNavigateTab('revision');
                        }}
                        className="px-2.5 py-1 rounded-md bg-[#FAF8F5] hover:bg-[#F7F5F0] text-[#606B7C] hover:text-[#121827] font-medium transition-colors cursor-pointer ml-auto"
                      >
                        Flashcards
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      {/* Multi-Page Study Notes Paste Modal */}
      {pasteModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#121827]/40 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="paste-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPasteModalOpen(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl border border-[#E8E6E2] w-full max-w-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-[#E8E6E2] bg-[#FCFBF9] flex items-center justify-between">
              <div>
                <h3 id="paste-modal-title" className="font-serif-editorial text-lg font-bold text-[#121827]">
                  Paste Study Notes
                </h3>
                <p className="text-xs text-[#606B7C]">
                  LearnMate divides your notes into structured pages and extracts key topics.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPasteModalOpen(false)}
                aria-label="Close modal"
                className="p-1.5 rounded-lg text-[#606B7C] hover:text-[#121827] hover:bg-[#F7F5F0] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleNotesSubmit} className="p-6 space-y-4">
              <div>
                <label
                  htmlFor="full-notes-title"
                  className="block text-xs font-semibold text-[#121827] mb-1.5"
                >
                  Document Title
                </label>
                <input
                  id="full-notes-title"
                  type="text"
                  value={notesTitle}
                  onChange={(e) => setNotesTitle(e.target.value)}
                  placeholder="e.g. Organic Chemistry Chapter 4: Reaction Mechanisms"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-[#E8E6E2] text-xs font-medium text-[#121827] focus:outline-none focus:border-[#C84428]"
                />
              </div>

              <div>
                <label
                  htmlFor="full-notes-body"
                  className="block text-xs font-semibold text-[#121827] mb-1.5"
                >
                  Study Notes (Optional: use &quot;--- Page 1 ---&quot; to divide into specific pages)
                </label>
                <textarea
                  id="full-notes-body"
                  rows={9}
                  value={notesContent}
                  onChange={(e) => setNotesContent(e.target.value)}
                  placeholder="Paste lecture notes, textbook excerpts, or study guides here (minimum 25 characters)..."
                  className="w-full px-3.5 py-3 rounded-lg border border-[#E8E6E2] text-xs text-[#121827] focus:outline-none focus:border-[#C84428] leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#E8E6E2]">
                <button
                  type="button"
                  onClick={() => setPasteModalOpen(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-[#606B7C] hover:bg-[#F7F5F0] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isProcessing || notesContent.trim().length < 25}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg lm-btn-accent text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Indexing Notes...</span>
                    </>
                  ) : (
                    <>
                      <span>Start Studying</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
