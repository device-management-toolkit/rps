/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import {
  ciraConfigSecretPath,
  deviceSecretPath,
  domainCertSecretPath,
  profileSecretPath,
  profileTlsSecretPath,
  tenantSegment,
  wirelessSecretPath
} from './secretPaths.js'

describe('secretPaths', () => {
  const builders = [
    [
      'profile',
      profileSecretPath,
      'profiles'
    ],
    [
      'profile TLS',
      profileTlsSecretPath,
      'TLS'
    ],
    [
      'domain cert',
      domainCertSecretPath,
      'certs'
    ],
    [
      'CIRA config',
      ciraConfigSecretPath,
      'CIRAConfigs'
    ],
    [
      'wireless',
      wirelessSecretPath,
      'Wireless'
    ],
    [
      'device',
      deviceSecretPath,
      'devices'
    ]
  ] as const

  describe.each(builders)('%s path', (_label, build, folder) => {
    it.each([
      '',
      null,
      undefined
    ])('keeps the legacy path for the empty tenant: %s', (tenantId) => {
      expect(build('name-1', tenantId)).toBe(`${folder}/name-1`)
    })

    it('prefixes a non-empty tenant', () => {
      expect(build('name-1', 'tenant-a')).toBe(`tenants/tenant-a/${folder}/name-1`)
    })

    it('gives two tenants with the same resource name distinct paths', () => {
      expect(build('name-1', 'tenant-a')).not.toBe(build('name-1', 'tenant-b'))
      expect(build('name-1', 'tenant-a')).not.toBe(build('name-1', ''))
    })
  })

  describe('tenantSegment', () => {
    it('returns a UUID tenant id unchanged', () => {
      const uuid = '4c4c4544-004b-4210-8033-b6c04f504633'
      expect(tenantSegment(uuid)).toBe(uuid)
    })

    it('keeps a tenant id with path characters inside one segment', () => {
      const segment = tenantSegment('a b/c%d_e')
      expect(segment).toBe('a_20b_2Fc_25d_5Fe')
      expect(segment).not.toContain('/')
      expect(segment).not.toContain('%')
    })

    it('is reversible so distinct tenant ids never collide', () => {
      const decode = (s: string): string => decodeURIComponent(s.replace(/_/g, '%'))
      for (const tenantId of [
        'a/b',
        'a_b',
        'a%2Fb',
        'a_2Fb',
        'tenant-ä'
      ]) {
        expect(decode(tenantSegment(tenantId))).toBe(tenantId)
      }
      expect(tenantSegment('a/b')).not.toBe(tenantSegment('a_2Fb'))
    })

    it('cannot escape the tenant prefix with a crafted tenant id', () => {
      expect(profileSecretPath('p1', '../other')).toBe('tenants/.._2Fother/profiles/p1')
      expect(profileSecretPath('p1', 'x/profiles')).toBe('tenants/x_2Fprofiles/profiles/p1')
    })
  })
})
