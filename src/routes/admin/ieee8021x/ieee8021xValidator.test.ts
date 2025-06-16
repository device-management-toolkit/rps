/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type Meta } from 'express-validator'
import { validatePxeTimeout, validateAuthProtocol } from './ieee8021xValidator.js'

describe('ieee802.1x validator', () => {
  describe('PXE Checks', () => {
    it('should pass', () => {
      const pxeTimeout = 120
      expect(validatePxeTimeout(pxeTimeout, null as any)).toBeTruthy()
    })
    it('should fail if pxe timeout is not a number', () => {
      const pxeTimeout = '123'
      expect(() => {
        validatePxeTimeout(pxeTimeout, null as any)
      }).toThrow('PXE Timeout must be number')
    })
    it('should fail if pxe timeout is below range', () => {
      const pxeTimeout = -1
      expect(() => {
        validatePxeTimeout(pxeTimeout, null as any)
      }).toThrow('PXE Timeout value should be 0 - 86400')
    })
    it('should fail if pxe timeout is above range', () => {
      const pxeTimeout: number = 60 * 60 * 24 + 1
      expect(() => {
        validatePxeTimeout(pxeTimeout, null as any)
      }).toThrow('PXE Timeout value should be 0 - 86400')
    })
  })

  describe('Protocol Checks', () => {
    let metaReq: Meta

    beforeEach(() => {
      metaReq = {
        req: {
          body: {
            profileName: 'ieee8021xProfileName',
            authenticationProtocol: 3,
            pxeTimeout: 120,
            wiredInterface: true
          }
        }
      } as any
    })

    describe('Protocol Checks - ieee8021xValidator', () => {
      it('wired should pass', () => {
        expect(validateAuthProtocol(metaReq.req.body.authenticationProtocol, metaReq)).toBeTruthy()
      })
      it('wired should fail with invalid authentication protocol ', async () => {
        metaReq.req.body.wiredInterface = true
        metaReq.req.body.authenticationProtocol = 100
        expect(() => {
          validateAuthProtocol(metaReq.req.body.authenticationProtocol, metaReq)
        }).toThrow(
          'Authentication protocol must be one of 0:EAP-TLS, 3:PEAPv1/EAP-GTC, 5:EAP-FAST/GTC, 10:EAP-FAST/TLS'
        )
      })
      it('wireless should pass', async () => {
        metaReq.req.body.wiredInterface = false
        metaReq.req.body.authenticationProtocol = 2
        expect(validateAuthProtocol(metaReq.req.body.authenticationProtocol, metaReq)).toBeTruthy()
      })
      it('wireless should fail with invalid authentication protocol', async () => {
        metaReq.req.body.wiredInterface = false
        metaReq.req.body.authenticationProtocol = 100
        expect(() => {
          validateAuthProtocol(metaReq.req.body.authenticationProtocol, metaReq)
        }).toThrow('Authentication protocol must be one of 0:EAP-TLS, 2:PEAPv0/EAP-MSCHAPv2')
      })
    })
  })
})
