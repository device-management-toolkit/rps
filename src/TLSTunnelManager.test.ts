/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import forge from 'node-forge'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Logger from './Logger.js'
import { Environment } from './utils/Environment.js'
import { AMT_ODCA_ROOT_CERTS } from './certs/amt-odca.js'
import { AmtChainVerificationError, getTrustedAmtRoots, TLSTunnelManager } from './TLSTunnelManager.js'
import { DEBUG_DEVICE_TOP_PEM, PUBLISHED_DICE_SUBCA_PEM } from './test/helper/diceCerts.js'

const DEBUG_ROOT_FP = '24:F8:14:D4:F9:C1:8A:0A:B7:95:D4:49:71:18:30:DD:D2:C9:55:6F:D5:28:93:8D:A2:BD:FE:2C:C6:CC:41:9C'
const RELEASE_ROOT_FP =
  '80:31:CD:5E:07:D4:9B:E7:F3:08:90:0E:F1:77:51:45:CD:E8:D2:64:D3:85:45:00:38:F2:E8:29:04:D5:C9:07'

/** Fingerprints of the trusted roots that sign `top`. */
function signers(roots: ReturnType<typeof getTrustedAmtRoots>, top: crypto.X509Certificate): string[] {
  return roots.filter(({ cert }) => top.verify(cert.publicKey)).map(({ cert }) => cert.fingerprint256)
}

describe('getTrustedAmtRoots', () => {
  const productionTop = new crypto.X509Certificate(PUBLISHED_DICE_SUBCA_PEM)
  const debugTop = new crypto.X509Certificate(DEBUG_DEVICE_TOP_PEM)

  it('trusts only release roots when the debug root is not enabled', () => {
    const roots = getTrustedAmtRoots(false)
    expect(roots.some(({ debug }) => debug)).toBe(false)
    const fps = roots.map(({ cert }) => cert.fingerprint256)
    expect(fps).toContain(RELEASE_ROOT_FP)
    expect(fps).not.toContain(DEBUG_ROOT_FP)
  })

  it('accepts a production device chain through the release root in either setting', () => {
    expect(signers(getTrustedAmtRoots(false), productionTop)).toEqual([RELEASE_ROOT_FP])
    expect(signers(getTrustedAmtRoots(true), productionTop)).toEqual([RELEASE_ROOT_FP])
  })

  it('refuses a debug-signed device chain when the debug root is not enabled', () => {
    expect(signers(getTrustedAmtRoots(false), debugTop)).toEqual([])
  })

  it('accepts a debug-signed device chain only through the debug root when enabled', () => {
    const roots = getTrustedAmtRoots(true)
    expect(roots.filter(({ debug }) => debug).map(({ cert }) => cert.fingerprint256)).toEqual([DEBUG_ROOT_FP])
    expect(signers(roots, debugTop)).toEqual([DEBUG_ROOT_FP])
  })
})

