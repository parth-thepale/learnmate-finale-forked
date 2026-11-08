import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import type { BrainTeaserSet, BrainTeaserQuestion } from '../data/brainTeasersData';
import { normalizePdfText, wrapPdfTextLines, triggerPdfDownload } from './pdfGenerator';

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 48;
const CONTENT_WIDTH = A4_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;

const COLOR_PRIMARY = rgb(0.784, 0.267, 0.157); // #C84428 terracotta
const COLOR_INK = rgb(0.12, 0.12, 0.14); // #1E1E24
const COLOR_MUTED = rgb(0.45, 0.45, 0.48); // #73737A
const COLOR_BORDER = rgb(0.85, 0.82, 0.78); // #D9D1C7
const COLOR_BG_PANEL = rgb(0.97, 0.96, 0.94); // #F8F5F0

interface PdfContext {
  doc: PDFDocument;
  fontRegular: PDFFont;
  fontBold: PDFFont;
  pages: PDFPage[];
  currentPage: PDFPage;
  cursorY: number;
}

function checkPageSpace(ctx: PdfContext, requiredSpace: number): void {
  if (ctx.cursorY - requiredSpace < 55) {
    const newPage = ctx.doc.addPage([A4_WIDTH, A4_HEIGHT]);
    ctx.pages.push(newPage);
    ctx.currentPage = newPage;
    ctx.cursorY = A4_HEIGHT - 50;
  }
}

/**
 * Compiles a BrainTeaserSet into a real, formatted multi-page PDF document.
 */
