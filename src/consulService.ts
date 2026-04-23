/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import got, { type Got } from 'got'
import Logger from './Logger.js'
import { type RPSConfig } from './models/index.js'
import type { IServiceManager } from './interfaces/IServiceManager.js'
import { Environment } from './utils/Environment.js'

export class ConsulService implements IServiceManager {
  gotClient: Got
  log = new Logger('ConsulService')
  constructor(host: string, port: number) {
    this.gotClient = got.extend({
      prefixUrl: `http://${host}:${port}/v1/`
    })
  }

  async health(serviceName: string): Promise<any> {
    return await this.gotClient
      .get(`health/service/${encodeURIComponent(serviceName)}`, {
        searchParams: { passing: true }
      })
      .json()
  }

  async seed(prefix: string, config: RPSConfig): Promise<boolean> {
    try {
      await this.gotClient.put(`kv/${encodeURIComponent(prefix)}/config`, {
        body: JSON.stringify(config, null, 2)
      })
      this.log.info('Wrote configuration settings to Consul.')
      return true
    } catch (e) {
      return false
    }
  }

  async get(prefix: string): Promise<any> {
    try {
      const entries = (await this.gotClient
        .get(`kv/${encodeURIComponent(prefix)}/`, {
          searchParams: { recurse: true }
        })
        .json()) as { Key: string; Value: string | null }[]
      return entries.map((entry) => ({
        ...entry,
        Value: entry.Value != null ? Buffer.from(entry.Value, 'base64').toString('utf-8') : entry.Value
      }))
    } catch (e: any) {
      if (e?.response?.statusCode === 404) return null
      throw e
    }
  }

  process(consulValues: object): string {
    let value = ''
    for (const consulKey in consulValues) {
      value = consulValues[consulKey].Value
      Environment.Config = JSON.parse(value)
    }
    return value
  }
}
