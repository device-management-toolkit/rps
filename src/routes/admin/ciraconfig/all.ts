/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author : Ramu Bachala
 **********************************************************************/
import { ICiraConfigDb } from '../../../repositories/interfaces/ICiraConfigDb'
import { CiraConfigDbFactory } from '../../../repositories/CiraConfigDbFactory'
import Logger from '../../../Logger'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION } from '../../../utils/constants'
import { CIRAConfig } from '../../../RCS.Config'

export async function allCiraConfigs (req, res): Promise<void> {
  let ciraConfigDb: ICiraConfigDb = null
  const log = new Logger('allCiraConfigs')
  try {
    ciraConfigDb = CiraConfigDbFactory.getCiraConfigDb()
    let results: CIRAConfig[] = await ciraConfigDb.getAllCiraConfigs() || [] as CIRAConfig[]
    if (results.length >= 0) {
      results = results.map((result: CIRAConfig) => {
        delete result.password
        return result
      })
      res.status(200).json(API_RESPONSE(results)).end()
    }
  } catch (error) {
    log.error('Failed to get all the CIRA config profiles :', error)
    res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('Get all CIRA config profiles'))).end()
  }
}
