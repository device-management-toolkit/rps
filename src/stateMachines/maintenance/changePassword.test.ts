/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { isDigestRealmValid, HttpResponseError, coalesceMessage } from '../common.js'

import { type AMT, type Common } from '@device-management-toolkit/wsman-messages'
import { SecretManagerCreatorFactory } from '../../factories/SecretManagerCreatorFactory.js'
import { type DeviceCredentials, type ISecretManagerService } from '../../interfaces/ISecretManagerService.js'
import { type DoneResponse, StatusFailed, StatusSuccess } from './doneResponse.js'
import { runTilDone } from '../../test/helper/xstate.js'
import { config, setupTestClient } from '../../test/helper/Config.js'
import { Environment } from '../../utils/Environment.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'
import got from 'got'
import { type MachineImplementationsSimplified, fromPromise } from 'xstate'

import {
  type ChangePassword as ChangePasswordType,
  type ChangePasswordEvent,
  type SetAdminACLEntryExResponse,
  type ChangePasswordContext
} from './changePassword.js'

const invokeWsmanCallSpy = jest.fn<any>()
jest.unstable_mockModule('../common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  isDigestRealmValid,
  HttpResponseError,
  coalesceMessage
}))

const { ChangePassword } = await import('./changePassword.js')

Environment.Config = config

const HttpBadRequestError = new HttpResponseError('Bad Request', 400)
const HttpUnauthorizedError = new HttpResponseError('Unauthorized Request', 401)

describe('ChangePassword State Machine', () => {
  let clientId: string
  let doneResponse: DoneResponse
  let generalSettingsRsp: Common.Models.Response<AMT.Models.GeneralSettingsResponse>
  let deviceCredentials: DeviceCredentials
  let event: ChangePasswordEvent
  let implementation: ChangePasswordType
  let implementationConfig: MachineImplementationsSimplified<ChangePasswordContext, ChangePasswordEvent>
  let setAdminACLEntryExResponse: SetAdminACLEntryExResponse
  let secretWriterSpy: SpyInstance<any>
  let secretGetterSpy: SpyInstance<any>
  let mpsRsp
  let deleteSpy: SpyInstance<any>
  let context: ChangePasswordContext

  beforeEach(() => {
    jest.resetAllMocks()
    clientId = setupTestClient()
    implementation = new ChangePassword()

    generalSettingsRsp = {
      Envelope: {
        Body: {
          AMT_GeneralSettings: {
            DigestRealm: 'Digest:ABCDEF0123456789ABCDEF0123456789',
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
    deviceCredentials = {
      AMT_PASSWORD: 'existingAMTPassword',
      MEBX_PASSWORD: 'existingMEBXPassword'
    }
    event = {
      type: 'CHANGE_PASSWORD',
      clientId,
      newStaticPassword: 'testStaticPassword'
    }
    doneResponse = {
      taskName: 'changepassword',
      status: 'SUCCESS',
      message: expect.any(String)
    }
    setAdminACLEntryExResponse = {
      Envelope: {
        Body: {
          SetAdminAclEntryEx_OUTPUT: { ReturnValue: 0 }
        }
      }
    }
    mpsRsp = {
      statusCode: 200,
      statusMessage: 'OK'
    }
    context = {
      taskName: 'changepassword',
      clientId
    } as any
    implementationConfig = {
      actors: {},
      guards: {},
      actions: {},
      delays: {}
    }
    const mockSecretsManager: ISecretManagerService = {
      deleteSecretAtPath: jest.fn<any>(),
      getSecretFromKey: jest.fn<any>(),
      health: jest.fn<any>(),
      writeSecretWithObject: jest.fn<any>(),
      getSecretAtPath: jest.fn<any>()
    }
    spyOn(SecretManagerCreatorFactory.prototype, 'getSecretManager').mockResolvedValue(mockSecretsManager)
    secretGetterSpy = spyOn(mockSecretsManager, 'getSecretAtPath').mockResolvedValue(deviceCredentials)
    secretWriterSpy = spyOn(mockSecretsManager, 'writeSecretWithObject').mockResolvedValue(deviceCredentials)

    deleteSpy = spyOn(got, 'delete')
  })

  const runTheTest = async function (done?): Promise<void> {
    invokeWsmanCallSpy.mockResolvedValueOnce(generalSettingsRsp).mockResolvedValueOnce(setAdminACLEntryExResponse)
    deleteSpy.mockResolvedValue(mpsRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context, done)
  }
  it('should succeed changing password to the newStaticPassword', (done) => {
    void runTheTest(done)
  })
  it('should succeed changing password to something random on empty newStaticPassword', (done) => {
    event.newStaticPassword = null as any
    void runTheTest(done)
  })
  it('should fail on failed general settings response', (done) => {
    generalSettingsRsp = {} as any
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on bad SetAdminAclEntryEx_OUTPUT', (done) => {
    delete (setAdminACLEntryExResponse as any).Envelope.Body.SetAdminAclEntryEx_OUTPUT
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on failed SaveToSecretProvider', (done) => {
    implementationConfig.actors!.saveToSecretProvider = fromPromise(
      async ({ input }) => await Promise.reject(new Error())
    )
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail on failed refreshMPS', (done) => {
    implementationConfig.actors!.refreshMPS = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    doneResponse.status = StatusFailed
    void runTheTest(done)
  })
  it('should fail getting general settings on http response error', (done) => {
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockRejectedValueOnce(HttpBadRequestError)
    void runTilDone(implementation.machine, event, doneResponse, context, done)
  })
  it('should fail on invalid next state response', (done) => {
    implementationConfig.guards!.isGeneralSettings = () => false
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockRejectedValueOnce(HttpUnauthorizedError)
    void runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context, done)
  })
  it('should pass on empty credentials in secret manager', (done) => {
    const expectedCredentials: DeviceCredentials = {
      AMT_PASSWORD: event.newStaticPassword,
      MEBX_PASSWORD: ''
    }
    secretGetterSpy.mockResolvedValue(null)
    secretWriterSpy.mockResolvedValue(expectedCredentials)
    doneResponse.status = StatusSuccess
    void runTheTest(done)
  })
  it('should fail on save to Secret Provider', async () => {
    const x = await implementation.saveToSecretProvider({ input: context })
    expect(x).toBeFalsy()
  })
  it('should save to Secret Provider', async () => {
    context.updatedPassword = 'testPassword'
    const x = await implementation.saveToSecretProvider({ input: context })
    expect(x).toBeTruthy()
  })
  it('should create creds and save to Secret Provider', async () => {
    context.updatedPassword = 'testPassword'
    secretGetterSpy.mockResolvedValue(null)
    const x = await implementation.saveToSecretProvider({ input: context })
    expect(x).toBeTruthy()
  })
  it('should save to MPS', async () => {
    jest.spyOn(got, 'delete').mockImplementation(() => ({}) as any)
    const x = await implementation.refreshMPS({ input: context })
    expect(x).toBeTruthy()
  })
})
