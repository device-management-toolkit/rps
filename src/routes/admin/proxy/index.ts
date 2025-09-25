/*********************************************************************
 * Copyright (c) Intel Corporation 2025
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Router } from 'express'
import validateMiddleware from '../../../middleware/validate.js'
import { odataValidator } from '../odataValidator.js'
import { allProxyProfiles } from './all.js'
import { createProxyProfile } from './create.js'
import { proxyUpdateValidator, proxyValidator } from './proxyValidator.js'
import { deleteProxyProfile } from './delete.js'
import { getProxyProfile } from './get.js'
import { editProxyProfile } from './edit.js'

const proxyRouter: Router = Router()

proxyRouter.get('/', odataValidator(), validateMiddleware, allProxyProfiles)
proxyRouter.get('/:proxyName', getProxyProfile)
proxyRouter.post('/', proxyValidator(), validateMiddleware, createProxyProfile)
proxyRouter.patch('/', proxyUpdateValidator(), validateMiddleware, editProxyProfile)
proxyRouter.delete('/:proxyName', deleteProxyProfile)
export default proxyRouter
