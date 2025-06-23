/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import { HttpHandler } from '../HttpHandler.js'
import { AMT, IPS } from '@device-management-toolkit/wsman-messages'
import { devices } from '../devices.js'
import { jest } from '@jest/globals'

const invokeEnterpriseAssistantCallSpy = jest.fn<any>()
jest.unstable_mockModule('./common.js', () => ({
  invokeEnterpriseAssistantCall: invokeEnterpriseAssistantCallSpy
}))

const { initiateCertRequest, sendEnterpriseAssistantKeyPairResponse, getCertFromEnterpriseAssistant } = await import(
  './enterpriseAssistant.js'
)
const clientId = randomUUID()

describe('Enterprise Assistant', () => {
  let eaConfigContext: any
  beforeEach(() => {
    // eaConfiguration = new
    eaConfigContext = {
      clientId,
      httpHandler: new HttpHandler(),
      errorMessage: '',
      xmlMessage: '',
      statusMessage: '',
      amt: new AMT.Messages(),
      ips: new IPS.Messages(),
      amtProfile: {
        profileName: 'acm',
        amtPassword: 'Intel123!',
        mebxPassword: 'Intel123!',
        activation: 'acmactivate',
        tags: ['acm'],
        dhcpEnabled: true,
        ieee8021xProfileName: 'p1',
        tenantId: ''
      },
      eaResponse: {
        rootcert:
          'MIIDhTCCAm2gAwIBAgIQSxKZZpPSAo5ACu3OFx0Y8jANBgkqhkiG9w0BAQsFADBVMRMwEQYKCZImiZPyLGQBGRYDY29tMRgwFgYKCZImiZPyLGQBGRYIdnByb2RlbW8xJDAiBgNVBAMTG3Zwcm9kZW1vLVdJTi1QRVFIRjBSTjQwVi1DQTAeFw0yMzAyMDEyMjU1NTVaFw0yODAyMDEyMzA1NTRaMFUxEzARBgoJkiaJk/IsZAEZFgNjb20xGDAWBgoJkiaJk/IsZAEZFgh2cHJvZGVtbzEkMCIGA1UEAxMbdnByb2RlbW8tV0lOLVBFUUhGMFJONDBWLUNBMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAz9eNHbevH3k/TorT4+yWJMBrk8t15Ig+yGFJWsZEgXN8/VfN9naeacPjDYxzWZOvUpWRZZMiZTAvctvUo8vi02qy2qVyHhjA+IYyMYsBEN9QNmWjpsfDvwUyJ2W4Zz3IeTjYF9LhOKvr99Z2CvAXqMKR6CmSvnvLyizJW+RkVASOavXMawWKzyKknLAUVLXP9dbT2T80oJ5irtLhOXfGgwJWVTE13V1YJ3erix0PT+cFyNCqDWR1u5JNfgUcJuzrYisBsngfWLYQilxDy8sMUVPGwV4Pz04N30ri1GGsj2BgvnLl9Q17wow5d54funPvnoa6fM33Uiad3jZoL9ABNQIDAQABo1EwTzALBgNVHQ8EBAMCAYYwDwYDVR0TAQH/BAUwAwEB/zAdBgNVHQ4EFgQUb8R8CBWHno23fZN+Y3PfS4EzW9IwEAYJKwYBBAGCNxUBBAMCAQAwDQYJKoZIhvcNAQELBQADggEBAGIIZtWeThNBTDEmrZcb6yg9U376ImdGaso637RqDzS3nFgudKrl6/cVUDvS+YKp97bK7ryPn9lLRLI66mSw5TgPUOZ7eXfAw9uuULKAPA8eO0wJsDbVKflmTFIr8THrE0Bdyq4cm9swRzKnNiu/mx2w8b3TITHsBVx+xTO5WkW32GRq4jkqYpL3FMbDUjOJ2fP5yqGVIxpUSrh7k5Bxo5eUoOevRmBMTeDeaw/f0Bs2lf/buc+zLtL15Y3ZzIJugWVF/6BtOiknD7olbI9uATq/LrHoPCOdlrxIXqqB0GDDDvOWcLrRECfUQNkH7IE27vsSs7yosCET/gRtF6UV5MU=',
        username: 'abc'
      },
      message: { Envelope: { Body: {} } },
      targetAfterError: null,
      ieee8021xProfile: null,
      addTrustedRootCertResponse: null,
      addCertResponse: null,
      authProtocol: 0
    }
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: jest.fn() } as any,
      ciraconfig: {
        TLSSettingData: { Enabled: true, AcceptNonSecureConnections: true, MutualAuthentication: true, TrustedCN: null }
      },
      network: {},
      status: {},
      tls: {},
      hostname: 'WinDev2211Eval',
      activationStatus: false,
      connectionParams: {
        guid: '4c4c4544-004b-4210-8033-b6c04f504633',
        port: 16992,
        digestChallenge: {},
        username: 'admin',
        password: 'P@ssw0rd'
      },
      uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
      messageId: 1
    } as any
  })

  it('should initiateCertRequest', async () => {
    await initiateCertRequest({ input: eaConfigContext })
    expect(eaConfigContext.message).toEqual({
      action: 'satellite',
      subaction: '802.1x-ProFile-Request',
      satelliteFlags: 2,
      nodeid: eaConfigContext.clientId,
      domain: '',
      reqid: '',
      authProtocol: 0,
      osname: 'win11',
      devname: 'WinDev2211Eval',
      icon: 1,
      cert: null,
      certid: null,
      ver: ''
    })
    expect(invokeEnterpriseAssistantCallSpy).toHaveBeenCalled()
  })

  it('should sendEnterpriseAssistantKeyPairResponse', async () => {
    eaConfigContext.keyPairHandle = 'Intel(r) AMT Key: Handle: 0'
    eaConfigContext.message = {
      Envelope: {
        Body: {
          PullResponse: {
            Items: {
              AMT_PublicPrivateKeyPair: [
                {
                  InstanceID: 'Intel(r) AMT Key: Handle: 0',
                  DERKey: 'DERKey'
                }
              ]
            }
          }
        }
      }
    }
    const expectedMessage = {
      action: 'satellite',
      subaction: '802.1x-KeyPair-Response',
      satelliteFlags: 2,
      nodeid: eaConfigContext.clientId,
      domain: '',
      reqid: '',
      devname: 'WinDev2211Eval',
      authProtocol: 0,
      osname: 'win11',
      icon: 1,
      DERKey: 'DERKey',
      keyInstanceId: 'Intel(r) AMT Key: Handle: 0',
      ver: ''
    }
    await sendEnterpriseAssistantKeyPairResponse({ input: eaConfigContext })
    expect(eaConfigContext.message).toEqual(expectedMessage)
    expect(invokeEnterpriseAssistantCallSpy).toHaveBeenCalled()
    expect(devices[eaConfigContext.clientId].tls.PublicPrivateKeyPair).toEqual([
      {
        InstanceID: 'Intel(r) AMT Key: Handle: 0',
        DERKey: 'DERKey'
      }
    ])
  })

  it('should get cert from Enterprise Assistant', async () => {
    eaConfigContext.message = {
      Envelope: {
        Body: {
          GeneratePKCS10RequestEx_OUTPUT: {
            SignedCertificateRequest: 'certificate'
          }
        }
      }
    }

    await getCertFromEnterpriseAssistant({ input: eaConfigContext })
    expect(eaConfigContext.message).toEqual({
      action: 'satellite',
      subaction: '802.1x-CSR-Response',
      satelliteFlags: 2,
      nodeid: eaConfigContext.clientId,
      domain: '',
      reqid: '',
      authProtocol: 0,
      osname: 'win11',
      devname: 'WinDev2211Eval',
      icon: 1,
      signedcsr: 'certificate',
      ver: ''
    })
    expect(invokeEnterpriseAssistantCallSpy).toHaveBeenCalled()
  })
})
