import { Router, type Request, type Response, type NextFunction } from 'express'
import { param, query } from 'express-validator'
import validateMiddleware from '../../../middleware/validate.js'
import { Environment } from '../../../utils/Environment.js'
import Logger from '../../../Logger.js'
import { diagnosticViews, formatDiagnostics, type DiagnosticView } from '../../../diagnostics/formatDiagnostics.js'

const router = Router()
const logger = new Logger('ActivationAttemptsApi')

router.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store')
  if (Environment.Config.diagnostics_enabled !== true) {
    res.status(404).json({ message: 'Activation diagnostics are disabled' })
    return
  }
  if (typeof req.tenantId !== 'string') {
    res.status(403).json({ message: 'Tenant context is required' })
    return
  }
  next()
})

async function retrieve(req: Request, res: Response, kind: 'latest' | 'list' | 'detail'): Promise<void> {
  const tenantId = req.tenantId
  if (typeof tenantId !== 'string') {
    res.status(403).json({ message: 'Tenant context is required' })
    return
  }
  try {
    const table = req.db.activationAttempts
    const result =
      kind === 'latest'
        ? await table.latest(tenantId, req.query.deviceId as string)
        : kind === 'list'
          ? { attempts: await table.list(tenantId, req.query.deviceId as string, Number(req.query.limit ?? 20)) }
          : await table.get(tenantId, req.params.attemptId)
    if (result == null) {
      res.status(404).json({ message: 'Activation attempt not found' })
      return
    }
    if (kind !== 'list' && req.query.format !== 'json') {
      const view = (req.query.view ?? 'summary') as DiagnosticView
      res.status(200).type('text/plain').send(formatDiagnostics(result, view))
      return
    }
    res.status(200).json(result)
  } catch {
    logger.warn('Unable to retrieve activation diagnostics; check database availability and migration')
    res.status(503).json({ message: 'Activation diagnostics storage is unavailable' })
  }
}

router.get(
  '/latest',
  query('deviceId').isUUID('loose'),
  query('format').optional().isIn(['json', 'table']),
  query('view')
    .optional()
    .isIn([...diagnosticViews]),
  validateMiddleware,
  async (req: Request, res: Response) => {
    await retrieve(req, res, 'latest')
  }
)
router.get(
  '/',
  query('deviceId').isUUID('loose'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  validateMiddleware,
  async (req: Request, res: Response) => {
    await retrieve(req, res, 'list')
  }
)
router.get(
  '/:attemptId',
  param('attemptId').isUUID(),
  query('format').optional().isIn(['json', 'table']),
  query('view')
    .optional()
    .isIn([...diagnosticViews]),
  validateMiddleware,
  async (req: Request, res: Response) => {
    await retrieve(req, res, 'detail')
  }
)

export default router
