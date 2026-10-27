import type {
  StudyPage,
  StudyTopic,
  StudySourceType,
  TutorCitation,
  TutorSourceType,
  GeminiModelOption,
  StudentTutorContext,
  QuizQuestion,
  QuizAttempt,
  MistakeInsight,
  RevisionTask,
  StickyNoteItem,
  FlashcardItem,
  MindMapData,
  OnePageRevisionSheet,
  YouTubeRecommendation,
  SourceControlMode,
  TeachItBackEvaluation,
  DailyNewsArticle,
  EducationalPlaceItem,
  AiUsageDashboardStats,
  Generate3DModelResponse,
  Custom3DSceneSpec,
} from '../types/study';

export interface AiStatusMetadata {
  aiStatus?: string;
  aiNotice?: string;
}

export interface AnalyzeDocumentResponse extends AiStatusMetadata {
  overview: string;
  topics: StudyTopic[];
}

export interface AnalyzeYouTubeResponse extends AiStatusMetadata {
  videoId: string;
  youtubeUrl: string;
  title: string;
  overview: string;
  pages: StudyPage[];
  topics: StudyTopic[];
}

export interface AskTutorResponse extends AiStatusMetadata {
  answer: string;
  foundInMaterial: boolean;
  sourceType: TutorSourceType;
  sourceControlMode?: SourceControlMode;
  citations: TutorCitation[];
  relatedTopics: string[];
  modelUsed?: string;
}

export interface GenerateQuizResponse extends AiStatusMetadata {
  questions: QuizQuestion[];
}

export interface DiagnoseMistakesResponse extends AiStatusMetadata {
  mistakes: MistakeInsight[];
  revisionPlan: RevisionTask[];
}

export interface GenerateStickyAndFlashcardsResponse extends AiStatusMetadata {
  stickyNotes: StickyNoteItem[];
  flashcards: FlashcardItem[];
}

export interface GenerateMindMapAndRevisionResponse extends AiStatusMetadata {
  mindMap: MindMapData;
  onePageRevision: OnePageRevisionSheet;
}

export interface YouTubeRecommendationsResponse {
  configured: boolean;
  videos: YouTubeRecommendation[];
  searchQuery?: string;
  extractedConcepts?: string[];
  message?: string;
}

export interface ScanNotesResponse {
  title: string;
  cleanContent: string;
  handwrittenContent: string;
  uncertainSegments: string[];
  summary: string;
  keyConcepts: string[];
}

export interface TranscribeAudioResponse {
  title: string;
  transcript: string;
  structuredNotes: string;
  summary: string;
  keyConcepts: string[];
}

export interface VisualizeConceptResponse {
  concept: string;
  style: string;
  isAiGenerated: boolean;
  verificationStatus?: 'WORKING_VERIFIED' | 'BLOCKED_BY_BILLING';
  generatedImageUrl?: string;
  modelNotice?: string;
  diagramSteps: Array<{
    step: number;
    title: string;
    detail: string;
    color: string;
  }>;
}

export interface VideoLessonResponse {
  jobId?: string;
  topic: string;
  mode?: 'text_to_video' | 'image_to_video';
  aspectRatio?: '16:9' | '9:16';
  omniStatus: string;
  verificationStatus?: 'WORKING_VERIFIED' | 'BLOCKED_BY_BILLING' | 'WORKING_WITH_NON_AI_FALLBACK';
  fallbackMode?: 'none' | 'animated_explanation';
  userFacingNotice?: string;
  errorReason?: string;
  videoUrl?: string;
  scenes: Array<{
    sceneNumber: number;
    durationSeconds: number;
    heading: string;
    narration: string;
    visualCue: string;
    keyFormula: string;
    animationMode?: 'projectile_arc' | 'quadratic_curve' | 'probability_tree' | 'molecule_bonds';
    highlightValues?: string[];
  }>;
}

// Client-side in-flight deduplication to prevent duplicate submissions from rapid button clicks
const inFlightRequests = new Map<string, Promise<unknown>>();

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const serialized = JSON.stringify(body);
  const requestKey = `${url}::${serialized}`;

  const existing = inFlightRequests.get(requestKey);
  if (existing) {
    return existing as Promise<T>;
  }

  const task = (async () => {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: serialized,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message =
          (data && typeof data.aiNotice === 'string' && data.aiNotice) ||
          (data && typeof data.error === 'string' && data.error) ||
          `Request failed with status ${response.status}`;
        throw new Error(message);
      }
      return data as T;
    } finally {
      inFlightRequests.delete(requestKey);
    }
  })();

  inFlightRequests.set(requestKey, task);
  return task;
}

