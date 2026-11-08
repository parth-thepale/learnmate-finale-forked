import type { CheckpointTheoryModule } from '../../types/checkpointTheory.types';

export const MATHEMATICS_THEORY_MODULES: Record<string, CheckpointTheoryModule> = {
  'MAT-01-CP1': {
    checkpointId: 'MAT-01-CP1',
    roadmapId: 'MAT-01',
    subject: 'mathematics',
    title: 'Sets, Relations & Real-Valued Functions',
    subtitle: 'Equivalence relations, injective/surjective mappings, composite functions, and domain/range analysis',
    estimatedMinutes: 50,
    learningObjectives: [
      'Classify binary relations as reflexive, symmetric, transitive, and equivalence relations.',
      'Test for injectivity (one-one) and surjectivity (onto) algebraically and via horizontal line test.',
      'Determine precise domains and ranges of algebraic, rational, radical, and transcendental functions.',
      'Form composite functions g(f(x)) and compute their constrained domain of definition.',
      'Find inverse functions f⁻¹(x) and analyze graphical symmetry about the identity line y = x.',
    ],
    definitions: [
      {
        term: 'Equivalence Relation',
        definition:
          'A relation R on set A that is simultaneously: (1) Reflexive: (a, a) ∈ R for all a ∈ A; (2) Symmetric: (a, b) ∈ R implies (b, a) ∈ R; (3) Transitive: (a, b) ∈ R and (b, c) ∈ R implies (a, c) ∈ R.',
        context: 'Partitions set A into disjoint equivalence classes whose union equals A.',
      },
      {
        term: 'Bijective Mapping',
        definition:
          'A function f: A → B that is both injective (one-one: f(x₁) = f(x₂) => x₁ = x₂) and surjective (onto: Range(f) = Codomain B).',
        context: 'A function possesses a well-defined inverse function f⁻¹: B → A if and only if it is a bijection.',
      },
      {
        term: 'Domain of Definition',
        definition:
          'The maximal subset of real numbers ℝ for which the operational formula f(x) yields finite, real values. Requires: Denominator ≠ 0, Even Radical Radicand ≥ 0, Logarithm Argument > 0 and Base > 0, Base ≠ 1.',
        context: 'The starting step for all JEE calculus problems before evaluating limits, derivatives, or integrals.',
      },
    ],
    concepts: [
      {
        id: 'function-mappings',
        title: 'Injectivity, Surjectivity & Invertibility',
        explanation:
          'Consider a function $f: A \\to B$ where $A$ is domain and $B$ is codomain:\n\n1. Injective (One-One):\n   - Algebraic Test: Assume $f(x_1) = f(x_2)$. If this strictly forces $x_1 = x_2$, the function is injective.\n   - Calculus Test: If $f\'(x) > 0$ strictly (strictly increasing) or $f\'(x) < 0$ strictly (strictly decreasing) throughout its domain, $f$ is injective.\n   - Graphical Test: Any horizontal line $y = c$ intersects the curve at most once.\n\n2. Surjective (Onto):\n   - A function is surjective if every element of codomain $B$ has at least one pre-image in domain $A$.\n   - Enforceable Condition: $\\text{Range}(f) = \\text{Codomain}(B)$.\n\n3. Bijective & Invertible:\n   - $f$ is invertible $\\iff f$ is bijective.\n   - If $f(x)$ and $f^{-1}(x)$ intersect, their real intersections always lie on the line $y = x$ for non-decreasing functions.',
        diagramSvg: `<svg viewBox="0 0 400 160" className="w-full h-auto">
          <rect x="10" y="10" width="380" height="140" rx="8" fill="var(--bg-surface-warm)" stroke="var(--border-paper)" />
          <ellipse cx="90" cy="85" rx="50" ry="50" fill="var(--bg-surface)" stroke="var(--accent-terracotta)" strokeWidth="1.5" />
          <text x="90" y="30" textAnchor="middle" fill="var(--accent-terracotta)" fontWeight="bold" fontSize="12">Domain A</text>
          <ellipse cx="310" cy="85" rx="50" ry="50" fill="var(--bg-surface)" stroke="var(--border-paper-strong)" strokeWidth="1.5" />
          <text x="310" y="30" textAnchor="middle" fill="var(--text-ink)" fontWeight="bold" fontSize="12">Codomain B</text>
          <path d="M 120 70 L 275 70" stroke="var(--text-ink)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <text x="200" y="62" textAnchor="middle" fill="var(--text-ink-secondary)" fontSize="11">One-to-One</text>
          <path d="M 120 100 L 275 100" stroke="var(--text-ink)" strokeWidth="1.5" markerEnd="url(#arrow)" />
          <text x="200" y="122" textAnchor="middle" fill="var(--text-ink-secondary)" fontSize="11">Range = Codomain</text>
        </svg>`,
        diagramCaption: 'Fig 1.1: Bijective mapping establishes unique pairing between domain and codomain.',
        keyFormulas: [
          {
            label: 'Injectivity Algebraic Condition',
            formula: 'f(x_1) = f(x_2) \\implies x_1 = x_2',
            description: 'No two distinct domain elements map to the same image.',
          },
          {
            label: 'Surjectivity Condition',
            formula: '\\text{Range}(f) = \\text{Codomain}(f)',
            description: 'All codomain elements are covered by the range.',
          },
          {
            label: 'Number of Relations on Set of size n',
            formula: 'N_{\\text{relations}} = 2^{n^2}, \\quad N_{\\text{reflexive}} = 2^{n^2 - n}, \\quad N_{\\text{symmetric}} = 2^{\\frac{n(n+1)}{2}}',
            description: 'Standard combinatorics formulas for relation counting.',
          },
        ],
        derivations: [
          {
            title: 'Derivation of Invertibility Symmetry About y = x',
            startingPoint: 'Let y = f(x) be an invertible function with inverse x = f⁻¹(y)',
            steps: [
              {
                stepNumber: 1,
                text: 'If point (a, b) lies on the graph of y = f(x), then by definition b = f(a).',
              },
              {
                stepNumber: 2,
                text: 'Apply the inverse function f⁻¹ to both sides: f⁻¹(b) = f⁻¹(f(a)) = a.',
                math: 'f^{-1}(b) = a',
              },
              {
                stepNumber: 3,
                text: 'This demonstrates that point (b, a) lies on the graph of y = f⁻¹(x).',
              },
              {
                stepNumber: 4,
                text: 'The geometric transformation mapping (a, b) to (b, a) is an orthogonal reflection across the identity line y = x.',
              },
            ],
            conclusion: 'The curve of f⁻¹(x) is the mirror reflection of f(x) across y = x.',
          },
        ],
        solvedExamples: [
          {
            id: 'ex-mat-01-cp1-1',
            title: 'Domain of a Nested Radical-Logarithmic Function',
            difficulty: 'hard',
            problemStatement:
              'Find the domain of the real-valued function: f(x) = √[ log₁₀((5x - x²) / 4) ].',
            approach:
              'Enforce two constraints: (1) Inside the logarithm: (5x - x²)/4 > 0; (2) Inside the square root: log₁₀((5x - x²)/4) ≥ 0.',
            solutionSteps: [
              'Step 1: Argument of square root must be non-negative: log₁₀((5x - x²)/4) ≥ 0',
              'Since base is 10 > 1, the inequality direction is preserved: (5x - x²) / 4 ≥ 10⁰ = 1',
              'Multiply by 4: 5x - x² ≥ 4',
              'Rearrange into standard quadratic inequality: x² - 5x + 4 ≤ 0',
              'Factorize: (x - 1)(x - 4) ≤ 0',
              'The solution set of this quadratic inequality is x ∈ [1, 4].',
              'Step 2: Check logarithm argument constraint: for x ∈ [1, 4], (5x - x²)/4 ≥ 1 > 0, so it is automatically satisfied.',
            ],
            finalAnswer: 'The domain of f(x) is [1, 4].',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Assuming a function is onto without checking the explicitly specified codomain.',
            correction: 'Surjectivity depends strictly on codomain. f(x) = x² is onto for [0, ∞) but NOT onto for ℝ.',
            why: 'Onto requires every codomain member to have a pre-image; negative reals have no pre-image for x².',
          },
        ],
      },
    ],
    keyTakeaways: [
      'A relation is an equivalence relation if and only if it is reflexive, symmetric, and transitive.',
      'A function has an inverse if and only if it is both one-to-one (injective) and onto (surjective).',
      'For composite domain g(f(x)), both x ∈ dom(f) and f(x) ∈ dom(g) must be satisfied simultaneously.',
      'The graph of y = f⁻¹(x) is the reflection of y = f(x) across the identity line y = x.',
    ],
  },

  'MAT-01-CP2': {
    checkpointId: 'MAT-01-CP2',
    roadmapId: 'MAT-01',
    subject: 'mathematics',
    title: 'Quadratic Equations & Polynomial Roots',
    subtitle: 'Discriminant conditions, symmetric expressions of roots, common roots, and location of roots',
    estimatedMinutes: 50,
    learningObjectives: [
      'Formulate relations between roots and coefficients using Vieta formulas for quadratic and cubic equations.',
      'Analyze the nature of roots based on the discriminant Δ = b² - 4ac.',
      'Establish necessary and sufficient conditions for one common root and two common roots.',
      'Apply location of roots conditions with respect to real constants k, k₁, k₂.',
    ],
    definitions: [
      {
        term: 'Discriminant (Δ)',
        definition:
          'For a quadratic equation ax² + bx + c = 0 (a ≠ 0), Δ = b² - 4ac determines root nature: Δ > 0 (two distinct real roots), Δ = 0 (repeated real roots), Δ < 0 (complex conjugate roots).',
        context: 'If coefficients a, b, c are rational and Δ is a perfect square, the roots are rational.',
      },
      {
        term: 'Location of Roots Conditions',
        definition:
          'The set of sign conditions on discriminant Δ, vertex coordinate -b/(2a), and endpoint value a·f(k) that guarantee roots lie in specified intervals relative to real constant k.',
        context: 'High-frequency JEE Main topic for bounding parameters in quadratic constraints.',
      },
    ],
    concepts: [
      {
        id: 'location-of-roots',
        title: 'Location of Roots Analysis for ax² + bx + c = 0',
        explanation:
          'Let $f(x) = ax^2 + bx + c$ with $a > 0$ (if $a < 0$, multiply entire equation by $-1$).\n\nKey Cases:\n1. Both roots greater than a constant $k$ ($x_1, x_2 > k$):\n   - $\\Delta \\ge 0$ (roots are real)\n   - $-\\frac{b}{2a} > k$ (vertex lies to the right of $k$)\n   - $a \\cdot f(k) > 0$ ($k$ lies outside the root interval)\n\n2. Both roots lie between $k_1$ and $k_2$ ($k_1 < x_1 \\le x_2 < k_2$):\n   - $\\Delta \\ge 0$\n   - $k_1 < -\\frac{b}{2a} < k_2$\n   - $a \\cdot f(k_1) > 0$ and $a \\cdot f(k_2) > 0$\n\n3. Exactly one root lies in $(k_1, k_2)$:\n   - Condition: $f(k_1) \\cdot f(k_2) < 0$.',
        keyFormulas: [
          {
            label: 'Vieta Formulas (Quadratic)',
            formula: '\\alpha + \\beta = -\\frac{b}{a}, \\quad \\alpha \\beta = \\frac{c}{a}, \\quad |\\alpha - \\beta| = \\frac{\\sqrt{\\Delta}}{|a|}',
            description: 'Sum, product, and difference of roots.',
          },
          {
            label: 'Condition for One Common Root',
            formula: '(c_1 a_2 - c_2 a_1)^2 = (b_1 c_2 - b_2 c_1)(a_1 b_2 - a_2 b_1)',
            description: 'Between a₁x² + b₁x + c₁ = 0 and a₂x² + b₂x + c₂ = 0.',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Forgetting to check the vertex position -b/(2a) when locating roots.',
            correction: 'Checking only Δ ≥ 0 and a·f(k) > 0 is insufficient; both roots could still lie on the opposite side of k.',
            why: 'Vertex constraint locks the parabola horizontal position relative to k.',
          },
        ],
      },
    ],
    keyTakeaways: [
      'Vieta formulas connect roots directly to polynomial coefficients: α + β = -b/a, αβ = c/a.',
      'Discriminant Δ = b² - 4ac dictates root reality and rationality.',
      'Location of roots requires checking three criteria: Discriminant (Δ ≥ 0), Vertex (-b/2a vs k), and Value (a·f(k) > 0).',
    ],
  },
};
