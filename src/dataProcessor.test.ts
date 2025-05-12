/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'
import Logger from './Logger.js'
import { config } from './test/helper/Config.js'
import { Validator } from './Validator.js'
import { Configurator } from './Configurator.js'
import { DataProcessor } from './DataProcessor.js'
import { Environment } from './utils/Environment.js'
import { VersionChecker } from './VersionChecker.js'
import { devices } from './devices.js'
import { parse } from 'http-z'
import { HttpHandler } from './HttpHandler.js'
import { Deactivation } from './stateMachines/deactivation.js'
import { Activation } from './stateMachines/activation.js'
import { ClientMethods, type ClientMsg } from './models/RCS.Config.js'
import { Maintenance, type MaintenanceEvent } from './stateMachines/maintenance/maintenance.js'
import { ChangePasswordEventType, type ChangePasswordEvent } from './stateMachines/maintenance/changePassword.js'
// import { type IPConfiguration } from './stateMachines/syncIP.js'
import { RPSError } from './utils/RPSError.js'
// import { type HostnameConfiguration } from './stateMachines/syncHostName.js'
import { parseChunkedMessage } from './utils/parseChunkedMessage.js'
import {
  response200BadWsmanXML,
  response200Good,
  response200Incomplete,
  response200OutOfOrder,
  response400,
  response401
} from './test/helper/AMTMessages.js'
import { UNEXPECTED_PARSE_ERROR } from './utils/constants.js'
import { SyncTimeEventType } from './stateMachines/maintenance/syncTime.js'
import { type IPConfiguration, type SyncIPEvent, SyncIPEventType } from './stateMachines/maintenance/syncIP.js'
import { SyncDeviceInfoEventType, type DeviceInfo } from './stateMachines/maintenance/syncDeviceInfo.js'
import {
  type HostNameInfo,
  type SyncHostNameEvent,
  SyncHostNameEventType
} from './stateMachines/maintenance/syncHostName.js'
import { jest } from '@jest/globals'
import { spyOn } from 'jest-mock'
Environment.Config = config
const configurator = new Configurator()
const validator = new Validator(new Logger('Validator'), configurator)
const dataProcessor = new DataProcessor(new Logger('DataProcessor'), validator)
const httpHandler = new HttpHandler()
const digestChallenge = {
  realm: 'Digest:AF541D9BC94CFF7ADFA073F492F355E6',
  nonce: 'dxNzCQ9JBAAAAAAAd2N7c6tYmUl0FFzQ',
  stale: 'false',
  qop: 'auth'
}
const connectionParams = {
  guid: '4c4c4544-004b-4210-8033-b6c04f504633',
  port: 16992,
  digestChallenge,
  username: 'admin',
  password: 'P@ssw0rd'
}

