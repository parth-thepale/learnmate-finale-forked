/**
 * JEE (Main) 2026 Paper 1 (B.E./B.Tech.) syllabus: subjects → chapters (NTA units) → topics.
 *
 * Source: "Syllabus for JEE (Main) - 2026", National Testing Agency,
 * https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/10/202510311323551056.pdf
 * (retrieved 2026-11-03, sha256 7cad9da2a12065444828f744bd9f1a93a2dd0d9bd54c32a6d92d94a769e4f905).
 *
 * Chapters correspond 1:1 to NTA units. Topic groupings are Learnmate's own breakdown of each
 * unit's official text and are pending product-owner review.
 *
 * IDs are stable identifiers stored in user data (attempts, sessions, question bank). Never
 * rename or reuse an ID; add new IDs and deprecate old ones instead.
 */

export type JeeSubjectId = 'physics' | 'chemistry' | 'mathematics';
export type ChemistrySection = 'physical' | 'inorganic' | 'organic';

export interface SyllabusTopic {
  id: string;
  name: string;
}

export interface SyllabusChapter {
  id: string;
  subjectId: JeeSubjectId;
  unitNumber: number;
  name: string;
  section?: ChemistrySection;
  topics: SyllabusTopic[];
}

export interface SyllabusSubject {
  id: JeeSubjectId;
  name: string;
  chapters: SyllabusChapter[];
}

export const JEE_MAIN_SYLLABUS_META = Object.freeze({
  exam: 'JEE (Main) 2026 — Paper 1 (B.E./B.Tech.)',
  sourceTitle: 'Syllabus for JEE (Main) - 2026',
  sourceUrl:
    'https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/10/202510311323551056.pdf',
  sourceSha256: '7cad9da2a12065444828f744bd9f1a93a2dd0d9bd54c32a6d92d94a769e4f905',
  retrievedOn: '2026-11-03',
  topicGroupingReview: 'pending_owner_review' as const,
});

type TopicSpec = [slug: string, name: string];

function chapter(
  subjectId: JeeSubjectId,
  unitNumber: number,
  slug: string,
  name: string,
  topics: TopicSpec[],
  section?: ChemistrySection
): SyllabusChapter {
  const id = `${subjectId}.${slug}`;
  return {
    id,
    subjectId,
    unitNumber,
    name,
    ...(section ? { section } : {}),
    topics: topics.map(([topicSlug, topicName]) => ({ id: `${id}.${topicSlug}`, name: topicName })),
  };
}

