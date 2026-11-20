/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type HttpHandler } from '../HttpHandler.js'
import { type ISecretManagerService, type TLSProvisioningJournal } from '../interfaces/ISecretManagerService.js'
import { ensurePemCertificate, parseX509Certificate } from '../utils/certHelpers.js'

export const certificateIdentity = (pem: string): string => parseX509Certificate(pem).fingerprint256

export async function readJournal(secrets: ISecretManagerService, uuid: string): Promise<TLSProvisioningJournal> {
  const stored = await secrets.getSecretAtPath(`tls-provisioning/${uuid.toLowerCase()}`)
  if (stored == null) return { certificates: [] }
  if (!('certificates' in stored) || !Array.isArray(stored.certificates)) {
    throw new Error('Invalid TLS provisioning journal')
  }
  stored.certificates.forEach(certificateIdentity)
  return stored
}

export async function writeJournal(
  secrets: ISecretManagerService,
  uuid: string,
  journal: TLSProvisioningJournal,
  certificates: string[],
  handler?: HttpHandler
): Promise<void> {
  const cas = journal.version == null ? 0 : Number(journal.version)
  if (!Number.isSafeInteger(cas) || cas < 0) throw new Error('Invalid TLS journal version')
  if (!secrets.writeSecretWithObjectIfVersion) throw new Error('Conditional TLS ownership writes are unavailable')
  const write = async (): Promise<any> =>
    await secrets.writeSecretWithObjectIfVersion!(`tls-provisioning/${uuid.toLowerCase()}`, { certificates }, cas)
  const result = handler?.trackProvisioningWrite ? await handler.trackProvisioningWrite(write) : await write()
  if (result == null) throw new Error('Failed to persist TLS provisioning journal')
}

// Persist the exact signed leaf before AddCertificate. A lost response or process
// exit after AMT installs it can then be reconciled without relying on handles.
export async function recordCertificate(
  secrets: ISecretManagerService,
  uuid: string,
  pem: string,
  handler?: HttpHandler
): Promise<void> {
  if (!uuid) throw new Error('Missing device UUID for TLS provisioning journal')
  if (!secrets.writeSecretWithObjectIfVersion) return
  const journal = await readJournal(secrets, uuid)
  const fingerprint = certificateIdentity(pem)
  if (!journal.certificates.some((cert) => certificateIdentity(cert) === fingerprint)) {
    await writeJournal(secrets, uuid, journal, [...journal.certificates, ensurePemCertificate(pem)], handler)
  }
}
