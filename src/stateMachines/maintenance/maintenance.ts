/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { assign, createActor, sendTo, setup } from 'xstate'
import Logger from '../../Logger.js'
import { devices } from '../../devices.js'
import { type ProvisioningFailure, type Status } from '../../models/RCS.Config.js'
import { reportProvisioningFailure } from '../common.js'
import { SyncTime, type SyncTimeEvent } from './syncTime.js'
import { SyncIP, type SyncIPEvent } from './syncIP.js'
import { ChangePassword, type ChangePasswordEvent } from './changePassword.js'
import { type DoneResponse, StatusSuccess } from './doneResponse.js'
import { SyncHostName, type SyncHostNameEvent } from './syncHostName.js'
import { SyncDeviceInfo, type SyncDeviceInfoEvent } from './syncDeviceInfo.js'
import ClientResponseMsg from '../../utils/ClientResponseMsg.js'
import { HttpHandler } from '../../HttpHandler.js'

export type MaintenanceEvent =
  | ChangePasswordEvent
  | SyncTimeEvent
  | SyncIPEvent
  | SyncHostNameEvent
  | SyncDeviceInfoEvent

export interface MaintenanceContext {
  clientId: string
  doneData: any
  httpHandler: HttpHandler
}

// TODO: tech-debt - these should be in ClientResponseMsg, but the default export there makes it really weird
type ClientRspMessageType = 'error' | 'wsman' | 'success' | 'heartbeat_request'
type ClientRspStatusType = 'failed' | 'success' | 'ok' | 'heartbeat'
const logger = new Logger('Maintenance')

export class Maintenance {
  changePassword: ChangePassword = new ChangePassword()
  syncIP: SyncIP = new SyncIP()
  syncTime: SyncTime = new SyncTime()
  syncHostName: SyncHostName = new SyncHostName()
  syncDeviceInfo: SyncDeviceInfo = new SyncDeviceInfo()
  machine = setup({
    types: {} as {
      context: MaintenanceContext
      events: MaintenanceEvent
      actions: any
      input: MaintenanceContext
      output: any
    },
    actors: {
      changePassword: this.changePassword.machine,
      syncIP: this.syncIP.machine,
      syncTime: this.syncTime.machine,
      syncHostName: this.syncHostName.machine,
      syncDeviceInfo: this.syncDeviceInfo.machine
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QFsCGBLAdgFzJ1mAxmALRqEAWWYAdAJIBydAKnQIIAyAxAMIASbBgHEAogH0ACmwDK0gOoB5AEoARANoAGALqJQABwD2sdNnQHMukAA9EARgCctmgGYATAHZXGgBwA2AKyuzv62-gAsADQgAJ6Irt7uNO7+zrbJYWmugWEAvjlRaFi4+ESk5FSYtIws7NzSAJoMPGKsALIimjpIIIbGpuaWNggOTm6ePgFBIeFRsQjJ9jS2Yb5hHu7BrmHbeQUYOHgExGSolNT0TKycXA1NYnQSnZa9JmYW3UMjLh5efoHBoUiMUQvg0rhoGlCm18vlcDn89l2IEKBxKx3K52qVzqjWafAU0mYYgYbHaT26L3671An0c33GfymgNmiG2YRo3m8a38GjC9g0zg0GnsziRKOKRzKpwqVUutRuuLEKhEADU6DxxIwAGIKcn6IyvAYfOx0sa-SYAmbA4aCmiwuHhcK2bz2Xx+MX7CWlE5nSo0fiCUSSGTyZQqLgQcy0LAANwMAGtaJQCDASHpULBYAB3AwAJwgep6Bqpg0Q7ncTiFoIFvnsrocLIQrhhSRWriyzbCzlSzY9RUO3oxftueIJRJJ7QjUZosYTtFg0SIJAoRmwJHwyDAhcpb1L8wrEI01ectfr9kba2cHPLgoFzg27ns3j7qMlPplNBH9wkU79s8TNALku6B6Nuxa7sa+6VkeQonnWvgNta-jeNBXJgjy9geGEz75MinoDui0rnF+bQiL+0aYHGAFAYQJCmJuYF9BBNJlgeVawaeCHntaGzeEszj2GE5bIUEQSirh4oEVKvq0F+ypqhq9wMDq5EzpRc6AYutEQGAMboMcWAAGYGIxhrUtYrHQcenGIXMtjCnaoReF2nL2MkFZ5LhmAGDp8DdJJaLSTKzzgUaLEICQviNiQ-g0HWdZCu4YQIl47jeOJez9oF76YnKnAhUxYUWQgayNssV7dvE6EIRsbkvl6hEyf6AjCOIUiyIoqgFWZe4ZBoSzeP4ni+IKzpCY2QR8T2fgnmEAqDbYGV4Vlb5DrJir4oSxKkiI3UlpBbJJL4j5-J4yz+I2AmxdsAm2LYCHJQkyz1VJOXDoqDx7cxxUrFeyQwk6Q1pNxcz+IENBDTyi1pas3hwi92VrZ+iqkV9RVDF2iR1hWfVQ-yfiNu4DlEwhoT2Mh96eAjq1Ee9dzyeqmrKQoaPmRj91JItPJw09CQXdaKEDc6tYzQkoLuNTg607QKgKAwu0UqFbN2EK-XOBkrpuphIn83Maz9c6wQaOEwTY64nk5EAA */
    id: 'maintenance-machine',
    context: ({ input }) => ({
      clientId: input.clientId,
      doneData: input.doneData,
      httpHandler: new HttpHandler()
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          CHANGE_PASSWORD: { target: 'CHANGE_PASSWORD' },
          SYNC_TIME: { target: 'SYNC_TIME' },
          SYNC_IP: { target: 'SYNC_IP' },
          SYNC_HOST_NAME: { target: 'SYNC_HOST_NAME' },
          SYNC_DEVICE_INFO: { target: 'SYNC_DEVICE_INFO' }
        }
      },
      CHANGE_PASSWORD: {
        entry: [
          assign({ clientId: ({ event }) => event.clientId }),
          sendTo('change-password', ({ event }) => event)
        ],
        invoke: {
          id: 'change-password',
          src: 'changePassword',
          input: ({ context }) => ({
            clientId: context.clientId,
            httpHandler: context.httpHandler,
            message: '',
            errorMessage: '',
            taskName: 'changepassword'
          }),
          onDone: {
            actions: assign({ doneData: ({ event }) => event.output }),
            target: 'DONE'
          }
        }
      },
      SYNC_HOST_NAME: {
        entry: [
          assign({ clientId: ({ event }) => event.clientId }),
          sendTo('sync-host-name', ({ event }) => event)
        ],
        invoke: {
          id: 'sync-host-name',
          src: 'syncHostName',
          input: ({ context }) => ({
            clientId: context.clientId,
            httpHandler: context.httpHandler,
            message: '',
            errorMessage: '',
            hostNameInfo: { dnsSuffixOS: '', hostname: '' },
            generalSettings: null,
            taskName: 'synchostname'
          }),
          onDone: {
            actions: assign({
              doneData: ({ event }) => event.output
            }),
            target: 'DONE'
          },
          onError: {
            actions: assign({ doneData: ({ event }) => event.error }),
            target: 'DONE'
          }
        },
        on: {
          ONFAILED: {
            actions: assign({ doneData: ({ event }) => event.output }),
            target: 'DONE'
          }
        }
      },
      SYNC_IP: {
        entry: [
          assign({ clientId: ({ event }) => event.clientId }),
          sendTo('sync-ip', ({ event }) => event)
        ],
        invoke: {
          id: 'sync-ip',
          src: 'syncIP',
          input: ({ context }) => ({
            clientId: context.clientId,
            httpHandler: context.httpHandler,
            message: '',
            errorMessage: '',
            parseErrorCount: 0,
            enumerationContext: '',
            wiredSettings: {},
            taskName: 'syncip'
          }),
          onDone: {
            actions: assign({
              doneData: ({ event }) => event.output
            }),
            target: 'DONE'
          },
          onError: {
            actions: assign({
              doneData: ({ event }) => event.error
            }),
            target: 'DONE'
          }
        }
      },
      SYNC_TIME: {
        entry: [
          assign({ clientId: ({ event }) => event.clientId }),
          sendTo('sync-time', ({ event }) => event)
        ],
        invoke: {
          id: 'sync-time',
          src: 'syncTime',
          input: ({ context }) => ({
            clientId: context.clientId,
            httpHandler: context.httpHandler,
            message: '',
            errorMessage: '',
            parseErrorCount: 0,
            lowAccuracyData: { Ta0: 0, Tm1: 0 },
            taskName: 'synctime'
          }),
          onDone: {
            actions: assign({
              doneData: ({ event }) => event.output
            }),
            target: 'DONE'
          }
        }
      },
      SYNC_DEVICE_INFO: {
        entry: [
          assign({ clientId: ({ event }) => event.clientId }),
          sendTo('sync-device-info', ({ event }) => event)
        ],
        invoke: {
          id: 'sync-device-info',
          src: 'syncDeviceInfo',
          input: ({ context, event }) => ({
            clientId: context.clientId,
            httpHandler: context.httpHandler,
            message: '',
            errorMessage: '',
            deviceInfo: null,
            taskName: 'syncdeviceinfo'
          }),
          onDone: {
            actions: assign({ doneData: ({ event }) => event.output }),
            target: 'DONE'
          }
        }
      },
      DONE: {
        type: 'final',
        entry: ({ context }) => this.respondAfterDone(context.clientId, context.doneData)
      }
    },
    output: ({ context }) => ({ context })
  })

