/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type IDomainCredentialManager } from './interfaces/IDomainCredentialManager.js'
import { type ILogger } from './interfaces/ILogger.js'
import { type IDomainsTable } from './interfaces/database/IDomainsDb.js'
import { type AMTDomain } from './models/index.js'
import { type ISecretManagerService, type CertCredentials } from './interfaces/ISecretManagerService.js'

export class DomainCredentialManager implements IDomainCredentialManager {
  private readonly amtDomains: IDomainsTable
  private readonly logger: ILogger
  private readonly secretsManager: ISecretManagerService | null = null

  constructor(logger: ILogger, amtDomains: IDomainsTable, secretsManager?: ISecretManagerService) {
    this.amtDomains = amtDomains
    this.logger = logger
    this.secretsManager = secretsManager ?? null
  }

  /**
   * @description get the provisioning cert for a given domain
   * @param {string} domainSuffix
   * @param {string} tenantId
   * @returns {AMTDomain} returns domain object
   */
  async getProvisioningCert(domainSuffix: string, tenantId: string): Promise<AMTDomain | null> {
    const domain = await this.doesDomainExist(domainSuffix, tenantId)
    this.logger.debug(`domain : ${JSON.stringify(domain)}`)

    if (domain?.provisioningCert) {
      if (this.secretsManager) {
        const certPwd = (await this.secretsManager.getSecretAtPath(`certs/${domain.profileName}`)) as CertCredentials
        this.logger.debug('Received CertPwd from vault')
        domain.provisioningCert = certPwd.CERT
        domain.provisioningCertPassword = certPwd.CERT_PASSWORD
      }
    } else {
      this.logger.error(`unable to find provisioning cert for profile ${domainSuffix}`)
    }
    return domain
  }

  /**
   * @description Checks if the AMT domain exists or not
   * @param {string} domainSuffix
   * @param {string} tenantId
   * @returns {AMTDomain | null} returns domain object if found, otherwise null.
   */
  public async doesDomainExist(domainSuffix: string, tenantId: string): Promise<AMTDomain | null> {
    const segments = domainSuffix.split('.')
    for (let i = 0; i <= segments.length - 2; i++) {
      const suffix = segments.slice(i).join('.')
      const domain = await this.amtDomains.getDomainByDomainSuffix(suffix, tenantId)
      if (domain) {
        return domain
      }
    }
    return null
  }
}
