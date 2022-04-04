/*********************************************************************
 * Copyright (c) Intel Corporation 2019
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { CIRAConfigurator } from './CIRAConfigurator'
import { NetworkConfigurator } from './NetworkConfigurator'
import { Configurator } from '../Configurator'
import Logger from '../Logger'
import { NodeForge } from '../NodeForge'
import { ClientResponseMsg } from '../utils/ClientResponseMsg'
import { Validator } from '../Validator'
import { v4 as uuid } from 'uuid'
import { EnvReader } from '../utils/EnvReader'
import { config } from '../test/helper/Config'
import { TLSConfigurator } from './TLSConfigurator'
import { CertManager } from '../CertManager'
import { devices } from '../WebSocketListener'
import { ClientAction } from '../models/RCS.Config'
EnvReader.GlobalEnvConfig = config
const nodeForge = new NodeForge()
const certManager = new CertManager(new Logger('CertManager'), nodeForge)
const configurator = new Configurator()
const responseMsg = new ClientResponseMsg(new Logger('ClientResponseMsg'))
const validator = new Validator(new Logger('Validator'), configurator)
const tlsConfig = new TLSConfigurator(new Logger('CIRAConfig'), certManager, responseMsg)
const ciraConfig = new CIRAConfigurator(new Logger('CIRAConfig'), configurator, responseMsg, tlsConfig)
const networkConfigurator = new NetworkConfigurator(new Logger('NetworkConfig'), configurator, responseMsg, validator, ciraConfig)
let clientId, activationmsg

beforeAll(() => {
  clientId = uuid()
  activationmsg = {
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
        'd7a7a0fb5d7e2731d771e9484ebcdef71d5f0c3e0a2948782bc83ee0ea699ef4',
        '1465fa205397b876faa6f0a9958e5590e40fcc7faa4fb7c2c8677521fb5fb658',
        '83ce3c1229688a593d485f81973c0f9195431eda37cc5e36430e79c7a888638b',
        'a4b6b3996fc2f306b3fd8681bd63413d8c5009cc4fa329c2ccf0e2fa1b140305',
        '9acfab7e43c8d880d06b262a94deeee4b4659989c3d0caf19baf6405e41ab7df',
        'a53125188d2110aa964b02c7b7c6da3203170894e5fb71fffb6667d5e6810a36',
        '16af57a9f676b0ab126095aa5ebadef22ab31119d644ac95cd4b93dbf3f26aeb',
        '960adf0063e96356750c2965dd0a0867da0b9cbd6e77714aeafb2349ab393da3',
        '68ad50909b04363c605ef13581a939ff2c96372e3f12325b0a6861e1d59f6603',
        '6dc47172e01cbcb0bf62580d895fe2b8ac9ad4f873801e0c10b9c837d21eb177',
        '73c176434f1bc6d5adf45b0e76e727287c8de57616c1e6e6141a2b2cbc7d8e4c',
        '2399561127a57125de8cefea610ddf2fa078b5c8067f4e828290bfb860e84b3c',
        '45140b3247eb9cc8c5b4f0d7b53091f73292089e6e5a63e2749dd3aca9198eda',
        '43df5774b03e7fef5fe40d931a7bedf1bb2e6b42738c4e6d3841103d3aa7f339',
        '2ce1cb0bf9d2f9e102993fbe215152c3b2dd0cabde1c68e5319b839154dbb7f5',
        '70a73f7f376b60074248904534b11482d5bf0e698ecc498df52577ebf2e93b9a'
      ],
      sku: '16392',
      uuid: '4bac9510-04a6-4321-bae2-d45ddf07b684',
      username: '$$OsAdmin',
      client: 'PPC',
      profile: {
        profileName: 'acm',
        generateRandomPassword: false,
        activation: 'acmactivate',
        ciraConfigName: 'config1',
        generateRandomMEBxPassword: false,
        tags: ['acm'],
        dhcpEnabled: true,
        wifiConfigs: [
          {
            priority: 1,
            profileName: 'home'
          }
        ]
      },
      action: 'acmactivate'
    }
  }
  const digestChallenge = {
    realm: 'Digest:AF541D9BC94CFF7ADFA073F492F355E6',
    nonce: 'dxNzCQ9JBAAAAAAAd2N7c6tYmUl0FFzQ',
    stale: 'false',
    qop: 'auth'
  }
  devices[clientId] = {
    unauthCount: 0,
    ClientId: clientId,
    ClientSocket: null,
    ClientData: activationmsg,
    ciraconfig: {},
    network: {},
    status: {},
    uuid: activationmsg.payload.uuid,
    activationStatus: {},
    connectionParams: {
      guid: '4c4c4544-004b-4210-8033-b6c04f504633',
      port: 16992,
      digestChallenge: digestChallenge,
      username: 'admin',
      password: 'P@ssw0rd'
    },
    messageId: 1
  }
})

describe('process WSMan Response', () => {
  test('should return a wsman if the status code 401', async () => {
    const message = {
      payload: { statusCode: 401 }
    }
    const result = await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(result.method).toBe('wsman')
  })
  test('should return a wsman if the status code 200 for CIM_WiFiEndpointSettings enumerate response', async () => {
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '044E\r\n<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.xmlsoap.org/ws/2004/09/enumeration" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>1</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/enumeration/EnumerateResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000000A056</b:MessageID><c:ResourceURI>http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpointSettings</c:ResourceURI></a:Header><a:Body><g:EnumerateResponse><g:EnumerationContext>93340000-0000-0000-0000-000000000000</g:EnumerationContext></g:EnumerateResponse></a:Body></a:Envelope>\r\n0\r\n\r\n'
        }
      }
    }
    const result = await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(result.method).toBe('wsman')
  })
  test('should return a wsman if the status code 200 for AMT_EthernetPortSettings enumerate response', async () => {
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '0447\r\n<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.xmlsoap.org/ws/2004/09/enumeration" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>4</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/enumeration/EnumerateResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000000A05C</b:MessageID><c:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_EthernetPortSettings</c:ResourceURI></a:Header><a:Body><g:EnumerateResponse><g:EnumerationContext>95340000-0000-0000-0000-000000000000</g:EnumerationContext></g:EnumerateResponse></a:Body></a:Envelope>\r\n0\r\n\r\n'
        }
      }
    }
    const result = await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(result.method).toBe('wsman')
  })
  test('should return a wsman if the status code 200 for AMT_GeneralSettings get response', async () => {
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '0508\r\n' +
            '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://intel.com/wbem/wscim/1/amt-schema/1/AMT_GeneralSettings" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>3</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000000A06C</b:MessageID><c:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_GeneralSettings</c:ResourceURI></a:Header><a:Body><g:AMT_GeneralSettings><g:AMTNetworkEnabled>1</g:AMTNetworkEnabled><g:DDNSPeriodicUpdateInterval>1440</g:DDNSPeriodicUpdateInterval><g:DDNSTTL>900</g:DDNSTTL><g:DDNSUpdateByDHCPServerEnabled>true</g:DDNSUpdateByDHCPServerEnabled><g:DDNSUpdateEnabled>false</g:DDNSUpdateEnabled><g:DHCPv6ConfigurationTimeout>0</g:DHCPv6ConfigurationTimeout><\r\n' +
            '0348\r\n' +
            'g:DigestRealm>Digest:92E0C911AFE032A34352AD65ECA5C308</g:DigestRealm><g:DomainName></g:DomainName><g:ElementName>Intel(r) AMT: General Settings</g:ElementName><g:HostName></g:HostName><g:HostOSFQDN></g:HostOSFQDN><g:IdleWakeTimeout>1</g:IdleWakeTimeout><g:InstanceID>Intel(r) AMT: General Settings</g:InstanceID><g:NetworkInterfaceEnabled>true</g:NetworkInterfaceEnabled><g:PingResponseEnabled>true</g:PingResponseEnabled><g:PowerSource>0</g:PowerSource><g:PreferredAddressFamily>0</g:PreferredAddressFamily><g:PresenceNotificationInterval>0</g:PresenceNotificationInterval><g:PrivacyLevel>0</g:PrivacyLevel><g:RmcpPingResponseEnabled>true</g:RmcpPingResponseEnabled><g:SharedFQDN>true</g:SharedFQDN><g:ThunderboltDockEnabled>0</g:ThunderboltDockEnabled><g:WsmanOnlyMode>false</g:WsmanOnlyMode></g:AMT_GeneralSettings></a:Body></a:Envelope>\r\n' +
            '0\r\n' +
            '\r\n'
        }
      }
    }
    const result = await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(result.method).toBe('wsman')
  })
  test('should return a wsman if the status code 200 for AMT_EthernetPortSettings enumerate response', async () => {
    const clientObj = devices[clientId]
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '0508\r\n' +
            '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://intel.com/wbem/wscim/1/amt-schema/1/AMT_EthernetPortSettings" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>6</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/09/transfer/PutResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000000A06F</b:MessageID><c:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_EthernetPortSettings</c:ResourceURI></a:Header><a:Body><g:AMT_EthernetPortSettings><g:DHCPEnabled>true</g:DHCPEnabled><g:DefaultGateway>192.168.1.1</g:DefaultGateway><g:ElementName>Intel(r) AMT Ethernet Port Settings</g:ElementName><g:IPAddress>192.168.1.53</g:IPAddress><g:InstanceID>Intel(r) AMT Ethernet Port Settings 0</g:InstanceID><g:IpSyncEnabled>true</g:IpSyncEnabled><g:LinkIs\r\n' +
            '01DC\r\n' +
            'Up>true</g:LinkIsUp><g:LinkPolicy>1</g:LinkPolicy><g:LinkPolicy>14</g:LinkPolicy><g:MACAddress>a4-bb-6d-89-52-e4</g:MACAddress><g:PhysicalConnectionType>0</g:PhysicalConnectionType><g:PrimaryDNS>68.105.28.11</g:PrimaryDNS><g:SecondaryDNS>68.105.29.11</g:SecondaryDNS><g:SharedDynamicIP>true</g:SharedDynamicIP><g:SharedMAC>true</g:SharedMAC><g:SharedStaticIp>false</g:SharedStaticIp><g:SubnetMask>255.255.255.0</g:SubnetMask></g:AMT_EthernetPortSettings></a:Body></a:Envelope>\r\n' +
            '0\r\n' +
            '\r\n'
        }
      }
    }
    await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(clientObj.network.setEthernetPortSettings).toBeTruthy()
  })
  test('should return null if the status code 200 for CIM_WiFiPort', async () => {
    const clientObj = devices[clientId]
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '0444\r\n' +
            '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>7</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort/RequestStateChangeResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000001BFC6</b:MessageID><c:ResourceURI>http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort</c:ResourceURI></a:Header><a:Body><g:RequestStateChange_OUTPUT><g:ReturnValue>0</g:ReturnValue></g:RequestStateChange_OUTPUT></a:Body></a:Envelope>\r\n' +
            '0\r\n' +
            '\r\n'
        }
      }
    }
    await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(clientObj.network.setWiFiPort).toBeTruthy()
  })
  test('should change action to ciraconfig if the status code 200 for CIM_WiFiPort and return value is not 0', async () => {
    const clientObj = devices[clientId]
    const message = {
      payload: {
        statusCode: 200,
        body: {
          text: '0444\r\n' +
            '<?xml version="1.0" encoding="UTF-8"?><a:Envelope xmlns:a="http://www.w3.org/2003/05/soap-envelope" xmlns:b="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:c="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd" xmlns:d="http://schemas.xmlsoap.org/ws/2005/02/trust" xmlns:e="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:f="http://schemas.dmtf.org/wbem/wsman/1/cimbinding.xsd" xmlns:g="http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><a:Header><b:To>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</b:To><b:RelatesTo>7</b:RelatesTo><b:Action a:mustUnderstand="true">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort/RequestStateChangeResponse</b:Action><b:MessageID>uuid:00000000-8086-8086-8086-00000001BFC6</b:MessageID><c:ResourceURI>http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiPort</c:ResourceURI></a:Header><a:Body><g:RequestStateChange_OUTPUT><g:ReturnValue>1</g:ReturnValue></g:RequestStateChange_OUTPUT></a:Body></a:Envelope>\r\n' +
            '0\r\n' +
            '\r\n'
        }
      }
    }
    await networkConfigurator.processWSManJsonResponse(message, clientId)
    expect(clientObj.action).toBe(ClientAction.CIRACONFIG)
    expect(clientObj.status.Network).toBe('Ethernet Configured. WiFi Failed.')
  })
})

describe('validate WiFi Endpoint Settings', () => {
  test('should return a wsman for pull request', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/EnumerateResponse'
          },
          ResourceURI: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpointSettings'
        },
        Body: {
          EnumerateResponse: {
            EnumerationContext: '92340000-0000-0000-0000-000000000000'
          }
        }
      }
    }
    const result = await networkConfigurator.validateWiFiEndpointSettings(clientId, message)
    expect(result.method).toBe('wsman')
  })
  test('should return a wsman for pull request', async () => {
    const clientObj = devices[clientId]
    const message = {
      Envelope: {
        Header: {
          RelatesTo: 2,
          Action: {
            _: 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/PullResponse'
          },
          ResourceURI: 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_WiFiEndpointSettings'
        },
        Body: {
          PullResponse: {
            Items: '',
            EndOfSequence: ''
          }
        }
      }
    }
    const result = await networkConfigurator.validateWiFiEndpointSettings(clientId, message)
    expect(result.method).toBe('wsman')
    expect(clientObj.network.getWiFiPortCapabilities).toBeTruthy()
  })
})

describe('validate AMT General Settings', () => {
  test('should return a wsman to enumerate ethernet port settings', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: 'http://schemas.xmlsoap.org/ws/2004/09/transfer/GetResponse'
          },
          ResourceURI: 'http://intel.com/wbem/wscim/1/amt-schema/1/AMT_GeneralSettings'
        },
        Body: {
          AMT_GeneralSettings: {
            AMTNetworkEnabled: 1,
            RmcpPingResponseEnabled: true,
            SharedFQDN: false
          }
        }
      }
    }
    const result = await networkConfigurator.validateGeneralSettings(clientId, message)
    expect(result.method).toBe('wsman')
  })
})
describe('validate WifiPortConfigurationService', () => {
  it('should handle AddWiFiSettingsResponse', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: '/AddWiFiSettingsResponse'
          }
        }
      }
    }
    const result = await networkConfigurator.validateWifiPortConfiguration(clientId, message)
    expect(result).not.toBeNull()
  })
  it('should handle PutResponse', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: '/PutResponse'
          }
        },
        Body: {
          AMT_WiFiPortConfigurationService: { localProfileSynchronizationEnabled: 1 }
        }
      }
    }
    const result = await networkConfigurator.validateWifiPortConfiguration(clientId, message)
    expect(result).toBeNull()
  })
  it('should handle GetResponse when localProfileSynchronizationEnabled is 0', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: '/GetResponse'
          }
        },
        Body: {
          AMT_WiFiPortConfigurationService: {
            localProfileSynchronizationEnabled: 0
          }
        }
      }
    }
    const result = await networkConfigurator.validateWifiPortConfiguration(clientId, message)
    expect(result).not.toBeNull()
  })
  it('should handle GetResponse when localProfileSynchronizationEnabled is 1', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: '/GetResponse'
          }
        },
        Body: {
          AMT_WiFiPortConfigurationService: {
            localProfileSynchronizationEnabled: 1
          }
        }
      }
    }
    const result = await networkConfigurator.validateWifiPortConfiguration(clientId, message)
    expect(result).toBeNull()
  })
})
describe('validate Ethernet Port Settings', () => {
  test('should return a wsman to put ethernet port settings', async () => {
    const message = {
      Envelope: {
        Header: {
          Action: {
            _: 'http://schemas.xmlsoap.org/ws/2004/09/enumeration/PullResponse'
          },
          ResourceURI: 'http://intel.com/wbem/wscim/1/amt-schema/1/AMT_EthernetPortSettings'
        },
        Body: {
          PullResponse: {
            Items: {
              AMT_EthernetPortSettings: [
                {
                  DHCPEnabled: true,
                  DefaultGateway: '192.168.1.1',
                  ElementName: 'Intel(r) AMT Ethernet Port Settings',
                  IPAddress: '192.168.1.53',
                  InstanceID: 'Intel(r) AMT Ethernet Port Settings 0',
                  IpSyncEnabled: false,
                  LinkIsUp: true,
                  LinkPolicy: [
                    1,
                    14
                  ],
                  MACAddress: 'a4-bb-6d-89-52-e4',
                  PhysicalConnectionType: 0,
                  PrimaryDNS: '68.105.28.11',
                  SecondaryDNS: '68.105.29.11',
                  SharedDynamicIP: true,
                  SharedMAC: true,
                  SharedStaticIp: false,
                  SubnetMask: '255.255.255.0'
                },
                {
                  ConsoleTcpMaxRetransmissions: 5,
                  DHCPEnabled: true,
                  ElementName: 'Intel(r) AMT Ethernet Port Settings',
                  InstanceID: 'Intel(r) AMT Ethernet Port Settings 1',
                  LinkControl: 2,
                  LinkIsUp: false,
                  LinkPreference: 2,
                  MACAddress: '00-00-00-00-00-00',
                  PhysicalConnectionType: 3,
                  SharedMAC: true,
                  WLANLinkProtectionLevel: 1
                }
              ]
            },
            EndOfSequence: ''
          }
        }
      }
    }
    const result = await networkConfigurator.validateEthernetPortSettings(clientId, message)
    expect(result.method).toBe('wsman')
  })
})
