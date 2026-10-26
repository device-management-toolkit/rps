/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from '../../../utils/Environment.js'

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { deleteProfile } from './delete.js'

import { vi, type MockInstance } from 'vitest'
describe('Profiles - Delete', () => {
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
      db: { profiles: { delete: vi.fn(), getByName: vi.fn() } },
      query: {},
      tenantId: '',
      params: { profileName: 'profileName' }
    }
    deleteSpy = vi.spyOn(req.db.profiles, 'delete').mockResolvedValue({})
    vi.spyOn(req.db.profiles, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should delete profile and TLS secrets under the request tenant', async () => {
    Environment.Config = { ...Environment.Config, secrets_tenant_partition: true } as any
    req.tenantId = 'tenant-a'
    req.secretsManager = { deleteSecretAtPath: vi.fn().mockResolvedValue(true) }
    vi.spyOn(req.db.profiles, 'getByName').mockResolvedValue({
      profileName: 'profileName',
      generateRandomPassword: false,
      generateRandomMEBxPassword: true
    })
    await deleteProfile(req, resSpy)
    expect(req.secretsManager.deleteSecretAtPath).toHaveBeenCalledWith('tenants/tenant-a/profiles/profileName')
    expect(req.secretsManager.deleteSecretAtPath).toHaveBeenCalledWith('tenants/tenant-a/TLS/profileName')
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = vi.spyOn(req.db.profiles, 'getByName').mockResolvedValue(null)
    await deleteProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.profiles, 'delete').mockRejectedValue(null)
    await deleteProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('profileName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
