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
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

const invokeWsmanCallSpy = jest.fn<any>()
const invokeEnterpriseAssistantCallSpy = jest.fn<any>()
jest.unstable_mockModule('./common.js', () => ({
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
      ClientSocket: { send: jest.fn() },
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
        createTLSCredentialContext: fromPromise(async ({ input }) => await Promise.resolve({})),
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
    jest.resetAllMocks()
    jest.useRealTimers()
  })
  it('should configure TLS', (done) => {
    jest.useFakeTimers()
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
    tlsService.subscribe((state) => {
      const expectedState: any = flowStates[currentStateIndex++]
      expect(state.matches(expectedState)).toBe(true)
      if (state.matches('WAIT_A_BIT')) {
        jest.advanceTimersByTime(5000)
      } else if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
        done()
      }
    })

    tlsService.start()
    tlsService.send({ type: 'CONFIGURE_TLS', clientId })
    jest.runAllTicks()
  })

  it('should retry', (done) => {
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
    tlsService.subscribe((state) => {
      const expected: any = flowStates[currentStateIndex++]
      expect(state.matches(expected)).toBe(true)
      if (state.matches('FAILED') || currentStateIndex === flowStates.length) {
        done()
      }
    })

    tlsService.start()
    tlsService.send({ type: 'CONFIGURE_TLS', clientId })
  })

  it('should signCSR', async () => {
    context.message = {
      response: {
        keyInstanceId: 'ABC123',
        csr: 'null'
      }
    }

    const publicKeyManagementSpy = spyOn(
      context.amt.PublicKeyManagementService,
      'GeneratePKCS10RequestEx'
    ).mockReturnValue({} as any)

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
  it('should addTrustedRootCertificate', async () => {
    devices[clientId].ClientData = { payload: { profile: { tlsCerts: { ROOT_CERTIFICATE: { certbin: '' } } } } }
    await tls.addTrustedRootCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should createTLSCredentialContext', async () => {
    const event: any = {
      output: {
        Envelope: {
          Body: {
            AddCertificate_OUTPUT: {
              CreatedCertificate: { ReferenceParameters: { SelectorSet: { Selector: { _: '' } } } }
            }
          }
        }
      }
    }
    await tls.createTLSCredentialContext({ input: { context, event } })
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
    spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
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
    spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
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
    spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
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
    spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putRemoteTLSData({ input: context })
    expect(context.tlsSettingData[0].AcceptNonSecureConnections).toBe(undefined)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should putLocalTLSData', async () => {
    context.tlsSettingData = [{}, {}]
    spyOn(forge.pki, 'certificateFromPem').mockReturnValue({ subject: { getField: () => ({}) } } as any)
    const tlsSettingDataSpy = spyOn(context.amt.TLSSettingData, 'Put').mockReturnValue('')
    await tls.putLocalTLSData({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
    expect(tlsSettingDataSpy).toHaveBeenCalled()
  })
  it('should commitChanges', async () => {
    await tls.commitChanges({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
})
