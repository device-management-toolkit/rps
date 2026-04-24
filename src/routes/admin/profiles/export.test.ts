/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { createSpyObj } from '../../../test/helper/testUtils.js'
import { exportProfile } from './export.js'
import { Environment } from '../../../utils/Environment.js'

import { vi, type MockInstance } from 'vitest'
import yaml from 'js-yaml'
import crypto from 'crypto'

describe('Profiles - Export', () => {
  let resSpy
  let req
  let getByNameSpy: MockInstance

  const baseProfile = {
    profileName: 'testProfile',
    activation: 'ccmactivate',
    dhcpEnabled: true,
    ipSyncEnabled: true,
    amtPassword: 'P@ssw0rd',
    mebxPassword: 'P@ssw0rd',
    ciraConfigName: '',
    wifiConfigs: [],
    ieee8021xProfileName: '',
    localWifiSyncEnabled: false,
    uefiWifiSyncEnabled: false,
    tlsMode: null
  }

  /** Helper: decrypt the export response and return parsed YAML */
  function decryptExport(content: string, key: string): any {
    const raw = Buffer.from(content, 'base64')
    const nonce = raw.slice(0, 12)
    const tag = raw.slice(-16)
    const ct = raw.slice(12, -16)
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key, 'ascii'), nonce)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ct), decipher.final()])
    const pt = decrypted.toString('utf8')
    return yaml.load(pt)
  }

  beforeEach(() => {
    resSpy = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    req = {
      db: {
        profiles: { getByName: vi.fn() },
        ciraConfigs: { getByName: vi.fn() },
        wirelessProfiles: { getByName: vi.fn() },
        ieee8021xProfiles: { getByName: vi.fn() },
        domains: { getByName: vi.fn() }
      },
      secretsManager: {
        getSecretFromKey: vi.fn<any>().mockResolvedValue(''),
        getSecretAtPath: vi.fn<any>().mockResolvedValue({})
      },
      params: { profileName: 'testProfile' },
      query: {},
      tenantId: ''
    }
    getByNameSpy = vi.spyOn(req.db.profiles, 'getByName')
    resSpy.status.mockReturnThis()
    resSpy.json.mockReturnThis()
    resSpy.send.mockReturnThis()
    Environment.Config = { enterprise_assistant_url: 'http://localhost:8000' } as any
  })

  describe('sharedStaticIP derivation', () => {
    it('should set sharedStaticIP to false when dhcpEnabled is true', async () => {
      getByNameSpy.mockResolvedValue({ ...baseProfile, dhcpEnabled: true })
      await exportProfile(req, resSpy)

      expect(resSpy.status).toHaveBeenCalledWith(200)
      const { content, key } = resSpy.json.mock.calls[0][0]
      const parsed = decryptExport(content, key)
      expect(parsed.configuration.network.wired.dhcpEnabled).toBe(true)
      expect(parsed.configuration.network.wired.sharedStaticIP).toBe(false)
    })

    it('should set sharedStaticIP to true when dhcpEnabled is false (static IP mode)', async () => {
      getByNameSpy.mockResolvedValue({ ...baseProfile, dhcpEnabled: false, ipSyncEnabled: true })
      await exportProfile(req, resSpy)

      expect(resSpy.status).toHaveBeenCalledWith(200)
      const { content, key } = resSpy.json.mock.calls[0][0]
      const parsed = decryptExport(content, key)
      expect(parsed.configuration.network.wired.dhcpEnabled).toBe(false)
      expect(parsed.configuration.network.wired.sharedStaticIP).toBe(true)
    })

    it('should set sharedStaticIP to true when dhcpEnabled is false regardless of ipSyncEnabled', async () => {
      getByNameSpy.mockResolvedValue({ ...baseProfile, dhcpEnabled: false, ipSyncEnabled: false })
      await exportProfile(req, resSpy)

      expect(resSpy.status).toHaveBeenCalledWith(200)
      const { content, key } = resSpy.json.mock.calls[0][0]
      const parsed = decryptExport(content, key)
      expect(parsed.configuration.network.wired.dhcpEnabled).toBe(false)
      expect(parsed.configuration.network.wired.sharedStaticIP).toBe(true)
    })

    it('should default sharedStaticIP to false when dhcpEnabled is undefined', async () => {
      const profile = { ...baseProfile }
      delete (profile as any).dhcpEnabled
      getByNameSpy.mockResolvedValue(profile)
      await exportProfile(req, resSpy)

      expect(resSpy.status).toHaveBeenCalledWith(200)
      const { content, key } = resSpy.json.mock.calls[0][0]
      const parsed = decryptExport(content, key)
      expect(parsed.configuration.network.wired.dhcpEnabled).toBe(true)
      expect(parsed.configuration.network.wired.sharedStaticIP).toBe(false)
    })
  })

  it('should return 404 when profile not found', async () => {
    getByNameSpy.mockResolvedValue(null)
    await exportProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(404)
  })

  it('should handle error', async () => {
    getByNameSpy.mockRejectedValue(new Error('db error'))
    await exportProfile(req, resSpy)
    expect(resSpy.status).toHaveBeenCalledWith(500)
  })
})
