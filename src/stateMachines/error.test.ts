/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type MachineImplementationsSimplified, createActor } from 'xstate'
import { Error, type ErrorContext } from './error.js'
import { randomUUID } from 'node:crypto'
import { devices } from '../devices.js'

let context: ErrorContext
const clientId = randomUUID()
const unauthorizedResponse = {
  statusCode: 401,
  headers: [
    { name: 'X-Frame-Options', value: 'DENY' },
    {
      name: 'Content-Type',
      value: 'application/soap+xml; charset=UTF-8'
    },
    { name: 'Transfer-Encoding', value: 'chunked' },
    {
      name: 'Www-Authenticate',
      value:
        'Digest realm="Digest:34BF4B5A0561F95248F58509A406E046", nonce="bQali2IAAAAAAAAAn0xaWCOcxNsRcEHX",stale="false",qop="auth"'
    }
  ],
  body: {}
}

describe('Error State Machine', () => {
  let config: MachineImplementationsSimplified<ErrorContext, ErrorEvent>
  let currentStateIndex
  let error: Error
  beforeEach(() => {
    error = new Error()
    currentStateIndex = 0
    config = {
      actors: {},
      actions: {
        respondUnknown: () => {},
        respondBadRequest: () => {}
      },
      guards: {
        isBadRequest: () => false,
        isUnauthorized: () => false
      },
      delays: {}
    }
    devices[clientId] = {
      unauthCount: 0,
      ClientId: clientId,
      ClientSocket: { send: vi.fn() } as any,
      ClientData: '',
      ciraconfig: {},
      network: {},
      status: {},
      activationStatus: false,
      connectionParams: {
        guid: '4c4c4544-004b-4210-8033-b6c04f504633',
        port: 16992,
        digestChallenge: null,
        username: 'admin',
        password: 'P@ssw0rd'
      },
      uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
      messageId: 1
    } as any
    context = {
      clientId,
      message: unauthorizedResponse as any
    }
  })

  it('should eventually reach UNKNOWN', () =>
    new Promise<void>((resolve, reject) => {
      const mockerrorMachine = error.machine.provide(config)
      const flowStates = ['ERRORED', 'UNKNOWN']
      const errorService = createActor(mockerrorMachine, { input: context })
      errorService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('UNKNOWN') && currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })
      errorService.start()
      errorService.send({ type: 'PARSE', clientId })
    }))

  it('should eventually reach BADREQUEST', () =>
    new Promise<void>((resolve, reject) => {
      config.guards = {
        isBadRequest: () => true
      }
      context = {
        message: null,
        clientId
      }

      const mockerrorMachine = error.machine.provide(config)
      const flowStates = ['ERRORED', 'BADREQUEST']
      const errorService = createActor(mockerrorMachine, { input: context })
      errorService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('BADREQUEST') && currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })
      errorService.start()
      errorService.send({ type: 'PARSE', clientId })
    }))

  it('should eventually reach "AUTHORIZED"', () =>
    new Promise<void>((resolve, reject) => {
      config.guards = {}
      const mockerrorMachine = error.machine.provide(config)
      const flowStates = ['ERRORED', 'AUTHORIZED']
      const errorService = createActor(mockerrorMachine, { input: context })
      errorService.subscribe({
        next: (state) => {
          try {
            const expectedState: any = flowStates[currentStateIndex++]
            expect(state.matches(expectedState)).toBe(true)
            if (state.matches('AUTHORIZED') && currentStateIndex === flowStates.length) {
              resolve()
            }
          } catch (err) {
            reject(err)
          }
        },
        error: (err) => {
          reject(err)
        }
      })
      errorService.start()
      errorService.send({ type: 'PARSE', clientId })
    }))

  it('should add authorization header', () => {
    expect(devices[clientId].connectionParams.digestChallenge).toBeNull()
    error.addAuthorizationHeader({ context })
    expect(devices[clientId].connectionParams.digestChallenge).not.toBeNull()
  })
})
