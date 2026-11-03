import { vi } from 'vitest'
import { ActivationAttemptsTable } from './activationAttempts.js'
import { Pool } from 'pg'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

describe('ActivationAttemptsTable', () => {
  const query = vi.fn()
  const table = new ActivationAttemptsTable({ query })

  beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }))

  it('uses tenant-scoped parameterized lookups and bounded lists', async () => {
    expect(await table.latest('tenant-a', 'device-a')).toBeNull()
    expect(await table.get('tenant-b', 'attempt-a')).toBeNull()
    expect(await table.list('tenant-a', 'device-a', 20)).toEqual([])
    expect(query.mock.calls[0][1]).toEqual(['tenant-a', 'device-a'])
    expect(query.mock.calls[1][1]).toEqual(['tenant-b', 'attempt-a'])
    expect(query.mock.calls[2][1]).toEqual([
      'tenant-a',
      'device-a',
      20
    ])
    for (const [sql] of query.mock.calls) {
      expect(sql).toContain('tenant_id = $1')
      expect(sql).toContain('expires_at > now()')
    }
  })

  it('upserts an attempt and prunes expired records in bounded batches', async () => {
    const record = {
      attemptId: 'attempt-a',
      tenantId: '',
      deviceId: 'device-a',
      startedAt: '2026-10-30T00:00:00Z',
      finishedAt: null,
      outcome: 'in_progress',
      durationMs: 0
    }
    await table.save(record, 7)
    expect(query.mock.calls[0][0]).toContain('ON CONFLICT (attempt_id)')
    expect(query.mock.calls[0][1]).toEqual([
      'attempt-a',
      '',
      'device-a',
      record.startedAt,
      null,
      'in_progress',
      0,
      JSON.stringify(record),
      7
    ])
    expect(query.mock.calls[1][0]).toContain('LIMIT 1000')
  })
})

const integrationUrl = process.env.RPS_DIAGNOSTICS_TEST_DATABASE_URL ?? process.env.rps_diagnostics_test_database_url

describe.skipIf(integrationUrl == null)('ActivationAttemptsTable PostgreSQL integration', () => {
  let pool: Pool
  let table: ActivationAttemptsTable
  const deviceId = randomUUID()
  const attemptId = randomUUID()
  const record = {
    attemptId,
    tenantId: 'tenant-a',
    deviceId,
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    outcome: 'in_progress',
    durationMs: 0,
    summary: { wsmanRequests: 0 }
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: integrationUrl })
    const migration = readFileSync(
      new URL('../../../../data/migrations/001_activation_attempts.sql', import.meta.url),
      'utf8'
    )
    await pool.query(migration)
    await pool.query(migration)
    table = new ActivationAttemptsTable({ query: (text, params) => pool.query(text, params) })
  })

  afterAll(async () => {
    await pool.query('DELETE FROM activation_attempts WHERE device_id = $1', [deviceId])
    await pool.end()
  })

  it('persists and retrieves an attempt, updates completion, and isolates tenants', async () => {
    await table.save(record, 7)
    expect(await table.latest('tenant-a', deviceId)).toMatchObject({ attemptId, outcome: 'in_progress' })
    expect(await table.get('tenant-b', attemptId)).toBeNull()
    expect(await table.list('tenant-b', deviceId, 20)).toEqual([])
    await table.save({ ...record, outcome: 'success', finishedAt: new Date().toISOString(), durationMs: 1234 }, 7)
    expect(await table.get('tenant-a', attemptId)).toMatchObject({ outcome: 'success', durationMs: 1234 })
    expect(await table.list('tenant-a', deviceId, 20)).toHaveLength(1)
  })

  it('hides expired records and removes them on the next write', async () => {
    await pool.query("UPDATE activation_attempts SET expires_at = now() - interval '1 day' WHERE attempt_id = $1", [
      attemptId
    ])
    expect(await table.get('tenant-a', attemptId)).toBeNull()
    const nextId = randomUUID()
    await table.save({ ...record, attemptId: nextId }, 7)
    const result = await pool.query('SELECT attempt_id FROM activation_attempts WHERE attempt_id = $1', [attemptId])
    expect(result.rows).toHaveLength(0)
  })
})
