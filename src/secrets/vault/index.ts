/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import {
  type CiraConfigSecrets,
  type DeviceCredentials,
  type ISecretManagerService,
  type SecretMetadata,
  type TLSCredentials,
  type WifiCredentials,
  isUsableHostname
} from '../../interfaces/ISecretManagerService.js'
import { type ILogger } from '../../interfaces/ILogger.js'
import { Environment } from '../../utils/Environment.js'
import got, { HTTPError, type Got } from 'got'

// KV v2 serves a secret's metadata under the same mount as its data, with the last "data"
// segment replaced by "metadata". The mount itself may contain "data" (team/data/data/), so only
// the last one is replaced. Null for a KV v1 path or any other path without a data segment.
export function kvMetadataPath(secretsPath: string | undefined): string | null {
  const index = secretsPath?.lastIndexOf('/data/') ?? -1
  if (secretsPath == null || index < 0) {
    return null
  }
  return `${secretsPath.slice(0, index)}/metadata/${secretsPath.slice(index + '/data/'.length)}`
}

// Metadata paths a permanent delete tries. When secrets_path holds "data" more than once, which
// occurrence is the KV v2 one cannot be told from the path alone, so every occurrence gets a
// candidate. A path without a data segment (KV v1) is deleted at secrets_path itself.
export function kvMetadataPathCandidates(secretsPath: string | undefined): string[] {
  if (kvMetadataPath(secretsPath) == null) {
    return [secretsPath ?? '']
  }
  const normalized = secretsPath?.endsWith('/') ? secretsPath : `${secretsPath}/`
  const candidates = Array.from(
    normalized.matchAll(/\/data(?=\/)/g),
    (match) => `${normalized.slice(0, match.index)}/metadata${normalized.slice(match.index + '/data'.length)}`
  )
  return [...new Set(candidates)]
}

export class VaultService implements ISecretManagerService {
  gotClient: Got
  logger: ILogger
  constructor(logger: ILogger) {
    this.logger = logger
    const secretsPath = Environment.Config.secrets_path
    if ((`${secretsPath ?? ''}/`.match(/\/data(?=\/)/g) ?? []).length > 1) {
      this.logger.warn(
        `secrets_path ${secretsPath} contains /data/ more than once; metadata is written under ${kvMetadataPath(secretsPath)} and deleted under ${kvMetadataPathCandidates(secretsPath).join(', ')}`
      )
    }
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

  async writeSecretWithObject(path: string, data: any, metadata?: SecretMetadata): Promise<any> {
    let result: any
    try {
      const json = {
        data
      }
      this.logger.verbose('writing data to vault:')
      const rspJson: any = await this.gotClient.post(path, { json }).json()
      this.logger.debug(`Successfully written data to vault at path: ${path}, result: ${JSON.stringify(rspJson)}`)
      result = rspJson
    } catch (error) {
      this.logger.error('writeSecretWithObject error \r\n')
      this.logger.error(error)
      return null
    }
    if (metadata?.hostname) {
      try {
        await this.writeSecretMetadata(path, metadata)
      } catch (error) {
        this.logger.warn(
          `writing secret metadata for ${path} failed: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    }
    return result
  }

  async writeSecretMetadata(path: string, metadata: SecretMetadata): Promise<void> {
    const basePath = kvMetadataPath(Environment.Config.secrets_path)
    if (!isUsableHostname(metadata.hostname) || basePath == null) {
      this.logger.debug(`skipping secret metadata write for ${path}`)
      return
    }
    try {
      await this.gotClient
        .patch(path, {
          prefixUrl: `${Environment.Config.vault_address}/v1/${basePath}`,
          headers: { 'Content-Type': 'application/merge-patch+json' },
          json: { custom_metadata: { hostname: metadata.hostname } }
        })
        .json()
      this.logger.debug(`Successfully written secret metadata at path: ${path}`)
    } catch (error) {
      this.logger.warn(
        `failed to write secret metadata at path ${path}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  async deleteSecretAtPath(path: string): Promise<boolean> {
    // to permanently delete the key, we use metadata path
    this.logger.verbose(`Deleting data from vault:${path}`)
    const secretsPath = Environment.Config.secrets_path
    const last = kvMetadataPath(secretsPath)
    const candidates = kvMetadataPathCandidates(secretsPath)
    const ordered = last == null ? candidates : [last, ...candidates.filter((candidate) => candidate !== last)]
    for (const basePath of ordered) {
      try {
        await this.gotClient
          .delete(`${path}`, {
            prefixUrl: `${Environment.Config.vault_address}/v1/${basePath}`
          })
          .json()
      } catch (error) {
        // Vault answers 204 for an absent path, but 403 or 404 for one outside the token's policy
        // or any mount, so a candidate's status cannot tell whether the secret is gone.
        this.logger.debug(`delete at ${basePath} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      // Only reading the secret tells. The likeliest candidate goes first and the sequence stops at
      // the first one that removed it, so a DELETE at an unrelated path is sent only when needed.
      // A read that cannot answer stops it too: nothing is known, so no further DELETE is sent.
      try {
        await this.gotClient.get(path).json()
      } catch (error) {
        if (error instanceof HTTPError && error.response?.statusCode === 404) {
          this.logger.debug(`Successfully Deleted data from vault: ${path}`)
          return true
        }
        this.logger.error(`Failed to delete secret ${path}: could not verify the delete`)
        return false
      }
    }
    this.logger.error(`Failed to delete secret ${path}: still readable after delete`)
    return false
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
