import { Router } from 'express';
import {
  skillInvocationStore,
  type SkillInvocationStatus,
} from '../../../../packages/core/src/skill_invocation';

const router = Router();

const VALID_STATUSES = new Set<string>([
  'pending',
  'running',
  'failed',
  'completed',
  'cancelled',
]);

router.get('/', (req, res) => {
  let invocations = skillInvocationStore.listAll();

  const { status, agent, workspace, skill } = req.query;

  if (typeof status === 'string' && status) {
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `Invalid status value: ${status}` });
      return;
    }
    invocations = invocations.filter(
      (inv) => inv.status === (status as SkillInvocationStatus),
    );
  }

  if (typeof agent === 'string' && agent) {
    invocations = invocations.filter((inv) => inv.agentId === agent);
  }

  if (typeof workspace === 'string' && workspace) {
    invocations = invocations.filter((inv) => inv.workspaceId === workspace);
  }

  if (typeof skill === 'string' && skill) {
    invocations = invocations.filter((inv) => inv.skillId === skill);
  }

  res.json(invocations);
});

router.get('/:id', (req, res) => {
  const invocation = skillInvocationStore.getById(req.params.id);
  if (!invocation) {
    res.status(404).json({ error: 'Skill invocation not found.' });
    return;
  }
  res.json(invocation);
});

export default router;
