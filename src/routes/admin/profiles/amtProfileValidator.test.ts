/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { validationResult } from 'express-validator'
import { ClientAction, TlsMode, TlsSigningAuthority } from '../../../models/RCS.Config.js'
import { AMTUserConsent } from '../../../models/index.js'
import { amtProfileValidator, profileUpdateValidator } from './amtProfileValidator.js'
import { createSpyObj } from '../../../test/helper/testUtils.js'

describe('AMT Profile Validation', () => {
  const testExpressValidatorMiddleware = async (req: Request, res: Response, middlewares): Promise<void> => {
    await Promise.all(
      middlewares.map(async (middleware) => {
        await middleware(req, res, () => undefined)
      })
    )
  }

  let req
  let res
  beforeEach(() => {
    req = {
      body: {
        profileName: 'acm',
        activation: ClientAction.ADMINCTLMODE,
        tags: ['acm'],
        tlsMode: 2,
        dhcpEnabled: false,
        ipSyncEnabled: true,
        generateRandomPassword: false,
        amtPassword: 'ABCabc123!@#',
        generateRandomMEBxPassword: false,
        mebxPassword: 'ABCabc123!@#',
        userConsent: AMTUserConsent.NONE,
        iderEnabled: true,
        kvmEnabled: true,
        solEnabled: true,
        version: '100'
      },
      query: {}
    }
    res = createSpyObj('Response', [
      'status',
      'json',
      'end',
      'send'
    ])
    res.status.mockReturnThis()
    res.json.mockReturnThis()
    res.send.mockReturnThis()
  })

  describe('Create', () => {
    it('should pass on creation happy path', async () => {
      await testExpressValidatorMiddleware(req, res, amtProfileValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should pass on creation with valid TLS values', async () => {
      req.body.tlsMode = TlsMode.MUTUAL_ONLY
      req.body.tlsSigningAuthority = TlsSigningAuthority.MICROSOFT_CA
      await testExpressValidatorMiddleware(req, res, amtProfileValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should fail on creation with invalid TLS values', async () => {
      req.body.tlsMode = 99
      req.body.tlsSigningAuthority = 'not an option'
      await testExpressValidatorMiddleware(req, res, amtProfileValidator())
      const errors = validationResult(req)
      const errMap = errors.mapped()
      expect(errMap.tlsMode).toBeTruthy()
      expect(errMap.tlsSigningAuthority).toBeTruthy()
    })
    it('should fail on creation when amtPassword is omitted and generateRandomPassword is false', async () => {
      delete req.body.amtPassword
      await testExpressValidatorMiddleware(req, res, amtProfileValidator())
      const errors = validationResult(req)
      expect(errors.mapped().generateRandomPassword).toBeTruthy()
    })
    it('should fail on creation in ACM when mebxPassword is omitted and generateRandomMEBxPassword is false', async () => {
      delete req.body.mebxPassword
      await testExpressValidatorMiddleware(req, res, amtProfileValidator())
      const errors = validationResult(req)
      expect(errors.mapped().generateRandomMEBxPassword).toBeTruthy()
    })
  })
  describe('Update', () => {
    it('should pass on update happy path', async () => {
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should pass on update with valid TLS values', async () => {
      req.body.tlsMode = TlsMode.MUTUAL_ONLY
      req.body.tlsSigningAuthority = TlsSigningAuthority.MICROSOFT_CA
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should fail on update with invalid TLS values', async () => {
      req.body.tlsMode = 99
      req.body.tlsSigningAuthority = 'not an option'
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      const errMap = errors.mapped()
      expect(errMap.tlsMode).toBeTruthy()
      expect(errMap.tlsSigningAuthority).toBeTruthy()
    })
    it('should pass on update when amtPassword and mebxPassword are omitted', async () => {
      delete req.body.amtPassword
      delete req.body.mebxPassword
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should fail on update when an invalid amtPassword is provided', async () => {
      req.body.amtPassword = 'weak'
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.mapped().amtPassword).toBeTruthy()
    })
    it('should fail on update when an invalid mebxPassword is provided', async () => {
      req.body.mebxPassword = 'weak'
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.mapped().mebxPassword).toBeTruthy()
    })
    it('should pass on update when amtPassword and mebxPassword are explicitly null', async () => {
      req.body.amtPassword = null
      req.body.mebxPassword = null
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.isEmpty()).toBeTruthy()
    })
    it('should fail on update when generateRandomPassword is true and amtPassword is also provided', async () => {
      req.body.generateRandomPassword = true
      req.body.amtPassword = 'ABCabc123!@#'
      await testExpressValidatorMiddleware(req, res, profileUpdateValidator())
      const errors = validationResult(req)
      expect(errors.mapped().generateRandomPassword).toBeTruthy()
    })
  })
})
