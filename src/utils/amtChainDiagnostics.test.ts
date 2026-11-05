/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'
import { PUBLISHED_DICE_SUBCA_PEM } from '../test/helper/diceCerts.js'
import {
  MAX_LOGGED_CERTIFICATES,
  checkProductionRomCertificate,
  checkUpid,
  describeChain,
  dnAttribute,
  sanitizeForLog
} from './amtChainDiagnostics.js'

const keys = forge.pki.rsa.generateKeyPair(1024)
const otherKeys = forge.pki.rsa.generateKeyPair(1024)

function makeCert(
  subject: { cn: string; ou?: string },
  issuer: { cn: string; ou?: string },
  signWith?: forge.pki.rsa.PrivateKey
): crypto.X509Certificate {
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date(Date.now() - 1000)
  cert.validity.notAfter = new Date(Date.now() + 86400000)
  const attrs = (a: { cn: string; ou?: string }): forge.pki.CertificateField[] => [
    { name: 'commonName', value: a.cn },
    ...(a.ou != null ? [{ name: 'organizationalUnitName', value: a.ou }] : [])
  ]
  cert.setSubject(attrs(subject))
  cert.setIssuer(attrs(issuer))
  cert.sign(signWith ?? keys.privateKey, forge.md.sha256.create())
  return new crypto.X509Certificate(forge.pki.certificateToPem(cert))
}

function chain(leafCn: string, romCn = 'CSME ROM CA', romIssuerOu = 'ODCA 2 CSME P 0123'): crypto.X509Certificate[] {
  return [
    makeCert({ cn: leafCn }, { cn: 'Intermediate' }),
    makeCert({ cn: 'Intermediate' }, { cn: 'Other' }),
    makeCert({ cn: 'Other' }, { cn: 'Rom' }),
    makeCert({ cn: romCn }, { cn: 'Root', ou: romIssuerOu }),
    makeCert({ cn: 'Root' }, { cn: 'Root' })
  ]
}

