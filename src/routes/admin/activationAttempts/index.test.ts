import express from 'express'
import { type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { vi } from 'vitest'
import router from './index.js'
import { Environment } from '../../../utils/Environment.js'

describe('activation attempts API', () => {
  let server: Server
  let baseUrl: string
  let tenantId: string | undefined
  const deviceId = '00000000-0000-4000-8000-000000000001'
  const attemptId = '00000000-0000-4000-8000-000000000002'
  const table = { latest: vi.fn(), list: vi.fn(), get: vi.fn() }

  beforeEach(async () => {
    vi.resetAllMocks()
    tenantId = 'tenant-a'
    Environment.Config.diagnostics_enabled = true
    const app = express()
    app.use((req, _res, next) => {
      req.db = { activationAttempts: table } as any
      req.tenantId = tenantId as string
      next()
    })
    app.use('/activation-attempts', router)
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => server.once('listening', resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/activation-attempts`
  })

  afterEach(async () => {
    Environment.Config.diagnostics_enabled = false
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  })

  it('retrieves latest diagnostics using server-side tenant context', async () => {
    table.latest.mockResolvedValue({ attemptId, outcome: 'success' })
    const response = await fetch(`${baseUrl}/latest?deviceId=${deviceId}&tenantId=tenant-b&format=json`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ attemptId, outcome: 'success' })
    expect(table.latest).toHaveBeenCalledWith('tenant-a', deviceId)
  })

  it('lists bounded history and retrieves an individual attempt', async () => {
    table.list.mockResolvedValue([{ attemptId }])
    table.get.mockResolvedValue({ attemptId })
    expect(await (await fetch(`${baseUrl}?deviceId=${deviceId}&limit=10`)).json()).toEqual({
      attempts: [{ attemptId }]
    })
    expect(table.list).toHaveBeenCalledWith('tenant-a', deviceId, 10)
    expect((await fetch(`${baseUrl}/${attemptId}`)).status).toBe(200)
    expect(table.get).toHaveBeenCalledWith('tenant-a', attemptId)
  })

  it('renders only request rows as plain text with response durations', async () => {
    const record = {
      attemptId,
      outcome: 'success',
      requests: [
        {
          sequence: 1,
          action: 'Get',
          resource: 'AMT_GeneralSettings',
          statusCode: 200,
          durationMs: 123,
          outcome: 'success'
        },
        {
          sequence: 2,
          action: 'Delete',
          resource: 'AMT_RemoteAccessPolicyRule',
          statusCode: 400,
          durationMs: 45,
          outcome: 'http_error'
        }
      ],
      events: [
        { type: 'state', elapsedMs: 100 },
        { type: 'wsman', durationMs: 9999 }
      ]
    }
    table.latest.mockResolvedValue(record)
    table.get.mockResolvedValue(record)
    for (const path of [
      `/latest?deviceId=${deviceId}&format=table&view=requests`,
      `/${attemptId}?format=table&view=requests`
    ]) {
      const response = await fetch(`${baseUrl}${path}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/plain')
      const text = await response.text()
      expect(text).toContain('Duration')
      expect(text).toContain('AMT_GeneralSettings')
      expect(text).toContain('123ms')
      expect(text).toContain('400')
      expect(text).not.toContain('elapsedMs')
      expect(text).not.toContain('9999')
      expect(text).not.toContain('state')
    }
  })

  it('does not present legacy operation durations as request-only timings', async () => {
    table.latest.mockResolvedValue({
      attemptId,
      outcome: 'success',
      events: [
        { type: 'wsman_request', action: 'Get', resource: 'AMT_GeneralSettings' },
        { type: 'wsman', durationMs: 9999 }
      ]
    })
    const response = await fetch(`${baseUrl}/latest?deviceId=${deviceId}&format=table&view=requests`)
    const text = await response.text()
    expect(text).toContain('AMT_GeneralSettings')
    expect(text).toContain('n/a')
    expect(text).toContain('older capture')
    expect(text).not.toContain('9999')
    expect((await fetch(`${baseUrl}/latest?deviceId=${deviceId}&format=html`)).status).toBe(400)
  })

  it.each([
    [0, '0ms'],
    [999, '999ms'],
    [1000, '1s'],
    [1234, '1s 234ms'],
    [60000, '1m 0s'],
    [154296, '2m 34s 296ms']
  ])('formats duration %s as %s without changing stored JSON', async (milliseconds, readable) => {
    const record = {
      attemptId,
      outcome: 'success',
      durationMs: milliseconds,
      summary: { explicitWaitMs: milliseconds, wsmanRequests: 74 },
      settings: { delayActivationSyncMs: milliseconds, delayTlsSeconds: 5 },
      requests: [
        {
          sequence: 1,
          action: 'Get',
          resource: 'AMT_GeneralSettings',
          statusCode: 200,
          durationMs: milliseconds,
          outcome: 'success'
        }
      ],
      phases: [{ actor: 'activation', state: 'GET', durationMs: milliseconds }],
      events: [
        { type: 'tls_connect', durationMs: milliseconds, outcome: 'success' },
        { type: 'wait', configuredMs: milliseconds, durationMs: milliseconds, outcome: 'success' }
      ]
    }
    table.latest.mockResolvedValue(record)
    for (const view of [
      'requests',
      'states',
      'connections',
      'waits',
      'summary'
    ]) {
      const response = await fetch(`${baseUrl}/latest?deviceId=${deviceId}&view=${view}`)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(text).toContain(readable)
      expect(text).not.toContain('Duration (ms)')
      if (view === 'summary') {
        expect(text).toContain('5s')
        expect(text).toContain('74')
        expect(text).not.toContain('explicitWaitMs')
      }
    }
    const raw = await fetch(`${baseUrl}/latest?deviceId=${deviceId}&format=json`)
    expect(await raw.json()).toEqual(record)
  })

  it('defaults to summary and includes request rows or states only when explicitly requested', async () => {
    const record = {
      attemptId,
      outcome: 'success',
      requests: [],
      phases: [
        { actor: 'activation', state: 'GET_GENERAL_SETTINGS', durationMs: 125 }
      ],
      events: [
        { type: 'tls_connect', durationMs: 2000, outcome: 'success' },
        { type: 'wait', reason: 'tls_rollover', durationMs: 5000, configuredMs: 5000, outcome: 'success' }
      ],
      summary: { wsmanRequests: 1 },
      settings: { delayTlsSeconds: 5 }
    }
    table.latest.mockResolvedValue(record)
    table.get.mockResolvedValue(record)
    for (const path of [`/latest?deviceId=${deviceId}`, `/${attemptId}`]) {
      const text = await (await fetch(`${baseUrl}${path}`)).text()
      expect(text).toContain('Activation Summary')
      expect(text).toContain('Settings')
      expect(text).not.toContain('WS-Man Requests')
      expect(text).not.toContain('State Timings')
      expect(text).not.toContain('GET_GENERAL_SETTINGS')
    }
    const requests = await (await fetch(`${baseUrl}/latest?deviceId=${deviceId}&view=requests`)).text()
    expect(requests).toContain('WS-Man Requests')
    expect(requests).not.toContain('Activation Summary')
    const states = await (await fetch(`${baseUrl}/latest?deviceId=${deviceId}&view=states`)).text()
    expect(states).toContain('State Timings')
    expect(states).toContain('GET_GENERAL_SETTINGS')
    expect(states).not.toContain('WS-Man Requests')
    const all = await (await fetch(`${baseUrl}/latest?deviceId=${deviceId}&view=all`)).text()
    for (const section of [
      'WS-Man Requests',
      'State Timings',
      'Connections',
      'Waits',
      'Activation Summary',
      'Settings'
    ]) {
      expect(all).toContain(section)
    }
    expect((await fetch(`${baseUrl}/latest?deviceId=${deviceId}&view=unknown`)).status).toBe(400)
  })

  it('rejects invalid identifiers and unbounded limits', async () => {
    expect((await fetch(`${baseUrl}/latest?deviceId=bad`)).status).toBe(400)
    expect((await fetch(`${baseUrl}?deviceId=${deviceId}&limit=101`)).status).toBe(400)
    expect((await fetch(`${baseUrl}/bad`)).status).toBe(400)
    expect(table.latest).not.toHaveBeenCalled()
    expect(table.list).not.toHaveBeenCalled()
  })

  it('accepts AMT device UUIDs without RFC version bits for latest and history lookups', async () => {
    const amtDeviceId = '47834b6a-aaef-0ff7-aac7-48210b8764f6'
    table.latest.mockResolvedValue({ attemptId, deviceId: amtDeviceId, outcome: 'success' })
    table.list.mockResolvedValue([{ attemptId, deviceId: amtDeviceId }])
    const latest = await fetch(`${baseUrl}/latest?deviceId=${amtDeviceId}&format=json`)
    expect(latest.status).toBe(200)
    expect(await latest.json()).toMatchObject({ deviceId: amtDeviceId })
    expect(table.latest).toHaveBeenCalledWith('tenant-a', amtDeviceId)
    const history = await fetch(`${baseUrl}?deviceId=${amtDeviceId}`)
    expect(history.status).toBe(200)
    expect(table.list).toHaveBeenCalledWith('tenant-a', amtDeviceId, 20)
    expect((await fetch(`${baseUrl}/${amtDeviceId}`)).status).toBe(400)
    expect(table.get).not.toHaveBeenCalled()
  })

  it.each(['47834b6a-aaef-0ff7-aac7-48210b8764fg', '47834b6a-aaef-0ff7-aac7-48210b8764f'])(
    'rejects malformed AMT device identifier %s',
    async (invalidId) => {
      expect((await fetch(`${baseUrl}/latest?deviceId=${invalidId}`)).status).toBe(400)
      expect((await fetch(`${baseUrl}?deviceId=${invalidId}`)).status).toBe(400)
      expect(table.latest).not.toHaveBeenCalled()
      expect(table.list).not.toHaveBeenCalled()
    }
  )

  it('returns 404 for missing records and 503 without leaking database errors', async () => {
    table.get.mockResolvedValue(null)
    expect((await fetch(`${baseUrl}/${attemptId}`)).status).toBe(404)
    table.latest.mockRejectedValue(new Error('secret connection information'))
    const response = await fetch(`${baseUrl}/latest?deviceId=${deviceId}`)
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('secret')
  })

  it('does not expose diagnostics when disabled or without tenant context', async () => {
    Environment.Config.diagnostics_enabled = false
    expect((await fetch(`${baseUrl}/latest?deviceId=${deviceId}`)).status).toBe(404)
    Environment.Config.diagnostics_enabled = true
    tenantId = undefined
    expect((await fetch(`${baseUrl}/latest?deviceId=${deviceId}`)).status).toBe(403)
    expect(table.latest).not.toHaveBeenCalled()
  })
})
