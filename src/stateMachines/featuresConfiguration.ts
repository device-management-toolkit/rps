import { AMT, CIM, Common, IPS } from '@open-amt-cloud-toolkit/wsman-messages'
import { HttpHandler } from '../HttpHandler'
import Logger from '../Logger'
import { assign, createMachine, interpret } from 'xstate'
import { AMTConfiguration } from '../models'
import { devices } from '../WebSocketListener'
import { ClientResponseMsg } from '../utils/ClientResponseMsg'
import { parseBody } from '../utils/parseWSManResponseBody'
import { AMT_REDIRECTION_SERVICE_ENABLE_STATE } from '@open-amt-cloud-toolkit/wsman-messages/models/common'
import { RedirectionService } from '@open-amt-cloud-toolkit/wsman-messages/amt/models'
import { IPS_OptInService } from '@open-amt-cloud-toolkit/wsman-messages/models/ips_models'

export class FeaturesConfiguration {
  amt: AMT.Messages
  cim: CIM.Messages
  ips: IPS.Messages
  // the class name and method for this is silly
  // should be new ClientReponseMsg(params...)
  // but instead it has a method called .get?
  clientMsgBuilder: ClientResponseMsg
  httpHandler: HttpHandler
  logger: Logger

  constructor (
    private readonly clientId: string,
    private readonly amtCfg: AMTConfiguration
  ) {
    this.amt = new AMT.Messages()
    this.cim = new CIM.Messages()
    this.ips = new IPS.Messages()
    this.clientMsgBuilder = new ClientResponseMsg()
    this.httpHandler = new HttpHandler()
    this.logger = new Logger('FeaturesConfiguration')
  }

