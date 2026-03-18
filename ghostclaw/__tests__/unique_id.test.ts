import { uniqueId, ulid } from '../packages/core/src/unique_id';

describe('ulid()', () => {
  it('produces a 26-character Crockford Base32 string', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('is lexicographically sortable by time', () => {
    const id1 = ulid();
    // Advance clock by at least 1ms
    const start = Date.now();
    while (Date.now() === start) { /* spin */ }
    const id2 = ulid();
    expect(id2 > id1).toBe(true);
  });

  it('produces unique IDs even within the same millisecond', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(ulid());
    }
    expect(ids.size).toBe(1000);
  });
});

describe('uniqueId(prefix)', () => {
  it('produces IDs with the correct prefix', () => {
    expect(uniqueId('signal')).toMatch(/^signal_/);
    expect(uniqueId('plan')).toMatch(/^plan_/);
    expect(uniqueId('job')).toMatch(/^job_/);
    expect(uniqueId('artifact')).toMatch(/^artifact_/);
    expect(uniqueId('pub')).toMatch(/^pub_/);
    expect(uniqueId('batch')).toMatch(/^batch_/);
    expect(uniqueId('audit')).toMatch(/^audit_/);
    expect(uniqueId('el')).toMatch(/^el_/);
    expect(uniqueId('assign')).toMatch(/^assign_/);
    expect(uniqueId('inv')).toMatch(/^inv_/);
  });

  it('format is {prefix}_{26-char-ulid}', () => {
    const id = uniqueId('signal');
    const underscoreIdx = id.indexOf('_');
    expect(underscoreIdx).toBe(6); // "signal" is 6 chars
    const ulidPart = id.slice(underscoreIdx + 1);
    expect(ulidPart).toHaveLength(26);
    expect(ulidPart).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('never produces duplicate IDs in 10,000 sequential calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      ids.add(uniqueId('test'));
    }
    expect(ids.size).toBe(10_000);
  });

  it('never produces duplicate IDs across different prefixes', () => {
    const ids = new Set<string>();
    const prefixes = ['signal', 'plan', 'job', 'artifact', 'pub', 'batch', 'audit', 'el', 'assign', 'inv'];
    for (const prefix of prefixes) {
      for (let i = 0; i < 1_000; i++) {
        ids.add(uniqueId(prefix));
      }
    }
    expect(ids.size).toBe(10_000);
  });

  it('produces IDs safe for SQLite TEXT PRIMARY KEY', () => {
    for (let i = 0; i < 100; i++) {
      const id = uniqueId('signal');
      // Only alphanumeric + underscore
      expect(id).toMatch(/^[a-z0-9A-Z_]+$/);
      // prefix(6) + underscore(1) + ulid(26) = 33
      expect(id.length).toBe(33);
    }
  });
});

describe('ID collision safety across simulated restarts', () => {
  it('IDs generated in separate "runs" never collide', () => {
    // Simulate: generate IDs, "restart" (clear all state), generate again
    const run1 = new Set<string>();
    for (let i = 0; i < 500; i++) {
      run1.add(uniqueId('signal'));
      run1.add(uniqueId('job'));
      run1.add(uniqueId('plan'));
      run1.add(uniqueId('artifact'));
      run1.add(uniqueId('audit'));
      run1.add(uniqueId('el'));
    }
    expect(run1.size).toBe(3000);

    // "Restart" — uniqueId has zero state, nothing to clear
    const run2 = new Set<string>();
    for (let i = 0; i < 500; i++) {
      run2.add(uniqueId('signal'));
      run2.add(uniqueId('job'));
      run2.add(uniqueId('plan'));
      run2.add(uniqueId('artifact'));
      run2.add(uniqueId('audit'));
      run2.add(uniqueId('el'));
    }
    expect(run2.size).toBe(3000);

    // Zero overlap between runs
    for (const id of run2) {
      expect(run1.has(id)).toBe(false);
    }
  });

  it('three consecutive "restarts" produce zero collisions across all entity types', () => {
    const allIds = new Set<string>();
    const prefixes = ['signal', 'plan', 'job', 'artifact', 'pub', 'batch', 'audit', 'el', 'assign', 'inv'];
    const runsCount = 3;
    const idsPerPrefixPerRun = 100;

    for (let run = 0; run < runsCount; run++) {
      for (const prefix of prefixes) {
        for (let i = 0; i < idsPerPrefixPerRun; i++) {
          const id = uniqueId(prefix);
          expect(allIds.has(id)).toBe(false);
          allIds.add(id);
        }
      }
    }

    expect(allIds.size).toBe(runsCount * prefixes.length * idsPerPrefixPerRun);
  });
});

describe('signals.id collision regression', () => {
  it('signal IDs are never signal_1, signal_2, etc. (counter-based)', () => {
    for (let i = 0; i < 100; i++) {
      const id = uniqueId('signal');
      // Must NOT match the old counter pattern
      expect(id).not.toMatch(/^signal_\d+$/);
      // Must be prefix + ULID
      expect(id).toMatch(/^signal_[0-9A-HJKMNP-TV-Z]{26}$/);
    }
  });

  it('two batches of 3 signal IDs (simulating two batch submissions) never collide', () => {
    // This is the exact failure scenario: POST batch (3 signals) → restart → POST batch (3 signals)
    const batch1 = [uniqueId('signal'), uniqueId('signal'), uniqueId('signal')];
    const batch2 = [uniqueId('signal'), uniqueId('signal'), uniqueId('signal')];

    const all = [...batch1, ...batch2];
    expect(new Set(all).size).toBe(6);
  });
});
