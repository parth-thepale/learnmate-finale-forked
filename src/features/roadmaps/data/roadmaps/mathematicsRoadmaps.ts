import type { Roadmap } from '../../types/roadmap.types';

export const MATHEMATICS_ROADMAPS: readonly Roadmap[] = Object.freeze([
  {
    id: 'MAT-01',
    subject: 'mathematics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Algebra & Functions',
    description:
      'Master the backbone of analytical thinking: sets and function mappings, complex numbers, algebraic equations, matrix determinental systems, combinatorics, and series progression.',
    order: 1,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['MAT-01-CP1', 'MAT-01-CP2', 'MAT-01-CP3', 'MAT-01-CP4'],
    estimatedHours: 44,
    targetAudience: 'Aspirants building core algebraic manipulation and systematic reasoning',
    colorTheme: {
      accentColor: '#c85a32', // terracotta
      subtleBg: 'rgba(200, 90, 50, 0.08)',
      borderColor: 'rgba(200, 90, 50, 0.25)',
    },
  },
  {
    id: 'MAT-02',
    subject: 'mathematics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Differential & Integral Calculus',
    description:
      'Continuous analysis from basic epsilon-delta limits, tangency extrema, and Taylor approximations to Riemann integrals, area curves, and linear differential equations.',
    order: 2,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['MAT-02-CP1', 'MAT-02-CP2', 'MAT-02-CP3', 'MAT-02-CP4'],
    estimatedHours: 54,
    targetAudience: 'Students tackling the highest-weightage pillar of the JEE Mathematics paper',
    colorTheme: {
      accentColor: '#ea580c', // orange/amber
      subtleBg: 'rgba(234, 88, 12, 0.08)',
      borderColor: 'rgba(234, 88, 12, 0.25)',
    },
  },
  {
    id: 'MAT-03',
    subject: 'mathematics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Coordinate Geometry',
    description:
      'Geometric locus analysis, Cartesian equations of intersecting lines, orthocentres, circle tangents, parabolas, ellipses, hyperbolas, and conic section properties.',
    order: 3,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['MAT-03-CP1', 'MAT-03-CP2', 'MAT-03-CP3', 'MAT-03-CP4'],
    estimatedHours: 40,
    targetAudience: 'Students mastering visual and algebraic coordinate problem-solving',
    colorTheme: {
      accentColor: '#4f46e5', // indigo
      subtleBg: 'rgba(79, 70, 229, 0.08)',
      borderColor: 'rgba(79, 70, 229, 0.25)',
    },
  },
  {
    id: 'MAT-04',
    subject: 'mathematics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Trigonometry, Vectors, 3D & Probability',
    description:
      'Trigonometric transformations, 3D directional vectors, shortest distance between skew lines, statistical variance dispersion, and conditional Bayes probability laws.',
    order: 4,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['MAT-04-CP1', 'MAT-04-CP2', 'MAT-04-CP3', 'MAT-04-CP4'],
    estimatedHours: 42,
    targetAudience: 'Aspirants securing high-scoring vector-3D geometry and probability questions',
    colorTheme: {
      accentColor: '#0d9488', // teal
      subtleBg: 'rgba(13, 148, 136, 0.08)',
      borderColor: 'rgba(13, 148, 136, 0.25)',
    },
  },
]);
