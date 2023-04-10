/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import router from './index'

describe('Check index from admin', () => {
  const routes = [
    { path: '/', method: 'get' }
  ]
  it('should have routes', () => {
    routes.forEach((route) => {
      const match = router.stack.find(
        (s) => s.route?.path === route.path && s.route?.methods[route.method]
      )
      expect(match).toBeTruthy()
    })
  })
  const routers = [
    { path: '/domains', method: 'use' },
    { path: '/profiles', method: 'use' },
    { path: '/ciraconfigs', method: 'use' },
    { path: '/wirelessconfigs', method: 'use' },
    { path: '/ieee8021xconfigs', method: 'use' },
    { path: '/version', method: 'use' },
    { path: '/health', method: 'use' }]

  it('should have routers', () => {
    routers.forEach((route) => {
      const match = router.stack.find(
        (s) => (s?.regexp as RegExp).exec(route.path)?.length > 0 && s.path == null
      )
      expect(match).toBeTruthy()
    })
  })
})
