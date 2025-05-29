/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@device-management-toolkit/wsman-messages'
import { type DigestChallenge } from '@device-management-toolkit/wsman-messages/models/common.js'
import type Server from 'ws'
import { type AMTConfiguration, type AMTDomain, type ProvisioningCertObj } from './index.js'

export interface WebSocketConfig {
  WebSocketPort: number
}
export interface WirelessConfig {
  profileName: string
  authenticationMethod: number
  encryptionMethod: number
  ssid: string
  pskValue: number
  pskPassphrase: string
  linkPolicy: string[]
  tenantId: string
  ieee8021xProfileName: string
  ieee8021xProfileObject?: Ieee8021xConfig
  version?: string | null
}
export interface ProfileWifiConfigs {
  priority: number
  profileName: string
  tenantId: string
}

export interface Ieee8021xConfig {
  profileName: string
  authenticationProtocol: number
  serverName?: string
  domain?: string
  username?: string
  password?: string
  roamingIdentity?: string
  activeInS0?: boolean
  pxeTimeout: number
  wiredInterface: boolean
  tenantId: string
  version?: string | null
}

/*
- AddMpServer Method:

AccessInfo: IP or FQDN of MPS server(MaxLen 256)
Port (number)
Username (16 alphanumeric characters)
Password (16 characters)
CN (common name used when AccessInfo is IP address)

Additional information that we need to provide when configuring MPS:

- AddMpServer Method:

InfoFormat IPv4 (3), IPv6 (4), FQDN (201)
AuthMethod Mutual Auth (1), Username/Password (2) (We only support 2)
Certificate (Not required)
*/
export interface CIRAConfig {
  configName: string
  mpsServerAddress: string
  mpsPort: number
  username: string
  password?: string
  commonName: string
  serverAddressFormat: AMT.Types.MPServer.InfoFormat // IPv4 (3), IPv6 (4), FQDN (201)
  authMethod: AMT.Types.MPServer.AuthMethod // Mutual Auth (1), Username/Password (2) (We only support 2)
  mpsRootCertificate: string // Assumption is Root Cert for MPS. Need to validate.
  proxyDetails: string
  tenantId: string
  /** Flag to regenerate a random password when editing a cira config */
  regeneratePassword?: boolean
  version?: string
}

export interface RemoteConfig {
  Name: string
  Description: string
  WSConfiguration: WebSocketConfig
  AMTConfigurations: AMTConfiguration[]
  AMTDomains: AMTDomain[]
}

export interface Status {
  Status?: string
  Network?: string
  CIRAConnection?: string
  TLSConfiguration?: string
}
export interface ClientObject {
  ClientId: string
  action?: ClientAction
  uuid?: string
  hostname?: string
  ClientSocket: Server
  ClientData?: any
  count?: number
  payload?: any
  certObj?: ProvisioningCertObj | null
  readyState?: number
  activationStatus?: boolean
  delayEndTime?: number
  amtPassword: string | null
  mebxPassword?: string | null
  ciraconfig?: CIRAConfigFlow
  nonce?: Buffer
  signature?: string
  mpsUsername?: string
  mpsPassword?: string
  network?: NetworkConfigFlow
  tls: TLSConfigFlow
  status: Status
  unauthCount: number
  connectionParams: connectionParams
  messageId?: number
  trustedRootCertificate?: string
  trustedRootCertificateResponse?: any
  pendingPromise?: Promise<any>
  resolve: (value: unknown) => void
  reject: (value: unknown) => void
}

export interface CIRAConfigFlow {
  policyRuleUserInitiate?: boolean
  policyRuleAlert?: boolean
  policyRulePeriodic?: boolean
  mpsRemoteSAP?: boolean
  mpsRemoteSAPEnumerate?: boolean
  mpsRemoteSAPDelete?: boolean
  mpsRemoteSAPGet?: boolean
  mpsPublicCertDelete?: boolean
  publicCerts?: any
  privateCerts?: any
  addTrustedRootCert?: boolean
  addMPSServer?: boolean
  setMpsType?: boolean
  addRemoteAccessPolicyRule?: boolean
  userInitConnectionService?: boolean
  getENVSettingData?: boolean
  setENVSettingData?: boolean
  getENVSettingDataCIRA?: boolean
  setENVSettingDataCIRA?: boolean
  TLSSettingData?: any
}