const MATHEMATICS: SyllabusChapter[] = [
  chapter('mathematics', 1, 'sets-relations-functions', 'Sets, Relations and Functions', [
    ['sets', 'Sets, their representation and algebraic properties; power set'],
    ['relations', 'Relations, types of relations and equivalence relations'],
    ['functions', 'Functions: one-one, into and onto functions, composition of functions'],
  ]),
  chapter('mathematics', 2, 'complex-numbers-quadratic-equations', 'Complex Numbers and Quadratic Equations', [
    ['complex-number-representation', 'Complex numbers as ordered pairs, a + ib form and Argand diagram'],
    ['complex-number-algebra', 'Algebra of complex numbers, modulus and argument'],
    ['quadratic-equations', 'Quadratic equations in real and complex number systems and their solutions'],
    ['roots-and-coefficients', 'Relations between roots and coefficients, nature of roots, forming equations from roots'],
  ]),
  chapter('mathematics', 3, 'matrices-determinants', 'Matrices and Determinants', [
    ['matrix-algebra', 'Matrices, algebra and types of matrices'],
    ['determinants', 'Determinants of order two and three, evaluation, area of triangles'],
    ['adjoint-inverse', 'Adjoint and inverse of a square matrix'],
    ['linear-systems', 'Consistency and solution of simultaneous linear equations using matrices'],
  ]),
  chapter('mathematics', 4, 'permutations-combinations', 'Permutations and Combinations', [
    ['counting-principle', 'Fundamental principle of counting'],
    ['permutations-combinations', 'Permutations and combinations, P(n, r) and C(n, r), simple applications'],
  ]),
  chapter('mathematics', 5, 'binomial-theorem', 'Binomial Theorem and its Simple Applications', [
    ['binomial-expansion', 'Binomial theorem for a positive integral index'],
    ['general-middle-term', 'General term, middle term and simple applications'],
  ]),
  chapter('mathematics', 6, 'sequence-series', 'Sequence and Series', [
    ['arithmetic-progression', 'Arithmetic progressions and insertion of arithmetic means'],
    ['geometric-progression', 'Geometric progressions and insertion of geometric means'],
    ['am-gm', 'Relation between A.M. and G.M.'],
  ]),
  chapter('mathematics', 7, 'limit-continuity-differentiability', 'Limit, Continuity and Differentiability', [
    ['real-functions', 'Real-valued functions, algebra of functions, inverse functions and graphs of simple functions'],
    ['limits', 'Limits'],
    ['continuity-differentiability', 'Continuity and differentiability'],
    ['differentiation', 'Differentiation rules, composite and implicit functions, derivatives up to order two'],
    ['applications-of-derivatives', 'Applications of derivatives: rate of change, monotonicity, maxima and minima'],
  ]),
  chapter('mathematics', 8, 'integral-calculus', 'Integral Calculus', [
    ['indefinite-integrals', 'Integral as anti-derivative and fundamental integrals'],
    ['integration-methods', 'Integration by substitution, by parts, by partial fractions and using trigonometric identities'],
    ['definite-integrals', 'Fundamental theorem of calculus and properties of definite integrals'],
    ['area-under-curves', 'Areas of regions bounded by simple curves in standard forms'],
  ]),
  chapter('mathematics', 9, 'differential-equations', 'Differential Equations', [
    ['order-degree', 'Ordinary differential equations: order and degree'],
    ['separation-of-variables', 'Solution by separation of variables'],
    ['homogeneous-linear', 'Homogeneous and linear differential equations dy/dx + p(x)y = q(x)'],
  ]),
  chapter('mathematics', 10, 'coordinate-geometry', 'Co-ordinate Geometry', [
    ['cartesian-basics', 'Cartesian coordinates, distance and section formulae, locus'],
    ['straight-lines', 'Straight lines: slope, forms of equations, intersection, angles, concurrency, distance of a point'],
    ['triangle-centres', 'Centroid, orthocentre and circumcentre of a triangle'],
    ['circles', 'Circles: standard and general forms, diameter form, intersection with a line'],
    ['conic-sections', 'Conic sections: parabola, ellipse and hyperbola in standard forms'],
  ]),
  chapter('mathematics', 11, 'three-dimensional-geometry', 'Three Dimensional Geometry', [
    ['points-in-space', 'Coordinates of a point in space, distance and section formulae'],
    ['direction-ratios-cosines', 'Direction ratios, direction cosines and angle between intersecting lines'],
    ['lines-in-space', 'Equation of a line, skew lines and the shortest distance between them'],
  ]),
  chapter('mathematics', 12, 'vector-algebra', 'Vector Algebra', [
    ['vector-basics', 'Vectors and scalars, addition and components in two and three dimensions'],
    ['vector-products', 'Scalar and vector products'],
  ]),
  chapter('mathematics', 13, 'statistics-probability', 'Statistics and Probability', [
    ['measures-of-dispersion', 'Mean, median, mode, standard deviation, variance and mean deviation'],
    ['probability-basics', 'Probability of an event, addition and multiplication theorems'],
    ['bayes-theorem', "Bayes' theorem"],
    ['random-variables', 'Probability distribution of a random variable'],
  ]),
  chapter('mathematics', 14, 'trigonometry', 'Trigonometry', [
    ['identities-functions', 'Trigonometrical identities and functions'],
    ['inverse-trigonometric-functions', 'Inverse trigonometrical functions and their properties'],
  ]),
];

