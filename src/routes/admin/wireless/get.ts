/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { type Request, type Response } from 'express'
import { API_RESPONSE, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'

export async function getWirelessProfile(req: Request<{ profileName: string }>, res: Response): Promise<void> {
  const log = new Logger('getWirelessProfile')
  const { profileName } = req.params
  try {
    const result = await req.db.wirelessProfiles.getByName(profileName, req.tenantId)
    if (result == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('Wireless', profileName), NOT_FOUND_EXCEPTION)
    }
    const { pskPassphrase, ...response } = result || {}
    MqttProvider.publishEvent('success', ['getWirelessProfiles'], `Sent Wireless Profile : ${profileName}`)
    res.status(200).json(API_RESPONSE(response)).end()
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