export interface NetworkConfigFlow {
  getWiFiPortCapabilities?: boolean
  WiFiPortCapabilities?: any
  isWiFiConfigsDeleted?: boolean
  getGeneralSettings?: boolean
  setEthernetPortSettings?: boolean
  WirelessObj?: AMT.Models.EthernetPortSettings
  setWiFiPort?: boolean
  setWiFiPortResponse?: boolean
  getWiFiPortConfigurationService?: boolean
  count?: number
}

export interface TLSConfigFlow {
  getPublicKeyCertificate?: boolean
  addTrustedRootCert?: boolean
  createdTrustedRootCert?: boolean
  checkPublicKeyCertificate?: boolean
  confirmPublicKeyCertificate?: boolean
  getPublicPrivateKeyPair?: boolean
  generateKeyPair?: boolean
  generatedPublicPrivateKeyPair?: boolean
  createdPublicPrivateKeyPair?: boolean
  checkPublicPrivateKeyPair?: boolean
  confirmPublicPrivateKeyPair?: boolean
  addCert?: boolean
  getTLSSettingData?: boolean
  getTLSCredentialContext?: boolean
  PublicKeyCertificate?: any[]
  PublicPrivateKeyPair?: any[]
  TLSSettingData?: any
  TLSCredentialContext?: any
  setRemoteTLS?: boolean
  setLocalTLS?: boolean
  putRemoteTLS?: boolean
  putLocalTLS?: boolean
  addCredentialContext?: boolean
  resCredentialContext?: boolean
  commitRemoteTLS?: boolean
  commitLocalTLS?: boolean
  getTimeSynch?: boolean
  setTimeSynch?: boolean
}

export interface mpsServer {
  AccessInfo: any
  InfoFormat: number
  Port: number
  AuthMethod: number
  Username: string
  Password: string
  CommonName?: string
}

export interface ClientMsg {
  method: string
  apiKey: string
  appVersion: string
  protocolVersion?: string
  status: string
  message: string
  payload: any
  tenantId: string
}

export interface Payload {
  ver: string
  build: string
  modes?: any
  fqdn?: string
  digestRealm?: string
  fwNonce?: Buffer
  password?: string
  currentMode?: number
  hostname?: string
  certHashes?: string[]
  sku?: string
  uuid?: any
  username?: string
  client: string
  profile?: any
}

export interface ConnectionObject {
  socket: any
  state: number
  write?: any
  close?: any
  onStateChange?: any
}

export enum ClientAction {
  INVALID = 'invalid',
  ADMINCTLMODE = 'acmactivate',
  CLIENTCTLMODE = 'ccmactivate',
  DEACTIVATE = 'deactivate',
  CIRACONFIG = 'ciraconfig',
  NETWORKCONFIG = 'networkConfig',
  TLSCONFIG = 'tlsConfig',
  MAINTENANCE = 'maintenance'
}

export enum ClientMethods {
  INVALID = 'invalid',
  WSMAN = 'wsman',
  RESPONSE = 'response',
  ACTIVATION = 'activate',
  DEACTIVATION = 'deactivate',
  CIRACONFIG = 'ciraconfig',
  HEARTBEAT = 'heartbeat_response',
  MAINTENANCE = 'maintenance'
}

export interface apiResponse {
  data?: any
  error?: string
  message?: string
}

export interface HealthCheck {
  db: HealthCheckStatus
  secretStore: HealthCheckStatus
}
export interface HealthCheckStatus {
  name: string
  status: any
}

export enum TlsMode {
  INVALID = -1,
  NONE = 0,
  SERVER_ONLY = 1,
  SERVER_ALLOW_NONTLS = 2,
  MUTUAL_ONLY = 3,
  MUTUAL_ALLOW_NONTLS = 4
}

export enum TlsSigningAuthority {
  SELF_SIGNED = 'SelfSigned',
  MICROSOFT_CA = 'MicrosoftCA'
}

export interface connectionParams {
  port: number
  guid: string
  username: string
  password: string
  nonce?: string
  nonceCounter?: number
  consoleNonce?: string
  digestChallenge?: DigestChallenge
}
