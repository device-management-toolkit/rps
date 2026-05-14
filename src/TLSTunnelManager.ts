/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import tls from 'node:tls'
import crypto from 'node:crypto'
import { Duplex } from 'node:stream'
import type Server from 'ws'
import ClientResponseMsg from './utils/ClientResponseMsg.js'
import { AMT_ODCA_ROOT_CERTS } from './certs/amt-odca.js'
import Logger from './Logger.js'
import { ensurePemCertificate } from './utils/certHelpers.js'

const logger = new Logger('TLSTunnelManager')

let sessionCounter = 0

interface TLSTunnelOptions {
  allowPostCcmTransitionSelfSigned?: boolean
}

export class TLSTunnelManager {
  private clientSocket: Server
  private clientId: string
  private rejectUnauthorized: boolean
  private legacyTlsCompatibility: boolean
  private caCerts: string | undefined
  private tlsSocket: tls.TLSSocket | null = null
  private duplexStream: Duplex
  private connected = false
  private handshakeStarted = false
  private pendingData: Buffer[] = []
  private sessionId: string
  private intentionalClose = false
  private writeBuffer: Buffer[] = []
  private flushPending = false
  private peerChainDer: Buffer[] = []
  private allowPostCcmTransitionSelfSigned: boolean

  constructor(
    clientSocket: Server,
    clientId: string,
    rejectUnauthorized: boolean,
    legacyTlsCompatibility = false,
    caCerts?: string,
    options?: TLSTunnelOptions
  ) {
    this.clientSocket = clientSocket
    this.clientId = clientId
    this.rejectUnauthorized = rejectUnauthorized
    this.legacyTlsCompatibility = legacyTlsCompatibility
    this.caCerts = caCerts
    this.allowPostCcmTransitionSelfSigned = options?.allowPostCcmTransitionSelfSigned === true
    this.sessionId = `${clientId}-${++sessionCounter}-${Date.now()}`
    this.duplexStream = this.createWebSocketDuplex()
  }

  getSessionId(): string {
    return this.sessionId
  }

  private getLegacyServerConnectFlag(): number | undefined {
    return (crypto.constants as unknown as { SSL_OP_LEGACY_SERVER_CONNECT?: number }).SSL_OP_LEGACY_SERVER_CONNECT
  }

  private applyLegacyTlsCompatibility(tlsOptions: tls.ConnectionOptions): void {
    // Keep support for newer protocol versions while allowing older AMT stacks to negotiate TLS 1.1.
    tlsOptions.minVersion = 'TLSv1.1'

    // OpenSSL SECLEVEL=0 relaxes minimum policy checks for legacy certificates/ciphers.
    // It does not force a weak cipher; the negotiated cipher is still the best mutually supported option.
    tlsOptions.ciphers = 'DEFAULT:@SECLEVEL=0'
    logger.warn('TLS connect: enabling legacy AMT TLS compatibility profile (TLSv1.1+/SECLEVEL=0)')

    const legacyFlag = this.getLegacyServerConnectFlag()
    if (typeof legacyFlag === 'number') {
      // Needed for older AMT TLS stacks that still request legacy renegotiation.
      const existingSecureOptions = typeof tlsOptions.secureOptions === 'number' ? tlsOptions.secureOptions : 0
      tlsOptions.secureOptions = existingSecureOptions | legacyFlag
    } else {
      logger.warn('TLS connect: SSL_OP_LEGACY_SERVER_CONNECT is unavailable in this runtime')
    }
  }

  private logNegotiatedTLSDetails(): void {
    if (this.tlsSocket == null) {
      return
    }

    const protocol = this.tlsSocket.getProtocol() ?? 'unknown'
    const cipher = this.tlsSocket.getCipher?.()
    const cipherInfo = cipher != null ? `, cipher=${cipher.name} (${cipher.version})` : ''
    logger.info(`TLS connected: protocol=${protocol}${cipherInfo}, session=${this.sessionId}`)
  }

