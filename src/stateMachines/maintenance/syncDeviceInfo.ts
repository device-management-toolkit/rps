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
import { type HostInventory } from '../../models/RCS.Config.js'

export interface DeviceInfo extends HostInventory {
  ver: string
  build: string
  sku: string
  currentMode: string
  features: string
  ipConfiguration?: { ipAddress: string }
}

export const SyncDeviceInfoEventType = 'SYNC_DEVICE_INFO'
export interface SyncDeviceInfoEvent {
  type: typeof SyncDeviceInfoEventType | 'ONFAILED'
  clientId: string
  deviceInfo: DeviceInfo
  output?: any
}

// deviceInfo as MPS stores it: the host inventory plus fields this sync does not own (status, activatedAt, ...).
export type StoredDeviceInfo = HostInventory & Record<string, unknown>

export interface SyncDeviceInfoContext extends CommonMaintenanceContext {
  deviceInfo: DeviceInfo | null
  // deviceInfo MPS currently holds for the device; whatever the client does not report is carried forward from it.
  existingDeviceInfo?: StoredDeviceInfo | null
}

const hostInventoryKeys = [
  'osName',
  'osVersion',
  'osDistro',
  'serialNumber',
  'upid'
] as const

const logger = new Logger('syncDeviceInfo')

export class SyncDeviceInfo {
  // MPS replaces deviceInfo wholesale on PATCH, so read what it holds first to avoid erasing what a
  // previous activation or sync stored (activation status and time, host inventory).
  getDeviceFromMPS = async ({ input }: { input: SyncDeviceInfoContext }): Promise<StoredDeviceInfo | null> => {
    const clientObj = devices[input.clientId]
    // MPS answers with an empty body when the tenant does not match, so pass the tenant the client
    // connected with, as the activation and deactivation lookups do. The uuid is client input.
    const guid = encodeURIComponent(clientObj.uuid ?? '')
    const tenantId = encodeURIComponent(clientObj.ClientData?.tenantId ?? '')
    const url = `${Environment.Config.mps_server}/api/v1/devices/${guid}?tenantId=${tenantId}`
    const rsp = await got.get(url)
    if (rsp?.body == null || rsp.body === '') {
      return null
    }
    try {
      const existing = typeof rsp.body === 'string' ? JSON.parse(rsp.body) : rsp.body
      return existing?.deviceInfo ?? null
    } catch {
      // Non-JSON body: treated as no stored deviceInfo, as the activation lookup does.
      return null
    }
  }

  saveToMPS = async ({ input }: { input: SyncDeviceInfoContext }): Promise<void> => {
    const clientObj = devices[input.clientId]
    const url = `${Environment.Config.mps_server}/api/v1/devices`
    const reported = {
      fwVersion: input.deviceInfo?.ver,
      fwBuild: input.deviceInfo?.build,
      fwSku: input.deviceInfo?.sku,
      currentMode: input.deviceInfo?.currentMode?.toString(),
      features: input.deviceInfo?.features,
      ipAddress: input.deviceInfo?.ipConfiguration?.ipAddress
    }
    // Stored fields this sync does not report (status, activatedAt, ...) are kept as they are. The
    // host inventory is left out here because getHostInventory decides what is carried forward.
    const stored: Record<string, unknown> = { ...input.existingDeviceInfo }
    for (const key of hostInventoryKeys) {
      delete stored[key]
    }
    const deviceinfo = {
      ...stored,
      ...Object.fromEntries(Object.entries(reported).filter(([, value]) => value !== undefined)),
      ...getHostInventory(input.deviceInfo, input.existingDeviceInfo),
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
      getDeviceFromMPS: fromPromise(this.getDeviceFromMPS),
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
      deviceInfo: input.deviceInfo,
      existingDeviceInfo: input.existingDeviceInfo
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
            target: 'GET_DEVICE_FROM_MPS'
          }
        }
      },
      GET_DEVICE_FROM_MPS: {
        entry: assign({
          errorMessage: () => ''
        }),
        invoke: {
          src: 'getDeviceFromMPS',
          input: ({ context }) => context,
          id: 'get-device-from-mps',
          onDone: {
            actions: assign({ existingDeviceInfo: ({ event }) => event.output }),
            target: 'SAVE_TO_MPS'
          },
          onError: {
            actions: assign({
              errorMessage: ({ event }) => coalesceMessage('at GET_DEVICE_FROM_MPS', event.error)
            }),
            target: 'FAILED'
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
