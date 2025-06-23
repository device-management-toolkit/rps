/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { AMT } from '@device-management-toolkit/wsman-messages'
import { assign, createActor, sendTo, fromPromise, setup } from 'xstate'
import { Configurator } from '../Configurator.js'
import { HttpHandler } from '../HttpHandler.js'
import Logger from '../Logger.js'
import ClientResponseMsg from '../utils/ClientResponseMsg.js'
import { Environment } from '../utils/Environment.js'
import { devices } from '../devices.js'
import { Error } from './error.js'
import got, { type Got } from 'got'
import { type CommonContext, invokeWsmanCall } from './common.js'

export interface DeactivationContext extends CommonContext {
  unauthCount: number
  status: 'success' | 'error'
  tenantId: string
}

export interface DeactivationEvent {
  type: 'UNPROVISION' | 'ONFAILED'
  clientId: string
  tenantId: string
  output: any
  error: any
}
export class Deactivation {
  configurator: Configurator
  amt: AMT.Messages
  logger: Logger
  error: Error = new Error()
  context: DeactivationContext
  gotClient: Got

  invokeUnprovision = async ({ input }: { input: DeactivationContext }): Promise<any> => {
    input.xmlMessage = this.amt.SetupAndConfigurationService.Unprovision(1)
    return await invokeWsmanCall(input)
  }

  removeDeviceFromSecretProvider = async ({ input }: { input: DeactivationContext }): Promise<boolean> =>
    await this.configurator.secretsManager.deleteSecretAtPath(`devices/${devices[input.clientId].uuid}`)

  removeDeviceFromMPS = async ({ input }: { input: DeactivationContext }): Promise<any> =>
    await got(
      `${Environment.Config.mps_server}/api/v1/devices/${devices[input.clientId].uuid}?tenantId=${input.tenantId}`,
      {
        method: 'DELETE'
      }
    )

  sendMessageToDevice = ({ context }: { context: DeactivationContext }): void => {
    const { clientId, status } = context
    const clientObj = devices[clientId]
    let method: 'failed' | 'success' | 'ok' | 'heartbeat' = 'success' // TODO: Get rid of redundant data (i.e. Method and Status)
    if (status === 'success') {
      clientObj.status.Status = context.statusMessage !== '' ? context.statusMessage : 'Deactivated'
      method = 'success'
    } else if (status === 'error') {
      clientObj.status.Status = context.errorMessage !== '' ? context.errorMessage : 'Failed'
      method = 'failed'
    }

    const responseMessage = ClientResponseMsg.get(clientId, null, status, method, JSON.stringify(clientObj.status))
    if (clientObj.ClientSocket) {
      clientObj.ClientSocket.send(JSON.stringify(responseMessage))
    } else {
      this.logger.error('No client socket')
    }
  }

