import type { Express, Request, Response } from 'express';
import {
  approveQuestionContent,
  revokeQuestionApproval,
} from './contentApprovalService.ts';
import type {
  ApprovalRecordRepository,
  AuthoritativeContentRepository,
  ContentSigningService,
  ReviewerAuthority,
} from './types.ts';

export interface ContentApprovalRouteDeps {
  authority: ReviewerAuthority;
  contentRepository: AuthoritativeContentRepository;
  approvalRepository: ApprovalRecordRepository;
  signingService: ContentSigningService;
}

/**
 * Registers the server-side content approval and revocation route handlers.
 * Mounted at:
 *   POST /api/content/review/approve
 *   POST /api/content/review/revoke
 */
export function registerContentApprovalRoutes(
  app: Express,
  deps: ContentApprovalRouteDeps
): void {
  app.post('/api/content/review/approve', async (req: Request, res: Response) => {
    try {
      const outcome = await approveQuestionContent(
        req.body,
        req.authUser,
        deps.authority,
        deps.contentRepository,
        deps.approvalRepository,
        deps.signingService
      );

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        approvalRecord: outcome.approvalRecord,
        isDuplicate: outcome.isDuplicate,
        message: outcome.message,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error processing approval.',
        code: 'internal_approval_error',
      });
    }
  });

  app.post('/api/content/review/revoke', async (req: Request, res: Response) => {
    try {
      const outcome = await revokeQuestionApproval(
        req.body,
        req.authUser,
        deps.authority,
        deps.approvalRepository
      );

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        approvalRecord: outcome.approvalRecord,
        message: outcome.message,
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error processing revocation.',
        code: 'internal_revocation_error',
      });
    }
  });
}
