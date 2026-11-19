/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { fromPromise } from 'xstate'
import { runMachineSegment } from '../test/helper/xstate.js'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { ClientAction } from '../models/RCS.Config.js'
import { GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'

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

const authenticationSteps = [
  { state: 'ADMIN_SETUP', actor: 'sendAdminSetup', success: 'CHECK_ADMIN_SETUP' },
  { state: 'UPGRADE_TO_ADMIN_SETUP', actor: 'sendUpgradeClientToAdmin', success: 'CHECK_UPGRADE' },
  { state: 'CHANGE_AMT_PASSWORD', actor: 'changeAMTPassword', success: 'UPDATE_CREDENTIALS' },
  { state: 'SET_MEBX_PASSWORD', actor: 'setMEBxPassword', success: 'SAVE_DEVICE_TO_SECRET_PROVIDER' }
]

describe.each(authenticationSteps)('$state authentication recovery', ({ state, actor, success }) => {
  const challenge = {
    statusCode: 401,
    headers: [{ name: 'Www-Authenticate', value: 'Digest realm="AMT", nonce="fresh-nonce", qop="auth"' }]
  }

  it.each([true, false])('retries after a digest challenge (TLS ACM phase: %s)', async (tlsPhase) => {
    devices[clientId].connectionParams = { port: 16993 } as any
    const invoke = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({})
    const machine = new Activation().machine.provide({ actors: { [actor]: fromPromise(invoke) } })
    const snapshot = await runMachineSegment(machine, state, { ...tlsAcmContext, tlsCCMComplete: tlsPhase }, [
      success,
      'DEACTIVATION',
      'FAILED'
    ])
    expect(snapshot.value).toBe(success)
    expect(invoke).toHaveBeenCalledTimes(2)
    expect(devices[clientId].connectionParams?.digestChallenge?.nonce).toBe('fresh-nonce')
    expect(devices[clientId].unauthCount).toBe(0)
  })

  it.each([
    0,
    2,
    3
  ])('stops when the existing retry budget is exhausted (initial count: %s)', async (count) => {
    devices[clientId].unauthCount = count
    const invoke = vi.fn().mockRejectedValue(challenge)
    const machine = new Activation().machine.provide({ actors: { [actor]: fromPromise(invoke) } })
    const snapshot = await runMachineSegment(machine, state, tlsAcmContext, [
      success,
      'DEACTIVATION',
      'FAILED'
    ])
    expect(snapshot.value).toBe('DEACTIVATION')
    expect(invoke).toHaveBeenCalledTimes(Math.max(1, 3 - count))
    expect(devices[clientId].unauthCount).toBe(0)
  })

  it('fails after bounded retries outside the TLS ACM phase', async () => {
    const invoke = vi.fn().mockRejectedValue(challenge)
    const machine = new Activation().machine.provide({ actors: { [actor]: fromPromise(invoke) } })
    const snapshot = await runMachineSegment(machine, state, { ...tlsAcmContext, tlsCCMComplete: false }, [
      success,
      'DEACTIVATION',
      'FAILED'
    ])
    expect(snapshot.value).toBe('FAILED')
    expect(invoke).toHaveBeenCalledTimes(3)
  })

  it('preserves TLS ACM failure handling for non-401 errors', async () => {
    const invoke = vi.fn().mockRejectedValue({ statusCode: 400 })
    const machine = new Activation().machine.provide({ actors: { [actor]: fromPromise(invoke) } })
    const snapshot = await runMachineSegment(machine, state, tlsAcmContext, [
      success,
      'DEACTIVATION',
      'FAILED'
    ])
    expect(snapshot.value).toBe('DEACTIVATION')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})

describe.each(authenticationSteps.slice(0, 2))('$state uncertain commit recovery', ({ state, actor }) => {
  it('checks activation status after a timeout instead of retrying the commit', async () => {
    const invoke = vi.fn().mockRejectedValue(new GATEWAY_TIMEOUT_ERROR())
    const machine = new Activation().machine.provide({ actors: { [actor]: fromPromise(invoke) } })
    const snapshot = await runMachineSegment(machine, state, tlsAcmContext, [
      'CHECK_ACTIVATION_ON_AMT',
      'DEACTIVATION',
      'ERROR'
    ])
    expect(snapshot.value).toBe('CHECK_ACTIVATION_ON_AMT')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
})
afterEach(() => {
  delete devices[clientId]
})

describe('SetMEBxPassword digest challenge in the TLS ACM phase', () => {
  it('routes a 401 to the error machine instead of deactivating', async () => {
    const machine = new Activation().machine.provide({
      actors: {
        setMEBxPassword: fromPromise(async () => {
          throw { statusCode: 401 }
        })
      }
    })
    const snapshot = await runMachineSegment(machine, 'SET_MEBX_PASSWORD', tlsAcmContext, ['ERROR', 'DEACTIVATION'])
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
    const snapshot = await runMachineSegment(machine, 'SET_MEBX_PASSWORD', tlsAcmContext, ['ERROR', 'DEACTIVATION'])
    expect(snapshot.value).toBe('DEACTIVATION')
  })

  it('retries SetMEBxPassword after re-authentication', async () => {
    const machine = new Activation().machine
    const snapshot = await runMachineSegment(
      machine,
      'NEXT_STATE',
      { ...tlsAcmContext, targetAfterError: 'SET_MEBX_PASSWORD' },
      ['SET_MEBX_PASSWORD', 'DEACTIVATION']
    )
    expect(snapshot.value).toBe('SET_MEBX_PASSWORD')
  })

  it('keeps deactivating from NEXT_STATE for other recovered steps in the TLS ACM phase', async () => {
    const machine = new Activation().machine
    const snapshot = await runMachineSegment(
      machine,
      'NEXT_STATE',
      { ...tlsAcmContext, targetAfterError: 'GET_GENERAL_SETTINGS' },
      ['GET_GENERAL_SETTINGS', 'DEACTIVATION']
    )
    expect(snapshot.value).toBe('DEACTIVATION')
  })
})
