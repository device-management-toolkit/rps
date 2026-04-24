/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { createSpyObj } from '../../../test/helper/testUtils.js'
import { allCiraConfigs } from './all.js'

describe('CIRA Config - All', () => {
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
        ciraConfigs: {
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
    await allCiraConfigs(req, resSpy)
    expect(req.db.ciraConfigs.get).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should get all with req.query.$count as true', async () => {
    req.query.$count = true
    await allCiraConfigs(req, resSpy)
    expect(req.db.ciraConfigs.get).toHaveBeenCalled()
    expect(req.db.ciraConfigs.getCount).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(200)
  })

  it('should set status to 500 if error occurs', async () => {
    req.db.ciraConfigs.getCount = vi.fn().mockImplementation(() => {
      throw new TypeError('fake error')
    })
    req.query.$count = true
    await allCiraConfigs(req, resSpy)
    expect(req.db.ciraConfigs.get).toHaveBeenCalled()
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
