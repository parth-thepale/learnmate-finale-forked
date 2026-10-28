import React, { useEffect, useState, useRef } from 'react';
import { AlertTriangle, ShieldAlert, Maximize2, Lock } from 'lucide-react';

interface QuizProctorOverlayProps {
  isQuizActive: boolean;
  onAutoSubmit: () => void;
  quizTitle?: string;
}

export const QuizProctorOverlay: React.FC<QuizProctorOverlayProps> = ({
  isQuizActive,
  onAutoSubmit,
  quizTitle = 'Quiz',
}) => {
  const [warningCount, setWarningCount] = useState(0);
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [lastInfraction, setLastInfraction] = useState<'fullscreen' | 'tab'>('fullscreen');
  const [isLocked, setIsLocked] = useState(false);
  const hasAutoSubmittedRef = useRef(false);

  // Trigger fullscreen when quiz becomes active
  useEffect(() => {
    if (isQuizActive) {
      setWarningCount(0);
      setShowWarningModal(false);
      setIsLocked(false);
      hasAutoSubmittedRef.current = false;

      // Request fullscreen automatically
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {
          // May require user gesture on some browser configurations
        });
      }
    } else {
      // Exit fullscreen when quiz finishes if currently in fullscreen
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    }
  }, [isQuizActive]);

  // Infraction detection: Fullscreen exit and Tab switching
  useEffect(() => {
    if (!isQuizActive) return;

    const handleInfraction = (type: 'fullscreen' | 'tab') => {
      if (hasAutoSubmittedRef.current) return;

      setLastInfraction(type);
      setWarningCount((prev) => {
        const nextCount = prev + 1;
        if (nextCount >= 3) {
          hasAutoSubmittedRef.current = true;
          setIsLocked(true);
          setShowWarningModal(true);
          // Auto submit the quiz immediately
          try {
            onAutoSubmit();
          } catch (err) {
            console.error('Error auto-submitting quiz:', err);
          }
          return 3;
        } else {
          setShowWarningModal(true);
          return nextCount;
        }
      });
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isQuizActive && !hasAutoSubmittedRef.current) {
        handleInfraction('fullscreen');
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden && isQuizActive && !hasAutoSubmittedRef.current) {
        handleInfraction('tab');
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isQuizActive, onAutoSubmit]);

  const handleReturnToFullscreen = async () => {
    if (isLocked) {
      setShowWarningModal(false);
      return;
    }

    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Ignore
    } finally {
      setShowWarningModal(false);
    }
  };

  if (!isQuizActive && !showWarningModal) return null;

  return (
    <>
      {/* Floating Proctoring Badge while taking quiz */}
      {isQuizActive && !showWarningModal && (
        <div
          data-testid="proctoring-active-badge"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/75 dark:bg-zinc-900/80 backdrop-blur-xl border border-white/20 text-white shadow-xl text-xs select-none pointer-events-none transition-all"
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-semibold text-slate-200">Proctored Full Screen</span>
          <span className="text-white/40">·</span>
          <span
            className={`font-mono font-bold ${
              warningCount === 0
                ? 'text-emerald-400'
                : warningCount === 1
                ? 'text-amber-400'
                : 'text-red-400'
            }`}
          >
            {warningCount}/3 Warnings
          </span>
        </div>
      )}

      {/* Warning Overlay Modal */}
      {showWarningModal && (
        <div
          data-testid="proctoring-warning-modal"
          className="fixed inset-0 z-[9999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-200"
        >
          <div className="max-w-md w-full bg-zinc-900 border border-white/20 rounded-3xl p-6 sm:p-7 shadow-2xl text-center space-y-5 text-white">
            {/* Warning Icon Badge */}
            <div className="mx-auto w-16 h-16 rounded-2xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 animate-pulse">
              {isLocked ? <Lock className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
            </div>

            {/* Title */}
            <div className="space-y-1">
              <span className="text-[11px] font-bold uppercase tracking-wider text-red-400 bg-red-500/10 px-3 py-1 rounded-full border border-red-500/20">
                {isLocked ? 'Quiz Locked' : `Proctor Warning ${warningCount} of 3`}
              </span>
              <h3 className="text-xl font-extrabold text-white pt-2">
                {isLocked
                  ? 'Maximum Warnings Exceeded'
                  : lastInfraction === 'fullscreen'
                  ? 'Full Screen Exited'
                  : 'Tab Switch Detected'}
              </h3>
            </div>

            {/* Strike Indicators */}
            <div className="flex items-center justify-center gap-2 pt-1">
              {[1, 2, 3].map((step) => {
                const isTripped = step <= warningCount;
                return (
                  <div
                    key={step}
                    className={`flex-1 h-2 rounded-full transition-colors ${
                      isTripped
                        ? step === 3
                          ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
                          : 'bg-amber-400'
                        : 'bg-white/10'
                    }`}
                  />
                );
              })}
            </div>

            {/* Description */}
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              {isLocked ? (
                <>
                  You have exited full screen <strong>3 times</strong> during this quiz. To maintain
                  academic integrity, your quiz has been <strong>automatically submitted</strong>.
                </>
              ) : (
                <>
                  <strong>{quizTitle}</strong> requires full screen mode at all times. Leaving full
                  screen or switching tabs is recorded as an infraction.
                  <br />
                  <span className="text-amber-300 font-semibold mt-1 block">
                    {3 - warningCount} {3 - warningCount === 1 ? 'warning remains' : 'warnings remain'}{' '}
                    before automatic submission.
                  </span>
                </>
              )}
            </p>

            {/* Action Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleReturnToFullscreen}
                className={`w-full py-3 px-5 rounded-2xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg ${
                  isLocked
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : 'bg-emerald-500 hover:bg-emerald-600 text-black'
                }`}
              >
                {isLocked ? (
                  <span>Acknowledge & View Results</span>
                ) : (
                  <>
                    <Maximize2 className="w-4 h-4" />
                    <span>Return to Full Screen & Resume Quiz</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
