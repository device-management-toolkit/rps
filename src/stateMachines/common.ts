/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { Environment } from '../utils/Environment.js'
import { devices } from '../devices.js'
import {
  type EnterpriseAssistantMessage,
  enterpriseAssistantSocket,
  promises
} from '../WSEnterpriseAssistantListener.js'
import {
  GATEWAY_TIMEOUT_ERROR,
  UNEXPECTED_PARSE_ERROR,
  EA_TIMEOUT_ERROR,
  CONNECTION_RESET_ERROR,
  TLS_TUNNEL_ERROR
} from '../utils/constants.js'
import Logger from '../Logger.js'
import { type HttpHandler } from '../HttpHandler.js'
import { type ComponentResult, type ComponentResults } from '../models/RCS.Config.js'
import pkg, { type HttpZResponseModel } from 'http-z'
import { parseChunkedMessage } from '../utils/parseChunkedMessage.js'
import { TLSTunnelManager } from '../TLSTunnelManager.js'

const invokeWsmanLogger = new Logger('invokeWsmanCall')
const progressLogger = new Logger('sendProgressToDevice')

// Best-effort progress note to rpc-go — emitted both at phase boundaries (state entry)
// and for per-item milestones (e.g. each WiFi profile / proxy add) via transition actions.
// Gated on the client advertising `progressSupported`; failures are swallowed.
export const sendProgressToDevice = (clientId: string, label: string): void => {
  try {
    const clientObj = devices[clientId]
    if (clientObj?.ClientSocket == null) {
      return
    }
    if (clientObj.ClientData?.payload?.progressSupported !== true) {
      return
    }
    const responseMessage = ClientResponseMsg.get(clientId, null, 'progress', 'ok', label)
    clientObj.ClientSocket.send(JSON.stringify(responseMessage))
  } catch (err) {
    progressLogger.warn(`Failed to send progress to device ${clientId}: ${(err as Error).message}`)
  }
}

/**
 * If retries is more than 0, will resend the message
 * if the response cannot be parsed.
 *
 * @param context
 * @param retries <optional> ADDITIONAL times to send the message.
 * If you want to try a total of 3 times, retries should equal 2
 */
export class HttpResponseError extends Error {
  statusCode: number

  constructor(message: string, statusCode: number) {
    super(message)
    this.name = this.constructor.name
    this.statusCode = statusCode
    Error.captureStackTrace(this, this.constructor)
  }
}
const invokeWsmanCallInternal = async <T>(context: any): Promise<T> => {
  const { clientId, xmlMessage, httpHandler } = context
  const clientObj = devices[clientId]
  if (xmlMessage == null) {
    throw new Error('xmlMessage is null - cannot send WSMAN request')
  }
  // Keep-alive only makes sense when reusing a TLS tunnel across messages.
  // Non-TLS path opens a fresh socket per message in rpc-go, so Connection: close is optimal there.
  const persistentTunnel = Environment.Config.amt_tls_tunnel_persistent !== false
  const keepAlive = clientObj.tlsEnforced === true && persistentTunnel
  const message = httpHandler.wrapIt(xmlMessage, clientObj.connectionParams, keepAlive)

  // Log the outgoing WSMAN request
  const actionMatch = xmlMessage?.match(/<a:Action>([^<]+)<\/a:Action>/)
  const resourceMatch = xmlMessage?.match(/<w:ResourceURI>([^<]+)<\/w:ResourceURI>/)
  const action = actionMatch ? actionMatch[1].split('/').pop() : 'unknown'
  const resource = resourceMatch ? resourceMatch[1].split('/').pop() : 'unknown'
  invokeWsmanLogger.debug(`WSMAN REQUEST: ${action} on ${resource}`)
  invokeWsmanLogger.debug(`WSMAN REQUEST XML:\n${xmlMessage}`)

  if (clientObj.tlsEnforced === true) {
    return await invokeWsmanCallViaTLSTunnel<T>(context, message)
  }

  // Standard WebSocket JSON path
  const clientMsg = ClientResponseMsg.get(clientId, message, 'wsman', 'ok')
  const clientMsgStr = JSON.stringify(clientMsg)
  clientObj.pendingPromise = new Promise<T>((resolve, reject) => {
    clientObj.resolve = resolve
    clientObj.reject = reject
  })
  if (clientObj.ClientSocket) {
    clientObj.ClientSocket.send(clientMsgStr)
    return await clientObj.pendingPromise
  }
  invokeWsmanLogger.warn('No client socket')
  return clientObj.reject as any
}