  private createWebSocketDuplex(): Duplex {
    return new Duplex({
      read: (): void => {},
      write: (chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void => {
        // Buffer the chunk - will be flushed after TLS write completes
        this.writeBuffer.push(Buffer.from(chunk))

        // Schedule flush on next tick to collect all TLS record fragments
        if (!this.flushPending) {
          this.flushPending = true
          setImmediate(() => {
            this.flushWriteBuffer()
          })
        }
        callback(null)
      }
    })
  }

  private flushWriteBuffer(): void {
    this.flushPending = false
    if (this.writeBuffer.length === 0) {
      return
    }

    // Combine all buffered chunks into a single message
    const combined = Buffer.concat(this.writeBuffer)
    this.writeBuffer = []

    const base64Data = combined.toString('base64')
    const msg = ClientResponseMsg.get(this.clientId, base64Data, 'tls_data', 'ok')
    try {
      this.clientSocket.send(JSON.stringify(msg), (err?: Error) => {
        if (err) {
          logger.error(`Flush failed: ${err.message}`)
        }
      })
    } catch (err) {
      logger.error(`Flush exception: ${(err as Error).message}`)
    }
  }

  injectData(data: Buffer): void {
    // Parse TLS record type
    let contentType = -1
    if (data.length >= 5) {
      contentType = data[0]
    }

    // Discard stale Application Data (0x17) received before handshake completes
    if (!this.connected && contentType === 0x17) {
      return
    }

    // Capture server certificates from TLS Handshake Certificate message (type 0x0b)
    // before OpenSSL processes them, so we can diagnose verification failures
    if (!this.connected && contentType === 0x16 && data.length > 5) {
      this.extractHandshakeCerts(data)
    }

    if (this.handshakeStarted) {
      this.duplexStream.push(data)
    } else {
      this.pendingData.push(data)
    }
  }

  /**
   * Attempts to extract certificate bytes from a TLS message, handling
   * both standard handshake records and fragmented data.
   */
  private findCertificateInTlsData(data: Buffer): Buffer[] {
    const certs: Buffer[] = []

    // Try to find Certificate handshake message (type 0x0b) at various positions
    for (let i = 0; i < data.length - 8; i++) {
      if (data[i] === 0x0b) {
        // Found potential Certificate message at offset i
        // Next 3 bytes are the length of the message
        const msgLen = (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]
        if (i + msgLen + 4 > data.length) continue // Message extends beyond buffer

        // Next 3 bytes are the cert_list_length
        const certsLen = (data[i + 4] << 16) | (data[i + 5] << 8) | data[i + 6]
        let offset = i + 7
        let certIndex = 0

        // Extract all certificates from the list
        while (offset + 3 < i + 4 + msgLen && certIndex < 10) {
          const certLen = (data[offset] << 16) | (data[offset + 1] << 8) | data[offset + 2]
          offset += 3
          if (offset + certLen > data.length) break
          certs.push(data.subarray(offset, offset + certLen))
          offset += certLen
          certIndex++
        }
        if (certs.length > 0) break
      }
    }
    return certs
  }

  /**
   * Parses raw TLS Handshake record to extract Certificate messages.
   * TLS record: [type 1B][version 2B][length 2B][handshake...]
   * Handshake Certificate: [type=0x0b 1B][length 3B][certs_length 3B][cert entries...]
   * Each cert entry: [cert_length 3B][DER cert data...]
   */
  private extractHandshakeCerts(data: Buffer): void {
    try {
      const certs = this.findCertificateInTlsData(data)
      if (certs.length === 0) return

      // Capture the raw DER chain for downstream verification. Node's getPeerCertificate()
      // can truncate the chain when validation fails, so we keep the wire-format copy.
      this.peerChainDer = certs
    } catch (err) {
      logger.silly(`extractHandshakeCerts: ${(err as Error).message}`)
    }
  }

  private async connectAttempt(useLegacyProfile: boolean): Promise<void> {
    return await new Promise((resolve, reject) => {
      let settled = false
      const settleReject = (err: Error): void => {
        if (settled) return
        settled = true
        reject(err)
      }
      const settleResolve = (): void => {
        if (settled) return
        settled = true
        resolve()
      }

      logger.debug(
        `TLS connect attempt: profile=${useLegacyProfile ? 'legacy-compat' : 'modern-default'}, rejectUnauthorized=${this.rejectUnauthorized}, session=${this.sessionId}`
      )

      // We always pass rejectUnauthorized=false to Node and do the trust evaluation
      // ourselves after secureConnect. Node delegates to OpenSSL's default verify, which
      // enforces Extended Key Usage strictly — that rejects AMT's RCFG activation cert
      // (valid Intel OnDie chain but no serverAuth EKU) with INVALID_PURPOSE. Our custom
      // verifiers walk the chain cryptographically and skip the EKU check, which is the
      // behavior we want for AMT management TLS.
      const doCustomVerification = this.rejectUnauthorized

      const tlsOptions: tls.ConnectionOptions = {
        socket: this.duplexStream as any,
        ca: this.caCerts != null ? ensurePemCertificate(this.caCerts) : AMT_ODCA_ROOT_CERTS,
        rejectUnauthorized: false
      }

      if (useLegacyProfile) {
        this.applyLegacyTlsCompatibility(tlsOptions)
      }

      this.tlsSocket = tls.connect(tlsOptions, () => {
        if (doCustomVerification) {
          const verifyResult =
            this.caCerts != null
              ? this.verifyPeerAgainstCustomCA(this.tlsSocket!)
              : this.verifyAmtChainAgainstODCA(this.tlsSocket!)

          if (!verifyResult.ok) {
            const err = new Error(verifyResult.reason)
            logger.error(`TLS custom verification failed: ${verifyResult.reason}`)
            this.logTLSDiagnostics(this.tlsSocket!, err)
            this.tlsSocket?.destroy(err)
            settleReject(err)
            return
          }
          logger.debug(`TLS custom verification succeeded: ${verifyResult.reason}`)
        }

        this.connected = true
        this.logNegotiatedTLSDetails()
        settleResolve()
      })

      this.tlsSocket.on('error', (err: Error) => {
        logger.error(`TLS error: ${err.message}`)
        this.logTLSDiagnostics(this.tlsSocket!, err)
        if (!this.connected) {
          settleReject(err)
        }
      })

      this.tlsSocket.on('close', () => {
        if (!this.connected && !this.intentionalClose) {
          settleReject(new Error('TLS tunnel closed before handshake completed'))
        }
        this.connected = false
      })
    })
  }

  async connect(): Promise<void> {
    // Log the CA cert(s) we're trusting so we can verify their extensions
    this.logCACerts()
    this.handshakeStarted = true

    // Flush pending data
    for (const data of this.pendingData) {
      this.duplexStream.push(data)
    }
    this.pendingData = []

    const useLegacyProfile = this.legacyTlsCompatibility
    await this.connectAttempt(useLegacyProfile)
  }

  private splitPemBundle(pemBundle: string): string[] {
    const matches = pemBundle.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)
    return matches ?? [pemBundle]
  }

