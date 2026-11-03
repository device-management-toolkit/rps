/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { createActor, createMachine, fromPromise, waitFor } from 'xstate'
import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from './helper/Config.js'
import { ClientAction } from '../models/RCS.Config.js'

const exchange = vi.hoisted(() => vi.fn())
vi.mock('../stateMachines/common.js', async () => ({
  ...(await vi.importActual<typeof import('../stateMachines/common.js')>('../stateMachines/common.js')),
  invokeWsmanCall: exchange
}))
vi.mock('../Configurator.js', () => ({
  Configurator: function () {
    return { ready: Promise.resolve() }
  }
}))
vi.mock('../factories/DbCreatorFactory.js', () => ({ DbCreatorFactory: vi.fn() }))
const { Unconfiguration } = await import('../stateMachines/unconfiguration.js')
const { Activation } = await import('../stateMachines/activation.js')

// These segmented release characterizations retain real transitions and SDK builders.
// External WS-Man responses are scripted; no transport, device, or timing is measured.
const clientId = 'issue-2935-simulation'
const enumeration = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'simulation' } } } }
const pull = (items: any): any => ({ Envelope: { Body: { PullResponse: { Items: items } } } })
let requests: string[]

beforeEach(() => {
  Environment.Config = config
  requests = []
  exchange.mockReset()
  devices[clientId] = {
    uuid: clientId,
    tlsEnforced: true,
    tlsTunnelActivation: false,
    status: {},
    ClientData: { payload: { currentMode: 2 } }
  } as any
})
afterEach(() => {
  delete devices[clientId]
})

function script(responses: any[]): void {
  exchange.mockImplementation(async (context) => {
    requests.push(context.xmlMessage)
    if (responses.length === 0) throw new Error('Unexpected additional WS-Man call')
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response
  })
}

