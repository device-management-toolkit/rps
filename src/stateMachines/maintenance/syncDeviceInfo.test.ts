/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type DoneResponse, StatusFailed } from './doneResponse.js'
import { config, setupTestClient } from '../../test/helper/Config.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { Environment } from '../../utils/Environment.js'
import { devices } from '../../devices.js'

import { vi, type MockInstance } from 'vitest'
import { type MachineImplementationsSimplified } from 'xstate'
import got from 'got'

import { coalesceMessage, HttpResponseError } from '../common.js'

import {
  type DeviceInfo,
  type SyncDeviceInfoContext,
  type SyncDeviceInfoEvent,
  type SyncDeviceInfo as SyncDeviceInfoType
} from './syncDeviceInfo.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('../common.js', async () => {
  const actual = await vi.importActual<typeof import('../common.js')>('../common.js')
  const { coalesceMessage, HttpResponseError } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    coalesceMessage,
    HttpResponseError
  }
})

const { SyncDeviceInfo, SyncDeviceInfoEventType } = await import('./syncDeviceInfo.js')

vi.mock('got')

Environment.Config = config

describe('SyncDeviceInfo State Machine', () => {
  let clientId: string
  let doneResponse: DoneResponse
  let event: SyncDeviceInfoEvent
  let context: SyncDeviceInfoContext
  let implementation: SyncDeviceInfoType
  let implementationConfig: MachineImplementationsSimplified<SyncDeviceInfoContext, SyncDeviceInfoEvent>
  let deviceInfo: DeviceInfo
  let mpsRsp: any
  let existingDeviceInfo: any
  let gotSpy: MockInstance
  let getSpy: MockInstance

  beforeEach(() => {
    vi.resetAllMocks()
    clientId = setupTestClient()
    implementation = new SyncDeviceInfo()
    doneResponse = {
      taskName: 'syncdeviceinfo',
      status: 'SUCCESS',
      message: expect.any(String)
    }
    deviceInfo = {
      ver: '16.1.1',
      build: '1111',
      sku: '16xxx',
      currentMode: '0',
      features: 'AMT Pro Corprate',
      ipConfiguration: { ipAddress: '1.1.1.1' }
    }
    mpsRsp = {
      statusCode: 200,
      statusMessage: 'OK'
    }
    existingDeviceInfo = {
      fwVersion: '16.1.0',
      osName: 'linux',
      osVersion: '6.8.0-45-generic',
      serialNumber: 'OLD123',
      upid: { csmeId: '094BB130B1EB87DC' }
    }
    event = { type: SyncDeviceInfoEventType, clientId, deviceInfo }
    context = {
      taskName: 'syncdeviceinfo',
      clientId
    } as any
    implementationConfig = {
      actors: {
        // saveToMPS: fromPromise(async ({ input }) => await Promise.resolve({}))
      },
      actions: {},
      guards: {},
      delays: {}
    }

    gotSpy = vi.spyOn(got, 'patch')
    getSpy = vi.spyOn(got, 'get').mockResolvedValue({ body: JSON.stringify({ deviceInfo: existingDeviceInfo }) })
  })

  const runTheTest = async function (): Promise<any> {
    gotSpy.mockResolvedValue(mpsRsp)
    return await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context)
  }
  it('should succeed synchronizing device info', async () => {
    devices[clientId].uuid = '4c4c4544-004b-4210-8033-b6c04f504633'
    const finalContext = await runTheTest()
    expect(getSpy).toHaveBeenCalledWith(`${config.mps_server}/api/v1/devices/${devices[clientId].uuid}?tenantId=`)
    expect(finalContext.existingDeviceInfo).toEqual(existingDeviceInfo)
    const sent = (gotSpy.mock.calls[0][1] as any).json.deviceInfo
    expect(sent).toMatchObject({ fwVersion: '16.1.1', osName: 'linux', serialNumber: 'OLD123' })
  })
  it('should read the existing deviceInfo from MPS', async () => {
    const existing = await implementation.getDeviceFromMPS({ input: context })
    expect(existing).toEqual(existingDeviceInfo)
  })
  it('should pass the client tenant and encode the uuid in the MPS lookup', async () => {
    devices[clientId].uuid = 'abc/../stats?x=1'
    devices[clientId].ClientData = { tenantId: 'tenant A' }
    await implementation.getDeviceFromMPS({ input: context })
    expect(getSpy).toHaveBeenCalledWith(
      `${config.mps_server}/api/v1/devices/abc%2F..%2Fstats%3Fx%3D1?tenantId=tenant%20A`
    )
  })
  it('should return null when MPS has no deviceInfo for the device', async () => {
    getSpy.mockResolvedValue({ body: '' })
    expect(await implementation.getDeviceFromMPS({ input: context })).toBeNull()
    getSpy.mockResolvedValue({ body: JSON.stringify({}) })
    expect(await implementation.getDeviceFromMPS({ input: context })).toBeNull()
  })
  it('should return null when MPS answers the lookup with a non-JSON body', async () => {
    getSpy.mockResolvedValue({ body: '<html>Bad Gateway</html>' })
    const existing = await implementation.getDeviceFromMPS({ input: context })
    expect(existing).toBeNull()
  })
  it('should fail when the MPS device lookup fails', async () => {
    getSpy.mockRejectedValue(new Error('Device not found'))
    doneResponse.status = StatusFailed
    await runTheTest()
    expect(gotSpy).not.toHaveBeenCalled()
  })
  it('should save to MPS', async () => {
    gotSpy = vi.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    expect(gotSpy).toHaveBeenCalled()
  })
  it('should include host OS, serial number, and UPID in deviceInfo sent to MPS', async () => {
    const upid = { csmeId: '094BB130B1EB87DC', oemPlatformIdType: 'Not Set (0)' }
    context.deviceInfo = {
      ...deviceInfo,
      osName: 'linux',
      osVersion: '6.8.0-45-generic',
      osDistro: 'Ubuntu 24.04.1 LTS',
      serialNumber: 'PF4ABCDE',
      upid
    }
    gotSpy = vi.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    const sent = (gotSpy.mock.calls[0][1] as any).json.deviceInfo
    expect(sent).toMatchObject({
      fwVersion: '16.1.1',
      osName: 'linux',
      osVersion: '6.8.0-45-generic',
      osDistro: 'Ubuntu 24.04.1 LTS',
      serialNumber: 'PF4ABCDE',
      upid
    })
  })
  it('should keep the host inventory MPS already holds when an older rpc-go does not send it', async () => {
    context.deviceInfo = deviceInfo
    context.existingDeviceInfo = existingDeviceInfo
    gotSpy = vi.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    const sent = (gotSpy.mock.calls[0][1] as any).json.deviceInfo
    expect(sent).toMatchObject({
      fwVersion: '16.1.1',
      osName: 'linux',
      osVersion: '6.8.0-45-generic',
      serialNumber: 'OLD123',
      upid: { csmeId: '094BB130B1EB87DC' }
    })
  })
  it('should keep the stored fields the sync does not report', async () => {
    context.deviceInfo = { ...deviceInfo, osName: 'windows', osVersion: '10.0.26100' }
    context.existingDeviceInfo = {
      ...existingDeviceInfo,
      osDistro: 'Ubuntu 24.04.1 LTS',
      status: 'Activation Success',
      activatedAt: '2025-01-01T00:00:00.000Z',
      lastProvisionedAt: '2025-01-02T00:00:00.000Z'
    }
    gotSpy = vi.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    const sent = (gotSpy.mock.calls[0][1] as any).json.deviceInfo
    expect(sent).toMatchObject({
      fwVersion: '16.1.1',
      status: 'Activation Success',
      activatedAt: '2025-01-01T00:00:00.000Z',
      lastProvisionedAt: '2025-01-02T00:00:00.000Z',
      osName: 'windows',
      osVersion: '10.0.26100'
    })
    // The OS is still replaced as a unit: the stored distro belongs to the previous OS.
    expect(sent).not.toHaveProperty('osDistro')
  })
  it('should omit host inventory keys neither the client nor MPS has', async () => {
    context.deviceInfo = deviceInfo
    context.existingDeviceInfo = null
    gotSpy = vi.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    const sent = (gotSpy.mock.calls[0][1] as any).json.deviceInfo
    expect(sent).not.toHaveProperty('osName')
    expect(sent).not.toHaveProperty('serialNumber')
    expect(sent).not.toHaveProperty('upid')
  })
  it('should fail on bad response from MPS', async () => {
    mpsRsp.statusCode = 404
    mpsRsp.statusMessage = 'Device not found'
    doneResponse.status = StatusFailed
    await runTheTest()
  })
})
