import type { Roadmap } from '../../types/roadmap.types';

export const PHYSICS_ROADMAPS: readonly Roadmap[] = Object.freeze([
  {
    id: 'PHY-01',
    subject: 'physics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Mechanics & Measurement',
    description:
      'Master the core foundation of classical physics: precision measurement, kinematics, Newtonian dynamics, work-energy theorem, and rotational mechanics.',
    order: 1,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['PHY-01-CP1', 'PHY-01-CP2', 'PHY-01-CP3', 'PHY-01-CP4'],
    estimatedHours: 42,
    targetAudience: 'JEE Main 2027 Aspirants building mechanics intuition and problem-solving speed',
    colorTheme: {
      accentColor: '#c85a32', // terracotta
      subtleBg: 'rgba(200, 90, 50, 0.08)',
      borderColor: 'rgba(200, 90, 50, 0.25)',
    },
  },
  {
    id: 'PHY-02',
    subject: 'physics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Gravitation, Matter & Thermal Physics',
    description:
      'Explore central gravitational forces, fluid and solid mechanics, heat transfer laws, kinetic gas theory, and wave oscillation harmonics.',
    order: 2,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['PHY-02-CP1', 'PHY-02-CP2', 'PHY-02-CP3', 'PHY-02-CP4'],
    estimatedHours: 38,
    targetAudience: 'Students mastering macroscopic physics, thermo cycles, and fluid mechanics',
    colorTheme: {
      accentColor: '#b45309', // amber/ochre
      subtleBg: 'rgba(180, 83, 9, 0.08)',
      borderColor: 'rgba(180, 83, 9, 0.25)',
    },
  },
  {
    id: 'PHY-03',
    subject: 'physics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Electricity, Magnetism & Electromagnetic Waves',
    description:
      'Rigorous exploration of static charges, field flux, circuit networks, Ampere & Biot-Savart magnetostatics, electromagnetic induction, and Maxwell waves.',
    order: 3,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['PHY-03-CP1', 'PHY-03-CP2', 'PHY-03-CP3', 'PHY-03-CP4'],
    estimatedHours: 48,
    targetAudience: 'Aspirants targeting high weightage Electrodynamics and AC circuits',
    colorTheme: {
      accentColor: '#1d4ed8', // classic cobalt
      subtleBg: 'rgba(29, 78, 216, 0.08)',
      borderColor: 'rgba(29, 78, 216, 0.25)',
    },
  },
  {
    id: 'PHY-04',
    subject: 'physics',
    examIdentifier: 'JEE Main',
    examYear: 2027,
    title: 'Optics, Modern Physics & Experimental Skills',
    description:
      'From geometric mirrors and wave interference to quantum photoelectric emission, atomic Bohr spectra, semiconductor diodes, and laboratory apparatus.',
    order: 4,
    syllabusVersion: 'NTA-2027-v1',
    checkpointIds: ['PHY-04-CP1', 'PHY-04-CP2', 'PHY-04-CP3', 'PHY-04-CP4'],
    estimatedHours: 40,
    targetAudience: 'Aspirants looking to secure high-efficiency, high-accuracy scoring topics',
    colorTheme: {
      accentColor: '#0f766e', // deep teal
      subtleBg: 'rgba(15, 118, 110, 0.08)',
      borderColor: 'rgba(15, 118, 110, 0.25)',
    },
  },
]);
