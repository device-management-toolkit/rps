/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { deleteProxyProfile } from './delete.js'

import { vi, type MockInstance } from 'vitest'
describe('Proxy - Delete', () => {
  let resSpy
  let req
  let deleteSpy: MockInstance
  let checkSpy: MockInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxyConfigs: { delete: vi.fn(), checkProfileExits: vi.fn() } },
      query: {},
      params: { name: 'proxyConfigName' },
      tenantId: '',
      method: 'DELETE'
    }
    deleteSpy = vi.spyOn(req.db.proxyConfigs, 'delete').mockResolvedValue({})
    checkSpy = vi.spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    checkSpy = vi.spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)
    await deleteProxyProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    checkSpy = vi.spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(false)
    await deleteProxyProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    checkSpy = vi.spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)
    vi.spyOn(req.db.proxyConfigs, 'delete').mockRejectedValue(null)
    await deleteProxyProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('proxyConfigName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
