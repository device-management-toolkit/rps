/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author : Ramu Bachala
 **********************************************************************/
import Logger from '../../../Logger'
import { AMTConfiguration, DataWithCount } from '../../../models/Rcs'
import { IProfilesDb } from '../../../repositories/interfaces/IProfilesDb'
import { ProfilesDbFactory } from '../../../repositories/factories/ProfilesDbFactory'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION } from '../../../utils/constants'
import { validationResult } from 'express-validator'

export async function allProfiles (req, res): Promise<void> {
  const log = new Logger('allProfiles')
  let profilesDb: IProfilesDb = null
  let amtConfigs: AMTConfiguration[] = [] as AMTConfiguration[]
  const top = req.query.$top
  const skip = req.query.$skip
  const count = req.query.$count
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() })
      return
    }
    profilesDb = ProfilesDbFactory.getProfilesDb()
    amtConfigs = await profilesDb.getAllProfiles(top, skip)
    if (count == null || count === 'false' || count === '0') {
      res.status(200).json(API_RESPONSE(amtConfigs)).end()
    } else {
      const count: number = await profilesDb.getCount()
      const dataWithCount: DataWithCount = {
        data: amtConfigs,
        totalCount: count
      }
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
  } catch (error) {
    log.error('Failed to get all the AMT Domains :', error)
    res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('GET all AMT profiles'))).end()
  }
}
