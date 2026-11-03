import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'

export type AttemptOutcome = 'in_progress' | 'success' | 'failed' | 'interrupted'

export interface AttemptMetadata {
  tenantId: string
  deviceId: string
  amtVersion: string
  startingMode: number | null
  profileName: string | null
  tlsEnforced: boolean
  settings: Record<string, number | boolean>
}

export interface DiagnosticEvent {
  type: string
  elapsedMs: number
  durationMs?: number
  configuredMs?: number
  reason?: string
  state?: string
  actor?: string
  action?: string
  resource?: string
  outcome?: string
}

export interface WsmanRequestMeasurement {
  sequence: number
  action: string
  resource: string
  statusCode: number | null
  durationMs: number | null
  outcome: 'pending' | 'success' | 'http_error' | 'timeout' | 'transport_error' | 'interrupted'
}

export class ActivationDiagnostics {
  readonly attemptId = randomUUID()
  readonly startedAt = new Date().toISOString()
  readonly schemaVersion = 2
  readonly metadata: AttemptMetadata
  outcome: AttemptOutcome = 'in_progress'
  finishedAt: string | null = null
  private readonly started = performance.now()
  private durationMs: number | null = null
  private readonly events: DiagnosticEvent[] = []
  private readonly states = new Map<string, string>()
  private readonly openStates = new Map<string, DiagnosticEvent>()
  private readonly requests: WsmanRequestMeasurement[] = []
  private pendingRequest?: { record: WsmanRequestMeasurement; started: number }
  private requestSequence = 0
  readonly summary = {
    wsmanRequests: 0,
    wsmanRequestDurationMs: 0,
    wsmanFailures: 0,
    retries: 0,
    httpResponses: {} as Record<string, number>,
    tlsConnectionAttempts: 0,
    tlsConnectionsEstablished: 0,
    tlsConnectionFailures: 0,
    tlsConnectionDurationMs: 0,
    tlsClosures: 0,
    portSwitches: 0,
    explicitWaitMs: 0,
    requestsDropped: 0,
    eventsDropped: 0
  }

  constructor(
    metadata: AttemptMetadata,
    private readonly maxEvents = 500
  ) {
    this.metadata = { ...metadata, settings: { ...metadata.settings } }
  }

  event(type: string, details: Omit<DiagnosticEvent, 'type' | 'elapsedMs'> = {}): void {
    if (this.outcome !== 'in_progress') return
    if (this.events.length >= this.maxEvents) {
      this.summary.eventsDropped++
      return
    }
    this.events.push({ type, elapsedMs: this.elapsed(), ...details })
  }

  state(actor: string, value: unknown, status = 'active'): void {
    const state = JSON.stringify(value)
    if (state == null || this.states.get(actor) === state) return
    const previous = this.openStates.get(actor)
    if (previous != null) previous.durationMs = this.elapsed() - previous.elapsedMs
    this.states.set(actor, state)
    const event: DiagnosticEvent = { type: 'state', elapsedMs: this.elapsed(), actor, state }
    if (status !== 'active') event.durationMs = 0
    if (this.outcome === 'in_progress' && this.events.length < this.maxEvents) {
      this.events.push(event)
      if (status === 'active') this.openStates.set(actor, event)
      else this.openStates.delete(actor)
    } else if (this.outcome === 'in_progress') {
      this.summary.eventsDropped++
      this.openStates.delete(actor)
    }
  }

  response(status: number): void {
    if (this.outcome !== 'in_progress') return
    const key = String(status)
    this.summary.httpResponses[key] = (this.summary.httpResponses[key] ?? 0) + 1
    this.endRequest(status >= 200 && status < 300 ? 'success' : 'http_error', status)
  }

  beginRequest(action: string, resource: string): void {
    if (this.outcome !== 'in_progress') return
    this.endRequest('transport_error')
    const record: WsmanRequestMeasurement = {
      sequence: ++this.requestSequence,
      action,
      resource,
      statusCode: null,
      durationMs: null,
      outcome: 'pending'
    }
    this.pendingRequest = { record, started: performance.now() }
    if (this.requests.length < this.maxEvents) this.requests.push(record)
    else this.summary.requestsDropped++
  }

  endRequest(outcome: WsmanRequestMeasurement['outcome'], statusCode: number | null = null): void {
    if (this.outcome !== 'in_progress' || this.pendingRequest == null) return
    const { record, started } = this.pendingRequest
    record.durationMs = Math.max(0, Math.round(performance.now() - started))
    record.statusCode = statusCode
    record.outcome = outcome
    this.pendingRequest = undefined
  }

  measure(
    type: 'wsman' | 'tls_connect' | 'wait',
    details: Omit<DiagnosticEvent, 'type' | 'elapsedMs'> = {}
  ): (success?: boolean) => void {
    const started = performance.now()
    if (this.outcome === 'in_progress') {
      if (type === 'wsman') this.summary.wsmanRequests++
      if (type === 'tls_connect') this.summary.tlsConnectionAttempts++
    }
    let completed = false
    return (success = true) => {
      if (completed || this.outcome !== 'in_progress') return
      completed = true
      const durationMs = Math.max(0, Math.round(performance.now() - started))
      if (type === 'wsman') {
        this.summary.wsmanRequestDurationMs += durationMs
        if (!success) this.summary.wsmanFailures++
      } else if (type === 'tls_connect') {
        this.summary.tlsConnectionDurationMs += durationMs
        if (success) this.summary.tlsConnectionsEstablished++
        else this.summary.tlsConnectionFailures++
      } else {
        this.summary.explicitWaitMs += durationMs
      }
      this.event(type, { ...details, durationMs, outcome: success ? 'success' : 'failed' })
    }
  }

  finish(outcome: Exclude<AttemptOutcome, 'in_progress'>): boolean {
    if (this.outcome !== 'in_progress') return false
    this.endRequest('interrupted')
    this.durationMs = this.elapsed()
    for (const event of this.openStates.values()) event.durationMs = this.durationMs - event.elapsedMs
    this.openStates.clear()
    this.finishedAt = new Date().toISOString()
    this.outcome = outcome
    return true
  }

  snapshot(): object {
    return {
      attemptId: this.attemptId,
      ...this.metadata,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      outcome: this.outcome,
      durationMs: this.durationMs ?? this.elapsed(),
      schemaVersion: this.schemaVersion,
      summary: {
        ...this.summary,
        tlsReconnectsEstablished: Math.max(0, this.summary.tlsConnectionsEstablished - 1),
        httpResponses: { ...this.summary.httpResponses }
      },
      phases: this.events.filter((event) => event.type === 'state').map((event) => ({ ...event })),
      requests: this.requests.map((request) => ({ ...request })),
      events: this.events.map((event) => ({ ...event }))
    }
  }

  private elapsed(): number {
    return Math.max(0, Math.round(performance.now() - this.started))
  }
}