  machine = setup({
    types: {} as {
      context: DeactivationContext
      events: DeactivationEvent
      actions: any
      input: DeactivationContext
    },
    actors: {
      invokeUnprovision: fromPromise(this.invokeUnprovision),
      removeDeviceFromSecretProvider: fromPromise(this.removeDeviceFromSecretProvider),
      removeDeviceFromMPS: fromPromise(this.removeDeviceFromMPS),
      errorMachine: this.error.machine
    },
    actions: {
      'Reset Unauth Count': ({ context }) => {
        devices[context.clientId].unauthCount = 0
      },
      'Send Message to Device': this.sendMessageToDevice
    },
    guards: {
      isNotFound: ({ context, event }) => {
        const { message } = context
        if (message.toString().includes('HTTPError: Response code 404')) {
          return true
        }
        return false
      }
    }
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5QBEwEMDGAXAlgNzVwHsA7AAgFlMALHEsAOgAUAlAeQDUBJAZS7YByAUWQBiAKoDWnXvwEBtAAwBdRKAAORWDmIk1IAB6IArADYAHAwBMAFjNWAnFYCM551YDMDgDQgAnogAtG4MNjaKHoqmxsbm4Yo2zgC+Sb6omLgEupQ0dIyS0tx8glwCAOKiEKSMdHhEANaMsGAkEIEAriTqAE5EeDjapIEAtnCwaDBKqkggmtq6+kYI7jYO1g5uiooOzgDsuw6KVr4BCIGu1h77ux5Wu6YbHnu7KWno2PiEOKQ5GLT0DAK7CKclKFTA3V63QY6gANoQAGZEbrDBjNVodLq9fqDEgjMYTMBTfRzHTfPQzJYODymUKRKxWB7GBL7DwnRDmYwMLxuXZxUw2PlPZKpEDpD5Zcm-f6MFhCCicIQAfWQQm4AGFlQAxdgUJU8ITquUAFSVhS4qpYlWqDFqDUY3TAwz6YECEDA-QwroRvWGgWaGEdWECPT6OHd3WJM1JC0piGcTmcDAepiOCbijNMbP8QQ8XOMDl2il2LlMpn25gFxleYvemS+PyofzyDDlCo4ytVGu1uv1hpNZuBFqEVohUJh8KwSJRDEdzrwrvdnu9vv9YEDYGDof6EajGi0ZNIi3jMUs1PMDlT6burnZCBCqfCt0F5lu21MNfF9eyTZlrflioqmqXCakqOpsHqBpGkIprmpaYEAIJcAAMuIcqiHuswHrGoBLAyuxcqYVjGK4igXsy5ivne7hcrszjGDYeY0k8NhWJWn51p8P65ACbaAV2IE9hBfbQbBQ7wVqSGoeh8jONM+7zOSx4IPhayljcWzEc8pjUTcDD3FY2x7LEqzmC8opflxUq-i2fEdkB3Zgb2FBMDw1oAnajSzk6Lpuh6OBeoEPpEH6wzqLAmExkpcYqeWHgMAk0QeHEJE0dmpzOEmApuLcBZRBsBweBxGRWY2PGygB9kCaB4F6i5bljsiE6IsiqJzr5S4BSuIUjOFkXYdFuGILYsTWEcdG2IKjgeDYd6eEmbjmHc4QEVWWbFRKDbkDZvGVZ2wE1c5rmIShaFCBhKgkgNR4xY41IMA4iSrCWTixIW1FLcmZhFjsjiuJl5lvCVkplc2u3tvtjm1Uq9UndJ52yfJWGKTdQ0qQ4hYMMYHgsXcLiRLNOYqclDBxM44TY7yhmsRt37WeVDAjuwVpVB5JB1F5jXdCM5X9SjFJo2YlgjURiZuJ4PhE5y3IbHs-IvrctOldtDNM2wo6Qk1cItTOXM82DRKXdG10C4Y8b0UmzgzREhnGHy553jjVgPU8qZHI4Nx5krIMqwbjMsMzoiCJJKEiHzh6m1SlYMFbDipZEhyPeYjvEQlCZ7Ey9wCjYKSiiQRDuvAMyWT70p5Fd-PKTNakCuWlY7Io9HHET5wWMmDIJvcBbMjNH4WZxpc7Yw5rFMIyAVxHVeY4yNh1w8ziN8YzenIEdik69ZYMYZURW33QObdxftAjIo9ghPOFm-e2Pcs+uyCtjtiZXegRL8mZlk84WbUnb3tbWX4P8QOkJSC-YYKDhkJac+g1L5N1opELwsRO57GXkEV+Fg+SJE-l4PMgNazAz-kPf8EMHKCScsJKCA44IjjhmdKBqMYFLzWHRGkNgzJx2iEtai91wiuAYvyHGBxqz93wYfP8dlIakOhvVOhkdhrV1JmRLYTxbjz2flmfS9FGJmVWNSBIOdhEH3pn7cRJDDrCVhiHeGMjlKOHCA9VwGNnxbDcITU4OM1g8OiFmPkmUGS-1ES2Y+IJBAiGsbdbK+k8x2D5FsTKlY7zS2WmZVMAoEyKCEfvOmoM-xqxYGEtGF4bD6TuHEJwRxqSSwymWbkBElpWwYnfDGGS8GGOyS2SxoTjaVxiuTHG69yKnlTI9VxiAWJY00eEbRlE2LmRSEAA */
    context: ({ input }) => ({
      message: input.message,
      clientId: input.clientId,
      status: input.status,
      unauthCount: 0,
      xmlMessage: input.xmlMessage,
      errorMessage: input.errorMessage,
      statusMessage: '',
      tenantId: input.tenantId,
      httpHandler: new HttpHandler()
    }),
    id: 'Deactivation Machine',
    initial: 'PROVISIONED',
    states: {
      PROVISIONED: {
        on: {
          UNPROVISION: {
            actions: [
              assign({
                clientId: ({ event }) => event.clientId,
                tenantId: ({ event }) => event.tenantId
              }),
              'Reset Unauth Count'
            ],
            target: 'UNPROVISIONING'
          }
        }
      },
      UNPROVISIONING: {
        invoke: {
          src: 'invokeUnprovision',
          input: ({ context }) => context,
          id: 'send-unprovision-message',
          onDone: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER',
          onError: 'ERROR'
        }
      },
      REMOVE_DEVICE_FROM_SECRET_PROVIDER: {
        invoke: {
          src: 'removeDeviceFromSecretProvider',
          input: ({ context }) => context,
          id: 'remove-device-from-secret-provider',
          onDone: 'REMOVE_DEVICE_FROM_MPS',
          onError: {
            actions: assign({ message: ({ event }) => (event as any).error }),
            target: 'REMOVE_DEVICE_FROM_SECRET_PROVIDER_FAILURE'
          }
        }
      },
      REMOVE_DEVICE_FROM_SECRET_PROVIDER_FAILURE: {
        always: [
          {
            guard: 'isNotFound',
            target: 'REMOVE_DEVICE_FROM_MPS'
          },
          {
            actions: assign({ errorMessage: () => 'Failed to remove device from secret provider' }),
            target: 'FAILED'
          }
        ]
      },
      REMOVE_DEVICE_FROM_MPS: {
        invoke: {
          src: 'removeDeviceFromMPS',
          input: ({ context }) => context,
          id: 'remove-device-from-mps',
          onDone: 'UNPROVISIONED',
          onError: {
            actions: assign({ message: ({ event }) => (event as any).error }),
            target: 'REMOVE_DEVICE_FROM_MPS_FAILURE'
          }
        }
      },
      REMOVE_DEVICE_FROM_MPS_FAILURE: {
        always: [
          {
            guard: 'isNotFound',
            target: 'UNPROVISIONED'
          },
          {
            actions: assign({ statusMessage: () => 'Deactivated. MPS Unavailable.' }),
            target: 'UNPROVISIONED'
          }
        ]
      },
      UNPROVISIONED: {
        type: 'final',
        entry: [assign({ status: () => 'success' }), 'Send Message to Device']
      },
      ERROR: {
        invoke: {
          id: 'error-machine',
          src: 'errorMachine',
          input: ({ context, event }) => ({
            message: event.error,
            clientId: context.clientId
          }),
          onDone: 'UNPROVISIONING',
          onError: 'FAILED'
        },
        entry: sendTo('error-machine', { type: 'PARSE' }),
        on: {
          ONFAILED: {
            actions: assign({ errorMessage: ({ event }) => event.output }),
            target: 'FAILED'
          }
        }
      },
      FAILED: {
        entry: [assign({ status: () => 'error' }), 'Send Message to Device'],
        type: 'final'
      }
    }
  })

  service = createActor(this.machine, { input: {} as any })

  constructor() {
    this.configurator = new Configurator()
    this.amt = new AMT.Messages()
    this.logger = new Logger('Deactivation State Machine')
  }
}
