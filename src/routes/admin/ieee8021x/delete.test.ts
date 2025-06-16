/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteIEEE8021xProfile } from './delete.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('checks deleteIEEE8021xProfile', () => {
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
      db: { ieee8021xProfiles: { delete: jest.fn() } },
      body: {},
      query: {},
      secretsManager: { writeSecretWithObject: jest.fn(), deleteSecretAtPath: jest.fn() },
      profileName: 'abcd',
      params: {}
    }
    spyOn(req.secretsManager, 'deleteSecretAtPath').mockResolvedValue({})
    deleteSpy = spyOn(req.db.ieee8021xProfiles, 'delete').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteIEEE8021xProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = spyOn(req.db.ieee8021xProfiles, 'delete').mockResolvedValue(null)
    await deleteIEEE8021xProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
})
