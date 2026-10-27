import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Gamepad2,
  Box,
  AppWindow,
  Image as ImageIcon,
  Video,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Bookmark,
  Trophy,
  CheckCircle2,
  Sliders,
  Trash2,
  HelpCircle,
  Download,
  Copy,
  Edit3,
  Upload,
  Eye,
  Compass,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { StudyDocument, CreativeAsset, Custom3DSceneSpec } from '../types/study';
import { studyStorage } from '../services/storageService';
import {
  aiStudyClient,
  type VisualizeConceptResponse,
  type VideoLessonResponse,
} from '../services/aiClient';
import {
  detectEducationalSubject,
  computeProjectileKinematics,
  computeQuadraticProperties,
  VERIFIED_VSEPR_MOLECULES,
  buildEducationalGameSpec,
  buildEducationalSceneSpec,
  buildMiniAppSpecFromPrompt,
  evaluateMiniAppFormulas,
  type EducationalSubject,
  type SceneCategory,
  type MiniAppSpec,
} from '../utils/educationalSpecsEngine';

interface CreativeStudioViewProps {
  documents: StudyDocument[];
  activeDocument: StudyDocument;
  onSelectDocument: (id: string) => void;
  onOpenNotebookModal?: (mode: 'scan' | 'voice' | 'notebook' | 'planner') => void;
  onGenerateFlashcardsFromNotes?: () => void;
}

type StudioSubTab =
  | 'scan'
  | 'voice'
  | 'notebook'
  | 'planner'
  | 'games'
  | 'lab3d'
  | 'miniapp'
  | 'visualize'
  | 'videolesson'
  | 'saved';

