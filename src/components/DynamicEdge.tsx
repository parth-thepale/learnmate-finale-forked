import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Timer as TimerIcon,
  Headphones,
  Music,
  Volume2,
  Maximize2,
  Minimize2,
  X,
  Flame,
  BookOpen,
  ChevronRight,
  Bell,
  CheckCircle2,
} from 'lucide-react';
import type { StudyDocument, StudyTimerState } from '../types/study';
import { studyStorage } from '../services/storageService';
import { computeTimerRemainingSeconds, formatTimestamp } from '../utils/quizGrading';
import { aiStudyClient } from '../services/aiClient';
import { LOFI_PRESETS, type LofiPresetOption } from './StudyTimerFocusBar';
import { isFeatureEnabled } from '../config/launchFeatures';
import {
  CapsuleButton,
  CapsuleChip,
  CapsuleControl,
  CapsuleToggle,
  CapsuleStatus,
} from './capsule';

export type DynamicEdgeTab = 'timer' | 'lofi' | 'coach';

interface DynamicEdgeProps {
  activeDoc?: StudyDocument | null;
  className?: string;
  defaultExpanded?: boolean;
}

function playTimerChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const playTone = (freq: number, startOffset: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
      gain.gain.setValueAtTime(0.001, ctx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + startOffset + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + startOffset);
      osc.stop(ctx.currentTime + startOffset + duration);
    };
    playTone(587.33, 0, 0.28);
    playTone(880, 0.25, 0.45);
  } catch {
    // ignore audio failure
  }
}

