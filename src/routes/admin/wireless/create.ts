/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { wirelessSecretPath } from '../../../utils/secretPaths.js'

import { type WirelessConfig } from '../../../models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { type WifiCredentials } from '../../../interfaces/ISecretManagerService.js'
export async function createWirelessProfile(req: Request, res: Response): Promise<void> {
  const wirelessConfig: WirelessConfig = req.body
  wirelessConfig.tenantId = req.tenantId || ''
  const log = new Logger('createWirelessProfile')
  try {
    const passphrase = wirelessConfig.pskPassphrase
    // prevents passphrase from being stored in DB
    if (req.secretsManager) {
      wirelessConfig.pskPassphrase = 'PSK_PASSPHRASE'
    }
    const results: WirelessConfig | null = await req.db.wirelessProfiles.insert(wirelessConfig)
    // store the password into Vault
    if (req.secretsManager) {
      if (req.body.ieee8021xProfileName == null) {
        await req.secretsManager.writeSecretWithObject(wirelessSecretPath(wirelessConfig.profileName, req.tenantId), {
          PSK_PASSPHRASE: passphrase
        } as WifiCredentials)
        log.debug(`pskPassphrase stored in Vault for wireless profile: ${wirelessConfig.profileName}`)
      }
    }
    log.verbose(`Created wireless profile : ${wirelessConfig.profileName}`)
    const { pskPassphrase, ...response } = results || {}
    MqttProvider.publishEvent(
      'success',
      ['createWirelessProfiles'],
      `Created wireless profile : ${wirelessConfig.profileName}`
    )
    res.status(201).json(response).end()
  } catch (error) {
    handleError(log, 'wirelessConfig.profileName', req, res, error)
  }
}
