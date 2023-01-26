/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type Request, type Response } from 'express'
import { validationResult } from 'express-validator'

const validateMiddleware = async (req: Request, res: Response, next): Promise<void> => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({ errors: errors.array() }).end()
  } else {
    next()
  }
}
export default validateMiddleware
