/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { editIEEE8021xProfile } from './edit.js'

import { vi, type MockInstance } from 'vitest'
describe('Checks editIEEE8021xProfile', () => {
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
      db: { ieee8021xProfiles: { getByName: vi.fn(), update: vi.fn() } },
      body: { profileName: 'profileName', password: 'password' },
      tenantId: '',
      secretsManager: { writeSecretWithObject: vi.fn() }
    }
    getByNameSpy = vi.spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue({})
    vi.spyOn(req.db.ieee8021xProfiles, 'update').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should edit', async () => {
    await editIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    vi.spyOn(req.db.ieee8021xProfiles, 'getByName').mockResolvedValue(null)
    await editIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ieee8021xProfiles, 'getByName').mockRejectedValue(null)
    await editIEEE8021xProfile(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