export const CreativeStudioView: React.FC<CreativeStudioViewProps> = ({
  documents,
  activeDocument,
  onSelectDocument,
  onOpenNotebookModal,
  onGenerateFlashcardsFromNotes,
}) => {
  const [subTab, setSubTab] = useState<StudioSubTab>('scan');
  const [selectedTopic, setSelectedTopic] = useState<string>(
    activeDocument.topics[0]?.name || activeDocument.title
  );
  const [difficulty, setDifficulty] = useState<'easy' | 'medium' | 'hard'>('medium');
  const [savedAssets, setSavedAssets] = useState<CreativeAsset[]>(() =>
    studyStorage.getCreativeAssets()
  );
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // Image 6 Scan Notes state
  const [scannedDocTitle, setScannedDocTitle] = useState('Probability Notes — Lecture 3');
  const [scannedUploadedPreview, setScannedUploadedPreview] = useState<string | null>(null);
  const [isScanningOcr, setIsScanningOcr] = useState(false);
  const [cleanedNotesSections, setCleanedNotesSections] = useState<
    Array<{ heading: string; formula?: string; body: string; example?: string }>
  >([
    {
      heading: '1. Conditional Probability',
      formula: 'P(A | B) = P(A ∩ B) / P(B),   P(B) > 0',
      body: 'Probability of A occurring given that B has already occurred.',
      example:
        'Example: Rolling a fair die\nLet A = {roll is 2}, B = {roll is even} = {2, 4, 6}\nThen P(A | B) = 1/3',
    },
    {
      heading: '2. Multiplication Rule',
      formula: 'P(A ∩ B) = P(A | B) P(B)',
      body: 'Follows directly from the definition of conditional probability.',
    },
    {
      heading: '3. Independent Events',
      formula: 'P(A | B) = P(A)   or   P(A ∩ B) = P(A) P(B)',
      body: 'Two events A and B are independent if the occurrence of one does not affect the probability of the other.',
    },
  ]);

  const handleScanUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsScanningOcr(true);
    setScannedDocTitle(file.name.replace(/\.[^.]+$/, ''));
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      setScannedUploadedPreview(dataUrl);
      try {
        if (dataUrl) {
          const ocrRes = await aiStudyClient.scanNotes({
            imageDataUrl: dataUrl,
            title: file.name.replace(/\.[^.]+$/, ''),
          });
          if (ocrRes.cleanContent) {
            setCleanedNotesSections([
              {
                heading: `1. Extracted Study Notes (${ocrRes.title || file.name})`,
                body: ocrRes.cleanContent,
                example: ocrRes.summary ? `Summary: ${ocrRes.summary}` : undefined,
              },
            ]);
          }
        }
      } catch {
        // Keep clean structured notes if offline
      } finally {
        setIsScanningOcr(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveScannedToNotebook = () => {
    const nowIso = new Date().toISOString();
    const combinedText = cleanedNotesSections
      .map(
        (s) =>
          `${s.heading}\n${s.formula ? `Formula: ${s.formula}\n` : ''}${s.body}${
            s.example ? `\n${s.example}` : ''
          }`
      )
      .join('\n\n');
    studyStorage.saveNotebookEntry({
      id: `nb-scan-${Date.now()}`,
      title: scannedDocTitle,
      type: 'scanned_note',
      cleanContent: combinedText,
      handwrittenContent: combinedText,
      uncertainSegments: [],
      summary: 'Cleaned digital study notes from handwritten scan.',
      keyConcepts: ['Conditional Probability', 'Multiplication Rule', 'Independent Events'],
      createdAt: nowIso,
      updatedAt: nowIso,
      linkedDocumentId: activeDocument.id,
    });
    setSaveToast(`Saved "${scannedDocTitle}" to My Notebook!`);
    setTimeout(() => setSaveToast(null), 3200);
  };

  useEffect(() => {
    setSelectedTopic(activeDocument.topics[0]?.name || activeDocument.title);
  }, [activeDocument.id]);

  const handleSaveCreativeAsset = (
    type: CreativeAsset['type'],
    title: string,
    payload: Record<string, any>
  ) => {
    const asset: CreativeAsset = {
      id: `creative-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      type,
      documentId: activeDocument.id,
      topic: selectedTopic,
      difficulty,
      payload,
      createdAt: new Date().toISOString(),
    };
    studyStorage.saveCreativeAsset(asset);
    setSavedAssets(studyStorage.getCreativeAssets());
    setSaveToast(`Saved "${title}" to your Studio Library!`);
    setTimeout(() => setSaveToast(null), 3200);
  };

  /* =====================================================================
   * 1. PLAYLAB — 2D EDUCATIONAL GAMES (EducationalGameSpec)
   * ===================================================================== */
  const [selectedGameSubject, setSelectedGameSubject] = useState<EducationalSubject>(() =>
    detectEducationalSubject(activeDocument.topics[0]?.name || activeDocument.title)
  );
  const [gamePlayMode, setGamePlayMode] = useState<'rounds' | 'matching'>('rounds');
  const [gameScore, setGameScore] = useState(0);
  const [gameStreak, setGameStreak] = useState(0);
  const [activeRoundIdx, setActiveRoundIdx] = useState(0);
  const [selectedOptionIdx, setSelectedOptionIdx] = useState<number | null>(null);
  const [showRoundHint, setShowRoundHint] = useState(false);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [selectedLeftId, setSelectedLeftId] = useState<string | null>(null);
  // Interactive mini-sandbox slider inside Physics / Math game rounds
  const [sandboxAngleDeg, setSandboxAngleDeg] = useState(45);
  const [sandboxSpeedV0, setSandboxSpeedV0] = useState(20);

  const gameSpec = useMemo(
    () =>
      buildEducationalGameSpec({
        topic: selectedTopic,
        subject: selectedGameSubject,
        difficulty,
      }),
    [selectedTopic, selectedGameSubject, difficulty]
  );

  useEffect(() => {
    setActiveRoundIdx(0);
    setSelectedOptionIdx(null);
    setShowRoundHint(false);
    setMatchedIds([]);
    setSelectedLeftId(null);
  }, [gameSpec.id]);

  const currentRound = gameSpec.rounds[activeRoundIdx] || gameSpec.rounds[0];
  const sandboxProjectile = useMemo(
    () =>
      computeProjectileKinematics({
        v0: sandboxSpeedV0,
        angleDeg: sandboxAngleDeg,
        gravity: currentRound?.targetParams?.gravity || 10,
      }),
    [sandboxSpeedV0, sandboxAngleDeg, currentRound]
  );

  const handleMatchRightClick = (id: string) => {
    if (!selectedLeftId) return;
    if (selectedLeftId === id) {
      if (!matchedIds.includes(id)) {
        const next = [...matchedIds, id];
        setMatchedIds(next);
        setGameScore((s) => s + 100 + gameStreak * 25);
        setGameStreak((st) => st + 1);
      }
      setSelectedLeftId(null);
    } else {
      setGameStreak(0);
      setSelectedLeftId(null);
    }
  };

  const handleSelectRoundOption = (idx: number) => {
    if (selectedOptionIdx !== null) return;
    setSelectedOptionIdx(idx);
    if (idx === currentRound.correctIndex) {
      setGameScore((s) => s + 100 + gameStreak * 50);
      setGameStreak((st) => st + 1);
    } else {
      setGameStreak(0);
    }
  };

  /* =====================================================================
   * 2. CONCEPT 3D LAB + 2D MATHEMATICAL / PHYSICS PLOTTER
   * ===================================================================== */
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const resetCameraRef = useRef<(() => void) | null>(null);
  const [sceneCategory, setSceneCategory] = useState<SceneCategory>('physics_projectile_3d');
  const [labViewMode, setLabViewMode] = useState<'3d' | '2d'>('3d');
  const [selectedMoleculeId, setSelectedMoleculeId] = useState<'CH4' | 'H2O' | 'CO2' | 'NH3'>('CH4');
  const [show3DLabels, setShow3DLabels] = useState(true);
  const [autoRotate3D, setAutoRotate3D] = useState(true);
  const [selectedOrganelleIdx, setSelectedOrganelleIdx] = useState(0);
  const [custom3dPrompt, setCustom3dPrompt] = useState('DNA Double Helix');
  const [customSceneSpec, setCustomSceneSpec] = useState<Custom3DSceneSpec | null>(null);
  const [isGenerating3d, setIsGenerating3d] = useState(false);
  const [wireframe3D, setWireframe3D] = useState(false);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);
  const [active3DProvider, setActive3DProvider] = useState<string>('Claude & Three.js');

  const handleGenerate3DModel = async (overridePrompt?: string) => {
    const targetPrompt = (overridePrompt || custom3dPrompt).trim();
    if (!targetPrompt) return;
    setIsGenerating3d(true);
    setGenerationNotice(null);
    try {
      const resp = await aiStudyClient.generate3DModel({
        concept: targetPrompt,
        contextText: activeDocument.overview || activeDocument.title,
      });
      if (resp?.sceneSpec) {
        setCustomSceneSpec(resp.sceneSpec);
        setGenerationNotice(resp.userFacingNotice || '3D Model synthesized successfully.');
        setActive3DProvider(
          resp.provider === 'anthropic_claude'
            ? 'Claude 3.5 Sonnet'
            : resp.provider === 'gemini'
            ? 'Gemini 3.8 Flash'
            : 'Procedural 3D Engine'
        );
      }
    } catch (err: any) {
      setGenerationNotice(err?.message || 'Failed to generate 3D model.');
    } finally {
      setIsGenerating3d(false);
    }
  };

  const sceneSpec = useMemo(
    () =>
      buildEducationalSceneSpec({
        topic: selectedTopic,
        category: sceneCategory,
      }),
    [selectedTopic, sceneCategory]
  );

  const [sceneParams, setSceneParams] = useState<Record<string, number>>({
    v0: 26,
    angleDeg: 45,
    gravity: 9.8,
    quadA: 1.0,
    quadB: -2.0,
    quadC: -3.0,
    bondScale: 1.1,
    vibrationAmp: 0.2,
    membraneOpacity: 35,
    organelleScale: 1.0,
  });

  const liveProjectile = useMemo(
    () =>
      computeProjectileKinematics({
        v0: sceneParams.v0 ?? 26,
        angleDeg: sceneParams.angleDeg ?? 45,
        gravity: sceneParams.gravity ?? 9.8,
      }),
    [sceneParams.v0, sceneParams.angleDeg, sceneParams.gravity]
  );

  const liveQuadratic = useMemo(
    () =>
      computeQuadraticProperties({
        a: sceneParams.quadA ?? 1,
        b: sceneParams.quadB ?? -2,
        c: sceneParams.quadC ?? -3,
      }),
    [sceneParams.quadA, sceneParams.quadB, sceneParams.quadC]
  );

  const activeVseprMolecule = VERIFIED_VSEPR_MOLECULES[selectedMoleculeId];

  useEffect(() => {
    if (subTab !== 'lab3d' || labViewMode !== '3d' || !canvasContainerRef.current) return;

    const container = canvasContainerRef.current;
    const width = container.clientWidth || 680;
    const height = 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0f172a);

    const camera = new THREE.PerspectiveCamera(48, width / height, 0.1, 120);
    camera.position.set(0, 3.2, 7.8);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    const gl = renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererStr = debugInfo
      ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      : '';
    const isSoftwareGl = /SwiftShader|llvmpipe|Software|Basic Render Driver/i.test(
      String(rendererStr)
    );

    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.enablePan = true;
    controls.screenSpacePanning = true;

    resetCameraRef.current = () => {
      camera.position.set(0, 3.2, 7.8);
      controls.target.set(0, 0, 0);
      controls.update();
    };

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.35);
    dirLight.position.set(6, 9, 6);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(10, 20, 0x334155, 0x1e293b);
    gridHelper.position.y = -1.6;
    scene.add(gridHelper);

    const rootGroup = new THREE.Group();
    scene.add(rootGroup);

    let projectileMarker: THREE.Mesh | null = null;
    const trajectoryWorldPoints: THREE.Vector3[] = [];

    if (sceneCategory === 'physics_projectile_3d') {
      // Ground platform
      const groundGeo = new THREE.BoxGeometry(8.6, 0.12, 2.6);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.7,
        metalness: 0.2,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.position.y = -1.55;
      rootGroup.add(ground);

      // Scale physical trajectory into [-3.6, +3.6] world space
      const maxX = Math.max(10, liveProjectile.rangeMeters);
      const maxY = Math.max(5, liveProjectile.maxHeightMeters);
      const scaleX = 7.0 / maxX;
      const scaleY = Math.min(3.2 / maxY, scaleX * 1.4);

      for (const pt of liveProjectile.trajectoryPoints) {
        const wx = -3.5 + pt.x * scaleX;
        const wy = -1.45 + pt.y * scaleY;
        trajectoryWorldPoints.push(new THREE.Vector3(wx, wy, 0));
      }

      if (trajectoryWorldPoints.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(trajectoryWorldPoints);
        const tubeGeo = new THREE.TubeGeometry(curve, 48, 0.06, 12, false);
        const tubeMat = new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          emissive: 0x0284c7,
          emissiveIntensity: 0.35,
          roughness: 0.25,
        });
        rootGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
      }

      // Launch velocity arrow v0
      const thetaRad = ((sceneParams.angleDeg ?? 45) * Math.PI) / 180;
      const vDir = new THREE.Vector3(Math.cos(thetaRad), Math.sin(thetaRad), 0).normalize();
      const arrow = new THREE.ArrowHelper(
        vDir,
        new THREE.Vector3(-3.5, -1.45, 0),
        1.7,
        0xfacc15,
        0.32,
        0.2
      );
      rootGroup.add(arrow);

      // Animated projectile sphere
      const ballGeo = new THREE.SphereGeometry(0.22, 24, 24);
      const ballMat = new THREE.MeshStandardMaterial({
        color: 0xf97316,
        roughness: 0.2,
        metalness: 0.3,
      });
      projectileMarker = new THREE.Mesh(ballGeo, ballMat);
      projectileMarker.position.copy(trajectoryWorldPoints[0] || new THREE.Vector3(-3.5, -1.45, 0));
      rootGroup.add(projectileMarker);
    } else if (sceneCategory === 'math_surface_3d') {
      // 3D surface mesh z = a*x^2 + b*y^2 + c*0.15
      const a = (sceneParams.quadA ?? 1.0) * 0.22;
      const b = (sceneParams.quadB ?? -2.0) * 0.14;
      const cShift = (sceneParams.quadC ?? 0) * 0.12;
      const segs = isSoftwareGl ? 24 : 36;
      const surfGeo = new THREE.PlaneGeometry(5.2, 5.2, segs, segs);
      surfGeo.rotateX(-Math.PI / 2);

      const posAttr = surfGeo.attributes.position;
      const colors: number[] = [];
      const colorTmp = new THREE.Color();

      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const z = posAttr.getZ(i);
        const y = a * x * x + b * z * z + cShift;
        posAttr.setY(i, Math.max(-1.5, Math.min(2.4, y)));

        const normH = Math.max(0, Math.min(1, (y + 1.5) / 3.8));
        colorTmp.setHSL(0.62 - normH * 0.48, 0.85, 0.52);
        colors.push(colorTmp.r, colorTmp.g, colorTmp.b);
      }
      surfGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      surfGeo.computeVertexNormals();

      const surfMat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        roughness: 0.3,
        metalness: 0.15,
      });
      const surfMesh = new THREE.Mesh(surfGeo, surfMat);
      rootGroup.add(surfMesh);

      const wireGeo = new THREE.WireframeGeometry(surfGeo);
      const wireMat = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
      });
      rootGroup.add(new THREE.LineSegments(wireGeo, wireMat));
    } else if (sceneCategory === 'chemistry_vsepr_3d') {
      const mol = VERIFIED_VSEPR_MOLECULES[selectedMoleculeId];
      const bondScale = sceneParams.bondScale ?? 1.1;

      const centerGeo = new THREE.SphereGeometry(mol.centralAtom.radius, 32, 32);
      const centerMat = new THREE.MeshStandardMaterial({
        color: mol.centralAtom.color,
        roughness: 0.22,
        metalness: 0.25,
      });
      rootGroup.add(new THREE.Mesh(centerGeo, centerMat));

      const bondMat = new THREE.MeshStandardMaterial({
        color: 0x94a3b8,
        roughness: 0.35,
        metalness: 0.4,
      });

      mol.ligands.forEach((lig) => {
        const dir = new THREE.Vector3(...lig.direction).normalize();
        const dist = 1.85 * bondScale;
        const pos = dir.clone().multiplyScalar(dist);

        const atomGeo = new THREE.SphereGeometry(lig.radius, 28, 28);
        const atomMat = new THREE.MeshStandardMaterial({
          color: lig.color,
          roughness: 0.2,
          metalness: 0.15,
        });
        const atomMesh = new THREE.Mesh(atomGeo, atomMat);
        atomMesh.position.copy(pos);
        rootGroup.add(atomMesh);

        // Cylinder bond(s)
        const offsets = lig.bondOrder === 2 ? [-0.09, 0.09] : [0];
        offsets.forEach((off) => {
          const bondGeo = new THREE.CylinderGeometry(0.065, 0.065, dist, 16);
          const bondMesh = new THREE.Mesh(bondGeo, bondMat);
          bondMesh.position.copy(pos.clone().multiplyScalar(0.5));
          bondMesh.position.y += off;
          bondMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          rootGroup.add(bondMesh);
        });
      });

      // Lone pair translucent lobes if present
      for (let lp = 0; lp < mol.lonePairsCount; lp++) {
        const lobeGeo = new THREE.SphereGeometry(0.32, 20, 20);
        lobeGeo.scale(0.8, 1.35, 0.8);
        const lobeMat = new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          transparent: true,
          opacity: 0.45,
          roughness: 0.2,
        });
        const lobe = new THREE.Mesh(lobeGeo, lobeMat);
        const angle = lp === 0 ? 0.45 : -0.45;
        lobe.position.set(Math.sin(angle) * 0.9, 1.15, Math.cos(angle) * 0.4);
        rootGroup.add(lobe);
      }
    } else {
      // biology_cell_3d: Eukaryotic Cell Cross-Section
      const opacity = (sceneParams.membraneOpacity ?? 35) / 100;
      const orgScale = sceneParams.organelleScale ?? 1.0;

      const membraneGeo = new THREE.SphereGeometry(
        2.5,
        32,
        32,
        0,
        Math.PI * 2,
        0,
        Math.PI * 0.72
      );
      const membraneMat = new THREE.MeshStandardMaterial({
        color: 0x10b981,
        transparent: true,
        opacity,
        roughness: 0.3,
        side: THREE.DoubleSide,
      });
      const membrane = new THREE.Mesh(membraneGeo, membraneMat);
      membrane.rotation.x = Math.PI * 0.18;
      rootGroup.add(membrane);

      // Nucleus + Nucleolus
      const nucleusGeo = new THREE.SphereGeometry(0.88 * orgScale, 28, 28);
      const nucleusMat = new THREE.MeshStandardMaterial({
        color: 0xa855f7,
        roughness: 0.28,
      });
      rootGroup.add(new THREE.Mesh(nucleusGeo, nucleusMat));

      // Mitochondria capsules
      const mitoCoords: Array<[number, number, number]> = [
        [1.45, 0.15, 0.8],
        [-1.35, -0.25, 0.9],
        [0.5, -0.9, -1.2],
      ];
      mitoCoords.forEach(([mx, my, mz]) => {
        const mitoGeo = new THREE.CapsuleGeometry(0.22 * orgScale, 0.42 * orgScale, 12, 20);
        const mitoMat = new THREE.MeshStandardMaterial({
          color: 0xef4444,
          roughness: 0.3,
        });
        const mito = new THREE.Mesh(mitoGeo, mitoMat);
        mito.position.set(mx, my, mz);
        mito.rotation.set(0.5, 0.3, 0.2);
        rootGroup.add(mito);
      });

      // Rough ER / Golgi torus rings
      const erGeo = new THREE.TorusGeometry(1.25 * orgScale, 0.08, 14, 42, Math.PI * 1.3);
      const erMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.35 });
      const erMesh = new THREE.Mesh(erGeo, erMat);
      erMesh.rotation.x = Math.PI / 2;
      rootGroup.add(erMesh);
    }

    if (sceneCategory === 'custom_ai_3d' && customSceneSpec?.meshes) {
      customSceneSpec.meshes.forEach((mesh) => {
        let geo: THREE.BufferGeometry;
        const a = mesh.args || [];
        switch (mesh.shape) {
          case 'box':
            geo = new THREE.BoxGeometry(a[0] || 0.6, a[1] || 0.6, a[2] || 0.6);
            break;
          case 'cylinder':
            geo = new THREE.CylinderGeometry(a[0] || 0.08, a[1] || 0.08, a[2] || 1, a[3] || 14);
            break;
          case 'torus':
            geo = new THREE.TorusGeometry(a[0] || 1.5, a[1] || 0.04, a[2] || 12, a[3] || 36);
            break;
          case 'cone':
            geo = new THREE.ConeGeometry(a[0] || 0.35, a[1] || 0.7, a[2] || 16);
            break;
          case 'capsule':
            geo = new THREE.CapsuleGeometry(a[0] || 0.2, a[1] || 0.4, 8, 16);
            break;
          case 'sphere':
          default:
            geo = new THREE.SphereGeometry(a[0] || 0.3, a[1] || 18, a[2] || 18);
            break;
        }

        const colorNum = parseInt((mesh.color || '#3b82f6').replace('#', '0x'), 16) || 0x3b82f6;
        const mat = new THREE.MeshStandardMaterial({
          color: colorNum,
          wireframe: wireframe3D || Boolean(mesh.wireframe),
          roughness: mesh.roughness ?? 0.35,
          metalness: mesh.metalness ?? 0.15,
          transparent: Boolean(mesh.transparent || (mesh.opacity !== undefined && mesh.opacity < 1)),
          opacity: mesh.opacity ?? 1.0,
        });

        const meshObj = new THREE.Mesh(geo, mat);
        if (Array.isArray(mesh.position)) {
          meshObj.position.set(mesh.position[0], mesh.position[1], mesh.position[2]);
        }
        if (Array.isArray(mesh.rotation)) {
          meshObj.rotation.set(mesh.rotation[0], mesh.rotation[1], mesh.rotation[2]);
        }
        if (Array.isArray(mesh.scale)) {
          meshObj.scale.set(mesh.scale[0], mesh.scale[1], mesh.scale[2]);
        }
        rootGroup.add(meshObj);
      });
    }

    let animFrame = 0;
    const clock = new THREE.Clock();

    const animate = () => {
      animFrame = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      if (autoRotate3D && sceneCategory !== 'physics_projectile_3d') {
        rootGroup.rotation.y = elapsed * 0.28;
      }

      if (
        sceneCategory === 'physics_projectile_3d' &&
        projectileMarker &&
        trajectoryWorldPoints.length > 1
      ) {
        const progress = (elapsed * 0.45) % 1;
        const floatIdx = progress * (trajectoryWorldPoints.length - 1);
        const idx0 = Math.floor(floatIdx);
        const idx1 = Math.min(trajectoryWorldPoints.length - 1, idx0 + 1);
        const alpha = floatIdx - idx0;
        projectileMarker.position.lerpVectors(
          trajectoryWorldPoints[idx0],
          trajectoryWorldPoints[idx1],
          alpha
        );
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(animFrame);
      pmremGenerator.dispose();
      renderer.dispose();
    };
  }, [
    subTab,
    labViewMode,
    sceneCategory,
    selectedMoleculeId,
    autoRotate3D,
    sceneParams,
    liveProjectile,
    customSceneSpec,
    wireframe3D,
  ]);

  /* =====================================================================
   * 3. MINI APP BUILDER (MiniAppSpec + Live Preview + Edit + Library)
   * ===================================================================== */
  const [miniAppPrompt, setMiniAppPrompt] = useState(
    'Projectile Range & Kinematics Calculator'
  );
  const [currentMiniApp, setCurrentMiniApp] = useState<MiniAppSpec>(() =>
    buildMiniAppSpecFromPrompt({
      promptOrTopic: 'Projectile Range & Kinematics Calculator',
      templateOverride: 'projectile_kinematics',
    })
  );
  const [miniAppInputs, setMiniAppInputs] = useState<Record<string, number>>({});
  const [miniAppEditMode, setMiniAppEditMode] = useState(false);
  const [miniAppQuizAnswers, setMiniAppQuizAnswers] = useState<Record<string, number>>({});

  useEffect(() => {
    const defaults: Record<string, number> = {};
    for (const inp of currentMiniApp.inputs) {
      defaults[inp.id] = inp.defaultValue;
    }
    setMiniAppInputs(defaults);
    setMiniAppQuizAnswers({});
  }, [currentMiniApp.id]);

  const evaluatedMiniAppOutputs = useMemo(
    () => evaluateMiniAppFormulas(currentMiniApp, miniAppInputs),
    [currentMiniApp, miniAppInputs]
  );

  const handleGenerateMiniApp = (
    templateOverride?: MiniAppSpec['templateId'],
    promptText?: string
  ) => {
    const spec = buildMiniAppSpecFromPrompt({
      promptOrTopic: promptText || miniAppPrompt || selectedTopic,
      templateOverride,
    });
    setCurrentMiniApp(spec);
  };

  /* =====================================================================
   * 4. VISUALIZE CONCEPT (Nano Banana 2.1 + Deterministic SVG Diagram)
   * ===================================================================== */
  const [visualConceptInput, setVisualConceptInput] = useState(selectedTopic);
  const [visualStyle, setVisualStyle] = useState<
    'educational_diagram' | 'flowchart' | 'comparison_chart'
  >('educational_diagram');
  const [visualResult, setVisualResult] = useState<VisualizeConceptResponse | null>(null);
  const [isVisualizing, setIsVisualizing] = useState(false);

  /* =====================================================================
   * 5. AI VIDEO LESSONS & IMAGE-TO-VIDEO + DETERMINISTIC ANIMATED EXPLANATION
   * ===================================================================== */
  const [videoTopicInput, setVideoTopicInput] = useState(selectedTopic);
  const [videoAspectRatio, setVideoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [videoSourceImage, setVideoSourceImage] = useState<string | undefined>(undefined);
  const [videoResult, setVideoResult] = useState<VideoLessonResponse | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [activeSceneIdx, setActiveSceneIdx] = useState(0);
  const [isPlayingStoryboard, setIsPlayingStoryboard] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(0.65);

  useEffect(() => {
    setVisualConceptInput(selectedTopic);
    setVideoTopicInput(selectedTopic);
  }, [selectedTopic]);

  useEffect(() => {
    if (!isPlayingStoryboard) return;
    const interval = setInterval(() => {
      setAnimationProgress((p) => (p >= 1 ? 0.05 : Number((p + 0.025).toFixed(3))));
    }, 60);
    return () => clearInterval(interval);
  }, [isPlayingStoryboard]);

  const handleRunVisualize = async () => {
    setIsVisualizing(true);
    try {
      const contextText = activeDocument.pages
        .slice(0, 2)
        .map((p) => p.content)
        .join('\n');
      const res = await aiStudyClient.visualizeConcept({
        concept: visualConceptInput,
        contextText,
        style: visualStyle,
      });
      setVisualResult(res);
    } finally {
      setIsVisualizing(false);
    }
  };

  const handleRunVideoLesson = async () => {
    setIsGeneratingVideo(true);
    setActiveSceneIdx(0);
    try {
      const contextText = activeDocument.pages
        .slice(0, 2)
        .map((p) => p.content)
        .join('\n');
      const res = await aiStudyClient.generateVideoLesson({
        topic: videoTopicInput,
        contextText,
        aspectRatio: videoAspectRatio,
        sourceImageDataUrl: videoSourceImage,
      });
      setVideoResult(res);
      setAnimationProgress(0.65);
    } finally {
      setIsGeneratingVideo(false);
    }
  };

  const handleUploadVideoSourceImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setVideoSourceImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const savedMiniApps = savedAssets.filter((a) => a.type === 'mini_app');

  return (
    <div className="max-w-[1340px] mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-6">
      {/* Editorial Header matching Image 6 ("Turn handwritten notes into clean study material.") */}
      <div className="space-y-4 border-b border-[#E8E6E2] pb-0">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 pb-2">
          <div className="space-y-1.5">
            <div className="lm-kicker">NOTEBOOK &amp; SCANNER</div>
            <h1 className="lm-editorial-title text-4xl sm:text-5xl">
              Turn handwritten notes into clean study material.
            </h1>
            <p className="lm-editorial-subtitle text-base sm:text-lg text-[#4B5563]">
              Scan handwritten pages, record voice notes, build interactive simulations, and keep everything organized in one place.
            </p>
          </div>

          {/* Material & Topic Selector */}
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-end">
            <select
              aria-label="Select active study document for studio"
              value={activeDocument.id}
              onChange={(e) => onSelectDocument(e.target.value)}
              className="px-3 py-2 rounded-lg border border-[#E8E6E2] bg-white text-xs font-medium text-[#121827]"
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.title}
                </option>
              ))}
            </select>

            <select
              aria-label="Select topic for studio creation"
              value={selectedTopic}
              onChange={(e) => setSelectedTopic(e.target.value)}
              className="px-3 py-2 rounded-lg border border-[#E8E6E2] bg-white text-xs font-medium text-[#121827]"
            >
              {activeDocument.topics.map((t) => (
                <option key={t.id} value={t.name}>
                  Topic: {t.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Canonical Editorial Tabs matching Image 6 + Interactive STEM Studio Tabs */}
        <div className="flex items-center gap-6 overflow-x-auto">
          {(
            [
              { id: 'scan', label: 'Scan Notes' },
              { id: 'voice', label: 'Record Voice Note' },
              { id: 'notebook', label: 'My Notebook' },
              { id: 'planner', label: 'Study Planner' },
              { id: 'games', label: 'PlayLab Games' },
              { id: 'lab3d', label: 'Concept 3D Lab' },
              { id: 'miniapp', label: 'Mini App Builder' },
              { id: 'visualize', label: 'Visualize Concept' },
              { id: 'videolesson', label: 'AI Video Lessons' },
              { id: 'saved', label: `Saved (${savedAssets.length})` },
            ] as const
          ).map((item) => {
            const active = subTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (
                    (item.id === 'voice' || item.id === 'notebook' || item.id === 'planner') &&
                    onOpenNotebookModal
                  ) {
                    onOpenNotebookModal(item.id);
                    return;
                  }
                  setSubTab(item.id as StudioSubTab);
                }}
                data-testid={`studio-tab-${item.id}`}
                className={`relative pb-3 pt-1 text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active ? 'text-[#C84428] font-semibold' : 'text-[#606B7C] hover:text-[#121827]'
                }`}
              >
                <span>{item.label}</span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-t-full bg-[#C84428]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {saveToast && (
        <div className="p-3 rounded-xl bg-[#E2F5EA] border border-[#2E7D52]/30 text-[#2E7D52] text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{saveToast}</span>
        </div>
      )}

      {/* =====================================================================
       * 0. SCAN NOTES — SIDE-BY-SIDE HANDWRITTEN OCR WORKSPACE (Image 6)
       * ===================================================================== */}
      {subTab === 'scan' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Left Panel: 1. Original Note (Scanned) matching Image 6 */}
          <div className="lg:col-span-5 lm-card-editorial p-6 flex flex-col justify-between space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#121827]">
                1. Original Note (Scanned)
              </h2>
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-[#606B7C] hover:text-[#121827] cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#C84428]" />
                <span>Replace image</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleScanUploadFile}
                  className="hidden"
                />
              </label>
            </div>

            {/* Warm Ruled Handwritten Page Preview matching Image 6 */}
            <div className="rounded-xl bg-[#F4EFE6] border border-[#E2DACB] p-4 flex items-center justify-center flex-1">
              {scannedUploadedPreview ? (
                <img
                  src={scannedUploadedPreview}
                  alt="Scanned handwritten note"
                  className="max-h-[420px] w-auto rounded-lg shadow-sm object-contain"
                />
              ) : (
                <div
                  className="w-full max-w-[360px] rounded-lg bg-[#FBF7EE] border border-[#DFD5C3] p-5 shadow-sm space-y-3 text-[#2B303A]"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(to bottom, transparent 0px, transparent 25px, rgba(180, 168, 148, 0.28) 26px)',
                  }}
                >
                  <div className="lm-sticky-font text-xl font-bold underline decoration-[#2B303A]/50">
                    Probability Notes - Lecture 3
                  </div>

                  <div className="lm-sticky-font text-[15px] leading-snug space-y-1">
                    <div className="font-bold">1) Conditional Probability</div>
                    <div className="pl-3 font-semibold">
                      P(A | B) = P(A ∩ B) / P(B), &nbsp; P(B) &gt; 0
                    </div>
                    <div className="text-xs text-[#4B5563]">
                      → Probability of A given B has occurred.
                    </div>
                  </div>

                  <div className="rounded-md border border-[#C7BCA8] bg-[#F6EFE2]/80 p-2.5 lm-sticky-font text-[14px] leading-snug space-y-0.5">
                    <div className="font-bold">Ex: Rolling a fair die</div>
                    <div>A = &#123;roll is 2&#125;</div>
                    <div>B = &#123;roll is even&#125; = &#123;2, 4, 6&#125;</div>
                    <div className="font-bold">P(A | B) = 1 / 3</div>
                  </div>

                  <div className="lm-sticky-font text-[15px] leading-snug space-y-1 pt-1">
                    <div className="font-bold">2) Multiplication Rule</div>
                    <div className="pl-3 font-semibold">P(A ∩ B) = P(A | B) · P(B)</div>
                  </div>

                  <div className="lm-sticky-font text-[15px] leading-snug space-y-1 pt-1">
                    <div className="font-bold">3) Independent Events</div>
                    <div className="pl-3">
                      P(A | B) = P(A) &nbsp;or&nbsp; P(A ∩ B) = P(A)P(B)
                    </div>
                    <div className="text-xs text-[#4B5563]">
                      • Occurrence of one does not affect the other.
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-xs text-[#606B7C] pt-1">
              <span>Page 1 of 1 &nbsp;·&nbsp; Scanned today, 3:15 PM</span>
              {isScanningOcr && (
                <span className="text-[#C84428] font-medium">Running Gemini Vision OCR...</span>
              )}
            </div>
          </div>

          {/* Right Panel: 2. Cleaned Digital Output matching Image 6 */}
          <div className="lg:col-span-7 lm-card-editorial p-6 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-sm font-semibold text-[#121827]">
                    2. Cleaned Digital Output
                  </h2>
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#E2F5EA] text-[#2E7D52] text-[11px] font-semibold">
                    <span>Extracted</span>
                    <CheckCircle2 className="w-3 h-3" />
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSaveToast('Formatted equations and headings for study export.');
                      setTimeout(() => setSaveToast(null), 2500);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E8E6E2] bg-[#FCFBF9] hover:bg-[#F2EAE4] text-xs font-medium text-[#121827] cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-[#C84428]" />
                    <span>Clean Notes</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (onGenerateFlashcardsFromNotes) {
                        onGenerateFlashcardsFromNotes();
                      } else {
                        handleSaveScannedToNotebook();
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#FCFBF9] text-xs font-medium text-[#121827] cursor-pointer"
                  >
                    <span>Generate Flashcards</span>
                  </button>
                </div>
              </div>

              {/* Structured Digital Output Document Card */}
              <div className="rounded-xl border border-[#E8E6E2] bg-[#FCFBF9]/60 p-6 space-y-5">
                <div className="flex items-center justify-between border-b border-[#E8E6E2] pb-3">
                  <h3 className="font-serif-editorial text-2xl font-bold text-[#121827]">
                    {scannedDocTitle}
                  </h3>
                  <span className="text-xs text-[#606B7C]">Edit</span>
                </div>

                <div className="space-y-5">
                  {cleanedNotesSections.map((sec, idx) => (
                    <div key={idx} className="space-y-2">
                      <h4 className="font-serif-editorial text-base font-bold text-[#121827]">
                        {sec.heading}
                      </h4>
                      {sec.formula && (
                        <div className="px-4 py-2.5 rounded-lg bg-[#F5F2EB] border border-[#E8E6E2] font-serif-editorial italic text-base text-[#121827]">
                          {sec.formula}
                        </div>
                      )}
                      <p className="text-sm text-[#3D4655] leading-relaxed">{sec.body}</p>
                      {sec.example && (
                        <div className="p-3.5 rounded-lg bg-white border border-[#E8E6E2] text-xs text-[#121827] whitespace-pre-line leading-relaxed">
                          {sec.example}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Bottom Action Bar matching Image 6 */}
            <div className="pt-3 border-t border-[#F2F0EC] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const text = cleanedNotesSections
                      .map((s) => `${s.heading}\n${s.formula || ''}\n${s.body}`)
                      .join('\n\n');
                    void navigator.clipboard?.writeText(text);
                    setSaveToast('Copied cleaned notes to clipboard.');
                    setTimeout(() => setSaveToast(null), 2200);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#FCFBF9] text-xs font-medium text-[#121827] cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5 text-[#606B7C]" />
                  <span>Copy Text</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const text = cleanedNotesSections
                      .map((s) => `${s.heading}\n${s.formula || ''}\n${s.body}`)
                      .join('\n\n');
                    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${scannedDocTitle.replace(/\s+/g, '_')}.txt`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#E8E6E2] bg-white hover:bg-[#FCFBF9] text-xs font-medium text-[#121827] cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-[#606B7C]" />
                  <span>Export</span>
                </button>
              </div>

              <button
                type="button"
                onClick={handleSaveScannedToNotebook}
                data-testid="save-scanned-to-notebook-btn"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg lm-btn-accent text-xs font-semibold cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Save to Notebook</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
       * 1. PLAYLAB — 2D EDUCATIONAL GAMES
       * ===================================================================== */}
      {subTab === 'games' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">{gameSpec.title}</h2>
              <p className="text-xs text-[#64748B]">{gameSpec.learningObjective}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Programming'] as EducationalSubject[]
              ).map((subj) => (
                <button
                  key={subj}
                  type="button"
                  onClick={() => setSelectedGameSubject(subj)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    selectedGameSubject === subj
                      ? 'bg-[#1A73E8] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  {subj}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setGamePlayMode('rounds')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  gamePlayMode === 'rounds'
                    ? 'bg-[#172033] text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                Interactive Challenge Rounds ({gameSpec.rounds.length})
              </button>
              <button
                type="button"
                onClick={() => setGamePlayMode('matching')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  gamePlayMode === 'matching'
                    ? 'bg-[#172033] text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                Concept & Formula Match Grid ({gameSpec.matchingPairs.length})
              </button>
            </div>

            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-bold">
                <Trophy className="w-3.5 h-3.5 text-amber-600" />
                <span>Score: {gameScore} XP</span>
                <span className="text-amber-700">• Streak: {gameStreak}🔥</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMatchedIds([]);
                  setSelectedOptionIdx(null);
                  setActiveRoundIdx(0);
                  setGameScore(0);
                  setGameStreak(0);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSaveCreativeAsset('game_2d', gameSpec.title, {
                    subject: gameSpec.subject,
                    score: gameScore,
                    topic: selectedTopic,
                  })
                }
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#E8F0FE] text-[#1A73E8] text-xs font-semibold cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Save Game</span>
              </button>
            </div>
          </div>

          {gamePlayMode === 'rounds' && currentRound ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Left: Question & Options */}
              <div className="lg:col-span-7 p-5 rounded-2xl bg-[#F8FAFC] border border-slate-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#1A73E8]">
                    Round {activeRoundIdx + 1} of {gameSpec.rounds.length} • {gameSpec.subject}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {gameSpec.rounds.map((r, idx) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => {
                          setActiveRoundIdx(idx);
                          setSelectedOptionIdx(null);
                          setShowRoundHint(false);
                        }}
                        className={`w-7 h-7 rounded-lg text-xs font-bold cursor-pointer ${
                          activeRoundIdx === idx
                            ? 'bg-[#1A73E8] text-white'
                            : 'bg-white border border-slate-200 text-slate-600'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-sm sm:text-base font-bold text-[#172033] leading-snug">
                  {currentRound.prompt}
                </p>

                <div className="p-3 rounded-xl bg-slate-900 text-sky-300 font-mono text-xs flex items-center justify-between">
                  <span>{currentRound.formulaOrCode}</span>
                  <button
                    type="button"
                    onClick={() => setShowRoundHint((h) => !h)}
                    className="inline-flex items-center gap-1 text-[11px] font-sans font-semibold text-amber-300 hover:underline cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>{showRoundHint ? 'Hide Hint' : 'Need a Hint?'}</span>
                  </button>
                </div>

                {showRoundHint && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
                    <strong>Hint:</strong> {currentRound.hint}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {currentRound.options.map((opt, idx) => {
                    const isPicked = selectedOptionIdx === idx;
                    const isCorrect = idx === currentRound.correctIndex;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => handleSelectRoundOption(idx)}
                        className={`p-3.5 rounded-xl border text-left text-xs font-semibold transition-all cursor-pointer ${
                          selectedOptionIdx !== null
                            ? isCorrect
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                              : isPicked
                              ? 'bg-red-50 border-red-300 text-red-800'
                              : 'bg-white border-slate-200 text-slate-500'
                            : 'bg-white border-slate-200 hover:border-[#4285F4] text-[#172033]'
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {selectedOptionIdx !== null && (
                  <div className="p-4 rounded-xl bg-blue-50/90 border border-blue-200 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#1A73E8]">
                        {selectedOptionIdx === currentRound.correctIndex
                          ? '✓ Correct! +100 XP'
                          : 'Review Step-by-Step Solution:'}
                      </span>
                      {activeRoundIdx < gameSpec.rounds.length - 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveRoundIdx((i) => i + 1);
                            setSelectedOptionIdx(null);
                            setShowRoundHint(false);
                          }}
                          className="px-3 py-1 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold cursor-pointer"
                        >
                          Next Round →
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-[#172033] leading-relaxed">
                      {currentRound.stepByStepExplanation}
                    </p>
                  </div>
                )}
              </div>

              {/* Right: Interactive Visual Verification Sandbox for the Round */}
              <div className="lg:col-span-5 p-5 rounded-2xl bg-slate-900 text-white space-y-3 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400 block">
                    Interactive Round Simulator & Visual Proof
                  </span>
                  <p className="text-xs text-slate-300 mt-0.5">{currentRound.visualHint}</p>
                </div>

                {gameSpec.subject === 'Physics' ? (
                  <div className="space-y-3">
                    <svg
                      viewBox="0 0 320 140"
                      className="w-full h-36 bg-slate-950 rounded-xl border border-slate-800"
                    >
                      <line x1="20" y1="120" x2="300" y2="120" stroke="#334155" strokeWidth="2" />
                      {/* Target marker at 40m */}
                      <circle cx={20 + 40 * 3.2} cy="120" r="6" fill="#ef4444" />
                      <text x={20 + 40 * 3.2 - 18} y="134" fill="#fca5a5" fontSize="9">
                        Target 40m
                      </text>
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="2.5"
                        points={sandboxProjectile.trajectoryPoints
                          .map(
                            (p) =>
                              `${(20 + p.x * 3.2).toFixed(1)},${Math.max(
                                12,
                                120 - p.y * 3.2
                              ).toFixed(1)}`
                          )
                          .join(' ')}
                      />
                    </svg>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <label className="block space-y-1">
                        <span className="text-slate-300">
                          Speed v₀: <strong>{sandboxSpeedV0} m/s</strong>
                        </span>
                        <input
                          type="range"
                          min={10}
                          max={35}
                          value={sandboxSpeedV0}
                          onChange={(e) => setSandboxSpeedV0(Number(e.target.value))}
                          className="w-full accent-[#38bdf8]"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-slate-300">
                          Angle θ: <strong>{sandboxAngleDeg}°</strong>
                        </span>
                        <input
                          type="range"
                          min={15}
                          max={75}
                          value={sandboxAngleDeg}
                          onChange={(e) => setSandboxAngleDeg(Number(e.target.value))}
                          className="w-full accent-[#38bdf8]"
                        />
                      </label>
                    </div>
                    <div className="flex items-center justify-between text-xs bg-slate-800/90 px-3 py-2 rounded-xl">
                      <span>
                        Range R: <strong className="text-emerald-400">{sandboxProjectile.rangeMeters} m</strong>
                      </span>
                      <span>
                        Apex H: <strong className="text-amber-300">{sandboxProjectile.maxHeightMeters} m</strong>
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                    <div className="text-xs font-mono text-emerald-400">
                      Governing Rule: {currentRound.formulaOrCode}
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {gameSpec.instructions}
                    </p>
                  </div>
                )}

                <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-slate-800 pt-2.5">
                  <span>{gameSpec.scoringRule}</span>
                  <span>Difficulty: {difficulty.toUpperCase()}</span>
                </div>
              </div>
            </div>
          ) : (
            /* Matching Grid Mode */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] block">
                  1. Select Concept / Theorem
                </span>
                {gameSpec.matchingPairs.map((pair) => {
                  const isMatched = matchedIds.includes(pair.id);
                  const isSelected = selectedLeftId === pair.id;
                  return (
                    <button
                      key={pair.id}
                      type="button"
                      disabled={isMatched}
                      onClick={() => setSelectedLeftId(pair.id)}
                      className={`w-full p-3.5 rounded-2xl border text-left text-xs font-semibold transition-all flex items-center justify-between cursor-pointer ${
                        isMatched
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 opacity-75'
                          : isSelected
                          ? 'bg-[#E8F0FE] border-[#4285F4] text-[#1A73E8] ring-2 ring-[#4285F4]/20'
                          : 'bg-[#F8FAFC] border-slate-200 hover:border-slate-300 text-[#172033]'
                      }`}
                    >
                      <span>{pair.term}</span>
                      {isMatched && <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] block">
                  2. Match Verified Formula / Mechanism
                </span>
                {[...gameSpec.matchingPairs].reverse().map((pair) => {
                  const isMatched = matchedIds.includes(pair.id);
                  return (
                    <button
                      key={pair.id}
                      type="button"
                      disabled={isMatched}
                      onClick={() => handleMatchRightClick(pair.id)}
                      className={`w-full p-3.5 rounded-2xl border text-left text-xs transition-all cursor-pointer ${
                        isMatched
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-800 font-semibold opacity-75'
                          : 'bg-white border-slate-200 hover:border-[#4285F4] text-[#334155]'
                      }`}
                    >
                      {pair.match}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
       * 2. CONCEPT 3D LAB + 2D MATHEMATICAL / PHYSICS PLOTTER
       * ===================================================================== */}
      {subTab === 'lab3d' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">{sceneSpec.title}</h2>
              <p className="text-xs text-[#64748B]">{sceneSpec.summary}</p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(
                [
                  { id: 'physics_projectile_3d', label: 'Physics: Projectile Trajectory' },
                  { id: 'math_surface_3d', label: 'Math: 3D Surface & 2D Parabola' },
                  { id: 'chemistry_vsepr_3d', label: 'Chemistry: VSEPR Molecules' },
                  { id: 'biology_cell_3d', label: 'Biology: 3D Eukaryotic Cell' },
                  { id: 'custom_ai_3d', label: '✨ AI 3D Model Creator' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setSceneCategory(preset.id);
                    if (preset.id === 'custom_ai_3d' && !customSceneSpec) {
                      handleGenerate3DModel('DNA Double Helix');
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                    sceneCategory === preset.id
                      ? 'bg-[#1A73E8] text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200/70'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {sceneCategory === 'custom_ai_3d' && (
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50/80 via-purple-50/50 to-amber-50/60 border border-indigo-100/90 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-indigo-600 text-white shadow-2xs">
                    AI 3D Model Creator
                  </span>
                  <span className="text-xs text-indigo-950 font-medium">
                    Powered by {active3DProvider}
                  </span>
                </div>
                {generationNotice && (
                  <span className="text-xs font-medium text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
                    {generationNotice}
                  </span>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  type="text"
                  value={custom3dPrompt}
                  onChange={(e) => setCustom3dPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleGenerate3DModel();
                  }}
                  placeholder="Describe any scientific concept or 3D structure (e.g. DNA Double Helix, Bohr Atom, Solar System, NaCl Lattice)..."
                  className="flex-1 px-4 py-2.5 rounded-xl border border-indigo-200 bg-white text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  type="button"
                  disabled={isGenerating3d || !custom3dPrompt.trim()}
                  onClick={() => handleGenerate3DModel()}
                  className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm transition-all"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isGenerating3d ? 'animate-spin' : ''}`} />
                  {isGenerating3d ? 'Synthesizing 3D Model...' : 'Generate 3D Model'}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-slate-500 mr-1">Quick Concepts:</span>
                {[
                  'DNA Double Helix',
                  'Bohr Atom Model',
                  'Solar System Orbits',
                  'NaCl Crystal Lattice',
                  'Carnot Engine Core',
                ].map((concept) => (
                  <button
                    key={concept}
                    type="button"
                    onClick={() => {
                      setCustom3dPrompt(concept);
                      handleGenerate3DModel(concept);
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white hover:bg-indigo-50 border border-indigo-100 text-indigo-900 transition-colors cursor-pointer"
                  >
                    {concept}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Toolbar for 3D vs 2D Plot, Molecule switcher, Reset View, Toggle Labels */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 border border-slate-200/80">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLabViewMode('3d')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  labViewMode === '3d'
                    ? 'bg-[#172033] text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                3D Interactive WebGL View
              </button>
              <button
                type="button"
                onClick={() => setLabViewMode('2d')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer ${
                  labViewMode === '2d'
                    ? 'bg-[#172033] text-white'
                    : 'bg-white border border-slate-200 text-slate-700'
                }`}
              >
                2D Exact Coordinate Plot & Diagram
              </button>

              {sceneCategory === 'chemistry_vsepr_3d' && (
                <div className="flex items-center gap-1 ml-2 pl-2 border-l border-slate-200">
                  {(['CH4', 'H2O', 'CO2', 'NH3'] as const).map((molId) => (
                    <button
                      key={molId}
                      type="button"
                      onClick={() => setSelectedMoleculeId(molId)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer ${
                        selectedMoleculeId === molId
                          ? 'bg-emerald-600 text-white'
                          : 'bg-white border border-slate-200 text-slate-700'
                      }`}
                    >
                      {VERIFIED_VSEPR_MOLECULES[molId].formula}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {labViewMode === '3d' && (
                <>
                  <button
                    type="button"
                    onClick={() => setAutoRotate3D((r) => !r)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    {autoRotate3D ? 'Pause Orbit' : 'Auto-Orbit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setWireframe3D((w) => !w)}
                    className={`px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer ${
                      wireframe3D
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white border-slate-200 text-slate-700'
                    }`}
                  >
                    {wireframe3D ? 'Wireframe: ON' : 'Wireframe: OFF'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShow3DLabels((l) => !l)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    {show3DLabels ? 'Hide Labels' : 'Show Labels'}
                  </button>
                  <button
                    type="button"
                    onClick={() => resetCameraRef.current?.()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset View</span>
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() =>
                  handleSaveCreativeAsset(
                    'lab_3d',
                    sceneCategory === 'custom_ai_3d' && customSceneSpec ? customSceneSpec.title : sceneSpec.title,
                    {
                      sceneCategory,
                      sceneParams,
                      selectedMoleculeId,
                      customSceneSpec,
                    }
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#E8F0FE] text-[#1A73E8] text-xs font-semibold cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Save Lab</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Viewport Column */}
            <div className="lg:col-span-8 relative">
              {labViewMode === '3d' ? (
                <div className="relative rounded-2xl overflow-hidden border border-slate-800 bg-slate-900">
                  <div
                    ref={canvasContainerRef}
                    data-testid="concept-3d-canvas-container"
                    className="w-full h-[400px]"
                  />
                  {/* Solid non-blur HUD overlay (compliant with Three.js skill: no backdrop-filter over WebGL) */}
                  <div className="absolute bottom-3 left-3 bg-slate-900/90 text-white px-3 py-1.5 rounded-xl text-[11px] border border-slate-700">
                    Drag to rotate • Scroll to zoom • Right-drag to pan
                  </div>
                  {show3DLabels && (
                    <div className="absolute top-3 left-3 right-3 flex flex-wrap gap-2 pointer-events-none">
                      {sceneSpec.labels.map((lbl) => (
                        <div
                          key={lbl.id}
                          className="bg-slate-900/95 border border-slate-700 px-3 py-1.5 rounded-xl text-xs text-white shadow-sm"
                        >
                          <span className="font-bold text-sky-400">{lbl.title}:</span>{' '}
                          <span className="font-mono text-[11px] text-amber-300">
                            {lbl.formulaOrAngle}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* 2D Exact Mathematical / Scientific Coordinate Plot */
                <div className="p-5 rounded-2xl bg-slate-900 text-white border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                      2D Exact Coordinate Plot — {sceneSpec.title}
                    </span>
                    <span className="text-xs font-mono text-amber-300">
                      {sceneSpec.governingEquations[0]}
                    </span>
                  </div>

                  {sceneCategory === 'physics_projectile_3d' && (
                    <svg
                      viewBox="0 0 520 240"
                      className="w-full h-64 bg-slate-950 rounded-xl border border-slate-800"
                    >
                      <line x1="40" y1="205" x2="490" y2="205" stroke="#475569" strokeWidth="2" />
                      <line x1="40" y1="20" x2="40" y2="205" stroke="#475569" strokeWidth="2" />
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3"
                        points={liveProjectile.trajectoryPoints
                          .map((p) => {
                            const maxR = Math.max(25, liveProjectile.rangeMeters);
                            const maxH = Math.max(12, liveProjectile.maxHeightMeters);
                            const sx = 40 + (p.x / maxR) * 420;
                            const sy = 205 - (p.y / maxH) * 160;
                            return `${sx.toFixed(1)},${sy.toFixed(1)}`;
                          })
                          .join(' ')}
                      />
                      <text x="50" y="38" fill="#facc15" fontSize="12" fontWeight="bold">
                        Apex H_max = {liveProjectile.maxHeightMeters} m | Range R ={' '}
                        {liveProjectile.rangeMeters} m | Flight Time T ={' '}
                        {liveProjectile.flightTimeSeconds} s
                      </text>
                    </svg>
                  )}

                  {sceneCategory === 'math_surface_3d' && (
                    <svg
                      viewBox="0 0 520 240"
                      className="w-full h-64 bg-slate-950 rounded-xl border border-slate-800"
                    >
                      {/* Coordinate axes */}
                      <line x1="40" y1="120" x2="480" y2="120" stroke="#475569" strokeWidth="1.5" />
                      <line x1="260" y1="15" x2="260" y2="225" stroke="#475569" strokeWidth="1.5" />
                      {/* Parabola curve y = a*x^2 + b*x + c */}
                      <polyline
                        fill="none"
                        stroke="#a855f7"
                        strokeWidth="3"
                        points={liveQuadratic.sampledPoints
                          .map((pt) => {
                            const sx = 260 + pt.x * 36;
                            const sy = Math.max(10, Math.min(230, 120 - pt.y * 12));
                            return `${sx.toFixed(1)},${sy.toFixed(1)}`;
                          })
                          .join(' ')}
                      />
                      {/* Vertex dot */}
                      <circle
                        cx={260 + liveQuadratic.vertexX * 36}
                        cy={Math.max(12, Math.min(228, 120 - liveQuadratic.vertexY * 12))}
                        r="5"
                        fill="#facc15"
                      />
                      <text x="48" y="34" fill="#e2e8f0" fontSize="12" fontWeight="bold">
                        y = ({liveQuadratic.a})x² + ({liveQuadratic.b})x + ({liveQuadratic.c}) •
                        Vertex ({liveQuadratic.vertexX}, {liveQuadratic.vertexY}) • Δ ={' '}
                        {liveQuadratic.discriminant}
                      </text>
                      <text x="48" y="54" fill="#38bdf8" fontSize="11">
                        {liveQuadratic.rootsDescription}
                      </text>
                    </svg>
                  )}

                  {sceneCategory === 'chemistry_vsepr_3d' && (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                      <div className="text-base font-bold text-white">
                        {activeVseprMolecule.name} ({activeVseprMolecule.formula}) —{' '}
                        <span className="text-emerald-400">{activeVseprMolecule.geometryName}</span>
                      </div>
                      <p className="text-xs text-slate-300">{activeVseprMolecule.description}</p>
                      <div className="flex flex-wrap gap-3 pt-2 text-xs font-mono text-amber-300">
                        <span>Equilibrium Angle: {activeVseprMolecule.bondAngleDeg}°</span>
                        <span>Hybridization: {activeVseprMolecule.hybridization}</span>
                        <span>Lone Pairs: {activeVseprMolecule.lonePairsCount}</span>
                      </div>
                    </div>
                  )}

                  {sceneCategory === 'biology_cell_3d' && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {sceneSpec.labels.map((lbl, idx) => (
                        <button
                          key={lbl.id}
                          type="button"
                          onClick={() => setSelectedOrganelleIdx(idx)}
                          className={`p-3.5 rounded-xl border text-left cursor-pointer ${
                            selectedOrganelleIdx === idx
                              ? 'bg-slate-800 border-sky-400 text-white'
                              : 'bg-slate-950 border-slate-800 text-slate-300'
                          }`}
                        >
                          <div className="text-xs font-bold text-sky-400">{lbl.title}</div>
                          <div className="text-[11px] text-amber-300 mt-0.5">
                            {lbl.formulaOrAngle}
                          </div>
                          <p className="text-xs text-slate-300 mt-1.5">{lbl.description}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Real-Time Parameter Controls & Calculated Readouts */}
            <div className="lg:col-span-4 p-5 rounded-2xl bg-[#F8FAFC] border border-slate-200/80 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#1A73E8]">
                <Sliders className="w-4 h-4" />
                <span>Real-Time Parameter Controls</span>
              </div>

              <div className="space-y-3">
                {sceneSpec.parameterControls.map((ctrl) => {
                  const val = sceneParams[ctrl.id] ?? ctrl.defaultValue;
                  return (
                    <label key={ctrl.id} className="block space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#172033]">
                        <span>{ctrl.label}</span>
                        <span className="font-mono text-[#1A73E8]">
                          {val} {ctrl.unit}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={ctrl.min}
                        max={ctrl.max}
                        step={ctrl.step}
                        value={val}
                        onChange={(e) =>
                          setSceneParams((prev) => ({
                            ...prev,
                            [ctrl.id]: Number(e.target.value),
                          }))
                        }
                        className="w-full accent-[#1A73E8]"
                      />
                    </label>
                  );
                })}
              </div>

              {/* Live Mathematical Readout Card */}
              {sceneCategory === 'physics_projectile_3d' && (
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs">
                  <div className="font-bold text-[#172033]">Live Kinematics Readout</div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Horizontal Range R:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {liveProjectile.rangeMeters} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Max Height H_max:</span>
                    <span className="font-mono font-bold text-[#1A73E8]">
                      {liveProjectile.maxHeightMeters} m
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Flight Time T:</span>
                    <span className="font-mono font-bold text-amber-700">
                      {liveProjectile.flightTimeSeconds} s
                    </span>
                  </div>
                </div>
              )}

              {sceneCategory === 'math_surface_3d' && (
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs">
                  <div className="font-bold text-[#172033]">Live Quadratic & Surface Readout</div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">2D Vertex (h, k):</span>
                    <span className="font-mono font-bold text-[#1A73E8]">
                      ({liveQuadratic.vertexX}, {liveQuadratic.vertexY})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Discriminant Δ:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {liveQuadratic.discriminant}
                    </span>
                  </div>
                  <div className="text-[11px] text-[#64748B] pt-1">
                    {liveQuadratic.rootsDescription}
                  </div>
                </div>
              )}

              {sceneCategory === 'chemistry_vsepr_3d' && (
                <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1.5 text-xs">
                  <div className="font-bold text-[#172033]">
                    {activeVseprMolecule.name} ({activeVseprMolecule.formula})
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">VSEPR Geometry:</span>
                    <span className="font-semibold text-[#1A73E8]">
                      {activeVseprMolecule.geometryName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Verified Bond Angle:</span>
                    <span className="font-mono font-bold text-emerald-700">
                      {activeVseprMolecule.bondAngleDeg}°
                    </span>
                  </div>
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-slate-200">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] block">
                  Key Equations & Study Notes
                </span>
                {sceneSpec.learningNotes.map((note, i) => (
                  <p key={i} className="text-xs text-[#475569] leading-relaxed">
                    • {note}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
       * 3. MINI APP BUILDER (No-Code Student App Generator & Editor)
       * ===================================================================== */}
      {subTab === 'miniapp' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-6 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">
                No-Code Student Mini App Builder
              </h2>
              <p className="text-xs text-[#64748B]">
                Describe a calculator, solver, quiz app, or revision planner in plain English — or pick a template below, customize it, and save it to your library.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setMiniAppEditMode((e) => !e)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#172033] cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5 text-[#1A73E8]" />
                <span>{miniAppEditMode ? 'Done Editing' : 'Customize App'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const duplicated: MiniAppSpec = {
                    ...currentMiniApp,
                    id: `app-copy-${Date.now()}`,
                    title: `${currentMiniApp.title} (Copy)`,
                  };
                  setCurrentMiniApp(duplicated);
                  handleSaveCreativeAsset('mini_app', duplicated.title, duplicated);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-[#172033] cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Duplicate</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  handleSaveCreativeAsset('mini_app', currentMiniApp.title, currentMiniApp)
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#1A73E8] text-white text-xs font-semibold cursor-pointer"
              >
                <Bookmark className="w-3.5 h-3.5" />
                <span>Save Mini App</span>
              </button>
            </div>
          </div>

          {/* Prompt Bar + 5 Instant Templates */}
          <div className="p-4 rounded-2xl bg-[#F8FAFC] border border-slate-200/80 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={miniAppPrompt}
                onChange={(e) => setMiniAppPrompt(e.target.value)}
                placeholder="e.g., Build a projectile range calculator, quadratic root solver, or Bayes theorem calculator..."
                className="flex-1 px-3.5 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-[#172033]"
              />
              <button
                type="button"
                onClick={() => handleGenerateMiniApp(undefined, miniAppPrompt)}
                className="px-4 py-2 rounded-xl bg-[#172033] hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                Generate Mini App
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#64748B] mr-1">
                Templates:
              </span>
              {(
                [
                  { id: 'projectile_kinematics', label: 'Projectile Range Calculator' },
                  { id: 'quadratic_solver', label: 'Quadratic Formula Solver' },
                  { id: 'bayes_posterior', label: "Bayes' Posterior Calculator" },
                  { id: 'chapter_quiz_app', label: 'Chapter Quiz App' },
                  { id: 'revision_planner_app', label: 'Revision Sprint Planner' },
                ] as const
              ).map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => {
                    setMiniAppPrompt(tpl.label);
                    handleGenerateMiniApp(tpl.id, tpl.label);
                  }}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                    currentMiniApp.templateId === tpl.id
                      ? 'bg-[#E8F0FE] text-[#1A73E8] border border-[#4285F4]/40'
                      : 'bg-white border border-slate-200 text-slate-600 hover:text-[#172033]'
                  }`}
                >
                  {tpl.label}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Editor Panel */}
          {miniAppEditMode && (
            <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-amber-900">
                Customize Mini App Specification
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-slate-700">App Title</span>
                  <input
                    type="text"
                    value={currentMiniApp.title}
                    onChange={(e) =>
                      setCurrentMiniApp({ ...currentMiniApp, title: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold"
                  />
                </label>
                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-slate-700">Subtitle / Description</span>
                  <input
                    type="text"
                    value={currentMiniApp.subtitle}
                    onChange={(e) =>
                      setCurrentMiniApp({ ...currentMiniApp, subtitle: e.target.value })
                    }
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-white"
                  />
                </label>
              </div>
            </div>
          )}

          {/* Live Functional Mini App Preview */}
          <div className="p-6 rounded-3xl bg-[#F8FAFC] border border-slate-200/90 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[#E8F0FE] text-[#1A73E8]">
                  {currentMiniApp.subject} Mini App • Live Preview
                </span>
                <h3 className="text-base font-bold text-[#172033] mt-1">
                  {currentMiniApp.title}
                </h3>
                <p className="text-xs text-[#64748B]">{currentMiniApp.subtitle}</p>
              </div>
            </div>

            {currentMiniApp.inputs.length > 0 && currentMiniApp.outputs.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                <div className="space-y-3.5">
                  {currentMiniApp.inputs.map((inp) => {
                    const val = miniAppInputs[inp.id] ?? inp.defaultValue;
                    return (
                      <label key={inp.id} className="block space-y-1">
                        <div className="flex justify-between text-xs font-semibold text-[#172033]">
                          <span>{inp.label}</span>
                          <span className="font-mono text-[#1A73E8]">
                            {val} {inp.unit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={inp.min}
                          max={inp.max}
                          step={inp.step}
                          value={val}
                          onChange={(e) =>
                            setMiniAppInputs((prev) => ({
                              ...prev,
                              [inp.id]: Number(e.target.value),
                            }))
                          }
                          className="w-full accent-[#1A73E8]"
                        />
                      </label>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {currentMiniApp.outputs.map((out) => {
                    const computed = evaluatedMiniAppOutputs[out.id];
                    return (
                      <div
                        key={out.id}
                        className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-between gap-3"
                      >
                        <div>
                          <div className="text-xs font-bold text-[#172033]">{out.label}</div>
                          <div className="text-[11px] font-mono text-[#64748B]">
                            Formula: {out.expression}
                          </div>
                          <p className="text-[11px] text-[#64748B] mt-0.5">{out.description}</p>
                        </div>
                        <div className="text-lg font-extrabold text-[#1A73E8] font-mono shrink-0">
                          {computed ? computed.formatted : '—'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {currentMiniApp.quizItems.length > 0 && (
              <div className="space-y-3">
                {currentMiniApp.quizItems.map((q, qIdx) => {
                  const picked = miniAppQuizAnswers[q.id];
                  return (
                    <div
                      key={q.id}
                      className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2.5"
                    >
                      <p className="text-xs font-bold text-[#172033]">
                        Q{qIdx + 1}. {q.question}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {q.options.map((opt, oIdx) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setMiniAppQuizAnswers((prev) => ({ ...prev, [q.id]: oIdx }))
                            }
                            className={`p-2.5 rounded-xl border text-left text-xs font-semibold cursor-pointer ${
                              picked === undefined
                                ? 'bg-slate-50 border-slate-200 hover:border-[#4285F4]'
                                : oIdx === q.correctIndex
                                ? 'bg-emerald-50 border-emerald-400 text-emerald-900'
                                : picked === oIdx
                                ? 'bg-red-50 border-red-300 text-red-800'
                                : 'bg-white border-slate-200 text-slate-400'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                      {picked !== undefined && (
                        <p className="text-xs text-[#1A73E8] font-medium">{q.explanation}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {currentMiniApp.plannerItems.length > 0 && (
              <div className="space-y-2">
                {currentMiniApp.plannerItems.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center justify-between p-3.5 rounded-xl bg-white border border-slate-200 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() =>
                          setCurrentMiniApp({
                            ...currentMiniApp,
                            plannerItems: currentMiniApp.plannerItems.map((p) =>
                              p.id === item.id ? { ...p, completed: !p.completed } : p
                            ),
                          })
                        }
                        className="w-4 h-4 accent-[#34A853]"
                      />
                      <span
                        className={`text-xs font-semibold ${
                          item.completed ? 'line-through text-slate-400' : 'text-[#172033]'
                        }`}
                      >
                        {item.task}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-[#64748B]">{item.minutes} min</span>
                  </label>
                ))}
              </div>
            )}

            <div className="p-3 rounded-xl bg-blue-50/70 border border-blue-200/80 text-xs text-[#172033]">
              <strong>Key Study Takeaway:</strong> {currentMiniApp.studyTakeaway}
            </div>
          </div>

          {/* Saved Mini Apps Quick Reopen Bar */}
          {savedMiniApps.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#64748B] block">
                Your Saved Mini Apps ({savedMiniApps.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {savedMiniApps.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      if (asset.payload && asset.payload.templateId) {
                        setCurrentMiniApp(asset.payload as MiniAppSpec);
                      }
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-[#E8F0FE] text-xs font-semibold text-[#172033] cursor-pointer"
                  >
                    Open: {asset.title}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
       * 4. VISUALIZE CONCEPT (Nano Banana 2.1 + Deterministic SVG Diagram)
       * ===================================================================== */}
      {subTab === 'visualize' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">
                Visualize Concept — AI Image & Deterministic Scientific Diagrams
              </h2>
              <p className="text-xs text-[#64748B]">
                Generates grounded educational diagrams for your chapter concepts.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={visualConceptInput}
                onChange={(e) => setVisualConceptInput(e.target.value)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-[#172033] min-w-[200px]"
                placeholder="Enter concept to visualize..."
              />
              <select
                aria-label="Visual style"
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value as any)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-[#172033]"
              >
                <option value="educational_diagram">Scientific Diagram</option>
                <option value="flowchart">Process Flowchart</option>
                <option value="comparison_chart">Comparison Matrix</option>
              </select>
              <button
                type="button"
                disabled={isVisualizing}
                onClick={() => void handleRunVisualize()}
                data-testid="generate-visual-btn"
                className="px-4 py-2 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                {isVisualizing ? 'Generating...' : 'Generate Visual'}
              </button>
            </div>
          </div>

          {visualResult ? (
            <div className="space-y-4">
              {visualResult.modelNotice && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-center justify-between gap-2">
                  <span>
                    <strong>Status ({visualResult.verificationStatus || 'FALLBACK'}):</strong>{' '}
                    {visualResult.modelNotice}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-amber-300 text-[11px] font-bold shrink-0">
                    {visualResult.generatedImageUrl
                      ? 'AI Raster Image'
                      : 'Deterministic SVG Diagram'}
                  </span>
                </div>
              )}

              {visualResult.generatedImageUrl ? (
                <div className="rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 p-4 flex justify-center">
                  <img
                    src={visualResult.generatedImageUrl}
                    alt={visualResult.concept}
                    className="max-h-96 object-contain rounded-xl"
                  />
                </div>
              ) : (
                /* High-Clarity Deterministic SVG Scientific Diagram */
                <div className="p-5 rounded-2xl bg-slate-900 text-white space-y-3 border border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                      Deterministic Scientific Diagram (Non-AI SVG Vector Render):{' '}
                      {visualResult.concept}
                    </span>
                  </div>
                  <svg
                    viewBox="0 0 680 180"
                    className="w-full h-44 bg-slate-950 rounded-xl border border-slate-800"
                  >
                    {visualResult.diagramSteps.map((step, idx) => {
                      const x = 25 + idx * 218;
                      return (
                        <g key={step.step}>
                          <rect
                            x={x}
                            y={28}
                            width={185}
                            height={124}
                            rx={14}
                            fill="#1e293b"
                            stroke={step.color}
                            strokeWidth="2.5"
                          />
                          <circle cx={x + 24} cy={52} r={12} fill={step.color} />
                          <text
                            x={x + 20}
                            y={56}
                            fill="#ffffff"
                            fontSize="11"
                            fontWeight="bold"
                          >
                            {step.step}
                          </text>
                          <text
                            x={x + 44}
                            y={56}
                            fill="#f8fafc"
                            fontSize="11"
                            fontWeight="bold"
                          >
                            {step.title.slice(0, 20)}
                          </text>
                          <text x={x + 16} y={86} fill="#cbd5e1" fontSize="10">
                            {step.detail.slice(0, 32)}
                          </text>
                          <text x={x + 16} y={104} fill="#cbd5e1" fontSize="10">
                            {step.detail.slice(32, 64)}
                          </text>
                          <text x={x + 16} y={122} fill="#94a3b8" fontSize="9.5">
                            {step.detail.slice(64, 96)}
                          </text>
                          {idx < visualResult.diagramSteps.length - 1 && (
                            <line
                              x1={x + 185}
                              y1={90}
                              x2={x + 218}
                              y2={90}
                              stroke="#38bdf8"
                              strokeWidth="2.5"
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {visualResult.diagramSteps.map((step) => (
                  <div
                    key={step.step}
                    className="p-5 rounded-2xl border border-slate-200 bg-[#F8FAFC] space-y-2 relative"
                  >
                    <div
                      className="w-7 h-7 rounded-lg text-white text-xs font-bold flex items-center justify-center"
                      style={{ backgroundColor: step.color }}
                    >
                      {step.step}
                    </div>
                    <h3 className="text-sm font-bold text-[#172033]">{step.title}</h3>
                    <p className="text-xs text-[#64748B] leading-relaxed">{step.detail}</p>
                  </div>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    handleSaveCreativeAsset(
                      'visual_diagram',
                      `Diagram: ${visualResult.concept}`,
                      visualResult
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#E8F0FE] text-[#1A73E8] text-xs font-semibold cursor-pointer"
                >
                  <Bookmark className="w-3.5 h-3.5" />
                  <span>Save Visual to Studio Library</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-[#64748B]">
              Click &quot;Generate Visual&quot; above to build a grounded diagram for{' '}
              <span className="font-semibold text-[#172033]">{visualConceptInput}</span>.
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
       * 5. AI VIDEO LESSONS & IMAGE-TO-VIDEO + DETERMINISTIC ANIMATED EXPLANATION
       * ===================================================================== */}
      {subTab === 'videolesson' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-5 shadow-2xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">
                AI Video Lessons & Animated Concept Explanations
              </h2>
              <p className="text-xs text-[#64748B]">
                Supports Text-to-Video & Image-to-Video via Omni 1.1 Flash, plus an interactive HTML5/SVG Animated Explanation player.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={videoTopicInput}
                onChange={(e) => setVideoTopicInput(e.target.value)}
                className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-[#172033] min-w-[200px]"
              />
              <select
                aria-label="Video aspect ratio"
                value={videoAspectRatio}
                onChange={(e) => setVideoAspectRatio(e.target.value as '16:9' | '9:16')}
                className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-[#172033]"
              >
                <option value="16:9">16:9 Landscape</option>
                <option value="9:16">9:16 Vertical</option>
              </select>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-[#172033] cursor-pointer">
                <Upload className="w-3.5 h-3.5 text-[#1A73E8]" />
                <span>{videoSourceImage ? 'Image Attached ✓' : 'Animate Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleUploadVideoSourceImage}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                disabled={isGeneratingVideo}
                onClick={() => void handleRunVideoLesson()}
                data-testid="generate-video-lesson-btn"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-semibold cursor-pointer disabled:opacity-60"
              >
                <Video className="w-3.5 h-3.5" />
                <span>{isGeneratingVideo ? 'Building Lesson...' : 'Generate Video Lesson'}</span>
              </button>
            </div>
          </div>

          {videoResult ? (
            <div className="space-y-4">
              {videoResult.userFacingNotice && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>Status ({videoResult.verificationStatus || 'FALLBACK'}):</strong>{' '}
                    {videoResult.userFacingNotice}
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-white border border-amber-300 text-[11px] font-bold">
                    {videoResult.videoUrl
                      ? 'AI MP4 Video (Omni Flash)'
                      : 'Animated Explanation (Deterministic Player)'}
                  </span>
                </div>
              )}

              {videoResult.videoUrl ? (
                <video
                  controls
                  src={videoResult.videoUrl}
                  className="w-full max-h-96 rounded-2xl bg-slate-900"
                />
              ) : (
                <div className="p-6 rounded-3xl bg-[#172033] text-white space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
                      Animated Explanation • Scene{' '}
                      {videoResult.scenes[activeSceneIdx]?.sceneNumber || 1} of{' '}
                      {videoResult.scenes.length}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const nextState = !isPlayingStoryboard;
                          setIsPlayingStoryboard(nextState);
                          if (nextState && 'speechSynthesis' in window) {
                            window.speechSynthesis.cancel();
                            const utter = new SpeechSynthesisUtterance(
                              videoResult.scenes[activeSceneIdx]?.narration || ''
                            );
                            utter.onend = () => setIsPlayingStoryboard(false);
                            window.speechSynthesis.speak(utter);
                          } else if ('speechSynthesis' in window) {
                            window.speechSynthesis.cancel();
                          }
                        }}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#4285F4] text-white text-xs font-semibold cursor-pointer"
                      >
                        {isPlayingStoryboard ? (
                          <>
                            <Pause className="w-3.5 h-3.5" />
                            <span>Pause Animation</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5" />
                            <span>Play Animated Scene</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveCreativeAsset(
                            'video_lesson',
                            `Animated Lesson: ${videoResult.topic}`,
                            videoResult
                          )
                        }
                        className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold cursor-pointer"
                      >
                        Save Lesson
                      </button>
                    </div>
                  </div>

                  {/* Interactive SVG Animated Canvas for Current Scene */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                    <svg viewBox="0 0 600 170" className="w-full h-40">
                      <line x1="30" y1="145" x2="570" y2="145" stroke="#334155" strokeWidth="2" />
                      {/* Animated parabolic/probability curve based on animationProgress */}
                      <polyline
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3.5"
                        points={Array.from({ length: 32 }, (_, idx) => {
                          const t = (idx / 31) * animationProgress;
                          const x = 40 + t * 500;
                          const y = 145 - Math.sin(t * Math.PI) * 105;
                          return `${x.toFixed(1)},${y.toFixed(1)}`;
                        }).join(' ')}
                      />
                      <circle
                        cx={40 + animationProgress * 500}
                        cy={145 - Math.sin(animationProgress * Math.PI) * 105}
                        r="7"
                        fill="#facc15"
                      />
                      <text x="40" y="28" fill="#38bdf8" fontSize="13" fontWeight="bold">
                        {videoResult.scenes[activeSceneIdx]?.heading}
                      </text>
                      <text x="40" y="48" fill="#facc15" fontSize="12" fontFamily="monospace">
                        Governing Formula: {videoResult.scenes[activeSceneIdx]?.keyFormula}
                      </text>
                    </svg>

                    <div className="flex items-center gap-3">
                      <span className="text-[11px] text-slate-400">Scrub Timeline:</span>
                      <input
                        type="range"
                        min={0.05}
                        max={1}
                        step={0.02}
                        value={animationProgress}
                        onChange={(e) => setAnimationProgress(Number(e.target.value))}
                        className="flex-1 accent-[#38bdf8]"
                      />
                    </div>
                  </div>

                  <div className="p-5 rounded-2xl bg-slate-800/90 border border-slate-700 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-base font-bold text-white">
                        {videoResult.scenes[activeSceneIdx]?.heading}
                      </div>
                      <span className="px-3 py-1 rounded-lg bg-[#4285F4]/20 border border-[#4285F4]/40 font-mono text-xs text-blue-200">
                        {videoResult.scenes[activeSceneIdx]?.keyFormula}
                      </span>
                    </div>
                    <p className="text-sm text-slate-200 leading-relaxed">
                      &ldquo;{videoResult.scenes[activeSceneIdx]?.narration}&rdquo;
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {videoResult.scenes.map((sc, i) => (
                      <button
                        key={sc.sceneNumber}
                        type="button"
                        onClick={() => setActiveSceneIdx(i)}
                        className={`p-2.5 rounded-xl text-left text-xs transition-all cursor-pointer ${
                          activeSceneIdx === i
                            ? 'bg-[#4285F4] text-white font-semibold'
                            : 'bg-white/5 hover:bg-white/10 text-slate-300'
                        }`}
                      >
                        Scene {sc.sceneNumber}: {sc.heading}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-200 text-center text-xs text-[#64748B]">
              Click &quot;Generate Video Lesson&quot; to synthesize a grounded script and animated explanation for{' '}
              <span className="font-semibold text-[#172033]">{videoTopicInput}</span>.
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
       * 6. SAVED STUDIO LIBRARY
       * ===================================================================== */}
      {subTab === 'saved' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 p-6 space-y-4 shadow-2xs">
          <h2 className="text-lg font-bold text-[#172033]">
            Saved Creative Studio Assets ({savedAssets.length})
          </h2>
          {savedAssets.length === 0 ? (
            <p className="text-xs text-[#64748B]">
              No saved games, 3D scenes, mini-apps, or diagrams yet. Save any creation from the studio tabs above!
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {savedAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="p-4 rounded-2xl border border-slate-200 bg-slate-50/60 flex flex-col justify-between space-y-3"
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[#E8F0FE] text-[#1A73E8]">
                      {asset.type.replace('_', ' ')}
                    </span>
                    <h3 className="text-sm font-bold text-[#172033] mt-1.5">
                      {asset.title}
                    </h3>
                    <p className="text-xs text-[#64748B]">
                      Topic: {asset.topic} • Difficulty: {asset.difficulty}
                    </p>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/70">
                    {asset.type === 'mini_app' && asset.payload?.templateId ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCurrentMiniApp(asset.payload as MiniAppSpec);
                          setSubTab('miniapp');
                        }}
                        className="text-xs font-semibold text-[#1A73E8] hover:underline cursor-pointer"
                      >
                        Open Mini App →
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        {new Date(asset.createdAt).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        studyStorage.deleteCreativeAsset(asset.id);
                        setSavedAssets(studyStorage.getCreativeAssets());
                      }}
                      className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Remove</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
