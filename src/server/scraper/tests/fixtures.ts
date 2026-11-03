import { createHash } from 'crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { SourceDefinition, SourceDocument } from '../types';

/** A line of text, or a 40x40 image (to simulate a figure) at that position. */
export type FixtureLine = string | { image: true };

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Builds a text-layer PDF (Helvetica, WinAnsi text) with one entry per line, top to bottom. */
export async function makePdf(pages: FixtureLine[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const png = await doc.embedPng(PNG_1X1);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const line of lines) {
      if (typeof line === 'string') {
        page.drawText(line, { x: 50, y, size: 11, font });
        y -= 18;
      } else {
        page.drawImage(png, { x: 60, y: y - 36, width: 40, height: 40 });
        y -= 50;
      }
    }
  }
  return doc.save();
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function documentFrom(bytes: Uint8Array, contentType: SourceDocument['contentType'], fileName: string): SourceDocument {
  return {
    sourceId: 'manual-upload',
    fileName,
    bytes,
    sha256: sha256(bytes),
    retrievedAt: '2026-11-03T10:00:00.000Z',
    contentType,
  };
}

export function textDocument(text: string, fileName = 'key.csv'): SourceDocument {
  return documentFrom(new TextEncoder().encode(text), 'text/csv', fileName);
}

/** Sample paper covering inline/line options, numeric option labels, a figure, 3 options,
 * a numerical section, a stem line that starts with "2.5" and a numbering gap (Q7 missing). */
export const SAMPLE_PAPER: FixtureLine[][] = [
  [
    'PHYSICS - SECTION A',
    '1. A block slides down a smooth incline from rest.',
    '2.5 kg is the mass of the block. Find its speed after 1 s.',
    '(A) 2 m/s (B) 4 m/s (C) 6 m/s (D) 8 m/s',
    '2. Which quantity is a vector?',
    '(A) Speed',
    '(B) Mass',
    '(C) Velocity',
    '(D) Energy',
    '3. The figure shows a circuit. Find the current.',
    { image: true },
    '(A) 1 A',
    '(B) 2 A',
    '(C) 3 A',
    '(D) 4 A',
    '4. A question printed with three options only.',
    '(A) one',
    '(B) two',
    '(C) three',
    'PHYSICS - SECTION B',
    '5. Find the number of moles, to the nearest integer.',
  ],
  [
    'MATHEMATICS - SECTION A',
    '6. If x + 2 = 5, then x equals',
    '(1) 1',
    '(2) 2',
    '(3) 3',
    '(4) 4',
    '8. The value of 2 + 2 is',
    '(a) 3',
    '(b) 4',
    '(c) 5',
    '(d) 6',
  ],
];

export const SAMPLE_KEY_CSV = 'question,answer\n1,B\n2,C\n3,A|B\n4,A\n5,12\n6,C\n8,DROPPED\n9,A\n';

export function testSource(overrides: Partial<SourceDefinition> = {}): SourceDefinition {
  return {
    id: 'test-source',
    name: 'Test source',
    kind: 'third_party_pyq',
    owner: 'Test',
    allowedHosts: ['papers.example.org', 'cdn.example.org'],
    reuse: { status: 'permission_granted', summary: 'test', permissionReference: 'TEST' },
    robots: { summary: 'test' },
    formats: [],
    fetchEnabled: true,
    importEnabled: true,
    retainSourceFiles: false,
    adapterId: 'manual-pdf',
    ...overrides,
  };
}
