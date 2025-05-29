/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { type CIM } from '@device-management-toolkit/wsman-messages'

export interface Header {
  To: string
  RelatesTo: string
  Action: string
  MessageID: string
  ResourceURI: string
  Method: string
}

export interface AddWiFiSettingsResponse {
  Header: Header
  Body: {
    WiFiEndpointSettings: any
    ReturnValue: number
    ReturnValueStr: string
  }
}

export interface CIM_WiFiPortResponse {
  Header: Header
  Body: CIM.Models.WiFiPort
}

export interface AMT_WiFiPortConfigurationServiceResponse {
  CreationClassName: string
  ElementName: string
  EnabledState: number
  HealthState: number
  LastConnectedSsidUnderMeControl: string
  Name: string
  NoHostCsmeSoftwarePolicy: number
  RequestedState: number
  SystemCreationClassName: string
  SystemName: string
  UEFIWiFiProfileShareEnabled: boolean
  localProfileSynchronizationEnabled: number
}

export interface AMT_WiFiPortConfigurationService {
  response: AMT_WiFiPortConfigurationServiceResponse
  responses: {
    Header: Header
    Body: AMT_WiFiPortConfigurationServiceResponse
  }
  status: number
}
