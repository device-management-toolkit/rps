/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest'
import { createWirelessProfile } from './create'

describe('Wireless - Create', () => {
  let resSpy
  let req
  let insertSpy: jest.SpyInstance
  let writeSpy: jest.SpyInstance

  beforeEach(() => {
    resSpy = createSpyObj('Response', ['status', 'json', 'end', 'send'])
    req = {
      db: { wirelessProfiles: { insert: jest.fn() } },
      secretsManager: { writeSecretWithObject: jest.fn() },
      body: {},
      query: { }
    }
    insertSpy = jest.spyOn(req.db.wirelessProfiles, 'insert').mockResolvedValue({})
    writeSpy = jest.spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should create', async () => {
    await createWirelessProfile(req, resSpy)
    req.body = { ieee8021xProfileName: null, pskPassphrase: 'passPhrase' }
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should create 8021x', async () => {
    req.body = { ieee8021xProfileName: '8021x', pskPassphrase: null }
    await createWirelessProfile(req, resSpy)
    expect(writeSpy).toHaveBeenCalledTimes(0)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error', async () => {
    jest.spyOn(req.db.wirelessProfiles, 'insert').mockRejectedValue(null)
    await createWirelessProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledTimes(1)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
