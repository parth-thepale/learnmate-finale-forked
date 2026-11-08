import type { Roadmap } from '../../types/roadmap.types';

export const CHEMISTRY_ROADMAPS: readonly Roadmap[] = Object.freeze([
  {
    id: 'CHE-01',
    subject: 'chemistry',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Physical Chemistry Foundations',
    description:
      'Build unshakeable stoichiometry fundamentals, subatomic quantum models, chemical bonding hybridization geometries, and thermodynamic spontaneity laws.',
    order: 1,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['CHE-01-CP1', 'CHE-01-CP2', 'CHE-01-CP3', 'CHE-01-CP4'],
    estimatedHours: 36,
    targetAudience: 'Students establishing stoichiometric and molecular structural mastery',
    colorTheme: {
      accentColor: '#059669', // emerald
      subtleBg: 'rgba(5, 150, 105, 0.08)',
      borderColor: 'rgba(5, 150, 105, 0.25)',
    },
  },
  {
    id: 'CHE-02',
    subject: 'chemistry',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Physical Chemistry Applications & Inorganic Chemistry',
    description:
      'Colligative solution properties, dynamic equilibrium, Nernst electrochemistry, reaction rates, periodic trends, and d/f-block coordination complex theory.',
    order: 2,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['CHE-02-CP1', 'CHE-02-CP2', 'CHE-02-CP3', 'CHE-02-CP4'],
    estimatedHours: 46,
    targetAudience: 'Mastering numerical equilibria and high-yield inorganic complexes',
    colorTheme: {
      accentColor: '#0284c7', // cerulean
      subtleBg: 'rgba(2, 132, 199, 0.08)',
      borderColor: 'rgba(2, 132, 199, 0.25)',
    },
  },
  {
    id: 'CHE-03',
    subject: 'chemistry',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Organic Chemistry & Reaction Mastery',
    description:
      'From purification and GOC electron displacement effects to electrophilic additions, substitution mechanisms, carbonyl condensations, and essential biomolecules.',
    order: 3,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['CHE-03-CP1', 'CHE-03-CP2', 'CHE-03-CP3', 'CHE-03-CP4'],
    estimatedHours: 50,
    targetAudience: 'Students mastering multi-step organic reaction pathways and named transformations',
    colorTheme: {
      accentColor: '#7c3aed', // violet
      subtleBg: 'rgba(124, 58, 237, 0.08)',
      borderColor: 'rgba(124, 58, 237, 0.25)',
    },
  },
  {
    id: 'CHE-04',
    subject: 'chemistry',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Practical Chemistry & Complete Revision',
    description:
      'Comprehensive laboratory qualitative salt analysis, volumetric titrimetry, and systematic domain-level cumulative synthesis across Physical, Inorganic, and Organic Chemistry.',
    order: 4,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['CHE-04-CP1', 'CHE-04-CP2', 'CHE-04-CP3', 'CHE-04-CP4'],
    estimatedHours: 32,
    targetAudience: 'Final phase JEE revision, salt analysis tests, and integrated mock mastery',
    colorTheme: {
      accentColor: '#db2777', // rose/magenta
      subtleBg: 'rgba(219, 39, 119, 0.08)',
      borderColor: 'rgba(219, 39, 119, 0.25)',
    },
  },
]);
