import { X509Certificate } from 'node:crypto'

/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Shared helpers for certificate string handling.
 *
 * Several code paths (TLS tunnel setup, activation state machine, TLS state
 * machine) receive certificates that may arrive as either a PEM-encoded
 * string (with `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`
 * markers) or as a raw base64-encoded DER blob (as returned by AMT WS-Man
 * responses, or as stored alongside config in postgres). This module
 * provides a single normalization routine used by all of them.
 */

const PEM_BEGIN = '-----BEGIN CERTIFICATE-----'
const PEM_END = '-----END CERTIFICATE-----'

/**
 * Normalizes a certificate string to PEM format.
 *
 * - If the input already contains a PEM `-----BEGIN CERTIFICATE-----`
 *   marker, it is returned unchanged.
 * - Otherwise the input is treated as a raw base64-encoded DER blob:
 *   whitespace is stripped, the body is wrapped at 64 characters per line,
 *   and PEM header/footer markers are added.
 *
 * The output matches the previous inline copies of this logic in
 * TLSTunnelManager (`toCaPem`), activation.ts (`normalizeCertificatePem`
 * and `stashActiveTlsRootCa`), and tls.ts for all realistic inputs.
 */
export function ensurePemCertificate(input: string): string {
  if (input.includes(PEM_BEGIN)) {
    return input
  }
  const clean = input.replace(/\s+/g, '')
  const lines = clean.match(/.{1,64}/g) ?? []
  return `${PEM_BEGIN}\n${lines.join('\n')}\n${PEM_END}`
}

/** Accept the wrapped PEM, single-line PEM and base64 DER encodings used by RPS and AMT. */
export function parseX509Certificate(certData: string): X509Certificate {
  const pemMatch = certData.match(/-----BEGIN CERTIFICATE-----([^-]+)-----END CERTIFICATE-----/)
  const base64 = pemMatch != null ? pemMatch[1].replace(/\s+/g, '') : certData
  return new X509Certificate(Buffer.from(base64, 'base64'))
}
