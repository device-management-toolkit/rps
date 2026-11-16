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

// Longest inventory string stored. Real values are far shorter; the cap keeps a client from
// growing the MPS device record without bound.
export const maxInventoryValueLength = 256

type HostInventorySource = Partial<HostInventory> | null | undefined

// Picks the host inventory fields rpc-go reports (OS, serial number, UPID) for the MPS deviceInfo blob.
// MPS replaces deviceInfo wholesale, so anything the client did not send falls back to the value
// already stored in MPS (when known). Fields absent from both are omitted. The client payload is
// untrusted input, so values of the wrong type or longer than maxInventoryValueLength are treated
// as absent rather than stored verbatim.
export function getHostInventory(
  payload: HostInventorySource,
  existingDeviceInfo?: HostInventorySource
): HostInventory {
  const inventory: HostInventory = {}
  const osSource = osKeys.some((key) => isUsableString(payload?.[key])) ? payload : existingDeviceInfo
  for (const key of osKeys) {
    const value = osSource?.[key]
    if (isUsableString(value)) {
      inventory[key] = value
    }
  }
  const serialNumber = isUsableString(payload?.serialNumber) ? payload.serialNumber : existingDeviceInfo?.serialNumber
  if (isUsableString(serialNumber)) {
    inventory.serialNumber = serialNumber
  }
  // Like the OS fields, a UPID is taken from one source as a unit. rpc-go sends every field the
  // platform has, so a field missing from a reported UPID is absent on the device now; merging in
  // the stored one would pair this read's CSME ID with a stale OEM ID.
  const upid = toUPID(payload?.upid) ?? toUPID(existingDeviceInfo?.upid)
  if (upid != null) {
    inventory.upid = upid
  }
  return inventory
}

function isUsableString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= maxInventoryValueLength
}

// Keeps only the known, usable string fields of a UPID; undefined when nothing usable remains.
function toUPID(value: unknown): UPIDInfo | undefined {
  if (value == null || typeof value !== 'object') {
    return undefined
  }
  const upid: UPIDInfo = {}
  for (const key of upidKeys) {
    const field = (value as Record<string, unknown>)[key]
    if (isUsableString(field)) {
      upid[key] = field
    }
  }
  return Object.keys(upid).length > 0 ? upid : undefined
}
