import type { CheckpointQuizQuestion } from '../../types/checkpointQuiz.types';
import { getCheckpointById } from '../checkpointRegistry';

export const CHECKPOINT_QUIZ_BANK: Record<string, CheckpointQuizQuestion[]> = {
  // =========================================================================
  // Physics Checkpoint 1: Units, Dimensions & 1D Kinematics
  // =========================================================================
  'PHY-01-CP1': [
    {
      id: 'quiz-phy-01-cp1-q1',
      checkpointId: 'PHY-01-CP1',
      type: 'single_correct',
      stem: 'A physical quantity $P$ depends on four measurable parameters $a, b, c, d$ according to the relation $P = \\frac{a^3 b^2}{\\sqrt{c}\\,d}$. The percentage errors in the measurement of $a, b, c$ and $d$ are $1\\%$, $2\\%$, $4\\%$, and $2\\%$ respectively. What is the maximum percentage error in the calculated value of $P$?',
      options: ['9%', '11%', '13%', '14%'],
      correctOptionIndex: 1, // 3(1) + 2(2) + 0.5(4) + 1(2) = 3 + 4 + 2 + 2 = 11%
      explanation:
        'Using logarithmic differentiation for fractional error accumulation:\n$$\\frac{\\Delta P}{P} = 3\\frac{\\Delta a}{a} + 2\\frac{\\Delta b}{b} + \\frac{1}{2}\\frac{\\Delta c}{c} + 1\\frac{\\Delta d}{d}$$\nSubstituting given percentage errors:\n$$\\text{Error} = 3(1\\%) + 2(2\\%) + \\frac{1}{2}(4\\%) + 1(2\\%) = 3\\% + 4\\% + 2\\% + 2\\% = 11\\%$$\nNotice that uncertainties in the denominator always add, never subtract.',
      formulaReference: '\\frac{\\Delta P}{P} = 3\\frac{\\Delta a}{a} + 2\\frac{\\Delta b}{b} + \\frac{1}{2}\\frac{\\Delta c}{c} + \\frac{\\Delta d}{d}',
      conceptReference: 'dim-analysis',
      difficulty: 'easy',
    },
    {
      id: 'quiz-phy-01-cp1-q2',
      checkpointId: 'PHY-01-CP1',
      type: 'single_correct',
      stem: 'The acceleration $a$ of a particle moving along the x-axis is given by $a = -2v$, where $v$ is its instantaneous velocity in m/s. If the particle had an initial velocity $v_0 = 10\\,\\text{m/s}$ at $x = 0$, what is the total distance traveled by the particle before coming momentarily to rest?',
      options: ['2.5 m', '5.0 m', '10.0 m', '20.0 m'],
      correctOptionIndex: 1, // v dv/dx = -2v => dv/dx = -2 => v - v0 = -2x => 0 - 10 = -2x => x = 5 m
      explanation:
        'Express acceleration in terms of position: $a = v\\frac{dv}{dx}$.\n$$v\\frac{dv}{dx} = -2v \\implies \\frac{dv}{dx} = -2 \\quad (\\text{for } v \\ne 0)$$\nIntegrating with respect to $x$:\n$$\\int_{v_0}^0 dv = -2 \\int_0^{x_{\\max}} dx \\implies 0 - 10 = -2 x_{\\max} \\implies x_{\\max} = 5.0\\,\\text{m}.$$',
      formulaReference: 'a = v \\frac{dv}{dx}',
      conceptReference: 'rectilinear-motion',
      difficulty: 'medium',
    },
    {
      id: 'quiz-phy-01-cp1-q3',
      checkpointId: 'PHY-01-CP1',
      type: 'numerical',
      stem: 'A car accelerates uniformly from rest for a time duration $t_1 = 10\\,\\text{s}$ at a rate $a_1 = 2\\,\\text{m/s}^2$, and then decelerates at a constant rate $a_2 = 4\\,\\text{m/s}^2$ until it comes to a complete stop. Calculate the total distance covered by the car in meters.',
      correctNumericalAnswer: 150,
      numericalTolerance: 0.5,
      explanation:
        'Phase 1: Acceleration from rest:\n- Maximum velocity: $v_{\\max} = a_1 t_1 = 2 \\times 10 = 20\\,\\text{m/s}$.\n- Distance $s_1 = \\frac{1}{2} a_1 t_1^2 = \\frac{1}{2}(2)(10)^2 = 100\\,\\text{m}$.\n\nPhase 2: Deceleration to rest from $v_{\\max} = 20\\,\\text{m/s}$ with $a_2 = 4\\,\\text{m/s}^2$:\n- $v^2 = u^2 - 2a_2 s_2 \\implies 0 = (20)^2 - 2(4) s_2 \\implies 8 s_2 = 400 \\implies s_2 = 50\\,\\text{m}$.\n\nTotal distance = $s_1 + s_2 = 100 + 50 = 150\\,\\text{m}$.',
      formulaReference: 'v^2 = u^2 + 2as',
      conceptReference: 'rectilinear-motion',
      difficulty: 'medium',
    },
  ],

  // =========================================================================
  // Physics Checkpoint 2: Vectors, 2D Projectile & Relative Motion
  // =========================================================================
  'PHY-01-CP2': [
    {
      id: 'quiz-phy-01-cp2-q1',
      checkpointId: 'PHY-01-CP2',
      type: 'single_correct',
      stem: 'A projectile is launched with an initial velocity $u$ at an angle $\\theta$ with the horizontal. At the highest point of its trajectory, what is its radius of curvature? (Take acceleration due to gravity as $g$)',
      options: ['u² / g', '(u² cos²θ) / g', '(u² sin²θ) / g', '(u² cos θ) / g'],
      correctOptionIndex: 1,
      explanation:
        'The radius of curvature is defined as $\\rho = \\frac{v^2}{a_\\perp}$, where $v$ is the speed and $a_\\perp$ is the normal acceleration perpendicular to velocity.\nAt the apex of the trajectory:\n- The velocity is purely horizontal: $v = u \\cos \\theta$.\n- Gravity $g$ acts purely vertically downward, which is directly perpendicular to velocity: $a_\\perp = g$.\n- Therefore, $\\rho = \\frac{(u \\cos \\theta)^2}{g} = \\frac{u^2 \\cos^2 \\theta}{g}$.',
      formulaReference: '\\rho = \\frac{v^2}{a_\\perp} = \\frac{u^2 \\cos^2 \\theta}{g}',
      conceptReference: 'projectile-motion',
      difficulty: 'medium',
    },
    {
      id: 'quiz-phy-01-cp2-q2',
      checkpointId: 'PHY-01-CP2',
      type: 'numerical',
      stem: 'A river of width $400\\,\\text{m}$ flows with a current speed of $3\\,\\text{m/s}$. A swimmer can swim with a speed of $5\\,\\text{m/s}$ in still water. If the swimmer crosses the river in the shortest possible time, calculate the drift (in meters) along the river bank.',
      correctNumericalAnswer: 240,
      numericalTolerance: 1.0,
      explanation:
        'To cross in shortest time, the swimmer must head directly perpendicular to the current (across the banks, $\\theta = 90^\\circ$):\n- Time to cross: $t_{\\min} = \\frac{d}{v_s} = \\frac{400\\,\\text{m}}{5\\,\\text{m/s}} = 80\\,\\text{s}$.\n- During this time, the river current carries the swimmer downstream:\n- Drift: $x = v_r \\times t_{\\min} = 3\\,\\text{m/s} \\times 80\\,\\text{s} = 240\\,\\text{m}$.',
      formulaReference: 't_{\\min} = \\frac{d}{v_{b/r}}, \\quad x_{\\text{drift}} = v_r \\times t_{\\min}',
      conceptReference: 'relative-motion',
      difficulty: 'medium',
    },
    {
      id: 'quiz-phy-01-cp2-q3',
      checkpointId: 'PHY-01-CP2',
      type: 'single_correct',
      stem: 'The trajectory equation of a projectile fired from ground level is given by $y = \\sqrt{3}x - 2x^2$ where $x$ and $y$ are in meters. What is the horizontal range of the projectile?',
      options: ['(√3 / 4) m', '(√3 / 2) m', '√3 m', '2√3 m'],
      correctOptionIndex: 1, // y = x (√3 - 2x) = 0 => x = √3 / 2
      explanation:
        'The ground impact occurs when $y = 0$ for $x > 0$:\n$$y = \\sqrt{3}x - 2x^2 = x(\\sqrt{3} - 2x) = 0$$\nFor $x \\ne 0$:\n$$\\sqrt{3} - 2x = 0 \\implies x = \\frac{\\sqrt{3}}{2}\\,\\text{m}.$$\nHence, the horizontal range is $R = \\frac{\\sqrt{3}}{2}\\,\\text{m}$.',
      formulaReference: 'y = x \\tan \\theta \\left(1 - \\frac{x}{R}\\right)',
      conceptReference: 'projectile-motion',
      difficulty: 'easy',
    },
  ],

  // =========================================================================
  // Chemistry Checkpoint 1: Mole Concept, Stoichiometry & Redox Basics
  // =========================================================================
  'CHE-01-CP1': [
    {
      id: 'quiz-che-01-cp1-q1',
      checkpointId: 'CHE-01-CP1',
      type: 'single_correct',
      stem: 'What is the molality of an aqueous solution containing $18\\,\\text{g}$ of glucose (molar mass = $180\\,\\text{g/mol}$) dissolved in $250\\,\\text{g}$ of water?',
      options: ['0.1 m', '0.2 m', '0.4 m', '0.8 m'],
      correctOptionIndex: 2, // n = 18/180 = 0.1 mol. Mass of water = 0.25 kg. m = 0.1 / 0.25 = 0.4 m
      explanation:
        'Calculate moles of solute (glucose):\n$$n = \\frac{\\text{mass}}{\\text{molar mass}} = \\frac{18\\,\\text{g}}{180\\,\\text{g/mol}} = 0.1\\,\\text{mol}.$$\nConvert mass of solvent (water) to kilograms:\n$$W_{\\text{water}} = 250\\,\\text{g} = 0.25\\,\\text{kg}.$$\nApply molality definition:\n$$m = \\frac{n_{\\text{solute}}}{W_{\\text{solvent}}(\\text{kg})} = \\frac{0.1\\,\\text{mol}}{0.25\\,\\text{kg}} = 0.4\\,\\text{mol/kg} = 0.4\\,\\text{m}.$$',
      formulaReference: 'm = \\frac{n_{\\text{solute}}}{W_{\\text{solvent}}(\\text{kg})}',
      conceptReference: 'limiting-reagent',
      difficulty: 'easy',
    },
    {
      id: 'quiz-che-01-cp1-q2',
      checkpointId: 'CHE-01-CP1',
      type: 'numerical',
      stem: 'When $3.0\\,\\text{g}$ of carbon is burned completely in $16.0\\,\\text{g}$ of oxygen gas to produce carbon dioxide (CO₂), what is the mass of carbon dioxide (in grams) formed? (Atomic masses: C = 12, O = 16)',
      correctNumericalAnswer: 11,
      numericalTolerance: 0.1,
      explanation:
        'Reaction: $\\text{C} + \\text{O}_2 \\to \\text{CO}_2$.\n- Moles of C = $\\frac{3.0}{12} = 0.25\\,\\text{mol}$.\n- Moles of O₂ = $\\frac{16.0}{32} = 0.50\\,\\text{mol}$.\n- Stoichiometric requirement is $1:1$. Since $0.25 < 0.50$, Carbon is the limiting reagent!\n- Moles of CO₂ formed = $0.25\\,\\text{mol}$.\n- Mass of CO₂ = $0.25\\,\\text{mol} \\times 44\\,\\text{g/mol} = 11.0\\,\\text{g}$.',
      formulaReference: 'n = \\frac{m}{M}, \\quad \\text{Mass} = n_{\\text{LR}} \\times M_{\\text{product}}',
      conceptReference: 'limiting-reagent',
      difficulty: 'medium',
    },
    {
      id: 'quiz-che-01-cp1-q3',
      checkpointId: 'CHE-01-CP1',
      type: 'single_correct',
      stem: 'In the acidic redox reaction: $\\text{MnO}_4^- + 5\\text{Fe}^{2+} + 8\\text{H}^+ \\to \\text{Mn}^{2+} + 5\\text{Fe}^{3+} + 4\\text{H}_2\\text{O}$, what is the equivalent weight of $\\text{KMnO}_4$ in terms of its molecular weight $M$?',
      options: ['M / 1', 'M / 3', 'M / 5', 'M / 6'],
      correctOptionIndex: 2, // Mn(+7) -> Mn(+2), n-factor = 5
      explanation:
        'The oxidation state of manganese in $\\text{MnO}_4^-$ is $+7$. In acidic medium, it is reduced to $\\text{Mn}^{2+}$ (oxidation state $+2$).\n$$\\text{Change in oxidation number per Mn atom} = 7 - 2 = 5.$$\nTherefore, the valence factor ($n$-factor) is $5$.\n$$\\text{Equivalent Weight} = \\frac{\\text{Molecular Weight}}{n\\text{-factor}} = \\frac{M}{5}.$$',
      formulaReference: 'E = \\frac{M}{n\\text{-factor}}',
      conceptReference: 'limiting-reagent',
      difficulty: 'easy',
    },
  ],

  // =========================================================================
  // Chemistry Checkpoint 2: Atomic Structure & Quantum Mechanical Model
  // =========================================================================
  'CHE-01-CP2': [
    {
      id: 'quiz-che-01-cp2-q1',
      checkpointId: 'CHE-01-CP2',
      type: 'single_correct',
      stem: 'Which electronic transition in a hydrogen atom emits a photon corresponding to the third line of the Balmer series?',
      options: ['n = 4 → n = 2', 'n = 5 → n = 2', 'n = 6 → n = 2', 'n = 3 → n = 1'],
      correctOptionIndex: 1, // Balmer series has n1 = 2. Lines: 1st (3->2), 2nd (4->2), 3rd (5->2)
      explanation:
        'In the hydrogen spectrum, the Balmer series terminates at $n_1 = 2$.\n- First line (H_α): $n_2 = 3 \\to n_1 = 2$\n- Second line (H_β): $n_2 = 4 \\to n_1 = 2$\n- Third line (H_γ): $n_2 = 5 \\to n_1 = 2$.\nTherefore, the third line corresponds to the transition from $n = 5$ to $n = 2$.',
      formulaReference: '\\frac{1}{\\lambda} = R_H \\left(\\frac{1}{2^2} - \\frac{1}{n_2^2}\\right)',
      conceptReference: 'bohr-model',
      difficulty: 'easy',
    },
    {
      id: 'quiz-che-01-cp2-q2',
      checkpointId: 'CHE-01-CP2',
      type: 'numerical',
      stem: 'The ratio of the radius of the second orbit of $\\text{He}^+$ ion to the radius of the first orbit of hydrogen atom is:',
      correctNumericalAnswer: 2,
      numericalTolerance: 0.05,
      explanation:
        'Bohr radius formula for hydrogen-like species:\n$$r_n = r_0 \\frac{n^2}{Z}$$\n- For first orbit of Hydrogen ($n = 1, Z = 1$): $r_{\\text{H}} = r_0 \\frac{1^2}{1} = r_0$.\n- For second orbit of $\\text{He}^+$ ($n = 2, Z = 2$): $r_{\\text{He}^+} = r_0 \\frac{2^2}{2} = 2 r_0$.\n- Ratio: $\\frac{r_{\\text{He}^+}}{r_{\\text{H}}} = \\frac{2 r_0}{r_0} = 2$.',
      formulaReference: 'r_n = r_0 \\frac{n^2}{Z}',
      conceptReference: 'bohr-model',
      difficulty: 'easy',
    },
    {
      id: 'quiz-che-01-cp2-q3',
      checkpointId: 'CHE-01-CP2',
      type: 'single_correct',
      stem: 'An electron is accelerated from rest through an electric potential difference of 100 V. According to the de Broglie hypothesis, what is the associated wavelength of the electron? (Use λ ≈ 12.27 / √V Å)',
      options: ['0.123 Å', '1.227 Å', '12.27 Å', '122.7 Å'],
      correctOptionIndex: 1, // 12.27 / sqrt(100) = 1.227 Å
      explanation:
        'For an electron accelerated through potential difference $V$:\n$$\\lambda = \\frac{h}{p} = \\frac{h}{\\sqrt{2mqV}} = \\frac{12.27}{\\sqrt{V}}\\,\\text{\\AA}.$$\nGiven $V = 100\\,\\text{V}$, $\\sqrt{V} = 10$.\n$$\\lambda = \\frac{12.27}{10} = 1.227\\,\\text{\\AA}.$$',
      formulaReference: '\\lambda = \\frac{12.27}{\\sqrt{V}}\\,\\text{\\AA}',
      conceptReference: 'bohr-model',
      difficulty: 'easy',
    },
  ],

  // =========================================================================
  // Mathematics Checkpoint 1: Sets, Relations & Real-Valued Functions
  // =========================================================================
  'MAT-01-CP1': [
    {
      id: 'quiz-mat-01-cp1-q1',
      checkpointId: 'MAT-01-CP1',
      type: 'single_correct',
      stem: 'Let $A = \\{1, 2, 3\\}$. A relation $R$ on $A$ is defined as $R = \\{(1, 1), (2, 2), (3, 3), (1, 2), (2, 1), (2, 3)\\}$. To make $R$ an equivalence relation on $A$, what is the minimum number of ordered pairs that must be added to $R$?',
      options: ['1', '2', '3', '4'],
      correctOptionIndex: 2, // (3,2) for symmetry. Then (1,3) and (3,1) for transitivity. Total 3 pairs.
      explanation:
        'Analyzing relation $R$:\n1. Reflexivity: $(1, 1), (2, 2), (3, 3) \\in R$ - already reflexive.\n2. Symmetry: $(2, 3) \\in R$ requires $(3, 2) \\in R$. Adding $(3, 2)$ (Pair 1).\n3. Transitivity: $(1, 2) \\in R$ and $(2, 3) \\in R$ implies $(1, 3)$ must be in $R$ (Pair 2).\n4. Symmetry on $(1, 3)$: requires $(3, 1) \\in R$ (Pair 3).\nWith $(3, 2), (1, 3), (3, 1)$ added, all pairs of $A \\times A$ are present, forming a complete equivalence relation.\nThus, exactly 3 pairs must be added.',
      formulaReference: '(a,b) \\in R \\land (b,c) \\in R \\implies (a,c) \\in R',
      conceptReference: 'function-mappings',
      difficulty: 'medium',
    },
    {
      id: 'quiz-mat-01-cp1-q2',
      checkpointId: 'MAT-01-CP1',
      type: 'single_correct',
      stem: 'The domain of the function $f(x) = \\sqrt{\\frac{x - 2}{x + 3}} + \\frac{1}{\\sqrt{9 - x^2}}$ is:',
      options: ['(-3, -2] ∪ [2, 3)', '[2, 3)', '(-3, 2]', '(-3, 3)'],
      correctOptionIndex: 1, // Part 1: (x-2)/(x+3) >= 0 => x in (-inf, -3) U [2, inf). Part 2: 9 - x^2 > 0 => x in (-3, 3). Intersection = [2, 3)
      explanation:
        'We enforce both conditions simultaneously:\n1. For $\\sqrt{\\frac{x - 2}{x + 3}}$:\n   $$\\frac{x - 2}{x + 3} \\ge 0 \\quad (x \\ne -3) \\implies x \\in (-\\infty, -3) \\cup [2, \\infty).$$\n2. For $\\frac{1}{\\sqrt{9 - x^2}}$:\n   $$9 - x^2 > 0 \\implies x^2 < 9 \\implies x \\in (-3, 3).$$\n3. Taking intersection of both sets:\n   $$((-\\infty, -3) \\cup [2, \\infty)) \\cap (-3, 3) = [2, 3).$$\nHence, the domain is $[2, 3)$.',
      formulaReference: '\\text{dom}(f + g) = \\text{dom}(f) \\cap \\text{dom}(g)',
      conceptReference: 'function-mappings',
      difficulty: 'medium',
    },
    {
      id: 'quiz-mat-01-cp1-q3',
      checkpointId: 'MAT-01-CP1',
      type: 'numerical',
      stem: 'If a finite set $S$ contains $4$ elements, how many non-empty relations can be defined on $S$ that are both reflexive and symmetric?',
      correctNumericalAnswer: 64,
      numericalTolerance: 0.1,
      explanation:
        'Let $|S| = n = 4$.\n- A relation $R$ on $S$ is a subset of $S \\times S$ (which contains $n^2 = 16$ pairs).\n- For reflexivity: All $n = 4$ diagonal pairs $(x, x)$ must be included (1 choice for each).\n- For symmetry: For the remaining $\\frac{n^2 - n}{2} = \\frac{16 - 4}{2} = 6$ off-diagonal unordered pairs $\\{a, b\\}$, we can either include both $(a, b)$ and $(b, a)$ or exclude both (2 choices for each pair).\n- Total number of reflexive & symmetric relations = $2^{\\frac{n(n-1)}{2}} = 2^6 = 64$.\nAll 64 relations are non-empty because they contain the 4 diagonal pairs.',
      formulaReference: 'N = 2^{\\frac{n(n-1)}{2}}',
      conceptReference: 'function-mappings',
      difficulty: 'hard',
    },
  ],

  // =========================================================================
  // Mathematics Checkpoint 2: Quadratic Equations & Polynomial Roots
  // =========================================================================
  'MAT-01-CP2': [
    {
      id: 'quiz-mat-01-cp2-q1',
      checkpointId: 'MAT-01-CP2',
      type: 'single_correct',
      stem: 'If the roots of the quadratic equation $x^2 - 2kx + (k^2 + k - 5) = 0$ are real and both are less than $5$, then the set of all possible real values of $k$ is:',
      options: ['k ≤ 5', 'k ∈ (-∞, 4)', 'k ∈ (-∞, 5]', 'k ∈ [2, 5)'],
      correctOptionIndex: 1, // Delta >= 0 => 4k^2 - 4(k^2 + k - 5) >= 0 => -4k + 20 >= 0 => k <= 5. Vertex: -b/2a = k < 5. f(5) > 0 => 25 - 10k + k^2 + k - 5 > 0 => k^2 - 9k + 20 > 0 => (k-4)(k-5) > 0 => k < 4 or k > 5. Intersect with k <= 5 and k < 5 => k < 4.
      explanation:
        'For $f(x) = x^2 - 2kx + (k^2 + k - 5) = 0$ with $a = 1 > 0$:\n1. Discriminant condition: $\\Delta \\ge 0$\n   $$\\Delta = 4k^2 - 4(k^2 + k - 5) = -4k + 20 \\ge 0 \\implies k \\le 5.$$\n2. Vertex condition: $-\\frac{b}{2a} < 5$\n   $$\\frac{2k}{2} = k < 5.$$\n3. Boundary value condition: $a \\cdot f(5) > 0$\n   $$f(5) = 5^2 - 2k(5) + (k^2 + k - 5) = 25 - 10k + k^2 + k - 5 = k^2 - 9k + 20 > 0$$\n   Factorizing: $(k - 4)(k - 5) > 0 \\implies k < 4 \\text{ or } k > 5$.\n4. Taking intersection of (1), (2), and (3):\n   $$k \\le 5 \\;\\cap\\; k < 5 \\;\\cap\\; (k < 4 \\cup k > 5) \\implies k < 4.$$\nThus, $k \\in (-\\infty, 4)$.',
      formulaReference: '\\Delta \\ge 0, \\quad -\\frac{b}{2a} < k, \\quad a \\cdot f(k) > 0',
      conceptReference: 'location-of-roots',
      difficulty: 'hard',
    },
    {
      id: 'quiz-mat-01-cp2-q2',
      checkpointId: 'MAT-01-CP2',
      type: 'numerical',
      stem: 'If the quadratic equations $x^2 + px + q = 0$ and $x^2 + qx + p = 0$ ($p \\ne q$) have a common root, calculate the numerical value of $(p + q)$.',
      correctNumericalAnswer: -1,
      numericalTolerance: 0.1,
      explanation:
        'Let $\\alpha$ be the common root:\n1. $\\alpha^2 + p\\alpha + q = 0$\n2. $\\alpha^2 + q\\alpha + p = 0$\nSubtracting (2) from (1):\n$$(p - q)\\alpha + (q - p) = 0 \\implies (p - q)(\\alpha - 1) = 0$$\nSince $p \\ne q$, we must have $\\alpha - 1 = 0 \\implies \\alpha = 1$.\nSubstitute $\\alpha = 1$ back into the first equation:\n$$1^2 + p(1) + q = 0 \\implies 1 + p + q = 0 \\implies p + q = -1.$$',
      formulaReference: '\\alpha = 1 \\implies p + q = -1',
      conceptReference: 'location-of-roots',
      difficulty: 'medium',
    },
    {
      id: 'quiz-mat-01-cp2-q3',
      checkpointId: 'MAT-01-CP2',
      type: 'single_correct',
      stem: 'If $\\alpha$ and $\\beta$ are the roots of the quadratic equation $x^2 - 6x + 2 = 0$, calculate the value of $\\frac{\\alpha}{\\beta} + \\frac{\\beta}{\\alpha}$.',
      options: ['14', '16', '18', '20'],
      correctOptionIndex: 1, // (alpha^2 + beta^2)/(alpha*beta) = ((alpha+beta)^2 - 2alpha*beta)/(alpha*beta) = (36 - 4)/2 = 16
      explanation:
        'By Vieta formulas for $x^2 - 6x + 2 = 0$:\n$$\\alpha + \\beta = -\\frac{-6}{1} = 6, \\quad \\alpha\\beta = \\frac{2}{1} = 2.$$\nRewriting the required symmetric expression:\n$$\\frac{\\alpha}{\\beta} + \\frac{\\beta}{\\alpha} = \\frac{\\alpha^2 + \\beta^2}{\\alpha\\beta} = \\frac{(\\alpha + \\beta)^2 - 2\\alpha\\beta}{\\alpha\\beta}$$\nSubstitute values:\n$$\\frac{6^2 - 2(2)}{2} = \\frac{36 - 4}{2} = \\frac{32}{2} = 16.$$',
      formulaReference: '\\frac{\\alpha}{\\beta} + \\frac{\\beta}{\\alpha} = \\frac{(\\alpha+\\beta)^2 - 2\\alpha\\beta}{\\alpha\\beta}',
      conceptReference: 'location-of-roots',
      difficulty: 'medium',
    },
  ],
};

