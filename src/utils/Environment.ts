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
// TLS operations may take longer due to AMT reconfiguration (30+ seconds)
config.delay_tls_timer = config.delay_tls_timer ?? 50
log.silly(`config: ${JSON.stringify(config, null, 2)}`)

const Environment = {
  Config: config
}

export { Environment }
