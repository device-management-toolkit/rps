/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { vi } from 'vitest'
import { type MachineImplementationsSimplified, assign, createActor, sendTo, setup, waitFor } from 'xstate'
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

  describe('ONFAILED structured failure', () => {
    // Runs the real error machine under a minimal parent so the sendParent payload can be inspected.
    const runUnderParent = async (message: any): Promise<any> => {
      const parent = setup({
        types: {} as { context: { received?: any }; events: { type: 'ONFAILED'; output: string; failure: any } },
        actors: { error: error.machine }
      }).createMachine({
        context: {},
        initial: 'running',
        states: {
          running: {
            entry: sendTo('error-machine', { type: 'PARSE', clientId }),
            invoke: { src: 'error', id: 'error-machine', input: { message, clientId } },
            on: {
              ONFAILED: { actions: assign({ received: ({ event }) => event }), target: 'done' }
            }
          },
          done: { type: 'final' }
        }
      })
      const actor = createActor(parent).start()
      await waitFor(actor, (s) => s.matches('done'))
      return actor.getSnapshot().context.received
    }

    it('carries WSMAN_AUTH_FAILED with the HTTP status when authentication is exhausted', async () => {
      devices[clientId].unauthCount = 3
      const event = await runUnderParent(unauthorizedResponse)
      expect(event.output).toBe('Unable to authenticate with AMT')
      expect(event.failure).toEqual({
        Code: 'WSMAN_AUTH_FAILED',
        Component: 'Activation',
        Step: 'UNAUTHORIZED',
        Reason: 'AMT rejected the digest credentials (HTTP 401)',
        HttpStatus: 401
      })
    })

    it('carries WSMAN_BAD_REQUEST for a 400 response', async () => {
      const event = await runUnderParent({ statusCode: 400, statusMessage: 'Bad Request', headers: [], body: {} })
      expect(event.output).toBe('Bad Request')
      expect(event.failure).toEqual({
        Code: 'WSMAN_BAD_REQUEST',
        Component: 'Activation',
        Step: 'BADREQUEST',
        Reason: 'AMT rejected the WSMAN request as malformed (HTTP 400)',
        HttpStatus: 400,
        Detail: 'Bad Request'
      })
    })

    it('carries WSMAN_REQUEST_FAILED for an unrecognized response', async () => {
      const event = await runUnderParent(null)
      expect(event.output).toBe('Unknown error has occured')
      expect(event.failure).toMatchObject({
        Code: 'WSMAN_REQUEST_FAILED',
        Component: 'Activation',
        Step: 'UNKNOWN'
      })
    })
  })
})
