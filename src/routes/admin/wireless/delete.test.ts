/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { deleteWirelessProfile } from './delete.js'

import { vi, type MockInstance } from 'vitest'
describe('Wireless - Delete', () => {
  let resSpy
  let req
  let deleteSpy: MockInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { wirelessProfiles: { delete: vi.fn(), getByName: vi.fn() } },
      query: {},
      tenantId: '',
      params: { profileName: 'profileName' }
    }
    deleteSpy = vi.spyOn(req.db.wirelessProfiles, 'delete').mockResolvedValue({})
    vi.spyOn(req.db.wirelessProfiles, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteWirelessProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = vi.spyOn(req.db.wirelessProfiles, 'delete').mockResolvedValue(null)
    await deleteWirelessProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.wirelessProfiles, 'delete').mockRejectedValue(null)
    await deleteWirelessProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
