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

export async function deleteCiraConfig(req: Request, res: Response): Promise<void> {
  const log = new Logger('deleteCiraConfig')
  const ciraConfigName: string = req.params.ciraConfigName
  try {
    const result: boolean = await req.db.ciraConfigs.delete(ciraConfigName, req.tenantId)
    if (result) {
      if (req.secretsManager) {
        await req.secretsManager.deleteSecretAtPath(
          `CIRAConfigs/${ciraConfigName.replace(/%/g, '%25').replace(/#/g, '%23')}`
        )
      }
      MqttProvider.publishEvent('success', ['deleteCiraConfig'], `Deleted CIRA config : ${ciraConfigName}`)
      log.verbose(`Deleted CIRA config profile : ${ciraConfigName}`)
      res.status(204).end()
    } else {
      throw new RPSError(NOT_FOUND_MESSAGE('CIRA', ciraConfigName), NOT_FOUND_EXCEPTION)
    }
  } catch (error) {
    handleError(log, ciraConfigName, req, res, error)
  }
}
