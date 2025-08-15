/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type ProfileProxyConfigs } from '../../models/RCS.Config.js'

export interface IProfileProxyConfigsTable {
  getProfileProxyConfigs: (profileName: string) => Promise<ProfileProxyConfigs[]>
  deleteProfileProxyConfigs: (profileName: string, tenantId: string) => Promise<boolean>
  createProfileProxyConfigs: (
    proxyConfigs: ProfileProxyConfigs[],
    profileName: string,
    tenantId?: string
  ) => Promise<boolean>
}
