import React, { useState, useRef, useMemo } from 'react';
import {
  FileText,
  Upload,
  Youtube,
  Sparkles,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Clock,
  Layers,
  ChevronRight,
  Compass,
  Award,
  Search,
  Plus,
  Play,
  RotateCcw,
} from 'lucide-react';
import type { StudyDocument } from '../types/study';
import type { StudySession } from '../types/questionBank';
import { studyStorage } from '../services/storageService';
import { JEE_MAIN_SYLLABUS, type JeeSubjectId } from '../data/jeeMainSyllabus';
import type { ActiveTab } from './Navbar';
import { CapsuleButton, CapsuleChip, CapsuleSearch } from './capsule';

interface PaperHomeViewProps {
  documents: StudyDocument[];
  onUploadPdf: (file: File) => Promise<void>;
  onSubmitTextNotes: (title: string, rawText: string) => Promise<void>;
  onSubmitYouTubeUrl: (url: string) => Promise<void>;
  onSelectDocument: (doc: StudyDocument) => void;
  onNavigateTab: (tab: ActiveTab) => void;
  onStartSession?: (session: StudySession) => void;
  userName?: string;
  isProcessing: boolean;
  errorMessage: string | null;
  onClearError: () => void;
}

export const PaperHomeView: React.FC<PaperHomeViewProps> = ({
  documents,
  onUploadPdf,
  onSubmitTextNotes,
  onSubmitYouTubeUrl,
  onSelectDocument,
  onNavigateTab,
  userName = 'Student',
  isProcessing,
  errorMessage,
  onClearError,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // "Create Session" form state
  const [sessionName, setSessionName] = useState('');
  const [selectedSubject, setSelectedSubject] = useState<JeeSubjectId>('physics');
  const [selectedChapterId, setSelectedChapterId] = useState<string>('physics_unit_01');
  const [docAttachMode, setDocAttachMode] = useState<'pdf' | 'paste'>('pdf');
  const [pastedNotes, setPastedNotes] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sample JEE study material loader for instantaneous presentation / demo readiness
  const handleLoadSampleNotes = async () => {
    const sampleTitle = 'JEE Physics: Mechanics & Kinematics';
    const sampleContent = `1. Dimensional Analysis and Homogeneity
Physical quantities can only be added or subtracted if they share the exact same dimensions. In any valid physical equation [LHS] = [RHS].
Arguments of transcendental functions (trigonometric, exponential, logarithmic) must be strictly dimensionless [M^0 L^0 T^0].
- Gravitational constant G: [M^-1 L^3 T^-2]
- Planck constant h: [M L^2 T^-1]
- Permittivity of free space ε0: [M^-1 L^-3 T^4 A^2]
- Permeability of free space μ0: [M L T^-2 A^-2]
Fractional Error: Z = A^p B^q / C^r => ΔZ/Z = p(ΔA/A) + q(ΔB/B) + r(ΔC/C). Always add absolute fractional errors to compute worst-case bounds.

2. Kinematics in One Dimension (Rectilinear Motion)
Instantaneous velocity v = dx/dt and acceleration a = dv/dt = v(dv/dx).
Equations of motion for CONSTANT acceleration:
v = u + a*t
s = u*t + (1/2)*a*t^2
v^2 = u^2 + 2*a*s
Distance traveled in n-th second: s_n = u + (a/2)*(2n - 1).
For variable acceleration, kinematic integration is mandatory:
v(t) = v0 + ∫ a(t) dt
x(t) = x0 + ∫ v(t) dt
If acceleration is given as a function of position a(x):
∫ v dv = ∫ a(x) dx => (v^2 - v0^2)/2 = ∫ a(x) dx.

3. Graphical Interpretation in Kinematics
- Slope of displacement-time (x-t) curve represents instantaneous velocity v.
- Slope of velocity-time (v-t) curve represents instantaneous acceleration a.
- Area under velocity-time (v-t) curve between t1 and t2 equals total displacement Δx.
- Area under acceleration-time (a-t) curve equals change in velocity Δv.

4. Free Fall & Projectile Motion Launch
For an object thrown vertically upward with initial speed u in gravity g:
- Maximum height reached: H_max = u^2 / (2g).
- Total time of flight: T = 2u / g.
- Speed upon returning to launch level: v = u.`;
    await onSubmitTextNotes(sampleTitle, sampleContent);
  };

  // Load real sessions from storage
  const [sessions, setSessions] = useState<StudySession[]>(() => studyStorage.getStudySessions());

  // Available chapters for the selected subject
  const currentSubjectChapters = useMemo(() => {
    const subj = JEE_MAIN_SYLLABUS.find((s) => s.id === selectedSubject);
    return subj ? subj.chapters : [];
  }, [selectedSubject]);

  // Handle PDF file selection
  const handleFileDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === 'application/pdf') {
      await onUploadPdf(file);
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = sessionName.trim() || `${selectedSubject.toUpperCase()} Study Session`;
    
    // Create new session in local-first storage
    studyStorage.createStudySession({
      name,
      subjectId: selectedSubject,
      chapterId: selectedChapterId,
      resourceIds: selectedDocIds,
    });

    // If text notes are provided in paste mode, import them
    if (docAttachMode === 'paste' && pastedNotes.trim()) {
      await onSubmitTextNotes(name, pastedNotes.trim());
      setPastedNotes('');
    }

    // If YouTube URL is provided, import it
    if (youtubeUrl.trim()) {
      await onSubmitYouTubeUrl(youtubeUrl.trim());
    }

    setSessions(studyStorage.getStudySessions());
    setSessionName('');
    setYoutubeUrl('');

    // Open session workspace directly
    onNavigateTab('sessions');
  };

  return (
    <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-10">
      
      {/* 1. Founder Greeting & Dynamic Search (Page 1) */}
      <div className="space-y-4">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--border-paper)] pb-6">
          <div>
            <div className="paper-kicker mb-1">JEE 2026 Academic Workspace</div>
            <h1 className="paper-title text-3xl sm:text-4xl text-[var(--text-ink)] tracking-tight">
              Hello, {userName}. <span className="italic font-normal text-[var(--accent-terracotta)]">let&apos;s grind.</span>
            </h1>
            <p className="text-sm text-[var(--text-ink-secondary)] mt-1.5 font-serif-editorial">
              Your paper study journal for deep problem solving, verified mocks, and disciplined revision.
            </p>
          </div>

          {/* Dynamic Search Box with Capsule Architecture */}
          <div className="w-full md:w-80">
            <CapsuleSearch
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search chapters, topics, formulas..."
            />
          </div>
        </div>

        {errorMessage && (
          <div className="p-3.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 flex items-center justify-between text-xs text-red-700 dark:text-red-300">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={onClearError}
              className="text-red-500 hover:text-red-700 font-semibold cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>

      {/* Demo Presentation Helper Banner */}
      <div className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="font-semibold text-[var(--text-ink)]">Live Presentation & Instant Study Mode</div>
            <div className="text-[var(--text-ink-secondary)]">Load standard JEE Physics notes with 1 click to test grounded AI tutoring, mind maps, practice quizzes, and PDF generation.</div>
          </div>
        </div>
        <CapsuleButton
          size="sm"
          variant="accent"
          disabled={isProcessing}
          onClick={handleLoadSampleNotes}
          icon={<Sparkles className="w-3.5 h-3.5" />}
        >
          {isProcessing ? 'Loading...' : 'Load Sample Notes'}
        </CapsuleButton>
      </div>

      {/* 2. Primary Action: Create Session Panel & Recent Sessions (2-column layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT (7 cols): Create Session Card (Prominent Blueprint Action) */}
        <div className="lg:col-span-7 paper-card p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3.5">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] flex items-center justify-center font-bold text-xs">
                +
              </div>
              <h2 className="font-serif-editorial font-bold text-xl text-[var(--text-ink)]">
                Create Session
              </h2>
            </div>
            <span className="text-[11px] text-[var(--text-ink-muted)]">Active context for notes & AI chat</span>
          </div>

          <form onSubmit={handleCreateSession} className="space-y-4">
            {/* Session Name */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-ink-secondary)] mb-1">
                Session Name
              </label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder="e.g. Rotational Dynamics & Center of Mass Practice"
                className="w-full px-3.5 py-2.5 text-xs paper-input"
              />
            </div>

            {/* Subject and Chapter Selectors */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-[var(--text-ink-secondary)] mb-1">
                  Subject
                </label>
                <select
                  value={selectedSubject}
                  onChange={(e) => {
                    const subj = e.target.value as JeeSubjectId;
                    setSelectedSubject(subj);
                    const firstChap = JEE_MAIN_SYLLABUS.find((s) => s.id === subj)?.chapters[0];
                    if (firstChap) setSelectedChapterId(firstChap.id);
                  }}
                  className="w-full px-3 py-2 text-xs paper-input capitalize"
                >
                  <option value="physics">Physics</option>
                  <option value="chemistry">Chemistry</option>
                  <option value="mathematics">Mathematics</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[var(--text-ink-secondary)] mb-1">
                  NTA Chapter / Unit
                </label>
                <select
                  value={selectedChapterId}
                  onChange={(e) => setSelectedChapterId(e.target.value)}
                  className="w-full px-3 py-2 text-xs paper-input"
                >
                  {currentSubjectChapters.map((chap) => (
                    <option key={chap.id} value={chap.id}>
                      Unit {chap.unitNumber}: {chap.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Add Docs: Attachment Mode Switcher & Box */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-semibold text-[var(--text-ink-secondary)]">
                  Attach Study Documents
                </label>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setDocAttachMode('pdf')}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      docAttachMode === 'pdf'
                        ? 'bg-[var(--accent-terracotta)] text-white'
                        : 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)]'
                    }`}
                  >
                    Upload PDF
                  </button>
                  <button
                    type="button"
                    onClick={() => setDocAttachMode('paste')}
                    className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                      docAttachMode === 'paste'
                        ? 'bg-[var(--accent-terracotta)] text-white'
                        : 'bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)]'
                    }`}
                  >
                    Paste Notes
                  </button>
                </div>
              </div>

              {docAttachMode === 'pdf' ? (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`p-4 rounded-lg border-2 border-dashed text-center cursor-pointer transition-colors ${
                    isDragOver
                      ? 'border-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)]'
                      : 'border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] bg-[var(--bg-surface-warm)]'
                  }`}
                >
                  <Upload className="w-5 h-5 mx-auto text-[var(--text-ink-muted)] mb-1.5" />
                  <div className="text-xs font-medium text-[var(--text-ink)]">
                    {isProcessing ? 'Analyzing document...' : 'Click to upload PDF notes or drag and drop'}
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5">
                    NCERT text, classroom notes, coaching modules (max 30 MB)
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) await onUploadPdf(file);
                      e.target.value = '';
                    }}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <textarea
                    rows={4}
                    value={pastedNotes}
                    onChange={(e) => setPastedNotes(e.target.value)}
                    placeholder="Paste textbook excerpts, derivations, lecture notes, or key formulas..."
                    className="w-full p-3 text-xs paper-input font-serif-editorial"
                  />
                  <div className="flex items-center justify-between text-[11px] text-[var(--text-ink-muted)]">
                    <span>At least 25 characters required.</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPastedNotes(
                          `Kinematics & Rotational Dynamics Principles:\n1. Torque τ = r × F = I α\n2. Work done W = ∫ τ dθ\n3. Angular momentum L = I ω\n4. Conservation of angular momentum holds when external net torque is zero.\n5. Radius of gyration k: I = M k²`
                        )
                      }
                      className="text-[var(--accent-terracotta)] hover:underline cursor-pointer"
                    >
                      Fill Example
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Add YouTube Links */}
            <div>
              <label className="block text-xs font-semibold text-[var(--text-ink-secondary)] mb-1">
                Add YouTube Lecture Link
              </label>
              <div className="relative">
                <Youtube className="w-4 h-4 text-red-600 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="url"
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full pl-9 pr-3 py-2 text-xs paper-input"
                />
              </div>
            </div>

            {/* Primary Submit Button */}
            <CapsuleButton
              type="submit"
              disabled={isProcessing}
              variant="accent"
              size="lg"
              className="w-full"
              icon={<Play className="w-3.5 h-3.5 fill-current" />}
            >
              {isProcessing ? 'Initializing Session...' : 'Create & Open Session Workspace'}
            </CapsuleButton>
          </form>
        </div>

        {/* RIGHT (5 cols): Recent Sessions List */}
        <div className="lg:col-span-5 paper-card p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3.5">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--accent-terracotta)]" />
              <h2 className="font-serif-editorial font-bold text-xl text-[var(--text-ink)]">
                Recent Sessions
              </h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('sessions')}
              className="text-xs text-[var(--accent-terracotta)] hover:underline font-medium cursor-pointer"
            >
              View all ({sessions.length})
            </button>
          </div>

          <div className="divide-y divide-[var(--border-paper)] max-h-[380px] overflow-y-auto">
            {sessions.length > 0 ? (
              sessions.slice(0, 5).map((sess) => (
                <div
                  key={sess.id}
                  onClick={() => onNavigateTab('sessions')}
                  className="py-3 px-1 hover:bg-[var(--bg-subtle)] rounded-lg transition-colors cursor-pointer group flex items-center justify-between"
                >
                  <div className="min-w-0 pr-3">
                    <div className="font-medium text-xs text-[var(--text-ink)] group-hover:text-[var(--accent-terracotta)] truncate transition-colors">
                      {sess.name}
                    </div>
                    <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5 flex items-center gap-2">
                      <span className="capitalize">{sess.subjectId || 'General'}</span>
                      <span>•</span>
                      <span>{new Date(sess.lastActiveAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
                      <span>•</span>
                      <span>{sess.resourceIds.length} doc{sess.resourceIds.length === 1 ? '' : 's'}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-ink-muted)] group-hover:text-[var(--accent-terracotta)] transition-colors shrink-0" />
                </div>
              ))
            ) : documents.length > 0 ? (
              documents.slice(0, 5).map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectDocument(doc)}
                  className="py-3 px-1 hover:bg-[var(--bg-subtle)] rounded-lg transition-colors cursor-pointer group flex items-center justify-between"
                >
                  <div className="min-w-0 pr-3">
                    <div className="font-medium text-xs text-[var(--text-ink)] group-hover:text-[var(--accent-terracotta)] truncate transition-colors">
                      {doc.title}
                    </div>
                    <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5 flex items-center gap-2">
                      <span>{doc.pages.length} pages</span>
                      <span>•</span>
                      <span>{doc.sourceType}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[var(--text-ink-muted)] group-hover:text-[var(--accent-terracotta)] transition-colors shrink-0" />
                </div>
              ))
            ) : (
              <div className="py-8 text-center text-xs text-[var(--text-ink-muted)] space-y-2">
                <div>No study sessions recorded yet.</div>
                <div className="text-[11px]">Upload a PDF or enter a YouTube lecture to begin.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 3. Roadmaps / Series Section (Page 1) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[var(--accent-terracotta)]" />
            <h2 className="font-serif-editorial font-bold text-2xl text-[var(--text-ink)]">
              Roadmaps / Series
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('roadmaps')}
            className="text-xs text-[var(--accent-terracotta)] hover:underline font-medium cursor-pointer"
          >
            Explore all tracks →
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              id: 'physics-mechanics',
              title: 'Mechanics & Newton’s Laws',
              subject: 'Physics',
              units: 'Units 1–4',
              progress: 68,
              badge: 'High Weightage',
            },
            {
              id: 'chem-organic',
              title: 'Organic Reaction Mechanisms',
              subject: 'Chemistry',
              units: 'Units 11–16',
              progress: 42,
              badge: 'Scoring Core',
            },
            {
              id: 'math-calculus',
              title: 'Integral Calculus & Vectors',
              subject: 'Mathematics',
              units: 'Units 7–10',
              progress: 55,
              badge: 'Critical Math',
            },
            {
              id: 'physics-electrodynamics',
              title: 'Electrodynamics & Magnetism',
              subject: 'Physics',
              units: 'Units 12–15',
              progress: 30,
              badge: 'Advanced Core',
            },
          ].map((track) => (
            <div
              key={track.id}
              onClick={() => onNavigateTab('roadmaps')}
              className="paper-card p-4 space-y-3 hover:border-[var(--border-paper-strong)] transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[var(--accent-terracotta)] uppercase tracking-wider">
                  {track.subject}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--bg-subtle)] text-[var(--text-ink-secondary)]">
                  {track.badge}
                </span>
              </div>
              <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)] group-hover:text-[var(--accent-terracotta)] transition-colors">
                {track.title}
              </h3>
              <div className="text-xs text-[var(--text-ink-muted)]">{track.units}</div>
              
              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-[var(--text-ink-muted)]">
                  <span>Progress</span>
                  <span className="font-semibold text-[var(--text-ink)]">{track.progress}%</span>
                </div>
                <div className="w-full h-1.5 bg-[var(--bg-subtle)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-terracotta)] rounded-full transition-all"
                    style={{ width: `${track.progress}%` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Mocks / PYQs Section (Page 1) */}
      <div className="paper-card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-3.5">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-[var(--accent-terracotta)]" />
            <h2 className="font-serif-editorial font-bold text-2xl text-[var(--text-ink)]">
              Mocks / PYQ’s
            </h2>
          </div>
          <span className="text-xs text-[var(--text-ink-muted)]">
            Verified NTA JEE Main papers with official +4 / -1 marking
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { year: '2026 JEE', label: 'NTA Model Papers & Syllabus Blueprints', count: 'Available for Assembly' },
            { year: '2025 PYQ', label: 'Jan & Apr Session Real Papers', count: 'Verified Question Bank' },
            { year: '2024 PYQ', label: 'Full 10-Shift Archive by Chapter', count: 'Curated Verified' },
          ].map((item) => (
            <div
              key={item.year}
              onClick={() => onNavigateTab('mocks')}
              className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] hover:border-[var(--accent-terracotta)] transition-colors cursor-pointer group"
            >
              <div className="font-serif-editorial font-bold text-lg text-[var(--text-ink)] group-hover:text-[var(--accent-terracotta)]">
                {item.year}
              </div>
              <div className="text-xs text-[var(--text-ink-secondary)] mt-1">{item.label}</div>
              <div className="text-[11px] text-[var(--accent-terracotta)] font-semibold mt-2.5 flex items-center gap-1">
                <span>Start Practice</span>
                <ArrowRight className="w-3 h-3" />
              </div>
            </div>
          ))}
        </div>

        {/* Custom Mock Generator Action Bar */}
        <div className="p-4 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-paper)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-xs text-[var(--text-ink)]">
              Custom Mock Generator
            </div>
            <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5">
              Select specific subjects, units, or weak topics to generate a timed examination session.
            </div>
          </div>
          <CapsuleButton
            variant="accent"
            size="md"
            onClick={() => onNavigateTab('mocks')}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Generate Custom Mock
          </CapsuleButton>
        </div>
      </div>

      {/* 5. Minimal Editorial Paper Footer */}
      <footer className="pt-6 border-t border-[var(--border-paper)] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[var(--text-ink-muted)] font-serif-editorial">
        <div>
          LearnMate 2.0 • Grounded in official NTA JEE (Main) 2026 Curriculum
        </div>
        <div className="flex items-center gap-4 text-[11px] font-sans">
          <span>Local-First Academic Journal</span>
          <span>•</span>
          <span>Per-Account Privacy</span>
        </div>
      </footer>
    </div>
  );
};
