/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { getHostInventory } from './hostInventory.js'

describe('getHostInventory', () => {
  const upid = { csmeId: 'ABCD', oemId: '', oemPlatformIdType: 'Not Set (0)' }

  it('picks only the host inventory fields from the client payload', () => {
    const payload = {
      ver: '16.1.25',
      uuid: '4c4c4544-0000-0000-0000-000000000000',
      osName: 'windows',
      osVersion: '10.0.26200.9711',
      osDistro: 'Windows 11 Enterprise 25H2',
      serialNumber: 'PF51TS9X',
      upid
    }
    expect(getHostInventory(payload)).toEqual({
      osName: 'windows',
      osVersion: '10.0.26200.9711',
      osDistro: 'Windows 11 Enterprise 25H2',
      serialNumber: 'PF51TS9X',
      upid
    })
  })

  it('omits fields that are missing, empty, or blank', () => {
    expect(getHostInventory({ osName: 'linux', serialNumber: '  ', upid: {} })).toEqual({ osName: 'linux' })
    expect(getHostInventory({})).toEqual({})
    expect(getHostInventory(undefined)).toEqual({})
  })

  it('falls back to values already stored in MPS when the client omits them', () => {
    const existing = { osName: 'linux', serialNumber: 'OLD123', upid, activatedAt: '2025-01-01T00:00:00.000Z' }
    expect(getHostInventory({ osName: 'windows' }, existing)).toEqual({
      osName: 'windows',
      serialNumber: 'OLD123',
      upid
    })
  })
})
