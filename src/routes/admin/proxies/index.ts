/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Router } from 'express'
import validateMiddleware from '../../../middleware/validate.js'
import { odataValidator } from '../odataValidator.js'
import { allProxyProfiles } from './all.js'
import { createProxyProfile } from './create.js'
import { proxiesValidator } from './proxiesValidator.js'

const profileRouter: Router = Router()

profileRouter.get('/', odataValidator(), validateMiddleware, allProxyProfiles)
profileRouter.post('/', proxiesValidator(), validateMiddleware, createProxyProfile)
export default profileRouter
