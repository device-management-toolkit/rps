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
vi.mock('./common.js', async () => {
  const actual = await vi.importActual<typeof import('./common.js')>('./common.js')
  return {
    invokeWsmanCall: invokeWsmanCallSpy,
    invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy,
    sendProgressToDevice: vi.fn(),
    recordComponentResult: actual.recordComponentResult
  }
})

const { TLS } = await import('./tls.js')

Environment.Config = config

// AMT returns the public half of the firmware-held key pair as a bare base64
// SubjectPublicKeyInfo. RPS must sign the TLS leaf over exactly this key, so
// tests have to supply a real one rather than an empty object.
const TEST_KEY_PAIR_HANDLE = 'Intel(r) AMT Key: Handle: 0'
const TEST_DER_KEY = forge.pki
  .publicKeyToPem(forge.pki.rsa.generateKeyPair(2048).publicKey)
  .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
  .replace(/\s/g, '')

const testKeyPairPullResponse = {
  Envelope: {
    Body: {
      PullResponse: {
        Items: {
          AMT_PublicPrivateKeyPair: { InstanceID: TEST_KEY_PAIR_HANDLE, DERKey: TEST_DER_KEY }
        }
      }
    }
  }
}

const generateKeyPairSuccess = {
  Envelope: {
    Body: {
      GenerateKeyPair_OUTPUT: {
        ReturnValue: 0,
        KeyPair: { ReferenceParameters: { SelectorSet: { Selector: { _: TEST_KEY_PAIR_HANDLE } } } }
      }
    }
  }
}

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
        generateKeyPair: fromPromise(async ({ input }) => await Promise.resolve(generateKeyPairSuccess)),
        enumeratePublicPrivateKeyPair: fromPromise(async ({ input }: { input: TLSContext }) => {
          // Mirror the real actor: it records the handle GenerateKeyPair returned.
          input.keyPairHandle =
            input.message?.Envelope?.Body?.GenerateKeyPair_OUTPUT?.KeyPair?.ReferenceParameters?.SelectorSet?.Selector?._
          return await Promise.resolve({})
        }),
        pullPublicPrivateKeyPair: fromPromise(async ({ input }) => await Promise.resolve(testKeyPairPullResponse)),
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
    context.keyPairHandle = TEST_KEY_PAIR_HANDLE
    context.message = testKeyPairPullResponse
    await tls.addCertificate({ input: { context, event } })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  it('should refuse to addCertificate when AMT returned no key pair', async () => {
    // AMT 22 rejected GenerateKeyPair with 2066, so no handle and no DERKey.
    // Signing a locally invented key here is what produced the HTTP 400 on
    // Put AMT_TLSCredentialContext three requests later.
    const event: TLSEvent = { type: 'CONFIGURE_TLS', clientId, output: { response: '' } }
    context.keyPairHandle = undefined
    context.message = { Envelope: { Body: { PullResponse: { Items: { AMT_PublicPrivateKeyPair: {} } } } } }

    await expect(tls.addCertificate({ input: { context, event } })).rejects.toThrow(/No AMT public key available/)
    expect(invokeWsmanCallSpy).not.toHaveBeenCalled()
  })

  it('should sign an AMT 22 TLS certificate with the AMT 22 policy', async () => {
    const event: TLSEvent = {
      type: 'CONFIGURE_TLS',
      clientId: clientId as string,
      output: { response: '' }
    }
    devices[clientId].ClientData = { payload: { ver: '22.0.0' } }
    context.keyPairHandle = TEST_KEY_PAIR_HANDLE
    context.message = testKeyPairPullResponse
    const signSpy = vi.spyOn(tls.certManager, 'amtCertSignWithCAKey')
    const createCertificateSpy = vi.spyOn(tls.certManager, 'createCertificate')

    await tls.addCertificate({ input: { context, event } })

    // sha384: AMT 22's TlsProvisionVerifyLeafCertificate() no longer accepts a
    // SHA-256 leaf, and rejects it at Put AMT_TLSCredentialContext with a bare
    // AMT-STATUS 1. The digest must reach both the leaf and the root RPS mints.
    expect(signSpy.mock.calls[0][6]).toBe('sha384')
    // rsaKeySize must reach amtCertSignWithCAKey, not just createCertificate for
    // the root, otherwise the AMT 22 policy size is silently dropped.
    expect(signSpy.mock.calls[0][7]).toBe(3072)
    expect(createCertificateSpy.mock.calls[0][6]).toBe('sha384')
    expect(createCertificateSpy.mock.calls[0][7]).toBe(3072)
  })

  it.each([
    // The SDK allows exactly two key pairs: KeyAlgorithm 0 / RSA-2048 and
    // KeyAlgorithm 1 / ECC-384. Any other size returns 2066 PT_STATUS_UNSUPPORTED.
    { version: '21.0.6', expected: { KeyAlgorithm: 0, KeyLength: 2048 } },
    { version: '22.0.0', expected: { KeyAlgorithm: 1, KeyLength: 384 } }
  ])('should ask AMT $version for the key pair its generation binds', async ({ version, expected }) => {
    devices[clientId].ClientData = { payload: { ver: version } }
    const generateKeyPairSpy = vi
      .spyOn(context.amt.PublicKeyManagementService, 'GenerateKeyPair')
      .mockReturnValue({} as any)

    await tls.generateKeyPair({ input: context })

    expect(generateKeyPairSpy).toHaveBeenCalledWith(expected)
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })

  describe('getGenerateKeyPairFailure', () => {
    it('accepts a successful response that carries a key pair handle', () => {
      expect(TLS.getGenerateKeyPairFailure(generateKeyPairSuccess)).toBeNull()
    })

    it('reports the decoded PT status for the AMT 22 RSA-3072 rejection', () => {
      const response = { Envelope: { Body: { GenerateKeyPair_OUTPUT: { ReturnValue: 2066 } } } }
      expect(TLS.getGenerateKeyPairFailure(response)).toContain('2066 (PT_STATUS_UNSUPPORTED)')
    })

    it('rejects a zero ReturnValue with no key pair handle', () => {
      const response = { Envelope: { Body: { GenerateKeyPair_OUTPUT: { ReturnValue: 0 } } } }
      expect(TLS.getGenerateKeyPairFailure(response)).toContain('no key pair handle')
    })

    it('rejects a response with no GenerateKeyPair_OUTPUT at all', () => {
      expect(TLS.getGenerateKeyPairFailure({ Envelope: { Body: {} } })).toContain('no GenerateKeyPair_OUTPUT')
    })
  })
  it('should addTrustedRootCertificate with pre-configured cert', async () => {
    devices[clientId].ClientData = { payload: { profile: { tlsCerts: { ROOT_CERTIFICATE: { certbin: 'dGVzdA==' } } } } }
    await tls.addTrustedRootCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should addTrustedRootCertificate with MPS root cert from vault', async () => {
    devices[clientId].ClientData = { payload: { profile: {} } }
    devices[clientId].tls = {
      rootCertKey: forge.pki.rsa.generateKeyPair(2048).privateKey,
      mpsRootCertPEM: '-----BEGIN CERTIFICATE-----\ndGVzdA==\n-----END CERTIFICATE-----'
    } as any
    await tls.addTrustedRootCertificate({ input: context })
    expect(invokeWsmanCallSpy).toHaveBeenCalled()
  })
  it('should addTrustedRootCertificate with MPS root cert from profile', async () => {
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

  it('should forward the pulled credential context to Put so the device instance is echoed', async () => {
    // A Put has no header SelectorSet; AMT matches the instance from the body.
    // Hand-building ElementProvidingContext instead of echoing what the device
    // reported is rejected with HTTP 500 on AMT 22.
    const deviceContext = {
      ElementInContext: {
        Address: 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous',
        ReferenceParameters: {
          ResourceURI: 'http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicKeyCertificate',
          SelectorSet: { Selector: { _: 'Intel(r) AMT Certificate: Handle: 0', $: { Name: 'InstanceID' } } }
        }
      },
      ElementProvidingContext: {
        Address: 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous',
        ReferenceParameters: {
          ResourceURI: 'http://intel.com/wbem/wscim/1/amt-schema/1/AMT_TLSProtocolEndpointCollection',
          SelectorSet: { Selector: { _: 'TLSProtocolEndpoint Instances Collection', $: { Name: 'ElementName' } } }
        }
      }
    }
    context.certHandle = 'Intel(r) AMT Certificate: Handle: 2'
    context.message = {
      Envelope: { Body: { PullResponse: { Items: { AMT_TLSCredentialContext: deviceContext } } } }
    }
    const putSpy = vi.spyOn(context.amt.TLSCredentialContext, 'Put')

    await tls.putTLSCredentialContext({ input: { context, event: { output: {} } as any } })

    expect(putSpy).toHaveBeenCalledWith('Intel(r) AMT Certificate: Handle: 2', deviceContext)
    expect(context.xmlMessage).toContain('TLSProtocolEndpoint Instances Collection')
    expect(context.xmlMessage).not.toContain('TLSProtocolEndpointInstances Collection')
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
    expect(devices[context.clientId].status.Components?.TLS).toEqual({
      Result: 'Success',
      Details: 'Success status message'
    })
    expect(invokeWsmanCallSpy).not.toHaveBeenCalled()
  })
  it('should updateConfigurationStatus when failure', async () => {
    context.status = 'error'
    context.errorMessage = 'error status message'
    tls.updateConfigurationStatus({ context })
    expect(devices[context.clientId].status.TLSConfiguration).toEqual('error status message')
    expect(devices[context.clientId].status.Components?.TLS).toEqual({
      Result: 'Failure',
      Details: 'Error status message'
    })
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

  it('should run full TLS flow including TLS settings Put for post-provisioning', () =>
    new Promise<void>((resolve, reject) => {
      vi.useFakeTimers()
      currentStateIndex = 0
      context.amtProfile = { tlsMode: 3, tlsSigningAuthoritys: 'SelfSigned' } as any

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
      tlsService.subscribe((state) => {
        const expectedState: any = flowStates[currentStateIndex++]
        expect(state.matches(expectedState)).toBe(true)
        if (state.matches('WAIT_A_BIT')) {
          vi.advanceTimersByTime(5000)
        } else if (state.matches('SUCCESS') && currentStateIndex === flowStates.length) {
          resolve()
        }
      })

      tlsService.start()
      tlsService.send({ type: 'CONFIGURE_TLS', clientId })
      vi.runAllTicks()
    }))
})