/**
 * Sends WSMAN message through the TLS tunnel when TLS is enforced.
 * The TLS tunnel encrypts the message before sending via WebSocket to rpc-go.
 */
const invokeWsmanCallViaTLSTunnel = async <T>(context: any, message: string): Promise<T> => {
  const { clientId, httpHandler } = context
  const clientObj = devices[clientId]

  // Re-establish tunnel if needed
  if (clientObj.tlsTunnelNeedsReset === true || clientObj.tlsTunnelManager == null) {
    const reason = clientObj.tlsTunnelNeedsReset ? 'tunnel needs reset' : 'no tunnel manager'
    invokeWsmanLogger.info(`Creating new TLS tunnel (${reason})`)

    if (clientObj.tlsTunnelManager != null) {
      clientObj.tlsTunnelManager.close()
    }

    // Trust anchor selection depends on where we are in the provisioning lifecycle:
    //   - Pre-CCM: no cert material yet → caCert is undefined; TLSTunnelManager falls
    //     back to walking the OnDie CA chain.
    //   - Post-CCM / already-activated, no cert pinned yet: we need a temporary
    //     tunnel before we can fetch AMT_PublicKeyCertificate / AMT_TLSCredentialContext
    //     to identify the device's live cert. No trust anchor exists for this window;
    //     digest auth via the admin password is the trust boundary. Skip verification.
    //   - After RPS has generated/uploaded a TLS cert: issuedCertPEM pins the exact
    //     cert. If an MPS root CA was used instead, mpsRootCertPEM wins.
    const hasIssuedCert = clientObj.tls?.issuedCertPEM != null && clientObj.tls.issuedCertPEM !== ''
    const caCert: string | undefined = clientObj.tls?.mpsRootCertPEM ?? clientObj.tls?.issuedCertPEM
    const hasTrustAnchor = caCert != null && caCert !== ''

    // Phase A (post-CCM transition): CCM complete but issued cert not yet installed on AMT.
    // If no trust anchor is available, skip verification as before.
    // If MPS root trust anchor exists, enforce verification and allow temporary
    // self-signed fallback for AMT's brief post-CCM transition period.
    const inPostCcmTransitionNoAnchor = clientObj.activationStatus === true && !hasIssuedCert && !hasTrustAnchor
    const inPostCcmTransitionSelfSignedPhase = clientObj.activationStatus === true && !hasIssuedCert && hasTrustAnchor
    const skipVerify = context.skipTlsVerification === true || inPostCcmTransitionNoAnchor
    const rejectUnauthorized = skipVerify ? false : Environment.Config.amt_post_tls_reject === true

    if (context.skipTlsVerification === true) {
      invokeWsmanLogger.warn(
        `Skipping TLS peer verification for this call (${clientId}) - deactivation/unprovision path`
      )
    } else if (inPostCcmTransitionNoAnchor) {
      invokeWsmanLogger.warn(
        `Skipping TLS peer verification for this tunnel (${clientId}) - post-CCM transition without trust anchor`
      )
    } else if (inPostCcmTransitionSelfSignedPhase && rejectUnauthorized) {
      invokeWsmanLogger.warn(
        `TLS post-CCM transition for ${clientId}: enforcing MPS-root verification with temporary self-signed fallback until issued cert is installed`
      )
    }

    clientObj.tlsTunnelManager = new TLSTunnelManager(
      clientObj.ClientSocket,
      clientId,
      rejectUnauthorized,
      Environment.Config.amt_legacy_tls_compatibility === true,
      caCert,
      {
        allowPostCcmTransitionSelfSigned: inPostCcmTransitionSelfSignedPhase && rejectUnauthorized
      }
    )
    clientObj.tlsTunnelSessionId = clientObj.tlsTunnelManager.getSessionId()
    clientObj.tlsTunnelNeedsReset = false

    try {
      await clientObj.tlsTunnelManager.connect()
      clientObj.tlsTunnelManager.onData((data: Buffer) => {
        processTLSTunnelResponse(clientId, data, httpHandler)
      })
      invokeWsmanLogger.info(`TLS tunnel established`)
    } catch (err) {
      invokeWsmanLogger.error(`TLS tunnel connect failed: ${(err as Error).message}`)
      clientObj.tlsTunnelManager = undefined
      clientObj.tlsTunnelSessionId = undefined
      clientObj.tlsTunnelNeedsReset = true
      clientObj.amtReconfiguring = true // AMT may be reconfiguring - next operation should wait
      throw new TLS_TUNNEL_ERROR((err as Error).message)
    }
  }

  clientObj.tlsResponseBuffer = undefined
  clientObj.pendingPromise = new Promise<T>((resolve, reject) => {
    clientObj.resolve = resolve
    clientObj.reject = reject
  })

  try {
    await clientObj.tlsTunnelManager!.send(Buffer.from(message))
  } catch (err) {
    invokeWsmanLogger.error(`TLS send error: ${(err as Error).message}`)
    // Tunnel is broken, mark for reset and signal AMT may be reconfiguring
    clientObj.tlsTunnelNeedsReset = true
    clientObj.amtReconfiguring = true
    clientObj.reject(err)
  }

  const result = (await clientObj.pendingPromise) as T

  // When tunnel persistence is disabled, we send Connection: close so AMT tears down
  // the TCP socket after each response. Close the tunnel here so the next call rebuilds.
  if (Environment.Config.amt_tls_tunnel_persistent === false) {
    invokeWsmanLogger.debug('Closing TLS tunnel after response (amt_tls_tunnel_persistent=false)')
    clientObj.tlsTunnelManager?.close()
    clientObj.tlsTunnelManager = undefined
    clientObj.tlsTunnelSessionId = undefined
    clientObj.tlsTunnelNeedsReset = true
  }

  return result
}

