import type { CheckpointTheoryModule } from '../../types/checkpointTheory.types';

export const CHEMISTRY_THEORY_MODULES: Record<string, CheckpointTheoryModule> = {
  'CHE-01-CP1': {
    checkpointId: 'CHE-01-CP1',
    roadmapId: 'CHE-01',
    subject: 'chemistry',
    title: 'Mole Concept, Stoichiometry & Redox Basics',
    subtitle: 'Stoichiometric ratios, limiting reagents, solution concentrations, and oxidation states',
    estimatedMinutes: 45,
    learningObjectives: [
      'Perform stoichiometric mass-mole-volume calculations with chemical equations.',
      'Identify limiting reagents and calculate theoretical, actual, and percentage product yields.',
      'Interconvert concentration units: Molarity, Molality, Mole Fraction, Mass Percentage, and ppm.',
      'Determine empirical and molecular formulas from percentage elemental composition.',
      'Assign oxidation numbers and balance redox equations via ion-electron and oxidation number methods.',
    ],
    definitions: [
      {
        term: 'Mole (Avogadro Constant)',
        definition:
          'One mole is the exact amount of substance containing 6.02214076 × 10²³ elementary entities (atoms, molecules, ions, or electrons). One mole of an ideal gas at STP (1 bar, 273.15 K) occupies 22.71 L (or 22.4 L at 1 atm, 273.15 K).',
        context: 'The central bridge connecting microscopic atomic counts to macroscopic laboratory mass.',
      },
      {
        term: 'Limiting Reagent (LR)',
        definition:
          'The reactant that is completely consumed first in a chemical reaction. It dictates the theoretical maximum amount of product formed.',
        context: 'Identified by dividing the available moles of each reactant by its stoichiometric coefficient in the balanced equation: lowest value wins.',
      },
      {
        term: 'Molality (m)',
        definition:
          'The number of moles of solute dissolved per kilogram of solvent: m = n_solute / W_solvent(kg).',
        context: 'Independent of temperature, unlike Molarity which varies with thermal expansion/contraction of solution volume.',
      },
    ],
    concepts: [
      {
        id: 'limiting-reagent',
        title: 'Stoichiometry & Limiting Reagent Determination',
        explanation:
          'In chemical synthesis, reactants are rarely present in exact stoichiometric ratios. The limiting reactant governs the extent of reaction.\n\nSystematic Algorithm to Find Limiting Reagent:\n1. Write and balance the chemical equation: $aA + bB \\to cC + dD$.\n2. Calculate the moles available for each reactant: $n_A = \\frac{m_A}{M_A}$ and $n_B = \\frac{m_B}{M_B}$.\n3. Compute the stoichiometric ratio index: $\\chi_A = \\frac{n_A}{a}$ and $\\chi_B = \\frac{n_B}{b}$.\n4. The reactant with the smallest value of $\\frac{n}{\\text{coefficient}}$ is strictly the limiting reagent.\n5. All theoretical yields must be computed directly from the moles of the limiting reagent.',
        diagramSvg: `<svg viewBox="0 0 400 160" className="w-full h-auto">
          <rect x="10" y="10" width="380" height="140" rx="8" fill="var(--bg-surface-warm)" stroke="var(--border-paper)" />
          <text x="200" y="35" textAnchor="middle" fill="var(--text-ink)" fontWeight="bold" fontSize="13">Limiting Reagent Decision Matrix</text>
          <rect x="30" y="55" width="150" height="70" rx="6" fill="var(--bg-surface)" stroke="var(--border-paper-strong)" />
          <text x="105" y="80" textAnchor="middle" fill="var(--text-ink)" fontWeight="bold" fontSize="12">Calculate n_A / a</text>
          <text x="105" y="102" textAnchor="middle" fill="var(--text-ink-secondary)" fontSize="11">vs n_B / b</text>
          <path d="M 190 90 L 220 90" stroke="var(--accent-terracotta)" strokeWidth="2" markerEnd="url(#arrow)" />
          <rect x="230" y="55" width="140" height="70" rx="6" fill="var(--bg-surface)" stroke="var(--accent-terracotta)" strokeWidth="1.5" />
          <text x="300" y="80" textAnchor="middle" fill="var(--accent-terracotta)" fontWeight="bold" fontSize="12">Smaller Ratio</text>
          <text x="300" y="102" textAnchor="middle" fill="var(--text-ink)" fontSize="11">= Limiting Reagent</text>
        </svg>`,
        diagramCaption: 'Fig 1.1: Stoichiometric ratio comparison determines which reactant exhausts first.',
        keyFormulas: [
          {
            label: 'Mole Calculation',
            formula: 'n = \\frac{\\text{Mass (g)}}{\\text{Molar Mass (g/mol)}} = \\frac{N}{N_A} = \\frac{V_{\\text{STP}} (\\text{L})}{22.71\\,\\text{L}}',
            description: 'Core conversion between mass, particle count, and gaseous volume.',
          },
          {
            label: 'Molarity (M)',
            formula: 'M = \\frac{n_{\\text{solute}}}{V_{\\text{solution}}(\\text{L})} = \\frac{\\% (w/v) \\times 10}{\\text{Molar Mass}}',
            description: 'Moles of solute per liter of total solution volume (temperature dependent).',
          },
          {
            label: 'Molality (m)',
            formula: 'm = \\frac{n_{\\text{solute}}}{W_{\\text{solvent}}(\\text{kg})} = \\frac{1000 \\times M}{1000 d - M \\times M_{\\text{solute}}}',
            description: 'Molality to Molarity conversion where d is solution density in g/mL.',
          },
        ],
        derivations: [
          {
            title: 'Derivation of Relationship between Molality (m) and Mole Fraction (X_B)',
            startingPoint: 'Let X_B be the mole fraction of solute and X_A = (1 - X_B) be the mole fraction of solvent with molar mass M_A (g/mol)',
            steps: [
              {
                stepNumber: 1,
                text: 'By definition of molality: m = (moles of solute B) / (mass of solvent A in kg)',
                math: 'm = \\frac{n_B}{w_A / 1000} = \\frac{1000 \\times n_B}{n_A \\times M_A}',
              },
              {
                stepNumber: 2,
                text: 'Divide numerator and denominator by total moles (n_A + n_B):',
                math: 'm = \\frac{1000 \\times \\frac{n_B}{n_A + n_B}}{\\frac{n_A}{n_A + n_B} \\times M_A} = \\frac{1000 \\times X_B}{X_A \\times M_A}',
              },
              {
                stepNumber: 3,
                text: 'Substitute X_A = 1 - X_B:',
                math: 'm = \\frac{1000 \\times X_B}{(1 - X_B) \\times M_A}',
              },
            ],
            conclusion: 'For dilute aqueous solutions (M_A = 18 g/mol): m ≈ 55.55 × X_B.',
          },
        ],
        solvedExamples: [
          {
            id: 'ex-che-01-cp1-1',
            title: 'Limiting Reagent in Ammonia Haber Synthesis',
            difficulty: 'medium',
            problemStatement:
              'In the Haber process, 50.0 kg of N₂(g) and 10.0 kg of H₂(g) are mixed to produce NH₃(g). Identify the limiting reagent and calculate the theoretical mass of NH₃ produced.',
            approach:
              'Balance equation: N₂ + 3H₂ -> 2NH₃. Convert masses to moles, compute stoichiometric ratios, and determine NH₃ yield.',
            solutionSteps: [
              'Balanced reaction: N₂(g) + 3 H₂(g) → 2 NH₃(g)',
              'Moles of N₂: 50,000 g / 28.02 g/mol = 1,784.4 mol',
              'Moles of H₂: 10,000 g / 2.016 g/mol = 4,960.3 mol',
              'Ratio for N₂: 1,784.4 / 1 = 1,784.4',
              'Ratio for H₂: 4,960.3 / 3 = 1,653.4',
              'Since 1,653.4 < 1,784.4, H₂ is the limiting reagent!',
              'Moles of NH₃ formed: (2/3) × moles of H₂ = (2/3) × 4,960.3 = 3,306.9 mol',
              'Mass of NH₃: 3,306.9 mol × 17.03 g/mol = 56,316 g ≈ 56.3 kg',
            ],
            finalAnswer: 'H₂ is the limiting reagent; theoretical yield of NH₃ is 56.3 kg.',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Using total solution mass instead of solvent mass in the denominator of molality.',
            correction: 'Molality denominator is strictly solvent mass: m = n_solute / kg of solvent.',
            why: 'Solution mass includes solute mass; using it yields an artificially lower molality value.',
          },
          {
            mistake: 'Assuming the reactant with fewer grams is always the limiting reagent.',
            correction: 'Always convert grams to moles and divide by stoichiometric coefficients before comparing.',
            why: 'A lighter reactant can possess far more moles if its molar mass is low (e.g. H₂ vs O₂).',
          },
        ],
      },
    ],
    keyTakeaways: [
      '1 mole contains 6.022 × 10²³ particles; 1 mol ideal gas occupies 22.71 L at STP.',
      'Limiting reagent is determined by the minimum value of (available moles / stoichiometric coefficient).',
      'Molality is independent of temperature, whereas Molarity varies with temperature.',
      'In redox reactions, oxidation is increase in oxidation number (electron loss); reduction is decrease (electron gain).',
      'Mole fraction relation: m = (1000 · X_B) / ((1 - X_B) · M_A).',
    ],
  },

  'CHE-01-CP2': {
    checkpointId: 'CHE-01-CP2',
    roadmapId: 'CHE-01',
    subject: 'chemistry',
    title: 'Atomic Structure & Quantum Mechanical Model',
    subtitle: 'Bohr orbits, de Broglie duality, Heisenberg uncertainty, and quantum number configurations',
    estimatedMinutes: 50,
    learningObjectives: [
      'Apply Bohr quantization postulates to compute radii, velocities, and energy levels for hydrogen-like species.',
      'Calculate spectral transition wavelengths using the Rydberg formula for Lyman, Balmer, Paschen, and Pfund series.',
      'Explain wave-particle duality and compute de Broglie wavelengths of particles and macroscopic objects.',
      'Solve Heisenberg uncertainty relation problems: Δx · Δp ≥ h / (4π).',
      'Assign quantum numbers (n, l, m_l, m_s) and apply Aufbau, Pauli, and Hund rules for electronic configurations.',
    ],
    definitions: [
      {
        term: 'Bohr Angular Momentum Quantization',
        definition:
          'Electrons in hydrogen-like atoms revolve only in stable non-radiating orbits where orbital angular momentum is an integral multiple of h / (2π): mvr = nℏ = n(h / 2π).',
        context: 'Explains atomic stability and discrete line spectra of hydrogen and hydrogenic ions (He⁺, Li²⁺, Be³⁺).',
      },
      {
        term: 'de Broglie Matter Wave',
        definition:
          'Any moving entity with linear momentum p possesses an associated wave of wavelength λ = h / p = h / (mv) = h / √(2mK).',
        context: 'Forms the foundational physical basis for electron diffraction and wave mechanics.',
      },
      {
        term: 'Heisenberg Uncertainty Principle',
        definition:
          'It is physically impossible to simultaneously measure both the exact position and linear momentum of an subatomic particle: Δx · Δp_x ≥ h / (4π) = ℏ/2.',
        context: 'Disproves deterministic planetary orbits for electrons and necessitates probabilistic 3D orbitals.',
      },
    ],
    concepts: [
      {
        id: 'bohr-model',
        title: 'Bohr Hydrogenic Model & Rydberg Spectral Transitions',
        explanation:
          'For a single-electron species of nuclear charge Z (H, He⁺, Li²⁺), Bohr balanced Coulomb attraction with centripetal force while enforcing quantized angular momentum:\n1. Orbital Radius: $r_n = 0.529\\,\\text{Å} \\times \\frac{n^2}{Z}$\n2. Orbital Speed: $v_n = 2.18 \\times 10^6\\,\\text{m/s} \\times \\frac{Z}{n}$\n3. Total Orbital Energy: $E_n = -13.6\\,\\text{eV} \\times \\frac{Z^2}{n^2}$\n\nWhen an electron drops from higher orbit $n_2$ to lower orbit $n_1$, a photon of energy $\\Delta E = h\\nu = hc/\\lambda$ is emitted. The wavenumber $\\bar{\\nu} = 1/\\lambda$ is given by the Rydberg equation:\n$$\\bar{\\nu} = \\frac{1}{\\lambda} = R_H Z^2 \\left(\\frac{1}{n_1^2} - \\frac{1}{n_2^2}\\right)$$\nwhere $R_H \\approx 109,677\\,\\text{cm}^{-1} \\approx 1.097 \\times 10^7\\,\\text{m}^{-1}$.\n- Lyman Series ($n_1 = 1$): Ultraviolet region\n- Balmer Series ($n_1 = 2$): Visible region (only series visible to human eye in hydrogen)\n- Paschen Series ($n_1 = 3$): Infrared region',
        keyFormulas: [
          {
            label: 'Hydrogenic Energy Levels',
            formula: 'E_n = -13.6 \\frac{Z^2}{n^2}\\,\\text{eV} = -2.18 \\times 10^{-18} \\frac{Z^2}{n^2}\\,\\text{J}',
            description: 'Negative sign signifies bound potential well relative to free ionized state at infinity.',
          },
          {
            label: 'Rydberg Formula',
            formula: '\\frac{1}{\\lambda} = R_H Z^2 \\left(\\frac{1}{n_1^2} - \\frac{1}{n_2^2}\\right)',
            description: 'Wavenumber of emitted radiation during electronic transition from n₂ to n₁.',
          },
          {
            label: 'de Broglie Wavelength',
            formula: '\\lambda = \\frac{h}{p} = \\frac{h}{mv} = \\frac{h}{\\sqrt{2 m q V}}',
            description: 'For an electron accelerated through potential difference V volts: λ = 12.27 / √V Å.',
          },
        ],
        commonMistakes: [
          {
            mistake: 'Applying the Bohr model to multi-electron atoms like neutral Helium or Carbon.',
            correction: 'Bohr model is strictly valid ONLY for 1-electron species: H, He⁺, Li²⁺, Be³⁺.',
            why: 'It neglects electron-electron Coulomb repulsion and shielding/penetration effects.',
          },
          {
            mistake: 'Claiming the Balmer series of He⁺ lies entirely in the visible range.',
            correction: 'Because of Z² = 4 in the Rydberg formula, He⁺ Balmer lines shift into the ultraviolet.',
            why: 'Only hydrogen Balmer transitions fall directly within the 400–700 nm optical band.',
          },
        ],
      },
    ],
    keyTakeaways: [
      'Bohr model radius scales as n²/Z; velocity scales as Z/n; energy scales as -Z²/n².',
      'Rydberg equation computes spectral line wavelengths: 1/λ = R_H Z² (1/n₁² - 1/n₂²).',
      'Only the Balmer series of hydrogen produces visible spectral lines.',
      'de Broglie wavelength: λ = h / p; for an electron accelerated across V volts, λ = 12.27 / √V Å.',
      'Quantum numbers: n (shell), l (shape: 0 to n-1), m_l (orientation: -l to +l), m_s (spin: ±1/2).',
    ],
  },
};
