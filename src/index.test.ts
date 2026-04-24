/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type ISecretManagerService } from './interfaces/ISecretManagerService.js'
import { type IDB } from './interfaces/database/IDb.js'
import { config } from './test/helper/Config.js'

const backOffSpy = vi.hoisted(() => vi.fn())
const processServiceConfigsSpy = vi.hoisted(() => vi.fn().mockReturnValue(Promise.resolve()))
const waitForServiceManagerSpy = vi.hoisted(() => vi.fn().mockReturnValue(Promise.resolve(true)))
vi.mock('exponential-backoff', () => ({
  backOff: backOffSpy
}))
vi.mock('./serviceManager.js', () => ({
  processServiceConfigs: processServiceConfigsSpy,
  waitForServiceManager: waitForServiceManagerSpy
}))
vi.mock('./Configurator.js', () => ({
  Configurator: vi.fn().mockImplementation(function () {
    return { ready: Promise.resolve() }
  })
}))
const indexFile = await import('./Index.js')

describe('Index', () => {
  // const env = process.env
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
    config.consul_enabled = false
    // process.env = { ...env }
    process.env.NODE_ENV = 'test'
    /*
    vi.mock('fs', () => ({
      existsSync: vi.fn(() => true),
      lstatSync: vi.fn(() => ({ isDirectory: () => true })),
      readdirSync: vi.fn(() => ['example.js'] as any)
    }))
    */
    // vi.mock('./middleware/custom/example', () => function (req, res, next) {})
  })

  /*
  it('should load custom middleware', async () => {
    const result = await indexFile.loadCustomMiddleware()
    expect(result.length).toBe(1)
  })
  */

  it('Should pass setupServiceManager', async () => {
    await indexFile.setupServiceManager(config)
    expect(processServiceConfigsSpy).toHaveBeenCalled()
    expect(waitForServiceManagerSpy).toHaveBeenCalled()
  })

  it('should wait for db', async () => {
    let shouldBeOk = false
    const dbMock: IDB = {
      query: vi.fn(() => {
        if (shouldBeOk) return null
        shouldBeOk = true
        throw new Error('error')
      })
    } as any
    await indexFile.waitForDB(dbMock)
    expect(backOffSpy).toHaveBeenCalled()
  })

  it('should wait for secret provider', async () => {
    let shouldBeOk = false
    const secretMock: ISecretManagerService = {
      health: vi.fn(() => {
        if (shouldBeOk) return null
        shouldBeOk = true
        throw new Error('error')
      })
    } as any
    await indexFile.waitForSecretsManager(secretMock)
    expect(backOffSpy).toHaveBeenCalled()
  })
})
