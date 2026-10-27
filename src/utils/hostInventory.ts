/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type UPIDInfo } from '../models/RCS.Config.js'

export interface HostInventory {
  osName?: string
  osVersion?: string
  osDistro?: string
  serialNumber?: string
  upid?: UPIDInfo
}

const hostInventoryKeys: (keyof HostInventory)[] = [
  'osName',
  'osVersion',
  'osDistro',
  'serialNumber',
  'upid'
]

// Picks the host inventory fields rpc-go reports (OS, serial number, UPID) for the MPS deviceInfo blob.
// MPS replaces deviceInfo wholesale, so any field the client did not send falls back to the value
// already stored in MPS (when known). Fields absent from both are omitted.
export function getHostInventory(payload: any, existingDeviceInfo?: any): HostInventory {
  const inventory: HostInventory = {}
  for (const key of hostInventoryKeys) {
    const value = isPresent(payload?.[key]) ? payload[key] : existingDeviceInfo?.[key]
    if (isPresent(value)) {
      inventory[key] = value
    }
  }
  return inventory
}

function isPresent(value: unknown): boolean {
  if (value == null) {
    return false
  }
  if (typeof value === 'string') {
    return value.trim() !== ''
  }
  if (typeof value === 'object') {
    return Object.keys(value).length > 0
  }
  return true
}
