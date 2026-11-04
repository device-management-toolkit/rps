/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/
import Logger from '../Logger.js'

const logger = new Logger('StateTrace')

/**
 * Logs every state-machine transition under the given root actor at debug level.
 * Measurement aid for issue #2935: one log line per transition, no behavior change.
 * Promise actors are skipped; only machine snapshots carry a state value.
 */
export function traceStateTransitions(service: any, clientId: string): void {
  if (typeof service?.system?.inspect !== 'function') return
  const last = new Map<string, string>()
  const subscription = service.system.inspect((event: any) => {
    if (event.type !== '@xstate.snapshot') return
    const snapshot = event.snapshot
    if (snapshot == null || typeof snapshot.matches !== 'function') return
    const actor: string = event.actorRef?.id ?? 'unknown'
    const value = typeof snapshot.value === 'string' ? snapshot.value : JSON.stringify(snapshot.value)
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
