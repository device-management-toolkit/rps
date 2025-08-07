/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { createProxyProfile } from './create.js'
import { jest } from '@jest/globals'
import { type SpyInstance, spyOn } from 'jest-mock'

describe('Proxy - Create', () => {
  let resSpy
  let req
  let insertSpy: SpyInstance<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { proxiesProfiles: { insert: jest.fn() } },
      body: {},
      query: {}
    }
    insertSpy = spyOn(req.db.proxiesProfiles, 'insert').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should create', async () => {
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error', async () => {
    spyOn(req.db.proxiesProfiles, 'insert').mockRejectedValue(null)
    await createProxyProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
