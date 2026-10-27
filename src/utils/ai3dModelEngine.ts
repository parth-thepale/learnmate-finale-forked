import type { Custom3DSceneSpec, Custom3DMeshSpec } from '../types/study.ts';

export async function callAnthropicMessagesApi(params: {
  apiKey?: string;
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string | null> {
  const key = (params.apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  if (!key) return null;

  // Use fast Haiku 4.5 by default or Sonnet 4.5
  const model = params.model || 'claude-haiku-4-5-20251001';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: params.maxTokens || 2048,
        ...(params.system ? { system: params.system } : {}),
        messages: [{ role: 'user', content: params.prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`Anthropic API returned HTTP ${res.status}: ${errText.slice(0, 120)}`);
      return null;
    }

    const data = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find((c) => c.type === 'text');
    return textBlock?.text || null;
  } catch (err) {
    console.warn('Anthropic API request failed:', err instanceof Error ? err.message : String(err));
    return null;
  }
}

export function generateProcedural3DScene(concept: string, contextText?: string): Custom3DSceneSpec {
  const lower = (concept + ' ' + (contextText || '')).toLowerCase();

  // 1. DNA Double Helix
  if (lower.includes('dna') || lower.includes('helix') || lower.includes('genetic') || lower.includes('nucleotide')) {
    const meshes: Custom3DMeshSpec[] = [];
    const rungs = 12;
    for (let i = 0; i < rungs; i++) {
      const angle = i * 0.52;
      const y = (i - rungs / 2) * 0.38;
      const radius = 1.35;
      const x1 = Math.cos(angle) * radius;
      const z1 = Math.sin(angle) * radius;
      const x2 = -x1;
      const z2 = -z1;

      // Backbone strand 1 (Sugar-phosphate node)
      meshes.push({
        id: `dna-strand1-${i}`,
        shape: 'sphere',
        args: [0.22, 16, 16],
        position: [x1, y, z1],
        color: '#3B82F6',
        roughness: 0.25,
        metalness: 0.1,
        label: `Strand A Backbone (Node ${i + 1})`,
      });

      // Backbone strand 2
      meshes.push({
        id: `dna-strand2-${i}`,
        shape: 'sphere',
        args: [0.22, 16, 16],
        position: [x2, y, z2],
        color: '#10B981',
        roughness: 0.25,
        metalness: 0.1,
        label: `Strand B Backbone (Node ${i + 1})`,
      });

      // Connecting hydrogen-bonded base pair rung
      const cx = (x1 + x2) / 2;
      const cz = (z1 + z2) / 2;
      meshes.push({
        id: `dna-rung-${i}`,
        shape: 'cylinder',
        args: [0.06, 0.06, radius * 2, 12],
        position: [cx, y, cz],
        rotation: [0, -angle, Math.PI / 2],
        color: i % 2 === 0 ? '#F59E0B' : '#EF4444',
        roughness: 0.4,
        label: i % 2 === 0 ? 'Adenine–Thymine (A=T) Base Pair' : 'Guanine–Cytosine (G≡C) Base Pair',
      });
    }

    return {
      title: 'DNA Double Helix Spatial Architecture',
      summary: '3D molecular model showing complementary base-pairing (A–T, G–C) and antiparallel sugar-phosphate helical backbones.',
      category: 'biology',
      camera: { position: [0, 2.5, 6.5], target: [0, 0, 0] },
      meshes,
      annotations: [
        { title: 'Helical Pitch', description: 'One complete helical turn spans ~3.4 nm containing 10.5 base pairs.', position: [0, 1.8, 1.5] },
        { title: 'Hydrogen Bonding', description: 'Two hydrogen bonds form between A and T; three hydrogen bonds form between G and C.', position: [0, -0.8, -1.2] },
      ],
    };
  }

  // 2. Solar System & Planetary Orbits
  if (lower.includes('solar') || lower.includes('planet') || lower.includes('orbit') || lower.includes('gravity') || lower.includes('astronomy')) {
    const meshes: Custom3DMeshSpec[] = [
      {
        id: 'sun-core',
        shape: 'sphere',
        args: [0.95, 24, 24],
        position: [0, 0, 0],
        color: '#F59E0B',
        roughness: 0.2,
        metalness: 0.1,
        label: 'Sun (Sol) — 99.8% of Solar System Mass',
      },
    ];

    const planets = [
      { name: 'Mercury', r: 1.8, size: 0.14, color: '#94A3B8', angle: 0.4 },
      { name: 'Venus', r: 2.6, size: 0.22, color: '#FBBF24', angle: 1.9 },
      { name: 'Earth', r: 3.5, size: 0.25, color: '#38BDF8', angle: 3.6 },
      { name: 'Mars', r: 4.4, size: 0.18, color: '#EF4444', angle: 5.1 },
    ];

    planets.forEach((p, idx) => {
      // Orbit Ring
      meshes.push({
        id: `orbit-ring-${idx}`,
        shape: 'torus',
        args: [p.r, 0.02, 12, 48],
        position: [0, 0, 0],
        rotation: [Math.PI / 2, 0, 0],
        color: '#475569',
        wireframe: true,
        label: `${p.name} Keplerian Orbital Track`,
      });

      // Planet Sphere
      const px = Math.cos(p.angle) * p.r;
      const pz = Math.sin(p.angle) * p.r;
      meshes.push({
        id: `planet-${idx}`,
        shape: 'sphere',
        args: [p.size, 16, 16],
        position: [px, 0, pz],
        color: p.color,
        roughness: 0.3,
        label: `${p.name}`,
      });
    });

    return {
      title: 'Solar System Keplerian Planetary Model',
      summary: '3D orbital model demonstrating gravitational binding and elliptical coplanar planetary revolution around the central Sun.',
      category: 'astronomy',
      camera: { position: [0, 6.2, 7.8], target: [0, 0, 0] },
      meshes,
      annotations: [
        { title: 'Gravitational Centripetal Force', description: 'F = G(M·m)/r² provides the inward acceleration maintaining stable orbits.', position: [0, 1.2, 0] },
      ],
    };
  }

  // 3. Bohr Atomic Model & Electron Shells
  if (lower.includes('atom') || lower.includes('bohr') || lower.includes('electron') || lower.includes('proton') || lower.includes('quantum')) {
    const meshes: Custom3DMeshSpec[] = [
      // Central Nucleus Cluster
      { id: 'nucleus-p1', shape: 'sphere', args: [0.35, 16, 16], position: [0, 0, 0], color: '#EF4444', label: 'Proton Cluster (Positive Charge)' },
      { id: 'nucleus-n1', shape: 'sphere', args: [0.32, 16, 16], position: [0.28, 0.22, 0], color: '#94A3B8', label: 'Neutron Core (Neutral)' },
      { id: 'nucleus-p2', shape: 'sphere', args: [0.34, 16, 16], position: [-0.22, -0.18, 0.1], color: '#EF4444', label: 'Proton Cluster' },
    ];

    // 3 Tilted Electron Orbit Rings
    const ringAngles: [number, number, number][] = [
      [Math.PI / 2, 0, 0],
      [Math.PI / 3, Math.PI / 4, 0],
      [Math.PI / 6, -Math.PI / 3, 0],
    ];

    ringAngles.forEach((rot, idx) => {
      const radius = 2.4;
      meshes.push({
        id: `electron-orbit-${idx}`,
        shape: 'torus',
        args: [radius, 0.03, 12, 48],
        position: [0, 0, 0],
        rotation: rot,
        color: '#38BDF8',
        wireframe: true,
        label: `Quantized Energy Level n=${idx + 1}`,
      });

      // Electron node on each shell
      const angle = (idx + 1) * 1.8;
      const ex = Math.cos(angle) * radius * 0.9;
      const ey = Math.sin(angle) * radius * 0.5;
      const ez = Math.sin(angle) * radius * 0.7;
      meshes.push({
        id: `electron-${idx}`,
        shape: 'sphere',
        args: [0.15, 14, 14],
        position: [ex, ey, ez],
        color: '#06B6D4',
        roughness: 0.1,
        metalness: 0.4,
        label: `Electron e⁻ (Shell n=${idx + 1})`,
      });
    });

    return {
      title: 'Bohr Quantized Atomic Model',
      summary: '3D atomic representation showing the dense central nucleon core and discrete quantized electron probability shells.',
      category: 'physics',
      camera: { position: [0, 3.2, 6.5], target: [0, 0, 0] },
      meshes,
      annotations: [
        { title: 'Rydberg Energy Formula', description: 'E_n = -13.6 eV / n² defines the discrete binding energy levels of the hydrogenic atom.', position: [0, 1.8, 1.5] },
      ],
    };
  }

  // 4. Default: Polyhedral Conceptual Scientific Core
  const meshes: Custom3DMeshSpec[] = [
    {
      id: 'central-core',
      shape: 'sphere',
      args: [0.95, 20, 20],
      position: [0, 0, 0],
      color: '#10B981',
      roughness: 0.28,
      metalness: 0.15,
      label: `${concept} — Central Core Principle`,
    },
    {
      id: 'equatorial-ring',
      shape: 'torus',
      args: [2.1, 0.05, 12, 48],
      position: [0, 0, 0],
      rotation: [Math.PI / 2.3, 0.2, 0],
      color: '#3B82F6',
      wireframe: true,
      label: 'Equatorial Equilibrium Manifold',
    },
    {
      id: 'polar-ring',
      shape: 'torus',
      args: [2.3, 0.04, 12, 48],
      position: [0, 0, 0],
      rotation: [0.2, Math.PI / 2.8, 0],
      color: '#F59E0B',
      wireframe: true,
      label: 'Polar Flux Contour',
    },
  ];

  const satellites = [
    { pos: [1.7, 0.8, 0.6] as [number, number, number], color: '#EC4899', name: 'Factor Alpha (Primary Variable)' },
    { pos: [-1.6, -0.7, 0.8] as [number, number, number], color: '#8B5CF6', name: 'Factor Beta (State Function)' },
    { pos: [0.4, 1.8, -1.2] as [number, number, number], color: '#06B6D4', name: 'Factor Gamma (Constraint)' },
    { pos: [-0.6, -1.7, -1.1] as [number, number, number], color: '#EAB308', name: 'Factor Delta (Equilibrium Output)' },
  ];

  satellites.forEach((s, idx) => {
    meshes.push({
      id: `satellite-${idx}`,
      shape: 'sphere',
      args: [0.28, 16, 16],
      position: s.pos,
      color: s.color,
      roughness: 0.3,
      label: s.name,
    });
    // Connector to center
    meshes.push({
      id: `connector-${idx}`,
      shape: 'cylinder',
      args: [0.03, 0.03, Math.hypot(s.pos[0], s.pos[1], s.pos[2]), 8],
      position: [s.pos[0] / 2, s.pos[1] / 2, s.pos[2] / 2],
      rotation: [Math.atan2(s.pos[1], s.pos[2]), 0, -Math.atan2(s.pos[0], s.pos[1])],
      color: '#64748B',
      label: `Interaction Vector ${idx + 1}`,
    });
  });

  return {
    title: `3D Concept Architecture: ${concept}`,
    summary: `Spatial model mapping the core principles and interdependent boundary factors governing "${concept}".`,
    category: 'science',
    camera: { position: [0, 2.8, 6.8], target: [0, 0, 0] },
    meshes,
    annotations: [
      { title: 'Core Dynamic', description: 'Central nexus mediating state changes across the surrounding variables.', position: [0, 1.2, 0] },
    ],
  };
}