export function getCheckpointQuizQuestions(checkpointId: string): CheckpointQuizQuestion[] {
  if (CHECKPOINT_QUIZ_BANK[checkpointId]) {
    return CHECKPOINT_QUIZ_BANK[checkpointId];
  }

  // Fallback high-yield conceptual quiz for any checkpoint in the catalogue
  const cp = getCheckpointById(checkpointId);
  const title = cp?.title || checkpointId;
  const topicNames = (cp?.topicIds || []).map((t) => t.split('.').pop()?.replace(/-/g, ' '));
  const primaryTopic = topicNames[0] || 'core theory';

  return [
    {
      id: `quiz-${checkpointId}-auto-1`,
      checkpointId,
      type: 'single_correct',
      stem: `In the study of ${title}, which of the following statements represents a fundamental principle governing ${primaryTopic}?`,
      options: [
        `The conservation and equilibrium conditions hold strictly under standard ideal constraints in ${primaryTopic}.`,
        'Physical parameters are unconstrained and vary arbitrarily without reference to boundary conditions.',
        'The equations are independent of coordinate orientation and units.',
        'Differential changes in the governing state variables have zero first-order impact.',
      ],
      correctOptionIndex: 0,
      explanation:
        `Under fundamental laws of ${cp?.subject || 'physics'}, governing principles enforce conservation laws, continuity, and thermodynamic/mechanical equilibrium under standard ideal boundary conditions.`,
      formulaReference: `\\text{Law of } ${primaryTopic}`,
      conceptReference: `${checkpointId}-core-concepts`,
      difficulty: 'medium',
    },
    {
      id: `quiz-${checkpointId}-auto-2`,
      checkpointId,
      type: 'single_correct',
      stem: `When analyzing boundary conditions in ${title}, a student encounters an edge condition where the primary variable approaches infinity. What is the correct physical/mathematical interpretation?`,
      options: [
        'The model requires asymptotic limit evaluation to establish stable physical bounds.',
        'The system ceases to satisfy dimensional homogeneity.',
        'The equations can be solved by simply setting all parameters to zero.',
        'The relationship is purely imaginary and has no physical meaning.',
      ],
      correctOptionIndex: 0,
      explanation:
        'In asymptotic analysis, boundary conditions are evaluated using limits to determine steady-state or extreme behavior.',
      formulaReference: '\\lim_{x \\to \\infty} f(x)',
      conceptReference: `${checkpointId}-core-concepts`,
      difficulty: 'easy',
    },
  ];
}

