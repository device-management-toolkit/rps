/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { getCiraConfig } from './get.js'

import { vi, type MockInstance } from 'vitest'
describe('CIRA Config - Get', () => {
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
      db: { ciraConfigs: { getByName: vi.fn() } },
      query: {},
      params: { ciraConfigName: 'ciraConfig' },
      tenantId: ''
    }
    getByNameSpy = vi.spyOn(req.db.ciraConfigs, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should get', async () => {
    await getCiraConfig(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('ciraConfig', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ciraConfigs, 'getByName').mockRejectedValue(null)
    await getCiraConfig(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('ciraConfig', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
