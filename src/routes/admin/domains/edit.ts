/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMTDomain } from '../../../models/index.js'
import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { type CertCredentials } from '../../../interfaces/ISecretManagerService.js'
import { NodeForge } from '../../../NodeForge.js'
import { CertManager } from '../../../certManager.js'

export async function editDomain(req: Request, res: Response): Promise<void> {
  let amtDomain: AMTDomain = {} as AMTDomain
  const log = new Logger('editDomain')
  let cert: any
  let domainPwd = ''
  const newDomain = req.body
  newDomain.tenantId = req.tenantId
  try {
    const oldDomain: AMTDomain | null = await req.db.domains.getByName(newDomain.profileName, req.tenantId)
    if (oldDomain == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('Domain', newDomain.profileName), NOT_FOUND_EXCEPTION)
    } else {
      amtDomain = getUpdatedData(newDomain, oldDomain)
      // store the cert and password key in database
      if (req.secretsManager) {
        if (typeof amtDomain.provisioningCert === 'string' && typeof amtDomain.provisioningCertPassword === 'string') {
          cert = amtDomain.provisioningCert
          domainPwd = amtDomain.provisioningCertPassword
        }
        amtDomain.provisioningCert = 'CERT'
        amtDomain.provisioningCertPassword = 'CERT_PASSWORD'
      }
      // SQL Query > Insert Data
      const results: AMTDomain | null = await req.db.domains.update(amtDomain)
      if (results) {
        // Delete the previous values of cert and password in vault and store the updated values
        if (
          req.secretsManager &&
          newDomain.provisioningCert &&
          newDomain.provisioningCert !== '' &&
          newDomain.provisioningCertPassword &&
          newDomain.provisioningCertPassword !== ''
        ) {
          const data: CertCredentials = {
            CERT: cert,
            CERT_PASSWORD: domainPwd
          }
          await req.secretsManager.writeSecretWithObject(`certs/${amtDomain.profileName}`, data)
          log.debug(`Updated AMT Domain : ${amtDomain.profileName} in vault`)
        }
        delete results.provisioningCert
        delete results.provisioningCertPassword
        MqttProvider.publishEvent('success', ['editDomain'], `Domain Updated : ${amtDomain.profileName}`)
        res.status(200).json(results).end()
      }
    }
  } catch (error) {
    handleError(log, amtDomain.profileName, req, res, error)
  }
}

function getUpdatedData(newDomain: any, oldDomain: AMTDomain): AMTDomain {
  const amtDomain: AMTDomain = { profileName: newDomain.profileName } as AMTDomain
  const nodeForge = new NodeForge()
  const certManager = new CertManager(new Logger('CertManager'), nodeForge)
  amtDomain.domainSuffix = newDomain.domainSuffix ?? oldDomain.domainSuffix
  amtDomain.provisioningCert =
    newDomain.provisioningCert && newDomain.provisioningCert !== ''
      ? newDomain.provisioningCert
      : oldDomain.provisioningCert
  amtDomain.provisioningCertStorageFormat =
    newDomain.provisioningCertStorageFormat ?? oldDomain.provisioningCertStorageFormat
  amtDomain.provisioningCertPassword =
    newDomain.provisioningCertPassword && newDomain.provisioningCertPassword !== ''
      ? newDomain.provisioningCertPassword
      : oldDomain.provisioningCertPassword

  let expirationDate = oldDomain.expirationDate
  if (newDomain.provisioningCert && newDomain.provisioningCert !== '') {
    expirationDate = certManager.getExpirationDate(newDomain.provisioningCert, amtDomain.provisioningCertPassword ?? '')
  }
  amtDomain.expirationDate = expirationDate
  amtDomain.tenantId = newDomain.tenantId ?? oldDomain.tenantId
  amtDomain.version = newDomain.version
  return amtDomain
}
