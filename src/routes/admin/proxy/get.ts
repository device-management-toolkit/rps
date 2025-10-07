import Logger from '../../../Logger.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { API_RESPONSE, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { ProxyConfig } from 'models/RCS.Config.js'

export async function getProxyProfile(req: Request, res: Response) {
  const { name } = req.params
  const tenantId = req.tenantId || ''
  const log = new Logger('getProxyProfile')
  try {
    const result: ProxyConfig | null = await req.db.proxyConfigs.getByName(name, tenantId)
    if (result == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('Proxy', name), NOT_FOUND_EXCEPTION)
    } else {
      MqttProvider.publishEvent('success', ['getProxyProfile'], `Sent Profile : ${name}`)
      res.status(200).json(API_RESPONSE(result)).end()
    }
  } catch (error) {
    handleError(log, 'getProxyProfile', req, res, error)
  }
}
