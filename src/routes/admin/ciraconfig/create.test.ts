/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { createCiraConfig } from './create.js'

import { vi, type MockInstance } from 'vitest'
describe('CIRA Config - Create', () => {
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
      db: { ciraConfigs: { insert: vi.fn() } },
      body: {},
      query: {}
    }
    insertSpy = vi.spyOn(req.db.ciraConfigs, 'insert').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should create', async () => {
    await createCiraConfig(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ciraConfigs, 'insert').mockRejectedValue(null)
    await createCiraConfig(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
