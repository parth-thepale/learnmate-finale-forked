import {
  JEE_MAIN_SYLLABUS,
  type JeeSubjectId,
  type SyllabusChapter,
} from '../../../../data/jeeMainSyllabus';
import type { RoadmapId } from '../../types/roadmap.types';

export interface UnitMappingRecord {
  readonly subjectId: JeeSubjectId;
  readonly unitNumber: number;
  readonly chapterId: string;
  readonly chapterName: string;
  readonly primaryRoadmapId: RoadmapId;
  readonly primaryCheckpointId: string;
  readonly notes?: string;
}

/**
 * Authoritative coverage matrix mapping every official NTA JEE Main Paper 1 Unit
 * (20 Physics, 20 Chemistry, 14 Mathematics = 54 units total) to exactly ONE
 * primary roadmap and checkpoint.
 */
export const OFFICIAL_JEE_2027_SYLLABUS_MATRIX: readonly UnitMappingRecord[] = Object.freeze([
  // ==========================================
  // PHYSICS (Units 1 - 20)
  // ==========================================
  // PHY-01: Mechanics & Measurement (Units 1 - 5)
  {
    subjectId: 'physics',
    unitNumber: 1,
    chapterId: 'physics.units-measurements',
    chapterName: 'Units and Measurements',
    primaryRoadmapId: 'PHY-01',
    primaryCheckpointId: 'PHY-01-CP1',
  },
  {
    subjectId: 'physics',
    unitNumber: 2,
    chapterId: 'physics.kinematics',
    chapterName: 'Kinematics',
    primaryRoadmapId: 'PHY-01',
    primaryCheckpointId: 'PHY-01-CP1',
  },
  {
    subjectId: 'physics',
    unitNumber: 3,
    chapterId: 'physics.laws-of-motion',
    chapterName: 'Laws of Motion',
    primaryRoadmapId: 'PHY-01',
    primaryCheckpointId: 'PHY-01-CP2',
  },
  {
    subjectId: 'physics',
    unitNumber: 4,
    chapterId: 'physics.work-energy-power',
    chapterName: 'Work, Energy and Power',
    primaryRoadmapId: 'PHY-01',
    primaryCheckpointId: 'PHY-01-CP3',
  },
  {
    subjectId: 'physics',
    unitNumber: 5,
    chapterId: 'physics.rotational-motion',
    chapterName: 'Rotational Motion',
    primaryRoadmapId: 'PHY-01',
    primaryCheckpointId: 'PHY-01-CP4',
  },

  // PHY-02: Gravitation, Matter & Thermal Physics (Units 6 - 10)
  {
    subjectId: 'physics',
    unitNumber: 6,
    chapterId: 'physics.gravitation',
    chapterName: 'Gravitation',
    primaryRoadmapId: 'PHY-02',
    primaryCheckpointId: 'PHY-02-CP1',
  },
  {
    subjectId: 'physics',
    unitNumber: 7,
    chapterId: 'physics.properties-solids-liquids',
    chapterName: 'Properties of Solids and Liquids',
    primaryRoadmapId: 'PHY-02',
    primaryCheckpointId: 'PHY-02-CP2',
  },
  {
    subjectId: 'physics',
    unitNumber: 8,
    chapterId: 'physics.thermodynamics',
    chapterName: 'Thermodynamics',
    primaryRoadmapId: 'PHY-02',
    primaryCheckpointId: 'PHY-02-CP4',
  },
  {
    subjectId: 'physics',
    unitNumber: 9,
    chapterId: 'physics.kinetic-theory-of-gases',
    chapterName: 'Kinetic Theory of Gases',
    primaryRoadmapId: 'PHY-02',
    primaryCheckpointId: 'PHY-02-CP3',
  },
  {
    subjectId: 'physics',
    unitNumber: 10,
    chapterId: 'physics.oscillations-waves',
    chapterName: 'Oscillations and Waves',
    primaryRoadmapId: 'PHY-02',
    primaryCheckpointId: 'PHY-02-CP4',
  },

  // PHY-03: Electricity, Magnetism & Electromagnetic Waves (Units 11 - 15)
  {
    subjectId: 'physics',
    unitNumber: 11,
    chapterId: 'physics.electrostatics',
    chapterName: 'Electrostatics',
    primaryRoadmapId: 'PHY-03',
    primaryCheckpointId: 'PHY-03-CP1',
  },
  {
    subjectId: 'physics',
    unitNumber: 12,
    chapterId: 'physics.current-electricity',
    chapterName: 'Current Electricity',
    primaryRoadmapId: 'PHY-03',
    primaryCheckpointId: 'PHY-03-CP2',
  },
  {
    subjectId: 'physics',
    unitNumber: 13,
    chapterId: 'physics.magnetic-effects-magnetism',
    chapterName: 'Magnetic Effects of Current and Magnetism',
    primaryRoadmapId: 'PHY-03',
    primaryCheckpointId: 'PHY-03-CP3',
  },
  {
    subjectId: 'physics',
    unitNumber: 14,
    chapterId: 'physics.electromagnetic-induction-ac',
    chapterName: 'Electromagnetic Induction and Alternating Currents',
    primaryRoadmapId: 'PHY-03',
    primaryCheckpointId: 'PHY-03-CP4',
  },
  {
    subjectId: 'physics',
    unitNumber: 15,
    chapterId: 'physics.electromagnetic-waves',
    chapterName: 'Electromagnetic Waves',
    primaryRoadmapId: 'PHY-03',
    primaryCheckpointId: 'PHY-03-CP4',
  },

  // PHY-04: Optics, Modern Physics & Experimental Skills (Units 16 - 20)
  {
    subjectId: 'physics',
    unitNumber: 16,
    chapterId: 'physics.optics',
    chapterName: 'Optics',
    primaryRoadmapId: 'PHY-04',
    primaryCheckpointId: 'PHY-04-CP1', // Subtopics span Ray (CP1) & Wave (CP2)
  },
  {
    subjectId: 'physics',
    unitNumber: 17,
    chapterId: 'physics.dual-nature',
    chapterName: 'Dual Nature of Matter and Radiation',
    primaryRoadmapId: 'PHY-04',
    primaryCheckpointId: 'PHY-04-CP3',
  },
  {
    subjectId: 'physics',
    unitNumber: 18,
    chapterId: 'physics.atoms-nuclei',
    chapterName: 'Atoms and Nuclei',
    primaryRoadmapId: 'PHY-04',
    primaryCheckpointId: 'PHY-04-CP3',
  },
  {
    subjectId: 'physics',
    unitNumber: 19,
    chapterId: 'physics.electronic-devices',
    chapterName: 'Electronic Devices',
    primaryRoadmapId: 'PHY-04',
    primaryCheckpointId: 'PHY-04-CP4',
  },
  {
    subjectId: 'physics',
    unitNumber: 20,
    chapterId: 'physics.experimental-skills',
    chapterName: 'Experimental Skills',
    primaryRoadmapId: 'PHY-04',
    primaryCheckpointId: 'PHY-04-CP4',
  },

  // ==========================================
  // CHEMISTRY (Units 1 - 20)
  // ==========================================
  // CHE-01: Physical Chemistry Foundations (Units 1 - 4)
  {
    subjectId: 'chemistry',
    unitNumber: 1,
    chapterId: 'chemistry.basic-concepts',
    chapterName: 'Some Basic Concepts in Chemistry',
    primaryRoadmapId: 'CHE-01',
    primaryCheckpointId: 'CHE-01-CP1',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 2,
    chapterId: 'chemistry.atomic-structure',
    chapterName: 'Atomic Structure',
    primaryRoadmapId: 'CHE-01',
    primaryCheckpointId: 'CHE-01-CP2',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 3,
    chapterId: 'chemistry.chemical-bonding',
    chapterName: 'Chemical Bonding and Molecular Structure',
    primaryRoadmapId: 'CHE-01',
    primaryCheckpointId: 'CHE-01-CP3',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 4,
    chapterId: 'chemistry.chemical-thermodynamics',
    chapterName: 'Chemical Thermodynamics',
    primaryRoadmapId: 'CHE-01',
    primaryCheckpointId: 'CHE-01-CP4',
  },

  // CHE-02: Physical Chemistry Applications & Inorganic Chemistry (Units 5 - 12)
  {
    subjectId: 'chemistry',
    unitNumber: 5,
    chapterId: 'chemistry.solutions',
    chapterName: 'Solutions',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP1',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 6,
    chapterId: 'chemistry.equilibrium',
    chapterName: 'Equilibrium',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP2',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 7,
    chapterId: 'chemistry.redox-electrochemistry',
    chapterName: 'Redox Reactions and Electrochemistry',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP3',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 8,
    chapterId: 'chemistry.chemical-kinetics',
    chapterName: 'Chemical Kinetics',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP3',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 9,
    chapterId: 'chemistry.periodicity',
    chapterName: 'Classification of Elements and Periodicity in Properties',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP4',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 10,
    chapterId: 'chemistry.p-block-elements',
    chapterName: 'p-Block Elements',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP4',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 11,
    chapterId: 'chemistry.d-f-block-elements',
    chapterName: 'd- and f-Block Elements',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP4',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 12,
    chapterId: 'chemistry.coordination-compounds',
    chapterName: 'Coordination Compounds',
    primaryRoadmapId: 'CHE-02',
    primaryCheckpointId: 'CHE-02-CP4',
  },

  // CHE-03: Organic Chemistry & Reaction Mastery (Units 13 - 19)
  {
    subjectId: 'chemistry',
    unitNumber: 13,
    chapterId: 'chemistry.purification-characterisation',
    chapterName: 'Purification and Characterisation of Organic Compounds',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP1',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 14,
    chapterId: 'chemistry.basic-principles-organic',
    chapterName: 'Some Basic Principles of Organic Chemistry',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP1',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 15,
    chapterId: 'chemistry.hydrocarbons',
    chapterName: 'Hydrocarbons',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP2',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 16,
    chapterId: 'chemistry.organic-halogen-compounds',
    chapterName: 'Organic Compounds Containing Halogens',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP3',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 17,
    chapterId: 'chemistry.organic-oxygen-compounds',
    chapterName: 'Organic Compounds Containing Oxygen',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP3',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 18,
    chapterId: 'chemistry.organic-nitrogen-compounds',
    chapterName: 'Organic Compounds Containing Nitrogen',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP4',
  },
  {
    subjectId: 'chemistry',
    unitNumber: 19,
    chapterId: 'chemistry.biomolecules',
    chapterName: 'Biomolecules',
    primaryRoadmapId: 'CHE-03',
    primaryCheckpointId: 'CHE-03-CP4',
  },

  // CHE-04: Practical Chemistry & Complete Revision (Unit 20)
  {
    subjectId: 'chemistry',
    unitNumber: 20,
    chapterId: 'chemistry.practical-chemistry',
    chapterName: 'Principles Related to Practical Chemistry',
    primaryRoadmapId: 'CHE-04',
    primaryCheckpointId: 'CHE-04-CP1',
    notes: 'Checkpoint 2, 3 and 4 provide cumulative domain-level revision & multi-topic synthesis',
  },

  // ==========================================
  // MATHEMATICS (Units 1 - 14)
  // ==========================================
  // MAT-01: Algebra & Functions (Units 1 - 6)
  {
    subjectId: 'mathematics',
    unitNumber: 1,
    chapterId: 'mathematics.sets-relations-functions',
    chapterName: 'Sets, Relations and Functions',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP1',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 2,
    chapterId: 'mathematics.complex-numbers-quadratic-equations',
    chapterName: 'Complex Numbers and Quadratic Equations',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP2',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 3,
    chapterId: 'mathematics.matrices-determinants',
    chapterName: 'Matrices and Determinants',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP3',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 4,
    chapterId: 'mathematics.permutations-combinations',
    chapterName: 'Permutations and Combinations',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP4',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 5,
    chapterId: 'mathematics.binomial-theorem',
    chapterName: 'Binomial Theorem and its Simple Applications',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP4',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 6,
    chapterId: 'mathematics.sequence-series',
    chapterName: 'Sequence and Series',
    primaryRoadmapId: 'MAT-01',
    primaryCheckpointId: 'MAT-01-CP4',
  },

  // MAT-02: Differential & Integral Calculus (Units 7 - 9)
  {
    subjectId: 'mathematics',
    unitNumber: 7,
    chapterId: 'mathematics.limit-continuity-differentiability',
    chapterName: 'Limit, Continuity and Differentiability',
    primaryRoadmapId: 'MAT-02',
    primaryCheckpointId: 'MAT-02-CP1', // Subtopics span Limits/Continuity (CP1) and Derivatives/AOD (CP2)
  },
  {
    subjectId: 'mathematics',
    unitNumber: 8,
    chapterId: 'mathematics.integral-calculus',
    chapterName: 'Integral Calculus',
    primaryRoadmapId: 'MAT-02',
    primaryCheckpointId: 'MAT-02-CP3',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 9,
    chapterId: 'mathematics.differential-equations',
    chapterName: 'Differential Equations',
    primaryRoadmapId: 'MAT-02',
    primaryCheckpointId: 'MAT-02-CP4',
  },

  // MAT-03: Coordinate Geometry (Unit 10)
  {
    subjectId: 'mathematics',
    unitNumber: 10,
    chapterId: 'mathematics.coordinate-geometry',
    chapterName: 'Co-ordinate Geometry',
    primaryRoadmapId: 'MAT-03',
    primaryCheckpointId: 'MAT-03-CP1', // Subtopics span Lines (CP1), Circles (CP2), Parabola/Ellipse (CP3), Hyperbola (CP4)
  },

  // MAT-04: Trigonometry, Vectors, 3D & Probability (Units 11 - 14)
  {
    subjectId: 'mathematics',
    unitNumber: 11,
    chapterId: 'mathematics.three-dimensional-geometry',
    chapterName: 'Three Dimensional Geometry',
    primaryRoadmapId: 'MAT-04',
    primaryCheckpointId: 'MAT-04-CP3',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 12,
    chapterId: 'mathematics.vector-algebra',
    chapterName: 'Vector Algebra',
    primaryRoadmapId: 'MAT-04',
    primaryCheckpointId: 'MAT-04-CP2',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 13,
    chapterId: 'mathematics.statistics-probability',
    chapterName: 'Statistics and Probability',
    primaryRoadmapId: 'MAT-04',
    primaryCheckpointId: 'MAT-04-CP4',
  },
  {
    subjectId: 'mathematics',
    unitNumber: 14,
    chapterId: 'mathematics.trigonometry',
    chapterName: 'Trigonometry',
    primaryRoadmapId: 'MAT-04',
    primaryCheckpointId: 'MAT-04-CP1',
  },
]);

