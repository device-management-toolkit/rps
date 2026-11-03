import { ActivationDiagnostics, type AttemptMetadata, type AttemptOutcome } from './ActivationDiagnostics.js'
import { DbCreatorFactory } from '../factories/DbCreatorFactory.js'
import { Environment } from '../utils/Environment.js'
import Logger from '../Logger.js'

const active = new Map<string, ActivationDiagnostics>()
const writes = new WeakMap<ActivationDiagnostics, Promise<void>>()
const logger = new Logger('ActivationDiagnostics')

export const diagnosticsFor = (clientId: string): ActivationDiagnostics | undefined => active.get(clientId)

function persist(attempt: ActivationDiagnostics): void {
  const record = attempt.snapshot()
  const next = (writes.get(attempt) ?? Promise.resolve())
    .then(async () => {
      const db = await new DbCreatorFactory().getDb()
      await db.activationAttempts.save(record, Environment.Config.diagnostics_retention_days ?? 7)
    })
    .catch(() => {
      logger.warn(
        `Unable to persist activation diagnostics ${attempt.attemptId}; check database availability and migration`
      )
    })
  writes.set(attempt, next)
}

export function startDiagnostics(clientId: string, metadata: AttemptMetadata): void {
  if (Environment.Config.diagnostics_enabled !== true) return
  finishDiagnostics(clientId, 'interrupted')
  const attempt = new ActivationDiagnostics(metadata)
  active.set(clientId, attempt)
  persist(attempt)
}

export function finishDiagnostics(clientId: string, outcome: Exclude<AttemptOutcome, 'in_progress'>): void {
  const attempt = active.get(clientId)
  if (attempt == null || !attempt.finish(outcome)) return
  active.delete(clientId)
  persist(attempt)
}

export const diagnosticsClock = (
  getClientId: () => string
): {
  setTimeout: (callback: (...args: any[]) => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void
} => {
  const pending = new Map<ReturnType<typeof setTimeout>, (success?: boolean) => void>()
  return {
    setTimeout(callback, ms) {
      const attempt = diagnosticsFor(getClientId())
      const complete = attempt?.measure('wait', { reason: 'state_machine_delay', configuredMs: ms })
      const timer = setTimeout(() => {
        pending.delete(timer)
        complete?.()
        callback()
      }, ms)
      if (complete != null) pending.set(timer, complete)
      return timer
    },
    clearTimeout(timer) {
      pending.get(timer)?.(false)
      pending.delete(timer)
      clearTimeout(timer)
    }
  }
}
