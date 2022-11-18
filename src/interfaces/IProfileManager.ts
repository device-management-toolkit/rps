/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMTConfiguration } from '../models'
import { CIRAConfig } from '../models/RCS.Config'

export interface IProfileManager {
  getActivationMode: (profileName: string) => Promise<string>
  getCiraConfiguration: (profileName: string) => Promise<CIRAConfig>
  getAmtPassword: (profileName: string) => Promise<string>
  doesProfileExist: (profileName: string) => Promise<boolean>
  getAmtProfile: (profileName: string) => Promise<AMTConfiguration>
  getMEBxPassword: (profileName: string) => Promise<string>
  getMPSPassword: (profileName: string) => Promise<string>
}
