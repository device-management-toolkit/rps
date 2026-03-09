/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type CertCreationResult } from '../models/index.js'

export interface DeviceCredentials {
  AMT_PASSWORD: string | null
  MPS_PASSWORD?: string // only required for CIRA
  MEBX_PASSWORD?: string | null
  TLS_ROOT_CERTIFICATE?: string
  TLS_ISSUED_CERTIFICATE?: string
  version?: string
}

export interface WifiCredentials {
  PSK_PASSPHRASE: string
  version?: string
}

export interface TLSCredentials {
  ISSUED_CERTIFICATE: CertCreationResult
  ROOT_CERTIFICATE: CertCreationResult
  version?: string
}

export interface CiraConfigSecrets {
  MPS_PASSWORD: string
}

// these credentials refer to the domain provisioning cert
export interface CertCredentials {
  CERT: string
  CERT_PASSWORD: string
  version?: string
}

export interface ISecretManagerService {
  getSecretFromKey: (path: string, key: string) => Promise<string | null>
  getSecretAtPath: (
    path: string
  ) => Promise<DeviceCredentials | WifiCredentials | TLSCredentials | CertCredentials | CiraConfigSecrets | null>
  writeSecretWithObject: (
    path: string,
    data: DeviceCredentials | WifiCredentials | TLSCredentials | CertCredentials | CiraConfigSecrets
  ) => Promise<any>
  deleteSecretAtPath: (path: string) => Promise<boolean>
  health: () => Promise<any>
}
