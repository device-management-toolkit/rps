/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'

import { vi, type MockInstance } from 'vitest'
import { editProxyProfile } from './edit.js'

describe('Proxy - Edit', () => {
  let resSpy
  let req
  let updateSpy: MockInstance
  let getSpy: MockInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxyConfigs: { update: vi.fn(), getByName: vi.fn() } },
      query: {},
      params: { proxyConfigAddress: 'proxyConfigAddress' },
      tenantId: '',
      method: 'PATCH',
      body: {
        address: 'intel.com', // FQDN for testing auto-detection (will be 201)
        networkDnsSuffix: 'vprodemo',
        port: 443,
        tenantId: 'foo'
      }
    }
    updateSpy = vi.spyOn(req.db.proxyConfigs, 'update').mockResolvedValue({})
    getSpy = vi.spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should update', async () => {
    getSpy = vi.spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.proxyName, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    getSpy = vi.spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue(null)
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.proxyName, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    getSpy = vi.spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue({})
    vi.spyOn(req.db.proxyConfigs, 'update').mockRejectedValue(null)
    await editProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith(req.body.proxyName, req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
