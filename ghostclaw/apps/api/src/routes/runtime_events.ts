import { Router } from 'express';
import { runtimeEventLog } from '../../../../packages/core/src/runtime_event_log';
import { isReplayable } from '../../../../packages/core/src/replay';

const router = Router();

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * GET /api/runtime-events
 * List recent runtime events with optional filters.
 * Query params: workspace, event_type, job_id, skill_invocation_id, correlation_id, limit
 */
router.get('/', (req, res) => {
  const {
    workspace,
    event_type,
    job_id,
    skill_invocation_id,
    correlation_id,
    limit: limitParam,
  } = req.query;

  let limit = DEFAULT_LIMIT;
  if (typeof limitParam === 'string' && limitParam) {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, MAX_LIMIT);
    }
  }

  // Use the most specific store method when only one filter is provided,
  // otherwise start with listRecent and filter in-memory.
  let events = runtimeEventLog.listRecent(limit);

  if (typeof workspace === 'string' && workspace) {
    events = events.filter((e) => e.workspace_id === workspace);
  }
  if (typeof event_type === 'string' && event_type) {
    events = events.filter((e) => e.event_type === event_type);
  }
  if (typeof job_id === 'string' && job_id) {
    events = events.filter((e) => e.job_id === job_id);
  }
  if (typeof skill_invocation_id === 'string' && skill_invocation_id) {
    events = events.filter((e) => e.skill_invocation_id === skill_invocation_id);
  }
  if (typeof correlation_id === 'string' && correlation_id) {
    events = events.filter((e) => e.correlation_id === correlation_id);
  }

  res.json(events);
});

/**
 * GET /api/runtime-events/by-correlation/:correlationId
 * Get all events in an execution chain ordered chronologically (oldest first).
 * Includes chain_complete and has_failures metadata.
 */
router.get('/by-correlation/:correlationId', (req, res) => {
  const { correlationId } = req.params;

  // listByCorrelationId returns entries in append order (oldest first)
  const events = runtimeEventLog.listByCorrelationId(correlationId);

  const eventTypes = new Set(events.map((e) => e.event_type));
  const hasSignal = eventTypes.has('signal.received');
  const hasTerminal =
    eventTypes.has('artifact.created') ||
    eventTypes.has('publish.completed') ||
    eventTypes.has('skill.invocation.failed');

  const chain_complete = hasSignal && hasTerminal;
  const has_failures = eventTypes.has('skill.invocation.failed');

  res.json({ events, chain_complete, has_failures });
});

/**
 * GET /api/runtime-events/:id
 * Get a single event by event_id. Includes replayable classification.
 */
router.get('/:id', (req, res) => {
  const entry = runtimeEventLog.getById(req.params.id);
  if (!entry) {
    res.status(404).json({ error: 'Runtime event not found.' });
    return;
  }
  res.json({ ...entry, replayable: isReplayable(entry.event_type) });
});

export default router;
