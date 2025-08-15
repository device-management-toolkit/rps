/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ICiraConfigTable } from './ICiraConfigDb.js'
import { type IDomainsTable } from './IDomainsDb.js'
import { type IIEEE8021xProfileTable } from './IIEEE8021xProfilesDB.js'
import { type IProfilesTable } from './IProfilesDb.js'
import { type IProfilesWifiConfigsTable } from './IProfileWifiConfigsDb.js'
import { type IWirelessProfilesTable } from './IWirelessProfilesDB.js'
import { type IProfileProxyConfigsTable } from './IProfileProxyConfigsDb.js'
import { type IProxyConfigsTable } from './IProxyConfigsDB.js'

export interface IDB {
  ciraConfigs: ICiraConfigTable
  domains: IDomainsTable
  profiles: IProfilesTable
  wirelessProfiles: IWirelessProfilesTable
  profileWirelessConfigs: IProfilesWifiConfigsTable
  ieee8021xProfiles: IIEEE8021xProfileTable
  proxyConfigs: IProxyConfigsTable
  profileProxyConfigs: IProfileProxyConfigsTable

  query: (text: string, params?: any) => Promise<any>
}
