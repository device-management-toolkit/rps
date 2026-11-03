export interface IActivationAttemptsTable {
  save: (record: any, retentionDays: number) => Promise<void>
  latest: (tenantId: string, deviceId: string) => Promise<any | null>
  get: (tenantId: string, attemptId: string) => Promise<any | null>
  list: (tenantId: string, deviceId: string, limit: number) => Promise<any[]>
}
