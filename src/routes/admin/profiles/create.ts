/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger'
import { type AMTConfiguration } from '../../../models'
import { MqttProvider } from '../../../utils/MqttProvider'
import { type Request, type Response } from 'express'
import { ClientAction, TlsSigningAuthority } from '../../../models/RCS.Config'
import handleError from '../../../utils/handleError'
import { type DeviceCredentials } from '../../../interfaces/ISecretManagerService'
import { adjustTlsConfiguration, generateSelfSignedCertificate, adjustRedirectionConfiguration } from './common'

export async function createProfile (req: Request, res: Response): Promise<void> {
  let vaultStatus: any
  const log = new Logger('createProfile')
  let amtConfig: AMTConfiguration = req.body
  amtConfig.tenantId = req.tenantId || ''
  try {
    const pwdBefore = amtConfig.amtPassword
    const mebxPwdBefore = amtConfig.mebxPassword
    if (req.secretsManager) {
      if (!amtConfig.generateRandomPassword) {
        amtConfig.amtPassword = 'AMT_PASSWORD'
      }
      if (!amtConfig.generateRandomMEBxPassword && amtConfig.activation === ClientAction.ADMINCTLMODE) {
        amtConfig.mebxPassword = 'MEBX_PASSWORD'
      }
    }

    // set/align optional properties
    amtConfig = adjustRedirectionConfiguration(amtConfig)
    amtConfig = adjustTlsConfiguration(amtConfig)

    const results: AMTConfiguration = await req.db.profiles.insert(amtConfig)
    if (results == null) {
      throw new Error('AMT Profile not inserted')
    }
    // don't return secrets to the client
    delete results.amtPassword
    delete results.mebxPassword

    // profile inserted  into db successfully.
    if (req.secretsManager) {
      if (!amtConfig.generateRandomPassword || !amtConfig.generateRandomMEBxPassword) {
      // store the passwords in Vault if not randomly generated per device
        const data: DeviceCredentials = { AMT_PASSWORD: '', MEBX_PASSWORD: '' }
        if (!amtConfig.generateRandomPassword) {
          data.AMT_PASSWORD = pwdBefore
          log.debug('AMT Password written to vault')
        }
        if (!amtConfig.generateRandomMEBxPassword) {
          data.MEBX_PASSWORD = mebxPwdBefore
          log.debug('MEBX Password written to vault')
        }
        vaultStatus = await req.secretsManager.writeSecretWithObject(`profiles/${amtConfig.profileName}`, data)
        if (vaultStatus == null) {
          const dbResults: any = await req.db.profiles.delete(amtConfig.profileName, req.tenantId)
          if (dbResults == null) {
            throw new Error('Error saving password to secret provider. AMT Profile inserted but unable to undo')
          }
          throw new Error('Error saving password to secret provider. AMT Profile not inserted')
        }
      }
      // generate self-signed certificates for use with TLS config if applicable
      if (amtConfig.tlsMode != null) {
        // API compatibility: default to self-signed if no other option is indicated
        if (!amtConfig.tlsSigningAuthority || amtConfig.tlsSigningAuthority === TlsSigningAuthority.SELF_SIGNED) {
          await generateSelfSignedCertificate(req.secretsManager, amtConfig.profileName)
        }
      }
    }

    MqttProvider.publishEvent('success', ['createProfile'], `Created Profile : ${amtConfig.profileName}`)
    res.status(201).json(results).end()
  } catch (error) {
    handleError(log, amtConfig.profileName, req, res, error)
  }
}
