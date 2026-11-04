/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { RPSError } from '../../../utils/RPSError.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'

export async function deleteIEEE8021xProfile(req: Request<{ profileName: string }>, res: Response): Promise<void> {
  const log = new Logger('deleteIEEE8021xProfile')
  const { profileName } = req.params
  try {
    const results: boolean = await req.db.ieee8021xProfiles.delete(profileName, req.tenantId)
    if (results) {
      MqttProvider.publishEvent('success', ['deleteIEEE8021xProfiles'], `Deleted 802.1x profile : ${profileName}`)
      log.verbose(`Deleted 802.1x profile : ${profileName}`)
      res.status(204).end()
    } else {
      throw new RPSError(NOT_FOUND_MESSAGE('802.1x', profileName), NOT_FOUND_EXCEPTION)
    }
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
