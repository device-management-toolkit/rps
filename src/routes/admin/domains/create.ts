/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { domainCertSecretPath } from '../../../utils/secretPaths.js'

import { type AMTDomain } from '../../../models/index.js'
import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { type CertCredentials } from '../../../interfaces/ISecretManagerService.js'
import { CertManager } from '../../../certManager.js'
import { NodeForge } from '../../../NodeForge.js'

export class DomainCreate {
  public createDomain = async (req: Request, res: Response): Promise<void> => {
    let vaultStatus: any
    const amtDomain: AMTDomain = req.body
    amtDomain.tenantId = req.tenantId || ''
    const log = new Logger('createDomain')
    let cert = ''
    let domainPwd = ''
    const nodeForge = new NodeForge()
    const certManager = new CertManager(new Logger('CertManager'), nodeForge)
    try {
      // store the cert and password key in database
      if (req.secretsManager) {
        if (typeof amtDomain.provisioningCert === 'string' && typeof amtDomain.provisioningCertPassword === 'string') {
          cert = amtDomain.provisioningCert
          domainPwd = amtDomain.provisioningCertPassword
        }
        amtDomain.provisioningCert = 'CERT'
        amtDomain.provisioningCertPassword = 'CERT_PASSWORD'
        amtDomain.expirationDate = certManager.getExpirationDate(cert, domainPwd)
      }
      // SQL Query > Insert Data
      const results: AMTDomain | null = await req.db.domains.insert(amtDomain)
      if (results == null) {
        throw new Error('AMT domain not inserted')
      }
      // don't return secrets to the client
      delete results.provisioningCert
      delete results.provisioningCertPassword

      if (req.secretsManager) {
        const data: CertCredentials = {
          CERT: cert,
          CERT_PASSWORD: domainPwd
        }
        // save to secret provider
        vaultStatus = await req.secretsManager.writeSecretWithObject(
          domainCertSecretPath(amtDomain.profileName, req.tenantId),
          data
        )
        if (vaultStatus == null) {
          const dbResults: any = await req.db.domains.delete(amtDomain.profileName, req.tenantId)
          if (dbResults == null) {
            throw new Error('Error saving password to secret provider. AMT domain inserted but unable to undo')
          }
          throw new Error('Error saving password to secret provider. AMT domain not inserted')
        }
      }

      log.verbose(`Created Domain : ${amtDomain.profileName}`)
      MqttProvider.publishEvent('success', ['createDomain'], `Created Domain : ${amtDomain.profileName}`)
      res.status(201).json(results).end()
    } catch (error) {
      handleError(log, amtDomain.profileName, req, res, error)
    }
  }
}
