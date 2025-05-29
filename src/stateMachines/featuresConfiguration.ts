/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT, type CIM, Common, type IPS } from '@device-management-toolkit/wsman-messages'
import Logger from '../Logger.js'
import { assign, setup, fromPromise } from 'xstate'
import {
  type AMTConfiguration,
  AMTRedirectionServiceEnabledStates,
  mapAMTUserConsent,
  AMTUserConsent
} from '../models/index.js'
import { type CommonContext, invokeWsmanCall } from './common.js'

export interface FeatureContext extends CommonContext {
  isRedirectionChanged: boolean
  isOptInServiceChanged: boolean
  AMT_RedirectionService?: any
  IPS_OptInService?: any
  CIM_KVMRedirectionSAP?: any
  amtConfiguration: AMTConfiguration
  amt?: AMT.Messages
  cim?: CIM.Messages
  ips?: IPS.Messages
}
export interface FeatureEvent {
  type: 'CONFIGURE_FEATURES'
  clientId: string
  output?: any
}
export class FeaturesConfiguration {
  logger: Logger

  getAmtRedirectionService = async ({ input }: { input: FeatureContext }): Promise<any> => {
    input.xmlMessage = input.amt != null ? input.amt.RedirectionService.Get() : ''
    return await invokeWsmanCall(input, 2)
  }

  getIpsOptInService = async ({ input }: { input: FeatureContext }): Promise<any> => {
    input.xmlMessage = input.ips != null ? input.ips.OptInService.Get() : ''
    return await invokeWsmanCall(input, 2)
  }

  getCimKvmRedirectionSAP = async ({ input }: { input: FeatureContext }): Promise<any> => {
    input.xmlMessage = input.cim != null ? input.cim.KVMRedirectionSAP.Get() : ''
    return await invokeWsmanCall(input, 2)
  }

  setRedirectionService = async ({ input }: { input: FeatureContext }): Promise<any> => {
    input.xmlMessage =
      input.amt != null
        ? input.amt.RedirectionService.RequestStateChange(input.AMT_RedirectionService.EnabledState)
        : ''
    return await invokeWsmanCall(input, 2)
  }

  setKvmRedirectionSap = async ({ input }: { input: FeatureContext }): Promise<any> => {
    input.xmlMessage =
      input.cim != null ? input.cim.KVMRedirectionSAP.RequestStateChange(input.CIM_KVMRedirectionSAP.EnabledState) : ''
    return await invokeWsmanCall(input, 2)
  }

  putRedirectionService = async ({ input }: { input: FeatureContext }): Promise<any> => {
    const redirectionService: AMT.Models.RedirectionService = input.AMT_RedirectionService
    input.xmlMessage = input.amt != null ? input.amt.RedirectionService.Put(redirectionService) : ''
    return await invokeWsmanCall(input, 2)
  }

  putIpsOptInService = async ({ input }: { input: FeatureContext }): Promise<any> => {
    const ipsOptInService: IPS.Models.OptInService = input.IPS_OptInService
    const ipsOptInSvcResponse: IPS.Models.OptInServiceResponse = {
      IPS_OptInService: JSON.parse(JSON.stringify(ipsOptInService))
    }
    input.xmlMessage = input.ips != null ? input.ips.OptInService.Put(ipsOptInSvcResponse) : ''
    return await invokeWsmanCall(input, 2)
  }

