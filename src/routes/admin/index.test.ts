/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import express from 'express'
import router from './index.js'
import { request } from '../../test/helper/http.js'

const { childRouter } = vi.hoisted(() => ({
  childRouter: async () => {
    const { Router } = await import('express')
    return { default: Router().get('/', (req, res) => res.json({ mounted: req.baseUrl })) }
  }
}))

vi.mock('./domains/index.js', () => childRouter())
vi.mock('./profiles/index.js', () => childRouter())
vi.mock('./ciraconfig/index.js', () => childRouter())
vi.mock('./wireless/index.js', () => childRouter())
vi.mock('./ieee8021x/index.js', () => childRouter())
vi.mock('./version/index.js', () => childRouter())
vi.mock('./health/index.js', () => childRouter())
vi.mock('./proxy/index.js', () => childRouter())

describe('Admin router', () => {
  it('serves the admin index', async () => {
    expect(await request(express().use(router), '/')).toEqual({
      status: 200,
      body: { message: 'admin path. use admin/profiles' }
    })
  })

  it.each([
    'domains',
    'profiles',
    'ciraconfigs',
    'wirelessconfigs',
    'ieee8021xconfigs',
    'version',
    'health',
    'proxyconfigs'
  ])('mounts /%s', async (path) => {
    expect(await request(express().use(router), `/${path}`)).toEqual({
      status: 200,
      body: { mounted: `/${path}` }
    })
  })
})
