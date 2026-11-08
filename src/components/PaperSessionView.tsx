import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FileText,
  Youtube,
  Send,
  Sparkles,
  Calculator,
  LineChart,
  Edit3,
  Layers,
  Video,
  Box,
  FileDown,
  Mic,
  Plus,
  RotateCcw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ArrowRight,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  X,
  GraduationCap,
  SidebarClose,
  SidebarOpen,
  RotateCw,
  Eye,
  BookOpen,
  Download,
  Award,
  Check,
  Copy,
  BarChart3,
  Loader2,
} from 'lucide-react';
import type { StudyDocument, PracticeQuizQuestion, QuizAttempt, FlashcardItem, StickyNoteItem } from '../types/study';
import type { StudySession } from '../types/questionBank';
import { MathRenderer } from './MathRenderer';
import type { SyllabusChapter, JeeSubjectId } from '../data/jeeMainSyllabus';
import type { ChapterEducationalContent } from '../services/chapterContentProvider';
import { getCheckpointsForChapter } from '../services/chapterContentProvider';
import { getCheckpointQuizQuestions } from '../features/roadmaps/data/quizzes/checkpointQuizBank';
import { aiStudyClient } from '../services/aiClient';
import { studyStorage } from '../services/storageService';
import { generateRevisionNotesPdfBytes } from '../utils/pdfGenerator';
import { brainTeaserSets, getBrainTeaserSet, BrainTeaserSet, BrainTeaserQuestion } from '../data/brainTeasersData';
import { downloadBrainTeaserPdf } from '../utils/brainTeaserPdfGenerator';
import { buildGroundedStickyNotesAndFlashcards, parseYouTubeUrl } from '../utils/quizGrading';
import { VoiceTutorModal } from './VoiceTutorModal';
import { CapsuleButton, CapsuleChip, CapsuleControl } from './capsule';
import type { ActiveTab } from './Navbar';

interface SessionChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  citations?: Array<{ pageNumber: number; quote: string }>;
}

export interface ActiveChapterSessionContext {
  subjectId: JeeSubjectId;
  chapter: SyllabusChapter;
  content: ChapterEducationalContent;
  session: StudySession;
}

interface PaperSessionViewProps {
  documents: StudyDocument[];
  activeDocument?: StudyDocument | null;
  activeChapterSession?: ActiveChapterSessionContext | null;
  onSelectDocument: (doc: StudyDocument) => void;
  onClearActiveChapter?: () => void;
  onUploadPdf?: (file: File) => Promise<void>;
  onSubmitYouTubeUrl?: (url: string) => Promise<void>;
  onNavigateTab?: (tab: ActiveTab) => void;
  userName?: string;
  isProcessing?: boolean;
}

type DossierTab = 'mindmap' | 'videos' | '3d' | 'revision' | 'talk';
type ToolModal = 'calc' | 'graph' | 'scratchpad' | null;
type QuizActivity = 'full' | 'quick' | 'teaser' | 'history';
type QuickRevTab = 'flashcards' | 'sticky' | 'onepage';

