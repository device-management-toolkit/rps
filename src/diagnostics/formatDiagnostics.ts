export const diagnosticViews = [
  'requests',
  'states',
  'connections',
  'waits',
  'summary',
  'all'
] as const
export type DiagnosticView = (typeof diagnosticViews)[number]

const clean = (value: unknown): string =>
  Array.from(String(value ?? '-'), (character) => {
    const code = character.charCodeAt(0)
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : character
  })
    .join('')
    .slice(0, 160)

function duration(milliseconds: unknown): string {
  if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds) || milliseconds < 0) return 'n/a'
  const total = Math.round(milliseconds)
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const remainder = total % 1000
  if (minutes > 0) return `${minutes}m ${seconds}s${remainder > 0 ? ` ${remainder}ms` : ''}`
  if (seconds > 0) return `${seconds}s${remainder > 0 ? ` ${remainder}ms` : ''}`
  return `${remainder}ms`
}

function table(title: string, headings: string[], values: unknown[][]): string {
  const rows = [headings, ...values.map((row) => row.map(clean))]
  const widths = headings.map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  const border = `+-${widths.map((width) => '-'.repeat(width)).join('-+-')}-+`
  const line = (row: string[]): string => `| ${row.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`
  return [
    title,
    border,
    line(rows[0]),
    border,
    ...rows.slice(1).map(line),
    border,
    ...(values.length === 0 ? ['No records captured.'] : [])
  ].join('\n')
}

export function formatDiagnostics(attempt: any, view: DiagnosticView): string {
  const sections: string[] = [`Attempt: ${clean(attempt.attemptId)}   Outcome: ${clean(attempt.outcome)}`]
  const events = attempt.events ?? []
  const include = (name: DiagnosticView): boolean => view === name || view === 'all'
  if (include('requests')) {
    const legacy = !Array.isArray(attempt.requests)
    const requests = legacy
      ? events
          .filter((event: any) => event.type === 'wsman_request')
          .map((event: any, index: number) => ({
            sequence: index + 1,
            action: event.action,
            resource: event.resource,
            statusCode: null,
            durationMs: null,
            outcome: 'not recorded'
          }))
      : attempt.requests
    sections.push(
      table(
        'WS-Man Requests',
        [
          '#',
          'Action',
          'Resource',
          'HTTP',
          'Duration',
          'Result'
        ],
        requests.map((request: any) => [
          request.sequence,
          request.action,
          request.resource,
          request.statusCode ?? '-',
          duration(request.durationMs),
          request.outcome
        ])
      )
    )
    if (legacy)
      sections.push(
        'Request-only timing was not recorded for this older capture. Run activation with the updated build.'
      )
    if (attempt.summary?.requestsDropped > 0)
      sections.push(`Additional requests omitted: ${attempt.summary.requestsDropped}`)
  }
  if (include('states')) {
    const states = attempt.phases ?? events.filter((event: any) => event.type === 'state')
    sections.push(
      table(
        'State Timings',
        [
          '#',
          'Actor',
          'State',
          'Duration'
        ],
        states.map((event: any, index: number) => [
          index + 1,
          event.actor,
          event.state,
          duration(event.durationMs)
        ])
      )
    )
    sections.push('Parent and child state durations overlap; do not sum them.')
  }
  if (include('connections')) {
    const connections = events.filter((event: any) => [
        'tls_connect',
        'tls_close',
        'connection_reset',
        'port_switch'
      ].includes(event.type))
    sections.push(
      table(
        'Connections',
        [
          '#',
          'Event',
          'Reason',
          'Duration',
          'Result'
        ],
        connections.map((event: any, index: number) => [
          index + 1,
          event.type,
          event.reason,
          event.durationMs == null ? '-' : duration(event.durationMs),
          event.outcome
        ])
      )
    )
  }
  if (include('waits')) {
    sections.push(
      table(
        'Waits',
        [
          '#',
          'Reason',
          'Configured',
          'Duration',
          'Result'
        ],
        events
          .filter((event: any) => event.type === 'wait')
          .map((event: any, index: number) => [
            index + 1,
            event.reason,
            duration(event.configuredMs),
            duration(event.durationMs),
            event.outcome
          ])
      )
    )
  }
  if (include('summary')) {
    sections.push(
      table(
        'Activation Summary',
        ['Metric', 'Value'],
        [
          ['Total activation duration', duration(attempt.durationMs)],
          ...Object.entries(attempt.summary ?? {}).map(([key, value]) => [
            key.endsWith('Ms') ? key.slice(0, -2) : key,
            key.endsWith('Ms') ? duration(value) : typeof value === 'object' ? JSON.stringify(value) : value
          ])
        ]
      )
    )
    sections.push(
      table(
        'Settings',
        ['Setting', 'Value'],
        Object.entries(attempt.settings ?? {}).map(([key, value]) => {
          if (key.endsWith('Ms')) return [key.slice(0, -2), duration(value)]
          if (key.endsWith('Seconds') && typeof value === 'number') return [key.slice(0, -7), duration(value * 1000)]
          return [key, value]
        })
      )
    )
  }
  if (view === 'all' && attempt.summary?.eventsDropped > 0) {
    sections.push(`Additional diagnostic events omitted: ${attempt.summary.eventsDropped}`)
  }
  return `${sections.join('\n\n')}\n`
}