/**
 * Validates that every official NTA chapter is mapped exactly once without omissions or duplicates.
 */
export function validateSyllabusCoverage(): {
  isComplete: boolean;
  totalMappedUnits: number;
  expectedUnits: number;
  missingChapters: string[];
  duplicateChapters: string[];
} {
  const allOfficialChapters: SyllabusChapter[] = [];
  for (const subject of JEE_MAIN_SYLLABUS) {
    allOfficialChapters.push(...subject.chapters);
  }

  const mappedChapterIds = new Set<string>();
  const duplicateChapters: string[] = [];
  for (const record of OFFICIAL_JEE_2027_SYLLABUS_MATRIX) {
    if (mappedChapterIds.has(record.chapterId)) {
      duplicateChapters.push(record.chapterId);
    }
    mappedChapterIds.add(record.chapterId);
  }

  const missingChapters: string[] = [];
  for (const ch of allOfficialChapters) {
    if (!mappedChapterIds.has(ch.id)) {
      missingChapters.push(ch.id);
    }
  }

  return {
    isComplete: missingChapters.length === 0 && duplicateChapters.length === 0,
    totalMappedUnits: OFFICIAL_JEE_2027_SYLLABUS_MATRIX.length,
    expectedUnits: allOfficialChapters.length,
    missingChapters,
    duplicateChapters,
  };
}

export function getUnitMapping(chapterId: string): UnitMappingRecord | undefined {
  return OFFICIAL_JEE_2027_SYLLABUS_MATRIX.find((rec) => rec.chapterId === chapterId);
}
