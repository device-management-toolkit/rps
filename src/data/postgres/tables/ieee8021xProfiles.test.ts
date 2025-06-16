/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import PostgresDb from '../index.js'
import { type Ieee8021xConfig } from '../../../models/RCS.Config.js'
import {
  API_UNEXPECTED_EXCEPTION,
  CONCURRENCY_MESSAGE,
  IEEE8021X_DELETION_FAILED_CONSTRAINT_AMT_PROFILE,
  IEEE8021X_DELETION_FAILED_CONSTRAINT_WIRELESS,
  IEEE8021X_INSERTION_FAILED,
  IEEE8021X_INSERTION_FAILED_DUPLICATE
} from '../../../utils/constants.js'
import { IEEE8021xProfilesTable } from './ieee8021xProfiles.js'
import { PostgresErr } from '../errors.js'
import { RPSError } from '../../../utils/RPSError.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('8021x profiles tests', () => {
  let db: PostgresDb
  let ieee8021xprofilesTable: IEEE8021xProfilesTable
  let querySpy: jest.Spied<any>
  let ieee8021xConfig: Ieee8021xConfig
  const profileName = 'profileName'
  beforeEach(() => {
    ieee8021xConfig = {
      profileName: 'profileName',
      authenticationProtocol: 0,
      username: '',
      password: '',
      activeInS0: false,
      pxeTimeout: 0,
      wiredInterface: false,
      tenantId: '',
      serverName: '',
      domain: '',
      roamingIdentity: '',
      version: ''
    }
    db = new PostgresDb('')
    ieee8021xprofilesTable = new IEEE8021xProfilesTable(db)
    querySpy = spyOn(ieee8021xprofilesTable.db, 'query')
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
      const count: number = await ieee8021xprofilesTable.getCount()
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
      const count: number = await ieee8021xprofilesTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on empty rows array', async () => {
      const expected = 0
      querySpy.mockResolvedValueOnce({ rows: [], command: '', fields: null, rowCount: expected, oid: 0 })
      const count: number = await ieee8021xprofilesTable.getCount()
      expect(count).toBe(expected)
    })
    test('should get count of 0 on no rows returned', async () => {
      querySpy.mockResolvedValueOnce({})
      const count: number = await ieee8021xprofilesTable.getCount()
      expect(count).toBe(0)
    })
    test('should get count of 0 on null results', async () => {
      querySpy.mockResolvedValueOnce(null)
      const count: number = await ieee8021xprofilesTable.getCount()
      expect(count).toBe(0)
    })

    test('should Get', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const result = await ieee8021xprofilesTable.get()
      expect(result).toStrictEqual([{}])
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
    test('should get by name', async () => {
      const rows = [{}]
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: rows.length })
      const result = await ieee8021xprofilesTable.getByName(profileName)
      expect(result).toStrictEqual(rows[0])
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
    test('should NOT get by name when no profiles exists', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await ieee8021xprofilesTable.getByName(profileName)
      expect(result).toBeNull()
    })
    test('should check profile exist', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await ieee8021xprofilesTable.checkProfileExits(profileName)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(result).toBeFalsy()
    })
    test('should check profile exist', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const result = await ieee8021xprofilesTable.checkProfileExits(profileName)
      expect(querySpy).toHaveBeenCalledTimes(1)
      expect(result).toBeFalsy()
    })
  })
  describe('Delete', () => {
    test('should delete', async () => {
      querySpy.mockImplementation(() => ({ rows: [], rowCount: 1 }))
      const result = await ieee8021xprofilesTable.delete(profileName)
      expect(result).toBeTruthy()
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
    test('should not delete if associated with amt profile', async () => {
      const dbErr = {
        code: PostgresErr.C23_FOREIGN_KEY_VIOLATION,
        table: 'profiles'
      }
      querySpy.mockRejectedValueOnce(dbErr)
      await expect(ieee8021xprofilesTable.delete(profileName)).rejects.toThrow(
        IEEE8021X_DELETION_FAILED_CONSTRAINT_AMT_PROFILE(profileName)
      )
    })
    test('should not delete if associated with wireless configuration', async () => {
      const dbErr = {
        code: PostgresErr.C23_FOREIGN_KEY_VIOLATION,
        table: 'wirelessconfigs'
      }
      querySpy.mockRejectedValueOnce(dbErr)
      await expect(ieee8021xprofilesTable.delete(profileName)).rejects.toThrow(
        IEEE8021X_DELETION_FAILED_CONSTRAINT_WIRELESS(profileName)
      )
    })
    test('should not delete on unhandled/unknown db error', async () => {
      const dbErr = {
        code: PostgresErr.C0A_FEATURE_NOT_SUPPORTED
      }
      querySpy.mockRejectedValueOnce(dbErr)
      await expect(ieee8021xprofilesTable.delete(profileName)).rejects.toBeInstanceOf(RPSError)
    })
  })
  describe('Insert', () => {
    test('should insert', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 1 })
      const getByNameSpy = spyOn(ieee8021xprofilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(ieee8021xConfig)
      const result = await ieee8021xprofilesTable.insert(ieee8021xConfig)

      expect(result).toBe(ieee8021xConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
    test('should get a null if insert returns no rows (should throw error actually)', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(ieee8021xprofilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(ieee8021xConfig)
      const result = await ieee8021xprofilesTable.insert(ieee8021xConfig)
      expect(result).toBeNull()
    })
    test('should NOT insert when duplicate name', async () => {
      querySpy.mockRejectedValueOnce({ code: '23505', detail: 'triggerd by profile_name constraint' })
      await expect(ieee8021xprofilesTable.insert(ieee8021xConfig)).rejects.toThrow(
        IEEE8021X_INSERTION_FAILED_DUPLICATE(ieee8021xConfig.profileName)
      )
    })
    test('should NOT insert on other error conditions', async () => {
      querySpy.mockRejectedValueOnce(new Error('unknown'))
      await expect(ieee8021xprofilesTable.insert(ieee8021xConfig)).rejects.toThrow(
        IEEE8021X_INSERTION_FAILED(ieee8021xConfig.profileName)
      )
    })
  })
  describe('Update', () => {
    test('should Update', async () => {
      querySpy.mockResolvedValueOnce({ rows: [{}], rowCount: 1 })
      const getByNameSpy = spyOn(ieee8021xprofilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(ieee8021xConfig)
      const result = await ieee8021xprofilesTable.update(ieee8021xConfig)
      expect(result).toBe(ieee8021xConfig)
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
    test('should NOT update when unexpected error', async () => {
      querySpy.mockRejectedValueOnce('unknown')
      await expect(ieee8021xprofilesTable.update(ieee8021xConfig)).rejects.toThrow(
        API_UNEXPECTED_EXCEPTION(ieee8021xConfig.profileName)
      )
    })
    test('should NOT update when concurrency issue', async () => {
      querySpy.mockResolvedValueOnce({ rows: [], rowCount: 0 })
      const getByNameSpy = spyOn(ieee8021xprofilesTable, 'getByName')
      getByNameSpy.mockResolvedValue(ieee8021xConfig)
      await expect(ieee8021xprofilesTable.update(ieee8021xConfig)).rejects.toThrow(CONCURRENCY_MESSAGE)
      expect(querySpy).toHaveBeenCalledTimes(1)
    })
  })
})
