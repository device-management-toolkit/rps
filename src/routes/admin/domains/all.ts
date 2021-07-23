/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 * Author : Ramu Bachala
 **********************************************************************/
import { IDomainsDb } from '../../../repositories/interfaces/IDomainsDb'
import { DomainsDbFactory } from '../../../repositories/factories/DomainsDbFactory'
import { API_RESPONSE, API_UNEXPECTED_EXCEPTION } from '../../../utils/constants'
import Logger from '../../../Logger'
import { AMTDomain, DataWithCount } from '../../../models/Rcs'
import { validationResult } from 'express-validator'

export async function getAllDomains (req, res): Promise<void> {
  const log = new Logger('getAllDomains')
  let domainsDb: IDomainsDb
  const top = req.query.$top
  const skip = req.query.$skip
  const count = req.query.$count
  try {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() })
      return
    }
    domainsDb = DomainsDbFactory.getDomainsDb()
    let domains: AMTDomain[] = await domainsDb.getAllDomains(top, skip)
    if (domains.length >= 0) {
      domains = domains.map((result: AMTDomain) => {
        delete result.provisioningCert
        delete result.provisioningCertPassword
        return result
      })
    }
    if (count == null || count === 'false' || count === '0') {
      res.status(200).json(API_RESPONSE(domains)).end()
    } else {
      const count: number = await domainsDb.getCount()
      const dataWithCount: DataWithCount = {
        data: domains,
        totalCount: count
      }
      res.status(200).json(API_RESPONSE(dataWithCount)).end()
    }
  } catch (error) {
    log.error('Failed to get all the AMT Domains :', error)
    res.status(500).json(API_RESPONSE(null, null, API_UNEXPECTED_EXCEPTION('GET all Domains'))).end()
  }
}
