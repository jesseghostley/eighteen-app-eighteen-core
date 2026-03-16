import { Router } from 'express';
import { skillInvocationStore } from '../../../../packages/core/src/skill_invocation';

const router = Router();

router.get('/:id/skill-invocations', (req, res) => {
  const invocations = skillInvocationStore.listByJobId(req.params.id);
  res.json(invocations);
});

export default router;
