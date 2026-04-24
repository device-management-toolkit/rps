/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createActor, fromPromise } from 'xstate'
import { HttpHandler } from '../HttpHandler.js'
import { devices } from '../devices.js'
import { type TLS as TLSType, type TLSContext, type TLSEvent } from './tls.js'
import forge from 'node-forge'
import { AMT } from '@device-management-toolkit/wsman-messages'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { wsmanAlreadyExistsAllChunks } from '../test/helper/AMTMessages.js'
import { config } from '../test/helper/Config.js'
import { Environment } from '../utils/Environment.js'

import { vi } from 'vitest'
const invokeWsmanCallSpy = vi.hoisted(() => vi.fn<any>())
const invokeEnterpriseAssistantCallSpy = vi.hoisted(() => vi.fn<any>())
vi.mock('./common.js', () => ({
  invokeWsmanCall: invokeWsmanCallSpy,
  invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy
}))

const { TLS } = await import('./tls.js')

Environment.Config = config

describe('TLS State Machine', () => {
  let tls: TLSType
  let config
  let context: TLSContext
  let currentStateIndex = 0
  const clientId = '4c4c4544-004b-4210-8033-b6c04f504633'
  beforeEach(() => {
    currentStateIndex = 0
    devices[clientId] = {
      status: {},
      hostname: 'WinDev2211Eval',
      ClientSocket: { send: vi.fn() },
      tls: {}
    } as any
    context = {
      clientId,
      httpHandler: new HttpHandler(),
      message: null,
      xmlMessage: '',
      errorMessage: '',
      statusMessage: '',
      status: 'success',
      tlsSettingData: [],
      tlsCredentialContext: '',
      amtProfile: { tlsMode: 3, tlsCerts: { ISSUED_CERTIFICATE: { pem: '' } } } as any,
      unauthCount: 0,
      authProtocol: 0,
      retryCount: 0,
      amt: new AMT.Messages()
    } as any
    tls = new TLS()

    config = {
      actors: {
        timeSync: fromPromise(async ({ input }) => await Promise.resolve({})),
        errorMachine: fromPromise(async ({ input }) => await Promise.resolve({})),
        enumeratePublicKeyCertificate: fromPromise(async ({ input }) => await Promise.resolve({})),
        pullPublicKeyCertificate: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: {} } } } } })
        ),
        addTrustedRootCertificate: fromPromise(async ({ input }) => await Promise.resolve({})),
        generateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({})),
        enumeratePublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve({})),
        pullPublicPrivateKeyPair: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_PublicPrivateKeyPair: {} } } } } })
        ),
        addCertificate: fromPromise(async ({ input }) => await Promise.resolve({})),
        enumerateTLSCredentialContext: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'ctx' } } }
            })
        ),
        pullTLSCredentialContext: fromPromise(
          async ({ input }) =>
            await Promise.resolve({
              Envelope: { Body: { PullResponse: { Items: {} } } }
            })
        ),
        createTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({})),
        putTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({})),
        enumerateTLSData: fromPromise(async ({ input }) => await Promise.resolve({})),
        pullTLSData: fromPromise(
          async ({ input }) =>
            await Promise.resolve({ Envelope: { Body: { PullResponse: { Items: { AMT_TLSSettingData: [{}, {}] } } } } })
        ),
        putRemoteTLSData: fromPromise(async ({ input }) => await Promise.resolve({})),
        putLocalTLSData: fromPromise(async ({ input }) => await Promise.resolve({})),
        commitChanges: fromPromise(async ({ input }) => await Promise.resolve({}))
      },
      actions: {
        'Send Message to Device': () => {}
      }
    }
  })
  afterEach(() => {
    vi.resetAllMocks()
    vi.useRealTimers()
  })
  it('should configure TLS', () =>
    new Promise<void>((resolve, reject) => {
      vi.useFakeTimers()
      context.amtProfile = { tlsMode: 3, tlsSigningAuthoritys: 'SelfSigned' } as any
      // already existing error case is covered with this reject

      config.actors.createTlsCredentialContext = fromPromise(
        async ({ input }) =>
          await Promise.reject({
            body: {
              text: wsmanAlreadyExistsAllChunks
            }
          })
      )
      const tlsStateMachine = tls.machine.provide(config)
      const flowStates = [
        'PROVISIONED',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'ADD_TRUSTED_ROOT_CERTIFICATE',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ADD_CERTIFICATE',
        'ENUMERATE_TLS_CREDENTIAL_CONTEXT',
        'PULL_TLS_CREDENTIAL_CONTEXT',
        'CREATE_TLS_CREDENTIAL_CONTEXT',
        'SYNC_TIME',
        'ENUMERATE_TLS_DATA',
        'PULL_TLS_DATA',
        'PUT_REMOTE_TLS_DATA',
        'WAIT_A_BIT',
        'PUT_LOCAL_TLS_DATA',
        'COMMIT_CHANGES',
        'SUCCESS'
      ]

      const tlsService = createActor(tlsStateMachine, { input: context })
      tlsService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('WAIT_A_BIT')) {
              vi.advanceTimersByTime(5000)
            } else if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })

      tlsService.start()
      tlsService.send({ type: 'CONFIGURE_TLS', clientId })
      vi.runAllTicks()
    }))

  it('should PUT TLS credential context when one already exists', () =>
    new Promise<void>((resolve, reject) => {
      vi.useFakeTimers()
      currentStateIndex = 0
      context.amtProfile = { tlsMode: 3, tlsSigningAuthoritys: 'SelfSigned' } as any

      config.actors.pullTLSCredentialContext = fromPromise(
        async ({ input }) =>
          await Promise.resolve({
            Envelope: {
              Body: {
                PullResponse: {
                  Items: {
                    AMT_TLSCredentialContext: {}
                  }
                }
              }
            }
          })
      )

      const tlsStateMachine = tls.machine.provide(config)
      const flowStates = [
        'PROVISIONED',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'ADD_TRUSTED_ROOT_CERTIFICATE',
        'GENERATE_KEY_PAIR',
        'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR',
        'PULL_PUBLIC_PRIVATE_KEY_PAIR',
        'ADD_CERTIFICATE',
        'ENUMERATE_TLS_CREDENTIAL_CONTEXT',
        'PULL_TLS_CREDENTIAL_CONTEXT',
        'PUT_TLS_CREDENTIAL_CONTEXT',
        'SYNC_TIME',
        'ENUMERATE_TLS_DATA',
        'PULL_TLS_DATA',
        'PUT_REMOTE_TLS_DATA',
        'WAIT_A_BIT',
        'PUT_LOCAL_TLS_DATA',
        'COMMIT_CHANGES',
        'SUCCESS'
      ]

      const tlsService = createActor(tlsStateMachine, { input: context })
      tlsService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('WAIT_A_BIT')) {
              vi.advanceTimersByTime(5000)
            } else if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })

      tlsService.start()
      tlsService.send({ type: 'CONFIGURE_TLS', clientId })
      vi.runAllTicks()
    }))

  it('should retry', () =>
    new Promise<void>((resolve, reject) => {
      context.amtProfile = { tlsMode: 3, tlsSigningAuthoritys: 'SelfSigned' } as any
      config.actors.pullPublicKeyCertificate = fromPromise(
        async ({ input }) => await Promise.reject(new UNEXPECTED_PARSE_ERROR())
      )

      const tlsStateMachine = tls.machine.provide(config)
      const flowStates = [
        'PROVISIONED',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'ENUMERATE_PUBLIC_KEY_CERTIFICATE',
        'PULL_PUBLIC_KEY_CERTIFICATE',
        'FAILED'
      ]

      const tlsService = createActor(tlsStateMachine, { input: context })
      tlsService.subscribe({
        next: (state) => {
          try {
            const expected: any = flowStates[currentStateIndex++]
            expect(state.matches(expected)).toBe(true)
            if (state.matches('FAILED') || currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })

      tlsService.start()
      tlsService.send({ type: 'CONFIGURE_TLS', clientId })
    }))

  it('should signCSR', async () => {
    context.message = {
      response: {
        keyInstanceId: 'ABC123',
        csr: 'null'
      }
    }

    const publicKeyManagementSpy = vi
      .spyOn(context.amt.PublicKeyManagementService, 'GeneratePKCS10RequestEx')
      .mockReturnValue({} as any)

    await tls.signCSR({ input: context })

    expect(publicKeyManagementSpy).toHaveBeenCalledWith({
      KeyPair: expect.stringContaining('ABC123'),
      SigningAlgorithm: 1,
      NullSignedCertificateRequest: context.message.response.csr
    })
  })

  it('should addCertificate', async () => {
    const event: TLSEvent = {
      type: 'CONFIGURE_TLS',
      clientId: clientId as string,
      output: {
        response: ''
      }
    }
    context.message = { Envelope: { Body: { PullResponse: { Items: { AMT_PublicPrivateKeyPair: {} } } } } }
    await tls.addCertificate({ input: { context, event } })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should generateKeyPair', async () => {
    await tls.generateKeyPair({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should addTrustedRootCertificate with pre-configured cert', async () => {
    devices[clientId].ClientData = { payload: { profile: { tlsCerts: { ROOT_CERTIFICATE: { certbin: 'dGVzdA==' } } } } }
    await tls.addTrustedRootCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should addTrustedRootCertificate with MPS root cert', async () => {
    devices[clientId].ClientData = {
      payload: { profile: { ciraConfigObject: { mpsRootCertificate: 'dGVzdA==' } } }
    }
    devices[clientId].tls = { rootCertKey: forge.pki.rsa.generateKeyPair(2048).privateKey } as any
    await tls.addTrustedRootCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should throw if no root certificate available', async () => {
    devices[clientId].ClientData = { payload: { profile: {} } }
    devices[clientId].tls = {} as any
    await expect(tls.addTrustedRootCertificate({ input: context })).rejects.toThrow(
      'No root certificate available for TLS activation'
    )
  })

  it('should createTLSCredentialContext', async () => {
    context.certHandle = 'Intel(r) AMT Certificate: Handle: 1'
    const event: any = { output: {} }
    await tls.createTLSCredentialContext({ input: { context, event } })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should putTLSCredentialContext', async () => {
    context.certHandle = 'Intel(r) AMT Certificate: Handle: 1'
    const event: any = { output: {} }
    await tls.putTLSCredentialContext({ input: { context, event } })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should enumerateTLSCredentialContext', async () => {
    await tls.enumerateTLSCredentialContext({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should pullTLSCredentialContext', async () => {
    context.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: 'ctx' } } } }
    await tls.pullTLSCredentialContext({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should enumeratePublicKeyCertificate', async () => {
    await tls.enumeratePublicKeyCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should pullPublicKeyCertificate', async () => {
    context.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: '' } } } }
    await tls.pullPublicKeyCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should enumeratePublicPrivateKeyPair', async () => {
    await tls.enumeratePublicPrivateKeyPair({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should pullPublicPrivateKeyPair', async () => {
    context.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: '' } } } }
    await tls.pullPublicPrivateKeyPair({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should updateConfigurationStatus when success', async () => {
    context.status = 'success'
    context.statusMessage = 'success status message'
    tls.updateConfigurationStatus({ context })
    expect(devices[context.clientId].status.TLSConfiguration).toEqual('success status message')
    expect(invokeWsmanCallSpy).not.toHaveBeenCalled()
  })
  it('should updateConfigurationStatus when failure', async () => {
    context.status = 'error'
    context.errorMessage = 'error status message'
    tls.updateConfigurationStatus({ context })
    expect(devices[context.clientId].status.TLSConfiguration).toEqual('error status message')
    expect(invokeWsmanCallSpy).not.toHaveBeenCalled()
  })
  it('should enumerateTLSData', async () => {
    await tls.enumerateTLSData({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should pullTLSData', async () => {
    context.message = { Envelope: { Body: { EnumerateResponse: { EnumerationContext: '' } } } }
    await tls.pullTLSData({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should putRemoteTLSData on AMT 16.0 and older systems when tlsMode is not 1 or 3 and NonSecureConnectionsSupported does not exist', async () => {
    context.tlsSettingData = [{}]
    if (context.amtProfile != null) {
      context.amtProfile.tlsMode = 4
    }
    vi.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = vi.spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putRemoteTLSData({ input: context })
    expect(context.tlsSettingData[0].AcceptNonSecureConnections).toBe(true)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should putRemoteTLSData on AMT 16.0 and older systems when tlsMode is not 1 or 3', async () => {
    context.tlsSettingData = [
      {
        NonSecureConnectionsSupported: true
      }
    ]
    if (context.amtProfile != null) {
      context.amtProfile.tlsMode = 4
    }
    vi.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = vi.spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putRemoteTLSData({ input: context })
    expect(context.tlsSettingData[0].AcceptNonSecureConnections).toBe(true)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should putRemoteTLSData on AMT 16.0 and older systems when tlsMode is 1 or 3', async () => {
    context.tlsSettingData = [
      {
        NonSecureConnectionsSupported: true
      }
    ]
    vi.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = vi.spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putRemoteTLSData({ input: context })
    expect(context.tlsSettingData[0].AcceptNonSecureConnections).toBe(false)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should putRemoteTLSData on AMT 16.1 and newer systems', async () => {
    context.tlsSettingData = [
      {
        NonSecureConnectionsSupported: false
      }
    ]
    vi.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = vi.spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putRemoteTLSData({ input: context })
    expect(context.tlsSettingData[0].AcceptNonSecureConnections).toBe(undefined)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should putLocalTLSData', async () => {
    context.tlsSettingData = [{}, {}]
    vi.spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = vi.spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putLocalTLSData({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should commitChanges', async () => {
    await tls.commitChanges({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
})
