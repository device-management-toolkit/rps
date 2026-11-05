/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import crypto from 'node:crypto'

/**
 * Diagnostics for the certificate chain an AMT device presents during the TLS handshake.
 * Everything here only describes the chain; none of it changes the accept/refuse decision.
 */

export interface ChainFinding {
  level: 'debug' | 'info' | 'warn'
  message: string
}

const LEAF_CN_UPID_DISABLED = 'AMT RCFG'
const LEAF_CN_UPID_ENABLED = 'iAMT CSME IDevID RCFG'
const ROM_CERT_INDEX = 3
const PRODUCTION_OU_PREFIXES = ['ODCA 2 CSME P', 'On Die CSME P']
// Accepted by rpc-go today, but without the trailing "P" they do not prove a production chain.
const NON_PRODUCTION_OU_PREFIXES = ['ODCA 2 CSME', 'On Die CSME']
const UPID_BINDING_PREFIX_LEN = 20

/** The chain is device-supplied and is logged before it is verified, so bound what a hostile device can emit. */
export const MAX_LOGGED_CERTIFICATES = 10
const MAX_LOGGED_VALUE_LENGTH = 200

/**
 * Makes a device-supplied string safe for a log line: control characters (newlines, carriage returns,
 * escape sequences) become "?", and long values are truncated.
 */
