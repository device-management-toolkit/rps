/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { AMT_DICE_ROOT_CERTS } from './certs/amt-dice.js'

describe('Intel AMT DICE trust anchors', () => {
  it('pins the official CAID 343_1 CA certificate from Intel', () => {
    const certificate = AMT_DICE_ROOT_CERTS.map((pem) => new crypto.X509Certificate(pem)).find((cert) =>
      cert.subject.includes('CN=Intel DICE SubCA CAID:343_1')
    )

    expect(certificate).toBeDefined()
    expect(certificate?.subject).toContain('organizationIdentifier=PEN:343')
    expect(certificate?.ca).toBe(true)
    expect(certificate?.fingerprint256).toBe(
      'FB:31:E4:10:9E:75:63:53:2B:3D:19:79:57:28:2A:5C:7A:9B:5D:C8:AC:49:B4:B7:BD:B0:C7:B8:A8:CF:48:F0'
    )
  })

  it('pins the self-signed DCP DICE Global Root CA', () => {
    const certificate = AMT_DICE_ROOT_CERTS.map((pem) => new crypto.X509Certificate(pem)).find((cert) =>
      cert.subject.includes('CN=DCP DICE Global Root CA')
    )

    expect(certificate).toBeDefined()
    expect(certificate?.ca).toBe(true)
    expect(certificate?.fingerprint256).toBe(
      '24:F8:14:D4:F9:C1:8A:0A:B7:95:D4:49:71:18:30:DD:D2:C9:55:6F:D5:28:93:8D:A2:BD:FE:2C:C6:CC:41:9C'
    )
    expect(certificate == null ? false : certificate.verify(certificate.publicKey)).toBe(true)
  })
})
