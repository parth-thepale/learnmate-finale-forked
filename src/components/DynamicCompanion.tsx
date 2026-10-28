import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Timer,
  Send,
  Bot,
  ChevronDown,
  Headphones,
  Music,
  Volume2,
  SkipForward,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import type { StudyDocument, StudyTimerState } from '../types/study';
import { studyStorage } from '../services/storageService';
import { computeTimerRemainingSeconds, formatTimestamp } from '../utils/quizGrading';
import { aiStudyClient } from '../services/aiClient';
import { LOFI_PRESETS, type LofiPresetOption } from './StudyTimerFocusBar';

export type CompanionMode = 'idle' | 'pomodoro' | 'ai';

interface DynamicCompanionProps {
  activeDoc?: StudyDocument | null;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  time: string;
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
    // ignore
  }
}

export const DynamicCompanion: React.FC<DynamicCompanionProps> = ({ activeDoc }) => {
  const [mode, setMode] = useState<CompanionMode>('idle');

  // ==========================================
  // 1. RICH POMODORO TIMER STATE & PERSISTENCE
  // ==========================================
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

  // Timer interval countdown
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
          studyStorage.addNotification({
            title: `Focus Session Complete (${timerState.durationMinutes}m)`,
            message: `Great concentration on "${docTitle}". Take a ${timerState.breakMinutes}-minute restorative break!`,
            category: 'goal',
            actionTab: 'study',
            documentId: activeDoc?.id,
          });

          const nextState: StudyTimerState = {
            ...timerState,
            mode: 'break',
            remainingSeconds: timerState.breakMinutes * 60,
            isRunning: false,
            targetEndTimestamp: null,
            completedSessionsCount: (timerState.completedSessionsCount || 0) + 1,
          };
          setTimerState(nextState);
          studyStorage.saveStudyTimerState(nextState);
        } else {
          studyStorage.addNotification({
            title: 'Break Finished',
            message: 'Break is over. Ready for your next study sprint?',
            category: 'goal',
            actionTab: 'study',
            documentId: activeDoc?.id,
          });

          const nextState: StudyTimerState = {
            ...timerState,
            mode: 'study',
            remainingSeconds: timerState.durationMinutes * 60,
            isRunning: false,
            targetEndTimestamp: null,
          };
          setTimerState(nextState);
          studyStorage.saveStudyTimerState(nextState);
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
  }, [timerState, activeDoc]);

  const handleStartPause = () => {
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

  // ==========================================
  // 2. AI COMPANION CHAT STATE
  // ==========================================
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: activeDoc
        ? `Studying "${activeDoc.title}"? Ask me for quick explanations, formulas, or key concepts!`
        : 'Hi! I am your real-time AI Study Companion. Ask me any concept, formula, or study question.',
      time: 'Now',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (mode === 'ai') {
      scrollToBottom();
    }
  }, [messages, mode]);

  const handleSendMessage = async (textOverride?: string) => {
    const text = (textOverride || inputValue).trim();
    if (!text || isAiLoading) return;

    const userMessage: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue('');
    setIsAiLoading(true);

    try {
      const resp = await aiStudyClient.askTutor({
        title: activeDoc?.title || 'General Concept',
        pages: activeDoc?.pages || [],
        question: text,
        history: messages.slice(-4).map((m) => ({
          role: m.role,
          content: m.text,
        })),
        sourceControlMode: 'extended_knowledge',
      });

      const reply = resp?.answer || 'Keep up the focused momentum! Let me know what you want to review next.';
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: reply,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: "Here's a quick focus tip: Recall the core definition first, then apply it to one active problem before moving on.",
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setIsAiLoading(false);
    }
  };

  // ==========================================
  // 3. OUTSIDE CLICK TO COLLAPSE
  // ==========================================
  const islandRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        setMode('idle');
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('idle');
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  return (
    <div
      ref={islandRef}
      className="fixed top-2 left-1/2 -translate-x-1/2 z-[100] pointer-events-auto select-none"
    >
      <motion.div
        layout
        transition={{
          type: 'spring',
          stiffness: 440,
          damping: 32,
        }}
        className={`bg-black/40 dark:bg-black/50 text-white backdrop-blur-3xl backdrop-saturate-150 border border-white/25 shadow-[0_8px_32px_0_rgba(0,0,0,0.35)] ring-1 ring-white/15 overflow-hidden transition-colors ${
          mode === 'idle' ? 'rounded-full' : 'rounded-3xl'
        }`}
      >
        {/* ========================================================= */}
        {/* IDLE MODE (Dynamic Island Pill with Live Controls)        */}
        {/* ========================================================= */}
        {mode === 'idle' && (
          <motion.div
            key="island-idle"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex items-center gap-2 px-3 py-1.5 h-9"
          >
            {/* Status Indicator */}
            <div className="flex items-center gap-1 pl-0.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  timerState.isRunning
                    ? 'bg-[#34A853] animate-pulse ring-2 ring-emerald-500/40'
                    : lofiPlaying
                    ? 'bg-[#4285F4] animate-pulse'
                    : 'bg-amber-400'
                }`}
              />
            </div>

            {/* Pomodoro Timer Trigger */}
            <button
              type="button"
              onClick={() => setMode('pomodoro')}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-white/15 text-xs font-mono font-medium transition-colors cursor-pointer text-slate-100 hover:text-white"
              title="Open Pomodoro & Focus Radio"
            >
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span>{formatTimestamp(timerState.remainingSeconds)}</span>
            </button>

            {/* Quick Play/Pause */}
            <button
              type="button"
              onClick={handleStartPause}
              title={timerState.isRunning ? 'Pause Timer' : 'Start Timer'}
              className="p-1 rounded-md hover:bg-white/15 text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              {timerState.isRunning ? (
                <Pause className="w-3 h-3 text-amber-300" />
              ) : (
                <Play className="w-3 h-3 fill-current text-emerald-400" />
              )}
            </button>

            {/* Quick Headphones Lo-Fi Trigger */}
            <button
              type="button"
              onClick={() => setLofiPlaying((p) => !p)}
              title={lofiPlaying ? 'Pause Focus Radio' : 'Play Focus Radio'}
              className={`p-1 rounded-md transition-colors cursor-pointer ${
                lofiPlaying
                  ? 'bg-[#4285F4] text-white shadow-xs'
                  : 'hover:bg-white/15 text-slate-300 hover:text-white'
              }`}
            >
              <Headphones className="w-3 h-3" />
            </button>

            {/* Divider */}
            <div className="w-[1px] h-3.5 bg-white/20" />

            {/* AI Companion Quick Trigger */}
            <button
              type="button"
              onClick={() => setMode('ai')}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-white/15 text-xs font-medium transition-colors cursor-pointer text-slate-200 hover:text-white"
              title="Open AI Study Companion"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin-slow" />
              <span className="font-medium tracking-tight">AI Companion</span>
            </button>
          </motion.div>
        )}

        {/* ========================================================= */}
        {/* POMODORO MODE (Full View matching StudyTimerFocusBar)     */}
        {/* ========================================================= */}
        {mode === 'pomodoro' && (
          <motion.div
            key="island-pomodoro"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="w-[360px] sm:w-[380px] p-4 flex flex-col gap-3 text-xs"
          >
            {/* Header: Document Title + Reset + Focus Mode + Controls */}
            <div className="flex items-center justify-between border-b border-white/15 pb-2.5">
              <span className="text-slate-200 font-medium truncate max-w-[170px]" title={activeDoc?.title || 'Study Session'}>
                {activeDoc?.title || 'Study Session'}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleReset}
                  className="px-2 py-1 rounded-md bg-white/10 hover:bg-white/20 text-[11px] font-medium text-slate-200 cursor-pointer transition-colors"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={handleToggleFullscreen}
                  className="px-2 py-1 rounded-md bg-[#4285F4] hover:bg-[#1A73E8] text-[11px] font-semibold text-white cursor-pointer transition-colors flex items-center gap-1"
                >
                  {isFullscreen ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
                  <span>{isFullscreen ? 'Exit Focus' : 'Focus Mode'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('ai')}
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-indigo-300 transition-colors cursor-pointer ml-1"
                  title="Switch to AI Companion"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Minimize to Island"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Timer Readout & Primary Controls */}
            <div className="flex items-center justify-between px-3 py-2 bg-white/[0.07] backdrop-blur-md rounded-2xl border border-white/10">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    timerState.isRunning ? 'bg-[#34A853] animate-pulse' : 'bg-slate-400'
                  }`}
                />
                <div>
                  <span className="text-2xl font-mono font-bold tracking-wider text-white">
                    {formatTimestamp(timerState.remainingSeconds)}
                  </span>
                  <span className="text-[10px] text-slate-400 block uppercase tracking-wider">
                    {timerState.mode === 'study' ? 'Deep Focus' : 'Break Time'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleStartPause}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-all ${
                    timerState.isRunning
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30'
                      : 'bg-[#34A853] hover:bg-emerald-600 text-white'
                  }`}
                >
                  {timerState.isRunning ? (
                    <>
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" /> Start Focus
                    </>
                  )}
                </button>

                {timerState.mode === 'break' && (
                  <button
                    type="button"
                    onClick={handleSkipBreak}
                    className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-slate-300 cursor-pointer"
                    title="Skip Break"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Lo-Fi Focus Radio (Deterministic Synth) */}
            <div className="space-y-2 pt-1 border-t border-white/10">
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

              {/* 6 Soundscapes Grid */}
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
                      activePresetId === preset.id && lofiPlaying
                        ? 'bg-[#4285F4]/30 border border-[#4285F4] text-white font-semibold'
                        : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="truncate">{preset.name}</div>
                  </button>
                ))}
              </div>

              {/* Volume Slider */}
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
          </motion.div>
        )}

        {/* ========================================================= */}
        {/* AI COMPANION MODE (Quick Student Tutor Chat)             */}
        {/* ========================================================= */}
        {mode === 'ai' && (
          <motion.div
            key="island-ai"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="w-[370px] max-w-[94vw] p-4 flex flex-col gap-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-indigo-500/20 text-indigo-400">
                  <Bot className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-xs font-bold tracking-tight text-white flex items-center gap-1.5">
                    <span>AI Study Companion</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-500/30 text-indigo-300 font-normal">
                      Claude & Gemini
                    </span>
                  </h4>
                  <span className="text-[10px] text-slate-400 truncate max-w-[200px] block">
                    {activeDoc ? activeDoc.title : 'Ready for any academic inquiry'}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMode('pomodoro')}
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-amber-300 transition-colors cursor-pointer"
                  title="Switch to Pomodoro Timer"
                >
                  <Timer className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setMode('idle')}
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
                  title="Minimize to Island"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Thread */}
            <div className="max-h-52 min-h-24 overflow-y-auto space-y-2.5 pr-1 text-xs">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${
                    msg.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-xs'
                        : 'bg-white/10 text-slate-200 border border-white/5 rounded-bl-xs'
                    }`}
                  >
                    {msg.text}
                  </div>
                  <span className="text-[9px] text-slate-500 mt-0.5 px-1">
                    {msg.time}
                  </span>
                </div>
              ))}
              {isAiLoading && (
                <div className="flex items-center gap-2 p-2 rounded-xl bg-white/5 text-slate-400 text-xs">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                  <span>Synthesizing response...</span>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Suggestion Chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {[
                'Key formula?',
                'Explain simply',
                'Quiz me',
                'Study tip',
              ].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => handleSendMessage(chip)}
                  disabled={isAiLoading}
                  className="px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/15 text-[10px] text-slate-300 hover:text-white transition-colors shrink-0 cursor-pointer border border-white/5"
                >
                  {chip}
                </button>
              ))}
            </div>

            {/* Input Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex items-center gap-1.5 pt-1"
            >
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask your companion anything..."
                className="flex-1 bg-white/10 hover:bg-white/15 focus:bg-white/15 border border-white/10 focus:border-indigo-400/50 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-400 focus:outline-none transition-colors"
              />
              <button
                type="submit"
                disabled={isAiLoading || !inputValue.trim()}
                className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors cursor-pointer shrink-0 shadow-sm"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
};
