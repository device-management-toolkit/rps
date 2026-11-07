/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type HostInventory, type UPIDInfo } from '../models/RCS.Config.js'

// The OS fields describe one operating system, so they are always taken from the same source:
// a client that reports its OS never has it mixed with the OS a previous session stored.
const osKeys = [
  'osName',
  'osVersion',
  'osDistro'
] as const
const upidKeys = [
  'csmeId',
  'oemId',
  'oemPlatformIdType'
] as const

type HostInventorySource = Partial<HostInventory> | null | undefined

// Picks the host inventory fields rpc-go reports (OS, serial number, UPID) for the MPS deviceInfo blob.
// MPS replaces deviceInfo wholesale, so anything the client did not send falls back to the value
// already stored in MPS (when known). Fields absent from both are omitted. The client payload is
// untrusted input, so values of the wrong type are treated as absent rather than stored verbatim.
export function getHostInventory(
  payload: HostInventorySource,
  existingDeviceInfo?: HostInventorySource
): HostInventory {
  const inventory: HostInventory = {}
  const osSource = osKeys.some((key) => isNonBlankString(payload?.[key])) ? payload : existingDeviceInfo
  for (const key of osKeys) {
    const value = osSource?.[key]
    if (isNonBlankString(value)) {
      inventory[key] = value
    }
  }
  const serialNumber = isNonBlankString(payload?.serialNumber) ? payload.serialNumber : existingDeviceInfo?.serialNumber
  if (isNonBlankString(serialNumber)) {
    inventory.serialNumber = serialNumber
  }
  const upid = toUPID(payload?.upid) ?? toUPID(existingDeviceInfo?.upid)
  if (upid != null) {
    inventory.upid = upid
  }
  return inventory
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

// Keeps only the known, non-blank string fields of a UPID; undefined when nothing usable remains.
function toUPID(value: unknown): UPIDInfo | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined
  }
  const upid: UPIDInfo = {}
  for (const key of upidKeys) {
    const field = (value as Record<string, unknown>)[key]
    if (isNonBlankString(field)) {
      upid[key] = field
    }
  }
  return Object.keys(upid).length > 0 ? upid : undefined
}
