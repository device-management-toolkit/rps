/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type AMT } from '@device-management-toolkit/wsman-messages'
import { type DoneResponse, StatusFailed, StatusSuccess } from './doneResponse.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { type MachineImplementationsSimplified } from 'xstate'
import { setupTestClient } from '../../test/helper/Config.js'

import { HttpResponseError, coalesceMessage } from '../common.js'

import {
  type EthernetPortSettingsPullResponse,
  type EthernetPortSettingsEnumerateResponse,
  type IPConfiguration,
  type SyncIPContext,
  type SyncIPEvent,
  type SyncIP as SyncIPType
} from './syncIP.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('../common.js', async () => {
  const actual = await vi.importActual<typeof import('../common.js')>('../common.js')
  const { HttpResponseError, coalesceMessage } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    HttpResponseError,
    coalesceMessage
  }
})

const { MessageAlreadySynchronized, MessageNoWiredSettingsOnDevice, MessageWirelessOnly, SyncIP, SyncIPEventType } =
  await import('./syncIP.js')

const HttpBadRequestError = new HttpResponseError('Bad Request', 400)

describe('SyncIP State Machine', () => {
  let clientId: string
  let doneResponse: DoneResponse
  let event: SyncIPEvent
  let implementation: SyncIPType
  let context: SyncIPContext
  let implementationConfig: MachineImplementationsSimplified<SyncIPContext, SyncIPEvent>
  let targetIPConfig: IPConfiguration
  let enumerateRsp: EthernetPortSettingsEnumerateResponse
  let wiredPortSettings: AMT.Models.EthernetPortSettings
  let wirelessPortSettings: AMT.Models.EthernetPortSettings
  let pullRsp: EthernetPortSettingsPullResponse
  let putRsp: any

  beforeEach(() => {
    vi.resetAllMocks()
    clientId = setupTestClient()
    implementation = new SyncIP()
    doneResponse = {
      taskName: 'syncip',
      status: 'SUCCESS',
      message: expect.any(String)
    }
    enumerateRsp = {
      Envelope: {
        Body: {
          EnumerateResponse: {
            EnumerationContext: 'ABCDEF0123456789'
          }
        }
      }
    }
    targetIPConfig = {
      ipAddress: '192.168.1.100',
      netmask: '',
      gateway: '',
      primaryDns: '',
      secondaryDns: ''
    }
    wiredPortSettings = {
      ElementName: 'Intel(r) AMT Ethernet Port Settings',
      InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
      IpSyncEnabled: true,
      LinkIsUp: true,
      LinkPolicy: [
        1,
        14,
        16
      ],
      MACAddress: '70-b5-e8-61-f5-20',
      PhysicalConnectionType: 0,
      DHCPEnabled: false,
      SharedStaticIp: true,
      IPAddress: '192.168.1.80',
      SubnetMask: '255.255.255.0',
      DefaultGateway: '192.168.1.1',
      PrimaryDNS: '192.168.1.1',
      SecondaryDNS: '192.168.1.1'
    }
    wirelessPortSettings = {
      ConsoleTcpMaxRetransmissions: 5,
      DHCPEnabled: true,
      ElementName: 'Intel(r) AMT Ethernet Port Settings',
      InstanceID: 'Intel(r) AMT Ethernet Port Settings 1',
      LinkControl: 2,
      LinkIsUp: false,
      LinkPolicy: [
        1,
        14,
        16
      ],
      LinkPreference: 2,
      MACAddress: '00-00-00-00-00-00',
      PhysicalConnectionType: 3,
      SharedMAC: true,
      WLANLinkProtectionLevel: 1
    }
    pullRsp = {
      Envelope: {
        Body: {
          PullResponse: {
            Items: {
              AMT_EthernetPortSettings: [wiredPortSettings, wirelessPortSettings]
            }
          }
        }
      }
    }
    context = {
      taskName: 'syncip',
      clientId,
      wiredSettings: {
        DHCPEnabled: true,
        IpSyncEnabled: true,
        SharedStaticIp: false,
        IPAddress: '0.0.0.0',
        SubnetMask: '0.0.0.0',
        DefaultGateway: '0.0.0.0',
        PrimaryDNS: '0.0.0.0',
        SecondaryDNS: '0.0.0.0'
      }
    } as any
    implementationConfig = {
      actors: {},
      actions: {},
      guards: {},
      delays: {}
    }
    putRsp = wiredPortSettings
    event = { type: SyncIPEventType, clientId, targetIPConfig }
  })

  const runTheTest = async function (): Promise<void> {
    invokeWsmanCallSpy.mockResolvedValueOnce(enumerateRsp).mockResolvedValueOnce(pullRsp).mockResolvedValueOnce(putRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context)
  }
  it('should succeed synchronizing static ip', async () => {
    doneResponse.status = StatusSuccess
    await runTheTest()
  })
  it('should succeed synchronizing DHCP', async () => {
    wiredPortSettings.DHCPEnabled = true
    doneResponse.status = StatusSuccess
    await runTheTest()
  })
  it('should fail missing event.targetIPConfig.ipAddress', async () => {
    const { ipAddress, ...newTargetIPConfig } = targetIPConfig
    event.targetIPConfig = newTargetIPConfig as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail missing event.targetIPConfig', async () => {
    // need this twice to hit all the branches in
    delete event.targetIPConfig
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail missing enumerateRsp.EnumerateResponse', async () => {
    // implementationConfig.actors!.enumerateEthernetPortSettings = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    const { EnumerateResponse, ...newEnumRsp } = enumerateRsp.Envelope.Body
    enumerateRsp = newEnumRsp as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail missing pullRsp.PullResponse.Items.AMT_EthernetPortSettings', async () => {
    pullRsp.Envelope.Body.PullResponse = { EndOfSequence: 'EOS' } as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail missing pullRsp.PullResponse.Items', async () => {
    const { Items, ...newPullResponse } = pullRsp.Envelope.Body.PullResponse
    pullRsp.Envelope.Body.PullResponse = newPullResponse as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it(`should fail on ${MessageNoWiredSettingsOnDevice}`, async () => {
    pullRsp.Envelope.Body.PullResponse.Items.AMT_EthernetPortSettings = wirelessPortSettings
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it(`should fail on ${MessageWirelessOnly}`, async () => {
    wiredPortSettings.MACAddress = null as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it(`should fail on ${MessageAlreadySynchronized}`, async () => {
    targetIPConfig.ipAddress = wiredPortSettings.IPAddress as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail on bad put response', async () => {
    putRsp = null
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail enumerate response on http response error', async () => {
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockRejectedValueOnce(HttpBadRequestError)
    await runTilDone(implementation.machine, event, doneResponse, context)
  })
  it('should fail pull response on http response error', async () => {
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockResolvedValueOnce(enumerateRsp).mockRejectedValueOnce(HttpBadRequestError)
    await runTilDone(implementation.machine, event, doneResponse, context)
  })
  it('should fail put response on http response error', async () => {
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy
      .mockResolvedValueOnce(enumerateRsp)
      .mockResolvedValueOnce(pullRsp)
      .mockRejectedValueOnce(HttpBadRequestError)
    await runTilDone(implementation.machine, event, doneResponse, context)
  })
})
