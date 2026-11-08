import test from 'node:test';
import assert from 'node:assert/strict';
import type { ExtractedPdfResult } from './pdfExtractor';

test('ExtractedPdfResult interface distinguishes scanned vs digital documents', () => {
  const digitalDoc: ExtractedPdfResult = {
    pageCount: 3,
    pages: [
      { pageNumber: 1, title: 'Introduction', content: 'Electrostatics covers Coulomb law in detail with mathematical derivations.' },
      { pageNumber: 2, title: 'Electric Field', content: 'Electric field due to a point charge is given by E = k * q / r^2.' },
      { pageNumber: 3, title: 'Gauss Law', content: 'Surface integral of electric field over a closed surface equals enclosed charge over epsilon0.' }
    ],
    pdfDataUrl: '',
    isScanned: false,
    metadata: {
      format: 'digital',
      charCount: 280,
      cached: false
    }
  };

  assert.equal(digitalDoc.isScanned, false);
  assert.equal(digitalDoc.metadata?.format, 'digital');
  assert.equal(digitalDoc.metadata?.cached, false);

  const scannedDoc: ExtractedPdfResult = {
    pageCount: 2,
    pages: [
      { pageNumber: 1, title: 'Page 1', content: '[Visual diagram]' },
      { pageNumber: 2, title: 'Page 2', content: '[Handwritten diagram]' }
    ],
    pdfDataUrl: '',
    isScanned: true,
    metadata: {
      format: 'scanned',
      charCount: 38,
      cached: true
    }
  };

  assert.equal(scannedDoc.isScanned, true);
  assert.equal(scannedDoc.metadata?.format, 'scanned');
  assert.equal(scannedDoc.metadata?.cached, true);
});
