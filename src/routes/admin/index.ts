/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Router, type Request, type Response } from 'express'
import domains from './domains/index.js'
import profiles from './profiles/index.js'
import ciraConfigs from './ciraconfig/index.js'
import version from './version/index.js'
import wirelessconfigs from './wireless/index.js'
import health from './health/index.js'
import ieee8021x from './ieee8021x/index.js'
import proxyconfigs from './proxy/index.js'

const adminRouter: Router = Router()

adminRouter.use('/domains', domains)
adminRouter.use('/profiles', profiles)
adminRouter.use('/ciraconfigs', ciraConfigs)
adminRouter.use('/wirelessconfigs', wirelessconfigs)
adminRouter.use('/version', version)
adminRouter.use('/health', health)
adminRouter.use('/ieee8021xconfigs', ieee8021x)
adminRouter.use('/proxyconfigs', proxyconfigs)
adminRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'admin path. use admin/profiles' })
})
export default adminRouter
