export interface StudyPage {
  pageNumber: number;
  title: string;
  content: string;
  timestampSeconds?: number;
  timestampLabel?: string;
}

export interface StudyTopic {
  id: string;
  name: string;
  summary: string;
  keyConcepts: string[];
  sourcePages: number[];
}

export type StudySourceType =
  | 'pdf'
  | 'text'
  | 'youtube'
  | 'scanned_notes'
  | 'voice_note'
  | 'course';

export type SourceControlMode = 'material_only' | 'extended_knowledge';

export interface StudyDocument {
  id: string;
  title: string;
  sourceType: StudySourceType;
  youtubeUrl?: string;
  videoId?: string;
  contentVersion?: string;
  fileSize?: number;
  pageCount: number;
  pages: StudyPage[];
  pdfDataUrl?: string;
  scannedImageDataUrl?: string;
  createdAt: string;
  lastStudiedAt: string;
  topics: StudyTopic[];
  overview: string;
}

export interface TutorCitation {
  pageNumber: number;
  section: string;
  quote: string;
  timestampLabel?: string;
  webUrl?: string;
}

export type TutorSourceType = 'material' | 'general' | 'both' | 'web_grounded';

export type GeminiModelOption =
  | 'gemini-3.8-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-4-argon';

export interface StudentTutorContext {
  currentTopic?: string;
  currentPage?: number;
  currentActivity?: string;
  weakTopics?: string[];
  recentScorePct?: number | null;
  completedRevisionCount?: number;
  totalRevisionCount?: number;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  foundInMaterial: boolean;
  sourceType?: TutorSourceType;
  sourceControlMode?: SourceControlMode;
  citations: TutorCitation[];
  relatedTopics: string[];
  timestamp: string;
  modelUsed?: string;
}

