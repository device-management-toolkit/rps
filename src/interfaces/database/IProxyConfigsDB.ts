/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProxyConfig } from '../../models/RCS.Config.js'
import { type ITable } from './ITable.js'

export interface IProxyConfigsTable extends ITable<ProxyConfig> {
  checkProfileExits: (configName: string, tenantId?: string) => Promise<boolean>
}
