/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMTConfiguration } from './models/index.js'
import { type ILogger } from './interfaces/ILogger.js'
import { type IProfileManager } from './interfaces/IProfileManager.js'
import { PasswordHelper } from './utils/PasswordHelper.js'
import { type CIRAConfig } from './models/RCS.Config.js'
import { type IProfilesTable } from './interfaces/database/IProfilesDb.js'
import { type ISecretManagerService, type TLSCredentials } from './interfaces/ISecretManagerService.js'
import { RPS_MODE_CONSOLE } from './utils/constants.js'
import { Environment } from './utils/Environment.js'

export class ProfileManager implements IProfileManager {
  private readonly amtConfigurations: IProfilesTable
  private readonly logger: ILogger
  private readonly secretsManager: ISecretManagerService
  private readonly envConfig: any

  constructor(logger: ILogger, secretsManager: ISecretManagerService, amtConfigurations: IProfilesTable, config?: any) {
    this.logger = logger
    this.secretsManager = secretsManager
    this.amtConfigurations = amtConfigurations
    this.envConfig = config // This is all Env config stuff
  }

  /**
   * @description Retrieves activation for a given profile
   * @param {string} profileName profile to look up
   * @returns {string} returns the activation to be performed
   */
  public async getActivationMode(profileName: string, tenantId: string): Promise<string | null> {
    const profile = await this.getAmtProfile(profileName, tenantId)
    let activation: string | null = null

    if (profile?.activation) {
      this.logger.debug(`found activation for profile ${profileName}`)
      activation = profile.activation
    } else {
      this.logger.error(`unable to find activation for profile ${profileName}`)
    }

    return activation
  }

  /**
   * @description Retrieves CIRA Configuration for a given profile name
   * @param {string} profile of cira config
   * @returns {string} returns the config for CIRA for a given profile
   */
  public async getCiraConfiguration(profileName: string | null, tenantId: string): Promise<CIRAConfig | null> {
    const profile = await this.getAmtProfile(profileName, tenantId)
    let ciraConfig: CIRAConfig | null = null

    if (profile) {
      if (profile.ciraConfigName && profile.ciraConfigObject) {
        this.logger.debug(`found CIRAConfigObject for profile: ${profile.profileName}`)
        ciraConfig = profile.ciraConfigObject
      } else {
        this.logger.debug(`unable to find CIRAConfig for profile ${profile.profileName}`)
      }
    } else {
      this.logger.debug(`unable to find CIRAConfig for profile ${profileName}`)
    }

    return ciraConfig
  }

  /**
   * @description Retrieves the amt password set in the configuration or generates non-static password
   * @param {string} profileName profile name of amt password
   * @returns {string} returns the amt password for a given profile
   */
  public async getAmtPassword(profileName: string, tenantId: string): Promise<string | null> {
    const profile: AMTConfiguration | null = await this.getAmtProfile(profileName, tenantId)
    let amtPassword: string | null = null
    if (profile) {
      if (profile.generateRandomPassword) {
        amtPassword = PasswordHelper.generateRandomPassword()

        if (amtPassword) {
          this.logger.debug(`Created random password for ${profile.profileName}`)
        } else {
          this.logger.error(`unable to create a random password for ${profile.profileName}`)
        }
      } else if (Environment.Config.mode === RPS_MODE_CONSOLE && this.amtConfigurations.getSecretsByName) {
        // Console mode: profile passwords aren't in the normal read, so fetch the secrets route instead of Vault.
        const secrets = await this.amtConfigurations.getSecretsByName(profileName, tenantId)
        amtPassword = secrets?.amtPassword ?? null
      } else if (this.secretsManager) {
        amtPassword = await this.secretsManager.getSecretFromKey(`profiles/${profileName}`, 'AMT_PASSWORD')
      } else {
        if (profile.amtPassword) {
          amtPassword = profile.amtPassword
        }
      }
      if (!amtPassword) {
        this.logger.error('password cannot be blank')
        throw new Error('password cannot be blank')
      }
      this.logger.debug(`found amtPassword for profile ${profileName}`)
      return amtPassword
    } else {
      this.logger.error(`unable to find amtPassword for profile ${profileName}`)
    }
    return null
  }

