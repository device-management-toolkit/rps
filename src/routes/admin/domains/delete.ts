/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { domainCertSecretPath } from '../../../utils/secretPaths.js'

import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { type AMTDomain } from '../../../models/index.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import { RPSError } from '../../../utils/RPSError.js'
import handleError from '../../../utils/handleError.js'

export async function deleteDomain(req: Request, res: Response): Promise<void> {
  const log = new Logger('deleteDomain')
  const { domainName } = req.params
  try {
    const domain: AMTDomain | null = await req.db.domains.getByName(domainName, req.tenantId)
    if (domain == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('Domain', domainName), NOT_FOUND_EXCEPTION)
    } else {
      const results = await req.db.domains.delete(domainName, req.tenantId)
      if (results) {
        if (req.secretsManager) {
          await req.secretsManager.deleteSecretAtPath(domainCertSecretPath(domain.profileName, req.tenantId))
        }
        MqttProvider.publishEvent('success', ['deleteDomain'], `Domain Deleted : ${domainName}`)
        res.status(204).end()
      }
    }
  } catch (error) {
    handleError(log, domainName, req, res, error)
  }
}
