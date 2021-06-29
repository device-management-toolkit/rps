/*********************************************************************
 * Copyright (c) Intel Corporation 2021
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { IWirelessProfilesDb } from '../../../repositories/interfaces/IWirelessProfilesDB'
import { WirelessConfigDbFactory } from '../../../repositories/factories/WirelessConfigDbFactory'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION, NETWORK_CONFIG_NOT_FOUND } from '../../../utils/constants'
import { WirelessConfig } from '../../../RCS.Config'
import Logger from '../../../Logger'
import { validationResult } from 'express-validator'
import { RPSError } from '../../../utils/RPSError'
import { EnvReader } from '../../../utils/EnvReader'

export async function editWirelessProfile (req, res): Promise<void> {
  const log = new Logger('editNetProfile')
  let wirelessDb: IWirelessProfilesDb = null
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() })
      return
    }
    wirelessDb = WirelessConfigDbFactory.getConfigDb()
    let config: WirelessConfig = await wirelessDb.getProfileByName(req.body.profileName)
    if (config == null) {
      res.status(404).json(API_RESPONSE(null, 'Not Found', NETWORK_CONFIG_NOT_FOUND('Wireless', req.body.profileName))).end()
    } else {
      const passphrase = req.body.pskPassphrase
      if (passphrase) {
        config = { ...config, ...req.body }
        config.pskPassphrase = 'pskPassphrase'
      } else {
        config = { ...config, ...req.body }
      }

      const results: WirelessConfig = await wirelessDb.updateProfile(config)
      if (req.secretsManager && passphrase) {
        await req.secretsManager.writeSecretWithKey(`${EnvReader.GlobalEnvConfig.VaultConfig.SecretsPath}Wireless/${config.profileName}`, config.pskPassphrase, passphrase)
        log.info(`pskPassphrase stored in Vault for wireless profile: ${config.profileName}`)
      }
      delete results.pskPassphrase
      delete results.pskValue
      res.status(200).json(results).end()
    }
  } catch (error) {
    log.error(`Failed to edit network configuration : ${req.body.profileName}`, error)
    if (error instanceof RPSError) {
      res.status(400).json(API_RESPONSE(null, error.message)).end()
    } else {
      res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION(`UPDATE ${req.body.profileName}`))).end()
    }
  }
}
