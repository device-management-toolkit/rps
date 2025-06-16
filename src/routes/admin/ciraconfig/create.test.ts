/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { createCiraConfig } from './create.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('CIRA Config - Create', () => {
  let resSpy
  let req
  let insertSpy: jest.Spied<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { ciraConfigs: { insert: jest.fn() } },
      body: {},
      query: {}
    }
    insertSpy = spyOn(req.db.ciraConfigs, 'insert').mockResolvedValue({})
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
    spyOn(req.db.ciraConfigs, 'insert').mockRejectedValue(null)
    await createCiraConfig(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
