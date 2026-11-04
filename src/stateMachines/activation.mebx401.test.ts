/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { createActor, createMachine, fromPromise, waitFor } from 'xstate'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { ClientAction } from '../models/RCS.Config.js'

vi.mock('../Configurator.js', () => ({
  Configurator: function () {
    return { ready: Promise.resolve() }
  }
}))
vi.mock('../factories/DbCreatorFactory.js', () => ({ DbCreatorFactory: vi.fn() }))
const { Activation } = await import('./activation.js')

// AMT closes the digest session after the ACM commit, so the first call after it
// (SetMEBxPassword) gets a 401. In the TLS ACM phase that must re-authenticate and
// retry, not deactivate the device.
const clientId = 'mebx-401-test'
const tlsAcmContext = {
  clientId,
  amt: new AMT.Messages(),
  profile: { activation: ClientAction.ADMINCTLMODE },
  tlsCCMComplete: true,
  tlsACMComplete: false
}

beforeEach(() => {
  Environment.Config = config
  devices[clientId] = { uuid: clientId, status: {}, ClientData: { payload: {} } } as any
})
afterEach(() => {
  delete devices[clientId]
})

async function runSegment(machine: any, initial: string, context: any, terminals: string[]): Promise<any> {
  const states = { ...machine.config.states }
  for (const terminal of terminals) states[terminal] = { type: 'final' }
  const segment = createMachine({ ...machine.config, initial, context, states }, machine.implementations)
  const actor = createActor(segment)
  try {
    actor.start()
    return await waitFor(actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
  } finally {
    actor.stop()
  }
}

describe('SetMEBxPassword digest challenge in the TLS ACM phase', () => {
  it('routes a 401 to the error machine instead of deactivating', async () => {
    const machine = new Activation().machine.provide({
      actors: {
        setMEBxPassword: fromPromise(async () => {
          throw { statusCode: 401 }
        })
      }
    })
    const snapshot = await runSegment(machine, 'SET_MEBX_PASSWORD', tlsAcmContext, ['ERROR', 'DEACTIVATION'])
    expect(snapshot.value).toBe('ERROR')
    expect(snapshot.context.targetAfterError).toBe('SET_MEBX_PASSWORD')
  })

  it('still deactivates on any other SetMEBxPassword failure', async () => {
    const machine = new Activation().machine.provide({
      actors: {
        setMEBxPassword: fromPromise(async () => {
          throw new Error('device rejected the MEBx password')
        })
      }
    })
    const snapshot = await runSegment(machine, 'SET_MEBX_PASSWORD', tlsAcmContext, ['ERROR', 'DEACTIVATION'])
    expect(snapshot.value).toBe('DEACTIVATION')
  })

  it('retries SetMEBxPassword after re-authentication', async () => {
    const machine = new Activation().machine
    const snapshot = await runSegment(
      machine,
      'NEXT_STATE',
      { ...tlsAcmContext, targetAfterError: 'SET_MEBX_PASSWORD' },
      ['SET_MEBX_PASSWORD', 'DEACTIVATION']
    )
    expect(snapshot.value).toBe('SET_MEBX_PASSWORD')
  })

  it('keeps deactivating from NEXT_STATE for other recovered steps in the TLS ACM phase', async () => {
    const machine = new Activation().machine
    const snapshot = await runSegment(
      machine,
      'NEXT_STATE',
      { ...tlsAcmContext, targetAfterError: 'GET_GENERAL_SETTINGS' },
      ['GET_GENERAL_SETTINGS', 'DEACTIVATION']
    )
    expect(snapshot.value).toBe('DEACTIVATION')
  })
})
