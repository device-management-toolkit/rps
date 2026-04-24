/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import {} from './serviceManager.js'
import { type IServiceManager } from './interfaces/IServiceManager.js'
import { ConsulService } from './consulService.js'
import { Environment } from './utils/Environment.js'

const { processServiceConfigs, waitForServiceManager } = await import('./serviceManager.js')

const consul: IServiceManager = new ConsulService('consul', 8500)
let componentName: string
let config: any

describe('Index', () => {
  componentName = 'RPS'
  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.resetAllMocks()
    // process.env = env
  })
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.resetAllMocks()
    vi.resetModules()

    config = {
      consul_enabled: false,
      consul_host: 'localhost',
      consul_port: '8500',
      consul_key_prefix: 'RPS'
    } as any
    Environment.Config = config
  })

  it('should wait for service provider', async () => {
    let shouldBeOk = false
    const secretMock: IServiceManager = {
      health: vi.fn(() => {
        if (shouldBeOk) return null
        shouldBeOk = true
        throw new Error('error')
      })
    } as any
    await waitForServiceManager(secretMock, 'consul')
    expect(secretMock.health).toHaveBeenCalled()
  })
  it('should pass processServiceConfigs empty Consul', async () => {
    consul.get = vi.fn(() => null as any)
    consul.seed = vi.fn(async () => await Promise.resolve(true))
    await processServiceConfigs(consul, config)
    expect(consul.get).toHaveBeenCalledWith(config.consul_key_prefix)
    expect(consul.seed).toHaveBeenCalledWith(config.consul_key_prefix, config)
  })
  it('should pass processServiceConfigs seeded Consul', async () => {
    const consulValues: { Key: string; Value: string }[] = [
      {
        Key: componentName + '/Config.js',
        Value: '{"web_port": 8081, "delay_timer": 12}'
      }
    ]
    consul.get = vi.fn(async () => await Promise.resolve(consulValues))
    consul.process = vi.fn(() => JSON.stringify(consulValues, null, 2))
    await processServiceConfigs(consul, config)
    expect(consul.get).toHaveBeenCalledWith(config.consul_key_prefix)
    expect(consul.process).toHaveBeenCalledWith(consulValues)
  })
})
