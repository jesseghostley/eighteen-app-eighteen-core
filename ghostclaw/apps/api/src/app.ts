import express from 'express';
import { initializeStores } from '../../../packages/core/src/store_provider';
import runtimeRouter from './routes/runtime';
import signalsRouter from './routes/signals';
import skillInvocationsRouter from './routes/skill_invocations';
import jobsRouter from './routes/jobs';
import runtimeEventsRouter from './routes/runtime_events';
import ghostMartRouter from './routes/ghost_mart';
import { registerRuntimeEventLogSubscribers } from '../../../packages/core/src/runtime_event_log_subscriber';
import { eventBus } from '../../../packages/core/src/event_bus';

// Initialise stores from env config BEFORE any route or subscriber touches them.
// In sqlite mode this creates all tables (signals, plans, jobs, assignments,
// skill_invocations, artifacts, publish_events, audit_log, workspace_policies,
// runtime_event_log) and replaces the in-memory singleton exports with
// SQLite-backed implementations.
initializeStores();

const app = express();

app.use(express.json());

registerRuntimeEventLogSubscribers(eventBus);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'ghostclaw-api' });
});

app.use('/api/signals', signalsRouter);
app.use('/api/runtime', runtimeRouter);
app.use('/api/skill-invocations', skillInvocationsRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/runtime-events', runtimeEventsRouter);
app.use('/api/ghost-mart', ghostMartRouter);

export default app;
