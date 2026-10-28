import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Timer,
  X,
  Send,
  Bot,
  Flame,
  CheckCircle2,
  ChevronDown,
} from 'lucide-react';
import type { StudyDocument } from '../types/study';
import { aiStudyClient } from '../services/aiClient';

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

export const DynamicCompanion: React.FC<DynamicCompanionProps> = ({ activeDoc }) => {
  const [mode, setMode] = useState<CompanionMode>('idle');

  // ==========================================
  // 1. POMODORO TIMER STATE
  // ==========================================
  const DEFAULT_FOCUS_TIME = 25 * 60; // 25 minutes
  const DEFAULT_BREAK_TIME = 5 * 60;  // 5 minutes

  const [timeLeft, setTimeLeft] = useState(DEFAULT_FOCUS_TIME);
  const [isActive, setIsActive] = useState(false);
  const [timerType, setTimerType] = useState<'focus' | 'break'>('focus');
  const [completedSessions, setCompletedSessions] = useState(0);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0) {
      if (isActive) {
        setIsActive(false);
        if (timerType === 'focus') {
          setCompletedSessions((c) => c + 1);
          setTimerType('break');
          setTimeLeft(DEFAULT_BREAK_TIME);
        } else {
          setTimerType('focus');
          setTimeLeft(DEFAULT_FOCUS_TIME);
        }
      }
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isActive, timeLeft, timerType]);

  const toggleTimer = () => setIsActive((prev) => !prev);

  const resetTimer = () => {
    setIsActive(false);
    setTimeLeft(timerType === 'focus' ? DEFAULT_FOCUS_TIME : DEFAULT_BREAK_TIME);
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
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
        className={`bg-black/75 dark:bg-zinc-950/75 text-white backdrop-blur-2xl border border-white/20 shadow-[0_12px_40px_rgba(0,0,0,0.45)] ring-1 ring-white/10 overflow-hidden transition-colors ${
          mode === 'idle' ? 'rounded-full' : 'rounded-3xl'
        }`}
      >
        {/* ========================================================= */}
        {/* IDLE MODE (Sleek Black Pill with dynamic island indicator) */}
        {/* ========================================================= */}
        {mode === 'idle' && (
          <motion.div
            key="island-idle"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex items-center gap-2.5 px-3.5 py-1.5 h-9"
          >
            {/* Pulsing Island Indicator */}
            <div className="flex items-center gap-1.5 pl-0.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isActive
                    ? 'bg-emerald-400 animate-pulse ring-2 ring-emerald-500/40'
                    : timeLeft < DEFAULT_FOCUS_TIME
                    ? 'bg-amber-400'
                    : 'bg-indigo-400'
                }`}
              />
            </div>

            {/* Pomodoro Quick Pill */}
            <button
              type="button"
              onClick={() => setMode('pomodoro')}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full hover:bg-white/10 text-xs font-mono font-medium transition-colors cursor-pointer text-slate-200 hover:text-white"
              title="Open Pomodoro Timer"
            >
              <Timer className="w-3.5 h-3.5 text-amber-400" />
              <span>{formatTime(timeLeft)}</span>
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
              )}
            </button>

            {/* Divider */}
            <div className="w-[1px] h-3.5 bg-white/20" />

            {/* AI Companion Quick Pill */}
            <button
              type="button"
              onClick={() => setMode('ai')}
              className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full hover:bg-white/10 text-xs font-medium transition-colors cursor-pointer text-slate-200 hover:text-white"
              title="Open AI Study Companion"
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-spin-slow" />
              <span className="font-medium tracking-tight">AI Companion</span>
            </button>
          </motion.div>
        )}

        {/* ========================================================= */}
        {/* POMODORO MODE (Expanded Island with Timer Controls)       */}
        {/* ========================================================= */}
        {mode === 'pomodoro' && (
          <motion.div
            key="island-pomodoro"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="w-[340px] p-4 flex flex-col gap-3"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-amber-500/20 text-amber-400">
                  <Timer className="w-4 h-4" />
                </span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    {timerType === 'focus' ? 'Deep Focus Session' : 'Quick Break'}
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    {completedSessions} {completedSessions === 1 ? 'cycle' : 'cycles'} finished today
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setMode('ai')}
                  className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-indigo-300 transition-colors cursor-pointer"
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

            {/* Big Digital Clock Display */}
            <div className="flex flex-col items-center justify-center py-2 bg-white/5 rounded-2xl border border-white/5">
              <span className="text-4xl font-mono font-extrabold tracking-widest text-white drop-shadow-sm">
                {formatTime(timeLeft)}
              </span>
              <div className="flex items-center gap-1.5 mt-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    isActive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                  }`}
                />
                <span className="text-[11px] font-medium text-slate-400">
                  {isActive
                    ? timerType === 'focus'
                      ? 'Session in progress...'
                      : 'Resting mind...'
                    : 'Paused'}
                </span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-center gap-2 pt-0.5">
              <button
                type="button"
                onClick={toggleTimer}
                className={`flex-1 py-2 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all shadow-sm ${
                  isActive
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-black'
                }`}
              >
                {isActive ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" /> Start Focus
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetTimer}
                className="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
                title="Reset to 25m"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </motion.div>
        )}

        {/* ========================================================= */}
        {/* AI COMPANION MODE (Expanded Island with Quick Tutor Chat)  */}
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
