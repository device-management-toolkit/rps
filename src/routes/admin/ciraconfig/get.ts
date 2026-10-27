/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type CIRAConfig } from '../../../models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'

export async function getCiraConfig(req: Request<{ ciraConfigName: string }>, res: Response): Promise<void> {
  const log = new Logger('getCiraConfig')
  const ciraConfigName: string = req.params.ciraConfigName
  try {
    const results: CIRAConfig | null = await req.db.ciraConfigs.getByName(ciraConfigName, req.tenantId)
    if (results != null) {
      // secrets rules: never return sensitive data (passwords) in a response
      delete results.password
      MqttProvider.publishEvent('success', ['getCiraConfig'], `Get CIRA config profile : ${ciraConfigName}`)
      log.verbose(`CIRA config profile : ${JSON.stringify(results)}`)
      res.status(200).json(results).end()
    } else {
      throw new RPSError(NOT_FOUND_MESSAGE('CIRA', ciraConfigName), NOT_FOUND_EXCEPTION)
    }
  } catch (error) {
    handleError(log, ciraConfigName, req, res, error)
  }
}
