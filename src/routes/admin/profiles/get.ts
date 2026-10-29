/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { API_RESPONSE, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { type AMTConfiguration } from '../../../models/index.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'

export async function getProfile(req: Request<{ profileName: string }>, res: Response): Promise<void> {
  const log = new Logger('getProfile')
  const { profileName } = req.params
  try {
    const result: AMTConfiguration | null = await req.db.profiles.getByName(profileName, req.tenantId)
    if (result == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('AMT', profileName), NOT_FOUND_EXCEPTION)
    } else {
      MqttProvider.publishEvent('success', ['getProfile'], `Sent Profile : ${profileName}`)
      res.status(200).json(API_RESPONSE(result)).end()
    }
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
