/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { type Request, type Response } from 'express'
import {
  API_RESPONSE,
  API_UNEXPECTED_EXCEPTION,
  POSTGRES_RESPONSE_CODES,
  VAULT_RESPONSE_CODES
} from '../../../utils/constants.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type HealthCheck } from '../../../models/RCS.Config.js'
import { Environment } from '../../../utils/Environment.js'
import { type ISecretManagerService } from '../../../interfaces/ISecretManagerService.js'
import { type IDB } from '../../../interfaces/database/IDb.js'

export async function getHealthCheck(req: Request, res: Response): Promise<void> {
  const log = new Logger('getHealthCheck')
  try {
    const status: HealthCheck = {
      db: {
        name: Environment.Config.db_provider.toUpperCase(),
        status: 'OK'
      },
      secretStore: {
        name: Environment.Config.secrets_provider.toUpperCase(),
        status: 'OK'
      }
    }

    status.db.status = await getDBHealth(req.db)
    status.secretStore.status = await getSecretStoreHealth(req.secretsManager)

    res.status(200)
    if (
      status.db.status !== 'OK' ||
      status.secretStore.status.initialized !== true ||
      status.secretStore.status.sealed === true
    ) {
      res.status(503)
    }

    res.json(status).end()
  } catch (error) {
    MqttProvider.publishEvent('fail', ['getHealthCheck'], 'Failed to get health')
    log.error('Failed to get health', JSON.stringify(error))
    res
      .status(500)
      .json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('Health Check failed')))
      .end()
  }
}

export async function getDBHealth(db: IDB): Promise<any> {
  try {
    await db.query('SELECT 1')
    return 'OK'
  } catch (dbError) {
    if (dbError.code) {
      return POSTGRES_RESPONSE_CODES(dbError?.code)
    } else {
      return POSTGRES_RESPONSE_CODES()
    }
  }
}

export async function getSecretStoreHealth(secretsManager: ISecretManagerService): Promise<any> {
  try {
    const secretProviderResponse = await secretsManager.health()
    return secretProviderResponse
  } catch (secretProviderError) {
    // Providers other than Vault report their own status name instead of a Vault status code.
    if (typeof secretProviderError?.healthStatus === 'string') {
      return secretProviderError.healthStatus
    }
    if (secretProviderError.error) {
      return VAULT_RESPONSE_CODES(secretProviderError.error.code)
    } else {
      return VAULT_RESPONSE_CODES(secretProviderError)
    }
  }
}
