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

import { vi, type MockInstance } from 'vitest'
import got from 'got'
import { type MachineImplementationsSimplified, createActor, fromPromise, waitFor } from 'xstate'

import {
  type ChangePassword as ChangePasswordType,
  type ChangePasswordEvent,
  type SetAdminACLEntryExResponse,
  type ChangePasswordContext
} from './changePassword.js'

const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('../common.js', async () => {
  const actual = await vi.importActual<typeof import('../common.js')>('../common.js')
  const { isDigestRealmValid, HttpResponseError, coalesceMessage } = actual
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    isDigestRealmValid,
    HttpResponseError,
    coalesceMessage,
    failAt: actual.failAt,
    returnValueOf: actual.returnValueOf,
    buildFailure: actual.buildFailure,

    stepFailure: actual.stepFailure,

    failureAfterErrorMachine: actual.failureAfterErrorMachine
  }
})

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
  let secretWriterSpy: MockInstance
  let secretGetterSpy: MockInstance
  let mpsRsp
  let deleteSpy: MockInstance
  let context: ChangePasswordContext

  beforeEach(() => {
    vi.resetAllMocks()
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
      deleteSecretAtPath: vi.fn(),
      getSecretFromKey: vi.fn(),
      health: vi.fn(),
      writeSecretWithObject: vi.fn(),
      getSecretAtPath: vi.fn()
    }
    vi.spyOn(SecretManagerCreatorFactory.prototype, 'getSecretManager').mockResolvedValue(mockSecretsManager)
    secretGetterSpy = vi.spyOn(mockSecretsManager, 'getSecretAtPath').mockResolvedValue(deviceCredentials)
    secretWriterSpy = vi.spyOn(mockSecretsManager, 'writeSecretWithObject').mockResolvedValue(deviceCredentials)

    deleteSpy = vi.spyOn(got, 'delete')
  })

  const runTheTest = async function (): Promise<void> {
    invokeWsmanCallSpy.mockResolvedValueOnce(generalSettingsRsp).mockResolvedValueOnce(setAdminACLEntryExResponse)
    deleteSpy.mockResolvedValue(mpsRsp)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context)
  }
  it('should succeed changing password to the newStaticPassword', async () => {
    await runTheTest()
  })
  it('should succeed changing password to something random on empty newStaticPassword', async () => {
    event.newStaticPassword = null as any
    await runTheTest()
  })
  it('should fail on failed general settings response', async () => {
    generalSettingsRsp = {} as any
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail on bad SetAdminAclEntryEx_OUTPUT', async () => {
    delete (setAdminACLEntryExResponse as any).Envelope.Body.SetAdminAclEntryEx_OUTPUT
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should map a non-zero SetAdminAclEntryEx ReturnValue to a structured AMT failure', async () => {
    setAdminACLEntryExResponse.Envelope.Body.SetAdminAclEntryEx_OUTPUT.ReturnValue = 2054
    invokeWsmanCallSpy.mockResolvedValueOnce(generalSettingsRsp).mockResolvedValueOnce(setAdminACLEntryExResponse)
    const actor = createActor(implementation.machine.provide(implementationConfig), { input: context })
    actor.start()
    actor.send(event)
    const state = await waitFor(actor, (s) => s.status === 'done')
    expect(state.output.status).toBe(StatusFailed)
    expect(state.context.errorMessage).toBe('at SET_ADMIN_ACL_ENTRY ReturnValue PT_STATUS_INVALID_PASSWORD')
    expect(state.context.failure).toEqual({
      Code: 'AMT_PT_INVALID_PASSWORD',
      Component: 'Maintenance',
      Step: 'SET_ADMIN_ACL_ENTRY',
      Reason: 'Password does not meet AMT requirements',
      AmtReturnValue: 2054,
      Detail: 'ReturnValue PT_STATUS_INVALID_PASSWORD'
    })
    expect(state.output.failure).toEqual(state.context.failure)
  })
  it('should carry a structured WSMAN_BAD_REQUEST failure through the error machine', async () => {
    // The WSMAN path rejects with the parsed AMT response itself.
    invokeWsmanCallSpy.mockRejectedValueOnce({ statusCode: 400, statusMessage: 'Bad Request' })
    const actor = createActor(implementation.machine, { input: context })
    actor.start()
    actor.send(event)
    const state = await waitFor(actor, (s) => s.status === 'done')
    expect(state.output.status).toBe(StatusFailed)
    expect(state.context.failure).toMatchObject({
      Code: 'WSMAN_BAD_REQUEST',
      Component: 'Maintenance',
      Step: 'GET_GENERAL_SETTINGS',
      HttpStatus: 400
    })
    expect(state.output.failure).toEqual(state.context.failure)
  })
  it('should tag secret provider failures with RPS_SECRETS_WRITE_FAILED', async () => {
    implementationConfig.actors!.saveToSecretProvider = fromPromise(
      async ({ input }) => await Promise.reject(new Error('vault sealed'))
    )
    invokeWsmanCallSpy.mockResolvedValueOnce(generalSettingsRsp).mockResolvedValueOnce(setAdminACLEntryExResponse)
    const actor = createActor(implementation.machine.provide(implementationConfig), { input: context })
    actor.start()
    actor.send(event)
    const state = await waitFor(actor, (s) => s.status === 'done')
    expect(state.output.status).toBe(StatusFailed)
    expect(state.context.failure).toEqual({
      Code: 'RPS_SECRETS_WRITE_FAILED',
      Component: 'Maintenance',
      Step: 'SAVE_TO_SECRET_PROVIDER',
      Reason: 'Secret could not be written to the secret provider',
      Detail: 'vault sealed'
    })
  })
  it('should fail on failed SaveToSecretProvider', async () => {
    implementationConfig.actors!.saveToSecretProvider = fromPromise(
      async ({ input }) => await Promise.reject(new Error())
    )
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail on failed refreshMPS', async () => {
    implementationConfig.actors!.refreshMPS = fromPromise(async ({ input }) => await Promise.reject(new Error()))
    doneResponse.status = StatusFailed
    await runTheTest()
  })
  it('should fail getting general settings on http response error', async () => {
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockRejectedValueOnce(HttpBadRequestError)
    await runTilDone(implementation.machine, event, doneResponse, context)
  })
  it('should fail on invalid next state response', async () => {
    implementationConfig.guards!.isGeneralSettings = () => false
    doneResponse.status = StatusFailed
    invokeWsmanCallSpy.mockRejectedValueOnce(HttpUnauthorizedError)
    await runTilDone(implementation.machine.provide(implementationConfig), event, doneResponse, context)
  })
  it('should pass on empty credentials in secret manager', async () => {
    const expectedCredentials: DeviceCredentials = {
      AMT_PASSWORD: event.newStaticPassword,
      MEBX_PASSWORD: ''
    }
    secretGetterSpy.mockResolvedValue(null)
    secretWriterSpy.mockResolvedValue(expectedCredentials)
    doneResponse.status = StatusSuccess
    await runTheTest()
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
    vi.spyOn(got, 'delete').mockImplementation(() => ({}) as any)
    const x = await implementation.refreshMPS({ input: context })
    expect(x).toBeTruthy()
  })
})
