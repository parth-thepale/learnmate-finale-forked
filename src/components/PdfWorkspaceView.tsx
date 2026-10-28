import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  FileText,
  Upload,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  Search,
  Highlighter,
  PenTool,
  Type,
  Underline as UnderlineIcon,
  Square,
  Circle as CircleIcon,
  ArrowUpRight,
  Eraser,
  Undo2,
  Redo2,
  Download,
  Save,
  Trash2,
  Edit3,
  Check,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  MousePointer,
  Layers,
  BookOpen,
  Sparkles,
  FileCheck2,
  AlertCircle,
  ScrollText,
  File
} from 'lucide-react';
import {
  StudyDocument,
  PdfAnnotationItem,
  PdfAnnotationTool,
  PdfAnnotationColor
} from '../types/study';
import { studyStorage } from '../services/storageService';
import {
  generateAnnotatedDocumentPdfBytes,
  triggerPdfDownload
} from '../utils/pdfGenerator';

interface PdfWorkspaceViewProps {
  documents: StudyDocument[];
  activeDoc: StudyDocument | null;
  onSelectDoc: (doc: StudyDocument) => void;
  onUploadClick: () => void;
  onDeleteDoc: (docId: string) => void;
  onDocumentsChanged: () => void;
  onOpenStudySpace: () => void;
}

const COLOR_MAP: Record<
  'yellow' | 'green' | 'blue' | 'pink',
  { label: string; hex: string; fillHex: string }
> = {
  yellow: { label: 'Yellow', hex: '#EAB308', fillHex: 'rgba(250, 204, 21, 0.36)' },
  green: { label: 'Green', hex: '#10B981', fillHex: 'rgba(52, 211, 153, 0.34)' },
  blue: { label: 'Blue', hex: '#3B82F6', fillHex: 'rgba(96, 165, 250, 0.34)' },
  pink: { label: 'Pink', hex: '#EC4899', fillHex: 'rgba(244, 114, 182, 0.34)' }
};

