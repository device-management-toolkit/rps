import { AMT } from '@open-amt-cloud-toolkit/wsman-messages'
import { createMachine, interpret, send, assign } from 'xstate'
import { HttpHandler } from '../HttpHandler'
import Logger from '../Logger'
import ClientResponseMsg from '../utils/ClientResponseMsg'

import { devices } from '../WebSocketListener'
import { Error } from './error'
import { SyncIP } from './syncIP'
import { TimeSync } from './timeMachine'

export interface MaintenanceContext {
  message: any
  xmlMessage: string
  errorMessage: string
  statusMessage: string
  clientId: string
  httpHandler: HttpHandler
  status: 'success' | 'error' | ''
}

export interface MaintenanceEvent {
  type: 'SYNCTIME' | 'ONFAILED' | 'ON_SYNCIP_FAILED' | 'SYNCIP'
  clientId: string
  data?: any
}

export class Maintenance {
  amt: AMT.Messages
  logger: Logger
  timeSync: TimeSync = new TimeSync()
  ipSync: SyncIP = new SyncIP()
  error: Error = new Error()
  machine =
  createMachine<MaintenanceContext, MaintenanceEvent>({
    predictableActionArguments: true,
    preserveActionOrder: true,
    initial: 'PROVISIONED',
    context: {
      clientId: '',
      status: 'success',
      message: null,
      httpHandler: new HttpHandler(),
      xmlMessage: '',
      errorMessage: '',
      statusMessage: ''
    },
    states: {
      PROVISIONED: {
        on: {
          SYNCTIME: {
            actions: [assign({ clientId: (context, event) => event.clientId }), 'Reset Unauth Count'],
            target: 'SYNC_TIME'
          },
          SYNCIP: {
            actions: [assign({
              clientId: (context, event) => event.clientId,
              message: (context, event) => event.data
            }), 'Reset Unauth Count'],
            target: 'SYNC_IP_ADDRESS'
          }
        }
      },
      SYNC_TIME: {
        entry: send({ type: 'TIMETRAVEL' }, { to: 'time-machine' }),
        invoke: {
          src: this.timeSync.machine,
          id: 'time-machine',
          data: {
            clientId: (context, event) => context.clientId
          },
          onDone: {
            actions: assign({ statusMessage: (context, event) => 'Time Synchronized' }),
            target: 'SUCCESS'
          },
          onError: 'ERROR'
        }
      },
      SYNC_IP_ADDRESS: {
        entry: send({ type: 'SYNC_IP' }, { to: 'sync-ip-address' }),
        invoke: {
          src: this.ipSync.machine,
          id: 'sync-ip-address',
          data: {
            unauthCount: (context, event) => context.unauthCount,
            ipConfiguration: (context, event) => context.message,
            httpHandler: (context, event) => context.httpHandler,
            clientId: (context, event) => context.clientId
          },
          onDone: {
            actions: assign({ statusMessage: (context, event) => 'IP Address Synchronized' }),
            target: 'SUCCESS'
          }
        },
        on: {
          ON_SYNCIP_FAILED: 'FAILURE'
        }
      },
      ERROR: {
        entry: send({ type: 'PARSE' }, { to: 'error-machine' }),
        invoke: {
          src: this.error.machine,
          id: 'error-machine',
          data: {
            unauthCount: (context, event) => context.unauthCount,
            message: (context, event) => event.data,
            clientId: (context, event) => context.clientId
          },
          onDone: 'SYNC_TIME' // To do: Need to test as it might not require anymore.
        },
        on: {
          ONFAILED: 'FAILURE'
        }
      },
      FAILURE: {
        entry: [
          assign({ status: (context, event) => 'error', errorMessage: (context, event) => event.data }),
          'Update Configuration Status',
          'Send Message to Device'
        ],
        type: 'final'
      },
      SUCCESS: {
        entry: ['Update Configuration Status', 'Send Message to Device'],
        type: 'final'
      }
    }
  }, {
    actions: {
      'Reset Unauth Count': (context, event) => { devices[context.clientId].unauthCount = 0 },
      'Send Message to Device': (context, event) => this.sendMessageToDevice(context, event),
      'Update Configuration Status': this.updateConfigurationStatus.bind(this)
    }
  })

  constructor () {
    this.amt = new AMT.Messages()
  }

  service = interpret(this.machine).onTransition((state) => {
    console.log(`Current state of Maintenance State Machine: ${JSON.stringify(state.value)}`)
  }).onChange((data) => {
    console.log('ONCHANGE:')
    console.log(data)
  }).onDone((data) => {
    console.log('ONDONE:')
    console.log(data)
  })

  updateConfigurationStatus (context: MaintenanceContext): void {
    if (context.status === 'success') {
      devices[context.clientId].status.Status = context.statusMessage
    } else if (context.status === 'error') {
      devices[context.clientId].status.Status = context.errorMessage !== '' ? context.errorMessage : 'Failed'
    }
  }

  sendMessageToDevice (context: MaintenanceContext, event): void {
    const { clientId, status } = context
    const message = event?.data
    const clientObj = devices[clientId]
    let method: 'failed' | 'success' | 'ok' | 'heartbeat' = 'success' // TODO: Get rid of redundant data (i.e. Method and Status)
    if (status === 'success') {
      method = 'success'
    } else if (status === 'error') {
      clientObj.status.Status = message
      method = 'failed'
    }
    const responseMessage = ClientResponseMsg.get(clientId, null, status as any, method, JSON.stringify(clientObj.status))
    devices[clientId].ClientSocket.send(JSON.stringify(responseMessage))
  }
}