  private verifyPeerAgainstCustomCA(socket: tls.TLSSocket): { ok: boolean; reason: string } {
    const peer = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate
    if (peer?.raw == null) {
      return { ok: false, reason: 'peer certificate not available after handshake' }
    }

    const leaf = new crypto.X509Certificate(peer.raw)
    const now = Date.now()
    const validFrom = Date.parse(leaf.validFrom)
    const validTo = Date.parse(leaf.validTo)
    if (!Number.isNaN(validFrom) && now < validFrom) {
      return { ok: false, reason: `peer certificate not yet valid (validFrom=${leaf.validFrom})` }
    }
    if (!Number.isNaN(validTo) && now > validTo) {
      return { ok: false, reason: `peer certificate expired (validTo=${leaf.validTo})` }
    }

    const configuredCA = this.caCerts != null ? ensurePemCertificate(this.caCerts) : ''
    const caCandidates = this.splitPemBundle(configuredCA)
    if (caCandidates.length === 0) {
      return { ok: false, reason: 'no custom CA certificate candidates provided' }
    }

    for (let i = 0; i < caCandidates.length; i++) {
      try {
        const ca = new crypto.X509Certificate(caCandidates[i])
        const signatureValid = leaf.verify(ca.publicKey)
        if (!signatureValid) {
          continue
        }

        if (leaf.checkIssued(ca)) {
          return {
            ok: true,
            reason: `leaf signature verified against custom CA[${i}] (${ca.subject})`
          }
        }

        // Signature validation is authoritative; checkIssued can fail on formatting quirks.
        return {
          ok: true,
          reason: `leaf signature verified against custom CA[${i}] (issuer formatting mismatch tolerated)`
        }
      } catch (err) {
        logger.warn(`Failed to evaluate custom CA[${i}] during TLS verification: ${(err as Error).message}`)
      }
    }

    // Post-CCM transition: AMT may temporarily present a self-signed cert before
    // the RPS-issued cert is installed. Allow this only when explicitly enabled.
    if (this.allowPostCcmTransitionSelfSigned) {
      try {
        const isSelfSigned = leaf.verify(leaf.publicKey)
        if (isSelfSigned) {
          logger.warn(`TLS post-CCM transition: accepting temporary AMT self-signed leaf (${leaf.fingerprint256})`)
          return {
            ok: true,
            reason: `post-CCM transition self-signed leaf accepted (${leaf.fingerprint256})`
          }
        }
      } catch (err) {
        logger.warn(`Post-CCM transition self-signed verification failed: ${(err as Error).message}`)
      }
    }

    return {
      ok: false,
      reason: `leaf certificate signature did not validate against any provided custom CA (${caCandidates.length} candidate(s))`
    }
  }

