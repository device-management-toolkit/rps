/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { editWirelessProfile } from './edit.js'

import { vi, type MockInstance } from 'vitest'
describe('Wireless - Edit', () => {
  let resSpy
  let req
  let getByNameSpy: MockInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { wirelessProfiles: { getByName: vi.fn(), update: vi.fn() } },
      body: { profileName: 'profileName' },
      tenantId: '',
      query: {}
    }
    getByNameSpy = vi.spyOn(req.db.wirelessProfiles, 'getByName').mockResolvedValue({})
    vi.spyOn(req.db.wirelessProfiles, 'update').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should edit', async () => {
    await editWirelessProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    vi.spyOn(req.db.wirelessProfiles, 'getByName').mockResolvedValue(null)
    await editWirelessProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.wirelessProfiles, 'getByName').mockRejectedValue(null)
    await editWirelessProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