export const aiStudyClient = {
  async analyzeDocument(title: string, pages: StudyPage[]): Promise<AnalyzeDocumentResponse> {
    return postJson<AnalyzeDocumentResponse>('/api/study/analyze', { title, pages });
  },

  async analyzeYouTubeVideo(youtubeUrl: string): Promise<AnalyzeYouTubeResponse> {
    return postJson<AnalyzeYouTubeResponse>('/api/study/youtube-analyze', { youtubeUrl });
  },

  async askTutor(params: {
    title: string;
    pages: StudyPage[];
    question: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    modelPreference?: GeminiModelOption;
    studentContext?: StudentTutorContext;
    sourceControlMode?: SourceControlMode;
  }): Promise<AskTutorResponse> {
    return postJson<AskTutorResponse>('/api/study/ask', params);
  },

  async generateQuiz(params: {
    documentId: string;
    title: string;
    pages: StudyPage[];
    topics: StudyTopic[];
    mode: 'diagnostic' | 'adaptive';
    focusTopics?: string[];
    questionCount?: number;
    forceRefresh?: boolean;
  }): Promise<GenerateQuizResponse> {
    return postJson<GenerateQuizResponse>('/api/study/quiz', params);
  },

  async analyzeMistakesAndPlan(params: {
    documentId: string;
    title: string;
    pages: StudyPage[];
    attempt: QuizAttempt;
  }): Promise<DiagnoseMistakesResponse> {
    return postJson<DiagnoseMistakesResponse>('/api/study/mistakes-and-plan', params);
  },

  async generateStickyNotesAndFlashcards(params: {
    title: string;
    overview: string;
    sourceType: StudySourceType;
    pages: StudyPage[];
    topics: StudyTopic[];
    forceRefresh?: boolean;
  }): Promise<GenerateStickyAndFlashcardsResponse> {
    return postJson<GenerateStickyAndFlashcardsResponse>('/api/study/quick-revise', {
      ...params,
      resourceType: 'sticky_and_flashcards',
    });
  },

  async generateMindMapAndRevisionSheet(params: {
    title: string;
    overview: string;
    sourceType: StudySourceType;
    pages: StudyPage[];
    topics: StudyTopic[];
    forceRefresh?: boolean;
  }): Promise<GenerateMindMapAndRevisionResponse> {
    return postJson<GenerateMindMapAndRevisionResponse>('/api/study/quick-revise', {
      ...params,
      resourceType: 'mindmap_and_revision',
    });
  },

  async fetchYouTubeRecommendations(params: {
    query?: string;
    documentTitle: string;
    topics: string[];
    weakTopics?: string[];
    keyConcepts?: string[];
    pageTitles?: string[];
  }): Promise<YouTubeRecommendationsResponse> {
    return postJson<YouTubeRecommendationsResponse>('/api/study/youtube-recommendations', params);
  },

  async scanNotes(params: {
    imageDataUrl: string;
    title?: string;
  }): Promise<ScanNotesResponse> {
    return postJson<ScanNotesResponse>('/api/study/scan-notes', params);
  },

  async transcribeAudio(params: {
    audioDataUrl?: string;
    title?: string;
    manualTranscript?: string;
  }): Promise<TranscribeAudioResponse> {
    return postJson<TranscribeAudioResponse>('/api/study/transcribe-audio', params);
  },

  async evaluateTeachItBack(params: {
    topic: string;
    studentExplanation: string;
    keyConcepts?: string[];
    pages: StudyPage[];
  }): Promise<TeachItBackEvaluation> {
    return postJson<TeachItBackEvaluation>('/api/study/teach-it-back', params);
  },

  async visualizeConcept(params: {
    concept: string;
    contextText: string;
    style?: string;
  }): Promise<VisualizeConceptResponse> {
    return postJson<VisualizeConceptResponse>('/api/create/visualize', params);
  },

  async generateVideoLesson(params: {
    topic: string;
    contextText: string;
    aspectRatio?: '16:9' | '9:16';
    sourceImageDataUrl?: string;
  }): Promise<VideoLessonResponse> {
    return postJson<VideoLessonResponse>('/api/create/video-lesson', params);
  },

  async prepareLofiMusic(params: {
    presetId: string;
    prompt: string;
  }): Promise<{
    presetId: string;
    instrumentalOnly: boolean;
    sanitizedPrompt: string;
    audioDataUrl?: string;
    verificationStatus?: string;
    fallbackMode?: string;
    userFacingNotice?: string;
  }> {
    return postJson('/api/create/lofi-music', params);
  },

  async fetchDailyNews(category?: string): Promise<{
    updatedAt: string;
    articles: DailyNewsArticle[];
    groundedWithSearch: boolean;
  }> {
    return postJson('/api/explore/daily-news', { category });
  },

  async fetchEducationalPlaces(params: {
    city: string;
    studyTopic: string;
  }): Promise<{
    city: string;
    studyTopic: string;
    places: EducationalPlaceItem[];
  }> {
    return postJson('/api/explore/educational-maps', params);
  },

  async generate3DModel(params: {
    concept: string;
    contextText?: string;
    style?: string;
  }): Promise<Generate3DModelResponse> {
    return postJson<Generate3DModelResponse>('/api/create/3d-model', params);
  },

  async fetchAiUsageStats(): Promise<AiUsageDashboardStats> {
    const resp = await fetch('/api/usage');
    if (!resp.ok) {
      throw new Error('Failed to load AI usage metrics');
    }
    return (await resp.json()) as AiUsageDashboardStats;
  },

  async fetchAiCapabilities(): Promise<{
    checkedAt: string;
    capabilities: Array<{
      id: string;
      name: string;
      provider: string;
      modelId: string;
      verificationStatus: string;
      userFacingNotice: string;
      fallbackStrategy: string;
    }>;
  }> {
    const resp = await fetch('/api/capabilities');
    if (!resp.ok) {
      throw new Error('Failed to load AI capabilities');
    }
    return resp.json();
  },
};

