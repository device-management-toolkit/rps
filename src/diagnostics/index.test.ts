import { vi } from 'vitest'
import { createActor, setup } from 'xstate'
import { Environment } from '../utils/Environment.js'
import { diagnosticsClock, diagnosticsFor, finishDiagnostics, startDiagnostics } from './index.js'
import { type AttemptMetadata } from './ActivationDiagnostics.js'

const save = vi.hoisted(() => vi.fn())
vi.mock('../factories/DbCreatorFactory.js', () => ({
  DbCreatorFactory: function () {
    return { getDb: async () => ({ activationAttempts: { save } }) }
  }
}))

const metadata: AttemptMetadata = {
  tenantId: '',
  deviceId: '00000000-0000-4000-8000-000000000001',
  amtVersion: '21.0',
  startingMode: 0,
  profileName: 'acm',
  tlsEnforced: true,
  settings: { delayTlsSeconds: 15 }
}

describe('diagnostics lifecycle', () => {
  beforeEach(() => {
    save.mockReset().mockResolvedValue(undefined)
    Environment.Config.diagnostics_enabled = true
    Environment.Config.diagnostics_retention_days = 7
  })

  afterEach(() => {
    finishDiagnostics('client-a', 'interrupted')
    finishDiagnostics('client-b', 'interrupted')
    Environment.Config.diagnostics_enabled = false
    vi.useRealTimers()
  })

  it('does not allocate or write diagnostics when disabled', async () => {
    Environment.Config.diagnostics_enabled = false
    startDiagnostics('client-a', metadata)
    expect(diagnosticsFor('client-a')).toBeUndefined()
    await Promise.resolve()
    expect(save).not.toHaveBeenCalled()
  })

  it('serializes initial and final writes and ignores disconnect after completion', async () => {
    startDiagnostics('client-a', metadata)
    diagnosticsFor('client-a')?.response(400)
    finishDiagnostics('client-a', 'success')
    finishDiagnostics('client-a', 'interrupted')
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[0][0].outcome).toBe('in_progress')
    expect(save.mock.calls[0][0].summary.httpResponses).toEqual({})
    expect(save.mock.calls[1][0].outcome).toBe('success')
    expect(save.mock.calls[1][0].summary.httpResponses).toEqual({ '400': 1 })
    expect(diagnosticsFor('client-a')).toBeUndefined()
  })

  it('still attempts the final write after an initial storage failure', async () => {
    save.mockRejectedValueOnce(new Error('database unavailable'))
    startDiagnostics('client-a', metadata)
    finishDiagnostics('client-a', 'failed')
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1][0].outcome).toBe('failed')
  })

  it('isolates disconnects and records interrupted attempts', async () => {
    startDiagnostics('client-a', metadata)
    startDiagnostics('client-b', metadata)
    finishDiagnostics('client-a', 'interrupted')
    expect(diagnosticsFor('client-b')?.outcome).toBe('in_progress')
    await vi.waitFor(() => expect(save.mock.calls.some(([record]) => record.outcome === 'interrupted')).toBe(true))
  })

  it('measures inherited XState delays without changing transitions', async () => {
    vi.useFakeTimers()
    startDiagnostics('client-a', metadata)
    const machine = setup({}).createMachine({
      initial: 'waiting',
      states: {
        waiting: { after: { 25: 'finished' } },
        finished: { type: 'final' }
      }
    })
    const actor = createActor(machine, { clock: diagnosticsClock(() => 'client-a') })
    actor.start()
    await vi.advanceTimersByTimeAsync(25)
    expect(actor.getSnapshot().status).toBe('done')
    expect(diagnosticsFor('client-a')?.snapshot()).toMatchObject({
      events: [{ type: 'wait', reason: 'state_machine_delay', configuredMs: 25, outcome: 'success' }]
    })
    actor.stop()
  })
})
