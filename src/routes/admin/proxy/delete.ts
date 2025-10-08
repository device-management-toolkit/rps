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

export async function deleteProxyProfile(req: Request, res: Response): Promise<void> {
  const { name } = req.params
  const tenantId = req.tenantId || ''
  const log = new Logger('deleteProxyProfile')
  try {
    const proxyConfigExists: boolean = await req.db.proxyConfigs.checkProfileExits(name, tenantId)
    if (!proxyConfigExists) {
      throw new RPSError(NOT_FOUND_MESSAGE('Proxy', name), NOT_FOUND_EXCEPTION)
    } else {
      const results: boolean | null = await req.db.proxyConfigs.delete(name, tenantId)
      if (results) {
        log.verbose(`Deleted proxy profile : ${name}`)
        MqttProvider.publishEvent('success', ['deleteProxyProfile'], `Deleted proxy configuration : ${name}`)
        res.status(204).json(results).end()
      } else {
        throw new RPSError(API_UNEXPECTED_EXCEPTION('Error deleting proxy configuration'))
      }
    }
  } catch (error) {
    handleError(log, 'deleteProxyProfile', req, res, error)
  }
}