  machine = setup({
    types: {} as {
      context: FeatureContext
      events: FeatureEvent
      actions: any
      input: FeatureContext
    },
    actors: {
      getAmtRedirectionService: fromPromise(this.getAmtRedirectionService),
      getIpsOptInService: fromPromise(this.getIpsOptInService),
      getCimKvmRedirectionSAP: fromPromise(this.getCimKvmRedirectionSAP),
      setRedirectionService: fromPromise(this.setRedirectionService),
      setKvmRedirectionSap: fromPromise(this.setKvmRedirectionSap),
      putRedirectionService: fromPromise(this.putRedirectionService),
      putIpsOptInService: fromPromise(this.putIpsOptInService)
    },
    actions: {
      cacheAmtRedirectionService: assign({
        AMT_RedirectionService: ({ event }) => event.output.Envelope.Body.AMT_RedirectionService
      }),
      cacheIpsOptInService: assign({ IPS_OptInService: ({ event }) => event.output.Envelope.Body.IPS_OptInService }),
      cacheCimKvmRedirectionSAP: assign({
        CIM_KVMRedirectionSAP: ({ event }) => event.output.Envelope.Body.CIM_KVMRedirectionSAP
      }),
      computeUpdates: assign(({ context }) => {
        const amtRedirectionService = context.AMT_RedirectionService
        const cimKVMRedirectionSAP = context.CIM_KVMRedirectionSAP
        const ipsOptInService = context.IPS_OptInService

        let solEnabled = false
        let iderEnabled = false
        let isRedirectionChanged = false

        let enabledState = context.AMT_RedirectionService.EnabledState

        if (enabledState === AMTRedirectionServiceEnabledStates.BOTH_IDER_SOL) {
          solEnabled = true
          iderEnabled = true
        } else if (enabledState === AMTRedirectionServiceEnabledStates.ONLY_IDER) {
          iderEnabled = true
        } else if (enabledState === AMTRedirectionServiceEnabledStates.ONLY_SOL) {
          solEnabled = true
        }
        const kvmEnabled =
          context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.CIM_KVM_REDIRECTION_SAP_ENABLED_STATE.Enabled ||
          context.CIM_KVMRedirectionSAP.EnabledState ===
            Common.Models.CIM_KVM_REDIRECTION_SAP_ENABLED_STATE.EnabledButOffline

        if (context.amtConfiguration?.solEnabled !== solEnabled) {
          solEnabled = context.amtConfiguration?.solEnabled != null ? context.amtConfiguration.solEnabled : false
          isRedirectionChanged = true
        }

        if (context.amtConfiguration?.iderEnabled !== iderEnabled) {
          iderEnabled = context.amtConfiguration?.iderEnabled != null ? context.amtConfiguration.iderEnabled : false
          isRedirectionChanged = true
        }

        if ((solEnabled || iderEnabled) && !amtRedirectionService.ListenerEnabled) {
          isRedirectionChanged = true
        }

        if (context.amtConfiguration?.kvmEnabled !== kvmEnabled) {
          cimKVMRedirectionSAP.EnabledState = context.amtConfiguration?.kvmEnabled
            ? Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled
            : Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Disabled
          isRedirectionChanged = true
        }

        if (isRedirectionChanged) {
          enabledState = AMTRedirectionServiceEnabledStates.DISABLED
          if (iderEnabled && solEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.BOTH_IDER_SOL
          } else if (iderEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.ONLY_IDER
          } else if (solEnabled) {
            enabledState = AMTRedirectionServiceEnabledStates.ONLY_SOL
          }
          amtRedirectionService.EnabledState = enabledState
          amtRedirectionService.ListenerEnabled = solEnabled || iderEnabled || kvmEnabled
        }

        const userConsent =
          context.amtConfiguration?.userConsent != null ? context.amtConfiguration.userConsent : AMTUserConsent.ALL
        const cfgOptInValue = mapAMTUserConsent(userConsent)
        const isOptInServiceChanged = ipsOptInService.OptInRequired !== cfgOptInValue
        if (isOptInServiceChanged) {
          ipsOptInService.OptInRequired = cfgOptInValue
        }

        return {
          AMT_RedirectionService: amtRedirectionService,
          IPS_OptInService: ipsOptInService,
          CIM_KVMRedirectionSAP: cimKVMRedirectionSAP,
          isRedirectionChanged,
          isOptInServiceChanged
        }
      })
    }
  }).createMachine({
    id: 'features-configuration-machine',
    context: ({ input }) => ({
      clientId: input.clientId,
      httpHandler: input.httpHandler,
      amtConfiguration: input.amtConfiguration,
      isRedirectionChanged: input.isRedirectionChanged,
      isOptInServiceChanged: input.isOptInServiceChanged,
      amt: input.amt,
      ips: input.ips,
      cim: input.cim
    }),
    initial: 'DEFAULT_FEATURES',
    states: {
      DEFAULT_FEATURES: {
        on: {
          CONFIGURE_FEATURES: {
            target: 'GET_AMT_REDIRECTION_SERVICE'
          }
        }
      },
      GET_AMT_REDIRECTION_SERVICE: {
        invoke: {
          id: 'get-amt-redirection-service',
          src: 'getAmtRedirectionService',
          input: ({ context }) => context,
          onDone: {
            actions: ['cacheAmtRedirectionService'],
            target: 'GET_IPS_OPT_IN_SERVICE'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to get AMT redirection service' }),
            target: 'FAILED'
          }
        }
      },
      GET_IPS_OPT_IN_SERVICE: {
        invoke: {
          id: 'get-ips-opt-in-service',
          src: 'getIpsOptInService',
          input: ({ context }) => context,
          onDone: {
            actions: ['cacheIpsOptInService'],
            target: 'GET_CIM_KVM_REDIRECTION_SAP'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to get ips opt in service' }),
            target: 'FAILED'
          }
        }
      },
      GET_CIM_KVM_REDIRECTION_SAP: {
        invoke: {
          id: 'get-cim-kvm-redirection-sap',
          src: 'getCimKvmRedirectionSAP',
          input: ({ context }) => context,
          onDone: {
            actions: 'cacheCimKvmRedirectionSAP',
            target: 'COMPUTE_UPDATES'
          },
          onError: {
            actions: assign({ statusMessage: () => 'Failed to get cim kvm redirection sap' }),
            target: 'FAILED'
          }
        }
      },

      COMPUTE_UPDATES: {
        id: 'compute-updates',
        entry: ['computeUpdates'],
        always: [
          { target: 'SET_REDIRECTION_SERVICE', guard: ({ context }) => context.isRedirectionChanged },
          { target: 'PUT_IPS_OPT_IN_SERVICE', guard: ({ context }) => context.isOptInServiceChanged },
          { target: 'SUCCESS' }]
      },
      SET_REDIRECTION_SERVICE: {
        invoke: {
          id: 'set-redirection-service',
          src: 'setRedirectionService',
          input: ({ context }) => context,
          onDone: 'SET_KVM_REDIRECTION_SAP',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to set redirection service' }),
            target: 'FAILED'
          }
        }
      },
      SET_KVM_REDIRECTION_SAP: {
        invoke: {
          id: 'set-kvm-redirection-sap',
          src: 'setKvmRedirectionSap',
          input: ({ context }) => context,
          onDone: 'PUT_REDIRECTION_SERVICE',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to set kvm redirection sap' }),
            target: 'FAILED'
          }
        }
      },
      PUT_REDIRECTION_SERVICE: {
        invoke: {
          id: 'put-redirection-service',
          src: 'putRedirectionService',
          input: ({ context }) => context,
          onDone: [
            { target: 'PUT_IPS_OPT_IN_SERVICE', guard: ({ context }) => context.isOptInServiceChanged },
            { target: 'SUCCESS' }],
          onError: {
            actions: assign({ statusMessage: () => 'Failed to put redirection service' }),
            target: 'FAILED'
          }
        }
      },
      PUT_IPS_OPT_IN_SERVICE: {
        invoke: {
          id: 'put-ips-opt-in-service',
          src: 'putIpsOptInService',
          input: ({ context }) => context,
          onDone: 'SUCCESS',
          onError: {
            actions: assign({ statusMessage: () => 'Failed to put ips opt in service' }),
            target: 'FAILED'
          }
        }
      },
      SUCCESS: {
        entry: () => {
          this.logger.info('AMT Features Configuration success')
        },
        type: 'final'
      },
      FAILED: {
        entry: ({ context }) => {
          this.logger.error(`AMT Features Configuration failed: ${context.statusMessage}`)
        },
        type: 'final'
      }
    }
  })

  constructor() {
    this.logger = new Logger('FeaturesConfiguration')
  }
}
