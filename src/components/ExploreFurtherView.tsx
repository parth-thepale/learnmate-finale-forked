import React, { useEffect, useState, useMemo } from 'react';
import {
  Youtube,
  Search,
  ExternalLink,
  Loader2,
  Play,
  Sparkles,
  AlertCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import type { StudyDocument, YouTubeRecommendation } from '../types/study';
import { aiStudyClient } from '../services/aiClient';
import { studyStorage } from '../services/storageService';
import {
  extractPreciseEducationalConcepts,
  buildSpecificYouTubeSearchQuery,
} from '../utils/stabilityEngine';

interface ExploreFurtherViewProps {
  activeDocument: StudyDocument;
  weakTopics: string[];
  onImportYouTubeUrl?: (youtubeUrl: string) => Promise<void>;
}

export const ExploreFurtherView: React.FC<ExploreFurtherViewProps> = ({
  activeDocument,
  weakTopics,
  onImportYouTubeUrl,
}) => {
  const [selectedQuery, setSelectedQuery] = useState<string>('');
  const [customSearchInput, setCustomSearchInput] = useState<string>('');
  const [videos, setVideos] = useState<YouTubeRecommendation[]>([]);
  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [activeSearchQuery, setActiveSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Extract 3-5 precise educational concepts, skipping generic titles like "Semester 1 Revision"
  const topicChips = useMemo(() => {
    const concepts = extractPreciseEducationalConcepts({
      documentTitle: activeDocument.title,
      topics: activeDocument.topics,
      weakTopics,
      pageTitles: activeDocument.pages.map((p) => p.title),
    });
    return concepts.length > 0
      ? concepts
      : activeDocument.topics.map((t) => t.name).slice(0, 5);
  }, [activeDocument.id, activeDocument.title, activeDocument.topics, activeDocument.pages, weakTopics]);

  const allKeyConcepts = useMemo(
    () => activeDocument.topics.flatMap((t) => t.keyConcepts || []),
    [activeDocument.topics]
  );

  const fetchRecommendations = async (topicQuery?: string, forceRefresh = false) => {
    if (isLoading) return;
    const effectiveConcept =
      (topicQuery ?? selectedQuery).trim() ||
      topicChips[0] ||
      activeDocument.topics[0]?.name ||
      'Core Concept';

    const specificQuery = buildSpecificYouTubeSearchQuery({
      concept: effectiveConcept,
      documentTitle: activeDocument.title,
      topics: activeDocument.topics.map((t) => t.name),
    });
    setActiveSearchQuery(specificQuery);

    const cacheKey = `${activeDocument.id}_${specificQuery
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')}`;

    if (!forceRefresh) {
      const cached = studyStorage.getCachedYouTubeRecommendations(cacheKey);
      if (cached && cached.length > 0) {
        setVideos(cached);
        setIsConfigured(true);
        setStatusMessage(null);
        return;
      }
    }

    setIsLoading(true);
    setStatusMessage(null);
    try {
      const res = await aiStudyClient.fetchYouTubeRecommendations({
        query: effectiveConcept,
        documentTitle: activeDocument.title,
        topics: activeDocument.topics.map((t) => t.name),
        weakTopics,
        keyConcepts: allKeyConcepts,
        pageTitles: activeDocument.pages.map((p) => p.title),
      });

      setIsConfigured(res.configured);
      setVideos(res.videos || []);
      if (res.searchQuery) {
        setActiveSearchQuery(res.searchQuery);
      }
      if (res.configured && res.videos && res.videos.length > 0) {
        studyStorage.saveCachedYouTubeRecommendations(cacheKey, res.videos);
      } else if (res.message) {
        setStatusMessage(res.message);
      }
    } catch (err) {
      setIsConfigured(false);
      setVideos([]);
      setStatusMessage(
        err instanceof Error
          ? err.message
          : 'Could not reach YouTube recommendations service.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    const initialTopic =
      topicChips[0] ||
      weakTopics[0] ||
      activeDocument.topics[0]?.name ||
      'Core Concept';
    setSelectedQuery(initialTopic);
    void fetchRecommendations(initialTopic, false);
  }, [activeDocument.id]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = customSearchInput.trim();
    if (!q || isLoading) return;
    setSelectedQuery(q);
    void fetchRecommendations(q, true);
  };

  return (
    <div className="p-6 sm:p-8 space-y-6 flex-1">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-xl font-bold text-[#172033] flex items-center gap-2">
            <Youtube className="w-5 h-5 text-[#EA4335]" />
            <span>Explore Further: YouTube Recommendations</span>
          </h2>
          <p className="text-xs sm:text-sm text-[#64748B]">
            Concept-specific educational tutorials ranked by relevance, channel authority, and duration.
          </p>
        </div>

        <button
          type="button"
          disabled={isLoading}
          onClick={() => void fetchRecommendations(selectedQuery, true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-xs font-semibold text-slate-700 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Videos</span>
        </button>
      </div>

      {/* Extracted Concept Chips & Manual Topic Search */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Extracted Concepts:</span>
          {topicChips.map((chip) => {
            const isSelected = selectedQuery === chip;
            const isWeak = weakTopics.some(
              (w) => w.toLowerCase() === chip.toLowerCase()
            );
            return (
              <button
                key={chip}
                type="button"
                disabled={isLoading}
                onClick={() => {
                  setSelectedQuery(chip);
                  void fetchRecommendations(chip, false);
                }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-[#1A73E8] text-white border-[#1A73E8]'
                    : isWeak
                    ? 'bg-[#FEF9EE] text-amber-900 border-amber-200 hover:bg-amber-100'
                    : 'bg-[#F8FAFC] text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {isWeak ? `Focus: ${chip}` : chip}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 max-w-lg">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={customSearchInput}
              onChange={(e) => setCustomSearchInput(e.target.value)}
              placeholder="Search a specific concept, theorem, or formula..."
              aria-label="Search educational YouTube videos"
              className="w-full pl-9 pr-4 py-2 rounded-full bg-[#F8FAFC] border border-slate-200 text-xs sm:text-sm text-[#172033] focus:outline-none focus:border-[#4285F4]"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !customSearchInput.trim()}
            className="px-4 py-2 rounded-full bg-[#1A73E8] hover:bg-[#1557B0] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            Find Videos
          </button>
        </form>
      </div>

      {/* Results Area */}
      {isLoading ? (
        <div className="py-16 text-center space-y-3">
          <Loader2 className="w-7 h-7 animate-spin text-[#EA4335] mx-auto" />
          <p className="text-sm font-medium text-slate-700">
            Searching & ranking educational lectures for &ldquo;{selectedQuery}&rdquo;...
          </p>
        </div>
      ) : videos.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {videos.slice(0, 3).map((video) => (
            <div
              key={video.videoId}
              className="rounded-2xl bg-white border border-slate-200/90 overflow-hidden shadow-2xs flex flex-col justify-between group"
            >
              <div>
                <a
                  href={video.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block relative aspect-video bg-slate-900 overflow-hidden"
                >
                  <img
                    src={video.thumbnailUrl}
                    alt={video.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    referrerPolicy="no-referrer"
                  />
                  {video.durationLabel && (
                    <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900/85 text-white text-[11px] font-semibold">
                      <Clock className="w-3 h-3" />
                      <span>{video.durationLabel}</span>
                    </span>
                  )}
                  <div className="absolute inset-0 bg-black/25 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="w-11 h-11 rounded-full bg-[#EA4335] text-white flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                    </span>
                  </div>
                </a>

                <div className="p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[#EA4335] block truncate">
                      {video.channelTitle}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[#172033] line-clamp-2 leading-snug">
                    {video.title}
                  </h3>
                  {video.relevanceReason && (
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#E6F4EA] text-[#137333] text-[11px] font-medium">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span className="truncate">{video.relevanceReason}</span>
                    </div>
                  )}
                  {video.description && (
                    <p className="text-xs text-[#64748B] line-clamp-2 leading-relaxed">
                      {video.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="px-4 pb-4 pt-2 flex items-center justify-between gap-2 border-t border-slate-100">
                <a
                  href={video.watchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A73E8] hover:underline"
                >
                  <span>Watch on YouTube</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>

                {onImportYouTubeUrl && (
                  <button
                    type="button"
                    onClick={() => void onImportYouTubeUrl(video.watchUrl)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#E8F0FE] hover:bg-[#D2E3FC] text-[#1A73E8] text-[11px] font-semibold cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Analyze in LearnMate</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Honest API Configuration / Unconfigured or Empty State (Never Fabricates Fake Video URLs) */
        <div
          data-testid="youtube-recommendations-config-state"
          className="rounded-2xl bg-[#F8FAFC] border border-slate-200/90 p-6 sm:p-8 space-y-4 max-w-2xl"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FCE8E6] text-[#EA4335] flex items-center justify-center shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-[#172033]">
                {isConfigured
                  ? 'No Strongly Relevant Video Matches Found'
                  : 'YouTube Data API v3 Configuration Required for In-App Video Cards'}
              </h3>
              <p className="text-xs sm:text-sm text-[#64748B] leading-relaxed">
                {statusMessage ||
                  'LearnMate filters out clickbait, shorts, and off-topic results. Try searching a more specific concept above, or open a concept-targeted YouTube search below.'}
              </p>
              {activeSearchQuery && (
                <p className="text-[11px] text-[#64748B]">
                  Targeted query: <span className="font-semibold text-[#172033]">{activeSearchQuery}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            {topicChips.map((concept) => {
              const cleanQuery = buildSpecificYouTubeSearchQuery({
                concept,
                documentTitle: activeDocument.title,
                topics: activeDocument.topics.map((t) => t.name),
              });
              return (
                <a
                  key={concept}
                  href={`https://www.youtube.com/results?search_query=${encodeURIComponent(
                    cleanQuery
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-slate-200 hover:border-[#EA4335] text-xs font-semibold text-[#172033] transition-colors"
                >
                  <Youtube className="w-4 h-4 text-[#EA4335]" />
                  <span>Search YouTube: {concept}</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
