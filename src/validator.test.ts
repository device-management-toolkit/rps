/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { randomUUID } from 'node:crypto'

import Logger from './Logger.js'
import { config } from './test/helper/Config.js'
import { Validator } from './Validator.js'
import { Configurator } from './Configurator.js'
import { RPSError } from './utils/RPSError.js'
import { Environment } from './utils/Environment.js'
import { VersionChecker } from './VersionChecker.js'
import { devices } from './devices.js'
import { ClientAction, type ClientObject } from './models/RCS.Config.js'
import { type DeviceCredentials } from './interfaces/ISecretManagerService.js'

import { vi } from 'vitest'
Environment.Config = config
const configurator: Configurator = new Configurator()
const validator = new Validator(new Logger('Validator'), configurator)
const clientId = randomUUID()
devices[clientId] = { ClientId: clientId, ClientSocket: null as any, unauthCount: 0 } as any

let msg

describe('validator', () => {
  beforeEach(async () => {
    msg = {
      method: 'activation',
      apiKey: 'key',
      appVersion: '1.2.0',
      protocolVersion: '4.0.0',
      status: 'ok',
      message: "all's good!",
      payload: {
        ver: '11.8.50',
        build: '3425',
        fqdn: 'vprodemo.com',
        password: 'KQGnH+N5qJ8YLqjEFJMnGSgcnFLMv0Tk',
        currentMode: 0,
        certHashes: [
          'e7685634efacf69ace939a6b255b7b4fabef42935b50a265acb5cb6027e44e70',
          'eb04cf5eb1f39afa762f2bb120f296cba520c1b97db1589565b81cb9a17b7244',
          'c3846bf24b9e93ca64274c0ec67c1ecc5e024ffcacd2d74019350e81fe546ae4',
          'd7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4'
        ],
        sku: '16392',
        uuid: '4c4c4544-005a-3510-804b-b4c04f564433',
        username: '$$OsAdmin',
        client: 'RPC',
        profile: 'profile1'
      },
      tenantId: ''
    }
    await configurator.ready
  })

  describe('get Device Credentials ', () => {
    test('should get device credentials from secret provider', async () => {
      const cred = { MPS_PASSWORD: 'sOK1A4Wh$rtp!FB2', AMT_PASSWORD: 'Intel123!', MEBX_PASSWORD: 'Intel123!' }
      const getSpy = vi
        .spyOn(validator.configurator.secretsManager, 'getSecretAtPath')
        .mockImplementation(async () => cred)
      const amtDevice = await validator.getDeviceCredentials(msg)
      expect(amtDevice).toBe(cred)
      expect(getSpy).toHaveBeenCalled()
    })
    test('should return null when credentials does not exists', async () => {
      const getSpy = vi
        .spyOn(validator.configurator.secretsManager, 'getSecretAtPath')
        .mockImplementation(async () => null)
      const amtDevice = await validator.getDeviceCredentials(msg)
      expect(amtDevice).toBeNull()
      expect(getSpy).toHaveBeenCalled()
    })
    test('should return null on an exception', async () => {
      const getSpy = vi.spyOn(validator.configurator.secretsManager, 'getSecretAtPath').mockImplementation(async () => {
        throw new Error()
      })
      const amtDevice = await validator.getDeviceCredentials(msg)
      expect(amtDevice).toBeNull()
      expect(getSpy).toHaveBeenCalled()
    })
  })

  describe('verify Device Password  ', () => {
    let getSpy
    beforeEach(() => {
      const cred = { MPS_PASSWORD: 'sOK1A4Wh$rtp!FB2', AMT_PASSWORD: 'Intel123!', MEBX_PASSWORD: 'Intel123!' }
      getSpy = vi
        .spyOn(validator.configurator.secretsManager, 'getSecretAtPath')
        .mockImplementation(async () => cred as any)
    })
    test('should get device credentials from secret provider', async () => {
      const clientId = randomUUID()
      devices[clientId] = { ClientId: clientId, ClientSocket: null as any, unauthCount: 0 } as any
      msg.payload.password = 'Intel123!'
      await validator.verifyDevicePassword(msg.payload, clientId)
      expect(getSpy).toHaveBeenCalled()
    })
    test('should throw an exception when device info does not exists', async () => {
      const clientId = randomUUID()
      msg.payload.password = 'P@ssw0rd'
      let rpsError
      try {
        await validator.verifyDevicePassword(msg.payload, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`AMT password DOES NOT match stored version for Device ${msg.payload.uuid}`)
      expect(getSpy).toHaveBeenCalled()
    })
  })

  describe('verifyAMTVersion', () => {
    const testCases = [
      {
        description: 'should throw an exception if version is less than 7',
        input: { ver: '6.8.50' },
        shouldThrow: true,
        expectedError:
          'Device 4c4c4544-005a-3510-804b-b4c04f564433 activation failed. AMT version: 6.8.50. Version less than 7 cannot be remotely configured '
      },
      {
        description: 'should throw an exception if version is 11.6 and build is less than 3000',
        input: { ver: '11.6.50', build: '2425' },
        shouldThrow: true,
        expectedError:
          'Device 4c4c4544-005a-3510-804b-b4c04f564433 activation failed. Please check with your OEM for a firmware update.'
      },
      {
        description: 'should not throw an exception if version is less than 11.6 and build is great than 3000',
        input: { ver: '8.0.0', build: '3425' },
        shouldThrow: false
      },
      {
        description: 'should not throw an exception if version is greater than 11.6 and build is less than 3000',
        input: { ver: '12.0.0', build: '2425' },
        shouldThrow: false
      }
    ]

    testCases.forEach((testCase) => {
      test(testCase.description, async () => {
        msg.payload.ver = testCase.input.ver
        if (testCase.input.build) {
          msg.payload.build = testCase.input.build
        }
        if (testCase.shouldThrow) {
          expect(() => {
            validator.verifyAMTVersion(msg.payload, 'activation')
          }).toThrow(testCase.expectedError)
        } else {
          expect(() => {
            validator.verifyAMTVersion(msg.payload, 'activation')
          }).not.toThrow()
        }
      })
    })
  })

  describe('parseClientMsg function', () => {
    test('should parse and return a client activation message', () => {
      const msg = {
        apiKey: 'key',
        appVersion: '1.2.0',
        message: "all's good!",
        method: 'activation',
        payload:
          'eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=',
        protocolVersion: '4.0.0',
        status: 'ok'
      }
      VersionChecker.setCurrentVersion('4.0.0')
      const clientMsg = validator.parseClientMsg(JSON.stringify(msg), clientId)
      expect(clientMsg?.message).toEqual(msg.message)
    })

    test('check protocol version of message', () => {
      const msg =
        '{"apiKey":"key","appVersion":"1.2.0","message":"all\'s good!","method":"activation","payload":"eyJidWlsZCI6IjM0MjUiLCJjZXJ0SGFzaGVzIjpbImU3Njg1NjM0ZWZhY2Y2OWFjZTkzOWE2YjI1NWI3YjRmYWJlZjQyOTM1YjUwYTI2NWFjYjVjYjYwMjdlNDRlNzAiLCJlYjA0Y2Y1ZWIxZjM5YWZhNzYyZjJiYjEyMGYyOTZjYmE1MjBjMWI5N2RiMTU4OTU2NWI4MWNiOWExN2I3MjQ0IiwiYzM4NDZiZjI0YjllOTNjYTY0Mjc0YzBlYzY3YzFlY2M1ZTAyNGZmY2FjZDJkNzQwMTkzNTBlODFmZTU0NmFlNCIsImQ3YTdhMGZiNWQ3ZTI3MzFkNzcxZTk0ODRlYmNkZWY3MWQ1ZjBjM2UwYTI5NDg3ODJiYzgzZWUwZWE2OTllZjQiLCIxNDY1ZmEyMDUzOTdiODc2ZmFhNmYwYTk5NThlNTU5MGU0MGZjYzdmYWE0ZmI3YzJjODY3NzUyMWZiNWZiNjU4IiwiODNjZTNjMTIyOTY4OGE1OTNkNDg1ZjgxOTczYzBmOTE5NTQzMWVkYTM3Y2M1ZTM2NDMwZTc5YzdhODg4NjM4YiIsImE0YjZiMzk5NmZjMmYzMDZiM2ZkODY4MWJkNjM0MTNkOGM1MDA5Y2M0ZmEzMjljMmNjZjBlMmZhMWIxNDAzMDUiLCI5YWNmYWI3ZTQzYzhkODgwZDA2YjI2MmE5NGRlZWVlNGI0NjU5OTg5YzNkMGNhZjE5YmFmNjQwNWU0MWFiN2RmIiwiYTUzMTI1MTg4ZDIxMTBhYTk2NGIwMmM3YjdjNmRhMzIwMzE3MDg5NGU1ZmI3MWZmZmI2NjY3ZDVlNjgxMGEzNiIsIjE2YWY1N2E5ZjY3NmIwYWIxMjYwOTVhYTVlYmFkZWYyMmFiMzExMTlkNjQ0YWM5NWNkNGI5M2RiZjNmMjZhZWIiLCI5NjBhZGYwMDYzZTk2MzU2NzUwYzI5NjVkZDBhMDg2N2RhMGI5Y2JkNmU3NzcxNGFlYWZiMjM0OWFiMzkzZGEzIiwiNjhhZDUwOTA5YjA0MzYzYzYwNWVmMTM1ODFhOTM5ZmYyYzk2MzcyZTNmMTIzMjViMGE2ODYxZTFkNTlmNjYwMyIsIjZkYzQ3MTcyZTAxY2JjYjBiZjYyNTgwZDg5NWZlMmI4YWM5YWQ0Zjg3MzgwMWUwYzEwYjljODM3ZDIxZWIxNzciLCI3M2MxNzY0MzRmMWJjNmQ1YWRmNDViMGU3NmU3MjcyODdjOGRlNTc2MTZjMWU2ZTYxNDFhMmIyY2JjN2Q4ZTRjIiwiMjM5OTU2MTEyN2E1NzEyNWRlOGNlZmVhNjEwZGRmMmZhMDc4YjVjODA2N2Y0ZTgyODI5MGJmYjg2MGU4NGIzYyIsIjQ1MTQwYjMyNDdlYjljYzhjNWI0ZjBkN2I1MzA5MWY3MzI5MjA4OWU2ZTVhNjNlMjc0OWRkM2FjYTkxOThlZGEiLCI0M2RmNTc3NGIwM2U3ZmVmNWZlNDBkOTMxYTdiZWRmMWJiMmU2YjQyNzM4YzRlNmQzODQxMTAzZDNhYTdmMzM5IiwiMmNlMWNiMGJmOWQyZjllMTAyOTkzZmJlMjE1MTUyYzNiMmRkMGNhYmRlMWM2OGU1MzE5YjgzOTE1NGRiYjdmNSIsIjcwYTczZjdmMzc2YjYwMDc0MjQ4OTA0NTM0YjExNDgyZDViZjBlNjk4ZWNjNDk4ZGY1MjU3N2ViZjJlOTNiOWEiXSwiY2xpZW50IjoiUFBDIiwiY3VycmVudE1vZGUiOjAsImZxZG4iOiJ2cHJvZGVtby5jb20iLCJwYXNzd29yZCI6IktRR25IK041cUo4WUxxakVGSk1uR1NnY25GTE12MFRrIiwicHJvZmlsZSI6InByb2ZpbGUxIiwic2t1IjoiMTYzOTIiLCJ1c2VybmFtZSI6IiQkT3NBZG1pbiIsInV1aWQiOlsxNiwxNDksMTcyLDc1LDE2Niw0LDMzLDY3LDE4NiwyMjYsMjEyLDkzLDIyMyw3LDE4MiwxMzJdLCJ2ZXIiOiIxMS44LjUwIn0=","protocolVersion":"3.0.0","status":"ok"}'
      VersionChecker.setCurrentVersion('4.0.0')
      let rpsError: any = null
      try {
        validator.parseClientMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }

      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual('protocol version NOT supported: 3.0.0')
    })
  })

  describe('verifyPayload function', () => {
    test('Should return payload', async () => {
      const result = validator.verifyPayload(msg, clientId)
      expect(result).toEqual(msg.payload)
    })

    test('Should throw an exception if message is null', async () => {
      let rpsError: any = null
      try {
        validator.verifyPayload(null as any, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`${clientId} - Error while Validating the client message`)
    })

    test('Should throw an exception if uuid does not exist', async () => {
      let rpsError: any = null
      try {
        msg.payload.uuid = ''
        validator.verifyPayload(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`${clientId} - Missing uuid from payload`)
    })
  })

  describe('validate maintenance message', () => {
    let rpsError = null
    let verifyDevicePasswordSpy
    beforeEach(() => {
      vi.resetAllMocks()
      rpsError = null
      msg.method = 'maintenance'
      msg.payload.task = 'synctime'
      msg.payload.currentMode = 1
      verifyDevicePasswordSpy = vi.spyOn(validator, 'verifyDevicePassword').mockResolvedValue()
    })
    test('should pass happy path', async () => {
      try {
        await validator.validateMaintenanceMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeFalsy()
      expect(verifyDevicePasswordSpy).toHaveBeenCalled()
    })
    test('should pass with force flag', async () => {
      msg.payload.force = true
      try {
        await validator.validateMaintenanceMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeFalsy()
      expect(verifyDevicePasswordSpy).not.toHaveBeenCalled()
    })
    test('Should throw an exception if task is not specified', async () => {
      let rpsError: any = null
      msg.payload.task = ''
      try {
        await validator.validateMaintenanceMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`${clientId} - missing maintenance task in message`)
    })
    test('Should throw an exception if device is in preprovisioning state', async () => {
      let rpsError: any = null
      msg.payload.currentMode = 0
      try {
        await validator.validateMaintenanceMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`Device ${msg.payload.uuid} is in pre-provisioning mode.`)
    })
  })

  describe('Digest Realm', () => {
    test('should return true when realm valid', async () => {
      const digestRealm = 'Digest:A4070000000000000000000000000000'
      const isDigestRealmValid: boolean = validator.isDigestRealmValid(digestRealm)
      expect(isDigestRealmValid).toBe(true)
    })

    test('should return false when realm is null or undefined', async () => {
      const isDigestRealmValid: boolean = validator.isDigestRealmValid(null as any)
      expect(isDigestRealmValid).toBe(false)
    })

    test('should return false when realm does not start with Digest', async () => {
      const digestRealm = 'Gist:4AF90000000000000000000000000000'
      const isDigestRealmValid: boolean = validator.isDigestRealmValid(digestRealm)
      expect(isDigestRealmValid).toBe(false)
    })

    test('should return false when realm length is not equal to 32', async () => {
      const digestRealm = 'Digest:4AF900000000000000000000000000000'
      const isDigestRealmValid: boolean = validator.isDigestRealmValid(digestRealm)
      expect(isDigestRealmValid).toBe(false)
    })

    test('should return false when realm is not a hexadecimal', async () => {
      const digestRealm = 'Digest:4AZ90000000000000000000000000000'
      const isDigestRealmValid: boolean = validator.isDigestRealmValid(digestRealm)
      expect(isDigestRealmValid).toBe(false)
    })
  })

  describe('validate activation message', () => {
    test('should throw an exception if AMT password is undefined', async () => {
      let rpsError: any = null
      try {
        msg.payload.password = undefined
        await validator.validateActivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`Device ${msg.payload.uuid} activation failed. Missing password.`)
    })
    test('should throw an exception if profile does not match', async () => {
      const getAMTProfileSpy = vi.spyOn(configurator.profileManager, 'getAmtProfile').mockReturnValue(null as any)
      let rpsError: any = null
      try {
        msg.payload.profile = 'profile5'
        await validator.validateActivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(getAMTProfileSpy).toHaveBeenCalled()
      expect(rpsError.message).toEqual(
        `Device ${msg.payload.uuid} activation failed. ${msg.payload.profile} does not match list of available AMT profiles.`
      )
    })
    test('Should throw an exception if uuid length is not 36', async () => {
      let rpsError: any = null
      try {
        msg.payload.uuid = '4bac9510-04a6-4321-bae2-d45ddf07b68'
        await validator.validateActivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`${clientId} - uuid not valid length`)
    })
    test('Should throw an exception if uuid is empty', async () => {
      let rpsError: any = null
      try {
        msg.payload.uuid = ''
        await validator.validateActivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`${clientId} - Missing uuid from payload`)
    })
  })

  describe('validate deactivation message', () => {
    let rpsError
    let verifyAMTVersionSpy
    let verifyDevicePasswordSpy
    beforeEach(() => {
      vi.resetAllMocks()
      msg.method = 'deactivation'
      rpsError = null
      devices[clientId] = { ClientId: clientId, ClientSocket: null as any, unauthCount: 0 } as any
      verifyAMTVersionSpy = vi.spyOn(validator, 'verifyAMTVersion')
      verifyDevicePasswordSpy = vi.spyOn(validator, 'verifyDevicePassword').mockResolvedValue()
    })
    test('should throw an exception when device is already in pre-provisioning mode', async () => {
      try {
        await validator.validateDeactivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toContain('Device 4c4c4544-005a-3510-804b-b4c04f564433 is in pre-provisioning mode.')
    })
    test('should throw an exception when current mode is not 0/1/2', async () => {
      msg.payload.currentMode = 3
      try {
        await validator.validateDeactivationMsg(msg, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toContain(
        `Device ${msg.payload.uuid} deactivation failed. It is in unknown mode: ${msg.payload.currentMode}.`
      )
    })
    test('should set client data when current mode is 1', async () => {
      msg.payload.currentMode = 1
      msg.payload.force = true
      await validator.validateDeactivationMsg(msg, clientId)
      expect(verifyAMTVersionSpy).toHaveBeenCalled()
      expect(verifyDevicePasswordSpy).not.toHaveBeenCalled()
      expect(devices[clientId].ClientData).toEqual(msg)
    })
    test('should set client data when current mode is 2', async () => {
      msg.payload.currentMode = 2
      delete msg.payload.force
      await validator.validateDeactivationMsg(msg, clientId)
      expect(verifyAMTVersionSpy).toHaveBeenCalled()
      expect(verifyDevicePasswordSpy).toHaveBeenCalled()
      expect(devices[clientId].ClientData).toEqual(msg)
    })
  })

  describe('verify Activation message for ACM', () => {
    test('should throw an exception if no certHashes', async () => {
      let rpsError: any = null
      try {
        msg.payload.certHashes = undefined
        await validator.verifyActivationMsgForACM(msg)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(
        `Device ${msg.payload.uuid} activation failed. Missing certificate hashes from the device.`
      )
    })
    test('should throw an exception if no fqdn', async () => {
      let rpsError: any = null
      try {
        msg.payload.fqdn = undefined
        await validator.verifyActivationMsgForACM(msg)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`Device ${msg.payload.uuid} activation failed. Missing DNS Suffix.`)
    })
    test('should throw an exception if no fqdn (with doesDomainExist mock)', async () => {
      vi.spyOn(validator.configurator.domainCredentialManager, 'doesDomainExist').mockImplementation(async () => null)
      let rpsError: any = null
      try {
        msg.payload.fqdn = 'abcd'
        await validator.verifyActivationMsgForACM(msg)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(
        `Device ${msg.payload.uuid} activation failed. Specified AMT domain suffix: abcd does not match list of available AMT domain suffixes.`
      )
    })
    test('should not throw an exception if device already in ACM without FQDN', async () => {
      let rpsError = null
      try {
        msg.payload.fqdn = undefined
        msg.payload.currentMode = 2
        await validator.verifyActivationMsgForACM(msg)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBe(null)
    })
    test('should not throw an exception if no fqdn (with doesDomainExist mock)', async () => {
      vi.spyOn(validator.configurator.domainCredentialManager, 'doesDomainExist').mockImplementation(async () => null)
      let rpsError = null
      try {
        msg.payload.fqdn = 'abcd'
        msg.payload.currentMode = 2
        await validator.verifyActivationMsgForACM(msg)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBe(null)
    })
  })

  describe('set next steps for Configuration', () => {
    test('should set next action NETWORKCONFIG if MEBX is already set', async () => {
      const clientObj: ClientObject = {
        ClientId: clientId,
        ClientData: null,
        action: ClientAction.ADMINCTLMODE,
        activationStatus: false,
        amtPassword: null,
        unauthCount: 0
      } as any
      devices[clientId] = clientObj
      const getDevcieCredentialsSpy = vi.spyOn(validator, 'getDeviceCredentials').mockResolvedValue({
        AMT_PASSWORD: msg.payload.password,
        MEBX_PASSWORD: 'TestP{assw0rd'
      } as DeviceCredentials)
      const updateTagsSpy = vi.spyOn(validator, 'updateTags').mockResolvedValue()
      await validator.setNextStepsForConfiguration(msg, clientObj.ClientId)
      expect(clientObj.amtPassword).toBe(msg.payload.password)
      expect(clientObj.ClientData).toBe(msg)
      expect(getDevcieCredentialsSpy).toHaveBeenCalled()
      expect(updateTagsSpy).toHaveBeenCalled()
    })
    test('should set next action NETWORKCONFIG if ClientAction is CCM', async () => {
      const clientObj: ClientObject = {
        ClientId: clientId,
        ClientData: null,
        action: ClientAction.CLIENTCTLMODE,
        activationStatus: false,
        amtPassword: null,
        unauthCount: 0
      } as any
      devices[clientId] = clientObj
      const getDeviceCredentialsSpy = vi.spyOn(validator, 'getDeviceCredentials').mockResolvedValue({
        AMT_PASSWORD: msg.payload.password
      } as DeviceCredentials)
      const updateTagsSpy = vi.spyOn(validator, 'updateTags').mockResolvedValue()
      await validator.setNextStepsForConfiguration(msg, clientObj.ClientId)
      expect(clientObj.amtPassword).toBe(msg.payload.password)
      expect(clientObj.ClientData).toBe(msg)
      expect(getDeviceCredentialsSpy).toHaveBeenCalled()
      expect(updateTagsSpy).toHaveBeenCalled()
    })
  })

  describe('verify CurrentMode for activation ', () => {
    let profile
    let setNextStepsForConfigurationSpy
    beforeEach(() => {
      profile = {
        profileName: 'profile1',
        amtPassword: 'P@ssw0rd',
        activation: 'ccmactivate',
        mebxPassword: 'P@ssw0rd',
        tenantId: ''
      }
      setNextStepsForConfigurationSpy = vi.spyOn(validator, 'setNextStepsForConfiguration')
    })
    test('should set nothing when current mode is 0', async () => {
      msg.payload.currentMode = 0
      devices[clientId] = { ClientId: clientId, ClientSocket: null as any, unauthCount: 0, status: {} } as any
      await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      expect(devices[clientId].status.Status).toBeUndefined()
    })
    test('should set status as already enabled in client mode, when current mode is 1', async () => {
      msg.payload.currentMode = 1
      await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      expect(setNextStepsForConfigurationSpy).toHaveBeenCalled()
      expect(devices[clientId].status.Status).toEqual('already enabled in client mode.')
    })
    test('should set status as already enabled in admin mode, when current mode is 2', async () => {
      msg.payload.currentMode = 2
      profile.activation = 'acmactivate'
      await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      expect(setNextStepsForConfigurationSpy).toHaveBeenCalled()
      expect(devices[clientId].status.Status).toEqual('already enabled in admin mode.')
    })
    test('should throw an exception, when current mode is not 0/1/2', async () => {
      msg.payload.currentMode = 3
      let rpsError: any = null
      try {
        await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`Device ${msg.payload.uuid} activation failed. It is in unknown mode.`)
    })
    test('should throw an exception, when current mode is 1 and profile activation in acm', async () => {
      msg.payload.currentMode = 1
      profile.activation = 'acmactivate'
      await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      expect(setNextStepsForConfigurationSpy).toHaveBeenCalled()
      expect(devices[clientId].status.Status).toEqual('Upgraded to admin control mode.')
    })
    test('should throw an exception, when current mode is 2 and profile activation in ccm', async () => {
      msg.payload.currentMode = 2
      let rpsError: any = null
      try {
        await validator.verifyCurrentModeForActivation(msg, profile, clientId)
      } catch (error) {
        rpsError = error
      }
      expect(rpsError).toBeInstanceOf(RPSError)
      expect(rpsError.message).toEqual(`Device ${msg.payload.uuid} already enabled in admin control mode.`)
    })
  })
})
