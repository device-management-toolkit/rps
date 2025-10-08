/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProxyConfig } from '../../../models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { detectAddressFormat } from './proxyValidator.js'

export async function createProxyProfile(req: Request, res: Response): Promise<void> {
  const proxyConfig: ProxyConfig = req.body
  proxyConfig.tenantId = req.tenantId || ''
  const log = new Logger('createProxyProfile')
  try {
    // Auto-detect the infoFormat based on the address
    proxyConfig.infoFormat = detectAddressFormat(proxyConfig.address)

    const results: ProxyConfig | null = await req.db.proxyConfigs.insert(proxyConfig)
    log.verbose(`Created proxy profile: ${proxyConfig.name}`)
    MqttProvider.publishEvent('success', ['createProxyConfigs'], `Created proxy profile: ${proxyConfig.name}`)
    res.status(201).json(results).end()
  } catch (error) {
    handleError(log, 'proxyConfig.name', req, res, error)
  }
}