  /**
   * @description Retrieves the amt password set in the configuration or generates a nonstatic password
   * @param {string} profileName profile name of amt password
   * @returns {string} returns the amt password for a given profile
   */
  public async getMEBxPassword(profileName: string, tenantId: string): Promise<string | null> {
    const profile: AMTConfiguration | null = await this.getAmtProfile(profileName, tenantId)
    let mebxPassword: string | null = null
    if (profile) {
      if (profile.generateRandomMEBxPassword) {
        mebxPassword = PasswordHelper.generateRandomPassword()

        if (mebxPassword) {
          this.logger.debug(`Created random MEBx password for ${profile.profileName}`)
        } else {
          this.logger.error(`unable to create MEBx random password for ${profile.profileName}`)
        }
      } else if (Environment.Config.mode === RPS_MODE_CONSOLE && this.amtConfigurations.getSecretsByName) {
        const secrets = await this.amtConfigurations.getSecretsByName(profileName, tenantId)
        mebxPassword = secrets?.mebxPassword ?? null
      } else if (this.secretsManager) {
        mebxPassword = await this.secretsManager.getSecretFromKey(`profiles/${profileName}`, 'MEBX_PASSWORD')
      } else {
        if (profile.mebxPassword) {
          mebxPassword = profile.mebxPassword
        }
      }
      if (!mebxPassword) {
        this.logger.error('mebx password cannot be blank')
        throw new Error('mebx password cannot be blank')
      }
      this.logger.debug(`found amtPassword for profile ${profileName}`)
      return mebxPassword
    } else {
      this.logger.error(`unable to find mebxPassword for profile ${profileName}`)
    }
    return null
  }

  /**
   * @description generates a random password unless custom-ui is used which
   * includes an MPS password
   * @param {string} profileName profile name of MPS password
   * @returns {string} returns the MPS password for a given profile
   */
  public async getMPSPassword(profileName: string, tenantId: string): Promise<string> {
    const profile: AMTConfiguration | null = await this.getAmtProfile(profileName, tenantId)
    let mpsPassword: string | null = null

    if (profile?.ciraConfigObject) {
      mpsPassword = PasswordHelper.generateRandomPassword()

      if (mpsPassword) {
        this.logger.debug(`Created random MPS password for ${profile.profileName}`)
      } else {
        this.logger.error(`unable to create MPS random password for ${profile.profileName}`)
      }
    } else {
      this.logger.error(`unable to find mpsPassword for profile ${profileName}`)
    }

    if (mpsPassword) {
      return mpsPassword
    }

    this.logger.error('password cannot be blank')
    throw new Error('password cannot be blank')
  }

  /**
   * @description Checks if the AMT profile exists or not
   * @param {string} profile
   * @returns {AMTConfiguration} returns AMTConfig object if profile exists otherwise null.
   */
  public async getAmtProfile(profile: string | null, tenantId: string): Promise<AMTConfiguration | null> {
    try {
      if (!profile) {
        return null
      }
      const amtProfile: AMTConfiguration | null = await this.amtConfigurations.getByName(profile, tenantId)
      if (!amtProfile) {
        return null
      }
      // If the CIRA Config associated with profile, retrieves from DB
      if (amtProfile.ciraConfigName != null) {
        amtProfile.ciraConfigObject = await this.amtConfigurations.getCiraConfigForProfile(
          amtProfile.ciraConfigName,
          tenantId
        )
      }
      // If the TLS Config associated with profile, retrieves from DB
      if (amtProfile.tlsMode != null && amtProfile.tlsSigningAuthority) {
        if (this.secretsManager) {
          const results = await this.secretsManager.getSecretAtPath(`TLS/${amtProfile.profileName}`)
          amtProfile.tlsCerts = results as TLSCredentials
        }
      }
      // If the CIRA Config associated with profile, retrieves from DB
      if (amtProfile.ieee8021xProfileName != null) {
        amtProfile.ieee8021xProfileObject = await this.amtConfigurations.get8021XConfigForProfile(
          amtProfile.ieee8021xProfileName,
          tenantId
        )
      }
      this.logger.debug(`AMT Profile returned from db: ${amtProfile?.profileName}`)
      return amtProfile
    } catch (error) {
      this.logger.error(`Failed to get AMT profile: ${error}`)
    }
    return null
  }

  /**
   * @description Checks if the AMT profile exists or not
   * @param {string} profile
   * @returns {boolean} returns true if profile exists otherwise false.
   */
  public async doesProfileExist(profileName: string, tenantId: string): Promise<boolean> {
    const profile = await this.getAmtProfile(profileName, tenantId)
    if (profile) {
      // this.logger.debug(`found profile ${profileName}`);
      return true
    } else {
      this.logger.error(`unable to find profile ${profileName}`)
      return false
    }
  }
}