export const PdfWorkspaceView: React.FC<PdfWorkspaceViewProps> = ({
  documents,
  activeDoc,
  onSelectDoc,
  onUploadClick,
  onDeleteDoc,
  onDocumentsChanged,
  onOpenStudySpace
}) => {
  const currentDoc = activeDoc || documents[0] || null;

  // Layout panels
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [leftTab, setLeftTab] = useState<'thumbnails' | 'outline' | 'files'>('thumbnails');

  // Reader controls
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoom, setZoom] = useState<number>(100);
  const [fitMode, setFitMode] = useState<'width' | 'page' | 'custom'>('width');
  const [scrollMode, setScrollMode] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Annotation state
  const [activeTool, setActiveTool] = useState<PdfAnnotationTool>('select');
  const [activeColor, setActiveColor] = useState<'yellow' | 'green' | 'blue' | 'pink'>('yellow');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [annotations, setAnnotations] = useState<PdfAnnotationItem[]>([]);
  const [undoStack, setUndoStack] = useState<PdfAnnotationItem[][]>([]);
  const [redoStack, setRedoStack] = useState<PdfAnnotationItem[][]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Interactive drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [currentBox, setCurrentBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // Document management state
  const [renamingDocId, setRenamingDocId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>('');
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const workspaceContainerRef = useRef<HTMLDivElement>(null);
  const pageSurfaceRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Load annotations when document changes
  useEffect(() => {
    if (!currentDoc) {
      setAnnotations([]);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedAnnotationId(null);
      return;
    }
    const saved = studyStorage.getPdfAnnotations(currentDoc.id);
    setAnnotations(saved);
    setUndoStack([]);
    setRedoStack([]);
    setSelectedAnnotationId(null);
    setCurrentPage(1);
  }, [currentDoc?.id]);

  const totalPages = currentDoc?.pages?.length || 1;

  // Search matches across pages
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !currentDoc) return [];
    const results: { pageNumber: number; snippet: string; count: number }[] = [];
    for (const page of currentDoc.pages) {
      const lower = page.content.toLowerCase();
      let idx = lower.indexOf(q);
      let count = 0;
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(q, idx + q.length);
      }
      if (count > 0) {
        const firstIdx = lower.indexOf(q);
        const start = Math.max(0, firstIdx - 28);
        const end = Math.min(page.content.length, firstIdx + q.length + 45);
        results.push({
          pageNumber: page.pageNumber,
          snippet:
            (start > 0 ? '...' : '') +
            page.content.slice(start, end) +
            (end < page.content.length ? '...' : ''),
          count
        });
      }
    }
    return results;
  }, [searchQuery, currentDoc]);

  const pushAnnotationState = (next: PdfAnnotationItem[]) => {
    setUndoStack((prev) => [...prev.slice(-24), annotations]);
    setRedoStack([]);
    setAnnotations(next);
    if (currentDoc) {
      studyStorage.savePdfAnnotations(currentDoc.id, next);
    }
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setRedoStack((prev) => [...prev, annotations]);
    setUndoStack((prev) => prev.slice(0, -1));
    setAnnotations(previous);
    if (currentDoc) {
      studyStorage.savePdfAnnotations(currentDoc.id, previous);
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((prev) => [...prev, annotations]);
    setRedoStack((prev) => prev.slice(0, -1));
    setAnnotations(next);
    if (currentDoc) {
      studyStorage.savePdfAnnotations(currentDoc.id, next);
    }
  };

  const handleSaveAnnotations = () => {
    if (!currentDoc) return;
    studyStorage.savePdfAnnotations(currentDoc.id, annotations);
    setStatusBanner({
      type: 'success',
      message: `Saved ${annotations.length} annotation${annotations.length === 1 ? '' : 's'} to "${currentDoc.title}".`
    });
    setTimeout(() => setStatusBanner(null), 3500);
  };

  const handleDownloadPdf = async (includeAnnotations: boolean) => {
    if (!currentDoc || isExporting) return;
    setIsExporting(true);
    setStatusBanner({
      type: 'info',
      message: includeAnnotations
        ? 'Generating your annotated PDF document...'
        : 'Preparing original PDF download...'
    });
    try {
      const pdfBytes = await generateAnnotatedDocumentPdfBytes(
        currentDoc,
        annotations,
        includeAnnotations
      );
      const baseTitle = currentDoc.title.replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_');
      const filename = includeAnnotations
        ? `${baseTitle}_Annotated.pdf`
        : `${baseTitle}_Original.pdf`;
      triggerPdfDownload(pdfBytes, filename);
      setStatusBanner({
        type: 'success',
        message: `Downloaded ${filename} (${Math.max(1, Math.round(pdfBytes.byteLength / 1024))} KB)`
      });
    } catch (err: any) {
      setStatusBanner({
        type: 'error',
        message: err?.message || 'Could not export PDF. Please try again.'
      });
    } finally {
      setIsExporting(false);
    }
  };

  const toggleFullscreen = () => {
    if (!workspaceContainerRef.current) return;
    if (!document.fullscreenElement) {
      workspaceContainerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Text selection highlighting on a page
  const handleTextSelectionOnPage = (pageNumber: number) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;
    const selectedText = selection.toString().trim();
    if (!selectedText || selectedText.length < 2) return;

    if (activeTool === 'highlight' || activeTool === 'underline') {
      const surface = pageSurfaceRefs.current[pageNumber];
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      let relX = 0.08;
      let relY = 0.22;
      let relW = 0.78;
      let relH = 0.045;

      if (surface) {
        const surfaceRect = surface.getBoundingClientRect();
        if (surfaceRect.width > 0 && surfaceRect.height > 0) {
          relX = Math.max(0.02, Math.min(0.92, (rect.left - surfaceRect.left) / surfaceRect.width));
          relY = Math.max(0.02, Math.min(0.95, (rect.top - surfaceRect.top) / surfaceRect.height));
          relW = Math.max(0.08, Math.min(0.94 - relX, rect.width / surfaceRect.width));
          relH = Math.max(0.025, Math.min(0.25, rect.height / surfaceRect.height));
        }
      }

      const newAnn: PdfAnnotationItem = {
        id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        pageNumber,
        tool: activeTool,
        color: activeColor,
        strokeWidth,
        x: relX,
        y: relY,
        width: relW,
        height: relH,
        quoteText: selectedText,
        text:
          activeTool === 'highlight'
            ? `Highlighted: "${selectedText.slice(0, 80)}"`
            : `Underlined: "${selectedText.slice(0, 80)}"`,
        createdAt: new Date().toISOString()
      };

      pushAnnotationState([...annotations, newAnn]);
      setSelectedAnnotationId(newAnn.id);
      selection.removeAllRanges();
    }
  };

  const getRelativeCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = Math.max(0.01, Math.min(0.99, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.01, Math.min(0.99, (e.clientY - rect.top) / rect.height));
    return { x, y };
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>, pageNumber: number) => {
    if (!currentDoc) return;
    if (activeTool === 'select' || activeTool === 'eraser') return;

    const pt = getRelativeCoords(e);

    if (activeTool === 'text_note') {
      const newNote: PdfAnnotationItem = {
        id: `ann-${Date.now()}`,
        pageNumber,
        tool: 'text_note',
        color: activeColor,
        strokeWidth: 2,
        x: pt.x,
        y: pt.y,
        width: 0.28,
        height: 0.08,
        text: 'Key study note: click to edit in side panel',
        createdAt: new Date().toISOString()
      };
      pushAnnotationState([...annotations, newNote]);
      setSelectedAnnotationId(newNote.id);
      setActiveTool('select');
      return;
    }

    setIsDrawing(true);
    setDrawStart(pt);
    if (activeTool === 'pen') {
      setCurrentPoints([pt]);
    } else {
      setCurrentBox({ x: pt.x, y: pt.y, w: 0.01, h: 0.01 });
    }
  };

  const handleSvgMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDrawing || !drawStart) return;
    const pt = getRelativeCoords(e);
    if (activeTool === 'pen') {
      setCurrentPoints((prev) => [...prev, pt]);
    } else {
      setCurrentBox({
        x: Math.min(drawStart.x, pt.x),
        y: Math.min(drawStart.y, pt.y),
        w: Math.max(0.015, Math.abs(pt.x - drawStart.x)),
        h: Math.max(0.015, Math.abs(pt.y - drawStart.y))
      });
    }
  };

  const handleSvgMouseUp = (e: React.MouseEvent<SVGSVGElement>, pageNumber: number) => {
    if (!isDrawing || !currentDoc || !drawStart) return;
    if (activeTool === 'select' || activeTool === 'eraser') return;
    const pt = getRelativeCoords(e);
    setIsDrawing(false);

    if (activeTool === 'pen' && currentPoints.length > 1) {
      const xs = currentPoints.map((p) => p.x);
      const ys = currentPoints.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      const maxX = Math.max(...xs);
      const maxY = Math.max(...ys);

      const newStroke: PdfAnnotationItem = {
        id: `ann-${Date.now()}`,
        pageNumber,
        tool: 'pen',
        color: activeColor,
        strokeWidth,
        x: minX,
        y: minY,
        width: Math.max(0.02, maxX - minX),
        height: Math.max(0.02, maxY - minY),
        points: currentPoints,
        text: 'Freehand ink annotation',
        createdAt: new Date().toISOString()
      };
      pushAnnotationState([...annotations, newStroke]);
      setSelectedAnnotationId(newStroke.id);
    } else if (currentBox && (currentBox.w > 0.02 || currentBox.h > 0.015)) {
      const newShape: PdfAnnotationItem = {
        id: `ann-${Date.now()}`,
        pageNumber,
        tool: activeTool,
        color: activeColor,
        strokeWidth,
        x: activeTool === 'arrow' ? drawStart.x : currentBox.x,
        y: activeTool === 'arrow' ? drawStart.y : currentBox.y,
        width: activeTool === 'arrow' ? pt.x - drawStart.x : currentBox.w,
        height: activeTool === 'arrow' ? pt.y - drawStart.y : currentBox.h,
        text: `${activeTool.replace('_', ' ')} annotation on Page ${pageNumber}`,
        createdAt: new Date().toISOString()
      };
      pushAnnotationState([...annotations, newShape]);
      setSelectedAnnotationId(newShape.id);
    }

    setDrawStart(null);
    setCurrentPoints([]);
    setCurrentBox(null);
  };

  const handleAnnotationClick = (e: React.MouseEvent, ann: PdfAnnotationItem) => {
    e.stopPropagation();
    if (activeTool === 'eraser') {
      pushAnnotationState(annotations.filter((item) => item.id !== ann.id));
      if (selectedAnnotationId === ann.id) {
        setSelectedAnnotationId(null);
      }
      return;
    }
    setSelectedAnnotationId(ann.id);
  };

  const handleDeleteAnnotation = (annId: string) => {
    pushAnnotationState(annotations.filter((item) => item.id !== annId));
    if (selectedAnnotationId === annId) {
      setSelectedAnnotationId(null);
    }
  };

  const handleUpdateAnnotationNote = (annId: string, text: string) => {
    const updated = annotations.map((item) => (item.id === annId ? { ...item, text } : item));
    setAnnotations(updated);
    if (currentDoc) {
      studyStorage.savePdfAnnotations(currentDoc.id, updated);
    }
  };

  const handleStartRename = (doc: StudyDocument) => {
    setRenamingDocId(doc.id);
    setRenameValue(doc.title);
  };

  const handleConfirmRename = (docId: string) => {
    if (renameValue.trim()) {
      studyStorage.renameDocument(docId, renameValue.trim());
      onDocumentsChanged();
    }
    setRenamingDocId(null);
  };

  const selectedAnnotation = annotations.find((a) => a.id === selectedAnnotationId) || null;
  const currentPageAnnotations = annotations.filter((a) => a.pageNumber === currentPage);

  const computedPageWidth = useMemo(() => {
    if (fitMode === 'width') return '100%';
    if (fitMode === 'page') return '680px';
    return `${Math.round(740 * (zoom / 100))}px`;
  }, [fitMode, zoom]);

  const renderHighlightedParagraph = (paragraph: string, pIdx: number) => {
    const q = searchQuery.trim();
    if (!q) return paragraph;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = paragraph.split(regex);
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={`${pIdx}-${i}`} className="bg-amber-200 text-slate-900 px-1 rounded font-semibold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  const renderSinglePageSurface = (page: { pageNumber: number; title?: string; content: string }) => {
    const pageAnns = annotations.filter((a) => a.pageNumber === page.pageNumber);
    const paragraphs = page.content.split(/\n+/).filter(Boolean);
    const interactiveOverlayActive = activeTool !== 'select';

    return (
      <div
        key={page.pageNumber}
        ref={(el) => {
          pageSurfaceRefs.current[page.pageNumber] = el;
        }}
        onMouseUp={() => handleTextSelectionOnPage(page.pageNumber)}
        data-testid={`pdf-page-surface-${page.pageNumber}`}
        style={{ width: computedPageWidth, maxWidth: '100%' }}
        className="relative mx-auto bg-white rounded-2xl border border-slate-200/90 shadow-[0_12px_36px_-12px_rgba(15,23,42,0.12)] transition-all overflow-hidden mb-6"
      >
        {/* Top Page Header Bar */}
        <div className="px-7 py-3.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <FileText className="w-3.5 h-3.5 text-blue-600" />
            <span className="truncate max-w-[260px]">{currentDoc?.title}</span>
          </div>
          <div className="flex items-center gap-3">
            {pageAnns.length > 0 && (
              <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-semibold border border-blue-200/60">
                {pageAnns.length} annotation{pageAnns.length === 1 ? '' : 's'}
              </span>
            )}
            <span className="font-mono font-semibold text-slate-600">
              Page {page.pageNumber} of {totalPages}
            </span>
          </div>
        </div>

        {/* Page Body Content */}
        <div
          className="px-8 sm:px-12 py-9 min-h-[640px] text-slate-800 leading-relaxed space-y-4 select-text"
          style={{ fontSize: `${Math.max(13, Math.round(15 * (zoom / 100)))}px` }}
        >
          {page.title && (
            <h2 className="text-xl font-extrabold text-slate-900 border-b border-slate-100 pb-2">
              {page.title}
            </h2>
          )}
          {paragraphs.map((para, idx) => {
            const isHeading =
              idx === 0 ||
              (para.length < 85 && (/^[A-Z0-9\s:&—-]+$/.test(para) || para.endsWith(':')));
            const isFormulaOrBullet =
              para.trim().startsWith('•') ||
              para.trim().startsWith('-') ||
              /^[0-9]+\./.test(para.trim()) ||
              para.includes('=');

            if (isHeading) {
              return (
                <h3
                  key={idx}
                  className="text-lg font-bold text-slate-900 tracking-tight pt-2 border-b border-slate-100 pb-1.5"
                >
                  {renderHighlightedParagraph(para, idx)}
                </h3>
              );
            }
            if (isFormulaOrBullet) {
              return (
                <div
                  key={idx}
                  className="pl-4 py-2 pr-3 rounded-xl bg-slate-50/90 border-l-4 border-blue-400 text-slate-800 font-medium"
                >
                  {renderHighlightedParagraph(para, idx)}
                </div>
              );
            }
            return (
              <p key={idx} className="text-slate-700 leading-7">
                {renderHighlightedParagraph(para, idx)}
              </p>
            );
          })}
        </div>

        {/* SVG Annotation & Drawing Layer */}
        <svg
          viewBox="0 0 1000 1000"
          preserveAspectRatio="none"
          onMouseDown={(e) => handleSvgMouseDown(e, page.pageNumber)}
          onMouseMove={(e) => handleSvgMouseMove(e)}
          onMouseUp={(e) => handleSvgMouseUp(e, page.pageNumber)}
          data-testid={`pdf-annotation-svg-${page.pageNumber}`}
          className={`absolute inset-0 w-full h-full ${
            interactiveOverlayActive && activeTool !== 'highlight' && activeTool !== 'underline'
              ? 'cursor-crosshair pointer-events-auto'
              : 'pointer-events-none'
          }`}
        >
          <defs>
            <marker
              id="annotation-arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#2563EB" />
            </marker>
          </defs>

          {pageAnns.map((ann) => {
            const colorKey = (ann.color in COLOR_MAP ? ann.color : 'yellow') as keyof typeof COLOR_MAP;
            const colorSpec = COLOR_MAP[colorKey];
            const isSelected = ann.id === selectedAnnotationId;
            const x = ann.x * 1000;
            const y = ann.y * 1000;
            const w = Math.max(20, (ann.width || 0.22) * 1000);
            const h = Math.max(16, (ann.height || 0.04) * 1000);
            const sw = ann.strokeWidth || 2;

            if (ann.tool === 'highlight') {
              return (
                <rect
                  key={ann.id}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={6}
                  fill={colorSpec.fillHex}
                  stroke={isSelected ? colorSpec.hex : 'none'}
                  strokeWidth={isSelected ? 3 : 0}
                  className="pointer-events-auto cursor-pointer transition-opacity hover:opacity-80"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                />
              );
            }

            if (ann.tool === 'underline') {
              return (
                <g
                  key={ann.id}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                >
                  <rect x={x} y={y} width={w} height={h} fill="transparent" />
                  <line
                    x1={x}
                    y1={y + h}
                    x2={x + w}
                    y2={y + h}
                    stroke={colorSpec.hex}
                    strokeWidth={sw * 1.5}
                  />
                </g>
              );
            }

            if (ann.tool === 'rectangle') {
              return (
                <rect
                  key={ann.id}
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={8}
                  fill="rgba(255,255,255,0.04)"
                  stroke={colorSpec.hex}
                  strokeWidth={sw * 1.6}
                  strokeDasharray={isSelected ? '8 4' : undefined}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                />
              );
            }

            if (ann.tool === 'circle') {
              return (
                <ellipse
                  key={ann.id}
                  cx={x + w / 2}
                  cy={y + h / 2}
                  rx={w / 2}
                  ry={h / 2}
                  fill="rgba(255,255,255,0.04)"
                  stroke={colorSpec.hex}
                  strokeWidth={sw * 1.6}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                />
              );
            }

            if (ann.tool === 'arrow') {
              const x2 = (ann.x + (ann.width || 0.15)) * 1000;
              const y2 = (ann.y + (ann.height || 0.08)) * 1000;
              return (
                <line
                  key={ann.id}
                  x1={x}
                  y1={y}
                  x2={x2}
                  y2={y2}
                  stroke={colorSpec.hex}
                  strokeWidth={sw * 2}
                  markerEnd="url(#annotation-arrow)"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                />
              );
            }

            if (ann.tool === 'pen' && ann.points && ann.points.length > 1) {
              const pathData = ann.points
                .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x * 1000} ${p.y * 1000}`)
                .join(' ');
              return (
                <path
                  key={ann.id}
                  d={pathData}
                  fill="none"
                  stroke={colorSpec.hex}
                  strokeWidth={sw * 1.7}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                />
              );
            }

            if (ann.tool === 'text_note') {
              return (
                <g
                  key={ann.id}
                  transform={`translate(${x}, ${y})`}
                  className="pointer-events-auto cursor-pointer"
                  onClick={(e) => handleAnnotationClick(e, ann)}
                >
                  <rect
                    x={0}
                    y={0}
                    width={240}
                    height={68}
                    rx={10}
                    fill="#FEF9C3"
                    stroke={colorSpec.hex}
                    strokeWidth={isSelected ? 3.5 : 2}
                  />
                  <text x={12} y={24} fontSize="15" fontWeight="bold" fill="#1E293B">
                    Note
                  </text>
                  <text x={12} y={46} fontSize="13" fill="#334155">
                    {(ann.text || '').slice(0, 30)}
                  </text>
                </g>
              );
            }

            return null;
          })}

          {isDrawing && activeTool === 'pen' && currentPoints.length > 1 && (
            <path
              d={currentPoints
                .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x * 1000} ${p.y * 1000}`)
                .join(' ')}
              fill="none"
              stroke={COLOR_MAP[activeColor].hex}
              strokeWidth={strokeWidth * 1.7}
              strokeLinecap="round"
            />
          )}
          {isDrawing && currentBox && activeTool !== 'pen' && (
            <rect
              x={currentBox.x * 1000}
              y={currentBox.y * 1000}
              width={currentBox.w * 1000}
              height={currentBox.h * 1000}
              fill={activeTool === 'highlight' ? COLOR_MAP[activeColor].fillHex : 'none'}
              stroke={COLOR_MAP[activeColor].hex}
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          )}
        </svg>
      </div>
    );
  };

  return (
    <div
      ref={workspaceContainerRef}
      data-testid="pdf-workspace-view"
      className="space-y-4 pb-10"
    >
      {/* Workspace Header & Action Bar */}
      <div className="lm-card p-4 sm:p-5 bg-gradient-to-r from-white via-blue-50/40 to-indigo-50/30 border border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
            <FileCheck2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-blue-100/80 text-blue-700">
                PDF Workspace
              </span>
              <span className="text-xs text-slate-500 font-medium">
                Read, Highlight, Draw, Annotate &amp; Export Real PDFs
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight mt-0.5">
              {currentDoc ? currentDoc.title : 'Upload or Select a Study PDF'}
            </h1>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          <button
            onClick={onUploadClick}
            data-testid="pdf-workspace-upload-btn"
            className="h-10 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <Upload className="w-4 h-4 text-blue-600" />
            Upload PDF
          </button>

          <button
            onClick={handleSaveAnnotations}
            disabled={!currentDoc}
            data-testid="pdf-workspace-save-btn"
            className="h-10 px-4 rounded-xl bg-white hover:bg-emerald-50/60 text-slate-700 hover:text-emerald-700 border border-slate-200/90 text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <Save className="w-4 h-4 text-emerald-600" />
            Save Annotations ({annotations.length})
          </button>

          <button
            onClick={() => handleDownloadPdf(false)}
            disabled={!currentDoc || isExporting}
            data-testid="pdf-workspace-download-original-btn"
            className="h-10 px-4 rounded-xl bg-white hover:bg-slate-50 text-slate-700 border border-slate-200/90 text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer disabled:opacity-50"
          >
            <File className="w-4 h-4 text-slate-500" />
            Original PDF
          </button>

          <button
            onClick={() => handleDownloadPdf(true)}
            disabled={!currentDoc || isExporting}
            data-testid="pdf-workspace-download-annotated-btn"
            className="h-10 px-4 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Download Annotated PDF
          </button>

          <button
            onClick={onOpenStudySpace}
            className="h-10 px-3.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            AI Study Tools
          </button>
        </div>
      </div>

      {statusBanner && (
        <div
          data-testid="pdf-workspace-status-banner"
          className={`px-4 py-3 rounded-xl border flex items-center justify-between text-xs font-semibold ${
            statusBanner.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : statusBanner.type === 'error'
              ? 'bg-rose-50 border-rose-200 text-rose-800'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{statusBanner.message}</span>
          </div>
          <button
            onClick={() => setStatusBanner(null)}
            className="text-slate-500 hover:text-slate-800 p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Reader & Annotation Toolbar */}
      <div className="lm-card p-3 bg-white border border-slate-200/90 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center flex-wrap gap-1.5">
          <button
            onClick={() => setLeftPanelOpen((v) => !v)}
            title="Toggle Document & Page Sidebar"
            className="h-9 px-2.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          >
            {leftPanelOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            <span className="hidden sm:inline">Pages</span>
          </button>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          <button
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            data-testid="pdf-prev-page-btn"
            className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span
            data-testid="pdf-page-indicator"
            className="px-2.5 text-xs font-bold text-slate-700 font-mono"
          >
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            data-testid="pdf-next-page-btn"
            className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          <button
            onClick={() => {
              setFitMode('custom');
              setZoom((z) => Math.max(60, z - 15));
            }}
            title="Zoom Out"
            className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-bold text-slate-700 min-w-[46px] text-center">
            {zoom}%
          </span>
          <button
            onClick={() => {
              setFitMode('custom');
              setZoom((z) => Math.min(180, z + 15));
            }}
            title="Zoom In"
            className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <button
            onClick={() => {
              setFitMode('width');
              setZoom(100);
            }}
            className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              fitMode === 'width'
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Fit Width
          </button>
          <button
            onClick={() => {
              setFitMode('page');
              setZoom(90);
            }}
            className={`h-9 px-2.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              fitMode === 'page'
                ? 'bg-blue-50 border-blue-200 text-blue-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            Fit Page
          </button>
          <button
            onClick={() => setScrollMode((s) => !s)}
            className={`h-9 px-2.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all cursor-pointer ${
              scrollMode
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ScrollText className="w-3.5 h-3.5" />
            {scrollMode ? 'Continuous Scroll' : 'Single Page'}
          </button>
        </div>

        {/* Center: Annotation Tool Bar */}
        <div
          data-testid="pdf-annotation-toolbar"
          className="flex items-center flex-wrap gap-1 bg-slate-100/90 p-1 rounded-xl border border-slate-200/80"
        >
          {(
            [
              { id: 'select', label: 'Select', icon: MousePointer },
              { id: 'highlight', label: 'Highlight', icon: Highlighter },
              { id: 'pen', label: 'Pen', icon: PenTool },
              { id: 'text_note', label: 'Note', icon: Type },
              { id: 'underline', label: 'Underline', icon: UnderlineIcon },
              { id: 'rectangle', label: 'Box', icon: Square },
              { id: 'circle', label: 'Circle', icon: CircleIcon },
              { id: 'arrow', label: 'Arrow', icon: ArrowUpRight },
              { id: 'eraser', label: 'Eraser', icon: Eraser }
            ] as { id: PdfAnnotationTool; label: string; icon: React.ComponentType<{ className?: string }> }[]
          ).map((tool) => {
            const Icon = tool.icon;
            const active = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                onClick={() => setActiveTool(tool.id)}
                data-testid={`pdf-tool-${tool.id}`}
                title={tool.label}
                className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white/80'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden xl:inline">{tool.label}</span>
              </button>
            );
          })}

          <div className="h-4 w-px bg-slate-300 mx-1" />

          {(['yellow', 'green', 'blue', 'pink'] as const).map((color) => (
            <button
              key={color}
              onClick={() => setActiveColor(color)}
              data-testid={`pdf-color-${color}`}
              title={`Color: ${COLOR_MAP[color].label}`}
              className={`w-6 h-6 rounded-full border-2 transition-transform cursor-pointer ${
                activeColor === color ? 'scale-110 border-slate-900' : 'border-white opacity-80 hover:opacity-100'
              }`}
              style={{ backgroundColor: COLOR_MAP[color].hex }}
            />
          ))}

          <div className="h-4 w-px bg-slate-300 mx-1" />

          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            title="Undo Annotation"
            data-testid="pdf-undo-btn"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-40 cursor-pointer"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            title="Redo Annotation"
            data-testid="pdf-redo-btn"
            className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-700 hover:bg-white disabled:opacity-40 cursor-pointer"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Search inside PDF + Fullscreen + Right Panel toggle */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in PDF..."
              data-testid="pdf-search-input"
              className="h-9 pl-8 pr-7 w-40 sm:w-48 rounded-lg border border-slate-200 bg-slate-50/70 text-xs text-slate-800 focus:bg-white focus:border-blue-400 focus:outline-none"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={toggleFullscreen}
            title="Toggle Fullscreen Reader"
            className="h-9 w-9 rounded-lg border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            onClick={() => setRightPanelOpen((v) => !v)}
            title="Toggle Notes & Properties Sidebar"
            className="h-9 px-2.5 rounded-lg bg-slate-100/80 hover:bg-slate-200/70 text-slate-700 flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
          >
            <span className="hidden sm:inline">Inspector</span>
            {rightPanelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* 3-Region Workspace Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {leftPanelOpen && (
          <div
            data-testid="pdf-left-panel"
            className="lg:col-span-3 lm-card p-4 bg-white border border-slate-200/90 space-y-4 max-h-[760px] overflow-y-auto"
          >
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100">
              {(
                [
                  { id: 'thumbnails', label: 'Pages' },
                  { id: 'outline', label: 'Outline' },
                  { id: 'files', label: `PDFs (${documents.length})` }
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setLeftTab(tab.id)}
                  className={`py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    leftTab === tab.id ? 'bg-white text-blue-600 shadow-2xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {searchQuery.trim() && (
              <div className="p-3 rounded-xl bg-amber-50/90 border border-amber-200 space-y-2">
                <div className="text-xs font-bold text-amber-900 flex items-center justify-between">
                  <span>Search Matches</span>
                  <span>{searchMatches.reduce((a, b) => a + b.count, 0)} hits</span>
                </div>
                {searchMatches.length === 0 ? (
                  <p className="text-xs text-amber-700">No matches found for "{searchQuery}".</p>
                ) : (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {searchMatches.map((m) => (
                      <button
                        key={m.pageNumber}
                        onClick={() => setCurrentPage(m.pageNumber)}
                        className="w-full text-left p-2 rounded-lg bg-white hover:bg-amber-100/50 border border-amber-200/70 text-xs cursor-pointer"
                      >
                        <div className="font-bold text-slate-800">
                          Page {m.pageNumber} ({m.count} match{m.count === 1 ? '' : 'es'})
                        </div>
                        <div className="text-[11px] text-slate-600 line-clamp-2">{m.snippet}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {leftTab === 'thumbnails' && currentDoc && (
              <div className="space-y-2.5">
                {currentDoc.pages.map((page) => {
                  const count = annotations.filter((a) => a.pageNumber === page.pageNumber).length;
                  const active = currentPage === page.pageNumber;
                  return (
                    <button
                      key={page.pageNumber}
                      onClick={() => setCurrentPage(page.pageNumber)}
                      data-testid={`pdf-thumbnail-page-${page.pageNumber}`}
                      className={`w-full text-left p-3 rounded-xl border transition-all cursor-pointer ${
                        active
                          ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-100'
                          : 'bg-slate-50/60 border-slate-200/80 hover:bg-slate-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-bold text-slate-800">Page {page.pageNumber}</span>
                        {count > 0 && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                            {count} note{count === 1 ? '' : 's'}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                        {page.content.slice(0, 120)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}

            {leftTab === 'outline' && currentDoc && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">
                  Structured sections &amp; topics detected in this PDF:
                </p>
                {currentDoc.pages.map((page) => {
                  const firstLine =
                    page.title ||
                    page.content.split('\n').find((l) => l.trim().length > 0) ||
                    `Section ${page.pageNumber}`;
                  return (
                    <button
                      key={page.pageNumber}
                      onClick={() => setCurrentPage(page.pageNumber)}
                      className="w-full text-left p-2.5 rounded-xl hover:bg-blue-50/60 border border-transparent hover:border-blue-200/70 flex items-start gap-2.5 transition-all cursor-pointer"
                    >
                      <BookOpen className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-slate-800 truncate">
                          {firstLine.slice(0, 56)}
                        </div>
                        <div className="text-[11px] text-slate-500">Page {page.pageNumber}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {leftTab === 'files' && (
              <div className="space-y-2.5">
                <button
                  onClick={onUploadClick}
                  className="w-full py-2.5 px-3 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 hover:bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  Upload New PDF Document
                </button>

                {documents.map((doc) => {
                  const isCurrent = currentDoc?.id === doc.id;
                  const isRenaming = renamingDocId === doc.id;
                  const isConfirmingDelete = confirmDeleteDocId === doc.id;
                  const savedAnns = studyStorage.getPdfAnnotations(doc.id).length;

                  return (
                    <div
                      key={doc.id}
                      className={`p-3 rounded-xl border transition-all ${
                        isCurrent
                          ? 'bg-blue-50/60 border-blue-300'
                          : 'bg-white border-slate-200/80 hover:border-slate-300'
                      }`}
                    >
                      {isRenaming ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="flex-1 h-8 px-2 rounded-lg border border-blue-300 text-xs font-semibold text-slate-800"
                            autoFocus
                          />
                          <button
                            onClick={() => handleConfirmRename(doc.id)}
                            className="h-8 w-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setRenamingDocId(null)}
                            className="h-8 w-8 rounded-lg bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => onSelectDoc(doc)}
                            className="text-left flex-1 min-w-0 cursor-pointer"
                          >
                            <div className="text-xs font-bold text-slate-900 truncate">{doc.title}</div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {doc.pages.length} pages • {savedAnns} annotation{savedAnns === 1 ? '' : 's'}
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleStartRename(doc)}
                              title="Rename Document"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 cursor-pointer"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => setConfirmDeleteDocId(doc.id)}
                              title="Delete Document"
                              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      {isConfirmingDelete && (
                        <div className="mt-2.5 pt-2.5 border-t border-rose-200/80 flex items-center justify-between gap-2">
                          <span className="text-[11px] font-semibold text-rose-700">
                            Delete this document?
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                onDeleteDoc(doc.id);
                                setConfirmDeleteDocId(null);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold cursor-pointer"
                            >
                              Delete
                            </button>
                            <button
                              onClick={() => setConfirmDeleteDocId(null)}
                              className="px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-semibold cursor-pointer"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* CENTER PANEL: Interactive PDF Reader + Canvas */}
        <div
          className={`${
            leftPanelOpen && rightPanelOpen
              ? 'lg:col-span-6'
              : leftPanelOpen || rightPanelOpen
              ? 'lg:col-span-9'
              : 'lg:col-span-12'
          } bg-slate-100/80 rounded-2xl border border-slate-200/90 p-4 sm:p-6 max-h-[760px] overflow-y-auto`}
        >
          <div className="mb-4 px-3.5 py-2 rounded-xl bg-white/90 border border-slate-200/80 flex items-center justify-between text-xs text-slate-600">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              <span className="font-semibold text-slate-800 capitalize">
                Tool: {activeTool.replace('_', ' ')}
              </span>
              <span className="text-slate-500 hidden sm:inline">
                {activeTool === 'highlight' || activeTool === 'underline'
                  ? 'Select any text on the page or drag a region to mark it.'
                  : activeTool === 'pen'
                  ? 'Click and drag directly on the page to write or sketch.'
                  : activeTool === 'text_note'
                  ? 'Click anywhere on the page to pin a structured study note.'
                  : activeTool === 'eraser'
                  ? 'Click any highlight, drawing, or shape to remove it cleanly.'
                  : 'Click any annotation to inspect or edit its note.'}
              </span>
            </div>
            <span className="font-mono text-[11px] text-slate-500">
              {currentPageAnnotations.length} on this page
            </span>
          </div>

          {!currentDoc ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
              <FileText className="w-12 h-12 text-blue-500 mx-auto" />
              <h3 className="text-lg font-bold text-slate-900">No PDF Document Loaded</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Upload a textbook chapter, lecture handout, or study PDF to read, highlight, draw diagrams, and export an annotated PDF.
              </p>
              <button
                onClick={onUploadClick}
                className="px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold cursor-pointer"
              >
                Upload Study PDF
              </button>
            </div>
          ) : scrollMode ? (
            currentDoc.pages.map((page) => renderSinglePageSurface(page))
          ) : (
            renderSinglePageSurface(
              currentDoc.pages.find((p) => p.pageNumber === currentPage) || currentDoc.pages[0]
            )
          )}
        </div>

        {/* RIGHT PANEL: Annotation Properties, Stroke Settings & Notes List */}
        {rightPanelOpen && (
          <div
            data-testid="pdf-right-panel"
            className="lg:col-span-3 lm-card p-4 bg-white border border-slate-200/90 space-y-4 max-h-[760px] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h3 className="text-sm font-bold text-slate-900">Annotations &amp; Notes</h3>
              </div>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                {annotations.length} total
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/70 space-y-2">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>Stroke &amp; Border Thickness</span>
                <span className="font-mono">{strokeWidth}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={8}
                value={strokeWidth}
                onChange={(e) => setStrokeWidth(Number(e.target.value))}
                className="w-full accent-blue-600 cursor-pointer"
              />
            </div>

            {selectedAnnotation && (
              <div className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-900 capitalize">
                    Selected {selectedAnnotation.tool.replace('_', ' ')} (Page {selectedAnnotation.pageNumber})
                  </span>
                  <button
                    onClick={() => handleDeleteAnnotation(selectedAnnotation.id)}
                    className="text-xs font-bold text-rose-600 hover:text-rose-700 flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                </div>
                {selectedAnnotation.quoteText && (
                  <p className="text-xs italic text-slate-600 bg-white/80 p-2 rounded-lg border border-blue-100">
                    "{selectedAnnotation.quoteText}"
                  </p>
                )}
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">
                    Attached Study Note:
                  </label>
                  <textarea
                    rows={3}
                    value={selectedAnnotation.text || ''}
                    onChange={(e) => handleUpdateAnnotationNote(selectedAnnotation.id, e.target.value)}
                    placeholder="Add your explanation, formula reminder, or exam tip..."
                    className="w-full p-2 rounded-lg border border-blue-200 bg-white text-xs text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            )}

            {currentDoc && (
              <button
                onClick={() => {
                  const newNote: PdfAnnotationItem = {
                    id: `ann-${Date.now()}`,
                    pageNumber: currentPage,
                    tool: 'text_note',
                    color: activeColor,
                    strokeWidth: 2,
                    x: 0.12,
                    y: 0.14 + (currentPageAnnotations.length % 5) * 0.12,
                    width: 0.3,
                    height: 0.08,
                    text: `Important note on Page ${currentPage}`,
                    createdAt: new Date().toISOString()
                  };
                  pushAnnotationState([...annotations, newNote]);
                  setSelectedAnnotationId(newNote.id);
                }}
                data-testid="pdf-quick-add-note-btn"
                className="w-full py-2.5 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Type className="w-3.5 h-3.5" />
                + Add Note to Page {currentPage}
              </button>
            )}

            <div className="space-y-2">
              {annotations.length === 0 ? (
                <div className="p-6 text-center rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
                  No annotations yet. Select a tool above or highlight text on the page to begin.
                </div>
              ) : (
                annotations.map((ann) => {
                  const cKey = (ann.color in COLOR_MAP ? ann.color : 'yellow') as keyof typeof COLOR_MAP;
                  return (
                    <div
                      key={ann.id}
                      onClick={() => {
                        setCurrentPage(ann.pageNumber);
                        setSelectedAnnotationId(ann.id);
                      }}
                      className={`p-3 rounded-xl border transition-all cursor-pointer ${
                        ann.id === selectedAnnotationId
                          ? 'bg-blue-50/70 border-blue-300'
                          : 'bg-slate-50/70 border-slate-200/80 hover:bg-slate-100/70'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: COLOR_MAP[cKey].hex }}
                          />
                          <span className="text-xs font-bold text-slate-800 capitalize">
                            {ann.tool.replace('_', ' ')}
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            P.{ann.pageNumber}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnnotation(ann.id);
                          }}
                          className="text-slate-400 hover:text-rose-600 p-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {ann.text && (
                        <p className="text-xs text-slate-600 line-clamp-2">{ann.text}</p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
