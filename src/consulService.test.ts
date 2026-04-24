/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { ConsulService } from './consulService.js'
import { config } from './test/helper/Config.js'

import { vi } from 'vitest'
let componentName: string
let serviceName: string
let consul: ConsulService

describe('consul', () => {
  beforeEach(() => {
    consul = new ConsulService('localhost', 8500)

    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.resetModules()

    componentName = 'RPS'
    serviceName = 'consul'
  })

  describe('ConsulService', () => {
    it('get Consul health', async () => {
      const healthPayload = [{ Service: { Service: 'consul' } }]
      const spyGet = vi
        .spyOn(consul.gotClient, 'get')
        .mockImplementation(() => ({ json: vi.fn(async () => healthPayload) }) as any)
      const result = await consul.health(serviceName)
      expect(spyGet).toHaveBeenCalledWith('health/service/consul', { searchParams: { passing: true } })
      expect(result).toEqual(healthPayload)
    })

    it('health Consul failure propagates error', async () => {
      vi.spyOn(consul.gotClient, 'get').mockImplementation(
        () => ({ json: vi.fn(async () => await Promise.reject(new Error('503 Service Unavailable'))) }) as any
      )
      await expect(consul.health(serviceName)).rejects.toThrow('503 Service Unavailable')
    })

    it('seed Consul success', async () => {
      const spyPut = vi.spyOn(consul.gotClient, 'put').mockResolvedValue({} as any)
      const result = await consul.seed(componentName, config)
      expect(result).toBe(true)
      expect(spyPut).toHaveBeenCalledWith('kv/RPS/config', { body: JSON.stringify(config, null, 2) })
    })

    it('seed Consul failure', async () => {
      vi.spyOn(consul.gotClient, 'put').mockRejectedValue(new Error('network down') as never)
      const result = await consul.seed(componentName, config)
      expect(result).toBe(false)
    })

    it('get from Consul success', async () => {
      const encoded = Buffer.from('{"web_port": 8081}', 'utf-8').toString('base64')
      const spyGet = vi
        .spyOn(consul.gotClient, 'get')
        .mockImplementation(() => ({ json: vi.fn(async () => [{ Key: 'RPS/Config.js', Value: encoded }]) }) as any)
      const result = await consul.get(componentName)
      expect(spyGet).toHaveBeenCalledWith('kv/RPS/', { searchParams: { recurse: true } })
      expect(result).toEqual([{ Key: 'RPS/Config.js', Value: '{"web_port": 8081}' }])
    })

    it('get from Consul returns null on 404', async () => {
      const err: any = new Error('Not Found')
      err.response = { statusCode: 404 }
      vi.spyOn(consul.gotClient, 'get').mockImplementation(
        () => ({ json: vi.fn(async () => await Promise.reject(err)) }) as any
      )
      const result = await consul.get(componentName)
      expect(result).toBeNull()
    })

    it('get from Consul throws on non-404 error', async () => {
      const err: any = new Error('Internal Server Error')
      err.response = { statusCode: 500 }
      vi.spyOn(consul.gotClient, 'get').mockImplementation(
        () => ({ json: vi.fn(async () => await Promise.reject(err)) }) as any
      )
      await expect(consul.get(componentName)).rejects.toThrow('Internal Server Error')
    })

    it('process Consul', () => {
      const consulValues: { Key: string; Value: string }[] = [
        {
          Key: componentName + '/Config.js',
          Value: '{"web_port": 8081, "delay_timer": 12}'
        }
      ]
      const result = consul.process(consulValues)
      expect(result).toBe('{"web_port": 8081, "delay_timer": 12}')
    })
  })
})
