/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { deleteCiraConfig } from './delete.js'

import { vi, type MockInstance } from 'vitest'
describe('CIRA Config - delete', () => {
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
      db: { ciraConfigs: { delete: vi.fn() } },
      tenantId: '',
      query: {},
      params: { ciraConfigName: 'ciraConfig' }
    }
    deleteSpy = vi.spyOn(req.db.ciraConfigs, 'delete').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteCiraConfig(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = vi.spyOn(req.db.ciraConfigs, 'delete').mockResolvedValue(null)
    await deleteCiraConfig(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ciraConfigs, 'delete').mockRejectedValue(null)
    await deleteCiraConfig(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('ciraConfig', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
