/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import {
  type CiraConfigSecrets,
  type DeviceCredentials,
  type ISecretManagerService,
  type TLSCredentials,
  type WifiCredentials
} from '../../interfaces/ISecretManagerService.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { Environment } from '../../utils/Environment.js'
import got, { HTTPError, type Got } from 'got'

export class VaultService implements ISecretManagerService {
  gotClient: Got
  logger: ILogger
  constructor(logger: ILogger) {
    this.logger = logger
    this.gotClient = got.extend({
      prefixUrl: `${Environment.Config.vault_address}/v1/${Environment.Config.secrets_path}`,
      headers: {
        'X-Vault-Token': Environment.Config.vault_token
      }
    })
  }

  async getSecretFromKey(path: string, key: string): Promise<string | null> {
    try {
      this.logger.verbose(`getting secret from vault: ${path}, ${key}`)
      const rspJson: any = await this.gotClient.get(path).json()
      this.logger.debug(`got data back from vault: ${path}, ${key}`)
      if (rspJson.data?.data[key]) {
        return rspJson.data.data[key]
      }
    } catch (error) {
      this.logger.error('getSecretFromKey error \r\n')
      this.logger.error(error)
    }
    return null
  }

  async getSecretAtPath(
    path: string
  ): Promise<DeviceCredentials | TLSCredentials | WifiCredentials | CiraConfigSecrets | null> {
    try {
      this.logger.verbose(`getting secrets from ${path}`)
      const rspJson: any = await this.gotClient.get(path).json()
      this.logger.debug(`got data back from vault ${path}, ${JSON.stringify(rspJson?.data?.metadata)}`)
      const secretData = rspJson.data.data
      secretData.version = rspJson.data.metadata.version
      return secretData
    } catch (error) {
      // 404 means the secret is absent; other errors throw so a Vault hiccup
      // isn't mistaken for "no secret".
      if (error instanceof HTTPError && error.response?.statusCode === 404) {
        this.logger.debug(`secret not found at path: ${path}`)
        return null
      }
      this.logger.error('getSecretAtPath error \r\n')
      this.logger.error(error)
      throw error
    }
  }

  async writeSecretWithObject(path: string, data: any): Promise<any> {
    try {
      const json = {
        data
      }
      this.logger.verbose('writing data to vault:')
      const rspJson: any = await this.gotClient.post(path, { json }).json()
      this.logger.debug(`Successfully written data to vault at path: ${path}, result: ${JSON.stringify(rspJson)}`)
      return rspJson
    } catch (error) {
      this.logger.error('writeSecretWithObject error \r\n')
      this.logger.error(error)
      return null
    }
  }

  async deleteSecretAtPath(path: string): Promise<boolean> {
    try {
      // to permanently delete the key, we use metadata path
      const basePath = Environment.Config.secrets_path.replace('/data/', '/metadata/')
      this.logger.verbose(`Deleting data from vault:${path}`)
      await this.gotClient
        .delete(`${path}`, {
          prefixUrl: `${Environment.Config.vault_address}/v1/${basePath}`
        })
        .json()
      this.logger.debug(`Successfully Deleted data from vault: ${path}`)
      return true
    } catch (error) {
      this.logger.error('Failed to delete secret')
      return false
    }
  }

  async health(): Promise<any> {
    const rspJson: any = await this.gotClient
      .get('sys/health?standbyok=true', {
        prefixUrl: `${Environment.Config.vault_address}/v1/`
      })
      .json()
    return rspJson
  }
}

export default VaultService
