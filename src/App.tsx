import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { PaperHomeView } from './components/PaperHomeView';
import { PaperSessionView } from './components/PaperSessionView';
import { ChaptersView } from './components/ChaptersView';
import { RoadmapsView } from './components/RoadmapsView';
import { ProfileView } from './components/ProfileView';
import { StudyView, StudySubMode } from './components/StudyView';
import { QuickReviseView } from './components/QuickReviseView';
import { PracticeWorkspaceView } from './components/PracticeWorkspaceView';
import { ExploreWorkspaceView, ExploreSubTab } from './components/ExploreWorkspaceView';
import { CreativeStudioView } from './components/CreativeStudioView';
import { StudentProfileModal } from './components/StudentProfileModal';
import { VoiceTutorModal } from './components/VoiceTutorModal';
import { NotebookAndScannerModal } from './components/NotebookAndScannerModal';
import { SignOutDialog } from './components/SignOutDialog';
import { performSignOut, prepareSignOutSummary, type SignOutChoice, type SignOutSummary } from './services/signOutFlow';
import { isFeatureEnabled, isTabAvailable } from './config/launchFeatures';
import {
  StudyDocument,
  LearnMateNotification,
  StudentAcademicProfile
} from './types/study';
import { studyStorage } from './services/storageService';
import { createFirestoreCloudStore } from './services/firestoreCloudStore';
import { RoadmapSyncService } from './features/roadmaps/services/roadmapSyncService';
import { RoadmapOutboxService } from './features/roadmaps/services/roadmapOutboxService';
import {
  roadmapSyncCoordinator,
  type UnifiedSyncStatus,
} from './features/roadmaps/services/roadmapSyncCoordinator';
import type { SyncSnapshot } from './services/syncStatus';
import { extractPagesFromPdf } from './utils/pdfExtractor';
import { aiStudyClient } from './services/aiClient';
import { splitTextIntoPages } from './utils/quizGrading';
import { getInitialTheme, applyTheme, type Theme } from './utils/theme';
import type { SyllabusChapter, JeeSubjectId } from './data/jeeMainSyllabus';
import { getChapter } from './data/jeeMainSyllabus';
import { getChapterContent } from './services/chapterContentProvider';
import type { ActiveChapterSessionContext } from './components/PaperSessionView';
import {
  auth,
  db,
  signInWithGoogle,
  signOutUser,
  onAuthStateChanged,
  User
} from './firebase';

studyStorage.attachCloudStore(createFirestoreCloudStore(db));

function sameSyncSnapshot(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return (
    a.state === b.state &&
    a.pendingWrites === b.pendingWrites &&
    a.unsyncedChanges === b.unsyncedChanges &&
    a.lastError === b.lastError
  );
}

const VALID_TABS: ActiveTab[] = [
  'home',
  'chapters',
  'sessions',
  'mocks',
  'roadmaps',
  'dashboard',
  'study',
  'revision',
  'practice',
  'explore',
  'ai-tutor',
  'create',
  'pdf-workspace',
  'analytics',
  'profile'
];

