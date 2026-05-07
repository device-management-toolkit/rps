/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type RPSConfig } from '../models/index.js'
import rc from 'rc'
import { parseValue } from './parseEnvValue.js'
import Logger from '../Logger.js'

const log = new Logger('Environment')

// To merge ENV variables. consider after lowercasing ENV since our config keys are lowercase
process.env = Object.keys(process.env).reduce((destination, key) => {
  const value = process.env[key] ?? ''
  destination[key.toLowerCase()] = parseValue(value)
  return destination
}, {})

// build config object
const config: RPSConfig = rc('rps')
config.delay_activation_sync = config.delay_timer * 1000
config.delay_setup_and_config_sync = 5000
config.delay_tls_put_data_sync = 5000
// TLS operations may take longer due to AMT reconfiguration (15+ seconds)
config.delay_tls_timer = config.delay_tls_timer ?? 15
// Generic WSMAN attempt budget (initial try + retries)
config.wsman_max_attempts = config.wsman_max_attempts ?? 3
// Post-provisioning: true when RPS owns the DMT root cert (AMT 19+, AMT ≤18 with --tls-tunnel)
config.amt_post_tls_reject = config.amt_post_tls_reject ?? false
// Generic compatibility mode for older AMT TLS implementations (legacy renegotiation/ciphers/protocol floor).
config.amt_legacy_tls_compatibility = config.amt_legacy_tls_compatibility ?? false
// When true, the TLS tunnel is reused across WSMAN calls (keep-alive). When false,
// the tunnel is torn down and re-established for every message (Connection: close).
config.amt_tls_tunnel_persistent = config.amt_tls_tunnel_persistent ?? true
log.silly(`config: ${JSON.stringify(config, null, 2)}`)

const Environment = {
  Config: config
}

export { Environment }