describe('refusing a DICE chain', () => {
  const debugTop = new crypto.X509Certificate(DEBUG_DEVICE_TOP_PEM)
  const original = Environment.Config

  afterEach(() => {
    Environment.Config = original
  })

  const verify = (
    allowDebugRoot: boolean,
    chain: crypto.X509Certificate[] = [debugTop]
  ): { ok: boolean; reason: string; summary?: string } => {
    Environment.Config = { ...original, amt_dice_allow_debug_root: allowDebugRoot } as any
    const manager: any = new TLSTunnelManager({} as any, 'client', true)
    manager.peerChainDer = chain.map((cert) => cert.raw)
    return manager.verifyAmtChainAgainstODCA({})
  }

  /** A self-signed certificate that carries the Intel DICE SubCA name but chains to no Intel root. */
  const forgedSubCA = (cn = 'Intel DICE SubCA CAID:343_1'): crypto.X509Certificate => {
    const keys = forge.pki.rsa.generateKeyPair(1024)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date(Date.now() - 1000)
    cert.validity.notAfter = new Date(Date.now() + 86400000)
    const name = [
      { name: 'organizationName', value: 'Intel Corporation' },
      { name: 'commonName', value: cn }
    ]
    cert.setSubject(name)
    cert.setIssuer(name)
    cert.sign(keys.privateKey, forge.md.sha256.create())
    return new crypto.X509Certificate(forge.pki.certificateToPem(cert))
  }

  it.each([false, true])(
    'refuses an untrusted certificate that only carries the Intel DICE SubCA name (debug root enabled: %s)',
    (allowDebugRoot) => {
      const verdict = verify(allowDebugRoot, [forgedSubCA()])

      expect(verdict.ok).toBe(false)
      expect(verdict.summary).toBe('Intel DICE chain verification failed: not signed by a trusted root')
    }
  )

  it('keeps device-supplied text in the refusal reason on one bounded line', () => {
    const verdict = verify(false, [forgedSubCA(`Intel DICE SubCA\tforged ${'x'.repeat(500)}`)])

    expect(verdict.ok).toBe(false)
    expect(verdict.reason).not.toContain('\t')
    expect(verdict.reason).toContain('...(')
    // Only the device-supplied subject is bounded. The trusted roots listed are fixed.
    expect(verdict.reason).not.toContain('x'.repeat(250))
  })

  it('names the roots that were checked, and marks the debug root only when it is enabled', () => {
    const off = verify(false, [forgedSubCA()]).reason
    const on = verify(true, [forgedSubCA()]).reason

    expect(off).toContain(`fp256=${RELEASE_ROOT_FP}`)
    expect(off).toContain('DCP DICE Global Root CA')
    expect(off).not.toContain(DEBUG_ROOT_FP)
    expect(off).not.toContain('[DICE debug root]')
    expect(on).toContain(`fp256=${RELEASE_ROOT_FP}`)
    expect(on).toContain(`fp256=${DEBUG_ROOT_FP}`)
    expect(on).toContain('[DICE debug root]')
    // The ODCA roots are listed as well.
    for (const pem of AMT_ODCA_ROOT_CERTS) {
      expect(on).toContain(new crypto.X509Certificate(pem).fingerprint256)
    }
  })

  it('bounds the rejected peer names in the debug diagnostics', () => {
    const hostile = forgedSubCA(`Intel DICE SubCA\tforged ${'x'.repeat(500)}`)
    const lines: string[] = []
    const spy = vi.spyOn(Logger.prototype, 'debug').mockImplementation((line: string) => {
      lines.push(line)
    })
    const manager: any = new TLSTunnelManager({} as any, 'client', true)
    manager.logTLSDiagnostics(
      {
        authorized: false,
        getProtocol: () => 'TLSv1.3',
        getCipher: () => ({}),
        getPeerCertificate: () => ({
          raw: hostile.raw,
          subject: { CN: `a\tb${'y'.repeat(500)}` },
          issuer: { CN: `c\td${'z'.repeat(500)}` },
          fingerprint256: 'fp'
        })
      },
      new Error('refused')
    )
    spy.mockRestore()

    const peerLines = lines.filter((line) => line.includes('peer '))
    expect(peerLines.length).toBe(2)
    for (const line of peerLines) {
      expect(line).not.toContain('\t')
      expect(line).not.toContain('x'.repeat(250))
      expect(line).not.toContain('y'.repeat(250))
      expect(line).not.toContain('z'.repeat(250))
    }
  })

  it.each([false, true])(
    'still accepts a chain that terminates at an ODCA root, for AMT 21 and earlier (debug root enabled: %s)',
    (allowDebugRoot) => {
      const odcaRoot = new crypto.X509Certificate(AMT_ODCA_ROOT_CERTS[0])

      const verdict = verify(allowDebugRoot, [odcaRoot])

      expect(verdict.ok).toBe(true)
      expect(verdict.reason).toContain('terminates at trusted AMT root')
    }
  )

  it('says the DICE chain failed', () => {
    const verdict = verify(false)

    expect(verdict.ok).toBe(false)
    expect(verdict.summary).toBe('Intel DICE chain verification failed: not signed by a trusted root')
    // The full reason, with the hint for pre-production hardware, stays for the logs.
    expect(verdict.reason).toContain('top fp256=')
    expect(verdict.reason).toContain('RPS_AMT_DICE_ALLOW_DEBUG_ROOT=true')
  })

  describe('the NON-PRODUCTION warning', () => {
    const releaseTop = new crypto.X509Certificate(PUBLISHED_DICE_SUBCA_PEM)

    /** Runs the verification and returns the verdict with the NON-PRODUCTION warnings it logged. */
    const verifyAndCollectWarnings = (
      allowDebugRoot: boolean,
      chain: crypto.X509Certificate[]
    ): { verdict: { ok: boolean; reason: string }; warnings: string[] } => {
      const warnings: string[] = []
      const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation((line: string) => {
        if (line.includes('NON-PRODUCTION')) warnings.push(line)
      })
      try {
        return { verdict: verify(allowDebugRoot, chain), warnings }
      } finally {
        spy.mockRestore()
      }
    }

    it('is logged once, naming the debug root, when a chain is accepted through it', () => {
      const { verdict, warnings } = verifyAndCollectWarnings(true, [debugTop])

      expect(verdict.ok).toBe(true)
      expect(verdict.reason).toContain('DICE debug root')
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(`fp=${DEBUG_ROOT_FP}`)
    })

    it.each([false, true])(
      'is not logged when a production chain is accepted through the release root (debug root enabled: %s)',
      (allowDebugRoot) => {
        const { verdict, warnings } = verifyAndCollectWarnings(allowDebugRoot, [releaseTop])

        expect(verdict.ok).toBe(true)
        expect(warnings).toEqual([])
      }
    )

    it('is not logged when a debug chain is refused because the debug root is not enabled', () => {
      const { verdict, warnings } = verifyAndCollectWarnings(false, [debugTop])

      expect(verdict.ok).toBe(false)
      expect(warnings).toEqual([])
    })
  })

  it('carries the summary on the error the activation reads', () => {
    const error = new AmtChainVerificationError('full reason', 'short summary')

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('full reason')
    expect(error.summary).toBe('short summary')
  })
})