export interface QuizQuestion {
  id: string;
  topic: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
  sourcePage: number;
  sourceQuote: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface QuizAttemptAnswer {
  questionId: string;
  selectedIndex: number;
  isCorrect: boolean;
  topic: string;
  sourcePage: number;
}

export type ExamTypeId =
  | 'jee_main'
  | 'jee_advanced'
  | 'neet_ug'
  | 'cuet'
  | 'board_exams'
  | 'university_exams'
  | 'general_practice';

export interface QuizAttempt {
  id: string;
  documentId: string;
  documentTitle: string;
  mode: 'diagnostic' | 'adaptive' | 'jee_simulator';
  examType?: ExamTypeId;
  examTitle?: string;
  subjectFilter?: string;
  timedMode?: boolean;
  targetTopics?: string[];
  questions: QuizQuestion[];
  answers: QuizAttemptAnswer[];
  score: number;
  totalQuestions: number;
  percentage: number;
  weakTopics: string[];
  strongTopics: string[];
  completedAt: string;
  negativeMarkingUsed?: boolean;
  rawMarks?: number;
  maxMarks?: number;
  timeTakenSeconds?: number;
}

export interface MistakeInsight {
  questionId: string;
  topic: string;
  question: string;
  selectedOption: string;
  correctOption: string;
  likelyMisconception: string;
  coreConceptFix: string;
  sourcePage: number;
  sourceQuote: string;
}

export interface RevisionTask {
  id: string;
  documentId: string;
  topic: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  recommendedAction: string;
  conceptSummary: string;
  sourcePage: number;
  completed: boolean;
  updatedAt: string;
}

export interface DocumentDiagnosisBundle {
  attemptId: string;
  documentId: string;
  mistakes: MistakeInsight[];
  revisionPlan: RevisionTask[];
  createdAt: string;
}

export interface TopicProgressComparison {
  topic: string;
  firstScorePct: number;
  latestScorePct: number;
  attemptsCount: number;
  totalCorrect: number;
  totalQuestions: number;
  deltaPct: number;
  status: 'mastered' | 'improved' | 'steady' | 'needs-work';
}

export interface OverallProgressSummary {
  totalAttempts: number;
  diagnosticCount: number;
  adaptiveCount: number;
  averageScorePct: number;
  firstAttemptPct: number | null;
  latestAttemptPct: number | null;
  overallDeltaPct: number | null;
  masteredTopicsCount: number;
  weakTopicsCount: number;
}

/* =====================================================================
 * NEW LEARNING TOOLS EXPANSION TYPES
 * ===================================================================== */

export type StickyNoteColor = 'yellow' | 'pink' | 'blue' | 'green';

export interface StickyNoteItem {
  id: string;
  title: string;
  content: string;
  formula?: string;
  sourcePage: number;
  sourceLabel: string;
  color: StickyNoteColor;
}

export type FlashcardStatus = 'unreviewed' | 'know_it' | 'review_again';

export interface FlashcardItem {
  id: string;
  frontQuestion: string;
  backAnswer: string;
  topic: string;
  sourcePage: number;
  sourceLabel: string;
  status: FlashcardStatus;
  repetitionCount?: number;
  repetitions?: number;
  easeFactor?: number;
  intervalDays?: number;
  nextReviewDate?: string;
  nextReviewAt?: string;
  lastReviewedAt?: string;
}

export interface MindMapNode {
  id: string;
  label: string;
  explanation: string;
  sourcePage: number;
  sourceLabel: string;
  level: 'central' | 'branch' | 'subtopic';
  color: 'blue' | 'red' | 'yellow' | 'green';
  parentId?: string;
}

export interface MindMapEdge {
  from: string;
  to: string;
  relation?: string;
}

export interface MindMapData {
  centralTopic: string;
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

export interface OnePageRevisionSheet {
  chapterTitle: string;
  overview: string;
  essentialConcepts: Array<{
    title: string;
    summary: string;
    sourceLabel: string;
    sourcePage: number;
  }>;
  formulasAndDefinitions: Array<{
    term: string;
    formulaOrDef: string;
    sourceLabel: string;
  }>;
  keyRelationships: string[];
  commonMistakesToAvoid: string[];
  quickRecallQuestions: Array<{
    question: string;
    shortAnswer: string;
  }>;
}

export interface QuickReviseBundle {
  documentId: string;
  contentVersion: string;
  stickyNotes: StickyNoteItem[];
  flashcards: FlashcardItem[];
  mindMap: MindMapData | null;
  onePageRevision: OnePageRevisionSheet | null;
  updatedAt: string;
}

export interface YouTubeRecommendation {
  videoId: string;
  title: string;
  channelTitle: string;
  description: string;
  thumbnailUrl: string;
  watchUrl: string;
  publishedAt?: string;
  durationSeconds?: number;
  durationLabel?: string;
  relevanceReason?: string;
  matchedConcept?: string;
}

export interface StudyTimerState {
  mode: 'study' | 'break';
  durationMinutes: number;
  breakMinutes: number;
  remainingSeconds: number;
  isRunning: boolean;
  targetEndTimestamp: number | null;
  soundEnabled: boolean;
  completedSessionsCount: number;
  activeLofiPresetId?: string;
  lofiPlaying?: boolean;
  lofiVolume?: number;
}

export interface FocusSessionRecord {
  id: string;
  documentId?: string;
  documentTitle?: string;
  durationMinutes: number;
  completedAt: string;
}

export type ThemeMode = 'light' | 'dark' | 'system';

/* =====================================================================
 * LEARNMATE 2.0 EXPANSION TYPES
 * ===================================================================== */

export type WorkspaceTab =
  | 'home'
  | 'study'
  | 'practice'
  | 'pdf-workspace'
  | 'create'
  | 'explore';

export interface LearnMateNotification {
  id: string;
  title: string;
  message: string;
  category: 'revision' | 'goal' | 'ai_job' | 'resource';
  read: boolean;
  createdAt: string;
  actionTab?: WorkspaceTab;
  documentId?: string;
}

export interface NotebookEntry {
  id: string;
  title: string;
  type: 'scanned_note' | 'voice_transcript' | 'manual_note';
  cleanContent: string;
  handwrittenContent: string;
  uncertainSegments: string[];
  originalImageUrl?: string;
  audioDurationSeconds?: number;
  summary: string;
  keyConcepts: string[];
  createdAt: string;
  updatedAt: string;
  linkedDocumentId?: string;
}

export type CreativeAssetType =
  | 'game_2d'
  | 'lab_3d'
  | 'mini_app'
  | 'visual_diagram'
  | 'video_lesson';

export interface CreativeAsset {
  id: string;
  title: string;
  type: CreativeAssetType;
  documentId?: string;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  payload: Record<string, any>;
  createdAt: string;
}

export type CourseCategory =
  | 'School'
  | 'College'
  | 'Programming'
  | 'Mathematics'
  | 'Science'
  | 'Competitive Exams';

export interface CourseModuleItem {
  id: string;
  title: string;
  summary: string;
  content: string;
  keyConcepts: string[];
}

export interface CourseLibraryItem {
  id: string;
  title: string;
  category: CourseCategory;
  level: 'Beginner' | 'Intermediate' | 'Advanced';
  durationEstimate: string;
  description: string;
  badgeColor: 'blue' | 'red' | 'yellow' | 'green';
  modules: CourseModuleItem[];
}

export interface DailyNewsArticle {
  id: string;
  headline: string;
  category:
    | 'World'
    | 'India'
    | 'Technology'
    | 'Science'
    | 'Economy'
    | 'Education'
    | 'Environment'
    | 'Competitive Exam Current Affairs';
  summary: string;
  examRelevance: string;
  keyTakeaways: string[];
  sourceName: string;
  sourceUrl?: string;
  publishedAt: string;
  quizQuestion?: {
    question: string;
    options: [string, string, string, string];
    correctIndex: number;
    explanation: string;
  };
}

export interface EducationalPlaceItem {
  id: string;
  name: string;
  category: 'Library' | 'Science Center' | 'Museum' | 'University / Lab' | 'Historical Site';
  address: string;
  description: string;
  studyConnection: string;
  mapsUri?: string;
  distanceHint?: string;
}

export interface StudyPlannerTask {
  id: string;
  title: string;
  dateIso: string;
  durationMinutes: number;
  category: 'study' | 'practice' | 'revision' | 'exam';
  completed: boolean;
  documentId?: string;
}

export interface AccessibilitySettings {
  fontSize: 'normal' | 'large' | 'xlarge';
  readingWidth: 'standard' | 'relaxed' | 'wide';
  highContrast: boolean;
  reducedMotion: boolean;
  dyslexiaFriendlyFont?: boolean;
}

export interface TeachItBackEvaluation {
  scorePct: number;
  verdict: 'mastered' | 'good_understanding' | 'partial_gaps' | 'needs_review';
  strengths: string[];
  missingConcepts: string[];
  inaccuracies: string[];
  suggestedFollowUpQuestion: string;
  groundedFeedback: string;
}

export interface AiUsageDashboardStats {
  totalRequests: number;
  cacheHits: number;
  deduplicatedHits: number;
  failedRequests: number;
  avgLatencyMs: number;
  activeCooldownUntil: number | null;
  byOperation: Record<string, { count: number; avgMs: number; errors: number }>;
  modelsConfigured: string[];
}

/* =====================================================================
 * PDF WORKSPACE ANNOTATION & STUDENT ACADEMIC PROFILE TYPES
 * ===================================================================== */

export type PdfAnnotationTool =
  | 'select'
  | 'highlight'
  | 'pen'
  | 'text_note'
  | 'underline'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'eraser';

export type PdfAnnotationColor =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'pink'
  | 'red'
  | 'navy';

export interface PdfAnnotationItem {
  id: string;
  pageNumber: number;
  tool: Exclude<PdfAnnotationTool, 'select' | 'eraser'>;
  color: PdfAnnotationColor;
  strokeWidth?: number;
  /** Normalized coordinates (0..1 relative to page width and height) */
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: Array<{ x: number; y: number }>;
  text?: string;
  quoteText?: string;
  createdAt: string;
}

export interface PdfDocumentAnnotationsBundle {
  documentId: string;
  annotations: PdfAnnotationItem[];
  updatedAt: string;
}

export type EducationStage = 'school' | 'college' | 'self_learner';

export interface StudentAcademicProfile {
  fullName: string;
  educationStage: EducationStage;
  // School fields (Class 9-12)
  schoolClass: 'Class 9' | 'Class 10' | 'Class 11' | 'Class 12';
  stream: 'PCM' | 'PCB' | 'PCMB' | 'Commerce' | 'Arts / Humanities' | 'Foundation';
  schoolBoard: 'CBSE' | 'ICSE / ISC' | 'State Board' | 'IB / Cambridge' | 'Other';
  schoolName: string;
  // College / Undergraduate fields
  collegeYear: '1st Year' | '2nd Year' | '3rd Year' | '4th Year' | 'Postgraduate';
  degreeCourse: string;
  universityName: string;
  academicYear: string;
  // Learning & Exam Personalization
  primaryGoal:
    | 'competitive_exam'
    | 'board_university_excellence'
    | 'concept_mastery'
    | 'daily_revision';
  targetExam: ExamTypeId;
  targetExamYear: string;
  subjectsStudied: string[];
  weakAreas: string[];
  preferredLanguage:
    | 'English'
    | 'Hindi + English (Hinglish)'
    | 'Hindi'
    | 'Tamil'
    | 'Telugu'
    | 'Bengali';
  personalGoalStatement: string;
  dailyStudyMinutesGoal: number;
  updatedAt: string;
}




export interface Custom3DMeshSpec {
  id: string;
  shape: 'sphere' | 'box' | 'cylinder' | 'torus' | 'cone' | 'capsule' | 'tube' | 'ring';
  args?: number[];
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  color: string;
  wireframe?: boolean;
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
  metalness?: number;
  label?: string;
}

export interface Custom3DSceneSpec {
  title: string;
  summary: string;
  category?: string;
  camera?: {
    position: [number, number, number];
    target?: [number, number, number];
  };
  meshes: Custom3DMeshSpec[];
  annotations?: Array<{
    title: string;
    description: string;
    position: [number, number, number];
  }>;
}

export interface Generate3DModelResponse {
  sceneSpec: Custom3DSceneSpec;
  isAiGenerated: boolean;
  provider: 'anthropic_claude' | 'gemini' | 'procedural_engine';
  modelUsed?: string;
  userFacingNotice?: string;
}