function parseTabFromHash(): ActiveTab {
  if (typeof window === 'undefined') return 'home';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (raw === 'learn') return 'sessions';
  if (raw === 'saved') return 'profile';
  if (VALID_TABS.includes(raw as ActiveTab) && isTabAvailable(raw)) {
    return raw as ActiveTab;
  }
  return 'home';
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => parseTabFromHash());
  const [theme, setTheme] = useState<Theme>(() => getInitialTheme());
  const [dynamicEdgeOpen, setDynamicEdgeOpen] = useState(false);
  const [studyInitialMode, setStudyInitialMode] = useState<StudySubMode>('explain');
  const [exploreSubTab, setExploreSubTab] = useState<ExploreSubTab>('news');
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<StudyDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Student Profile state
  const [studentProfile, setStudentProfile] = useState<StudentAcademicProfile>(() =>
    studyStorage.getStudentProfile()
  );
  const [profileModalOpen, setProfileModalOpen] = useState(false);

  // Modals
  const [voiceTutorOpen, setVoiceTutorOpen] = useState(false);
  const [notebookModalOpen, setNotebookModalOpen] = useState(false);
  const [notebookInitialTab, setNotebookInitialTab] = useState<
    'scan' | 'voice' | 'notebook' | 'planner'
  >('scan');

  // Notifications
  const [notifications, setNotifications] = useState<LearnMateNotification[]>([]);

  // Firebase Auth & Sync State
  const [user, setUser] = useState<User | null>(null);
  const [signOutSummary, setSignOutSummary] = useState<SignOutSummary | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSnapshot, setSyncSnapshot] = useState<SyncSnapshot>(() => studyStorage.getSyncSnapshot());
  const [roadmapSyncStatus, setRoadmapSyncStatus] = useState<UnifiedSyncStatus>(() =>
    roadmapSyncCoordinator.getStatus()
  );
  const [scopeEpoch, setScopeEpoch] = useState(0);
  const authUidRef = useRef<string | null>(null);

  const [activeChapterSession, setActiveChapterSession] = useState<ActiveChapterSessionContext | null>(() => {
    try {
      const sessions = studyStorage.getStudySessions();
      const latest = sessions[0];
      if (latest && latest.chapterId && latest.subjectId) {
        const ch = getChapter(latest.chapterId);
        if (ch) {
          return {
            subjectId: latest.subjectId,
            chapter: ch,
            content: getChapterContent(latest.subjectId, ch),
            session: latest,
          };
        }
      }
    } catch {
      // ignore
    }
    return null;
  });

  const effectiveDoc = activeDoc || documents[0] || studyStorage.getDocuments()[0];

  // Theme synchronization
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const handleToggleTheme = () => {
    const next: Theme = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    applyTheme(next);
  };

  const handleSelectTab = (requestedTab: ActiveTab) => {
    const tab: ActiveTab = isTabAvailable(requestedTab) ? requestedTab : 'home';
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const targetHash = `#${tab}`;
      if (window.location.hash !== targetHash) {
        window.history.pushState(null, '', targetHash);
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      const tabFromHash = parseTabFromHash();
      setActiveTab(tabFromHash);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const loadStateFromStorage = useCallback(() => {
    const docs = studyStorage.getDocuments();
    setDocuments(docs);
    const activeId = studyStorage.getActiveDocumentId();
    setActiveDoc(docs.find((d) => d.id === activeId) || docs[0] || null);
    setNotifications(studyStorage.getNotifications());
    setStudentProfile(studyStorage.getStudentProfile());
  }, []);

  // Load initial local storage data immediately so local-first UI is responsive instantly
  useEffect(() => {
    loadStateFromStorage();
    const fallbackTimer = setTimeout(() => {
      setIsAuthReady(true);
    }, 350);
    return () => clearTimeout(fallbackTimer);
  }, [loadStateFromStorage]);

  useEffect(() => {
    const cloud = createFirestoreCloudStore(db);

    const unsubscribeStorage = studyStorage.subscribe(() => {
      const next = studyStorage.getSyncSnapshot();
      setSyncSnapshot((prev) => (sameSyncSnapshot(prev, next) ? prev : next));
    });

    const unsubscribeRoadmapSync = roadmapSyncCoordinator.subscribeStatus((status) => {
      setRoadmapSyncStatus(status);
    });

    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      const previousScope = studyStorage.getActiveScope();
      studyStorage.activateAccount(currentUser);
      const prevUid = authUidRef.current;
      authUidRef.current = currentUser?.uid ?? null;
      if (studyStorage.getActiveScope() !== previousScope) {
        setScopeEpoch((epoch) => epoch + 1);
      }
      setUser(currentUser);
      loadStateFromStorage();
      setSyncSnapshot(studyStorage.getSyncSnapshot());
      setIsAuthReady(true);

      // Root-level sync lifecycle coordinator
      roadmapSyncCoordinator.setUser(
        currentUser,
        cloud,
        typeof window !== 'undefined' ? window.localStorage : undefined
      );

      if (currentUser) {
        setIsSyncing(true);
        (async () => {
          if (typeof window !== 'undefined') {
            await RoadmapSyncService.migrateGuestRoadmapDataToUser(
              currentUser.uid,
              window.localStorage,
              cloud
            ).catch((err) => console.warn('Guest roadmap migration error:', err));
          }
          await Promise.all([
            studyStorage.syncWithCloudUser(currentUser),
            roadmapSyncCoordinator.triggerSync(),
          ]);
        })()
          .catch((err) => console.error('Error syncing with Firestore:', err))
          .finally(() => {
            if (authUidRef.current !== currentUser.uid) return;
            loadStateFromStorage();
            setIsSyncing(false);
          });
      } else {
        // Transitioning to guest session: restore any unconfirmed migration backup
        if (typeof window !== 'undefined') {
          RoadmapSyncService.restoreFromGuestMigrationBackup(window.localStorage, { previousUid: prevUid });
        }
        setIsSyncing(false);
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeStorage();
      unsubscribeRoadmapSync();
    };
  }, [loadStateFromStorage]);

  const handleLogin = async () => {
    setErrorMessage(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') {
        return;
      }
      setErrorMessage(
        err?.message || 'Google sign-in could not be completed. You can continue studying in local guest mode.'
      );
    }
  };

  const handleLogout = async () => {
    if (!user) return;
    setSignOutError(null);
    const cloud = createFirestoreCloudStore(db);
    setSignOutSummary(
      await prepareSignOutSummary(studyStorage, user, {
        cloud,
        customStorage: typeof window !== 'undefined' ? window.localStorage : undefined,
      })
    );
  };

  const handleSignOutChoice = useCallback(
    async (choice: SignOutChoice) => {
      if (!signOutSummary) return;
      if (choice === 'cancel') {
        setSignOutSummary(null);
        return;
      }
      setSignOutBusy(true);
      setSignOutError(null);
      const cloud = createFirestoreCloudStore(db);
      const result = await performSignOut({
        choice,
        uid: signOutSummary.uid,
        storage: studyStorage,
        signOut: signOutUser,
        cloud,
        customStorage: typeof window !== 'undefined' ? window.localStorage : undefined,
      });
      setSignOutBusy(false);
      if (result.status === 'failed') {
        setSignOutError(result.error);
        return;
      }
      setSignOutSummary(null);
    },
    [signOutSummary]
  );

  useEffect(() => {
    if (signOutSummary && !signOutBusy && user?.uid !== signOutSummary.uid) setSignOutSummary(null);
  }, [user, signOutSummary, signOutBusy]);

  const refreshDocumentsState = () => {
    const refreshed = studyStorage.getDocuments();
    setDocuments(refreshed);
    if (activeDoc) {
      const updatedActive =
        refreshed.find((d) => d.id === activeDoc.id) || refreshed[0] || null;
      setActiveDoc(updatedActive);
    } else if (refreshed.length > 0) {
      setActiveDoc(refreshed[0]);
    }
  };

  const handleUploadPdf = async (file: File) => {
    setErrorMessage(null);
    setIsProcessing(true);

    try {
      const extracted = await extractPagesFromPdf(file);
      if (extracted.pages.length === 0) {
        throw new Error(
          'Could not extract readable text from this PDF. Please try another PDF or use Paste Notes.'
        );
      }

      const analysis = await aiStudyClient
        .analyzeDocument(file.name, extracted.pages)
        .catch(() => ({
          overview: `Uploaded study material (${extracted.pageCount} pages).`,
          topics: []
        }));

      const newDoc: StudyDocument = {
        id: `doc-${Date.now()}`,
        title: file.name,
        sourceType: 'pdf',
        fileSize: file.size,
        pageCount: extracted.pageCount,
        pages: extracted.pages,
        pdfDataUrl: extracted.pdfDataUrl,
        createdAt: new Date().toISOString(),
        lastStudiedAt: new Date().toISOString(),
        topics: analysis.topics || [],
        overview: analysis.overview || `Uploaded PDF (${extracted.pageCount} pages).`
      };

      studyStorage.saveDocument(newDoc);
      studyStorage.setActiveDocumentId(newDoc.id);

      const updatedDocs = studyStorage.getDocuments();
      setDocuments(updatedDocs);
      setActiveDoc(newDoc);
      handleSelectTab('sessions');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to process PDF file.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmitTextNotes = async (
    title: string,
    rawText: string,
    sourceType: StudyDocument['sourceType'] = 'text',
    youtubeUrl?: string
  ) => {
    setErrorMessage(null);
    const cleaned = rawText.trim();
    if (cleaned.length < 25) {
      setErrorMessage('Please enter at least a paragraph of study notes.');
      return;
    }

    setIsProcessing(true);
    try {
      const pages = splitTextIntoPages(cleaned);
      const analysis = await aiStudyClient.analyzeDocument(title, pages).catch(() => ({
        overview: cleaned.slice(0, 220),
        topics: []
      }));

      const newDoc: StudyDocument = {
        id: `doc-${Date.now()}`,
        title: title.endsWith('.pdf') ? title : `${title}.pdf`,
        sourceType,
        youtubeUrl,
        pageCount: pages.length,
        pages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: new Date().toISOString(),
        topics: analysis.topics || [],
        overview: analysis.overview || cleaned.slice(0, 220)
      };

      studyStorage.saveDocument(newDoc);
      studyStorage.setActiveDocumentId(newDoc.id);

      const updatedDocs = studyStorage.getDocuments();
      setDocuments(updatedDocs);
      setActiveDoc(newDoc);
      handleSelectTab('sessions');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to analyze study notes.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmitYouTubeUrl = async (url: string) => {
    setErrorMessage(null);
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMessage('Please enter a valid YouTube lecture URL.');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await aiStudyClient.analyzeYouTubeVideo(trimmed);
      const newDoc: StudyDocument = {
        id: `doc-${Date.now()}`,
        title: result.title,
        sourceType: 'youtube',
        youtubeUrl: result.youtubeUrl,
        videoId: result.videoId,
        pageCount: result.pages.length,
        pages: result.pages,
        createdAt: new Date().toISOString(),
        lastStudiedAt: new Date().toISOString(),
        topics: result.topics || [],
        overview: result.overview
      };
      studyStorage.saveDocument(newDoc);
      studyStorage.setActiveDocumentId(newDoc.id);
      setDocuments(studyStorage.getDocuments());
      setActiveDoc(newDoc);
      handleSelectTab('sessions');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import YouTube lecture.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectDocument = (doc: StudyDocument) => {
    const updated: StudyDocument = {
      ...doc,
      lastStudiedAt: new Date().toISOString()
    };
    studyStorage.saveDocument(updated);
    studyStorage.setActiveDocumentId(updated.id);
    setDocuments(studyStorage.getDocuments());
    setActiveDoc(updated);
    handleSelectTab('sessions');
  };

  const handleStartSessionForChapter = (subjectId: JeeSubjectId, chapter: SyllabusChapter) => {
    const content = getChapterContent(subjectId, chapter);
    const newSession = studyStorage.createStudySession({
      name: `${chapter.name} Session`,
      subjectId,
      chapterId: chapter.id,
      topicIds: chapter.topics.map((t) => t.id),
      resourceIds: activeDoc ? [activeDoc.id] : [],
    });
    setActiveChapterSession({
      subjectId,
      chapter,
      content,
      session: newSession,
    });
    handleSelectTab('sessions');
  };

  const handleMarkNotificationsRead = () => {
    studyStorage.markAllNotificationsRead();
    setNotifications(studyStorage.getNotifications());
  };

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg-paper)] text-[var(--text-ink)] paper-texture transition-colors">
      
      {/* 1. Minimal Horizontal Navbar with Capsule Navigation & Dynamic Edge */}
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        hasActiveDoc={!!activeDoc}
        activeDoc={activeDoc}
        user={user}
        isAuthReady={isAuthReady}
        isSyncing={isSyncing}
        syncSnapshot={syncSnapshot}
        roadmapSyncStatus={roadmapSyncStatus}
        onRetryFailedRoadmapSync={() => {
          void roadmapSyncCoordinator.retry();
          void studyStorage.retrySync();
        }}
        onLogin={handleLogin}
        onLogout={handleLogout}
        documents={documents}
        onSelectDocumentFromSearch={handleSelectDocument}
        notifications={notifications}
        onMarkNotificationsRead={handleMarkNotificationsRead}
        onOpenProfileModal={() => setProfileModalOpen(true)}
        studentProfile={studentProfile}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* 3. Main Workspace Router */}
      <main className="flex-1" key={`main-${scopeEpoch}`}>
        {!isAuthReady ? (
          <div role="status" className="max-w-xl mx-auto px-4 py-20 text-center text-xs text-[var(--text-ink-muted)]">
            Loading your study journal…
          </div>
        ) : (
          <>
            {/* 1. HOME: Tactile Paper Dashboard (Blueprint Page 1) */}
            {(activeTab === 'home' || activeTab === 'dashboard') && (
              <PaperHomeView
                documents={documents}
                onUploadPdf={handleUploadPdf}
                onSubmitTextNotes={(title, text) => handleSubmitTextNotes(title, text, 'text')}
                onSubmitYouTubeUrl={handleSubmitYouTubeUrl}
                onSelectDocument={handleSelectDocument}
                onNavigateTab={handleSelectTab}
                userName={user?.displayName?.split(' ')[0] || studentProfile.fullName || 'Student'}
                isProcessing={isProcessing}
                errorMessage={errorMessage}
                onClearError={() => setErrorMessage(null)}
              />
            )}

            {/* 2. SESSIONS: The Complete Central Session Workspace (Blueprint Page 2) */}
            {(activeTab === 'sessions' || activeTab === 'study' || activeTab === 'ai-tutor' || activeTab === 'pdf-workspace') && (
              <PaperSessionView
                documents={documents}
                activeDocument={effectiveDoc}
                activeChapterSession={activeChapterSession}
                onSelectDocument={(doc) => {
                  studyStorage.setActiveDocumentId(doc.id);
                  setActiveDoc(doc);
                }}
                onClearActiveChapter={() => setActiveChapterSession(null)}
                onUploadPdf={handleUploadPdf}
                onSubmitYouTubeUrl={handleSubmitYouTubeUrl}
                onNavigateTab={handleSelectTab}
                userName={user?.displayName?.split(' ')[0] || studentProfile.fullName || 'Student'}
                isProcessing={isProcessing}
              />
            )}

            {/* 3. CHAPTERS: NTA JEE Main 2026 Curriculum Tree (Blueprint Page 3) */}
            {activeTab === 'chapters' && (
              <ChaptersView
                onStartSessionForChapter={handleStartSessionForChapter}
                onNavigateTab={handleSelectTab}
              />
            )}

            {/* 4. MOCKS / PYQS: Verified Exam Practice & Custom Mock Builder (Blueprint Page 1 & 3) */}
            {(activeTab === 'mocks' || activeTab === 'practice') && (
              <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-6">
                <PracticeWorkspaceView
                  documents={documents}
                  activeDoc={activeDoc}
                  onSelectDoc={(doc) => setActiveDoc(doc)}
                  onOpenStudyQuiz={() => handleSelectTab('sessions')}
                  studentProfile={studentProfile}
                  onOpenProfileModal={() => setProfileModalOpen(true)}
                />
              </div>
            )}

            {/* 5. ROADMAPS: Structured Learning Progression Ladders (Blueprint Page 3) */}
            {activeTab === 'roadmaps' && (
              <RoadmapsView onNavigateTab={handleSelectTab} user={user} />
            )}

            {/* 6. PROFILE: Identity, Quota Usage, Heatmap & Diagnostic Analytics (Blueprint Page 4) */}
            {(activeTab === 'profile' || activeTab === 'analytics' || (activeTab as string) === 'analysis') && (
              <ProfileView
                user={user}
                studentProfile={studentProfile}
                onOpenProfileModal={() => setProfileModalOpen(true)}
                initialTab={activeTab === 'analytics' || (activeTab as string) === 'analysis' ? 'analysis' : undefined}
              />
            )}

            {/* Backward-Compatible Auxiliary Tabs */}
            {activeTab === 'revision' && effectiveDoc && (
              <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-6">
                <QuickReviseView
                  activeDocument={effectiveDoc}
                  onNavigateToCitation={() => handleSelectTab('sessions')}
                  onAskTutorAboutConcept={() => handleSelectTab('sessions')}
                />
              </div>
            )}

            {activeTab === 'explore' && (
              <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-6">
                <ExploreWorkspaceView
                  activeSubTab={exploreSubTab}
                  onSelectSubTab={setExploreSubTab}
                  activeDoc={activeDoc}
                  onImportAsStudyMaterial={(title, content, sourceType) => {
                    handleSubmitTextNotes(
                      title,
                      content,
                      sourceType === 'youtube' ? 'youtube' : 'text'
                    );
                  }}
                />
              </div>
            )}

            {activeTab === 'create' && effectiveDoc && (
              <div className="max-w-[1380px] mx-auto px-4 sm:px-6 py-6">
                <CreativeStudioView
                  documents={documents}
                  activeDocument={effectiveDoc}
                  onSelectDocument={(docId) => {
                    const found = documents.find((d) => d.id === docId);
                    if (found) setActiveDoc(found);
                  }}
                  onOpenNotebookModal={(mode) => {
                    setNotebookInitialTab(mode);
                    setNotebookModalOpen(true);
                  }}
                  onGenerateFlashcardsFromNotes={() => handleSelectTab('revision')}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Student Academic Profile Modal */}
      {isAuthReady && (
        <StudentProfileModal
          key={`profile-${scopeEpoch}`}
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          onProfileSaved={(updated) => setStudentProfile(updated)}
        />
      )}

      {/* Live Voice AI Tutor Modal */}
      {activeDoc && isFeatureEnabled('liveVoice') && (
        <VoiceTutorModal
          isOpen={voiceTutorOpen}
          onClose={() => setVoiceTutorOpen(false)}
          activeDocument={activeDoc}
          weakTopics={studentProfile.weakAreas}
        />
      )}

      {/* Smart Notebook, OCR Scanner & Planner Modal */}
      {isAuthReady && (
        <NotebookAndScannerModal
          key={`notebook-${scopeEpoch}`}
          isOpen={notebookModalOpen}
          initialMode={notebookInitialTab}
          onClose={() => setNotebookModalOpen(false)}
          onImportAsStudyDocument={(doc) => {
            studyStorage.saveDocument(doc);
            studyStorage.setActiveDocumentId(doc.id);
            setDocuments(studyStorage.getDocuments());
            setActiveDoc(doc);
            handleSelectTab('sessions');
          }}
        />
      )}

      {/* Sign-Out Data Preservation Dialog */}
      {signOutSummary && (
        <SignOutDialog
          summary={signOutSummary}
          busy={signOutBusy}
          error={signOutError}
          onChoose={handleSignOutChoice}
        />
      )}
    </div>
  );
}

export default App;
