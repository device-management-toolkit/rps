/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { createIEEE8021xProfile } from './create.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Checks createIEEE8021xProfile', () => {
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
      db: { ieee8021xProfiles: { insert: jest.fn() } },
      body: {},
      query: {},
      secretsManager: { writeSecretWithObject: jest.fn() },
      profileName: 'abcd'
    }
    spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue({})
    insertSpy = spyOn(req.db.ieee8021xProfiles, 'insert').mockResolvedValue({})
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
    spyOn(req.db.ieee8021xProfiles, 'insert').mockRejectedValue(null)
    await createIEEE8021xProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
