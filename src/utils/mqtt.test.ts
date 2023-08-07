/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { MqttProvider } from './MqttProvider'
import { Environment } from './Environment'
import { config } from '../test/helper/Config'
import mqtt1, { type MqttClient } from 'mqtt'

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
jest.mock('mqtt', () => ({ ...jest.requireActual('mqtt') as object }))

describe('MQTT Turned ON Tests', () => {
  beforeEach(() => {
    config.mqtt_address = 'mqtt://127.0.0.1:8883'
    Environment.Config = config
    MqttProvider.instance = new MqttProvider(config)
  })

  it('Creates MQTT Helper', async () => {
    expect(MqttProvider.instance.turnedOn).toBe(true)
    expect(MqttProvider.instance.mqttUrl).toBeDefined()
    expect(MqttProvider.instance.baseUrl).toBe('mqtt://127.0.0.1:8883')
    expect(MqttProvider.instance.port).toBe(8883)
    expect(MqttProvider.instance.options).toBeDefined()
    expect(MqttProvider.instance.options.port).toBe(8883)
    // TODO: update this to check string prefix
    expect(MqttProvider.instance.options.clientId).toBeDefined()
  })
  it('Checks Connection', () => {
    jest.spyOn(mqtt1, 'connect').mockImplementation(() => ({
      connected: true
    } as any))

    expect(MqttProvider.instance.client).toBeUndefined()
    MqttProvider.instance.connectBroker()
    expect(MqttProvider.instance.client.connected).toBe(true)
  })

  it('Should send an event message when turned on', async () => {
    MqttProvider.instance.client = {
      publish: (topic, message, opts, callback) => ({} as any)
    } as any
    const spy = jest.spyOn(MqttProvider.instance.client, 'publish').mockImplementation((topic, message, opts, callback) => {
      callback(null)
      return {} as MqttClient
    })
    MqttProvider.instance.turnedOn = true
    try {
      await MqttProvider.publishEvent('success', ['testMethod'], 'Test Message')
      expect(spy).toHaveBeenCalled()
    } catch (err) {
    }
  })

  it('Should throw error when event message publish fails', async () => {
    MqttProvider.instance.client = {
      publish: (topic, message, callback) => {
        expect(topic).toEqual('rps/events')
        expect(message).toContain('testMethod')
        callback(new Error())
        return {} as any
      }
    } as any
    MqttProvider.instance.turnedOn = true

    try {
      await MqttProvider.publishEvent('success', ['testMethod'], 'Test Message')
    } catch (err) {
      expect(err?.message).toBe('Event message failed: ')
    }
  })

  it('Should close client when prompted', async () => {
    MqttProvider.instance.client = {
      connected: true,
      end: () => ({ connected: false })
    } as any

    MqttProvider.instance.turnedOn = true

    MqttProvider.endBroker()
    expect(MqttProvider.instance.client.connected).toBe(false)
  })
})

describe('MQTT Turned OFF Tests', () => {
  beforeEach(() => {
    Environment.Config = config
    MqttProvider.instance = new MqttProvider(config)
  })

  it('Should NOT Send an event message when turned off', async () => {
    MqttProvider.instance.client = {
      publish: (topic, message, callback) => ({} as any)
    } as any
    const spy = jest.spyOn(MqttProvider.instance.client, 'publish').mockImplementation((topic, message, callback) => ({} as any))
    MqttProvider.instance.turnedOn = false
    MqttProvider.publishEvent('success', ['testMethod'], 'Test Message')
    expect(spy).not.toHaveBeenCalled()
  })
})
