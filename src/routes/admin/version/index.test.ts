/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import router from './index.js'

describe('Check index from routes/version', () => {
  const routes = [
    { path: '/', method: 'get' }
  ]
  it('should have routes', () => {
    routes.forEach((route) => {
      const match = router.stack.find((s) => s.route?.path === route.path && s.route?.methods[route.method])
      expect(match).toBeTruthy()
    })
  })
})
