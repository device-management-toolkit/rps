/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { AMT_DICE_ROOT_CERTS } from './certs/amt-dice.js'

describe('Intel AMT DICE trust anchors', () => {
  it('pins the official CAID 343_1 CA certificate from Intel', () => {
    expect(AMT_DICE_ROOT_CERTS).toHaveLength(1)

    const certificate = new crypto.X509Certificate(AMT_DICE_ROOT_CERTS[0])

    expect(certificate.subject).toContain('CN=Intel DICE SubCA CAID:343_1')
    expect(certificate.subject).toContain('organizationIdentifier=PEN:343')
    expect(certificate.ca).toBe(true)
    expect(certificate.fingerprint256).toBe(
      'FB:31:E4:10:9E:75:63:53:2B:3D:19:79:57:28:2A:5C:7A:9B:5D:C8:AC:49:B4:B7:BD:B0:C7:B8:A8:CF:48:F0'
    )
  })
})
