import { Router } from 'express';
import { processSignal, runtimeStore } from '../../../../packages/core/src/runtime_loop';
import { skillInvocationStore } from '../../../../packages/core/src/skill_invocation';

const router = Router();

router.post('/', (req, res) => {
  const name = req.body?.name;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Signal "name" is required.' });
    return;
  }

  try {
    const result = processSignal({
      name,
      payload: req.body?.payload,
    });

    res.status(201).json({
      message: 'Signal processed.',
      ...result,
      storeCounts: {
        signals: runtimeStore.signals.length,
        plans: runtimeStore.plans.length,
        jobs: runtimeStore.jobs.length,
        artifacts: runtimeStore.artifacts.length,
        skillInvocations: skillInvocationStore.listAll().length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process signal.';
    res.status(422).json({ error: message });
  }
});

export default router;
