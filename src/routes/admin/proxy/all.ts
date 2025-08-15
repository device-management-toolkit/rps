/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { type ProxyConfig } from '../../../models/RCS.Config.js'
import { API_RESPONSE } from '../../../utils/constants.js'
import { type DataWithCount } from '../../../models/index.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'

export async function allProxyProfiles(req: Request, res: Response): Promise<void> {
  const log = new Logger('allProfiles')
  const top = Number(req.query.$top)
  const skip = Number(req.query.$skip)
  const includeCount = req.query.$count
  try {
    const proxyConfigs: ProxyConfig[] = await req.db.proxyConfigs.get(top, skip, req.tenantId)
    if (includeCount == null || includeCount === 'false') {
      res.status(200).json(API_RESPONSE(proxyConfigs)).end()
    } else {
      const count: number = await req.db.proxyConfigs.getCount(req.tenantId)
      const dataWithCount: DataWithCount = {
        data: proxyConfigs,
        totalCount: count
      }
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
    MqttProvider.publishEvent('success', ['allProxyConfigs'], 'Sent proxy configs')
  } catch (error) {
    handleError(log, '', req, res, error)
  }
}
