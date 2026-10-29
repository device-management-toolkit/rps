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

export async function deleteWirelessProfile(req: Request<{ profileName: string }>, res: Response): Promise<void> {
  const log = new Logger('deleteWirelessProfile')
  const { profileName } = req.params
  try {
    const results: boolean = await req.db.wirelessProfiles.delete(profileName, req.tenantId)
    if (results) {
      if (req.secretsManager) {
        await req.secretsManager.deleteSecretAtPath(`Wireless/${profileName}`)
      }
      MqttProvider.publishEvent('success', ['deleteWirelessProfiles'], `Deleted wireless profile : ${profileName}`)
      log.verbose(`Deleted wireless profile : ${profileName}`)
      res.status(204).end()
    } else {
      throw new RPSError(NOT_FOUND_MESSAGE('Wireless', profileName), NOT_FOUND_EXCEPTION)
    }
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
