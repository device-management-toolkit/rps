/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/jest.js'
import { Environment } from '../../../utils/Environment.js'
import { createProfile } from './create.js'
import { ClientAction, TlsMode, TlsSigningAuthority } from '../../../models/RCS.Config.js'
import { AMTUserConsent } from '../../../models/index.js'
import { adjustRedirectionConfiguration } from './common.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'

describe('Profiles - Create', () => {
  let resSpy
  let req
  let insertSpy: jest.Spied<any>
  let writeSecretSpy: jest.Spied<any>
  let defaultRedirectionCfgACM
  let sparseAcmCfg

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: { profiles: { insert: jest.fn(), delete: jest.fn() } },
      secretsManager: {
        writeSecretWithObject: jest.fn()
      },
      body: {},
      query: {}
    }
    defaultRedirectionCfgACM = {
      iderEnabled: false,
      kvmEnabled: true,
      solEnabled: false,
      userConsent: AMTUserConsent.KVM
    }
    sparseAcmCfg = {
      profileName: 'testProfile',
      activation: ClientAction.ADMINCTLMODE,
      dhcpEnabled: true,
      generateRandomPassword: false,
      amtPassword: 'P@ssw0rd',
      generateRandomMEBxPassword: false,
      mebxPassword: 'P@ssw0rd'
    }
    insertSpy = spyOn(req.db.profiles, 'insert').mockResolvedValue({})
    writeSecretSpy = spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue({})
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
    Environment.Config = { VaultConfig: { SecretsPath: '' } } as any
  })
  it('should create', async () => {
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      amtPassword: 'AMT_PASSWORD',
      iderEnabled: false,
      kvmEnabled: true,
      solEnabled: false,
      userConsent: AMTUserConsent.KVM,
      tenantId: ''
    })
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should handle error with create with write in vault fails', async () => {
    spyOn(req.db.profiles, 'delete').mockResolvedValue(true)
    writeSecretSpy = spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue(null)
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      amtPassword: 'AMT_PASSWORD',
      iderEnabled: false,
      kvmEnabled: true,
      solEnabled: false,
      userConsent: AMTUserConsent.KVM,
      tenantId: ''
    })
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
  it('should handle error with create with write in vault fails and undo db.delete fail', async () => {
    spyOn(req.db.profiles, 'delete').mockResolvedValue(null)
    writeSecretSpy = spyOn(req.secretsManager, 'writeSecretWithObject').mockResolvedValue(null)
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      amtPassword: 'AMT_PASSWORD',
      iderEnabled: false,
      kvmEnabled: true,
      solEnabled: false,
      userConsent: AMTUserConsent.KVM,
      tenantId: ''
    })
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
  it('should create when generate random password false for acm', async () => {
    req.body = {
      profileName: 'acm',
      activation: ClientAction.ADMINCTLMODE,
      tags: ['acm'],
      tlsMode: TlsMode.SERVER_ALLOW_NONTLS,
      tlsSigningAuthority: TlsSigningAuthority.SELF_SIGNED,
      dhcpEnabled: false,
      ipSyncEnabled: true,
      generateRandomPassword: false,
      password: 'password',
      generateRandomMEBxPassword: false,
      mebxPassword: 'password',
      userConsent: AMTUserConsent.NONE,
      iderEnabled: true,
      kvmEnabled: true,
      solEnabled: true
    }
    await createProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should create when generate random password and generate MEBX password true for acm', async () => {
    req.body = {
      profileName: 'acm',
      activation: ClientAction.ADMINCTLMODE,
      tags: ['acm'],
      tlsMode: TlsMode.SERVER_ALLOW_NONTLS,
      tlsSigningAuthority: TlsSigningAuthority.SELF_SIGNED,
      dhcpEnabled: false,
      ipSyncEnabled: true,
      generateRandomPassword: true,
      password: 'password',
      generateRandomMEBxPassword: true,
      mebxPassword: 'password',
      userConsent: AMTUserConsent.NONE,
      iderEnabled: true,
      kvmEnabled: true,
      solEnabled: true
    }
    await createProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
  it('should create self signed certificate when selected as signing authority', async () => {
    req.body = {
      ...sparseAcmCfg,
      tlsMode: TlsMode.SERVER_ALLOW_NONTLS,
      tlsSigningAuthority: TlsSigningAuthority.SELF_SIGNED
    }
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      ...req.body,
      amtPassword: 'AMT_PASSWORD',
      mebxPassword: 'MEBX_PASSWORD',
      ...defaultRedirectionCfgACM
    })
    expect(writeSecretSpy).toHaveBeenNthCalledWith(2, `TLS/${req.body.profileName}`, expect.anything())
  })
  it('should create self signed certificate by default', async () => {
    req.body = {
      ...sparseAcmCfg,
      tlsMode: TlsMode.SERVER_ALLOW_NONTLS
    }
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      ...req.body,
      amtPassword: 'AMT_PASSWORD',
      mebxPassword: 'MEBX_PASSWORD',
      tlsSigningAuthority: TlsSigningAuthority.SELF_SIGNED,
      ...defaultRedirectionCfgACM
    })
    expect(writeSecretSpy).toHaveBeenNthCalledWith(2, `TLS/${req.body.profileName}`, expect.anything())
  })
  it('should not create self signed certificate if tlsMode is falsy', async () => {
    req.body = {
      ...sparseAcmCfg,
      tlsSigningAuthority: TlsSigningAuthority.SELF_SIGNED
    }
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      ...req.body,
      amtPassword: 'AMT_PASSWORD',
      mebxPassword: 'MEBX_PASSWORD',
      ...defaultRedirectionCfgACM
    })
    expect(writeSecretSpy).not.toHaveBeenNthCalledWith(2, `TLS/${req.body.profileName}`, expect.anything())
  })
  it(`should set default AMT Redirection Configuration settings for ${ClientAction.ADMINCTLMODE}`, async () => {
    req.body = {
      activation: ClientAction.ADMINCTLMODE
    }
    const result = adjustRedirectionConfiguration(req.body)
    expect(result).toEqual({
      ...req.body,
      ...defaultRedirectionCfgACM
    })
  })
  it(`should set default AMT Redirection Configuration settings for ${ClientAction.CLIENTCTLMODE}`, async () => {
    req.body = {
      activation: ClientAction.CLIENTCTLMODE
    }
    const result = adjustRedirectionConfiguration(req.body)
    expect(result).toEqual({
      ...req.body,
      ...defaultRedirectionCfgACM,
      userConsent: AMTUserConsent.ALL
    })
  })
  it('should handle error', async () => {
    spyOn(req.db.profiles, 'insert').mockResolvedValue(null)
    await createProfile(req, resSpy)
    expect(insertSpy).toHaveBeenCalledWith({
      amtPassword: 'AMT_PASSWORD',
      iderEnabled: false,
      kvmEnabled: true,
      solEnabled: false,
      userConsent: 'KVM',
      tenantId: ''
    })
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
  it('should create even when no secretsManager', async () => {
    req.secretsManager = null
    await createProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(201)
  })
})
