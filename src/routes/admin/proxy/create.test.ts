/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { createProxyProfile } from './create.js'

import { vi, type MockInstance } from 'vitest'
describe('Proxy - Create', () => {
  let resSpy
  let req
  let insertSpy: MockInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxyConfigs: { insert: vi.fn() } },
      body: {
        address: '192.168.1.1' // IPv4 address for testing auto-detection
      },
      query: {}
    }
    insertSpy = vi.spyOn(req.db.proxyConfigs, 'insert').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should create and auto-detect infoFormat for IPv4', async () => {
    req.body.address = '192.168.1.1'
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    // Verify that infoFormat was set to 3 (IPv4)
    expect(req.body.infoFormat).toBe(3)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should create and auto-detect infoFormat for IPv6', async () => {
    req.body.address = '2001:0db8:85a3:0000:0000:8a2e:0370:7334'
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    // Verify that infoFormat was set to 4 (IPv6)
    expect(req.body.infoFormat).toBe(4)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should create and auto-detect infoFormat for FQDN', async () => {
    req.body.address = 'proxy.example.com'
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    // Verify that infoFormat was set to 201 (FQDN)
    expect(req.body.infoFormat).toBe(201)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.proxyConfigs, 'insert').mockRejectedValue(null)
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
