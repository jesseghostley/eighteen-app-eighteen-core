import { Router } from 'express';
import {
  getAgentStatus,
  getArtifactStatus,
  getPlannerStrategyStatus,
  getQueueStatus,
  getRuntimeStatus,
} from '../../../../packages/core/src/runtime_monitor';

const router = Router();

router.get('/status', (_req, res) => {
  res.json(getRuntimeStatus());
});

router.get('/queue', (_req, res) => {
  res.json(getQueueStatus());
});

router.get('/agents', (_req, res) => {
  res.json(getAgentStatus());
});

router.get('/artifacts', (_req, res) => {
  res.json(getArtifactStatus());
});

router.get('/planner-strategies', (_req, res) => {
  res.json(getPlannerStrategyStatus());
});

export default router;
