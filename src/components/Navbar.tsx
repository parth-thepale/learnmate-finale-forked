import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  BookOpen,
  ListChecks,
  CheckSquare,
  Compass,
  MessageSquare,
  PlaySquare,
  Bell,
  ChevronDown,
  Search,
  BarChart2,
  FilePenLine,
  LogIn,
  LogOut,
  Check,
  Clock,
  GraduationCap,
  Target,
  Home,
} from 'lucide-react';
import { User } from 'firebase/auth';
import { StudyDocument, LearnMateNotification, StudentAcademicProfile } from '../types/study';
import { EXAM_BLUEPRINTS } from '../utils/examSimulatorEngine';
import { StudyTimerFocusBar } from './StudyTimerFocusBar';
import { CompactStudyUtilitiesWidget } from './CompactStudyUtilitiesWidget';

export type ActiveTab =
  | 'home'
  | 'dashboard'
  | 'study'
  | 'revision'
  | 'practice'
  | 'explore'
  | 'ai-tutor'
  | 'create'
  | 'pdf-workspace'
  | 'analytics';

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  hasActiveDoc: boolean;
  activeDoc?: StudyDocument | null;
  onOpenNotebookModal?: () => void;
  user?: User | null;
  isAuthReady?: boolean;
  isSyncing?: boolean;
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
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  activeDoc,
  onOpenNotebookModal,
  user,
  isAuthReady,
  isSyncing,
  onLogin,
  onLogout,
  documents = [],
  onSelectDocumentFromSearch,
  notifications = [],
  onMarkNotificationsRead,
  onOpenProfileModal,
  studentProfile,
  focusMode = false,
  onToggleFocusMode = () => {},
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearchFocused(false);
        setNotifOpen(false);
        setProfileOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Canonical 7 Top-Bar Destinations from the 10 Editorial Reference Screenshots
  const navItems: {
    id: ActiveTab;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: FileText },
    { id: 'study', label: 'Study Space', icon: BookOpen },
    { id: 'revision', label: 'Revision', icon: ListChecks },
    { id: 'practice', label: 'Practice', icon: CheckSquare },
    { id: 'explore', label: 'Explore', icon: Compass },
    { id: 'ai-tutor', label: 'AI Tutor', icon: MessageSquare },
    { id: 'create', label: 'Create', icon: PlaySquare },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  const filteredDocs = searchQuery.trim()
    ? documents.filter(
        (d) =>
          d.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          d.pages.some((p) => p.content.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const targetExamShort =
    studentProfile?.targetExam && EXAM_BLUEPRINTS[studentProfile.targetExam]
      ? EXAM_BLUEPRINTS[studentProfile.targetExam].shortName
      : 'JEE Main';

  const classOrStageLabel =
    studentProfile?.educationStage === 'college'
      ? studentProfile?.degreeCourse || 'College'
      : studentProfile?.schoolClass || 'Class 12';

  const avatarInitial =
    user?.displayName?.[0]?.toUpperCase() ||
    studentProfile?.fullName?.[0]?.toUpperCase() ||
    'S';

  return (
    <header className="sticky top-16 z-40 w-full bg-[#FCFBF9]/95 backdrop-blur-md border-b border-[#E8E6E2] lm-no-print">
      <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Left: Editorial Brand Logo */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={() => onSelectTab('dashboard')}
            data-testid="navbar-brand-btn"
            className="flex items-center text-left focus:outline-none cursor-pointer shrink-0"
          >
            <span className="font-serif-editorial font-bold text-2xl tracking-tight text-[#121827]">
              Learn<span className="text-[#C84428]">Mate</span>
            </span>
          </button>

          {/* Center-Left: 7 Canonical Editorial Navigation Items with Terracotta Active Underline */}
          <nav
            aria-label="Main Navigation"
            className="hidden lg:flex items-center gap-0.5 h-16"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive =
                activeTab === item.id ||
                (item.id === 'practice' && activeTab === 'analytics') ||
                (item.id === 'study' && activeTab === 'pdf-workspace');

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectTab(item.id)}
                  data-testid={`nav-tab-${item.id}`}
                  className={`relative h-16 px-2 xl:px-2.5 flex items-center gap-1.5 text-xs xl:text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer border-b-2 ${
                    isActive
                      ? 'border-[#C84428] text-[#C84428] font-semibold'
                      : 'border-transparent text-[#606B7C] hover:text-[#121827]'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-[#C84428]' : 'text-[#606B7C]'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Right: Dynamic-Island Timer, Study Tools, Notification Bell & Student Profile Pill */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Compact Dynamic-Island Focus Timer */}
          <div className="hidden sm:block">
            <StudyTimerFocusBar
              activeDocumentId={activeDoc?.id || 'default'}
              activeDocumentTitle={activeDoc?.title || 'Study Session'}
              focusMode={focusMode}
              onToggleFocusMode={onToggleFocusMode}
              floatingIsland
            />
          </div>

          {/* Study Tools Modal Trigger (Image 5) */}
          <CompactStudyUtilitiesWidget activeDocument={activeDoc} />

          {/* Notification Bell with Real Student Reminders Dropdown */}
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((prev) => !prev);
                if (!notifOpen && unreadCount > 0) {
                  onMarkNotificationsRead?.();
                }
              }}
              aria-label="Notifications"
              data-testid="navbar-notifications-btn"
              className="relative w-9 h-9 rounded-full bg-white hover:bg-[#F7F5F0] border border-[#E8E6E2] flex items-center justify-center text-[#606B7C] hover:text-[#121827] transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#C84428] text-white text-[10px] font-bold flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-[#E8E6E2] overflow-hidden z-50">
                <div className="px-4 py-3 border-b border-[#E8E6E2] flex items-center justify-between bg-[#FCFBF9]">
                  <span className="font-serif-editorial text-sm font-bold text-[#121827]">
                    Study Notifications
                  </span>
                  <span className="text-[11px] text-[#2E7D52] font-medium flex items-center gap-1">
                    <Check className="w-3 h-3" /> Up to date
                  </span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#E8E6E2]">
                  {notifications.length > 0 ? (
                    notifications.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          if (item.actionTab) {
                            onSelectTab(item.actionTab as ActiveTab);
                          }
                          setNotifOpen(false);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-[#FCFBF9] transition-colors flex items-start gap-3 cursor-pointer"
                      >
                        <div className="w-7 h-7 rounded-full bg-[#FBECE6] text-[#C84428] flex items-center justify-center shrink-0 mt-0.5">
                          <Clock className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[#121827]">{item.title}</div>
                          <div className="text-[11px] text-[#606B7C] leading-snug mt-0.5">
                            {item.message}
                          </div>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="p-4 text-xs text-[#606B7C] text-center">
                      No pending study notifications.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="hidden sm:block h-5 w-px bg-[#E8E6E2]" />

          {/* Student Profile Pill matching Screenshots ("S | Class 12 / JEE Main ▾") */}
          <div ref={profileRef} className="relative">
            <button
              type="button"
              onClick={() => setProfileOpen((prev) => !prev)}
              data-testid="navbar-profile-btn"
              className="flex items-center gap-2.5 pl-1.5 pr-3 py-1 rounded-full bg-white hover:bg-[#F7F5F0] border border-[#E8E6E2] transition-all cursor-pointer"
            >
              {user && user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'Student'}
                  className="w-7 h-7 rounded-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-[#F2EAE4] text-[#121827] text-xs font-serif-editorial font-bold flex items-center justify-center">
                  {avatarInitial}
                </div>
              )}
              <span className="text-xs font-medium text-[#121827] hidden md:inline max-w-[160px] truncate">
                {classOrStageLabel} / {targetExamShort}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#606B7C]" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-2 w-68 bg-white rounded-xl shadow-xl border border-[#E8E6E2] py-1.5 z-50">
                <div className="px-4 py-2.5 border-b border-[#E8E6E2] bg-[#FCFBF9]">
                  <div className="text-xs font-bold text-[#121827] truncate">
                    {user?.displayName || studentProfile?.fullName || 'Student'}
                  </div>
                  <div className="text-[11px] text-[#606B7C] truncate">
                    {isSyncing
                      ? 'Syncing cloud records...'
                      : `${classOrStageLabel} • ${targetExamShort} (${studentProfile?.targetExamYear || '2027'})`}
                  </div>
                </div>

                {/* Quick Search Materials inside Menu */}
                <div ref={searchContainerRef} className="px-3 py-2 border-b border-[#E8E6E2]">
                  <div className="flex items-center gap-2 bg-[#FCFBF9] border border-[#E8E6E2] rounded-lg px-2.5 py-1.5">
                    <Search className="w-3.5 h-3.5 text-[#606B7C] shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onFocus={() => setSearchFocused(true)}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSearchFocused(true);
                      }}
                      placeholder="Jump to material..."
                      className="bg-transparent text-xs text-[#121827] placeholder:text-[#606B7C] focus:outline-none w-full"
                    />
                  </div>
                  {searchFocused && filteredDocs.length > 0 && (
                    <div className="mt-1.5 max-h-36 overflow-y-auto divide-y divide-[#E8E6E2] border border-[#E8E6E2] rounded-lg bg-white">
                      {filteredDocs.map((doc) => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => {
                            onSelectDocumentFromSearch?.(doc);
                            setSearchFocused(false);
                            setProfileOpen(false);
                            setSearchQuery('');
                          }}
                          className="w-full px-2.5 py-1.5 text-left text-xs hover:bg-[#FCFBF9] truncate cursor-pointer"
                        >
                          {doc.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {onOpenProfileModal && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenProfileModal();
                      setProfileOpen(false);
                    }}
                    data-testid="open-academic-profile-menu-btn"
                    className="w-full px-4 py-2 text-left text-xs font-semibold text-[#C84428] hover:bg-[#FBECE6]/50 flex items-center gap-2.5 cursor-pointer"
                  >
                    <GraduationCap className="w-4 h-4 text-[#C84428]" />
                    Academic Profile &amp; Exam Goals
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('home');
                    setProfileOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-medium text-[#121827] hover:bg-[#FCFBF9] flex items-center gap-2.5 cursor-pointer"
                >
                  <Home className="w-4 h-4 text-[#606B7C]" />
                  Upload &amp; Manage Materials
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('dashboard');
                    setProfileOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-medium text-[#121827] hover:bg-[#FCFBF9] flex items-center gap-2.5 cursor-pointer"
                >
                  <BarChart2 className="w-4 h-4 text-[#606B7C]" />
                  Learning Dashboard
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSelectTab('pdf-workspace');
                    setProfileOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-medium text-[#121827] hover:bg-[#FCFBF9] flex items-center gap-2.5 cursor-pointer"
                >
                  <FilePenLine className="w-4 h-4 text-[#606B7C]" />
                  Full PDF Annotation Studio
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onOpenNotebookModal?.();
                    setProfileOpen(false);
                  }}
                  className="w-full px-4 py-2 text-left text-xs font-medium text-[#121827] hover:bg-[#FCFBF9] flex items-center gap-2.5 cursor-pointer"
                >
                  <Target className="w-4 h-4 text-[#606B7C]" />
                  Quick Scanner &amp; Voice Modal
                </button>

                {isAuthReady && (
                  <div className="border-t border-[#E8E6E2] mt-1 pt-1">
                    {user ? (
                      <button
                        type="button"
                        onClick={() => {
                          onLogout?.();
                          setProfileOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-xs font-medium text-[#C84428] hover:bg-[#FBECE6]/50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        Sign Out
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onLogin?.();
                          setProfileOpen(false);
                        }}
                        className="w-full px-4 py-2 text-left text-xs font-semibold text-[#C84428] hover:bg-[#FBECE6]/50 flex items-center gap-2.5 cursor-pointer"
                      >
                        <LogIn className="w-4 h-4" />
                        Sign In with Google
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* First-Class Android & Tablet Bottom / Scrollable Navigation Bar */}
      <div className="lg:hidden flex items-center justify-between overflow-x-auto border-t border-[#E8E6E2] bg-[#FFFFFF] px-2 py-1.5 gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeTab === item.id ||
            (item.id === 'practice' && activeTab === 'analytics') ||
            (item.id === 'study' && activeTab === 'pdf-workspace');
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              data-testid={`mobile-nav-tab-${item.id}`}
              className={`flex flex-col items-center justify-center gap-0.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium shrink-0 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-[#FBECE6] text-[#C84428] font-semibold'
                  : 'text-[#606B7C] hover:text-[#121827]'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-[#C84428]' : 'text-[#606B7C]'}`} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </header>
  );
};
