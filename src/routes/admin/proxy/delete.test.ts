/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteProxyProfile } from './delete.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

describe('Proxy - Delete', () => {
  let resSpy
  let req
  let deleteSpy: SpyInstance<any>
  let checkSpy: SpyInstance<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxyConfigs: { delete: jest.fn(), checkProfileExits: jest.fn() } },
      query: {},
      params: { proxyName: 'proxyConfigName' },
      tenantId: '',
      method: 'DELETE'
    }
    deleteSpy = spyOn(req.db.proxyConfigs, 'delete',).mockResolvedValue({})
    checkSpy = spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    checkSpy = spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)
    await deleteProxyProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    checkSpy = spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(false)
    await deleteProxyProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    checkSpy = spyOn(req.db.proxyConfigs, 'checkProfileExits').mockResolvedValue(true)
    spyOn(req.db.proxyConfigs, 'delete').mockRejectedValue(null)
    await deleteProxyProfile(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('proxyConfigName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
