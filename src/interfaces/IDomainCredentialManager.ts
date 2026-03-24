/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMTDomain } from '../models/index.js'

export interface IDomainCredentialManager {
  getProvisioningCert: (domainSuffix: string, tenantId: string) => Promise<AMTDomain | null>
  doesDomainExist: (domainSuffix: string, tenantId: string) => Promise<AMTDomain | null>
}
