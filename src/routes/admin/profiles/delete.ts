/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { profileSecretPath, profileTlsSecretPath } from '../../../utils/secretPaths.js'

import Logger from '../../../Logger.js'
import { type AMTConfiguration } from '../../../models/index.js'
import { API_UNEXPECTED_EXCEPTION, NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import { MqttProvider } from '../../../utils/MqttProvider.js'
import { type Request, type Response } from 'express'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'

export async function deleteProfile(req: Request, res: Response): Promise<void> {
  const log = new Logger('deleteProfile')
  const { profileName } = req.params
  try {
    const profile: AMTConfiguration | null = await req.db.profiles.getByName(profileName, req.tenantId)
    if (profile == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('AMT', profileName), NOT_FOUND_EXCEPTION)
    } else {
      const results: boolean = await req.db.profiles.delete(profileName, req.tenantId)
      if (results) {
        if (req.secretsManager) {
          if (!profile.generateRandomPassword || !profile.generateRandomMEBxPassword) {
            await req.secretsManager.deleteSecretAtPath(profileSecretPath(profile.profileName, req.tenantId))
          }
          await req.secretsManager.deleteSecretAtPath(profileTlsSecretPath(profile.profileName, req.tenantId))
        }

        MqttProvider.publishEvent('success', ['deleteProfile'], `Deleted Profile : ${profileName}`)
        res.status(204).end()
      } else {
        throw new RPSError(API_UNEXPECTED_EXCEPTION('Error deleting profile'))
      }
    }
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
