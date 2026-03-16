import Database from 'better-sqlite3';
import type { IArtifactStore } from '../interfaces/IArtifactStore';
import type { Artifact } from '../../runtime_loop';

export class SqliteArtifactStore implements IArtifactStore {
  private readonly db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        jobId TEXT NOT NULL,
        skillInvocationId TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        workspaceId TEXT,
        contentUri TEXT,
        mimeType TEXT,
        sizeBytes INTEGER,
        checksum TEXT,
        validatedAt INTEGER,
        validationStatus TEXT
      )
    `);
  }

  private rowToArtifact(row: Record<string, unknown>): Artifact {
    const artifact: Artifact = {
      id: row.id as string,
      jobId: row.jobId as string,
      skillInvocationId: row.skillInvocationId as string,
      type: row.type as string,
      content: row.content as string,
      createdAt: row.createdAt as number,
    };

    if (row.workspaceId != null) artifact.workspaceId = row.workspaceId as string;
    if (row.contentUri != null) artifact.contentUri = row.contentUri as string;
    if (row.mimeType != null) artifact.mimeType = row.mimeType as string;
    if (row.sizeBytes != null) artifact.sizeBytes = row.sizeBytes as number;
    if (row.checksum != null) artifact.checksum = row.checksum as string;
    if (row.validatedAt != null) artifact.validatedAt = row.validatedAt as number;
    if (row.validationStatus != null) {
      artifact.validationStatus = row.validationStatus as 'pending' | 'pass' | 'fail';
    }

    return artifact;
  }

  create(artifact: Artifact): Artifact {
    this.db.prepare(`
      INSERT INTO artifacts
        (id, jobId, skillInvocationId, type, content, createdAt,
         workspaceId, contentUri, mimeType, sizeBytes, checksum, validatedAt, validationStatus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      artifact.id,
      artifact.jobId,
      artifact.skillInvocationId,
      artifact.type,
      artifact.content,
      artifact.createdAt,
      artifact.workspaceId ?? null,
      artifact.contentUri ?? null,
      artifact.mimeType ?? null,
      artifact.sizeBytes ?? null,
      artifact.checksum ?? null,
      artifact.validatedAt ?? null,
      artifact.validationStatus ?? null,
    );
    return artifact;
  }

  getById(id: string): Artifact | undefined {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToArtifact(row) : undefined;
  }

  listAll(): Artifact[] {
    const rows = this.db.prepare('SELECT * FROM artifacts').all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToArtifact(r));
  }

  listByJobId(jobId: string): Artifact[] {
    const rows = this.db
      .prepare('SELECT * FROM artifacts WHERE jobId = ?')
      .all(jobId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToArtifact(r));
  }

  reset(): void {
    this.db.prepare('DELETE FROM artifacts').run();
  }
}
