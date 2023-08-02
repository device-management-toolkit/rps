/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import * as svcMngr from './serviceManager'
import { type IServiceManager } from './interfaces/IServiceManager'
import { ConsulService } from './consul'
import { Environment } from './utils/Environment'
import * as exponentialBackoff from 'exponential-backoff'

const consul: IServiceManager = new ConsulService('consul', '8500')
let componentName: string
let config: any

describe('Index', () => {
  componentName = 'RPS'
  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    jest.resetAllMocks()
    // process.env = env
  })
  beforeEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    jest.resetAllMocks()
    jest.resetModules()

    config = {
      consul_enabled: false,
      consul_host: 'localhost',
      consul_port: '8500',
      consul_key_prefix: 'RPS'
    } as any
    Environment.Config = config
  })

  it('should wait for service provider', async () => {
    const backOffSpy = jest.spyOn(exponentialBackoff, 'backOff')
    let shouldBeOk = false
    const secretMock: IServiceManager = {
      health: jest.fn(() => {
        if (shouldBeOk) return null
        shouldBeOk = true
        throw new Error('error')
      })
    } as any
    await svcMngr.waitForServiceManager(secretMock, 'consul')
    expect(backOffSpy).toHaveBeenCalled()
  })
  it('should pass processServiceConfigs empty Consul', async () => {
    consul.get = jest.fn(() => null)
    consul.seed = jest.fn(async () => await Promise.resolve(true))
    await svcMngr.processServiceConfigs(consul, config)
    expect(consul.get).toHaveBeenCalledWith(config.consul_key_prefix)
    expect(consul.seed).toHaveBeenCalledWith(config.consul_key_prefix, config)
  })
  it('should pass processServiceConfigs seeded Consul', async () => {
    const consulValues: Array<{ Key: string, Value: string }> = [
      {
        Key: componentName + '/config',
        Value: '{"web_port": 8081, "delay_timer": 12}'
      }
    ]
    consul.get = jest.fn(async () => await Promise.resolve(consulValues))
    consul.process = jest.fn(() => JSON.stringify(consulValues, null, 2))
    await svcMngr.processServiceConfigs(consul, config)
    expect(consul.get).toHaveBeenCalledWith(config.consul_key_prefix)
    expect(consul.process).toHaveBeenCalledWith(consulValues)
  })
})
