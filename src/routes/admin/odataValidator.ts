/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { query } from 'express-validator'
import { type RequestHandler } from 'express'
import { DEFAULT_SKIP, DEFAULT_TOP } from '../../utils/constants.js'

// Express 5 reparses query parameters on every access. Keep one object so
// express-validator's defaults remain available to subsequent handlers.
const retainQuery: RequestHandler = (req, _res, next) => {
  Object.defineProperty(req, 'query', {
    value: req.query,
    writable: true,
    configurable: true,
    enumerable: true
  })
  next()
}

export const odataValidator = (): any => [
  retainQuery,
  query('$top')
    .default(DEFAULT_TOP)
    .isInt({ min: 0, max: 9999999999 })
    .withMessage('The number of items to return should be a positive integer'),
  query('$skip')
    .default(DEFAULT_SKIP)
    .isInt({ min: 0, max: 9999999999 })
    .withMessage('The number of items to skip before starting to collect the result set should be a positive integer'),
  query('$count')
    .optional()
    .isBoolean()
    .withMessage('To return total number of records in result set should be boolean')
]
