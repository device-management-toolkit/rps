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

// A certificate that this run installed, or that was already validated earlier in this run,
// must not be probed, validated and port-switched a second time.
const clientId = 'revalidation-test'

beforeEach(() => {
  Environment.Config = config
  devices[clientId] = {
    uuid: clientId,
    status: {},
    tlsEnforced: true,
    ClientData: { payload: { currentMode: 1 } },
    connectionParams: { port: 16993 }
  } as any
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

const base = () => ({
  clientId,
  amt: new AMT.Messages(),
  profile: { activation: ClientAction.ADMINCTLMODE },
  message: { Envelope: { Body: { AMT_GeneralSettings: { DigestRealm: 'Digest:ABCDEF0123456789ABCDEF0123456789' } } } }
})

describe('TLS activation Phase 2 re-entry', () => {
  // The digest realm check precedes the routing under test; it is not what these tests exercise.
  const machine = () => new Activation().machine.provide({ guards: { isDigestRealmInvalid: () => false } })

  it('goes straight to the ACM upgrade after CCM over TLS in the same run', async () => {
    const snapshot = await runSegment(
      machine(),
      'CHECK_DIGEST_REALM',
      { ...base(), isActivated: true, tlsCCMComplete: true, tlsACMComplete: false, tlsNeedsProvisioning: true },
      ['CHECK_AMT_TLS_STATE', 'IPS_HOST_BASED_SETUP_SERVICE']
    )
    expect(snapshot.value).toBe('IPS_HOST_BASED_SETUP_SERVICE')
    expect(snapshot.context.tlsNeedsProvisioning).toBe(false)
  })

  it('still probes TLS state for a device that was already activated before this run', async () => {
    const snapshot = await runSegment(
      machine(),
      'CHECK_DIGEST_REALM',
      { ...base(), isActivated: true, tlsCCMComplete: false, tlsACMComplete: false },
      ['CHECK_AMT_TLS_STATE', 'IPS_HOST_BASED_SETUP_SERVICE']
    )
    expect(snapshot.value).toBe('CHECK_AMT_TLS_STATE')
  })

  it('still probes TLS state once the ACM upgrade has completed', async () => {
    const snapshot = await runSegment(
      machine(),
      'CHECK_DIGEST_REALM',
      { ...base(), isActivated: true, tlsCCMComplete: true, tlsACMComplete: true },
      ['CHECK_AMT_TLS_STATE', 'IPS_HOST_BASED_SETUP_SERVICE']
    )
    expect(snapshot.value).toBe('CHECK_AMT_TLS_STATE')
  })
})

describe('--tls-tunnel re-validation after saving device info', () => {
  const machine = () =>
    new Activation().machine.provide({ actors: { saveDeviceInfoToMPS: fromPromise(async () => ({})) } })

  it('does not validate and port-switch again for an activated device whose certificate already passed', async () => {
    devices[clientId].tlsTunnelActivation = true
    const snapshot = await runSegment(
      machine(),
      'SAVE_DEVICE_TO_MPS',
      { ...base(), isActivated: true, tlsNeedsProvisioning: false, tlsTunnelCCMComplete: false },
      ['FETCH_MPS_ROOT_KEY', 'UNCONFIGURATION']
    )
    expect(snapshot.value).toBe('UNCONFIGURATION')
  })

  it('still provisions TLS for a first-time --tls-tunnel activation', async () => {
    devices[clientId].tlsTunnelActivation = true
    const snapshot = await runSegment(
      machine(),
      'SAVE_DEVICE_TO_MPS',
      { ...base(), isActivated: false, tlsNeedsProvisioning: false, tlsTunnelCCMComplete: false },
      ['FETCH_MPS_ROOT_KEY', 'UNCONFIGURATION']
    )
    expect(snapshot.value).toBe('FETCH_MPS_ROOT_KEY')
  })

  it('still provisions TLS for an activated --tls-tunnel device whose certificate did not pass', async () => {
    devices[clientId].tlsTunnelActivation = true
    const snapshot = await runSegment(
      machine(),
      'SAVE_DEVICE_TO_MPS',
      { ...base(), isActivated: true, tlsNeedsProvisioning: true, tlsTunnelCCMComplete: false },
      ['FETCH_MPS_ROOT_KEY', 'UNCONFIGURATION']
    )
    expect(snapshot.value).toBe('FETCH_MPS_ROOT_KEY')
  })

  it('marks provisioning needed when the TLS probe itself fails', async () => {
    devices[clientId].tlsTunnelActivation = true
    const failing = new Activation().machine.provide({
      actors: {
        checkAmtTlsState: fromPromise(async () => {
          throw new Error('probe failed')
        })
      }
    })
    const snapshot = await runSegment(
      failing,
      'CHECK_AMT_TLS_STATE',
      { ...base(), isActivated: true, tlsNeedsProvisioning: false },
      ['IPS_HOST_BASED_SETUP_SERVICE', 'CHANGE_AMT_PASSWORD']
    )
    expect(snapshot.context.tlsNeedsProvisioning).toBe(true)
  })
})