const PHYSICS: SyllabusChapter[] = [
  chapter('physics', 1, 'units-measurements', 'Units and Measurements', [
    ['units-si', 'Units, system of units, SI, fundamental and derived units'],
    ['measurement-errors', 'Least count, significant figures and errors in measurements'],
    ['dimensional-analysis', 'Dimensions of physical quantities and dimensional analysis'],
  ]),
  chapter('physics', 2, 'kinematics', 'Kinematics', [
    ['straight-line-motion', 'Frame of reference and motion in a straight line'],
    ['uniformly-accelerated-motion', 'Uniformly accelerated motion, position-time and velocity-time graphs'],
    ['relative-velocity', 'Relative velocity'],
    ['motion-in-a-plane', 'Motion in a plane and projectile motion'],
    ['uniform-circular-motion', 'Uniform circular motion'],
  ]),
  chapter('physics', 3, 'laws-of-motion', 'Laws of Motion', [
    ['newtons-laws', "Newton's laws of motion, momentum and impulse"],
    ['momentum-conservation', 'Conservation of linear momentum and equilibrium of concurrent forces'],
    ['friction', 'Static, kinetic and rolling friction'],
    ['circular-motion-dynamics', 'Dynamics of uniform circular motion, level and banked roads'],
  ]),
  chapter('physics', 4, 'work-energy-power', 'Work, Energy and Power', [
    ['work-energy-theorem', 'Work by constant and variable forces, kinetic and potential energy, work-energy theorem, power'],
    ['conservation-of-energy', 'Spring potential energy, conservation of mechanical energy, conservative forces'],
    ['vertical-circle', 'Motion in a vertical circle'],
    ['collisions', 'Elastic and inelastic collisions in one and two dimensions'],
  ]),
  chapter('physics', 5, 'rotational-motion', 'Rotational Motion', [
    ['centre-of-mass', 'Centre of mass of a two-particle system and of a rigid body'],
    ['torque-angular-momentum', 'Torque, angular momentum and its conservation'],
    ['moment-of-inertia', 'Moment of inertia, radius of gyration, parallel and perpendicular axes theorems'],
    ['rigid-body-dynamics', 'Equilibrium of rigid bodies, equations of rotational motion'],
  ]),
  chapter('physics', 6, 'gravitation', 'Gravitation', [
    ['law-of-gravitation', 'Universal law of gravitation and variation of g'],
    ['keplers-laws', "Kepler's laws of planetary motion"],
    ['gravitational-potential', 'Gravitational potential energy and potential'],
    ['satellites', 'Escape velocity, satellite motion, orbital velocity, period and energy'],
  ]),
  chapter('physics', 7, 'properties-solids-liquids', 'Properties of Solids and Liquids', [
    ['elasticity', "Elasticity, stress-strain, Hooke's law and elastic moduli"],
    ['fluid-pressure', "Pressure in fluids and Pascal's law"],
    ['viscosity-flow', "Viscosity, Stokes' law, terminal velocity, streamline and turbulent flow, Bernoulli's principle"],
    ['surface-tension', 'Surface energy, surface tension, angle of contact, drops, bubbles and capillary rise'],
    ['thermal-properties', 'Heat, temperature, thermal expansion, calorimetry and latent heat'],
    ['heat-transfer', 'Heat transfer: conduction, convection and radiation'],
  ]),
  chapter('physics', 8, 'thermodynamics', 'Thermodynamics', [
    ['zeroth-first-law', 'Thermal equilibrium, zeroth law, heat, work, internal energy and the first law'],
    ['thermodynamic-processes', 'Isothermal and adiabatic processes'],
    ['second-law', 'Second law of thermodynamics, reversible and irreversible processes'],
  ]),
  chapter('physics', 9, 'kinetic-theory-of-gases', 'Kinetic Theory of Gases', [
    ['ideal-gas', 'Equation of state of a perfect gas and work done on compressing a gas'],
    ['kinetic-theory', 'Kinetic theory assumptions, pressure, kinetic interpretation of temperature, RMS speed'],
    ['equipartition', 'Degrees of freedom, equipartition of energy and specific heats of gases'],
    ['mean-free-path', "Mean free path and Avogadro's number"],
  ]),
  chapter('physics', 10, 'oscillations-waves', 'Oscillations and Waves', [
    ['periodic-motion', 'Periodic motion, time period, frequency and displacement'],
    ['simple-harmonic-motion', 'Simple harmonic motion, spring oscillations, energy and the simple pendulum'],
    ['wave-motion', 'Longitudinal and transverse waves, wave speed and progressive waves'],
    ['superposition-standing-waves', 'Superposition, reflection, standing waves in strings and organ pipes, harmonics, beats'],
  ]),
  chapter('physics', 11, 'electrostatics', 'Electrostatics', [
    ['coulombs-law', "Electric charge, Coulomb's law and superposition"],
    ['electric-field-dipole', 'Electric field, field lines, electric dipole and torque on a dipole'],
    ['gauss-law', "Electric flux and Gauss's law applications"],
    ['electric-potential', 'Electric potential, equipotential surfaces and electrostatic potential energy'],
    ['capacitors-dielectrics', 'Conductors, dielectrics, capacitors and their combinations, energy stored'],
  ]),
  chapter('physics', 12, 'current-electricity', 'Current Electricity', [
    ['ohms-law-resistance', "Drift velocity, mobility, Ohm's law, resistivity and temperature dependence"],
    ['resistor-combinations-power', 'Series and parallel resistors, electrical energy and power'],
    ['cells-emf', 'Internal resistance, emf and combinations of cells'],
    ['kirchhoffs-laws', "Kirchhoff's laws, Wheatstone bridge and metre bridge"],
  ]),
  chapter('physics', 13, 'magnetic-effects-magnetism', 'Magnetic Effects of Current and Magnetism', [
    ['biot-savart-ampere', "Biot-Savart law and Ampere's law applications"],
    ['magnetic-force', 'Force on moving charges and current-carrying conductors, force between parallel currents'],
    ['galvanometer', 'Torque on a current loop, moving coil galvanometer and conversion to ammeter/voltmeter'],
    ['magnetism-matter', 'Magnetic dipoles, bar magnet, para-, dia- and ferromagnetic substances'],
  ]),
  chapter('physics', 14, 'electromagnetic-induction-ac', 'Electromagnetic Induction and Alternating Currents', [
    ['faraday-lenz', "Faraday's law, induced emf, Lenz's law and eddy currents"],
    ['inductance', 'Self and mutual inductance'],
    ['ac-circuits', 'Peak and RMS values, reactance, impedance, LCR circuits, resonance, power and wattless current'],
    ['generator-transformer', 'AC generator and transformer'],
  ]),
  chapter('physics', 15, 'electromagnetic-waves', 'Electromagnetic Waves', [
    ['displacement-current', 'Displacement current and characteristics of electromagnetic waves'],
    ['em-spectrum', 'Electromagnetic spectrum and applications'],
  ]),
  chapter('physics', 16, 'optics', 'Optics', [
    ['reflection-mirrors', 'Reflection of light and spherical mirrors'],
    ['refraction-lenses', 'Refraction, thin lens and lens maker formulae, total internal reflection, power and combinations'],
    ['prism', 'Refraction through a prism'],
    ['optical-instruments', 'Microscope and astronomical telescope'],
    ['wave-optics-interference', "Huygens' principle and interference (Young's double slit)"],
    ['diffraction-polarization', "Single-slit diffraction and polarization, Brewster's law"],
  ]),
  chapter('physics', 17, 'dual-nature', 'Dual Nature of Matter and Radiation', [
    ['photoelectric-effect', "Photoelectric effect and Einstein's equation"],
    ['matter-waves', 'Matter waves and the de Broglie relation'],
  ]),
  chapter('physics', 18, 'atoms-nuclei', 'Atoms and Nuclei', [
    ['atomic-models', "Alpha scattering, Rutherford and Bohr models, hydrogen spectrum"],
    ['nuclear-structure', 'Nucleus composition, mass defect and binding energy'],
    ['fission-fusion', 'Nuclear fission and fusion'],
  ]),
  chapter('physics', 19, 'electronic-devices', 'Electronic Devices', [
    ['semiconductor-diodes', 'Semiconductors, p-n junction diode and rectifiers'],
    ['special-diodes', 'LED, photodiode, solar cell and Zener diode as a voltage regulator'],
    ['logic-gates', 'Logic gates (OR, AND, NOT, NAND and NOR)'],
  ]),
  chapter('physics', 20, 'experimental-skills', 'Experimental Skills', [
    ['measuring-instruments', 'Vernier calipers, screw gauge and metre scale'],
    ['mechanics-properties-experiments', "Pendulum, Young's modulus, surface tension and viscosity experiments"],
    ['heat-sound-experiments', 'Speed of sound (resonance tube) and specific heat capacity'],
    ['electricity-experiments', "Metre bridge, Ohm's law and galvanometer experiments"],
    ['optics-experiments', 'Focal length, prism deviation and refractive index experiments'],
    ['semiconductor-experiments', 'Diode and Zener characteristics, identifying electronic components'],
  ]),
];

