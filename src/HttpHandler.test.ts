/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { CIM, type Common } from '@device-management-toolkit/wsman-messages'
import { HttpHandler } from './HttpHandler.js'

const httpHandler = new HttpHandler()

it('should return null when it parse empty string', async () => {
  const xml = ''
  const result = httpHandler.parseXML(xml)
  expect(result).toBe(null)
})
it('should throw an error and return null when it parse invalid xml', async () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.xmlsoap.org/ws/2004/09/enumeration" xmlns:h="http:/…xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:Address><b:ReferenceParameters><c:ResourceURI>http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ComputerSystem</c:ResourceURI><c:SelectorSet><c:Selector Name="CreationClassName">CIM_ComputerSystem</c:Selector><c:Selector Name="Name">ManagedSystem</c:Selector></c:SelectorSet></b:ReferenceParameters></h:UserOfService></h:CIM_AssociatedPowerManagementService></g:Items><g:EndOfSequence></g:EndOfSequence></g:PullResponse></a:Body></a:Envelope>'
  const result = httpHandler.parseXML(xml)
  expect(result).toBe(null)
})
it('should parse authentication response header', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",qop="auth"'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})

it('should parse authentication response header with 1 comma in value', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",qop="auth-int, auth"'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})

it('should parse authentication response header with 2 commas in value', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",qop="auth-int, auth, hot-mess"'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})
it('should parse authentication response header with no value', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",qop=""'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})

it('should parse authentication response header with rogue comma', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",qop="auth",'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})

it('should parse authentication response header with rogue double comma', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
    stale: 'false',
    qop: 'auth'
  }
  const value =
    'Digest realm="Digest:56ABC7BE224EF620C69EB88F01071DC8", nonce="fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY",stale="false",,qop="auth",'
  const result: Common.Models.DigestChallenge = httpHandler.parseAuthenticateResponseHeader(value)
  expect(JSON.stringify(result)).toBe(JSON.stringify(digestChallenge))
})

it('should return a WSMan request', async () => {
  const cim = new CIM.Messages()
  const xmlRequestBody = cim.ServiceAvailableToElement.Enumerate()
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
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
  const result = httpHandler.wrapIt(xmlRequestBody, connectionParams)
  expect(result).toContain('Authorization')
})
it('should return a null when no xml is passed to wrap a WSMan request', async () => {
  const digestChallenge = {
    realm: 'Digest:56ABC7BE224EF620C69EB88F01071DC8',
    nonce: 'fVNueyEAAAAAAAAAcO8WqJ8s+WdyFUIY',
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
  const result = httpHandler.wrapIt(null as any, connectionParams)
  expect(result).toBe(null)
})
