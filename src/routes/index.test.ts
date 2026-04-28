/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import router from './index.js'

describe('Check index from admin', () => {
  const routes: any = [
    // { path: '/', method: 'get' }
  ]

  it('should have routes', () => {
    routes.forEach((route) => {
      const match = router.stack.find((s) => s.route?.path === route.path && s.route?.methods[route.method])
      expect(match).toBeTruthy()
    })
  })
  const routers = [
    { path: '/admin', method: 'use' }
  ]

  it('should have routers', () => {
    routers.forEach((route) => {
      const match = router.stack.find((s) => {
        const isPathMatched = (s.regexp as RegExp).exec(route.path)
        if (isPathMatched != null) {
          return isPathMatched.length > 0 && s.path == null
        }
        return false
      })
      expect(match).toBeTruthy()
    })
  })
})