const CHEMISTRY: SyllabusChapter[] = [
  chapter('chemistry', 1, 'basic-concepts', 'Some Basic Concepts in Chemistry', [
    ['matter-atomic-theory', "Matter, Dalton's atomic theory and laws of chemical combination"],
    ['mole-concept', 'Atomic and molecular masses, mole concept and molar mass'],
    ['formulae-composition', 'Percentage composition, empirical and molecular formulae'],
    ['stoichiometry', 'Chemical equations and stoichiometry'],
  ], 'physical'),
  chapter('chemistry', 2, 'atomic-structure', 'Atomic Structure', [
    ['bohr-model', 'Electromagnetic radiation, hydrogen spectrum and the Bohr model'],
    ['dual-nature-uncertainty', 'Dual nature of matter, de Broglie relation and Heisenberg uncertainty principle'],
    ['quantum-mechanical-model', 'Quantum mechanical model, orbitals and quantum numbers'],
    ['electronic-configuration', "Aufbau, Pauli and Hund's rules and electronic configuration"],
  ], 'physical'),
  chapter('chemistry', 3, 'chemical-bonding', 'Chemical Bonding and Molecular Structure', [
    ['ionic-bonding', 'Ionic bonding and lattice enthalpy'],
    ['covalent-bonding-vsepr', "Electronegativity, Fajan's rule, dipole moment and VSEPR shapes"],
    ['valence-bond-hybridization', 'Valence bond theory, hybridization and resonance'],
    ['molecular-orbital-theory', 'Molecular orbital theory, bond order, bond length and bond energy'],
    ['metallic-hydrogen-bonding', 'Metallic bonding and hydrogen bonding'],
  ], 'physical'),
  chapter('chemistry', 4, 'chemical-thermodynamics', 'Chemical Thermodynamics', [
    ['thermodynamics-fundamentals', 'System, surroundings, state functions and types of processes'],
    ['first-law-enthalpy', "First law, enthalpy, heat capacity and Hess's law"],
    ['enthalpies-of-change', 'Enthalpies of bond dissociation, combustion, formation and other changes'],
    ['spontaneity-gibbs', 'Second law, spontaneity, entropy and Gibbs energy, ΔG° and equilibrium constant'],
  ], 'physical'),
  chapter('chemistry', 5, 'solutions', 'Solutions', [
    ['concentration-terms', 'Molality, molarity, mole fraction and percentage concentration'],
    ['raoults-law', "Vapour pressure, Raoult's law, ideal and non-ideal solutions"],
    ['colligative-properties', "Colligative properties, molar mass determination and van't Hoff factor"],
  ], 'physical'),
  chapter('chemistry', 6, 'equilibrium', 'Equilibrium', [
    ['physical-equilibrium', "Equilibria in physical processes and Henry's law"],
    ['chemical-equilibrium', "Law of chemical equilibrium, Kp and Kc, Le Chatelier's principle"],
    ['acids-bases-ph', 'Acid-base concepts, ionization constants, pH and common ion effect'],
    ['hydrolysis-solubility-buffers', 'Hydrolysis of salts, solubility product and buffer solutions'],
  ], 'physical'),
  chapter('chemistry', 7, 'redox-electrochemistry', 'Redox Reactions and Electrochemistry', [
    ['redox-reactions', 'Oxidation number and balancing redox reactions'],
    ['electrolytic-conductance', "Conductance, molar conductivity and Kohlrausch's law"],
    ['electrochemical-cells', 'Galvanic and electrolytic cells, electrode potentials and Nernst equation'],
    ['batteries-fuel-cells', 'Cell potential and Gibbs energy, dry cell, lead accumulator and fuel cells'],
  ], 'physical'),
  chapter('chemistry', 8, 'chemical-kinetics', 'Chemical Kinetics', [
    ['reaction-rate-factors', 'Rate of reaction and factors affecting it'],
    ['rate-law-order', 'Order, molecularity, rate law and integrated rate equations (zero and first order)'],
    ['temperature-arrhenius', 'Effect of temperature, Arrhenius theory, activation energy and collision theory'],
  ], 'physical'),
  chapter('chemistry', 9, 'periodicity', 'Classification of Elements and Periodicity in Properties', [
    ['periodic-table', 'Modern periodic law and the periodic table (s, p, d and f blocks)'],
    ['periodic-trends', 'Periodic trends: radii, ionization enthalpy, electron gain enthalpy, valence and reactivity'],
  ], 'inorganic'),
  chapter('chemistry', 10, 'p-block-elements', 'p-Block Elements', [
    ['group-trends', 'Groups 13 to 18: electronic configuration and trends in properties'],
    ['first-element-anomaly', 'Unique behaviour of the first element in each group'],
  ], 'inorganic'),
  chapter('chemistry', 11, 'd-f-block-elements', 'd- and f-Block Elements', [
    ['transition-element-trends', 'Transition elements: configuration and trends in properties'],
    ['dichromate-permanganate', 'Preparation, properties and uses of K2Cr2O7 and KMnO4'],
    ['lanthanoids-actinoids', 'Lanthanoids (lanthanoid contraction) and actinoids'],
  ], 'inorganic'),
  chapter('chemistry', 12, 'coordination-compounds', 'Coordination Compounds', [
    ['werner-ligands-nomenclature', "Werner's theory, ligands, coordination number, denticity and IUPAC nomenclature"],
    ['isomerism', 'Isomerism in coordination compounds'],
    ['bonding-cft', 'Valence bond approach, crystal field theory, colour and magnetic properties'],
    ['applications', 'Importance in qualitative analysis, metallurgy and biological systems'],
  ], 'inorganic'),
  chapter('chemistry', 13, 'purification-characterisation', 'Purification and Characterisation of Organic Compounds', [
    ['purification-methods', 'Crystallization, sublimation, distillation, extraction and chromatography'],
    ['qualitative-analysis', 'Detection of nitrogen, sulphur, phosphorus and halogens'],
    ['quantitative-analysis', 'Estimation of elements and empirical/molecular formula calculations'],
  ], 'organic'),
  chapter('chemistry', 14, 'basic-principles-organic', 'Some Basic Principles of Organic Chemistry', [
    ['classification-nomenclature', 'Tetravalency, classification, homologous series and nomenclature'],
    ['isomerism', 'Structural and stereoisomerism'],
    ['reactive-intermediates', 'Bond fission, free radicals, carbocations, carbanions, electrophiles and nucleophiles'],
    ['electronic-effects', 'Inductive and electromeric effects, resonance and hyperconjugation'],
    ['reaction-types', 'Substitution, addition, elimination and rearrangement reactions'],
  ], 'organic'),
  chapter('chemistry', 15, 'hydrocarbons', 'Hydrocarbons', [
    ['alkanes', 'Alkanes: conformations and halogenation mechanism'],
    ['alkenes', 'Alkenes: geometrical isomerism, electrophilic addition, ozonolysis and polymerization'],
    ['alkynes', 'Alkynes: acidic character, addition reactions and polymerization'],
    ['aromatic-hydrocarbons', 'Benzene, aromaticity, electrophilic substitution and Friedel-Crafts reactions'],
  ], 'organic'),
  chapter('chemistry', 16, 'organic-halogen-compounds', 'Organic Compounds Containing Halogens', [
    ['preparation-properties', 'Preparation, properties and the nature of the C-X bond'],
    ['substitution-mechanisms', 'Mechanisms of substitution reactions'],
    ['uses-environment', 'Uses and environmental effects of chloroform, iodoform, freons and DDT'],
  ], 'organic'),
  chapter('chemistry', 17, 'organic-oxygen-compounds', 'Organic Compounds Containing Oxygen', [
    ['alcohols', 'Alcohols: classification and mechanism of dehydration'],
    ['phenols-ethers', 'Phenols (acidity, electrophilic substitution, Reimer-Tiemann) and ethers'],
    ['aldehydes-ketones', 'Aldehydes and ketones: nucleophilic addition and important named reactions'],
    ['carboxylic-acids', 'Carboxylic acids: acidic strength and factors affecting it'],
  ], 'organic'),
  chapter('chemistry', 18, 'organic-nitrogen-compounds', 'Organic Compounds Containing Nitrogen', [
    ['amines', 'Amines: nomenclature, classification, structure and basic character'],
    ['diazonium-salts', 'Diazonium salts in synthetic organic chemistry'],
  ], 'organic'),
  chapter('chemistry', 19, 'biomolecules', 'Biomolecules', [
    ['carbohydrates', 'Carbohydrates: classification, monosaccharides and oligosaccharides'],
    ['proteins-enzymes', 'Amino acids, peptides, protein structure, denaturation and enzymes'],
    ['vitamins-hormones', 'Vitamins and hormones'],
    ['nucleic-acids', 'Nucleic acids: DNA and RNA'],
  ], 'organic'),
  chapter('chemistry', 20, 'practical-chemistry', 'Principles Related to Practical Chemistry', [
    ['functional-group-detection', 'Detection of extra elements and functional groups'],
    ['preparations', 'Preparation of Mohr\'s salt, potash alum, acetanilide, p-nitroacetanilide, aniline yellow and iodoform'],
    ['titrimetry', 'Titrimetric exercises and indicators'],
    ['salt-analysis', 'Qualitative salt analysis (cations and anions)'],
    ['experiments', 'Enthalpy of solution and neutralization, lyophilic/lyophobic sols, iodide-peroxide kinetics'],
  ], 'organic'),
];

