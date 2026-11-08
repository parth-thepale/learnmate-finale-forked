import React, { useState, useRef, useEffect } from 'react';
import {
  Search,
  Bell,
  Sun,
  Moon,
  Timer,
  User as UserIcon,
  LogIn,
  LogOut,
  ChevronDown,
  BookOpen,
  Sparkles,
  Award,
  Layers,
  Compass,
  FileText,
  Clock,
  Menu,
  X,
  Cloud,
  CloudOff,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { User } from 'firebase/auth';
import type { StudyDocument, LearnMateNotification, StudentAcademicProfile } from '../types/study';
import type { SyncSnapshot } from '../services/syncStatus';
import type { UnifiedSyncStatus } from '../features/roadmaps/services/roadmapSyncCoordinator';
import {
  CapsuleButton,
  CapsuleNavItem,
  CapsuleControl,
} from './capsule';
import { DynamicEdge } from './DynamicEdge';

export type ActiveTab =
  | 'home'
  | 'chapters'
  | 'sessions'
  | 'mocks'
  | 'roadmaps'
  | 'dashboard'
  | 'study'
  | 'revision'
  | 'practice'
  | 'explore'
  | 'ai-tutor'
  | 'create'
  | 'pdf-workspace'
  | 'analytics'
  | 'profile';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  hasActiveDoc?: boolean;
  activeDoc?: StudyDocument | null;
  onOpenNotebookModal?: () => void;
  user?: User | null;
  isAuthReady?: boolean;
  isSyncing?: boolean;
  syncSnapshot?: SyncSnapshot;
  roadmapSyncStatus?: UnifiedSyncStatus;
  onRetryFailedRoadmapSync?: () => void;
  onLogin?: () => void;
  onLogout?: () => void;
  documents?: StudyDocument[];
  onSelectDocumentFromSearch?: (doc: StudyDocument) => void;
  notifications?: LearnMateNotification[];
  onMarkNotificationsRead?: () => void;
  onOpenProfileModal?: () => void;
  studentProfile?: StudentAcademicProfile;
  focusMode?: boolean;
  onToggleFocusMode?: () => void;
  dynamicEdgeOpen?: boolean;
  onToggleDynamicEdge?: () => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  activeDoc,
  user,
  isAuthReady,
  isSyncing,
  syncSnapshot,
  roadmapSyncStatus,
  onRetryFailedRoadmapSync,
  onLogin,
  onLogout,
  documents = [],
  onSelectDocumentFromSearch,
  notifications = [],
  onMarkNotificationsRead,
  onOpenProfileModal,
  studentProfile,
  dynamicEdgeOpen = false,
  onToggleDynamicEdge,
  theme = 'light',
  onToggleTheme,
}) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setNotifOpen(false);
        setProfileOpen(false);
        setMobileMenuOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (searchOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchOpen]);

  // Founder Blueprint 5 Core Destinations (Minimal Horizontal)
  const navLinks: Array<{ id: ActiveTab; label: string; aliases: ActiveTab[] }> = [
    { id: 'home', label: 'Home', aliases: ['home', 'dashboard'] },
    { id: 'chapters', label: 'Chapters', aliases: ['chapters'] },
    { id: 'sessions', label: 'Sessions', aliases: ['sessions', 'study', 'pdf-workspace'] },
    { id: 'mocks', label: 'Mocks / PYQs', aliases: ['mocks', 'practice'] },
    { id: 'roadmaps', label: 'Roadmaps', aliases: ['roadmaps'] },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredDocs = searchQuery.trim()
    ? documents.filter(
        (d) =>
          d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.pages.some((p) => p.content.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const avatarInitial =
    user?.displayName?.[0]?.toUpperCase() ||
    studentProfile?.fullName?.[0]?.toUpperCase() ||
    'S';

  // Determine comprehensive sync status across storage & roadmaps
  const effectiveState = React.useMemo(() => {
    if (!user) return null;
    if (roadmapSyncStatus?.state === 'has_failed_mutations' || (roadmapSyncStatus?.failedCount ?? 0) > 0) {
      return 'recoverable_failures';
    }
    if (
      isSyncing ||
      roadmapSyncStatus?.state === 'syncing' ||
      (syncSnapshot && syncSnapshot.state === 'syncing')
    ) {
      return 'syncing';
    }
    if (
      roadmapSyncStatus?.state === 'offline_pending' ||
      (typeof navigator !== 'undefined' &&
        !navigator.onLine &&
        ((roadmapSyncStatus?.pendingCount ?? 0) > 0 || (syncSnapshot?.unsyncedChanges ?? 0) > 0))
    ) {
      return 'offline_pending';
    }
    if (
      roadmapSyncStatus?.state === 'sync_failed' ||
      (syncSnapshot && syncSnapshot.state === 'unsynced' && syncSnapshot.lastError)
    ) {
      return 'sync_failed';
    }
    if (
      (roadmapSyncStatus?.pendingCount ?? 0) > 0 ||
      (syncSnapshot && syncSnapshot.unsyncedChanges > 0)
    ) {
      return 'syncing';
    }
    return 'synced';
  }, [user, isSyncing, syncSnapshot, roadmapSyncStatus]);

  return (
    <>
      <header className="sticky top-0 z-40 w-full bg-[var(--bg-surface)] border-b border-[var(--border-paper)] lm-no-print transition-colors">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4">
          
          {/* LEFT: Learnmate Wordmark / Brand Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => onSelectTab('home')}
              className="flex items-center gap-2 text-left focus:outline-none cursor-pointer group"
              aria-label="Learnmate Home"
            >
              <div className="w-8 h-8 rounded-lg bg-[var(--accent-terracotta)] text-white flex items-center justify-center font-serif-editorial font-bold text-lg shadow-sm">
                L
              </div>
              <span className="font-serif-editorial font-bold text-2xl tracking-tight text-[var(--text-ink)]">
                Learn<span className="text-[var(--accent-terracotta)]">mate</span>
              </span>
            </button>
          </div>

          {/* CENTER: Minimal Horizontal Navigation Tabs with Capsule Geometry */}
          <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1.5 h-15">
            {navLinks.map((item) => {
              const isActive = item.aliases.includes(activeTab);
              return (
                <CapsuleNavItem
                  key={item.id}
                  id={`nav-link-${item.id}`}
                  label={item.label}
                  isActive={isActive}
                  onClick={() => onSelectTab(item.id)}
                />
              );
            })}
          </nav>

          {/* RIGHT: Dynamic Edge Capsule, Search, Theme Toggle, Notifications, Profile */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {/* Roadmap & Cloud Sync Badge */}
            {(() => {
              if (
                !user &&
                !roadmapSyncStatus?.pendingCount &&
                !roadmapSyncStatus?.failedCount &&
                !roadmapSyncStatus?.unpersistedCount
              ) {
                return null;
              }
              const state = effectiveState ?? roadmapSyncStatus?.state ?? (isSyncing ? 'syncing' : 'synced');
              const pending = (roadmapSyncStatus?.pendingCount ?? 0) + (syncSnapshot?.unsyncedChanges ?? 0);
              const failed = roadmapSyncStatus?.failedCount ?? 0;
              const unpersisted = roadmapSyncStatus?.unpersistedCount ?? 0;

              if (state === 'persistence_failed') {
                return (
                  <div
                    data-testid="navbar-sync-badge"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-600/10 text-rose-700 dark:text-rose-400 border border-rose-600/30"
                    title={`${unpersisted} change${unpersisted === 1 ? '' : 's'} held only in memory (disk storage full). Do not reload.`}
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>Storage full ({unpersisted})</span>
                  </div>
                );
              }
              if (state === 'syncing') {
                return (
                  <div
                    data-testid="navbar-sync-badge"
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] border border-[var(--border-paper)]"
                    title="Syncing roadmap and study progress..."
                  >
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Syncing</span>
                  </div>
                );
              }
              if (state === 'offline_pending') {
                return (
                  <div
                    data-testid="navbar-sync-badge"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20"
                    title={`${pending} offline roadmap change${pending === 1 ? '' : 's'} queued`}
                  >
                    <CloudOff className="w-3 h-3" />
                    <span>Offline ({pending})</span>
                  </div>
                );
              }
              if (state === 'has_failed_mutations') {
                return (
                  <button
                    type="button"
                    data-testid="navbar-sync-badge"
                    onClick={() => onRetryFailedRoadmapSync?.()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors cursor-pointer"
                    title={`${failed} failed mutation${failed === 1 ? '' : 's'} (click to retry)`}
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>Sync alert ({failed})</span>
                  </button>
                );
              }
              if (state === 'sync_failed') {
                const errDetail = roadmapSyncStatus?.lastError || syncSnapshot?.lastError || 'Sync failed';
                return (
                  <button
                    type="button"
                    data-testid="navbar-sync-badge"
                    onClick={() => onRetryFailedRoadmapSync?.()}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 transition-colors cursor-pointer"
                    title={`${errDetail} (click to retry)`}
                  >
                    <AlertCircle className="w-3 h-3" />
                    <span>Sync failed (retry)</span>
                  </button>
                );
              }
              return (
                <div
                  data-testid="navbar-sync-badge"
                  className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] text-[var(--text-ink-muted)]"
                  title="All changes synced"
                >
                  <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                  <span>Saved</span>
                </div>
              );
            })()}

            {/* Apple Dynamic Island-Inspired Dynamic Edge */}
            <DynamicEdge activeDoc={activeDoc} />

            {/* Quick Search Capsule Trigger */}
            <CapsuleControl
              size="md"
              icon={<Search className="w-4 h-4" />}
              title="Search notes and syllabus (⌘K)"
              onClick={() => setSearchOpen(true)}
            />

            {/* Theme Toggle Capsule (Sun / Moon) */}
            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                data-testid="theme-toggle-btn"
                className="h-9 w-9 rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:border-[var(--border-paper-strong)] hover:bg-[var(--bg-surface-warm)] flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40"
                title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} theme`}
                aria-label={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} theme`}
              >
                {theme === 'light' ? (
                  <Moon className="w-4 h-4" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-400" />
                )}
              </button>
            )}

            {/* Notifications Capsule Dropdown */}
            <div ref={notifRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotifOpen((prev) => !prev);
                  if (!notifOpen && unreadCount > 0) {
                    onMarkNotificationsRead?.();
                  }
                }}
                className="relative h-9 w-9 rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:border-[var(--border-paper-strong)] hover:bg-[var(--bg-surface-warm)] flex items-center justify-center transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40"
                title="Notifications"
                aria-label="Notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--accent-terracotta)] text-white text-[10px] font-bold flex items-center justify-center shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {notifOpen && (
                <div className="absolute right-0 mt-2 w-80 bg-[var(--bg-surface)] rounded-xl shadow-lg border border-[var(--border-paper)] overflow-hidden z-50">
                  <div className="px-4 py-3 border-b border-[var(--border-paper)] flex items-center justify-between bg-[var(--bg-surface-warm)]">
                    <span className="font-serif-editorial text-sm font-bold text-[var(--text-ink)]">
                      Study Notifications
                    </span>
                    {unreadCount > 0 && (
                      <span className="text-[11px] font-medium text-[var(--accent-terracotta)]">
                        {unreadCount} new
                      </span>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border-paper)]">
                    {notifications.length > 0 ? (
                      notifications.map((item) => (
                        <div
                          key={item.id}
                          className="px-4 py-3 hover:bg-[var(--bg-subtle)] transition-colors flex items-start gap-3 cursor-pointer"
                          onClick={() => {
                            if (item.actionTab) onSelectTab(item.actionTab as ActiveTab);
                            setNotifOpen(false);
                          }}
                        >
                          <div className="w-7 h-7 rounded-full bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] flex items-center justify-center shrink-0 mt-0.5">
                            <Clock className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-[var(--text-ink)]">{item.title}</div>
                            <div className="text-[11px] text-[var(--text-ink-secondary)] leading-snug mt-0.5">
                              {item.message}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-4 text-xs text-[var(--text-ink-muted)] text-center">
                        No pending study reminders.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Dropdown / Login Button */}
            {isAuthReady && !user && onLogin ? (
              <CapsuleButton
                variant="accent"
                size="md"
                icon={<LogIn className="w-3.5 h-3.5" />}
                onClick={onLogin}
              >
                Sign in
              </CapsuleButton>
            ) : (
              <div ref={profileRef} className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((prev) => !prev)}
                  className="h-9 pl-1 pr-2.5 rounded-full border border-[var(--border-paper)] bg-[var(--bg-surface)] hover:bg-[var(--bg-surface-warm)] hover:border-[var(--border-paper-strong)] flex items-center gap-2 transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-terracotta)]/40"
                  aria-label="User Account"
                >
                  <div className="w-7 h-7 rounded-full bg-[var(--accent-terracotta)] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                    {avatarInitial}
                  </div>
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--text-ink-muted)]" />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 mt-2 w-64 bg-[var(--bg-surface)] rounded-xl shadow-lg border border-[var(--border-paper)] overflow-hidden z-50">
                    <div className="p-3.5 border-b border-[var(--border-paper)] bg-[var(--bg-surface-warm)]">
                      <div className="font-semibold text-xs text-[var(--text-ink)] truncate">
                        {user?.displayName || studentProfile?.fullName || 'JEE Aspirant'}
                      </div>
                      <div className="text-[11px] text-[var(--text-ink-muted)] truncate mt-0.5">
                        {user?.email || 'Local Study Profile'}
                      </div>
                      <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)]">
                        JEE 2026 Plan • Free Tier
                      </div>
                    </div>
                    <div className="py-1">
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTab('profile');
                          setProfileOpen(false);
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-subtle)] flex items-center gap-2 cursor-pointer"
                      >
                        <UserIcon className="w-3.5 h-3.5" />
                        <span>Profile & Study Analytics</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onSelectTab('profile');
                          setProfileOpen(false);
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-subtle)] flex items-center gap-2 cursor-pointer"
                      >
                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                        <span>Daily AI Quotas (5h &amp; Media)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onOpenProfileModal?.();
                          setProfileOpen(false);
                        }}
                        className="w-full px-3.5 py-2 text-left text-xs text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] hover:bg-[var(--bg-subtle)] flex items-center gap-2 cursor-pointer"
                      >
                        <Award className="w-3.5 h-3.5" />
                        <span>Edit Academic Target</span>
                      </button>

                      {/* Sync Status Row */}
                      <div className="px-3.5 py-2 border-t border-[var(--border-paper)] bg-[var(--bg-surface-warm)]/50 text-[11px]">
                        <div className="flex items-center justify-between text-[var(--text-ink-secondary)]">
                          <span className="font-medium">Cloud sync:</span>
                          <span className="font-mono text-[10px] capitalize">
                            {roadmapSyncStatus?.state ? roadmapSyncStatus.state.replace('_', ' ') : user ? 'Synced' : 'Local'}
                          </span>
                        </div>
                        {roadmapSyncStatus &&
                          (roadmapSyncStatus.pendingCount > 0 ||
                            roadmapSyncStatus.failedCount > 0 ||
                            roadmapSyncStatus.unpersistedCount > 0) && (
                            <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-ink-muted)]">
                              <span>Pending: {roadmapSyncStatus.pendingCount}</span>
                              {roadmapSyncStatus.failedCount > 0 && (
                                <span className="text-rose-600 font-semibold">Failed: {roadmapSyncStatus.failedCount}</span>
                              )}
                              {roadmapSyncStatus.unpersistedCount > 0 && (
                                <span className="text-amber-600 font-semibold">Unpersisted: {roadmapSyncStatus.unpersistedCount}</span>
                              )}
                            </div>
                          )}
                        {roadmapSyncStatus && roadmapSyncStatus.failedCount > 0 && onRetryFailedRoadmapSync && (
                          <button
                            type="button"
                            onClick={() => {
                              setProfileOpen(false);
                              onRetryFailedRoadmapSync();
                            }}
                            className="mt-1.5 w-full py-1 px-2 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 dark:text-rose-400 font-medium text-[10px] flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry failed writes</span>
                          </button>
                        )}
                      </div>

                      {user && onLogout && (
                        <button
                          type="button"
                          onClick={() => {
                            setProfileOpen(false);
                            onLogout();
                          }}
                          className="w-full px-3.5 py-2 text-left text-xs text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center gap-2 cursor-pointer border-t border-[var(--border-paper)]"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Sign out</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mobile Navigation Menu Button */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="md:hidden h-9 w-9 rounded-lg border border-[var(--border-paper)] flex items-center justify-center text-[var(--text-ink-secondary)] hover:text-[var(--text-ink)] cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-[var(--border-paper)] bg-[var(--bg-surface)] px-4 py-3 space-y-1">
            {navLinks.map((item) => {
              const isActive = item.aliases.includes(activeTab);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full px-3 py-2 rounded-lg text-left text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[var(--accent-terracotta-subtle)] text-[var(--accent-terracotta)] font-semibold'
                      : 'text-[var(--text-ink-secondary)] hover:bg-[var(--bg-subtle)]'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </header>

      {/* Global Document & Chapter Search Modal */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/40 backdrop-blur-xs">
          <div className="w-full max-w-xl bg-[var(--bg-surface)] rounded-xl shadow-2xl border border-[var(--border-paper)] overflow-hidden">
            <div className="p-3.5 border-b border-[var(--border-paper)] flex items-center gap-2.5">
              <Search className="w-4 h-4 text-[var(--text-ink-muted)] shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes, chapters, JEE syllabus topics..."
                className="w-full bg-transparent text-sm text-[var(--text-ink)] placeholder-[var(--text-ink-muted)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="p-1 text-[var(--text-ink-muted)] hover:text-[var(--text-ink)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto p-2 divide-y divide-[var(--border-paper)]">
              {filteredDocs.length > 0 ? (
                filteredDocs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => {
                      onSelectDocumentFromSearch?.(doc);
                      setSearchOpen(false);
                    }}
                    className="p-3 rounded-lg hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-medium text-[var(--text-ink)]">{doc.title}</div>
                      <div className="text-xs text-[var(--text-ink-muted)]">{doc.pages.length} pages • {doc.sourceType}</div>
                    </div>
                    <span className="text-xs text-[var(--accent-terracotta)] font-medium">Open →</span>
                  </div>
                ))
              ) : searchQuery.trim() ? (
                <div className="p-6 text-center text-xs text-[var(--text-ink-muted)]">
                  No matching documents or notes found.
                </div>
              ) : (
                <div className="p-4 text-xs text-[var(--text-ink-muted)] text-center">
                  Type to search your notes, study materials, and syllabus chapters.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
