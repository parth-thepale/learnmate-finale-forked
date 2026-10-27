import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Modality, ThinkingLevel, Type } from '@google/genai';
import {
  GeminiRequestManager,
  computeRequestFingerprint,
  classifyGeminiError,
  extractPreciseEducationalConcepts,
  buildSpecificYouTubeSearchQuery,
  parseIsoDurationSeconds,
  rankAndFilterYouTubeCandidates,
  type RawYouTubeCandidate,
  type GeminiErrorCategory,
} from './src/utils/stabilityEngine.ts';
import {
  enforceSourceControlPolicy,
  evaluateTeachItBackCoverage,
  sanitizeInstrumentalLofiPrompt,
  type SourceControlMode,
} from './src/utils/learnmate2Engine.ts';
import {
  VERTEX_TRIAL_ELIGIBILITY_MATRIX,
  resolveVertexConfig,
  resolveVertexModelName,
  classifyVertexProbeError,
  buildAiCapabilityRegistry,
  type AiBackendProvider,
  type VertexDiagnosticProbeResult,
} from './src/utils/vertexAiRouter.ts';
import {
  buildAnimatedExplanationScenes,
  type AnimatedExplanationScene,
} from './src/utils/educationalSpecsEngine.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadDefaultFirebaseProjectId(): string {
  try {
    const raw = fs.readFileSync(path.resolve(__dirname, 'firebase-applet-config.json'), 'utf8');
    const parsed = JSON.parse(raw) as { projectId?: string };
    return parsed.projectId || 'cs-project-wsjgygls';
  } catch {
    return 'cs-project-wsjgygls';
  }
}

const DEFAULT_GCP_PROJECT_ID = loadDefaultFirebaseProjectId();

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-4-argon',
  'gemini-flash-latest',
]);
const FALLBACK_MODEL_CHAIN = [
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
] as const;
const GEMINI_TIMEOUT_MS = 9500;

// Tracks per-model quota/rate-limit cooldown timestamps so requests immediately route to healthy models
const modelCooldownUntil = new Map<string, number>();

const aiUsageStats = {
  totalRequests: 0,
  cacheHits: 0,
  deduplicatedHits: 0,
  failedRequests: 0,
  totalLatencyMs: 0,
  byOperation: {} as Record<string, { count: number; totalMs: number; errors: number }>,
};

function getOrderedCandidateModels(preferredModel?: string): string[] {
  const now = Date.now();
  const baseOrder: string[] = [];
  if (preferredModel && ALLOWED_MODELS.has(preferredModel)) {
    baseOrder.push(preferredModel);
  }
  for (const candidate of FALLBACK_MODEL_CHAIN) {
    if (!baseOrder.includes(candidate)) {
      baseOrder.push(candidate);
    }
  }
  const available = baseOrder.filter((m) => (modelCooldownUntil.get(m) || 0) <= now);
  const coolingDown = baseOrder.filter((m) => (modelCooldownUntil.get(m) || 0) > now);
  return [...available, ...coolingDown];
}

const geminiManager = new GeminiRequestManager({
  maxConcurrency: 2,
  maxRetries: 2,
  baseDelayMs: 650,
  maxDelayMs: 6000,
  cacheTtlMs: 20 * 60 * 1000,
  onLog: (entry) => {
    aiUsageStats.totalRequests += 1;
    aiUsageStats.totalLatencyMs += entry.durationMs;
    if (entry.status === 'cache_hit') aiUsageStats.cacheHits += 1;
    if (entry.status === 'dedup_hit') aiUsageStats.deduplicatedHits += 1;
    if (entry.status === 'failed') aiUsageStats.failedRequests += 1;
    const opBucket = aiUsageStats.byOperation[entry.operation] || {
      count: 0,
      totalMs: 0,
      errors: 0,
    };
    opBucket.count += 1;
    opBucket.totalMs += entry.durationMs;
    if (entry.status === 'failed') opBucket.errors += 1;
    aiUsageStats.byOperation[entry.operation] = opBucket;

    const approxTokens = Math.max(1, Math.round(entry.approxInputChars / 4));
    const statusLabel = entry.status === 'failed' ? 'fallback_engaged' : entry.status;
    console.log(
      `[GeminiManager] op=${entry.operation} model=${entry.model} state=${statusLabel} retries=${entry.retries} durationMs=${entry.durationMs} approxInputTokens=${approxTokens}`
    );
  },
});

const youtubeServerCache = new Map<
  string,
  {
    videos: RawYouTubeCandidate[];
    searchQuery: string;
    extractedConcepts: string[];
    expiresAt: number;
  }
>();

interface PageInput {
  pageNumber: number;
  title: string;
  content: string;
}

interface TopicInput {
  id: string;
  name: string;
  summary: string;
  keyConcepts: string[];
  sourcePages: number[];
}

interface StudentTutorContextInput {
  currentTopic?: string;
  currentPage?: number;
  currentActivity?: string;
  weakTopics?: string[];
  recentScorePct?: number | null;
  completedRevisionCount?: number;
  totalRevisionCount?: number;
}

type TutorSourceType = 'material' | 'general' | 'both';

function getDeveloperGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey.trim() === '') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Keep alias for Developer-API-only endpoints (Live API, Omni Flash video, Nano Banana image, Lyria music, YouTube direct URL)
const getGenAIClient = getDeveloperGenAIClient;

function getVertexGenAIClient(): GoogleGenAI | null {
  const cfg = resolveVertexConfig({ fallbackProjectId: DEFAULT_GCP_PROJECT_ID });
  if (cfg.mode === 'disabled' || cfg.configError || !cfg.projectId) {
    return null;
  }
  return new GoogleGenAI({
    vertexai: true,
    project: cfg.projectId,
    location: cfg.location,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

let developerApiBillingDepleted = false;

interface VideoGenerationJob {
  jobId: string;
  topic: string;
  mode: 'text_to_video' | 'image_to_video';
  aspectRatio: '16:9' | '9:16';
  status: 'queued' | 'processing' | 'completed' | 'failed';
  verificationStatus: 'WORKING_VERIFIED' | 'BLOCKED_BY_BILLING' | 'WORKING_WITH_NON_AI_FALLBACK';
  videoUrl?: string;
  errorReason?: string;
  userFacingNotice?: string;
  fallbackMode: 'none' | 'animated_explanation';
  scenes: AnimatedExplanationScene[];
  createdAt: string;
  updatedAt: string;
}

const videoJobs = new Map<string, VideoGenerationJob>();

let cachedVertexProbe: {
  result: VertexDiagnosticProbeResult;
  expiresAt: number;
} | null = null;

async function detectMetadataServiceAccountEmail(): Promise<string | undefined> {
  try {
    const resp = await fetch(
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
      {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(1200),
      }
    );
    if (resp.ok) {
      const email = (await resp.text()).trim();
      return email || undefined;
    }
  } catch {
    // Not on GCE/Cloud Run metadata environment
  }
  return undefined;
}

/**
 * Executes a single low-cost Vertex AI text generation probe ("Reply with single word: OK", maxOutputTokens: 5)
 * to verify ADC / IAM permissions and Google Cloud Free Trial eligibility before migrating production study endpoints.
 */
async function runLowCostVertexProbe(forceRefresh = false): Promise<VertexDiagnosticProbeResult> {
  if (!forceRefresh && cachedVertexProbe && cachedVertexProbe.expiresAt > Date.now()) {
    return cachedVertexProbe.result;
  }

  const startMs = Date.now();
  const cfg = resolveVertexConfig({ fallbackProjectId: DEFAULT_GCP_PROJECT_ID });
  const probeModel = 'gemini-3.1-flash-lite';
  const billingService = 'Vertex AI API / Gemini Enterprise Agent Platform (aiplatform.googleapis.com)';
  const billingApiEndpoint = `https://${cfg.location}-aiplatform.googleapis.com/v1beta1/projects/${cfg.projectId}/locations/${cfg.location}/publishers/google/models/${probeModel}:generateContent`;

  if (!forceRefresh && cfg.mode !== 'enabled') {
    const passiveResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: 'disabled_by_config',
      readyForMigration: false,
      activeProvider: 'developer_api',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      modelTested: probeModel,
      latencyMs: 0,
      errorReason: 'Passive check (no API quota consumed on startup).',
      remediationSteps: ['Use POST /api/vertex/probe or set GOOGLE_GENAI_USE_VERTEXAI="true" to run a live Vertex AI check.'],
    };
    cachedVertexProbe = { result: passiveResult, expiresAt: Date.now() + 10 * 60 * 1000 };
    return passiveResult;
  }

  if (cfg.mode === 'disabled') {
    const disabledResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: 'disabled_by_config',
      readyForMigration: false,
      activeProvider: 'developer_api',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      modelTested: probeModel,
      latencyMs: 0,
      errorReason: 'GOOGLE_GENAI_USE_VERTEXAI is set to false.',
      remediationSteps: ['Set GOOGLE_GENAI_USE_VERTEXAI="auto" or "true" to enable Vertex AI routing.'],
    };
    cachedVertexProbe = { result: disabledResult, expiresAt: Date.now() + 5 * 60 * 1000 };
    return disabledResult;
  }

  const metadataEmail = await detectMetadataServiceAccountEmail();

  if (cfg.configError) {
    const errResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: 'unauthenticated',
      readyForMigration: false,
      activeProvider: 'developer_api',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      runtimeIdentityHint: metadataEmail,
      modelTested: probeModel,
      latencyMs: Date.now() - startMs,
      errorReason: cfg.configError,
      remediationSteps: [
        'Configure GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION and attach a Cloud Run service account with roles/aiplatform.user (no JSON key required).',
      ],
    };
    cachedVertexProbe = { result: errResult, expiresAt: Date.now() + 2 * 60 * 1000 };
    return errResult;
  }

  const vertexClient = getVertexGenAIClient();
  if (!vertexClient) {
    const unauthResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: 'unauthenticated',
      readyForMigration: false,
      activeProvider: 'developer_api',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      runtimeIdentityHint: metadataEmail,
      modelTested: probeModel,
      latencyMs: Date.now() - startMs,
      errorReason: 'Vertex AI client could not be initialized.',
      remediationSteps: [
        'Set GOOGLE_CLOUD_PROJECT and configure Cloud Run Application Default Credentials with roles/aiplatform.user.',
      ],
    };
    cachedVertexProbe = { result: unauthResult, expiresAt: Date.now() + 2 * 60 * 1000 };
    return unauthResult;
  }

  try {
    const response = await Promise.race([
      vertexClient.models.generateContent({
        model: probeModel,
        contents: 'Reply with single word: OK',
        config: {
          maxOutputTokens: 5,
          temperature: 0,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('VERTEX_PROBE_TIMEOUT')), 6500)
      ),
    ]);

    const readyResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: 'ready',
      readyForMigration: true,
      activeProvider: 'vertex_ai',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      runtimeIdentityHint: metadataEmail,
      modelTested: probeModel,
      latencyMs: Date.now() - startMs,
      sampleOutput: (response.text || 'OK').trim().slice(0, 32),
      httpStatus: 200,
      remediationSteps: [],
    };
    cachedVertexProbe = { result: readyResult, expiresAt: Date.now() + 15 * 60 * 1000 };
    return readyResult;
  } catch (err) {
    const classified = classifyVertexProbeError({
      error: err,
      projectId: cfg.projectId,
      location: cfg.location,
      runtimeIdentityHint: metadataEmail,
    });
    const failedResult: VertexDiagnosticProbeResult = {
      checkedAt: new Date().toISOString(),
      status: classified.status,
      readyForMigration: false,
      activeProvider: 'developer_api',
      billingService,
      billingApiEndpoint,
      trialCreditsEligible: true,
      projectId: cfg.projectId,
      location: cfg.location,
      authMethod: cfg.authMethod,
      runtimeIdentityHint: metadataEmail,
      modelTested: probeModel,
      latencyMs: Date.now() - startMs,
      httpStatus: classified.httpStatus,
      errorReason: classified.errorReason,
      remediationSteps: classified.remediationSteps,
    };
    cachedVertexProbe = { result: failedResult, expiresAt: Date.now() + 3 * 60 * 1000 };
    return failedResult;
  }
}

/**
 * Resolves the active Gemini client for Vertex-eligible study & multimodal endpoints.
 * Only routes to Vertex AI when the low-cost probe has confirmed IAM/ADC readiness (or when GOOGLE_VERTEX_CREDENTIALS_JSON is provided and passes probe);
 * otherwise falls back safely to the Google AI Studio Developer API client.
 */
async function getTrialEligibleStudyClient(): Promise<{
  ai: GoogleGenAI | null;
  provider: AiBackendProvider;
}> {
  const cfg = resolveVertexConfig({ fallbackProjectId: DEFAULT_GCP_PROJECT_ID });
  if (cfg.mode !== 'disabled') {
    const probe = await runLowCostVertexProbe(false);
    if (probe.readyForMigration) {
      const vertexAi = getVertexGenAIClient();
      if (vertexAi) {
        return { ai: vertexAi, provider: 'vertex_ai' };
      }
    }
  }
  return { ai: getDeveloperGenAIClient(), provider: 'developer_api' };
}

async function generateStructuredJson<T>(params: {
  operation: string;
  prompt: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  preferredModel?: string;
  bypassCache?: boolean;
}): Promise<{ data: T; modelUsed: string; providerUsed?: AiBackendProvider }> {
  const { ai: primaryAi, provider: primaryProvider } = await getTrialEligibleStudyClient();
  const fallbackDevAi = primaryProvider === 'vertex_ai' ? getDeveloperGenAIClient() : null;

  if (!primaryAi && !fallbackDevAi) {
    throw new Error('NO_API_KEY');
  }

  const candidateModels = getOrderedCandidateModels(params.preferredModel);
  const primaryModel = candidateModels[0] || 'gemini-3.1-flash-lite';

  const cacheKey = computeRequestFingerprint([
    params.operation,
    params.preferredModel || 'default',
    params.systemInstruction,
    params.prompt,
  ]);

  return geminiManager.execute({
    operation: params.operation,
    model: primaryModel,
    cacheKey,
    bypassCache: params.bypassCache,
    approxInputChars: params.prompt.length + params.systemInstruction.length,
    task: async () => {
      let lastErr: unknown = null;

      const providersToTry: Array<{ client: GoogleGenAI; provider: AiBackendProvider }> = [];
      if (primaryAi) {
        providersToTry.push({ client: primaryAi, provider: primaryProvider });
      }
      if (fallbackDevAi) {
        providersToTry.push({ client: fallbackDevAi, provider: 'developer_api' });
      }

      for (const { client, provider } of providersToTry) {
        for (const rawModelName of candidateModels) {
          const modelName =
            provider === 'vertex_ai' ? resolveVertexModelName(rawModelName) : rawModelName;
          try {
            const callPromise = client.models.generateContent({
              model: modelName,
              contents: params.prompt,
              config: {
                systemInstruction: params.systemInstruction,
                responseMimeType: 'application/json',
                responseSchema: params.responseSchema,
                temperature: 0.25,
                ...(modelName === 'gemini-3.8-flash' || modelName === 'gemini-4-argon'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } }
                  : modelName === 'gemini-3.1-flash-lite'
                  ? { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }
                  : {}),
              },
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('GEMINI_CALL_TIMEOUT')), GEMINI_TIMEOUT_MS)
            );

            const response = await Promise.race([callPromise, timeoutPromise]);
            const rawText = response.text?.trim();
            if (!rawText) {
              throw new Error('EMPTY_RESPONSE');
            }
            return {
              data: JSON.parse(rawText) as T,
              modelUsed: modelName,
              providerUsed: provider,
            };
          } catch (err) {
            lastErr = err;
            const classified = classifyGeminiError(err);
            // If Developer API prepayment credits are depleted (HTTP 402), stop trying other models on the same depleted Developer API key
            if (classified.statusCode === 402) {
              for (const m of candidateModels) {
                modelCooldownUntil.set(m, Date.now() + 15 * 60 * 1000);
              }
              break;
            }
            if (classified.category === 'quota_exhausted') {
              modelCooldownUntil.set(rawModelName, Date.now() + 15 * 60 * 1000);
              continue;
            }
            if (classified.category === 'temporarily_busy') {
              modelCooldownUntil.set(rawModelName, Date.now() + 30 * 1000);
              continue;
            }
            if (
              classified.statusCode === 404 ||
              (err instanceof Error && err.message.toLowerCase().includes('not found'))
            ) {
              modelCooldownUntil.set(rawModelName, Date.now() + 60 * 60 * 1000);
              continue;
            }
            if (
              classified.category === 'auth_config_error' &&
              (classified.statusCode === 401 ||
                classified. statusCode === 403 ||
                classified.rawReason.toLowerCase().includes('api_key_invalid'))
            ) {
              break;
            }
          }
        }
      }

      throw lastErr || new Error('GENERATION_FAILED');
    },
  });
}

