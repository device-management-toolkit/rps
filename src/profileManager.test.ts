/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMTConfiguration } from './models/index.js'
import { ProfileManager } from './ProfileManager.js'
import { type ILogger } from './interfaces/ILogger.js'
import Logger from './Logger.js'
import { type IProfilesTable } from './interfaces/database/IProfilesDb.js'
import { type CIRAConfig, ClientAction, type Ieee8021xConfig } from './models/RCS.Config.js'
import { config } from './test/helper/Config.js'
import { Environment } from './utils/Environment.js'

Environment.Config = config
const logger: ILogger = new Logger('ProfileManagerTests')

const ciraConfigurations: CIRAConfig[] = [
  {
    configName: 'ciraconfig1',
    mpsServerAddress: 'localhost',
    mpsPort: 4433,
    username: 'admin',
    password: 'P@ssw0rd',
    commonName: 'localhost',
    serverAddressFormat: 201, // IPv4 (3), IPv6 (4), FQDN (201)
    authMethod: 2, // Mutual Auth (1), Username/Password (2) (We only support 2)
    mpsRootCertificate: 'rootcert', // Assumption is Root Cert for MPS. Need to validate.
    proxyDetails: '',
    tenantId: ''
  },
  {
    configName: 'ciraconfig2',
    mpsServerAddress: 'localhost',
    mpsPort: 4433,
    username: 'admin',
    password: 'P@ssw0rd',
    commonName: 'localhost',
    serverAddressFormat: 201, // IPv4 (3), IPv6 (4), FQDN (201)
    authMethod: 2, // Mutual Auth (1), Username/Password (2) (We only support 2)
    mpsRootCertificate: 'rootcert', // Assumption is Root Cert for MPS. Need to validate.
    proxyDetails: '',
    tenantId: ''
  }
]

const ieee8021xConfigurations: Ieee8021xConfig[] = [
  {
    profileName: 'p1',
    authenticationProtocol: 0,
    pxeTimeout: 120,
    wiredInterface: true,
    tenantId: ''
  },
  {
    profileName: 'p2',
    authenticationProtocol: 0,
    pxeTimeout: 120,
    wiredInterface: false,
    tenantId: ''
  }
]

const amtConfigurations: AMTConfiguration[] = [
  {
    profileName: 'profile 1',
    amtPassword: '<StrongPassword1!>',
    mebxPassword: 'P@ssw0rd',
    generateRandomPassword: false,
    generateRandomMEBxPassword: false,
    activation: ClientAction.CLIENTCTLMODE,
    ciraConfigName: 'ciraconfig1',
    ciraConfigObject: ciraConfigurations[0],
    tlsMode: 1,
    tenantId: ''
  },
  {
    profileName: 'profile 2',
    amtPassword: '<StrongPassword2!>',
    mebxPassword: 'P@ssw0rd',
    generateRandomPassword: false,
    generateRandomMEBxPassword: false,
    activation: ClientAction.ADMINCTLMODE,
    ciraConfigName: 'ciraconfig1',
    ciraConfigObject: ciraConfigurations[0],
    tenantId: ''
  }
]
const profileStub: IProfilesTable = {
  getCount: async () => 2,
  getByName: async (name) => amtConfigurations.find((c) => c.profileName === name) as any,
  get: async (top, skip) => amtConfigurations,
  getCiraConfigForProfile: async (ciraConfigName) =>
    ciraConfigurations.find((c) => c.configName === ciraConfigName) as any,
  get8021XConfigForProfile: async (profileName) =>
    ieee8021xConfigurations.find((p) => p.profileName === profileName) as any,
  delete: async (profileName) => true,
  insert: async (amtConfig: AMTConfiguration) => {
    amtConfigurations.push(amtConfig)
    return amtConfig
  },
  update: async (amtConfig) => {
    const index = amtConfigurations.findIndex((item): boolean => item.profileName === amtConfig.profileName)
    if (index >= 0) {
      amtConfigurations.splice(index, 1)
      amtConfigurations.push(amtConfig)
      return amtConfig
    }
    return null
  }
}
test('test if profile exists', () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub)

  const actual = profileManager.doesProfileExist('profile 1', '')
  expect(actual).toBeTruthy()
})

test('test if profile does not exists', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub)

  const actual = await profileManager.doesProfileExist('profile 5', '')
  expect(actual).toBeFalsy()
})

test('retrieve activation based on profile', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub)

  const expected = ClientAction.ADMINCTLMODE
  const actual = await profileManager.getActivationMode('profile 2', '')
  expect(actual).toEqual(expected)
})

test('retrieve activation based on profile', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub, Environment.Config)

  const expected = ClientAction.CLIENTCTLMODE
  const actual = await profileManager.getActivationMode('profile 1', '')
  expect(actual).toEqual(expected)
})

test('retrieve configuration for cira', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub, Environment.Config)

  const expected = 'ciraconfig1'
  const actual: any = await profileManager.getCiraConfiguration('profile 2', '')
  expect(actual.configName).toEqual(expected)
})

test('retrieve amt password', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub)

  const expected = '<StrongPassword1!>'
  const profile = 'profile 1'
  const actual = await profileManager.getAmtPassword(profile, '')

  expect(actual).toEqual(expected)
})

test('retrieve amt and mebx passwords from the tenant-scoped secret path', async () => {
  const secretsManager = { getSecretFromKey: vi.fn().mockResolvedValue('fromVault') } as any
  const profileManager: ProfileManager = new ProfileManager(logger, secretsManager, profileStub)

  const profile = 'profile 1'
  expect(await profileManager.getAmtPassword(profile, 'tenant-a')).toBe('fromVault')
  expect(secretsManager.getSecretFromKey).toHaveBeenCalledWith('tenants/tenant-a/profiles/profile 1', 'AMT_PASSWORD')
  expect(await profileManager.getAmtPassword(profile, '')).toBe('fromVault')
  expect(secretsManager.getSecretFromKey).toHaveBeenCalledWith('profiles/profile 1', 'AMT_PASSWORD')
})

test('retrieve amt password auto generated', async () => {
  const profileManager: ProfileManager = new ProfileManager(logger, null as any, profileStub, Environment.Config)

  const profile = 'profile 2'
  const expected = '<StrongPassword2!>'
  const actual = await profileManager.getAmtPassword(profile, '')
  expect(actual).toBe(expected)
})
