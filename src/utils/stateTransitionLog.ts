/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import Logger from '../Logger.js'
import { type AnyActorRef, type InspectionEvent } from 'xstate'

const logger = new Logger('StateTrace')

/**
 * Logs every state-machine transition under the given root actor at debug level.
 * Emits one line when an actor state or status changes.
 * Only snapshots exposing the machine matches() method are logged.
 */
export function traceStateTransitions(service: AnyActorRef, clientId: string): void {
  if (typeof service?.system?.inspect !== 'function') return
  const last = new Map<string, string>()
  const subscription = service.system.inspect((event: InspectionEvent) => {
    if (event.type !== '@xstate.snapshot') return
    const snapshot = event.snapshot
    if (snapshot == null || !('matches' in snapshot) || typeof snapshot.matches !== 'function') return
    const actor = (event.actorRef as AnyActorRef)?.id ?? 'unknown'
    const state = 'value' in snapshot ? snapshot.value : undefined
    const value = typeof state === 'string' ? state : JSON.stringify(state)
    const key = `${value}|${snapshot.status}`
    if (last.get(actor) === key) return
    last.set(actor, key)
    logger.debug(
      `STATE client=${clientId} actor=${actor} state=${value} status=${snapshot.status} event=${event.event?.type ?? ''}`
    )
  })
  if (typeof service.subscribe === 'function') {
    const stop = (): void => {
      subscription.unsubscribe()
    }
    service.subscribe({ complete: stop, error: stop })
  }
}
