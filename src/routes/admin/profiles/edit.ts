/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { type AMTConfiguration } from '../../../models/index.js'
import {
  ClientAction,
  type ProfileWifiConfigs,
  type ProfileProxyConfigs,
  TlsSigningAuthority
} from '../../../models/RCS.Config.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import { type IProfilesWifiConfigsTable } from '../../../interfaces/database/IProfileWifiConfigsDb.js'
import { type IProfileProxyConfigsTable } from '../../../interfaces/database/IProfileProxyConfigsDb.js'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { type DeviceCredentials } from '../../../interfaces/ISecretManagerService.js'
import { adjustTlsConfiguration, generateSelfSignedCertificate } from './common.js'

export async function editProfile(req: Request, res: Response): Promise<void> {
  const log = new Logger('editProfile')
  const newConfig: AMTConfiguration = req.body
  newConfig.tenantId = req.tenantId || ''
  try {
    const oldConfig: AMTConfiguration | null = await req.db.profiles.getByName(newConfig.profileName, req.tenantId)

    if (oldConfig == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('AMT', newConfig.profileName), NOT_FOUND_EXCEPTION)
    } else {
      let amtConfig: AMTConfiguration = await getUpdatedData(newConfig, oldConfig)
      amtConfig.wifiConfigs = await handleWifiConfigs(newConfig, oldConfig, req.db.profileWirelessConfigs)
      amtConfig.proxyConfigs = await handleProxyConfigs(newConfig, oldConfig, req.db.profileProxyConfigs)
      // Assigning value key value for AMT Random Password and MEBx Random Password to store in database
      const amtPwdBefore = amtConfig.amtPassword ?? ''
      const mebxPwdBefore = amtConfig.mebxPassword ?? ''
      if (req.secretsManager) {
        // store the AMT password key into db
        if (!amtConfig.generateRandomPassword) {
          amtConfig.amtPassword = 'AMT_PASSWORD'
        }
        // store the MEBX password key into db
        if (!amtConfig.generateRandomMEBxPassword && amtConfig.activation === ClientAction.ADMINCTLMODE) {
          amtConfig.mebxPassword = 'MEBX_PASSWORD'
        }
      }
      amtConfig = adjustTlsConfiguration(amtConfig)
      // SQL Query > Insert Data
      const results = await req.db.profiles.update(amtConfig)
      if (results) {
        // check if non-tls to tls
        // then check if certificate exists in vault and generate self-signed if it does not exist
        if (amtConfig.tlsSigningAuthority === TlsSigningAuthority.SELF_SIGNED) {
          // generate self-signed certificates for use with TLS config if applicable
          const existingTLSCert = await req.secretsManager.getSecretAtPath(`TLS/${oldConfig.profileName}`)
          if (existingTLSCert == null) {
            await generateSelfSignedCertificate(req.secretsManager, newConfig.profileName)
          }
        }

        // profile inserted  into db successfully. insert the secret into vault
        if (oldConfig.amtPassword !== null || oldConfig.mebxPassword !== null) {
          if (req.secretsManager) {
            log.debug('Delete in vault') // User might be flipping from false to true which we dont know. So try deleting either way.
            await req.secretsManager.deleteSecretAtPath(`profiles/${amtConfig.profileName}`)
            log.debug('Password deleted from vault')
          }
        }
        // store the password sent into Vault
        if (req.secretsManager && (!amtConfig.generateRandomPassword || !amtConfig.generateRandomMEBxPassword)) {
          const data: DeviceCredentials = {
            AMT_PASSWORD: amtConfig.generateRandomPassword ? '' : amtPwdBefore,
            MEBX_PASSWORD: amtConfig.generateRandomMEBxPassword ? '' : mebxPwdBefore
          }
          if (!amtConfig.generateRandomPassword) {
            log.debug('AMT Password written to vault')
          }
          if (!amtConfig.generateRandomMEBxPassword) {
            log.debug('MEBX Password written to vault')
          }
          if (data.AMT_PASSWORD != null || data.MEBX_PASSWORD != null) {
            await req.secretsManager.writeSecretWithObject(`profiles/${amtConfig.profileName}`, data)
          }
        }
        log.verbose(`Updated AMT profile: ${newConfig.profileName}`)
        delete results.amtPassword
        delete results.mebxPassword
        MqttProvider.publishEvent('success', ['editProfile'], `Updated Profile : ${newConfig.profileName}`)
        res.status(200).json(results).end()
      }
    }
  } catch (error) {
    handleError(log, newConfig.profileName, req, res, error)
  }
}

export const handleAMTPassword = (
  amtConfig: AMTConfiguration,
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration
): AMTConfiguration => {
  if (newConfig.amtPassword == null) {
    amtConfig.amtPassword = oldConfig.amtPassword
    amtConfig.generateRandomPassword = false
  } else {
    amtConfig.amtPassword = newConfig.amtPassword
  }
  return amtConfig
}