/**
 * Processes HTTP response received through the TLS tunnel.
 * Called by TLSTunnelManager.onData callback.
 *
 * HTTP responses may span multiple TLS records, so we buffer data until we have
 * a complete response (detected by finding the end of chunked encoding: 0\r\n\r\n)
 */
export const processTLSTunnelResponse = (clientId: string, data: Buffer, httpHandler: HttpHandler): void => {
  const clientObj = devices[clientId]

  if (clientObj == null || clientObj.pendingPromise == null) {
    invokeWsmanLogger.debug(`TLS response received but no pending promise (${data.length} bytes)`)
    return
  }

  // Accumulate data in buffer
  if (clientObj.tlsResponseBuffer == null) {
    clientObj.tlsResponseBuffer = data
  } else {
    clientObj.tlsResponseBuffer = Buffer.concat([clientObj.tlsResponseBuffer, data])
  }

  // Check if we have a complete HTTP response
  const bufferStr = clientObj.tlsResponseBuffer.toString()
  const isChunked = /Transfer-Encoding:\s*chunked/i.test(bufferStr)
  const hasCompleteChunkedResponse = isChunked && bufferStr.endsWith('0\r\n\r\n')

  let hasCompleteContentLengthResponse = false
  const contentLengthMatch = bufferStr.match(/Content-Length:\s*(\d+)/i)
  if (contentLengthMatch) {
    const contentLength = parseInt(contentLengthMatch[1], 10)
    const headerEndIndex = bufferStr.indexOf('\r\n\r\n')
    if (headerEndIndex !== -1) {
      const bodyStart = headerEndIndex + 4
      const bodyLength = clientObj.tlsResponseBuffer.length - bodyStart
      hasCompleteContentLengthResponse = bodyLength >= contentLength
    }
  }

  if (!hasCompleteChunkedResponse && !hasCompleteContentLengthResponse) {
    return
  }

  const responseData = clientObj.tlsResponseBuffer
  clientObj.tlsResponseBuffer = undefined

  try {
    const { parse } = pkg
    const httpRsp = parse(responseData.toString()) as HttpZResponseModel
    const statusCode = httpRsp.statusCode

    if (statusCode === 200) {
      const isChunkedResponse = /Transfer-Encoding:\s*chunked/i.test(responseData.toString())
      const xmlBody = isChunkedResponse ? parseChunkedMessage(httpRsp.body.text) : httpRsp.body.text
      const resolveValue = xmlBody ? httpHandler.parseXML(xmlBody) : null
      if (xmlBody != null && xmlBody !== '' && resolveValue != null) {
        invokeWsmanLogger.debug(`WSMAN RESPONSE XML:\n${xmlBody}`)
        clientObj.resolve(resolveValue)
      } else {
        invokeWsmanLogger.warn(`WSMAN RESPONSE: parse failed`)
        clientObj.reject(new UNEXPECTED_PARSE_ERROR())
      }
    } else {
      // Non-200 (including 401 digest challenges) are rejected so the error state machine
      // handles the retry/auth flow consistently with the non-TLS path. The error machine
      // installs the digest challenge from Www-Authenticate and bounds retries via unauthCount.
      invokeWsmanLogger.warn(`WSMAN RESPONSE: HTTP ${statusCode}`)
      clientObj.reject(httpRsp)
    }
  } catch (err) {
    invokeWsmanLogger.error(`Response parse error: ${(err as Error).message}`)
    clientObj.reject(new UNEXPECTED_PARSE_ERROR())
  }
}