async function runSegment(machine: any, initial: string, context: any, terminals: string[]): Promise<any> {
  const states = { ...machine.config.states }
  // Pin cleanup characterization to the September transition graph after candidate A is implemented.
  // The release had no pre-read transition in this state; retain its baseline sequence here.
  if (states.ENUMERATE_TLS_SETTING_DATA != null) {
    states.ENUMERATE_TLS_SETTING_DATA = { ...states.ENUMERATE_TLS_SETTING_DATA, always: undefined }
  }
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

describe('Issue 2935 release cleanup characterization', () => {
  it.each([false, true])('discards TLS reads but retains environment cleanup (MPS entries=%s)', async (hasMps) => {
    const cleanup = new Unconfiguration()
    const deleteMps = vi.fn(async () => ({}))
    const machine = cleanup.machine.provide({ actors: { deleteRemoteAccessService: fromPromise(deleteMps) } })
    script([
      enumeration,
      pull({ AMT_TLSSettingData: [{ Enabled: true }, { Enabled: true }] }),
      { Envelope: { Body: { AMT_EnvironmentDetectionSettingData: { DetectionStrings: ['simulation'] } } } },
      {}
    ])
    const snapshot = await runSegment(
      machine,
      'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE',
      {
        clientId,
        amt: new AMT.Messages(),
        message: pull(hasMps ? { AMT_ManagementPresenceRemoteSAP: {} } : {})
      },
      ['SUCCESS', 'FAILURE']
    )
    expect(snapshot.value).toBe('SUCCESS')
    expect(deleteMps).toHaveBeenCalledTimes(hasMps ? 1 : 0)
    expect(requests).toHaveLength(4)
    expect(requests[0]).toContain('AMT_TLSSettingData')
    expect(requests[1]).toContain('AMT_TLSSettingData')
    expect(requests[2]).toContain('AMT_EnvironmentDetectionSettingData')
    expect(requests[3]).toContain('AMT_EnvironmentDetectionSettingData')
    expect(requests.join('')).not.toContain('AMT_PublicKeyCertificate')
  })

  it.each([
    0,
    1,
    2
  ])('fails cleanup when scripted read %s fails', async (failureIndex) => {
    const responses = [
      enumeration,
      pull({ AMT_TLSSettingData: [] }),
      {}
    ]
    responses[failureIndex] = new Error('simulated read failure')
    script(responses)
    const snapshot = await runSegment(
      new Unconfiguration().machine,
      'ENUMERATE_TLS_SETTING_DATA',
      { clientId, amt: new AMT.Messages() },
      ['SUCCESS', 'FAILURE']
    )
    expect(snapshot.value).toBe('FAILURE')
    expect(requests).toHaveLength(failureIndex + 1)
  })

  it('retains TLS-disable routing on devices without TLS enforcement', async () => {
    devices[clientId].tlsEnforced = false
    script([enumeration, pull({ AMT_TLSSettingData: [{ Enabled: true }] })])
    const snapshot = await runSegment(
      new Unconfiguration().machine,
      'ENUMERATE_TLS_SETTING_DATA',
      { clientId, amt: new AMT.Messages() },
      ['DISABLE_TLS_SETTING_DATA', 'FAILURE']
    )
    expect(snapshot.value).toBe('DISABLE_TLS_SETTING_DATA')
    expect(requests).toHaveLength(2)
  })
})

describe('Issue 2935 release activated routing characterization', () => {
  it.each([
    { enabled: false, enforced: false, tunnel: false, mode: 2, target: 'CHANGE_AMT_PASSWORD', count: 2 },
    { enabled: true, enforced: false, tunnel: false, mode: 2, target: 'CHANGE_AMT_PASSWORD', count: 4 },
    { enabled: true, enforced: false, tunnel: false, mode: 1, target: 'IPS_HOST_BASED_SETUP_SERVICE', count: 4 },
    { enabled: true, enforced: false, tunnel: true, mode: 2, target: 'VALIDATE_ACTIVATED_DEVICE_TLS_CERT', count: 4 },
    { enabled: true, enforced: true, tunnel: false, mode: 2, target: 'VALIDATE_ACTIVATED_DEVICE_TLS_CERT', count: 4 }
  ])('routes the probed scenario $enabled/$enforced/$tunnel/$mode to $target', async (scenario) => {
    devices[clientId].tlsEnforced = scenario.enforced
    devices[clientId].tlsTunnelActivation = scenario.tunnel
    devices[clientId].ClientData.payload.currentMode = scenario.mode
    script([
      enumeration,
      pull({ AMT_TLSSettingData: [{ Enabled: scenario.enabled }] }),
      enumeration,
      pull({ AMT_TLSCredentialContext: [{}] })
    ])
    const snapshot = await runSegment(
      new Activation().machine,
      'CHECK_AMT_TLS_STATE',
      { clientId, amt: new AMT.Messages(), isActivated: true, profile: { activation: ClientAction.ADMINCTLMODE } },
      [
        'CHANGE_AMT_PASSWORD',
        'IPS_HOST_BASED_SETUP_SERVICE',
        'VALIDATE_ACTIVATED_DEVICE_TLS_CERT'
      ]
    )
    expect(snapshot.value).toBe(scenario.target)
    expect(requests).toHaveLength(scenario.count)
    expect(requests.slice(0, 2).every((xml) => xml.includes('AMT_TLSSettingData'))).toBe(true)
    if (!scenario.enforced && !scenario.tunnel) expect(snapshot.context.tlsNeedsProvisioning).toBe(false)
  })

  it('still selects non-TLS routing after a failed probe', async () => {
    devices[clientId].tlsEnforced = false
    script([new Error('simulated probe failure')])
    const snapshot = await runSegment(
      new Activation().machine,
      'CHECK_AMT_TLS_STATE',
      { clientId, amt: new AMT.Messages(), isActivated: true, profile: { activation: ClientAction.CLIENTCTLMODE } },
      [
        'CHANGE_AMT_PASSWORD',
        'IPS_HOST_BASED_SETUP_SERVICE',
        'VALIDATE_ACTIVATED_DEVICE_TLS_CERT'
      ]
    )
    expect(snapshot.value).toBe('CHANGE_AMT_PASSWORD')
    expect(snapshot.context.tlsNeedsProvisioning).toBe(false)
    expect(requests).toHaveLength(1)
  })
})

describe('Issue 2935 further TLS reuse characterization', () => {
  it('requests deferred TLS provisioning after a successful matching-certificate route', async () => {
    const activation = new Activation()
    const validate = vi.fn(async () => true)
    const machine = activation.machine.provide({
      actors: {
        validateActivatedTlsIdentity: fromPromise(async () => ({ valid: await validate(), reuseApproved: false })),
        featuresConfiguration: fromPromise(async () => ({}))
      }
    })
    const context = {
      clientId,
      amt: new AMT.Messages(),
      isActivated: true,
      profile: { activation: ClientAction.ADMINCTLMODE },
      tlsNeedsProvisioning: true
    }
    devices[clientId].ClientData.payload.tlsEnforced = true
    devices[clientId].tls = {} as any
    const validated = await runSegment(machine, 'VALIDATE_ACTIVATED_DEVICE_TLS_CERT', context, [
      'SIGNAL_ACTIVATED_PORT_SWITCH',
      'ROUTE_ACTIVATED_NON_TLS'
    ])
    expect(validate).toHaveBeenCalledOnce()
    expect(validated.value).toBe('SIGNAL_ACTIVATED_PORT_SWITCH')
    expect(validated.context.tlsNeedsProvisioning).toBe(false)
    expect(devices[clientId].status.TLSConfiguration).toBe('Already configured')
    const deferred = await runSegment(machine, 'FEATURES_CONFIGURATION', validated.context, [
      'FETCH_POST_PROVISIONING_ROOT_KEY',
      'CIRA',
      'PROVISIONED'
    ])
    expect(deferred.value).toBe('FETCH_POST_PROVISIONING_ROOT_KEY')
    expect(exchange).not.toHaveBeenCalled()
  })
})