  private logCACerts(): void {
    try {
      const caSource = this.caCerts != null ? 'MPS root CA (custom)' : 'Intel ODCA (fallback)'
      const effectiveCa = this.caCerts != null ? ensurePemCertificate(this.caCerts) : AMT_ODCA_ROOT_CERTS
      const caCerts = Array.isArray(effectiveCa) ? effectiveCa : this.splitPemBundle(effectiveCa)
      logger.debug(`Loaded ${caCerts.length} CA cert(s) for TLS verification (source: ${caSource})`)
      for (let i = 0; i < caCerts.length; i++) {
        try {
          const x509 = new crypto.X509Certificate(caCerts[i])
          logger.silly(
            `  CA[${i}] fp256=${x509.fingerprint256}, subject=${x509.subject}, validTo=${x509.validTo}, isCA=${x509.ca}`
          )
        } catch (parseErr) {
          logger.error(`  CA[${i}] parse error: ${(parseErr as Error).message}`)
        }
      }
    } catch (err) {
      logger.error(`logCACerts failed: ${(err as Error).message}`)
    }
  }

  private logTLSDiagnostics(socket: tls.TLSSocket, err: Error): void {
    try {
      logger.error(`TLS diagnostics for session ${this.sessionId}:`)
      logger.error(`  rejectUnauthorized: ${this.rejectUnauthorized}`)
      logger.error(`  authorized: ${socket.authorized}`)
      logger.error(`  authorizationError: ${socket.authorizationError ?? 'none'}`)
      logger.error(`  protocol: ${socket.getProtocol() ?? 'unknown'}`)
      logger.error(`  cipher: ${JSON.stringify(socket.getCipher?.() ?? 'unavailable')}`)

      let peerCert: tls.DetailedPeerCertificate | undefined
      try {
        peerCert = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate
      } catch {
        // getPeerCertificate may throw if handshake never completed
      }

      if (peerCert?.subject) {
        logger.error(
          `  peer cert: fp256=${peerCert.fingerprint256 ?? 'n/a'}, serial=${peerCert.serialNumber ?? 'n/a'}, subject=${JSON.stringify(peerCert.subject)}, issuer=${JSON.stringify(peerCert.issuer)}, validFrom=${peerCert.valid_from ?? 'n/a'}, validTo=${peerCert.valid_to ?? 'n/a'}`
        )

        // Parse raw DER for concise normalized view
        if (peerCert.raw) {
          try {
            const x509 = new crypto.X509Certificate(peerCert.raw)
            logger.error(
              `  peer x509: fp256=${x509.fingerprint256}, subject=${x509.subject}, issuer=${x509.issuer}, validTo=${x509.validTo}, isCA=${x509.ca}`
            )
          } catch (parseErr) {
            logger.error(`  x509 parse error: ${(parseErr as Error).message}`)
          }
        }
      } else {
        logger.error(`  peer certificate: not available (handshake may not have completed)`)
      }

      // Log the CA certs we're trusting
      const effectiveCa = this.caCerts != null ? this.caCerts : AMT_ODCA_ROOT_CERTS
      const caCount = Array.isArray(effectiveCa) ? effectiveCa.length : 1
      logger.error(
        `  trusted CA certs loaded: ${caCount} (source: ${this.caCerts != null ? 'MPS root CA' : 'Intel ODCA'})`
      )
    } catch (diagErr) {
      logger.error(`  diagnostics collection failed: ${(diagErr as Error).message}`)
    }
  }

