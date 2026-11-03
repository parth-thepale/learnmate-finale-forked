import type { SourceDefinition } from './types';

/**
 * Registry of question sources. A source can only be fetched from or imported when its legal /
 * reuse review allows it. Adding a website means adding a reviewed entry here plus an adapter —
 * never hard-coding URLs elsewhere.
 */
export const SOURCE_REGISTRY: readonly SourceDefinition[] = Object.freeze([
  {
    id: 'manual-upload',
    name: 'Manually supplied PDF paper',
    kind: 'manual_upload',
    owner: 'Supplied by a Learnmate administrator',
    allowedHosts: [],
    reuse: {
      status: 'declared_per_import',
      summary:
        'The administrator must declare the licence basis (own content, NTA permission or licence) for every import. Undeclared or unverified content can be staged as drafts but never verified.',
    },
    robots: { summary: 'Not applicable (no network access).' },
    formats: ['PDF with a text layer (questions numbered 1., Q1, Question 1; options (A)–(D), (a)–(d) or (1)–(4))', 'Answer key as CSV/TXT'],
    fetchEnabled: false,
    importEnabled: true,
    retainSourceFiles: false,
    adapterId: 'manual-pdf',
  },
  {
    id: 'nta-jee-main',
    name: 'National Testing Agency — JEE (Main) official papers and final answer keys',
    kind: 'official_paper',
    owner: 'National Testing Agency (Government of India); hosted by NIC (s3waas)',
    allowedHosts: ['jeemain.nta.nic.in', 'nta.ac.in', 'www.nta.ac.in', 'cdnbbsr.s3waas.gov.in'],
    termsUrl: 'https://jeemain.nta.nic.in/copyright-policy/',
    reuse: {
      status: 'permission_required',
      reviewedOn: '2026-11-03',
      summary:
        'NTA copyright policy: material "may be reproduced free of charge after taking proper permission from National Testing Agency (NTA)", must be reproduced accurately, not used misleadingly, and the source must be prominently acknowledged. No permission is on record, so fetching and importing are disabled.',
    },
    robots: {
      checkedOn: '2026-11-03',
      summary: 'jeemain.nta.nic.in robots.txt disallows only /wp-admin/. cdnbbsr.s3waas.gov.in serves no robots.txt (404). nta.ac.in returned 404 for robots.txt; one request timed out during review.',
    },
    formats: [
      'Question paper PDF (e.g. "B Tech 2nd Apr 2026 Shift 1"): question number, question id, type (MCQ/SA) and option ids are text; question stems, options and figures are embedded images (OCR or manual transcription required).',
      'Final answer key PDF: question id → correct answer table per exam date/shift/subject. Session 1 (Feb 2026) lists option number or numerical value with Domestic/International columns; Session 2 (Apr 2026) lists correct option ids. Layout-aware (column) parsing is required.',
    ],
    fetchEnabled: false,
    importEnabled: false,
    retainSourceFiles: false,
    adapterId: 'nta-jee-main',
    notes: 'Adapter intentionally not implemented until written NTA permission is obtained and recorded here.',
  },
]);

export type SourceLookup = (id: string) => SourceDefinition | undefined;

export function getSource(id: string): SourceDefinition | undefined {
  return SOURCE_REGISTRY.find((s) => s.id === id);
}

export class SourceNotPermittedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceNotPermittedError';
  }
}

/** Throws unless the source exists and allows the requested operation. */
export function assertSourceAllows(sourceId: string, operation: 'fetch' | 'import', lookup: SourceLookup = getSource): SourceDefinition {
  const source = lookup(sourceId);
  if (!source) throw new SourceNotPermittedError(`Unknown source "${sourceId}".`);
  if (source.reuse.status === 'prohibited' || source.reuse.status === 'not_reviewed') {
    throw new SourceNotPermittedError(`Source "${sourceId}" has not been cleared for use (${source.reuse.status}).`);
  }
  if (operation === 'fetch' && source.allowedHosts.length === 0) {
    throw new SourceNotPermittedError(`"${sourceId}" is a local-file source; it has nothing to fetch or discover.`);
  }
  if (operation === 'fetch' && !source.fetchEnabled) {
    throw new SourceNotPermittedError(`Fetching from "${sourceId}" is disabled: ${source.reuse.summary}`);
  }
  if (operation === 'import' && !source.importEnabled) {
    throw new SourceNotPermittedError(`Importing from "${sourceId}" is disabled: ${source.reuse.summary}`);
  }
  return source;
}