export function sanitizeForLog(value: string, maxLength = MAX_LOGGED_VALUE_LENGTH): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, '?')
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...(${cleaned.length - maxLength} more)` : cleaned
}

/** Splits the newline separated DN that node:crypto returns into attribute values. */
export function dnAttribute(dn: string, name: string): string[] {
  const prefix = `${name}=`
  return dn
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length))
}

function oneLine(dn: string): string {
  return sanitizeForLog(dn.replace(/\n/g, ', '))
}

function describeKey(cert: crypto.X509Certificate): string {
  const key = cert.publicKey
  const details = key.asymmetricKeyDetails
  const curve = details?.namedCurve
  const bits = details?.modulusLength
  const type = key.asymmetricKeyType ?? 'unknown'
  return curve != null ? `${type}/${curve}` : bits != null ? `${type}/${bits}` : type
}

function publicKeySha256(cert: crypto.X509Certificate): string {
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' })
  return crypto.createHash('sha256').update(spki).digest('hex')
}

/** One line per certificate: enough to identify it and to decide whether it matches a trust anchor. */
export function describeChain(chain: crypto.X509Certificate[]): string[] {
  const lines = chain.slice(0, MAX_LOGGED_CERTIFICATES).map((cert, i) => {
    const issuerKnown = i + 1 < chain.length
    let signedByNext = 'n/a (last certificate)'
    if (issuerKnown) {
      try {
        signedByNext = String(cert.verify(chain[i + 1].publicKey))
      } catch {
        signedByNext = 'error'
      }
    }
    const selfSigned = cert.subject === cert.issuer
    return (
      `chain[${i}]: subject=${oneLine(cert.subject)}; issuer=${oneLine(cert.issuer)}; serial=${sanitizeForLog(cert.serialNumber)}; ` +
      `valid=${sanitizeForLog(cert.validFrom)} to ${sanitizeForLog(cert.validTo)}; ca=${cert.ca}; selfSigned=${selfSigned}; ` +
      `key=${describeKey(cert)}; pubKeySha256=${publicKeySha256(cert)}; fp256=${cert.fingerprint256}; ` +
      `signedByChain[${i + 1}]=${signedByNext}`
    )
  })
  if (chain.length > MAX_LOGGED_CERTIFICATES) {
    lines.push(`${chain.length - MAX_LOGGED_CERTIFICATES} more certificate(s) not logged`)
  }
  return lines
}

/**
 * Intel UPID. With UPID enabled the leaf Common Name is "iAMT CSME IDevID RCFG" and the device's UPID
 * binds to the ROM ODCA certificate; without it the leaf is "AMT RCFG" and there is nothing to bind.
 * RPS is not given the UPID, so it can describe the mode and the value to bind, but cannot check it.
 */
export function checkUpid(chain: crypto.X509Certificate[]): ChainFinding[] {
  if (chain.length === 0) return []
  const leafCn = sanitizeForLog(dnAttribute(chain[0].subject, 'CN')[0] ?? '')
  const findings: ChainFinding[] = []

  if (leafCn === LEAF_CN_UPID_DISABLED) {
    findings.push({
      level: 'info',
      message: `Intel UPID not enabled (leaf CN="${leafCn}"): no UPID binding to check, trust rests on the chain and the ROM ODCA checks`
    })
  } else if (leafCn === LEAF_CN_UPID_ENABLED) {
    findings.push({
      level: 'info',
      message: `Intel UPID enabled (leaf CN="${leafCn}"): the device UPID must bind to the ROM ODCA certificate`
    })
    const rom = chain[ROM_CERT_INDEX]
    if (rom == null) {
      findings.push({
        level: 'warn',
        message: `UPID binding cannot be evaluated: chain has ${chain.length} certificate(s), no ROM ODCA certificate at chain[${ROM_CERT_INDEX}]`
      })
    } else {
      const hash = crypto.createHash('sha256').update(rom.raw).digest('hex')
      // The UPID is a platform identifier, so the value to bind is debug only.
      findings.push({
        level: 'debug',
        message:
          `UPID binding not verified by RPS (UPID is not sent to RPS); expected UPID HWSerialNum prefix ` +
          `(first ${UPID_BINDING_PREFIX_LEN} bytes of SHA-256 of chain[${ROM_CERT_INDEX}]) = ${hash.slice(0, UPID_BINDING_PREFIX_LEN * 2)}`
      })
    }
  } else {
    findings.push({
      level: 'warn',
      message: `leaf CN="${leafCn}" is neither "${LEAF_CN_UPID_DISABLED}" (UPID off) nor "${LEAF_CN_UPID_ENABLED}" (UPID on): cannot tell the UPID mode`
    })
  }
  return findings
}

/**
 * Production check from Intel's "Verifying the ODCA Certificate Chain": the ROM ODCA certificate is the 4th
 * certificate, its Common Name contains "ROM CA", and the OU of its Issuer starts with "ODCA 2 CSME P" or
 * "On Die CSME P", where P means Production.
 */
export function checkProductionRomCertificate(chain: crypto.X509Certificate[]): ChainFinding[] {
  const rom = chain[ROM_CERT_INDEX]
  if (rom == null) {
    return [
      {
        level: 'warn',
        message: `Production check not possible: chain has ${chain.length} certificate(s), there is no 4th (ROM ODCA) certificate`
      }
    ]
  }

  const cn = sanitizeForLog(dnAttribute(rom.subject, 'CN')[0] ?? '')
  const issuerOus = dnAttribute(rom.issuer, 'OU').map((ou) => sanitizeForLog(ou))
  if (!cn.includes('ROM CA')) {
    return [
      {
        level: 'warn',
        message: `Production check: chain[${ROM_CERT_INDEX}] CN="${cn}" does not contain "ROM CA", so it is not the CSME ROM ODCA certificate`
      }
    ]
  }

  const produced = issuerOus.find((ou) => PRODUCTION_OU_PREFIXES.some((p) => ou.startsWith(p)))
  if (produced != null) {
    return [
      {
        level: 'info',
        message: `Production check passed: ROM ODCA chain[${ROM_CERT_INDEX}] CN="${cn}", issuer OU="${produced}"`
      }
    ]
  }

  const nonProduction = issuerOus.find((ou) => NON_PRODUCTION_OU_PREFIXES.some((p) => ou.startsWith(p)))
  return [
    {
      level: 'warn',
      message:
        nonProduction != null
          ? `Production check FAILED: ROM ODCA chain[${ROM_CERT_INDEX}] issuer OU="${nonProduction}" has no production "P" suffix (engineering or debug chain)`
          : `Production check FAILED: ROM ODCA chain[${ROM_CERT_INDEX}] issuer OU=${JSON.stringify(issuerOus)} starts with neither "ODCA 2 CSME P" nor "On Die CSME P"`
    }
  ]
}
