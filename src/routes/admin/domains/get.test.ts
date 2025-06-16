/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { getDomain } from './get.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('CIRA Config - Get', () => {
  let resSpy
  let req
  let getByNameSpy: jest.Spied<any>
  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { domains: { getByName: jest.fn() } },
      query: {},
      params: { domainName: 'domainName' },
      tenantId: ''
    }
    getByNameSpy = spyOn(req.db.domains, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should get', async () => {
    await getDomain(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('domainName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })
  it('should handle error', async () => {
    spyOn(req.db.domains, 'getByName').mockRejectedValue(null)
    await getDomain(req, resSpy)
    expect(getByNameSpy).toHaveBeenCalledWith('domainName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
