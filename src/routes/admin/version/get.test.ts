/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { getVersion } from './get.js'
import { ProtocolVersion } from '../../../utils/constants.js'
import { version } from '../../../utils/version.js'

describe('Checks getVersion', () => {
  let resSpy
  const req: any = undefined
  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
  })
  it('should return with protocolVersion and serviceVersion', () => {
    getVersion(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(200)
    expect(resSpy.json).toHaveBeenCalledWith({ serviceVersion: version, protocolVersion: ProtocolVersion })
  })
})
