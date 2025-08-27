/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProxyConfig } from '../../../models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
export async function createProxyProfile(req: Request, res: Response): Promise<void> {
  const proxyConfig: ProxyConfig = req.body
  proxyConfig.tenantId = req.tenantId || ''
  const log = new Logger('createProxyProfile')
  try {
    const results: ProxyConfig | null = await req.db.proxyConfigs.insert(proxyConfig)
    log.verbose(`Created proxy config: ${proxyConfig.accessInfo}`)
    MqttProvider.publishEvent('success', ['createProxyConfigs'], `Created proxy config: ${proxyConfig.accessInfo}`)
    res.status(201).json(results).end()
  } catch (error) {
    handleError(log, 'proxyConfig.accessInfo', req, res, error)
  }
}
