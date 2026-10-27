/**
 * Pure, deterministic Educational Specifications Engine for LearnMate 2.0 Creative Studio:
 * - PlayLab 2D Educational Games (EducationalGameSpec)
 * - Concept 3D Lab & 2D Mathematical/Physics Simulators (EducationalSceneSpec)
 * - No-Code Student Mini App Builder & Safe Formula Evaluator (MiniAppSpec)
 * - Deterministic Animated Explanation Specs for Video Lessons (AnimatedExplanationSpec)
 */

export type EducationalSubject =
  | 'Mathematics'
  | 'Physics'
  | 'Chemistry'
  | 'Biology'
  | 'Programming';

export type GameTemplateType =
  | 'math_graph_and_formula'
  | 'physics_projectile_challenge'
  | 'chemistry_equation_and_vsepr'
  | 'biology_organelle_and_sequence'
  | 'programming_code_trace';

export interface EducationalGameRound {
  id: string;
  prompt: string;
  visualHint: string;
  formulaOrCode: string;
  options: [string, string, string, string];
  correctIndex: number;
  hint: string;
  stepByStepExplanation: string;
  targetParams?: {
    targetRangeMeters?: number;
    gravity?: number;
    quadA?: number;
    quadB?: number;
    quadC?: number;
  };
}

export interface EducationalGameSpec {
  id: string;
  title: string;
  subject: EducationalSubject;
  topic: string;
  difficulty: 'easy' | 'medium' | 'hard';
  templateType: GameTemplateType;
  learningObjective: string;
  instructions: string;
  scoringRule: string;
  matchingPairs: Array<{
    id: string;
    term: string;
    match: string;
    category: string;
  }>;
  rounds: EducationalGameRound[];
}

export type SceneCategory =
  | 'math_surface_3d'
  | 'physics_projectile_3d'
  | 'chemistry_vsepr_3d'
  | 'biology_cell_3d'
  | 'custom_ai_3d';

export interface SceneParameterControl {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface SceneObjectLabel {
  id: string;
  title: string;
  formulaOrAngle: string;
  description: string;
  color: string;
  position3D: [number, number, number];
}

export interface EducationalSceneSpec {
  id: string;
  title: string;
  subject: EducationalSubject;
  topic: string;
  category: SceneCategory;
  supports3D: boolean;
  supports2DPlot: boolean;
  summary: string;
  governingEquations: string[];
  parameterControls: SceneParameterControl[];
  labels: SceneObjectLabel[];
  learningNotes: string[];
}

export interface MiniAppInputField {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
}

export interface MiniAppFormulaOutput {
  id: string;
  label: string;
  unit: string;
  expression: string;
  description: string;
}

export interface MiniAppQuizItem {
  id: string;
  question: string;
  options: [string, string, string, string];
  correctIndex: number;
  explanation: string;
}

export interface MiniAppPlannerItem {
  id: string;
  task: string;
  minutes: number;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
}

export interface MiniAppSpec {
  id: string;
  title: string;
  subtitle: string;
  subject: EducationalSubject;
  topic: string;
  templateId:
    | 'projectile_kinematics'
    | 'quadratic_solver'
    | 'bayes_posterior'
    | 'chapter_quiz_app'
    | 'revision_planner_app';
  accentColor: '#1A73E8' | '#34A853' | '#EA4335' | '#D97706' | '#7C3AED';
  inputs: MiniAppInputField[];
  outputs: MiniAppFormulaOutput[];
  quizItems: MiniAppQuizItem[];
  plannerItems: MiniAppPlannerItem[];
  studyTakeaway: string;
}

export interface AnimatedExplanationScene {
  sceneNumber: number;
  durationSeconds: number;
  heading: string;
  narration: string;
  visualCue: string;
  keyFormula: string;
  animationMode: 'projectile_arc' | 'quadratic_curve' | 'probability_tree' | 'molecule_bonds';
  highlightValues: string[];
}

/**
 * Classifies a study topic or document title into one of the 5 core STEM subjects.
 */
export function detectEducationalSubject(topicOrTitle: string): EducationalSubject {
  const lower = (topicOrTitle || '').toLowerCase();
  if (
    lower.includes('projectile') ||
    lower.includes('kinematic') ||
    lower.includes('velocity') ||
    lower.includes('pendulum') ||
    lower.includes('newton') ||
    lower.includes('force') ||
    lower.includes('optic') ||
    lower.includes('circuit') ||
    lower.includes('physics')
  ) {
    return 'Physics';
  }
  if (
    lower.includes('molecule') ||
    lower.includes('vsepr') ||
    lower.includes('bond') ||
    lower.includes('stoichiometr') ||
    lower.includes('methane') ||
    lower.includes('periodic') ||
    lower.includes('acid') ||
    lower.includes('chemistry') ||
    lower.includes('chemical')
  ) {
    return 'Chemistry';
  }
  if (
    lower.includes('cell') ||
    lower.includes('organelle') ||
    lower.includes('mitochondr') ||
    lower.includes('dna') ||
    lower.includes('photosynthe') ||
    lower.includes('genetics') ||
    lower.includes('biology')
  ) {
    return 'Biology';
  }
  if (
    lower.includes('algorithm') ||
    lower.includes('recursion') ||
    lower.includes('array') ||
    lower.includes('binary search') ||
    lower.includes('python') ||
    lower.includes('javascript') ||
    lower.includes('code') ||
    lower.includes('programming')
  ) {
    return 'Programming';
  }
  return 'Mathematics';
}

/**
 * Computes exact projectile motion kinematics for Physics 3D/2D Lab & PlayLab games.
 */
export function computeProjectileKinematics(params: {
  v0: number;
  angleDeg: number;
  gravity: number;
}): {
  vx: number;
  vy0: number;
  flightTimeSeconds: number;
  rangeMeters: number;
  maxHeightMeters: number;
  trajectoryPoints: Array<{ t: number; x: number; y: number }>;
} {
  const v0 = Math.max(1, Math.min(150, Number(params.v0) || 25));
  const angleDeg = Math.max(5, Math.min(85, Number(params.angleDeg) || 45));
  const g = Math.max(1.6, Math.min(25, Number(params.gravity) || 9.8));

  const thetaRad = (angleDeg * Math.PI) / 180;
  const vx = v0 * Math.cos(thetaRad);
  const vy0 = v0 * Math.sin(thetaRad);
  const flightTimeSeconds = (2 * vy0) / g;
  const rangeMeters = (v0 * v0 * Math.sin(2 * thetaRad)) / g;
  const maxHeightMeters = (vy0 * vy0) / (2 * g);

  const steps = 40;
  const trajectoryPoints: Array<{ t: number; x: number; y: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (flightTimeSeconds * i) / steps;
    const x = vx * t;
    const y = Math.max(0, vy0 * t - 0.5 * g * t * t);
    trajectoryPoints.push({
      t: Number(t.toFixed(3)),
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
    });
  }

  return {
    vx: Number(vx.toFixed(2)),
    vy0: Number(vy0.toFixed(2)),
    flightTimeSeconds: Number(flightTimeSeconds.toFixed(2)),
    rangeMeters: Number(rangeMeters.toFixed(2)),
    maxHeightMeters: Number(maxHeightMeters.toFixed(2)),
    trajectoryPoints,
  };
}

/**
 * Computes exact quadratic properties for y = a*x^2 + b*x + c.
 */
export function computeQuadraticProperties(params: {
  a: number;
  b: number;
  c: number;
}): {
  a: number;
  b: number;
  c: number;
  discriminant: number;
  vertexX: number;
  vertexY: number;
  realRoots: number[];
  rootsDescription: string;
  sampledPoints: Array<{ x: number; y: number }>;
} {
  const a = Math.abs(params.a) < 0.05 ? (params.a < 0 ? -0.5 : 1) : params.a;
  const b = Number(params.b) || 0;
  const c = Number(params.c) || 0;

  const discriminant = b * b - 4 * a * c;
  const vertexX = -b / (2 * a);
  const vertexY = a * vertexX * vertexX + b * vertexX + c;

  let realRoots: number[] = [];
  let rootsDescription = 'No real roots (complex conjugate pair)';
  if (Math.abs(discriminant) < 1e-6) {
    realRoots = [Number(vertexX.toFixed(2))];
    rootsDescription = `One repeated real root at x = ${vertexX.toFixed(2)}`;
  } else if (discriminant > 0) {
    const sqrtD = Math.sqrt(discriminant);
    const r1 = (-b - sqrtD) / (2 * a);
    const r2 = (-b + sqrtD) / (2 * a);
    realRoots = [Number(Math.min(r1, r2).toFixed(2)), Number(Math.max(r1, r2).toFixed(2))];
    rootsDescription = `Two distinct real roots: x₁ = ${realRoots[0]}, x₂ = ${realRoots[1]}`;
  }

  const sampledPoints: Array<{ x: number; y: number }> = [];
  for (let x = -5; x <= 5; x += 0.25) {
    const y = a * x * x + b * x + c;
    sampledPoints.push({ x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) });
  }

