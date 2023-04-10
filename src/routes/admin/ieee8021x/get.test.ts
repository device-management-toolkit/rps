/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest'
import { getIEEE8021xProfile, getIEEE8021xCountByInterface } from './get'

describe('Checks - getIEEE8021xProfile', () => {
  let resSpy
  let req
  let getByNameSpy: jest.SpyInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', ['status', 'json', 'end', 'send'])
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
    getByNameSpy = jest.spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue('abcd')

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
    jest.spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue(null)
    await getIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    jest.spyOn(req.db.ieee8021xProfiles, 'getByName').mockRejectedValue(null)
    await getIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })

  it('should get wired interface profile', async () => {
    const getSpy = jest
      .spyOn(req.db.ieee8021xProfiles, 'getCountByInterface')
      .mockResolvedValue({ profileName: 'doesntmatter' })
    await getIEEE8021xCountByInterface(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle wired interface profile not found', async () => {
    const getSpy = jest
      .spyOn(req.db.ieee8021xProfiles, 'getCountByInterface')
      .mockResolvedValue(null)
    await getIEEE8021xCountByInterface(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle wired interface profile error', async () => {
    const getSpy = jest
      .spyOn(req.db.ieee8021xProfiles, 'getCountByInterface')
      .mockRejectedValue('test error')
    await getIEEE8021xCountByInterface(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
