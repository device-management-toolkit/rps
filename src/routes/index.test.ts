/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import express from 'express'
import router from './index.js'
import { request } from '../test/helper/http.js'

vi.mock('./admin/index.js', async () => {
  const { Router } = await import('express')
  return { default: Router().get('/', (_req, res) => res.json({ mounted: 'admin' })) }
})

describe('API router', () => {
  it('mounts the admin router under /admin', async () => {
    expect(await request(express().use('/api/v1', router), '/api/v1/admin')).toEqual({
      status: 200,
      body: { mounted: 'admin' }
    })
  })
})
