/**
 * Payload validation for protected API routes.
 *
 * Upload strategy: PDFs are parsed in the browser and only extracted text pages are sent to the
 * server (the client already caps PDFs at 20 pages). Text requests are therefore small and use the
 * default JSON body limit; only the image/audio routes accept larger base64 payloads.
 */

export const REQUEST_LIMITS = Object.freeze({
  defaultJsonBody: '2mb',
  mediaJsonBody: '8mb',
  maxPages: 30,
  maxTotalPageChars: 200_000,
  maxPageTitleChars: 300,
  maxTitleChars: 300,
  maxOverviewChars: 10_000,
  maxQuestionChars: 2_000,
  maxHistoryItems: 20,
  maxHistoryItemChars: 6_000,
  maxTopics: 40,
  maxTopicTextChars: 2_000,
  maxShortStringChars: 300,
  maxListItems: 30,
  maxFocusTopics: 40,
  maxQuizQuestions: 60,
  maxQuizTextChars: 4_000,
  maxExplanationChars: 8_000,
  maxManualTranscriptChars: 20_000,
  maxUrlChars: 2_048,
  maxMediaDataUrlChars: 8_000_000,
});

export type ValidationResult = { ok: true } | { ok: false; status: 400 | 413; error: string };

const OK: ValidationResult = { ok: true };

