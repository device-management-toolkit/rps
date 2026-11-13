/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'
import { type AMT } from '@device-management-toolkit/wsman-messages'
import { type AMTConfiguration } from '../models/index.js'
import { type TLSConfigFlow, TlsMode, TlsSigningAuthority } from '../models/RCS.Config.js'
import { ensurePemCertificate } from '../utils/certHelpers.js'

const remoteTlsSettingName = 'Intel(r) AMT 802.3 TLS Settings'
const localTlsSettingName = 'Intel(r) AMT LMS TLS Settings'

const renewalWindowMs = 30 * 24 * 60 * 60 * 1000
const enabled = (value: unknown): boolean => value === true || value === 'true'
const disabled = (value: unknown): boolean => value === false || value === 'false'

/** Conservative reuse policy for the DMT-generated, MPS-signed server identity. */
export function canReuseTlsIdentity(
  profile: AMTConfiguration,
  settings: AMT.Models.TLSSettingData[],
  certificate: string,
  root: string,
  hostname: string,
  now = Date.now()
): boolean {
  try {
    if (
      profile.tlsCerts != null ||
      (profile.tlsSigningAuthority != null && profile.tlsSigningAuthority !== TlsSigningAuthority.SELF_SIGNED) ||
      profile.ieee8021xProfileName != null ||
      (profile.wifiConfigs?.length ?? 0) > 0
    ) {
      return false
    }
    if (profile.tlsMode != null && ![
        TlsMode.NONE,
        TlsMode.SERVER_ONLY,
        TlsMode.SERVER_ALLOW_NONTLS,
        TlsMode.MUTUAL_ONLY,
        TlsMode.MUTUAL_ALLOW_NONTLS
      ].includes(profile.tlsMode)) return false
    const remote = settings.find((entry) => entry.ElementName === remoteTlsSettingName)
    const local = settings.find((entry) => entry.ElementName === localTlsSettingName)
    if (!remote || !local || !enabled(remote.Enabled) || !enabled(local.Enabled)) return false
    const mutual = profile.tlsMode === TlsMode.MUTUAL_ONLY || profile.tlsMode === TlsMode.MUTUAL_ALLOW_NONTLS
    if (mutual ? !enabled(remote.MutualAuthentication) : !disabled(remote.MutualAuthentication)) return false
    const acceptNonSecure = profile.tlsMode !== TlsMode.SERVER_ONLY && profile.tlsMode !== TlsMode.MUTUAL_ONLY
    if (!disabled(remote.NonSecureConnectionsSupported)) {
      if (
        acceptNonSecure ? !enabled(remote.AcceptNonSecureConnections) : !disabled(remote.AcceptNonSecureConnections)
      ) {
        return false
      }
    }
    // Mutual TLS has additional trust/opt-in requirements; retain full provisioning for now.
    if (mutual) return false
    const leaf = new crypto.X509Certificate(ensurePemCertificate(certificate))
    const ca = new crypto.X509Certificate(ensurePemCertificate(root))
    if (leaf.ca || !ca.ca || !leaf.verify(ca.publicKey)) return false
    if (!leaf.subject.split('\n').includes(`CN=AMT-${hostname}`)) return false
    if (!leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1')) return false
    for (const cert of [leaf, ca]) {
      if (Date.parse(cert.validFrom) > now || Date.parse(cert.validTo) <= now + renewalWindowMs) return false
    }
    return true
  } catch {
    return false
  }
}

/** A validated retained leaf is managed identity, but is not a newly issued leaf. */
export function getTlsTrustMaterial(tls?: TLSConfigFlow): {
  hasManagedIdentity: boolean
  hasRetainedIdentity: boolean
  caCert?: string
} {
  const leaf = tls?.issuedCertPEM || tls?.validatedCertPEM
  return {
    hasManagedIdentity: Boolean(leaf),
    hasRetainedIdentity: Boolean(tls?.validatedCertPEM),
    caCert: tls?.mpsRootCertPEM ?? leaf
  }
}
