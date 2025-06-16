/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { getWirelessProfile } from './get.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Wireless - Get', () => {
  let resSpy
  let req
  let getByNameSpy: jest.Spied<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { wirelessProfiles: { getByName: jest.fn() } },
      query: {},
      params: { profileName: 'profileName' },
      tenantId: ''
    }
    getByNameSpy = spyOn(req.db.wirelessProfiles, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should get', async () => {
    await getWirelessProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle error', async () => {
    spyOn(req.db.wirelessProfiles, 'getByName').mockRejectedValue(null)
    await getWirelessProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