function fail(error: string, status: 400 | 413 = 400): ValidationResult {
  return { ok: false, status, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(body: Record<string, unknown>, key: string, max: number): ValidationResult {
  const value = body[key];
  if (value === undefined || value === null) return OK;
  if (typeof value !== 'string') return fail(`"${key}" must be text.`);
  if (value.length > max) return fail(`"${key}" is too long (maximum ${max} characters).`, 413);
  return OK;
}

function optionalBoolean(body: Record<string, unknown>, key: string): ValidationResult {
  const value = body[key];
  if (value === undefined || value === null || typeof value === 'boolean') return OK;
  return fail(`"${key}" must be true or false.`);
}

function optionalStringList(
  body: Record<string, unknown>,
  key: string,
  maxItems: number,
  maxChars: number
): ValidationResult {
  const value = body[key];
  if (value === undefined || value === null) return OK;
  if (!Array.isArray(value)) return fail(`"${key}" must be a list.`);
  if (value.length > maxItems) return fail(`"${key}" has too many items (maximum ${maxItems}).`, 413);
  for (const item of value) {
    if (typeof item !== 'string') return fail(`"${key}" must contain only text.`);
    if (item.length > maxChars) return fail(`An item in "${key}" is too long.`, 413);
  }
  return OK;
}

function isIntInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export function validatePages(value: unknown, required: boolean): ValidationResult {
  if (value === undefined || value === null) {
    return required ? fail('Study material pages are required.') : OK;
  }
  if (!Array.isArray(value)) return fail('"pages" must be a list.');
  if (required && value.length === 0) return fail('Study material pages are required.');
  if (value.length > REQUEST_LIMITS.maxPages) {
    return fail(`This material has too many pages for one request (maximum ${REQUEST_LIMITS.maxPages}).`, 413);
  }
  let totalChars = 0;
  for (const page of value) {
    if (!isPlainObject(page)) return fail('Each page must be an object.');
    if (!isIntInRange(page.pageNumber, 0, 10_000)) return fail('Each page needs a valid page number.');
    if (typeof page.content !== 'string') return fail('Each page needs text content.');
    if (page.title !== undefined && page.title !== null) {
      if (typeof page.title !== 'string') return fail('Page titles must be text.');
      if (page.title.length > REQUEST_LIMITS.maxPageTitleChars) return fail('A page title is too long.', 413);
    }
    totalChars += page.content.length;
    if (totalChars > REQUEST_LIMITS.maxTotalPageChars) {
      return fail(
        `This material is too large to send to the AI in one request (maximum about ${Math.round(
          REQUEST_LIMITS.maxTotalPageChars / 1000
        )}k characters). Try a shorter document or split it into chapters.`,
        413
      );
    }
  }
  return OK;
}

export function validateTopics(value: unknown): ValidationResult {
  if (value === undefined || value === null) return OK;
  if (!Array.isArray(value)) return fail('"topics" must be a list.');
  if (value.length > REQUEST_LIMITS.maxTopics) return fail('Too many topics in one request.', 413);
  for (const topic of value) {
    if (!isPlainObject(topic)) return fail('Each topic must be an object.');
    for (const key of ['id', 'name', 'summary']) {
      const r = optionalString(topic, key, REQUEST_LIMITS.maxTopicTextChars);
      if (!r.ok) return r;
    }
    const concepts = optionalStringList(topic, 'keyConcepts', REQUEST_LIMITS.maxListItems, REQUEST_LIMITS.maxShortStringChars);
    if (!concepts.ok) return concepts;
    if (topic.sourcePages !== undefined && topic.sourcePages !== null) {
      if (!Array.isArray(topic.sourcePages) || topic.sourcePages.length > 200) {
        return fail('Topic source pages must be a short list.');
      }
    }
  }
  return OK;
}

function all(...results: ValidationResult[]): ValidationResult {
  return results.find((r) => !r.ok) ?? OK;
}

type BodyValidator = (body: Record<string, unknown>) => ValidationResult;

const validateAnalyze: BodyValidator = (b) =>
  all(optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars), validatePages(b.pages, true));

const validateAsk: BodyValidator = (b) => {
  if (typeof b.question !== 'string' || b.question.trim().length === 0) return fail('Please enter a question.');
  if (b.question.length > REQUEST_LIMITS.maxQuestionChars) {
    return fail(`Your question is too long (maximum ${REQUEST_LIMITS.maxQuestionChars} characters).`, 413);
  }
  const base = all(
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    optionalString(b, 'modelPreference', 64),
    optionalString(b, 'sourceControlMode', 64),
    validatePages(b.pages, false)
  );
  if (!base.ok) return base;

  if (b.history !== undefined && b.history !== null) {
    if (!Array.isArray(b.history)) return fail('"history" must be a list.');
    if (b.history.length > REQUEST_LIMITS.maxHistoryItems) return fail('Conversation history is too long.', 413);
    for (const item of b.history) {
      if (!isPlainObject(item) || (item.role !== 'user' && item.role !== 'assistant') || typeof item.content !== 'string') {
        return fail('Conversation history entries are malformed.');
      }
      if (item.content.length > REQUEST_LIMITS.maxHistoryItemChars) return fail('A conversation message is too long.', 413);
    }
  }

  if (b.studentContext !== undefined && b.studentContext !== null) {
    if (!isPlainObject(b.studentContext)) return fail('"studentContext" must be an object.');
    const ctx = b.studentContext;
    return all(
      optionalString(ctx, 'currentTopic', REQUEST_LIMITS.maxShortStringChars),
      optionalString(ctx, 'currentActivity', 64),
      optionalStringList(ctx, 'weakTopics', REQUEST_LIMITS.maxListItems, REQUEST_LIMITS.maxShortStringChars)
    );
  }
  return OK;
};

const validateQuiz: BodyValidator = (b) => {
  if (b.mode !== undefined && b.mode !== 'diagnostic' && b.mode !== 'adaptive') {
    return fail('"mode" must be "diagnostic" or "adaptive".');
  }
  if (b.questionCount !== undefined && b.questionCount !== null && !isIntInRange(b.questionCount, 1, 30)) {
    return fail('"questionCount" must be a whole number between 1 and 30.');
  }
  return all(
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    optionalString(b, 'documentId', 200),
    optionalBoolean(b, 'forceRefresh'),
    optionalStringList(b, 'focusTopics', REQUEST_LIMITS.maxFocusTopics, REQUEST_LIMITS.maxShortStringChars),
    validatePages(b.pages, true),
    validateTopics(b.topics)
  );
};

const SET_ID_PATTERN = /^qs_[a-f0-9]{32}$/;

function requireSetId(b: Record<string, unknown>): ValidationResult {
  return typeof b.setId === 'string' && SET_ID_PATTERN.test(b.setId) ? OK : fail('A valid practice set id is required.');
}

const validateMistakesAndPlan: BodyValidator = (b) =>
  all(
    requireSetId(b),
    optionalString(b, 'documentId', 200),
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    validatePages(b.pages, true)
  );

const validatePracticeSubmit: BodyValidator = (b) => {
  const base = requireSetId(b);
  if (!base.ok) return base;
  if (b.responses === undefined || b.responses === null) return OK;
  if (!isPlainObject(b.responses)) return fail('"responses" must be an object.');
  const entries = Object.entries(b.responses);
  if (entries.length > REQUEST_LIMITS.maxQuizQuestions) return fail('Too many answers in one submission.', 413);
  for (const [questionId, response] of entries) {
    if (questionId.length > 80) return fail('Answer ids are malformed.');
    if (!isPlainObject(response)) return fail('Answers are malformed.');
  }
  return OK;
};

const validateQuickRevise: BodyValidator = (b) => {
  if (
    b.resourceType !== undefined &&
    b.resourceType !== 'sticky_and_flashcards' &&
    b.resourceType !== 'mindmap_and_revision'
  ) {
    return fail('Unknown revision resource type.');
  }
  return all(
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    optionalString(b, 'overview', REQUEST_LIMITS.maxOverviewChars),
    optionalString(b, 'sourceType', 32),
    optionalBoolean(b, 'forceRefresh'),
    validatePages(b.pages, true),
    validateTopics(b.topics)
  );
};

const validateYouTubeAnalyze: BodyValidator = (b) => {
  if (typeof b.youtubeUrl !== 'string' || b.youtubeUrl.trim().length === 0) {
    return fail('Please provide a YouTube video link.');
  }
  return optionalString(b, 'youtubeUrl', REQUEST_LIMITS.maxUrlChars);
};

function validateDataUrl(value: unknown, allowedPrefixes: string[], label: string, required: boolean): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return required ? fail(`A valid ${label} is required.`) : OK;
  }
  if (typeof value !== 'string' || !value.includes('base64,')) return fail(`A valid base64 ${label} is required.`);
  if (!allowedPrefixes.some((prefix) => value.startsWith(prefix))) return fail(`Unsupported ${label} format.`);
  if (value.length > REQUEST_LIMITS.maxMediaDataUrlChars) {
    return fail(`This ${label} is too large. Please use a smaller file.`, 413);
  }
  return OK;
}

