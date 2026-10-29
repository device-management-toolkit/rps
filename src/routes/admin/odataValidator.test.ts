/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import express from 'express'
import { odataValidator } from './odataValidator.js'
import validateMiddleware from '../../middleware/validate.js'
import { request } from '../../test/helper/http.js'

describe('OData pagination over HTTP', () => {
  const app = express()
  app.get('/', odataValidator(), validateMiddleware, (req, res) => {
    res.json({ top: Number(req.query.$top), skip: Number(req.query.$skip), count: req.query.$count })
  })

  it.each(['/', '/?$top=&$skip='])('retains defaults for %s', async (path) => {
    expect(await request(app, path)).toEqual({ status: 200, body: { top: 25, skip: 0 } })
  })

  it('retains explicit pagination and count', async () => {
    expect(await request(app, '/?$top=5&$skip=2&$count=false')).toEqual({
      status: 200,
      body: { top: 5, skip: 2, count: 'false' }
    })
  })

  it.each([
    '/?$top=-1',
    '/?$skip=invalid',
    '/?$top=10000000000',
    '/?$count=invalid'
  ])('rejects invalid pagination for %s', async (path) => {
    const response = await request(app, path)
    expect(response.status).toBe(400)
    expect(response.body.errors).not.toHaveLength(0)
  })
})
