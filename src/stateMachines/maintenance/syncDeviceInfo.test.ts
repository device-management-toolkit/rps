/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type DoneResponse, StatusFailed } from './doneResponse.js'
import { config, setupTestClient } from '../../test/helper/Config.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { Environment } from '../../utils/Environment.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
import { type MachineImplementationsSimplified } from 'xstate'
import got from 'got'

import { coalesceMessage, HttpResponseError } from '../common.js'

import {
  type DeviceInfo,
  type SyncDeviceInfoContext,
  type SyncDeviceInfoEvent,
  type SyncDeviceInfo as SyncDeviceInfoType
} from './syncDeviceInfo.js'

const invokeWsmanCallSpy = jest.fn<any>()
jest.unstable_mockModule('../common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  coalesceMessage,
  HttpResponseError
}))

const { SyncDeviceInfo, SyncDeviceInfoEventType } = await import('./syncDeviceInfo.js')

jest.mock('got')

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
  let gotSpy: jest.Spied<any>

  beforeEach(() => {
    jest.resetAllMocks()
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

    gotSpy = spyOn(got, 'patch')
  })

  const runTheTest = async function (done): Promise<void> {
    gotSpy.mockResolvedValue(mpsRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context, done)
  }

  it('should succeed synchronizing device info', (done) => {
    void runTheTest(done)
  })
  it('should save to MPS', async () => {
    gotSpy = spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    await implementation.saveToMPS({ input: context })
    expect(gotSpy).toHaveBeenCalled()
  })
  it('should fail on bad response from MPS', (done) => {
    mpsRsp.statusCode = 404
    mpsRsp.statusMessage = 'Device not found'
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
})
