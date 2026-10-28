import React, { useEffect, useRef, useState } from 'react';
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
  Settings2,
  CheckCircle2,
  Music,
  ChevronDown,
  ChevronUp,
  Headphones,
} from 'lucide-react';
import type { StudyTimerState } from '../types/study';
import { studyStorage } from '../services/storageService';
import { computeTimerRemainingSeconds, formatTimestamp } from '../utils/quizGrading';
import { aiStudyClient } from '../services/aiClient';

export interface LofiPresetOption {
  id: string;
  name: string;
  subtitle: string;
  bpm: number;
  notes: number[];
  prompt: string;
}

export const LOFI_PRESETS: LofiPresetOption[] = [
  {
    id: 'rainy-night',
    name: 'Rainy Library',
    subtitle: 'Warm Rhodes chords & gentle rain',
    bpm: 72,
    notes: [261.63, 329.63, 392.0, 493.88], // Cmaj7
    prompt:
      'Instrumental lo-fi hip hop for Rainy Library study, warm Rhodes chords, soft brushed snare, subtle vinyl texture, relaxed 72 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
  {
    id: 'warm-vinyl',
    name: 'Midnight Coding',
    subtitle: 'Mellow synth-piano & deep sub pulse',
    bpm: 76,
    notes: [293.66, 349.23, 440.0, 523.25], // Dm7
    prompt:
      'Instrumental lo-fi beats for Midnight Coding, warm electric piano chords, soft brushed snare, subtle vinyl texture, relaxed 76 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
  {
    id: 'soft-piano',
    name: 'Cozy Café',
    subtitle: 'Minimal acoustic felt piano harmony',
    bpm: 70,
    notes: [220.0, 261.63, 329.63, 392.0], // Am7
    prompt:
      'Instrumental Cozy Cafe lo-fi study music, soft acoustic felt piano chords, gentle brush percussion, relaxed 70 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
  {
    id: 'deep-focus',
    name: 'Deep Focus',
    subtitle: 'Binaural alpha-wave harmonic pad',
    bpm: 64,
    notes: [220.0, 226.0, 329.63, 440.0], // Alpha binaural + fifth
    prompt:
      'Instrumental Deep Focus ambient study pad, warm harmonic drones, relaxed 64 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
  {
    id: 'cozy-library',
    name: 'Sunset Revision',
    subtitle: 'Golden-hour major 7th progressions',
    bpm: 74,
    notes: [174.61, 220.0, 261.63, 329.63], // Fmaj7
    prompt:
      'Instrumental Sunset Revision lo-fi study beats, warm Rhodes chords, soft brushed snare, relaxed 74 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
  {
    id: 'ambient-jazz',
    name: 'Sleepy Vinyl',
    subtitle: 'Tape-saturated 9th chords & vinyl warmth',
    bpm: 66,
    notes: [196.0, 246.94, 293.66, 349.23], // G7
    prompt:
      'Instrumental Sleepy Vinyl lo-fi study music, warm Rhodes chords, subtle vinyl crackle texture, relaxed 66 BPM, mellow bass, no vocals, no spoken words, smooth loopable study ambiance',
  },
];

interface StudyTimerFocusBarProps {
  activeDocumentId: string;
  activeDocumentTitle: string;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  onFocusSessionCompleted?: () => void;
  floatingIsland?: boolean;
}

/**
 * Plays a gentle two-tone Web Audio API chime when a study or break session completes.
 */
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
    playTone(587.33, 0, 0.28); // D5
    playTone(880, 0.25, 0.45); // A5
  } catch {
    // ignore audio context restrictions
  }
}

export const StudyTimerFocusBar: React.FC<StudyTimerFocusBarProps> = ({
  activeDocumentId,
  activeDocumentTitle,
  focusMode,
  onToggleFocusMode,
  onFocusSessionCompleted,
  floatingIsland = false,
}) => {
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

  const [showTimerSettings, setShowTimerSettings] = useState(false);
  const [showLofiPopover, setShowLofiPopover] = useState(false);
  const [islandExpanded, setIslandExpanded] = useState(false);
  const [customStudyMins, setCustomStudyMins] = useState(timerState.durationMinutes);
  const [customBreakMins, setCustomBreakMins] = useState(timerState.breakMinutes);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sessionBanner, setSessionBanner] = useState<string | null>(null);
  const [lofiPlaying, setLofiPlaying] = useState(false);
  const [activePresetId, setActivePresetId] = useState(
    timerState.activeLofiPresetId || 'rainy-night'
  );
  const [lofiVolume, setLofiVolume] = useState(timerState.lofiVolume ?? 0.45);
  const [tabSwitchReminder, setTabSwitchReminder] = useState(false);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const chordIntervalRef = useRef<number | null>(null);
  const htmlAudioRef = useRef<HTMLAudioElement | null>(null);

  const activePreset =
    LOFI_PRESETS.find((p) => p.id === activePresetId) || LOFI_PRESETS[0];

  // Close timer settings, Lo-Fi popover, or expanded island on outside click or Escape
  useEffect(() => {
    if (!showTimerSettings && !showLofiPopover && !islandExpanded) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setShowTimerSettings(false);
        setShowLofiPopover(false);
        setIslandExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowTimerSettings(false);
        setShowLofiPopover(false);
        setIslandExpanded(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [showTimerSettings, showLofiPopover, islandExpanded]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Gentle Focus Mode tab-switch reminder
  useEffect(() => {
    if (!focusMode) {
      setTabSwitchReminder(false);
      return;
    }
    const onVisChange = () => {
      if (document.hidden && focusMode && timerState.isRunning) {
        setTabSwitchReminder(true);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [focusMode, timerState.isRunning]);

  // Procedural Web Audio API Instrumental Lo-Fi Synthesizer + Lyria clip support
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

    if (!lofiPlaying) {
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
          const freq = baseFreq * (chordShift % 2 === 1 ? 0.890899 : 1); // alternate IV/vi feel
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

      // Request Lyria instrumental clip in background
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
      // ignore audio restrictions
    }

    return () => {
      stopAudio();
    };
  }, [lofiPlaying, activePreset, lofiVolume]);

  // Real-timestamp interval ticker (never drifts in background tabs)
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

        if (timerState.mode === 'study') {
          studyStorage.saveFocusSession({
            id: `focus-${Date.now()}`,
            documentId: activeDocumentId,
            documentTitle: activeDocumentTitle,
            durationMinutes: timerState.durationMinutes,
            completedAt: new Date().toISOString(),
          });
          studyStorage.addNotification({
            title: `Focus Session Complete (${timerState.durationMinutes}m)`,
            message: `Great concentration on "${activeDocumentTitle}". Take a ${timerState.breakMinutes}-minute restorative break!`,
            category: 'goal',
            actionTab: 'study',
            documentId: activeDocumentId,
          });
          if (onFocusSessionCompleted) onFocusSessionCompleted();

          const nextState: StudyTimerState = {
            ...timerState,
            mode: 'break',
            remainingSeconds: timerState.breakMinutes * 60,
            isRunning: false,
            targetEndTimestamp: null,
            completedSessionsCount: timerState.completedSessionsCount + 1,
          };
          setTimerState(nextState);
          studyStorage.saveStudyTimerState(nextState);
          setSessionBanner(
            `Focus session complete (${timerState.durationMinutes}m)! Ready for a ${timerState.breakMinutes}m break.`
          );
        } else {
          const nextState: StudyTimerState = {
            ...timerState,
            mode: 'study',
            remainingSeconds: timerState.durationMinutes * 60,
            isRunning: false,
            targetEndTimestamp: null,
          };
          setTimerState(nextState);
          studyStorage.saveStudyTimerState(nextState);
          setSessionBanner('Break complete! Ready for your next study session.');
        }
      } else {
        setTimerState((prev) => {
          const updated = { ...prev, remainingSeconds: remaining };
          studyStorage.saveStudyTimerState(updated);
          return updated;
        });
      }
    }, 500);

    return () => window.clearInterval(interval);
  }, [
    timerState.isRunning,
    timerState.targetEndTimestamp,
    timerState.mode,
    timerState.durationMinutes,
    timerState.breakMinutes,
    timerState.soundEnabled,
    timerState.completedSessionsCount,
    activeDocumentId,
    activeDocumentTitle,
    onFocusSessionCompleted,
  ]);

  const handleStartPause = () => {
    setSessionBanner(null);
    if (timerState.isRunning) {
      const remaining = computeTimerRemainingSeconds({
        isRunning: true,
        targetEndTimestamp: timerState.targetEndTimestamp,
        fallbackRemainingSeconds: timerState.remainingSeconds,
      });
      const paused: StudyTimerState = {
        ...timerState,
        isRunning: false,
        remainingSeconds: remaining,
        targetEndTimestamp: null,
      };
      setTimerState(paused);
      studyStorage.saveStudyTimerState(paused);
    } else {
      const baseSeconds =
        timerState.remainingSeconds > 0
          ? timerState.remainingSeconds
          : (timerState.mode === 'study'
              ? timerState.durationMinutes
              : timerState.breakMinutes) * 60;
      const started: StudyTimerState = {
        ...timerState,
        isRunning: true,
        remainingSeconds: baseSeconds,
        targetEndTimestamp: Date.now() + baseSeconds * 1000,
      };
      setTimerState(started);
      studyStorage.saveStudyTimerState(started);
    }
  };

  const handleReset = () => {
    setSessionBanner(null);
    const totalSecs =
      (timerState.mode === 'study'
        ? timerState.durationMinutes
        : timerState.breakMinutes) * 60;
    const resetState: StudyTimerState = {
      ...timerState,
      isRunning: false,
      remainingSeconds: totalSecs,
      targetEndTimestamp: null,
    };
    setTimerState(resetState);
    studyStorage.saveStudyTimerState(resetState);
  };

  const handleSkipBreak = () => {
    setSessionBanner(null);
    const nextMode = timerState.mode === 'break' ? 'study' : 'break';
    const nextSecs =
      (nextMode === 'study' ? timerState.durationMinutes : timerState.breakMinutes) * 60;
    const nextState: StudyTimerState = {
      ...timerState,
      mode: nextMode,
      isRunning: false,
      remainingSeconds: nextSecs,
      targetEndTimestamp: null,
    };
    setTimerState(nextState);
    studyStorage.saveStudyTimerState(nextState);
  };

  const handleToggleSound = () => {
    const next: StudyTimerState = {
      ...timerState,
      soundEnabled: !timerState.soundEnabled,
    };
    setTimerState(next);
    studyStorage.saveStudyTimerState(next);
  };

  const handleApplyCustomDurations = (e: React.FormEvent) => {
    e.preventDefault();
    const safeStudy = Math.max(1, Math.min(120, Number(customStudyMins) || 25));
    const safeBreak = Math.max(1, Math.min(60, Number(customBreakMins) || 5));
    const nextSecs = (timerState.mode === 'study' ? safeStudy : safeBreak) * 60;
    const updated: StudyTimerState = {
      ...timerState,
      durationMinutes: safeStudy,
      breakMinutes: safeBreak,
      remainingSeconds: nextSecs,
      isRunning: false,
      targetEndTimestamp: null,
    };
    setTimerState(updated);
    studyStorage.saveStudyTimerState(updated);
    setShowTimerSettings(false);
  };

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fullscreen may be blocked by iframe permissions; Focus Mode still works cleanly
    }
  };

  // Docked Top-Right Dynamic Island Pill across routes (never obscures content or mobile nav)
  if (floatingIsland) {
    return (
      <div
        ref={containerRef}
        data-testid="floating-dynamic-timer"
        className="relative z-30 lm-no-print"
      >
        <div className="rounded-xl bg-[#172033] text-white shadow-sm border border-slate-700/80 transition-all">
          <div className="flex items-center gap-1.5 px-2.5 py-1">
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                timerState.isRunning
                  ? 'bg-[#34A853]'
                  : lofiPlaying
                  ? 'bg-[#4285F4]'
                  : 'bg-slate-400'
              }`}
            />
            <span className="hidden 2xl:inline text-[11px] font-semibold uppercase tracking-wider text-slate-300">
              {timerState.mode === 'study' ? 'Focus' : 'Break'}
            </span>
            <span className="font-bold text-xs tabular-nums text-white">
              {formatTimestamp(timerState.remainingSeconds)}
            </span>
            <button
              type="button"
              onClick={handleStartPause}
              title={timerState.isRunning ? 'Pause Timer' : 'Start Timer'}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            >
              {timerState.isRunning ? (
                <Pause className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setLofiPlaying((p) => !p)}
              title={lofiPlaying ? 'Pause Focus Radio' : 'Play Focus Radio (Instrumental Synth)'}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                lofiPlaying
                  ? 'bg-[#4285F4] text-white'
                  : 'bg-white/10 hover:bg-white/20 text-slate-200'
              }`}
            >
              <Headphones className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setIslandExpanded((p) => !p)}
              aria-label="Expand study timer and lo-fi radio"
              className="p-1 rounded-lg text-slate-300 hover:text-white cursor-pointer"
            >
              {islandExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        {islandExpanded && (
          <div className="absolute right-0 top-full mt-2 px-4 pb-3.5 pt-3 rounded-2xl bg-[#172033] text-white border border-slate-700/80 shadow-2xl w-76 sm:w-80 space-y-3 text-xs z-50">
            <div className="flex items-center justify-between">
              <span className="text-slate-300 font-medium truncate">
                {activeDocumentTitle || 'Study Session'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/15 text-[11px] font-medium cursor-pointer"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={onToggleFocusMode}
                  className="px-2 py-1 rounded-md bg-[#4285F4] hover:bg-[#1A73E8] text-[11px] font-semibold cursor-pointer"
                >
                  {focusMode ? 'Exit Focus' : 'Focus Mode'}
                </button>
              </div>
            </div>

            <div className="pt-1 border-t border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <Music className="w-3.5 h-3.5 text-[#FBBC05]" />
                  <span>Focus Radio (Deterministic Synth)</span>
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300">
                  {activePreset.bpm} BPM
                </span>
              </div>
              <p className="text-[10px] text-slate-400 leading-snug">
                AI media generation requires configuration or paid model access. Playing warm Web Audio instrumental synth.
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {LOFI_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setActivePresetId(preset.id);
                      setLofiPlaying(true);
                    }}
                    className={`text-left px-2 py-1.5 rounded-lg text-[11px] transition-colors cursor-pointer ${
                      activePresetId === preset.id
                        ? 'bg-[#4285F4]/30 border border-[#4285F4] text-white font-semibold'
                        : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="truncate">{preset.name}</div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Volume2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <input
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  value={lofiVolume}
                  onChange={(e) => setLofiVolume(Number(e.target.value))}
                  aria-label="Lo-Fi radio volume"
                  className="w-full accent-[#4285F4] cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      {/* Compact Pomodoro Study Timer Pill */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F8FAFC] border border-slate-200/90 text-xs">
        <span
          className={`inline-flex items-center gap-1 font-semibold px-2 py-0.5 rounded-md ${
            timerState.mode === 'study'
              ? 'bg-[#E8F0FE] text-[#1A73E8]'
              : 'bg-[#E6F4EA] text-[#137333]'
          }`}
        >
          <Timer className="w-3.5 h-3.5" />
          <span>{timerState.mode === 'study' ? 'Focus' : 'Break'}</span>
        </span>

        <span
          aria-live="off"
          data-testid="study-timer-readout"
          className="font-bold text-sm text-[#172033] tabular-nums px-1"
        >
          {formatTimestamp(timerState.remainingSeconds)}
        </span>

        <button
          type="button"
          onClick={handleStartPause}
          aria-label={timerState.isRunning ? 'Pause study timer' : 'Start study timer'}
          title={timerState.isRunning ? 'Pause Timer' : 'Start / Resume Timer'}
          className={`p-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
            timerState.isRunning
              ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
              : 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
          }`}
        >
          {timerState.isRunning ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={handleReset}
          aria-label="Reset study timer"
          title="Reset Timer"
          className="p-1.5 rounded-lg text-slate-600 hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {timerState.mode === 'break' && (
          <button
            type="button"
            onClick={handleSkipBreak}
            title="Skip Break"
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer"
          >
            <SkipForward className="w-3 h-3" />
            <span>Skip Break</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleToggleSound}
          aria-label={timerState.soundEnabled ? 'Mute timer chime' : 'Enable timer chime'}
          title={timerState.soundEnabled ? 'Timer Chime On' : 'Timer Chime Muted'}
          className="p-1.5 rounded-lg text-slate-500 hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          {timerState.soundEnabled ? (
            <Volume2 className="w-3.5 h-3.5 text-[#34A853]" />
          ) : (
            <VolumeX className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setCustomStudyMins(timerState.durationMinutes);
            setCustomBreakMins(timerState.breakMinutes);
            setShowTimerSettings((prev) => !prev);
            setShowLofiPopover(false);
          }}
          aria-label="Customize timer durations"
          title="Timer Settings (25/5 Pomodoro or Custom)"
          className="p-1.5 rounded-lg text-slate-500 hover:text-[#172033] hover:bg-slate-200/60 transition-colors cursor-pointer"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Lo-Fi Focus Radio Pill (Strictly Instrumental) */}
      <button
        type="button"
        onClick={() => {
          setShowLofiPopover((p) => !p);
          setShowTimerSettings(false);
        }}
        data-testid="lofi-radio-trigger"
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border ${
          lofiPlaying
            ? 'bg-[#E8F0FE] border-[#4285F4]/40 text-[#1A73E8]'
            : 'bg-[#F8FAFC] hover:bg-slate-100 border-slate-200/90 text-[#172033]'
        }`}
      >
        <Headphones className="w-3.5 h-3.5 text-[#4285F4]" />
        <span>{lofiPlaying ? activePreset.name : 'Lo-Fi Radio'}</span>
      </button>

      {/* Focus Mode Toggle Button */}
      <button
        type="button"
        onClick={onToggleFocusMode}
        aria-pressed={focusMode}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
          focusMode
            ? 'bg-[#EA4335] hover:bg-red-700 text-white shadow-2xs'
            : 'bg-[#F8FAFC] hover:bg-slate-100 border border-slate-200/90 text-[#172033]'
        }`}
      >
        {focusMode ? (
          <>
            <EyeOff className="w-3.5 h-3.5" />
            <span>Exit Focus</span>
          </>
        ) : (
          <>
            <Eye className="w-3.5 h-3.5 text-[#4285F4]" />
            <span>Focus Mode</span>
          </>
        )}
      </button>

      {/* Optional Browser Fullscreen Button when in Focus Mode */}
      {focusMode && (
        <button
          type="button"
          onClick={() => void handleToggleFullscreen()}
          title={isFullscreen ? 'Exit Fullscreen' : 'Enter Browser Fullscreen'}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          {isFullscreen ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Window</span>
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fullscreen</span>
            </>
          )}
        </button>
      )}

      {/* Gentle Tab-Switch Focus Reminder */}
      {tabSwitchReminder && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs font-medium text-amber-900">
          <span>Stay focused on {activeDocumentTitle} : you switched tabs during your active timer.</span>
          <button
            type="button"
            onClick={() => setTabSwitchReminder(false)}
            className="text-amber-800 font-semibold hover:underline cursor-pointer"
          >
            Got it
          </button>
        </div>
      )}

      {/* Session Complete Toast Banner */}
      {sessionBanner && (
        <div
          role="status"
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900"
        >
          <CheckCircle2 className="w-3.5 h-3.5 text-[#34A853] shrink-0" />
          <span>{sessionBanner}</span>
          <button
            type="button"
            onClick={() => setSessionBanner(null)}
            className="text-emerald-700 font-semibold hover:underline ml-1 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Lo-Fi Focus Radio Popover */}
      {showLofiPopover && (
        <div
          data-testid="lofi-radio-popover"
          className="absolute right-0 top-11 z-40 w-80 rounded-2xl bg-white border border-slate-200 shadow-xl p-4 space-y-3"
        >
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div>
              <div className="text-xs font-bold text-[#172033] flex items-center gap-1.5">
                <Headphones className="w-3.5 h-3.5 text-[#4285F4]" />
                <span>Lo-Fi Focus Radio</span>
              </div>
              <p className="text-[11px] text-[#64748B]">
                Strictly instrumental ambient study audio
              </p>
            </div>
            <button
              type="button"
              onClick={() => setLofiPlaying((p) => !p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                lofiPlaying
                  ? 'bg-red-50 text-[#EA4335] border border-red-200'
                  : 'bg-[#1A73E8] text-white hover:bg-[#1557B0]'
              }`}
            >
              {lofiPlaying ? 'Pause' : 'Play'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-1.5 max-h-56 overflow-y-auto pr-1">
            {LOFI_PRESETS.map((preset) => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setActivePresetId(preset.id);
                    setLofiPlaying(true);
                  }}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#E8F0FE]/70 border-[#4285F4] text-[#172033]'
                      : 'bg-slate-50/70 hover:bg-slate-100 border-slate-200/70 text-[#172033]'
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold">{preset.name}</div>
                    <div className="text-[11px] text-[#64748B]">{preset.subtitle}</div>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-white border border-slate-200 text-slate-600">
                    {preset.bpm} BPM
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100">
            <Volume2 className="w-4 h-4 text-slate-500 shrink-0" />
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={lofiVolume}
              onChange={(e) => setLofiVolume(Number(e.target.value))}
              aria-label="Lo-Fi focus radio volume"
              className="w-full accent-[#1A73E8] cursor-pointer"
            />
            <button
              type="button"
              onClick={() => setShowLofiPopover(false)}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Custom Timer Settings Popover */}
      {showTimerSettings && (
        <div className="absolute right-0 top-11 z-40 w-72 rounded-2xl bg-white border border-slate-200 shadow-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-xs font-bold text-[#172033]">Study Timer Settings</span>
            <span className="text-[11px] text-[#64748B] tabular-nums">
              {timerState.completedSessionsCount} session(s) done
            </span>
          </div>

          <form onSubmit={handleApplyCustomDurations} className="space-y-3">
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="study-mins-input"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Focus (mins)
                </label>
                <input
                  id="study-mins-input"
                  type="number"
                  min={1}
                  max={120}
                  value={customStudyMins}
                  onChange={(e) => setCustomStudyMins(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-[#172033]"
                />
              </div>
              <div>
                <label
                  htmlFor="break-mins-input"
                  className="block text-[11px] font-semibold text-slate-600 mb-1"
                >
                  Break (mins)
                </label>
                <input
                  id="break-mins-input"
                  type="number"
                  min={1}
                  max={60}
                  value={customBreakMins}
                  onChange={(e) => setCustomBreakMins(Number(e.target.value))}
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-[#172033]"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                { label: '25 / 5 Pomodoro', s: 25, b: 5 },
                { label: '50 / 10 Deep', s: 50, b: 10 },
                { label: '15 / 3 Quick', s: 15, b: 3 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setCustomStudyMins(preset.s);
                    setCustomBreakMins(preset.b);
                  }}
                  className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[11px] font-medium text-slate-700 cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowTimerSettings(false)}
                className="px-2.5 py-1 rounded-lg text-xs text-slate-500 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-3 py-1 rounded-lg bg-[#1A73E8] text-white text-xs font-semibold hover:bg-[#1557B0] cursor-pointer"
              >
                Apply
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
