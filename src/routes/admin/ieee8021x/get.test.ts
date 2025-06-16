/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { getIEEE8021xProfile } from './get.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Checks - getIEEE8021xProfile', () => {
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
      db: {
        ieee8021xProfiles: {
          getByName: jest.fn(),
          getCountByInterface: jest.fn()
        }
      },
      params: { profileName: 'profileName', password: 'password' },
      tenantId: '',
      secretsManager: { writeSecretWithObject: jest.fn() }
    }
    getByNameSpy = spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue('abcd')

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should get', async () => {
    await getIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue(null)
    await getIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    spyOn(req.db.ieee8021xProfiles, 'getByName').mockRejectedValue(null)
    await getIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
