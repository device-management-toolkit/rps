/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { CIRAConfig } from '../../../models/RCS.Config'
import Logger from '../../../Logger'
import { API_RESPONSE, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants'
import { MqttProvider } from '../../../utils/MqttProvider'
import { Request, Response } from 'express'
import handleError from '../../../utils/handleError'
import { RPSError } from '../../../utils/RPSError'

export async function getCiraConfig (req: Request, res: Response): Promise<void> {
  const log = new Logger('getCiraConfig')
  const ciraConfigName: string = req.params.ciraConfigName
  try {
    const results: CIRAConfig = await req.db.ciraConfigs.getByName(ciraConfigName)
    if (results != null) {
      // Return null. Check Security objectives around returning passwords.
      delete results.password
      MqttProvider.publishEvent('success', ['getCiraConfig'], `Get CIRA config profile : ${ciraConfigName}`)
      log.verbose(`CIRA config profile : ${JSON.stringify(results)}`)
      res.status(200).json(API_RESPONSE(results)).end()
    } else {
      throw new RPSError(NOT_FOUND_MESSAGE('CIRA', ciraConfigName), NOT_FOUND_EXCEPTION)
    }
  } catch (error) {
    handleError(log, ciraConfigName, req, res, error)
  }
}
