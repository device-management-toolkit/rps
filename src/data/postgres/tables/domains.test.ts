/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { DomainsTable } from './domains.js'
import {
  DUPLICATE_DOMAIN_FAILED,
  API_UNEXPECTED_EXCEPTION,
  DEFAULT_SKIP,
  DEFAULT_TOP,
  CONCURRENCY_MESSAGE
} from '../../../utils/constants.js'
import { type AMTDomain } from '../../../models/index.js'
import PostgresDb from '../index.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('domains tests', () => {
  let db: PostgresDb
  let domainsTable: DomainsTable
  let querySpy: jest.Spied<any>
  let amtDomain: AMTDomain
  const profileName = 'profileName'
  beforeEach(() => {
    amtDomain = {
      profileName: 'name',
      domainSuffix: 'suffix',
      provisioningCert: 'cert',
      provisioningCertStorageFormat: 'format',
      provisioningCertPassword: 'password',
      expirationDate: new Date(),
      tenantId: '1',
      version: '2'
    }

    db = new PostgresDb('')
    domainsTable = new DomainsTable(db)
    querySpy = spyOn(domainsTable.db, 'query')
  })
  afterEach(() => {
    jest.clearAllMocks()
  })
  describe('Get', () => {
    test('should get expected count', async () => {
      const expected = 10
      querySpy.mockResolvedValueOnce({
        rows: [{ total_count: expected }],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await domainsTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no counts made', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({
        rows: [{ total_count: expected }],
        command: '',
        fields: null,
        rowCount: expected,
        oid: 0
      })
      const count: number = await domainsTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on empty rows array', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: expected, oid: 0 })
      const count: number = await domainsTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no rows returned', async () => {
      querySpy.mockResolvedValueOnce({})
      const count: number = await domainsTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on null results', async () => {
      querySpy.mockResolvedValueOnce(null)
      const count: number = await domainsTable.getCount()
      expect(count).toBe(0)
    })

    test('Should get an array of one domain', async () => {
      querySpy.mockResolvedValueOnce({ rows: [amtDomain], command: '', fields: null, rowCount: 1, oid: 0 })
      const domains: AMTDomain[] = await domainsTable.get()
      expect(domains[0]).toBe(amtDomain)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    SELECT 
      name as "profileName", 
      domain_suffix as "domainSuffix", 
      provisioning_cert as "provisioningCert", 
      provisioning_cert_storage_format as "provisioningCertStorageFormat",
      provisioning_cert_key as "provisioningCertPassword", 
      expiration_date as "expirationDate", 
      tenant_id as "tenantId",
      xmin as "version"
    FROM domains 
    WHERE tenant_id = $3
    ORDER BY name 
    LIMIT $1 OFFSET $2`,
        [
          DEFAULT_TOP,
          DEFAULT_SKIP,
          ''
        ]
      )
      expect(domains.length).toBe(1)
      expect(domains[0]).toBe(amtDomain)
    })

    test('Should get domain using getByName', async () => {
      querySpy.mockResolvedValueOnce({ rows: [amtDomain], command: '', fields: null, rowCount: 1, oid: 0 })
      const result = await domainsTable.getByName(profileName)
      expect(result).toBe(amtDomain)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    SELECT 
      name as "profileName", 
      domain_suffix as "domainSuffix", 
      provisioning_cert as "provisioningCert", 
      provisioning_cert_storage_format as "provisioningCertStorageFormat", 
      provisioning_cert_key as "provisioningCertPassword", 
      expiration_date as "expirationDate", 
      tenant_id as "tenantId",
      xmin as "version"
    FROM domains 
    WHERE Name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('Should return null if no results for getByName', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const result = await domainsTable.getByName(profileName)
      expect(result).toBeNull()
    })
    test('Should getDomainByDomainSuffix', async () => {
      querySpy.mockResolvedValueOnce({ rows: [amtDomain], command: '', fields: null, rowCount: 1, oid: 0 })
      const result = await domainsTable.getDomainByDomainSuffix(amtDomain.domainSuffix)
      expect(result).toBe(amtDomain)
    })
    test('Should return null on no results for getDomainByDomainSuffix', async () => {
      querySpy.mockResolvedValueOnce({ rows: [amtDomain], command: '', fields: null, rowCount: 0, oid: 0 })
      const result = await domainsTable.getDomainByDomainSuffix(amtDomain.domainSuffix)
      expect(result).toBeNull()
    })
  })
  describe('Delete', () => {
    test('Should get false when domain delete fails', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 0, oid: 0 })
      const isDeleted: boolean = await domainsTable.delete(profileName)
      expect(isDeleted).toBe(false)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    DELETE 
    FROM domains 
    WHERE Name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
    test('Should get true when domain delete succeeds', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: 1, oid: 0 })
      const isDeleted: boolean = await domainsTable.delete(profileName)
      expect(isDeleted).toBe(true)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
    DELETE 
    FROM domains 
    WHERE Name = $1 and tenant_id = $2`,
        [profileName, '']
      )
    })
  })
  describe('Insert', () => {
    test('should return ciraconfig when successfully inserted', async () => {
      const getByName = spyOn(domainsTable, 'getByName')
      querySpy.mockResolvedValueOnce({ rows: [{ amtDomain }], command: '', fields: null, rowCount: 1, oid: 0 })
      getByName.mockResolvedValueOnce(amtDomain)
      const result = await domainsTable.insert(amtDomain)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
      INSERT INTO domains(name, domain_suffix, provisioning_cert, provisioning_cert_storage_format, provisioning_cert_key, expiration_date, tenant_id)
      values($1, $2, $3, $4, $5, $6, $7)`,
        [
          amtDomain.profileName,
          amtDomain.domainSuffix,
          amtDomain.provisioningCert,
          amtDomain.provisioningCertStorageFormat,
          amtDomain.provisioningCertPassword,
          amtDomain.expirationDate,
          amtDomain.tenantId
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(1)
      expect(result).toBe(amtDomain)
    })

    test('should return null when insert fails', async () => {
      const getByName = spyOn(domainsTable, 'getByName')
      querySpy.mockResolvedValueOnce({ rows: [{ amtDomain }], command: '', fields: null, rowCount: 0, oid: 0 })
      getByName.mockResolvedValueOnce(amtDomain)
      const result = await domainsTable.insert(amtDomain)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
      INSERT INTO domains(name, domain_suffix, provisioning_cert, provisioning_cert_storage_format, provisioning_cert_key, expiration_date, tenant_id)
      values($1, $2, $3, $4, $5, $6, $7)`,
        [
          amtDomain.profileName,
          amtDomain.domainSuffix,
          amtDomain.provisioningCert,
          amtDomain.provisioningCertStorageFormat,
          amtDomain.provisioningCertPassword,
          amtDomain.expirationDate,
          amtDomain.tenantId
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(0)
      expect(result).toBe(null)
    })

    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(domainsTable.insert(amtDomain)).rejects.toThrow(DUPLICATE_DOMAIN_FAILED(amtDomain.profileName))
    })

    test('should NOT insert when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(domainsTable.insert(amtDomain)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(amtDomain.profileName))
    })
  })

  describe('Update', () => {
    test('should get a domain when device updates with change', async () => {
      const getByName = spyOn(domainsTable, 'getByName')
      querySpy.mockResolvedValueOnce({ rows: [{ amtDomain }], command: '', fields: null, rowCount: 1, oid: 0 })
      getByName.mockResolvedValueOnce(amtDomain)
      const result = await domainsTable.update(amtDomain)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(querySpy).toHaveBeenCalledWith(
        `
      UPDATE domains 
      SET domain_suffix=$2, provisioning_cert=$3, provisioning_cert_storage_format=$4, provisioning_cert_key=$5, expiration_date=$6 
      WHERE name=$1 and tenant_id = $7 and xmin = $8`,
        [
          amtDomain.profileName,
          amtDomain.domainSuffix,
          amtDomain.provisioningCert,
          amtDomain.provisioningCertStorageFormat,
          amtDomain.provisioningCertPassword,
          amtDomain.expirationDate,
          amtDomain.tenantId,
          amtDomain.version
        ]
      )
      expect(getByName).toHaveBeenCalledTimes(1)
      expect(result).toBe(amtDomain)
    })
    test('should NOT update when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505' })
      await expect(domainsTable.update(amtDomain)).rejects.toThrow(DUPLICATE_DOMAIN_FAILED(amtDomain.profileName))
    })
    test('should NOT insert when unexpected exception', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(domainsTable.update(amtDomain)).rejects.toThrow(API_UNEXPECTED_EXCEPTION(amtDomain.profileName))
    })
    test('should NOT update when concurrency error', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(domainsTable, 'getByName')
      getByNameSpy.mockResolvedValue(amtDomain)
      await expect(domainsTable.update(amtDomain)).rejects.toThrow(CONCURRENCY_MESSAGE)
    })
  })
})