export const handleMEBxPassword = (
  amtConfig: AMTConfiguration,
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration
): AMTConfiguration => {
  if (newConfig.mebxPassword == null) {
    amtConfig.mebxPassword = oldConfig.mebxPassword
    amtConfig.generateRandomMEBxPassword = false
  } else {
    amtConfig.mebxPassword = newConfig.mebxPassword
  }
  return amtConfig
}

export const handleGenerateRandomPassword = (
  amtConfig: AMTConfiguration,
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration
): AMTConfiguration => {
  if (newConfig.generateRandomPassword) {
    amtConfig.generateRandomPassword = newConfig.generateRandomPassword
    amtConfig.amtPassword = null
  } else {
    amtConfig.generateRandomPassword = newConfig.amtPassword == null ? oldConfig.generateRandomPassword : false
  }
  return amtConfig
}

export const handleGenerateRandomMEBxPassword = (
  amtConfig: AMTConfiguration,
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration
): AMTConfiguration => {
  if (newConfig.generateRandomMEBxPassword) {
    amtConfig.generateRandomMEBxPassword = newConfig.generateRandomMEBxPassword
    amtConfig.mebxPassword = null
  } else {
    amtConfig.generateRandomMEBxPassword = newConfig.mebxPassword == null ? oldConfig.generateRandomMEBxPassword : false
  }
  return amtConfig
}

export const handleWifiConfigs = async (
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration,
  profileWifiConfigsDb: IProfilesWifiConfigsTable
): Promise<ProfileWifiConfigs[] | null> => {
  let wifiConfigs: ProfileWifiConfigs[] | null = null
  if (oldConfig.dhcpEnabled && !newConfig.dhcpEnabled) {
    await profileWifiConfigsDb.deleteProfileWifiConfigs(newConfig.profileName, newConfig.tenantId)
  } else if ((oldConfig.dhcpEnabled && newConfig.dhcpEnabled) || (!oldConfig.dhcpEnabled && newConfig.dhcpEnabled)) {
    await profileWifiConfigsDb.deleteProfileWifiConfigs(newConfig.profileName, newConfig.tenantId)
    wifiConfigs = newConfig.wifiConfigs ?? null
  }
  return wifiConfigs
}

export const handleProxyConfigs = async (
  newConfig: AMTConfiguration,
  oldConfig: AMTConfiguration,
  profileProxyConfigsDb: IProfileProxyConfigsTable
): Promise<ProfileProxyConfigs[] | null> => {
  let proxyConfigs: ProfileProxyConfigs[] | null = null
  // Always delete existing proxy configs and set new ones if provided
  await profileProxyConfigsDb.deleteProfileProxyConfigs(newConfig.profileName, newConfig.tenantId)
  proxyConfigs = newConfig.proxyConfigs ?? null
  return proxyConfigs
}

export const getUpdatedData = async (newConfig: any, oldConfig: AMTConfiguration): Promise<AMTConfiguration> => {
  let amtConfig: AMTConfiguration = { profileName: newConfig.profileName } as AMTConfiguration
  amtConfig = handleAMTPassword(amtConfig, newConfig, oldConfig)
  amtConfig = handleMEBxPassword(amtConfig, newConfig, oldConfig)
  amtConfig = handleGenerateRandomPassword(amtConfig, newConfig, oldConfig)
  amtConfig = handleGenerateRandomMEBxPassword(amtConfig, newConfig, oldConfig)
  amtConfig.activation = newConfig.activation ?? oldConfig.activation
  if (amtConfig.activation === ClientAction.CLIENTCTLMODE) {
    amtConfig.mebxPassword = null
    amtConfig.generateRandomMEBxPassword = false
  }
  amtConfig.ciraConfigName = newConfig.ciraConfigName
  amtConfig.tags = newConfig.tags ?? oldConfig.tags
  amtConfig.dhcpEnabled = newConfig.dhcpEnabled ?? oldConfig.dhcpEnabled
  amtConfig.ipSyncEnabled = newConfig.ipSyncEnabled ?? oldConfig.ipSyncEnabled
  amtConfig.localWifiSyncEnabled = newConfig.localWifiSyncEnabled ?? oldConfig.localWifiSyncEnabled
  amtConfig.tenantId = newConfig.tenantId ?? oldConfig.tenantId
  amtConfig.tlsMode = newConfig.tlsMode
  amtConfig.userConsent = newConfig.userConsent ?? oldConfig.userConsent
  amtConfig.iderEnabled = newConfig.iderEnabled ?? oldConfig.iderEnabled
  amtConfig.kvmEnabled = newConfig.kvmEnabled ?? oldConfig.kvmEnabled
  amtConfig.solEnabled = newConfig.solEnabled ?? oldConfig.solEnabled
  amtConfig.tlsSigningAuthority = newConfig.tlsSigningAuthority ?? oldConfig.tlsSigningAuthority
  amtConfig.ieee8021xProfileName = newConfig.ieee8021xProfileName
  amtConfig.version = newConfig.version
  return amtConfig
}
