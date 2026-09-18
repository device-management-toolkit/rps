/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { describe, expect, it } from 'vitest'
import { isIntelDiceSubCASubject } from './TLSTunnelManager.js'

describe('TLSTunnelManager', () => {
  it('identifies the AMT 22 Intel DICE SubCA subject', () => {
    expect(
      isIntelDiceSubCASubject('O=Intel Corporation\norganizationIdentifier=PEN:343\nCN=Intel DICE SubCA CAID:343_1')
    ).toBe(true)
  })

  it.each([
    'O=Example Corporation\norganizationIdentifier=PEN:343\nCN=Intel DICE SubCA CAID:343_1',
    'O=Intel Corporation\nCN=Intel DICE SubCA CAID:343_1',
    'O=Intel Corporation\norganizationIdentifier=PEN:343\nCN=Example SubCA'
  ])('rejects a non-Intel-DICE subject: %s', (subject) => {
    expect(isIntelDiceSubCASubject(subject)).toBe(false)
  })
})
