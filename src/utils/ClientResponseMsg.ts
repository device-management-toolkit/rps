import { ClientMsg } from '../RCS.Config'
import { INodeForge } from '../interfaces/INodeForge'
import { ILogger } from '../interfaces/ILogger'
import { AppVersion, ProtocolVersion } from './constants'

export class ClientResponseMsg {
  logger: ILogger
  nodeForge: INodeForge

  constructor (logger: ILogger, nodeForge: INodeForge) {
    this.logger = logger
    this.nodeForge = nodeForge
  }

  /**
 * @description builds response message to client
 * @param {string} payload
 * @param {string} clientId Id to keep track of connections
 * @returns {ClientMsg} returns message which is sent to client
 */
  get (clientId: string, payload: string, method: string, status: string, message: string): ClientMsg {
    let msg: ClientMsg
    try {
      if (method === 'error') {
        msg = { method: method, apiKey: 'xxxxx', appVersion: AppVersion, protocolVersion: ProtocolVersion, status: status, message: message, payload: payload }
      } else if (method === 'heartbeat_request') {
        msg = { method: method, apiKey: 'xxxxx', appVersion: AppVersion, protocolVersion: ProtocolVersion, status: status, message: message, payload: '' }
      } else if (method === 'success') {
        msg = { method: method, apiKey: 'xxxxx', appVersion: AppVersion, protocolVersion: ProtocolVersion, status: status, message: message, payload: payload }
      } else {
        msg = { method: method, apiKey: 'xxxxx', appVersion: AppVersion, protocolVersion: ProtocolVersion, status: status, message: message, payload: this.nodeForge.encode64(payload) }
      }
    } catch (error) {
      this.logger.error(`${clientId} : Failed to create the error message`, error)
    }
    return msg
  };
}