  machine = createMachine({
    id: 'features-configuration-fsm',
    predictableActionArguments: true,
    schema: {
      context: {} as {
        // 3 requests to the device
        // to get the current configuration
        // get saved here
        AMT_RedirectionService?: any
        IPS_OptInService?: any
        CIM_KVMRedirectionSAP?: any
        // transient values for computing
        // what configuration changes should be made
        // on the client device
        isRedirectionChanged: boolean
        isOptInServiceChanged: boolean
        errorMessage: string
      },
      events: {} as {
        type: ''
        clientId: string
        data?: any
      }
    },
    initial: 'GET_AMT_REDIRECTION_SERVICE',
    context: {
      isRedirectionChanged: false,
      isOptInServiceChanged: false,
      errorMessage: ''
    },
    states: {
      GET_AMT_REDIRECTION_SERVICE: {
        invoke: {
          src: async (context, _) => await this.getAmtRedirectionService(),
          onDone: {
            actions: ['cacheAmtRedirectionService'],
            target: 'GET_IPS_OPT_IN_SERVICE'
          },
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      GET_IPS_OPT_IN_SERVICE: {
        invoke: {
          src: async (context, _) => await this.getIpsOptInService(),
          onDone: {
            actions: ['cacheIpsOptInService'],
            target: 'GET_CIM_KVM_REDIRECTION_SAP'
          },
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      GET_CIM_KVM_REDIRECTION_SAP: {
        invoke: {
          src: async (context, _) => await this.getCimKvmRedirectionSAP(),
          onDone: {
            actions: ['cacheCimKvmRedirectionSAP'],
            target: 'COMPUTE_UPDATES'
          },
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      COMPUTE_UPDATES: {
        entry: ['computeUpdates'],
        always: [
          { target: 'SET_REDIRECTION_SERVICE', cond: (context, _) => context.isRedirectionChanged },
          { target: 'PUT_IPS_OPT_IN_SERVICE', cond: (context, _) => context.isOptInServiceChanged },
          { target: 'SUCCESS' }
        ]
      },
      SET_REDIRECTION_SERVICE: {
        invoke: {
          src: async (context, _) => await this.setRedirectionService(context.AMT_RedirectionService.EnabledState),
          onDone: 'SET_KVM_REDIRECTION_SAP',
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      SET_KVM_REDIRECTION_SAP: {
        invoke: {
          src: async (context, _) => await this.setKvmRedirectionSap(context.CIM_KVMRedirectionSAP.EnabledState),
          onDone: 'PUT_REDIRECTION_SERVICE',
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      PUT_REDIRECTION_SERVICE: {
        invoke: {
          src: async (context, _) => await this.putRedirectionService(context.AMT_RedirectionService),
          onDone: [
            { target: 'PUT_IPS_OPT_IN_SERVICE', cond: (context, _) => context.isOptInServiceChanged },
            { target: 'SUCCESS' }
          ],
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      PUT_IPS_OPT_IN_SERVICE: {
        invoke: {
          src: async (context, _) => await this.putIpsOptInService(context.IPS_OptInService),
          onDone: 'SUCCESS',
          onError: {
            actions: assign({ errorMessage: (_, event) => JSON.stringify(event.data) }),
            target: 'FAILED'
          }
        }
      },
      SUCCESS: {
        type: 'final'
      },
      FAILED: {
        entry: (context, _) => this.logger.error(`FeaturesConfiguration failed: ${context.errorMessage}`),
        type: 'final'
      }
    }
  },
  {
    actions: {
      cacheAmtRedirectionService: assign({ AMT_RedirectionService: (_, event) => event.data.Envelope.Body.AMT_RedirectionService }),
      cacheIpsOptInService: assign({ IPS_OptInService: (_, event) => event.data.Envelope.Body.IPS_OptInService }),
      cacheCimKvmRedirectionSAP: assign({ CIM_KVMRedirectionSAP: (_, event) => event.data.Envelope.Body.CIM_KVMRedirectionSAP }),
      computeUpdates: assign((context, _) => {
        const amtRedirectionService = context.AMT_RedirectionService
        const cimKVMRedirectionSAP = context.CIM_KVMRedirectionSAP

        let isRedirectionChanged = false
        let solEnabled = (context.AMT_RedirectionService.EnabledState & Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled) !== 0
        let iderEnabled = (context.AMT_RedirectionService.EnabledState & Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Other) !== 0
        const kvmEnabled = (
          (context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.EnabledButOffline &&
              context.CIM_KVMRedirectionSAP.RequestedState === Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled) ||
            context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled ||
            context.CIM_KVMRedirectionSAP.EnabledState === Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.EnabledButOffline)

        if (this.amtCfg.solEnabled !== solEnabled) {
          solEnabled = this.amtCfg.solEnabled
          isRedirectionChanged = true
        }

        if (this.amtCfg.iderEnabled !== iderEnabled) {
          iderEnabled = this.amtCfg.iderEnabled
          isRedirectionChanged = true
        }

        if ((solEnabled || iderEnabled) && !amtRedirectionService.ListenerEnabled) {
          isRedirectionChanged = true
        }

        if (this.amtCfg.kvmEnabled !== kvmEnabled) {
          cimKVMRedirectionSAP.EnabledState = this.amtCfg.kvmEnabled
            ? Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Enabled
            : Common.Models.AMT_REDIRECTION_SERVICE_ENABLE_STATE.Disabled
          isRedirectionChanged = true
        }

        if (isRedirectionChanged) {
          // what is this magic numbers going on?
          amtRedirectionService.EnabledState = 32768 + ((iderEnabled ? 1 : 0) + (solEnabled ? 2 : 0))
          if (solEnabled || iderEnabled || kvmEnabled) {
            amtRedirectionService.ListenerEnabled = true
          } else {
            amtRedirectionService.ListenerEnabled = true
          }
        }

        const UserConsentOptions = {
          none: 0,
          kvm: 1,
          all: 4294967295
        }
        const ipsOptInService = context.IPS_OptInService
        const key = this.amtCfg.userConsent.toLowerCase()
        const isOptInServiceChanged = (ipsOptInService.OptInRequired !== UserConsentOptions[key])
        if (isOptInServiceChanged) {
          ipsOptInService.OptInRequired = UserConsentOptions[key]
        }

        return {
          AMT_RedirectionService: amtRedirectionService,
          IPS_OptInService: ipsOptInService,
          CIM_KVMRedirectionSAP: cimKVMRedirectionSAP,
          isRedirectionChanged: isRedirectionChanged,
          isOptInServiceChanged: isOptInServiceChanged
        }
      })
    }
  })

  service = interpret(this.machine)

  async getAmtRedirectionService (): Promise<any> {
    return await this.invokeWsmanCall(this.clientId, this.amt.RedirectionService(AMT.Methods.GET))
  }

  async getIpsOptInService (): Promise<any> {
    return await this.invokeWsmanCall(this.clientId, this.ips.OptInService(IPS.Methods.GET))
  }

  async getCimKvmRedirectionSAP (): Promise<any> {
    return await this.invokeWsmanCall(this.clientId, this.ips.OptInService(IPS.Methods.GET))
  }

  async setRedirectionService (enabledState: number): Promise<any> {
    return await this.invokeWsmanCall(this.clientId, this.amt.RedirectionService(AMT.Methods.REQUEST_STATE_CHANGE, enabledState))
  }

  async setKvmRedirectionSap (requestedState: AMT_REDIRECTION_SERVICE_ENABLE_STATE): Promise<any> {
    return await this.invokeWsmanCall(this.clientId, this.cim.KVMRedirectionSAP(CIM.Methods.REQUEST_STATE_CHANGE, requestedState))
  }

  async putRedirectionService (redirectionService: RedirectionService): Promise<any> {
    const redirectionResponse: AMT.Models.RedirectionResponse = {
      AMT_RedirectionService: JSON.parse(JSON.stringify(redirectionService))
    }
    return await this.invokeWsmanCall(this.clientId, this.amt.RedirectionService(AMT.Methods.PUT, null, redirectionResponse))
  }

  async putIpsOptInService (ipsOptInService: IPS_OptInService): Promise<any> {
    const ipsOptInSvcResponse: IPS.Models.OptInServiceResponse = {
      IPS_OptInService: JSON.parse(JSON.stringify(ipsOptInService))
    }
    return await this.invokeWsmanCall(this.clientId, this.ips.OptInService(IPS.Methods.PUT, null, ipsOptInSvcResponse))
  }

  async invokeWsmanCall (clientId, xmlMessage): Promise<any> {
    const clientObj = devices[clientId]
    const message = this.httpHandler.wrapIt(xmlMessage, clientObj.connectionParams)
    const clientMsg = this.clientMsgBuilder.get(clientId, message, 'wsman', 'ok')
    devices[clientId].ClientSocket.send(JSON.stringify(clientMsg))
    clientObj.pendingPromise = new Promise<any>((resolve, reject) => {
      clientObj.resolve = resolve
      clientObj.reject = reject
    }).then((wsmanMsg) => {
      return this.httpHandler.parseXML(parseBody(wsmanMsg))
    })
    return await clientObj.pendingPromise
  }
}
