/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author : Ramu Bachala
 **********************************************************************/

import { Router, Request, Response } from 'express'
import domains from './domains/index'
import profiles from './profiles/index'
import ciraConfigs from './ciraconfig/index'
import version from './version/index'
import wirelessconfigs from './wireless/index'
import tlsconfigs from './tls/index'

const adminRouter: Router = Router()

adminRouter.use('/domains', domains)
adminRouter.use('/profiles', profiles)
adminRouter.use('/ciraconfigs', ciraConfigs)
adminRouter.use('/wirelessconfigs', wirelessconfigs)
adminRouter.use('/version', version)
adminRouter.use('/tlsconfigs', tlsconfigs)
adminRouter.get('/', (req: Request, res: Response) => {
  res.status(200).json({ message: 'admin path. use admin/profiles' })
})
export default adminRouter
