import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  Send,
  Sparkles,
  BookOpen,
  Radio,
  Captions,
  UserCheck,
  Play,
  Square,
  AlertCircle,
} from 'lucide-react';
import type { StudyDocument, TutorCitation } from '../types/study';
import {
  LearnMateBuddyAvatar,
  type BuddyAvatarState,
} from './LearnMateBuddyAvatar';
import {
  upsertStreamingTranscriptChunk,
  finalizeActiveTranscriptTurn,
  type VoiceTranscriptEntry,
} from '../utils/stabilityEngine';

interface TranscriptTurnItem extends VoiceTranscriptEntry {
  citations?: TutorCitation[];
}

interface VoiceTutorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeDocument: StudyDocument;
  weakTopics: string[];
  onNavigateToCitation?: (pageNumber: number, quote?: string) => void;
}

function floatTo16BitPCMBase64(float32Array: Float32Array): string {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToFloat32PCM(base64: string): Float32Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const float32 = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const int16 = view.getInt16(i * 2, true);
    float32[i] = int16 / 32768;
  }
  return float32;
}

export const VoiceTutorModal: React.FC<VoiceTutorModalProps> = ({
  isOpen,
  onClose,
  activeDocument: studyDoc,
  weakTopics,
  onNavigateToCitation,
}) => {
  // Explicit Voice State Machine: Idle -> Requesting Permission -> Listening -> Thinking -> Speaking -> Idle
  const [voiceState, setVoiceState] = useState<BuddyAvatarState>('idle');
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [isMicMuted, setIsMicMuted] = useState<boolean>(false);
  const [isTutorAudioMuted, setIsTutorAudioMuted] = useState<boolean>(false);
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const [showAvatar, setShowAvatar] = useState<boolean>(true);

  const [statusNote, setStatusNote] = useState<string>(
    'Connecting to LearnMate Live Voice Tutor...'
  );
  const [micPermissionNote, setMicPermissionNote] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurnItem[]>([]);
  const [quickPromptInput, setQuickPromptInput] = useState<string>('');
  const [inputEnergy, setInputEnergy] = useState<number>(0);
  const [outputEnergy, setOutputEnergy] = useState<number>(0);

  // Refs to prevent stale closures in WebSocket & Web Audio callbacks
  const wsRef = useRef<WebSocket | null>(null);
  const isMicMutedRef = useRef<boolean>(false);
  const isTutorAudioMutedRef = useRef<boolean>(false);
  const voiceStateRef = useRef<BuddyAvatarState>('idle');
  const sessionActiveRef = useRef<boolean>(false);

  // Web Audio output pipeline (GainNode + AnalyserNode for real-time lip-sync energy)
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const outputGainRef = useRef<GainNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeSourcesCountRef = useRef<number>(0);
  const rafEnergyIdRef = useRef<number | null>(null);
  const synthIntervalRef = useRef<number | null>(null);

  // Microphone capture pipeline
  const micStreamRef = useRef<MediaStream | null>(null);
  const micCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const captionsContainerRef = useRef<HTMLDivElement | null>(null);

  const updateVoiceState = useCallback((next: BuddyAvatarState) => {
    voiceStateRef.current = next;
    setVoiceState(next);
  }, []);

  useEffect(() => {
    isMicMutedRef.current = isMicMuted;
  }, [isMicMuted]);

  useEffect(() => {
    isTutorAudioMutedRef.current = isTutorAudioMuted;
    if (outputGainRef.current && playbackCtxRef.current) {
      outputGainRef.current.gain.setValueAtTime(
        isTutorAudioMuted ? 0 : 1,
        playbackCtxRef.current.currentTime
      );
    }
    if (isTutorAudioMuted && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      if (synthIntervalRef.current) {
        window.clearInterval(synthIntervalRef.current);
        synthIntervalRef.current = null;
      }
      setOutputEnergy(0);
    }
  }, [isTutorAudioMuted]);

  // Auto-scroll live captions internally without scrolling the outer document/modal header
  useEffect(() => {
    if (showCaptions && captionsContainerRef.current) {
      const container = captionsContainerRef.current;
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [transcript, showCaptions]);

  const stopOutputEnergyMonitor = useCallback(() => {
    if (rafEnergyIdRef.current !== null) {
      window.cancelAnimationFrame(rafEnergyIdRef.current);
      rafEnergyIdRef.current = null;
    }
    if (synthIntervalRef.current !== null) {
      window.clearInterval(synthIntervalRef.current);
      synthIntervalRef.current = null;
    }
    setOutputEnergy(0);
  }, []);

  const startOutputEnergyMonitor = useCallback(() => {
    if (rafEnergyIdRef.current !== null) return;
    const sampleBuffer = new Uint8Array(128);

    const tick = () => {
      const analyser = outputAnalyserRef.current;
      if (!analyser || activeSourcesCountRef.current <= 0) {
        rafEnergyIdRef.current = null;
        setOutputEnergy(0);
        return;
      }

      analyser.getByteTimeDomainData(sampleBuffer);
      let sumSq = 0;
      for (let i = 0; i < sampleBuffer.length; i++) {
        const centered = (sampleBuffer[i] - 128) / 128;
        sumSq += centered * centered;
      }
      const rms = Math.sqrt(sumSq / sampleBuffer.length);
      const normalized = isTutorAudioMutedRef.current
        ? 0
        : Math.min(1, rms * 4.2);
      setOutputEnergy(normalized);

      rafEnergyIdRef.current = window.requestAnimationFrame(tick);
    };

    rafEnergyIdRef.current = window.requestAnimationFrame(tick);
  }, []);

  const stopMicrophoneCapture = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current = null;
    }
    if (micCtxRef.current) {
      try {
        void micCtxRef.current.close();
      } catch {
        // ignore
      }
      micCtxRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
    setInputEnergy(0);
  }, []);

  const stopAllAudio = useCallback(() => {
    stopMicrophoneCapture();
    stopOutputEnergyMonitor();
    activeSourcesCountRef.current = 0;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    }
    if (playbackCtxRef.current) {
      try {
        void playbackCtxRef.current.close();
      } catch {
        // ignore
      }
      playbackCtxRef.current = null;
      outputGainRef.current = null;
      outputAnalyserRef.current = null;
    }
    sessionActiveRef.current = false;
    setSessionActive(false);
    updateVoiceState('idle');
  }, [stopMicrophoneCapture, stopOutputEnergyMonitor, updateVoiceState]);

  const ensurePlaybackGraph = useCallback(() => {
    if (!playbackCtxRef.current) {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new AudioContextClass({ sampleRate: 24000 });
      const gain = ctx.createGain();
      gain.gain.value = isTutorAudioMutedRef.current ? 0 : 1;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.55;

      gain.connect(analyser);
      analyser.connect(ctx.destination);

      playbackCtxRef.current = ctx;
      outputGainRef.current = gain;
      outputAnalyserRef.current = analyser;
      nextPlayTimeRef.current = ctx.currentTime;
    }
    if (playbackCtxRef.current.state === 'suspended') {
      void playbackCtxRef.current.resume();
    }
    return {
      ctx: playbackCtxRef.current,
      gain: outputGainRef.current!,
    };
  }, []);

  const playPcm24kChunk = useCallback(
    (base64Data: string) => {
      try {
        const { ctx, gain } = ensurePlaybackGraph();
        const floatSamples = base64ToFloat32PCM(base64Data);
        if (floatSamples.length === 0) return;

        const audioBuffer = ctx.createBuffer(1, floatSamples.length, 24000);
        audioBuffer.getChannelData(0).set(floatSamples);

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(gain);

        const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
        source.start(startAt);
        nextPlayTimeRef.current = startAt + audioBuffer.duration;

        activeSourcesCountRef.current += 1;
        updateVoiceState('speaking');
        startOutputEnergyMonitor();

        source.onended = () => {
          activeSourcesCountRef.current = Math.max(0, activeSourcesCountRef.current - 1);
          if (activeSourcesCountRef.current === 0) {
            stopOutputEnergyMonitor();
            updateVoiceState(
              sessionActiveRef.current && !isMicMutedRef.current && micStreamRef.current
                ? 'listening'
                : 'idle'
            );
          }
        };
      } catch {
        // ignore audio decode error
      }
    },
    [ensurePlaybackGraph, startOutputEnergyMonitor, stopOutputEnergyMonitor, updateVoiceState]
  );

  const speakWithBrowserSynthesis = useCallback(
    (text: string) => {
      if (isTutorAudioMutedRef.current) {
        updateVoiceState(
          sessionActiveRef.current && !isMicMutedRef.current && micStreamRef.current
            ? 'listening'
            : 'idle'
        );
        return;
      }
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        updateVoiceState('idle');
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.02;
        utterance.pitch = 1.0;

        utterance.onstart = () => {
          updateVoiceState('speaking');
          if (synthIntervalRef.current) window.clearInterval(synthIntervalRef.current);
          // Modulate energy from syllable cadence while browser TTS is speaking
          let step = 0;
          synthIntervalRef.current = window.setInterval(() => {
            step += 1;
            const wave = 0.25 + 0.35 * Math.abs(Math.sin(step * 0.85));
            setOutputEnergy(isTutorAudioMutedRef.current ? 0 : wave);
          }, 90);
        };

        const finishSpeech = () => {
          if (synthIntervalRef.current) {
            window.clearInterval(synthIntervalRef.current);
            synthIntervalRef.current = null;
          }
          setOutputEnergy(0);
          updateVoiceState(
            sessionActiveRef.current && !isMicMutedRef.current && micStreamRef.current
              ? 'listening'
              : 'idle'
          );
        };

        utterance.onend = finishSpeech;
        utterance.onerror = finishSpeech;
        window.speechSynthesis.speak(utterance);
      } catch {
        setOutputEnergy(0);
        updateVoiceState('idle');
      }
    },
    [updateVoiceState]
  );

  const sendSpokenOrTypedQuestion = useCallback(
    (questionText: string) => {
      const cleaned = questionText.trim();
      if (!cleaned) return;

      // Finalize any open student turn and record the clean question
      setTranscript((prev) => {
        const finalized = finalizeActiveTranscriptTurn(prev, 'user');
        return [
          ...finalized,
          {
            id: `turn-student-${Date.now()}`,
            role: 'user',
            text: cleaned,
            isFinal: true,
          },
        ];
      });

      updateVoiceState('thinking');

      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'voice_question',
            question: cleaned,
          })
        );
      }
    },
    [updateVoiceState]
  );

  const startMicrophoneCapture = useCallback(async () => {
    setMicPermissionNote(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      setMicPermissionNote(
        'Your browser or preview environment does not support microphone capture. You can continue using the typed input or quick prompts below.'
      );
      updateVoiceState('idle');
      return;
    }

    updateVoiceState('requesting_permission');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000,
        },
      });
      micStreamRef.current = stream;

      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const micCtx = new AudioContextClass({ sampleRate: 16000 });
      if (micCtx.state === 'suspended') {
        await micCtx.resume();
      }
      micCtxRef.current = micCtx;

      const source = micCtx.createMediaStreamSource(stream);
      const processor = micCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (isMicMutedRef.current || !sessionActiveRef.current) {
          setInputEnergy(0);
          return;
        }
        const inputData = event.inputBuffer.getChannelData(0);
        let sum = 0;
        for (let i = 0; i < inputData.length; i++) {
          sum += inputData[i] * inputData[i];
        }
        const rms = Math.sqrt(sum / inputData.length);
        setInputEnergy(Math.min(1, rms * 8));

        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const base64Pcm = floatTo16BitPCMBase64(inputData);
          wsRef.current.send(
            JSON.stringify({
              type: 'audio',
              data: base64Pcm,
            })
          );
        }
      };

      source.connect(processor);
      processor.connect(micCtx.destination);

      // Start Web Speech API recognition in parallel for instant live student captions
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRec) {
        const recognition = new SpeechRec();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recognition.onresult = (evt: any) => {
          if (isMicMutedRef.current) return;
          for (let i = evt.resultIndex; i < evt.results.length; i++) {
            const res = evt.results[i];
            const text = res?.[0]?.transcript?.trim();
            if (!text) continue;
            if (res.isFinal) {
              sendSpokenOrTypedQuestion(text);
            } else {
              setTranscript((prev) =>
                upsertStreamingTranscriptChunk(prev, {
                  role: 'user',
                  chunkText: text,
                  isFinal: false,
                })
              );
            }
          }
        };
        recognition.onerror = () => {
          // ignore speech recognition fallback error
        };
        try {
          recognition.start();
          recognitionRef.current = recognition;
        } catch {
          // ignore
        }
      }

      setIsMicMuted(false);
      isMicMutedRef.current = false;
      updateVoiceState('listening');
      setStatusNote('Microphone active: speak naturally or choose a topic prompt.');
    } catch (err) {
      const errName = err instanceof Error ? err.name : '';
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        setMicPermissionNote(
          'No microphone device was detected on your system. You can still interact with LearnMate Buddy using the text input below.'
        );
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        setMicPermissionNote(
          'Microphone permission was denied. Allow microphone access in your browser address bar, or ask questions using the text input below.'
        );
      } else {
        setMicPermissionNote(
          'Microphone could not be started in this preview frame. You can ask questions using the text box or quick prompts below.'
        );
      }
      updateVoiceState('idle');
    }
  }, [sendSpokenOrTypedQuestion, updateVoiceState]);

  const startLiveSession = useCallback(() => {
    stopAllAudio();
    sessionActiveRef.current = true;
    setSessionActive(true);
    setMicPermissionNote(null);
    updateVoiceState('idle');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/live`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'setup',
          title: studyDoc.title,
          pages: studyDoc.pages,
          weakTopics,
        })
      );
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'status') {
          if (msg.state === 'connected') {
            setStatusNote('Connected to Gemini Live Audio (gemini-3.8-live)');
          } else {
            setStatusNote('Interactive Voice Tutor Ready');
          }
          const greeting = `Hi! I'm LearnMate Buddy, your voice tutor for ${studyDoc.title.replace(
            /\.pdf$/i,
            ''
          )}. ${
            weakTopics.length > 0
              ? `We can focus on ${weakTopics.slice(0, 2).join(' and ')} or any page you'd like.`
              : 'Ask me to explain any concept, quiz you verbally, or walk through a formula.'
          }`;
          setTranscript([
            {
              id: 'welcome-turn',
              role: 'assistant',
              text: greeting,
              isFinal: true,
            },
          ]);
        } else if (msg.type === 'audio' && msg.data) {
          playPcm24kChunk(msg.data);
        } else if (msg.type === 'output_transcription' && msg.text) {
          setTranscript((prev) =>
            upsertStreamingTranscriptChunk(prev, {
              role: 'assistant',
              chunkText: msg.text,
              isFinal: Boolean(msg.finished),
            })
          );
        } else if (msg.type === 'input_transcription' && msg.text) {
          setTranscript((prev) =>
            upsertStreamingTranscriptChunk(prev, {
              role: 'user',
              chunkText: msg.text,
              isFinal: Boolean(msg.finished),
            })
          );
        } else if (msg.type === 'transcript' && msg.text) {
          setTranscript((prev) =>
            upsertStreamingTranscriptChunk(prev, {
              role: msg.role === 'user' ? 'user' : 'assistant',
              chunkText: msg.text,
              isFinal: false,
            })
          );
        } else if (msg.type === 'voice_response' && msg.text) {
          setTranscript((prev) => [
            ...finalizeActiveTranscriptTurn(prev, 'assistant'),
            {
              id: `turn-tutor-${Date.now()}`,
              role: 'assistant',
              text: msg.text,
              citations: msg.citations,
              isFinal: true,
            },
          ]);
          speakWithBrowserSynthesis(msg.text);
        } else if (msg.type === 'interrupted') {
          if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.cancel();
          }
          stopOutputEnergyMonitor();
          setTranscript((prev) => finalizeActiveTranscriptTurn(prev, 'assistant', true));
          updateVoiceState(
            !isMicMutedRef.current && micStreamRef.current ? 'listening' : 'idle'
          );
        } else if (msg.type === 'turn_complete') {
          setTranscript((prev) => finalizeActiveTranscriptTurn(prev, 'assistant'));
          if (activeSourcesCountRef.current === 0) {
            stopOutputEnergyMonitor();
            updateVoiceState(
              !isMicMutedRef.current && micStreamRef.current ? 'listening' : 'idle'
            );
          }
        }
      } catch {
        // ignore malformed message
      }
    };

    ws.onerror = () => {
      setStatusNote('Voice tutor active (grounded speech synthesis mode)');
    };
  }, [
    playPcm24kChunk,
    speakWithBrowserSynthesis,
    stopAllAudio,
    stopOutputEnergyMonitor,
    studyDoc.pages,
    studyDoc.title,
    updateVoiceState,
    weakTopics,
  ]);

  const handleCloseModal = useCallback(() => {
    stopAllAudio();
    onClose();
  }, [stopAllAudio, onClose]);

  useEffect(() => {
    if (!isOpen) {
      stopAllAudio();
      return;
    }
    startLiveSession();
    return () => {
      stopAllAudio();
    };
  }, [isOpen, startLiveSession, stopAllAudio]);

  // Close on Escape key and lock background body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, handleCloseModal]);

  const handleToggleMic = async () => {
    if (!sessionActive) {
      startLiveSession();
    }
    // If microphone stream isn't started yet, request permission and start it
    if (!micStreamRef.current) {
      await startMicrophoneCapture();
      return;
    }
    const nextMuted = !isMicMuted;
    setIsMicMuted(nextMuted);
    isMicMutedRef.current = nextMuted;
    if (nextMuted) {
      setInputEnergy(0);
      if (voiceState === 'listening') {
        updateVoiceState('idle');
      }
    } else if (voiceState === 'idle') {
      updateVoiceState('listening');
    }
  };

  const handleToggleSession = () => {
    if (sessionActive) {
      stopAllAudio();
      setStatusNote('Voice session ended. Click Start Session to reconnect.');
    } else {
      startLiveSession();
    }
  };

  if (!isOpen) return null;

  const suggestedVoicePrompts = [
    weakTopics[0]
      ? `Explain ${weakTopics[0]} simply with an example`
      : `Summarize Page 1 of ${studyDoc.title}`,
    'Quiz me verbally with one quick question',
    'What is the most common mistake students make here?',
  ];

  return (
    <div
      className="fixed inset-0 z-50 h-[100dvh] max-h-[100dvh] overflow-hidden bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="LearnMate Live Voice Tutor"
      data-testid="voice-tutor-modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleCloseModal();
        }
      }}
    >
      <div
        className="bg-white rounded-3xl shadow-2xl border border-slate-200/90 w-full max-w-xl max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2.5rem)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pinned Top Header — shrink-0 & sticky so Close button never moves off-screen */}
        <div className="shrink-0 sticky top-0 z-20 px-4 sm:px-6 py-3.5 border-b border-slate-100 flex items-center justify-between gap-2 bg-gradient-to-r from-[#4285F4]/10 via-[#FBBC05]/10 to-[#34A853]/10 backdrop-blur-md">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#4285F4] text-white flex items-center justify-center shadow-xs shrink-0">
              <Radio className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm sm:text-base font-bold text-[#172033]">
                  Live Voice Tutor
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#E8F0FE] text-[#1A73E8]">
                  LearnMate Buddy
                </span>
              </div>
              <p className="text-xs text-[#64748B] truncate max-w-[200px] sm:max-w-[300px]">
                {statusNote}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleToggleSession}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                sessionActive
                  ? 'bg-red-50 text-[#EA4335] hover:bg-red-100 border border-red-200/70'
                  : 'bg-[#E8F0FE] text-[#1A73E8] hover:bg-blue-100 border border-blue-200/70'
              }`}
            >
              {sessionActive ? (
                <>
                  <Square className="w-3 h-3 fill-current" />
                  <span className="hidden xs:inline">End Session</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current" />
                  <span className="hidden xs:inline">Start Session</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="close-voice-tutor-button"
              onClick={handleCloseModal}
              aria-label="Close Live Voice Tutor"
              title="Close Live Voice Tutor (Esc)"
              className="w-9 h-9 rounded-full bg-white/90 hover:bg-slate-100 border border-slate-200/80 text-slate-600 hover:text-[#172033] flex items-center justify-center shadow-2xs transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Middle Area (Avatar + Controls + Live Captions) */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
          {/* Animated 2D Avatar & Controls Bar */}
          <div className="shrink-0 px-4 sm:px-6 pt-3 pb-3 flex flex-col items-center bg-gradient-to-b from-slate-50/70 to-white border-b border-slate-100">
            {showAvatar && (
              <div className="mb-2.5 scale-95 sm:scale-100 origin-center">
                <LearnMateBuddyAvatar
                  state={voiceState}
                  outputEnergy={outputEnergy}
                  inputEnergy={inputEnergy}
                />
              </div>
            )}

            {/* Primary Interactive Voice Controls */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleToggleMic}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all shadow-2xs cursor-pointer ${
                  micStreamRef.current && !isMicMuted
                    ? 'bg-[#EA4335] hover:bg-[#D93025] text-white'
                    : 'bg-[#1A73E8] hover:bg-[#1557B0] text-white'
                }`}
              >
                {micStreamRef.current && !isMicMuted ? (
                  <>
                    <MicOff className="w-3.5 h-3.5" />
                    <span>Mute Mic</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>{micStreamRef.current ? 'Unmute Mic' : 'Enable Mic'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsTutorAudioMuted((m) => !m)}
                aria-pressed={isTutorAudioMuted}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  isTutorAudioMuted
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-white border-slate-200 text-[#172033] hover:bg-slate-50'
                }`}
              >
                {isTutorAudioMuted ? (
                  <>
                    <VolumeX className="w-3.5 h-3.5 text-amber-600" />
                    <span>Tutor Muted</span>
                  </>
                ) : (
                  <>
                    <Volume2 className="w-3.5 h-3.5 text-[#34A853]" />
                    <span>Mute Tutor Audio</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setShowCaptions((c) => !c)}
                aria-pressed={showCaptions}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  showCaptions
                    ? 'bg-[#E8F0FE] border-blue-200 text-[#1A73E8]'
                    : 'bg-white border-slate-200 text-[#64748B] hover:bg-slate-50'
                }`}
              >
                <Captions className="w-3.5 h-3.5" />
                <span>{showCaptions ? 'Hide Captions' : 'Show Captions'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAvatar((a) => !a)}
                aria-pressed={showAvatar}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold border transition-colors cursor-pointer ${
                  showAvatar
                    ? 'bg-[#E8F0FE] border-blue-200 text-[#1A73E8]'
                    : 'bg-white border-slate-200 text-[#64748B] hover:bg-slate-50'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>{showAvatar ? 'Hide Avatar' : 'Show Avatar'}</span>
              </button>
            </div>

            {micPermissionNote && (
              <div className="mt-2.5 flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200/80 px-3.5 py-2 rounded-xl max-w-md">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>{micPermissionNote}</span>
              </div>
            )}
          </div>

          {/* Synchronized Live Captions Transcript */}
          {showCaptions && (
            <div
              ref={captionsContainerRef}
              className="flex-1 overflow-y-auto px-4 sm:px-6 py-3 space-y-3 min-h-[120px] bg-slate-50/50"
              data-testid="live-voice-captions"
            >
              {transcript.length === 0 ? (
                <p className="text-xs text-center text-[#64748B] py-6">
                  Live captions will appear here as you and LearnMate Buddy speak.
                </p>
              ) : (
                transcript.map((item) => (
                  <div
                    key={item.id}
                    className={`flex flex-col ${
                      item.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B] mb-1 px-1">
                      {item.role === 'user' ? 'You (Student)' : 'LearnMate Buddy'}
                    </span>
                    <div
                      className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                        item.role === 'user'
                          ? 'bg-[#1A73E8] text-white rounded-br-xs'
                          : 'bg-white border border-slate-200/90 text-[#172033] rounded-bl-xs shadow-2xs'
                      }`}
                    >
                      <p>{item.text}</p>
                      {item.citations && item.citations.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.citations.map((cit: TutorCitation, idx: number) => (
                            <button
                              key={`${cit.pageNumber}-${idx}`}
                              type="button"
                              onClick={() => {
                                if (onNavigateToCitation) {
                                  onNavigateToCitation(cit.pageNumber, cit.quote);
                                }
                              }}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E8F0FE] text-[#1A73E8] text-[11px] font-semibold hover:bg-blue-100 cursor-pointer"
                            >
                              <BookOpen className="w-3 h-3" />
                              <span>Page {cit.pageNumber}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Pinned Bottom Quick Spoken Prompts + Typed Text Fallback Input */}
        <div className="shrink-0 p-3.5 sm:p-4 bg-white border-t border-slate-100 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {suggestedVoicePrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => sendSpokenOrTypedQuestion(prompt)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#F8FAFC] hover:bg-[#E8F0FE] hover:text-[#1A73E8] border border-slate-200/80 text-xs font-medium text-[#172033] transition-colors cursor-pointer"
              >
                <Sparkles className="w-3 h-3 text-[#4285F4] shrink-0" />
                <span className="truncate max-w-[230px]">{prompt}</span>
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!quickPromptInput.trim()) return;
              sendSpokenOrTypedQuestion(quickPromptInput);
              setQuickPromptInput('');
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={quickPromptInput}
              onChange={(e) => setQuickPromptInput(e.target.value)}
              placeholder="Ask by speaking or type a question for LearnMate Buddy..."
              aria-label="Ask by speaking or type a question for LearnMate Buddy"
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#F8FAFC] border border-slate-200/90 text-sm text-[#172033] placeholder:text-slate-400 focus:outline-none focus:border-[#4285F4]"
            />
            <button
              type="submit"
              disabled={!quickPromptInput.trim()}
              aria-label="Send voice question"
              className="px-4 py-2.5 rounded-xl bg-[#1A73E8] hover:bg-[#1557B0] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
