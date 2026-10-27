/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import express from 'express'
import cors from 'cors'
import Logger from './Logger.js'
import { WebSocketListener } from './WebSocketListener.js'
import { Configurator } from './Configurator.js'
import { Environment } from './utils/Environment.js'
import { type RPSConfig } from './models/index.js'
import routes from './routes/index.js'
import { MqttProvider } from './utils/MqttProvider.js'
import { DbCreatorFactory } from './factories/DbCreatorFactory.js'
import { backOff } from 'exponential-backoff'
import { type ISecretManagerService } from './interfaces/ISecretManagerService.js'
import { type IDB } from './interfaces/database/IDb.js'
import { WSEnterpriseAssistantListener } from './WSEnterpriseAssistantListener.js'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { processServiceConfigs, waitForServiceManager } from './serviceManager.js'
import { ConsulService } from './consulService.js'
import { type IServiceManager } from './interfaces/IServiceManager.js'
import path from 'node:path'
import { URL, fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const log = new Logger('Index')

const app = express()
app.set('query parser', 'extended')
app.use(cors())
app.use(express.urlencoded({ extended: true }))
app.use(express.json())

export const waitForDB = async function (db: IDB): Promise<void> {
  await backOff(async () => await db.query('SELECT 1'), {
    retry: (e: any, attemptNumber: number) => {
      log.info(`waiting for db[${attemptNumber}] ${e.code || e.message || e}`)
      return true
    }
  })
}

export const waitForSecretsManager = async function (secretsManager: ISecretManagerService): Promise<void> {
  await backOff(async () => await secretsManager.health(), {
    retry: (e: any, attemptNumber: number) => {
      log.info(`waiting for secret manager service[${attemptNumber}] ${e.message || e.code || e}`)
      return true
    }
  })
}

export const startItUp = (): void => {
  const configurator = new Configurator()
  log.silly(`WebSocket Cert Info ${JSON.stringify(Environment.Config)}`)
  const serverForEnterpriseAssistant: WSEnterpriseAssistantListener = new WSEnterpriseAssistantListener(
    new Logger('WSEnterpriseAssistantListener')
  )
  const server: WebSocketListener = new WebSocketListener(new Logger('WebSocketListener'), configurator.dataProcessor)

  const mqtt: MqttProvider = new MqttProvider(Environment.Config)
  mqtt.connectBroker()

  const dbFactory = new DbCreatorFactory()

  const loadCustomMiddleware = async function (): Promise<express.RequestHandler[]> {
    const pathToCustomMiddleware = path.join(__dirname, './middleware/custom/')
    const middleware: express.RequestHandler[] = []
    const doesExist = existsSync(pathToCustomMiddleware)
    const isDirectory = lstatSync(pathToCustomMiddleware).isDirectory()
    if (doesExist && isDirectory) {
      const files = readdirSync(pathToCustomMiddleware)
      for (const file of files) {
        if (path.extname(file) === '.js' && !file.endsWith('test.js')) {
          const filePath = path.join(pathToCustomMiddleware, file)
          const fileURL = pathToFileURL(filePath) // Convert path to URL
          const customMiddleware = await import(fileURL.href) // Use URL href for dynamic import
          log.info('Loading custom middleware: ' + file)
          if (customMiddleware?.default != null) {
            middleware.push(customMiddleware.default)
          }
        }
      }
    }

    return middleware
  }

  loadCustomMiddleware()
    .then((customMiddleware) => {
      app.use(
        '/api/v1',
        async (req: express.Request, res: express.Response, next) => {
          if (configurator.secretsManager) {
            ;(req as any).secretsManager = configurator.secretsManager
          }
          req.db = await dbFactory.getDb()
          next()
        },
        customMiddleware,
        routes
      )
    })
    .catch((err) => {
      log.error('Error loading custom middleware')
      log.error(err)
      process.exit(0)
    })

  // the env keys have been lower-cased!!
  if (process.env.node_env !== 'test') {
    dbFactory
      .getDb()
      .then(async (db) => {
        await waitForDB(db)
        await waitForSecretsManager(configurator.secretsManager)
      })
      .then(() => {
        app.listen(Environment.Config.web_port, () => {
          log.info(`RPS Microservice Rest APIs listening on http://:${Environment.Config.web_port}.`)
        })
        server.connect()
        serverForEnterpriseAssistant.connect()
      })
      .catch((err) => {
        log.error(err)
        process.exit(0)
      })
  }
}

export async function setupServiceManager(config: RPSConfig): Promise<void> {
  const consul: IServiceManager = new ConsulService(config.consul_host, parseInt(config.consul_port, 10))
  await waitForServiceManager(consul, 'consul')
  await processServiceConfigs(consul, config)
}

if (Environment.Config.consul_enabled) {
  setupServiceManager(Environment.Config)
    .then(() => {
      startItUp()
    })
    .catch((err) => {
      log.error(`Unable to reach consul: ${err}`)
      process.exit(0)
    })
} else {
  startItUp()
}
