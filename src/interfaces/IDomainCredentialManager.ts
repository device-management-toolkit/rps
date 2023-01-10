/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMTDomain } from '../models'

export interface IDomainCredentialManager {
  getProvisioningCert: (domainSuffix: string) => Promise<AMTDomain>
  doesDomainExist: (domainSuffix: string) => Promise<boolean>
}
