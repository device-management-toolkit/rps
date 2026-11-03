import { ActivationDiagnostics, type AttemptMetadata } from './ActivationDiagnostics.js'
import { performance } from 'node:perf_hooks'
import { vi } from 'vitest'

const metadata: AttemptMetadata = {
  tenantId: '',
  deviceId: '00000000-0000-4000-8000-000000000001',
  amtVersion: '21.0',
  startingMode: 0,
  profileName: 'acm',
  tlsEnforced: true,
  settings: { delayTlsSeconds: 15 }
}

describe('ActivationDiagnostics', () => {
  afterEach(() => vi.restoreAllMocks())

  it('times one request from send until the HTTP response, excluding preceding work', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const attempt = new ActivationDiagnostics(metadata)
    now = 5000
    attempt.beginRequest('Get', 'AMT_GeneralSettings')
    now = 5123
    attempt.response(200)
    now = 9000
    attempt.endRequest('success')
    expect(attempt.snapshot()).toMatchObject({
      requests: [
        {
          sequence: 1,
          action: 'Get',
          resource: 'AMT_GeneralSettings',
          statusCode: 200,
          durationMs: 123,
          outcome: 'success'
        }
      ]
    })
  })

  it('keeps HTTP errors and timed-out retries as distinct request rows', () => {
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const attempt = new ActivationDiagnostics(metadata)
    attempt.beginRequest('Delete', 'AMT_RemoteAccessPolicyRule')
    now = 40
    attempt.response(400)
    attempt.endRequest('transport_error')
    now = 5000
    attempt.beginRequest('Get', 'AMT_GeneralSettings')
    now = 17000
    attempt.endRequest('timeout')
    expect(attempt.snapshot()).toMatchObject({
      requests: [
        { sequence: 1, statusCode: 400, durationMs: 40, outcome: 'http_error' },
        { sequence: 2, statusCode: null, durationMs: 12000, outcome: 'timeout' }
      ]
    })
  })

  it('bounds request details independently of state events and snapshots pending requests safely', () => {
    const attempt = new ActivationDiagnostics(metadata, 1)
    attempt.state('activation', 'CHECK')
    attempt.beginRequest('Get', 'AMT_GeneralSettings')
    const pending = attempt.snapshot()
    attempt.response(200)
    attempt.beginRequest('Get', 'AMT_GeneralSettings')
    attempt.finish('interrupted')
    expect(pending).toMatchObject({ requests: [{ outcome: 'pending', durationMs: null }] })
    expect(attempt.snapshot()).toMatchObject({ requests: [{ outcome: 'success' }], summary: { requestsDropped: 1 } })
  })

  it('isolates concurrent attempts and counts failed requests and HTTP responses', () => {
    const first = new ActivationDiagnostics(metadata)
    const second = new ActivationDiagnostics(metadata)
    first.measure('wsman', { action: 'Delete', resource: 'AMT_RemoteAccessPolicyRule' })(false)
    first.response(400)
    expect(first.summary.wsmanRequests).toBe(1)
    expect(first.summary.wsmanFailures).toBe(1)
    expect(first.summary.httpResponses).toEqual({ '400': 1 })
    expect(second.summary.wsmanRequests).toBe(0)
    expect(first.attemptId).not.toBe(second.attemptId)
  })

  it('finalizes only once and ignores late measurements', () => {
    const attempt = new ActivationDiagnostics(metadata)
    const finishConnection = attempt.measure('tls_connect')
    expect(attempt.finish('success')).toBe(true)
    const snapshot = attempt.snapshot()
    finishConnection(false)
    attempt.response(500)
    expect(attempt.finish('interrupted')).toBe(false)
    expect(attempt.snapshot()).toEqual(snapshot)
  })

  it('bounds detailed events without losing counters', () => {
    const attempt = new ActivationDiagnostics(metadata, 1)
    attempt.measure('tls_connect')()
    attempt.measure('tls_connect')()
    expect(attempt.summary.tlsConnectionsEstablished).toBe(2)
    expect(attempt.summary.eventsDropped).toBe(1)
    expect(attempt.snapshot()).toMatchObject({ events: [{ type: 'tls_connect' }] })
  })

  it('records each state transition once per actor', () => {
    const attempt = new ActivationDiagnostics(metadata)
    attempt.state('activation', 'TLS')
    attempt.state('activation', 'TLS')
    attempt.state('tls', 'COMMIT')
    expect(attempt.snapshot()).toMatchObject({ events: [{ state: '"TLS"' }, { state: '"COMMIT"' }] })
  })

  it('counts completed measurements once', () => {
    const attempt = new ActivationDiagnostics(metadata)
    const complete = attempt.measure('tls_connect')
    complete()
    complete()
    expect(attempt.summary.tlsConnectionsEstablished).toBe(1)
  })
})
