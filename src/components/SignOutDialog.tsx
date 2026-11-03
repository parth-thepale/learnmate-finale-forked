import React, { useEffect, useRef, useState } from 'react';
import type { SignOutChoice, SignOutSummary } from '../services/signOutFlow';

interface SignOutDialogProps {
  summary: SignOutSummary;
  busy: boolean;
  error: string | null;
  onChoose: (choice: SignOutChoice) => void;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function deviceOnlyLines(summary: SignOutSummary): string[] {
  const d = summary.deviceOnly;
  const lines: string[] = [];
  if (d.studySessions > 0) lines.push(plural(d.studySessions, 'study session', 'study sessions'));
  if (d.notebookEntries > 0) lines.push(plural(d.notebookEntries, 'notebook entry', 'notebook entries'));
  if (d.plannerTasks > 0) lines.push(plural(d.plannerTasks, 'planner task', 'planner tasks'));
  if (d.annotatedDocuments > 0) lines.push(plural(d.annotatedDocuments, 'annotated PDF', 'annotated PDFs'));
  if (d.focusSessions > 0) lines.push(plural(d.focusSessions, 'focus timer record', 'focus timer records'));
  if (d.creativeAssets > 0) lines.push(plural(d.creativeAssets, 'saved creation', 'saved creations'));
  return lines;
}

/** Explicit sign-out: keep (default), remove (with a second confirmation) or cancel. */
export const SignOutDialog: React.FC<SignOutDialogProps> = ({ summary, busy, error, onChoose }) => {
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const localItems = deviceOnlyLines(summary);
  const hasLocalOnly = summary.unsyncedChanges > 0 || summary.deviceOnlyTotal > 0;

  useEffect(() => {
    (confirmingRemove ? backRef : keepRef).current?.focus();
  }, [confirmingRemove]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return;
      e.preventDefault();
      if (confirmingRemove) setConfirmingRemove(false);
      else onChoose('cancel');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, confirmingRemove, onChoose]);

  const button = 'px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed inset-0 z-[60] bg-[#121827]/40 backdrop-blur-xs flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sign-out-title"
      aria-describedby="sign-out-description"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-[#E8E6E2] w-full max-w-md overflow-hidden">
        <div className="px-6 pt-5 pb-2">
          <h2 id="sign-out-title" className="font-serif-editorial text-lg font-bold text-[#121827]">
            {confirmingRemove ? 'Remove your data from this device?' : 'Sign out'}
          </h2>
        </div>

        {!confirmingRemove ? (
          <div className="px-6 pb-6 space-y-4">
            <div id="sign-out-description" className="text-sm text-[#3A4352] space-y-2">
              <p>Choose what happens to this account’s study data on this device.</p>
              {hasLocalOnly && (
                <ul className="list-disc pl-5 text-[#606B7C]">
                  {summary.unsyncedChanges > 0 && (
                    <li>{plural(summary.unsyncedChanges, 'change is', 'changes are')} not saved to your account yet</li>
                  )}
                  {localItems.length > 0 && <li>Saved only on this device: {localItems.join(', ')}</li>}
                </ul>
              )}
            </div>

            <div className="space-y-2">
              <button
                ref={keepRef}
                type="button"
                disabled={busy}
                onClick={() => onChoose('keep')}
                className={`${button} w-full bg-[#121827] text-white hover:bg-[#2A3140] text-left`}
              >
                Keep on this device <span className="font-normal text-white/70">(recommended)</span>
                <span className="block text-xs font-normal text-white/80 mt-0.5">
                  It appears again only when you sign in to this account here. It stays stored in this browser
                  profile, so anyone using this profile could read it with browser tools. On a shared computer,
                  choose Remove.
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingRemove(true)}
                className={`${button} w-full border border-[#E8E6E2] text-[#9B2C1A] hover:bg-[#FCF3F1] text-left`}
              >
                Remove from this device
                <span className="block text-xs font-normal text-[#606B7C] mt-0.5">
                  Deletes this account’s data stored on this device. You will be asked to confirm.
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose('cancel')}
                className={`${button} w-full text-[#606B7C] hover:text-[#121827] hover:bg-[#F7F5F0]`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-4">
            <div id="sign-out-description" className="text-sm text-[#3A4352] space-y-2">
              <p className="font-semibold text-[#9B2C1A]">This permanently deletes this account’s data stored on this device.</p>
              <ul className="list-disc pl-5 text-[#606B7C]">
                {summary.unsyncedChanges > 0 && (
                  <li>{plural(summary.unsyncedChanges, 'change that is', 'changes that are')} not saved to your account will be lost.</li>
                )}
                {localItems.length > 0 && <li>Lost for good (saved only here): {localItems.join(', ')}.</li>}
                <li>Documents, quiz attempts and study history already saved to your account are not affected and return when you sign in again.</li>
              </ul>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <button
                ref={backRef}
                type="button"
                disabled={busy}
                onClick={() => setConfirmingRemove(false)}
                className={`${button} border border-[#E8E6E2] text-[#121827] hover:bg-[#F7F5F0]`}
              >
                Back
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onChoose('remove')}
                className={`${button} bg-[#9B2C1A] text-white hover:bg-[#7E2314]`}
              >
                Delete and sign out
              </button>
            </div>
          </div>
        )}

        {(busy || error) && (
          <p role="status" className={`px-6 pb-4 text-xs ${error ? 'text-[#9B2C1A]' : 'text-[#606B7C]'}`}>
            {error ? `Sign-out failed: ${error} Nothing was deleted.` : 'Signing out…'}
          </p>
        )}
      </div>
    </div>
  );
};
