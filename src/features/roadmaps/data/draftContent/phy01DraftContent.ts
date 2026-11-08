import type { ValidatedPracticeQuestion } from '../../types/contentSchema.types';

/**
 * Draft original practice questions for Pilot Roadmap PHY-01: Mechanics & Measurement.
 *
 * Strict Authenticity Policy:
 * 1. These questions are author-generated drafts staged in this isolated draft pipeline.
 * 2. They carry `verificationStatus: 'pending_review'`.
 * 3. They are NEVER labeled as official PYQs or verified questions until human review is signed off.
 */
export const PHY01_DRAFT_PRACTICE_QUESTIONS: readonly ValidatedPracticeQuestion[] = Object.freeze([
  // =========================================================================
  // PHY-01-CP1: Units, Measurement & 1D Kinematics
  // =========================================================================
  {
    id: 'draft-phy-01-cp1-p1',
    tier: 'foundation',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 1,
    chapterId: 'physics.units-measurements',
    topicId: 'physics.units-measurements.dimensional-analysis',
    topicLabel: 'Dimensional Analysis & Homogeneity',
    stem: 'The frequency of vibration $f$ of a stretched string depends upon its length $L$, tension $T$, and linear mass density $\\mu$ (mass per unit length). Using dimensional analysis, the relation between these quantities is:',
    options: [
      'f \\propto \\frac{1}{L}\\sqrt{\\frac{T}{\\mu}}',
      'f \\propto L\\sqrt{\\frac{T}{\\mu}}',
      'f \\propto \\frac{1}{L}\\sqrt{\\frac{\\mu}{T}}',
      'f \\propto \\frac{1}{L^2}\\frac{T}{\\mu}',
    ],
    correctOptionIndex: 0,
    hint: 'Dimensions: $[f] = [T^{-1}]$, $[L] = [L]$, $[T] = [M L T^{-2}]$, $[\\mu] = [M L^{-1}]$. Set up $f = k L^a T^b \\mu^c$ and equate powers of M, L, and T.',
    explanation:
      'Equating dimensions: $[T^{-1}] = [L]^a [M L T^{-2}]^b [M L^{-1}]^c = [M]^{b+c} [L]^{a+b-c} [T]^{-2b}$. From powers: $b+c = 0 \\implies c = -b$; $-2b = -1 \\implies b = 1/2, c = -1/2$; $a+b-c = 0 \\implies a + 1/2 - (-1/2) = 0 \\implies a = -1$. Hence $f \\propto \\frac{1}{L}\\sqrt{\\frac{T}{\\mu}}$.',
    errorClassification: 'formula_recall',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
        reviewNotes: 'Standard textbook dimensional derivation problem formatted for JEE foundation mastery.',
      },
    },
  },
  {
    id: 'draft-phy-01-cp1-p2',
    tier: 'application',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 1,
    chapterId: 'physics.units-measurements',
    topicId: 'physics.units-measurements.measurement-errors',
    topicLabel: 'Measurement Errors & Propagation',
    stem: 'In an experiment to measure acceleration due to gravity $g$ using a simple pendulum, $T = 2\\pi \\sqrt{L/g}$. The measured length $L = 100.0\\,\\text{cm}$ with an accuracy of $1\\,\\text{mm}$, and time for $100$ oscillations is measured as $90.0\\,\\text{s}$ using a stopwatch of $0.1\\,\\text{s}$ resolution. The percentage error in the calculated value of $g$ is closest to:',
    options: ['0.32%', '0.22%', '0.45%', '0.11%'],
    correctOptionIndex: 0,
    hint: 'Rewrite $g = 4\\pi^2 L / T^2$. The relative error is $\\frac{\\Delta g}{g} = \\frac{\\Delta L}{L} + 2\\frac{\\Delta t}{t}$.',
    explanation:
      'From $g = 4\\pi^2 L / T^2$, relative error is $\\Delta g / g = \\Delta L / L + 2(\\Delta t / t)$. $\\Delta L / L = 0.1\\,\\text{cm} / 100.0\\,\\text{cm} = 0.001 = 0.1\\%$. For 100 oscillations, total time $t = 90.0\\,\\text{s}$ with $\\Delta t = 0.1\\,\\text{s}$. Relative error in time is $2 \\times (0.1 / 90.0) = 2 \\times 0.00111 = 0.00222 = 0.222\\%$. Total percentage error $= 0.1\\% + 0.222\\% = 0.322\\% \\approx 0.32\\%$.',
    errorClassification: 'calculation',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp1-p3',
    tier: 'jee_main',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 2,
    chapterId: 'physics.kinematics',
    topicId: 'physics.kinematics.straight-line-motion',
    topicLabel: 'Rectilinear Motion & Non-uniform Acceleration',
    stem: 'A particle moves along the x-axis such that its acceleration is given by $a = -2v$, where $v$ is instantaneous velocity. At $t = 0$, position is $x = 0$ and velocity is $v = 10\\,\\text{m/s}$. The total distance travelled by the particle before coming to rest is:',
    options: ['5 m', '10 m', '2.5 m', '20 m'],
    correctOptionIndex: 0,
    hint: 'Use the chain rule relation for acceleration: $a = v\\frac{dv}{dx}$. Integrate with respect to $x$ from $v = 10$ to $v = 0$.',
    explanation:
      'Since $a = v\\frac{dv}{dx} = -2v$, dividing by $v$ gives $\\frac{dv}{dx} = -2 \\implies dv = -2\\,dx$. Integrating from $v = 10$ to $v = 0$ and $x = 0$ to $x_f$: $\\int_{10}^0 dv = -2\\int_0^{x_f} dx \\implies [0 - 10] = -2 x_f \\implies x_f = 5\\,\\text{m}$.',
    errorClassification: 'conceptual',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },

  // =========================================================================
  // PHY-01-CP2: 2D Motion, Projectiles & Newton's Laws of Motion
  // =========================================================================
  {
    id: 'draft-phy-01-cp2-p1',
    tier: 'foundation',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 2,
    chapterId: 'physics.kinematics',
    topicId: 'physics.kinematics.motion-in-a-plane',
    topicLabel: '2D Projectile Trajectory',
    stem: 'The equation of trajectory of a projectile is $y = \\sqrt{3}x - \\frac{g x^2}{2}$. The initial angle of projection with the horizontal is:',
    options: ['60°', '30°', '45°', '90°'],
    correctOptionIndex: 0,
    hint: 'Compare with the standard trajectory equation $y = x\\tan\\theta - \\frac{gx^2}{2u^2\\cos^2\\theta}$.',
    explanation:
      'Comparing $y = \\sqrt{3}x - \\frac{gx^2}{2}$ with $y = x\\tan\\theta - \\dots$ gives $\\tan\\theta = \\sqrt{3} \\implies \\theta = 60^\\circ$.',
    errorClassification: 'formula_recall',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp2-p2',
    tier: 'application',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 3,
    chapterId: 'physics.laws-of-motion',
    topicId: 'physics.laws-of-motion.friction',
    topicLabel: 'Friction on Inclines & Minimum Force',
    stem: 'A block of mass $m = 4\\,\\text{kg}$ is placed on a rough inclined plane of inclination $\\theta = 30^\\circ$. The coefficient of static friction is $\\mu_s = 0.8$. The minimum force $F$ applied parallel to the incline required to just push the block up the plane is ($g = 10\\,\\text{m/s}^2$, $\\cos 30^\\circ \\approx 0.866$):',
    options: ['47.7 N', '20.0 N', '27.7 N', '35.4 N'],
    correctOptionIndex: 0,
    hint: 'To push the block upwards, applied force must overcome both the downward gravity component $mg\\sin\\theta$ and the limiting friction opposing upward motion $f_s = \\mu_s mg\\cos\\theta$.',
    explanation:
      '$F_{\\min} = mg\\sin\\theta + \\mu_s mg\\cos\\theta = 4(10)(0.5) + 0.8(4)(10)(0.866) = 20 + 27.71 = 47.71\\,\\text{N}$.',
    errorClassification: 'conceptual',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp2-p3',
    tier: 'jee_main',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 3,
    chapterId: 'physics.laws-of-motion',
    topicId: 'physics.laws-of-motion.circular-motion-dynamics',
    topicLabel: 'Conical Pendulum & Tension Dynamics',
    stem: 'A bob of mass $m$ tied to a string of length $L$ revolves in a horizontal circle with constant angular velocity $\\omega$ such that the string makes an angle $\\theta$ with the vertical. The tension in the string is:',
    options: ['m \\omega^2 L', 'm g / \\cos\\theta', 'm g', 'm \\omega^2 L \\sin\\theta'],
    correctOptionIndex: 1,
    hint: 'Balance vertical forces: $T\\cos\\theta = mg$. The horizontal component $T\\sin\\theta = m\\omega^2 r = m\\omega^2 (L\\sin\\theta)$.',
    explanation:
      'Resolving vertically: $T\\cos\\theta = mg \\implies T = mg / \\cos\\theta$. Also horizontally $T\\sin\\theta = m\\omega^2 L\\sin\\theta \\implies T = m\\omega^2 L$. Both are equivalent when $\\cos\\theta = g / (\\omega^2 L)$, with $mg / \\cos\\theta$ directly representing vertical equilibrium.',
    errorClassification: 'reading_misinterpretation',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },

  // =========================================================================
  // PHY-01-CP3: Work, Energy, Power & Collisions
  // =========================================================================
  {
    id: 'draft-phy-01-cp3-p1',
    tier: 'foundation',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 4,
    chapterId: 'physics.work-energy-power',
    topicId: 'physics.work-energy-power.work-energy-theorem',
    topicLabel: 'Work Done by Variable Spring Force',
    stem: 'A light spring of spring constant $k = 400\\,\\text{N/m}$ is initially stretched by $2\\,\\text{cm}$. The additional work required to stretch it further from $2\\,\\text{cm}$ to $5\\,\\text{cm}$ is:',
    options: ['0.42 J', '0.50 J', '0.24 J', '0.84 J'],
    correctOptionIndex: 0,
    hint: 'Work done by external force on a spring is $W = \\frac{1}{2}k(x_2^2 - x_1^2)$. Convert cm to meters ($x_1 = 0.02\\,\\text{m}$, $x_2 = 0.05\\,\\text{m}$).',
    explanation:
      '$W = \\frac{1}{2}(400)[(0.05)^2 - (0.02)^2] = 200[0.0025 - 0.0004] = 200(0.0021) = 0.42\\,\\text{J}$.',
    errorClassification: 'calculation',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp3-p2',
    tier: 'application',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 4,
    chapterId: 'physics.work-energy-power',
    topicId: 'physics.work-energy-power.collisions',
    topicLabel: 'Inelastic Collisions & Energy Dissipation',
    stem: 'A bullet of mass $m = 20\\,\\text{g}$ moving horizontally at $v = 300\\,\\text{m/s}$ embeds into a wooden block of mass $M = 980\\,\\text{g}$ resting on a frictionless table. The fractional loss of initial kinetic energy of the system during the collision is:',
    options: ['98%', '2%', '50%', '90%'],
    correctOptionIndex: 0,
    hint: 'Apply conservation of linear momentum to find common final velocity $V = \\frac{m}{m+M}v$. The fraction of kinetic energy retained is $\\frac{K_f}{K_i} = \\frac{m}{m+M}$. Loss is $1 - \\frac{m}{m+M} = \\frac{M}{m+M}$.',
    explanation:
      'Linear momentum conservation: $m v = (m + M)V \\implies V = \\frac{m}{m+M}v$. Initial kinetic energy $K_i = \\frac{1}{2}m v^2$. Final kinetic energy $K_f = \\frac{1}{2}(m+M)V^2 = \\frac{1}{2}\\frac{m^2}{m+M}v^2 = K_i \\frac{m}{m+M}$. Fractional energy lost $= 1 - \\frac{m}{m+M} = \\frac{M}{m+M} = \\frac{980}{20 + 980} = \\frac{980}{1000} = 98\\%$.',
    errorClassification: 'conceptual',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp3-p3',
    tier: 'jee_main',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 4,
    chapterId: 'physics.work-energy-power',
    topicId: 'physics.work-energy-power.vertical-circle',
    topicLabel: 'Vertical Circle String Tension Ratio',
    stem: 'A small stone tied to a string of length $R$ executes a vertical circular motion with the minimum required speed at the bottom to complete the circle. The ratio of tension in the string at the lowest point to that at the highest point is:',
    options: ['T_bottom = 6mg and T_top = 0 (infinite ratio)', '5 : 1', '6 : 1', '4 : 1'],
    correctOptionIndex: 0,
    hint: 'For critical velocity, $v_{\\text{top}} = \\sqrt{gR}$, which requires $T_{\\text{top}} = 0$. At bottom $v_{\\text{bottom}} = \\sqrt{5gR}$, giving $T_{\\text{bottom}} = \\frac{m(5gR)}{R} + mg = 6mg$.',
    explanation:
      'For completing a vertical loop on a light flexible string, critical speed at top is $v_{\\text{top}} = \\sqrt{gR}$, where centripetal force is provided solely by gravity, so $T_{\\text{top}} = 0$. By energy conservation, $v_{\\text{bottom}} = \\sqrt{5gR}$. At the bottom, $T_{\\text{bottom}} - mg = m v_{\\text{bottom}}^2 / R \\implies T_{\\text{bottom}} = mg + 5mg = 6mg$. Since $T_{\\text{top}} = 0$, $T_{\\text{bottom}} = 6mg$ with $T_{\\text{top}} = 0$.',
    errorClassification: 'reading_misinterpretation',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },

  // =========================================================================
  // PHY-01-CP4: Centre of Mass, Rotational Dynamics & Mechanics Synthesis
  // =========================================================================
  {
    id: 'draft-phy-01-cp4-p1',
    tier: 'foundation',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 5,
    chapterId: 'physics.rotational-motion',
    topicId: 'physics.rotational-motion.moment-of-inertia',
    topicLabel: 'Perpendicular & Parallel Axis Theorems',
    stem: 'The moment of inertia of a uniform circular disc of mass $M$ and radius $R$ about its diameter is:',
    options: ['\\frac{1}{4}MR^2', '\\frac{1}{2}MR^2', '\\frac{3}{2}MR^2', 'MR^2'],
    correctOptionIndex: 0,
    hint: 'About the central perpendicular axis $I_z = \\frac{1}{2}MR^2$. By the perpendicular axis theorem for flat planar objects, $I_z = I_x + I_y = 2I_{\\text{dia}}$.',
    explanation:
      'For a flat symmetric planar disc, $I_x = I_y = I_{\\text{dia}}$. By perpendicular axes theorem, $I_z = I_x + I_y = 2I_{\\text{dia}}$. Since $I_z = \\frac{1}{2}MR^2$, we obtain $I_{\\text{dia}} = \\frac{1}{4}MR^2$.',
    errorClassification: 'formula_recall',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp4-p2',
    tier: 'application',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 5,
    chapterId: 'physics.rotational-motion',
    topicId: 'physics.rotational-motion.torque-angular-momentum',
    topicLabel: 'Conservation of Angular Momentum on Rotating Platforms',
    stem: 'A horizontal turntable of moment of inertia $I_0 = 4.0\\,\\text{kg}\\cdot\\text{m}^2$ is rotating freely at angular velocity $\\omega_0 = 10\\,\\text{rad/s}$ about a vertical frictionless axis. A lump of soft clay of mass $m = 1.0\\,\\text{kg}$ is dropped vertically onto the rim of the turntable at radius $R = 1.0\\,\\text{m}$ and sticks to it. The new angular velocity of the turntable is:',
    options: ['8.0 rad/s', '5.0 rad/s', '10.0 rad/s', '6.0 rad/s'],
    correctOptionIndex: 0,
    hint: 'No external torque acts about the vertical axis. Conserve total angular momentum: $I_0 \\omega_0 = (I_0 + m R^2)\\omega$.',
    explanation:
      'Conservation of angular momentum: $L_i = L_f \\implies I_0 \\omega_0 = (I_0 + m R^2)\\omega$. Substituting: $4.0 \\times 10 = (4.0 + 1.0(1.0)^2)\\omega \\implies 40 = 5.0\\omega \\implies \\omega = 8.0\\,\\text{rad/s}$.',
    errorClassification: 'conceptual',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
  {
    id: 'draft-phy-01-cp4-p3',
    tier: 'jee_main',
    type: 'mcq',
    subject: 'physics',
    unitNumber: 5,
    chapterId: 'physics.rotational-motion',
    topicId: 'physics.rotational-motion.rigid-body-dynamics',
    topicLabel: 'Pure Rolling Kinetic Energy Fractions',
    stem: 'A solid uniform cylinder rolls down a rough inclined plane without slipping. The fraction of its total kinetic energy associated with rotational motion about its centre of mass is:',
    options: ['1/3', '2/3', '1/2', '1/4'],
    correctOptionIndex: 0,
    hint: 'Total kinetic energy $K_{\\text{total}} = K_{\\text{trans}} + K_{\\text{rot}} = \\frac{1}{2}M v^2 + \\frac{1}{2}I\\omega^2$. Use $I = \\frac{1}{2}MR^2$ and $v = \\omega R$.',
    explanation:
      'Translational KE $K_{\\text{trans}} = \\frac{1}{2}M v^2$. Rotational KE $K_{\\text{rot}} = \\frac{1}{2}I\\omega^2 = \\frac{1}{2}(\\frac{1}{2}MR^2)(\\frac{v}{R})^2 = \\frac{1}{4}M v^2$. Total KE $K_{\\text{total}} = \\frac{1}{2}M v^2 + \\frac{1}{4}M v^2 = \\frac{3}{4}M v^2$. Fraction in rotation $= K_{\\text{rot}} / K_{\\text{total}} = (1/4) / (3/4) = 1/3$.',
    errorClassification: 'calculation',
    provenance: {
      sourceType: 'original_author',
      licenseOrRights: 'learnmate_original',
      verificationStatus: 'pending_review',
      reviewerMetadata: {
        authorId: 'learnmate-physics-team',
      },
    },
  },
]);
