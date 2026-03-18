/**
 * Centralized store initialization provider.
 *
 * Reads GHOSTCLAW_STORAGE_MODE ('memory' | 'sqlite') and GHOSTCLAW_SQLITE_PATH
 * from the environment and calls the storage factory to create all stores.
 *
 * After creation, the provider replaces the module-level singleton exports in
 * each domain module so that every existing `import { fooStore }` transparently
 * resolves to the factory-created instance.  In CJS (which this project uses),
 * named imports compile to property reads on the shared module exports object,
 * so mutating `exports.fooStore` is seen by all consumers on next access.
 *
 * Call `initializeStores()` once at application startup, before any route
 * handlers or event-bus subscribers access the stores.
 */

import { createStores, type StoreBundle } from './storage/storage_factory';
import type { StorageConfig } from './storage/storage_config';

let _stores: StoreBundle | null = null;

/**
 * Initialise all runtime stores according to the provided (or env-derived)
 * configuration and replace the module-level singletons so every consumer
 * uses the same backing store.
 */
export function initializeStores(config?: StorageConfig): StoreBundle {
  const resolvedConfig: StorageConfig = config ?? {
    mode: (process.env.GHOSTCLAW_STORAGE_MODE as 'memory' | 'sqlite') || 'memory',
    sqlitePath: process.env.GHOSTCLAW_SQLITE_PATH,
  };

  if (resolvedConfig.mode === 'sqlite' && !resolvedConfig.sqlitePath) {
    throw new Error(
      'GHOSTCLAW_SQLITE_PATH must be set when GHOSTCLAW_STORAGE_MODE is "sqlite".',
    );
  }

  _stores = createStores(resolvedConfig);

  // ── Replace module-level singleton exports ────────────────────────────────
  // Each domain module exports a const singleton (e.g. `export const jobQueue`).
  // In CJS, `import { jobQueue } from './job_queue'` compiles to property
  // access on the module's exports object, so overwriting that property here
  // is visible to all existing importers on their next access.
  //
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const r = require;

  const jobQueueModule = r('./job_queue');
  jobQueueModule.jobQueue = _stores.jobStore;

  const skillInvocationModule = r('./skill_invocation');
  skillInvocationModule.skillInvocationStore = _stores.skillInvocationStore;

  const assignmentModule = r('./assignment');
  assignmentModule.assignmentStore = _stores.assignmentStore;

  const publishEventModule = r('./publish_event');
  publishEventModule.publishEventStore = _stores.publishEventStore;

  const auditLogModule = r('./audit_log');
  auditLogModule.auditLog = _stores.auditLogStore;

  const workspacePolicyModule = r('./workspace_policy');
  workspacePolicyModule.workspacePolicyStore = _stores.workspacePolicyStore;

  const runtimeEventLogModule = r('./runtime_event_log');
  runtimeEventLogModule.runtimeEventLog = _stores.runtimeEventLogStore;

  console.log(
    `[GhostClaw] Stores initialized in "${resolvedConfig.mode}" mode` +
      (resolvedConfig.sqlitePath ? ` (${resolvedConfig.sqlitePath})` : '') +
      '.',
  );

  return _stores;
}

/**
 * Returns the current StoreBundle if `initializeStores()` has been called,
 * or `null` otherwise.  This avoids a lazy `initializeStores()` call that
 * would replace singletons at an unpredictable time (e.g. mid-test).
 */
export function getStores(): StoreBundle | null {
  return _stores;
}
