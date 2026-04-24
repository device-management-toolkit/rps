/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { getAllIEEE8021xConfigs } from './all.js'

import { vi } from 'vitest'
describe('IEEE8021xConfigs - All', () => {
  let resSpy
  let req
  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: {
        ieee8021xProfiles: {
          get: vi.fn<() => Promise<any>>().mockImplementation(async () => await Promise.resolve([])),
          getCount: vi.fn<() => Promise<number>>().mockImplementation(async () => await Promise.resolve(123))
        }
      },
      query: {}
    }
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })

  it('should get all', async () => {
    await getAllIEEE8021xConfigs(req, resSpy)
    expect(req.db.ieee8021xProfiles.get).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should get all IEEE8021x Profiles length > 0', async () => {
    req.query.$count = true
    vi.spyOn(req.db.ieee8021xProfiles, 'get').mockResolvedValue(['abc'])
    await getAllIEEE8021xConfigs(req, resSpy)
    expect(req.db.ieee8021xProfiles.get).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should get all req.query.$count as true', async () => {
    req.query.$count = true
    await getAllIEEE8021xConfigs(req, resSpy)
    expect(req.db.ieee8021xProfiles.get).toHaveBeenCalled()
    expect(req.db.ieee8021xProfiles.getCount).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should set status to 500 if error occurs', async () => {
    req.db.ieee8021xProfiles.getCount = vi.fn().mockImplementation(() => {
      throw new TypeError('fake error')
    })
    req.query.$count = true
    await getAllIEEE8021xConfigs(req, resSpy)
    expect(req.db.ieee8021xProfiles.get).toHaveBeenCalled()
    expect(req.db.ieee8021xProfiles.getCount).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
