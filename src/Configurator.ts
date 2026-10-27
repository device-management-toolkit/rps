/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import type { IDomainCredentialManager } from './interfaces/IDomainCredentialManager.js'
import type { IProfileManager } from './interfaces/IProfileManager.js'
import { DomainCredentialManager } from './DomainCredentialManager.js'
import { ProfileManager } from './ProfileManager.js'
import Logger from './Logger.js'
import type { ISecretManagerService } from './interfaces/ISecretManagerService.js'
import { Environment } from './utils/Environment.js'
import type { IValidator } from './interfaces/IValidator.js'
import { Validator } from './Validator.js'
import { DataProcessor } from './DataProcessor.js'
import { DbCreatorFactory } from './factories/DbCreatorFactory.js'
import { SecretManagerCreatorFactory } from './factories/SecretManagerCreatorFactory.js'

export class Configurator {
  domainCredentialManager: IDomainCredentialManager
  profileManager: IProfileManager
  secretsManager: ISecretManagerService
  dataProcessor: DataProcessor
  ready: Promise<void>
  constructor() {
    this.ready = new Promise((resolve, reject) => {
      const log = new Logger('Configurator')

      const validator: IValidator = new Validator(new Logger('Validator'), this)

      this.dataProcessor = new DataProcessor(new Logger('DataProcessor'), validator)

      const dbf = new DbCreatorFactory()
      const smcf = new SecretManagerCreatorFactory()

      dbf
        .getDb()
        .then((db) => {
          smcf
            .getSecretManager(new Logger('SecretManagerService'))
            .then((secretManager) => {
              this.secretsManager = secretManager
              this.domainCredentialManager = new DomainCredentialManager(
                new Logger('DomainCredentialManager'),
                db.domains,
                this.secretsManager
              )
              this.profileManager = new ProfileManager(
                new Logger('ProfileManager'),
                this.secretsManager,
                db.profiles,
                Environment.Config
              )
              resolve()
            })
            .catch((err) => {
              log.error(err)
              reject(err)
            })
        })
        .catch((err) => {
          log.error(err)
          reject(err)
        })
    })
  }
}
