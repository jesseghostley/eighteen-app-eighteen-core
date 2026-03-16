export type StorageMode = 'memory' | 'sqlite';

export type StorageConfig = {
  mode: StorageMode;
  /** Only required when mode === 'sqlite'. */
  sqlitePath?: string;
};