describe('handle AMT response', () => {
  const clientId = randomUUID()
  devices[clientId] = {
    ClientId: clientId,
    unauthCount: 0
  } as any
  VersionChecker.setCurrentVersion('4.0.0')

  let promise
  let clientMsg
  beforeEach(() => {
    clientMsg = {}
    promise = new Promise<any>((resolve, reject) => {
      devices[clientId].resolve = resolve
      devices[clientId].reject = reject
    })
    devices[clientId].pendingPromise = promise
  })

  // it('should resolve with parsed xml payload on 200', async () => {
  //   clientMsg.payload = response200Good
  //   const response = parse(response200Good)
  //   const expected = response.body?.text ? httpHandler.parseXML(parseChunkedMessage(response.body?.text)): ''
  //   await dataProcessor.handleResponse(clientMsg, clientId)
  //   await expect(promise).resolves.toEqual(expected)
  // })
  it('should reject with UNEXPECTED_PARSE_ERROR on 200 but out of order', async () => {
    clientMsg.payload = response200OutOfOrder
    await dataProcessor.handleResponse(clientMsg, clientId)
    await expect(promise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
  it('should reject with UNEXPECTED_PARSE_ERROR on 200 but incomplete', async () => {
    clientMsg.payload = response200Incomplete
    await dataProcessor.handleResponse(clientMsg, clientId)
    await expect(promise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
  it('should reject with UNEXPECTED_PARSE_ERROR on 200 but bad wsman xml', async () => {
    clientMsg.payload = response200BadWsmanXML
    await dataProcessor.handleResponse(clientMsg, clientId)
    await expect(promise).rejects.toBeInstanceOf(UNEXPECTED_PARSE_ERROR)
  })
  it('should reject with HttpZReponseModel on 400', async () => {
    clientMsg.payload = response400
    const expected = parse(response400)
    await dataProcessor.handleResponse(clientMsg, clientId)
    try {
      const resolveVal = await devices[clientId].pendingPromise
      expect(resolveVal).toBeFalsy()
    } catch (rejectVal) {
      expect(rejectVal).toEqual(expected)
      expect(rejectVal.statusCode).toEqual(400)
    }
  })
  it('should reject with HttpZReponseModel on 401', async () => {
    clientMsg.payload = response401
    const expected = parse(response401)
    await dataProcessor.handleResponse(clientMsg, clientId)
    try {
      const resolveVal = await devices[clientId].pendingPromise
      expect(resolveVal).toBeFalsy()
    } catch (rejectVal) {
      expect(rejectVal).toEqual(expected)
      expect(rejectVal.statusCode).toEqual(401)
    }
  })
})

describe('deactivate a device', () => {
  let clientMsg
  let deactivation
  beforeEach(() => {
    clientMsg = {
      method: 'deactivate',
      apiKey: 'key',
      appVersion: '1.0.0',
      protocolVersion: '4.0.0',
      status: 'ok',
      message: 'ok',
      fqdn: '',
      payload: {
        uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
        username: '$$OsAdmin',
        password: 'P@ssw0rd',
        currentMode: 2,
        hostname: 'DESKTOP-9CC12U7',
        certHashes: ['c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4']
      }
    }
    deactivation = new Deactivation()
  })
  it('should start deactivation service', async () => {
    const validatorSpy = spyOn(dataProcessor.validator, 'validateDeactivationMsg').mockImplementation(async () => {})
    const setConnectionParamsSpy = spyOn(dataProcessor, 'setConnectionParams').mockReturnValue()
    const deactivationStartSpy = spyOn(deactivation.service, 'start').mockReturnValue(null)
    const deactivationSendSpy = spyOn(deactivation.service, 'send').mockReturnValue(null)
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null as any,
      messageId: 0,
      connectionParams,
      unauthCount: 0
    } as any
    VersionChecker.setCurrentVersion('4.0.0')
    await dataProcessor.deactivateDevice(clientMsg, clientId, deactivation)
    expect(validatorSpy).toHaveBeenCalled()
    expect(setConnectionParamsSpy).toHaveBeenCalled()
    expect(deactivationStartSpy).toHaveBeenCalled()
    expect(deactivationSendSpy).toHaveBeenCalled()
  })
})

describe('Activate a device', () => {
  let clientMsg
  let activation
  beforeEach(() => {
    clientMsg = {
      method: 'activate',
      apiKey: 'key',
      appVersion: '1.0.0',
      protocolVersion: '4.0.0',
      status: 'ok',
      message: 'ok',
      fqdn: '',
      payload: {
        uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
        username: '$$OsAdmin',
        password: 'P@ssw0rd',
        currentMode: 2,
        friendlyName: 'ImaFriend',
        hostname: 'DESKTOP-9CC12U7',
        certHashes: ['c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4']
      }
    }
    activation = new Activation()
  })
  it('should start activation service', async () => {
    const validatorSpy = spyOn(dataProcessor.validator, 'validateActivationMsg').mockImplementation(async () => {})
    const setConnectionParamsSpy = spyOn(dataProcessor, 'setConnectionParams').mockReturnValue()
    const activationStartSpy = spyOn(activation.service, 'start').mockReturnValue(null)
    const activationSendSpy = spyOn(activation.service, 'send').mockReturnValue(null)
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null as any,
      messageId: 0,
      connectionParams,
      unauthCount: 0,
      activationStatus: false
    } as any
    VersionChecker.setCurrentVersion('4.0.0')
    await dataProcessor.activateDevice(clientMsg, clientId, activation)
    expect(validatorSpy).toHaveBeenCalled()
    expect(setConnectionParamsSpy).toHaveBeenCalled()
    expect(activationStartSpy).toHaveBeenCalled()
    expect(activationSendSpy).toHaveBeenCalled()
  })
})

describe('Process data', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })
  test('Should return an error with activation message and junk payload', async () => {
    const msg =
      '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"activation","payload":"SFRUUC8xLjEgNDAxIFVuYXV0aG9yaXplZA0KV1dXLUF1dGhlbnRpY2F0ZTogRGlnZXN0IHJlYWxtPSJEaWdlc3Q6QTQwNzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCBub25jZT0id2xiRUsxRXRBQUFBQUFBQVdXNWFVSEZwK21RUTFqNjMiLHN0YWxlPSJmYWxzZSIscW9wPSJhdXRoIg0KQ29udGVudC1UeXBlOiB0ZXh0L2h0bWwNClNlcnZlcjogSW50ZWwoUikgQWN0aXZlIE1hbmFnZW1lbnQgVGVjaG5vbG9neSAxMS44LjUwLjM0MjUNCkNvbnRlbnQtTGVuZ3RoOiA2OTANCkNvbm5lY3Rpb246IGNsb3NlDQoNCjwhRE9DVFlQRSBIVE1MIFBVQkxJQyAiLS8vVzNDLy9EVEQgSFRNTCA0LjAxIFRyYW5zaXRpb25hbC8vRU4iID4KPGh0bWw+PGhlYWQ+PGxpbmsgcmVsPXN0eWxlc2hlZXQgaHJlZj0vc3R5bGVzLmNzcz4KPG1ldGEgaHR0cC1lcXVpdj0iQ29udGVudC1UeXBlIiBjb250ZW50PSJ0ZXh0L2h0bWw7IGNoYXJzZXQ9dXRmLTgiPgo8dGl0bGU+SW50ZWwmcmVnOyBBY3RpdmUgTWFuYWdlbWVudCBUZWNobm9sb2d5PC90aXRsZT48L2hlYWQ+Cjxib2R5Pgo8dGFibGUgY2xhc3M9aGVhZGVyPgo8dHI+PHRkIHZhbGlnbj10b3Agbm93cmFwPgo8cCBjbGFzcz10b3AxPkludGVsPGZvbnQgY2xhc3M9cj48c3VwPiZyZWc7PC9zdXA+PC9mb250PiBBY3RpdmUgTWFuYWdlbWVudCBUZWNobm9sb2d5Cjx0ZCB2YWxpZ249InRvcCI+PGltZyBzcmM9ImxvZ28uZ2lmIiBhbGlnbj0icmlnaHQiIGFsdD0iSW50ZWwiPgo8L3RhYmxlPgo8YnIgLz4KPGgyIGNsYXNzPXdhcm4+TG9nIG9uIGZhaWxlZC4gSW5jb3JyZWN0IHVzZXIgbmFtZSBvciBwYXNzd29yZCwgb3IgdXNlciBhY2NvdW50IHRlbXBvcmFyaWx5IGxvY2tlZC48L2gyPgoKPHA+Cjxmb3JtIE1FVEhPRD0iR0VUIiBhY3Rpb249ImluZGV4Lmh0bSI","protocolVersion":"2.0.0","status":"ok"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    const clientMsg = await dataProcessor.processData(msg, clientId)
    expect(clientMsg?.message).toContain('Error: Failed to parse client message payload.')
  })

  test('Should return an error with activation message and missing mandatory data in payload.', async () => {
    const clientMsg =
      '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"activation","payload":"ewogICAgICAgICAgICAgICAgCiAgICAgICAgICAgICAgICAiYnVpbGQiOiAiMzQyNSIsCiAgICAgICAgICAgICAgICAiZnFkbiI6ICJ2cHJvZGVtby5jb20iLAogICAgICAgICAgICAgICAgInBhc3N3b3JkIjogIktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwKICAgICAgICAgICAgICAgICJjdXJyZW50TW9kZSI6IDAsCiAgICAgICAgICAgICAgICAiY2VydEhhc2hlcyI6IFsKICAgICAgICAgICAgICAgICAgICAgICAgImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLAogICAgICAgICAgICAgICAgICAgICAgICAiZWIwNGNmNWViMWYzOWFmYTc2MmYyYmIxMjBmMjk2Y2JhNTIwYzFiOTdkYjE1ODk1NjViODFjYjlhMTdiNzI0NCIsCiAgICAgICAgICAgICAgICAgICAgICAgICJjMzg0NmJmMjRiOWU5M2NhNjQyNzRjMGVjNjdjMWVjYzVlMDI0ZmZjYWNkMmQ3NDAxOTM1MGU4MWZlNTQ2YWU0IiwKICAgICAgICAgICAgICAgICAgICAgICAgImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLAogICAgICAgICAgICAgICAgICAgICAgICAiMTQ2NWZhMjA1Mzk3Yjg3NmZhYTZmMGE5OTU4ZTU1OTBlNDBmY2M3ZmFhNGZiN2MyYzg2Nzc1MjFmYjVmYjY1OCIsCiAgICAgICAgICAgICAgICAgICAgICAgICI4M2NlM2MxMjI5Njg4YTU5M2Q0ODVmODE5NzNjMGY5MTk1NDMxZWRhMzdjYzVlMzY0MzBlNzljN2E4ODg2MzhiIiwKICAgICAgICAgICAgICAgICAgICAgICAgImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLAogICAgICAgICAgICAgICAgICAgICAgICAiOWFjZmFiN2U0M2M4ZDg4MGQwNmIyNjJhOTRkZWVlZTRiNDY1OTk4OWMzZDBjYWYxOWJhZjY0MDVlNDFhYjdkZiIsCiAgICAgICAgICAgICAgICAgICAgICAgICJhNTMxMjUxODhkMjExMGFhOTY0YjAyYzdiN2M2ZGEzMjAzMTcwODk0ZTVmYjcxZmZmYjY2NjdkNWU2ODEwYTM2IiwKICAgICAgICAgICAgICAgICAgICAgICAgIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLAogICAgICAgICAgICAgICAgICAgICAgICAiOTYwYWRmMDA2M2U5NjM1Njc1MGMyOTY1ZGQwYTA4NjdkYTBiOWNiZDZlNzc3MTRhZWFmYjIzNDlhYjM5M2RhMyIsCiAgICAgICAgICAgICAgICAgICAgICAgICI2OGFkNTA5MDliMDQzNjNjNjA1ZWYxMzU4MWE5MzlmZjJjOTYzNzJlM2YxMjMyNWIwYTY4NjFlMWQ1OWY2NjAzIiwKICAgICAgICAgICAgICAgICAgICAgICAgIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLAogICAgICAgICAgICAgICAgICAgICAgICAiNzNjMTc2NDM0ZjFiYzZkNWFkZjQ1YjBlNzZlNzI3Mjg3YzhkZTU3NjE2YzFlNmU2MTQxYTJiMmNiYzdkOGU0YyIsCiAgICAgICAgICAgICAgICAgICAgICAgICIyMzk5NTYxMTI3YTU3MTI1ZGU4Y2VmZWE2MTBkZGYyZmEwNzhiNWM4MDY3ZjRlODI4MjkwYmZiODYwZTg0YjNjIiwKICAgICAgICAgICAgICAgICAgICAgICAgIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLAogICAgICAgICAgICAgICAgICAgICAgICAiNDNkZjU3NzRiMDNlN2ZlZjVmZTQwZDkzMWE3YmVkZjFiYjJlNmI0MjczOGM0ZTZkMzg0MTEwM2QzYWE3ZjMzOSIsCiAgICAgICAgICAgICAgICAgICAgICAgICIyY2UxY2IwYmY5ZDJmOWUxMDI5OTNmYmUyMTUxNTJjM2IyZGQwY2FiZGUxYzY4ZTUzMTliODM5MTU0ZGJiN2Y1IiwKICAgICAgICAgICAgICAgICAgICAgICAgIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiCiAgICAgICAgICAgICAgICBdLAogICAgICAgICAgICAgICAgInNrdSI6ICIxNjM5MiIsCiAgICAgICAgICAgICAgICAidXVpZCI6ICI0YmFjOTUxMC0wNGE2LTQzMjEtYmFlMi1kNDVkZGYwN2I2ODQiLAogICAgICAgICAgICAgICAgInVzZXJuYW1lIjogIiQkT3NBZG1pbiIsCiAgICAgICAgICAgICAgICAiY2xpZW50IjogIlBQQyIsCiAgICAgICAgICAgICAgICAicHJvZmlsZSI6ICJwcm9maWxlMSIKICAgICAgICB9","protocolVersion":"2.0.0","status":"ok"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    const responseMsg = await dataProcessor.processData(clientMsg, clientId)
    expect(responseMsg?.message).toEqual('Error: Invalid payload from client')
  })

  it('should return an error when message method is invalid and has a activation payload', async () => {
    const clientMsg =
      '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"unknown","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"2.0.0","status":"ok"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    VersionChecker.setCurrentVersion('2.0.0')
    const responseMsg = await dataProcessor.processData(clientMsg, clientId)
    expect(responseMsg?.message).toContain('Not a supported method received from AMT device')
  })

  it('process data to activate Device', async () => {
    const clientMsg =
      '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"unknown","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"2.0.0","status":"ok"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    VersionChecker.setCurrentVersion('2.0.0')
    const ret = {
      method: ClientMethods.ACTIVATION
    }
    const clientMethodsACTIVATION = spyOn(dataProcessor.validator, 'parseClientMsg').mockReturnValue(ret)
    await dataProcessor.processData(clientMsg, clientId)
    expect(clientMethodsACTIVATION).toHaveBeenCalledTimes(1)
  })

  it('process data to deactivate Device', async () => {
    const clientMsg =
      '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"unknown","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"2.0.0","status":"ok"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    VersionChecker.setCurrentVersion('2.0.0')
    const ret = {
      method: ClientMethods.DEACTIVATION
    }
    const clientMethodsdeactivateDevice = spyOn(dataProcessor.validator, 'parseClientMsg').mockReturnValue(ret)
    clientMethodsdeactivateDevice.mockReset()
    await dataProcessor.processData(clientMsg, clientId)
    expect(clientMethodsdeactivateDevice).toHaveBeenCalledTimes(1)
  })

  it('process data to manage Device', async () => {
    // const clientMsg = '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"unknown","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"2.0.0","status":"ok"}'
    const clientMsg =
      '{"method":"maintenance --password Passw0rd! --changepassword","apiKey":"key","appVersion":"2.2.0","protocolVersion":"4.0.0","status":"ok","message":"ok","fqdn":"","payload":"eyJ2ZXIiOiIxNS4wLjIzIiwiYnVpbGQiOiIxNzA2Iiwic2t1IjoiMTYzOTIiLCJ1dWlkIjoiNGM0YzQ1NDQtMDAzNS01OTEwLTgwNGUtYjRjMDRmNTY0NDMzIiwidXNlcm5hbWUiOiIkJE9zQWRtaW4iLCJwYXNzd29yZCI6IlBhc3N3MHJkISIsImN1cnJlbnRNb2RlIjoyLCJob3N0bmFtZSI6Im9wdGlwbGV4LVUyMCIsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJjbGllbnQiOiJSUEMiLCJjZXJ0SGFzaGVzIjpbImMzODQ2YmYyNGI5ZTkzY2E2NDI3NGMwZWM2N2MxZWNjNWUwMjRmZmNhY2QyZDc0MDE5MzUwZTgxZmU1NDZhZTQiLCI0NTE0MGIzMjQ3ZWI5Y2M4YzViNGYwZDdiNTMwOTFmNzMyOTIwODllNmU1YTYzZTI3NDlkZDNhY2E5MTk4ZWRhIiwiZDdhN2EwZmI1ZDdlMjczMWQ3NzFlOTQ4NGViY2RlZjcxZDVmMGMzZTBhMjk0ODc4MmJjODNlZTBlYTY5OWVmNCIsIjE0NjVmYTIwNTM5N2I4NzZmYWE2ZjBhOTk1OGU1NTkwZTQwZmNjN2ZhYTRmYjdjMmM4Njc3NTIxZmI1ZmI2NTgiLCIyY2UxY2IwYmY5ZDJmOWUxMDI5OTNmYmUyMTUxNTJjM2IyZGQwY2FiZGUxYzY4ZTUzMTliODM5MTU0ZGJiN2Y1IiwiOWFjZmFiN2U0M2M4ZDg4MGQwNmIyNjJhOTRkZWVlZTRiNDY1OTk4OWMzZDBjYWYxOWJhZjY0MDVlNDFhYjdkZiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiNDNkZjU3NzRiMDNlN2ZlZjVmZTQwZDkzMWE3YmVkZjFiYjJlNmI0MjczOGM0ZTZkMzg0MTEwM2QzYWE3ZjMzOSIsIjIzOTk1NjExMjdhNTcxMjVkZThjZWZlYTYxMGRkZjJmYTA3OGI1YzgwNjdmNGU4MjgyOTBiZmI4NjBlODRiM2MiLCI3MGE3M2Y3ZjM3NmI2MDA3NDI0ODkwNDUzNGIxMTQ4MmQ1YmYwZTY5OGVjYzQ5OGRmNTI1NzdlYmYyZTkzYjlhIiwiNDM0OGEwZTk0NDRjNzhjYjI2NWUwNThkNWU4OTQ0YjRkODRmOTY2MmJkMjZkYjI1N2Y4OTM0YTQ0M2M3MDE2MSIsImNiM2NjYmI3NjAzMWU1ZTAxMzhmOGRkMzlhMjNmOWRlNDdmZmMzNWU0M2MxMTQ0Y2VhMjdkNDZhNWFiMWNiNWYiLCIzMWFkNjY0OGY4MTA0MTM4YzczOGYzOWVhNDMyMDEzMzM5M2UzYTE4Y2MwMjI5NmVmOTdjMmFjOWVmNjczMWQwIiwiNTUyZjdiZGNmMWE3YWY5ZTZjZTY3MjAxN2Y0ZjEyYWJmNzcyNDBjNzhlNzYxYWMyMDNkMWQ5ZDIwYWM4OTk4OCIsIjY3NTQwYTQ3YWE1YjlmMzQ1NzBhOTk3MjNjZmVmYTk2YTk2ZWUzZjBkOWI4YmY0ZGVmOTQ0MGI4MDY1ZDY2NWQiLCI3MjI0Mzk1MjIyY2Q1ODhjNGYyNjgzNzE2OTIyYWRkYjQxZTM5YjU4MWFjMzRmYTg3YjM5ZWZhODk2ZmJiMzllIiwiY2JiNTIyZDdiN2YxMjdhZDZhMDExMzg2NWJkZjFjZDQxMDJlN2QwNzU5YWY2MzVhN2NmNDcyMGRjOTYzYzUzYiIsIjE3OWZiYzE0OGEzZGQwMGZkMjRlYTEzNDU4Y2M0M2JmYTdmNTljODE4MmQ3ODNhNTEzZjZlYmVjMTAwYzg5MjQiLCIyY2FiZWFmZTM3ZDA2Y2EyMmFiYTczOTFjMDAzM2QyNTk4Mjk1MmM0NTM2NDczNDk3NjNhM2FiNWFkNmNjZjY5Il19"}'
    const clientId = randomUUID()
    devices[clientId] = {
      ClientId: clientId,
      ClientSocket: null,
      unauthCount: 0
    } as any
    VersionChecker.setCurrentVersion('2.0.0')
    const ret = {
      method: ClientMethods.MAINTENANCE
    }
    spyOn(dataProcessor.validator, 'parseClientMsg').mockReturnValue(ret)
    const manageDeviceSpy = spyOn(dataProcessor, 'maintainDevice')
    await dataProcessor.processData(clientMsg, clientId)
    expect(manageDeviceSpy).toHaveBeenCalledTimes(1)
  })
})

it('should pass maintainDevice method', async () => {
  const clientMsg: ClientMsg = {
    method: 'maintenance',
    apiKey: 'key',
    appVersion: '1.0.0',
    protocolVersion: '4.0.0',
    status: 'ok',
    message: 'ok',
    tenantId: '',
    payload: {
      task: 'synctime',
      uuid: '4c4c4544-004b-4210-8033-b6c04f504633',
      username: '$$OsAdmin',
      password: 'P@ssw0rd',
      currentMode: 2,
      hostname: 'DESKTOP-9CC12U7',
      certHashes: ['c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4']
    }
  }
  const maintenance = new Maintenance()
  const validatorSpy = spyOn(dataProcessor.validator, 'validateMaintenanceMsg').mockImplementation(async () => {})
  const cnxParamsSpy = spyOn(dataProcessor, 'setConnectionParams').mockReturnValue()
  const startSpy = spyOn(maintenance.service, 'start').mockReturnValue(null as any)
  const sendSpy = spyOn(maintenance.service, 'send').mockReturnValue(null as any)
  const clientId = randomUUID()
  devices[clientId] = {
    ClientId: clientId,
    ClientSocket: null as any,
    messageId: 0,
    connectionParams,
    unauthCount: 0
  } as any
  VersionChecker.setCurrentVersion('4.0.0')
  const expectedEvent: MaintenanceEvent = {
    type: SyncTimeEventType,
    clientId
  }
  await dataProcessor.maintainDevice(clientMsg, clientId, maintenance)
  expect(validatorSpy).toHaveBeenCalled()
  expect(cnxParamsSpy).toHaveBeenCalled()
  expect(startSpy).toHaveBeenCalled()
  expect(sendSpy).toHaveBeenCalledWith(expectedEvent)
})

describe('build maintenance event', () => {
  let clientId
  let payload
  let rpsError
  beforeEach(() => {
    clientId = randomUUID()
    payload = {}
    rpsError = null
  })
  it('should fail - build maintenance event - no payload', async () => {
    try {
      dataProcessor.buildMaintenanceEvent(clientId, null)
    } catch (error) {
      rpsError = error
    }
    expect(rpsError).toBeInstanceOf(RPSError)
    expect(rpsError.message).toEqual(`${clientId} - missing payload data`)
  })
  it('should pass - synctime', async () => {
    payload.task = 'synctime'
    const mEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect(mEvent.type).toEqual(SyncTimeEventType)
    expect(mEvent.clientId).toEqual(clientId)
  })
  it('should fail - syncip requires ipConfiguration in payload', async () => {
    payload.task = 'syncip'
    expect(() => dataProcessor.buildMaintenanceEvent(clientId, payload)).toThrow(RPSError)
  })
  it('should pass - syncip', async () => {
    const ipCfg: IPConfiguration = {
      ipAddress: '192.168.1.5',
      netmask: '255.255.255.0',
      gateway: '192.168.1.1',
      primaryDns: '8.8.8.8',
      secondaryDns: '4.4.4.4'
    }
    payload.task = 'syncip'
    payload.ipConfiguration = ipCfg
    const mEvent: MaintenanceEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect((mEvent.type = SyncIPEventType))
    expect(mEvent.clientId).toEqual(clientId)
    expect((mEvent as SyncIPEvent).targetIPConfig).toEqual(ipCfg)
  })
  it('should pass - changepassword generate random', async () => {
    payload.task = 'changepassword'
    const mEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect(mEvent.type).toEqual(ChangePasswordEventType)
    expect(mEvent.clientId).toEqual(clientId)
    expect((mEvent as ChangePasswordEvent).newStaticPassword).toBeFalsy()
  })
  it('should pass - changepassword static', async () => {
    const newPassword = 'SomeNewPassword!@#$'
    payload.task = 'changepassword'
    payload.taskArg = newPassword
    const mEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect(mEvent.type).toEqual(ChangePasswordEventType)
    expect(mEvent.clientId).toEqual(clientId)
    expect((mEvent as ChangePasswordEvent).newStaticPassword).toEqual(newPassword)
  })
  it('should pass - synchostname', async () => {
    const hostnameInfo: HostNameInfo = {
      dnsSuffixOS: 'os.suffix.test',
      hostname: 'some-test-name'
    }
    payload.task = 'synchostname'
    payload.hostnameInfo = hostnameInfo
    const mEvent: MaintenanceEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect(mEvent.type).toEqual(SyncHostNameEventType)
    expect(mEvent.clientId).toEqual(clientId)
    expect((mEvent as SyncHostNameEvent).hostNameInfo).toEqual(hostnameInfo)
  })
  it('should fail - synchostname requires hostname info', async () => {
    payload.task = 'synchostname'
    expect(() => dataProcessor.buildMaintenanceEvent(clientId, payload)).toThrow(RPSError)
  })
  it('should pass - syncdeviceinfo', async () => {
    const deviceInfo: DeviceInfo = {
      ver: '16.1.1',
      build: '1111',
      sku: '16xxx',
      currentMode: '0',
      features: 'AMT Pro Corprate',
      ipConfiguration: { ipAddress: '1.1.1.1' }
    }
    payload.task = 'syncdeviceinfo'
    payload.deviceInfo = deviceInfo
    const mEvent: MaintenanceEvent = dataProcessor.buildMaintenanceEvent(clientId, payload)
    expect(mEvent.type).toEqual(SyncDeviceInfoEventType)
    expect(mEvent.clientId).toEqual(clientId)
  })
  it('should fail - unknown task', async () => {
    payload.task = 'somerandomtask'
    try {
      dataProcessor.buildMaintenanceEvent(clientId, payload)
    } catch (error) {
      rpsError = error
    }
    expect(rpsError).toBeInstanceOf(RPSError)
    expect(rpsError.message).toEqual(`${clientId} - unknown task ${payload.task}`)
  })
})

it('process data to handle Response', async () => {
  const clientMsg =
    '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"unknown","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"2.0.0","status":"ok"}'
  const clientId = randomUUID()
  devices[clientId] = { ClientId: clientId, ClientSocket: null as any, unauthCount: 0 } as any
  VersionChecker.setCurrentVersion('2.0.0')
  const ret = {
    method: ClientMethods.RESPONSE
  }
  const clientMethodshandleResponse = spyOn(dataProcessor.validator, 'parseClientMsg').mockReturnValue(ret)
  await dataProcessor.processData(clientMsg, clientId)
  expect(clientMethodshandleResponse).toHaveBeenCalledTimes(3)
})
