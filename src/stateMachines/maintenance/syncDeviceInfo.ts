/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { assign, fromPromise, setup } from 'xstate'
import { type CommonMaintenanceContext, coalesceMessage, HttpResponseError } from '../common.js'
import Logger from '../../Logger.js'
import { doneFail, doneSuccess } from './doneResponse.js'
import { devices } from '../../devices.js'
import got from 'got'
import { Environment } from '../../utils/Environment.js'
import { getHostInventory } from '../../utils/hostInventory.js'
import { type UPIDInfo } from '../../models/RCS.Config.js'

export interface DeviceInfo {
  ver: string
  build: string
  sku: string
  currentMode: string
  features: string
  ipConfiguration: { ipAddress: string }
  osName?: string
  osVersion?: string
  osDistro?: string
  serialNumber?: string
  upid?: UPIDInfo
}

export const SyncDeviceInfoEventType = 'SYNC_DEVICE_INFO'
export interface SyncDeviceInfoEvent {
  type: typeof SyncDeviceInfoEventType | 'ONFAILED'
  clientId: string
  deviceInfo: DeviceInfo
  output?: any
}

export interface SyncDeviceInfoContext extends CommonMaintenanceContext {
  deviceInfo: DeviceInfo | null
}

const logger = new Logger('syncDeviceInfo')

export class SyncDeviceInfo {
  saveToMPS = async ({ input }: { input: SyncDeviceInfoContext }): Promise<void> => {
    const clientObj = devices[input.clientId]
    const url = `${Environment.Config.mps_server}/api/v1/devices`
    const deviceinfo = {
      fwVersion: input.deviceInfo?.ver,
      fwBuild: input.deviceInfo?.build,
      fwSku: input.deviceInfo?.sku,
      currentMode: input.deviceInfo?.currentMode?.toString(),
      features: input.deviceInfo?.features,
      ipAddress: input.deviceInfo?.ipConfiguration.ipAddress,
      ...getHostInventory(input.deviceInfo),
      lastUpdated: new Date()
    }
    const jsonData = {
      guid: clientObj.uuid,
      deviceInfo: deviceinfo
    }

    const rsp = await got.patch(url, { json: jsonData })
    if (rsp.statusCode !== 200) {
      throw new HttpResponseError(rsp.statusMessage ? rsp.statusMessage : '', rsp.statusCode)
    }
    logger.debug(`savedToMPS ${JSON.stringify(jsonData)}`)
  }

  machine = setup({
    types: {} as {
      context: SyncDeviceInfoContext
      events: SyncDeviceInfoEvent
      input: SyncDeviceInfoContext
      actions: any
    },
    actors: {
      saveToMPS: fromPromise(this.saveToMPS)
    }
  }).createMachine({
    id: 'sync-device-info',
    context: ({ input }) => ({
      taskName: input.taskName,
      clientId: input.clientId,
      message: input.message,
      errorMessage: input.errorMessage,
      httpHandler: input.httpHandler,
      parseErrorCount: 0,
      deviceInfo: input.deviceInfo
    }),
    initial: 'INITIAL',
    states: {
      INITIAL: {
        on: {
          SYNC_DEVICE_INFO: {
            actions: assign({
              clientId: ({ event }) => event.clientId,
              deviceInfo: ({ event }) => event.deviceInfo
            }),
            target: 'SAVE_TO_MPS'
          }
        }
      },
      SAVE_TO_MPS: {
        entry: assign({
          errorMessage: () => ''
        }),
        invoke: {
          src: 'saveToMPS',
          input: ({ context }) => context,
          id: 'save-to-mps',
          onDone: {
            // actions: assign({ statusMessage: ({ event }) => event.output as string }),
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at SAVE_TO_MPS', event.error)
            }),
            target: 'FAILED'
          }
        }
      },
      FAILED: {
        entry: assign({ statusMessage: () => 'FAILED' }),
        type: 'final'
      },
      SUCCESS: {
        entry: assign({ statusMessage: () => 'SUCCESS' }),
        type: 'final'
      }
    },
    output: ({ context }) => {
      if (context.statusMessage === 'SUCCESS') {
        return doneSuccess(context.taskName)
      } else {
        return doneFail(context.taskName, context.errorMessage)
      }
    }
  })
}
