/**
 * LearnMate AI Tutor Engine — Pedagogical Reasoning, Context Awareness & Anti-Placeholder Guardrails
 *
 * Implements:
 * 1. JEE Main & Advanced Subject Teacher Persona (Physics, Chemistry, Mathematics).
 * 2. Deep conceptual explanations with physical intuition and common misconception alerts.
 * 3. Step-by-step numerical problem-solving (Given data, Governing law, Symbolic algebra, Substitution, Units, Sanity check).
 * 4. Rigorous KaTeX mathematical and chemical formatting ($...$ and $$...$$).
 * 5. Smart context retrieval with multi-turn conversation expansion and grounded page citations.
 * 6. Rolling conversational memory preserving problem constraints across follow-ups.
 * 7. Anti-placeholder validation (strictly bans [insert], TODO, lorem ipsum, generic filler).
 * 8. Subject-aware pedagogical fallbacks when offline or during transient API errors.
 */

import { GoogleGenAI, Type } from '@google/genai';

export type TutorSourceType = 'material' | 'general' | 'both';
export type SourceControlMode = 'material_only' | 'extended_knowledge' | 'expanded_default';

export interface TutorCitation {
  pageNumber: number;
  section: string;
  quote: string;
}

export interface TutorChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface StudentContextInput {
  currentTopic?: string;
  currentPage?: number;
  currentActivity?: string;
  weakTopics?: string[];
  recentScorePct?: number | null;
}

export interface TutorStudyPage {
  pageNumber: number;
  title: string;
  content: string;
}

export interface TutorRequestParams {
  title?: string;
  pages?: TutorStudyPage[];
  question: string;
  history?: TutorChatMessage[];
  studentContext?: StudentContextInput;
  sourceControlMode?: SourceControlMode;
  modelPreference?: string;
  subject?: 'physics' | 'chemistry' | 'mathematics' | 'general';
}

export interface TutorStructuredResponse {
  answer: string;
  sourceType: TutorSourceType;
  foundInMaterial: boolean;
  citations: TutorCitation[];
  relatedTopics: string[];
}

export interface TutorEngineResult extends TutorStructuredResponse {
  sourceControlMode: 'material_only' | 'extended_knowledge';
  modelUsed: string;
  provider: 'gemini_developer_api' | 'vertex_ai' | 'deterministic_fallback';
  tokensUsed?: { input: number; output: number };
  latencyMs: number;
  antiPlaceholderVerified: boolean;
  aiStatus?: string;
  aiNotice?: string;
}

// ---------------------------------------------------------------------------
// 1. SUBJECT & INTENT CLASSIFICATION
// ---------------------------------------------------------------------------

export type StemSubject = 'physics' | 'chemistry' | 'mathematics' | 'general';
export type QueryIntent = 'numerical' | 'derivation' | 'conceptual' | 'follow_up';

export function detectStemSubject(query: string, title?: string, topic?: string): StemSubject {
  const text = `${query} ${title || ''} ${topic || ''}`.toLowerCase();

  // Chemistry terms (evaluated first so compounds like "nuclear charge" or "electron pairing" aren't stolen by physics)
  if (
    /\b(molecule|atom|mole|stoichiometry|orbital|hybridization|electronegativity|chemical bond|covalent|ionic|equilibrium|le chatelier|ph|buffer|acid|base|titration|electrochemistry|nernst|galvanic|kinetics|activation energy|arrhenius|organic|alkane|alkene|alcohol|aldehyde|ketone|carboxylic|sn1|sn2|electrophile|nucleophile|isosteric|periodic table|periodic|enthalpy|ionization|ionisation|oxygen|nitrogen|delta g|delta h|delta s|gibbs|spontaneous)\b/i.test(
      text
    )
  ) {
    return 'chemistry';
  }

  // Physics terms
  if (
    /\b(force|newton|kinematics|velocity|acceleration|momentum|gravity|work|energy|power|torque|friction|capacitor|electric|magnetic|lorentz|flux|induction|optics|lens|mirror|thermodynamics|entropy|carnot|wave|sound|doppler|photoelectric|bohr|nucleus|de broglie|radioactivity|galvanometer|resistor|current|voltage|ohm|gauss|charge|coulomb|electrostatic|incline|projectile)\b/i.test(
      text
    )
  ) {
    return 'physics';
  }

  // Mathematics terms
  if (
    /\b(calculus|limit|continuity|differentiab|derivative|integral|integration|area under|differential equation|matrix|determinant|probability|bayes|permutation|combination|binomial|quadratic|complex number|coordinate geometry|parabola|ellipse|hyperbola|circle|straight line|vectors?|3d geometry|plane|dot product|cross product|trigonometry|logarithm)\b/i.test(
      text
    )
  ) {
    return 'mathematics';
  }

  return 'general';
}

export function detectQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase();

  if (
    /\b(why did you|explain step|step \d|another method|differently|how did you get|clarify that|explain again|what about step|why is that negative|repeat that|from your previous)\b/i.test(
      q
    )
  ) {
    return 'follow_up';
  }

  if (
    /\b(derive|derivation|proof|prove that|show that|origin of|obtain the expression|mathematical proof)\b/i.test(
      q
    )
  ) {
    return 'derivation';
  }

  if (
    /\b(calculate|find the value|compute|determine the magnitude|how much|how many|what is the velocity|what is the work|find the work|if a block of|mass of|charge of|resistor of|\d+\s*(m\/s|kg|n|j|w|v|a|c|m|s|mol|k|pa|atm))\b/i.test(
      q
    ) ||
    /\d+/.test(q)
  ) {
    return 'numerical';
  }

  return 'conceptual';
}

// ---------------------------------------------------------------------------
// 2. PEDAGOGICAL SYSTEM INSTRUCTION BUILDER
// ---------------------------------------------------------------------------