const timeout = async (ms: number): Promise<void> => {
  await new Promise((_resolve, reject) => {
    setTimeout(() => {
      reject(new GATEWAY_TIMEOUT_ERROR())
    }, ms)
  })
}

const invokeWsmanCall = async <T>(context: any, maxRetries = 0, timeoutMs?: number, oneShot = false): Promise<T> => {
  const { clientId } = context
  const clientObj = devices[clientId]

  // If AMT is reconfiguring (connection_reset received), wait BEFORE starting the operation.
  // This must happen outside the timeout race so the wait doesn't count against operation timeout.
  if (clientObj?.amtReconfiguring === true) {
    const delaySeconds = Environment.Config.delay_tls_timer
    invokeWsmanLogger.info(`Waiting ${delaySeconds}s for AMT TLS reconfiguration...`)
    await new Promise((resolve) => setTimeout(resolve, delaySeconds * 1000))
    clientObj.amtReconfiguring = false
  }

  let retriesUsed = 0
  // One-shot calls (ACM activation/upgrade) drop the session on success; never re-issue them.
  const maxAttempts = oneShot ? 1 : Math.max(maxRetries + 1, Environment.Config.wsman_max_attempts)
  const timeoutValue = timeoutMs ?? Environment.Config.delay_timer * 1000
  const retryDelayMs = Environment.Config.delay_tls_timer * 1000

  while (retriesUsed < maxAttempts) {
    try {
      const result = await Promise.race([
        invokeWsmanCallInternal<T>(context),
        timeout(timeoutValue)
      ])
      return result as any
    } catch (error) {
      // On TLS errors, clean up tunnel so next operation gets a fresh one.
      // Exception: 401 is a normal digest auth challenge — tunnel is fine, just needs credentials.
      if (clientObj?.tlsEnforced === true && (error as any)?.statusCode !== 401) {
        invokeWsmanLogger.warn(`Error during TLS operation, marking tunnel for reset`)
        if (clientObj.tlsTunnelManager != null) {
          clientObj.tlsTunnelManager.close()
          clientObj.tlsTunnelManager = undefined
          clientObj.tlsTunnelSessionId = undefined
        }
        clientObj.tlsTunnelNeedsReset = true
        clientObj.tlsResponseBuffer = undefined
        // On timeout errors, AMT may be reconfiguring - next operation should wait
        if (error instanceof GATEWAY_TIMEOUT_ERROR) {
          clientObj.amtReconfiguring = true
        }
      }

      const isRetryableError =
        error instanceof UNEXPECTED_PARSE_ERROR ||
        error instanceof CONNECTION_RESET_ERROR ||
        error instanceof TLS_TUNNEL_ERROR ||
        error instanceof GATEWAY_TIMEOUT_ERROR

      if (isRetryableError && retriesUsed < maxAttempts - 1) {
        retriesUsed++
        const errorType = (error as any)?.constructor?.name ?? typeof error
        const shouldDelay =
          error instanceof CONNECTION_RESET_ERROR ||
          error instanceof TLS_TUNNEL_ERROR ||
          error instanceof GATEWAY_TIMEOUT_ERROR ||
          clientObj?.amtReconfiguring === true

        if (shouldDelay) {
          const configuredDelaySeconds = Environment.Config.delay_tls_timer
          invokeWsmanLogger.info(
            `Retryable WSMAN error (${errorType}); retry ${retriesUsed}/${maxAttempts - 1}, waiting ${configuredDelaySeconds}s (${retryDelayMs}ms) before retry... (Error: ${(error as any)?.message})`
          )
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
          clientObj.amtReconfiguring = false
        } else {
          invokeWsmanLogger.warn(
            `Retryable WSMAN error (${errorType}); retry ${retriesUsed}/${maxAttempts - 1} without delay... (Error: ${(error as any)?.message})`
          )
        }

        continue
      }

      // Skip the exhaustion log only for the expected one-shot timeout; still log real failures.
      const isExpectedOneShotTimeout = oneShot && error instanceof GATEWAY_TIMEOUT_ERROR
      if (isRetryableError && retriesUsed >= maxAttempts - 1 && !isExpectedOneShotTimeout) {
        const errorType = (error as any)?.constructor?.name ?? typeof error
        const tunnelState = clientObj?.tlsTunnelManager != null ? 'present' : 'none'
        const sessionId = clientObj?.tlsTunnelSessionId ?? 'none'
        invokeWsmanLogger.error(
          `Max WSMAN attempts (${maxAttempts}) exhausted for device ${clientId}. Error: ${(error as any)?.message}`
        )
        invokeWsmanLogger.error(
          `WSMAN final failure context: attempts=${maxAttempts}, retriesUsed=${retriesUsed}, errorType=${errorType}, tunnelState=${tunnelState}, sessionId=${sessionId}, tunnelNeedsReset=${clientObj?.tlsTunnelNeedsReset === true}, amtReconfiguring=${clientObj?.amtReconfiguring === true}`
        )
      }
      throw error
    }
  }
  return await Promise.reject(new Error('Max retries reached'))
}
const invokeEnterpriseAssistantCallInternal = async (context: any): Promise<EnterpriseAssistantMessage> => {
  const { clientId, message } = context
  enterpriseAssistantSocket.send(JSON.stringify(message))
  if (promises[clientId] == null) {
    promises[clientId] = {} as any
  }
  promises[clientId].pendingPromise = new Promise<any>((resolve, reject) => {
    promises[clientId].resolve = resolve
    promises[clientId].reject = reject
  })
  return await promises[clientId].pendingPromise
}

