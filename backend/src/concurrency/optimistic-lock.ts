/**
 * Optimistic concurrency control for invoice state transitions.
 *
 * Each invoice carries a `version` counter that increments on every write.
 * Clients pass the expected version; if another session has written in the
 * meantime the version will not match and a ConflictError is thrown.
 *
 * Old clients that do not send a version are allowed through (backward compat).
 */

export class ConflictError extends Error {
  readonly code = 'CONFLICT' as const;
  readonly currentVersion: number;
  readonly attemptedVersion: number;

  constructor(currentVersion: number, attemptedVersion: number) {
    super(
      `Invoice was modified by another session (current version: ${currentVersion}, attempted: ${attemptedVersion}). Please refresh and try again.`
    );
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
    this.attemptedVersion = attemptedVersion;
  }
}

/**
 * Compare the expected version with the actual version.
 *
 * - If `expected` is undefined (old client), the check is skipped.
 * - If the versions match, the check passes silently.
 * - If they differ, a ConflictError is thrown.
 */
export function checkVersion(expected: number | undefined, actual: number): void {
  if (expected === undefined) return;
  if (expected !== actual) {
    throw new ConflictError(actual, expected);
  }
}
