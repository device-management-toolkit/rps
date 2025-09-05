/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { API_UNEXPECTED_EXCEPTION, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { ProxyConfig } from 'models/RCS.Config.js'

export async function editProxyProfile(req: Request, res: Response): Promise<void> {
  const newProxy: ProxyConfig = req.body
  newProxy.tenantId = req.tenantId || ''
  const log = new Logger('deleteProxyProfile')
  try {
    const oldProxy: ProxyConfig | null = await req.db.proxyConfigs.getByName(newProxy.accessInfo, req.tenantId)

    if (oldProxy == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('AMT', newProxy.accessInfo), NOT_FOUND_EXCEPTION)
    } else {
      const proxiConfig: ProxyConfig = await getUpdatedData(newProxy, oldProxy)
      const results = await req.db.proxyConfigs.update(proxiConfig)
      if (results) {
        MqttProvider.publishEvent('success', ['editProxyConfig'], `Updated proxy configuration : ${newProxy.accessInfo}`)
        res.status(200).json(results).end()
      } else {
        throw new RPSError(API_UNEXPECTED_EXCEPTION('Error updating proxy configuration'))
      }
    }
  } catch (error) {
    handleError(log, 'proxyConfigAccessInfo', req, res, error)
  }
}

export const getUpdatedData = async (newProxy: ProxyConfig, oldProxy: ProxyConfig): Promise<ProxyConfig> => {
  const proxyConfig: ProxyConfig = { accessInfo: newProxy.accessInfo } as ProxyConfig
  proxyConfig.infoFormat = newProxy.infoFormat ?? oldProxy.infoFormat
  proxyConfig.networkDnsSuffix = newProxy.networkDnsSuffix ?? oldProxy.networkDnsSuffix
  proxyConfig.port = newProxy.port ?? oldProxy.port
  proxyConfig.tenantId = oldProxy.tenantId
  return proxyConfig
}