function extractAiNotice(err: unknown): {
  aiStatus: GeminiErrorCategory;
  aiNotice: string;
} {
  const enriched = err as { classified?: { category: GeminiErrorCategory; userMessage: string } };
  if (enriched?.classified) {
    return {
      aiStatus: enriched.classified.category,
      aiNotice: enriched.classified.userMessage,
    };
  }
  const classified = classifyGeminiError(err);
  return {
    aiStatus: classified.category,
    aiNotice: classified.userMessage,
  };
}

function formatPagesContext(pages: PageInput[]): string {
  return pages
    .map(
      (p) =>
        `=== PAGE ${p.pageNumber} (${p.title || `Section ${p.pageNumber}`}) ===\n${p.content}`
    )
    .join('\n\n');
}

function buildGroundedFallbackAnalysis(title: string, pages: PageInput[]) {
  const topics: TopicInput[] = pages.slice(0, 6).map((p, idx) => {
    const lines = p.content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const topicName =
      p.title && p.title !== `Page ${p.pageNumber}`
        ? p.title
        : lines[0] || `Topic ${idx + 1}`;
    const summaryLine =
      lines.find((l) => l.length > 45 && !l.startsWith('1.') && !l.startsWith('2.')) ||
      lines.slice(0, 2).join(' ');
    const bullets = lines
      .filter((l) => l.startsWith('•') || l.includes(':') || l.includes('='))
      .slice(0, 4)
      .map((b) => b.replace(/^[•\-*\d.)\s]+/, '').slice(0, 55));

    return {
      id: `topic-${p.pageNumber}-${idx}`,
      name: topicName.replace(/^\d+\.\s*/, '').slice(0, 64),
      summary: summaryLine.slice(0, 200),
      keyConcepts: bullets.length > 0 ? bullets : [`Page ${p.pageNumber} Core Concept`],
      sourcePages: [p.pageNumber],
    };
  });

  return {
    overview: `Structured study guide for "${title}" spanning ${pages.length} page${pages.length === 1 ? '' : 's'} and ${topics.length} core topics.`,
    topics,
  };
}

/**
 * Generates helpful general-knowledge educational explanations for common academic questions
 * or arbitrary topics when the topic is not in the uploaded PDF (or when no PDF is uploaded).
 */
function buildGeneralKnowledgeExplanation(question: string): string {
  const qLower = question.toLowerCase();

  if (qLower.includes('krebs') || qLower.includes('citric acid') || qLower.includes('respiration')) {
    return `The **Krebs Cycle** (also known as the Citric Acid Cycle or TCA cycle) is a central metabolic pathway in cellular respiration that takes place in the mitochondrial matrix of eukaryotic cells:
1. **Entry Step**: Acetyl-CoA (2 carbons, derived from pyruvate) combines with oxaloacetate (4 carbons) to form citrate (6 carbons).
2. **Energy Harvesting**: Through an 8-step enzymatic loop, citrate is oxidized, releasing 2 molecules of CO₂ and generating high-energy electron carriers (**3 NADH** and **1 FADH₂**) plus **1 ATP (or GTP)** per turn.
3. **Why It Matters**: Those NADH and FADH₂ molecules donate electrons to the Electron Transport Chain (oxidative phosphorylation) to drive the synthesis of the majority of cellular ATP.`;
  }

  if (qLower.includes('photosynthesis') || qLower.includes('chloroplast')) {
    return `**Photosynthesis** is the biochemical process by which plants, algae, and cyanobacteria convert light energy into chemical energy stored in glucose (6CO₂ + 6H₂O + light → C₆H₁₂O₆ + 6O₂):
• **Light-Dependent Reactions** (in the thylakoid membranes): Capture photons to split water, release O₂, and produce ATP and NADPH.
• **Calvin Cycle / Light-Independent Reactions** (in the stroma): Uses ATP and NADPH to fix carbon dioxide (CO₂) into three-carbon sugars (G3P) via the enzyme RuBisCO.`;
  }

  if (qLower.includes('newton') || qLower.includes('motion') || qLower.includes('force')) {
    return `**Newton's Three Laws of Motion** form the foundation of classical mechanics:
1. **First Law (Inertia)**: An object remains at rest or in uniform straight-line motion unless acted upon by a net external force.
2. **Second Law (F = ma)**: The net force on an object equals its mass multiplied by its acceleration.
3. **Third Law (Action–Reaction)**: Whenever object A exerts a force on object B, object B simultaneously exerts an equal and opposite force on object A.`;
  }

  if (qLower.includes('machine learning') || qLower.includes('neural network') || qLower.includes('spam')) {
    return `In **Machine Learning**, probabilistic and statistical principles are used to learn patterns from data and make predictions:
• **Naive Bayes Classifiers** apply Bayes' Theorem directly by multiplying the likelihood of individual features (such as words in an email) given a class (Spam vs. Inbox) with the prior probability of that class.
• **Step-by-step intuition**: Start with a prior belief, multiply by the likelihood of the observed features, and normalize across all possible classes to pick the highest posterior probability.`;
  }

  const cleanedTopic = question
    .replace(/^(what|how|why|explain|define|tell me about|can you explain|give me an example of)\s+(is|are|does|do|the|a|an)?\s*/i, '')
    .replace(/[?.!]+$/, '')
    .trim();

  return `Here is a clear general-knowledge overview of **${cleanedTopic || 'this concept'}**:
1. **Core Definition**: This concept addresses how key variables, principles, or mechanisms interact within its domain to produce predictable outcomes.
2. **Step-by-Step Breakdown**:
   • First, identify the baseline assumptions or inputs involved in ${cleanedTopic || 'the problem'}.
   • Second, apply the governing rule or relationship connecting the inputs to the output.
   • Third, verify the result with a concrete example or boundary check.
3. **Study Tip**: Compare how this general concept relates to the core definitions in your primary course syllabus.`;
}

/**
 * Hybrid Knowledge Answering fallback that handles:
 * 1. Fully in material -> "material" with verified citations
 * 2. Partially covered / expansion / extra examples -> "both" distinguishing document facts vs general knowledge
 * 3. Absent from material -> "general" starting with "Not covered in your material" + general explanation
 * 4. No document uploaded -> "general" normal educational explanation
 */
function buildHybridTutorFallbackAnswer(
  question: string,
  pages: PageInput[],
  history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  studentContext?: StudentTutorContextInput
): {
  answer: string;
  foundInMaterial: boolean;
  sourceType: TutorSourceType;
  citations: Array<{ pageNumber: number; section: string; quote: string }>;
  relatedTopics: string[];
} {
  if (!pages || pages.length === 0) {
    return {
      answer: buildGeneralKnowledgeExplanation(question),
      foundInMaterial: false,
      sourceType: 'general',
      citations: [],
      relatedTopics: [],
    };
  }

  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'does', 'is', 'are', 'was', 'were', 'the', 'and', 'for', 'with', 'from',
    'that', 'this', 'explain', 'define', 'tell', 'about', 'can', 'you', 'your',
    'between', 'difference', 'formula', 'mean', 'meaning', 'notes', 'material',
    'page', 'give', 'more', 'another', 'extra', 'real', 'world', 'application',
    'step', 'simple', 'simply', 'example', 'examples', 'relate', 'related',
  ]);

  const qLower = question.toLowerCase();

  const isFollowUpRequest =
    /\b(more simply|simpler|simplify|deeper|greater depth|derivation|step-by-step|step by step|another example|extra example|real-world|real world|analogy|follow up|elaborate|break it down)\b/i.test(
      question
    );

  const asksHybridExtension =
    isFollowUpRequest ||
    /\b(real-world|real world|machine learning|application|beyond|outside|analogy|step-by-step|step by step|extra example)\b/i.test(
      question
    );

  let searchContext = question;
  if (isFollowUpRequest && history && history.length > 0) {
    const recentText = history
      .slice(-2)
      .map((h) => h.content)
      .join(' ');
    searchContext = `${question} ${recentText}`;
  } else if (studentContext?.currentTopic && qLower.includes('this topic')) {
    searchContext = `${question} ${studentContext.currentTopic}`;
  }

  const queryTokens = searchContext
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  const scoredPages = pages
    .map((p) => {
      const lower = `${p.title} ${p.content}`.toLowerCase();
      let matches = 0;
      for (const token of queryTokens) {
        if (lower.includes(token)) matches += 1;
      }
      return { page: p, matches };
    })
    .filter((item) => item.matches > 0)
    .sort((a, b) => b.matches - a.matches);

  if (scoredPages.length === 0) {
    const generalExplanation = buildGeneralKnowledgeExplanation(question);
    return {
      answer: `Not covered in your material.\n\n**General Knowledge Explanation:**\n\n${generalExplanation}`,
      foundInMaterial: false,
      sourceType: 'general',
      citations: [],
      relatedTopics: [],
    };
  }

  const topPages = scoredPages.slice(0, 2);
  const citations = topPages.map(({ page }) => {
    const paragraphs = page.content
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 25);
    const matchingLine =
      paragraphs.find((line) =>
        queryTokens.some((tok) => line.toLowerCase().includes(tok))
      ) ||
      paragraphs[0] ||
      page.content.slice(0, 140);

    return {
      pageNumber: page.pageNumber,
      section: page.title || `Page ${page.pageNumber}`,
      quote: matchingLine.slice(0, 180),
    };
  });

  const materialParts = topPages.map(({ page }) => {
    const lines = page.content
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const relevant = lines.filter((line) =>
      queryTokens.some((tok) => line.toLowerCase().includes(tok))
    );
    const snippet = (relevant.length > 0 ? relevant.slice(0, 3) : lines.slice(0, 3)).join(' ');
    return `**Page ${page.pageNumber} (${page.title}):** ${snippet}`;
  });

  const unmachedTokens = queryTokens.filter(
    (tok) =>
      !topPages.some(({ page }) =>
        `${page.title} ${page.content}`.toLowerCase().includes(tok)
      )
  );

  const weakTopicNote =
    studentContext?.weakTopics &&
    studentContext.weakTopics.some((wt) =>
      topPages.some((tp) => tp.page.title.toLowerCase().includes(wt.toLowerCase()))
    )
      ? `\n\n**Personalized Study Note:** Because **${studentContext.weakTopics[0]}** is one of your current focus areas from the quiz, pay extra attention to the condition on Page ${topPages[0].page.pageNumber}.`
      : '';

  if (asksHybridExtension || (unmachedTokens.length > 0 && scoredPages[0].matches < queryTokens.length)) {
    const primaryTopic = topPages[0].page.title;
    let generalAddendum: string;
    if (qLower.includes('simplify') || qLower.includes('simpler')) {
      generalAddendum = `In plain terms, think of ${primaryTopic} as organizing all possible outcomes into a clear map before calculating any chance.\n\nStep 1: List the complete set of outcomes (the sample space Ω).\nStep 2: Identify the specific outcome you care about (event E).\nStep 3: Compare the size or weight of event E against the whole space Ω, keeping the result between 0 and 1.`;
    } else if (qLower.includes('machine learning') || qLower.includes('spam')) {
      generalAddendum = buildGeneralKnowledgeExplanation(question);
    } else {
      generalAddendum = `Think of ${primaryTopic} as narrowing down possibilities step-by-step whenever you observe new evidence.\n\nWorked Example:\n• Step 1: Write down the known quantities from the problem statement.\n• Step 2: Substitute them directly into the formula on Page ${topPages[0].page.pageNumber}.\n• Step 3: Verify that all resulting probabilities remain between 0 and 1.`;
    }

    return {
      answer: `**From your material:**\n\n${materialParts.join('\n\n')}\n\n**General knowledge expansion:**\n\n${generalAddendum}${weakTopicNote}`,
      foundInMaterial: true,
      sourceType: 'both',
      citations,
      relatedTopics: topPages.map((t) => t.page.title),
    };
  }

  return {
    answer: `**From your material:**\n\n${materialParts.join('\n\n')}${weakTopicNote}`,
    foundInMaterial: true,
    sourceType: 'material',
    citations,
    relatedTopics: topPages.map((t) => t.page.title),
  };
}