export const JEE_MAIN_SYLLABUS: readonly SyllabusSubject[] = Object.freeze([
  { id: 'physics', name: 'Physics', chapters: PHYSICS },
  { id: 'chemistry', name: 'Chemistry', chapters: CHEMISTRY },
  { id: 'mathematics', name: 'Mathematics', chapters: MATHEMATICS },
]);

const chapterIndex = new Map<string, SyllabusChapter>();
const topicIndex = new Map<string, { topic: SyllabusTopic; chapter: SyllabusChapter }>();
for (const subject of JEE_MAIN_SYLLABUS) {
  for (const ch of subject.chapters) {
    chapterIndex.set(ch.id, ch);
    for (const topic of ch.topics) topicIndex.set(topic.id, { topic, chapter: ch });
  }
}

export function getSubject(id: string): SyllabusSubject | undefined {
  return JEE_MAIN_SYLLABUS.find((s) => s.id === id);
}

export function getChapter(id: string): SyllabusChapter | undefined {
  return chapterIndex.get(id);
}

export function getTopic(id: string): { topic: SyllabusTopic; chapter: SyllabusChapter } | undefined {
  return topicIndex.get(id);
}

export function isKnownTopicId(id: unknown): id is string {
  return typeof id === 'string' && topicIndex.has(id);
}

export function isKnownChapterId(id: unknown): id is string {
  return typeof id === 'string' && chapterIndex.has(id);
}

export function allTopicIds(): string[] {
  return [...topicIndex.keys()];
}

/** Human-readable label, e.g. "Physics › Kinematics › Relative velocity". */
export function describeTopic(id: string): string | null {
  const found = topicIndex.get(id);
  if (!found) return null;
  const subject = getSubject(found.chapter.subjectId);
  return `${subject?.name ?? found.chapter.subjectId} › ${found.chapter.name} › ${found.topic.name}`;
}
