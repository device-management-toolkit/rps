/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@open-amt-cloud-toolkit/wsman-messages'
import { assign, fromPromise, setup } from 'xstate'
import { CertManager } from '../certManager.js'
import { Configurator } from '../Configurator.js'
import Logger from '../Logger.js'
import got from 'got'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { type CIRAConfig, ClientAction } from '../models/RCS.Config.js'
import { NodeForge } from '../NodeForge.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { Environment } from '../utils/Environment.js'
import { PasswordHelper } from '../utils/PasswordHelper.js'
import { SignatureHelper } from '../utils/SignatureHelper.js'
import { Validator } from '../Validator.js'
import { devices } from '../devices.js'
import { type AMTConfiguration } from '../models/index.js'
import { randomUUID } from 'node:crypto'
import { Error } from './error.js'
import { type CommonContext, invokeWsmanCall } from './common.js'

export interface CIRAConfigContext extends CommonContext {
  status: 'success' | 'error' | 'wsman' | 'heartbeat_request'
  ciraConfig: CIRAConfig | null
  profile: AMTConfiguration
  privateCerts?: any[]
  amt?: AMT.Messages
  retryCount: number
  tenantId: string
  remoteAccessPolicies: any[]
}

export interface CIRAConfigEvent {
  type: 'CONFIGURE_CIRA' | 'ONFAILED'
  clientId: string
  output: any
  tenantId: string
}

export enum MPSType {
  ExternalMPS = 0,
  InternalMPS = 1,
  Both = 2
}

