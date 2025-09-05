/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'
import { editProxyProfile } from './edit.js'

describe('Proxy - Edit', () => {
  let resSpy
  let req
  let updateSpy: SpyInstance<any>
  let getSpy: SpyInstance<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxyConfigs: { update: jest.fn(), getByName: jest.fn() } },
      query: {},
      params: { proxyConfigAccessInfo: 'proxyConfigAccessInfo' },
      tenantId: '',
      method: 'PATCH',
      body: {
        accessInfo : "intel.com",
        infoFormat : 201,
        networkDnsSuffix : "vprodemo",
        port : 443,
        tenantId: "foo"
      }
    }
    updateSpy = spyOn(req.db.proxyConfigs, 'update',).mockResolvedValue({})
    getSpy = spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should update', async () => {
    getSpy = spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.accessInfo, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    getSpy = spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue(null)
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.accessInfo, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    getSpy = spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})
    spyOn(req.db.proxyConfigs, 'update').mockRejectedValue(null)
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.accessInfo, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
