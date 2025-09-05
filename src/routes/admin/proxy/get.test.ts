/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteProxyProfile } from './delete.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'
import { getProxyProfile } from './get.js'
import { ProxyConfig } from 'models/RCS.Config.js'


describe('Proxy - Delete', () => {
  let resSpy
  let req
  let proxyConfig: ProxyConfig
  let getSpy: SpyInstance<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])

    req = {
      db: { proxyConfigs: { getByName: jest.fn() } },
      query: {},
      params: { proxyName: 'proxyConfigName' },
      tenantId: '',
      method: 'GET'
    }

    getSpy = spyOn(req.db.proxyConfigs, 'getByName',).mockResolvedValue(proxyConfig = {
      proxyName : "proxyConfigName",
      accessInfo : "intel.com",
      infoFormat : 201,
      networkDnsSuffix : "vprodemo",
      port : 443,
      tenantId: "foo"
    })

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should get', async () => {
    await getProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith('proxyConfigName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    spyOn(req.db.proxyConfigs, 'getByName').mockResolvedValue(null)
    await getProxyProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    spyOn(req.db.proxyConfigs, 'getByName').mockRejectedValue(null)
    await getProxyProfile(req, resSpy)
    expect(getSpy).toHaveBeenCalledWith('proxyConfigName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
