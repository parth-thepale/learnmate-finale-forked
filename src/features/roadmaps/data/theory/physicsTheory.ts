import type { CheckpointTheoryModule } from '../../types/checkpointTheory.types';

export const PHYSICS_THEORY_MODULES: Record<string, CheckpointTheoryModule> = {
  'PHY-01-CP1': {
    checkpointId: 'PHY-01-CP1',
    roadmapId: 'PHY-01',
    subject: 'physics',
    title: 'Units, Measurement & 1D Kinematics',
    subtitle: 'Dimensional homogeneity, experimental error bounds, and calculus-based rectilinear motion',
    estimatedMinutes: 45,
    learningObjectives: [
      'Apply the principle of dimensional homogeneity to verify and derive physical equations.',
      'Propagate fractional and percentage uncertainties in single and multi-variable measurements.',
      'Analyze 1D motion using instantaneous derivatives: v = dx/dt and a = dv/dt = v(dv/dx).',
      'Interpret displacement-time, velocity-time, and acceleration-time graphs including curvature and slopes.',
      'Solve non-uniform acceleration problems using definite and indefinite integration.',
    ],
    definitions: [
      {
        term: 'Dimensional Homogeneity',
        definition:
          'The law stating that every additive term on both sides of a valid physical equation must possess identical dimensions. Transcendental arguments (arguments of exp, sin, cos, ln) must be strictly dimensionless [M⁰L⁰T⁰].',
        context: 'Used to check formula consistency and deduce power-law relationships via Buckingham-π method.',
      },
      {
        term: 'Least Count (LC)',
        definition:
          'The smallest value that can be directly measured using an instrument. For a Vernier calliper: LC = 1 MSD - 1 VSD = (1/n) MSD. For a screw gauge: LC = (Pitch) / (Number of circular scale divisions).',
        context: 'Limits the precision of experimental readings and sets the absolute instrumental error.',
      },
      {
        term: 'Instantaneous Acceleration',
        definition:
          'The second time-derivative of displacement: a = d²x/dt² = dv/dt. Expressed in spatial coordinates via chain rule as a = v(dv/dx).',
        context: 'Crucial for non-uniform acceleration when acceleration is provided as a function of position x or velocity v.',
      },
    ],
    concepts: [
      {
        id: 'dim-analysis',
        title: 'Dimensional Analysis & Fractional Error Propagation',
        explanation:
          'Dimensional analysis represents physical dimensions in terms of the fundamental base dimensions: Mass [M], Length [L], Time [T], Electric Current [A], Thermodynamic Temperature [K], Amount of Substance [mol], and Luminous Intensity [cd].\n\nWhen a measured quantity is calculated from a formula $Z = \\frac{A^p B^q}{C^r}$, the relative uncertainty is calculated by taking logarithmic differentials:\n$$\\ln Z = p\\ln A + q\\ln B - r\\ln C \\implies \\frac{\\Delta Z}{Z} = p\\frac{\\Delta A}{A} + q\\frac{\\Delta B}{B} + r\\frac{\\Delta C}{C}$$\nNotice that relative errors always add in worst-case bounds, never cancel or subtract, because uncertainties accumulate.',
        diagramSvg: `<svg viewBox="0 0 400 160" className="w-full h-auto">
          <rect x="10" y="10" width="380" height="140" rx="8" fill="var(--bg-surface-warm)" stroke="var(--border-paper)" />
          <text x="200" y="35" textAnchor="middle" fill="var(--text-ink)" fontWeight="bold" fontSize="13">Error Propagation in Multi-Variable Power Laws</text>
          <rect x="30" y="55" width="100" height="70" rx="6" fill="var(--bg-surface)" stroke="var(--accent-terracotta)" strokeWidth="1.5" />
          <text x="80" y="85" textAnchor="middle" fill="var(--accent-terracotta)" fontWeight="bold" fontSize="12">Z = A^p · B^q / C^r</text>
          <text x="80" y="105" textAnchor="middle" fill="var(--text-ink-secondary)" fontSize="10">Measured Inputs</text>
          <path d="M 135 90 L 165 90" stroke="var(--border-paper-strong)" strokeWidth="2" markerEnd="url(#arrow)" />
          <rect x="175" y="55" width="195" height="70" rx="6" fill="var(--bg-surface)" stroke="var(--border-paper-strong)" />
          <text x="272" y="85" textAnchor="middle" fill="var(--text-ink)" fontWeight="bold" fontSize="12">ΔZ/Z = p(ΔA/A) + q(ΔB/B) + r(ΔC/C)</text>
          <text x="272" y="105" textAnchor="middle" fill="var(--text-ink-muted)" fontSize="10">Signs are always positive (Worst Case)</text>
        </svg>`,
        diagramCaption: 'Fig 1.1: Logarithmic differentiation for worst-case fractional error accumulation.',
        keyFormulas: [
          {
            label: 'Worst-Case Fractional Error',
            formula: '\\frac{\\Delta Z}{Z} = p\\left(\\frac{\\Delta A}{A}\\right) + q\\left(\\frac{\\Delta B}{B}\\right) + r\\left(\\frac{\\Delta C}{C}\\right)',
            description: 'For power law Z = A^p B^q / C^r. Fractional errors are summed with positive coefficients.',
          },
          {
            label: 'Vernier Calliper Least Count',
            formula: '\\text{LC} = 1\\text{ MSD} - 1\\text{ VSD} = \\left(1 - \\frac{n-1}{n}\\right)\\text{MSD} = \\frac{1}{n}\\text{MSD}',
            description: 'Where n Vernier scale divisions coincide with (n - 1) main scale divisions.',
          },
          {
            label: 'Screw Gauge Least Count',
            formula: '\\text{LC} = \\frac{\\text{Pitch}}{\\text{Total Circular Scale Divisions}}',
            description: 'Pitch is the linear distance traversed along the main sleeve in one complete rotation.',
          },
        ],
        derivations: [
          {
            title: 'Derivation of Fractional Error in Kinetic Energy',
            startingPoint: 'Kinetic energy of a particle of mass m moving with speed v: K = \\frac{1}{2} m v^2',
            steps: [
              {
                stepNumber: 1,
                text: 'Take natural logarithm on both sides of the kinetic energy expression:',
                math: '\\ln K = \\ln(1/2) + \\ln m + 2\\ln v',
                note: 'The constant factor 1/2 has zero uncertainty: d(ln 1/2) = 0.',
              },
              {
                stepNumber: 2,
                text: 'Differentiate both sides with respect to each variable:',
                math: '\\frac{dK}{K} = 0 + \\frac{dm}{m} + 2\\frac{dv}{v}',
              },
              {
                stepNumber: 3,
                text: 'For finite experimental uncertainties, replace differentials with absolute error bounds, ensuring worst-case addition:',
                math: '\\frac{\\Delta K}{K} = \\frac{\\Delta m}{m} + 2\\frac{\\Delta v}{v}',
                note: 'Notice the velocity error contribution is doubled due to the exponent 2.',
              },
            ],
            conclusion: 'If mass has 2% error and velocity has 3% error, maximum percentage error in K is 2% + 2(3%) = 8%.',
          },
        ],
        solvedExamples: [
          {
            id: 'ex-phy-01-cp1-1',
            title: 'Error in Acceleration Due to Gravity Using a Simple Pendulum',
            difficulty: 'medium',
            problemStatement:
              'In an experiment to determine the value of g using a simple pendulum, the period of oscillation is measured with a stopwatch of 0.1 s least count for 20 oscillations. The length of the pendulum is measured as L = 100.0 cm using a meter rule of least count 1 mm. If the time for 20 oscillations is measured as 40.0 s, calculate the percentage error in the calculated value of g.',
            approach:
              'Express g in terms of measured quantities: T = 2π√(L/g) => g = 4π²L/T². Then apply logarithmic differentiation.',
            solutionSteps: [
              'Formula: g = 4π² L / T²',
              'Fractional error relation: Δg/g = ΔL/L + 2(ΔT/T)',
              'Given: L = 100.0 cm, ΔL = 0.1 cm => ΔL/L = 0.1 / 100.0 = 0.001 (0.1%)',
              'For time: T = t / N => ΔT/T = Δt/t = 0.1 s / 40.0 s = 0.0025 (0.25%)',
              'Combined error: Δg/g = 0.001 + 2(0.0025) = 0.001 + 0.005 = 0.006',
              'Percentage error: 0.006 × 100% = 0.6%',
            ],
            finalAnswer: 'The percentage error in g is 0.6%.',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Subtracting fractional errors when quantities appear in the denominator.',
            correction: 'Always add relative errors: Δ(A/B) / (A/B) = ΔA/A + ΔB/B.',
            why: 'Errors represent uncertain deviations from nominal value; in the worst-case scenario, variations combine constructively to maximize deviation.',
          },
          {
            mistake: 'Treating trigonometric arguments as having dimensions of angle or length.',
            correction: 'In functions like sin(kx - ωt), both kx and ωt must be strictly dimensionless [M⁰L⁰T⁰].',
            why: 'Trigonometric functions are infinite Taylor series: sin(θ) = θ - θ³/3! + ... Adding terms with physical dimensions would violate homogeneity.',
          },
        ],
      },
      {
        id: 'rectilinear-motion',
        title: 'Rectilinear Motion: Kinematic Integration & Graph Analysis',
        explanation:
          'In one-dimensional motion along the x-axis, kinematic equations (v = u + at, s = ut + ½at², v² = u² + 2as) are valid ONLY when acceleration a is constant in time.\n\nWhen acceleration varies with time a(t), position a(x), or velocity a(v), we must integrate using fundamental calculus:\n1. $a = \\frac{dv}{dt} \\implies \\int_{v_0}^v dv = \\int_{t_0}^t a(t)\\,dt$\n2. $a = v\\frac{dv}{dx} \\implies \\int_{v_0}^v v\\,dv = \\int_{x_0}^x a(x)\\,dx$\n\nGraphical Rules:\n- The slope of a position-time (x-t) curve represents instantaneous velocity v.\n- The slope of a velocity-time (v-t) curve represents instantaneous acceleration a.\n- The area under a velocity-time curve represents net displacement Δx.\n- The area under an acceleration-time curve represents change in velocity Δv.',
        diagramSvg: `<svg viewBox="0 0 420 180" className="w-full h-auto">
          <rect x="10" y="10" width="400" height="160" rx="8" fill="var(--bg-surface-warm)" stroke="var(--border-paper)" />
          <line x1="40" y1="140" x2="380" y2="140" stroke="var(--text-ink)" strokeWidth="1.5" />
          <line x1="50" y1="150" x2="50" y2="30" stroke="var(--text-ink)" strokeWidth="1.5" />
          <text x="390" y="145" fill="var(--text-ink-secondary)" fontSize="11">Time (t)</text>
          <text x="35" y="25" fill="var(--text-ink-secondary)" fontSize="11">v(t)</text>
          <path d="M 50 110 Q 150 40 250 80 T 370 40" fill="none" stroke="var(--accent-terracotta)" strokeWidth="2.5" />
          <path d="M 120 140 L 120 73 Q 185 55 250 80 L 250 140 Z" fill="var(--accent-terracotta)" opacity="0.15" />
          <line x1="120" y1="140" x2="120" y2="73" stroke="var(--accent-terracotta)" strokeDasharray="3 3" />
          <line x1="250" y1="140" x2="250" y2="80" stroke="var(--accent-terracotta)" strokeDasharray="3 3" />
          <text x="185" y="115" textAnchor="middle" fill="var(--accent-terracotta)" fontWeight="bold" fontSize="12">Area = ∫ v dt = Δx</text>
          <text x="120" y="155" textAnchor="middle" fill="var(--text-ink-muted)" fontSize="10">t₁</text>
          <text x="250" y="155" textAnchor="middle" fill="var(--text-ink-muted)" fontSize="10">t₂</text>
        </svg>`,
        diagramCaption: 'Fig 1.2: Area under velocity-time graph equals net displacement between t₁ and t₂.',
        keyFormulas: [
          {
            label: 'Chain-Rule Acceleration',
            formula: 'a = v \\frac{dv}{dx} = \\frac{d}{dx}\\left(\\frac{1}{2}v^2\\right)',
            description: 'Used whenever acceleration is specified as a function of spatial displacement a(x).',
          },
          {
            label: 'Displacement in n-th Second',
            formula: 's_n = u + \\frac{a}{2}(2n - 1)',
            description: 'Distance covered specifically between t = (n - 1) and t = n under constant acceleration.',
          },
          {
            label: 'Velocity Change from a-t Area',
            formula: '\\Delta v = v(t_2) - v(t_1) = \\int_{t_1}^{t_2} a(t)\\,dt',
            description: 'Definite integral representing area under acceleration curve.',
          },
        ],
        derivations: [
          {
            title: 'Derivation of Kinematic Equation v² = u² + 2as Using Chain Rule',
            startingPoint: 'Instantaneous acceleration in differential form: a = v dv/dx',
            steps: [
              {
                stepNumber: 1,
                text: 'Separate variables with velocity v on the left and position x on the right:',
                math: 'v\\,dv = a\\,dx',
              },
              {
                stepNumber: 2,
                text: 'Assume constant acceleration a and integrate both sides from initial state (x = 0, v = u) to final state (x = s, v = v):',
                math: '\\int_u^v v\\,dv = a\\int_0^s dx',
              },
              {
                stepNumber: 3,
                text: 'Evaluate standard integrals on both sides:',
                math: '\\left[\\frac{v^2}{2}\\right]_u^v = a [x]_0^s \\implies \\frac{v^2 - u^2}{2} = as',
              },
              {
                stepNumber: 4,
                text: 'Multiply both sides by 2 and rearrange terms:',
                math: 'v^2 = u^2 + 2as',
              },
            ],
            conclusion: 'This confirms that v² = u² + 2as is the integrated consequence of Newton second law when force is spatially uniform.',
          },
        ],
        solvedExamples: [
          {
            id: 'ex-phy-01-cp1-2',
            title: 'Non-Uniform Position-Dependent Acceleration',
            difficulty: 'hard',
            problemStatement:
              'A particle starts from rest at x = 0. Its acceleration is governed by the relation a = 4x + 2, where x is in meters and a is in m/s². Determine the velocity of the particle when it reaches x = 2 m.',
            approach:
              'Since acceleration depends on position x rather than time t, use the relation a = v(dv/dx) and integrate variables.',
            solutionSteps: [
              'Write acceleration: v (dv/dx) = 4x + 2',
              'Separate variables: v dv = (4x + 2) dx',
              'Set limits: particle starts from rest (v = 0 at x = 0); we seek v at x = 2 m.',
              'Integrate: ∫₀^v v dv = ∫₀² (4x + 2) dx',
              'LHS: [v² / 2]₀^v = v² / 2',
              'RHS: [2x² + 2x]₀² = 2(2)² + 2(2) = 8 + 4 = 12',
              'Equating: v² / 2 = 12 => v² = 24 => v = √24 = 2√6 ≈ 4.90 m/s',
            ],
            finalAnswer: 'The velocity at x = 2 m is 2√6 m/s (≈ 4.90 m/s).',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Applying v = u + at when acceleration varies with position a(x) or time a(t).',
            correction: 'Always verify whether acceleration is constant before applying standard kinematic equations. If variable, use integration.',
            why: 'Kinematic formulas are derived assuming constant a; integrating a variable acceleration changes the functional dependence.',
          },
        ],
      },
    ],
    keyTakeaways: [
      'Dimensions must match across additive terms: [LHS] = [RHS]. Transcendental arguments are always dimensionless.',
      'Relative/percentage errors always add in worst-case analysis: for Z = A^p B^q / C^r, ΔZ/Z = p(ΔA/A) + q(ΔB/B) + r(ΔC/C).',
      'The least count of an instrument represents its inherent measurement uncertainty.',
      'Kinematic equations require constant acceleration; when a = f(x), apply v dv/dx = a and integrate.',
      'The area under a v-t graph equals displacement; the slope of an x-t graph equals instantaneous velocity.',
    ],
  },

  'PHY-01-CP2': {
    checkpointId: 'PHY-01-CP2',
    roadmapId: 'PHY-01',
    subject: 'physics',
    title: 'Vectors, 2D Projectile & Relative Motion',
    subtitle: 'Vector algebra, parabolic projectile trajectories, and 1D/2D relative reference frames',
    estimatedMinutes: 50,
    learningObjectives: [
      'Resolve vectors into rectangular components and compute dot and cross products.',
      'Decompose 2D projectile motion into independent horizontal and vertical 1D motions.',
      'Calculate time of flight, maximum height, horizontal range, and trajectory equation.',
      'Analyze relative motion in 2D including river-boat crossing and rain-umbrella orientation.',
    ],
    definitions: [
      {
        term: 'Orthogonal Vector Resolution',
        definition:
          'Expressing a vector A in Cartesian coordinates as A = A_x i + A_y j + A_z k, where A_x = |A| cos θ and A_y = |A| sin θ.',
        context: 'Permits decomposing complex 2D planar dynamics into two independent 1D orthogonal kinematic problems.',
      },
      {
        term: 'Trajectory Equation',
        definition:
          'The spatial curve y(x) followed by a projectile in a vertical plane under uniform downward gravitational acceleration g.',
        context: 'Expressed as y = x tan θ - (g x²) / (2 u² cos² θ) = x tan θ (1 - x / R), which is quadratic in x (a parabola).',
      },
      {
        term: 'Relative Velocity Vector',
        definition:
          'The velocity of object A as observed from the reference frame of moving object B: v_AB = v_A - v_B.',
        context: 'Used in collision avoidance, minimum distance calculations, and river-swimmer navigation.',
      },
    ],
    concepts: [
      {
        id: 'projectile-motion',
        title: '2D Projectile Kinematics on Horizontal Ground',
        explanation:
          'A projectile launched with speed u at an angle θ with the horizontal experiences zero horizontal acceleration (a_x = 0) and constant downward vertical acceleration (a_y = -g).\n\nBecause horizontal and vertical motions are strictly perpendicular, they proceed completely independently of each other:\n- Horizontal Velocity: $u_x = u \\cos \\theta$ (constant throughout flight)\n- Vertical Velocity: $v_y(t) = u \\sin \\theta - g t$\n- Time of Flight: Reached when vertical displacement returns to zero: $T = \\frac{2 u \\sin \\theta}{g}$\n- Maximum Height: Reached when instantaneous vertical velocity $v_y = 0$: $H = \\frac{u^2 \\sin^2 \\theta}{2g}$\n- Horizontal Range: $R = u_x \\times T = \\frac{u^2 \\sin 2\\theta}{g}$\n\nNotice that the range is symmetric about 45°: complementary launch angles $\\theta$ and $90^\\circ - \\theta$ yield identical horizontal ranges for the same launch speed.',
        diagramSvg: `<svg viewBox="0 0 420 180" className="w-full h-auto">
          <rect x="10" y="10" width="400" height="160" rx="8" fill="var(--bg-surface-warm)" stroke="var(--border-paper)" />
          <line x1="40" y1="150" x2="380" y2="150" stroke="var(--text-ink)" strokeWidth="1.5" />
          <path d="M 50 150 Q 210 20 370 150" fill="none" stroke="var(--accent-terracotta)" strokeWidth="2.5" />
          <line x1="210" y1="150" x2="210" y2="52" stroke="var(--border-paper-strong)" strokeDasharray="3 3" />
          <text x="210" y="42" textAnchor="middle" fill="var(--accent-terracotta)" fontWeight="bold" fontSize="11">H_max = u² sin²θ / 2g</text>
          <line x1="50" y1="162" x2="370" y2="162" stroke="var(--text-ink-muted)" strokeWidth="1" markerEnd="url(#arrow)" />
          <text x="210" y="174" textAnchor="middle" fill="var(--text-ink)" fontSize="11">Horizontal Range R = u² sin(2θ) / g</text>
          <line x1="50" y1="150" x2="100" y2="105" stroke="#16a34a" strokeWidth="2" markerEnd="url(#arrow)" />
          <text x="80" y="95" fill="#16a34a" fontWeight="bold" fontSize="11">u (launch)</text>
        </svg>`,
        diagramCaption: 'Fig 2.1: Parabolic trajectory showing independent orthogonal velocity decomposition.',
        keyFormulas: [
          {
            label: 'Time of Flight',
            formula: 'T = \\frac{2 u \\sin \\theta}{g}',
            description: 'Total duration before projectile impacts ground level.',
          },
          {
            label: 'Maximum Height',
            formula: 'H_{\\text{max}} = \\frac{u^2 \\sin^2 \\theta}{2g}',
            description: 'Peak altitude where vertical velocity vanishes.',
          },
          {
            label: 'Horizontal Range in terms of R',
            formula: 'y = x \\tan \\theta \\left(1 - \\frac{x}{R}\\right)',
            description: 'Extremely high-yield JEE trajectory form when Range R is given.',
          },
        ],
        derivations: [
          {
            title: 'Derivation of Trajectory Equation in Terms of Range R',
            startingPoint: 'Parametric equations: x = u cos θ · t and y = u sin θ · t - ½ g t²',
            steps: [
              {
                stepNumber: 1,
                text: 'Solve for time t from horizontal position: t = x / (u cos θ)',
              },
              {
                stepNumber: 2,
                text: 'Substitute t into vertical position equation:',
                math: 'y = u \\sin \\theta \\left(\\frac{x}{u \\cos \\theta}\\right) - \\frac{1}{2} g \\left(\\frac{x}{u \\cos \\theta}\\right)^2 = x \\tan \\theta - \\frac{g x^2}{2 u^2 \\cos^2 \\theta}',
              },
              {
                stepNumber: 3,
                text: 'Recall that horizontal range R = (2 u² sin θ cos θ) / g. Factor out x tan θ:',
                math: 'y = x \\tan \\theta \\left[1 - \\frac{g x}{2 u^2 \\sin \\theta \\cos \\theta}\\right] = x \\tan \\theta \\left(1 - \\frac{x}{R}\\right)',
              },
            ],
            conclusion: 'This compact formula y = x tan θ (1 - x / R) simplifies trajectory questions where a coordinate (x, y) and range R are specified.',
          },
        ],
        solvedExamples: [
          {
            id: 'ex-phy-01-cp2-1',
            title: 'Projectile Passing Through a Given Point',
            difficulty: 'medium',
            problemStatement:
              'A ball is projected from the ground such that it clears a wall of height 10 m located at a horizontal distance of 20 m from the point of projection, and strikes the ground 60 m beyond the wall. Find the angle of projection θ.',
            approach:
              'The total horizontal range is the sum of distances: R = 20 m + 60 m = 80 m. Use y = x tan θ (1 - x/R) with point (20, 10).',
            solutionSteps: [
              'Identify coordinates: x = 20 m, y = 10 m',
              'Total range: R = 20 + 60 = 80 m',
              'Apply trajectory formula: y = x tan θ (1 - x / R)',
              'Substitute values: 10 = 20 tan θ (1 - 20 / 80)',
              '10 = 20 tan θ (1 - 1/4) = 20 tan θ (3/4) = 15 tan θ',
              'tan θ = 10 / 15 = 2/3 => θ = arctan(2/3)',
            ],
            finalAnswer: 'The angle of projection is θ = arctan(2/3).',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Assuming speed at the highest point of projectile flight is zero.',
            correction: 'Only the vertical velocity v_y is zero at the peak. The horizontal velocity u_x = u cos θ remains unchanged.',
            why: 'Gravitational force acts solely downward, leaving horizontal momentum conserved.',
          },
        ],
      },
      {
        id: 'relative-motion',
        title: 'Relative Velocity in 2D & River-Swimmer Dynamics',
        explanation:
          'When observing the velocity of particle A from particle B, we compute vector difference: $\\vec{v}_{A/B} = \\vec{v}_A - \\vec{v}_B$.\n\nIn river-boat crossing problems:\n- Let $\\vec{v}_r$ be river flow velocity along the x-axis.\n- Let $\\vec{v}_{b/r}$ be velocity of the boat with respect to still water.\n- The resultant velocity of the boat relative to the bank is $\\vec{v}_b = \\vec{v}_{b/r} + \\vec{v}_r$.\n\nKey Cases:\n1. Shortest Time Crossing: Direct steering straight across (perpendicular to river bank, $\\theta = 90^\\circ$). Time $t_{\\min} = \\frac{d}{v_{b/r}}$. Drift along bank occurs: $x_{\\text{drift}} = v_r \\times t_{\\min}$.\n2. Shortest Path (Zero Drift): Requires resultant velocity $\\vec{v}_b$ to be perpendicular to banks. The boat must steer upstream at angle $\\sin \\alpha = \\frac{v_r}{v_{b/r}}$. Possible only if $v_{b/r} > v_r$.',
        keyFormulas: [
          {
            label: 'Relative Velocity',
            formula: '\\vec{v}_{A/B} = \\vec{v}_A - \\vec{v}_B',
            description: 'Velocity of A observed from the reference frame of B.',
          },
          {
            label: 'Minimum River Crossing Time',
            formula: 't_{\\min} = \\frac{d}{v_{b/r}}',
            description: 'Obtained by heading perpendicular to the river flow (θ = 90°).',
          },
          {
            label: 'Upstream Angle for Zero Drift',
            formula: '\\sin \\alpha = \\frac{v_r}{v_{b/r}} \\quad (v_{b/r} > v_r)',
            description: 'Angle α measured upstream from the perpendicular line across the river.',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Confusing velocity of boat in still water (v_{b/r}) with absolute velocity relative to ground (v_b).',
            correction: 'v_{b/r} is the velocity due to engine/rowing effort; v_b is the vector sum with river current.',
            why: 'Ground speed includes the advective transport velocity of the surrounding fluid medium.',
          },
        ],
      },
    ],
    keyTakeaways: [
      '2D projectile motion decomposes into independent horizontal (a_x = 0) and vertical (a_y = -g) components.',
      'Trajectory equation y = x tan θ (1 - x / R) provides direct relationship between coordinates and range.',
      'At maximum height, vertical velocity is zero, but horizontal speed remains u cos θ.',
      'Relative velocity formula v_AB = v_A - v_B simplifies multi-body pursuit and crossing problems.',
      'To cross a river in minimum time, steer perpendicular to the banks; to cross with zero drift, steer upstream.',
    ],
  },
};