export const DynamicEdge: React.FC<DynamicEdgeProps> = ({
  activeDoc,
  className = '',
  defaultExpanded = false,
}) => {
  // Check URL query param ?dynamic_edge=expanded for deterministic screenshot/deep-link capture
  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    if (defaultExpanded) return true;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('dynamic_edge') === 'expanded';
    }
    return false;
  });

  const [activeTab, setActiveTab] = useState<DynamicEdgeTab>('timer');
  const [contextNotification, setContextNotification] = useState<string | null>(null);

  // ----------------------------------------------------
  // 1. TIMER STATE (Unified with studyStorage)
  // ----------------------------------------------------
  const [timerState, setTimerState] = useState<StudyTimerState>(() => {
    const saved = studyStorage.getStudyTimerState();
    const accurateRemaining = computeTimerRemainingSeconds({
      isRunning: saved.isRunning,
      targetEndTimestamp: saved.targetEndTimestamp,
      fallbackRemainingSeconds: saved.remainingSeconds,
    });
    return {
      ...saved,
      remainingSeconds: accurateRemaining,
      isRunning: saved.isRunning && accurateRemaining > 0,
      activeLofiPresetId: saved.activeLofiPresetId || 'rainy-night',
      lofiPlaying: false,
      lofiVolume: typeof saved.lofiVolume === 'number' ? saved.lofiVolume : 0.45,
    };
  });

  // ----------------------------------------------------
  // 2. LO-FI SYNTHESIZER STATE
  // ----------------------------------------------------
  const [lofiPlaying, setLofiPlaying] = useState(false);
  const [activePresetId, setActivePresetId] = useState(
    timerState.activeLofiPresetId || 'rainy-night'
  );
  const [lofiVolume, setLofiVolume] = useState(timerState.lofiVolume ?? 0.45);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activePreset: LofiPresetOption =
    LOFI_PRESETS.find((p) => p.id === activePresetId) || LOFI_PRESETS[0];

  const audioCtxRef = useRef<AudioContext | null>(null);
  const chordIntervalRef = useRef<number | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside and escape handling
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };

    if (isExpanded) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isExpanded]);

  // Fullscreen sync
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore
    }
  };

  // Web Audio Instrumental Synthesizer
  useEffect(() => {
    const stopAudio = () => {
      if (chordIntervalRef.current) {
        window.clearInterval(chordIntervalRef.current);
        chordIntervalRef.current = null;
      }
      if (htmlAudioRef.current) {
        htmlAudioRef.current.pause();
        htmlAudioRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };

    if (!lofiPlaying || !isFeatureEnabled('lofi')) {
      stopAudio();
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const playWarmChord = (chordShift = 0) => {
        if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') return;
        const now = ctx.currentTime;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(920, now);
        filter.connect(ctx.destination);

        activePreset.notes.forEach((baseFreq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
          const freq = baseFreq * (chordShift % 2 === 1 ? 0.890899 : 1);
          osc.frequency.setValueAtTime(freq, now);
          const targetGain = Math.max(0.005, lofiVolume * 0.08);
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(targetGain, now + 0.45);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);
          osc.connect(gain);
          gain.connect(filter);
          osc.start(now);
          osc.stop(now + 3.3);
        });
      };

      let step = 0;
      playWarmChord(step++);
      const intervalMs = Math.round((60 / activePreset.bpm) * 4 * 1000);
      chordIntervalRef.current = window.setInterval(() => {
        playWarmChord(step++);
      }, intervalMs);

      void aiStudyClient
        .prepareLofiMusic({
          presetId: activePreset.id,
          prompt: activePreset.prompt,
        })
        .then((res) => {
          if (res.audioDataUrl && lofiPlaying) {
            const audio = new Audio(res.audioDataUrl);
            audio.loop = true;
            audio.volume = lofiVolume;
            htmlAudioRef.current = audio;
            audio.play().catch(() => {});
          }
        })
        .catch(() => {});
    } catch {
      // ignore
    }

    return () => {
      stopAudio();
    };
  }, [lofiPlaying, activePreset, lofiVolume]);

  // Timer countdown
  useEffect(() => {
    if (!timerState.isRunning || !timerState.targetEndTimestamp) return;

    const interval = window.setInterval(() => {
      const remaining = computeTimerRemainingSeconds({
        isRunning: true,
        targetEndTimestamp: timerState.targetEndTimestamp,
        fallbackRemainingSeconds: timerState.remainingSeconds,
      });

      if (remaining <= 0) {
        if (timerState.soundEnabled) {
          playTimerChime();
        }

        const docTitle = activeDoc?.title || 'Study Session';
        if (timerState.mode === 'study') {
          studyStorage.saveFocusSession({
            id: `focus-${Date.now()}`,
            documentId: activeDoc?.id || 'default',
            documentTitle: docTitle,
            durationMinutes: timerState.durationMinutes,
            completedAt: new Date().toISOString(),
          });
          setContextNotification(`Focus session complete! Take a ${timerState.breakMinutes}m break.`);
        } else {
          setContextNotification('Break complete! Ready for your next focus sprint.');
        }

        const nextDuration =
          timerState.mode === 'study' ? timerState.breakMinutes : timerState.durationMinutes;
        const updated: StudyTimerState = {
          ...timerState,
          mode: timerState.mode === 'study' ? 'break' : 'study',
          isRunning: false,
          remainingSeconds: nextDuration * 60,
          targetEndTimestamp: null,
        };
        setTimerState(updated);
        studyStorage.saveStudyTimerState(updated);
      } else {
        setTimerState((prev) => ({ ...prev, remainingSeconds: remaining }));
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [timerState, activeDoc]);

  // Notification auto-dismiss after 6 seconds
  useEffect(() => {
    if (!contextNotification) return;
    const t = setTimeout(() => setContextNotification(null), 6000);
    return () => clearTimeout(t);
  }, [contextNotification]);

  const handleStartTimer = () => {
    const end = Date.now() + timerState.remainingSeconds * 1000;
    const updated: StudyTimerState = {
      ...timerState,
      isRunning: true,
      targetEndTimestamp: end,
    };
    setTimerState(updated);
    studyStorage.saveStudyTimerState(updated);
    setContextNotification('Focus sprint started. Stay in flow!');
  };

  const handlePauseTimer = () => {
    const updated: StudyTimerState = {
      ...timerState,
      isRunning: false,
      targetEndTimestamp: null,
    };
    setTimerState(updated);
    studyStorage.saveStudyTimerState(updated);
    setContextNotification('Focus paused.');
  };

  const handleResetTimer = (minutes?: number) => {
    const dur = minutes ?? timerState.durationMinutes;
    const updated: StudyTimerState = {
      ...timerState,
      durationMinutes: dur,
      remainingSeconds: dur * 60,
      isRunning: false,
      targetEndTimestamp: null,
    };
    setTimerState(updated);
    studyStorage.saveStudyTimerState(updated);
  };

  const handleSelectPreset = (presetId: string) => {
    setActivePresetId(presetId);
    setContextNotification(`Preset changed to ${LOFI_PRESETS.find((p) => p.id === presetId)?.name || 'Lo-Fi'}`);
  };

  const totalSeconds = (timerState.mode === 'study' ? timerState.durationMinutes : timerState.breakMinutes) * 60;
  const progressPct = Math.min(100, Math.max(0, ((totalSeconds - timerState.remainingSeconds) / (totalSeconds || 1)) * 100));

  // Determine collapsed summary priority: Timer running > Lo-Fi playing > Context Notification > Idle
  const renderCollapsedContent = () => {
    if (contextNotification) {
      return (
        <div className="flex items-center gap-2 truncate text-[11px] font-medium text-[var(--accent-terracotta)]">
          <Bell className="w-3.5 h-3.5 animate-bounce shrink-0" />
          <span className="truncate max-w-[190px]">{contextNotification}</span>
        </div>
      );
    }

    if (timerState.isRunning) {
      return (
        <div className="flex items-center gap-2 text-xs font-mono font-semibold text-[var(--text-ink)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--accent-terracotta)] opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--accent-terracotta)]" />
          </span>
          <TimerIcon className="w-3.5 h-3.5 text-[var(--accent-terracotta)] shrink-0" />
          <span>{formatTimestamp(timerState.remainingSeconds)}</span>
          <span className="text-[10px] uppercase font-sans font-medium text-[var(--accent-terracotta)] px-1.5 py-0.2 rounded-full bg-[var(--accent-terracotta-subtle)]">
            {timerState.mode === 'study' ? 'Focus' : 'Break'}
          </span>
        </div>
      );
    }

    if (lofiPlaying) {
      return (
        <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-ink)]">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Music className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span className="truncate max-w-[130px]">{activePreset.name}</span>
          <span className="text-[10px] font-mono text-[var(--text-ink-muted)]">Playing</span>
        </div>
      );
    }

    // Default Idle State
    return (
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-ink)]">
        <Sparkles className="w-3.5 h-3.5 text-[var(--accent-terracotta)] shrink-0" />
        <span className="font-serif-editorial font-bold text-xs tracking-tight">Dynamic Edge</span>
        <span className="h-1.5 w-1.5 rounded-full bg-stone-300 dark:bg-stone-600 shrink-0" />
        <span className="text-[11px] font-mono text-[var(--text-ink-muted)]">
          {formatTimestamp(timerState.remainingSeconds)}
        </span>
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      
      {/* ---------------------------------------------------- */}
      {/* COLLAPSED CAPSULE TRIGGER (Apple Dynamic Island-Inspired) */}
      {/* ---------------------------------------------------- */}
      <button
        id="dynamic-edge-trigger"
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-label="Open Dynamic Edge study companion"
        className={`h-9 px-3.5 rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-warm)] hover:border-[var(--border-paper-strong)] transition-all duration-200 cursor-pointer select-none inline-flex items-center justify-between gap-3 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40 ${
          isExpanded
            ? 'ring-2 ring-[var(--accent-terracotta)]/30 border-[var(--accent-terracotta)] bg-[var(--bg-surface-warm)]'
            : ''
        }`}
      >
        {renderCollapsedContent()}
      </button>

      {/* ---------------------------------------------------- */}
      {/* EXPANDED ACTIVITY PANEL (Dynamic Edge Flyout)       */}
      {/* ---------------------------------------------------- */}
      {isExpanded && (
        <div
          id="dynamic-edge-panel"
          role="dialog"
          aria-label="Dynamic Edge Study Console"
          className="absolute right-0 top-full mt-2 w-[380px] sm:w-[420px] max-w-[95vw] rounded-3xl bg-[var(--bg-surface)] border border-[var(--border-paper)] shadow-2xl p-5 z-50 animate-in fade-in zoom-in-95 duration-150 text-[var(--text-ink)] select-none"
        >
          {/* Header Strip: Capsule Tabs & System Controls */}
          <div className="flex items-center justify-between border-b border-[var(--border-paper)] pb-3 mb-4 gap-2">
            <div className="flex items-center gap-1.5">
              <CapsuleButton
                size="sm"
                variant={activeTab === 'timer' ? 'accent' : 'subtle'}
                icon={<TimerIcon className="w-3.5 h-3.5" />}
                onClick={() => setActiveTab('timer')}
              >
                Pomodoro
              </CapsuleButton>
              <CapsuleButton
                size="sm"
                variant={activeTab === 'lofi' ? 'accent' : 'subtle'}
                icon={<Headphones className="w-3.5 h-3.5" />}
                onClick={() => setActiveTab('lofi')}
              >
                Lo-Fi
              </CapsuleButton>
              <CapsuleButton
                size="sm"
                variant={activeTab === 'coach' ? 'accent' : 'subtle'}
                icon={<Sparkles className="w-3.5 h-3.5" />}
                onClick={() => setActiveTab('coach')}
              >
                Coach
              </CapsuleButton>
            </div>

            <div className="flex items-center gap-1">
              <CapsuleControl
                size="sm"
                icon={isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen Focus'}
                onClick={handleToggleFullscreen}
              />
              <CapsuleControl
                size="sm"
                icon={<X className="w-3.5 h-3.5" />}
                title="Collapse Dynamic Edge"
                onClick={() => setIsExpanded(false)}
              />
            </div>
          </div>

          {/* TAB 1: POMODORO TIMER */}
          {activeTab === 'timer' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <CapsuleStatus
                  status={timerState.isRunning ? 'running' : 'idle'}
                  label={timerState.mode === 'study' ? 'Study Sprint' : 'Rest Break'}
                  pulsing={timerState.isRunning}
                />
                <div className="flex items-center gap-1.5">
                  <CapsuleChip
                    size="xs"
                    label="25m"
                    isSelected={timerState.durationMinutes === 25}
                    onSelect={() => handleResetTimer(25)}
                  />
                  <CapsuleChip
                    size="xs"
                    label="50m"
                    isSelected={timerState.durationMinutes === 50}
                    onSelect={() => handleResetTimer(50)}
                  />
                  <CapsuleChip
                    size="xs"
                    label="5m"
                    isSelected={timerState.durationMinutes === 5}
                    onSelect={() => handleResetTimer(5)}
                  />
                </div>
              </div>

              {/* Monospace Countdown Display */}
              <div className="p-5 rounded-2xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] text-center space-y-2">
                <div className="text-4xl font-mono font-bold tracking-tight text-[var(--text-ink)]">
                  {formatTimestamp(timerState.remainingSeconds)}
                </div>
                <div className="text-[11px] text-[var(--text-ink-muted)] font-serif-editorial">
                  {activeDoc ? `Focused on: ${activeDoc.title}` : 'JEE Deep Problem Solving Sprint'}
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-[var(--bg-paper)] rounded-full h-2 overflow-hidden border border-[var(--border-paper)] mt-3">
                  <div
                    className="bg-[var(--accent-terracotta)] h-full transition-all duration-500 rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between gap-3 pt-1">
                {timerState.isRunning ? (
                  <CapsuleButton
                    variant="accent"
                    size="md"
                    className="flex-1"
                    icon={<Pause className="w-4 h-4" />}
                    onClick={handlePauseTimer}
                  >
                    Pause Sprint
                  </CapsuleButton>
                ) : (
                  <CapsuleButton
                    variant="accent"
                    size="md"
                    className="flex-1"
                    icon={<Play className="w-4 h-4" />}
                    onClick={handleStartTimer}
                  >
                    Start Focus Sprint
                  </CapsuleButton>
                )}
                <CapsuleButton
                  variant="secondary"
                  size="md"
                  icon={<RotateCcw className="w-4 h-4" />}
                  onClick={() => handleResetTimer()}
                >
                  Reset
                </CapsuleButton>
              </div>

              <div className="flex items-center justify-between text-xs pt-1 border-t border-[var(--border-paper)]">
                <span className="text-[11px] text-[var(--text-ink-muted)]">Audio chime on completion</span>
                <CapsuleToggle
                  size="sm"
                  checked={timerState.soundEnabled}
                  onChange={(val) => {
                    const upd = { ...timerState, soundEnabled: val };
                    setTimerState(upd);
                    studyStorage.saveStudyTimerState(upd);
                  }}
                  ariaLabel="Timer completion sound"
                />
              </div>
            </div>
          )}

          {/* TAB 2: LO-FI AUDIO SYNTHESIZER */}
          {activeTab === 'lofi' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--text-ink)]">
                    WebAudio Study Synthesizer
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-muted)]">
                    Low-pass filtered binaural chord sequences
                  </div>
                </div>
                <CapsuleStatus
                  status={lofiPlaying ? 'live' : 'idle'}
                  label={lofiPlaying ? `${activePreset.bpm} BPM` : 'Muted'}
                  pulsing={lofiPlaying}
                />
              </div>

              {/* Preset Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-[var(--text-ink-secondary)] uppercase tracking-wider">
                  Atmospheric Presets
                </label>
                <div className="flex flex-wrap gap-2">
                  {LOFI_PRESETS.map((preset) => {
                    const isSel = preset.id === activePresetId;
                    return (
                      <CapsuleChip
                        key={preset.id}
                        label={preset.name}
                        icon={<Music className="w-3 h-3" />}
                        isSelected={isSel}
                        onSelect={() => handleSelectPreset(preset.id)}
                      />
                    );
                  })}
                </div>
              </div>

              {/* Volume Slider */}
              <div className="p-3 rounded-2xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 text-[var(--text-ink-secondary)]">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Master Volume</span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-[var(--text-ink)]">
                    {Math.round(lofiVolume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={lofiVolume}
                  onChange={(e) => setLofiVolume(parseFloat(e.target.value))}
                  className="w-full accent-[var(--accent-terracotta)] cursor-pointer"
                />
              </div>

              {/* Play / Stop Button */}
              <CapsuleButton
                variant={lofiPlaying ? 'secondary' : 'accent'}
                size="md"
                className="w-full"
                icon={lofiPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                onClick={() => setLofiPlaying((prev) => !prev)}
              >
                {lofiPlaying ? 'Pause Ambient Sound' : 'Play Instrumental Lo-Fi'}
              </CapsuleButton>
            </div>
          )}

          {/* TAB 3: SOCRATIC AI COMPANION */}
          {activeTab === 'coach' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-[var(--text-ink)]">
                    Socratic Academic Coach
                  </div>
                  <div className="text-[11px] text-[var(--text-ink-muted)]">
                    Bayesian topic analysis & study recommendations
                  </div>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-bold">
                  gemini-3.1
                </span>
              </div>

              {/* Context Card */}
              <div className="p-3.5 rounded-2xl bg-[var(--bg-surface-warm)] border border-[var(--border-paper)] space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[var(--accent-terracotta)] font-semibold text-[11px]">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Current Study Context</span>
                </div>
                <div className="font-bold text-[var(--text-ink)] text-xs">
                  {activeDoc?.title || 'JEE Full Syllabus Coverage'}
                </div>
                <p className="text-[11px] text-[var(--text-ink-secondary)] leading-relaxed font-serif-editorial">
                  {activeDoc?.overview ||
                    'Review key derivations, boundary conditions, and test problem archetypes from recent JEE papers.'}
                </p>
              </div>

              {/* Weak-Topic Recommendation */}
              <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 text-xs space-y-1.5">
                <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300 font-bold text-[11px]">
                  <Flame className="w-3.5 h-3.5" />
                  <span>Recommended Focus Area</span>
                </div>
                <p className="text-[11px] text-amber-900 dark:text-amber-200 leading-normal">
                  Reinforce <strong>Rotational Mechanics & Moment of Inertia</strong> before taking today’s timed diagnostic mock.
                </p>
              </div>

              {/* Socratic Prompt Suggestion */}
              <div className="text-[11px] text-[var(--text-ink-muted)] font-serif-editorial italic text-center">
                “Ask me to derive the parallel axis theorem or solve a tricky rolling constraint problem.”
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
