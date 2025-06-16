/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteProfile } from './delete.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Profiles - Delete', () => {
  let resSpy
  let req
  let deleteSpy: jest.Spied<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { profiles: { delete: jest.fn(), getByName: jest.fn() } },
      query: {},
      tenantId: '',
      params: { profileName: 'profileName' }
    }
    deleteSpy = spyOn(req.db.profiles, 'delete').mockResolvedValue({})
    spyOn(req.db.profiles, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = spyOn(req.db.profiles, 'getByName').mockResolvedValue(null)
    await deleteProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    spyOn(req.db.profiles, 'delete').mockRejectedValue(null)
    await deleteProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
