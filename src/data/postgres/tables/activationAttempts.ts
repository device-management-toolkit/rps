import { type IDB } from '../../../interfaces/database/IDb.js'
import { type IActivationAttemptsTable } from '../../../interfaces/database/IActivationAttemptsDb.js'

export class ActivationAttemptsTable implements IActivationAttemptsTable {
  constructor(readonly db: Pick<IDB, 'query'>) {}

  async save(record: any, retentionDays: number): Promise<void> {
    await this.db.query(
      `INSERT INTO activation_attempts
        (attempt_id, tenant_id, device_id, started_at, finished_at, outcome, duration_ms, diagnostics, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $4::timestamptz + $9 * interval '1 day')
       ON CONFLICT (attempt_id) DO UPDATE SET
         finished_at = EXCLUDED.finished_at, outcome = EXCLUDED.outcome,
         duration_ms = EXCLUDED.duration_ms, diagnostics = EXCLUDED.diagnostics
       WHERE activation_attempts.tenant_id = EXCLUDED.tenant_id`,
      [
        record.attemptId,
        record.tenantId,
        record.deviceId,
        record.startedAt,
        record.finishedAt,
        record.outcome,
        record.durationMs,
        JSON.stringify(record),
        retentionDays
      ]
    )
    await this.db.query(
      `DELETE FROM activation_attempts WHERE attempt_id IN
       (SELECT attempt_id FROM activation_attempts WHERE expires_at < now() ORDER BY expires_at LIMIT 1000)`
    )
  }

  async latest(tenantId: string, deviceId: string): Promise<any | null> {
    const result = await this.db.query(
      `SELECT diagnostics FROM activation_attempts
       WHERE tenant_id = $1 AND device_id = $2 AND expires_at > now()
       ORDER BY started_at DESC, attempt_id DESC LIMIT 1`,
      [tenantId, deviceId]
    )
    return result.rows[0]?.diagnostics ?? null
  }

  async get(tenantId: string, attemptId: string): Promise<any | null> {
    const result = await this.db.query(
      `SELECT diagnostics FROM activation_attempts
       WHERE tenant_id = $1 AND attempt_id = $2 AND expires_at > now()`,
      [tenantId, attemptId]
    )
    return result.rows[0]?.diagnostics ?? null
  }

  async list(tenantId: string, deviceId: string, limit: number): Promise<any[]> {
    const result = await this.db.query(
      `SELECT attempt_id AS "attemptId", device_id AS "deviceId", started_at AS "startedAt",
         finished_at AS "finishedAt", outcome, duration_ms AS "durationMs"
       FROM activation_attempts WHERE tenant_id = $1 AND device_id = $2 AND expires_at > now()
       ORDER BY started_at DESC, attempt_id DESC LIMIT $3`,
      [
        tenantId,
        deviceId,
        limit
      ]
    )
    return result.rows
  }
}
