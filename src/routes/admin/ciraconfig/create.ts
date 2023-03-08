/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type CIRAConfig } from '../../../models/RCS.Config'
import Logger from '../../../Logger'
import { MqttProvider } from '../../../utils/MqttProvider'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError'
import { type CiraConfigSecrets } from '../../../interfaces/ISecretManagerService'

export async function createCiraConfig (req: Request, res: Response): Promise<void> {
  const log = new Logger('createCiraConfig')
  const ciraConfig: CIRAConfig = req.body
  ciraConfig.tenantId = req.tenantId || ''

  try {
    // secrets rules: if secret manager is available, keep password out of database
    if (ciraConfig.password && req.secretsManager) {
      const secrets: CiraConfigSecrets = {
        MPS_PASSWORD: ciraConfig.password
      }
      const secretRsp = await req.secretsManager.writeSecretWithObject(`CIRAConfigs/${ciraConfig.configName}`, secrets)
      if (secretRsp == null) {
        throw new Error('Error saving cira configuration secrets to secret provider')
      }
      delete ciraConfig.password
    }
    const results: CIRAConfig = await req.db.ciraConfigs.insert(ciraConfig)
    if (results != null) {
      // secrets rules: never return sensitive data (passwords) in a response
      delete results.password
      log.verbose(`Created CIRA config : ${ciraConfig.configName}`)
      MqttProvider.publishEvent('success', ['createCiraConfig'], `Created ${results.configName}`)
      res.status(201).json(results).end()
    }
  } catch (error) {
    handleError(log, ciraConfig.configName, req, res, error)
  }
}