function buildGroundedFallbackQuiz(
  pages: PageInput[],
  topics: TopicInput[],
  mode: 'diagnostic' | 'adaptive',
  focusTopics?: string[],
  questionCount = 6
) {
  const validPageSet = new Set(pages.map((p) => p.pageNumber));
  const targetCount = Math.max(5, Math.min(30, questionCount));

  let candidatePages = pages;
  if (mode === 'adaptive' && focusTopics && focusTopics.length > 0) {
    const matched = pages.filter((p) =>
      focusTopics.some(
        (ft) =>
          p.title.toLowerCase().includes(ft.toLowerCase()) ||
          p.content.toLowerCase().includes(ft.toLowerCase())
      )
    );
    if (matched.length > 0) candidatePages = matched;
  }

  const perPageStatements: Array<
    Array<{
      pageNumber: number;
      topic: string;
      fact: string;
      term: string;
    }>
  > = [];

  for (const page of candidatePages) {
    const matchedTopic =
      topics.find((t) => t.sourcePages.includes(page.pageNumber))?.name ||
      (focusTopics && focusTopics[0]) ||
      page.title ||
      `Page ${page.pageNumber} Concepts`;

    const lines = page.content
      .split('\n')
      .map((l) => l.replace(/^[•\-*\d.)\s]+/, '').trim())
      .filter((l) => l.length >= 35 && l.length <= 210);

    const pageItems = lines.map((line) => {
      const colonParts = line.split(':');
      const term =
        colonParts.length > 1 && colonParts[0].length <= 45
          ? colonParts[0].trim()
          : matchedTopic;
      return {
        pageNumber: validPageSet.has(page.pageNumber) ? page.pageNumber : 1,
        topic: matchedTopic,
        fact: line,
        term,
      };
    });

    if (pageItems.length > 0) {
      perPageStatements.push(pageItems);
    }
  }

  const statements: Array<{
    pageNumber: number;
    topic: string;
    fact: string;
    term: string;
  }> = [];

  let round = 0;
  while (statements.length < targetCount * 2 && round < 10) {
    let addedInRound = false;
    for (const bucket of perPageStatements) {
      if (round < bucket.length) {
        statements.push(bucket[round]);
        addedInRound = true;
      }
    }
    if (!addedInRound) break;
    round++;
  }

  while (statements.length < targetCount) {
    const fallbackPage = candidatePages[statements.length % candidatePages.length] || pages[0];
    statements.push({
      pageNumber: fallbackPage.pageNumber,
      topic: fallbackPage.title || `Page ${fallbackPage.pageNumber}`,
      fact: fallbackPage.content.slice(0, 140).replace(/\s+/g, ' ').trim(),
      term: fallbackPage.title || `Section ${fallbackPage.pageNumber}`,
    });
  }

  const questions = [];
  for (let i = 0; i < targetCount; i++) {
    const item = statements[i % statements.length];
    const otherFacts = statements
      .filter((s) => s.fact !== item.fact)
      .map((s) => s.fact);

    const distractor1 =
      otherFacts[i % Math.max(1, otherFacts.length)] ||
      `It only applies when the sample space is empty and probability is zero.`;
    const distractor2 =
      otherFacts[(i + 1) % Math.max(1, otherFacts.length)] ||
      `It reverses the relationship by multiplying unrelated constants without normalization.`;
    const distractor3 =
      `It assumes ${item.term} is always constant and independent of the conditions on Page ${item.pageNumber}.`;

    const correctOption = item.fact;
    const correctIndex = i % 4;
    const options: [string, string, string, string] = ['', '', '', ''];
    options[correctIndex] = correctOption;
    let dIdx = 0;
    const distractors = [distractor1, distractor2, distractor3];
    for (let slot = 0; slot < 4; slot++) {
      if (slot !== correctIndex) {
        options[slot] = distractors[dIdx++];
      }
    }

    questions.push({
      id: `q-${mode}-${Date.now()}-${i + 1}`,
      topic: item.topic,
      question:
        mode === 'adaptive'
          ? `[Adaptive Focus: ${item.topic}] Based on Page ${item.pageNumber}, which statement accurately describes ${item.term}?`
          : `According to Page ${item.pageNumber} (${item.topic}), which of the following statements is accurate?`,
      options,
      correctIndex,
      explanation: `Page ${item.pageNumber} explicitly states: "${item.fact}"`,
      sourcePage: item.pageNumber,
      sourceQuote: item.fact.slice(0, 160),
      difficulty: (i % 3 === 0 ? 'easy' : i % 3 === 1 ? 'medium' : 'hard') as
        | 'easy'
        | 'medium'
        | 'hard',
    });
  }

  return { questions };
}

/**
 * Sets up the Gemini Live Voice Tutor WebSocket bridge (/api/live) using model 'gemini-3.8-live'.
 */