  return {
    a,
    b,
    c,
    discriminant: Number(discriminant.toFixed(2)),
    vertexX: Number(vertexX.toFixed(2)),
    vertexY: Number(vertexY.toFixed(2)),
    realRoots,
    rootsDescription,
    sampledPoints,
  };
}

/**
 * Verified VSEPR 3D Molecular Geometry data for Chemistry 3D Lab.
 */
export interface VseprMoleculeModel {
  id: 'CH4' | 'H2O' | 'CO2' | 'NH3';
  formula: string;
  name: string;
  geometryName: string;
  bondAngleDeg: number;
  hybridization: string;
  centralAtom: { element: string; color: number; radius: number };
  ligands: Array<{
    element: string;
    color: number;
    radius: number;
    direction: [number, number, number];
    bondOrder: 1 | 2;
  }>;
  lonePairsCount: number;
  description: string;
}

export const VERIFIED_VSEPR_MOLECULES: Record<'CH4' | 'H2O' | 'CO2' | 'NH3', VseprMoleculeModel> = {
  CH4: {
    id: 'CH4',
    formula: 'CH₄',
    name: 'Methane',
    geometryName: 'Tetrahedral (AX₄)',
    bondAngleDeg: 109.5,
    hybridization: 'sp³',
    centralAtom: { element: 'C', color: 0x334155, radius: 0.62 },
    ligands: [
      { element: 'H', color: 0x38bdf8, radius: 0.36, direction: [1, 1, 1], bondOrder: 1 },
      { element: 'H', color: 0x38bdf8, radius: 0.36, direction: [-1, -1, 1], bondOrder: 1 },
      { element: 'H', color: 0x38bdf8, radius: 0.36, direction: [-1, 1, -1], bondOrder: 1 },
      { element: 'H', color: 0x38bdf8, radius: 0.36, direction: [1, -1, -1], bondOrder: 1 },
    ],
    lonePairsCount: 0,
    description:
      'Four bonding electron pairs repel equally in 3D space, forming a symmetric tetrahedron with 109.5° H–C–H bond angles.',
  },
  H2O: {
    id: 'H2O',
    formula: 'H₂O',
    name: 'Water',
    geometryName: 'Bent / Angular (AX₂E₂)',
    bondAngleDeg: 104.5,
    hybridization: 'sp³',
    centralAtom: { element: 'O', color: 0xef4444, radius: 0.6 },
    ligands: [
      {
        element: 'H',
        color: 0xf8fafc,
        radius: 0.35,
        direction: [Math.sin((52.25 * Math.PI) / 180), -Math.cos((52.25 * Math.PI) / 180), 0],
        bondOrder: 1,
      },
      {
        element: 'H',
        color: 0xf8fafc,
        radius: 0.35,
        direction: [-Math.sin((52.25 * Math.PI) / 180), -Math.cos((52.25 * Math.PI) / 180), 0],
        bondOrder: 1,
      },
    ],
    lonePairsCount: 2,
    description:
      'Two lone pairs on Oxygen exert stronger repulsion than bonding pairs, compressing the H–O–H bond angle from 109.5° down to 104.5°.',
  },
  CO2: {
    id: 'CO2',
    formula: 'CO₂',
    name: 'Carbon Dioxide',
    geometryName: 'Linear (AX₂)',
    bondAngleDeg: 180.0,
    hybridization: 'sp',
    centralAtom: { element: 'C', color: 0x334155, radius: 0.6 },
    ligands: [
      { element: 'O', color: 0xef4444, radius: 0.54, direction: [-1, 0, 0], bondOrder: 2 },
      { element: 'O', color: 0xef4444, radius: 0.54, direction: [1, 0, 0], bondOrder: 2 },
    ],
    lonePairsCount: 0,
    description:
      'Two double bonds (C=O) with zero lone pairs on Carbon orient 180° apart in a symmetric linear geometry with zero net dipole.',
  },
  NH3: {
    id: 'NH3',
    formula: 'NH₃',
    name: 'Ammonia',
    geometryName: 'Trigonal Pyramidal (AX₃E₁)',
    bondAngleDeg: 107.0,
    hybridization: 'sp³',
    centralAtom: { element: 'N', color: 0x3b82f6, radius: 0.6 },
    ligands: [
      { element: 'H', color: 0xf8fafc, radius: 0.35, direction: [0.94, -0.34, 0], bondOrder: 1 },
      { element: 'H', color: 0xf8fafc, radius: 0.35, direction: [-0.47, -0.34, 0.81], bondOrder: 1 },
      { element: 'H', color: 0xf8fafc, radius: 0.35, direction: [-0.47, -0.34, -0.81], bondOrder: 1 },
    ],
    lonePairsCount: 1,
    description:
      'One apical lone pair on Nitrogen pushes the three N–H bonds downward into a trigonal pyramid with 107.0° H–N–H bond angles.',
  },
};

/**
 * Generates a validated, playable EducationalGameSpec tailored to the subject, topic, and difficulty.
 */