export function buildTutorSystemInstruction(params: {
  subject: StemSubject;
  intent: QueryIntent;
  studentContext?: StudentContextInput;
  isStrictMode: boolean;
}): string {
  const { subject, intent, studentContext, isStrictMode } = params;

  const subjectContextPrompt = {
    physics: 'You are LearnMate\'s Senior Physics Master Tutor for JEE Main & Advanced.',
    chemistry: 'You are LearnMate\'s Senior Chemistry Master Tutor for JEE Main & Advanced.',
    mathematics: 'You are LearnMate\'s Senior Mathematics Master Tutor for JEE Main & Advanced.',
    general: 'You are LearnMate\'s Senior STEM Master Tutor for JEE Main & Advanced.',
  }[subject];

  const studentContextLine = studentContext
    ? `Student Context: Current Topic: "${studentContext.currentTopic || 'General'}" | Viewing Page: ${
        studentContext.currentPage || 1
      } | Active Weak Areas: [${(studentContext.weakTopics || []).join(', ') || 'None reported'}] | Recent Quiz Score: ${
        studentContext.recentScorePct ?? 'N/A'
      }%.`
    : 'Student Context: General academic session.';

  return `${subjectContextPrompt}
${studentContextLine}

TEACHING PHILOSOPHY & PEDAGOGICAL RIGOR:
You are a brilliant, patient, encouraging, and deeply rigorous STEM educator. You never merely give an answer; you build genuine conceptual mastery and problem-solving intuition.

1. FOR CONCEPTUAL QUESTIONS:
- Explain the governing physical/chemical/mathematical principle clearly.
- Explain *why* it works from first principles.
- Use intuitive, real-world or physical analogies where helpful.
- Explicitly identify COMMON MISCONCEPTIONS and exam pitfalls where students lose marks.
- Adapt depth: if the student asks a quick factual question, be clear and concise. If they ask a deep conceptual question, provide rich, illuminating depth.

2. FOR NUMERICAL PROBLEMS & STEP-BY-STEP CALCULATIONS:
- **Given Data**: Explicitly list all known values with their SI units and identify the unknown quantity to be found.
- **Governing Law / Formula**: State the fundamental theorem, conservation law, or formula being applied and briefly state why it applies.
- **Symbolic Manipulation**: Rearrange variables symbolically *before* substituting numbers.
- **Substitution & Calculation**: Show intermediate calculation steps cleanly without skipping critical algebra.
- **Final Result**: Present the final answer clearly with explicit SI units.
- **Sanity Check & Limiting Cases**: Verify whether the answer makes physical sense (e.g. check limiting cases like mass approaching zero or infinity, or dimensional consistency).
- **Assumptions**: Explicitly state any ideal assumptions made (e.g., frictionless surface, ideal gas, massless string, uniform field).

3. FOR COMPLEX JEE MAIN / ADVANCED QUESTIONS & DERIVATIONS:
- Explain the strategic rationale behind the chosen method (e.g., why energy conservation is more efficient than integrating Newton\'s equations of motion).
- Do NOT skip critical algebraic, vector, or calculus steps.
- Present alternative approaches when insightful (e.g., center of mass frame vs laboratory frame).
- Distinguish between exact theoretical results and practical approximations (e.g., small angle approximation $\\sin\\theta \\approx \\theta$).

4. MATHEMATICAL & CHEMICAL TYPESETTING (KaTeX FORMATTING):
- Format ALL mathematical symbols, variables, numbers with units, and equations using LaTeX delimiters.
- Inline math MUST use single dollar signs: \`$E = mc^2$\`, \`$\\vec{F} = m\\vec{a}$\`, \`$\\Delta x$\`, \`$v = 10\\text{ m/s}$\`.
- Display equations, multi-step derivations, and matrices MUST use double dollar signs on their own lines:
  \`\`\`
  $$\\int_a^b f(x)\\,dx = F(b) - F(a)$$
  \`\`\`
- Use proper LaTeX commands: fractions (\`\\frac{a}{b}\`), square roots (\`\\sqrt{x}\`), vectors (\`\\vec{v}\` or \`\\mathbf{v}\`), integrals (\`\\int\`), Greek letters (\`\\alpha, \\beta, \\theta, \\lambda, \\mu_0, \\varepsilon_0\`).
- Format chemical equations cleanly using LaTeX text formatting:
  \`\`\`
  $$\\text{N}_2\\text{(g)} + 3\\text{H}_2\\text{(g)} \\rightleftharpoons 2\\text{NH}_3\\text{(g)}, \\quad \\Delta H < 0$$
  \`\`\`
- NEVER output raw ASCII fractions like \`a/b\` or \`F = m*a\` when mathematical typesetting is appropriate.
- NEVER wrap math inside markdown code blocks (\`\`\`latex or \`\`\`math) unless explicitly asked for LaTeX source code.

5. ZERO PLACEHOLDER & OUTPUT COMPLETENESS POLICY:
- Absolutely NEVER output placeholders like "[insert here]", "[TODO]", "lorem ipsum", "{fill in}", or "sample output".
- Complete every derivation and calculation fully. Never stop midway or say "similarly you can calculate the rest".
- Avoid generic filler or repetitive disclaimers.

6. CONTEXT & CITATION RULES (${isStrictMode ? 'STRICT MATERIAL ONLY MODE' : 'EXTENDED KNOWLEDGE HYBRID MODE'}):
${
  isStrictMode
    ? `- Answer ONLY using content directly supported by the provided Study Material Pages.
- Every claim MUST include verified page citations (pageNumber, section, verbatim quote).
- If the topic is not covered in the material, set "foundInMaterial": false, "sourceType": "general", "citations": [], and state that the topic is not in their material.`
    : `- PRIORITIZE UPLOADED MATERIAL: Check provided Study Material Pages first.
- If fully covered in the uploaded material: explain using the material and provide verified citations (pageNumber, section, verbatim quote). Set "foundInMaterial": true, "sourceType": "material".
- If partially covered or the student asks for expansion/examples/derivations: combine material with expert knowledge. Clearly distinguish with "**From your material:**" and "**Tutor explanation / Deep dive:**". Set "foundInMaterial": true, "sourceType": "both".
- If absent from material: start your answer with the exact phrase "Not covered in your material." and provide a complete, brilliant general-knowledge explanation. Set "foundInMaterial": false, "sourceType": "general", "citations": []. NEVER fabricate citations or pretend the PDF contained it.
- If no material is uploaded: answer using general STEM knowledge with "sourceType": "general" and "citations": [].`
}
`;
}

// ---------------------------------------------------------------------------
// 3. SMART CONTEXT RETRIEVAL WITH MULTI-TURN EXPANSION
// ---------------------------------------------------------------------------