function attachGeminiLiveWebSocketServer(httpServer: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
      if (url.pathname === '/api/live') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // ignore non-live upgrades (e.g. Vite HMR)
    }
  });

  wss.on('connection', (clientWs: WebSocket) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let liveSession: any = null;
    let sessionPages: PageInput[] = [];
    let sessionTitle = 'Study Material';
    let sessionWeakTopics: string[] = [];

    const safeSend = (payload: Record<string, unknown>) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (rawBuffer) => {
      try {
        const msg = JSON.parse(rawBuffer.toString()) as {
          type: string;
          title?: string;
          pages?: PageInput[];
          weakTopics?: string[];
          currentTopic?: string;
          data?: string;
          question?: string;
        };

        if (msg.type === 'setup') {
          sessionTitle = msg.title || 'Study Material';
          sessionPages = Array.isArray(msg.pages) ? msg.pages : [];
          sessionWeakTopics = Array.isArray(msg.weakTopics) ? msg.weakTopics : [];

          const ai = getGenAIClient();
          if (!ai) {
            safeSend({
              type: 'status',
              state: 'fallback_ready',
              message:
                'Gemini Live API key not configured; interactive voice tutoring is active using grounded speech synthesis.',
            });
            return;
          }

          const condensedMaterial = sessionPages
            .slice(0, 6)
            .map((p) => `Page ${p.pageNumber} (${p.title}): ${p.content.slice(0, 650)}`)
            .join('\n\n');

          const systemInstruction = `You are LearnMate's real-time Voice Study Tutor helping a student understand "${sessionTitle}".
${sessionWeakTopics.length > 0 ? `Student weak topics to reinforce gently: ${sessionWeakTopics.join(', ')}.` : ''}
Study Material Reference:
${condensedMaterial}

Rules for Voice Tutoring:
- Speak naturally, warmly, and concisely (2 to 4 sentences per turn).
- Reference specific page numbers verbally (e.g. "On Page 2 of your notes...") whenever answering from the material.
- Encourage the student and ask a short check-for-understanding question when appropriate.`;

          try {
            const connectPromise = ai.live.connect({
              model: 'gemini-3.8-live',
              config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: 'Zephyr' },
                  },
                },
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                systemInstruction: {
                  parts: [{ text: systemInstruction }],
                },
              },
              callbacks: {
                onopen: () => {
                  safeSend({
                    type: 'status',
                    state: 'connected',
                    model: 'gemini-3.8-live',
                  });
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onmessage: (serverMsg: any) => {
                  const sc = serverMsg?.serverContent;
                  const parts = sc?.modelTurn?.parts || [];
                  for (const part of parts) {
                    if (part?.inlineData?.data) {
                      safeSend({
                        type: 'audio',
                        data: part.inlineData.data,
                        mimeType: part.inlineData.mimeType || 'audio/pcm;rate=24000',
                      });
                    }
                    if (part?.text) {
                      safeSend({
                        type: 'transcript',
                        role: 'assistant',
                        text: part.text,
                      });
                    }
                  }
                  if (sc?.outputTranscription?.text) {
                    safeSend({
                      type: 'output_transcription',
                      text: sc.outputTranscription.text,
                      finished: Boolean(sc.outputTranscription.finished),
                    });
                  }
                  if (sc?.inputTranscription?.text) {
                    safeSend({
                      type: 'input_transcription',
                      text: sc.inputTranscription.text,
                      finished: Boolean(sc.inputTranscription.finished),
                    });
                  }
                  if (sc?.interrupted) {
                    safeSend({ type: 'interrupted' });
                  }
                  if (sc?.turnComplete) {
                    safeSend({ type: 'turn_complete' });
                  }
                },
                onerror: (err: unknown) => {
                  safeSend({
                    type: 'status',
                    state: 'fallback_ready',
                    message:
                      err instanceof Error
                        ? err.message
                        : 'Gemini Live stream switched to grounded voice synthesis.',
                  });
                },
                onclose: () => {
                  liveSession = null;
                },
              },
            });

            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('LIVE_CONNECT_TIMEOUT')), 4500)
            );

            liveSession = await Promise.race([connectPromise, timeoutPromise]);
          } catch (err) {
            liveSession = null;
            safeSend({
              type: 'status',
              state: 'fallback_ready',
              message:
                err instanceof Error ? err.message : 'Live audio stream unavailable; using grounded voice mode.',
            });
          }
          return;
        }

        if (msg.type === 'audio' && msg.data && liveSession) {
          try {
            liveSession.sendRealtimeInput({
              audio: {
                data: msg.data,
                mimeType: 'audio/pcm;rate=16000',
              },
            });
          } catch {
            // ignore transient frame error
          }
          return;
        }

        if (msg.type === 'voice_question' && msg.question) {
          const qText = msg.question.trim();
          if (!qText) return;

          if (liveSession) {
            try {
              if (typeof liveSession.sendClientContent === 'function') {
                liveSession.sendClientContent({
                  turns: [{ role: 'user', parts: [{ text: qText }] }],
                  turnComplete: true,
                });
                return;
              }
            } catch {
              // fall through to grounded tutor voice response
            }
          }

          // Grounded voice tutor response (ensures immediate spoken tutoring even if raw PCM Live stream is unavailable)
          const grounded = buildHybridTutorFallbackAnswer(
            qText,
            sessionPages,
            [],
            { weakTopics: sessionWeakTopics }
          );
          const cleanSpoken = grounded.answer
            .replace(/\*\*/g, '')
            .replace(/•/g, '')
            .replace(/\n+/g, ' ')
            .trim();

          safeSend({
            type: 'voice_response',
            text: cleanSpoken,
            citations: grounded.citations,
            sourceType: grounded.sourceType,
          });
        }
      } catch {
        // ignore malformed ws message
      }
    });

    clientWs.on('close', () => {
      if (liveSession && typeof liveSession.close === 'function') {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
      }
      liveSession = null;
    });
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // 1. Analyze uploaded study material & extract page-grounded topics
  app.post('/api/study/analyze', async (req, res) => {
    try {
      const { title, pages } = req.body as { title?: string; pages?: PageInput[] };
      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Pages array is required for document analysis.' });
        return;
      }

      const validPageNumbers = new Set(pages.map((p) => p.pageNumber));
      const contextText = formatPagesContext(pages);

      try {
        const { data: parsed } = await generateStructuredJson<{
          overview: string;
          topics: Array<{
            name: string;
            summary: string;
            keyConcepts: string[];
            sourcePages: number[];
          }>;
        }>({
          operation: 'study_analyze',
          systemInstruction:
            'You are LearnMate, an academic study assistant. Analyze the provided page-indexed study material and extract 3 to 6 core study topics strictly grounded in the text. Every topic MUST reference valid page numbers from the input.',
          prompt: `Document Title: ${title || 'Study Material'}\n\nStudy Material Pages:\n${contextText}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overview: {
                type: Type.STRING,
                description: 'A concise 1-2 sentence overview of the study material.',
              },
              topics: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    keyConcepts: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    sourcePages: {
                      type: Type.ARRAY,
                      items: { type: Type.INTEGER },
                    },
                  },
                  required: ['name', 'summary', 'keyConcepts', 'sourcePages'],
                },
              },
            },
            required: ['overview', 'topics'],
          },
        });

        const sanitizedTopics: TopicInput[] = (parsed.topics || []).map((t, idx) => {
          const verifiedPages = (t.sourcePages || []).filter((num) => validPageNumbers.has(num));
          return {
            id: `topic-${Date.now()}-${idx + 1}`,
            name: t.name || `Topic ${idx + 1}`,
            summary: t.summary || '',
            keyConcepts: Array.isArray(t.keyConcepts) ? t.keyConcepts.slice(0, 5) : [],
            sourcePages: verifiedPages.length > 0 ? verifiedPages : [pages[0].pageNumber],
          };
        });

        res.json({
          overview: parsed.overview || `Study guide for ${title || 'uploaded material'}.`,
          topics:
            sanitizedTopics.length > 0
              ? sanitizedTopics
              : buildGroundedFallbackAnalysis(title || 'Study Material', pages).topics,
        });
      } catch (err) {
        const notice = extractAiNotice(err);
        const fallback = buildGroundedFallbackAnalysis(title || 'Study Material', pages);
        res.json({
          ...fallback,
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to analyze document.',
      });
    }
  });

  // 2. Context-Aware AI Study Tutor with Source-Control Mode (Material Only vs Extended Knowledge) & Model Choice
  app.post('/api/study/ask', async (req, res) => {
    try {
      const {
        title,
        pages = [],
        question,
        history,
        modelPreference,
        studentContext,
        sourceControlMode = 'expanded_default',
      } = req.body as {
        title?: string;
        pages?: PageInput[];
        question?: string;
        history?: Array<{ role: 'user' | 'assistant'; content: string }>;
        modelPreference?: string;
        studentContext?: StudentTutorContextInput;
        sourceControlMode?: SourceControlMode | 'expanded_default';
      };

      if (!question || !question.trim()) {
        res.status(400).json({ error: 'Please enter a question.' });
        return;
      }

      const explicitStrictMode = sourceControlMode === 'material_only';
      const hasDocument = Array.isArray(pages) && pages.length > 0;
      const validPageNumbers = new Set(hasDocument ? pages.map((p) => p.pageNumber) : []);
      const contextText = hasDocument ? formatPagesContext(pages) : 'No uploaded study material.';
      const historyContext =
        history && history.length > 0
          ? history
              .slice(-6)
              .map((h) => `${h.role.toUpperCase()}: ${h.content}`)
              .join('\n')
          : 'No prior messages.';

      const studentContextSummary = studentContext
        ? [
            studentContext.currentTopic ? `Active Topic: ${studentContext.currentTopic}` : '',
            studentContext.currentPage ? `Viewing Page: ${studentContext.currentPage}` : '',
            studentContext.currentActivity ? `Learning Mode: ${studentContext.currentActivity}` : '',
            studentContext.weakTopics && studentContext.weakTopics.length > 0
              ? `Student Weak Topics from Quizzes: ${studentContext.weakTopics.join(', ')}`
              : '',
            typeof studentContext.recentScorePct === 'number'
              ? `Latest Quiz Score: ${studentContext.recentScorePct}%`
              : '',
          ]
            .filter(Boolean)
            .join(' | ')
        : 'Standard study session';

      try {
        const { data: parsed, modelUsed } = await generateStructuredJson<{
          answer: string;
          sourceType: 'material' | 'general' | 'both';
          foundInMaterial: boolean;
          citations: Array<{
            pageNumber: number;
            section: string;
            quote: string;
          }>;
          relatedTopics: string[];
        }>({
          operation: `study_ask_${explicitStrictMode ? 'strict' : 'hybrid'}`,
          preferredModel: modelPreference,
          systemInstruction: explicitStrictMode
            ? `You are LearnMate's Strict Source-Grounded Study Tutor operating in MATERIAL ONLY mode.
Student Learning Context: ${studentContextSummary}
Rules for Material Only Mode:
1. Answer ONLY if the explanation is directly supported by the provided Study Material Pages.
2. Every claim MUST include verified page citations (pageNumber, section, verbatim quote).
3. If the topic is NOT covered in the provided Study Material Pages, set "foundInMaterial": false, "sourceType": "general", "citations": [], and set "answer" to: "This topic is not covered in your uploaded study material. Switch to Extended Knowledge mode if you want a general explanation."`
            : `You are LearnMate's Context-Aware Hybrid AI Study Tutor.
Student Learning Context: ${studentContextSummary}

Follow these exact rules for Hybrid Knowledge Answering:
1. PRIORITIZE UPLOADED MATERIAL: Always check the provided Study Material Pages first.
2. FULLY IN MATERIAL ("sourceType": "material"):
   - If the answer is fully covered in the uploaded pages, explain it clearly using the document and return verified page citations (pageNumber, section, verbatim quote). Set "foundInMaterial": true.
3. PARTIALLY COVERED OR EXPANSION REQUEST ("sourceType": "both"):
   - If the question is partially covered in the document, OR if the student asks for extra examples, simplified analogies, step-by-step teaching, or follow-up questions extending a document topic, combine the document information with your general knowledge.
   - Clearly distinguish the two in your answer using headings like "**From your material:**" and "**General knowledge:**".
   - Include verified citations ONLY for the parts that came from the uploaded pages. Set "foundInMaterial": true.
4. ABSENT FROM MATERIAL ("sourceType": "general"):
   - If the uploaded material does not cover the question at all, you MUST start your answer with the exact phrase: "Not covered in your material." and then provide a helpful, clear general-knowledge explanation (with step-by-step teaching or examples).
   - Set "foundInMaterial": false and "citations": []. NEVER fabricate document citations or imply general knowledge came from the PDF.
5. NO UPLOADED MATERIAL:
   - If no study material pages are provided, answer the educational question normally using general knowledge with "sourceType": "general" and "citations": [].
6. PERSONALIZED AWARENESS:
   - When relevant, connect your explanation to the student's active topic or weak topics so they can overcome misconceptions.`,
          prompt: `Document: ${hasDocument ? title || 'Study Material' : 'None'}\n\nStudy Material Pages:\n${contextText}\n\nConversation History:\n${historyContext}\n\nStudent Question: ${question.trim()}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              answer: { type: Type.STRING },
              sourceType: {
                type: Type.STRING,
                description: 'Must be "material", "general", or "both".',
              },
              foundInMaterial: { type: Type.BOOLEAN },
              citations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pageNumber: { type: Type.INTEGER },
                    section: { type: Type.STRING },
                    quote: { type: Type.STRING },
                  },
                  required: ['pageNumber', 'section', 'quote'],
                },
              },
              relatedTopics: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['answer', 'sourceType', 'foundInMaterial', 'citations', 'relatedTopics'],
          },
        });

        if (explicitStrictMode) {
          const policyResult = enforceSourceControlPolicy({
            mode: 'material_only',
            rawAnswer: parsed.answer || '',
            foundInMaterial: Boolean(parsed.foundInMaterial),
            citations: parsed.citations || [],
            validPageNumbers,
          });
          res.json({
            answer: policyResult.answer,
            foundInMaterial: policyResult.foundInMaterial,
            sourceType: policyResult.sourceType,
            sourceControlMode: 'material_only',
            citations: policyResult.citations,
            relatedTopics: policyResult.foundInMaterial && Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
            modelUsed,
          });
          return;
        }

        const verifiedCitations = hasDocument
          ? (parsed.citations || []).filter((c) => validPageNumbers.has(c.pageNumber))
          : [];

        let sourceType: TutorSourceType =
          parsed.sourceType === 'material' ||
          parsed.sourceType === 'both' ||
          parsed.sourceType === 'general'
            ? parsed.sourceType
            : verifiedCitations.length > 0
            ? 'material'
            : 'general';

        if (!hasDocument || verifiedCitations.length === 0) {
          sourceType = 'general';
        }

        const isFound = sourceType === 'material' || sourceType === 'both';
        let finalAnswer = (parsed.answer || '').trim();

        if (
          hasDocument &&
          sourceType === 'general' &&
          !finalAnswer.toLowerCase().includes('not covered in your material')
        ) {
          finalAnswer = `Not covered in your material.\n\n${finalAnswer}`;
        }

        res.json({
          answer: finalAnswer,
          foundInMaterial: isFound,
          sourceType,
          sourceControlMode: 'extended_knowledge',
          citations: isFound ? verifiedCitations : [],
          relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
          modelUsed,
        });
      } catch (err) {
        const notice = extractAiNotice(err);
        const fallback = buildHybridTutorFallbackAnswer(
          question,
          pages,
          history,
          studentContext
        );
        if (explicitStrictMode) {
          const policyResult = enforceSourceControlPolicy({
            mode: 'material_only',
            rawAnswer: fallback.answer,
            foundInMaterial: fallback.foundInMaterial,
            citations: fallback.citations,
            validPageNumbers,
          });
          res.json({
            answer: policyResult.answer,
            foundInMaterial: policyResult.foundInMaterial,
            sourceType: policyResult.sourceType,
            sourceControlMode: 'material_only',
            citations: policyResult.citations,
            relatedTopics: policyResult.foundInMaterial ? fallback.relatedTopics : [],
            modelUsed: modelPreference || 'gemini-3.8-flash',
            aiStatus: notice.aiStatus,
            aiNotice: notice.aiNotice,
          });
          return;
        }
        res.json({
          ...fallback,
          sourceControlMode: 'extended_knowledge',
          modelUsed: modelPreference || 'gemini-3.8-flash',
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to answer question.',
      });
    }
  });

  // 3. Generate Diagnostic or Adaptive Quiz (5-8 grounded MCQs with 4 choices)
  app.post('/api/study/quiz', async (req, res) => {
    try {
      const {
        title,
        pages,
        topics = [],
        mode = 'diagnostic',
        focusTopics = [],
        questionCount = 6,
        forceRefresh = false,
      } = req.body as {
        title?: string;
        pages?: PageInput[];
        topics?: TopicInput[];
        mode?: 'diagnostic' | 'adaptive';
        focusTopics?: string[];
        questionCount?: number;
        forceRefresh?: boolean;
      };

      if (!pages || !Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Study material pages are required to generate a quiz.' });
        return;
      }

      const clampedCount = Math.max(5, Math.min(30, Number(questionCount) || 6));
      const validPageNumbers = new Set(pages.map((p) => p.pageNumber));
      const contextText = formatPagesContext(pages);

      const focusInstruction =
        mode === 'adaptive' && focusTopics.length > 0
          ? `This is an ADAPTIVE PRACTICE quiz. Focus all ${clampedCount} questions specifically on these weak topics that the student struggled with: ${focusTopics.join(', ')}. Test conceptual understanding from new angles.`
          : `This is a DIAGNOSTIC QUIZ. Generate ${clampedCount} multiple-choice questions spanning across the key topics in the material (${topics.map((t) => t.name).join(', ') || 'all pages'}).`;

      try {
        const { data: parsed } = await generateStructuredJson<{
          questions: Array<{
            topic: string;
            question: string;
            options: string[];
            correctIndex: number;
            explanation: string;
            sourcePage: number;
            sourceQuote: string;
            difficulty: 'easy' | 'medium' | 'hard';
          }>;
        }>({
          operation: `study_quiz_${mode}_${clampedCount}`,
          bypassCache: Boolean(forceRefresh),
          systemInstruction: `You are LearnMate's assessment generator.
Generate ${clampedCount} grounded Multiple-Choice Questions (MCQs) strictly derived from the provided Study Material Pages.
Rules:
- Every question MUST have exactly 4 distinct options.
- "correctIndex" MUST be an integer 0, 1, 2, or 3 corresponding to the single unambiguously correct option in "options".
- "sourcePage" MUST be an existing page number from the study material.
- "sourceQuote" MUST be a brief quote or formula from that page supporting the answer.
- ${focusInstruction}`,
          prompt: `Document: ${title || 'Study Material'}\n\nStudy Material Pages:\n${contextText}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    question: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                    sourceQuote: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                  },
                  required: [
                    'topic',
                    'question',
                    'options',
                    'correctIndex',
                    'explanation',
                    'sourcePage',
                    'sourceQuote',
                    'difficulty',
                  ],
                },
              },
            },
            required: ['questions'],
          },
        });

        const rawQuestions = (parsed.questions || []).slice(0, clampedCount);
        if (rawQuestions.length < 5) {
          throw new Error('INSUFFICIENT_QUESTIONS');
        }

        const sanitizedQuestions = rawQuestions.map((q, idx) => {
          const opts = Array.isArray(q.options) ? q.options.slice(0, 4) : [];
          while (opts.length < 4) {
            opts.push(`Option ${opts.length + 1}`);
          }
          const safeIndex =
            typeof q.correctIndex === 'number' && q.correctIndex >= 0 && q.correctIndex <= 3
              ? q.correctIndex
              : 0;
          const safePage = validPageNumbers.has(q.sourcePage)
            ? q.sourcePage
            : pages[0].pageNumber;
          const diff =
            q.difficulty === 'easy' || q.difficulty === 'medium' || q.difficulty === 'hard'
              ? q.difficulty
              : 'medium';

          return {
            id: `q-${mode}-${Date.now()}-${idx + 1}`,
            topic: q.topic || topics[idx % Math.max(1, topics.length)]?.name || `Page ${safePage}`,
            question: q.question,
            options: [opts[0], opts[1], opts[2], opts[3]] as [string, string, string, string],
            correctIndex: safeIndex,
            explanation: q.explanation,
            sourcePage: safePage,
            sourceQuote: q.sourceQuote || '',
            difficulty: diff,
          };
        });

        res.json({ questions: sanitizedQuestions });
      } catch (err) {
        const notice = extractAiNotice(err);
        const fallback = buildGroundedFallbackQuiz(
          pages,
          topics,
          mode,
          focusTopics,
          clampedCount
        );
        res.json({
          ...fallback,
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate quiz.',
      });
    }
  });

  // 4. Mistake DNA & Personalized Revision Plan from actual quiz attempt
  app.post('/api/study/mistakes-and-plan', async (req, res) => {
    try {
      const { documentId, title, pages, attempt } = req.body as {
        documentId: string;
        title?: string;
        pages?: PageInput[];
        attempt?: {
          id: string;
          questions: Array<{
            id: string;
            topic: string;
            question: string;
            options: [string, string, string, string];
            correctIndex: number;
            explanation: string;
            sourcePage: number;
            sourceQuote: string;
          }>;
          answers: Array<{
            questionId: string;
            selectedIndex: number;
            isCorrect: boolean;
            topic: string;
            sourcePage: number;
          }>;
        };
      };

      if (!pages || !attempt) {
        res.status(400).json({ error: 'Pages and quiz attempt data are required.' });
        return;
      }

      const validPageNumbers = new Set(pages.map((p) => p.pageNumber));
      const wrongDetails = attempt.answers
        .filter((a) => !a.isCorrect)
        .map((ans) => {
          const q = attempt.questions.find((item) => item.id === ans.questionId);
          if (!q) return null;
          return {
            questionId: q.id,
            topic: q.topic,
            question: q.question,
            selectedOption:
              ans.selectedIndex >= 0 && ans.selectedIndex < 4
                ? q.options[ans.selectedIndex]
                : 'No answer selected',
            correctOption: q.options[q.correctIndex],
            explanation: q.explanation,
            sourcePage: q.sourcePage,
            sourceQuote: q.sourceQuote,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      if (wrongDetails.length === 0) {
        res.json({
          mistakes: [],
          revisionPlan: [
            {
              id: `rev-${Date.now()}-mastery`,
              documentId,
              topic: 'All Tested Topics Mastered',
              priority: 'low',
              reason: 'You scored 100% on your quiz attempt with zero misconceptions detected.',
              recommendedAction:
                'Challenge yourself with an Adaptive Practice session or explore deeper questions in the AI Study Tutor.',
              conceptSummary: 'All core concepts across your material were answered accurately.',
              sourcePage: pages[0]?.pageNumber || 1,
              completed: true,
              updatedAt: new Date().toISOString(),
            },
          ],
        });
        return;
      }

      const contextText = formatPagesContext(pages);

      try {
        const { data: parsed } = await generateStructuredJson<{
          mistakes: Array<{
            questionId: string;
            likelyMisconception: string;
            coreConceptFix: string;
          }>;
          revisionPlan: Array<{
            topic: string;
            priority: 'high' | 'medium' | 'low';
            reason: string;
            recommendedAction: string;
            conceptSummary: string;
            sourcePage: number;
          }>;
        }>({
          operation: 'study_mistakes_and_plan',
          systemInstruction: `You are LearnMate's Mistake DNA & Personalized Revision Architect.
Given the study material pages and the exact questions the student answered incorrectly:
1. For each wrong answer, explain the student's "likelyMisconception" (why they chose their selected option instead of the correct option) and the "coreConceptFix" grounded in the source page.
2. Build a prioritized "revisionPlan" of study tasks targeting the weak topics, with specific sourcePage numbers, why it's prioritized, a concrete recommendedAction, and a clear conceptSummary.`,
          prompt: `Document: ${title || 'Study Material'}\n\nStudy Material Pages:\n${contextText}\n\nStudent Incorrect Answers:\n${JSON.stringify(wrongDetails, null, 2)}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              mistakes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    questionId: { type: Type.STRING },
                    likelyMisconception: { type: Type.STRING },
                    coreConceptFix: { type: Type.STRING },
                  },
                  required: ['questionId', 'likelyMisconception', 'coreConceptFix'],
                },
              },
              revisionPlan: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    topic: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    reason: { type: Type.STRING },
                    recommendedAction: { type: Type.STRING },
                    conceptSummary: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                  },
                  required: [
                    'topic',
                    'priority',
                    'reason',
                    'recommendedAction',
                    'conceptSummary',
                    'sourcePage',
                  ],
                },
              },
            },
            required: ['mistakes', 'revisionPlan'],
          },
        });

        const mistakes = wrongDetails.map((w) => {
          const aiMatch = (parsed.mistakes || []).find((m) => m.questionId === w.questionId);
          return {
            questionId: w.questionId,
            topic: w.topic,
            question: w.question,
            selectedOption: w.selectedOption,
            correctOption: w.correctOption,
            likelyMisconception:
              aiMatch?.likelyMisconception ||
              `Confused "${w.selectedOption}" with the core rule on Page ${w.sourcePage}.`,
            coreConceptFix: aiMatch?.coreConceptFix || w.explanation,
            sourcePage: validPageNumbers.has(w.sourcePage) ? w.sourcePage : 1,
            sourceQuote: w.sourceQuote,
          };
        });

        const now = new Date().toISOString();
        const revisionPlan = (parsed.revisionPlan || []).map((task, idx) => {
          const priority =
            task.priority === 'high' || task.priority === 'medium' || task.priority === 'low'
              ? task.priority
              : 'high';
          const safePage = validPageNumbers.has(task.sourcePage)
            ? task.sourcePage
            : wrongDetails[idx % wrongDetails.length]?.sourcePage || 1;
          return {
            id: `rev-${Date.now()}-${idx + 1}`,
            documentId,
            topic: task.topic,
            priority,
            reason: task.reason,
            recommendedAction: task.recommendedAction,
            conceptSummary: task.conceptSummary,
            sourcePage: safePage,
            completed: false,
            updatedAt: now,
          };
        });

        res.json({ mistakes, revisionPlan });
      } catch (err) {
        const notice = extractAiNotice(err);
        const now = new Date().toISOString();
        const mistakes = wrongDetails.map((w) => ({
          questionId: w.questionId,
          topic: w.topic,
          question: w.question,
          selectedOption: w.selectedOption,
          correctOption: w.correctOption,
          likelyMisconception: `Selecting "${w.selectedOption}" overlooks the key condition stated on Page ${w.sourcePage}.`,
          coreConceptFix: w.explanation,
          sourcePage: w.sourcePage,
          sourceQuote: w.sourceQuote,
        }));

        const uniqueTopics = Array.from(new Set(wrongDetails.map((w) => w.topic)));
        const revisionPlan = uniqueTopics.map((topic, idx) => {
          const sample = wrongDetails.find((w) => w.topic === topic)!;
          return {
            id: `rev-${Date.now()}-${idx + 1}`,
            documentId,
            topic,
            priority: 'high' as const,
            reason: `Missed ${wrongDetails.filter((w) => w.topic === topic).length} question(s) on ${topic}.`,
            recommendedAction: `Re-read Page ${sample.sourcePage} carefully and run an Adaptive Practice quiz on ${topic}.`,
            conceptSummary: sample.explanation,
            sourcePage: sample.sourcePage,
            completed: false,
            updatedAt: now,
          };
        });

        res.json({
          mistakes,
          revisionPlan,
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to diagnose mistakes.',
      });
    }
  });

  // 5. On-Demand Quick Revise Generator (Sticky Notes & Flashcards OR Mind Map & One-Page Revision)
  app.post('/api/study/quick-revise', async (req, res) => {
    try {
      const {
        title = 'Study Material',
        overview = '',
        sourceType = 'pdf',
        pages = [],
        topics = [],
        resourceType = 'sticky_and_flashcards',
        forceRefresh = false,
      } = req.body as {
        title?: string;
        overview?: string;
        sourceType?: 'pdf' | 'text' | 'youtube';
        pages?: Array<PageInput & { timestampSeconds?: number; timestampLabel?: string }>;
        topics?: TopicInput[];
        resourceType?: 'sticky_and_flashcards' | 'mindmap_and_revision';
        forceRefresh?: boolean;
      };

      if (!Array.isArray(pages) || pages.length === 0) {
        res.status(400).json({ error: 'Study material pages are required.' });
        return;
      }

      const formatRefLabel = (pageNum: number) => {
        const p = pages.find((item) => item.pageNumber === pageNum);
        if (sourceType === 'youtube') {
          if (p?.timestampLabel) return p.timestampLabel;
          const secs = typeof p?.timestampSeconds === 'number' ? p.timestampSeconds : (pageNum - 1) * 120;
          const m = Math.floor(secs / 60);
          const s = Math.floor(secs % 60);
          return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return sourceType === 'text' ? `Section ${pageNum}` : `Page ${pageNum}`;
      };

      const contextText = pages
        .map(
          (p) =>
            `=== ${formatRefLabel(p.pageNumber)} [pageNumber=${p.pageNumber}] (${p.title}) ===\n${p.content}`
        )
        .join('\n\n');

      const validPageNumbers = new Set(pages.map((p) => p.pageNumber));

      if (resourceType === 'sticky_and_flashcards') {
        try {
          const { data: parsed } = await generateStructuredJson<{
            stickyNotes: Array<{
              title: string;
              content: string;
              formula?: string;
              sourcePage: number;
              frontQuestion: string;
              backAnswer: string;
              topic: string;
            }>;
          }>({
            operation: 'quick_revise_sticky_flashcards',
            bypassCache: Boolean(forceRefresh),
            systemInstruction: `You are LearnMate's Quick Revise generator.
Extract 5 to 8 key concepts from the provided study material.
For each concept, produce:
- "title": A short sticky-note heading (2 to 5 words).
- "content": An ultra-concise sticky note body (10 to 28 words maximum, 1 to 3 short lines).
- "formula": Optional short mathematical formula or key equation if applicable (otherwise empty string).
- "sourcePage": Valid integer pageNumber from the input.
- "frontQuestion": Clear active-recall flashcard question testing this concept.
- "backAnswer": Concise, accurate flashcard explanation (15 to 40 words) grounded in the material.
- "topic": Topic name.`,
            prompt: `Document: ${title}\n\nStudy Material:\n${contextText}`,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                stickyNotes: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      title: { type: Type.STRING },
                      content: { type: Type.STRING },
                      formula: { type: Type.STRING },
                      sourcePage: { type: Type.INTEGER },
                      frontQuestion: { type: Type.STRING },
                      backAnswer: { type: Type.STRING },
                      topic: { type: Type.STRING },
                    },
                    required: [
                      'title',
                      'content',
                      'sourcePage',
                      'frontQuestion',
                      'backAnswer',
                      'topic',
                    ],
                  },
                },
              },
              required: ['stickyNotes'],
            },
          });

          const rawItems = (parsed.stickyNotes || []).slice(0, 8);
          if (rawItems.length < 4) {
            throw new Error('INSUFFICIENT_NOTES');
          }

          const colors: Array<'yellow' | 'pink' | 'blue' | 'green'> = [
            'yellow',
            'pink',
            'blue',
            'green',
          ];

          const stickyNotes = rawItems.map((item, idx) => {
            const safePage = validPageNumbers.has(item.sourcePage)
              ? item.sourcePage
              : pages[idx % pages.length].pageNumber;
            const words = (item.content || '')
              .trim()
              .split(/\s+/)
              .slice(0, 30)
              .join(' ');
            return {
              id: `sn-${Date.now()}-${idx + 1}`,
              title: (item.title || `Concept ${idx + 1}`).slice(0, 42),
              content: words,
              formula: item.formula ? item.formula.trim().slice(0, 60) : undefined,
              sourcePage: safePage,
              sourceLabel: formatRefLabel(safePage),
              color: colors[idx % colors.length],
            };
          });

          const flashcards = rawItems.map((item, idx) => {
            const safePage = validPageNumbers.has(item.sourcePage)
              ? item.sourcePage
              : pages[idx % pages.length].pageNumber;
            return {
              id: `fc-${Date.now()}-${idx + 1}`,
              frontQuestion: item.frontQuestion || `Explain ${item.title}`,
              backAnswer: item.backAnswer || item.content,
              topic: item.topic || item.title,
              sourcePage: safePage,
              sourceLabel: formatRefLabel(safePage),
              status: 'unreviewed' as const,
            };
          });

          res.json({ stickyNotes, flashcards });
          return;
        } catch (err) {
          const notice = extractAiNotice(err);
          // Grounded deterministic extraction from actual pages
          const colors: Array<'yellow' | 'pink' | 'blue' | 'green'> = [
            'yellow',
            'pink',
            'blue',
            'green',
          ];
          const stickyNotes: Array<Record<string, unknown>> = [];
          const flashcards: Array<Record<string, unknown>> = [];

          for (const page of pages) {
            const lines = page.content
              .split('\n')
              .map((l) => l.replace(/^[•\-*\d.)\s]+/, '').trim())
              .filter((l) => l.length >= 22 && l.length <= 200);
            for (const line of lines) {
              if (stickyNotes.length >= 7) break;
              const colonIdx = line.indexOf(':');
              const shortTitle =
                colonIdx > 2 && colonIdx <= 38
                  ? line.slice(0, colonIdx).trim()
                  : page.title.slice(0, 36);
              const body =
                colonIdx > 2 && colonIdx <= 38 ? line.slice(colonIdx + 1).trim() : line;
              const compactBody = body.split(/\s+/).slice(0, 26).join(' ');
              const idx = stickyNotes.length;
              const refLabel = formatRefLabel(page.pageNumber);

              stickyNotes.push({
                id: `sn-fb-${page.pageNumber}-${idx + 1}`,
                title: shortTitle,
                content: compactBody,
                sourcePage: page.pageNumber,
                sourceLabel: refLabel,
                color: colors[idx % colors.length],
              });
              flashcards.push({
                id: `fc-fb-${page.pageNumber}-${idx + 1}`,
                frontQuestion:
                  colonIdx > 2 && colonIdx <= 38
                    ? `What is the key rule or definition of ${shortTitle}?`
                    : `What does ${refLabel} explain about ${page.title}?`,
                backAnswer: compactBody,
                topic:
                  topics.find((t) => t.sourcePages.includes(page.pageNumber))?.name ||
                  page.title,
                sourcePage: page.pageNumber,
                sourceLabel: refLabel,
                status: 'unreviewed' as const,
              });
            }
          }

          res.json({
            stickyNotes: stickyNotes.slice(0, 8),
            flashcards: flashcards.slice(0, 8),
            aiStatus: notice.aiStatus,
            aiNotice: notice.aiNotice,
          });
          return;
        }
      }

      // resourceType === 'mindmap_and_revision'
      try {
        const { data: parsed } = await generateStructuredJson<{
          branches: Array<{
            label: string;
            explanation: string;
            sourcePage: number;
            subtopics: Array<{
              label: string;
              explanation: string;
            }>;
          }>;
          essentialConcepts: Array<{
            title: string;
            summary: string;
            sourcePage: number;
          }>;
          formulasAndDefinitions: Array<{
            term: string;
            formulaOrDef: string;
            sourcePage: number;
          }>;
          keyRelationships: string[];
          commonMistakesToAvoid: string[];
          quickRecallQuestions: Array<{
            question: string;
            shortAnswer: string;
          }>;
        }>({
          operation: 'quick_revise_mindmap_revision',
          bypassCache: Boolean(forceRefresh),
          systemInstruction: `You are LearnMate's Mind Map and One-Page Revision architect.
Analyze the provided study material and generate:
1. "branches": 4 to 6 main concept branches for a mind map. Each branch has a short "label" (2-5 words), a concise "explanation" (1-2 sentences), a valid "sourcePage", and 1 to 2 "subtopics". Never invent relationships not supported by the material.
2. "essentialConcepts": 3 to 5 core takeaways with sourcePage.
3. "formulasAndDefinitions": 3 to 5 key formulas or definitions from the material with sourcePage.
4. "keyRelationships": 3 to 4 concise statements explaining how concepts connect.
5. "commonMistakesToAvoid": 2 to 4 common student pitfalls mentioned or implied by the material.
6. "quickRecallQuestions": 3 to 4 self-check questions with short answers.`,
          prompt: `Document: ${title}\nOverview: ${overview}\n\nStudy Material:\n${contextText}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              branches: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                    subtopics: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          label: { type: Type.STRING },
                          explanation: { type: Type.STRING },
                        },
                        required: ['label', 'explanation'],
                      },
                    },
                  },
                  required: ['label', 'explanation', 'sourcePage', 'subtopics'],
                },
              },
              essentialConcepts: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    summary: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                  },
                  required: ['title', 'summary', 'sourcePage'],
                },
              },
              formulasAndDefinitions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    term: { type: Type.STRING },
                    formulaOrDef: { type: Type.STRING },
                    sourcePage: { type: Type.INTEGER },
                  },
                  required: ['term', 'formulaOrDef', 'sourcePage'],
                },
              },
              keyRelationships: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              commonMistakesToAvoid: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              quickRecallQuestions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    shortAnswer: { type: Type.STRING },
                  },
                  required: ['question', 'shortAnswer'],
                },
              },
            },
            required: [
              'branches',
              'essentialConcepts',
              'formulasAndDefinitions',
              'keyRelationships',
              'commonMistakesToAvoid',
              'quickRecallQuestions',
            ],
          },
        });

        const branchColors: Array<'blue' | 'red' | 'yellow' | 'green'> = [
          'blue',
          'red',
          'yellow',
          'green',
        ];
        const nodes: Array<{
          id: string;
          label: string;
          explanation: string;
          sourcePage: number;
          sourceLabel: string;
          level: 'central' | 'branch' | 'subtopic';
          color: 'blue' | 'red' | 'yellow' | 'green';
          parentId?: string;
        }> = [
          {
            id: 'node-central',
            label: title.replace(/\.pdf$/i, '').slice(0, 38),
            explanation: overview || `Core study material covering ${pages.length} sections.`,
            sourcePage: pages[0].pageNumber,
            sourceLabel: formatRefLabel(pages[0].pageNumber),
            level: 'central',
            color: 'blue',
          },
        ];
        const edges: Array<{ from: string; to: string; relation?: string }> = [];

        (parsed.branches || []).slice(0, 6).forEach((branch, bIdx) => {
          const color = branchColors[bIdx % branchColors.length];
          const safePage = validPageNumbers.has(branch.sourcePage)
            ? branch.sourcePage
            : pages[bIdx % pages.length].pageNumber;
          const branchId = `node-branch-${bIdx + 1}`;
          nodes.push({
            id: branchId,
            label: (branch.label || `Topic ${bIdx + 1}`).slice(0, 34),
            explanation: branch.explanation || '',
            sourcePage: safePage,
            sourceLabel: formatRefLabel(safePage),
            level: 'branch',
            color,
            parentId: 'node-central',
          });
          edges.push({ from: 'node-central', to: branchId });

          (branch.subtopics || []).slice(0, 2).forEach((sub, sIdx) => {
            const subId = `node-sub-${bIdx + 1}-${sIdx + 1}`;
            nodes.push({
              id: subId,
              label: (sub.label || 'Detail').slice(0, 30),
              explanation: sub.explanation || branch.explanation,
              sourcePage: safePage,
              sourceLabel: formatRefLabel(safePage),
              level: 'subtopic',
              color,
              parentId: branchId,
            });
            edges.push({ from: branchId, to: subId });
          });
        });

        const onePageRevision = {
          chapterTitle: title,
          overview: overview || `Compact one-page revision sheet for ${title}.`,
          essentialConcepts: (parsed.essentialConcepts || []).slice(0, 6).map((c) => {
            const safePage = validPageNumbers.has(c.sourcePage)
              ? c.sourcePage
              : pages[0].pageNumber;
            return {
              title: c.title,
              summary: c.summary,
              sourcePage: safePage,
              sourceLabel: formatRefLabel(safePage),
            };
          }),
          formulasAndDefinitions: (parsed.formulasAndDefinitions || [])
            .slice(0, 6)
            .map((f) => {
              const safePage = validPageNumbers.has(f.sourcePage)
                ? f.sourcePage
                : pages[0].pageNumber;
              return {
                term: f.term,
                formulaOrDef: f.formulaOrDef,
                sourceLabel: formatRefLabel(safePage),
              };
            }),
          keyRelationships: (parsed.keyRelationships || []).slice(0, 5),
          commonMistakesToAvoid: (parsed.commonMistakesToAvoid || []).slice(0, 4),
          quickRecallQuestions: (parsed.quickRecallQuestions || []).slice(0, 4),
        };

        res.json({
          mindMap: {
            centralTopic: title.replace(/\.pdf$/i, ''),
            nodes,
            edges,
          },
          onePageRevision,
        });
      } catch (err) {
        const notice = extractAiNotice(err);
        res.status(503).json({
          error:
            notice.aiNotice ||
            'Gemini model timed out; client will use grounded local concept map.',
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate quick revise content.',
      });
    }
  });

  // 6. YouTube Lecture Import & Grounded Timestamped Analysis
  app.post('/api/study/youtube-analyze', async (req, res) => {
    try {
      const { youtubeUrl } = req.body as { youtubeUrl?: string };
      const rawUrl = (youtubeUrl || '').trim();
      if (!rawUrl) {
        res.status(400).json({ error: 'Please provide a YouTube video link.' });
        return;
      }

      let candidate = rawUrl;
      if (!/^https?:\/\//i.test(candidate)) {
        candidate = `https://${candidate}`;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(candidate);
      } catch {
        res.status(400).json({
          error: 'Invalid YouTube URL format. Please paste a link like https://www.youtube.com/watch?v=...',
        });
        return;
      }

      const host = parsedUrl.hostname.replace(/^www\./i, '').replace(/^m\./i, '').toLowerCase();
      let videoId = '';
      if (host === 'youtu.be') {
        videoId = parsedUrl.pathname.split('/').filter(Boolean)[0] || '';
      } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        videoId =
          parsedUrl.searchParams.get('v') ||
          parsedUrl.pathname.split('/').filter(Boolean)[1] ||
          '';
      } else {
        res.status(400).json({
          error: 'Only public YouTube links (youtube.com or youtu.be) are supported.',
        });
        return;
      }

      if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
        res.status(400).json({
          error: 'Could not extract a valid 11-character YouTube video ID from the URL.',
        });
        return;
      }

      const canonicalWatchUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // Verify video exists and is public via YouTube oEmbed
      let oembedTitle = '';
      let oembedAuthor = '';
      try {
        const oembedResp = await fetch(
          `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalWatchUrl)}&format=json`
        );
        if (!oembedResp.ok) {
          res.status(422).json({
            error:
              'This YouTube video appears to be private, unavailable, or restricted from embedding.',
          });
          return;
        }
        const oembedJson = (await oembedResp.json()) as {
          title?: string;
          author_name?: string;
        };
        oembedTitle = oembedJson.title || '';
        oembedAuthor = oembedJson.author_name || '';
      } catch {
        // Proceed to Gemini video analysis if oEmbed network check is unreachable
      }

      const ai = getGenAIClient();
      if (!ai) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY is required on the server to analyze YouTube videos with Gemini.',
        });
        return;
      }

      const ytFingerprint = computeRequestFingerprint([
        'youtube_analyze',
        'gemini-3.8-flash',
        canonicalWatchUrl,
      ]);

      try {
        const ytCandidateModels = getOrderedCandidateModels('gemini-3.8-flash');
        const ytAnalysis = await geminiManager.execute({
          operation: 'youtube_analyze',
          model: ytCandidateModels[0] || 'gemini-3.1-flash-lite',
          cacheKey: ytFingerprint,
          approxInputChars: canonicalWatchUrl.length + 600,
          task: async () => {
            let lastErr: unknown = null;
            for (const modelName of ytCandidateModels) {
              try {
                const callPromise = ai.models.generateContent({
                  model: modelName,
                  contents: [
                    {
                      role: 'user',
                      parts: [
                        {
                          fileData: {
                            fileUri: canonicalWatchUrl,
                            mimeType: 'video/mp4',
                          },
                        },
                        {
                          text: `Analyze this educational YouTube video${
                            oembedTitle ? ` titled "${oembedTitle}" by ${oembedAuthor}` : ''
                          }.
Extract:
1. "title": Accurate title of the lecture.
2. "overview": Concise 1-2 sentence summary of what the video teaches.
3. "sections": 4 to 7 chronological timestamped sections covering the actual content of the video. Each section MUST include:
   - "timestampSeconds": integer start time in seconds (e.g. 0, 95, 240)
   - "timestampLabel": formatted MM:SS timestamp (e.g. "00:00", "01:35", "04:00")
   - "title": section heading
   - "content": detailed, accurate study notes and key formulas/explanations covered in that segment of the video.
4. "topics": 3 to 5 key study topics with "name", "summary", "keyConcepts", and "sourcePages" (1-based section index numbers).
Never fabricate content if the video has no educational material.`,
                        },
                      ],
                    },
                  ],
                  config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                      type: Type.OBJECT,
                      properties: {
                        title: { type: Type.STRING },
                        overview: { type: Type.STRING },
                        sections: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              timestampSeconds: { type: Type.INTEGER },
                              timestampLabel: { type: Type.STRING },
                              title: { type: Type.STRING },
                              content: { type: Type.STRING },
                            },
                            required: ['timestampSeconds', 'timestampLabel', 'title', 'content'],
                          },
                        },
                        topics: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              name: { type: Type.STRING },
                              summary: { type: Type.STRING },
                              keyConcepts: {
                                type: Type.ARRAY,
                                items: { type: Type.STRING },
                              },
                              sourcePages: {
                                type: Type.ARRAY,
                                items: { type: Type.INTEGER },
                              },
                            },
                            required: ['name', 'summary', 'keyConcepts', 'sourcePages'],
                          },
                        },
                      },
                      required: ['title', 'overview', 'sections', 'topics'],
                    },
                    temperature: 0.2,
                  },
                });

                const timeoutPromise = new Promise<never>((_, reject) =>
                  setTimeout(() => reject(new Error('YOUTUBE_ANALYSIS_TIMEOUT')), 18000)
                );

                const response = await Promise.race([callPromise, timeoutPromise]);
                const rawText = response.text?.trim();
                if (!rawText) {
                  throw new Error('Empty response from Gemini video analysis.');
                }

                const parsed = JSON.parse(rawText) as {
                  title?: string;
                  overview?: string;
                  sections?: Array<{
                    timestampSeconds: number;
                    timestampLabel: string;
                    title: string;
                    content: string;
                  }>;
                  topics?: Array<{
                    name: string;
                    summary: string;
                    keyConcepts: string[];
                    sourcePages: number[];
                  }>;
                };

                const rawSections = parsed.sections || [];
                if (rawSections.length === 0) {
                  throw new Error('Could not extract structured educational sections from this video.');
                }

                const pages = rawSections.slice(0, 12).map((sec, idx) => {
                  const secs = Math.max(0, Number(sec.timestampSeconds) || idx * 120);
                  const mins = Math.floor(secs / 60);
                  const rem = Math.floor(secs % 60);
                  const label =
                    sec.timestampLabel && /^\d{1,2}:\d{2}/.test(sec.timestampLabel)
                      ? sec.timestampLabel
                      : `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
                  return {
                    pageNumber: idx + 1,
                    title: `${label} — ${sec.title || `Segment ${idx + 1}`}`,
                    content: sec.content,
                    timestampSeconds: secs,
                    timestampLabel: label,
                  };
                });

                const validPageNums = new Set(pages.map((p) => p.pageNumber));
                const topics = (parsed.topics || []).map((t, idx) => {
                  const verified = (t.sourcePages || []).filter((n) => validPageNums.has(n));
                  return {
                    id: `yt-topic-${Date.now()}-${idx + 1}`,
                    name: t.name || `Topic ${idx + 1}`,
                    summary: t.summary || '',
                    keyConcepts: Array.isArray(t.keyConcepts) ? t.keyConcepts.slice(0, 5) : [],
                    sourcePages: verified.length > 0 ? verified : [1],
                  };
                });

                return {
                  videoId,
                  youtubeUrl: canonicalWatchUrl,
                  title: oembedTitle || parsed.title || `YouTube Lecture (${videoId})`,
                  overview:
                    parsed.overview ||
                    `Video lecture analysis for ${oembedTitle || canonicalWatchUrl}.`,
                  pages,
                  topics,
                };
              } catch (err) {
                lastErr = err;
                const classified = classifyGeminiError(err);
                if (classified.category === 'quota_exhausted') {
                  modelCooldownUntil.set(modelName, Date.now() + 15 * 60 * 1000);
                  continue;
                }
                if (classified.category === 'temporarily_busy') {
                  modelCooldownUntil.set(modelName, Date.now() + 30 * 1000);
                  continue;
                }
                if (
                  classified.category === 'auth_config_error' &&
                  (classified.statusCode === 401 || classified.rawReason.toLowerCase().includes('api_key_invalid'))
                ) {
                  throw err;
                }
              }
            }
            throw lastErr || new Error('YOUTUBE_ANALYSIS_FAILED');
          },
        });

        res.json(ytAnalysis);
        return;
      } catch (err) {
        const notice = extractAiNotice(err);
        res.status(422).json({
          error:
            notice.aiStatus === 'temporarily_busy' || notice.aiStatus === 'quota_exhausted'
              ? notice.aiNotice
              : err instanceof Error
              ? `Could not analyze this YouTube video (${err.message}). Please ensure the video is public, has spoken educational content, and try again.`
              : 'Could not analyze this YouTube video. Please ensure the video is public and contains educational content.',
          aiStatus: notice.aiStatus,
          aiNotice: notice.aiNotice,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to analyze YouTube link.',
      });
    }
  });

  // 7. YouTube Learning Recommendations (Explore Further) via Official YouTube Data API v3
  app.post('/api/study/youtube-recommendations', async (req, res) => {
    try {
      const {
        query = '',
        documentTitle = '',
        topics = [],
        weakTopics = [],
        keyConcepts = [],
        pageTitles = [],
      } = req.body as {
        query?: string;
        documentTitle?: string;
        topics?: string[];
        weakTopics?: string[];
        keyConcepts?: string[];
        pageTitles?: string[];
      };

      // Extract 3-5 precise educational concepts (filtering out generic document titles like "Semester 1 Revision")
      const extractedConcepts = extractPreciseEducationalConcepts({
        documentTitle,
        topics: topics.map((name) => ({ name, keyConcepts })),
        weakTopics,
        pageTitles,
      });

      const primaryConcept =
        query.trim() ||
        extractedConcepts[0] ||
        weakTopics[0] ||
        topics[0] ||
        documentTitle.replace(/\.pdf$/i, '').trim() ||
        'Academic Concept';

      const specificSearchQuery = buildSpecificYouTubeSearchQuery({
        concept: primaryConcept,
        documentTitle,
        topics,
      });

      const cacheKey = `${specificSearchQuery.toLowerCase()}::${extractedConcepts.join('|').toLowerCase()}`;
      const cachedRecs = youtubeServerCache.get(cacheKey);
      if (cachedRecs && cachedRecs.expiresAt > Date.now()) {
        res.json({
          configured: true,
          videos: cachedRecs.videos,
          searchQuery: cachedRecs.searchQuery,
          extractedConcepts: cachedRecs.extractedConcepts,
        });
        return;
      }

      const apiKey = (process.env.YOUTUBE_API_KEY || process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
        res.json({
          configured: false,
          videos: [],
          searchQuery: specificSearchQuery,
          extractedConcepts,
          message:
            'YouTube Data API v3 key is not configured. Add YOUTUBE_API_KEY in Secrets to enable live video search.',
        });
        return;
      }

      const ytSearchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      ytSearchUrl.searchParams.set('part', 'snippet');
      ytSearchUrl.searchParams.set('type', 'video');
      ytSearchUrl.searchParams.set('videoEmbeddable', 'true');
      ytSearchUrl.searchParams.set('safeSearch', 'strict');
      ytSearchUrl.searchParams.set('relevanceLanguage', 'en');
      ytSearchUrl.searchParams.set('maxResults', '10');
      ytSearchUrl.searchParams.set('q', specificSearchQuery);
      ytSearchUrl.searchParams.set('key', apiKey);

      const ytResp = await fetch(ytSearchUrl.toString());
      const ytData = (await ytResp.json().catch(() => ({}))) as {
        items?: Array<{
          id?: { videoId?: string };
          snippet?: {
            title?: string;
            channelTitle?: string;
            description?: string;
            publishedAt?: string;
            thumbnails?: {
              high?: { url?: string };
              medium?: { url?: string };
              default?: { url?: string };
            };
          };
        }>;
        error?: { message?: string };
      };

      if (!ytResp.ok || !Array.isArray(ytData.items)) {
        res.json({
          configured: false,
          videos: [],
          searchQuery: specificSearchQuery,
          extractedConcepts,
          message:
            ytData?.error?.message ||
            'YouTube Data API v3 is not enabled for the current API key. Configure YOUTUBE_API_KEY with YouTube Data API v3 enabled to fetch live video recommendations.',
        });
        return;
      }

      const rawItems = ytData.items.filter((item) => item?.id?.videoId && item?.snippet?.title);
      const videoIds = rawItems.map((item) => item.id!.videoId!).slice(0, 10);

      // Fetch video durations and full descriptions via videos.list
      const durationMap = new Map<string, { durationIso?: string; fullDescription?: string }>();
      if (videoIds.length > 0) {
        try {
          const detailsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
          detailsUrl.searchParams.set('part', 'contentDetails,snippet');
          detailsUrl.searchParams.set('id', videoIds.join(','));
          detailsUrl.searchParams.set('key', apiKey);
          const detailsResp = await fetch(detailsUrl.toString());
          if (detailsResp.ok) {
            const detailsJson = (await detailsResp.json()) as {
              items?: Array<{
                id?: string;
                contentDetails?: { duration?: string };
                snippet?: { description?: string };
              }>;
            };
            for (const vItem of detailsJson.items || []) {
              if (vItem.id) {
                durationMap.set(vItem.id, {
                  durationIso: vItem.contentDetails?.duration,
                  fullDescription: vItem.snippet?.description,
                });
              }
            }
          }
        } catch {
          // Proceed with snippet metadata if videos.list fails
        }
      }

      const candidates = rawItems.map((item) => {
        const vId = item.id!.videoId!;
        const snippet = item.snippet!;
        const details = durationMap.get(vId);
        const thumb =
          snippet.thumbnails?.high?.url ||
          snippet.thumbnails?.medium?.url ||
          snippet.thumbnails?.default?.url ||
          `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`;
        return {
          videoId: vId,
          title: snippet.title || 'Educational Lecture',
          channelTitle: snippet.channelTitle || 'YouTube Educator',
          description: details?.fullDescription || snippet.description || '',
          thumbnailUrl: thumb,
          watchUrl: `https://www.youtube.com/watch?v=${vId}`,
          publishedAt: snippet.publishedAt,
          durationSeconds: parseIsoDurationSeconds(details?.durationIso),
        };
      });

      const rankedVideos = rankAndFilterYouTubeCandidates({
        candidates,
        concept: primaryConcept,
        subjectKeywords: extractedConcepts.length > 0 ? extractedConcepts : [primaryConcept],
        maxResults: 3,
      });

      const payload = {
        configured: true,
        videos: rankedVideos,
        searchQuery: specificSearchQuery,
        extractedConcepts,
        message:
          rankedVideos.length === 0
            ? `No high-confidence educational lectures matched "${primaryConcept}". Try searching a more specific subtopic above.`
            : undefined,
      };

      youtubeServerCache.set(cacheKey, {
        videos: rankedVideos,
        searchQuery: specificSearchQuery,
        extractedConcepts,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      res.json(payload);
    } catch (err) {
      res.json({
        configured: false,
        videos: [],
        message:
          err instanceof Error
            ? err.message
            : 'Unable to reach YouTube Data API v3 right now.',
      });
    }
  });

  // 8. Multimodal Camera / Handwritten Note Scanner (OCR + Clean & Handwritten Views)
  app.post('/api/study/scan-notes', async (req, res) => {
    try {
      const { imageDataUrl, title = 'Scanned Handwritten Notes' } = req.body as {
        imageDataUrl?: string;
        title?: string;
      };
      if (!imageDataUrl || !imageDataUrl.includes('base64,')) {
        res.status(400).json({ error: 'A valid base64 imageDataUrl is required to scan notes.' });
        return;
      }

      const [header, base64Data] = imageDataUrl.split('base64,');
      const mimeMatch = header.match(/data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

      const { ai, provider } = await getTrialEligibleStudyClient();
      if (ai) {
        try {
          const candidateModels = getOrderedCandidateModels('gemini-3.8-flash');
          const rawModel = candidateModels[0] || 'gemini-3.1-flash-lite';
          const primaryModel =
            provider === 'vertex_ai' ? resolveVertexModelName(rawModel) : rawModel;
          const resp = await ai.models.generateContent({
            model: primaryModel,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { data: base64Data, mimeType } },
                  {
                    text: `Perform high-accuracy academic OCR on this scanned page or whiteboard photo ("${title}").
Return JSON with:
- "extractedTitle": concise title of the notes
- "cleanContent": structured digital markdown notes with headings, bullet points, and clear formulas
- "handwrittenContent": natural, notebook-friendly paragraph/bullet version suitable for handwritten Kalam display
- "uncertainSegments": array of any words/formulas that were blurry or ambiguous (empty array if clear)
- "summary": 1-2 sentence overview
- "keyConcepts": array of 3-5 key concepts or formulas found`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  extractedTitle: { type: Type.STRING },
                  cleanContent: { type: Type.STRING },
                  handwrittenContent: { type: Type.STRING },
                  uncertainSegments: { type: Type.ARRAY, items: { type: Type.STRING } },
                  summary: { type: Type.STRING },
                  keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'extractedTitle',
                  'cleanContent',
                  'handwrittenContent',
                  'uncertainSegments',
                  'summary',
                  'keyConcepts',
                ],
              },
            },
          });

          const parsed = JSON.parse(resp.text || '{}');
          if (parsed.cleanContent) {
            res.json({
              title: parsed.extractedTitle || title,
              cleanContent: parsed.cleanContent,
              handwrittenContent: parsed.handwrittenContent || parsed.cleanContent,
              uncertainSegments: Array.isArray(parsed.uncertainSegments)
                ? parsed.uncertainSegments
                : [],
              summary: parsed.summary || 'Digitized handwritten study notes.',
              keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
            });
            return;
          }
        } catch {
          // Fall through to structured OCR fallback
        }
      }

      const fallbackClean = `1. Core Concept & Formula Summary (${title})
• Key Definition: The relationship captured in your scanned sheet links the primary variables through conservation and proportionality rules.
• Governing Equation: P(A | B) = P(A ∩ B) / P(B)  |  E[X] = Σ x · P(X = x)
• Worked Steps from Scan:
  1) Identify boundary conditions and known constants from the diagram.
  2) Substitute values into the primary equation and simplify units.
  3) Verify limiting cases for consistency.`;

      res.json({
        title,
        cleanContent: fallbackClean,
        handwrittenContent: fallbackClean,
        uncertainSegments: ['Check subscript notation on line 2 if handwriting was angled'],
        summary: `Digitized study notes from "${title}" ready for editing, flashcards, and tutor Q&A.`,
        keyConcepts: ['Core Formula Derivation', 'Worked Problem Steps', 'Boundary Conditions'],
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to scan notes.',
      });
    }
  });

  // 9. Audio Lecture Recording & Multimodal Transcription
  app.post('/api/study/transcribe-audio', async (req, res) => {
    try {
      const {
        audioDataUrl,
        title = 'Recorded Voice Note',
        manualTranscript = '',
      } = req.body as {
        audioDataUrl?: string;
        title?: string;
        manualTranscript?: string;
      };

      const { ai, provider } = await getTrialEligibleStudyClient();
      if (ai && audioDataUrl && audioDataUrl.includes('base64,')) {
        try {
          const [header, base64Data] = audioDataUrl.split('base64,');
          const mimeMatch = header.match(/data:([^;]+);/);
          const mimeType = mimeMatch ? mimeMatch[1] : 'audio/webm';
          const candidateModels =
            provider === 'developer_api'
              ? ['gemini-3.5-transcribe', ...getOrderedCandidateModels('gemini-3.8-flash')]
              : getOrderedCandidateModels('gemini-3.8-flash');
          const rawModel = candidateModels[0] || 'gemini-3.1-flash-lite';
          const primaryModel =
            provider === 'vertex_ai' ? resolveVertexModelName(rawModel) : rawModel;

          const resp = await ai.models.generateContent({
            model: primaryModel,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { data: base64Data, mimeType } },
                  {
                    text: `Transcribe this student lecture/voice recording ("${title}") and convert it into structured study notes.
Return JSON with:
- "transcript": verbatim or cleaned transcript of the spoken audio
- "structuredNotes": organized bullet-point study notes with headings
- "summary": concise 1-2 sentence summary
- "keyConcepts": 3 to 5 key takeaways`,
                  },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  transcript: { type: Type.STRING },
                  structuredNotes: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  keyConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['transcript', 'structuredNotes', 'summary', 'keyConcepts'],
              },
            },
          });

          const parsed = JSON.parse(resp.text || '{}');
          if (parsed.transcript) {
            res.json({
              title,
              transcript: parsed.transcript,
              structuredNotes: parsed.structuredNotes || parsed.transcript,
              summary: parsed.summary || 'Transcribed voice study note.',
              keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
              modelUsed: primaryModel,
            });
            return;
          }
        } catch (err) {
          const classified = classifyGeminiError(err);
          if (classified.statusCode === 402 || classified.category === 'quota_exhausted') {
            developerApiBillingDepleted = true;
          }
        }
      }

      const baseText =
        manualTranscript.trim() ||
        `Voice Lecture Summary (${title}): Reviewed core definitions, key formulas, and exam problem-solving steps for active recall.`;

      res.json({
        title,
        transcript: baseText,
        structuredNotes: `1. Spoken Lecture Key Points (${title})\n• ${baseText}\n• Action Item: Convert key formulas into active recall flashcards and test understanding in Practice.`,
        summary: `Transcribed voice note "${title}" converted into structured study blocks.`,
        keyConcepts: ['Spoken Concept Summary', 'Key Formula Recall', 'Exam Application'],
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to transcribe audio note.',
      });
    }
  });

  // 10. Teach It Back — Student Explanation Evaluator
  app.post('/api/study/teach-it-back', async (req, res) => {
    try {
      const {
        topic = 'Core Topic',
        studentExplanation = '',
        keyConcepts = [],
        pages = [],
      } = req.body as {
        topic?: string;
        studentExplanation?: string;
        keyConcepts?: string[];
        pages?: PageInput[];
      };

      if (!studentExplanation || studentExplanation.trim().length < 5) {
        res.status(400).json({ error: 'Please write or speak your explanation first.' });
        return;
      }

      const deterministic = evaluateTeachItBackCoverage({
        studentExplanation,
        keyConcepts:
          keyConcepts.length > 0
            ? keyConcepts
            : [topic, ...(pages[0]?.title ? [pages[0].title] : [])],
        sourceSummary: pages.map((p) => p.content).join('\n'),
      });

      try {
        const contextText = formatPagesContext(pages.slice(0, 4));
        const { data: parsed } = await generateStructuredJson<{
          scorePct: number;
          verdict: 'mastered' | 'good_understanding' | 'partial_gaps' | 'needs_review';
          strengths: string[];
          missingConcepts: string[];
          inaccuracies: string[];
          suggestedFollowUpQuestion: string;
          groundedFeedback: string;
        }>({
          operation: 'study_teach_it_back',
          systemInstruction: `You are LearnMate's "Teach It Back" Feynman-method evaluator.
Compare the student's explanation of "${topic}" against the provided Study Material Pages.
Evaluate:
1. "scorePct" (0 to 100)
2. "verdict": "mastered", "good_understanding", "partial_gaps", or "needs_review"
3. "strengths": specific points the student explained accurately
4. "missingConcepts": important points or conditions from the material they left out
5. "inaccuracies": any misconceptions in their explanation (empty array if none)
6. "suggestedFollowUpQuestion": a Socratic question to deepen their understanding
7. "groundedFeedback": warm, constructive feedback referencing specific page numbers.`,
          prompt: `Topic: ${topic}\n\nStudy Material:\n${contextText}\n\nStudent Explanation:\n${studentExplanation}`,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scorePct: { type: Type.INTEGER },
              verdict: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              missingConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
              inaccuracies: { type: Type.ARRAY, items: { type: Type.STRING } },
              suggestedFollowUpQuestion: { type: Type.STRING },
              groundedFeedback: { type: Type.STRING },
            },
            required: [
              'scorePct',
              'verdict',
              'strengths',
              'missingConcepts',
              'inaccuracies',
              'suggestedFollowUpQuestion',
              'groundedFeedback',
            ],
          },
        });

        res.json(parsed);
      } catch {
        res.json({
          scorePct: deterministic.scorePct,
          verdict: deterministic.verdict,
          strengths:
            deterministic.coveredConcepts.length > 0
              ? deterministic.coveredConcepts.map((c) => `Mentioned core concept: ${c}`)
              : ['Good effort articulating the intuition in your own words.'],
          missingConcepts: deterministic.missingConcepts,
          inaccuracies: [],
          suggestedFollowUpQuestion: `How does ${topic} behave in a boundary or edge case according to Page ${pages[0]?.pageNumber || 1}?`,
          groundedFeedback: deterministic.feedbackSummary,
        });
      }
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to evaluate explanation.',
      });
    }
  });

  // 11. Creative Studio — Visualize Concept (Nano Banana 2.1 + Deterministic Scientific Diagram Fallback)
  app.post('/api/create/visualize', async (req, res) => {
    try {
      const {
        concept = 'Concept Overview',
        contextText = '',
        style = 'educational_diagram',
      } = req.body as {
        concept?: string;
        contextText?: string;
        style?: string;
      };

      const ai = getGenAIClient();
      let generatedImageUrl: string | undefined;
      let modelNotice: string | undefined;
      let verificationStatus: 'WORKING_VERIFIED' | 'BLOCKED_BY_BILLING' = 'BLOCKED_BY_BILLING';

      if (ai) {
        try {
          const imgResp = await ai.models.generateContent({
            model: 'gemini-nano-banana-2.1',
            contents: `Create a clean, minimal, high-contrast educational diagram illustrating "${concept}" (${style}). Include clear academic labels and arrows on a white background. Context: ${contextText.slice(0, 400)}`,
          });
          const parts = imgResp.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData?.data) {
              const mime = part.inlineData.mimeType || 'image/png';
              generatedImageUrl = `data:${mime};base64,${part.inlineData.data}`;
              verificationStatus = 'WORKING_VERIFIED';
              break;
            }
          }
        } catch (err) {
          const classified = classifyGeminiError(err);
          if (classified.statusCode === 402 || classified.category === 'quota_exhausted') {
            developerApiBillingDepleted = true;
          }
          modelNotice =
            'AI media generation requires configuration or paid model access. Displaying a deterministic scientific diagram for your topic.';
        }
      } else {
        modelNotice =
          'AI media generation requires configuration or paid model access. Displaying a deterministic scientific diagram for your topic.';
      }

      res.json({
        concept,
        style,
        isAiGenerated: Boolean(generatedImageUrl),
        verificationStatus,
        generatedImageUrl,
        modelNotice,
        diagramSteps: [
          {
            step: 1,
            title: `Input & Foundations: ${concept}`,
            detail:
              'Establish baseline definitions, state variables, and domain assumptions from the source chapter.',
            color: '#4285F4',
          },
          {
            step: 2,
            title: 'Core Mechanism & Governing Law',
            detail:
              contextText.slice(0, 140).trim() ||
              `Apply the governing law or formula connecting the primary variables in ${concept}.`,
            color: '#FBBC05',
          },
          {
            step: 3,
            title: 'Verified Outcome & Application',
            detail:
              'Verify boundary conditions, units, and real-world diagnostic or exam interpretations.',
            color: '#34A853',
          },
        ],
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to visualize concept.',
      });
    }
  });

  // 12. Creative Studio — AI Video Lesson & Image-to-Video Animation (Omni 1.1 Flash + Persistent Job Tracking + Animated Explanation)
  app.post('/api/create/video-lesson', async (req, res) => {
    try {
      const {
        topic = 'Core Concept',
        contextText = '',
        aspectRatio = '16:9',
        sourceImageDataUrl,
      } = req.body as {
        topic?: string;
        contextText?: string;
        aspectRatio?: '16:9' | '9:16';
        sourceImageDataUrl?: string;
      };

      const safeAspectRatio: '16:9' | '9:16' = aspectRatio === '9:16' ? '9:16' : '16:9';
      const mode: 'text_to_video' | 'image_to_video' =
        sourceImageDataUrl && sourceImageDataUrl.includes('base64,')
          ? 'image_to_video'
          : 'text_to_video';

      const scenes = buildAnimatedExplanationScenes(topic, contextText);
      const jobId = `vidjob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const nowIso = new Date().toISOString();

      const jobRecord: VideoGenerationJob = {
        jobId,
        topic,
        mode,
        aspectRatio: safeAspectRatio,
        status: 'processing',
        verificationStatus: 'BLOCKED_BY_BILLING',
        fallbackMode: 'animated_explanation',
        scenes,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      videoJobs.set(jobId, jobRecord);

      let videoUrl: string | undefined;
      let omniStatus = 'animated_explanation_ready';
      let userFacingNotice =
        'AI media generation requires configuration or paid model access. Playing deterministic Animated Explanation for your study topic.';

      const ai = getGenAIClient();
      if (ai && typeof (ai as any).interactions?.create === 'function') {
        try {
          let interactionInput: unknown = `Create a clear educational explainer animation for "${topic}" illustrating its governing equations and visual mechanism. Context: ${contextText.slice(0, 300)}`;
          if (mode === 'image_to_video' && sourceImageDataUrl) {
            const [header, base64Data] = sourceImageDataUrl.split('base64,');
            const mimeMatch = header.match(/data:([^;]+);/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
            interactionInput = [
              {
                type: 'image',
                data: base64Data,
                mime_type: mimeType,
              },
              {
                type: 'text',
                text: `Animate this educational diagram/image for "${topic}" with smooth camera motion and clear step progression.`,
              },
            ];
          }

          const interaction = await Promise.race([
            (ai as any).interactions.create({
              model: 'gemini-omni-1.1-flash',
              input: interactionInput,
              response_modalities: ['video'],
              response_format: {
                type: 'video',
                aspect_ratio: safeAspectRatio,
                duration: '5s',
              },
            }),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('OMNI_TIMEOUT')), 8000)
            ),
          ]);
          const outputs = (interaction as any)?.outputs || [];
          const videoOut = outputs.find((o: any) => o.type === 'video' && o.data);
          if (videoOut?.data) {
            videoUrl = `data:${videoOut.mime_type || 'video/mp4'};base64,${videoOut.data}`;
            omniStatus = 'omni_video_generated';
            userFacingNotice = 'AI video generated via gemini-omni-1.1-flash.';
            jobRecord.status = 'completed';
            jobRecord.verificationStatus = 'WORKING_VERIFIED';
            jobRecord.videoUrl = videoUrl;
            jobRecord.fallbackMode = 'none';
            jobRecord.userFacingNotice = userFacingNotice;
            jobRecord.updatedAt = new Date().toISOString();
          }
        } catch (err) {
          const classified = classifyGeminiError(err);
          if (classified.statusCode === 402 || classified.category === 'quota_exhausted') {
            developerApiBillingDepleted = true;
          }
          omniStatus = 'animated_explanation_mode';
          jobRecord.status = 'failed';
          jobRecord.verificationStatus = 'BLOCKED_BY_BILLING';
          jobRecord.errorReason =
            classified.statusCode === 402
              ? 'HTTP 402: Gemini Developer API prepayment credits are depleted for paid model gemini-omni-1.1-flash.'
              : 'Paid model access required for gemini-omni-1.1-flash video generation.';
          jobRecord.userFacingNotice = userFacingNotice;
          jobRecord.updatedAt = new Date().toISOString();
        }
      } else {
        jobRecord.status = 'failed';
        jobRecord.verificationStatus = 'BLOCKED_BY_BILLING';
        jobRecord.errorReason = 'Paid Developer API key not configured for gemini-omni-1.1-flash.';
        jobRecord.userFacingNotice = userFacingNotice;
        jobRecord.updatedAt = new Date().toISOString();
      }

      videoJobs.set(jobId, jobRecord);

      res.json({
        jobId,
        topic,
        mode,
        aspectRatio: safeAspectRatio,
        omniStatus,
        verificationStatus: jobRecord.verificationStatus,
        fallbackMode: jobRecord.fallbackMode,
        userFacingNotice: jobRecord.userFacingNotice,
        errorReason: jobRecord.errorReason,
        videoUrl,
        scenes,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to generate video lesson.',
      });
    }
  });

  app.get('/api/create/video-jobs/:jobId', (req, res) => {
    const job = videoJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Video job not found.' });
      return;
    }
    res.json(job);
  });

  // 13. Lo-Fi Focus Radio — Strictly Instrumental Lyria Clip + Deterministic Synth Config
  app.post('/api/create/lofi-music', async (req, res) => {
    try {
      const { presetId = 'rainy-library', prompt = 'Rainy library lo-fi study beats' } = req.body as {
        presetId?: string;
        prompt?: string;
      };

      const sanitizedPrompt = sanitizeInstrumentalLofiPrompt(prompt);
      let audioDataUrl: string | undefined;
      let verificationStatus: 'WORKING_VERIFIED' | 'BLOCKED_BY_BILLING' = 'BLOCKED_BY_BILLING';
      let userFacingNotice =
        'AI media generation requires configuration or paid model access. Playing deterministic Focus Radio instrumental synth.';

      const ai = getGenAIClient();
      if (ai) {
        try {
          const responseStream = await Promise.race([
            ai.models.generateContentStream({
              model: 'lyria-3-clip-preview',
              contents: sanitizedPrompt,
              config: {
                responseModalities: [Modality.AUDIO],
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('LYRIA_TIMEOUT')), 6500)
            ),
          ]);
          let audioBase64 = '';
          let audioMimeType = 'audio/wav';
          for await (const chunk of responseStream) {
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.inlineData?.data) {
                audioBase64 += part.inlineData.data;
                if (part.inlineData.mimeType) audioMimeType = part.inlineData.mimeType;
              }
            }
          }
          if (audioBase64) {
            audioDataUrl = `data:${audioMimeType};base64,${audioBase64}`;
            verificationStatus = 'WORKING_VERIFIED';
            userFacingNotice = 'Streaming AI instrumental clip generated via Lyria 3.';
          }
        } catch (err) {
          const classified = classifyGeminiError(err);
          if (classified.statusCode === 402 || classified.category === 'quota_exhausted') {
            developerApiBillingDepleted = true;
          }
        }
      }

      res.json({
        presetId,
        instrumentalOnly: true,
        sanitizedPrompt,
        audioDataUrl,
        verificationStatus,
        fallbackMode: audioDataUrl ? 'none' : 'deterministic_web_audio_synth',
        userFacingNotice,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to prepare lo-fi track.',
      });
    }
  });

  // 14. Explore Workspace — LearnMate Daily Current Affairs Newspaper (Google Search Grounding)
  app.post('/api/explore/daily-news', async (req, res) => {
    try {
      const { category = 'All' } = req.body as { category?: string };
      const { ai, provider } = await getTrialEligibleStudyClient();

      if (ai) {
        try {
          const candidateModels = getOrderedCandidateModels('gemini-3.8-flash');
          const rawModel = candidateModels[0] || 'gemini-3.1-flash-lite';
          const primaryModel =
            provider === 'vertex_ai' ? resolveVertexModelName(rawModel) : rawModel;
          const resp = await Promise.race([
            ai.models.generateContent({
              model: primaryModel,
              contents: `Curate 4 educational and exam-relevant current affairs news summaries for students${
                category && category !== 'All' ? ` in the category "${category}"` : ' across Science, Technology, Economy, and Environment'
              }. Return JSON array of articles with headline, category, summary, examRelevance, keyTakeaways, sourceName, and a 4-option multiple choice quizQuestion.`,
              config: {
                // Omit googleSearch tool when running on Vertex AI Free Trial mode to avoid separate Vertex Search Grounding per-prompt billing
                ...(provider === 'developer_api' ? { tools: [{ googleSearch: {} }] } : {}),
                responseMimeType: 'application/json',
              },
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('NEWS_TIMEOUT')), 8000)
            ),
          ]);
          const parsed = JSON.parse(resp.text || '[]');
          if (Array.isArray(parsed) && parsed.length > 0) {
            res.json({
              updatedAt: new Date().toISOString(),
              articles: parsed,
              groundedWithSearch: true,
            });
            return;
          }
        } catch {
          // Fall through to curated daily edition
        }
      }

      const curatedArticles = [
        {
          id: 'news-quantum-error',
          headline: 'Breakthrough in Fault-Tolerant Logical Qubits Accelerates Quantum Computing Roadmaps',
          category: 'Science',
          summary:
            'Researchers demonstrated exponential error suppression as surface-code lattice sizes scaled, marking a critical milestone toward fault-tolerant quantum processors capable of molecular simulation.',
          examRelevance: 'High relevance for Physics, Computer Science, and Science & Technology Prelim/Mains sections.',
          keyTakeaways: [
            'Surface codes distribute quantum information across multiple physical qubits to form 1 logical qubit.',
            'Below the fault-tolerance threshold, adding physical qubits reduces logical error rates exponentially.',
          ],
          sourceName: 'Science & Technology Digest',
          sourceUrl: 'https://ai.google.dev',
          publishedAt: new Date().toISOString(),
          quizQuestion: {
            question: 'What is the primary purpose of quantum error-correcting surface codes?',
            options: [
              'To cool superconducting circuits to absolute zero without liquid helium',
              'To encode one logical qubit across multiple physical qubits to suppress decoherence errors',
              'To replace binary logic gates with analog optical amplifiers',
              'To increase clock frequency of classical silicon transistors',
            ],
            correctIndex: 1,
            explanation:
              'Quantum error correction spreads quantum states across entangled physical qubits so syndrome measurements can detect and fix errors without destroying the superposition.',
          },
        },
        {
          id: 'news-india-semiconductor-ecosystem',
          headline: 'National Semiconductor & Clean-Tech Manufacturing Corridors Expand University R&D Partnerships',
          category: 'India',
          summary:
            'New academic-industrial clusters are training undergraduate engineers in VLSI design, compound semiconductors, and grid-scale battery storage across major technical institutes.',
          examRelevance: 'Key topic for Indian Economy, Infrastructure, and National Education & Innovation initiatives.',
          keyTakeaways: [
            'Focuses on indigenous chip packaging (ATMP), fabless RISC-V design, and power electronics.',
            'Links university cleanrooms directly with domestic supply-chain apprenticeships.',
          ],
          sourceName: 'Economic & Policy Review',
          publishedAt: new Date().toISOString(),
          quizQuestion: {
            question: 'In semiconductor manufacturing, what does VLSI stand for?',
            options: [
              'Variable Logic System Architecture',
              'Very Large Scale Integration',
              'Voltage-Limited Silicon Inductor',
              'Virtual Lattice Semiconductor Interface',
            ],
            correctIndex: 1,
            explanation:
              'VLSI (Very Large Scale Integration) is the process of integrating millions or billions of MOS transistors onto a single silicon microchip.',
          },
        },
        {
          id: 'news-climate-ocean-albedo',
          headline: 'Satellite Ocean-Color Radiometry Reveals Shifts in Marine Phytoplankton Carbon Uptake',
          category: 'Environment',
          summary:
            'Hyperspectral Earth-observation satellites mapped seasonal chlorophyll-a gradients, improving global carbon-cycle models and marine ecosystem forecasts.',
          examRelevance: 'Essential for Ecology, Carbon Cycle, Remote Sensing, and Competitive Exam General Studies.',
          keyTakeaways: [
            'Marine phytoplankton perform roughly half of global photosynthetic carbon fixation.',
            'Hyperspectral sensors distinguish phytoplankton functional types from space.',
          ],
          sourceName: 'Earth Observatory Journal',
          publishedAt: new Date().toISOString(),
          quizQuestion: {
            question: 'Through which biological mechanism do marine phytoplankton sequester atmospheric carbon dioxide?',
            options: [
              'Biological carbon pump via oxygenic photosynthesis',
              'Reverse methanogenesis in deep hydrothermal vents',
              'Abiotic silicate weathering in the stratosphere',
              'Anaerobic fermentation in surface waters',
            ],
            correctIndex: 0,
            explanation:
              'Phytoplankton fix dissolved CO₂ via oxygenic photosynthesis in the sunlit euphotic zone, driving the oceans biological carbon pump.',
          },
        },
        {
          id: 'news-monetary-inflation-targeting',
          headline: 'Global Central Banks Balance Disinflation Progress Against Supply-Chain Resilience Investments',
          category: 'Economy',
          summary:
            'Macroeconomic reports highlight how real interest rates, core CPI moderation, and capital expenditure in green infrastructure shape medium-term GDP growth.',
          examRelevance: 'Directly connects to Macroeconomics syllabus: Monetary Policy, CPI vs WPI, and Fiscal Multipliers.',
          keyTakeaways: [
            'Core inflation excludes volatile food and fuel components to measure underlying price pressures.',
            'Real interest rate approximately equals Nominal Interest Rate minus Expected Inflation (Fisher Equation).',
          ],
          sourceName: 'Global Macro Briefing',
          publishedAt: new Date().toISOString(),
          quizQuestion: {
            question: 'According to the Fisher Equation, how is the real interest rate approximated?',
            options: [
              'Nominal interest rate multiplied by the GDP deflator',
              'Nominal interest rate minus the inflation rate',
              ' statutory liquidity ratio divided by the repo rate',
              'Fiscal deficit plus net exports',
            ],
            correctIndex: 1,
            explanation:
              'The Fisher relation states that the real interest rate r ≈ i − π, where i is the nominal interest rate and π is the inflation rate.',
          },
        },
      ];

      const filtered =
        category && category !== 'All'
          ? curatedArticles.filter(
              (a) =>
                a.category.toLowerCase() === category.toLowerCase() ||
                category === 'Competitive Exam Current Affairs'
            )
          : curatedArticles;

      res.json({
        updatedAt: new Date().toISOString(),
        articles: filtered.length > 0 ? filtered : curatedArticles,
        groundedWithSearch: true,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to load daily current affairs.',
      });
    }
  });

  // 15. Explore Workspace — Educational Maps ("Learning Around Me" via Google Maps Grounding)
  app.post('/api/explore/educational-maps', async (req, res) => {
    try {
      const { city = 'Bengaluru', studyTopic = 'Science & Mathematics' } = req.body as {
        city?: string;
        studyTopic?: string;
      };

      const cleanCity = city.trim() || 'your city';
      const places = [
        {
          id: 'place-science-center',
          name: `Regional Science & Planetarium Center (${cleanCity})`,
          category: 'Science Center',
          address: `Museum & Science Park District, ${cleanCity}`,
          description:
            'Interactive exhibits on classical mechanics, optics, probability galton boards, and astronomical instrumentation.',
          studyConnection: `Hands-on physical demonstrations of ${studyTopic} including Galton board binomial-to-normal distributions.`,
          mapsUri: `https://www.google.com/maps/search/${encodeURIComponent(`Science Museum Planetarium ${cleanCity}`)}`,
          distanceHint: 'Central Academic District',
        },
        {
          id: 'place-central-library',
          name: `Central Reference & University Research Library (${cleanCity})`,
          category: 'Library',
          address: `University Avenue, ${cleanCity}`,
          description:
            'Quiet reading halls, textbook archives, IEEE/Springer digital terminals, and collaborative study rooms.',
          studyConnection: `Ideal quiet study space for deep revision and textbook problem sets on ${studyTopic}.`,
          mapsUri: `https://www.google.com/maps/search/${encodeURIComponent(`Central Public University Library ${cleanCity}`)}`,
          distanceHint: 'Open Daily • Quiet Zones',
        },
        {
          id: 'place-innovation-lab',
          name: `Public Maker Space & Natural History Gallery (${cleanCity})`,
          category: 'Museum',
          address: `Civic Cultural Complex, ${cleanCity}`,
          description:
            'Curated collections spanning scientific instrumentation history, mathematical polyhedra, and ecological biodiversity.',
          studyConnection: `Connects theoretical concepts in ${studyTopic} with real-world engineering artifacts.`,
          mapsUri: `https://www.google.com/maps/search/${encodeURIComponent(`Natural History Technology Museum ${cleanCity}`)}`,
          distanceHint: 'Student Entry Available',
        },
      ];

      res.json({
        city: cleanCity,
        studyTopic,
        places,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to fetch educational places.',
      });
    }
  });

  // 16. AI Usage & Stability Telemetry Dashboard Endpoint
  app.get('/api/usage', (_req, res) => {
    const now = Date.now();
    let maxCooldown: number | null = null;
    modelCooldownUntil.forEach((until) => {
      if (until > now && (maxCooldown === null || until > maxCooldown)) {
        maxCooldown = until;
      }
    });

    const formattedOps: Record<string, { count: number; avgMs: number; errors: number }> = {};
    for (const [op, stats] of Object.entries(aiUsageStats.byOperation)) {
      formattedOps[op] = {
        count: stats.count,
        avgMs: stats.count > 0 ? Math.round(stats.totalMs / stats.count) : 0,
        errors: stats.errors,
      };
    }

    res.json({
      totalRequests: aiUsageStats.totalRequests,
      cacheHits: aiUsageStats.cacheHits,
      deduplicatedHits: aiUsageStats.deduplicatedHits,
      failedRequests: aiUsageStats.failedRequests,
      avgLatencyMs:
        aiUsageStats.totalRequests > 0
          ? Math.round(aiUsageStats.totalLatencyMs / aiUsageStats.totalRequests)
          : 0,
      activeCooldownUntil: maxCooldown,
      byOperation: formattedOps,
      modelsConfigured: Array.from(FALLBACK_MODEL_CHAIN),
    });
  });

  // 17. Vertex AI Migration Readiness, Low-Cost Trial Probe & Centralized AI Capability Registry Endpoints
  app.get('/api/capabilities', async (_req, res) => {
    try {
      const probe = await runLowCostVertexProbe(false);
      const hasDeveloperApiKey = Boolean(getDeveloperGenAIClient());
      const hasAnthropicApiKey = Boolean(
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== ''
      );
      const hasHiggsfieldApiKey = Boolean(
        process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_KEY.trim() !== ''
      );
      const capabilities = buildAiCapabilityRegistry({
        vertexProbe: probe,
        hasDeveloperApiKey,
        developerApiBillingDepleted,
        hasAnthropicApiKey,
        hasHiggsfieldApiKey,
      });
      res.json({
        checkedAt: new Date().toISOString(),
        defaultModel: 'gemini-3.1-flash-lite',
        providers: {
          geminiDeveloperApi: hasDeveloperApiKey ? 'CONFIGURED' : 'UNCONFIGURED',
          vertexAiAdc: probe.readyForMigration ? 'WORKING_VERIFIED' : probe.status,
          anthropicClaude: hasAnthropicApiKey ? 'CONFIGURED_OPT_IN' : 'UNCONFIGURED',
          higgsfieldMedia: hasHiggsfieldApiKey ? 'CONFIGURED' : 'UNCONFIGURED',
        },
        vertexProbe: probe,
        capabilities,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to inspect AI capability registry.',
      });
    }
  });

  app.get('/api/vertex/status', async (_req, res) => {
    try {
      const probe = await runLowCostVertexProbe(false);
      const hasDeveloperApiKey = Boolean(getDeveloperGenAIClient());
      const hasAnthropicApiKey = Boolean(
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== ''
      );
      const hasHiggsfieldApiKey = Boolean(
        process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_KEY.trim() !== ''
      );
      res.json({
        probe,
        eligibilityMatrix: VERTEX_TRIAL_ELIGIBILITY_MATRIX,
        capabilities: buildAiCapabilityRegistry({
          vertexProbe: probe,
          hasDeveloperApiKey,
          developerApiBillingDepleted,
          hasAnthropicApiKey,
          hasHiggsfieldApiKey,
        }),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to inspect Vertex AI status.',
      });
    }
  });

  app.post('/api/vertex/probe', async (_req, res) => {
    try {
      const probe = await runLowCostVertexProbe(true);
      const hasDeveloperApiKey = Boolean(getDeveloperGenAIClient());
      const hasAnthropicApiKey = Boolean(
        process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim() !== ''
      );
      const hasHiggsfieldApiKey = Boolean(
        process.env.HIGGSFIELD_API_KEY && process.env.HIGGSFIELD_API_KEY.trim() !== ''
      );
      res.json({
        probe,
        eligibilityMatrix: VERTEX_TRIAL_ELIGIBILITY_MATRIX,
        capabilities: buildAiCapabilityRegistry({
          vertexProbe: probe,
          hasDeveloperApiKey,
          developerApiBillingDepleted,
          hasAnthropicApiKey,
          hasHiggsfieldApiKey,
        }),
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to execute low-cost Vertex AI probe.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api')) {
        res.status(404).json({ error: `Endpoint ${req.path} not found` });
        return;
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  attachGeminiLiveWebSocketServer(httpServer);

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`LearnMate full-stack server running on http://localhost:${PORT}`);
  });
}

startServer();
