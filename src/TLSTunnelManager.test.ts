/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { getTrustedAmtRoots } from './TLSTunnelManager.js'
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
