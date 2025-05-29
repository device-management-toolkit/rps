/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type AMT } from '@device-management-toolkit/wsman-messages'
import { assign, sendTo, fromPromise, setup } from 'xstate'
import { CertManager } from '../certManager.js'
import Logger from '../Logger.js'
import { type AMTConfiguration, type AMTKeyUsage, type CertAttributes } from '../models/index.js'
import { NodeForge } from '../NodeForge.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import { TimeSync } from './timeMachine.js'
import { TlsSigningAuthority } from '../models/RCS.Config.js'
import { UNEXPECTED_PARSE_ERROR } from '../utils/constants.js'
import { parseChunkedMessage } from '../utils/parseChunkedMessage.js'
import { Environment } from '../utils/Environment.js'
import {
  getCertFromEnterpriseAssistant,
  initiateCertRequest,
  sendEnterpriseAssistantKeyPairResponse
} from './enterpriseAssistant.js'
import { type CommonContext, invokeWsmanCall } from './common.js'

export interface TLSContext extends CommonContext {
  amtProfile: AMTConfiguration | null
  retryCount: number
  status: 'success' | 'error' | ''
  tlsSettingData: any[]
  tlsCredentialContext?: any
  unauthCount?: number
  amt: AMT.Messages
  keyPairHandle?: string
  authProtocol?: number
}

export interface TLSEvent {
  type: 'CONFIGURE_TLS' | 'ONFAILED'
  clientId: string
  output?: any
  error?: any
} /*  */

export class TLS {
  nodeForge: NodeForge
  logger: Logger = new Logger('TLS')
  certManager: CertManager
  error: Error = new Error()
  timeSync: TimeSync = new TimeSync()

