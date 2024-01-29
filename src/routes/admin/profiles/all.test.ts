/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { allProfiles } from './all.js'
import { jest } from '@jest/globals'

describe('Profiles - All', () => {
  let resSpy
  let req
  beforeEach(() => {
    resSpy = createSpyObj('Response', ['status', 'json', 'end', 'send'])
    req = {
      db: {
        profiles: {
          get: jest.fn<() => Promise<any>>().mockImplementation(async () => await Promise.resolve([])),
          getCount: jest.fn<() => Promise<number>>().mockImplementation(async () => await Promise.resolve(123))
        }
      },
      query: {}
    }
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })

  it('should get all', async () => {
    await allProfiles(req, resSpy)
    expect(req.db.profiles.get).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should get all with req.query.$count as true', async () => {
    req.query.$count = true
    await allProfiles(req, resSpy)
    expect(req.db.profiles.get).toHaveBeenCalled()
    expect(req.db.profiles.getCount).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should set status to 500 if error occurs', async () => {
    req.db.profiles.getCount = jest.fn().mockImplementation(() => {
      throw new TypeError('fake error')
    })
    req.query.$count = true
    await allProfiles(req, resSpy)
    expect(req.db.profiles.get).toHaveBeenCalled()
    expect(req.db.profiles.getCount).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
