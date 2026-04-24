/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { editCiraConfig } from './edit.js'

import { vi, type MockInstance } from 'vitest'
describe('CIRA Config - Edit', () => {
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
      db: { ciraConfigs: { getByName: vi.fn(), update: vi.fn() } },
      body: { configName: 'configName' },
      query: {},
      tenantId: ''
    }
    getByNameSpy = vi.spyOn(req.db.ciraConfigs, 'getByName').mockResolvedValue({})
    vi.spyOn(req.db.ciraConfigs, 'update').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should edit', async () => {
    await editCiraConfig(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('configName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle not found', async () => {
    vi.spyOn(req.db.ciraConfigs, 'getByName').mockResolvedValue(null)
    await editCiraConfig(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('configName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ciraConfigs, 'getByName').mockRejectedValue(null)
    await editCiraConfig(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('configName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
