/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { wirelessSecretPath } from '../../../utils/secretPaths.js'

import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { type WirelessConfig } from '../../../models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'

export async function editWirelessProfile(req: Request, res: Response): Promise<void> {
  const log = new Logger('editNetProfile')
  try {
    const config: WirelessConfig | null = await req.db.wirelessProfiles.getByName(req.body.profileName, req.tenantId)
    if (config == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('Wireless', req.body.profileName), NOT_FOUND_EXCEPTION)
    }
    const passphrase = req.body.pskPassphrase
    if (passphrase) {
      config.pskPassphrase = 'PSK_PASSPHRASE'
    }
    const updateConfig = { ...config, ...req.body }
    if (!req.body.version) {
      updateConfig.version = null
    }
    if (req.secretsManager && passphrase) {
      await req.secretsManager.writeSecretWithObject(wirelessSecretPath(updateConfig.profileName, req.tenantId), {
        PSK_PASSPHRASE: passphrase
      })
      log.debug(`pskPassphrase stored in Vault for wireless profile: ${updateConfig.profileName}`)
    }
    const results: WirelessConfig | null = await req.db.wirelessProfiles.update(updateConfig)
    const { pskPassphrase, pskValue, ...response } = results || {}
    MqttProvider.publishEvent(
      'success',
      ['editWirelessProfiles'],
      `Updated Wireless Profile : ${updateConfig.profileName}`
    )
    res.status(200).json(response).end()
  } catch (error) {
    handleError(log, req.body.profileName, req, res, error)
  }
}
