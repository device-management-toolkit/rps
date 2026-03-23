/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteCiraConfig } from './delete.js'
import { jest } from '@jest/globals'
import { type Spied, spyOn } from 'jest-mock'

describe('CIRA Config - delete', () => {
  let resSpy
  let req
  let deleteSpy: Spied<any>
  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { ciraConfigs: { delete: jest.fn() } },
      tenantId: '',
      query: {},
      params: { ciraConfigName: 'ciraConfig' }
    }
    deleteSpy = spyOn(req.db.ciraConfigs, 'delete').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteCiraConfig(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = spyOn(req.db.ciraConfigs, 'delete').mockResolvedValue(null)
    await deleteCiraConfig(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    spyOn(req.db.ciraConfigs, 'delete').mockRejectedValue(null)
    await deleteCiraConfig(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('ciraConfig', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
  it('should encode configName with special characters in secret path', async () => {
    const deleteSecretSpy = jest.fn<any>().mockResolvedValue(true)
    req.secretsManager = { deleteSecretAtPath: deleteSecretSpy }
    req.params.ciraConfigName = '%fGLW#z_wqOD^LtX5vK1AXl'
    spyOn(req.db.ciraConfigs, 'delete').mockResolvedValue(true)
    await deleteCiraConfig(req, resSpy)
    expect(deleteSecretSpy).toHaveBeenCalledWith('CIRAConfigs/%25fGLW%23z_wqOD^LtX5vK1AXl')
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
})
