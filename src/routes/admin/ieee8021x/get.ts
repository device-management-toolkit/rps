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

export async function getIEEE8021xProfile(req: Request<{ profileName: string }>, res: Response): Promise<void> {
  const log = new Logger('getIeee8021xProfile')
  const { profileName } = req.params
  try {
    const result = await req.db.ieee8021xProfiles.getByName(profileName, req.tenantId)
    if (result == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('802.1x', profileName), NOT_FOUND_EXCEPTION)
    } else {
      MqttProvider.publishEvent('success', ['getIeee8021xProfiles'], `Sent 802.1x Profile : ${profileName}`)
      res.status(200).json(API_RESPONSE(result)).end()
    }
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
