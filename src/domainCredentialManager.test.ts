/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from './utils/Environment.js'

import { vi } from 'vitest'
import { DomainCredentialManager } from './DomainCredentialManager.js'
import { type ILogger } from './interfaces/ILogger.js'
import Logger from './Logger.js'
import { type AMTDomain } from './models/index.js'
import { DomainsTable } from './data/postgres/tables/domains.js'
import type Db from './data/postgres/index.js'

const logger: ILogger = new Logger('DomainCredentialManagerTests')
describe('Domain Credential Manager Tests', () => {
  let creator: Db
  let domainCredentialManager: DomainCredentialManager
  beforeEach(() => {
    creator = {
      query: (query, params) => {
        if (query.indexOf('SELECT') >= 0) {
          // Simulate exact-match DB query; suffix stripping is handled by DomainCredentialManager
          const input = params?.[0] as string
          if (input === 'd2.com') {
            return {
              rowCount: 1,
              rows: [
                {
                  name: '',
                  domainSuffix: 'd2.com',
                  provisioningCert: ' ',
                  provisioningCertStorageFormat: '',
                  provisioningCertPassword: ''
                }
              ]
            }
          }
          return { rowCount: 0, rows: [] }
        }
      }
    } as any
    domainCredentialManager = new DomainCredentialManager(logger, new DomainsTable(creator), {
      getSecretAtPath: vi.fn().mockImplementation(() => ({ CERT: 'd2.pfx', CERT_PASSWORD: 'password' }))
    } as any)
  })
  test('retrieve provisioning cert based on domain', async () => {
    const expectedProvisioningCert = 'd2.pfx'
    const domain: AMTDomain | null = await domainCredentialManager.getProvisioningCert('d2.com', '')
    expect(domain?.provisioningCert).toEqual(expectedProvisioningCert)
    expect(domain?.provisioningCertPassword).toEqual('password')
  })
  test('reads the provisioning cert from the tenant-scoped path', async () => {
    Environment.Config = { ...Environment.Config, secrets_tenant_partition: true } as any
    Environment.Config = { ...Environment.Config, secrets_tenant_partition: true } as any
    const getSecretAtPath = vi.fn().mockResolvedValue({ CERT: 'd2.pfx', CERT_PASSWORD: 'password' })
    const manager = new DomainCredentialManager(logger, new DomainsTable(creator), { getSecretAtPath } as any)
    await manager.getProvisioningCert('d2.com', 'tenant-a')
    expect(getSecretAtPath.mock.calls[0][0]).toMatch(/^tenants\/tenant-a\/certs\//)
  })
  test('does domain exist should return domain object', async () => {
    const result = await domainCredentialManager.doesDomainExist('d2.com', '')
    expect(result).not.toBeNull()
    expect(result?.domainSuffix).toEqual('d2.com')
  })

  describe('suffix matching', () => {
    test('doesDomainExist should match when device FQDN has extra leading segments', async () => {
      // Device reports foo.d2.com, DB has d2.com
      const result = await domainCredentialManager.doesDomainExist('foo.d2.com', '')
      expect(result).not.toBeNull()
    })

    test('doesDomainExist should match with multiple extra leading segments', async () => {
      // Device reports bar.foo.d2.com, DB has d2.com
      const result = await domainCredentialManager.doesDomainExist('bar.foo.d2.com', '')
      expect(result).not.toBeNull()
    })

    test('doesDomainExist should return null when no suffix matches', async () => {
      const noMatchCreator = {
        query: () => ({ rowCount: 0, rows: [] })
      } as any
      const mgr = new DomainCredentialManager(logger, new DomainsTable(noMatchCreator))
      const result = await mgr.doesDomainExist('other.com', '')
      expect(result).toBeNull()
    })

    test('getProvisioningCert should match when device FQDN has extra leading segments', async () => {
      // Device reports foo.d2.com, DB has d2.com
      const domain = await domainCredentialManager.getProvisioningCert('foo.d2.com', '')
      expect(domain?.provisioningCert).toEqual('d2.pfx')
    })
  })
})
