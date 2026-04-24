/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { createIEEE8021xProfile } from './create.js'

import { vi, type MockInstance } from 'vitest'
describe('Checks createIEEE8021xProfile', () => {
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
      db: { ieee8021xProfiles: { insert: vi.fn() } },
      body: {},
      query: {},
      secretsManager: { writeSecretWithObject: vi.fn() },
      profileName: 'abcd'
    }
    vi.spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue({})
    insertSpy = vi.spyOn(req.db.ieee8021xProfiles, 'insert').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should create', async () => {
    await createIEEE8021xProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error', async () => {
    vi.spyOn(req.db.ieee8021xProfiles, 'insert').mockRejectedValue(null)
    await createIEEE8021xProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
