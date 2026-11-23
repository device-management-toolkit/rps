/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { devices } from '../devices.js'
import { Environment } from '../utils/Environment.js'
import { config } from '../test/helper/Config.js'
import { GATEWAY_TIMEOUT_ERROR } from '../utils/constants.js'
import { invokeWsmanCall } from './common.js'
import { TLSTunnelManager } from '../TLSTunnelManager.js'

// Over the TLS tunnel, an HTTP error status from AMT (400 for a missing object, 401 digest
// challenge) is an answer, not a transport failure. Only transport failures may reset the tunnel.
const clientId = 'tunnel-reset-test'
let originalConfig: any

function tlsDevice(): void {
  devices[clientId] = {
    uuid: clientId,
    tlsEnforced: true,
    activationStatus: true,
    tls: { issuedCertPEM: 'synthetic-leaf' },
    ClientSocket: { send: vi.fn() },
    ClientData: { payload: { currentMode: 2 } },
    connectionParams: { port: 16993 },
    status: {}
  } as any
}

describe('TLS tunnel reset policy', () => {
  let connect: any
  let onData: any
  let send: any

  beforeEach(() => {
    originalConfig = Environment.Config
    Environment.Config = {
      ...config,
      amt_post_tls_reject: false,
      amt_tls_tunnel_persistent: true,
      wsman_max_attempts: 1,
      delay_tls_timer: 0
    }
    tlsDevice()
    connect = vi.spyOn(TLSTunnelManager.prototype, 'connect').mockResolvedValue(undefined)
    onData = vi.spyOn(TLSTunnelManager.prototype, 'onData').mockImplementation(() => {})
  })
  afterEach(() => {
    connect.mockRestore()
    onData.mockRestore()
    send?.mockRestore()
    Environment.Config = originalConfig
    delete devices[clientId]
  })

  it.each([
    400,
    401,
    500
  ])('keeps the tunnel when AMT answers HTTP %s', async (statusCode) => {
    send = vi.spyOn(TLSTunnelManager.prototype, 'send').mockImplementation(async () => {
      devices[clientId].reject({ statusCode, statusMessage: 'synthetic' })
    })
    await expect(
      invokeWsmanCall({ clientId, xmlMessage: 'synthetic', httpHandler: { wrapIt: () => 'synthetic' } })
    ).rejects.toMatchObject({ statusCode })
    expect(devices[clientId].tlsTunnelManager).toBeDefined()
    expect(devices[clientId].tlsTunnelNeedsReset).not.toBe(true)
  })

  it('resets the tunnel when no response arrives before the timeout', async () => {
    send = vi.spyOn(TLSTunnelManager.prototype, 'send').mockImplementation(async () => {})
    await expect(
      invokeWsmanCall({ clientId, xmlMessage: 'synthetic', httpHandler: { wrapIt: () => 'synthetic' } }, 0, 20)
    ).rejects.toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    expect(devices[clientId].tlsTunnelManager).toBeUndefined()
    expect(devices[clientId].tlsTunnelNeedsReset).toBe(true)
    expect(devices[clientId].amtReconfiguring).toBe(true)
  })
})