const validateScanNotes: BodyValidator = (b) =>
  all(
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    validateDataUrl(b.imageDataUrl, ['data:image/'], 'image', true)
  );

const validateTranscribeAudio: BodyValidator = (b) =>
  all(
    optionalString(b, 'title', REQUEST_LIMITS.maxTitleChars),
    optionalString(b, 'manualTranscript', REQUEST_LIMITS.maxManualTranscriptChars),
    validateDataUrl(b.audioDataUrl, ['data:audio/', 'data:video/webm'], 'audio recording', false)
  );

const validateTeachItBack: BodyValidator = (b) => {
  if (typeof b.studentExplanation !== 'string' || b.studentExplanation.trim().length < 5) {
    return fail('Please write or speak your explanation first.');
  }
  return all(
    optionalString(b, 'studentExplanation', REQUEST_LIMITS.maxExplanationChars),
    optionalString(b, 'topic', REQUEST_LIMITS.maxShortStringChars),
    optionalStringList(b, 'keyConcepts', REQUEST_LIMITS.maxListItems, REQUEST_LIMITS.maxShortStringChars),
    validatePages(b.pages, false)
  );
};

export const BODY_VALIDATORS = Object.freeze({
  analyze: validateAnalyze,
  ask: validateAsk,
  quiz: validateQuiz,
  mistakesAndPlan: validateMistakesAndPlan,
  practiceSubmit: validatePracticeSubmit,
  quickRevise: validateQuickRevise,
  youtubeAnalyze: validateYouTubeAnalyze,
  scanNotes: validateScanNotes,
  transcribeAudio: validateTranscribeAudio,
  teachItBack: validateTeachItBack,
});

export type BodyValidatorName = keyof typeof BODY_VALIDATORS;

export function validateBody(name: BodyValidatorName, body: unknown): ValidationResult {
  if (!isPlainObject(body)) return fail('Request body must be a JSON object.');
  return BODY_VALIDATORS[name](body);
}
