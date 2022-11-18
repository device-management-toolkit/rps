/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger'
import { AMTConfiguration, DataWithCount } from '../../../models'
import { API_RESPONSE } from '../../../utils/constants'
import { MqttProvider } from '../../../utils/MqttProvider'
import { Request, Response } from 'express'
import handleError from '../../../utils/handleError'

export async function allProfiles (req: Request, res: Response): Promise<void> {
  const log = new Logger('allProfiles')
  let amtConfigs: AMTConfiguration[] = [] as AMTConfiguration[]
  const top = Number(req.query.$top)
  const skip = Number(req.query.$skip)
  const includeCount = req.query.$count
  try {
    amtConfigs = await req.db.profiles.get(top, skip)
    if (includeCount == null || includeCount === 'false') {
      res.status(200).json(API_RESPONSE(amtConfigs)).end()
    } else {
      const count: number = await req.db.profiles.getCount()
      const dataWithCount: DataWithCount = {
        data: amtConfigs,
        totalCount: count
      }
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
    MqttProvider.publishEvent('success', ['allProfiles'], 'Sent profiles')
  } catch (error) {
    handleError(log, '', req, res, error)
  }
}
