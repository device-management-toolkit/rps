/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { deleteDomain } from './delete.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('CIRA Config - Delete', () => {
  let resSpy
  let req
  let deleteSpy: jest.Spied<any>

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { domains: { delete: jest.fn(), getByName: jest.fn() } },
      query: {},
      params: { domainName: 'domainName' },
      tenantId: ''
    }
    deleteSpy = spyOn(req.db.domains, 'delete').mockResolvedValue({})
    spyOn(req.db.domains, 'getByName').mockResolvedValue({})

    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should delete', async () => {
    await deleteDomain(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(204)
  })
  it('should handle not found', async () => {
    deleteSpy = spyOn(req.db.domains, 'getByName').mockResolvedValue(null)
    await deleteDomain(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })
  it('should handle error', async () => {
    spyOn(req.db.domains, 'delete').mockRejectedValue(null)
    await deleteDomain(req, resSpy)
    expect(deleteSpy).toHaveBeenCalledWith('domainName', req.tenantId)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
