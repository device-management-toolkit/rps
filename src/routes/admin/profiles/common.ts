/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { profileTlsSecretPath, type TenantId } from '../../../utils/secretPaths.js'

import {
  type AMTConfiguration,
  type AMTKeyUsage,
  AMTUserConsent,
  type CertAttributes,
  type TLSCerts
} from '../../../models/index.js'
import { NodeForge } from '../../../NodeForge.js'
import { type ISecretManagerService } from '../../../interfaces/ISecretManagerService.js'
import { CertManager } from '../../../certManager.js'
import Logger from '../../../Logger.js'
import { ClientAction, TlsSigningAuthority } from '../../../models/RCS.Config.js'

export function adjustTlsConfiguration(amtConfig: AMTConfiguration): AMTConfiguration {
  // default to self-signed if tls is indicated
  if (amtConfig.tlsMode) {
    if (!amtConfig.tlsSigningAuthority) {
      amtConfig.tlsSigningAuthority = TlsSigningAuthority.SELF_SIGNED
    }
  }

  // clear out authority if it shouldn't be there.
  if (!amtConfig.tlsMode && amtConfig.tlsSigningAuthority) {
    amtConfig.tlsSigningAuthority = null
  }
  return amtConfig
}

export function adjustRedirectionConfiguration(amtConfig: AMTConfiguration): AMTConfiguration {
  // sets to default AMT redirection configuration settings, incase the information is not given.
  if (amtConfig.userConsent == null) {
    if (amtConfig.activation === ClientAction.CLIENTCTLMODE) {
      amtConfig.userConsent = AMTUserConsent.ALL
    } else {
      amtConfig.userConsent = AMTUserConsent.KVM
    }
  }
  amtConfig.kvmEnabled = amtConfig.kvmEnabled ?? true
  amtConfig.solEnabled = amtConfig.solEnabled ?? false
  amtConfig.iderEnabled = amtConfig.iderEnabled ?? false
  return amtConfig
}

export async function generateSelfSignedCertificate(
  secretsManager: ISecretManagerService,
  profileName: string,
  tenantId: TenantId
): Promise<any> {
  // generate root certificate
  const cm = new CertManager(new Logger('CertManager'), new NodeForge())
  const certAttr: CertAttributes = {
    CN: `oact-${profileName}`,
    C: 'country',
    ST: 'state',
    O: 'Intel'
  }
  const rootCert = cm.createCertificate(certAttr)

  const issueAttr: CertAttributes = {
    CN: `oact-issued-${profileName}`,
    C: 'country',
    ST: 'state',
    O: 'Intel'
  }

  const keyUsages: AMTKeyUsage = {
    name: 'extKeyUsage',
    '2.16.840.1.113741.1.2.1': true,
    '2.16.840.1.113741.1.2.2': false,
    '2.16.840.1.113741.1.2.3': false,
    serverAuth: false,
    clientAuth: true,
    emailProtection: false,
    codeSigning: false,
    timeStamping: false
  }
  // gene
  const issuedCert = cm.createCertificate(issueAttr, rootCert.key, null, certAttr, keyUsages)

  const certs: TLSCerts = {
    ROOT_CERTIFICATE: rootCert,
    ISSUED_CERTIFICATE: issuedCert
  }

  return await secretsManager.writeSecretWithObject(profileTlsSecretPath(profileName, tenantId), certs)
}