const eaTimeout = (ms): any =>
  new Promise((resolve, reject) => {
    setTimeout(() => {
      reject(new EA_TIMEOUT_ERROR())
    }, ms)
  })

const invokeEnterpriseAssistantCall = async (context: any): Promise<EnterpriseAssistantMessage> => {
  const result = await Promise.race([
    invokeEnterpriseAssistantCallInternal(context),
    eaTimeout(Environment.Config.delay_timer * 1000)
  ])
  return result
}

export type EnumerationContext = string

export function coalesceMessage(prefixMsg: string, err: any): string {
  let msg = prefixMsg
  if (err?.statusCode) {
    msg = `${msg} ${err.statusCode}`
    if (err.statusMessage) {
      msg = `${msg} ${err.statusMessage}`
    }
  }
  if (err?.message) {
    msg = `${msg} ${err.message}`
  } else {
    if (err != null && typeof err === 'string') {
      msg = `${msg} ${err}`
    }
  }
  return msg
}

// Every component RPS can report on. Used to backfill 'NotApplicable' entries so the
// Components block always carries the full, predictable key set (issue #2665).
const ALL_COMPONENTS: (keyof ComponentResults)[] = [
  'Activation',
  'WiredNetwork',
  'WirelessNetwork',
  'TLS',
  'CIRAProxy',
  'CIRAConnection'
]