describe('amtChainDiagnostics', () => {
  describe('log hardening', () => {
    it('replaces control characters from device-supplied text', () => {
      const out = sanitizeForLog('CN=ok\ninfo: forged line\r\u001b[31mred')
      // eslint-disable-next-line no-control-regex
      expect(out).not.toMatch(/[\u0000-\u001f]/)
      expect(out).toContain('CN=ok?info: forged line??')
    })

    it('truncates long values and says how much was cut', () => {
      const out = sanitizeForLog('a'.repeat(500))
      expect(out.length).toBeLessThan(260)
      expect(out).toContain('(300 more)')
    })

    it('keeps normal values unchanged', () => {
      expect(sanitizeForLog('CN=AMT RCFG, O=Intel Corporation')).toBe('CN=AMT RCFG, O=Intel Corporation')
    })

    it('logs at most the first certificates of an oversized chain', () => {
      const one = makeCert({ cn: 'c' }, { cn: 'c' })
      const lines = describeChain(Array.from({ length: MAX_LOGGED_CERTIFICATES + 5 }, () => one))
      expect(lines).toHaveLength(MAX_LOGGED_CERTIFICATES + 1)
      expect(lines[MAX_LOGGED_CERTIFICATES]).toBe('5 more certificate(s) not logged')
    })

    it('does not put control characters from a certificate name into a log line', () => {
      const evil = makeCert({ cn: 'AMT RCFG\nwarn: forged' }, { cn: 'Issuer\r\nerror: forged' })
      const [line] = describeChain([evil])
      expect(line).not.toMatch(/[\r\n]/)
    })
  })

  it('reads attributes from a node DN', () => {
    expect(dnAttribute('O=Intel Corporation\nOU=a\nOU=b\nCN=x', 'OU')).toEqual(['a', 'b'])
    expect(dnAttribute('CN=x', 'OU')).toEqual([])
  })

  describe('describeChain', () => {
    it('describes every certificate with key, fingerprint and issuer link', () => {
      const lines = describeChain([new crypto.X509Certificate(PUBLISHED_DICE_SUBCA_PEM)])
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('chain[0]: subject=')
      expect(lines[0]).toContain('CN=Intel DICE SubCA CAID:343_1')
      expect(lines[0]).toContain('key=ec/secp384r1')
      expect(lines[0]).toContain(
        'fp256=FB:31:E4:10:9E:75:63:53:2B:3D:19:79:57:28:2A:5C:7A:9B:5D:C8:AC:49:B4:B7:BD:B0:C7:B8:A8:CF:48:F0'
      )
      expect(lines[0]).toMatch(/pubKeySha256=[0-9a-f]{64}/)
    })

    it('reports whether each certificate is signed by the next', () => {
      const lines = describeChain(chain('AMT RCFG'))
      expect(lines).toHaveLength(5)
      // Every certificate in the test chain shares one key, so each link verifies.
      expect(lines[0]).toContain('signedByChain[1]=true')
      expect(lines[4]).toContain('signedByChain[5]=n/a')
    })

    it('flags a certificate that the next one did not sign', () => {
      const forged = makeCert({ cn: 'Leaf' }, { cn: 'Issuer' }, otherKeys.privateKey)
      const issuer = makeCert({ cn: 'Issuer' }, { cn: 'Issuer' })
      expect(describeChain([forged, issuer])[0]).toContain('signedByChain[1]=false')
    })
  })

  describe('checkUpid', () => {
    it('reports UPID off for the "AMT RCFG" leaf', () => {
      const findings = checkUpid(chain('AMT RCFG'))
      expect(findings).toHaveLength(1)
      expect(findings[0].message).toContain('Intel UPID not enabled')
    })

    it('reports UPID on, and the value to bind, for the IDevID leaf', () => {
      const c = chain('iAMT CSME IDevID RCFG')
      const findings = checkUpid(c)
      expect(findings[0].message).toContain('Intel UPID enabled')
      const expected = crypto.createHash('sha256').update(c[3].raw).digest('hex').slice(0, 40)
      expect(findings[1].message).toContain(expected)
      expect(findings[1].message).toContain('not verified by RPS')
      // The UPID prefix is a platform identifier, so it must not be logged above debug.
      expect(findings[1].level).toBe('debug')
    })

    it('warns when UPID is on but there is no ROM certificate', () => {
      const findings = checkUpid(chain('iAMT CSME IDevID RCFG').slice(0, 2))
      expect(findings[1].level).toBe('warn')
    })

    it('warns about an unknown leaf CN', () => {
      expect(checkUpid(chain('Something else'))[0].level).toBe('warn')
    })
  })

  describe('checkProductionRomCertificate', () => {
    it.each(['ODCA 2 CSME P 0123', 'On Die CSME P 1'])('passes for issuer OU "%s"', (ou) => {
      const [finding] = checkProductionRomCertificate(chain('AMT RCFG', 'CSME ROM CA', ou))
      expect(finding.level).toBe('info')
      expect(finding.message).toContain('Production check passed')
    })

    it('fails for an engineering chain without the P suffix', () => {
      const [finding] = checkProductionRomCertificate(chain('AMT RCFG', 'CSME ROM CA', 'ODCA 2 CSME 0123'))
      expect(finding.level).toBe('warn')
      expect(finding.message).toContain('engineering or debug')
    })

    it('fails for an unrelated issuer OU', () => {
      const [finding] = checkProductionRomCertificate(chain('AMT RCFG', 'CSME ROM CA', 'Other CA'))
      expect(finding.level).toBe('warn')
      expect(finding.message).toContain('neither')
    })

    it('says so when the 4th certificate is not a ROM CA', () => {
      const [finding] = checkProductionRomCertificate(chain('AMT RCFG', 'Not it'))
      expect(finding.message).toContain('not the CSME ROM ODCA certificate')
    })

    it('says so when the chain has fewer than 4 certificates', () => {
      const [finding] = checkProductionRomCertificate([new crypto.X509Certificate(PUBLISHED_DICE_SUBCA_PEM)])
      expect(finding.level).toBe('warn')
      expect(finding.message).toContain('no 4th')
    })
  })
})