export function retrieveRelevantPagesWithHistory(
  pages: TutorStudyPage[],
  query: string,
  history?: TutorChatMessage[],
  studentContext?: StudentContextInput,
  maxPages = 6
): TutorStudyPage[] {
  if (!Array.isArray(pages) || pages.length <= maxPages) {
    return pages || [];
  }

  // 1. Build search context with multi-turn expansion for follow-ups
  const isFollowUp = detectQueryIntent(query) === 'follow_up';
  let enrichedQuery = query;

  if (isFollowUp && history && history.length > 0) {
    // Extract key terms from the most recent assistant answer and user query
    const recentHistory = history.slice(-2);
    const historyText = recentHistory.map((h) => h.content).join(' ');
    enrichedQuery = `${query} ${historyText.slice(0, 300)}`;
  }

  if (studentContext?.currentTopic) {
    enrichedQuery += ` ${studentContext.currentTopic}`;
  }

  const stopWords = new Set([
    'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why', 'how',
    'does', 'is', 'are', 'was', 'were', 'the', 'and', 'for', 'with', 'from',
    'that', 'this', 'explain', 'define', 'tell', 'about', 'can', 'you', 'your',
    'please', 'give', 'step', 'also', 'just', 'more', 'have', 'been',
  ]);

  const queryTerms = enrichedQuery
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  const scored = pages.map((page, index) => {
    let score = 0;
    const lowerContent = (page.content || '').toLowerCase();
    const lowerTitle = (page.title || '').toLowerCase();

    // First page / introductory overview boost
    if (page.pageNumber === 1 || index === 0) score += 2;

    // Student currently viewing this page
    if (studentContext?.currentPage === page.pageNumber) score += 12;

    for (const term of queryTerms) {
      if (lowerTitle.includes(term)) score += 6;
      if (lowerContent.includes(term)) {
        // Count occurrences up to a cap of 4
        const matches = (lowerContent.match(new RegExp(term, 'g')) || []).length;
        score += Math.min(matches * 2, 8);
      }
    }

    return { page, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const selected = scored.slice(0, maxPages).map((s) => s.page);
  // Sort back by pageNumber to maintain logical document flow
  selected.sort((a, b) => a.pageNumber - b.pageNumber);
  return selected;
}

export function formatTutorPagesContext(pages: TutorStudyPage[]): string {
  if (!pages || pages.length === 0) return 'No study material pages loaded.';

  return pages
    .map((p) => {
      return `--- PAGE ${p.pageNumber}: ${p.title || 'Untitled Section'} ---\n${p.content.trim()}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// 4. ROLLING CONVERSATION MEMORY FORMATTING
// ---------------------------------------------------------------------------

export function formatConversationHistory(history?: TutorChatMessage[], maxTurns = 6): string {
  if (!history || history.length === 0) return 'No prior conversation.';

  // Exclude initial generic greeting messages if they clutter context
  const filtered = history.filter(
    (h) => !h.content.startsWith('Welcome to your AI Tutor session') && !h.content.startsWith('Welcome to your study session')
  );

  const recent = filtered.slice(-maxTurns * 2);
  if (recent.length === 0) return 'No prior conversation.';

  return recent
    .map((m) => `${m.role === 'user' ? 'STUDENT' : 'AI TUTOR'}: ${m.content.trim()}`)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// 5. ANTI-PLACEHOLDER VALIDATION & SANITIZATION
// ---------------------------------------------------------------------------

export interface AntiPlaceholderResult {
  valid: boolean;
  sanitizedAnswer: string;
  detectedIssues: string[];
}

export function validateAndSanitizeTutorAnswer(answer: string, subject: StemSubject): AntiPlaceholderResult {
  const issues: string[] = [];
  let sanitized = (answer || '').trim();

  if (!sanitized) {
    return {
      valid: false,
      sanitizedAnswer: '',
      detectedIssues: ['EMPTY_ANSWER'],
    };
  }

  // Forbidden placeholder patterns
  const placeholderRegexes = [
    { pattern: /\[(?:insert|add|replace|todo|placeholder|formula|code|step|your\s+.*?)\s*.*?\]/gi, label: 'BRACKETED_PLACEHOLDER' },
    { pattern: /\bTODO\b/g, label: 'TODO_MARKER' },
    { pattern: /\blorem\s+ipsum\b/gi, label: 'LOREM_IPSUM' },
    { pattern: /\bsample\s+output\b/gi, label: 'SAMPLE_OUTPUT_PLACEHOLDER' },
    { pattern: /\{fill\s+in\s+.*?\}/gi, label: 'FILL_IN_PLACEHOLDER' },
  ];

  for (const { pattern, label } of placeholderRegexes) {
    if (pattern.test(sanitized)) {
      issues.push(label);
      sanitized = sanitized.replace(pattern, '').replace(/\s{2,}/g, ' ');
    }
  }

  // Mismatched probability leakage check (e.g. probability boilerplate in a mechanics/organic question)
  if (subject !== 'mathematics') {
    if (
      /\bsample space \u03a9\b/i.test(sanitized) ||
      /\bprobabilities remain between 0 and 1\b/i.test(sanitized)
    ) {
      issues.push('MISMATCHED_PROBABILITY_BOILERPLATE');
      sanitized = sanitized
        .replace(/Step 1: List the complete set of outcomes \(the sample space \u03a9\)\..*?between 0 and 1\./gis, '')
        .replace(/Verify that all resulting probabilities remain between 0 and 1\./gi, 'Verify boundary conditions.');
    }
  }

  // Check for unclosed math delimiters
  const inlineDollarMatches = sanitized.match(/(?<!\\)\$/g) || [];
  if (inlineDollarMatches.length % 2 !== 0) {
    issues.push('UNCLOSED_MATH_DELIMITER');
    // Safely append a closing dollar sign to prevent KaTeX rendering corruptions
    sanitized += '$';
  }

  return {
    valid: issues.length === 0,
    sanitizedAnswer: sanitized.trim(),
    detectedIssues: issues,
  };
}

// ---------------------------------------------------------------------------
// 6. ROBUST JSON PARSER FOR GEMINI RESPONSES
// ---------------------------------------------------------------------------

export function parseRobustTutorJson(rawText: string): TutorStructuredResponse {
  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer : '',
      sourceType: ['material', 'general', 'both'].includes(parsed.sourceType) ? parsed.sourceType : 'general',
      foundInMaterial: Boolean(parsed.foundInMaterial),
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
      relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
    };
  } catch {
    // If JSON is malformed due to unescaped LaTeX backslashes (e.g. \frac without \\frac)
    try {
      // Escape raw unescaped backslashes not followed by valid JSON escape characters
      const escaped = cleaned.replace(/\\(?!["\\/bfnrtu])/g, '\\\\');
      const parsed = JSON.parse(escaped);
      return {
        answer: typeof parsed.answer === 'string' ? parsed.answer : '',
        sourceType: ['material', 'general', 'both'].includes(parsed.sourceType) ? parsed.sourceType : 'general',
        foundInMaterial: Boolean(parsed.foundInMaterial),
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
        relatedTopics: Array.isArray(parsed.relatedTopics) ? parsed.relatedTopics : [],
      };
    } catch {
      // Fallback: extract answer property with regex
      const answerMatch = cleaned.match(/"answer"\s*:\s*"([\s\S]*?)(?<!\\)",\s*"sourceType"/i);
      const answerText = answerMatch ? answerMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : cleaned;

      return {
        answer: answerText,
        sourceType: 'general',
        foundInMaterial: false,
        citations: [],
        relatedTopics: [],
      };
    }
  }
}

// ---------------------------------------------------------------------------
// 7. HIGH-FIDELITY SUBJECT-AWARE DETERMINISTIC FALLBACK
// ---------------------------------------------------------------------------

export function buildPedagogicalFallback(params: {
  question: string;
  subject: StemSubject;
  intent: QueryIntent;
  pages?: TutorStudyPage[];
  studentContext?: StudentContextInput;
  history?: TutorChatMessage[];
}): TutorStructuredResponse {
  const { question, subject, intent, pages, studentContext, history } = params;
  const historyText = history && history.length > 0 ? history.slice(-2).map((h) => h.content).join(' ') : '';
  const qLower = `${question} ${historyText}`.toLowerCase();

  // If pages are available, attempt grounded page excerpt
  if (pages && pages.length > 0) {
    const qWords = qLower
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const scoredPages = pages
      .map((p) => {
        const pText = `${p.title} ${p.content}`.toLowerCase();
        let score = 0;
        for (const w of qWords) {
          if (pText.includes(w)) score += 1;
        }
        return { page: p, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredPages.length > 0) {
      const topPage = scoredPages[0].page;
      const paragraphs = topPage.content.split(/\n+/).filter((l) => l.trim().length > 20);
      const excerpt = paragraphs.slice(0, 3).join('\n\n');

      return {
        answer: `**From your study material (Page ${topPage.pageNumber} — ${topPage.title}):**\n\n${excerpt}\n\n**Tutor Summary & Guidance:**\n• Review the equations above and verify the SI units.\n• For JEE problems involving **${topPage.title}**, always identify whether energy is conserved or external non-conservative forces do work.`,
        sourceType: 'material',
        foundInMaterial: true,
        citations: [
          {
            pageNumber: topPage.pageNumber,
            section: topPage.title,
            quote: (paragraphs[0] || topPage.content).slice(0, 160),
          },
        ],
        relatedTopics: [topPage.title],
      };
    }
  }

  // Fallback domain explanations tailored by subject and question intent
  let answer = '';
  let relatedTopics: string[] = [];

  if (subject === 'physics') {
    if (qLower.includes('incline') || qLower.includes('inclined plane') || (qLower.includes('block') && qLower.includes('rough'))) {
      answer = `**Dynamics of a Block on a Rough Inclined Plane:**\n\n1. **Coordinate System & Free-Body Diagram (FBD)**:\nConsider a block of mass $m$ on a plane inclined at angle $\theta$ with coefficient of kinetic friction $\\mu_k$.\n- Coordinate axes: $x$-axis down the inclined plane, $y$-axis normal to the plane pointing upwards.\n- Gravity force: $m\\vec{g}$ acting vertically downward, resolved into:\n  • Parallel to plane (downward): $F_{gx} = mg \\sin\\theta$\n  • Perpendicular to plane (into surface): $F_{gy} = mg \\cos\\theta$\n- Normal Reaction: $\\vec{N}$ acts perpendicular to the surface outward. Since there is no acceleration along the $y$-axis ($a_y = 0$):\n$$\\Sigma F_y = 0 \\implies N = mg \\cos\\theta$$\n\n2. **Friction Force & Acceleration Derivation**:\n- As the block slides down the incline, kinetic friction $f_k$ opposes the relative motion and acts **upward along the incline**:\n$$f_k = \\mu_k N = \\mu_k mg \\cos\\theta$$\n- Applying Newton's Second Law along the incline ($x$-axis):\n$$\\Sigma F_x = mg \\sin\\theta - f_k = m \\cdot a$$\n$$mg \\sin\\theta - \\mu_k mg \\cos\\theta = m \\cdot a$$\n$$a = g(\\sin\\theta - \\mu_k \\cos\\theta)$$\n*(Assumption: $\\tan\\theta > \\mu_k$, meaning gravitational pull exceeds static friction so downward acceleration occurs).*\n\n3. **Why the Normal Reaction Does Zero Work**:\n- Work done by a force $\\vec{F}$ over an infinitesimal displacement $d\\vec{r}$ is given by the scalar product:\n$$dW = \\vec{F} \\cdot d\\vec{r} = |\\vec{F}| |d\\vec{r}| \\cos\\phi$$\nwhere $\\phi$ is the angle between the force vector and the displacement vector.\n- For the block sliding along the inclined plane, the displacement $d\\vec{r}$ is strictly parallel to the surface of the incline.\n- The normal reaction $\\vec{N}$ is perpendicular ($\\\\perp$) to the incline at every point of contact: $\\phi = 90^\\circ$.\n- Since $\\cos(90^\\circ) = 0$:\n$$dW_N = \\vec{N} \\cdot d\\vec{r} = N \\, dr \\cos(90^\\circ) = 0$$\n$$\\therefore W_N = \\int dW_N = 0$$\nHence, the normal reaction does **zero work** on the block during its entire motion along the incline.`;
      relatedTopics = ['Friction on Incline', 'Newton\'s Second Law', 'Work Done by Normal Force'];
    } else if (qLower.includes('projectile') || (qLower.includes('highest point') && qLower.includes('acceleration')) || qLower.includes('acceleration must also be zero')) {
      answer = `**Misconception Analysis: Velocity & Acceleration at the Highest Point of Projectile Motion:**\n\n1. **The Core Misconception**:\nThe statement *"Since velocity is zero at the highest point, acceleration must also be zero"* contains two fundamental physical errors:\n- It conflates the **vertical velocity component ($v_y$)** with the **total velocity ($\\vec{v}$)**.\n- It confuses **instantaneous velocity ($\\vec{v} = 0$)** with **acceleration ($\\vec{a} = \\frac{d\\vec{v}}{dt}$)**.\n\n2. **Velocity at the Highest Point is NOT Zero**:\n- For a projectile launched with initial speed $u$ at angle $\theta$ to the horizontal:\n  • Horizontal velocity component: $v_x = u \\cos\\theta$ (constant throughout flight because $a_x = 0$, neglecting air drag).\n  • Vertical velocity component: $v_y = u \\sin\\theta - gt$.\n- At the apex (maximum height $H = \\frac{u^2 \\sin^2\\theta}{2g}$), only the vertical component momentarily vanishes: $v_y = 0$.\n- However, the horizontal velocity remains non-zero: $v_x = u \\cos\\theta$.\n- Therefore, the total velocity at the apex is purely horizontal and non-zero:\n$$\\vec{v}_{\\text{apex}} = (u \\cos\\theta) \\hat{i} \\implies |\\vec{v}_{\\text{apex}}| = u \\cos\\theta \\neq 0 \\quad (\\text{for } \\theta < 90^\\circ)$$\n*(Only in the degenerate case of purely vertical motion $\\theta = 90^\\circ$ is total velocity momentarily zero).* \n\n3. **Acceleration is NOT Zero (It Remains Constant $g$ Downward)**:\n- Acceleration is determined by the net external force acting on the particle (Newton's Second Law: $\\vec{a} = \\frac{\\Sigma \\vec{F}}{m}$).\n- Neglecting air resistance, the only force acting on the projectile at every point of its trajectory (including at the apex) is the downward force of gravity:\n$$\\Sigma \\vec{F} = \\vec{F}_g = -mg \\hat{j}$$\n$$\\vec{a} = \\frac{-mg \\hat{j}}{m} = -g \\hat{j} \\implies |\\vec{a}| = g \\approx 9.8\\text{ m/s}^2 \\text{ (directed vertically downward)}$$\n- **Proof by Contradiction**: If acceleration were zero at the top ($\\vec{a} = 0$), the net force would be zero ($\\Sigma \\vec{F} = 0$). By Newton's First Law, the projectile would continue moving horizontally at constant speed $u\\cos\\theta$ forever in a straight line, never descending back to Earth! The fact that its trajectory curves downward proves that downward acceleration $g$ is continuously present.`;
      relatedTopics = ['Projectile Motion', 'Acceleration due to Gravity', 'Kinematics Misconceptions'];
    } else if (qLower.includes('electrostatic') || qLower.includes('coulomb') || qLower.includes('electric field') || qLower.includes('gauss') || qLower.includes('capacitor')) {
      answer = `**Electrostatics & Gauss's Law:**\n\n1. **Coulomb's Law**: Between point charges in vacuum:\n$$\\vec{F} = \\frac{1}{4\\pi \\varepsilon_0} \\frac{q_1 q_2}{r^2} \\hat{r}, \\quad \\text{where } \\frac{1}{4\\pi \\varepsilon_0} \\approx 8.99 \\times 10^9 \\text{ N}\\cdot\\text{m}^2/\\text{C}^2$$\n2. **Electric Field & Potential**: $\\vec{E} = -\\nabla V \\implies V(r) = \\frac{q}{4\\pi \\varepsilon_0 r}$.\n3. **Gauss's Law**: Net electric flux through a closed surface equals enclosed charge divided by $\\varepsilon_0$:\n$$\\oint_{\\mathcal{S}} \\vec{E} \\cdot d\\vec{A} = \\frac{Q_{\\text{enclosed}}}{\\varepsilon_0}$$\n• **Common Pitfall**: Choosing an asymmetric Gaussian surface where $\\vec{E}$ is not constant across the surface.`;
      relatedTopics = ['Coulomb\'s Law', 'Electric Field', 'Gauss\'s Law'];
    } else if (qLower.includes('current') || qLower.includes('drift') || qLower.includes('kirchhoff') || qLower.includes('resistor') || qLower.includes('ohm')) {
      answer = `**Current Electricity (JEE Formulation):**\n\n1. **Drift Velocity & Current**: \n$$I = n e A v_d, \\quad v_d = \\frac{e E}{m} \\tau = \\frac{e V}{m L} \\tau$$\n2. **Ohm's Law & Resistivity**: $V = IR$, where $R = \\rho \\frac{L}{A}$ and conductivity $\\sigma = \\frac{1}{\\rho} = \\frac{n e^2 \\tau}{m}$.\n3. **Kirchhoff's Laws**:\n• **KCL (Junction Rule)**: $\\sum I_{\\text{in}} = \\sum I_{\\text{out}}$ (Conservation of Charge).\n• **KVL (Loop Rule)**: $\\sum \\Delta V = 0$ around any closed loop (Conservation of Energy).\n• **Common Pitfall**: Misinterpreting the sign of potential difference across a battery when tracing current in reverse.`;
      relatedTopics = ['Current Electricity', 'Drift Velocity', 'Kirchhoff\'s Laws'];
    } else if (qLower.includes('photoelectric') || qLower.includes('bohr') || qLower.includes('modern physics') || qLower.includes('de broglie') || qLower.includes('wavelength')) {
      answer = `**Modern Physics & Quantum Concepts:**\n\n1. **Einstein's Photoelectric Equation**:\n$$K_{\\text{max}} = h\\nu - \\Phi_0 = h\\nu - h\\nu_0 = e V_s$$\nwhere $\\Phi_0$ is the work function and $V_s$ is the stopping potential.\n2. **de Broglie Wavelength**: For a particle with momentum $p$:\n$$\\lambda = \\frac{h}{p} = \\frac{h}{m v} = \\frac{h}{\\sqrt{2 m K}} = \\frac{h}{\\sqrt{2 m q V}}$$\n3. **Bohr Model of Hydrogen Atom**: Quantized angular momentum $L = m v r = \\frac{n h}{2\\pi}$. Energy levels: $E_n = -\\frac{13.6\\text{ eV}}{n^2} Z^2$.\n• **Common Pitfall**: Confusing intensity of light (affects photoelectric current) with frequency of light (affects maximum kinetic energy $K_{\\text{max}}$).`;
      relatedTopics = ['Photoelectric Effect', 'de Broglie Wavelength', 'Bohr Model'];
    } else if (qLower.includes('work') || qLower.includes('energy') || qLower.includes('power')) {
      answer = `**Work-Energy Theorem & Conservation of Energy:**\n\n1. **Work Done by a Variable Force**: \n$$W = \\int_{\\vec{r}_i}^{\\vec{r}_f} \\vec{F} \\cdot d\\vec{r} = \\int (F_x dx + F_y dy + F_z dz)$$\n2. **Work-Energy Theorem**: The total work done by **all** forces (conservative, non-conservative, and pseudo) equals the change in kinetic energy: \n$$W_{\\text{total}} = \\Delta K = \\frac{1}{2}m v_f^2 - \\frac{1}{2}m v_i^2$$\n3. **Conservative Forces & Potential Energy**: For conservative forces, $W_c = -\\Delta U$. When non-conservative work $W_{\\text{nc}} = 0$, mechanical energy is strictly conserved: $K_i + U_i = K_f + U_f$.\n\n**Sanity Check**: Work is a scalar quantity measured in Joules ($1\\text{ J} = 1\\text{ N}\\cdot\\text{m} = 1\\text{ kg}\\cdot\\text{m}^2/\\text{s}^2$).`;
      relatedTopics = ['Work-Energy Theorem', 'Potential Energy', 'Conservation of Mechanical Energy'];
    } else if (qLower.includes('newton') || qLower.includes('force') || qLower.includes('motion')) {
      answer = `**Newton's Laws of Motion (JEE Mechanics):**\n\n1. **First Law (Inertia)**: An isolated body maintains its velocity ($\\vec{v} = \\text{constant}$) unless acted on by a net external force: $\\sum \\vec{F}_{\\text{ext}} = 0 \\implies \\frac{d\\vec{p}}{dt} = 0$.\n2. **Second Law (Momentum & Acceleration)**: $\\vec{F}_{\\text{net}} = \\frac{d\\vec{p}}{dt} = m\\vec{a}$ (for constant mass $m$).\n3. **Third Law (Action-Reaction Pair)**: $\\vec{F}_{AB} = -\\vec{F}_{BA}$. Action and reaction act on **different** bodies and never cancel each other on a single free-body diagram.\n\n**JEE Problem-Solving Steps:**\n• Step 1: Draw independent Free-Body Diagrams (FBDs) for each body.\n• Step 2: Choose orthogonal coordinate axes ($x, y$) aligned with acceleration.\n• Step 3: Write $\\sum F_x = m a_x$ and $\\sum F_y = m a_y$.\n• **Common Pitfall**: Including pseudo forces in inertial frames, or confusing normal reaction with gravity.`;
      relatedTopics = ['Newton\'s Laws', 'Free-Body Diagrams', 'Friction'];
    } else {
      answer = `**Physics Concept Overview:**\n\n• **Core Principle**: State the governing physical law before substituting numerical values.\n• **Vectors & Signs**: Pay careful attention to vector directions ($\hat{i}, \hat{j}, \hat{k}$) and signs in coordinate systems.\n• **Units**: Verify that all quantities are converted to base SI units ($m, kg, s, A$) before calculation.`;
      relatedTopics = ['General Physics', 'Mechanics', 'SI Units'];
    }
  } else if (subject === 'chemistry') {
    if (qLower.includes('ionization') || qLower.includes('ionisation') || (qLower.includes('oxygen') && qLower.includes('nitrogen'))) {
      answer = `**First Ionization Enthalpy Anomaly: Nitrogen vs Oxygen:**\n\n1. **Electronic Configurations & Orbital Diagrams**:\n- **Nitrogen ($Z = 7$)**: $[\\text{He}]\\, 2s^2\\, 2p_x^1\\, 2p_y^1\\, 2p_z^1$\n  • Nitrogen has a **half-filled $2p^3$ subshell** with 3 unpaired electrons of parallel spins.\n  • According to Hund's Rule of maximum multiplicity, half-filled subshells have enhanced stability due to symmetrical charge distribution and maximum **exchange energy** (3 exchange pairs).\n- **Oxygen ($Z = 8$)**: $[\\text{He}]\\, 2s^2\\, 2p_x^2\\, 2p_y^1\\, 2p_z^1$\n  • Oxygen has a $2p^4$ configuration with **one doubly occupied (paired) orbital** ($2p_x$) and two half-filled orbitals.\n\n2. **Inter-Electronic Pairing Repulsion**:\n- In oxygen, two electrons are forced into the same $2p_x$ orbital. Because $2p$ orbitals are compact, electrostatic repulsion between these two paired electrons is very high.\n- This mutual electron-electron repulsion destabilizes the $2p_x^2$ pair and pushes one electron to a higher energy state, making it significantly easier to remove.\n\n3. **Nuclear Charge vs Electron Repulsion Trade-off**:\n- Although oxygen has a higher nuclear charge ($Z = 8$) than nitrogen ($Z = 7$), the **extra inter-electronic repulsion** in the paired $2p$ orbital of oxygen overcompensates the increase in nuclear attraction.\n- Disruption of the stable half-filled $2p^3$ configuration in nitrogen requires extra energy.\n- Consequently, the first ionization enthalpy of oxygen is lower than that of nitrogen:\n$$\\Delta_i H_1(\\text{O}) \\approx 1314\\text{ kJ/mol} < \\Delta_i H_1(\\text{N}) \\approx 1402\\text{ kJ/mol}$$\n*(Note: For the second ionization enthalpy $\\Delta_i H_2$, oxygen becomes higher than nitrogen because $\\text{O}^+$ acquires the stable half-filled $2p^3$ configuration).*`;
      relatedTopics = ['Ionization Enthalpy', 'Electronic Configuration', 'Hund\'s Rule', 'Periodic Trends'];
    } else if (qLower.includes('bond') || qLower.includes('hybrid') || qLower.includes('orbital')) {
      answer = `**Chemical Bonding & Molecular Structure:**\n\n1. **VSEPR & Steric Number (SN)**:\n$$\\text{SN} = (\\text{Number of bonded atoms}) + (\\text{Number of lone pairs on central atom})$$\n• $\\text{SN} = 2 \\implies sp$ (Linear, $180^\\circ$)\n• $\\text{SN} = 3 \\implies sp^2$ (Trigonal Planar, $120^\\circ$)\n• $\\text{SN} = 4 \\implies sp^3$ (Tetrahedral, $109.5^\\circ$)\n2. **Dipole Moment ($\\mu$)**: $\\mu = q \\times d$, measured in Debye ($1\\text{ D} = 3.336 \\times 10^{-30}\\text{ C}\\cdot\\text{m}$). Molecular symmetry can cancel bond dipoles (e.g. $\\text{CO}_2$ has polar bonds but $\\mu = 0$).\n3. **Common JEE Pitfall**: Ignoring lone pair - bond pair repulsion which compresses bond angles (e.g. $\\text{NH}_3$ at $107^\\circ$, $\\text{H}_2\\text{O}$ at $104.5^\\circ$).`;
      relatedTopics = ['VSEPR Theory', 'Hybridization', 'Dipole Moment'];
    } else if (qLower.includes('thermodynamic') || qLower.includes('entropy') || qLower.includes('gibbs')) {
      answer = `**Chemical Thermodynamics & Spontaneity:**\n\n1. **First Law**: $\\Delta U = q + w$ (IUPAC convention where work done on the system is positive).\n2. **Enthalpy**: $H = U + PV \\implies \\Delta H = \\Delta U + \\Delta n_g R T$ for gaseous reactions.\n3. **Gibbs Free Energy & Spontaneity**:\n$$\\Delta G = \\Delta H - T\\Delta S$$\n• $\\Delta G < 0$: Spontaneous process.\n• $\\Delta G = 0$: Dynamic equilibrium, where $\\Delta G^\\circ = -RT \\ln K_{\\text{eq}}$.\n• $\\Delta G > 0$: Non-spontaneous in forward direction.\n• **Key Rule**: Temperature $T$ must always be in Kelvin ($T\\text{ (K)} = T\\text{ (^\\circ C)} + 273.15$).`;
      relatedTopics = ['Gibbs Free Energy', 'First Law of Thermodynamics', 'Spontaneity'];
    } else if (qLower.includes('equilibrium') || qLower.includes('chatelier') || qLower.includes('ph') || qLower.includes('buffer')) {
      answer = `**Chemical & Ionic Equilibrium:**\n\n1. **Equilibrium Constant ($K_c, K_p$)**:\n$$K_p = K_c (RT)^{\\Delta n_g}$$\nwhere $\\Delta n_g = \\sum n_{\\text{gaseous products}} - \\sum n_{\\text{gaseous reactants}}$.\n2. **Le Chatelier's Principle**: When a stress (concentration, pressure, volume, temperature) is applied to a system at dynamic equilibrium, the equilibrium position shifts to counteract the imposed change:\n• Exothermic reaction ($\\Delta H < 0$): Increasing $T$ shifts equilibrium backward (decreases $K$).\n• Increasing pressure shifts toward fewer moles of gas.\n3. **Buffer Solutions (Henderson-Hasselbalch Equation)**:\n$$\\text{pH} = \\text{p}K_a + \\log_{10}\\left(\\frac{[\\text{Conjugate Base}]}{[\\text{Weak Acid}]}\\right)$$\n• **Common Pitfall**: Including pure solids ($s$) and pure liquids ($l$) in the equilibrium expression $K_c$.`;
      relatedTopics = ['Chemical Equilibrium', 'Le Chatelier\'s Principle', 'Buffer Solutions'];
    } else if (qLower.includes('electrochem') || qLower.includes('nernst') || qLower.includes('galvanic') || qLower.includes('faraday')) {
      answer = `**Electrochemistry & Nernst Equation:**\n\n1. **Nernst Equation at $298\\text{ K}$**:\n$$E_{\\text{cell}} = E^\\circ_{\\text{cell}} - \\frac{0.0591}{n} \\log_{10} Q, \\quad \\text{where } Q = \\frac{[\\text{Products}]^p}{[\\text{Reactants}]^r}$$\n2. **Standard Cell Potential & Gibbs Energy**:\n$$\\Delta G^\\circ = -n F E^\\circ_{\\text{cell}} = -RT \\ln K_{\\text{eq}}$$\nwhere Faraday constant $F \\approx 96485\\text{ C/mol}$. Cell is spontaneous if $E_{\\text{cell}} > 0$.\n3. **Faraday\'s Laws of Electrolysis**: Mass deposited $w = Z I t = \\left(\\frac{M}{n F}\\right) I t$.\n• **Common Pitfall**: Forgetting to multiply stoichiometric coefficients as exponents in the reaction quotient $Q$.`;
      relatedTopics = ['Electrochemistry', 'Nernst Equation', 'Faraday\'s Laws'];
    } else if (qLower.includes('organic') || qLower.includes('sn1') || qLower.includes('sn2') || qLower.includes('carbocation') || qLower.includes('mechanism')) {
      answer = `**Organic Reaction Mechanisms (JEE Organic):**\n\n1. **$\\text{S}_\\text{N}1$ vs $\\text{S}_\\text{N}2$ Nucleophilic Substitution**:\n• **$\\text{S}_\\text{N}1$ (Two Steps)**: Formation of planar carbocation intermediate (rate-determining step), followed by nucleophilic attack. Reactivity order: $3^\\circ > 2^\\circ > 1^\\circ$. Results in partial racemization (inversion + retention).\n• **$\\text{S}_\\text{N}2$ (One Step)**: Concerted backside attack via penta-coordinate transition state. Reactivity order: $\\text{CH}_3\\text{X} > 1^\\circ > 2^\\circ > 3^\\circ$ (governed by steric hindrance). Results in complete Walden inversion.\n2. **Markovnikov Rule**: In electrophilic addition of $\\text{HX}$ to asymmetric alkenes, the proton adds to the carbon with more hydrogen atoms to yield the more stable carbocation intermediate ($3^\\circ > 2^\\circ > 1^\\circ$).\n• **Common Pitfall**: Overlooking hydride or methyl shifts that rearrange carbocations into more stable isomers.`;
      relatedTopics = ['Organic Mechanisms', 'SN1 and SN2 Substitution', 'Carbocation Stability'];
    } else {
      answer = `**Chemistry Concept Overview:**\n\n• **Reaction Stoichiometry**: Balance atoms and charge before applying equilibrium or kinetic formulas.\n• **Thermodynamic Conditions**: Standard conditions ($T = 298\\text{ K}, P = 1\\text{ bar}$) must be confirmed before quoting standard electrode potentials or enthalpies.`;
      relatedTopics = ['General Chemistry', 'Physical Chemistry'];
    }
  } else if (subject === 'mathematics') {
    if (qLower.includes('integral') || qLower.includes('integration') || qLower.includes('area')) {
      if (qLower.includes('x/(x^2+1)') || qLower.includes('x/(x²+1)') || (qLower.includes('x^2+1') && (qLower.includes('0 to 1') || qLower.includes('another method')))) {
        if (qLower.includes('another method') || qLower.includes('differently') || qLower.includes('alternative')) {
          answer = `**Alternative Evaluation of Definite Integral $I = \\int_0^1 \\frac{x}{x^2+1} \\, dx$ via Trigonometric Substitution:**\n\n1. **Choice of Trigonometric Substitution**:\nRecall the Pythagorean trigonometric identity $1 + \\tan^2\\theta = \\sec^2\\theta$. This naturally suggests setting:\n$$x = \\tan\\theta \\implies dx = \\sec^2\\theta \\, d\\theta$$\n\n2. **Transforming Denominator & Integrand**:\n$$x^2 + 1 = \\tan^2\\theta + 1 = \\sec^2\\theta$$\n$$\\frac{x}{x^2 + 1} \\, dx = \\frac{\\tan\\theta}{\\sec^2\\theta} \\cdot (\\sec^2\\theta \\, d\\theta) = \\tan\\theta \\, d\\theta$$\n\n3. **Transforming Integration Limits**:\n- Lower limit ($x = 0$): $\\tan\\theta = 0 \\implies \\theta = 0$.\n- Upper limit ($x = 1$): $\\tan\\theta = 1 \\implies \\theta = \\frac{\\pi}{4}$.\n\n4. **Integration & Final Evaluation**:\n$$I = \\int_0^{\\pi/4} \\tan\\theta \\, d\\theta = \\left[ \\ln|\\sec\\theta| \\right]_0^{\\pi/4}$$\n$$I = \\ln\\left(\\sec\\left(\\frac{\\pi}{4}\\right)\\right) - \\ln(\\sec(0))$$\nSince $\\sec(\\pi/4) = \\sqrt{2}$ and $\\sec(0) = 1$:\n$$I = \\ln(\\sqrt{2}) - \\ln(1) = \\ln(2^{1/2}) - 0 = \\mathbf{\\frac{1}{2} \\ln 2} \\approx 0.34657$$\n*(Note: Both the algebraic $u$-substitution and trigonometric $\\theta$-substitution yield the identical exact result $\\frac{1}{2}\\ln 2$).*`;
          relatedTopics = ['Trigonometric Substitution', 'Definite Integrals', 'Alternative Integration Techniques'];
        } else {
          answer = `**Step-by-Step Evaluation of $I = \\int_0^1 \\frac{x}{x^2+1} \\, dx$:**\n\n1. **Method of Algebraic Substitution ($u$-substitution)**:\nNotice that the numerator $x$ is proportional to the derivative of the denominator $x^2 + 1$.\n- Let $u = x^2 + 1$.\n- Differentiate both sides with respect to $x$:\n$$\\frac{du}{dx} = 2x \\implies du = 2x \\, dx \\implies x \\, dx = \\frac{du}{2}$$\n\n2. **Change of Integration Limits**:\nWhen transforming from $x$ to $u$, we convert the limits accordingly:\n- Lower limit ($x = 0$): $u = 0^2 + 1 = 1$\n- Upper limit ($x = 1$): $u = 1^2 + 1 = 2$\n\n3. **Transform the Integral**:\n$$I = \\int_0^1 \\frac{x}{x^2+1} \\, dx = \\int_{u=1}^{u=2} \\frac{1}{u} \\cdot \\frac{du}{2} = \\frac{1}{2} \\int_1^2 \\frac{1}{u} \\, du$$\n\n4. **Evaluate the Antiderivative**:\nThe fundamental antiderivative is $\\int \\frac{1}{u} \\, du = \\ln|u|$. Applying the Fundamental Theorem of Calculus:\n$$I = \\frac{1}{2} \\left[ \\ln|u| \\right]_1^2 = \\frac{1}{2} (\\ln 2 - \\ln 1)$$\nSince $\\ln(1) = 0$:\n$$I = \\frac{1}{2} (\\ln 2 - 0) = \\mathbf{\\frac{1}{2} \\ln 2} = \\ln(\\sqrt{2}) \\approx 0.34657$$\n\n5. **Sanity Check**:\nOver the domain $x \\in [0, 1]$, the integrand $f(x) = \\frac{x}{x^2+1} > 0$ for $x > 0$ with maximum at $x = 1$ where $f(1) = 0.5$. The area under the curve must be strictly between $0$ and $0.5$. Our answer $\\frac{1}{2}\\ln(2) \\approx 0.3466$ conforms to the bounds.`;
          relatedTopics = ['Definite Integrals', 'u-Substitution', 'Calculus'];
        }
      } else {
        answer = `**Integral Calculus (JEE Definite & Indefinite Integrals):**\n\n1. **Integration by Parts**:\n$$\\int u\\,dv = u v - \\int v\\,du, \\quad \\text{prioritizing ILATE (Inverse, Log, Algebraic, Trig, Exponential)}$$\n2. **King\'s Property of Definite Integrals**:\n$$\\int_a^b f(x)\\,dx = \\int_a^b f(a + b - x)\\,dx$$\nThis property solves many symmetrical JEE integrals by adding the original integral $I$ to the transformed integral $I$ to yield $2I$.\n3. **Leibniz Rule for Differentiation under the Integral Sign**:\n$$\\frac{d}{dx}\\left[\\int_{\\phi(x)}^{\\psi(x)} f(t)\\,dt\\right] = f(\\psi(x)) \\cdot \\psi'(x) - f(\\phi(x)) \\cdot \\phi'(x)$$`;
        relatedTopics = ['Definite Integrals', 'King\'s Property', 'Integration by Parts'];
      }
    } else if (qLower.includes('limit') || qLower.includes('continuity') || qLower.includes('differentiab') && !qLower.includes('derivative')) {
      answer = `**Limits & Continuity (JEE Calculus):**\n\n1. **Indeterminate Forms**: $\\frac{0}{0}, \\frac{\\infty}{\\infty}, 0 \\times \\infty, \\infty - \\infty, 0^0, \\infty^0, 1^\\infty$.\n2. **L\'Hôpital\'s Rule**: For $\\frac{0}{0}$ or $\\frac{\\infty}{\\infty}$, if $f(x)$ and $g(x)$ are differentiable near $a$:\n$$\\lim_{x \\to a} \\frac{f(x)}{g(x)} = \\lim_{x \\to a} \\frac{f'(x)}{g'(x)}$$\n3. **Standard Limits**:\n$$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1, \\quad \\lim_{x \\to 0} \\frac{e^x - 1}{x} = 1, \\quad \\lim_{x \\to 0} (1 + x)^{1/x} = e$$\n• **Common Pitfall**: Applying L\'Hôpital\'s Rule to forms that are not indeterminate! Always check substitution first.`;
      relatedTopics = ['Limits', 'L\'Hôpital\'s Rule', 'Continuity'];
    } else if (qLower.includes('derivative') || qLower.includes('differentiati') || qLower.includes('maxima') || qLower.includes('minima')) {
      answer = `**Differential Calculus & Applications of Derivatives:**\n\n1. **Fundamental Rules**:\n• Product Rule: $(uv)' = u'v + uv'$\n• Quotient Rule: $\\left(\\frac{u}{v}\\right)' = \\frac{u'v - uv'}{v^2}$\n• Chain Rule: $\\frac{dy}{dx} = \\frac{dy}{du} \\cdot \\frac{du}{dx}$\n2. **Maxima and Minima Criteria**:\n• Critical point: $f'(x_0) = 0$ (or undefined).\n• Local Maximum: $f''(x_0) < 0$.\n• Local Minimum: $f''(x_0) > 0$.\n• Point of Inflexion: $f''(x_0) = 0$ and $f'''(x_0) \\neq 0$.\n• **Common Pitfall**: Forgetting boundary endpoints on closed intervals $[a, b]$ when finding absolute extrema.`;
      relatedTopics = ['Differentiation', 'Chain Rule', 'Maxima and Minima'];
    } else if (qLower.includes('parabola') || qLower.includes('ellipse') || qLower.includes('hyperbola') || qLower.includes('conic') || qLower.includes('tangent')) {
      answer = `**Coordinate Geometry & Conic Sections:**\n\n1. **Standard Conics Equations**:\n• Parabola ($y^2 = 4ax$): Focus $(a, 0)$, Directrix $x = -a$, Tangent with slope $m$: $y = mx + \\frac{a}{m}$.\n• Ellipse ($\\frac{x^2}{a^2} + \\frac{y^2}{b^2} = 1$ with $a > b$): Eccentricity $e = \\sqrt{1 - \\frac{b^2}{a^2}}$, Foci $(\\pm ae, 0)$, Tangent: $y = mx \\pm \\sqrt{a^2 m^2 + b^2}$.\n• Hyperbola ($\\frac{x^2}{a^2} - \\frac{y^2}{b^2} = 1$): Eccentricity $e = \\sqrt{1 + \\frac{b^2}{a^2}}$, Tangent: $y = mx \\pm \\sqrt{a^2 m^2 - b^2}$.\n• **Common Pitfall**: Mixing up the focal distance $ae$ and directrix distance $\\frac{a}{e}$.`;
      relatedTopics = ['Conic Sections', 'Parabola', 'Ellipse', 'Hyperbola'];
    } else if (qLower.includes('vector') || qLower.includes('3d') || qLower.includes('plane') || qLower.includes('cross product') || qLower.includes('dot product')) {
      answer = `**Vectors & 3D Geometry:**\n\n1. **Dot & Cross Products**:\n• Dot Product: $\\vec{a} \\cdot \\vec{b} = |\\vec{a}||\\vec{b}|\\cos\\theta = a_x b_x + a_y b_y + a_z b_z$ (Orthogonal when $\\vec{a} \\cdot \\vec{b} = 0$).\n• Cross Product: $\\vec{a} \\times \\vec{b} = |\\vec{a}||\\vec{b}|\\sin\\theta\\,\\hat{n}$ (Collinear when $\\vec{a} \\times \\vec{b} = \\vec{0}$).\n2. **Plane in 3D Space**:\n$$\\vec{r} \\cdot \\vec{n} = d \\iff a(x - x_0) + b(y - y_0) + c(z - z_0) = 0$$\nwhere $\\vec{n} = a\\hat{i} + b\\hat{j} + c\\hat{k}$ is the normal vector.\n• **Shortest Distance Between Skew Lines**: $d = \\left|\\frac{(\\vec{a}_2 - \\vec{a}_1) \\cdot (\\vec{b}_1 \\times \\vec{b}_2)}{|\\vec{b}_1 \\times \\vec{b}_2|}\\right|$.`;
      relatedTopics = ['Vectors', '3D Geometry', 'Planes and Skew Lines'];
    } else {
      answer = `**Mathematics Problem-Solving Principles:**\n\n• **Domain & Range**: Always establish the domain of the function first before algebraic manipulation.\n• **Extraneous Roots**: Squaring both sides of an equation can introduce false roots; always substitute back to verify.`;
      relatedTopics = ['Calculus', 'Algebra', 'Trigonometry'];
    }
  } else {
    answer = `**Academic Study Breakdown for ${question}:**\n\n1. **Core Concept**: State the fundamental definition or governing theorem clearly.\n2. **Step-by-Step Analysis**: Break down variables, relationships, and assumptions.\n3. **Exam Application**: Verify boundary conditions and common student misconceptions.`;
    relatedTopics = ['General STEM', 'Study Methods'];
  }

  return {
    answer,
    sourceType: 'general',
    foundInMaterial: false,
    citations: [],
    relatedTopics,
  };
}