  signCSR = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.PublicKeyManagementService.GeneratePKCS10RequestEx({
      KeyPair:
        '<a:Address>http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</a:Address><a:ReferenceParameters><w:ResourceURI>http://intel.com/wbem/wscim/1/amt-schema/1/AMT_PublicPrivateKeyPair</w:ResourceURI><w:SelectorSet><w:Selector Name="InstanceID">' +
        (input.message.response.keyInstanceId as string) +
        '</w:Selector></w:SelectorSet></a:ReferenceParameters>',
      SigningAlgorithm: 1,
      NullSignedCertificateRequest: input.message.response.csr
    })
    return await invokeWsmanCall(input, 2)
  }

  addCertificate = async ({ input }: { input: { context: TLSContext; event: TLSEvent } }): Promise<any> => {
    const clientObj = devices[input.context.clientId]
    let cert = ''
    if (
      input.context.amtProfile?.tlsSigningAuthority === TlsSigningAuthority.SELF_SIGNED ||
      input.context.amtProfile?.tlsSigningAuthority == null
    ) {
      const potentialArray = input.context.message.Envelope.Body.PullResponse.Items.AMT_PublicPrivateKeyPair
      if (Array.isArray(potentialArray)) {
        clientObj.tls.PublicPrivateKeyPair = potentialArray
      } else {
        clientObj.tls.PublicPrivateKeyPair = [potentialArray]
      }
      const PublicPrivateKeyPair = clientObj.tls.PublicPrivateKeyPair.filter(
        (x) => x.InstanceID === input.context.keyPairHandle
      )[0]
      const DERKey = PublicPrivateKeyPair?.DERKey
      const certAttributes: CertAttributes = { CN: 'AMT', O: 'None', ST: 'None', C: 'None' }
      const issuerAttributes: CertAttributes = { CN: clientObj.uuid ?? 'Untrusted Root Certificate' }

      const keyUsages: AMTKeyUsage = {
        name: 'extKeyUsage',
        '2.16.840.1.113741.1.2.1': false,
        '2.16.840.1.113741.1.2.2': false,
        '2.16.840.1.113741.1.2.3': false,
        serverAuth: true,
        clientAuth: false,
        emailProtection: false,
        codeSigning: false,
        timeStamping: false
      }
      const certResult = this.certManager.amtCertSignWithCAKey(
        DERKey,
        null,
        certAttributes,
        issuerAttributes,
        keyUsages
      )
      cert = certResult.pem.substring(27, certResult.pem.length - 25)
    } else {
      cert = input.event.output.response.certificate
    }

    input.context.xmlMessage = input.context.amt.PublicKeyManagementService.AddCertificate({ CertificateBlob: cert })

    return await invokeWsmanCall(input.context, 2)
  }

  generateKeyPair = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.PublicKeyManagementService.GenerateKeyPair({ KeyAlgorithm: 0, KeyLength: 2048 })
    return await invokeWsmanCall(input, 2)
  }

  addTrustedRootCertificate = async ({ input }): Promise<any> => {
    const tlsCerts = devices[input.clientId].ClientData.payload.profile.tlsCerts
    input.xmlMessage = input.amt.PublicKeyManagementService.AddTrustedRootCertificate({
      CertificateBlob: tlsCerts.ROOT_CERTIFICATE.certbin
    })
    return await invokeWsmanCall(input, 2)
  }

  createTLSCredentialContext = async ({ input }: { input: { context: TLSContext; event: TLSEvent } }): Promise<any> => {
    // TODO: 802.1x shoudl be set here right?
    const certHandle =
      input.event.output.Envelope.Body?.AddCertificate_OUTPUT?.CreatedCertificate?.ReferenceParameters?.SelectorSet
        ?.Selector?._ ?? 'Intel(r) AMT Certificate: Handle: 1'
    input.context.xmlMessage = input.context.amt.TLSCredentialContext.Create(certHandle)
    return await invokeWsmanCall(input.context, 2)
  }

  enumeratePublicKeyCertificate = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.PublicKeyCertificate.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullPublicKeyCertificate = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.PublicKeyCertificate.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  enumeratePublicPrivateKeyPair = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.keyPairHandle =
      input.message?.Envelope?.Body?.GenerateKeyPair_OUTPUT?.KeyPair?.ReferenceParameters?.SelectorSet?.Selector?._
    input.xmlMessage = input.amt.PublicPrivateKeyPair.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullPublicPrivateKeyPair = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.PublicPrivateKeyPair.Pull(
      input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext
    )
    return await invokeWsmanCall(input)
  }

  updateConfigurationStatus({ context }: { context: TLSContext }): void {
    if (context.status === 'success') {
      devices[context.clientId].status.TLSConfiguration = context.statusMessage
    } else if (context.status === 'error') {
      devices[context.clientId].status.TLSConfiguration = context.errorMessage !== '' ? context.errorMessage : 'Failed'
    }
  }

  enumerateTLSData = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.TLSSettingData.Enumerate()
    return await invokeWsmanCall(input, 2)
  }

  pullTLSData = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.TLSSettingData.Pull(input.message.Envelope.Body?.EnumerateResponse?.EnumerationContext)
    return await invokeWsmanCall(input)
  }

  putRemoteTLSData = async ({ input }: { input: TLSContext }): Promise<any> => {
    // Set remote TLS data on AMT
    input.tlsSettingData[0].Enabled = true
    if (
      !('NonSecureConnectionsSupported' in input.tlsSettingData[0]) ||
      input.tlsSettingData[0].NonSecureConnectionsSupported === true
    ) {
      input.tlsSettingData[0].AcceptNonSecureConnections =
        input.amtProfile?.tlsMode !== 1 && input.amtProfile?.tlsMode !== 3 // TODO: check what these values should explicitly be
    }
    input.tlsSettingData[0].MutualAuthentication = input.amtProfile?.tlsMode === 3 || input.amtProfile?.tlsMode === 4

    input.xmlMessage = input.amt.TLSSettingData.Put(input.tlsSettingData[0])
    return await invokeWsmanCall(input, 2)
  }

  putLocalTLSData = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.tlsSettingData[1].Enabled = true
    input.xmlMessage = input.amt.TLSSettingData.Put(input.tlsSettingData[1])
    return await invokeWsmanCall(input, 2)
  }

  commitChanges = async ({ input }: { input: TLSContext }): Promise<any> => {
    input.xmlMessage = input.amt.SetupAndConfigurationService.CommitChanges()
    return await invokeWsmanCall(input)
  }

  machine = setup({
    types: {} as {
      context: TLSContext
      events: TLSEvent
      actions: any
      input: TLSContext
    },
    actors: {
      timeSync: this.timeSync.machine,
      errorMachine: this.error.machine,
      enumeratePublicKeyCertificate: fromPromise(this.enumeratePublicKeyCertificate),
      pullPublicKeyCertificate: fromPromise(this.pullPublicKeyCertificate),
      signCSR: fromPromise(this.signCSR),
      addTrustedRootCertificate: fromPromise(this.addTrustedRootCertificate),
      generateKeyPair: fromPromise(this.generateKeyPair),
      enumeratePublicPrivateKeyPair: fromPromise(this.enumeratePublicPrivateKeyPair),
      pullPublicPrivateKeyPair: fromPromise(this.pullPublicPrivateKeyPair),
      addCertificate: fromPromise(this.addCertificate),
      createTLSCredentialContext: fromPromise(this.createTLSCredentialContext),
      enumerateTLSData: fromPromise(this.enumerateTLSData),
      pullTLSData: fromPromise(this.pullTLSData),
      putRemoteTLSData: fromPromise(this.putRemoteTLSData),
      putLocalTLSData: fromPromise(this.putLocalTLSData),
      commitChanges: fromPromise(this.commitChanges),
      initiateCertRequest: fromPromise(initiateCertRequest),
      getCertFromEnterpriseAssistant: fromPromise(getCertFromEnterpriseAssistant),
      sendEnterpriseAssistantKeyPairResponse: fromPromise(sendEnterpriseAssistantKeyPairResponse)
    },
    delays: {
      DELAY_TIME_TLS_PUT_DATA_SYNC: () => Environment.Config.delay_tls_put_data_sync
    },
    guards: {
      hasPublicPrivateKeyPairs: ({ context }) => context.message.Envelope.Body.PullResponse.Items !== '',
      useTLSEnterpriseAssistantCert: ({ context }) =>
        context.amtProfile?.tlsSigningAuthority === TlsSigningAuthority.MICROSOFT_CA,
      shouldRetry: ({ context, event }) => context.retryCount < 3 && event.error instanceof UNEXPECTED_PARSE_ERROR,
      alreadyExists: ({ context, event }) => {
        let exists = false
        try {
          const xmlBody = parseChunkedMessage(event.output.body.text)
          const parsed = context.httpHandler.parseXML(xmlBody)
          if (parsed.Envelope?.Body?.Fault?.Code?.Subcode?.Value?.includes('AlreadyExists')) {
            this.logger.info(parsed.envelope?.Body?.Fault?.Reason?.Text)
            exists = true
          }
        } catch (err) {
          exists = false
        }
        return exists
      }
    },
    actions: {
      'Update Configuration Status': this.updateConfigurationStatus,
      'Reset Retry Count': assign({ retryCount: () => 0 }),
      'Increment Retry Count': assign({ retryCount: ({ context }) => context.retryCount + 1 })
    }
  }).createMachine({
    id: 'tls-configuration-machine',
    initial: 'PROVISIONED',
    context: ({ input }) => ({
      clientId: input.clientId,
      amtProfile: input.amtProfile,
      httpHandler: input.httpHandler,
      message: input.message,
      xmlMessage: input.xmlMessage,
      errorMessage: input.errorMessage,
      status: input.status,
      statusMessage: input.statusMessage,
      retryCount: input.retryCount,
      amt: input.amt,
      tlsSettingData: input.tlsSettingData
    }),
    states: {
      PROVISIONED: {
        on: {
          CONFIGURE_TLS: {
            actions: ['Reset Retry Count', assign({ authProtocol: 0 })],
            target: 'ENUMERATE_PUBLIC_KEY_CERTIFICATE'
          }
        }
      },
      ENUMERATE_PUBLIC_KEY_CERTIFICATE: {
        invoke: {
          src: 'enumeratePublicKeyCertificate',
          input: ({ context }) => context,
          id: 'enumerate-public-key-certificate',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'PULL_PUBLIC_KEY_CERTIFICATE'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to enumerate public key certificates'
            }),
            target: 'FAILED'
          }
        }
      },
      PULL_PUBLIC_KEY_CERTIFICATE: {
        invoke: {
          src: 'pullPublicKeyCertificate',
          input: ({ context }) => context,
          id: 'pull-public-key-certificate',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output }),
              'Reset Retry Count'
            ],
            target: 'CHECK_CERT_MODE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_PUBLIC_KEY_CERTIFICATE'
            },
            {
              actions: assign({ errorMessage: 'Failed to pull public key certificates' }),
              target: 'FAILED'
            }
          ]
        }
      },
      CHECK_CERT_MODE: {
        always: [
          {
            guard: 'useTLSEnterpriseAssistantCert',
            target: 'ENTERPRISE_ASSISTANT_REQUEST'
          },
          'ADD_TRUSTED_ROOT_CERTIFICATE'
        ]
      },
      CHECK_CERT_MODE_AFTER_REQUEST: {
        always: [
          {
            guard: 'useTLSEnterpriseAssistantCert',
            target: 'ENTERPRISE_ASSISTANT_RESPONSE'
          },
          'ADD_CERTIFICATE'
        ]
      },
      ENTERPRISE_ASSISTANT_REQUEST: {
        invoke: {
          src: 'initiateCertRequest',
          input: ({ context }) => context,
          id: 'enterprise-assistant-request',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'GENERATE_KEY_PAIR'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to initiate cert request with enterprise assistant'
            }),
            target: 'FAILED'
          }
        }
      },
      ENTERPRISE_ASSISTANT_RESPONSE: {
        invoke: {
          src: 'sendEnterpriseAssistantKeyPairResponse',
          input: ({ context }) => context,
          id: 'enterprise-assistant-response',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'SIGN_CSR'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to send key pair to enterprise assistant'
            }),
            target: 'FAILED'
          }
        }
      },
      SIGN_CSR: {
        invoke: {
          src: 'signCSR',
          input: ({ context }) => context,
          id: 'sign-csr',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'GET_CERT_FROM_ENTERPRISE_ASSISTANT'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to have AMT sign CSR'
            }),
            target: 'FAILED'
          }
        }
      },
      GET_CERT_FROM_ENTERPRISE_ASSISTANT: {
        invoke: {
          src: 'getCertFromEnterpriseAssistant',
          input: ({ context }) => context,
          id: 'get-cert-from-enterprise-assistant',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'ADD_CERTIFICATE'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to get cert from Microsoft CA'
            }),
            target: 'FAILED'
          }
        }
      },
      ADD_TRUSTED_ROOT_CERTIFICATE: {
        invoke: {
          src: 'addTrustedRootCertificate',
          input: ({ context }) => context,
          id: 'add-trusted-root-certificate',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'GENERATE_KEY_PAIR'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to add trusted root certificates'
            }),
            target: 'FAILED'
          }
        }
      },
      GENERATE_KEY_PAIR: {
        invoke: {
          src: 'generateKeyPair',
          input: ({ context }) => context,
          id: 'generate-key-pair',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to generate key pair'
            }),
            target: 'FAILED'
          }
        }
      },
      ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'enumeratePublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'enumerate-public-private-key-pair',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to enumerate public private key pair'
            }),
            target: 'FAILED'
          }
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR: {
        invoke: {
          src: 'pullPublicPrivateKeyPair',
          input: ({ context }) => context,
          id: 'pull-public-private-key-pair',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output }),
              'Reset Retry Count'
            ],
            target: 'PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR'
            },
            {
              actions: assign({ errorMessage: 'Failed to pull public private key pair' }),
              target: 'FAILED'
            }
          ]
        }
      },
      PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE: {
        always: [
          {
            guard: 'hasPublicPrivateKeyPairs',
            target: 'CHECK_CERT_MODE_AFTER_REQUEST'
          },
          'CREATE_TLS_CREDENTIAL_CONTEXT'
        ]
      },
      ADD_CERTIFICATE: {
        invoke: {
          src: 'addCertificate',
          input: ({ context, event }) => ({ context, event }),
          id: 'add-certificate',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'CREATE_TLS_CREDENTIAL_CONTEXT'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to add certificate'
            }),
            target: 'FAILED'
          }
        }
      },
      CREATE_TLS_CREDENTIAL_CONTEXT: {
        invoke: {
          src: 'createTLSCredentialContext',
          input: ({ context, event }) => ({ context, event }),
          id: 'create-tls-credential-context',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'SYNC_TIME'
          },
          onError: [
            {
              guard: 'alreadyExists',
              target: 'SYNC_TIME'
            },
            {
              actions: assign({ errorMessage: 'Failed to create TLS credential context' }),
              target: 'FAILED'
            }
          ]
        }
      },
      SYNC_TIME: {
        entry: sendTo('time-machine', { type: 'TIMETRAVEL' }),
        invoke: {
          src: 'timeSync',
          input: ({ context }) => context,
          id: 'time-machine',
          onDone: 'ENUMERATE_TLS_DATA'
        },
        on: {
          ONFAILED: 'FAILED'
        }
      },
      ENUMERATE_TLS_DATA: {
        invoke: {
          src: 'enumerateTLSData',
          input: ({ context }) => context,
          id: 'enumerate-tls-data',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'PULL_TLS_DATA'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to enumerate TLS data'
            }),
            target: 'FAILED'
          }
        }
      },
      PULL_TLS_DATA: {
        invoke: {
          src: 'pullTLSData',
          input: ({ context }) => context,
          id: 'pull-tls-data',
          onDone: {
            actions: [
              assign({
                message: ({ event }) => event.output,
                tlsSettingData: ({ event }) => event.output.Envelope.Body.PullResponse.Items.AMT_TLSSettingData
              }),
              'Reset Retry Count'
            ],
            target: 'PUT_REMOTE_TLS_DATA'
          },
          onError: [
            {
              guard: 'shouldRetry',
              actions: 'Increment Retry Count',
              target: 'ENUMERATE_TLS_DATA'
            },
            {
              actions: assign({ errorMessage: 'Failed to pull TLS data' }),
              target: 'FAILED'
            }
          ]
        }
      },
      PUT_REMOTE_TLS_DATA: {
        invoke: {
          src: 'putRemoteTLSData',
          input: ({ context }) => context,
          id: 'put-remote-tls-data',
          onDone: {
            actions: [
              assign({
                message: ({ event }) => event.output
              })
            ],
            target: 'WAIT_A_BIT' // should this be commit_changes? and then circle back to setting local tls data
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to update remote TLS data'
            }),
            target: 'FAILED'
          }
        }
      },
      WAIT_A_BIT: {
        after: {
          DELAY_TIME_TLS_PUT_DATA_SYNC: 'PUT_LOCAL_TLS_DATA'
        }
      },
      PUT_LOCAL_TLS_DATA: {
        invoke: {
          src: 'putLocalTLSData',
          input: ({ context }) => context,
          id: 'put-local-tls-data',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'COMMIT_CHANGES'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to update local TLS data'
            }),
            target: 'FAILED'
          }
        }
      },
      COMMIT_CHANGES: {
        invoke: {
          src: 'commitChanges',
          input: ({ context }) => context,
          id: 'commit-changes',
          onDone: {
            actions: [
              assign({ message: ({ event }) => event.output })
            ],
            target: 'SUCCESS'
          },
          onError: {
            actions: assign({
              errorMessage: 'Failed to commit changes'
            }),
            target: 'FAILED'
          }
        }
      },
      ERROR: {
        entry: sendTo('error-machine', { type: 'PARSE' }),
        invoke: {
          src: 'errorMachine',
          id: 'error-machine',
          input: ({ context, event }) => ({
            message: event.output,
            clientId: context.clientId
          }),
          onDone: 'ENUMERATE_PUBLIC_KEY_CERTIFICATE' // To do: Need to test as it might not require anymore.
        },
        on: {
          ONFAILED: 'FAILED'
        }
      },
      FAILED: {
        entry: [assign({ status: () => 'error' }), 'Update Configuration Status'],
        type: 'final'
      },
      SUCCESS: {
        entry: [assign({ statusMessage: () => 'Configured', status: 'success' }), 'Update Configuration Status'],
        type: 'final'
      }
    }
  })

  constructor() {
    this.nodeForge = new NodeForge()
    this.certManager = new CertManager(new Logger('CertManager'), this.nodeForge)
  }
}