  service = createActor(this.machine, { input: {} as MaintenanceContext })
  constructor() {
    this.service.subscribe((state) => {
      logger.info(`Maintenance machine: ${state.value}`)
    })
  }

  respondAfterDone(clientId: string, doneData: DoneResponse): any {
    const clientObj = devices[clientId]
    // TODO: this is silly, where is the type/interface definition for these?
    let method: ClientRspMessageType
    let status: ClientRspStatusType
    // and then 'another' status thingy to hold status from several optional activation
    // activities that aren't used here, but nonetheless are baked into the client API flow
    let actualStatusMsg: string
    if (doneData.status === StatusSuccess) {
      method = 'success'
      status = 'success'
      actualStatusMsg = `${doneData.taskName} completed succesfully`
    } else {
      method = 'error'
      status = 'failed'
      actualStatusMsg = `${doneData.taskName} failed`
    }
    if (doneData.message) {
      actualStatusMsg = `${actualStatusMsg} ${doneData.message}`
    }
    const taskStatus: Status = {
      Status: actualStatusMsg
    }
    if (doneData.status !== StatusSuccess) {
      const failure: ProvisioningFailure = doneData.failure ?? {
        Code: 'RPS_UNEXPECTED_ERROR',
        Component: 'Maintenance',
        Step: 'UNKNOWN',
        Reason: actualStatusMsg
      }
      taskStatus.Error = reportProvisioningFailure(logger, clientId, failure, 'maintenance', doneData.taskName)
    }
    logger.info(`${clientId} ${actualStatusMsg}`)
    const rspMsg = ClientResponseMsg.get(clientId, null, method, status, JSON.stringify(taskStatus))
    const toSend = JSON.stringify(rspMsg)
    if (clientObj?.ClientSocket != null) {
      clientObj.ClientSocket.send(toSend)
    }
  }
}
