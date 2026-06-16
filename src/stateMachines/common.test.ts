/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { Environment } from '../utils/Environment.js'
import { HttpHandler } from '../HttpHandler.js'
import Logger from '../Logger.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { devices } from '../devices.js'
import { GATEWAY_TIMEOUT_ERROR, UNEXPECTED_PARSE_ERROR, EA_TIMEOUT_ERROR } from '../utils/constants.js'
import { randomUUID } from 'node:crypto'
import { WSEnterpriseAssistantListener, enterpriseAssistantSocket, promises } from '../WSEnterpriseAssistantListener.js'
import { config } from '../test/helper/Config.js'

import { vi, type MockInstance } from 'vitest'
import {
  invokeEnterpriseAssistantCall,
  invokeEnterpriseAssistantCallInternal,
  invokeWsmanCall,
  coalesceMessage,
  recordComponentResult,
  normalizeDetails,
  deriveControlMode,
  deriveModeFromCurrentMode,
  finalizeComponentResults,
  updateNetworkStatus,
  applicableComponents
} from './common.js'

Environment.Config = config
describe('Common', () => {
  const clientId = randomUUID()
  let originalWsmanMaxAttempts: number
  let sendSpy
  let responseMessageSpy: MockInstance
  let wrapItSpy: MockInstance
  let enterpriseAssistantSocketSendSpy: MockInstance
  const context = {
    message: '',
    clientId,
    xmlMessage: '<?xml version="1.0" encoding="UTF-8"?><a:Envelope>Test Content</a:Envelope>',
    httpHandler: new HttpHandler()
  }
  beforeEach(() => {
    originalWsmanMaxAttempts = Environment.Config.wsman_max_attempts
    // Keep this suite deterministic: explicit retries are covered by maxRetries arguments.
    Environment.Config.wsman_max_attempts = 1
    vi.useFakeTimers()
    devices[clientId] = {
      ClientSocket: {
        send: vi.fn()
      },
      connectionParams: {
        guid: clientId,
        port: 16992,
        digestChallenge: null
      }
    } as any

    wrapItSpy = vi.spyOn(context.httpHandler, 'wrapIt')
    responseMessageSpy = vi.spyOn(ClientResponseMsg, 'get')
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send').mockReturnValue()
    const x = new WSEnterpriseAssistantListener(new Logger('test'))
    x.onClientConnected({
      send: vi.fn(),
      on: vi.fn()
    } as any)
    enterpriseAssistantSocketSendSpy = vi.spyOn(enterpriseAssistantSocket, 'send').mockImplementation(() => ({}) as any)
  })

  afterEach(() => {
    Environment.Config.wsman_max_attempts = originalWsmanMaxAttempts
    vi.runAllTicks()
    vi.useRealTimers()
  })

  it('should send a WSMan message once with successful reply', async () => {
    const expected = '123'
    const wsmanPromise = invokeWsmanCall(context, 2)
    expect(wrapItSpy).toHaveBeenCalled()
    expect(responseMessageSpy).toHaveBeenCalled()
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(devices[clientId].pendingPromise).toBeDefined()
    devices[clientId].resolve(expected)
    await expect(wsmanPromise).resolves.toEqual(expected)
  })
  it('should successfully resolve after one UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount === 1) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).resolves.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })
  it('should successfully resolve after two UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0

    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 2) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).resolves.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })

  it('should try three times on UNEXPECTED_PARSE_ERROR', async () => {
    const expected = '123'
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 3) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].resolve(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })

  it('should not retry when wsman_max_attempts is configured to 1', async () => {
    const wsmanPromise = invokeWsmanCall(context)
    expect(sendSpy).toHaveBeenCalledTimes(1)
    devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
    expect(sendSpy).toHaveBeenCalledTimes(1)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
  it('should cap oneShot calls to a single attempt even when wsman_max_attempts > 1', async () => {
    Environment.Config.wsman_max_attempts = 3
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async () => devices[clientId].reject(new UNEXPECTED_PARSE_ERROR()))
    const wsmanPromise = invokeWsmanCall(context, 0, undefined, true)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
    expect(sendSpy).toHaveBeenCalledTimes(1)
  })
  it('should honor the wsman_max_attempts floor when oneShot is false', async () => {
    Environment.Config.wsman_max_attempts = 3
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async () => devices[clientId].reject(new UNEXPECTED_PARSE_ERROR()))
    const wsmanPromise = invokeWsmanCall(context)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
    expect(sendSpy).toHaveBeenCalledTimes(3)
  })
  it('should not log exhaustion for the expected oneShot timeout', async () => {
    const errorLogSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    const wsmanPromise = invokeWsmanCall(context, 0, undefined, true)
    vi.advanceTimersByTime(Environment.Config.delay_timer * 1000)
    await expect(wsmanPromise).rejects.toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    expect(errorLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('Max WSMAN attempts'))
    errorLogSpy.mockRestore()
  })
  it('should log exhaustion for a non-timeout oneShot failure', async () => {
    const errorLogSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {})
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async () => devices[clientId].reject(new UNEXPECTED_PARSE_ERROR()))
    const wsmanPromise = invokeWsmanCall(context, 0, undefined, true)
    await expect(wsmanPromise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
    expect(errorLogSpy).toHaveBeenCalledWith(expect.stringContaining('Max WSMAN attempts'))
    errorLogSpy.mockRestore()
  })
  it('should not retry when error is not UNEXPECTED_PARSE_ERROR', async () => {
    const expected = {
      statusCode: 401,
      statusMessage: 'Unauthorized'
    }
    let invokeWsmanCallInternalCallCount = 0
    sendSpy = vi.spyOn(devices[clientId].ClientSocket, 'send')
    sendSpy.mockImplementation(async (context) => {
      invokeWsmanCallInternalCallCount++
      if (invokeWsmanCallInternalCallCount <= 1) {
        devices[clientId].reject(new UNEXPECTED_PARSE_ERROR())
      } else {
        devices[clientId].reject(expected)
      }
    })
    const wsmanPromise = invokeWsmanCall(context, 2)
    await expect(wsmanPromise).rejects.toEqual(expected)
    expect(sendSpy).toHaveBeenCalledTimes(2)
  })
  it('should send an enterprise-assistant message', async () => {
    void invokeEnterpriseAssistantCallInternal(context)

    expect(enterpriseAssistantSocketSendSpy).toHaveBeenCalled()
    expect(promises[clientId].pendingPromise).toBeDefined()
    expect(promises[clientId].resolve).toBeDefined()
    expect(promises[clientId].reject).toBeDefined()
  })

  it('should timeout on no response from AMT', async () => {
    try {
      const x = invokeWsmanCall(context)
      vi.advanceTimersByTime(Environment.Config.delay_timer * 1000)
      await x
    } catch (err) {
      expect(err).toBeInstanceOf(GATEWAY_TIMEOUT_ERROR)
    }
  })

  it('should timeout on no response from EA', async () => {
    try {
      const x = invokeEnterpriseAssistantCall(context)
      vi.advanceTimersByTime(Environment.Config.delay_timer * 1000)
      await x
    } catch (err) {
      expect(err).toBeInstanceOf(EA_TIMEOUT_ERROR)
    }
  })
  it('should return coalesced error message', () => {
    const prefix = 'test error'
    const anyErr = {
      statusCode: 400,
      statusMessage: 'Bad Request'
    }
    const msg = coalesceMessage(prefix, anyErr)
    expect(msg).toBeTruthy()
    expect(msg).toContain(prefix)
    expect(msg).toContain('Bad Request')
    expect(msg).toContain('400')
  })

  describe('recordComponentResult', () => {
    it('should initialize Components and record a result (issue #2665)', () => {
      devices[clientId].status = { Status: 'Admin control mode.' }
      recordComponentResult(clientId, 'Activation', {
        Result: 'Success',
        Mode: 'ACM'
      })
      expect(devices[clientId].status.Components?.Activation).toEqual({
        Result: 'Success',
        Mode: 'ACM'
      })
    })

    it('should preserve previously recorded components when adding another', () => {
      devices[clientId].status = { Components: { Activation: { Result: 'Success' } } }
      recordComponentResult(clientId, 'WirelessNetwork', {
        Result: 'Failure',
        Details: 'Failed to add 1'
      })
      expect(devices[clientId].status.Components?.Activation).toEqual({ Result: 'Success' })
      expect(devices[clientId].status.Components?.WirelessNetwork).toEqual({
        Result: 'Failure',
        Details: 'Failed to add 1'
      })
    })

    it('should normalize the failure detail and carry the reason in Details', () => {
      devices[clientId].status = {}
      recordComponentResult(clientId, 'TLS', { Result: 'Failure', Details: 'cert add rejected.' })
      expect(devices[clientId].status.Components?.TLS).toEqual({
        Result: 'Failure',
        Details: 'Cert add rejected'
      })
    })

    it('should no-op when the device has no status object', () => {
      delete (devices[clientId] as any).status
      expect(() => {
        recordComponentResult(clientId, 'TLS', { Result: 'Success' })
      }).not.toThrow()
      expect(devices[clientId].status).toBeUndefined()
    })
  })

  describe('normalizeDetails', () => {
    it('strips a single trailing period and capitalizes the first character', () => {
      expect(normalizeDetails('already enabled in admin mode.')).toEqual('Already enabled in admin mode')
    })
    it('leaves already-clean strings untouched', () => {
      expect(normalizeDetails('Wired Network Configured')).toEqual('Wired Network Configured')
    })
    it('handles empty/whitespace input', () => {
      expect(normalizeDetails('   ')).toEqual('')
    })
  })

  describe('deriveControlMode', () => {
    it('maps admin strings to ACM', () => {
      expect(deriveControlMode('already enabled in admin mode.')).toEqual('ACM')
    })
    it('maps client strings to CCM', () => {
      expect(deriveControlMode('Client control mode.')).toEqual('CCM')
    })
    it('returns undefined for unrecognized modes', () => {
      expect(deriveControlMode('something else')).toBeUndefined()
    })
  })

  describe('deriveModeFromCurrentMode', () => {
    it('maps currentMode 1 to CCM', () => {
      expect(deriveModeFromCurrentMode(1)).toEqual('CCM')
    })
    it('maps currentMode 2 to ACM', () => {
      expect(deriveModeFromCurrentMode(2)).toEqual('ACM')
    })
    it('returns undefined for pre-provisioning (0) or an absent mode', () => {
      expect(deriveModeFromCurrentMode(0)).toBeUndefined()
      expect(deriveModeFromCurrentMode(undefined)).toBeUndefined()
    })
  })

  describe('updateNetworkStatus', () => {
    beforeEach(() => {
      devices[clientId].status = {}
    })
    it('reports an error message as a failure', () => {
      const result = updateNetworkStatus({ clientId, errorMessage: 'boom', itemLabel: 'Proxy Configurations' })
      expect(result).toEqual({ message: 'boom', failed: true })
      expect(devices[clientId].status.Network).toEqual('boom')
    })
    it('builds an added/failed summary and flags failure when some items failed', () => {
      const result = updateNetworkStatus({
        clientId,
        added: '2',
        failedItems: '1',
        itemLabel: 'WiFi Profiles'
      })
      expect(result).toEqual({ message: 'Added 2 WiFi Profiles. Failed to add 1', failed: true })
    })
    it('reports the status message as a success when nothing failed', () => {
      const result = updateNetworkStatus({ clientId, statusMessage: 'Configured', itemLabel: 'WiFi Profiles' })
      expect(result).toEqual({ message: 'Configured', failed: false })
    })
    it('appends to an existing Network status rather than overwriting it', () => {
      devices[clientId].status.Network = 'Prior'
      updateNetworkStatus({ clientId, statusMessage: 'Configured', itemLabel: 'WiFi Profiles' })
      expect(devices[clientId].status.Network).toEqual('Prior. Configured')
    })
    it('leaves Network untouched when no message is produced (no literal "undefined")', () => {
      devices[clientId].status.Network = 'Prior'
      const result = updateNetworkStatus({ clientId, itemLabel: 'WiFi Profiles' })
      expect(result).toEqual({ message: undefined, failed: false })
      expect(devices[clientId].status.Network).toEqual('Prior')
    })
  })

  describe('finalizeComponentResults', () => {
    it('backfills NotApplicable components and the Activation entry', () => {
      devices[clientId].status = {
        Status: 'already enabled in admin mode.',
        Components: { TLS: { Result: 'Success' } }
      }
      finalizeComponentResults(clientId, true)
      const status = devices[clientId].status
      // Already-activated device: Activation is backfilled from the legacy flat status.
      expect(status.Components?.Activation).toEqual({
        Result: 'Success',
        Mode: 'ACM',
        Details: 'Already enabled in admin mode'
      })
      // Every remaining component is present as NotApplicable.
      expect(status.Components?.CIRAConnection?.Result).toEqual('NotApplicable')
      expect(status.Components?.WiredNetwork?.Result).toEqual('NotApplicable')
    })

    it('backfills Activation as ACM for an already-activated device from the reported control mode', () => {
      // Pure reconfigure: mode comes from currentMode (2 = ACM).
      devices[clientId].ClientData = { payload: { currentMode: 2 } } as any
      devices[clientId].status = { Components: { CIRAConnection: { Result: 'Success' } } }
      finalizeComponentResults(clientId, true)
      expect(devices[clientId].status.Components?.Activation).toEqual({
        Result: 'Success',
        Mode: 'ACM',
        Details: 'Device already activated in admin control mode'
      })
    })

    it('backfills Activation as CCM for an already-activated device from the reported control mode', () => {
      devices[clientId].ClientData = { payload: { currentMode: 1 } } as any
      devices[clientId].status = { Components: { CIRAConnection: { Result: 'Success' } } }
      finalizeComponentResults(clientId, true)
      expect(devices[clientId].status.Components?.Activation).toEqual({
        Result: 'Success',
        Mode: 'CCM',
        Details: 'Device already activated in client control mode'
      })
    })

    it('leaves Activation NotApplicable when neither a status string nor a control mode is available', () => {
      devices[clientId].ClientData = { payload: {} } as any
      devices[clientId].status = { Components: { CIRAConnection: { Result: 'Success' } } }
      finalizeComponentResults(clientId, true)
      expect(devices[clientId].status.Components?.Activation?.Result).toEqual('NotApplicable')
    })

    it('does not backfill Activation on the failure path', () => {
      devices[clientId].status = { Status: 'Failed', Components: {} }
      finalizeComponentResults(clientId, false)
      expect(devices[clientId].status.Components?.Activation?.Result).toEqual('NotApplicable')
    })

    it('no-ops when the device has no status object', () => {
      delete (devices[clientId] as any).status
      expect(() => {
        finalizeComponentResults(clientId, true)
      }).not.toThrow()
    })
  })

  describe('applicableComponents', () => {
    it('keeps Success and Failure entries, drops NotApplicable', () => {
      const result = applicableComponents({
        Activation: { Result: 'Success', Mode: 'ACM' },
        TLS: { Result: 'Failure', Details: 'TLS handshake failed' },
        CIRAProxy: { Result: 'NotApplicable', Details: 'CIRA proxy not part of this configuration' },
        WiredNetwork: { Result: 'NotApplicable' }
      })
      expect(result).toEqual({
        Activation: { Result: 'Success', Mode: 'ACM' },
        TLS: { Result: 'Failure', Details: 'TLS handshake failed' }
      })
    })

    it('returns an empty object for undefined or all-NotApplicable input', () => {
      expect(applicableComponents(undefined)).toEqual({})
      expect(
        applicableComponents({ TLS: { Result: 'NotApplicable' }, CIRAProxy: { Result: 'NotApplicable' } })
      ).toEqual({})
    })
  })
})
