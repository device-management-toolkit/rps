/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import tls from 'node:tls'
import { Duplex } from 'node:stream'
import type Server from 'ws'
import ClientResponseMsg from './utils/ClientResponseMsg.js'
import { AMT_ODCA_ROOT_CERTS, AMT_ALLOWED_ISSUERS } from './certs/amt-odca.js'
import Logger from './Logger.js'

const logger = new Logger('TLSTunnelManager')

let sessionCounter = 0

export class TLSTunnelManager {
  private clientSocket: Server
  private clientId: string
  private tlsSocket: tls.TLSSocket | null = null
  private duplexStream: Duplex
  private connected: boolean = false
  private handshakeStarted: boolean = false
  private pendingData: Buffer[] = []
  private sessionId: string
  private intentionalClose: boolean = false

  constructor(clientSocket: Server, clientId: string) {
    this.clientSocket = clientSocket
    this.clientId = clientId
    this.sessionId = `${clientId}-${++sessionCounter}-${Date.now()}`
    this.duplexStream = this.createWebSocketDuplex()
  }

  getSessionId(): string {
    return this.sessionId
  }

  private createWebSocketDuplex(): Duplex {
    const self = this
    return new Duplex({
      read(): void {},
      write(chunk: Buffer, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        const base64Data = Buffer.from(chunk).toString('base64')
        const msg = ClientResponseMsg.get(self.clientId, base64Data, 'tls_data', 'ok')
        try {
          self.clientSocket.send(JSON.stringify(msg), (err?: Error) => {
            callback(err ?? null)
          })
        } catch (err) {
          callback(err as Error)
        }
      }
    })
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

    if (this.handshakeStarted) {
      this.duplexStream.push(data)
    } else {
      this.pendingData.push(data)
    }
  }

  async connect(): Promise<void> {
    return await new Promise((resolve, reject) => {
      this.handshakeStarted = true

      // Flush pending data
      for (const data of this.pendingData) {
        this.duplexStream.push(data)
      }
      this.pendingData = []

      this.tlsSocket = tls.connect(
        {
          socket: this.duplexStream as any,
          ca: AMT_ODCA_ROOT_CERTS,
          rejectUnauthorized: false,
          checkServerIdentity: (hostname: string, cert: tls.PeerCertificate): Error | undefined => {
            return this.validateAMTCertificate(cert)
          }
        },
        () => {
          this.connected = true
          resolve()
        }
      )

      this.tlsSocket.on('error', (err: Error) => {
        logger.error(`TLS error: ${err.message}`)
        if (!this.connected) {
          reject(err)
        }
      })

      this.tlsSocket.on('close', () => {
        if (!this.connected && !this.intentionalClose) {
          reject(new Error('TLS tunnel closed before handshake completed'))
        }
        this.connected = false
      })
    })
  }

  private validateAMTCertificate(cert: tls.PeerCertificate): Error | undefined {
    const issuerCN = cert.issuer?.CN ?? ''
    const issuerO = cert.issuer?.O ?? ''
    const subjectCN = cert.subject?.CN ?? ''

    const isValidIssuer = AMT_ALLOWED_ISSUERS.some(
      (allowed) =>
        issuerCN.includes(allowed) ||
        issuerO.includes(allowed) ||
        subjectCN.includes(allowed)
    )

    if (!isValidIssuer) {
      logger.warn(`Cert not from known AMT issuer: ${subjectCN}`)
    }

    return undefined
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
