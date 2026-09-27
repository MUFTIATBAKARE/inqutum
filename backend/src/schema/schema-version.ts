/**
 * Schema versioning for Quittance records.
 *
 * Every record emitted by the API carries a `_schemaVersion` field so clients
 * and migration tooling can distinguish shapes across releases. Records
 * persisted before versioning was introduced are treated as version "0" and
 * upgraded on read through the compatibility layer.
 */

export const CURRENT_SCHEMA_VERSION = '1.0';

export type SchemaVersion = string;

export type VersionedRecord<T> = T & { _schemaVersion: SchemaVersion };

/**
 * Stamp an arbitrary record with the current schema version.
 * If the record already carries a `_schemaVersion` it is overwritten to the
 * current version (caller is responsible for any migration before calling).
 */
export function versionStamp<T extends Record<string, unknown>>(record: T): VersionedRecord<T> {
  return { ...record, _schemaVersion: CURRENT_SCHEMA_VERSION };
}

/**
 * Returns true when the record was persisted before schema versioning existed.
 */
export function isLegacyRecord(record: Record<string, unknown>): boolean {
  return record._schemaVersion === undefined || record._schemaVersion === null;
}
