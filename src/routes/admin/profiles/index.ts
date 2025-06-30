/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { deleteProfile } from './delete.js'
import { Router } from 'express'
import { allProfiles } from './all.js'
import { getProfile } from './get.js'
import { createProfile } from './create.js'
import { editProfile } from './edit.js'
import { amtProfileValidator, profileUpdateValidator } from './amtProfileValidator.js'
import { odataValidator } from '../odataValidator.js'
import validateMiddleware from '../../../middleware/validate.js'
import ifMatchMiddleware from '../../../middleware/if-match.js'
import { exportProfile } from './export.js'

const profileRouter: Router = Router()

profileRouter.get('/', odataValidator(), validateMiddleware, allProfiles)
profileRouter.get('/:profileName', getProfile)
profileRouter.post('/', amtProfileValidator(), validateMiddleware, createProfile)
profileRouter.patch('/', profileUpdateValidator(), validateMiddleware, ifMatchMiddleware, editProfile)
profileRouter.delete('/:profileName', deleteProfile)
profileRouter.get('/export/:profileName', exportProfile)

export default profileRouter
