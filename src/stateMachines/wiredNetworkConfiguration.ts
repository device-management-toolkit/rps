/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT, type CIM, type IPS } from '@device-management-toolkit/wsman-messages'
import { assign, sendTo, fromPromise, setup } from 'xstate'
import Logger from '../Logger.js'
import { type AMTConfiguration } from '../models/index.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { Configurator } from '../Configurator.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { type CommonContext, invokeWsmanCall } from './common.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import {
  getCertFromEnterpriseAssistant,
  initiateCertRequest,
  sendEnterpriseAssistantKeyPairResponse
} from './enterpriseAssistant.js'
import { RPSError } from '../utils/RPSError.js'

export interface WiredConfigContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  wiredSettings: any
  retryCount: number
  ieee8021xProfile?: any
  generalSettings?: AMT.Models.GeneralSettings | null
  eaResponse?: any
  addTrustedRootCertResponse?: any
  addCertResponse?: any
  keyPairHandle?: string
  targetAfterError?: string | null
  wirelessSettings?: any
  authProtocol?: number
  amt: AMT.Messages
  ips?: IPS.Messages
  cim?: CIM.Messages
}

export interface WiredConfigEvent {
  type: 'WIREDCONFIG' | 'ONFAILED'
  clientId: string
  output?: any
}
export class WiredConfiguration {
  configurator: Configurator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()

