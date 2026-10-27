import React, { useState, useEffect } from 'react';
import { Navbar, ActiveTab } from './components/Navbar';
import { HomeView } from './components/HomeView';
import { StudyView, StudySubMode } from './components/StudyView';
import { QuickReviseView } from './components/QuickReviseView';
import { PracticeWorkspaceView } from './components/PracticeWorkspaceView';
import { PdfWorkspaceView } from './components/PdfWorkspaceView';
import { ExploreWorkspaceView, ExploreSubTab } from './components/ExploreWorkspaceView';
import { CreativeStudioView } from './components/CreativeStudioView';
import { StudentDashboardView } from './components/StudentDashboardView';
import { StudentProfileModal } from './components/StudentProfileModal';
import { ProgressView } from './components/ProgressView';
import { VoiceTutorModal } from './components/VoiceTutorModal';
import { NotebookAndScannerModal } from './components/NotebookAndScannerModal';
import {
  StudyDocument,
  LearnMateNotification,
  StudentAcademicProfile
} from './types/study';
import { studyStorage } from './services/storageService';
import { extractPagesFromPdf } from './utils/pdfExtractor';
import { aiStudyClient } from './services/aiClient';
import { splitTextIntoPages } from './utils/quizGrading';
import {
  auth,
  signInWithGoogle,
  signOutUser,
  onAuthStateChanged,
  User
} from './firebase';

const VALID_TABS: ActiveTab[] = [
  'dashboard',
  'study',
  'revision',
  'practice',
  'explore',
  'ai-tutor',
  'create',
  'home',
  'pdf-workspace',
  'analytics'
];

