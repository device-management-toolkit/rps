import { vi } from 'vitest'
import { createActor, setup } from 'xstate'
import { DataProcessor } from './DataProcessor.js'
import { devices } from './devices.js'
import { Environment } from './utils/Environment.js'
import { diagnosticsFor, finishDiagnostics } from './diagnostics/index.js'

const save = vi.hoisted(() => vi.fn())
vi.mock('./factories/DbCreatorFactory.js', () => ({
  DbCreatorFactory: function () {
    return { getDb: async () => ({ activationAttempts: { save } }) }
  }
}))

describe('DataProcessor activation diagnostics', () => {
  const clientId = 'diagnostics-client'
  const payload = {
    uuid: '00000000-0000-4000-8000-000000000001',
    ver: '21.0',
    currentMode: 0,
    password: 'never-store-device-password',
    profile: { profileName: 'acm', amtPassword: 'never-store-profile-password', provisioningCert: 'never-store-cert' }
  }

  beforeEach(() => {
    save.mockReset().mockResolvedValue(undefined)
    Environment.Config.diagnostics_enabled = true
    Environment.Config.diagnostics_retention_days = 7
    devices[clientId] = { ClientData: { payload }, tlsEnforced: true } as any
  })

  afterEach(() => {
    finishDiagnostics(clientId, 'interrupted')
    delete devices[clientId]
    Environment.Config.diagnostics_enabled = false
  })

  it.each(['success', 'error'])('persists %s with allowlisted metadata and explicit state timings', async (status) => {
    const machine = setup({ types: {} as { context: { status: string } } }).createMachine({
      context: { status },
      initial: 'idle',
      states: {
        idle: { on: { ACTIVATION: 'finished' } },
        finished: { type: 'final' }
      }
    })
    const service = createActor(machine)
    const validator = { validateActivationMsg: vi.fn().mockResolvedValue(undefined) }
    const logger = { debug: vi.fn() }
    const processor = new DataProcessor(logger as any, validator as any)
    await processor.activateDevice({ payload, tenantId: '' } as any, clientId, { service } as any)
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    const record = save.mock.calls[1][0]
    expect(record.outcome).toBe(status === 'success' ? 'success' : 'failed')
    expect(record.profileName).toBe('acm')
    expect(record.phases.length).toBeGreaterThan(0)
    expect(JSON.stringify(record)).not.toContain('never-store')
    expect(diagnosticsFor(clientId)).toBeUndefined()
  })
})