export function buildEducationalGameSpec(params: {
  topic: string;
  subject?: EducationalSubject;
  difficulty?: 'easy' | 'medium' | 'hard';
}): EducationalGameSpec {
  const topic = (params.topic || 'Core Study Topic').trim();
  const subject = params.subject || detectEducationalSubject(topic);
  const difficulty = params.difficulty || 'medium';

  if (subject === 'Physics') {
    return {
      id: `game-physics-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Physics Lab Challenge: ${topic}`,
      subject: 'Physics',
      topic,
      difficulty,
      templateType: 'physics_projectile_challenge',
      learningObjective: `Master projectile kinematics R = (v₀² sin 2θ)/g, maximum height H = (v₀ sin θ)²/(2g), and vector decomposition for ${topic}.`,
      instructions:
        'Complete the Concept Matching Grid or launch projectiles and solve each kinematics round. Use hints if needed; streaks award +50 bonus XP!',
      scoringRule: '+100 XP per solved round (+50 streak bonus).',
      matchingPairs: [
        {
          id: 'p1',
          term: 'Horizontal Range R',
          match: '(v₀² · sin 2θ) / g — maximized at θ = 45°',
          category: 'Kinematics',
        },
        {
          id: 'p2',
          term: 'Maximum Height H_max',
          match: '(v₀ · sin θ)² / (2g) — vertical vy = 0 at apex',
          category: 'Kinematics',
        },
        {
          id: 'p3',
          term: 'Time of Flight T',
          match: '(2 · v₀ · sin θ) / g — total time in air on level ground',
          category: 'Kinematics',
        },
        {
          id: 'p4',
          term: 'Horizontal Velocity vx',
          match: 'v₀ · cos θ — remains constant (ax = 0 without drag)',
          category: 'Vectors',
        },
      ],
      rounds: [
        {
          id: 'phys-r1',
          prompt:
            'A projectile is launched with initial speed v₀ = 20 m/s at angle θ = 45° (take g = 10 m/s²). What is its horizontal range R?',
          visualHint: 'At θ = 45°, sin(2θ) = sin(90°) = 1.',
          formulaOrCode: 'R = (v₀² · sin(2θ)) / g',
          options: ['40.0 m', '20.0 m', '80.0 m', '10.0 m'],
          correctIndex: 0,
          hint: 'Substitute v₀ = 20, sin(90°) = 1, and g = 10 into R = v₀² sin(2θ) / g.',
          stepByStepExplanation:
            'Step 1: Compute v₀² = 20² = 400 m²/s². Step 2: sin(2 × 45°) = sin(90°) = 1. Step 3: Divide by g = 10 m/s² → R = 400 / 10 = 40.0 m.',
          targetParams: { targetRangeMeters: 40, gravity: 10 },
        },
        {
          id: 'phys-r2',
          prompt:
            'At the highest point (apex) of a 2D projectile trajectory launched at speed v₀ and angle θ, what are the velocity components (vx, vy)?',
          visualHint: 'Gravity acts strictly downward (ay = −g, ax = 0).',
          formulaOrCode: 'v(t) = (v₀ cos θ, v₀ sin θ − g·t)',
          options: [
            'vx = v₀ cos θ,  vy = 0',
            'vx = 0,  vy = 0',
            'vx = 0,  vy = v₀ sin θ',
            'vx = v₀ sin θ,  vy = −g',
          ],
          correctIndex: 0,
          hint: 'Does any horizontal force act on the projectile in ideal vacuum kinematics?',
          stepByStepExplanation:
            'At the apex, vertical motion momentarily reverses so vy = 0, while horizontal velocity vx = v₀ cos θ remains constant throughout flight.',
        },
        {
          id: 'phys-r3',
          prompt:
            'Two projectiles are launched with the same initial speed v₀ on level ground. If Projectile A is launched at 30°, which launch angle for Projectile B gives the exact same horizontal range R?',
          visualHint: 'Recall the trigonometric identity sin(2(90° − θ)) = sin(180° − 2θ) = sin(2θ).',
          formulaOrCode: 'θ₂ = 90° − θ₁',
          options: ['60°', '45°', '75°', '15°'],
          correctIndex: 0,
          hint: 'Complementary angles θ and (90° − θ) yield identical values of sin(2θ).',
          stepByStepExplanation:
            'Because sin(2 × 60°) = sin(120°) = √3/2 = sin(60°) = sin(2 × 30°), complementary launch angles 30° and 60° achieve the exact same range.',
        },
      ],
    };
  }

  if (subject === 'Chemistry') {
    return {
      id: `game-chem-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Chemistry Reaction & VSEPR Challenge: ${topic}`,
      subject: 'Chemistry',
      topic,
      difficulty,
      templateType: 'chemistry_equation_and_vsepr',
      learningObjective: `Master stoichiometric equation balancing and 3D VSEPR molecular geometry for ${topic}.`,
      instructions:
        'Match each molecule or law with its VSEPR geometry, then balance chemical equations and bond angles in the interactive challenge rounds.',
      scoringRule: '+100 XP per balanced reaction or VSEPR diagnosis.',
      matchingPairs: [
        {
          id: 'c1',
          term: 'Methane (CH₄)',
          match: 'Tetrahedral (sp³, 109.5°, 0 lone pairs)',
          category: 'VSEPR',
        },
        {
          id: 'c2',
          term: 'Water (H₂O)',
          match: 'Bent / Angular (sp³, 104.5°, 2 lone pairs)',
          category: 'VSEPR',
        },
        {
          id: 'c3',
          term: 'Ammonia (NH₃)',
          match: 'Trigonal Pyramidal (sp³, 107.0°, 1 lone pair)',
          category: 'VSEPR',
        },
        {
          id: 'c4',
          term: 'Carbon Dioxide (CO₂)',
          match: 'Linear (sp, 180.0°, two C=O double bonds)',
          category: 'VSEPR',
        },
      ],
      rounds: [
        {
          id: 'chem-r1',
          prompt:
            'Balance the complete combustion of methane:  a CH₄ + b O₂  →  c CO₂ + d H₂O. What is the stoichiometric coefficient tuple (a, b, c, d)?',
          visualHint: 'Count C atoms first (1), then H atoms (4 → 2 H₂O), then O atoms (4 → 2 O₂).',
          formulaOrCode: '1 CH₄ + 2 O₂ → 1 CO₂ + 2 H₂O',
          options: ['(1, 2, 1, 2)', '(1, 1, 1, 2)', '(2, 3, 2, 4)', '(1, 3, 1, 2)'],
          correctIndex: 0,
          hint: '1 CO₂ and 2 H₂O contain a total of 2 + 2 = 4 oxygen atoms on the product side.',
          stepByStepExplanation:
            '1 C on left gives c = 1 CO₂. 4 H on left gives d = 2 H₂O. Total O on right = 2(1) + 2(1) = 4 oxygen atoms, requiring b = 2 O₂.',
        },
        {
          id: 'chem-r2',
          prompt:
            'Why is the H–O–H bond angle in Water (104.5°) smaller than the ideal tetrahedral angle in Methane (109.5°)?',
          visualHint: 'Lone pair–lone pair repulsion > lone pair–bonding pair > bonding pair–bonding pair.',
          formulaOrCode: 'AX₂E₂ (2 Bonding Pairs + 2 Lone Pairs)',
          options: [
            'Two lone pairs on Oxygen occupy more angular space and compress the O–H bonds',
            'Oxygen uses d-orbital hybridization in H₂O',
            'Hydrogen atoms attract each other via covalent H–H bonding',
            'Water has linear sp hybridization',
          ],
          correctIndex: 0,
          hint: 'According to VSEPR theory, how many lone pairs reside on the central Oxygen atom?',
          stepByStepExplanation:
            'Oxygen has 6 valence electrons: 2 shared in O–H bonds and 4 in two lone pairs. Lone pair electron domains repel more strongly, pushing the two O–H bonds closer to 104.5°.',
        },
        {
          id: 'chem-r3',
          prompt:
            'Balance the Haber-Bosch ammonia synthesis reaction:  a N₂ + b H₂  ⇌  c NH₃.',
          visualHint: 'Ensure 2 Nitrogen atoms and 6 Hydrogen atoms on both sides.',
          formulaOrCode: 'N₂ + 3 H₂ ⇌ 2 NH₃',
          options: ['(1, 3, 2)', '(1, 2, 2)', '(2, 3, 2)', '(1, 1, 1)'],
          correctIndex: 0,
          hint: '1 molecule of N₂ produces 2 molecules of NH₃, which requires 2 × 3 = 6 H atoms.',
          stepByStepExplanation:
            '1 N₂ + 3 H₂ → 2 NH₃ balances 2 N atoms and 6 H atoms on both reactant and product sides.',
        },
      ],
    };
  }

  if (subject === 'Biology') {
    return {
      id: `game-bio-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Biology Organelle & Pathway Challenge: ${topic}`,
      subject: 'Biology',
      topic,
      difficulty,
      templateType: 'biology_organelle_and_sequence',
      learningObjective: `Identify eukaryotic cell organelle functions and biological pathway sequences for ${topic}.`,
      instructions:
        'Match each cellular organelle to its physiological role and solve the biological pathway sequence puzzles.',
      scoringRule: '+100 XP per organelle & pathway match.',
      matchingPairs: [
        {
          id: 'b1',
          term: 'Mitochondria',
          match: 'Site of oxidative phosphorylation & ATP synthesis (cristae inner membrane)',
          category: 'Organelle',
        },
        {
          id: 'b2',
          term: 'Rough Endoplasmic Reticulum',
          match: 'Ribosome-studded membrane network for secretory protein synthesis & folding',
          category: 'Organelle',
        },
        {
          id: 'b3',
          term: 'Golgi Apparatus',
          match: 'Post-translational glycosylation, sorting & vesicle packaging',
          category: 'Organelle',
        },
        {
          id: 'b4',
          term: 'Nucleus & Nucleolus',
          match: 'Houses chromatin DNA, transcriptional regulation & rRNA assembly',
          category: 'Organelle',
        },
      ],
      rounds: [
        {
          id: 'bio-r1',
          prompt:
            'What is the correct intracellular trafficking sequence for a secreted protein (such as insulin) from synthesis to exocytosis?',
          visualHint: 'Follow the endomembrane system from mRNA translation to the plasma membrane.',
          formulaOrCode: 'Ribosome (Rough ER) → Transport Vesicle → Golgi → Secretory Vesicle',
          options: [
            'Rough ER Ribosome → ER Lumen → Cis-Golgi → Trans-Golgi → Plasma Membrane',
            'Nucleolus → Mitochondria → Smooth ER → Lysosome → Plasma Membrane',
            'Free Cytosolic Ribosome → Peroxisome → Nucleus → Plasma Membrane',
            'Golgi Apparatus → Rough ER → Mitochondria → Plasma Membrane',
          ],
          correctIndex: 0,
          hint: 'Secreted proteins are co-translationally translocated into the Rough ER before reaching the Golgi.',
          stepByStepExplanation:
            'Polypeptides destined for secretion enter the Rough ER lumen, travel via vesicles to the cis-Golgi for modification, exit the trans-Golgi in secretory vesicles, and fuse with the plasma membrane.',
        },
        {
          id: 'bio-r2',
          prompt:
            'During cellular respiration, in which specific compartment does the proton motive force (H⁺ gradient) accumulate to drive ATP Synthase?',
          visualHint: 'The inner mitochondrial membrane is impermeable to H⁺ ions.',
          formulaOrCode: 'Intermembrane Space [H⁺] high → Matrix via F₀F₁ ATP Synthase',
          options: [
            'Mitochondrial intermembrane space (pumped across the inner membrane)',
            'Cytosol outside the outer mitochondrial membrane',
            'Nucleoplasm inside the nuclear envelope',
            'Smooth endoplasmic reticulum lumen',
          ],
          correctIndex: 0,
          hint: 'Complexes I, III, and IV reside in the inner mitochondrial membrane (cristae).',
          stepByStepExplanation:
            'The electron transport chain pumps protons (H⁺) from the mitochondrial matrix into the intermembrane space; chemiosmotic flow back into the matrix powers ATP Synthase.',
        },
      ],
    };
  }

  if (subject === 'Programming') {
    return {
      id: `game-prog-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `Algorithm & Code Trace Arena: ${topic}`,
      subject: 'Programming',
      topic,
      difficulty,
      templateType: 'programming_code_trace',
      learningObjective: `Predict exact execution outputs, time complexity, and state invariants for ${topic}.`,
      instructions:
        'Match data structures to their time complexities and trace code execution step by step.',
      scoringRule: '+100 XP per verified code trace.',
      matchingPairs: [
        {
          id: 'cs1',
          term: 'Binary Search (Sorted Array)',
          match: 'O(log n) time, O(1) iterative space — halves search interval each step',
          category: 'Complexity',
        },
        {
          id: 'cs2',
          term: 'Hash Table Lookup',
          match: 'O(1) average time — maps keys via hash function to bucket index',
          category: 'Data Structures',
        },
        {
          id: 'cs3',
          term: 'Merge Sort',
          match: 'O(n log n) worst-case time, O(n) auxiliary space, stable divide-and-conquer',
          category: 'Sorting',
        },
        {
          id: 'cs4',
          term: 'Breadth-First Search (BFS)',
          match: 'O(V + E) time using a FIFO Queue — finds shortest unweighted path',
          category: 'Graphs',
        },
      ],
      rounds: [
        {
          id: 'cs-r1',
          prompt:
            'What is the exact output of the following recursive function call: f(4) where f(n) = (n <= 1) ? 1 : n + f(n - 1)?',
          visualHint: 'Trace the call stack: f(4) = 4 + f(3) = 4 + 3 + f(2) = 4 + 3 + 2 + f(1).',
          formulaOrCode: 'function f(n) { return n <= 1 ? 1 : n + f(n - 1); } // f(4)',
          options: ['10', '24', '9', '7'],
          correctIndex: 0,
          hint: 'Base case f(1) returns 1. Sum 4 + 3 + 2 + 1.',
          stepByStepExplanation:
            'f(1) = 1 → f(2) = 2 + 1 = 3 → f(3) = 3 + 3 = 6 → f(4) = 4 + 6 = 10.',
        },
        {
          id: 'cs-r2',
          prompt:
            'In Binary Search on a sorted array of N = 1,024 elements, what is the maximum number of comparisons required to locate a target or prove it is absent?',
          visualHint: 'Recall 2¹⁰ = 1,024.',
          formulaOrCode: 'max_steps = ⌊log₂(1024)⌋ + 1',
          options: ['11 comparisons', '512 comparisons', '100 comparisons', '32 comparisons'],
          correctIndex: 0,
          hint: 'Each comparison cuts the remaining search range in half.',
          stepByStepExplanation:
            'Since 1,024 = 2¹⁰, halving the interval takes at most log₂(1024) + 1 = 11 comparisons in the worst case.',
        },
      ],
    };
  }

  // Default: Mathematics (Probability, Quadratic Functions, Sets & Relations, Statistics)
  return {
    id: `game-math-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title: `Mathematics Concept & Equation Arena: ${topic}`,
    subject: 'Mathematics',
    topic,
    difficulty,
    templateType: 'math_graph_and_formula',
    learningObjective: `Master governing formulas, graph transformations, and step-by-step problem solving for ${topic}.`,
    instructions:
      'Match each mathematical theorem or function to its exact formula, then solve the multi-step equation & probability rounds.',
    scoringRule: '+100 XP per solved round (+50 streak bonus).',
    matchingPairs: [
      {
        id: 'm1',
        term: "Bayes' Theorem Posterior P(A | B)",
        match: '[ P(B | A) · P(A) ] / P(B) — updates prior belief with likelihood',
        category: 'Probability',
      },
      {
        id: 'm2',
        term: 'Quadratic Vertex & Axis of Symmetry',
        match: 'x_v = −b / (2a),  Δ = b² − 4ac determines real root count',
        category: 'Algebra',
      },
      {
        id: 'm3',
        term: 'Standard Error of Sample Mean SE(X̄)',
        match: 'σ / √n — quadrupling sample size n cuts SE in half',
        category: 'Statistics',
      },
      {
        id: 'm4',
        term: 'Variance Scaling Property Var(aX + b)',
        match: 'a² · Var(X) — constant shift b does not change spread',
        category: 'Random Variables',
      },
    ],
    rounds: [
      {
        id: 'math-r1',
        prompt:
          'Given P(A) = 0.20, P(B | A) = 0.75, and marginal probability P(B) = 0.30, compute the exact posterior probability P(A | B) using Bayes’ Theorem.',
        visualHint: 'Numerator = P(B | A) × P(A) = 0.75 × 0.20 = 0.15.',
        formulaOrCode: 'P(A | B) = [ P(B | A) · P(A) ] / P(B)',
        options: ['0.50 (50%)', '0.25 (25%)', '0.15 (15%)', '0.75 (75%)'],
        correctIndex: 0,
        hint: 'Divide the joint probability P(A ∩ B) = 0.15 by P(B) = 0.30.',
        stepByStepExplanation:
          'Step 1: Joint probability P(A ∩ B) = P(B|A)·P(A) = 0.75 × 0.20 = 0.15. Step 2: Divide by P(B) = 0.30 → P(A|B) = 0.15 / 0.30 = 0.50 (50%).',
      },
      {
        id: 'math-r2',
        prompt:
          'For the quadratic function y = x² − 4x + 3, what are its vertex coordinates (h, k) and real roots (x-intercepts)?',
        visualHint: 'h = −b / (2a) = −(−4) / 2 = 2, and y = (x − 1)(x − 3).',
        formulaOrCode: 'y = x² − 4x + 3 = (x − 2)² − 1',
        options: [
          'Vertex (2, −1) and roots x = 1, x = 3',
          'Vertex (−2, 15) and roots x = −1, x = −3',
          'Vertex (2, 3) and no real roots',
          'Vertex (4, 3) and roots x = 0, x = 4',
        ],
        correctIndex: 0,
        hint: 'Evaluate y(2) = 2² − 4(2) + 3 to find the minimum value k.',
        stepByStepExplanation:
          'Completing the square gives y = (x − 2)² − 1, so the vertex is at (2, −1). Setting y = 0 factors as (x − 1)(x − 3) = 0, giving roots x = 1 and x = 3.',
        targetParams: { quadA: 1, quadB: -4, quadC: 3 },
      },
      {
        id: 'math-r3',
        prompt:
          'A random sample of size n = 25 is drawn from a population with standard deviation σ = 15. What is the Standard Error SE(X̄) of the sample mean, and what sample size is needed to reduce SE(X̄) to 1.5?',
        visualHint: 'SE = σ / √n. To halve SE from 3.0 to 1.5, how must n scale?',
        formulaOrCode: 'SE(X̄) = σ / √n',
        options: [
          'SE = 3.0; requires n = 100 (4× sample size)',
          'SE = 3.0; requires n = 50 (2× sample size)',
          'SE = 0.6; requires n = 50',
          'SE = 15.0; requires n = 225',
        ],
        correctIndex: 0,
        hint: '15 / √25 = 15 / 5 = 3.0. Solve 15 / √n = 1.5.',
        stepByStepExplanation:
          'At n = 25, SE = 15 / √25 = 3.0. To halve SE to 1.5, √n must double from 5 to 10, requiring n = 10² = 100 observations.',
      },
    ],
  };
}

/**
 * Generates a validated EducationalSceneSpec for the Concept 3D Lab + 2D Plotter.
 */
export function buildEducationalSceneSpec(params: {
  topic: string;
  category?: SceneCategory;
}): EducationalSceneSpec {
  const topic = (params.topic || 'Core Study Concept').trim();
  const inferredSubject = detectEducationalSubject(topic);
  const category: SceneCategory =
    params.category ||
    (inferredSubject === 'Physics'
      ? 'physics_projectile_3d'
      : inferredSubject === 'Chemistry'
      ? 'chemistry_vsepr_3d'
      : inferredSubject === 'Biology'
      ? 'biology_cell_3d'
      : 'math_surface_3d');

  if (category === 'physics_projectile_3d') {
    return {
      id: 'scene-physics-projectile',
      title: `3D Kinematics & Projectile Trajectory Lab (${topic})`,
      subject: 'Physics',
      topic,
      category: 'physics_projectile_3d',
      supports3D: true,
      supports2DPlot: true,
      summary:
        'Real-time 3D & 2D parabolic trajectory simulator showing launch velocity vector v₀, apex height H_max, horizontal range R, and gravity g.',
      governingEquations: [
        'x(t) = v₀ · cos(θ) · t',
        'y(t) = v₀ · sin(θ) · t − ½ g t²',
        'R = (v₀² · sin(2θ)) / g',
        'H_max = (v₀ · sin(θ))² / (2g)',
      ],
      parameterControls: [
        {
          id: 'v0',
          label: 'Launch Speed v₀',
          unit: 'm/s',
          min: 10,
          max: 50,
          step: 1,
          defaultValue: 26,
        },
        {
          id: 'angleDeg',
          label: 'Launch Angle θ',
          unit: '°',
          min: 15,
          max: 80,
          step: 1,
          defaultValue: 45,
        },
        {
          id: 'gravity',
          label: 'Gravity g',
          unit: 'm/s²',
          min: 1.6,
          max: 20,
          step: 0.2,
          defaultValue: 9.8,
        },
      ],
      labels: [
        {
          id: 'lbl-launch',
          title: 'Launch Origin & v₀ Vector',
          formulaOrAngle: 'v₀ = (v₀ cos θ, v₀ sin θ)',
          description: 'Initial velocity decomposed into constant horizontal vx and upward vy₀.',
          color: '#38bdf8',
          position3D: [-3.5, 0.4, 0],
        },
        {
          id: 'lbl-apex',
          title: 'Trajectory Apex (H_max)',
          formulaOrAngle: 'vy = 0,  vx = v₀ cos θ',
          description: 'Vertical velocity momentarily reaches zero at peak altitude.',
          color: '#facc15',
          position3D: [0, 2.4, 0],
        },
        {
          id: 'lbl-impact',
          title: 'Horizontal Range (R)',
          formulaOrAngle: 'R = v₀² sin(2θ) / g',
          description: 'Maximum horizontal displacement on level ground occurs at θ = 45°.',
          color: '#34d399',
          position3D: [3.5, 0.3, 0],
        },
      ],
      learningNotes: [
        'Horizontal velocity vx = v₀ cos θ is constant throughout flight when air resistance is negligible.',
        'Vertical velocity vy(t) = v₀ sin θ − g·t decreases linearly due to downward acceleration g.',
        'Try switching Gravity g to 1.6 m/s² (Moon) vs 9.8 m/s² (Earth) to see Range R scale inversely with g!',
      ],
    };
  }

  if (category === 'chemistry_vsepr_3d') {
    return {
      id: 'scene-chemistry-vsepr',
      title: `3D VSEPR Molecular Geometry & Bond Angle Lab (${topic})`,
      subject: 'Chemistry',
      topic,
      category: 'chemistry_vsepr_3d',
      supports3D: true,
      supports2DPlot: true,
      summary:
        'Verified 3D VSEPR molecular geometry viewer for Methane (CH₄, 109.5°), Water (H₂O, 104.5°), Ammonia (NH₃, 107.0°), and Carbon Dioxide (CO₂, 180.0°).',
      governingEquations: [
        'Steric Number SN = (Bonding Domains) + (Lone Pairs)',
        'CH₄: AX₄ → sp³ Tetrahedral (109.5°)',
        'H₂O: AX₂E₂ → sp³ Bent (104.5°)',
        'CO₂: AX₂ → sp Linear (180.0°)',
      ],
      parameterControls: [
        {
          id: 'bondScale',
          label: 'Bond Length Scale',
          unit: 'Å',
          min: 0.7,
          max: 1.6,
          step: 0.05,
          defaultValue: 1.1,
        },
        {
          id: 'vibrationAmp',
          label: 'Thermal Bond Vibration',
          unit: 'x',
          min: 0,
          max: 1,
          step: 0.1,
          defaultValue: 0.2,
        },
      ],
      labels: [
        {
          id: 'lbl-central',
          title: 'Central Atom Core',
          formulaOrAngle: 'Hybridized Valence Shell',
          description: 'Minimizes electron-pair repulsion across 3D steric domains.',
          color: '#ef4444',
          position3D: [0, 0.5, 0],
        },
        {
          id: 'lbl-angle',
          title: 'Equilibrium Bond Angle',
          formulaOrAngle: 'LP–LP > LP–BP > BP–BP repulsion',
          description: 'Lone pairs occupy larger angular volume, compressing adjacent covalent bonds.',
          color: '#38bdf8',
          position3D: [1.5, -0.8, 0],
        },
      ],
      learningNotes: [
        'Valence Shell Electron Pair Repulsion (VSEPR) positions electron domains as far apart in 3D space as possible.',
        'Compare CH₄ (0 lone pairs → 109.5°), NH₃ (1 lone pair → 107.0°), and H₂O (2 lone pairs → 104.5°).',
      ],
    };
  }

  if (category === 'biology_cell_3d') {
    return {
      id: 'scene-biology-cell',
      title: `3D Eukaryotic Cell & Organelle Cross-Section (${topic})`,
      subject: 'Biology',
      topic,
      category: 'biology_cell_3d',
      supports3D: true,
      supports2DPlot: true,
      summary:
        'Interactive 3D cross-section of a eukaryotic cell highlighting the Nucleus, Mitochondria, Endoplasmic Reticulum, Golgi Apparatus, and Selective Plasma Membrane.',
      governingEquations: [
        'Cellular Respiration: C₆H₁₂O₆ + 6 O₂ → 6 CO₂ + 6 H₂O + ~30–32 ATP',
        'Central Dogma: DNA (Nucleus) → mRNA → Ribosome / Rough ER (Protein)',
      ],
      parameterControls: [
        {
          id: 'membraneOpacity',
          label: 'Cross-Section Depth',
          unit: '%',
          min: 15,
          max: 85,
          step: 5,
          defaultValue: 35,
        },
        {
          id: 'organelleScale',
          label: 'Organelle Magnification',
          unit: 'x',
          min: 0.8,
          max: 1.4,
          step: 0.05,
          defaultValue: 1.0,
        },
      ],
      labels: [
        {
          id: 'lbl-nucleus',
          title: 'Nucleus & Nucleolus',
          formulaOrAngle: 'Double Nuclear Envelope',
          description: 'Stores genomic chromatin DNA and coordinates transcription and ribosome assembly.',
          color: '#a855f7',
          position3D: [0, 0.8, 0],
        },
        {
          id: 'lbl-mito',
          title: 'Mitochondria (Cristae)',
          formulaOrAngle: 'Oxidative Phosphorylation',
          description: 'Generates ATP via the inner-membrane electron transport chain and chemiosmosis.',
          color: '#ef4444',
          position3D: [1.5, 0.2, 0.9],
        },
        {
          id: 'lbl-er',
          title: 'Endoplasmic Reticulum & Golgi',
          formulaOrAngle: 'Endomembrane Trafficking',
          description: 'Synthesizes, folds, glycosylates, and packages proteins into vesicles.',
          color: '#38bdf8',
          position3D: [-1.4, -0.2, 1.0],
        },
      ],
      learningNotes: [
        'Compartmentalization allows incompatible biochemical processes (e.g., lysosomal hydrolysis vs. DNA replication) to occur simultaneously.',
        'Mitochondria possess their own circular DNA and 70S ribosomes, supporting the endosymbiotic theory.',
      ],
    };
  }

  if (category === 'custom_ai_3d') {
    return {
      id: 'scene-custom-ai-3d',
      title: `AI 3D Model Creator (${topic})`,
      subject: inferredSubject,
      topic,
      category: 'custom_ai_3d',
      supports3D: true,
      supports2DPlot: false,
      summary:
        'Interactive AI-synthesized 3D spatial model powered by Claude 3.5 & Three.js with full orbit, pan, zoom, and wireframe controls.',
      governingEquations: [
        'Mesh vertices (x, y, z) generated from educational spatial graphs',
        'Shader: ACESFilmicToneMapping + PMREM Environment Illumination',
      ],
      parameterControls: [],
      labels: [],
      learningNotes: [
        'Interact with the 3D model using mouse/touch: Left-drag to orbit, right-drag to pan, scroll/pinch to zoom.',
        'Toggle wireframe mode to inspect the geometric polygon mesh and underlying spatial primitives.',
      ],
    };
  }

  // Default: Mathematics 3D Surface z = f(x, y) + 2D Function Graph y = ax^2 + bx + c
  return {
    id: 'scene-math-surface',
    title: `3D Mathematical Surface z = f(x, y) & 2D Quadratic Graph (${topic})`,
    subject: 'Mathematics',
    topic,
    category: 'math_surface_3d',
    supports3D: true,
    supports2DPlot: true,
    summary:
      'Interactive 3D multivariate surface mesh z = a·x² + b·y² (paraboloid, saddle surface, or wave interference) paired with an exact 2D quadratic graph plotter y = a·x² + b·x + c.',
    governingEquations: [
      '3D Surface: z(x, y) = a·x² + b·y²  (Elliptic Paraboloid when a,b > 0; Hyperbolic Saddle when a·b < 0)',
      '2D Parabola: y(x) = a·x² + b·x + c,   Vertex x_v = −b / (2a),   Discriminant Δ = b² − 4ac',
    ],
    parameterControls: [
      {
        id: 'quadA',
        label: 'Curvature Coefficient a',
        unit: '',
        min: -2.0,
        max: 2.0,
        step: 0.25,
        defaultValue: 1.0,
      },
      {
        id: 'quadB',
        label: 'Linear / Y-Curvature b',
        unit: '',
        min: -4.0,
        max: 4.0,
        step: 0.5,
        defaultValue: -2.0,
      },
      {
        id: 'quadC',
        label: 'Vertical Shift c',
        unit: '',
        min: -4.0,
        max: 4.0,
        step: 0.5,
        defaultValue: -3.0,
      },
    ],
    labels: [
      {
        id: 'lbl-vertex',
        title: 'Critical Point / Vertex (∇f = 0)',
        formulaOrAngle: '∂z/∂x = 0, ∂z/∂y = 0',
        description: 'Local minimum, maximum, or saddle point depending on the Hessian determinant.',
        color: '#facc15',
        position3D: [0, 0.2, 0],
      },
      {
        id: 'lbl-axes',
        title: '3D Coordinate Axes (X, Y, Z)',
        formulaOrAngle: 'Domain (x, y) ∈ [−3, 3]²',
        description: 'Color-coded wireframe surface elevation showing rate of change and concavity.',
        color: '#38bdf8',
        position3D: [2.2, 1.4, 0],
      },
    ],
    learningNotes: [
      'In 3D Mode: Set a > 0 and b > 0 for an upward Elliptic Paraboloid; set a > 0 and b < 0 to observe a Hyperbolic Paraboloid (Saddle Point)!',
      'In 2D Graph Mode: Adjust a, b, and c to watch the vertex (h, k), axis of symmetry, and real roots update in real time.',
    ],
  };
}

/**
 * Safe deterministic formula evaluator for Student Mini Apps.
 * Evaluates mathematical expressions over a key-value input map without `eval`.
 */
export function evaluateMiniAppFormulas(
  spec: MiniAppSpec,
  inputValues: Record<string, number>
): Record<string, { value: number; formatted: string }> {
  const vars: Record<string, number> = {};
  for (const field of spec.inputs) {
    const raw = inputValues[field.id];
    vars[field.id] = typeof raw === 'number' && Number.isFinite(raw) ? raw : field.defaultValue;
  }

  const results: Record<string, { value: number; formatted: string }> = {};

  if (spec.templateId === 'projectile_kinematics') {
    const kin = computeProjectileKinematics({
      v0: vars.v0 ?? 25,
      angleDeg: vars.angleDeg ?? 45,
      gravity: vars.gravity ?? 9.8,
    });
    results.rangeMeters = {
      value: kin.rangeMeters,
      formatted: `${kin.rangeMeters.toFixed(2)} m`,
    };
    results.maxHeightMeters = {
      value: kin.maxHeightMeters,
      formatted: `${kin.maxHeightMeters.toFixed(2)} m`,
    };
    results.flightTimeSeconds = {
      value: kin.flightTimeSeconds,
      formatted: `${kin.flightTimeSeconds.toFixed(2)} s`,
    };
    results.vx = {
      value: kin.vx,
      formatted: `${kin.vx.toFixed(2)} m/s`,
    };
    return results;
  }

  if (spec.templateId === 'quadratic_solver') {
    const quad = computeQuadraticProperties({
      a: vars.a ?? 1,
      b: vars.b ?? -4,
      c: vars.c ?? 3,
    });
    results.discriminant = {
      value: quad.discriminant,
      formatted: `${quad.discriminant.toFixed(2)}`,
    };
    results.vertex = {
      value: quad.vertexY,
      formatted: `(${quad.vertexX.toFixed(2)}, ${quad.vertexY.toFixed(2)})`,
    };
    results.roots = {
      value: quad.realRoots.length,
      formatted: quad.rootsDescription,
    };
    return results;
  }

  // Default / bayes_posterior & custom numeric formulas
  const prior = (vars.priorPct ?? 10) / 100;
  const sens = (vars.sensitivityPct ?? 95) / 100;
  const fp = (vars.falsePositivePct ?? 5) / 100;
  const marginalB = sens * prior + fp * (1 - prior);
  const posterior = marginalB > 0 ? (sens * prior) / marginalB : 0;

  results.marginalPct = {
    value: Number((marginalB * 100).toFixed(2)),
    formatted: `${(marginalB * 100).toFixed(2)}%`,
  };
  results.posteriorPct = {
    value: Number((posterior * 100).toFixed(2)),
    formatted: `${(posterior * 100).toFixed(1)}%`,
  };
  results.likelihoodRatio = {
    value: fp > 0 ? Number((sens / fp).toFixed(2)) : 99,
    formatted: fp > 0 ? `${(sens / fp).toFixed(1)}×` : '∞',
  };

  return results;
}

/**
 * Generates a complete, validated MiniAppSpec from a student's natural-language prompt or template selection.
 */
export function buildMiniAppSpecFromPrompt(params: {
  promptOrTopic: string;
  templateOverride?: MiniAppSpec['templateId'];
}): MiniAppSpec {
  const text = (params.promptOrTopic || 'Interactive Study Calculator').trim();
  const lower = text.toLowerCase();

  const templateId: MiniAppSpec['templateId'] =
    params.templateOverride ||
    (lower.includes('projectile') ||
    lower.includes('range') ||
    lower.includes('kinematic') ||
    lower.includes('velocity') ||
    lower.includes('physics')
      ? 'projectile_kinematics'
      : lower.includes('quadratic') ||
        lower.includes('parabola') ||
        lower.includes('equation') ||
        lower.includes('vertex') ||
        lower.includes('root')
      ? 'quadratic_solver'
      : lower.includes('quiz') || lower.includes('mcq') || lower.includes('test')
      ? 'chapter_quiz_app'
      : lower.includes('plan') || lower.includes('flashcard') || lower.includes('schedule')
      ? 'revision_planner_app'
      : 'bayes_posterior');

  if (templateId === 'projectile_kinematics') {
    return {
      id: `app-proj-${Date.now()}`,
      title: 'Projectile Range & Kinematics Calculator',
      subtitle: 'Interactive 2D Physics Launch Simulator with Live Trajectory Curve',
      subject: 'Physics',
      topic: text,
      templateId: 'projectile_kinematics',
      accentColor: '#1A73E8',
      inputs: [
        {
          id: 'v0',
          label: 'Initial Launch Velocity (v₀)',
          unit: 'm/s',
          min: 5,
          max: 100,
          step: 1,
          defaultValue: 30,
        },
        {
          id: 'angleDeg',
          label: 'Launch Angle (θ)',
          unit: 'deg',
          min: 5,
          max: 85,
          step: 1,
          defaultValue: 45,
        },
        {
          id: 'gravity',
          label: 'Gravitational Acceleration (g)',
          unit: 'm/s²',
          min: 1.6,
          max: 24.8,
          step: 0.2,
          defaultValue: 9.8,
        },
      ],
      outputs: [
        {
          id: 'rangeMeters',
          label: 'Horizontal Range (R)',
          unit: 'm',
          expression: '(v₀² · sin(2θ)) / g',
          description: 'Total horizontal distance traveled before returning to launch elevation.',
        },
        {
          id: 'maxHeightMeters',
          label: 'Maximum Apex Height (H_max)',
          unit: 'm',
          expression: '(v₀ · sin θ)² / (2g)',
          description: 'Peak vertical altitude where vertical velocity vy = 0.',
        },
        {
          id: 'flightTimeSeconds',
          label: 'Total Time of Flight (T)',
          unit: 's',
          expression: '(2 · v₀ · sin θ) / g',
          description: 'Duration in the air from launch to landing.',
        },
        {
          id: 'vx',
          label: 'Constant Horizontal Speed (vx)',
          unit: 'm/s',
          expression: 'v₀ · cos θ',
          description: 'Horizontal component of velocity (constant when air drag is zero).',
        },
      ],
      quizItems: [],
      plannerItems: [],
      studyTakeaway:
        'For any fixed initial speed v₀ on level ground, horizontal range R is maximized at θ = 45° because sin(2θ) reaches its peak value of 1.',
    };
  }

  if (templateId === 'quadratic_solver') {
    return {
      id: `app-quad-${Date.now()}`,
      title: 'Quadratic Formula, Discriminant & Vertex Solver',
      subtitle: 'Solves y = ax² + bx + c with Real-Time Parabola Plot & Root Analysis',
      subject: 'Mathematics',
      topic: text,
      templateId: 'quadratic_solver',
      accentColor: '#7C3AED',
      inputs: [
        {
          id: 'a',
          label: 'Quadratic Coefficient (a)',
          unit: '',
          min: -5,
          max: 5,
          step: 0.5,
          defaultValue: 1,
        },
        {
          id: 'b',
          label: 'Linear Coefficient (b)',
          unit: '',
          min: -10,
          max: 10,
          step: 0.5,
          defaultValue: -4,
        },
        {
          id: 'c',
          label: 'Constant Intercept (c)',
          unit: '',
          min: -10,
          max: 10,
          step: 0.5,
          defaultValue: 3,
        },
      ],
      outputs: [
        {
          id: 'discriminant',
          label: 'Discriminant (Δ)',
          unit: '',
          expression: 'b² − 4ac',
          description: 'Δ > 0: two real roots · Δ = 0: one repeated root · Δ < 0: complex roots.',
        },
        {
          id: 'vertex',
          label: 'Parabola Vertex (h, k)',
          unit: '',
          expression: 'h = −b/(2a), k = f(h)',
          description: 'Turning point and axis of symmetry x = h.',
        },
        {
          id: 'roots',
          label: 'Real Roots (x₁, x₂)',
          unit: '',
          expression: '(−b ± √Δ) / (2a)',
          description: 'x-intercepts where the parabola crosses y = 0.',
        },
      ],
      quizItems: [],
      plannerItems: [],
      studyTakeaway:
        'Completing the square rewrites y = ax² + bx + c into vertex form y = a(x − h)² + k where h = −b/(2a).',
    };
  }

  if (templateId === 'chapter_quiz_app') {
    return {
      id: `app-quiz-${Date.now()}`,
      title: `Custom Chapter Quiz App: ${text.slice(0, 48)}`,
      subtitle: 'Self-Grading Interactive Practice App with Instant Explanations',
      subject: detectEducationalSubject(text),
      topic: text,
      templateId: 'chapter_quiz_app',
      accentColor: '#EA4335',
      inputs: [],
      outputs: [],
      quizItems: [
        {
          id: 'q1',
          question:
            'If events A and B have non-zero probabilities and are mutually exclusive (disjoint), can they be statistically independent?',
          options: [
            'No — knowing A occurred guarantees B did not occur, so P(A ∩ B) = 0 ≠ P(A)P(B)',
            'Yes — disjoint events are always statistically independent',
            'Only when P(A) + P(B) = 1',
            'Only when the sample space is infinite',
          ],
          correctIndex: 0,
          explanation:
            'Disjoint means P(A ∩ B) = 0, whereas independence requires P(A ∩ B) = P(A)P(B) > 0.',
        },
        {
          id: 'q2',
          question:
            'By what factor must you multiply the sample size n to cut the Standard Error SE(X̄) = σ/√n in half?',
          options: ['Quadruple n (4×)', 'Double n (2×)', 'Multiply n by 8×', 'Halve n (0.5×)'],
          correctIndex: 0,
          explanation: 'Because √(4n) = 2√n in the denominator, quadrupling n halves SE(X̄).',
        },
        {
          id: 'q3',
          question:
            'For any random variable X and constants a, b, what is Var(aX + b)?',
          options: ['a² · Var(X)', 'a · Var(X) + b', 'a² · Var(X) + b²', 'Var(X) / a²'],
          correctIndex: 0,
          explanation:
            'Adding a constant shift b does not change spread, while scaling by a multiplies variance by a².',
        },
      ],
      plannerItems: [],
      studyTakeaway:
        'Active recall with immediate misconception feedback strengthens long-term exam retention.',
    };
  }

  if (templateId === 'revision_planner_app') {
    return {
      id: `app-planner-${Date.now()}`,
      title: `Revision Sprint & Flashcard Planner: ${text.slice(0, 42)}`,
      subtitle: 'Structured Study Checklist & Time-Boxed Active Recall Organizer',
      subject: detectEducationalSubject(text),
      topic: text,
      templateId: 'revision_planner_app',
      accentColor: '#34A853',
      inputs: [
        {
          id: 'dailyMinutes',
          label: 'Available Study Time Today',
          unit: 'min',
          min: 15,
          max: 180,
          step: 15,
          defaultValue: 60,
        },
      ],
      outputs: [],
      quizItems: [],
      plannerItems: [
        {
          id: 'pl-1',
          task: 'Review core formulas & axioms summary sheet',
          minutes: 15,
          priority: 'high',
          completed: false,
        },
        {
          id: 'pl-2',
          task: 'Solve 5 diagnostic & worked boundary-case problems',
          minutes: 25,
          priority: 'high',
          completed: false,
        },
        {
          id: 'pl-3',
          task: 'Complete Feynman "Teach It Back" self-explanation check',
          minutes: 20,
          priority: 'medium',
          completed: false,
        },
      ],
      studyTakeaway:
        'Splitting study blocks into 25-minute focused sprints with active problem solving prevents passive re-reading fatigue.',
    };
  }

  // Default: Bayes' Theorem & Diagnostic Posterior Calculator
  return {
    id: `app-bayes-${Date.now()}`,
    title: "Bayes' Theorem & Diagnostic Posterior Calculator",
    subtitle: 'Interactive Base-Rate & Conditional Probability Explorer',
    subject: 'Mathematics',
    topic: text,
    templateId: 'bayes_posterior',
    accentColor: '#1A73E8',
    inputs: [
      {
        id: 'priorPct',
        label: 'Prior Probability P(A)',
        unit: '%',
        min: 1,
        max: 90,
        step: 1,
        defaultValue: 10,
      },
      {
        id: 'sensitivityPct',
        label: 'Sensitivity / Likelihood P(B | A)',
        unit: '%',
        min: 10,
        max: 99,
        step: 1,
        defaultValue: 95,
      },
      {
        id: 'falsePositivePct',
        label: 'False Positive Rate P(B | Aᶜ)',
        unit: '%',
        min: 1,
        max: 50,
        step: 1,
        defaultValue: 5,
      },
    ],
    outputs: [
      {
        id: 'posteriorPct',
        label: 'Posterior Probability P(A | B)',
        unit: '%',
        expression: '[ P(B|A)·P(A) ] / P(B)',
        description: 'Updated probability that hypothesis A is true after observing evidence B.',
      },
      {
        id: 'marginalPct',
        label: 'Marginal Evidence P(B)',
        unit: '%',
        expression: 'P(B|A)P(A) + P(B|Aᶜ)P(Aᶜ)',
        description: 'Total probability of observing positive evidence B across all cases.',
      },
      {
        id: 'likelihoodRatio',
        label: 'Positive Likelihood Ratio (LR+)',
        unit: '×',
        expression: 'P(B|A) / P(B|Aᶜ)',
        description: 'How many times more likely evidence B is under hypothesis A vs Aᶜ.',
      },
    ],
    quizItems: [],
    plannerItems: [],
    studyTakeaway:
      'Even when a test has 95% sensitivity, a low base rate P(A) means false positives can still outnumber true positives!',
  };
}

/**
 * Generates a topic-matched multi-scene deterministic AnimatedExplanationSpec
 * for the Video Lessons tab when paid Omni Flash video generation is unavailable.
 */
export function buildAnimatedExplanationScenes(
  topic: string,
  contextText = ''
): AnimatedExplanationScene[] {
  const cleanTopic = (topic || 'Core Study Topic').trim();
  const subject = detectEducationalSubject(`${cleanTopic} ${contextText}`);

  if (subject === 'Physics') {
    return [
      {
        sceneNumber: 1,
        durationSeconds: 8,
        heading: `Vector Decomposition & Launch Setup: ${cleanTopic}`,
        narration: `Let's visualize ${cleanTopic}. An object launched at speed v₀ and angle θ splits into a constant horizontal velocity vx = v₀ cos θ and an initial vertical velocity vy₀ = v₀ sin θ.`,
        visualCue: 'Animated launch velocity vector decomposing into orthogonal vx and vy₀ arrows',
        keyFormula: 'vx = v₀ cos θ,   vy(0) = v₀ sin θ',
        animationMode: 'projectile_arc',
        highlightValues: ['v₀ = 25 m/s', 'θ = 45°', 'ax = 0, ay = −g'],
      },
      {
        sceneNumber: 2,
        durationSeconds: 10,
        heading: 'Apex Altitude & Parabolic Trajectory',
        narration: `As the projectile climbs, gravity decelerates vy at 9.8 m/s² until vy = 0 at the apex H_max = (v₀ sin θ)² / (2g). Horizontal speed vx remains unchanged.`,
        visualCue: 'Parabolic arc tracing toward apex with real-time velocity vectors',
        keyFormula: 'H_max = (v₀ · sin θ)² / (2g)',
        animationMode: 'projectile_arc',
        highlightValues: ['vy(apex) = 0 m/s', 'H_max = 15.9 m', 't_apex = v₀ sin θ / g'],
      },
      {
        sceneNumber: 3,
        durationSeconds: 8,
        heading: 'Horizontal Range & Complementary Angles',
        narration: `Upon landing back at y = 0, total horizontal range is R = (v₀² sin 2θ) / g. Range peaks at θ = 45°, and complementary angles like 30° and 60° land at the exact same spot.`,
        visualCue: 'Comparison of 30°, 45°, and 60° trajectories on level ground',
        keyFormula: 'R = (v₀² · sin 2θ) / g',
        animationMode: 'projectile_arc',
        highlightValues: ['R_max at θ = 45°', 'R(30°) = R(60°)', 'T = 2 v₀ sin θ / g'],
      },
    ];
  }

  if (subject === 'Chemistry') {
    return [
      {
        sceneNumber: 1,
        durationSeconds: 8,
        heading: `Valence Electron Domains: ${cleanTopic}`,
        narration: `In ${cleanTopic}, central atoms arrange their bonding and non-bonding electron pairs in 3D space to minimize electrostatic repulsion.`,
        visualCue: 'Central atom valence shell expanding with bonding pairs and lone pairs',
        keyFormula: 'Steric Number = Bonding Domains + Lone Pairs',
        animationMode: 'molecule_bonds',
        highlightValues: ['CH₄: SN = 4 (0 LP)', 'NH₃: SN = 4 (1 LP)', 'H₂O: SN = 4 (2 LP)'],
      },
      {
        sceneNumber: 2,
        durationSeconds: 10,
        heading: 'Lone Pair Compression & Equilibrium Angles',
        narration: `Because lone pairs are held closer to the central nucleus, they repel bonding pairs more strongly, compressing bond angles from 109.5° in Methane to 107° in Ammonia and 104.5° in Water.`,
        visualCue: 'Animated angle gauge comparing 109.5° tetrahedral vs 104.5° bent geometry',
        keyFormula: 'LP–LP > LP–BP > BP–BP Repulsion',
        animationMode: 'molecule_bonds',
        highlightValues: ['CH₄ = 109.5°', 'NH₃ = 107.0°', 'H₂O = 104.5°'],
      },
      {
        sceneNumber: 3,
        durationSeconds: 8,
        heading: 'Conservation of Atoms & Stoichiometric Balance',
        narration: `In any chemical reaction, covalent bonds rearrange while total atom counts remain conserved across reactants and products.`,
        visualCue: 'Balanced combustion reaction showing 1 CH₄ + 2 O₂ → 1 CO₂ + 2 H₂O',
        keyFormula: '1 CH₄ + 2 O₂ → 1 CO₂ + 2 H₂O',
        animationMode: 'molecule_bonds',
        highlightValues: ['1 Carbon', '4 Hydrogens', '4 Oxygens'],
      },
    ];
  }

  if ( cleanTopic.toLowerCase().includes('quadratic') || cleanTopic.toLowerCase().includes('parabola')) {
    return [
      {
        sceneNumber: 1,
        durationSeconds: 8,
        heading: `Anatomy of a Quadratic Function: ${cleanTopic}`,
        narration: `The quadratic function y = ax² + bx + c graphs a symmetric parabola. The sign of coefficient a controls concavity, and x = −b/(2a) locates the axis of symmetry.`,
        visualCue: 'Coordinate plane plotting y = x² − 4x + 3 with axis of symmetry x = 2',
        keyFormula: 'y = ax² + bx + c,   x_v = −b / (2a)',
        animationMode: 'quadratic_curve',
        highlightValues: ['a > 0: Opens Up', 'Vertex (2, −1)', 'Axis x = 2'],
      },
      {
        sceneNumber: 2,
        durationSeconds: 10,
        heading: 'The Discriminant Δ = b² − 4ac & Real Roots',
        narration: `Inside the quadratic formula, the discriminant Δ = b² − 4ac reveals how many times the parabola crosses the x-axis: two distinct roots when Δ > 0, one tangent root when Δ = 0, and none when Δ < 0.`,
        visualCue: 'Animated root markers at x = 1 and x = 3 where y = 0',
        keyFormula: 'x = (−b ± √(b² − 4ac)) / (2a)',
        animationMode: 'quadratic_curve',
        highlightValues: ['Δ > 0 → 2 Real Roots', 'Δ = 0 → 1 Repeated Root', 'Δ < 0 → Complex Roots'],
      },
      {
        sceneNumber: 3,
        durationSeconds: 8,
        heading: 'Vertex Form & Geometric Transformations',
        narration: `Completing the square rewrites y = ax² + bx + c as y = a(x − h)² + k, making horizontal shift h and minimum/maximum value k immediately visible.`,
        visualCue: 'Parabola shifting smoothly from y = x² to y = (x − 2)² − 1',
        keyFormula: 'y = a(x − h)² + k',
        animationMode: 'quadratic_curve',
        highlightValues: ['Shift Right h = 2', 'Shift Down k = −1', 'Roots x = 1, 3'],
      },
    ];
  }

  // Default: Probability, Bayes' Theorem & Mathematical Foundations
  return [
    {
      sceneNumber: 1,
      durationSeconds: 8,
      heading: `Sample Space Partition & Prior Belief: ${cleanTopic}`,
      narration: `Welcome to this animated explanation of ${cleanTopic}. We begin with the sample space Ω partitioned into hypothesis A (prior probability P(A)) and its complement Aᶜ.`,
      visualCue: 'Probability tree branching from Sample Space Ω into P(A) and P(Aᶜ)',
      keyFormula: 'P(A) + P(Aᶜ) = 1',
      animationMode: 'probability_tree',
      highlightValues: ['Prior P(A) = 0.01', 'Complement P(Aᶜ) = 0.99', 'Sample Space Ω = 1'],
    },
    {
      sceneNumber: 2,
      durationSeconds: 10,
      heading: 'Conditioning on New Evidence & Law of Total Probability',
      narration:
        contextText.slice(0, 180).replace(/\s+/g, ' ').trim() ||
        `When new evidence B is observed, we weight each branch by its likelihood: true positives P(B|A)P(A) versus false positives P(B|Aᶜ)P(Aᶜ).`,
      visualCue: 'Highlighted evidence paths converging to marginal probability P(B)',
      keyFormula: 'P(B) = P(B|A)P(A) + P(B|Aᶜ)P(Aᶜ)',
      animationMode: 'probability_tree',
      highlightValues: ['True Positive = 0.0099', 'False Positive = 0.0495', 'Total P(B) = 0.0594'],
    },
    {
      sceneNumber: 3,
      durationSeconds: 8,
      heading: "Bayes' Posterior Update & Exam Takeaway",
      narration: `Finally, Bayes' Theorem divides the true-positive branch by total evidence P(B), yielding the updated posterior probability P(A|B). Always account for the base rate P(A)!`,
      visualCue: 'Posterior ratio bar normalizing P(A ∩ B) over P(B)',
      keyFormula: 'P(A | B) = [ P(B | A) · P(A) ] / P(B)',
      animationMode: 'probability_tree',
      highlightValues: ['Posterior P(A|B) = 16.7%', 'Avoid Base-Rate Fallacy', 'Check Disjoint vs Independent'],
    },
  ];
}
