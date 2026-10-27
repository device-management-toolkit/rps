/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { Configurator } from './Configurator.js'
import { DbCreatorFactory } from './factories/DbCreatorFactory.js'
import { SecretManagerCreatorFactory } from './factories/SecretManagerCreatorFactory.js'

vi.mock('./factories/DbCreatorFactory.js')
vi.mock('./factories/SecretManagerCreatorFactory.js')
vi.mock('./DataProcessor.js')
vi.mock('./Validator.js')
vi.mock('./Logger.js')

describe('Configurator initialization failures', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects ready with the database error without an unhandled rejection', async () => {
    const error = new Error('Database initialization failed')
    vi.spyOn(DbCreatorFactory.prototype, 'getDb').mockRejectedValue(error)

    const configurator = new Configurator()

    await expect(configurator.ready).rejects.toBe(error)
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('rejects ready with the secret manager error without an unhandled rejection', async () => {
    const error = new Error('Secret manager initialization failed')
    vi.spyOn(DbCreatorFactory.prototype, 'getDb').mockResolvedValue({} as any)
    vi.spyOn(SecretManagerCreatorFactory.prototype, 'getSecretManager').mockRejectedValue(error)

    const configurator = new Configurator()

    await expect(configurator.ready).rejects.toBe(error)
    await new Promise((resolve) => setImmediate(resolve))
  })
})