  signCSR = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicKeyManagementService.GeneratePKCS10RequestEx({
      KeyPair:
        '<a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address><a:ReferenceParameters><w:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicPrivateKeyPair</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">' +
        (input.message.response.keyInstanceId as string) +
        '</w:Selector></w:SelectorSet></a:ReferenceParameters>',
      SigningAlgorithm: 1,
      NullSignedCertificateRequest: input.message.response.csr
    })
    return await invokeWsmanCall(input)
  }

  putEthernetPortSettings = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    /**
     * CONFIGURATION | DHCPEnabled | IpSyncEnabled | SharedStaticIp | IPAddress | SubnetMask | DefaultGwy | PrimaryDNS | SecondaryDNS
     * ------------------------------------------------------------------------------------------------------------------------------------------------
     *     DHCP      | TRUE        | TRUE          | FALSE          | NULL      | NULL       | NULL       | NULL       | NULL
     * ------------------------------------------------------------------------------------------------------------------------------------------------
     *   Static IP   | FALSE       | FALSE         | FALSE          | Required  | Required   | Optional   | Optional   | Optional
     *   Static IP   | FALSE       | TRUE          | TRUE           | NULL      | NULL       | NULL       | NULL       | NULL
     * ------------------------------------------------------------------------------------------------------------------------------------------------
     */
    if (input.amtProfile?.dhcpEnabled) {
      input.wiredSettings.DHCPEnabled = true
      input.wiredSettings.IpSyncEnabled = true
      input.wiredSettings.SharedStaticIp = false
    } else {
      input.wiredSettings.DHCPEnabled = false
      // Enable Intel AMT to synchronize to the host IP by setting IPSyncEnabled to TRUE
      // if this value is FALSE, then the IP address must be set by supplying the IPAddress property manually
      // The value can match the host IP address.
      //
      // initially, RPS always set IpSyncEnabled to true
      // there are some customers that have configured AMT with static IP different
      // from the host OS ... so ipSyncEnabled comes from the profile, but might not
      // be present.
      input.wiredSettings.IpSyncEnabled = input.amtProfile?.ipSyncEnabled ?? true
      // SharedStaticIp follows IpSyncEnabled
      input.wiredSettings.SharedStaticIp = input.wiredSettings.IpSyncEnabled
    }

    if (input.wiredSettings.DHCPEnabled || input.wiredSettings.IpSyncEnabled) {
      // When 'DHCPEnabled' property is set to true the following properties should be removed:
      // SubnetMask, DefaultGateway, IPAddress, PrimaryDNS, SecondaryDNS.
      delete input.wiredSettings.SubnetMask
      delete input.wiredSettings.DefaultGateway
      delete input.wiredSettings.IPAddress
      delete input.wiredSettings.PrimaryDNS
      delete input.wiredSettings.SecondaryDNS
    } else {
      if (!input.wiredSettings.IPAddress || !input.wiredSettings.SubnetMask) {
        throw new RPSError(
          'Invalid configuration - IPAddress and SubnetMask are required when AMT profile is static and IpSyncEnabled is false'
        )
      }
    }
    input.xmlMessage = input.amt.EthernetPortSettings.Put(input.wiredSettings)
    return await invokeWsmanCall(input, 2)
  }

  get8021xProfile = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    input.xmlMessage = input.ips?.IEEE8021xSettings.Get()
    return await invokeWsmanCall(input, 2)
  }

  put8021xProfile = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    this.logger.info('EA Response :', JSON.stringify(input.eaResponse))
    switch (input.amtProfile?.ieee8021xProfileObject?.authenticationProtocol) {
      case 0: {
        devices[input.clientId].trustedRootCertificateResponse = input.message.Envelope.Body
        input.addTrustedRootCertResponse = devices[input.clientId].trustedRootCertificateResponse
        break
      }
      case 2: {
        input.ieee8021xProfile.Password = input.eaResponse?.password
        delete input.ieee8021xProfile.PSK
        delete input.ieee8021xProfile.PACPassword
        delete input.ieee8021xProfile.ProtectedAccessCredential
        break
      }
      default: {
        this.logger.info('Not a supported protocol')
      }
    }
    input.ieee8021xProfile.AuthenticationProtocol = input.amtProfile?.ieee8021xProfileObject?.authenticationProtocol
    input.ieee8021xProfile.ElementName = `${input.ieee8021xProfile.ElementName} ${input.amtProfile?.ieee8021xProfileName}`
    input.ieee8021xProfile.PxeTimeout = input.amtProfile?.ieee8021xProfileObject?.pxeTimeout
    input.ieee8021xProfile.Username = input.eaResponse?.username
    input.ieee8021xProfile.Enabled = 2
    input.ieee8021xProfile.AvailableInS0 = true
    input.xmlMessage = input.ips?.IEEE8021xSettings.Put(input.ieee8021xProfile)
    return await invokeWsmanCall(input, 2)
  }

  setCertificates = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    const clientCertReference1 =
      input.addCertResponse?.AddCertificate_OUTPUT?.CreatedCertificate?.ReferenceParameters?.SelectorSet?.Selector?._
    const rootCertReference1 =
      input.addTrustedRootCertResponse?.AddTrustedRootCertificate_OUTPUT?.CreatedCertificate?.ReferenceParameters
        ?.SelectorSet?.Selector?._
    const rootCertReference = `<a:Address>default</a:Address><a:ReferenceParameters><w:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicKeyCertificate</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">${rootCertReference1}</w:Selector></w:SelectorSet></a:ReferenceParameters>`
    const clientCertReference = `<a:Address>default</a:Address><a:ReferenceParameters><w:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicKeyCertificate</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">${clientCertReference1}</w:Selector></w:SelectorSet></a:ReferenceParameters>`

    input.xmlMessage = input.ips?.IEEE8021xSettings.SetCertificates(rootCertReference, clientCertReference)
    return await invokeWsmanCall(input, 2)
  }

  generateKeyPair = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicKeyManagementService.GenerateKeyPair({ KeyAlgorithm: 0, KeyLength: 2048 })
    return await invokeWsmanCall(input)
  }

  enumeratePublicPrivateKeyPair = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    input.keyPairHandle =
      input.message.Envelope.Body?.GenerateKeyPair_OUTPUT?.KeyPair?.ReferenceParameters?.SelectorSet?.Selector?._
    input.xmlMessage = input.amt?.PublicPrivateKeyPair.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullPublicPrivateKeyPair = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    input.xmlMessage = input.amt?.PublicPrivateKeyPair.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  async addCertificate({ input }: { input: { context: WiredConfigContext; event: WiredConfigEvent } }): Promise<any> {
    input.context.eaResponse = input.event.output.response
    const cert = input.event.output.response.certificate
    input.context.xmlMessage = input.context.amt?.PublicKeyManagementService.AddCertificate({ CertificateBlob: cert })
    return await invokeWsmanCall(input.context)
  }

  addRadiusServerRootCertificate = async ({ input }: { input: WiredConfigContext }): Promise<any> => {
    // To Do: Needs to replace the logic with how we will pull the radius server root certificate
    devices[input.clientId].trustedRootCertificate = input.eaResponse.rootcert
    const cert = input.eaResponse.rootcert
    input.xmlMessage = input.amt?.PublicKeyManagementService.AddTrustedRootCertificate({ CertificateBlob: cert })
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: WiredConfigContext
      events: WiredConfigEvent
      actions: any
      input: WiredConfigContext
    },
    actors: {
      putEthernetPortSettings: fromPromise(this.putEthernetPortSettings),
      get8021xProfile: fromPromise(this.get8021xProfile),
      errorMachine: this.error.machine,
      generateKeyPair: fromPromise(this.generateKeyPair),
      enumeratePublicPrivateKeyPair: fromPromise(this.enumeratePublicPrivateKeyPair),
      pullPublicPrivateKeyPair: fromPromise(this.pullPublicPrivateKeyPair),
      signCSR: fromPromise(this.signCSR),
      addCertificate: fromPromise(this.addCertificate),
      addRadiusServerRootCertificate: fromPromise(this.addRadiusServerRootCertificate),
      put8021xProfile: fromPromise(this.put8021xProfile),
      setCertificates: fromPromise(this.setCertificates),
      initiateCertRequest: fromPromise(initiateCertRequest),
      getCertFromEnterpriseAssistant: fromPromise(getCertFromEnterpriseAssistant),
      sendEnterpriseAssistantKeyPairResponse: fromPromise(sendEnterpriseAssistantKeyPairResponse)
    },
    guards: {
      isNotEthernetSettingsUpdated: ({ context }) => {
        const settings: AMT.Models.EthernetPortSettings = context.message.Envelope.Body.AMT_EthernetPortSettings
        if (
          context.amtProfile != null &&
          settings.DHCPEnabled != null &&
          settings.IpSyncEnabled != null &&
          settings.SharedStaticIp != null
        ) {
          if (context.amtProfile.dhcpEnabled) {
            return !settings.DHCPEnabled || !settings.IpSyncEnabled || settings.SharedStaticIp
          } else {
            return (
              settings.DHCPEnabled ||
              settings.IpSyncEnabled !== (context.amtProfile.ipSyncEnabled ?? true) ||
              settings.SharedStaticIp !== settings.IpSyncEnabled
            )
          }
        }
        return false
      },
      is8021xProfilesExists: ({ context }) => context.amtProfile?.ieee8021xProfileName != null,
      shouldRetry: ({ context, event }) => context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR,
      isMSCHAPv2: ({ context }) => context.amtProfile?.ieee8021xProfileObject?.authenticationProtocol === 2
    },
    actions: {
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context }) => context.retryCount + 1 }),
      'Update Configuration Status': ({ context }) => {
        const device = devices[context.clientId]
        device.status.Network = context.errorMessage ?? context.statusMessage
      }
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QHcCWAnSBaAdmALsgPboDWWAxkTgGapQCu6AhvqtVgLbMUAWqeAHQBBAMIAVAJIA1YVIDyAOQDEAdUkAlAKIARUUoBikgOIBtAAwBdRKAAORWKjbUbIAB6IALADYATIIBObwBWAHZzcwAOAGYAgEZQz2DogBoQAE9EALDBX0jvaLi-aPMigN8AXwq0tEwIXAJiMkpqOkYWZxwuHn4hAAUAVXEAfS1xAAktDUUx4b75DRGAZTGpRWMl5QhqMEEBADciUl3bBnwsAl4wdDxz+3Rz2AI2HChYC2skEHtHTtcPBBxXzecy5SKhUK+aLRGJBBJpTKAiL+HzeUKRZIQ5LmTxVGoYbC3JrkKi0ehMVjsLrcPgCXaDEZjSbTWbzRbDFbiNYbZTXdAkQS2AA2rBoJE4grOF3wVxuBCw90ezwEbw+rh+Tip-0QcTi2UEoT10MiviKniiCKywUEfgScU8evN3m8MTxIFqhMaJBJrXJHSp3VpQlEk1EAGlRhMpjMRmzlqtJOslnMhsNtEt5ooVso1V8NX8vgDfBEAoJoeYQsFPLDksFLQgfHEy9EQp5yuEAolzME3R76kTvS0ye1KRwab1diGtOHI8yY3MFvGuYmNimRunM9nTHFPnYHJqXIXEMXzKXy5Xq7Fa-W4uZotbog7wr5POjksDewT+17mqS2hTOkDCdBCnGcmWjVlFw5BMkzXNMtAzJQt18Xdvn3AtQCLEtmwrYIqxre96wdbxBDCE0wg7YIQm8T86gaQhBz-P1R2pHo6UEYxZkicxTQADTmDR5CMAAZLQth2PYcEOY5BBgc5uNNNwFX5OghTAXM91+LUjwQYF8htcEHUKEpdUSG8eJIvI4hhUJol8E9vDiWjPQY39fRHQDx3YziRgUuJ+L6QSRLEvkBWFUVxVk+U-KU2wVNQNSNLQrTD0w48XRIl1Ems6zSgSTx6xBJtIQiQpyjiYIAlKZzv1cn1hwAgMvKELRFHEKZAskFZhmEJYli68RhDa+CAEUBgQ8RxKEA4jl2MAcHwa44tQJ4sGYWBHFgfBmAWrBMAARwYOB8CS-NtLShBHwq0icWdbiAlfas6wyHVu38Oy7ziSJPB+7xPF8UIavo4kh3-f0xzYlq2o6jQuq0Hq+oGob1y0MaJqm3YZpk+bFvQZbVvWzbtt2g6jq27dULO1L3EQK7rWCW6XVPR6MXrOFBG7SrIhNW9jICIGBzchrwdYoNdla9qNE67rev6pZBuG7Q0fl3l0H5dBBRFfAxXQCUcaW9AVrANaNpW4nzlJ47TvQ86acuh16cZ+6WeexFEn8DFTU7O9wSrXFqndL9gcY9zGohsWONaqY5HhsMtAATTmYRNAxyTpN2GA8A6Y3jnSBVmAwa2UpwbUG3s0Iy1KYJ7M8e9a8iNnQmtF98nKWIeNfHsA77YOhbBligO8qONBj4Y48Tvpk40VX1c1iLdairPWBzsA89sAv0CLg8S50-6Acriqa7rmF6256JAm+ltTTw+JwQFn96v7zzIfFxQBgAWWj9qUwAIWEyRRACRkKPceScU7bGmlJWagh5oME4NcZeCoGAACMhSoAoMpVA+xEG53zoXKw6obbUwBHvCuJlq4vmPg3F6gIjSCCSC3e8jluKA27kHQWj9mLPwjq1D+X94aDD-gAoBshv6gMninUKGtwra0irA+B2ckGoPQZg7Bi0sC4PXvgymRCd4XTbHhehkQHrQkSNiahiJdQBHPgwy8VEvrmFYfiOiHDQZcKai-QQgxhLCV-v-QBnVRGxwTmA6eEDMZQJkqcIUQolFoIwctNRK814by3hhO2Ph-BBDCBEWE+Vkj1l8HhJswRuZVWyKeZ0TjA4uIfm4jyHiI7eN8YI-xIiQEhIkdPKRc9ZEL2ibE04yiEmGySRo1eeDN4ELzLo0umTAghHCFEWI+TUg0PtPqE0Dt7yH0vvfOq9Sw6i2As0vxwjAkdInlPGeYUtY6wlAMuJKjEk4ImVozeO5CHFzmX4BZOTlnxDMWsyxD1QQMwCNxH6AR4he32SDJiDTw7AQljDOGCM5YKxRohLMYlwlp2gfrPGhsCamy2jtC2cB7A4CeGk22AIgQgjBBCKEMJYiOVCIU0p-hdQllvPZfK-tnEuXhaHEWg8oaS2lvDWWSNFYIU3CFNWtz556wWgbI2Jsibkr2pS6gNLpmaW3qXBloI8jMuNGy+ENDiyRCbH9PU3g4R+HyHCkOwsB7NV2P1YwihhiiCWGEiSWNdiOCgF0CgsApk6O+TpE8Z4SgXgIq7Y8tcK62tytkNsPtXV93cUi9i3rfX+u6Uq6RdzIqhvDZG2lxDjzYXPHhS82RCLWsqiREoANsjFlNFEHNnDEXHKHiMUQUwRgGEEu-UY0MpawxlojeWyNU7BqiucCg1xzg0H5JwC4aqiUasJmbclNa9F2z0plQyOUTL5UKb4aFghvphBBOidEPg+2HLFZ6yOw7R3DHHfISdKKZ1oplQutqNyy0qpXZQddWBN1EG3YS-GxsD1koWse0uZ6DLZWMnlMy1qkjWgSBWEoUQ2yprfQio54rdjCB0DoP1o7JBGFEDHJdkTdjMAgPUNdDxUB0AoMvdDOk6Y3VRM7RIrNrX2X8BCIyr5oRJBxBR0VHrPG0foyOxYTGAGsZ6TI+5ghOPcfXXx9BgmDXJSNcJh2om7rMwk8m3ShRPAcxhD4NsaIIQPWU+67hwF1Nplo5IAYyYVgaGkFMNM8h5Dfq08x1jeLl1Gb2px1ADBYBYCeOgfY1w9pECIKukz-HzPRqs-o8uB8KG1yrCfdZBQSLZAKF9AoL4no+afo0-zdHAs6GC6FqYEWNBRZiwxuLOn2rgd6QZ5LLAIBpYy1lnL6A8sFeg7x4ri0hPlf3uQo+NWLE6lCHe6IEICjWNtdkUINE2G1IOZRj9niGTDD8gFIKkhRJsfTpKeSPE4ixXiolCzVMT0kOyNaasJiTtJBKAdwEeQXOGhdNZI7jl7zVJ7q4+7qmmmphewJIS73cVBvY99rAMVlJEFUupT5MyY36LB0YyHQKLTrIhwaUpiRYjxFPNEdrebB39Fx7917BOPt6fLf0qU5O4qU4SupIHszd4M4h7XKH5ibwhEiLkJIj1gSvmsXzgd1HBCclG1IeL7VNiJZJ08Qr62zOLXeArundsqJ2Q5tfPCLZrHxBvP9a031jHoniNCQ3VHP2m80+b8bCFJv6YrfKHjbANtwC267lrHuKpe8dSsm8wQEiCF1OWeIr5nXXaFbVEVvnOvsSmIJaehhk6iR0GngEbv-C-bwskHPvvW1a6uziMIDpcrUSqAHHARAIBwFcBjupWO-N0i+WVu2WBvCn3obEDEOy+bGMFTU4VbqOv5qEGIKQojJBKCX+kos5QbSOIKPkfPXm4jmW7IEbI+Qm4M3z52MPD2ceMhRgsixhQScjchLBX50qID5AuZ2TdpFI-TPq+CNznxFAOLLKq6OJ-7Y7ASgQRjgTAELjshgErjJhPYbhIRaCQG1qAiNo2jQ4-R5AnalKOZ8rnz3j55VjZKOS9o3YH65pG6fo+TPbC747BTUEg7HgfT3rQi3gFDgqmiw63inj0EAxo6OgthOR8GV6H787G6AZSroqyoozKziASGlwkaljJDGJohFJ4R4aWKlCwFMJVRGhB687aG9z9rh6eKcQzAjxiKdJTzmHCYYjg6P4QjdhJCdiOYf42jKHmjPqeZdwV5eHvo4G15vyfwBECIDBCIBKwxBJjxBGaAhH6JcGkRQi2S3oVjWQFTrJfQlIVhZSOJAhViVCeGY4qYL6C4+JnIFHAKBFXKlG07L4kLIGtrFikSlJ6jhCFBRDl7746ECE+E8LTqGEgaYrwTYorBlF2wwFlj2Q8QIGvjggTGIh2Eew4idhc5hBFDYE9FeomBFoBp7H0ouiEbyaQjlAxC3pr6tpHY2j2rVbQrWF76z53bdE15CDCFR6-oTpTqSqzrSrzqYpvHHg1EGimiGj2TlK1yFL+73qVi5SlJPQdGpFdHV7H40bdZR7aYsbtTomXScy5DezJGvg8Q3qdhljQq2rQghDFjeadFz5QnUkiDdYjy9YhbQThaRaCQjZ0kW5UGjHX60wxBNjQhcoVRBDAjAqHbhAcyQgUIcFth3zCmQlUkC70hC58RiGE5MlJAxCBD-RojGh6gAwa6PikS3gJAtxtgvjklLFpHz7QleqzCKkx4QEqlQEIDYj+AgjOYZRXYVR54RD0KJCLJVjf7cwPGhmCB14LBMnJBfT3qojVgsoP43rvTWQQoKRFInb3HmlV5H5WmCAGBN66BFlVQuZP7FhUQP7cx57WT0IOrWSFCQjOiLEQnNl6ER4DCiAjp9RdmAmQh65My2r5A3glDnzfR-RHY4heasJVBAA */
    context: ({ input }) => ({
      clientId: input.clientId,
      amtProfile: input.amtProfile,
      wiredSettings: input.wiredSettings,
      httpHandler: input.httpHandler,
      message: input.message,
      retryCount: input.retryCount,
      amt: input.amt,
      ips: input.ips,
      cim: input.cim
    }),
    id: 'wired-network-configuration-machine',
    initial: 'ACTIVATION',
    states: {
      ACTIVATION: {
        on: {
          WIREDCONFIG: {
            actions: [
              assign({
                statusMessage: () => '',
                authProtocol: ({ context }) =>
                  context.amtProfile?.ieee8021xProfileObject != null
                    ? context.amtProfile?.ieee8021xProfileObject?.authenticationProtocol
                    : 0
              }),
              'Reset Unauth Count',
              'Reset Retry Count'
            ],
            target: 'PUT_ETHERNET_PORT_SETTINGS'
          }
        }
      },
      PUT_ETHERNET_PORT_SETTINGS: {
        invoke: {
          src: 'putEthernetPortSettings',
          input: ({ context }) => context,
          id: 'put-ethernet-port-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'CHECK_ETHERNET_PORT_SETTINGS_PUT_RESPONSE'
          },
          onError: {
            actions: assign({ errorMessage: ({ event }) => (event.error as any).message }),
            target: 'FAILED'
          }
        }
      },
      CHECK_ETHERNET_PORT_SETTINGS_PUT_RESPONSE: {
        always: [
          {
            guard: 'isNotEthernetSettingsUpdated',
            actions: assign({ errorMessage: () => 'Failed to put to ethernet port settings' }),
            target: 'FAILED'
          },
          {
            guard: 'is8021xProfilesExists',
            target: 'GET_8021X_PROFILE'
          },
          {
            target: 'SUCCESS'
          }
        ]
      },
      GET_8021X_PROFILE: {
        invoke: {
          src: 'get8021xProfile',
          input: ({ context }) => context,
          id: 'get-8021x-profile',
          onDone: {
            actions: assign({ ieee8021xProfile: ({ event }) => event.output.Envelope.Body.IPS_IEEE8021xSettings }),
            target: 'ENTERPRISE_ASSISTANT_REQUEST'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get 8021x wired profile' }),
            target: 'FAILED'
          }
        }
      },
      ENTERPRISE_ASSISTANT_REQUEST: {
        invoke: {
          src: 'initiateCertRequest',
          input: ({ context }) => context,
          id: 'enterprise-assistant-request',
          onDone: [
            {
              guard: 'isMSCHAPv2',
              actions: assign({ eaResponse: ({ event }) => (event.output as any).response }),
              target: 'ADD_RADIUS_SERVER_ROOT_CERTIFICATE'
            },
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'GENERATE_KEY_PAIR'
            }
          ],
          onError: {
            actions: assign({ errorMessage: 'Failed to initiate cert request with enterprise assistant in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      GENERATE_KEY_PAIR: {
        invoke: {
          src: 'generateKeyPair',
          input: ({ context }) => context,
          id: 'generate-key-pair',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to generate key pair in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'enumeratePublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'enumerate-public-private-key-pair',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to enumerate public private key pair in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'pullPublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'pull-public-private-key-pair',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Retry Count'],
            target: 'ENTERPRISE_ASSISTANT_RESPONSE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
            },
            {
              actions: assign({ errorMessage: 'Failed to pull public private key pair in 802.1x' }),
              target: 'FAILED'
            }
          ]
        }
      },
      ENTERPRISE_ASSISTANT_RESPONSE: {
        invoke: {
          src: 'sendEnterpriseAssistantKeyPairResponse',
          input: ({ context }) => context,
          id: 'enterprise-assistant-response',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'SIGN_CSR'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to send key pair to enterprise assistant in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      SIGN_CSR: {
        invoke: {
          src: 'signCSR',
          input: ({ context }) => context,
          id: 'sign-csr',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'GET_CERT_FROM_ENTERPRISE_ASSISTANT'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to have AMT sign CSR in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      GET_CERT_FROM_ENTERPRISE_ASSISTANT: {
        invoke: {
          src: 'getCertFromEnterpriseAssistant',
          input: ({ context }) => context,
          id: 'get-cert-from-enterprise-assistant',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ADD_CERTIFICATE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to get cert from Microsoft CA in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ADD_CERTIFICATE: {
        invoke: {
          src: 'addCertificate',
          input: ({ context, event }) => ({ context, event }),
          id: 'add-certificate',
          onDone: {
            actions: assign({ addCertResponse: ({ event }) => event.output.Envelope?.Body }),
            target: 'ADD_RADIUS_SERVER_ROOT_CERTIFICATE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to add certificate in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ADD_RADIUS_SERVER_ROOT_CERTIFICATE: {
        invoke: {
          src: 'addRadiusServerRootCertificate',
          input: ({ context }) => context,
          id: 'add-radius-server-root-certificate',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PUT_8021X_PROFILE'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to add radius server root certificate in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      PUT_8021X_PROFILE: {
        invoke: {
          src: 'put8021xProfile',
          input: ({ context }) => context,
          id: 'put-8021x-profile',
          onDone: [
            {
              guard: 'isMSCHAPv2',
              actions: assign({ message: ({ event }) => event.output }),
              target: 'SUCCESS'
            },
            {
              actions: [assign({ message: ({ event }) => event.output }), 'Reset Unauth Count'],
              target: 'SET_CERTIFICATES'
            }
          ],
          onError: {
            actions: assign({ errorMessage: 'Failed to put 802.1x profile' }),
            target: 'FAILED'
          }
        }
      },
      SET_CERTIFICATES: {
        invoke: {
          src: 'setCertificates',
          input: ({ context }) => context,
          id: 'set-certificates',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output })],
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({ errorMessage: 'Failed to set certificate in 802.1x' }),
            target: 'FAILED'
          }
        }
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'errorMachine',
          id: 'error-machine',
          input: ({ context, event }) => ({
            message: event.output,
            clientId: context.clientId
          })
        },
        on: {
          ONFAILED: 'FAILED'
        }
      },
      FAILED: {
        entry: ['Update Configuration Status'],
        type: 'final'
      },
      SUCCESS: {
        entry: [assign({ statusMessage: 'Wired Network Configured' }), 'Update Configuration Status'],
        type: 'final'
      }
    }
  })

  constructor() {
    this.configurator = new Configurator()
    this.dbFactory = new DbCreatorFactory()
    this.logger = new Logger('Network_Configuration_State_Machine')
  }
}