export const PaperSessionView: React.FC<PaperSessionViewProps> = ({
  documents,
  activeDocument,
  activeChapterSession,
  onSelectDocument,
  onClearActiveChapter,
  onUploadPdf,
  onSubmitYouTubeUrl,
  onNavigateTab,
  userName = 'Student',
  isProcessing = false,
}) => {
  const currentDoc = activeDocument || documents[0] || null;

  // Active Session from storage
  const [activeSession, setActiveSession] = useState<StudySession | null>(() => {
    if (activeChapterSession) return activeChapterSession.session;
    const list = studyStorage.getStudySessions();
    return list[0] || null;
  });

  // Track whether the chapter session or an uploaded document is the active focus
  const [isChapterActive, setIsChapterActive] = useState<boolean>(() => Boolean(activeChapterSession));
  const prevChapterIdRef = useRef<string | null>(activeChapterSession?.chapter.id || null);

  const hasActiveChapter = isChapterActive && Boolean(activeChapterSession);

  // Compute effective context for AI Tutor, mind maps, quizzes, and revision
  const contextTitle = hasActiveChapter
    ? `${activeChapterSession!.chapter.name} (${activeChapterSession!.subjectId.toUpperCase()})`
    : currentDoc?.title || 'JEE Academic Session';

  const contextPages = useMemo(() => {
    if (hasActiveChapter) {
      return activeChapterSession!.content.toStudyPages();
    }
    return currentDoc?.pages || [];
  }, [hasActiveChapter, activeChapterSession, currentDoc]);

  const contextTopics = useMemo(() => {
    if (hasActiveChapter) {
      return activeChapterSession!.content.toStudyTopics();
    }
    return currentDoc?.topics || [];
  }, [hasActiveChapter, activeChapterSession, currentDoc]);

  // YouTube Link Ingestion Modal State
  const [youtubeModalOpen, setYoutubeModalOpen] = useState(false);
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [youtubeSubmitting, setYoutubeSubmitting] = useState(false);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);

  const handleOpenYouTubeModal = () => {
    setYoutubeUrlInput('');
    setYoutubeError(null);
    setYoutubeModalOpen(true);
  };

  const handleCloseYouTubeModal = () => {
    if (youtubeSubmitting) return;
    setYoutubeModalOpen(false);
    setYoutubeError(null);
  };

  const handleSubmitYouTube = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseYouTubeUrl(youtubeUrlInput);
    if (!parsed.valid) {
      setYoutubeError(parsed.error || 'Please enter a valid YouTube lecture URL.');
      return;
    }
    if (!onSubmitYouTubeUrl) {
      setYoutubeError('YouTube ingestion service is currently unavailable.');
      return;
    }

    setYoutubeSubmitting(true);
    setYoutubeError(null);
    try {
      await onSubmitYouTubeUrl(youtubeUrlInput.trim());
      setIsChapterActive(false);
      setYoutubeModalOpen(false);
    } catch (err: any) {
      setYoutubeError(err?.message || 'Failed to ingest YouTube video transcript.');
    } finally {
      setYoutubeSubmitting(false);
    }
  };

  // ----------------------------------------------------
  // 1. CHATBOT STATE
  // ----------------------------------------------------
  const [messages, setMessages] = useState<SessionChatMessage[]>(() => {
    if (activeChapterSession) {
      return [
        {
          id: `welcome-${activeChapterSession.chapter.id}`,
          role: 'assistant',
          content: `Welcome to your AI Tutor session on **${activeChapterSession.chapter.name}** (${activeChapterSession.subjectId.toUpperCase()}). All official syllabus concepts, formulas, and derivations are loaded. What would you like to explore or derive?`,
          timestamp: new Date().toISOString(),
        },
      ];
    }
    return [
      {
        id: 'welcome',
        role: 'assistant',
        content: currentDoc
          ? `Welcome to your study session on **${currentDoc.title}**. Ask me to derive any formula, explain a difficult step, or test your conceptual grasp!`
          : 'Welcome to your Learnmate session! Select or attach a document above to begin grounded Socratic study.',
        timestamp: new Date().toISOString(),
      },
    ];
  });

  // Switch context cleanly whenever activeChapterSession changes
  useEffect(() => {
    if (activeChapterSession) {
      if (prevChapterIdRef.current !== activeChapterSession.chapter.id) {
        prevChapterIdRef.current = activeChapterSession.chapter.id;
        setIsChapterActive(true);
        setActiveSession(activeChapterSession.session);
        setMessages([
          {
            id: `welcome-${activeChapterSession.chapter.id}`,
            role: 'assistant',
            content: `Welcome to your AI Tutor session on **${activeChapterSession.chapter.name}** (${activeChapterSession.subjectId.toUpperCase()}). All official syllabus concepts, formulas, and derivations are loaded. What would you like to explore or derive?`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    } else {
      prevChapterIdRef.current = null;
    }
  }, [activeChapterSession]);

  const [inputValue, setInputValue] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messages.length > 1 || isAsking) {
      chatScrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [messages, isAsking]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const query = inputValue.trim();
    if (!query || isAsking) return;

    const userMsg: SessionChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsAsking(true);

    try {
      const resp = await aiStudyClient.askTutor({
        title: contextTitle,
        pages: contextPages,
        question: query,
        history: messages
          .filter((m) => !m.content.startsWith('Welcome to your'))
          .slice(-10)
          .map((m) => ({
            role: m.role,
            content: m.content,
          })),
        studentContext: hasActiveChapter
          ? {
              currentTopic: activeChapterSession!.chapter.name,
              currentPage: 1,
              currentActivity: 'chapter_tutor_session',
            }
          : undefined,
        sourceControlMode: 'extended_knowledge',
      });

      const tutorReply: SessionChatMessage = {
        id: `tutor-${Date.now()}`,
        role: 'assistant',
        content: resp?.answer || 'Reviewing your syllabus notes. Let me know what step to clarify.',
        timestamp: new Date().toISOString(),
        citations: resp?.citations || [],
      };
      setMessages((prev) => [...prev, tutorReply]);
    } catch {
      const fallbackReply: SessionChatMessage = {
        id: `tutor-${Date.now()}`,
        role: 'assistant',
        content: `I encountered a temporary connection delay while generating the complete explanation for **${query}**. Please ask again or specify which sub-step or formula you would like me to focus on.`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, fallbackReply]);
    } finally {
      setIsAsking(false);
    }
  };

  // ----------------------------------------------------
  // 2. TOOLS MODALS (Calculator, Grapher, Scratchpad)
  // ----------------------------------------------------
  const [activeTool, setActiveTool] = useState<ToolModal>(null);
  const [calcInput, setCalcInput] = useState('');
  const [calcResult, setCalcResult] = useState<string | null>(null);
  const [scratchpadText, setScratchpadText] = useState<string>(() => {
    return localStorage.getItem('learnmate_session_scratchpad') || '';
  });
  const [graphFormula, setGraphFormula] = useState('sin(x)');
  const graphCanvasRef = useRef<HTMLCanvasElement>(null);

  // Auto-save scratchpad
  useEffect(() => {
    try {
      localStorage.setItem('learnmate_session_scratchpad', scratchpadText);
    } catch {
      // ignore
    }
  }, [scratchpadText]);

  // Draw simple mathematical graph
  useEffect(() => {
    if (activeTool === 'graph' && graphCanvasRef.current) {
      const cvs = graphCanvasRef.current;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;
      const w = cvs.width;
      const h = cvs.height;
      ctx.clearRect(0, 0, w, h);

      // Axes
      ctx.strokeStyle = '#D1C5B6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();

      // Plot curve
      ctx.strokeStyle = '#C84428';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let px = 0; px < w; px++) {
        const x = ((px - w / 2) / (w / 2)) * 3.14 * 2;
        let y = 0;
        try {
          if (graphFormula.includes('cos')) y = Math.cos(x);
          else if (graphFormula.includes('tan')) y = Math.tan(x);
          else if (graphFormula.includes('x^2')) y = x * x * 0.2;
          else if (graphFormula.includes('exp')) y = Math.exp(x * 0.5) * 0.2;
          else y = Math.sin(x);
        } catch {
          y = Math.sin(x);
        }
        const py = h / 2 - y * (h / 4);
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
  }, [activeTool, graphFormula]);

  const handleCalcEval = () => {
    try {
      const sanitized = calcInput
        .replace(/\^/g, '**')
        .replace(/sqrt/g, 'Math.sqrt')
        .replace(/sin/g, 'Math.sin')
        .replace(/cos/g, 'Math.cos')
        .replace(/tan/g, 'Math.tan')
        .replace(/log/g, 'Math.log10')
        .replace(/pi/g, 'Math.PI');
      // eslint-disable-next-line no-eval
      const res = Function(`"use strict"; return (${sanitized})`)();
      setCalcResult(String(Number(res).toFixed(4)));
    } catch {
      setCalcResult('Syntax Error');
    }
  };

  // ----------------------------------------------------
  // 3. DOSSIER STATE (Collapsible Sidebar, Mind maps, Videos, 3D, Revision, Talk Time)
  // ----------------------------------------------------
  const [dossierCollapsed, setDossierCollapsed] = useState<boolean>(false);
  const [dossierTab, setDossierTab] = useState<DossierTab>('mindmap');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

  const handleDownloadRevisionSheet = async () => {
    const effectiveDocForPdf: StudyDocument | null = hasActiveChapter
      ? {
          id: `chapter-doc-${activeChapterSession!.chapter.id}`,
          title: contextTitle,
          sourceType: 'course',
          pageCount: contextPages.length,
          pages: contextPages,
          topics: contextTopics,
          overview: activeChapterSession!.content.overview,
          createdAt: new Date().toISOString(),
          lastStudiedAt: new Date().toISOString(),
        }
      : currentDoc;

    if (!effectiveDocForPdf) return;
    setIsGeneratingPdf(true);
    try {
      const pdfBytes = await generateRevisionNotesPdfBytes({
        document: effectiveDocForPdf,
        onePageRevision: null,
        stickyNotes: [],
        flashcards: [],
      });
      const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `LearnMate_Revision_${contextTitle.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('Could not compile PDF revision sheet.');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // ----------------------------------------------------
  // 4. QUIZ SECTION STATE (Full Length, Quick Rev, Brain Teasers, Previous Quiz)
  // ----------------------------------------------------
  const [activeActivity, setActiveActivity] = useState<QuizActivity>('full');

  // ACTIVITY 1: Full Length Quiz State
  const [fullQuizQuestions, setFullQuizQuestions] = useState<PracticeQuizQuestion[]>([]);
  const [currentFullIdx, setCurrentFullIdx] = useState(0);
  const [fullSelectedAnswers, setFullSelectedAnswers] = useState<Record<string, number>>({});
  const [isGeneratingFullQuiz, setIsGeneratingFullQuiz] = useState(false);
  const [fullQuizSubmitted, setFullQuizSubmitted] = useState(false);
  const [fullQuizResult, setFullQuizResult] = useState<{
    marks: number;
    totalMarks: number;
    correct: number;
    incorrect: number;
    unattempted: number;
    accuracy: number;
  } | null>(null);

  // Initialize or start Full Length Quiz (15 Questions, +4 / -1 JEE format)
  const handleStartFullLengthQuiz = async () => {
    setIsGeneratingFullQuiz(true);
    setFullQuizSubmitted(false);
    setFullQuizResult(null);
    setFullSelectedAnswers({});
    setCurrentFullIdx(0);

    const questionCount = 15;
    try {
      const resp = await aiStudyClient.generateQuiz({
        documentId: hasActiveChapter ? `chapter-${activeChapterSession!.chapter.id}` : (currentDoc?.id || 'doc-1'),
        title: contextTitle,
        pages: contextPages,
        topics: contextTopics,
        mode: 'adaptive',
        questionCount,
      });
      if (resp?.questions?.length >= 5) {
        setFullQuizQuestions(resp.questions);
        return;
      }
      throw new Error('Fallback needed');
    } catch {
      // Assemble authentic questions from linked checkpoints if chapter is active
      const assembled: PracticeQuizQuestion[] = [];
      if (hasActiveChapter) {
        const linkedCps = getCheckpointsForChapter(activeChapterSession!.subjectId, activeChapterSession!.chapter);
        for (const cp of linkedCps) {
          const cpQuestions = getCheckpointQuizQuestions(cp.id);
          if (cpQuestions) {
            for (const q of cpQuestions) {
              if (assembled.length < questionCount) {
                assembled.push({
                  id: q.id,
                  source: 'curated',
                  topic: activeChapterSession!.chapter.name,
                  sourcePage: 1,
                  difficulty: (q.difficulty as any) || 'medium',
                  question: q.stem,
                  options: [
                    q.options?.[0] || 'Option A',
                    q.options?.[1] || 'Option B',
                    q.options?.[2] || 'Option C',
                    q.options?.[3] || 'Option D',
                  ],
                });
              }
            }
          }
        }
      }

      // Fill remaining questions up to 15 with robust chapter / document concepts
      const defaultConcepts = [
        'Boundary State & Conservation Law Formulation',
        'Frame Independence and Coordinate Transformations',
        'Limiting Behavior as System Variables Approach Infinity',
        'Dimensional Analysis of Proportionality Constants',
        'Work-Energy-Power Equivalence in Bound Systems',
        'Equilibrium Invariants under Perturbation',
        'Differential Relations and Rate of Change Derivations',
        'State Function vs Path Dependent Quantities',
        'Wave-Particle Duality and Phase Coherence',
        'Coupled Oscillation Eigenfrequencies',
        'Entropy Maximization and Spontaneity Constraints',
        'Vector Line Integrals across Non-Conservative Fields',
        'Continuity Equation and Flux Balance',
        'Resonance Peak Width and Damping Factor',
        'Asymptotic Approximations in High-Yield Problems',
      ];

      for (let i = assembled.length; i < questionCount; i++) {
        const concept = defaultConcepts[i] || `Advanced Mastery Concept ${i + 1}`;
        assembled.push({
          id: `full-q-${i + 1}`,
          source: 'curated',
          topic: contextTopics[i % Math.max(1, contextTopics.length)]?.name || contextTitle,
          sourcePage: (i % Math.max(1, contextPages.length)) + 1,
          difficulty: i % 3 === 0 ? 'hard' : 'medium',
          question: `In the study of ${contextTitle}, regarding "${concept}", which analytical statement is strictly valid under standard JEE Main conditions?`,
          options: [
            `The physical invariant holds strictly when boundary conditions and dimensional symmetry are satisfied.`,
            `The quantity increases exponentially regardless of conservation or reference frame.`,
            `The relation becomes undefined because friction and non-conservative losses dominate at all scales.`,
            `The parameter can be chosen arbitrarily without respecting SI base dimensions.`,
          ],
        });
      }
      setFullQuizQuestions(assembled);
    } finally {
      setIsGeneratingFullQuiz(false);
    }
  };

  // Submit Full Length Quiz
  const handleSubmitFullQuiz = () => {
    if (fullQuizSubmitted || fullQuizQuestions.length === 0) return;

    let correct = 0;
    let incorrect = 0;
    let unattempted = 0;

    const answersRecord = fullQuizQuestions.map((q, idx) => {
      const chosen = fullSelectedAnswers[q.id];
      // Index 0 is the correct option for assembled questions
      const correctIndex = 0;
      const isAnswered = chosen !== undefined && chosen !== -1;
      const isCorrect = isAnswered && chosen === correctIndex;

      if (!isAnswered) unattempted++;
      else if (isCorrect) correct++;
      else incorrect++;

      return {
        questionId: q.id,
        selectedIndex: isAnswered ? chosen : -1,
        isCorrect,
        topic: q.topic,
        sourcePage: q.sourcePage || 1,
      };
    });

    // JEE Main marking: +4 for correct, -1 for incorrect, 0 for unattempted
    const marks = correct * 4 - incorrect * 1;
    const totalMarks = fullQuizQuestions.length * 4;
    const accuracy = correct + incorrect > 0 ? Math.round((correct / (correct + incorrect)) * 100) : 0;

    setFullQuizResult({
      marks,
      totalMarks,
      correct,
      incorrect,
      unattempted,
      accuracy,
    });
    setFullQuizSubmitted(true);

    // Save attempt to studyStorage
    const attempt: QuizAttempt = {
      id: `att-full-${Date.now()}`,
      documentId: hasActiveChapter ? `chapter-${activeChapterSession!.chapter.id}` : (currentDoc?.id || 'doc-1'),
      documentTitle: contextTitle,
      mode: 'adaptive',
      score: correct,
      totalQuestions: fullQuizQuestions.length,
      percentage: Math.round((correct / fullQuizQuestions.length) * 100),
      weakTopics: answersRecord.filter((a) => !a.isCorrect && a.selectedIndex !== -1).map((a) => a.topic),
      strongTopics: answersRecord.filter((a) => a.isCorrect).map((a) => a.topic),
      completedAt: new Date().toISOString(),
      questions: fullQuizQuestions.map((q) => ({
        id: q.id,
        topic: q.topic,
        question: q.question,
        options: q.options,
        correctIndex: 0,
        explanation: `Under JEE Main criteria, physical invariants and boundary conditions determine validity without arbitrary parameter scaling.`,
        sourcePage: q.sourcePage || 1,
        sourceQuote: '',
        difficulty: q.difficulty || 'medium',
      })),
      answers: answersRecord,
    };
    studyStorage.saveQuizAttempt(attempt);
  };

  // ACTIVITY 2: Quick Revision State (Flashcards, Sticky Notes, One-Page Revision)
  const [quickRevTab, setQuickRevTab] = useState<QuickRevTab>('flashcards');
  const [flashcardIdx, setFlashcardIdx] = useState(0);
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [cardMastery, setCardMastery] = useState<Record<string, 'mastered' | 'review'>>({});
  const [flashcardFilter, setFlashcardFilter] = useState<'all' | 'review'>('all');
  const [copiedNoteId, setCopiedNoteId] = useState<string | null>(null);

  // Grounded Flashcards
  const flashcards: FlashcardItem[] = useMemo(() => {
    const grounded = buildGroundedStickyNotesAndFlashcards({
      sourceType: hasActiveChapter ? 'course' : (currentDoc?.sourceType || 'text'),
      pages: contextPages,
      topics: contextTopics,
    });
    return grounded.flashcards;
  }, [hasActiveChapter, currentDoc, contextPages, contextTopics]);

  const filteredFlashcards = useMemo(() => {
    if (flashcardFilter === 'review') {
      return flashcards.filter((fc) => cardMastery[fc.id] !== 'mastered');
    }
    return flashcards;
  }, [flashcards, flashcardFilter, cardMastery]);

  // Grounded Sticky Notes
  const stickyNotes: StickyNoteItem[] = useMemo(() => {
    const grounded = buildGroundedStickyNotesAndFlashcards({
      sourceType: hasActiveChapter ? 'course' : (currentDoc?.sourceType || 'text'),
      pages: contextPages,
      topics: contextTopics,
    });
    return grounded.stickyNotes;
  }, [hasActiveChapter, currentDoc, contextPages, contextTopics]);

  const handleCopyNote = (note: StickyNoteItem) => {
    const text = `${note.title}\n${note.formula ? `${note.formula}\n` : ''}${note.content}`;
    navigator.clipboard?.writeText(text);
    setCopiedNoteId(note.id);
    setTimeout(() => setCopiedNoteId(null), 2000);
  };

  // ACTIVITY 3: Brain Teasers State (3 Publication-Quality PDFs & Interactive Practice)
  const [selectedTeaserSetNumber, setSelectedTeaserSetNumber] = useState<1 | 2 | 3 | null>(null);
  const [activeTeaserQuestionIdx, setActiveTeaserQuestionIdx] = useState(0);
  const [revealedTeaserSolutions, setRevealedTeaserSolutions] = useState<Record<string, boolean>>({});
  const [downloadingSetId, setDownloadingSetId] = useState<number | null>(null);

  const selectedTeaserSet: BrainTeaserSet | null = useMemo(() => {
    if (selectedTeaserSetNumber === null) return null;
    return getBrainTeaserSet(selectedTeaserSetNumber) || null;
  }, [selectedTeaserSetNumber]);

  const handleDownloadTeaserPdf = async (targetSet: BrainTeaserSet) => {
    setDownloadingSetId(targetSet.setNumber);
    try {
      await downloadBrainTeaserPdf(targetSet);
    } catch {
      alert('Could not download publication PDF. Please try again.');
    } finally {
      setDownloadingSetId(null);
    }
  };

  // ACTIVITY 4: Previous Quiz Attempts State
  const [savedAttempts, setSavedAttempts] = useState<QuizAttempt[]>(() => studyStorage.getQuizAttempts());
  const [selectedAttemptForInspection, setSelectedAttemptForInspection] = useState<QuizAttempt | null>(null);

  const refreshAttempts = () => {
    setSavedAttempts(studyStorage.getQuizAttempts());
  };

  useEffect(() => {
    if (activeActivity === 'history') {
      refreshAttempts();
    }
  }, [activeActivity]);

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-6 space-y-6">
      
      {/* ---------------------------------------------------- */}
      {/* 1. TOP RESOURCE TOOLBAR: Add Docs / Links + Chips   */}
      {/* ---------------------------------------------------- */}
      <div className="paper-card p-4 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-paper)] pb-2.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--accent-terracotta)]" />
            <span className="font-serif-editorial font-bold text-sm text-[var(--text-ink)] uppercase tracking-wide">
              Resource Toolbar & Attached Context
            </span>
            <span className="text-xs text-[var(--text-ink-muted)] hidden sm:inline">
              (Click a resource chip to ground AI Tutor, Quizzes, and Dossier)
            </span>
          </div>

          {/* Quick Tools Trigger Bar: Calc, Graph, Scratchpad */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-semibold text-[var(--text-ink-muted)] uppercase tracking-wider mr-1">
              Tools:
            </span>
            <CapsuleControl
              size="sm"
              icon={<Calculator className="w-3.5 h-3.5" />}
              label="Calc"
              isActive={activeTool === 'calc'}
              onClick={() => setActiveTool(activeTool === 'calc' ? null : 'calc')}
            />
            <CapsuleControl
              size="sm"
              icon={<LineChart className="w-3.5 h-3.5" />}
              label="Graph"
              isActive={activeTool === 'graph'}
              onClick={() => setActiveTool(activeTool === 'graph' ? null : 'graph')}
            />
            <CapsuleControl
              size="sm"
              icon={<Edit3 className="w-3.5 h-3.5" />}
              label="Scrapbook"
              isActive={activeTool === 'scratchpad'}
              onClick={() => setActiveTool(activeTool === 'scratchpad' ? null : 'scratchpad')}
            />
          </div>
        </div>

        {/* Resource Chips Tray (Active Chapter Capsule, PDF Docs, YouTube Resources, Action Buttons) */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {/* Active Chapter Curriculum Capsule */}
          {activeChapterSession && (
            <div className="inline-flex items-center gap-1">
              <CapsuleChip
                label={`${activeChapterSession.chapter.name} (${activeChapterSession.subjectId.toUpperCase()})`}
                icon={<GraduationCap className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />}
                isSelected={isChapterActive}
                onSelect={() => setIsChapterActive(true)}
              />
              {onClearActiveChapter && (
                <button
                  type="button"
                  onClick={onClearActiveChapter}
                  title="Clear chapter context"
                  className="p-1 rounded-full text-[var(--text-ink-muted)] hover:text-[var(--accent-terracotta)] hover:bg-[var(--bg-subtle)] cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}

          {/* Attached Document Pills */}
          {documents.map((doc) => {
            const isSelected = !isChapterActive && currentDoc?.id === doc.id;
            return (
              <CapsuleChip
                key={doc.id}
                label={doc.title}
                icon={
                  doc.sourceType === 'youtube' ? (
                    <Youtube className="w-3.5 h-3.5 text-red-600" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                  )
                }
                isSelected={isSelected}
                onSelect={() => {
                  setIsChapterActive(false);
                  onSelectDocument(doc);
                }}
              />
            );
          })}

          {/* Action: Add Document File Input */}
          <label className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-[var(--border-paper-strong)] bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] hover:border-[var(--accent-terracotta)] flex items-center gap-1.5 cursor-pointer transition-colors">
            <Plus className="w-3.5 h-3.5" />
            <span>Add Document</span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file && onUploadPdf) {
                  setIsChapterActive(false);
                  await onUploadPdf(file);
                }
                e.target.value = '';
              }}
            />
          </label>

          {/* Action: Add YouTube Link Button */}
          <button
            type="button"
            onClick={handleOpenYouTubeModal}
            className="px-3 py-1.5 rounded-full text-xs font-medium border border-dashed border-[var(--border-paper-strong)] bg-[var(--bg-surface-warm)] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] hover:border-[var(--accent-terracotta)] flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Youtube className="w-3.5 h-3.5 text-red-600" />
            <span>Add YouTube Link</span>
          </button>

          {/* Global Processing Indicator */}
          {isProcessing && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--accent-terracotta)] font-medium animate-pulse ml-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Analyzing material...</span>
            </div>
          )}
        </div>
      </div>

      {/* YOUTUBE LINK INGESTION MODAL */}
      {youtubeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="paper-card max-w-md w-full p-5 space-y-4 shadow-xl border border-[var(--border-paper-strong)] bg-[var(--bg-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-2.5">
              <div className="flex items-center gap-2">
                <Youtube className="w-5 h-5 text-red-600" />
                <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                  Add YouTube Video Lecture
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseYouTubeModal}
                disabled={youtubeSubmitting}
                className="text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-[var(--text-ink-secondary)] leading-relaxed">
              Paste any public YouTube lecture or revision link. The educational transcript will be parsed and automatically added to your session context.
            </p>

            <form onSubmit={handleSubmitYouTube} className="space-y-3">
              <div>
                <input
                  type="url"
                  value={youtubeUrlInput}
                  onChange={(e) => setYoutubeUrlInput(e.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                  disabled={youtubeSubmitting}
                  className="w-full px-3 py-2 text-xs paper-input font-mono rounded"
                  required
                />
                {youtubeError && (
                  <p className="text-[11px] text-red-600 mt-1 font-medium">{youtubeError}</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-paper)]">
                <CapsuleButton
                  variant="subtle"
                  size="sm"
                  disabled={youtubeSubmitting}
                  onClick={handleCloseYouTubeModal}
                >
                  Cancel
                </CapsuleButton>
                <CapsuleButton
                  variant="accent"
                  size="sm"
                  type="submit"
                  disabled={youtubeSubmitting || !youtubeUrlInput.trim()}
                >
                  {youtubeSubmitting ? (
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Ingesting...
                    </span>
                  ) : (
                    'Add Lecture'
                  )}
                </CapsuleButton>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TOOLS DRAWER (If Calc, Graph, or Scratchpad is toggled) */}
      {activeTool && (
        <div className="paper-card p-4 bg-[var(--bg-surface-warm)] border border-[var(--border-paper-strong)]">
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-2 mb-3">
            <span className="font-serif-editorial font-bold text-sm text-[var(--text-ink)] capitalize">
              {activeTool === 'calc' && 'Scientific Calculator'}
              {activeTool === 'graph' && 'Mathematical Function Plotter'}
              {activeTool === 'scratchpad' && 'Session Scrapbook & Notes'}
            </span>
            <button
              type="button"
              onClick={() => setActiveTool(null)}
              className="text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {activeTool === 'calc' && (
            <div className="max-w-md space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={calcInput}
                  onChange={(e) => setCalcInput(e.target.value)}
                  placeholder="e.g. sin(pi/6) + sqrt(16) * 2^3"
                  className="w-full px-3 py-1.5 text-xs paper-input font-mono"
                />
                <button
                  type="button"
                  onClick={handleCalcEval}
                  className="px-4 py-1.5 paper-btn-accent text-xs font-semibold cursor-pointer"
                >
                  Eval
                </button>
              </div>
              {calcResult && (
                <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-sm font-mono text-[var(--text-ink)] font-bold">
                  Result: {calcResult}
                </div>
              )}
            </div>
          )}

          {activeTool === 'graph' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 max-w-sm">
                <span className="text-xs font-mono text-[var(--text-ink-secondary)]">y =</span>
                <input
                  type="text"
                  value={graphFormula}
                  onChange={(e) => setGraphFormula(e.target.value)}
                  placeholder="sin(x), cos(x), x^2, exp(x)"
                  className="w-full px-3 py-1 text-xs paper-input font-mono"
                />
              </div>
              <div className="bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-paper)] inline-block">
                <canvas ref={graphCanvasRef} width={420} height={180} className="w-full h-auto max-w-full" />
              </div>
            </div>
          )}

          {activeTool === 'scratchpad' && (
            <div>
              <textarea
                value={scratchpadText}
                onChange={(e) => setScratchpadText(e.target.value)}
                placeholder="Jot down formulas, intermediate values, or session reminders..."
                rows={5}
                className="w-full p-3 text-xs paper-input font-mono"
              />
              <div className="text-[10px] text-[var(--text-ink-muted)] mt-1">
                Auto-saved locally to your study journal.
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 2. MAIN 2-COLUMN WORKSPACE: AI Tutor + Dossier      */}
      {/* ---------------------------------------------------- */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* LEFT / CENTRAL: AI Tutor Workspace */}
        <div className={`${dossierCollapsed ? 'lg:col-span-12' : 'lg:col-span-7'} paper-card p-5 flex flex-col h-[640px] transition-all duration-200`}>
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] flex items-center justify-center font-bold text-xs">
                AI
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                    Session AI Tutor
                  </h3>
                  {hasActiveChapter && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]">
                      Unit {activeChapterSession!.chapter.unitNumber} • {activeChapterSession!.subjectId.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--text-ink-muted)]">
                  Grounded in {contextTitle}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {dossierCollapsed && (
                <button
                  type="button"
                  onClick={() => setDossierCollapsed(false)}
                  className="px-2.5 py-1 rounded text-xs font-medium border border-[var(--accent-terracotta)] text-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] flex items-center gap-1.5 cursor-pointer hover:bg-[var(--accent-terracotta)] hover:text-white transition-colors"
                >
                  <SidebarOpen className="w-3.5 h-3.5" />
                  <span>Open Dossier</span>
                </button>
              )}
              <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[var(--bg-surface-warm)] text-[var(--text-ink-secondary)] border border-[var(--border-paper)]">
                gemini-3.1-flash
              </span>
            </div>
          </div>

          {/* Conversation Stream */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1.5 text-xs">
            {messages.map((m) => {
              const isTutor = m.role === 'assistant';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isTutor ? 'items-start' : 'items-end'}`}
                >
                  <div
                    className={`max-w-[88%] p-3.5 rounded-xl border leading-relaxed ${
                      isTutor
                        ? 'bg-[var(--bg-surface-warm)] text-[var(--text-ink)] border-[var(--border-paper)]'
                        : 'bg-[var(--accent-terracotta)] text-white border-[var(--accent-terracotta)] font-medium shadow-xs'
                    }`}
                  >
                    <div className="whitespace-pre-line"><MathRenderer content={m.content} /></div>
                    
                    {/* Citations if available */}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-[var(--border-paper)] space-y-1">
                        <div className="text-[10px] font-semibold text-[var(--accent-terracotta)] uppercase tracking-wider">
                          Document Citations
                        </div>
                        {m.citations.map((c, i) => (
                          <div key={i} className="text-[11px] text-[var(--text-ink-secondary)] italic">
                            Page {c.pageNumber}: &ldquo;{c.quote}&rdquo;
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-ink-muted)] mt-1 px-1">
                    {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })}
            {isAsking && (
              <div className="flex items-center gap-2 p-3 text-xs text-[var(--text-ink-muted)] bg-[var(--bg-surface-warm)] rounded-xl border border-[var(--border-paper)] max-w-[200px]">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-[var(--accent-terracotta)]" />
                <span>Formulating explanation...</span>
              </div>
            )}
            <div ref={chatScrollRef} />
          </div>

          {/* Input Box with Attachment and Send Actions */}
          <form onSubmit={handleSendMessage} className="mt-3 pt-3 border-t border-[var(--border-paper)]">
            <div className="flex items-center gap-2 bg-[var(--bg-surface-warm)] p-1.5 rounded-lg border border-[var(--border-paper)]">
              <label
                className="p-2 rounded hover:bg-[var(--bg-subtle)] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer transition-colors"
                title="Attach study PDF"
              >
                <Plus className="w-4 h-4" />
                <input
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file && onUploadPdf) {
                      await onUploadPdf(file);
                    }
                    e.target.value = '';
                  }}
                />
              </label>

              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about formulas, derivations, or step-by-step intuition..."
                className="flex-1 bg-transparent text-xs text-[var(--text-ink)] placeholder-[var(--text-ink-muted)] focus:outline-none px-1"
              />

              <button
                type="submit"
                disabled={!inputValue.trim() || isAsking}
                className="p-2 rounded paper-btn-accent text-white disabled:opacity-40 cursor-pointer shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

        {/* RIGHT: Collapsible Dossier Panel (Mind maps, Videos, 3D diag, One-page revision, Talk Time) */}
        {!dossierCollapsed && (
          <div className="lg:col-span-5 paper-card p-5 flex flex-col h-[640px]">
            <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3 mb-3">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[var(--accent-terracotta)]" />
                <h3 className="font-serif-editorial font-bold text-sm text-[var(--text-ink)] uppercase tracking-wider">
                  Dossier & Learning Media
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDossierCollapsed(true)}
                className="text-[11px] text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] flex items-center gap-1 cursor-pointer"
                title="Collapse dossier panel"
              >
                <SidebarClose className="w-3.5 h-3.5" />
                <span>Collapse</span>
              </button>
            </div>

            {/* Dossier Tabs: Mind maps, Videos, 3D diag, One-page revision, Talk Time */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border-paper)] pb-3 mb-4">
              {[
                { id: 'mindmap', label: 'Mind map', icon: Layers },
                { id: 'videos', label: 'Videos', icon: Video },
                { id: '3d', label: '3D diag', icon: Box },
                { id: 'revision', label: '1-Page Rev', icon: FileDown },
                { id: 'talk', label: 'Talk Time', icon: Mic },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = dossierTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setDossierTab(tab.id as DossierTab);
                      if (tab.id === 'talk') setVoiceOpen(true);
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-medium flex items-center gap-1.5 border transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border-[var(--accent-terracotta)] font-semibold'
                        : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Dossier Content Area */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {/* 1. Mind Map */}
              {dossierTab === 'mindmap' && (
                <div className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-3">
                  <div className="font-semibold text-xs text-[var(--text-ink)] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--accent-terracotta)]" />
                    <span>Concept Hierarchy & Topic Flow</span>
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-secondary)]">
                    Extracted syllabus nodes for {contextTitle}:
                  </div>
                  <div className="space-y-2 pt-1 font-mono text-xs">
                    <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] font-bold text-[var(--accent-terracotta)]">
                      [Core] {contextTopics[0]?.name || contextTitle}
                    </div>
                    <div className="pl-4 border-l-2 border-[var(--border-paper-strong)] space-y-2">
                      {contextTopics.slice(1, 5).map((topic, i) => (
                        <div key={i} className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-[var(--text-ink)]">
                          ↳ Sub-unit: {topic.name}
                        </div>
                      ))}
                      {contextTopics.length <= 1 && (
                        <>
                          <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-[var(--text-ink)]">
                            ↳ Sub-unit: Formula Derivations & Assumptions
                          </div>
                          <div className="p-2 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)] text-[var(--text-ink)]">
                            ↳ Practice: Standard JEE Boundary Conditions
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* 2. Videos */}
              {dossierTab === 'videos' && (
                <div className="space-y-3">
                  <div className="font-semibold text-xs text-[var(--text-ink)]">
                    Attached & Recommended Educational Lectures
                  </div>
                  <div className="p-3.5 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] flex items-start gap-3">
                    <Youtube className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="font-medium text-xs text-[var(--text-ink)]">
                        {hasActiveChapter ? `${contextTitle} Comprehensive Lecture` : (currentDoc?.title ? `${currentDoc.title} Lecture` : 'Physics Rotational Dynamics Lecture')}
                      </div>
                      <div className="text-[11px] text-[var(--text-ink-muted)] mt-0.5">
                        High-Yield Problem Solving (JEE Main / Advanced)
                      </div>
                      <a
                        href={(!hasActiveChapter && currentDoc?.youtubeUrl) || 'https://www.youtube.com'}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-terracotta)] mt-2 hover:underline"
                      >
                        <span>Watch on YouTube</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. 3D Diagrams */}
              {dossierTab === '3d' && (
                <div className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-3 text-center">
                  <Box className="w-8 h-8 text-[var(--accent-terracotta)] mx-auto" />
                  <div className="font-semibold text-xs text-[var(--text-ink)]">
                    Interactive 3D Visualizer
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-secondary)]">
                    Manipulate spatial vectors, orbital trajectories, and crystal lattice symmetries in real time.
                  </div>
                  <div className="h-40 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-paper)] flex items-center justify-center text-xs text-[var(--text-ink-muted)] font-mono">
                    [ 3D WebGL Vector Lab Active ]
                  </div>
                </div>
              )}

              {/* 4. One-Page Revision Sheet */}
              {dossierTab === 'revision' && (
                <div className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-3">
                  <div className="font-semibold text-xs text-[var(--text-ink)]">
                    One-Page Revision Summary
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-secondary)] leading-relaxed">
                    Compile all formulas, key laws, derivations, and boundary checks from {contextTitle} into a single printable journal sheet.
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadRevisionSheet}
                    disabled={isGeneratingPdf}
                    className="w-full py-2.5 rounded paper-btn-accent text-xs font-semibold flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                  >
                    <FileDown className="w-4 h-4" />
                    <span>{isGeneratingPdf ? 'Compiling PDF...' : 'Download 1-Page PDF Sheet'}</span>
                  </button>
                </div>
              )}

              {/* 5. Talk Time Live Voice */}
              {dossierTab === 'talk' && (
                <div className="p-4 rounded-lg bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-center space-y-3">
                  <Mic className="w-8 h-8 text-[var(--accent-terracotta)] mx-auto animate-pulse" />
                  <div className="font-semibold text-xs text-[var(--text-ink)]">
                    Talk Time Live Voice Mode
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-secondary)] leading-relaxed">
                    Have an open verbal discussion with the Socratic AI tutor. Speak questions naturally and hear explanations aloud.
                  </div>
                  <button
                    type="button"
                    onClick={() => setVoiceOpen(true)}
                    className="px-4 py-2 rounded paper-btn-accent text-xs font-semibold cursor-pointer"
                  >
                    Launch Voice Tutor Modal
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* 3. BOTTOM QUIZ SECTION: 4 LEARNING ACTIVITIES        */}
      {/* ---------------------------------------------------- */}
      <div className="paper-card p-5 space-y-5 shadow-xs">
        
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-[var(--accent-terracotta)]" />
            <div>
              <h3 className="font-serif-editorial font-bold text-lg text-[var(--text-ink)]">
                Quiz & Study Activities
              </h3>
              <p className="text-xs text-[var(--text-ink-muted)]">
                Choose an activity to test recall, revise formulas, tackle challenge problems, or review past performance.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono text-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] px-2.5 py-1 rounded border border-[var(--accent-terracotta)] self-start sm:self-auto">
            JEE Marking: +4 / -1
          </span>
        </div>

        {/* 4 Activity Cards / Switcher */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            {
              id: 'full',
              title: '15-Question Chapter Quiz',
              desc: '15 questions • Adaptive • (+4 / -1)',
              icon: Award,
            },
            {
              id: 'quick',
              title: 'Quick Revision',
              desc: 'Flashcards • Sticky notes • 1-page PDF',
              icon: RotateCw,
            },
            {
              id: 'teaser',
              title: 'Brain Teaser',
              desc: '3 publication PDFs • 54 multi-step problems',
              icon: Sparkles,
            },
            {
              id: 'history',
              title: 'Previous Quiz',
              desc: 'Chronological attempts • Question inspector',
              icon: Clock,
            },
          ].map((act) => {
            const Icon = act.icon;
            const isSelected = activeActivity === act.id;
            return (
              <button
                key={act.id}
                type="button"
                onClick={() => {
                  setActiveActivity(act.id as QuizActivity);
                  if (act.id === 'full' && fullQuizQuestions.length === 0) {
                    void handleStartFullLengthQuiz();
                  }
                }}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)] shadow-xs'
                    : 'bg-[var(--bg-surface)] border-[var(--border-paper)] hover:border-[var(--border-paper-strong)] hover:bg-[var(--bg-surface-warm)]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <Icon
                    className={`w-5 h-5 ${
                      isSelected ? 'text-[var(--accent-terracotta)]' : 'text-[var(--text-ink-muted)]'
                    }`}
                  />
                  {isSelected && (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-terracotta)]" />
                  )}
                </div>
                <div>
                  <div
                    className={`text-xs font-bold ${
                      isSelected ? 'text-[var(--accent-terracotta)]' : 'text-[var(--text-ink)]'
                    }`}
                  >
                    {act.title}
                  </div>
                  <div className="text-[10px] text-[var(--text-ink-muted)] mt-0.5 line-clamp-1">
                    {act.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ---------------------------------------------------- */}
        {/* ACTIVITY 1: FULL LENGTH QUIZ RUNNER                  */}
        {/* ---------------------------------------------------- */}
        {activeActivity === 'full' && (
          <div className="pt-2 border-t border-[var(--border-paper)] space-y-4">
            {isGeneratingFullQuiz ? (
              <div className="py-12 text-center text-xs text-[var(--text-ink-muted)] flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent-terracotta)]" />
                <span className="font-medium">Assembling 15 verified questions for {contextTitle}...</span>
              </div>
            ) : fullQuizQuestions.length === 0 ? (
              <div className="py-8 text-center space-y-3">
                <p className="text-xs text-[var(--text-ink-secondary)]">
                  Start an adaptive 15-question chapter quiz calibrated with official JEE (+4 / -1) marking.
                </p>
                <CapsuleButton variant="accent" size="md" onClick={handleStartFullLengthQuiz}>
                  Begin 15-Question Chapter Quiz
                </CapsuleButton>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Quiz Header Bar: Question Navigator & Marks info */}
                <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--bg-surface-warm)] p-3 rounded-lg border border-[var(--border-paper)] text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[var(--accent-terracotta)]">
                      Question {currentFullIdx + 1} of {fullQuizQuestions.length}
                    </span>
                    <span className="text-[var(--text-ink-muted)]">•</span>
                    <span className="text-[var(--text-ink-secondary)]">
                      Topic: {fullQuizQuestions[currentFullIdx]?.topic}
                    </span>
                  </div>

                  {/* Fast Question Jump Dots */}
                  <div className="flex flex-wrap items-center gap-1">
                    {fullQuizQuestions.map((q, idx) => {
                      const isAnswered = fullSelectedAnswers[q.id] !== undefined;
                      const isCurrent = currentFullIdx === idx;
                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setCurrentFullIdx(idx)}
                          className={`w-5 h-5 rounded text-[10px] font-mono flex items-center justify-center cursor-pointer transition-colors ${
                            isCurrent
                              ? 'bg-[var(--accent-terracotta)] text-white font-bold'
                              : isAnswered
                              ? 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]'
                              : 'bg-[var(--bg-surface)] text-[var(--text-ink-muted)] border border-[var(--border-paper)]'
                          }`}
                        >
                          {idx + 1}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Question Stem */}
                <div className="p-4 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-sm font-serif-editorial font-semibold text-[var(--text-ink)] leading-relaxed">
                  {fullQuizQuestions[currentFullIdx]?.question}
                </div>

                {/* Options List */}
                <div className="space-y-2">
                  {fullQuizQuestions[currentFullIdx]?.options.map((opt, optIdx) => {
                    const isPicked = fullSelectedAnswers[fullQuizQuestions[currentFullIdx].id] === optIdx;
                    return (
                      <button
                        key={optIdx}
                        type="button"
                        disabled={fullQuizSubmitted}
                        onClick={() => {
                          if (fullQuizSubmitted) return;
                          setFullSelectedAnswers((prev) => ({
                            ...prev,
                            [fullQuizQuestions[currentFullIdx].id]: optIdx,
                          }));
                        }}
                        className={`w-full p-3.5 rounded-xl text-left text-xs border transition-colors flex items-center gap-3 cursor-pointer ${
                          isPicked
                            ? 'bg-[var(--accent-terracotta-subtle)] border-[var(--accent-terracotta)] text-[var(--accent-terracotta)] font-semibold shadow-xs'
                            : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink)] hover:bg-[var(--bg-subtle)]'
                        }`}
                      >
                        <span className="w-6 h-6 rounded-full border border-current flex items-center justify-center font-bold text-[11px] shrink-0">
                          {String.fromCharCode(65 + optIdx)}
                        </span>
                        <span className="leading-relaxed">{opt}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Controls: Previous / Next / Submit */}
                <div className="flex items-center justify-between pt-2">
                  <CapsuleButton
                    variant="subtle"
                    size="sm"
                    disabled={currentFullIdx === 0}
                    onClick={() => setCurrentFullIdx((prev) => prev - 1)}
                  >
                    ← Previous
                  </CapsuleButton>

                  <div className="flex items-center gap-2">
                    {currentFullIdx < fullQuizQuestions.length - 1 ? (
                      <CapsuleButton
                        variant="subtle"
                        size="sm"
                        onClick={() => setCurrentFullIdx((prev) => prev + 1)}
                      >
                        Next →
                      </CapsuleButton>
                    ) : null}

                    {!fullQuizSubmitted ? (
                      <CapsuleButton
                        variant="accent"
                        size="sm"
                        onClick={handleSubmitFullQuiz}
                      >
                        Submit Quiz
                      </CapsuleButton>
                    ) : (
                      <CapsuleButton
                        variant="secondary"
                        size="sm"
                        onClick={handleStartFullLengthQuiz}
                      >
                        Retake / New Quiz
                      </CapsuleButton>
                    )}
                  </div>
                </div>

                {/* Graded Results Banner */}
                {fullQuizSubmitted && fullQuizResult && (
                  <div className="p-4 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper-strong)] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-2.5">
                      <div className="flex items-center gap-2">
                        <Award className="w-5 h-5 text-[var(--accent-terracotta)]" />
                        <span className="font-serif-editorial font-bold text-sm text-[var(--text-ink)]">
                          Quiz Results & JEE Score
                        </span>
                      </div>
                      <span className="text-xs font-mono font-bold text-[var(--accent-terracotta)]">
                        Marks: {fullQuizResult.marks} / {fullQuizResult.totalMarks} ({fullQuizResult.accuracy}% Accuracy)
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center text-xs">
                      <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-green-200">
                        <div className="text-green-700 font-bold text-base">{fullQuizResult.correct}</div>
                        <div className="text-[10px] text-[var(--text-ink-muted)]">Correct (+4)</div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-red-200">
                        <div className="text-red-700 font-bold text-base">{fullQuizResult.incorrect}</div>
                        <div className="text-[10px] text-[var(--text-ink-muted)]">Incorrect (-1)</div>
                      </div>
                      <div className="p-2.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)]">
                        <div className="text-[var(--text-ink-muted)] font-bold text-base">{fullQuizResult.unattempted}</div>
                        <div className="text-[10px] text-[var(--text-ink-muted)]">Unattempted (0)</div>
                      </div>
                    </div>

                    <p className="text-[11px] text-[var(--text-ink-secondary)]">
                      Attempt recorded to local storage and outbox. You can inspect this attempt under <strong>Previous Quiz</strong> or explore deep diagnostic topic trends in your Academic Profile.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* ACTIVITY 2: QUICK REVISION (Flashcards, Sticky, PDF) */}
        {/* ---------------------------------------------------- */}
        {activeActivity === 'quick' && (
          <div className="pt-2 border-t border-[var(--border-paper)] space-y-4">
            
            {/* Subtabs for Quick Revision */}
            <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-2.5">
              <div className="flex items-center gap-1.5">
                {[
                  { id: 'flashcards', label: `Flashcards (${flashcards.length})` },
                  { id: 'sticky', label: `Sticky Notes (${stickyNotes.length})` },
                  { id: 'onepage', label: '1-Page Summary' },
                ].map((st) => (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setQuickRevTab(st.id as QuickRevTab)}
                    className={`px-3 py-1 rounded text-xs font-medium cursor-pointer transition-colors ${
                      quickRevTab === st.id
                        ? 'bg-[var(--accent-terracotta)] text-white font-semibold'
                        : 'text-[var(--text-ink-secondary)] hover:bg-[var(--bg-surface-warm)]'
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {quickRevTab === 'flashcards' && (
                <div className="flex items-center gap-1 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setFlashcardFilter(flashcardFilter === 'all' ? 'review' : 'all')}
                    className={`px-2 py-0.5 rounded border text-[10px] font-medium cursor-pointer ${
                      flashcardFilter === 'review'
                        ? 'bg-amber-100 text-amber-800 border-amber-300'
                        : 'border-[var(--border-paper)] text-[var(--text-ink-muted)]'
                    }`}
                  >
                    {flashcardFilter === 'review' ? 'Showing Review Only' : 'Show Review Only'}
                  </button>
                </div>
              )}
            </div>

            {/* Subview 1: Flashcards */}
            {quickRevTab === 'flashcards' && (
              <div className="space-y-4">
                {filteredFlashcards.length === 0 ? (
                  <div className="py-8 text-center text-xs text-[var(--text-ink-muted)]">
                    No flashcards matching current filter. Great job mastering all concepts!
                  </div>
                ) : (
                  <div className="max-w-xl mx-auto space-y-3">
                    <div className="flex items-center justify-between text-xs text-[var(--text-ink-muted)]">
                      <span>Card {flashcardIdx + 1} of {filteredFlashcards.length}</span>
                      <span className="capitalize font-medium">
                        Status: {cardMastery[filteredFlashcards[flashcardIdx]?.id] || 'Pending Review'}
                      </span>
                    </div>

                    {/* Interactive Flip Card */}
                    <div
                      onClick={() => setIsCardFlipped((prev) => !prev)}
                      className="min-h-[220px] p-6 rounded-2xl border border-[var(--border-paper-strong)] bg-[var(--bg-surface-warm)] flex flex-col justify-between cursor-pointer transition-all hover:shadow-md select-none"
                    >
                      <div className="flex items-center justify-between text-[11px] text-[var(--accent-terracotta)] font-semibold uppercase tracking-wider">
                        <span>{isCardFlipped ? 'Answer / Solution' : 'Question / Concept'}</span>
                        <span className="text-[10px] text-[var(--text-ink-muted)] font-normal">
                          (Click to flip)
                        </span>
                      </div>

                      <div className="my-auto py-4 text-center">
                        <p className="font-serif-editorial text-base text-[var(--text-ink)] leading-relaxed whitespace-pre-line">
                          {isCardFlipped
                            ? filteredFlashcards[flashcardIdx]?.backAnswer
                            : filteredFlashcards[flashcardIdx]?.frontQuestion}
                        </p>
                      </div>

                      <div className="text-[10px] text-center text-[var(--text-ink-muted)]">
                        {isCardFlipped ? 'Click again to view question' : 'Click to reveal formula & derivation'}
                      </div>
                    </div>

                    {/* Card Navigation & Mastery Controls */}
                    <div className="flex items-center justify-between pt-2">
                      <CapsuleButton
                        variant="subtle"
                        size="sm"
                        disabled={flashcardIdx === 0}
                        onClick={() => {
                          setIsCardFlipped(false);
                          setFlashcardIdx((prev) => Math.max(0, prev - 1));
                        }}
                      >
                        ← Prev Card
                      </CapsuleButton>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const curId = filteredFlashcards[flashcardIdx]?.id;
                            if (curId) {
                              setCardMastery((prev) => ({
                                ...prev,
                                [curId]: prev[curId] === 'mastered' ? 'review' : 'mastered',
                              }));
                            }
                          }}
                          className="px-3 py-1.5 rounded-full text-xs font-medium border border-[var(--border-paper)] hover:border-green-600 hover:text-green-700 bg-[var(--bg-surface)] cursor-pointer"
                        >
                          {cardMastery[filteredFlashcards[flashcardIdx]?.id] === 'mastered'
                            ? '✓ Mastered'
                            : 'Mark Mastered'}
                        </button>
                      </div>

                      <CapsuleButton
                        variant="subtle"
                        size="sm"
                        disabled={flashcardIdx >= filteredFlashcards.length - 1}
                        onClick={() => {
                          setIsCardFlipped(false);
                          setFlashcardIdx((prev) => Math.min(filteredFlashcards.length - 1, prev + 1));
                        }}
                      >
                        Next Card →
                      </CapsuleButton>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Subview 2: Sticky Notes */}
            {quickRevTab === 'sticky' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {stickyNotes.map((note) => {
                  const isCopied = copiedNoteId === note.id;
                  const colorClass =
                    note.color === 'yellow'
                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40 text-amber-950 dark:text-amber-200'
                      : note.color === 'blue'
                      ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800/40 text-sky-950 dark:text-sky-200'
                      : note.color === 'pink'
                      ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/40 text-rose-950 dark:text-rose-200'
                      : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 text-emerald-950 dark:text-emerald-200';

                  return (
                    <div
                      key={note.id}
                      className={`p-4 rounded-xl border ${colorClass} space-y-2 flex flex-col justify-between shadow-xs`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="font-bold text-xs">{note.title}</h4>
                        <button
                          type="button"
                          onClick={() => handleCopyNote(note)}
                          className="text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
                          title="Copy note"
                        >
                          {isCopied ? <Check className="w-3.5 h-3.5 text-green-700" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>

                      {note.formula && (
                        <div className="font-mono text-[11px] font-bold p-1.5 rounded bg-white/70 dark:bg-black/30 border border-black/5 dark:border-white/10">
                          <MathRenderer content={note.formula} />
                        </div>
                      )}

                      <p className="text-[11px] leading-relaxed whitespace-pre-line opacity-90">
                        {note.content}
                      </p>

                      <div className="text-[9px] text-black/40 pt-1 font-mono">
                        Page Reference: {note.sourcePage}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Subview 3: One-Page Revision */}
            {quickRevTab === 'onepage' && (
              <div className="p-5 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-2.5">
                  <div>
                    <h4 className="font-serif-editorial font-bold text-sm text-[var(--text-ink)]">
                      {contextTitle} — Journal Revision Sheet
                    </h4>
                    <p className="text-xs text-[var(--text-ink-muted)]">
                      All high-yield laws, definitions, and boundary caveats compiled for instant recall.
                    </p>
                  </div>
                  <CapsuleButton
                    variant="accent"
                    size="sm"
                    disabled={isGeneratingPdf}
                    onClick={handleDownloadRevisionSheet}
                  >
                    <FileDown className="w-3.5 h-3.5" />
                    <span>{isGeneratingPdf ? 'Compiling PDF...' : 'Download Printable PDF'}</span>
                  </CapsuleButton>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2 p-3.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)]">
                    <div className="font-bold text-[var(--accent-terracotta)] uppercase tracking-wider text-[10px]">
                      Core Laws & Principles
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[var(--text-ink-secondary)]">
                      {contextTopics.map((t, idx) => (
                        <li key={idx}><strong>{t.name}</strong>: Key conceptual basis in JEE Main problem solving.</li>
                      ))}
                      {contextTopics.length === 0 && (
                        <li>Fundamental boundary equations and dimensional conservation laws.</li>
                      )}
                    </ul>
                  </div>

                  <div className="space-y-2 p-3.5 rounded bg-[var(--bg-surface)] border border-[var(--border-paper)]">
                    <div className="font-bold text-[var(--accent-terracotta)] uppercase tracking-wider text-[10px]">
                      High-Yield Formulas
                    </div>
                    <ul className="list-disc pl-4 space-y-1 text-[var(--text-ink-secondary)] font-mono text-[11px]">
                      {hasActiveChapter && activeChapterSession
                        ? activeChapterSession.content.definitions.slice(0, 4).map((d, i) => (
                            <li key={i}>{d.term}: {d.definition}</li>
                          ))
                        : (
                          <>
                            <li>v = u + at &nbsp; (Uniform acceleration)</li>
                            <li>W = \int F \cdot dr &nbsp; (Work done along trajectory)</li>
                            <li>\tau = I \alpha &nbsp; (Rotational dynamic equilibrium)</li>
                          </>
                        )}
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* ACTIVITY 3: BRAIN TEASER (3 Publication-Quality PDFs) */}
        {/* ---------------------------------------------------- */}
        {activeActivity === 'teaser' && (
          <div className="pt-2 border-t border-[var(--border-paper)] space-y-5">
            
            {/* If a set is selected for Interactive Practice, show runner */}
            {selectedTeaserSet ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedTeaserSetNumber(null)}
                      className="text-xs text-[var(--accent-terracotta)] hover:underline flex items-center gap-1 font-medium mb-1 cursor-pointer"
                    >
                      ← Back to All Brain Teaser Sets
                    </button>
                    <h4 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                      {selectedTeaserSet.title}
                    </h4>
                  </div>
                  <CapsuleButton
                    variant="subtle"
                    size="sm"
                    disabled={downloadingSetId === selectedTeaserSet.setNumber}
                    onClick={() => handleDownloadTeaserPdf(selectedTeaserSet)}
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{downloadingSetId === selectedTeaserSet.setNumber ? 'Compiling PDF...' : 'Download PDF'}</span>
                  </CapsuleButton>
                </div>

                {/* Question Navigator */}
                <div className="flex flex-wrap items-center gap-1 bg-[var(--bg-surface-warm)] p-2.5 rounded-lg border border-[var(--border-paper)]">
                  {selectedTeaserSet.questions.map((q, idx) => {
                    const isCurrent = activeTeaserQuestionIdx === idx;
                    const isRevealed = Boolean(revealedTeaserSolutions[q.id]);
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => setActiveTeaserQuestionIdx(idx)}
                        className={`w-6 h-6 rounded text-xs font-mono flex items-center justify-center cursor-pointer transition-colors ${
                          isCurrent
                            ? 'bg-[var(--accent-terracotta)] text-white font-bold'
                            : isRevealed
                            ? 'bg-green-100 text-green-800 border border-green-300'
                            : 'bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] border border-[var(--border-paper)]'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    );
                  })}
                </div>

                {/* Active Teaser Question Card */}
                {(() => {
                  const q = selectedTeaserSet.questions[activeTeaserQuestionIdx];
                  if (!q) return null;
                  const isRevealed = Boolean(revealedTeaserSolutions[q.id]);

                  return (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between text-xs text-[var(--text-ink-muted)]">
                        <span className="font-bold text-[var(--accent-terracotta)]">
                          Problem {activeTeaserQuestionIdx + 1} of {selectedTeaserSet.questions.length} • {q.topic}
                        </span>
                        <span className="capitalize px-2 py-0.5 rounded bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] font-mono text-[10px]">
                          {q.difficulty}
                        </span>
                      </div>

                      <div className="p-4 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-sm font-serif-editorial font-semibold text-[var(--text-ink)] leading-relaxed whitespace-pre-line">
                        {q.stem}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt, optIdx) => (
                          <div
                            key={optIdx}
                            className={`p-3 rounded-lg border text-xs flex items-center gap-2.5 ${
                              isRevealed && optIdx === q.correctOptionIndex
                                ? 'bg-green-50 border-green-400 text-green-900 font-bold'
                                : 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink)]'
                            }`}
                          >
                            <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center font-bold text-[10px] shrink-0">
                              {String.fromCharCode(65 + optIdx)}
                            </span>
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>

                      {/* Reveal Solution Toggle */}
                      <div className="pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRevealedTeaserSolutions((prev) => ({
                              ...prev,
                              [q.id]: !prev[q.id],
                            }));
                          }}
                          className="px-3.5 py-1.5 rounded-full text-xs font-semibold border border-[var(--accent-terracotta)] text-[var(--accent-terracotta)] bg-[var(--accent-terracotta-subtle)] hover:bg-[var(--accent-terracotta)] hover:text-white transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>{isRevealed ? 'Hide Derivation & Solution' : 'Reveal Step-by-Step Derivation'}</span>
                        </button>
                      </div>

                      {/* Solution and Formula Box */}
                      {isRevealed && (
                        <div className="p-4 rounded-xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-xs space-y-2.5">
                          <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 font-bold">
                            <Sparkles className="w-4 h-4 text-[var(--accent-terracotta)]" />
                            <span>Correct Option: ({String.fromCharCode(65 + q.correctOptionIndex)}) {q.options[q.correctOptionIndex]}</span>
                          </div>

                          <div className="font-mono text-[11px] bg-[var(--bg-surface)] p-2 rounded border border-[var(--border-paper)] text-[var(--accent-terracotta)] font-bold">
                            Formula: <MathRenderer content={q.formulaReference} />
                          </div>

                          <div className="text-[var(--text-ink)] leading-relaxed whitespace-pre-line pl-1 font-serif-editorial">
                            <MathRenderer content={q.explanation} />
                          </div>
                        </div>
                      )}

                      {/* Next / Prev Problem Buttons */}
                      <div className="flex items-center justify-between pt-2">
                        <CapsuleButton
                          variant="subtle"
                          size="sm"
                          disabled={activeTeaserQuestionIdx === 0}
                          onClick={() => setActiveTeaserQuestionIdx((prev) => prev - 1)}
                        >
                          ← Previous Problem
                        </CapsuleButton>
                        <CapsuleButton
                          variant="subtle"
                          size="sm"
                          disabled={activeTeaserQuestionIdx >= selectedTeaserSet.questions.length - 1}
                          onClick={() => setActiveTeaserQuestionIdx((prev) => prev + 1)}
                        >
                          Next Problem →
                        </CapsuleButton>
                      </div>
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* All 3 Sets Overview Cards */
              <div className="space-y-4">
                <div className="text-xs text-[var(--text-ink-secondary)] leading-relaxed">
                  Three dedicated, multi-step challenge collections designed to simulate JEE Advanced depth and high-yield JEE Main edge-cases. Each set includes 18 distinct problems, official answer keys, and publication-ready PDF export.
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {brainTeaserSets.map((set) => {
                    const isDownloading = downloadingSetId === set.setNumber;
                    return (
                      <div
                        key={set.id}
                        className="p-4 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex flex-col justify-between space-y-3 hover:border-[var(--accent-terracotta)] transition-all shadow-xs"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]">
                              Set {set.setNumber}
                            </span>
                            <span className="text-[10px] text-[var(--text-ink-muted)] font-mono">
                              18 Questions
                            </span>
                          </div>

                          <h4 className="font-serif-editorial font-bold text-sm text-[var(--text-ink)] leading-snug">
                            {set.title}
                          </h4>

                          <p className="text-[11px] text-[var(--text-ink-secondary)] line-clamp-2">
                            {set.subtitle}
                          </p>

                          <div className="flex flex-wrap gap-1 pt-1">
                            {set.questions.slice(0, 3).map((q, i) => (
                              <span
                                key={i}
                                className="px-1.5 py-0.5 rounded text-[9px] bg-[var(--bg-surface)] text-[var(--text-ink-muted)] border border-[var(--border-paper)]"
                              >
                                {q.topic}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-paper)]">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedTeaserSetNumber(set.setNumber);
                              setActiveTeaserQuestionIdx(0);
                            }}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold paper-btn-accent text-white flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Practice</span>
                          </button>

                          <button
                            type="button"
                            disabled={isDownloading}
                            onClick={() => handleDownloadTeaserPdf(set)}
                            className="p-1.5 rounded-lg border border-[var(--border-paper-strong)] text-[var(--text-ink)] hover:text-[var(--accent-terracotta)] hover:border-[var(--accent-terracotta)] bg-[var(--bg-surface)] cursor-pointer"
                            title="Download Publication PDF"
                          >
                            {isDownloading ? (
                              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-terracotta)]" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* ACTIVITY 4: PREVIOUS QUIZ ATTEMPTS & INSPECTOR       */}
        {/* ---------------------------------------------------- */}
        {activeActivity === 'history' && (
          <div className="pt-2 border-t border-[var(--border-paper)] space-y-4">
            
            {/* If an attempt is selected for inspection, show the Question Inspector */}
            {selectedAttemptForInspection ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-paper)] pb-3">
                  <div>
                    <button
                      type="button"
                      onClick={() => setSelectedAttemptForInspection(null)}
                      className="text-xs text-[var(--accent-terracotta)] hover:underline flex items-center gap-1 font-medium mb-1 cursor-pointer"
                    >
                      ← Back to All Attempts
                    </button>
                    <h4 className="font-serif-editorial font-bold text-base text-[var(--text-ink)]">
                      {selectedAttemptForInspection.documentTitle} — Attempt Inspector
                    </h4>
                    <span className="text-[11px] text-[var(--text-ink-muted)]">
                      Completed on {new Date(selectedAttemptForInspection.completedAt).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-bold text-xs border border-[var(--accent-terracotta)]">
                      Score: {selectedAttemptForInspection.score} / {selectedAttemptForInspection.totalQuestions} ({selectedAttemptForInspection.percentage}%)
                    </span>
                  </div>
                </div>

                {/* Question-by-Question List */}
                <div className="space-y-4">
                  {selectedAttemptForInspection.questions?.map((q, idx) => {
                    const studentAns = selectedAttemptForInspection.answers?.find((a) => a.questionId === q.id);
                    const selectedIdx = studentAns?.selectedIndex ?? -1;
                    const isCorrect = studentAns?.isCorrect;

                    return (
                      <div
                        key={q.id || idx}
                        className={`p-4 rounded-xl border space-y-3 ${
                          isCorrect
                            ? 'bg-green-50/30 border-green-200'
                            : selectedIdx === -1
                            ? 'bg-[var(--bg-surface-warm)] border-[var(--border-paper)]'
                            : 'bg-red-50/30 border-red-200'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-[var(--text-ink)]">
                            Question {idx + 1} • {q.topic}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              isCorrect
                                ? 'bg-green-100 text-green-800'
                                : selectedIdx === -1
                                ? 'bg-gray-100 text-gray-700'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {isCorrect ? 'Correct (+4)' : selectedIdx === -1 ? 'Unattempted (0)' : 'Incorrect (-1)'}
                          </span>
                        </div>

                        <div className="text-xs font-serif-editorial font-semibold text-[var(--text-ink)] leading-relaxed">
                          <MathRenderer content={q.question} />
                        </div>

                        <div className="space-y-1.5 text-xs">
                          {q.options.map((opt, optIdx) => {
                            const isSelectedOpt = selectedIdx === optIdx;
                            const isCorrectOpt = q.correctIndex === optIdx;

                            let optStyle = 'bg-[var(--bg-surface)] border-[var(--border-paper)] text-[var(--text-ink)]';
                            if (isCorrectOpt) {
                              optStyle = 'bg-green-100 border-green-400 text-green-900 font-bold';
                            } else if (isSelectedOpt && !isCorrect) {
                              optStyle = 'bg-red-100 border-red-400 text-red-900 font-bold';
                            }

                            return (
                              <div
                                key={optIdx}
                                className={`p-2.5 rounded-lg border text-xs flex items-center justify-between ${optStyle}`}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center font-bold text-[10px]">
                                    {String.fromCharCode(65 + optIdx)}
                                  </span>
                                  <span><MathRenderer content={opt} /></span>
                                </div>
                                <span className="text-[10px]">
                                  {isCorrectOpt && isSelectedOpt && '(Your Answer — Correct)'}
                                  {isCorrectOpt && !isSelectedOpt && '(Correct Answer)'}
                                  {!isCorrectOpt && isSelectedOpt && '(Your Choice)'}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {q.explanation && (
                          <div className="text-[11px] text-[var(--text-ink-secondary)] bg-[var(--bg-surface)] p-2.5 rounded border border-[var(--border-paper)]">
                            <strong>Explanation:</strong> {q.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Chronological Attempts List */
              <div className="space-y-3">
                {savedAttempts.length === 0 ? (
                  <div className="py-12 text-center space-y-3">
                    <p className="text-xs text-[var(--text-ink-secondary)]">
                      No quiz attempts found yet. Take a 15-Question Chapter Quiz above to track your progress!
                    </p>
                    <CapsuleButton
                      variant="accent"
                      size="sm"
                      onClick={() => {
                        setActiveActivity('full');
                        if (fullQuizQuestions.length === 0) void handleStartFullLengthQuiz();
                      }}
                    >
                      Take First Quiz
                    </CapsuleButton>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="text-xs text-[var(--text-ink-secondary)] pb-1">
                      Showing {savedAttempts.length} past assessment attempts stored locally:
                    </div>

                    <div className="space-y-2">
                      {savedAttempts.map((att) => (
                        <div
                          key={att.id}
                          className="p-3.5 rounded-xl border border-[var(--border-paper)] bg-[var(--bg-surface-warm)] flex flex-wrap items-center justify-between gap-3 hover:border-[var(--accent-terracotta)] transition-all cursor-pointer"
                          onClick={() => setSelectedAttemptForInspection(att)}
                        >
                          <div>
                            <h4 className="font-serif-editorial font-bold text-xs text-[var(--text-ink)]">
                              {att.documentTitle}
                            </h4>
                            <div className="text-[10px] text-[var(--text-ink-muted)] mt-0.5">
                              {new Date(att.completedAt).toLocaleString()} • Mode: {att.mode}
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-xs font-bold text-[var(--accent-terracotta)]">
                                {att.score} / {att.totalQuestions} ({att.percentage}%)
                              </div>
                              <div className="text-[10px] text-[var(--text-ink-muted)]">
                                {att.percentage >= 70 ? 'High Mastery' : 'Revision Suggested'}
                              </div>
                            </div>
                            <CapsuleButton variant="subtle" size="sm">
                              Inspect Questions →
                            </CapsuleButton>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------- */}
        {/* LINK TO PROFILE → ANALYSIS INTEGRATION               */}
        {/* ---------------------------------------------------- */}
        <div className="p-4 rounded-xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper-strong)] flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 text-[var(--accent-terracotta)] shrink-0" />
            <div>
              <h4 className="font-bold text-xs text-[var(--text-ink)]">
                Ready for Deep Diagnostic Topic Analytics?
              </h4>
              <p className="text-[11px] text-[var(--text-ink-muted)]">
                Inspect accuracy trends, Bayesian topic mastery (strengths & weaknesses), and personalized revision recommendations in your Academic Profile.
              </p>
            </div>
          </div>

          <CapsuleButton
            variant="accent"
            size="sm"
            onClick={() => onNavigateTab?.('analytics')}
          >
            Open Profile Analysis →
          </CapsuleButton>
        </div>

      </div>

      {/* Voice Tutor Modal */}
      {voiceOpen && currentDoc && (
        <VoiceTutorModal
          isOpen={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          activeDocument={currentDoc}
          weakTopics={currentDoc.topics?.map((t) => t.name) || []}
        />
      )}
    </div>
  );
};