const NOT_APPLICABLE_DETAILS: Record<keyof ComponentResults, string> = {
  Activation: 'Activation not part of this configuration',
  WiredNetwork: 'Wired network not part of this configuration',
  WirelessNetwork: 'Wireless network not part of this configuration',
  TLS: 'TLS not part of this configuration',
  CIRAProxy: 'CIRA proxy not part of this configuration',
  CIRAConnection: 'CIRA connection not part of this configuration'
}

/**
 * Normalizes a human-readable detail string to sentence-case with no trailing period, so the
 * structured Components block reads consistently regardless of which child machine produced it.
 */
export function normalizeDetails(details: string): string {
  const trimmed = details.trim().replace(/\.+$/, '')
  if (trimmed.length === 0) {
    return trimmed
  }
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

/**
 * Maps a legacy control-mode status string onto a clean machine-readable mode enum.
 * Returns undefined when the string is absent or carries no recognizable control mode.
 */
export function deriveControlMode(statusMessage: string | undefined): 'ACM' | 'CCM' | undefined {
  if (statusMessage == null) {
    return undefined
  }
  const normalized = statusMessage.toLowerCase()
  if (normalized.includes('admin')) {
    return 'ACM'
  }
  if (normalized.includes('client')) {
    return 'CCM'
  }
  return undefined
}

/** Maps the device-reported AMT control mode (1 = CCM, 2 = ACM) onto the result Mode enum. */
export function deriveModeFromCurrentMode(currentMode: number | undefined): 'ACM' | 'CCM' | undefined {
  if (currentMode === 1) {
    return 'CCM'
  }
  if (currentMode === 2) {
    return 'ACM'
  }
  return undefined
}

/** Builds the proxy/wifi "added N / failed M" status, appends it to status.Network, returns message + failure flag. */
export function updateNetworkStatus(opts: {
  clientId: string
  errorMessage?: string
  statusMessage?: string
  added?: string | null
  failedItems?: string | null
  itemLabel: string
}): { message: string | undefined; failed: boolean } {
  const { clientId, errorMessage, statusMessage, added, failedItems, itemLabel } = opts
  const device = devices[clientId]
  const networkStatus = device.status.Network
  let message: string | undefined
  if (errorMessage) {
    message = errorMessage
  } else if (failedItems) {
    message =
      added != null ? `Added ${added} ${itemLabel}. Failed to add ${failedItems}` : `Failed to add ${failedItems}`
  } else {
    message = statusMessage
  }
  if (message != null) {
    device.status.Network = networkStatus ? `${networkStatus}. ${message}` : message
  }
  return { message, failed: !!errorMessage || !!failedItems }
}

/**
 * Records a structured per-component activation result onto the shared device status object
 * (issue #2665). This is additive: it sits alongside the legacy flat status strings and is
 * serialized into the final WebSocket `message` payload. Recording a component result never
 * alters control flow — a failure is captured for visibility but does not change the
 * activation outcome.
 *
 * Shape invariants enforced here: Details are normalized to sentence-case (the failure reason rides
 * in Details), and undefined optional fields are omitted.
 */
export function recordComponentResult(
  clientId: string,
  component: keyof ComponentResults,
  result: ComponentResult
): void {
  const clientObj = devices[clientId]
  if (clientObj?.status == null) {
    return
  }
  if (clientObj.status.Components == null) {
    clientObj.status.Components = {}
  }
  const normalized: ComponentResult = { Result: result.Result }
  if (result.Mode != null) {
    normalized.Mode = result.Mode
  }
  if (result.Details != null) {
    normalized.Details = normalizeDetails(result.Details)
  }
  clientObj.status.Components[component] = normalized
}

/**
 * Finalizes the structured Components block just before it is serialized to the device (issue #2665):
 * backfills Activation for already-activated devices that skipped the activation steps, and fills every
 * un-attempted component with a NotApplicable entry so the key set is always complete. Additive only —
 * the legacy flat status strings are left untouched for backwards compatibility.
 */
export function finalizeComponentResults(clientId: string, overallSuccess: boolean): void {
  const clientObj = devices[clientId]
  if (clientObj?.status == null) {
    return
  }
  const status = clientObj.status
  if (status.Components == null) {
    status.Components = {}
  }
  // Backfill Activation for already-activated devices (fresh activations already recorded it).
  if (overallSuccess && status.Components.Activation == null) {
    if (status.Status != null) {
      // Activated this session: prose status carries the mode.
      recordComponentResult(clientId, 'Activation', {
        Result: 'Success',
        Mode: deriveControlMode(status.Status),
        Details: status.Status
      })
    } else {
      // Pure reconfigure: status.Status unset, so use the reported control mode.
      const mode = deriveModeFromCurrentMode(clientObj.ClientData?.payload?.currentMode)
      if (mode != null) {
        recordComponentResult(clientId, 'Activation', {
          Result: 'Success',
          Mode: mode,
          Details: `Device already activated in ${mode === 'ACM' ? 'admin' : 'client'} control mode`
        })
      }
    }
  }
  for (const component of ALL_COMPONENTS) {
    if (status.Components[component] == null) {
      status.Components[component] = { Result: 'NotApplicable', Details: NOT_APPLICABLE_DETAILS[component] }
    }
  }
}

/** Drops NotApplicable entries (for logging only — the full set still goes to RPC). */
export function applicableComponents(components: ComponentResults | undefined): ComponentResults {
  const result: ComponentResults = {}
  if (components == null) {
    return result
  }
  for (const [name, entry] of Object.entries(components) as [keyof ComponentResults, ComponentResult][]) {
    if (entry?.Result !== 'NotApplicable') {
      result[name] = entry
    }
  }
  return result
}

const isDigestRealmValid = (realm: string): boolean => {
  const regex = /[0-9A-Fa-f]{32}/g
  let isValidRealm = false
  let realmElements: any
  if (realm?.startsWith('Digest:')) {
    realmElements = realm.split('Digest:')
    if (realmElements[1].length === 32 && regex.test(realmElements[1])) {
      isValidRealm = true
    }
  }
  return isValidRealm
}
export interface CommonContext {
  clientId: string
  httpHandler: HttpHandler
  message?: any | null
  errorMessage?: string
  statusMessage?: string
  xmlMessage?: string | null
  parseErrorCount?: number
  targetAfterError?: string | null
  // Deactivation / unprovision flow: the device is about to be wiped, so skip strict TLS cert
  // verification for this call. The factory self-signed cert on a TLS-enforced box has no
  // trust anchor we could validate against, and we already hold the admin credential.
  skipTlsVerification?: boolean
}

export interface CommonMaintenanceContext extends CommonContext {
  taskName: string
  errorMessage: string
}
export {
  invokeWsmanCall,
  invokeEnterpriseAssistantCall,
  invokeEnterpriseAssistantCallInternal,
  invokeWsmanCallInternal,
  isDigestRealmValid
}