export function gradeQuizSubmission(
  checkpointId: string,
  answers: Record<string, { selectedOption?: number; numericalInput?: string }>
): import('../../types/checkpointQuiz.types').QuizGradingResult {
  const questions = getCheckpointQuizQuestions(checkpointId);
  let correctCount = 0;
  let incorrectCount = 0;
  let unansweredCount = 0;
  let rawMarks = 0;
  const outcomes: Record<string, import('../../types/checkpointQuiz.types').QuizQuestionOutcome> = {};

  for (const q of questions) {
    const studentAns = answers[q.id];
    let isCorrect = false;
    let studentAnsString = 'Unanswered';
    let correctAnsString = '';

    if (q.type === 'single_correct') {
      const selected = studentAns?.selectedOption;
      correctAnsString = q.options?.[q.correctOptionIndex ?? 0] ?? `Option ${String.fromCharCode(65 + (q.correctOptionIndex ?? 0))}`;

      if (selected === undefined || selected === -1) {
        unansweredCount += 1;
      } else {
        studentAnsString = q.options?.[selected] ?? `Option ${String.fromCharCode(65 + selected)}`;
        if (selected === q.correctOptionIndex) {
          isCorrect = true;
          correctCount += 1;
          rawMarks += 4;
        } else {
          incorrectCount += 1;
          rawMarks -= 1; // Negative marking in JEE Main single-choice
        }
      }
    } else if (q.type === 'numerical') {
      const numInput = studentAns?.numericalInput?.trim();
      correctAnsString = String(q.correctNumericalAnswer);

      if (!numInput) {
        unansweredCount += 1;
      } else {
        studentAnsString = numInput;
        const parsed = parseFloat(numInput);
        const tolerance = q.numericalTolerance ?? 0.05;
        if (!isNaN(parsed) && q.correctNumericalAnswer !== undefined && Math.abs(parsed - q.correctNumericalAnswer) <= tolerance) {
          isCorrect = true;
          correctCount += 1;
          rawMarks += 4;
        } else {
          incorrectCount += 1;
          // No negative marking for numerical questions in JEE Main
        }
      }
    }

    outcomes[q.id] = {
      questionId: q.id,
      type: q.type,
      isCorrect,
      studentAnswer: studentAnsString,
      correctAnswer: correctAnsString,
      explanation: q.explanation,
      formulaReference: q.formulaReference,
      conceptReference: q.conceptReference,
    };
  }

  const maxMarks = questions.length * 4;
  const scorePercentage = maxMarks > 0 ? Math.max(0, Math.round((Math.max(0, rawMarks) / maxMarks) * 100)) : 0;
  const passed = scorePercentage >= 60; // 60% mastery threshold

  return {
    checkpointId,
    totalQuestions: questions.length,
    correctCount,
    incorrectCount,
    unansweredCount,
    rawMarks,
    maxMarks,
    scorePercentage,
    passed,
    completedAt: new Date().toISOString(),
    outcomes,
  };
}
