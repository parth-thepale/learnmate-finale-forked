import React, { useEffect, useState } from 'react';
import { Clock, Video, Box, Zap, RefreshCw, AlertCircle, CheckCircle2, Shield } from 'lucide-react';
import { aiStudyClient, type UserDailyUsage } from '../services/aiClient';

interface AiUsageDashboardProps {
  onClose?: () => void;
  compact?: boolean;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m ${s % 60}s`;
}

export const AiUsageDashboard: React.FC<AiUsageDashboardProps> = ({ compact = false }) => {
  const [usage, setUsage] = useState<UserDailyUsage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await aiStudyClient.fetchUserDailyUsage();
      setUsage(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load usage meters.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
    const interval = setInterval(loadUsage, 60000); // Poll once a minute
    return () => clearInterval(interval);
  }, []);

  if (loading && !usage) {
    return (
      <div className="p-4 rounded-xl border border-dashed border-[var(--border-paper,#E8E6E2)] text-center text-xs text-[var(--text-muted,#606B7C)] flex items-center justify-center gap-2">
        <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#C84428]" />
        <span>Loading daily AI quota meters...</span>
      </div>
    );
  }

  if (error && !usage) {
    return (
      <div className="p-4 rounded-xl border border-red-200 dark:border-red-900/40 bg-red-50/50 dark:bg-red-950/20 text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
        <button
          type="button"
          onClick={loadUsage}
          className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/60 font-semibold hover:bg-red-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!usage) return null;

  const activePct = Math.min(100, Math.round((usage.activeSeconds / usage.maxActiveSeconds) * 100));
  const activeColor =
    activePct >= 95 ? 'bg-red-500' : activePct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <div className={`space-y-4 ${compact ? 'text-xs' : 'text-sm'}`}>
      {/* Header with IST Reset Time */}
      <div className="flex items-center justify-between border-b border-[var(--border-paper,#E8E6E2)] pb-2.5">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#C84428]" />
          <h3 className="font-semibold text-[var(--text-ink,#121827)]">Daily AI Activity &amp; Quotas</h3>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted,#606B7C)]">
          <span>Reset: 00:00 IST ({formatDuration(usage.nextResetSeconds)})</span>
          <button
            type="button"
            onClick={loadUsage}
            disabled={loading}
            title="Refresh quota status"
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Grid of Quota Cards */}
      <div className={`grid gap-3 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-3'}`}>
        {/* 1. 5-Hour Daily AI Activity */}
        <div className="p-3.5 rounded-xl border border-[var(--border-paper,#E8E6E2)] bg-[var(--bg-surface,#FFFFFF)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted,#606B7C)]">
            <span className="flex items-center gap-1.5 font-medium">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              AI Activity (5h max)
            </span>
            <span className="font-semibold text-[var(--text-ink,#121827)]">{activePct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
            <div className={`h-full ${activeColor} transition-all duration-300`} style={{ width: `${activePct}%` }} />
          </div>
          <div className="flex justify-between items-center text-[11px] text-[var(--text-muted,#606B7C)]">
            <span>Used: {formatDuration(usage.activeSeconds)}</span>
            <span>Left: {formatDuration(usage.remainingActiveSeconds)}</span>
          </div>
        </div>

        {/* 2. Video Generations (Max 3/day) */}
        <div className="p-3.5 rounded-xl border border-[var(--border-paper,#E8E6E2)] bg-[var(--bg-surface,#FFFFFF)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted,#606B7C)]">
            <span className="flex items-center gap-1.5 font-medium">
              <Video className="w-3.5 h-3.5 text-purple-500" />
              Video Lessons (Max 3)
            </span>
            <span className="font-semibold text-[var(--text-ink,#121827)]">
              {usage.videoGenerations} / {usage.maxVideoGenerations}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {Array.from({ length: usage.maxVideoGenerations }).map((_, idx) => {
              const filled = idx < usage.videoGenerations;
              return (
                <div
                  key={idx}
                  className={`h-2 rounded-full ${
                    filled ? 'bg-purple-500' : 'bg-black/5 dark:bg-white/10'
                  }`}
                  title={filled ? `Video ${idx + 1} generated` : `Slot ${idx + 1} available`}
                />
              );
            })}
          </div>
          <div className="text-[11px] text-[var(--text-muted,#606B7C)] text-right">
            {usage.remainingVideoGenerations} remaining today
          </div>
        </div>

        {/* 3. 3D Model Generations (Max 3/day) */}
        <div className="p-3.5 rounded-xl border border-[var(--border-paper,#E8E6E2)] bg-[var(--bg-surface,#FFFFFF)] space-y-2">
          <div className="flex items-center justify-between text-xs text-[var(--text-muted,#606B7C)]">
            <span className="flex items-center gap-1.5 font-medium">
              <Box className="w-3.5 h-3.5 text-emerald-500" />
              3D Models (Max 3)
            </span>
            <span className="font-semibold text-[var(--text-ink,#121827)]">
              {usage.model3DGenerations} / {usage.maxModel3DGenerations}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            {Array.from({ length: usage.maxModel3DGenerations }).map((_, idx) => {
              const filled = idx < usage.model3DGenerations;
              return (
                <div
                  key={idx}
                  className={`h-2 rounded-full ${
                    filled ? 'bg-emerald-500' : 'bg-black/5 dark:bg-white/10'
                  }`}
                  title={filled ? `3D Model ${idx + 1} generated` : `Slot ${idx + 1} available`}
                />
              );
            })}
          </div>
          <div className="text-[11px] text-[var(--text-muted,#606B7C)] text-right">
            {usage.remainingModel3DGenerations} remaining today
          </div>
        </div>
      </div>

      {/* Dynamic Token & Cost Status (Cleanly handles unconfigured vs configured budget) */}
      <div className="p-3 rounded-lg border border-[var(--border-paper,#E8E6E2)] bg-[var(--bg-card,#F7F5F0)]/40 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 text-[var(--text-muted,#606B7C)]">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          <span>
            {usage.dailyBudgetUsd !== null && usage.remainingBudgetUsd !== null ? (
              <span>
                Estimated Budget: <strong>${usage.remainingBudgetUsd.toFixed(2)}</strong> left of $
                {usage.dailyBudgetUsd.toFixed(2)}
              </span>
            ) : (
              <span>
                Compute Cost Budget: <em>Awaiting owner configuration</em> (Tokens: {usage.inputTokens.toLocaleString()} in /{' '}
                {usage.outputTokens.toLocaleString()} out)
              </span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted,#606B7C)]">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          <span>Authoritative Backend Sync</span>
        </div>
      </div>
    </div>
  );
};