export async function generateBrainTeaserPdfBytes(set: BrainTeaserSet): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(`Learnmate Brain Teaser Set ${set.setNumber} — ${set.title}`);
  pdfDoc.setAuthor('Learnmate Academic Engineering Panel');
  pdfDoc.setSubject(`JEE Main 2026 Advanced Practice — ${set.title}`);

  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const initialPage = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
  const ctx: PdfContext = {
    doc: pdfDoc,
    fontRegular,
    fontBold,
    pages: [initialPage],
    currentPage: initialPage,
    cursorY: A4_HEIGHT - 45,
  };

  // -------------------------------------------------------------------------
  // 1. HEADER BANNER
  // -------------------------------------------------------------------------
  ctx.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.cursorY - 80,
    width: CONTENT_WIDTH,
    height: 80,
    color: COLOR_BG_PANEL,
    borderColor: COLOR_BORDER,
    borderWidth: 1,
  });

  // Top accent bar
  ctx.currentPage.drawRectangle({
    x: MARGIN_LEFT,
    y: ctx.cursorY - 4,
    width: CONTENT_WIDTH,
    height: 4,
    color: COLOR_PRIMARY,
  });

  ctx.currentPage.drawText(
    normalizePdfText(`LEARNMATE JEE (MAIN) 2026 • BRAIN TEASER SERIES — SET ${set.setNumber}`),
    {
      x: MARGIN_LEFT + 14,
      y: ctx.cursorY - 22,
      size: 9,
      font: ctx.fontBold,
      color: COLOR_PRIMARY,
    }
  );

  ctx.currentPage.drawText(normalizePdfText(set.title), {
    x: MARGIN_LEFT + 14,
    y: ctx.cursorY - 42,
    size: 14,
    font: ctx.fontBold,
    color: COLOR_INK,
  });

  ctx.currentPage.drawText(
    normalizePdfText(
      `18 Questions | Max Marks: 72 (+4 / -1) | Duration: 60 mins | Curriculum: NTA JEE Main 2026`
    ),
    {
      x: MARGIN_LEFT + 14,
      y: ctx.cursorY - 62,
      size: 8.5,
      font: ctx.fontRegular,
      color: COLOR_MUTED,
    }
  );

  ctx.cursorY -= 95;

  // -------------------------------------------------------------------------
  // 2. INSTRUCTIONS BLOCK
  // -------------------------------------------------------------------------
  ctx.currentPage.drawText(normalizePdfText('EXAM INSTRUCTIONS & PROVENANCE:'), {
    x: MARGIN_LEFT,
    y: ctx.cursorY,
    size: 8.5,
    font: ctx.fontBold,
    color: COLOR_INK,
  });
  ctx.cursorY -= 14;

  const instructions = [
    '1. This set contains 18 high-yield conceptual and numerical problems formulated for JEE Main level mastery.',
    '2. Each question has exactly one correct choice. Marking scheme: +4 for correct answer, -1 for incorrect answer.',
    '3. Plausible distractors represent common algebraic and conceptual pitfalls. Check boundary constraints and SI units.',
    '4. Section II contains the complete Answer Key; Section III contains step-by-step mathematical reasoning for every question.',
  ];

  for (const inst of instructions) {
    ctx.currentPage.drawText(normalizePdfText(inst), {
      x: MARGIN_LEFT + 8,
      y: ctx.cursorY,
      size: 8,
      font: ctx.fontRegular,
      color: COLOR_MUTED,
    });
    ctx.cursorY -= 12;
  }

  ctx.cursorY -= 8;

  // -------------------------------------------------------------------------
  // 3. SECTION I: QUESTIONS
  // -------------------------------------------------------------------------
  checkPageSpace(ctx, 40);
  ctx.currentPage.drawText(normalizePdfText('SECTION I: QUESTIONS (1 TO 18)'), {
    x: MARGIN_LEFT,
    y: ctx.cursorY,
    size: 11,
    font: ctx.fontBold,
    color: COLOR_PRIMARY,
  });

  ctx.currentPage.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.cursorY - 4 },
    end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: ctx.cursorY - 4 },
    thickness: 1,
    color: COLOR_PRIMARY,
  });
  ctx.cursorY -= 18;

  for (const q of set.questions) {
    // Estimate space needed for question
    checkPageSpace(ctx, 85);

    // Question header line (Q.1 • Topic)
    ctx.currentPage.drawText(
      normalizePdfText(`Question ${q.questionNumber} [${q.subject} • ${q.topic}]`),
      {
        x: MARGIN_LEFT,
        y: ctx.cursorY,
        size: 9,
        font: ctx.fontBold,
        color: COLOR_INK,
      }
    );
    ctx.cursorY -= 13;

    // Stem
    const stemLines = wrapPdfTextLines(q.stem, ctx.fontRegular, 8.5, CONTENT_WIDTH);
    for (const line of stemLines) {
      checkPageSpace(ctx, 12);
      ctx.currentPage.drawText(line, {
        x: MARGIN_LEFT,
        y: ctx.cursorY,
        size: 8.5,
        font: ctx.fontRegular,
        color: COLOR_INK,
      });
      ctx.cursorY -= 11.5;
    }

    ctx.cursorY -= 3;

    // Options (A), (B), (C), (D)
    const optionLabels = ['(A)', '(B)', '(C)', '(D)'];
    for (let optIdx = 0; optIdx < 4; optIdx++) {
      checkPageSpace(ctx, 14);
      const optText = `${optionLabels[optIdx]} ${q.options[optIdx]}`;
      const optLines = wrapPdfTextLines(optText, ctx.fontRegular, 8, CONTENT_WIDTH - 14);
      for (const line of optLines) {
        checkPageSpace(ctx, 11);
        ctx.currentPage.drawText(line, {
          x: MARGIN_LEFT + 10,
          y: ctx.cursorY,
          size: 8,
          font: ctx.fontRegular,
          color: COLOR_INK,
        });
        ctx.cursorY -= 11;
      }
    }

    // Divider
    ctx.cursorY -= 4;
    ctx.currentPage.drawLine({
      start: { x: MARGIN_LEFT, y: ctx.cursorY },
      end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: ctx.cursorY },
      thickness: 0.5,
      color: COLOR_BORDER,
    });
    ctx.cursorY -= 12;
  }

  // -------------------------------------------------------------------------
  // 4. SECTION II: ANSWER KEY
  // -------------------------------------------------------------------------
  checkPageSpace(ctx, 100);
  ctx.cursorY -= 10;
  ctx.currentPage.drawText(normalizePdfText('SECTION II: OFFICIAL ANSWER KEY'), {
    x: MARGIN_LEFT,
    y: ctx.cursorY,
    size: 11,
    font: ctx.fontBold,
    color: COLOR_PRIMARY,
  });

  ctx.currentPage.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.cursorY - 4 },
    end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: ctx.cursorY - 4 },
    thickness: 1,
    color: COLOR_PRIMARY,
  });
  ctx.cursorY -= 20;

  // Render answer key table (6 columns x 3 rows)
  const optionLetters = ['A', 'B', 'C', 'D'];
  const colWidth = CONTENT_WIDTH / 6;
  const rowHeight = 18;

  for (let r = 0; r < 3; r++) {
    checkPageSpace(ctx, rowHeight + 4);
    for (let c = 0; c < 6; c++) {
      const qNum = r * 6 + c + 1;
      const question = set.questions[qNum - 1];
      const correctLetter = question ? optionLetters[question.correctOptionIndex] : '-';
      const cellX = MARGIN_LEFT + c * colWidth;

      ctx.currentPage.drawRectangle({
        x: cellX,
        y: ctx.cursorY - rowHeight,
        width: colWidth,
        height: rowHeight,
        color: COLOR_BG_PANEL,
        borderColor: COLOR_BORDER,
        borderWidth: 0.5,
      });

      ctx.currentPage.drawText(normalizePdfText(`Q${qNum}: ${correctLetter}`), {
        x: cellX + 10,
        y: ctx.cursorY - 12,
        size: 8.5,
        font: ctx.fontBold,
        color: COLOR_INK,
      });
    }
    ctx.cursorY -= rowHeight;
  }

  ctx.cursorY -= 16;

  // -------------------------------------------------------------------------
  // 5. SECTION III: DETAILED STEP-BY-STEP SOLUTIONS
  // -------------------------------------------------------------------------
  checkPageSpace(ctx, 40);
  ctx.currentPage.drawText(
    normalizePdfText('SECTION III: DETAILED STEP-BY-STEP SOLUTIONS & FORMULAS'),
    {
      x: MARGIN_LEFT,
      y: ctx.cursorY,
      size: 11,
      font: ctx.fontBold,
      color: COLOR_PRIMARY,
    }
  );

  ctx.currentPage.drawLine({
    start: { x: MARGIN_LEFT, y: ctx.cursorY - 4 },
    end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: ctx.cursorY - 4 },
    thickness: 1,
    color: COLOR_PRIMARY,
  });
  ctx.cursorY -= 18;

  for (const q of set.questions) {
    checkPageSpace(ctx, 60);

    const correctAnsLetter = optionLetters[q.correctOptionIndex];
    ctx.currentPage.drawText(
      normalizePdfText(
        `Q${q.questionNumber} Solution — Correct Option: (${correctAnsLetter}) [${q.topic}]`
      ),
      {
        x: MARGIN_LEFT,
        y: ctx.cursorY,
        size: 8.5,
        font: ctx.fontBold,
        color: COLOR_PRIMARY,
      }
    );
    ctx.cursorY -= 12;

    if (q.formulaReference) {
      checkPageSpace(ctx, 14);
      ctx.currentPage.drawText(
        normalizePdfText(`Governing Relation: ${q.formulaReference}`),
        {
          x: MARGIN_LEFT,
          y: ctx.cursorY,
          size: 7.5,
          font: ctx.fontBold,
          color: COLOR_MUTED,
        }
      );
      ctx.cursorY -= 11;
    }

    const explLines = wrapPdfTextLines(q.explanation, ctx.fontRegular, 8, CONTENT_WIDTH);
    for (const line of explLines) {
      checkPageSpace(ctx, 11);
      ctx.currentPage.drawText(line, {
        x: MARGIN_LEFT,
        y: ctx.cursorY,
        size: 8,
        font: ctx.fontRegular,
        color: COLOR_INK,
      });
      ctx.cursorY -= 10.5;
    }

    ctx.cursorY -= 8;
  }

  // -------------------------------------------------------------------------
  // 6. FOOTER ON ALL PAGES
  // -------------------------------------------------------------------------
  const totalPages = ctx.pages.length;
  for (let idx = 0; idx < totalPages; idx++) {
    const page = ctx.pages[idx];
    page.drawLine({
      start: { x: MARGIN_LEFT, y: 35 },
      end: { x: MARGIN_LEFT + CONTENT_WIDTH, y: 35 },
      thickness: 0.5,
      color: COLOR_BORDER,
    });

    page.drawText(
      normalizePdfText(
        `Learnmate JEE Main Brain Teaser Series • Set ${set.setNumber} • Page ${idx + 1} of ${totalPages}`
      ),
      {
        x: MARGIN_LEFT,
        y: 22,
        size: 7.5,
        font: fontRegular,
        color: COLOR_MUTED,
      }
    );

    page.drawText(normalizePdfText('Confidential Study Material • Not Official PYQ'), {
      x: A4_WIDTH - MARGIN_RIGHT - 180,
      y: 22,
      size: 7.5,
      font: fontRegular,
      color: COLOR_MUTED,
    });
  }

  return pdfDoc.save();
}

import { getBrainTeaserSet } from '../data/brainTeasersData';

/**
 * Downloads a generated Brain Teaser set PDF directly in the browser.
 */
export async function downloadBrainTeaserPdf(setOrSetNumber: BrainTeaserSet | 1 | 2 | 3): Promise<void> {
  const targetSet =
    typeof setOrSetNumber === 'number' ? getBrainTeaserSet(setOrSetNumber) : setOrSetNumber;
  if (!targetSet) {
    throw new Error(`Brain teaser set ${String(setOrSetNumber)} not found.`);
  }
  const bytes = await generateBrainTeaserPdfBytes(targetSet);
  triggerPdfDownload(bytes, `Learnmate_Brain_Teaser_Set_${targetSet.setNumber}_${targetSet.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
}
