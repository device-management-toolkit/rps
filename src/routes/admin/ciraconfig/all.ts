/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author : Ramu Bachala
 **********************************************************************/
import { ICiraConfigDb } from '../../../interfaces/database/ICiraConfigDb'
import { CiraConfigDbFactory } from '../../../repositories/factories/CiraConfigDbFactory'
import Logger from '../../../Logger'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION } from '../../../utils/constants'
import { CIRAConfig } from '../../../RCS.Config'
import { DataWithCount } from '../../../models/Rcs'
import { MqttProvider } from '../../../utils/MqttProvider'
import { Request, Response } from 'express'

export async function allCiraConfigs (req: Request, res: Response): Promise<void> {
  let ciraConfigDb: ICiraConfigDb = null
  const log = new Logger('allCiraConfigs')
  const top = Number(req.query.$top)
  const skip = Number(req.query.$skip)
  const includeCount = req.query.$count
  try {
    ciraConfigDb = CiraConfigDbFactory.getCiraConfigDb()
    let ciraConfigs: CIRAConfig[] = await ciraConfigDb.get(top, skip) || [] as CIRAConfig[]
    if (ciraConfigs.length >= 0) {
      ciraConfigs = ciraConfigs.map((result: CIRAConfig) => {
        delete result.password
        return result
      })
    }
    if (includeCount == null || includeCount === 'false') {
      res.status(200).json(API_RESPONSE(ciraConfigs)).end()
    } else {
      const count: number = await ciraConfigDb.getCount()
      const dataWithCount: DataWithCount = {
        data: ciraConfigs,
        totalCount: count
      }
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
    MqttProvider.publishEvent('success', ['allCiraConfigs'], 'Sent configs')
  } catch (error) {
    MqttProvider.publishEvent('fail', ['allCiraConfigs'], 'Failed to get all the CIRA config profiles')
    log.error('Failed to get all the CIRA config profiles :', error)
    res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('Get all CIRA config profiles'))).end()
  }
}