function parseTabFromHash(): ActiveTab {
  if (typeof window === 'undefined') return 'dashboard';
  const raw = window.location.hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (raw === 'learn') return 'study';
  if (raw === 'saved') return 'analytics';
  if (VALID_TABS.includes(raw as ActiveTab)) {
    return raw as ActiveTab;
  }
  return 'dashboard';
}

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => parseTabFromHash());
  const [studyInitialMode, setStudyInitialMode] = useState<StudySubMode>('explain');
  const [exploreSubTab, setExploreSubTab] = useState<ExploreSubTab>('news');
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [activeDoc, setActiveDoc] = useState<StudyDocument | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Student Personalization Profile state
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
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  const effectiveDoc = activeDoc || documents[0] || studyStorage.getDocuments()[0];

  const handleSelectTab = (tab: ActiveTab) => {
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

  useEffect(() => {
    const docs = studyStorage.getDocuments();
    setDocuments(docs);
    const activeId = studyStorage.getActiveDocumentId();
    const initialDoc = docs.find((d) => d.id === activeId) || docs[0] || null;
    setActiveDoc(initialDoc);
    setNotifications(studyStorage.getNotifications());
    setStudentProfile(studyStorage.getStudentProfile());

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);

      if (currentUser) {
        setIsSyncing(true);
        try {
          await studyStorage.syncWithCloudUser(currentUser);
          const refreshedDocs = studyStorage.getDocuments();
          setDocuments(refreshedDocs);
          if (refreshedDocs.length > 0 && !activeDoc) {
            setActiveDoc(refreshedDocs[0]);
          }
        } catch (err) {
          console.error('Error syncing with Firestore:', err);
        } finally {
          setIsSyncing(false);
        }
      }
    });

    return () => unsubscribe();
  }, []);

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
      setStudyInitialMode('explain');
      handleSelectTab('study');
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
      setErrorMessage(
        'Please enter at least a paragraph of study notes so LearnMate can analyze it.'
      );
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
      setStudyInitialMode('explain');
      handleSelectTab('study');
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
      setErrorMessage('Please enter a valid YouTube lecture URL or topic.');
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
      setStudyInitialMode('explain');
      handleSelectTab('study');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to import YouTube lecture.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSelectDocument = (
    doc: StudyDocument,
    targetMode: StudySubMode = 'explain'
  ) => {
    const updated: StudyDocument = {
      ...doc,
      lastStudiedAt: new Date().toISOString()
    };
    studyStorage.saveDocument(updated);
    studyStorage.setActiveDocumentId(updated.id);
    setDocuments(studyStorage.getDocuments());
    setActiveDoc(updated);
    setStudyInitialMode(targetMode);
    handleSelectTab('study');
  };

  const handleDeleteDocument = (docId: string) => {
    studyStorage.deleteDocument(docId);
    const remaining = studyStorage.getDocuments();
    setDocuments(remaining);
    if (activeDoc?.id === docId) {
      setActiveDoc(remaining[0] || null);
    }
  };

  const handleMarkNotificationsRead = () => {
    studyStorage.markAllNotificationsRead();
    setNotifications(studyStorage.getNotifications());
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FCFBF9] text-[#121827]">
      <Navbar
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        hasActiveDoc={!!activeDoc}
        activeDoc={activeDoc}
        onOpenNotebookModal={() => {
          setNotebookInitialTab('scan');
          setNotebookModalOpen(true);
        }}
        user={user}
        isAuthReady={isAuthReady}
        isSyncing={isSyncing}
        onLogin={signInWithGoogle}
        onLogout={signOutUser}
        documents={documents}
        onSelectDocumentFromSearch={(doc) => handleSelectDocument(doc, 'explain')}
        notifications={notifications}
        onMarkNotificationsRead={handleMarkNotificationsRead}
        onOpenProfileModal={() => setProfileModalOpen(true)}
        studentProfile={studentProfile}
      />

      {/* Main Content Container */}
      <main className="flex-1">
        {activeTab === 'home' && (
          <HomeView
            documents={documents}
            onUploadPdf={handleUploadPdf}
            onSubmitTextNotes={(title, text) => handleSubmitTextNotes(title, text, 'text')}
            onSubmitYouTubeUrl={handleSubmitYouTubeUrl}
            onSelectDocument={handleSelectDocument}
            onNavigateTab={handleSelectTab}
            onOpenVoiceTutor={() => setVoiceTutorOpen(true)}
            onOpenNotebookModal={(tab = 'scan') => {
              setNotebookInitialTab(tab);
              setNotebookModalOpen(true);
            }}
            isProcessing={isProcessing}
            errorMessage={errorMessage}
            onClearError={() => setErrorMessage(null)}
          />
        )}

        {activeTab === 'dashboard' && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <StudentDashboardView
              studentName={
                user?.displayName
                  ? user.displayName.split(' ')[0]
                  : studentProfile.fullName
              }
              documents={documents}
              activeDoc={activeDoc}
              onSelectDoc={(doc, mode = 'explain') => handleSelectDocument(doc, mode)}
              onNavigateTab={handleSelectTab}
              studentProfile={studentProfile}
              onOpenProfileModal={() => setProfileModalOpen(true)}
            />
          </div>
        )}

        {(activeTab === 'study' || activeTab === 'ai-tutor') && activeDoc && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
            <StudyView
              documents={documents}
              activeDocument={effectiveDoc}
              onSelectDocument={(doc) => {
                studyStorage.setActiveDocumentId(doc.id);
                setActiveDoc(doc);
              }}
              initialSubMode={activeTab === 'ai-tutor' ? 'explain' : studyInitialMode}
              presentationMode={activeTab === 'ai-tutor' ? 'ai-tutor' : 'study-space'}
              onAttemptSaved={refreshDocumentsState}
              onNavigateProgress={() => handleSelectTab('dashboard')}
              onOpenPdfWorkspace={() => handleSelectTab('pdf-workspace')}
              onOpenUploadModal={() => handleSelectTab('home')}
              isCloudSynced={!!user}
            />
          </div>
        )}

        {(activeTab === 'study' || activeTab === 'ai-tutor') && !activeDoc && (
          <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
            <h2 className="font-serif-editorial text-3xl font-bold text-[#121827]">
              No Study Document Selected
            </h2>
            <p className="text-sm text-[#606B7C]">
              Upload a PDF or select one of your materials to start studying.
            </p>
            <button
              onClick={() => handleSelectTab('home')}
              className="px-5 py-2.5 rounded-lg lm-btn-accent text-xs font-semibold cursor-pointer"
            >
              Upload Study Material
            </button>
          </div>
        )}

        {activeTab === 'revision' && activeDoc && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <QuickReviseView
              activeDocument={effectiveDoc}
              onNavigateToCitation={(pageNumber) => {
                setStudyInitialMode('explain');
                handleSelectTab('study');
              }}
              onAskTutorAboutConcept={() => {
                handleSelectTab('ai-tutor');
              }}
            />
          </div>
        )}

        {activeTab === 'revision' && !activeDoc && (
          <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
            <h2 className="font-serif-editorial text-3xl font-bold text-[#121827]">
              Select a Material to Revise
            </h2>
            <button
              onClick={() => handleSelectTab('home')}
              className="px-5 py-2.5 rounded-lg lm-btn-accent text-xs font-semibold cursor-pointer"
            >
              Upload Material
            </button>
          </div>
        )}

        {activeTab === 'practice' && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <PracticeWorkspaceView
              documents={documents}
              activeDoc={activeDoc}
              onSelectDoc={(doc) => setActiveDoc(doc)}
              onOpenStudyQuiz={() => {
                if (activeDoc || documents[0]) {
                  if (!activeDoc && documents[0]) setActiveDoc(documents[0]);
                  setStudyInitialMode('quiz');
                  handleSelectTab('study');
                }
              }}
              studentProfile={studentProfile}
              onOpenProfileModal={() => setProfileModalOpen(true)}
            />
          </div>
        )}

        {activeTab === 'explore' && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
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
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-5">
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
              onGenerateFlashcardsFromNotes={() => {
                handleSelectTab('revision');
              }}
            />
          </div>
        )}

        {activeTab === 'pdf-workspace' && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <PdfWorkspaceView
              documents={documents}
              activeDoc={activeDoc}
              onSelectDoc={(doc) => setActiveDoc(doc)}
              onUploadClick={() => handleSelectTab('home')}
              onDeleteDoc={handleDeleteDocument}
              onDocumentsChanged={refreshDocumentsState}
              onOpenStudySpace={() => {
                setStudyInitialMode('explain');
                handleSelectTab('study');
              }}
            />
          </div>
        )}

        {activeTab === 'analytics' && (
          <div className="max-w-[1380px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <ProgressView
              documents={documents}
              attempts={studyStorage.getQuizAttempts()}
              onStartQuizForDocument={(doc, mode) => {
                handleSelectDocument(doc, mode);
              }}
              onResetProgress={() => {
                studyStorage.clearAllProgress();
                refreshDocumentsState();
              }}
            />
          </div>
        )}
      </main>

      {/* Personalized Student Academic Profile Modal */}
      <StudentProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
        onProfileSaved={(updated) => setStudentProfile(updated)}
      />

      {/* Live Voice AI Tutor Modal */}
      {activeDoc && (
        <VoiceTutorModal
          isOpen={voiceTutorOpen}
          onClose={() => setVoiceTutorOpen(false)}
          activeDocument={activeDoc}
          weakTopics={studentProfile.weakAreas}
        />
      )}

      {/* Smart Notebook, OCR Scanner & Voice Recorder Modal */}
      <NotebookAndScannerModal
        isOpen={notebookModalOpen}
        initialMode={notebookInitialTab}
        onClose={() => setNotebookModalOpen(false)}
        onImportAsStudyDocument={(doc) => {
          studyStorage.saveDocument(doc);
          studyStorage.setActiveDocumentId(doc.id);
          setDocuments(studyStorage.getDocuments());
          setActiveDoc(doc);
          setStudyInitialMode('explain');
          handleSelectTab('study');
        }}
      />
    </div>
  );
}

export default App;
