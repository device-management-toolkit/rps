/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type pki } from 'node-forge'
import {
  type Ieee8021xConfig,
  type CIRAConfig,
  type ProfileWifiConfigs,
  type TlsMode,
  type TlsSigningAuthority,
  type ProfileProxyConfigs
} from './RCS.Config.js'

// guid: string, name: string, mpsuser: string, mpspass: string, amtuser: string, amtpassword: string, mebxpass: string) {
export interface AMTDeviceDTO {
  guid: string
  name?: string
  mpsuser?: string
  mpspass?: string
  amtuser?: string
  amtpass?: string
  mebxpass?: string
}
export interface ProvisioningCertObj {
  certChain: string[]
  privateKey: pki.PrivateKey
}
export interface AMTKeyUsage {
  /** Extension ID  */
  name: string
  /** Enables Console Usage */
  ['2.16.840.1.113741.1.2.1']: boolean
  /** Enables Agent Usage */
  ['2.16.840.1.113741.1.2.2']: boolean
  /** Enables AMT Activation Usage */
  ['2.16.840.1.113741.1.2.3']: boolean
  /** Enables TLS Usage on the Server */
  serverAuth: boolean
  /** Enables TLS Usage on the Client */
  clientAuth: boolean
  /** Enables Email Protection */
  emailProtection: boolean
  /** Enables Code Signing */
  codeSigning: boolean
  /** Enables Time Stamping */
  timeStamping: boolean
}

export interface CertAttributes {
  CN: string
  O?: string
  ST?: string
  C?: string
}

export interface RootCertFingerprint {
  sha1: string
  sha256: string
}

export interface CertCreationResult {
  h: any
  cert: pki.Certificate
  pem: string
  certbin: string
  privateKey: string
  privateKeyBin?: string | null
  checked: boolean
  key: pki.PrivateKey | null
}
export interface CertsAndKeys {
  certs: pki.Certificate[]
  keys: pki.PrivateKey[]
}
export interface CertificateObject {
  pem: string
  issuer: string
  subject: string
}

export interface RPSConfig {
  vault_token: string
  vault_address: string
  consul_enabled: boolean
  consul_host: string
  consul_port: string
  consul_key_prefix: string
  secrets_path: string
  websocketport: number // no underlines to avoid breaking change
  web_port: number
  secrets_provider: string
  db_provider: string
  connection_string: string
  postgres_ssl_ca?: string
  postgres_ssl_cert?: string
  postgres_ssl_key?: string
  postgres_ssl_reject_unauthorized?: boolean
  cors_origin: string
  cors_headers: string
  cors_methods: string
  mps_server: string
  delay_timer: number
  delay_activation_sync: number
  delay_setup_and_config_sync: number
  delay_tls_put_data_sync: number
  mqtt_address?: string
  disable_cira_domain_name?: string
  enterprise_assistant_url?: string
  jwt_token_header: string
  jwt_tenant_property: string
}
export enum AMTRedirectionServiceEnabledStates {
  DISABLED = 32768,
  ONLY_IDER = 32769,
  ONLY_SOL = 32770,
  BOTH_IDER_SOL = 32771
}
export enum AMTUserConsent {
  NONE = 'None',
  ALL = 'All',
  KVM = 'KVM'
}
export enum AMTUserConsentValues {
  NONE = 0,
  KVM = 1,
  ALL = 4294967295
}
export function mapAMTUserConsent(e: AMTUserConsent): AMTUserConsentValues {
  switch (e) {
    case AMTUserConsent.ALL:
      return AMTUserConsentValues.ALL
    case AMTUserConsent.KVM:
      return AMTUserConsentValues.KVM
    case AMTUserConsent.NONE:
      return AMTUserConsentValues.NONE
  }
}
export enum AMTUserConsentWsmanValues {
  NONE = 'None',
  ALL = 'All',
  KVM = 'KVM'
}
export class AMTConfiguration {
  profileName: string
  amtPassword?: string | null
  generateRandomPassword?: boolean
  ciraConfigName: string
  activation: string
  mebxPassword?: string | null
  generateRandomMEBxPassword?: boolean
  ciraConfigObject?: CIRAConfig | null
  tags?: string[]
  dhcpEnabled?: boolean
  ipSyncEnabled?: boolean
  localWifiSyncEnabled?: boolean
  wifiConfigs?: ProfileWifiConfigs[] | null
  proxyConfigs?: ProfileProxyConfigs[] | null
  tenantId: string
  tlsMode?: TlsMode
  tlsCerts?: TLSCerts
  tlsSigningAuthority?: TlsSigningAuthority | null
  userConsent?: AMTUserConsent | null
  iderEnabled?: boolean
  kvmEnabled?: boolean
  solEnabled?: boolean
  ieee8021xProfileName?: string
  ieee8021xProfileObject?: Ieee8021xConfig | null
  version?: string
}