  /**
   * Verifies the peer certificate chain (as captured from the handshake) terminates at
   * one of the trusted Intel ODCA root certs. Each adjacent pair is checked by signature,
   * then the topmost cert is matched to a trusted root either by fingerprint (if the peer
   * sent the root) or by signature (if the peer only sent up to an intermediate).
   *
   * We deliberately do not check Extended Key Usage here. AMT's RCFG activation leaf is
   * issued by Intel specifically for remote configuration and does not carry the
   * serverAuth EKU, which would make OpenSSL's default verify reject it with
   * INVALID_PURPOSE despite a cryptographically valid chain.
   */
  private verifyAmtChainAgainstODCA(socket: tls.TLSSocket): { ok: boolean; reason: string } {
    let chain: crypto.X509Certificate[]
    if (this.peerChainDer.length > 0) {
      try {
        chain = this.peerChainDer.map((der) => new crypto.X509Certificate(der))
      } catch (err) {
        return { ok: false, reason: `failed to parse captured peer chain: ${(err as Error).message}` }
      }
    } else {
      chain = this.extractChainFromPeerCertificate(socket)
    }

    if (chain.length === 0) {
      return { ok: false, reason: 'peer certificate chain not available after handshake' }
    }

    const now = Date.now()
    for (let i = 0; i < chain.length; i++) {
      const cert = chain[i]
      const validFrom = Date.parse(cert.validFrom)
      const validTo = Date.parse(cert.validTo)
      if (!Number.isNaN(validFrom) && now < validFrom) {
        return { ok: false, reason: `chain[${i}] not yet valid (validFrom=${cert.validFrom})` }
      }
      if (!Number.isNaN(validTo) && now > validTo) {
        return { ok: false, reason: `chain[${i}] expired (validTo=${cert.validTo})` }
      }
    }

    for (let i = 0; i < chain.length - 1; i++) {
      try {
        if (!chain[i].verify(chain[i + 1].publicKey)) {
          return {
            ok: false,
            reason: `chain[${i}] signature does not validate against chain[${i + 1}] public key`
          }
        }
      } catch (err) {
        return { ok: false, reason: `chain[${i}] signature check error: ${(err as Error).message}` }
      }
    }

    const trustedRoots: crypto.X509Certificate[] = []
    for (const pem of AMT_ODCA_ROOT_CERTS) {
      try {
        trustedRoots.push(new crypto.X509Certificate(pem))
      } catch (err) {
        logger.warn(`Failed to parse trusted ODCA root: ${(err as Error).message}`)
      }
    }

    if (trustedRoots.length === 0) {
      return { ok: false, reason: 'no trusted ODCA roots available' }
    }

    const topCert = chain[chain.length - 1]
    for (const root of trustedRoots) {
      if (topCert.fingerprint256 === root.fingerprint256) {
        return {
          ok: true,
          reason: `chain terminates at trusted ODCA root (fp=${root.fingerprint256})`
        }
      }
      try {
        if (topCert.verify(root.publicKey)) {
          return {
            ok: true,
            reason: `top of chain signed by trusted ODCA root (fp=${root.fingerprint256})`
          }
        }
      } catch {
        // Try the next root.
      }
    }

    return {
      ok: false,
      reason: `chain does not terminate at any trusted ODCA root (${trustedRoots.length} root(s) checked, top subject=${topCert.subject.replace(/\n/g, ' ')})`
    }
  }

  private extractChainFromPeerCertificate(socket: tls.TLSSocket): crypto.X509Certificate[] {
    const chain: crypto.X509Certificate[] = []
    const seen = new Set<string>()
    let current: tls.DetailedPeerCertificate | undefined
    try {
      current = socket.getPeerCertificate(true) as tls.DetailedPeerCertificate
    } catch {
      return chain
    }
    while (current?.raw != null) {
      try {
        const x509 = new crypto.X509Certificate(current.raw)
        if (seen.has(x509.fingerprint256)) break
        seen.add(x509.fingerprint256)
        chain.push(x509)
      } catch {
        break
      }
      if (current.issuerCertificate === current) break
      current = current.issuerCertificate as tls.DetailedPeerCertificate | undefined
    }
    return chain
  }

  async send(data: Buffer): Promise<void> {
    return await new Promise((resolve, reject) => {
      if (this.tlsSocket == null || !this.connected) {
        reject(new Error('TLS tunnel not connected'))
        return
      }
      this.tlsSocket.write(data, (err?: Error | null) => {
        if (err != null) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  onData(callback: (data: Buffer) => void): void {
    this.tlsSocket?.on('data', callback)
  }

  close(): void {
    this.intentionalClose = true
    if (this.tlsSocket != null) {
      this.tlsSocket.destroy()
      this.tlsSocket = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }
}
