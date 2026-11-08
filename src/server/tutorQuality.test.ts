/**
 * LearnMate AI Tutor Quality Engineering & Evaluation Suite
 *
 * Covers:
 * 1. Physics (Newton's Laws, Work/Energy/Power, Electrostatics, Current Electricity, Modern Physics).
 * 2. Chemistry (Chemical Bonding, Thermodynamics, Equilibrium, Electrochemistry, Organic Reaction Mechanisms).
 * 3. Mathematics (Limits & Continuity, Differentiation, Integration, Coordinate Geometry, Vectors & 3D Geometry).
 * 4. Context Grounding (PDF Pages, YouTube Transcripts, Multi-Turn Follow-Ups, Missing Context, Ambiguous Questions).
 * 5. Robustness & Safety (Anti-Placeholder, Anti-Generic Filler, Math Delimiters, KaTeX Rendering, Fallback Reliability).
 * 6. Agent Quality Rubrics (Factual correctness, Mathematical accuracy, Step-by-step clarity, Citation integrity).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectStemSubject,
  detectQueryIntent,
  buildTutorSystemInstruction,
  retrieveRelevantPagesWithHistory,
  formatTutorPagesContext,
  formatConversationHistory,
  validateAndSanitizeTutorAnswer,
  parseRobustTutorJson,
  buildPedagogicalFallback,
  type TutorStudyPage,
  type TutorChatMessage,
} from './tutorEngine.ts';
import { parseMathSegments, renderKaTeXToString } from '../components/MathRenderer.tsx';

// ---------------------------------------------------------------------------
// 1. SUBJECT & INTENT CLASSIFICATION TESTS
// ---------------------------------------------------------------------------

test('Subject Classifier accurately identifies STEM domains', () => {
  // Physics
  assert.equal(detectStemSubject('Explain Newton\'s third law in rocket propulsion'), 'physics');
  assert.equal(detectStemSubject('Find work done by variable force F = 3x^2'), 'physics');
  assert.equal(detectStemSubject('Calculate drift velocity of electrons in copper wire'), 'physics');
  assert.equal(detectStemSubject('What is the de Broglie wavelength of an electron?'), 'physics');
  assert.equal(detectStemSubject('State Gauss\'s law for a charged spherical shell'), 'physics');

  // Chemistry
  assert.equal(detectStemSubject('What is the hybridization and shape of SF6 molecule?'), 'chemistry');
  assert.equal(detectStemSubject('State Le Chatelier\'s principle on Haber process'), 'chemistry');
  assert.equal(detectStemSubject('Write the Nernst equation for Zn-Cu galvanic cell'), 'chemistry');
  assert.equal(detectStemSubject('Explain the SN2 mechanism for alkyl halide hydrolysis'), 'chemistry');
  assert.equal(detectStemSubject('Calculate delta G from delta H and delta S at 298 K'), 'chemistry');

  // Mathematics
  assert.equal(detectStemSubject('Evaluate limit of (sin x - x) / x^3 as x approaches 0'), 'mathematics');
  assert.equal(detectStemSubject('Find derivative of e^(x^2) * cos(3x)'), 'mathematics');
  assert.equal(detectStemSubject('Evaluate definite integral of 1 / (1 + x^2) from 0 to 1'), 'mathematics');
  assert.equal(detectStemSubject('Find equation of tangent to ellipse x^2/16 + y^2/9 = 1'), 'mathematics');
  assert.equal(detectStemSubject('Find angle between vectors a = 2i + j - k and b = i - j + 2k'), 'mathematics');
});

test('Intent Classifier distinguishes numerical, derivation, conceptual, and follow-up', () => {
  assert.equal(detectQueryIntent('Calculate acceleration of a 5 kg block with 20 N force'), 'numerical');
  assert.equal(detectQueryIntent('Derive the formula for time period of a simple pendulum'), 'derivation');
  assert.equal(detectQueryIntent('Why does total mechanical energy remain conserved?'), 'conceptual');
  assert.equal(detectQueryIntent('Why did you use that formula in step 2?'), 'follow_up');
  assert.equal(detectQueryIntent('Can you explain step 3 again with another method?'), 'follow_up');
});

// ---------------------------------------------------------------------------
// 2. PEDAGOGICAL SYSTEM INSTRUCTION & ANTI-PLACEHOLDER TESTS
// ---------------------------------------------------------------------------

test('System instruction enforces KaTeX delimiters, step-by-step algebra, and strict anti-placeholder policy', () => {
  const instruction = buildTutorSystemInstruction({
    subject: 'physics',
    intent: 'numerical',
    isStrictMode: false,
  });

  assert.ok(instruction.includes('KaTeX FORMATTING'));
  assert.ok(instruction.includes('$E = mc^2$'));
  assert.ok(instruction.includes('Given Data'));
  assert.ok(instruction.includes('Governing Law'));
  assert.ok(instruction.includes('Final Result'));
  assert.ok(instruction.includes('Sanity Check'));
  assert.ok(instruction.includes('ZERO PLACEHOLDER'));
  assert.ok(instruction.includes('[insert here]'));
});

test('Anti-placeholder validator detects and sanitizes bracketed placeholders and TODOs', () => {
  const badAnswer = `To solve this, first calculate mass [insert formula here] and then apply TODO: verify units. Also add [your answer here].`;
  const result = validateAndSanitizeTutorAnswer(badAnswer, 'physics');

  assert.equal(result.valid, false);
  assert.ok(result.detectedIssues.includes('BRACKETED_PLACEHOLDER'));
  assert.ok(result.detectedIssues.includes('TODO_MARKER'));
  assert.ok(!result.sanitizedAnswer.includes('[insert formula here]'));
  assert.ok(!result.sanitizedAnswer.includes('TODO:'));
});

test('Anti-placeholder validator detects and cleans mismatched probability boilerplate in physics', () => {
  const badPhysicsAnswer = `**Newton's Second Law:**\nStep 1: List the complete set of outcomes (the sample space Ω).\nStep 2: Identify event E.\nStep 3: Compare size keeping result between 0 and 1.\nVerify that all resulting probabilities remain between 0 and 1.`;
  const result = validateAndSanitizeTutorAnswer(badPhysicsAnswer, 'physics');

  assert.equal(result.valid, false);
  assert.ok(result.detectedIssues.includes('MISMATCHED_PROBABILITY_BOILERPLATE'));
  assert.ok(!result.sanitizedAnswer.includes('sample space Ω'));
});

test('Anti-placeholder validator auto-repairs unclosed math delimiters', () => {
  const unclosedMath = `The electric field is given by $E = \\frac{\\sigma}{2\\varepsilon_0 and the potential is $V = Ed$.`;
  const result = validateAndSanitizeTutorAnswer(unclosedMath, 'physics');

  assert.equal(result.valid, false);
  assert.ok(result.detectedIssues.includes('UNCLOSED_MATH_DELIMITER'));
  assert.ok(result.sanitizedAnswer.endsWith('$'));
});

// ---------------------------------------------------------------------------
// 3. CONTEXT RETRIEVAL & MULTI-TURN CONVERSATION TESTS
// ---------------------------------------------------------------------------

test('Context retrieval enriches query with previous turn for follow-up questions', () => {
  const pages: TutorStudyPage[] = [
    { pageNumber: 1, title: 'Kinematics Overview', content: 'Position, displacement, velocity and uniform acceleration equations.' },
    { pageNumber: 2, title: 'Work-Energy Theorem', content: 'Work done by constant and variable forces. Net work equals change in kinetic energy W = delta K.' },
    { pageNumber: 3, title: 'Gravitational Potential Energy', content: 'Conservative gravitational field U = mgh and mechanical energy conservation.' },
  ];

  const history: TutorChatMessage[] = [
    { role: 'user', content: 'How do I find speed at the bottom of an incline?' },
    { role: 'assistant', content: 'Apply the Work-Energy Theorem: $W_{\\text{gravity}} = \\Delta K \\implies mgh = \\frac{1}{2}mv^2$.' },
  ];

  // Follow-up doesn't mention "work" or "energy" directly
  const followUpQuery = 'Why did you equate work to kinetic energy in step 1?';
  const retrieved = retrieveRelevantPagesWithHistory(pages, followUpQuery, history, undefined, 2);

  assert.ok(retrieved.length > 0);
  // Page 2 (Work-Energy Theorem) must be retrieved due to multi-turn expansion!
  assert.ok(retrieved.some((p) => p.pageNumber === 2));
});

test('Conversation history formatter preserves recent turns while filtering welcome greetings', () => {
  const history: TutorChatMessage[] = [
    { role: 'assistant', content: 'Welcome to your AI Tutor session on Electrostatics. All syllabus concepts loaded.' },
    { role: 'user', content: 'What is electric flux through a cube of side a containing charge q?' },
    { role: 'assistant', content: 'By Gauss\'s Law, total flux is $\\Phi = \\frac{q}{\\varepsilon_0}$. Through one face, it is $\\frac{q}{6\\varepsilon_0}$.' },
    { role: 'user', content: 'What if the charge is on one of the cube vertices?' },
  ];

  const formatted = formatConversationHistory(history, 4);
  assert.ok(!formatted.includes('Welcome to your AI Tutor session'));
  assert.ok(formatted.includes('STUDENT: What is electric flux through a cube'));
  assert.ok(formatted.includes('Gauss\'s Law'));
  assert.ok(formatted.includes('vertices'));
});

// ---------------------------------------------------------------------------
// 4. ROBUST JSON PARSER & LATEX ESCAPING TESTS
// ---------------------------------------------------------------------------

test('Robust JSON parser recovers from markdown fences and unescaped LaTeX backslashes', () => {
  const rawWithFences = '```json\n{\n  "answer": "The force is $F = \\\\frac{G M m}{r^2}$.",\n  "sourceType": "general",\n  "foundInMaterial": false,\n  "citations": [],\n  "relatedTopics": ["Gravity"]\n}\n```';
  const parsed = parseRobustTutorJson(rawWithFences);

  assert.ok(parsed.answer.includes('\\frac{G M m}{r^2}'));
  assert.equal(parsed.sourceType, 'general');
  assert.equal(parsed.foundInMaterial, false);
});

// ---------------------------------------------------------------------------
// 5. SUBJECT-SPECIFIC PEDAGOGICAL EVALUATION RUBRIC
// ---------------------------------------------------------------------------

test('Physics Pedagogical Fallback: Newton\'s Laws produces complete, accurate JEE mechanics formulation', () => {
  const fallback = buildPedagogicalFallback({
    question: 'Explain Newton\'s laws of motion with equations and JEE problem steps',
    subject: 'physics',
    intent: 'conceptual',
  });

  assert.ok(fallback.answer.includes('Newton\'s Laws of Motion'));
  assert.ok(fallback.answer.includes('\\vec{F}_{\\text{net}}'));
  assert.ok(fallback.answer.includes('m\\vec{a}'));
  assert.ok(fallback.answer.includes('Free-Body Diagrams'));
  assert.ok(fallback.answer.includes('Action-Reaction Pair'));
  assert.ok(!fallback.answer.includes('sample space'));
});

test('Physics Pedagogical Fallback: Work-Energy & Electrostatics contain valid formulas and units', () => {
  const workFallback = buildPedagogicalFallback({
    question: 'State work energy theorem and variable force work',
    subject: 'physics',
    intent: 'derivation',
  });
  assert.ok(workFallback.answer.includes('W = \\int'));
  assert.ok(workFallback.answer.includes('W_{\\text{total}} = \\Delta K'));
  assert.ok(workFallback.answer.includes('Joules'));

  const electroFallback = buildPedagogicalFallback({
    question: 'Coulomb law and Gauss law electric flux',
    subject: 'physics',
    intent: 'conceptual',
  });
  assert.ok(electroFallback.answer.includes('Coulomb'));
  assert.ok(electroFallback.answer.includes('\\varepsilon_0'));
  assert.ok(electroFallback.answer.includes('\\oint'));
});

test('Chemistry Pedagogical Fallback: VSEPR Bonding & Thermodynamics produce rigorous equations and rules', () => {
  const bondingFallback = buildPedagogicalFallback({
    question: 'Explain VSEPR theory, steric number, hybridization and dipole moment',
    subject: 'chemistry',
    intent: 'conceptual',
  });
  assert.ok(bondingFallback.answer.includes('VSEPR'));
  assert.ok(bondingFallback.answer.includes('Steric Number'));
  assert.ok(bondingFallback.answer.includes('Debye'));

  const thermoFallback = buildPedagogicalFallback({
    question: 'First law of thermodynamics, enthalpy and Gibbs free energy',
    subject: 'chemistry',
    intent: 'conceptual',
  });
  assert.ok(thermoFallback.answer.includes('\\Delta U = q + w'));
  assert.ok(thermoFallback.answer.includes('\\Delta G = \\Delta H - T\\Delta S'));
  assert.ok(thermoFallback.answer.includes('Kelvin'));
});

test('Mathematics Pedagogical Fallback: Calculus Limits & Integration produce exact mathematical theorems', () => {
  const limitFallback = buildPedagogicalFallback({
    question: 'How to evaluate 0/0 indeterminate limit using L\'Hopital and standard limits',
    subject: 'mathematics',
    intent: 'conceptual',
  });
  assert.ok(limitFallback.answer.includes('Indeterminate Forms'));
  assert.ok(limitFallback.answer.includes('L\'Hôpital\'s Rule'));
  assert.ok(limitFallback.answer.includes('\\lim_{x \\to a}'));

  const integralFallback = buildPedagogicalFallback({
    question: 'Integration by parts and King property of definite integrals',
    subject: 'mathematics',
    intent: 'conceptual',
  });
  assert.ok(integralFallback.answer.includes('\\int u\\,dv = u v - \\int v\\,du'));
  assert.ok(integralFallback.answer.includes('King\'s Property'));
  assert.ok(integralFallback.answer.includes('\\int_a^b f(a + b - x)\\,dx'));
});

test('Physics Pedagogical Fallback: Current Electricity & Modern Physics produce rigorous formulas', () => {
  const currentFallback = buildPedagogicalFallback({
    question: 'Calculate drift velocity and state Kirchhoff laws for resistor circuit',
    subject: 'physics',
    intent: 'numerical',
  });
  assert.ok(currentFallback.answer.includes('I = n e A v_d'));
  assert.ok(currentFallback.answer.includes('KCL'));
  assert.ok(currentFallback.answer.includes('KVL'));

  const modernFallback = buildPedagogicalFallback({
    question: 'Einstein photoelectric equation and de Broglie wavelength of electron',
    subject: 'physics',
    intent: 'conceptual',
  });
  assert.ok(modernFallback.answer.includes('K_{\\text{max}} = h\\nu - \\Phi_0'));
  assert.ok(modernFallback.answer.includes('\\lambda = \\frac{h}{p}'));
  assert.ok(modernFallback.answer.includes('Bohr Model'));
});

test('Chemistry Pedagogical Fallback: Equilibrium, Electrochemistry & Organic Mechanisms', () => {
  const eqFallback = buildPedagogicalFallback({
    question: 'State Le Chatelier principle on chemical equilibrium and buffer pH equation',
    subject: 'chemistry',
    intent: 'conceptual',
  });
  assert.ok(eqFallback.answer.includes('Le Chatelier'));
  assert.ok(eqFallback.answer.includes('K_p = K_c (RT)^{\\Delta n_g}'));
  assert.ok(eqFallback.answer.includes('Henderson-Hasselbalch'));

  const electroFallback = buildPedagogicalFallback({
    question: 'Explain Nernst equation for galvanic cell and Faraday laws of electrolysis',
    subject: 'chemistry',
    intent: 'conceptual',
  });
  assert.ok(electroFallback.answer.includes('Nernst Equation'));
  assert.ok(electroFallback.answer.includes('E_{\\text{cell}} = E^\\circ_{\\text{cell}}'));
  assert.ok(electroFallback.answer.includes('Faraday'));

  const organicFallback = buildPedagogicalFallback({
    question: 'Explain SN1 vs SN2 mechanism, carbocation stability, and Markovnikov rule',
    subject: 'chemistry',
    intent: 'conceptual',
  });
  assert.ok(organicFallback.answer.includes('\\text{S}_\\text{N}1'));
  assert.ok(organicFallback.answer.includes('\\text{S}_\\text{N}2'));
  assert.ok(organicFallback.answer.includes('Markovnikov'));
});

test('Mathematics Pedagogical Fallback: Differentiation, Coordinate Geometry & Vectors/3D', () => {
  const diffFallback = buildPedagogicalFallback({
    question: 'Chain rule of differentiation and second derivative test for maxima and minima',
    subject: 'mathematics',
    intent: 'conceptual',
  });
  assert.ok(diffFallback.answer.includes('Chain Rule'));
  assert.ok(diffFallback.answer.includes('Maxima and Minima'));
  assert.ok(diffFallback.answer.includes('f\'\'(x_0) < 0'));

  const conicFallback = buildPedagogicalFallback({
    question: 'Equations of parabola, ellipse, hyperbola and tangents',
    subject: 'mathematics',
    intent: 'conceptual',
  });
  assert.ok(conicFallback.answer.includes('Parabola'));
  assert.ok(conicFallback.answer.includes('Ellipse'));
  assert.ok(conicFallback.answer.includes('Hyperbola'));

  const vectorFallback = buildPedagogicalFallback({
    question: 'Dot and cross product of vectors and equation of plane in 3D',
    subject: 'mathematics',
    intent: 'conceptual',
  });
  assert.ok(vectorFallback.answer.includes('\\vec{a} \\cdot \\vec{b}'));
  assert.ok(vectorFallback.answer.includes('\\vec{a} \\times \\vec{b}'));
  assert.ok(vectorFallback.answer.includes('Plane in 3D Space'));
});

// ---------------------------------------------------------------------------
// 7. CONTEXT GROUNDING & MISSING CONTEXT HONESTY TESTS
// ---------------------------------------------------------------------------

test('PDF-grounded retrieval produces verified page citations and excerpts', () => {
  const pages: TutorStudyPage[] = [
    {
      pageNumber: 4,
      title: 'Carnot Cycle & Efficiency',
      content: 'A Carnot engine operates between temperatures T1 (source) and T2 (sink). Efficiency eta = 1 - T2/T1. It is reversible and consists of two isothermal and two adiabatic processes.',
    },
  ];

  const fallback = buildPedagogicalFallback({
    question: 'What is the efficiency of a Carnot engine in my notes?',
    subject: 'physics',
    intent: 'conceptual',
    pages,
  });

  assert.equal(fallback.foundInMaterial, true);
  assert.equal(fallback.sourceType, 'material');
  assert.equal(fallback.citations.length, 1);
  assert.equal(fallback.citations[0].pageNumber, 4);
  assert.ok(fallback.citations[0].quote.includes('Carnot'));
  assert.ok(fallback.answer.includes('From your study material (Page 4 — Carnot Cycle & Efficiency)'));
});

test('Missing context handling explicitly states absence without hallucinating false citations', () => {
  const fallback = buildPedagogicalFallback({
    question: 'What is the Hubble constant?',
    subject: 'general',
    intent: 'conceptual',
    pages: [], // No material uploaded
  });

  assert.equal(fallback.foundInMaterial, false);
  assert.equal(fallback.sourceType, 'general');
  assert.equal(fallback.citations.length, 0);
  assert.ok(!fallback.answer.includes('[insert'));
  assert.ok(!fallback.answer.includes('TODO'));
});

test('Tutor mathematical expressions parse and render into valid HTML via KaTeX', () => {
  const tutorMath = `The electric field of an infinite sheet of charge with uniform surface charge density $\\sigma$ is given by:
$$E = \\frac{\\sigma}{2\\varepsilon_0}$$
where $\\sigma$ is in $\\text{C}/\\text{m}^2$ and $\\varepsilon_0 \\approx 8.854 \\times 10^{-12}\\text{ F}/\\text{m}$.`;

  const segments = parseMathSegments(tutorMath);
  assert.ok(segments.some((s) => s.type === 'inline-math' && s.content === '\\sigma'));
  assert.ok(segments.some((s) => s.type === 'block-math' && s.content.includes('\\frac{\\sigma}{2\\varepsilon_0}')));

  for (const seg of segments) {
    if (seg.type === 'inline-math' || seg.type === 'block-math') {
      const html = renderKaTeXToString(seg.content, seg.type === 'block-math');
      assert.ok(html.includes('<span class="katex">'));
      assert.ok(!html.includes('katex-error'));
    }
  }
});