export interface TLSCerts {
  ROOT_CERTIFICATE: CertCreationResult
  ISSUED_CERTIFICATE: CertCreationResult
  version?: string
}

export class DataWithCount {
  data: any[]
  totalCount: number
}

export class AMTDomain {
  profileName: string
  domainSuffix: string
  provisioningCert?: string
  provisioningCertStorageFormat: string
  provisioningCertPassword?: string
  expirationDate: Date
  tenantId: string
  version?: string
}

export class WSMessage {
  version: number
  status: string
  data?: any
  errorText?: string
  constructor(version: number, status: string, data?: any, errorText?: string) {
    this.version = version
    this.status = status
    this.data = data
    this.errorText = errorText
  }
}

export class RCSMessage extends WSMessage {
  certs: string[]
  action: string
  nonce: string
  signature: string
  profileScript: string
  password: string
  constructor(
    version: number,
    status: string,
    certs: string[],
    action: string,
    nonce: string,
    signature: string,
    profileScript: string,
    password: string,
    data?: any,
    errorText?: string
  ) {
    super(version, status, data, errorText)
    this.certs = certs
    this.action = action
    this.nonce = nonce
    this.signature = signature
    this.profileScript = profileScript
    this.password = password
  }
}
export class RcsObj {
  constructor(
    public action?: string,
    public certs?: string[],
    public nonce?: string,
    public signature?: string,
    public password?: string,
    public profileScript?: string,
    public errorText?: string
  ) {}
}
export class Client {
  constructor(
    public client?: string,
    public dnsSuffix?: string,
    public digestRealm?: string,
    public fwNonce?: Buffer,
    public amtGuid?: string,
    public profile?: string,
    public certHashes?: string[],
    public amtVersion?: string,
    public availableModes?: number[],
    public currentMode?: number,
    public tag?: string
  ) {}
}

export class Version {
  major: number
  minor: number
  revision: number

  constructor() {
    this.major = 0
    this.minor = 0
    this.revision = 0
  }
}

export type eventType = 'request' | 'success' | 'fail'

export interface OpenAMTEvent {
  type: eventType
  message: string
  methods: string[]
  guid?: string
  timestamp: number
}

// Export-specific interfaces for profile export functionality
export interface ExportWifiConfig {
  profileName: string
  ssid: string
  priority: number
  authenticationMethod: number
  encryptionMethod: number
  pskPassphrase: string
  ieee8021xProfileName: string
}

export interface ExportConfiguration {
  id: number
  name: string
  configuration: {
    generalSettings: {
      sharedFQDN: boolean
      networkInterfaceEnabled: number
      pingResponseEnabled: boolean
    }
    network: {
      wired: {
        dhcpEnabled: boolean
        ipSyncEnabled: boolean
        sharedStaticIP: boolean
        ipAddress: string
        subnetMask: string
        defaultGateway: string
        primaryDNS: string
        secondaryDNS: string
        authentication: string
        ieee8021x: Ieee8021xConfig | null
      }
      wireless: {
        wifiSyncEnabled: boolean
        profiles: ExportWifiConfig[]
      }
    }
    tls: {
      mutualAuthentication: boolean
      enabled: boolean
      trustedCN: string[]
      allowNonTLS: boolean
    }
    redirection: {
      enabled: boolean
      services: {
        kvm: boolean
        sol: boolean
        ider: boolean
      }
      userConsent: string
    }
    userAccounts: {
      userAccounts: any[]
    }
    enterpriseAssistant: {
      url: string
      username: string
      password: string
    }
    amtSpecific: {
      controlMode: string
      adminPassword: string
      provisioningCert: string
      provisioningCertPwd: string
      mebxPassword: string
    }
    bmcSpecific: {
      adminPassword: string
    }
    dashSpecific: {
      adminPassword: string
    }
    redfishSpecific: {
      adminPassword: string
    }
  }
}
