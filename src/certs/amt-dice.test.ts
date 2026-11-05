/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { X509Certificate } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AMT_DICE_DEBUG_ROOT_CERTS, AMT_DICE_ROOT_CERTS } from './amt-dice.js'
import { DEBUG_DEVICE_TOP_PEM, PUBLISHED_DICE_SUBCA_PEM } from '../test/helper/diceCerts.js'

const RELEASE_ROOT_FP =
  '80:31:CD:5E:07:D4:9B:E7:F3:08:90:0E:F1:77:51:45:CD:E8:D2:64:D3:85:45:00:38:F2:E8:29:04:D5:C9:07'
const DEBUG_ROOT_FP = '24:F8:14:D4:F9:C1:8A:0A:B7:95:D4:49:71:18:30:DD:D2:C9:55:6F:D5:28:93:8D:A2:BD:FE:2C:C6:CC:41:9C'

describe('amt-dice certificates', () => {
  const release = new X509Certificate(AMT_DICE_ROOT_CERTS[0])
  const debug = new X509Certificate(AMT_DICE_DEBUG_ROOT_CERTS[0])

  it('embeds the published roots unchanged', () => {
    expect(release.fingerprint256).toBe(RELEASE_ROOT_FP)
    expect(debug.fingerprint256).toBe(DEBUG_ROOT_FP)
  })

  it('keeps the debug root out of the always-trusted anchors', () => {
    expect(AMT_DICE_ROOT_CERTS).toHaveLength(1)
    expect(AMT_DICE_DEBUG_ROOT_CERTS).toHaveLength(1)
    expect(new X509Certificate(AMT_DICE_ROOT_CERTS[0]).fingerprint256).not.toBe(DEBUG_ROOT_FP)
  })

  it('has the published production SubCA issued by the release root and not the debug root', () => {
    const subCa = new X509Certificate(PUBLISHED_DICE_SUBCA_PEM)
    expect(subCa.verify(release.publicKey)).toBe(true)
    expect(subCa.verify(debug.publicKey)).toBe(false)
  })

  it('has the pre-production device SubCA issued by the debug root and not the release root', () => {
    const top = new X509Certificate(DEBUG_DEVICE_TOP_PEM)
    expect(top.verify(debug.publicKey)).toBe(true)
    expect(top.verify(release.publicKey)).toBe(false)
  })
})
