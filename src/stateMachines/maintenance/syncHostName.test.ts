/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT, type Common } from '@device-management-toolkit/wsman-messages'
import { HttpResponseError, coalesceMessage } from '../common.js'
import { type DoneResponse, StatusFailed, StatusSuccess } from './doneResponse.js'
import { config, setupTestClient } from '../../test/helper/Config.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { Environment } from '../../utils/Environment.js'
import { type SpyInstance, spyOn } from 'jest-mock'
import { jest } from '@jest/globals'
import { type MachineImplementationsSimplified, fromPromise } from 'xstate'
import got from 'got'
import {
  type SyncHostNameContext,
  type HostNameInfo,
  type SyncHostName as SyncHostNameType,
  type SyncHostNameEvent
} from './syncHostName.js'

const invokeWsmanCallSpy = jest.fn<any>()
jest.unstable_mockModule('../common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  HttpResponseError,
  coalesceMessage
}))

const { SyncHostName, SyncHostNameEventType } = await import('./syncHostName.js')
let gotSpy: SpyInstance<any>

jest.mock('got')

Environment.Config = config

describe('SyncHostName State Machine', () => {
  let clientId: string
  let doneResponse: DoneResponse
  let event: SyncHostNameEvent
  let implementation: SyncHostNameType
  let implementationConfig: MachineImplementationsSimplified<SyncHostNameContext, SyncHostNameEvent>
  let hostNameInfo: HostNameInfo
  let generalSettingsRsp: Common.Models.Response<AMT.Models.GeneralSettingsResponse>
  let putRsp: any
  let mpsRsp: any
  let context: SyncHostNameContext

  beforeEach(() => {
    jest.resetAllMocks()
    clientId = setupTestClient()
    implementation = new SyncHostName()
    doneResponse = {
      taskName: 'synchostname',
      status: 'SUCCESS',
      message: expect.any(String)
    }
    hostNameInfo = {
      hostname: 'new.host.com',
      dnsSuffixOS: 'new.suffix.com'
    }
    generalSettingsRsp = {
      Envelope: {
        Body: {
          AMT_GeneralSettings: {
            HostName: 'old.host.com'
          }
        },
        Header: {
          To: '',
          RelatesTo: '',
          Action: '',
          MessageID: '',
          ResourceURI: ''
        }
      }
    }
    putRsp = {
      AMT_GeneralSettings: {
        HostName: hostNameInfo.hostname
      }
    }
    mpsRsp = {
      statusCode: 200,
      statusMessage: 'OK'
    }
    context = {
      taskName: 'synchostname',
      clientId,
      hostNameInfo,
      generalSettings: {
        Envelope: {
          Body: {}
        }
      }
    } as any
    implementationConfig = {
      actors: {
        getGeneralSettings: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: {
                Header: {},
                Body: { AMT_GeneralSettings: { HostName: 'old.host.com' } }
              }
            })
        )
        // saveToMPS: fromPromise(async ({ input }) => await Promise.resolve({}))
      },
      actions: {},
      guards: {},
      delays: {}
    }
    event = { type: SyncHostNameEventType, clientId, hostNameInfo }
    gotSpy = spyOn(got, 'patch')
  })

  const runTheTest = async function (done): Promise<void> {
    invokeWsmanCallSpy.mockResolvedValueOnce(generalSettingsRsp).mockResolvedValueOnce(putRsp)
    gotSpy.mockResolvedValue(mpsRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context, done)
  }

  it('should succeed synchronizing host name', (done) => {
    void runTheTest(done)
  })
  it('should fail on failed general settings response', (done) => {
    implementationConfig.actors!.getGeneralSettings = fromPromise(
      async ({ input }) => await Promise.reject(new Error())
    )
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on invalid hostname', (done) => {
    delete hostNameInfo.hostname
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail if already synchronized invalid hostname', (done) => {
    hostNameInfo.hostname = generalSettingsRsp.Envelope.Body.AMT_GeneralSettings?.HostName as any
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on failed put general settings response', (done) => {
    implementationConfig.actors!.putGeneralSettings = fromPromise(
      async ({ input }) => await Promise.reject(new Error())
    )
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on failed save to mps response', (done) => {
    implementationConfig.actors!.saveToMPS = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should succeed put AMT_GeneralSettings response', (done) => {
    doneResponse.status = StatusSuccess
    void runTheTest(done)
  })
  it('should send WSMan to get amt general settings', async () => {
    await implementation.getGeneralSettings({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should save to MPS', async () => {
    jest.spyOn(got, 'patch').mockImplementation(() => mpsRsp)
    const x = await implementation.saveToMPS({ input: context })
    expect(x).toEqual(hostNameInfo.hostname)
  })
  it('should fail on bad response from MPS', (done) => {
    mpsRsp.statusCode = 404
    mpsRsp.statusMessage = 'Device not found'
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
})