// TODO: [tech debt] - name confusion/collision
// CIRAConfiguration means different things in different places
export class CIRAConfiguration {
  nodeForge: NodeForge
  certManager: CertManager
  signatureHelper: SignatureHelper
  configurator: Configurator
  validator: Validator
  logger: Logger
  dbFactory: DbCreatorFactory
  db: any
  error: Error = new Error()
  saveMPSPasswordToSecretProvider = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    const data = await this.configurator.secretsManager.writeSecretWithObject(
      `devices/${devices[input.clientId].uuid}`,
      {
        MPS_PASSWORD: input.ciraConfig?.password,
        AMT_PASSWORD: devices[input.clientId].amtPassword,
        MEBX_PASSWORD:
          devices[input.clientId].action === ClientAction.ADMINCTLMODE ? devices[input.clientId].mebxPassword : null
      }
    )
    return data
  }

  getMPSPassword = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    const data = await this.configurator.secretsManager.getSecretAtPath(`CIRAConfigs/${input.ciraConfig?.configName}`)
    return data
  }

  getCIRAConfig = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    const data = await this.configurator.profileManager.getCiraConfiguration(input.profile.profileName, input.tenantId)
    return data
  }

  saveDeviceToMPS = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    const data = await got(`${Environment.Config.mps_server}/api/v1/devices`, {
      method: 'POST',
      json: {
        guid: devices[input.clientId].uuid,
        hostname: devices[input.clientId].hostname,
        mpsusername: input.ciraConfig?.username,
        tags: input.profile?.tags ?? [],
        tenantId: input.ciraConfig?.tenantId
      }
    })
    return data
  }

  enumerateManagementPresenceRemoteSAP = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.ManagementPresenceRemoteSAP.Enumerate()
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in enumerateManagementPresenceRemoteSAP()')
    }
  }

  pullManagementPresenceRemoteSAP = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      // TODO: [tech debt] uncouple nested dependency for wrapped message
      input.xmlMessage = input.amt.ManagementPresenceRemoteSAP.Pull(
        input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullManagementPresenceRemoteSAP()')
    }
  }

  addRemoteAccessPolicyRule = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      const selector = {
        name: 'Name',
        value: input.message.Envelope.Body.PullResponse.Items.AMT_ManagementPresenceRemoteSAP.Name
      }
      const policy: AMT.Models.RemoteAccessPolicyRule = {
        Trigger: 2, // 2 – Periodic
        TunnelLifeTime: 0, // 0 means that the tunnel should stay open until it is closed
        ExtendedData: 'AAAAAAAAABk=' // Equals to 25 seconds in base 64 with network order.
      }
      input.xmlMessage = input.amt.RemoteAccessService.AddRemoteAccessPolicyRule(policy, selector)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in addRemoteAccessPolicyRule()')
    }
  }

  addUserInitiatedRemoteAccessPolicyRule = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      const selector = {
        name: 'Name',
        value: input.message.Envelope.Body.PullResponse.Items.AMT_ManagementPresenceRemoteSAP.Name
      }
      const policy: AMT.Models.RemoteAccessPolicyRule = {
        Trigger: 0, // 0 – User Initiated
        TunnelLifeTime: 300, // 300 seconds
        ExtendedData: '' // Empty for User Initiated
      }
      input.xmlMessage = input.amt.RemoteAccessService.AddRemoteAccessPolicyRule(policy, selector)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in addUserInitiatedRemoteAccessPolicyRule()')
    }
  }

  getEnvironmentDetectionSettings = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.EnvironmentDetectionSettingData.Get()
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in getEnvironmentDetectionSettings()')
    }
  }

  putEnvironmentDetectionSettings = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null && Environment.Config != null) {
      const envSettings: AMT.Models.EnvironmentDetectionSettingData =
        input.message.Envelope.Body.AMT_EnvironmentDetectionSettingData
      if (Environment.Config.disable_cira_domain_name) {
        envSettings.DetectionStrings = [Environment.Config.disable_cira_domain_name]
      } else {
        envSettings.DetectionStrings = [`${randomUUID()}.com`]
      }
      input.xmlMessage = input.amt.EnvironmentDetectionSettingData.Put(envSettings)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in putEnvironmentDetectionSettings()')
    }
  }

  addTrustedRootCertificate = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.PublicKeyManagementService.AddTrustedRootCertificate({
        CertificateBlob: input.ciraConfig?.mpsRootCertificate ?? ''
      })
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in addTrustedRootCertificate()')
    }
  }

  addMPS = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      const server: AMT.Models.MPServer = {
        AccessInfo: input.ciraConfig?.mpsServerAddress,
        InfoFormat: input.ciraConfig?.serverAddressFormat,
        Port: input.ciraConfig?.mpsPort,
        AuthMethod: input.ciraConfig?.authMethod,
        Username: input.ciraConfig?.username,
        Password: input.ciraConfig?.password
      }
      if (input.ciraConfig?.serverAddressFormat === 3 && input.ciraConfig?.commonName) {
        server.CommonName = input.ciraConfig.commonName
      }
      input.xmlMessage = input.amt.RemoteAccessService.AddMPS(server)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in addMPS()')
    }
  }

  enumerateRemoteAccessPolicyAppliesToMPS = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.RemoteAccessPolicyAppliesToMPS.Enumerate()
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in enumerateRemoteAccessPolicyAppliesToMPS()')
    }
  }

  pullRemoteAccessPolicyAppliesToMPS = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.RemoteAccessPolicyAppliesToMPS.Pull(
        input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
      )
      return await invokeWsmanCall(input)
    } else {
      this.logger.error('Null object in pullRemoteAccessPolicyAppliesToMPS()')
    }
  }

  putRemoteAccessPolicyAppliesToMPS = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      const data = input.remoteAccessPolicies.length > 0 ? input.remoteAccessPolicies[0] : input.remoteAccessPolicies
      data.MpsType = MPSType.Both
      data.OrderOfAccess = 0

      let policySelector
      try {
        policySelector = data.PolicySet.ReferenceParameters.SelectorSet.Selector.find(
          (selector: any) => selector.$?.Name === 'PolicyRuleName'
        )
      } catch (err) {
        this.logger.error('Error in putRemoteAccessPolicyAppliesToMPS()', err)
      }

      const policyName = policySelector?._
      const baseXml = input.amt.RemoteAccessPolicyAppliesToMPS.Put(data)
      const customSelector = `</w:OperationTimeout><wsman:SelectorSet xmlns:wsman="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><wsman:Selector Name="ManagedElement"><EndpointReference xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://intel.com/wbem/wscim/1/amt-schema/1/AMT_ManagementPresenceRemoteSAP</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="CreationClassName">AMT_ManagementPresenceRemoteSAP</Selector><Selector Name="Name">Intel(r) AMT:Management Presence Server 0</Selector><Selector Name="SystemCreationClassName">CIM_ComputerSystem</Selector><Selector Name="SystemName">Intel(r) AMT</Selector></SelectorSet></ReferenceParameters></EndpointReference></wsman:Selector><wsman:Selector Name="PolicySet"><EndpointReference xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://intel.com/wbem/wscim/1/amt-schema/1/AMT_RemoteAccessPolicyRule</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="CreationClassName">AMT_RemoteAccessPolicyRule</Selector><Selector Name="PolicyRuleName">${policyName}</Selector><Selector Name="SystemCreationClassName">CIM_ComputerSystem</Selector><Selector Name="SystemName">Intel(r) AMT</Selector></SelectorSet></ReferenceParameters></EndpointReference></wsman:Selector></wsman:SelectorSet>`
      input.xmlMessage = baseXml.replace('</w:OperationTimeout>', customSelector.trim())

      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in putRemoteAccessPolicyAppliesToMPS()')
    }
  }

  userInitiatedConnectionService = async ({ input }: { input: CIRAConfigContext }): Promise<any> => {
    if (input.amt != null) {
      input.xmlMessage = input.amt.UserInitiatedConnectionService.RequestStateChange(32771)
      return await invokeWsmanCall(input, 2)
    } else {
      this.logger.error('Null object in userInitiatedConnectionService()')
    }
  }

  machine = setup({
    types: {} as {
      context: CIRAConfigContext
      events: CIRAConfigEvent
      actions: any
      input: any
    },
    actors: {
      addTrustedRootCertificate: fromPromise(this.addTrustedRootCertificate),
      addMPS: fromPromise(this.addMPS),
      enumerateManagementPresenceRemoteSAP: fromPromise(this.enumerateManagementPresenceRemoteSAP),
      pullManagementPresenceRemoteSAP: fromPromise(this.pullManagementPresenceRemoteSAP),
      addRemoteAccessPolicyRule: fromPromise(this.addRemoteAccessPolicyRule),
      enumerateRemoteAccessPolicyAppliesToMPS: fromPromise(this.enumerateRemoteAccessPolicyAppliesToMPS),
      addUserInitiatedRemoteAccessPolicyRule: fromPromise(this.addUserInitiatedRemoteAccessPolicyRule),
      pullRemoteAccessPolicyAppliesToMPS: fromPromise(this.pullRemoteAccessPolicyAppliesToMPS),
      putRemoteAccessPolicyAppliesToMPS: fromPromise(this.putRemoteAccessPolicyAppliesToMPS),
      userInitiatedConnectionService: fromPromise(this.userInitiatedConnectionService),
      getEnvironmentDetectionSettings: fromPromise(this.getEnvironmentDetectionSettings),
      putEnvironmentDetectionSettings: fromPromise(this.putEnvironmentDetectionSettings),
      getMPSPassword: fromPromise(this.getMPSPassword),
      getCIRAConfig: fromPromise(this.getCIRAConfig),
      saveDeviceToMPS: fromPromise(this.saveDeviceToMPS),
      saveMPSPasswordToSecretProvider: fromPromise(this.saveMPSPasswordToSecretProvider)
    },
    guards: {
      userInitiatedConnectionServiceSuccessful: ({ event }) =>
        event.output.Envelope.Body?.RequestStateChange_OUTPUT?.ReturnValue === 0,
      shouldRetry: ({ context, event }) => context.retryCount < 3 && event.output instanceof UNEXPECTED_PARSE_ERROR,
      isRemoteAccessPolicyExists: ({ context }) => {
        context.remoteAccessPolicies = context.remoteAccessPolicies.slice(1)
        if (context.remoteAccessPolicies.length > 0) {
          return true
        }
        return false
      }
    },
    actions: {
      'Update Configuration Status': ({ context, event }) => {
        devices[context.clientId].status.CIRAConnection = context.statusMessage
      },
      'Reset Unauth Count': ({ context, event }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Reset Retry Count': assign({ retryCount: ({ context, event }) => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context, event }) => context.retryCount + 1 })
    }
  }).createMachine({
    context: ({ input }) => ({
      clientId: input.clientId,
      httpHandler: input.httpHandler,
      status: input.status,
      errorMessage: input.errorMessage,
      xmlMessage: input.xmlMessage,
      statusMessage: input.statusMessage,
      message: input.message,
      ciraConfig: input.ciraConfig,
      profile: input.profile,
      privateCerts: input.privateCerts,
      tenantId: input.tenantId,
      retryCount: input.retryCount,
      amt: input.amt,
      remoteAccessPolicies: []
    }),
    id: 'cira-machine',
    initial: 'CIRACONFIGURED',
    states: {
      CIRACONFIGURED: {
        on: {
          CONFIGURE_CIRA: {
            // reset retry will create retryCount on the context
            actions: ['Reset Unauth Count', 'Reset Retry Count'],
            target: 'GET_CIRA_CONFIG'
          }
        }
      },
      GET_CIRA_CONFIG: {
        invoke: {
          // TODO: [tech debt] coupling, would expect a direct call to the persistence with the name of the cira config to retrieve it rather than use (amt) profile manager
          src: 'getCIRAConfig',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            httpHandler: context.httpHandler,
            status: context.status,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'get-cira-config',
          onDone: {
            actions: assign({ ciraConfig: ({ event }) => (event as any).output }),
            target: 'SET_MPS_PASSWORD'
          },
          onError: 'FAILURE'
        }
      },
      SET_MPS_PASSWORD: {
        invoke: {
          src: 'getMPSPassword',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            httpHandler: context.httpHandler,
            status: context.status,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'set-mps-password',
          onDone: {
            actions: assign(({ context, event }: { context: CIRAConfigContext; event: any }) => {
              if (context.ciraConfig) {
                if (event.output?.MPS_PASSWORD) {
                  context.ciraConfig.password = event.output?.MPS_PASSWORD
                } else {
                  context.ciraConfig.password = PasswordHelper.generateRandomPassword()
                }
              }
              return context
            }),
            target: 'ADD_TRUSTED_ROOT_CERTIFICATE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed getSecretAtPath' }),
            target: 'FAILURE'
          }
        }
      },
      ADD_TRUSTED_ROOT_CERTIFICATE: {
        invoke: {
          src: 'addTrustedRootCertificate',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'add-trusted-root-certificate',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'SAVE_MPS_PASSWORD_TO_SECRET_PROVIDER'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to add trusted root certificate' }),
            target: 'FAILURE'
          }
        }
      },
      SAVE_MPS_PASSWORD_TO_SECRET_PROVIDER: {
        invoke: {
          src: 'saveMPSPasswordToSecretProvider',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            httpHandler: context.httpHandler,
            status: context.status,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'save-mps-password-to-secret-provider',
          onDone: 'SAVE_DEVICE_TO_MPS',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to save mps password to secret provider' }),
            target: 'FAILURE'
          }
        }
      },
      SAVE_DEVICE_TO_MPS: {
        invoke: {
          src: 'saveDeviceToMPS',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            httpHandler: context.httpHandler,
            status: context.status,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'save-device-to-mps',
          onDone: 'ADD_MPS',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to save device to mps' }),
            target: 'FAILURE'
          }
        }
      },
      ADD_MPS: {
        invoke: {
          src: 'addMPS',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'add-mps',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to add mps' }),
            target: 'FAILURE'
          }
        }
      },
      ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP: {
        invoke: {
          src: 'enumerateManagementPresenceRemoteSAP',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'enumerate-management-presence-remote-sap',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_MANAGEMENT_PRESENCE_REMOTE_SAP'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate Management Presence Remote SAP' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_MANAGEMENT_PRESENCE_REMOTE_SAP: {
        invoke: {
          src: 'pullManagementPresenceRemoteSAP',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'pull-management-presence-remote-sap',
          onDone: {
            actions: [assign({ message: ({ event }) => event.output }), 'Reset Retry Count'],
            target: 'ADD_REMOTE_ACCESS_POLICY_RULE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP'
            },
            {
              actions: assign({ statusMessage: () => 'Failed to Pull Management Presence Remote SAP' }),
              target: 'FAILURE'
            }
          ]
        }
      },
      ADD_REMOTE_ACCESS_POLICY_RULE: {
        invoke: {
          src: 'addRemoteAccessPolicyRule',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'add-remote-policy-access-rule',
          onDone: 'ADD_USER_INITIATED_REMOTE_ACCESS_POLICY_RULE',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to add remote policy access rule' }),
            target: 'FAILURE'
          }
        }
      },
      ADD_USER_INITIATED_REMOTE_ACCESS_POLICY_RULE: {
        invoke: {
          src: 'addUserInitiatedRemoteAccessPolicyRule',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'add-user-initiated-remote-policy-access-rule',
          onDone: 'ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to add User Initiated remote policy access rule' }),
            target: 'FAILURE'
          }
        }
      },
      ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS: {
        invoke: {
          src: 'enumerateRemoteAccessPolicyAppliesToMPS',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'enumerate-remote-access-policy-rule',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PULL_REMOTE_ACCESS_POLICY_APPLIESTOMPS'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to enumerate remote access policy rule' }),
            target: 'FAILURE'
          }
        }
      },
      PULL_REMOTE_ACCESS_POLICY_APPLIESTOMPS: {
        invoke: {
          src: 'pullRemoteAccessPolicyAppliesToMPS',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'pull-remote-access-policy-rule',
          onDone: {
            actions: [
              assign({
                message: ({ event }) => event.output,
                remoteAccessPolicies: ({ event }) =>
                  event.output.Envelope.Body.PullResponse.Items.AMT_RemoteAccessPolicyAppliesToMPS
              }),
              'Reset Retry Count'
            ],
            target: 'PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS'
            },
            {
              actions: assign({ statusMessage: () => 'Failed to pull AMT_RemoteAccessPolicyAppliesToMPS' }),
              target: 'FAILURE'
            }
          ]
        }
      },
      PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS: {
        invoke: {
          src: 'putRemoteAccessPolicyAppliesToMPS',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'put-remote-access-policy-rule',
          onDone: [
            {
              actions: assign({ message: ({ event }) => event.output }),
              target: 'CHECK_REMOTE_ACCESS_POLICY_APPLIESTOMPS'
            }
          ],
          onError: {
            actions: assign({ statusMessage: () => 'Failed to put AMT_RemoteAccessPolicyAppliesToMPS' }),
            target: 'FAILURE'
          }
        }
      },
      CHECK_REMOTE_ACCESS_POLICY_APPLIESTOMPS: {
        always: [
          {
            guard: 'isRemoteAccessPolicyExists',
            target: 'PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS'
          },
          {
            target: 'USER_INITIATED_CONNECTION_SERVICE'
          }
        ]
      },
      USER_INITIATED_CONNECTION_SERVICE: {
        invoke: {
          src: 'userInitiatedConnectionService',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'user-initiated-connection-service',
          onDone: [
            {
              guard: 'userInitiatedConnectionServiceSuccessful',
              target: 'GET_ENVIRONMENT_DETECTION_SETTINGS'
            },
            {
              actions: assign({ statusMessage: () => 'Failed to set user initiated connection service' }),
              target: 'FAILURE'
            }
          ],
          onError: {
            actions: assign({ statusMessage: () => 'Failed to set user initiated connection service' }),
            target: 'FAILURE'
          }
        }
      },
      GET_ENVIRONMENT_DETECTION_SETTINGS: {
        invoke: {
          src: 'getEnvironmentDetectionSettings',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'get-environment-detection-settings',
          onDone: {
            actions: assign({ message: ({ event }) => event.output }),
            target: 'PUT_ENVIRONMENT_DETECTION_SETTINGS'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to get user initiated connection service' }),
            target: 'FAILURE'
          }
        }
      },
      PUT_ENVIRONMENT_DETECTION_SETTINGS: {
        invoke: {
          src: 'putEnvironmentDetectionSettings',
          input: ({ context }) => ({
            clientId: context.clientId,
            tenantId: context.tenantId,
            profile: context.profile,
            profileName: context.profile?.profileName,
            ciraConfig: context.ciraConfig,
            retryCount: context.retryCount,
            status: context.status,
            httpHandler: context.httpHandler,
            message: context.message,
            amt: context.amt,
            xmlMessage: context.xmlMessage,
            remoteAccessPolicies: context.remoteAccessPolicies
          }),
          id: 'put-environment-detection-settings',
          onDone: {
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to set user initiated connection service' }),
            target: 'FAILURE'
          }
        }
      },
      FAILURE: {
        entry: 'Update Configuration Status',
        type: 'final'
      },
      SUCCESS: {
        entry: [assign({ statusMessage: () => 'Configured' }), 'Update Configuration Status'],
        type: 'final'
      }
    }
  })

  constructor() {
    this.nodeForge = new NodeForge()
    this.certManager = new CertManager(new Logger('CertManager'), this.nodeForge)
    this.signatureHelper = new SignatureHelper(this.nodeForge)
    this.configurator = new Configurator()
    this.validator = new Validator(new Logger('Validator'), this.configurator)
    this.dbFactory = new DbCreatorFactory()
    this.logger = new Logger('CIRA_State_Machine')
  }
}
