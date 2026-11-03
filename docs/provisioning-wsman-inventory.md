# Provisioning state and WS-Man inventory

Source: pristine September release `v2.40.2`, commit `583d61f0cd4ad080cac1baacdff5b1606d9079d3`, for [issue #2935](https://github.com/device-management-toolkit/rps/issues/2935). This is a static inventory, not a runtime sequence or proof of reachability. Targets list direct transitions, including failure/retry branches. Builder names identify message types; selectors and configuration values remain defined by the source. Child machines, control messages, Vault/DB/REST operations, and local computations are shown without counting them as WS-Man requests.

## activation

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `UNPROVISIONED` | — | `GET_AMT_PROFILE` |
| `GET_AMT_PROFILE` | `getAMTProfile` (child/control/local/service operation; inspect actor) | `EVALUATE_LEGACY_LMS_NON_TLS_OVERRIDE`, `FAILED` |
| `EVALUATE_LEGACY_LMS_NON_TLS_OVERRIDE` | `evaluateLegacyLmsNonTlsOverride`: `amt.TLSSettingData.Enumerate`, `amt.TLSSettingData.Pull` | `CHECK_PROFILE_TYPE` |
| `CHECK_PROFILE_TYPE` | — | `CHECK_TENANT_ACCESS`, `INIT_TLS_TUNNEL`, `GET_AMT_DOMAIN_CERT` |
| `CHECK_TENANT_ACCESS` | `getDeviceFromMPS` (child/control/local/service operation; inspect actor) | `DETERMINE_CAN_ACTIVATE`, `INIT_TLS_TUNNEL` |
| `DETERMINE_CAN_ACTIVATE` | — | `INIT_TLS_TUNNEL`, `GET_AMT_DOMAIN_CERT`, `FAILED` |
| `GET_AMT_DOMAIN_CERT` | `getAMTDomainCert` (child/control/local/service operation; inspect actor) | `EXTRACT_DOMAIN_CERT`, `FAILED` |
| `EXTRACT_DOMAIN_CERT` | — | `COMPARE_DEVICE_HASHES`, `FAILED` |
| `COMPARE_DEVICE_HASHES` | — | `INIT_TLS_TUNNEL`, `FAILED` |
| `INIT_TLS_TUNNEL` | `initializeTLSTunnel` (child/control/local/service operation; inspect actor) | `GET_GENERAL_SETTINGS`, `FAILED` |
| `GET_GENERAL_SETTINGS` | `getGeneralSettings`: `amt.GeneralSettings.Get` | `READ_GENERAL_SETTINGS`, `ERROR` |
| `READ_GENERAL_SETTINGS` | — | `CHECK_DIGEST_REALM` |
| `CHECK_DIGEST_REALM` | — | `INVALID_DIGEST_REALM`, `CHECK_AMT_TLS_STATE`, `IPS_HOST_BASED_SETUP_SERVICE`, `CHANGE_AMT_PASSWORD`, `SETUP` |
| `IPS_HOST_BASED_SETUP_SERVICE` | `getHostBasedSetupService`: `ips.HostBasedSetupService.Get` | `CHANGE_AMT_PASSWORD`, `ADD_NEXT_CERT_IN_CHAIN`, `ERROR` |
| `ADD_NEXT_CERT_IN_CHAIN` | `getNextCERTInChain`: `ips.HostBasedSetupService.AddNextCertInChain` | `CHECK_CERT_CHAIN_RESPONSE`, `ERROR` |
| `CHECK_CERT_CHAIN_RESPONSE` | — | `FAILED`, `ADD_NEXT_CERT_IN_CHAIN`, `UPGRADE_TO_ADMIN_SETUP`, `ADMIN_SETUP` |
| `ADMIN_SETUP` | `sendAdminSetup`: `ips.HostBasedSetupService.AdminSetup` | `CHECK_ADMIN_SETUP`, `CHECK_ACTIVATION_ON_AMT`, `DEACTIVATION`, `ERROR` |
| `CHECK_ADMIN_SETUP` | — | `COMMIT_CHANGES`, `DELAYED_TRANSITION`, `DEACTIVATION`, `FAILED` |
| `UPGRADE_TO_ADMIN_SETUP` | `sendUpgradeClientToAdmin`: `ips.HostBasedSetupService.UpgradeClientToAdmin` | `CHECK_UPGRADE`, `CHECK_ACTIVATION_ON_AMT`, `DEACTIVATION`, `ERROR` |
| `CHECK_UPGRADE` | — | `COMMIT_CHANGES`, `CHANGE_AMT_PASSWORD`, `DEACTIVATION`, `FAILED` |
| `SETUP` | `sendClientSetup`: `ips.HostBasedSetupService.Setup` | `COMMIT_CHANGES`, `CHECK_SETUP`, `CHECK_ACTIVATION_ON_AMT`, `ERROR` |
| `COMMIT_CHANGES` | `commitChanges`: `amt.SetupAndConfigurationService.CommitChanges` | `SET_MEBX_PASSWORD`, `CHECK_SETUP`, `WAIT_AFTER_COMMIT`, `CHECK_ACTIVATION_ON_AMT`, `ERROR` |
| `WAIT_AFTER_COMMIT` | — | `CHECK_SETUP` |
| `CHECK_SETUP` | — | `DELAYED_TRANSITION`, `FAILED` |
| `CHECK_ACTIVATION_ON_AMT` | `getActivationStatus`: `ips.HostBasedSetupService.Get` | `CHECK_UPGRADE`, `CHECK_ADMIN_SETUP`, `CHECK_SETUP`, `ERROR` |
| `DELAYED_TRANSITION` | — | `UPDATE_CREDENTIALS` |
| `UPDATE_CREDENTIALS` | — | `FETCH_POST_PROVISIONING_ROOT_KEY`, `SAVE_DEVICE_TO_SECRET_PROVIDER`, `SET_MEBX_PASSWORD` |
| `SET_MEBX_PASSWORD` | `setMEBxPassword`: `amt.SetupAndConfigurationService.SetMEBXPassword` | `SAVE_DEVICE_TO_SECRET_PROVIDER`, `DEACTIVATION`, `ERROR` |
| `SAVE_DEVICE_TO_SECRET_PROVIDER` | `saveDeviceInfoToSecretProvider` (child/control/local/service operation; inspect actor) | `SAVE_DEVICE_TO_MPS`, `SAVE_DEVICE_TO_SECRET_PROVIDER_FAILURE` |
| `SAVE_DEVICE_TO_MPS` | `saveDeviceInfoToMPS` (child/control/local/service operation; inspect actor) | `FETCH_MPS_ROOT_KEY`, `UNCONFIGURATION`, `SAVE_DEVICE_TO_MPS_FAILURE` |
| `SAVE_DEVICE_TO_SECRET_PROVIDER_FAILURE` | — | `FAILED` |
| `SAVE_DEVICE_TO_MPS_FAILURE` | — | `FAILED` |
| `CHECK_AMT_TLS_STATE` | `checkAmtTlsState`: `amt.TLSSettingData.Enumerate`, `amt.TLSSettingData.Pull`, `amt.TLSCredentialContext.Enumerate`, `amt.TLSCredentialContext.Pull` | `ROUTE_ACTIVATED_NON_TLS`, `VALIDATE_ACTIVATED_DEVICE_TLS_CERT`, `IPS_HOST_BASED_SETUP_SERVICE`, `CHANGE_AMT_PASSWORD` |
| `VALIDATE_ACTIVATED_DEVICE_TLS_CERT` | `validateDeviceTlsCert`: `amt.TLSCredentialContext.Enumerate`, `amt.TLSCredentialContext.Pull`, `amt.PublicKeyCertificate.Enumerate`, `amt.PublicKeyCertificate.Pull` | `ROUTE_ACTIVATED_NON_TLS`, `SIGNAL_ACTIVATED_PORT_SWITCH` |
| `ROUTE_ACTIVATED_NON_TLS` | — | `IPS_HOST_BASED_SETUP_SERVICE`, `CHANGE_AMT_PASSWORD` |
| `SIGNAL_ACTIVATED_PORT_SWITCH` | `signalPortSwitch` (child/control/local/service operation; inspect actor) | `INIT_ACTIVATED_TLS_TUNNEL`, `IPS_HOST_BASED_SETUP_SERVICE`, `CHANGE_AMT_PASSWORD` |
| `INIT_ACTIVATED_TLS_TUNNEL` | `initializeTlsTunnelConnection` (child/control/local/service operation; inspect actor) | `IPS_HOST_BASED_SETUP_SERVICE`, `CHANGE_AMT_PASSWORD` |
| `FETCH_MPS_ROOT_KEY` | `fetchMPSRootKey` (child/control/local/service operation; inspect actor) | `VALIDATE_DEVICE_TLS_CERT`, `FAILED` |
| `VALIDATE_DEVICE_TLS_CERT` | `validateDeviceTlsCert`: `amt.TLSCredentialContext.Enumerate`, `amt.TLSCredentialContext.Pull`, `amt.PublicKeyCertificate.Enumerate`, `amt.PublicKeyCertificate.Pull` | `SIGNAL_PORT_SWITCH`, `TLS_TUNNEL_PROVISIONING` |
| `TLS_TUNNEL_PROVISIONING` | `tlsTunnelProvisioning` (child/control/local/service operation; inspect actor) | `CHECK_TLS_TUNNEL_RESULT`, `FAILED` |
| `CHECK_TLS_TUNNEL_RESULT` | — | `SAVE_TLS_TUNNEL_CERTS`, `FAILED` |
| `SAVE_TLS_TUNNEL_CERTS` | `saveTlsTunnelCerts` (child/control/local/service operation; inspect actor) | `SIGNAL_PORT_SWITCH`, `FAILED` |
| `SIGNAL_PORT_SWITCH` | `signalPortSwitch` (child/control/local/service operation; inspect actor) | `INIT_TLS_TUNNEL_CONNECTION`, `FAILED` |
| `INIT_TLS_TUNNEL_CONNECTION` | `initializeTlsTunnelConnection` (child/control/local/service operation; inspect actor) | `GET_AMT_DOMAIN_CERT`, `UNCONFIGURATION`, `FAILED` |
| `CHANGE_AMT_PASSWORD` | `changeAMTPassword`: `amt.AuthorizationService.SetAdminACLEntryEx` | `UPDATE_CREDENTIALS`, `DEACTIVATION`, `ERROR` |
| `UNCONFIGURATION` | `unconfiguration` (child/control/local/service operation; inspect actor) | `NETWORK_CONFIGURATION` |
| `NETWORK_CONFIGURATION` | `networkConfiguration` (child/control/local/service operation; inspect actor) | `FEATURES_CONFIGURATION` |
| `FEATURES_CONFIGURATION` | `featuresConfiguration` (child/control/local/service operation; inspect actor) | `FETCH_POST_PROVISIONING_ROOT_KEY`, `CIRA`, `PROVISIONED` |
| `CIRA` | `cira` (child/control/local/service operation; inspect actor) | `PROVISIONED` |
| `FETCH_POST_PROVISIONING_ROOT_KEY` | `fetchMPSRootKey` (child/control/local/service operation; inspect actor) | `TLS`, `FAILED` |
| `TLS` | `tls` (child/control/local/service operation; inspect actor) | `SAVE_POST_PROVISIONING_CERTS`, `PROVISIONED` |
| `SAVE_POST_PROVISIONING_CERTS` | `saveTlsTunnelCerts` (child/control/local/service operation; inspect actor) | `SIGNAL_PORT_SWITCH`, `CIRA`, `PROVISIONED` |
| `DEACTIVATION` | `invokeUnprovision`: `amt.SetupAndConfigurationService.Unprovision` | `FINAL` |
| `PROVISIONED` | — | — |
| `ERROR` | `error` (child/control/local/service operation; inspect actor) | `NEXT_STATE`, `DEACTIVATION`, `FAILED` |
| `NEXT_STATE` | — | `DEACTIVATION`, `GET_GENERAL_SETTINGS`, `SET_MEBX_PASSWORD`, `CHECK_ACTIVATION_ON_AMT`, `FAILED` |
| `INVALID_DIGEST_REALM` | — | `FAILED` |
| `FAILED` | — | `DEACTIVATION`, `FINAL` |
| `FINAL` | — | — |

## unconfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `UNCONFIGURED` | — | `ENUMERATE_ETHERNET_PORT_SETTINGS` |
| `ERROR` | `errorMachine` (child/control/local/service operation; inspect actor) | `ENUMERATE_ETHERNET_PORT_SETTINGS`, `FAILURE` |
| `ENUMERATE_ETHERNET_PORT_SETTINGS` | `enumerateEthernetPortSettings`: `amt.EthernetPortSettings.Enumerate` | `PULL_ETHERNET_PORT_SETTINGS`, `ERROR` |
| `PULL_ETHERNET_PORT_SETTINGS` | `pullEthernetPortSettings`: `amt.EthernetPortSettings.Pull` | `CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE`, `ENUMERATE_ETHERNET_PORT_SETTINGS`, `FAILURE` |
| `CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE` | — | `GET_8021X_PROFILE`, `ENUMERATE_WIFI_ENDPOINT_SETTINGS` |
| `GET_8021X_PROFILE` | `get8021xProfile`: `ips.IEEE8021xSettings.Get` | `CHECK_GET_8021X_PROFILE_RESPONSE`, `FAILURE` |
| `CHECK_GET_8021X_PROFILE_RESPONSE` | — | `DISABLE_IEEE8021X_WIRED`, `ENUMERATE_WIFI_ENDPOINT_SETTINGS`, `ENUMERATE_HTTP_PROXY_ACCESS_POINT` |
| `DISABLE_IEEE8021X_WIRED` | `disableWired8021xConfiguration`: `ips.IEEE8021xSettings.Put` | `ENUMERATE_WIFI_ENDPOINT_SETTINGS`, `ENUMERATE_HTTP_PROXY_ACCESS_POINT`, `FAILURE` |
| `ENUMERATE_WIFI_ENDPOINT_SETTINGS` | `enumerateWifiEndpointSettings`: `cim.WiFiEndpointSettings.Enumerate` | `PULL_WIFI_ENDPOINT_SETTINGS`, `FAILURE` |
| `PULL_WIFI_ENDPOINT_SETTINGS` | `pullWifiEndpointSettings`: `cim.WiFiEndpointSettings.Pull` | `CHECK_WIFI_ENDPOINT_SETTINGS_PULL_RESPONSE`, `ENUMERATE_WIFI_ENDPOINT_SETTINGS`, `FAILURE` |
| `CHECK_WIFI_ENDPOINT_SETTINGS_PULL_RESPONSE` | — | `DELETE_WIFI_ENDPOINT_SETTINGS`, `ENUMERATE_HTTP_PROXY_ACCESS_POINT` |
| `DELETE_WIFI_ENDPOINT_SETTINGS` | `deleteWiFiProfileOnAMTDevice`: `cim.WiFiEndpointSettings.Delete` | `CHECK_WIFI_ENDPOINT_SETTINGS_DELETE_RESPONSE`, `FAILURE` |
| `CHECK_WIFI_ENDPOINT_SETTINGS_DELETE_RESPONSE` | — | `FAILURE`, `DELETE_WIFI_ENDPOINT_SETTINGS`, `ENUMERATE_HTTP_PROXY_ACCESS_POINT` |
| `ENUMERATE_HTTP_PROXY_ACCESS_POINT` | `enumerateHTTPProxyAccessPoint`: `ips.HTTPProxyAccessPoint.Enumerate` | `PULL_HTTP_PROXY_ACCESS_POINT`, `FAILURE` |
| `PULL_HTTP_PROXY_ACCESS_POINT` | `pullHTTPProxyAccessPoint`: `ips.HTTPProxyAccessPoint.Pull` | `CHECK_HTTP_PROXY_ACCESS_POINT_PULL_RESPONSE`, `ENUMERATE_HTTP_PROXY_ACCESS_POINT`, `FAILURE` |
| `CHECK_HTTP_PROXY_ACCESS_POINT_PULL_RESPONSE` | — | `PULL_HTTP_PROXY_ACCESS_POINT`, `DELETE_HTTP_PROXY_ACCESS_POINT`, `REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED` |
| `DELETE_HTTP_PROXY_ACCESS_POINT` | `deleteHTTPProxyAccessPoint`: `ips.HTTPProxyAccessPoint.Delete` | `CHECK_HTTP_PROXY_ACCESS_POINT_DELETE_RESPONSE`, `FAILURE` |
| `CHECK_HTTP_PROXY_ACCESS_POINT_DELETE_RESPONSE` | — | `DELETE_HTTP_PROXY_ACCESS_POINT`, `REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED` |
| `REMOVE_REMOTE_ACCESS_POLICY_RULE_USER_INITIATED` | `removeRemoteAccessPolicyRuleUserInitiated`: `amt.RemoteAccessPolicyRule.Delete` | `REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT`, `ERROR` |
| `REMOVE_REMOTE_ACCESS_POLICY_RULE_ALERT` | `removeRemoteAccessPolicyRuleAlert`: `amt.RemoteAccessPolicyRule.Delete` | `REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC` |
| `REMOVE_REMOTE_ACCESS_POLICY_RULE_PERIODIC` | `removeRemoteAccessPolicyRulePeriodic`: `amt.RemoteAccessPolicyRule.Delete` | `ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP` |
| `ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP` | `enumerateManagementPresenceRemoteSAP`: `amt.ManagementPresenceRemoteSAP.Enumerate` | `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP`, `FAILURE` |
| `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP` | `pullManagementPresenceRemoteSAP`: `amt.ManagementPresenceRemoteSAP.Pull` | `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE`, `FAILURE` |
| `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP_RESPONSE` | — | `DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP`, `ENUMERATE_TLS_SETTING_DATA` |
| `DELETE_MANAGEMENT_PRESENCE_REMOTE_SAP` | `deleteRemoteAccessService`: `amt.ManagementPresenceRemoteSAP.Delete` | `ENUMERATE_TLS_SETTING_DATA`, `FAILURE` |
| `ENUMERATE_TLS_SETTING_DATA` | `enumerateTLSSettingData`: `amt.TLSSettingData.Enumerate` | `PULL_TLS_SETTING_DATA`, `FAILURE` |
| `PULL_TLS_SETTING_DATA` | `pullTLSSettingData`: `amt.TLSSettingData.Pull` | `PULL_TLS_SETTING_DATA_RESPONSE`, `FAILURE` |
| `PULL_TLS_SETTING_DATA_RESPONSE` | — | `GET_ENVIRONMENT_DETECTION_SETTINGS`, `DISABLE_TLS_SETTING_DATA`, `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `ENUMERATE_PUBLIC_KEY_CERTIFICATE` |
| `DISABLE_TLS_SETTING_DATA` | `disableRemoteTLSSettingData`: `amt.TLSSettingData.Put` | `DISABLE_TLS_SETTING_DATA_RESPONSE`, `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES` |
| `DISABLE_TLS_SETTING_DATA_2` | `disableLocalTLSSettingData`: `amt.TLSSettingData.Put` | `DISABLE_TLS_SETTING_DATA_RESPONSE`, `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES` |
| `DISABLE_TLS_SETTING_DATA_RESPONSE` | — | `DISABLE_TLS_SETTING_DATA_2`, `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES`, `FAILURE` |
| `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES` | `commitSetupAndConfigurationService`: `amt.SetupAndConfigurationService.CommitChanges` | `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES_RESPONSE`, `FAILURE` |
| `SETUP_AND_CONFIGURATION_SERVICE_COMMIT_CHANGES_RESPONSE` | — | `ENUMERATE_TLS_CREDENTIAL_CONTEXT` |
| `ENUMERATE_TLS_CREDENTIAL_CONTEXT` | `enumerateTLSCredentialContext`: `amt.TLSCredentialContext.Enumerate` | `PULL_TLS_CREDENTIAL_CONTEXT`, `FAILURE` |
| `PULL_TLS_CREDENTIAL_CONTEXT` | `pullTLSCredentialContext`: `amt.TLSCredentialContext.Pull` | `PULL_TLS_CREDENTIAL_CONTEXT_RESPONSE`, `FAILURE` |
| `PULL_TLS_CREDENTIAL_CONTEXT_RESPONSE` | — | `DELETE_TLS_CREDENTIAL_CONTEXT`, `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` |
| `DELETE_TLS_CREDENTIAL_CONTEXT` | `deleteTLSCredentialContext`: `amt.TLSCredentialContext.Delete` | `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` |
| `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` | `enumeratePublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Enumerate` | `PULL_PUBLIC_PRIVATE_KEY_PAIR`, `FAILURE` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR` | `pullPublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Pull` | `PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE`, `FAILURE` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE` | — | `DELETE_PUBLIC_PRIVATE_KEY_PAIR`, `ENUMERATE_PUBLIC_KEY_CERTIFICATE` |
| `DELETE_PUBLIC_PRIVATE_KEY_PAIR` | `deletePublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Delete` | `PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE` |
| `ENUMERATE_PUBLIC_KEY_CERTIFICATE` | `enumeratePublicKeyCertificate`: `amt.PublicKeyCertificate.Enumerate` | `PULL_PUBLIC_KEY_CERTIFICATE`, `FAILURE` |
| `PULL_PUBLIC_KEY_CERTIFICATE` | `pullPublicKeyCertificate`: `amt.PublicKeyCertificate.Pull` | `PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE`, `FAILURE` |
| `PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE` | — | `DELETE_PUBLIC_KEY_CERTIFICATE`, `GET_ENVIRONMENT_DETECTION_SETTINGS` |
| `DELETE_PUBLIC_KEY_CERTIFICATE` | `deletePublicKeyCertificate`: `amt.PublicKeyCertificate.Delete` | `PULL_PUBLIC_KEY_CERTIFICATE_RESPONSE` |
| `GET_ENVIRONMENT_DETECTION_SETTINGS` | `getEnvironmentDetectionSettings`: `amt.EnvironmentDetectionSettingData.Get` | `GET_ENVIRONMENT_DETECTION_SETTINGS_RESPONSE`, `FAILURE` |
| `GET_ENVIRONMENT_DETECTION_SETTINGS_RESPONSE` | — | `CLEAR_ENVIRONMENT_DETECTION_SETTINGS`, `SUCCESS` |
| `CLEAR_ENVIRONMENT_DETECTION_SETTINGS` | `clearEnvironmentDetectionSettings`: `amt.EnvironmentDetectionSettingData.Put` | `SUCCESS`, `FAILURE` |
| `FAILURE` | — | — |
| `SUCCESS` | — | — |

## networkConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `ACTIVATION` | — | `CHECK_GENERAL_SETTINGS` |
| `CHECK_GENERAL_SETTINGS` | — | `PUT_GENERAL_SETTINGS`, `ENUMERATE_ETHERNET_PORT_SETTINGS` |
| `PUT_GENERAL_SETTINGS` | `putGeneralSettings`: `amt.GeneralSettings.Put` | `ENUMERATE_ETHERNET_PORT_SETTINGS`, `FAILED` |
| `ENUMERATE_ETHERNET_PORT_SETTINGS` | `enumerateEthernetPortSettings`: `amt.EthernetPortSettings.Enumerate` | `PULL_ETHERNET_PORT_SETTINGS`, `FAILED` |
| `PULL_ETHERNET_PORT_SETTINGS` | `pullEthernetPortSettings`: `amt.EthernetPortSettings.Pull` | `CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE`, `ENUMERATE_ETHERNET_PORT_SETTINGS`, `FAILED` |
| `CHECK_ETHERNET_PORT_SETTINGS_PULL_RESPONSE` | — | `WIRED_CONFIGURATION`, `WIFI_CONFIGURATION`, `SUCCESS` |
| `WIRED_CONFIGURATION` | `wiredConfiguration` (child/control/local/service operation; inspect actor) | `WIFI_CONFIGURATION`, `PROXY_CONFIGURATION`, `SUCCESS` |
| `WIFI_CONFIGURATION` | `wifiConfiguration` (child/control/local/service operation; inspect actor) | `PROXY_CONFIGURATION`, `SUCCESS` |
| `PROXY_CONFIGURATION` | `proxyConfiguration` (child/control/local/service operation; inspect actor) | `SUCCESS` |
| `ERROR` | `errorMachine` (child/control/local/service operation; inspect actor) | `CHECK_GENERAL_SETTINGS`, `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

## wiredNetworkConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `ACTIVATION` | — | `CHECK_8021X_OR_SUCCESS`, `PUT_ETHERNET_PORT_SETTINGS` |
| `CHECK_8021X_OR_SUCCESS` | — | `GET_8021X_PROFILE`, `SUCCESS` |
| `PUT_ETHERNET_PORT_SETTINGS` | `putEthernetPortSettings`: `amt.EthernetPortSettings.Put` | `WAIT_AFTER_ETHERNET_PUT`, `CHECK_ETHERNET_PORT_SETTINGS_PUT_RESPONSE`, `FAILED` |
| `WAIT_AFTER_ETHERNET_PUT` | — | `SUCCESS` |
| `CHECK_ETHERNET_PORT_SETTINGS_PUT_RESPONSE` | — | `FAILED`, `GET_8021X_PROFILE`, `SUCCESS` |
| `GET_8021X_PROFILE` | `get8021xProfile`: `ips.IEEE8021xSettings.Get` | `ENTERPRISE_ASSISTANT_REQUEST`, `FAILED` |
| `ENTERPRISE_ASSISTANT_REQUEST` | `initiateCertRequest` (child/control/local/service operation; inspect actor) | `ADD_RADIUS_SERVER_ROOT_CERTIFICATE`, `GENERATE_KEY_PAIR`, `FAILED` |
| `GENERATE_KEY_PAIR` | `generateKeyPair`: `amt.PublicKeyManagementService.GenerateKeyPair` | `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` | `enumeratePublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Enumerate` | `PULL_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR` | `pullPublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Pull` | `ENTERPRISE_ASSISTANT_RESPONSE`, `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `ENTERPRISE_ASSISTANT_RESPONSE` | `sendEnterpriseAssistantKeyPairResponse` (child/control/local/service operation; inspect actor) | `SIGN_CSR`, `FAILED` |
| `SIGN_CSR` | `signCSR`: `amt.PublicKeyManagementService.GeneratePKCS10RequestEx` | `GET_CERT_FROM_ENTERPRISE_ASSISTANT`, `FAILED` |
| `GET_CERT_FROM_ENTERPRISE_ASSISTANT` | `getCertFromEnterpriseAssistant` (child/control/local/service operation; inspect actor) | `ADD_CERTIFICATE`, `FAILED` |
| `ADD_CERTIFICATE` | `addCertificate`: `amt.PublicKeyManagementService.AddCertificate` | `ADD_RADIUS_SERVER_ROOT_CERTIFICATE`, `FAILED` |
| `ADD_RADIUS_SERVER_ROOT_CERTIFICATE` | `addRadiusServerRootCertificate`: `amt.PublicKeyManagementService.AddTrustedRootCertificate` | `PUT_8021X_PROFILE`, `FAILED` |
| `PUT_8021X_PROFILE` | `put8021xProfile`: `ips.IEEE8021xSettings.Put` | `SUCCESS`, `SET_CERTIFICATES`, `FAILED` |
| `SET_CERTIFICATES` | `setCertificates`: `ips.IEEE8021xSettings.SetCertificates` | `SUCCESS`, `FAILED` |
| `ERROR` | `errorMachine` (child/control/local/service operation; inspect actor) | `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

## wifiNetworkConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `ACTIVATION` | — | `PUT_MAX_RETRAN_SETTING` |
| `PUT_MAX_RETRAN_SETTING` | `putMaxRetranSetting`: `amt.EthernetPortSettings.Put` | `GET_WIFI_PORT_CONFIGURATION_SERVICE`, `FAILED` |
| `GET_WIFI_PORT_CONFIGURATION_SERVICE` | `getWifiPortConfigurationService`: `amt.WiFiPortConfigurationService.Get` | `CHECK_WIFI_PORT_CONFIGURATION_SERVICE`, `FAILED` |
| `CHECK_WIFI_PORT_CONFIGURATION_SERVICE` | — | `GET_AMT_BOOTCAPABILITIES`, `REQUEST_STATE_CHANGE_FOR_WIFI_PORT` |
| `GET_AMT_BOOTCAPABILITIES` | `getAmtBootCapabilities`: `amt.BootCapabilities.Get` | `PUT_WIFI_PORT_CONFIGURATION_SERVICE`, `FAILED` |
| `PUT_WIFI_PORT_CONFIGURATION_SERVICE` | `putWifiPortConfigurationService`: `amt.WiFiPortConfigurationService.Put` | `REQUEST_STATE_CHANGE_FOR_WIFI_PORT`, `FAILED` |
| `REQUEST_STATE_CHANGE_FOR_WIFI_PORT` | `updateWifiPort`: `cim.WiFiPort.RequestStateChange` | `CHECK_FOR_WIFI_PROFILES`, `FAILED` |
| `CHECK_FOR_WIFI_PROFILES` | — | `GET_WIFI_PROFILE`, `SUCCESS_SYNC_ONLY` |
| `GET_WIFI_PROFILE` | `getWifiProfile` (child/control/local/service operation; inspect actor) | `CHECK_TO_ADD_WIFI_SETTINGS`, `FAILED` |
| `CHECK_TO_ADD_WIFI_SETTINGS` | — | `ENTERPRISE_ASSISTANT_REQUEST`, `ADD_WIFI_SETTINGS` |
| `ENTERPRISE_ASSISTANT_REQUEST` | `initiateCertRequest` (child/control/local/service operation; inspect actor) | `CHECK_RADIUS_SERVER_ROOT_CERTIFICATE`, `GENERATE_KEY_PAIR`, `FAILED` |
| `GENERATE_KEY_PAIR` | `generateKeyPair`: `amt.PublicKeyManagementService.GenerateKeyPair` | `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` | `enumeratePublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Enumerate` | `PULL_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR` | `pullPublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Pull` | `ENTERPRISE_ASSISTANT_RESPONSE`, `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `ENTERPRISE_ASSISTANT_RESPONSE` | `sendEnterpriseAssistantKeyPairResponse` (child/control/local/service operation; inspect actor) | `SIGN_CSR`, `FAILED` |
| `SIGN_CSR` | `signCSR`: `amt.PublicKeyManagementService.GeneratePKCS10RequestEx` | `GET_CERT_FROM_ENTERPRISE_ASSISTANT`, `FAILED` |
| `GET_CERT_FROM_ENTERPRISE_ASSISTANT` | `getCertFromEnterpriseAssistant` (child/control/local/service operation; inspect actor) | `ADD_CERTIFICATE`, `FAILED` |
| `ADD_CERTIFICATE` | `addCertificate`: `amt.PublicKeyManagementService.AddCertificate` | `CHECK_RADIUS_SERVER_ROOT_CERTIFICATE`, `FAILED` |
| `CHECK_RADIUS_SERVER_ROOT_CERTIFICATE` | — | `ADD_WIFI_SETTINGS`, `ADD_RADIUS_SERVER_ROOT_CERTIFICATE` |
| `ADD_RADIUS_SERVER_ROOT_CERTIFICATE` | `addRadiusServerRootCertificate`: `amt.PublicKeyManagementService.AddTrustedRootCertificate` | `ADD_WIFI_SETTINGS`, `FAILED` |
| `ADD_WIFI_SETTINGS` | `addWifiConfigs`: `amt.WiFiPortConfigurationService.AddWiFiSettings` | `CHECK_ADD_WIFI_SETTINGS_RESPONSE` |
| `CHECK_ADD_WIFI_SETTINGS_RESPONSE` | — | `GET_WIFI_PROFILE`, `SUCCESS` |
| `ERROR` | `errorMachine` (child/control/local/service operation; inspect actor) | `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |
| `SUCCESS_SYNC_ONLY` | — | — |

## proxyConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `ACTIVATION` | — | `CHECK_FOR_PROXY_CONFIGS` |
| `CHECK_FOR_PROXY_CONFIGS` | — | `GET_PROXY_CONFIG`, `SUCCESS` |
| `GET_PROXY_CONFIG` | `getProxyConfig` (child/control/local/service operation; inspect actor) | `ADD_PROXY_CONFIGS`, `FAILED` |
| `ADD_PROXY_CONFIGS` | `addProxyConfigs`: `ips.HTTPProxyService.AddProxyAccessPoint` | `CHECK_ADD_PROXY_CONFIGS_RESPONSE` |
| `CHECK_ADD_PROXY_CONFIGS_RESPONSE` | — | `GET_PROXY_CONFIG`, `SUCCESS` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

## featuresConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `DEFAULT_FEATURES` | — | `GET_AMT_REDIRECTION_SERVICE` |
| `GET_AMT_REDIRECTION_SERVICE` | `getAmtRedirectionService`: `amt.RedirectionService.Get` | `GET_IPS_OPT_IN_SERVICE`, `FAILED` |
| `GET_IPS_OPT_IN_SERVICE` | `getIpsOptInService`: `ips.OptInService.Get` | `GET_CIM_KVM_REDIRECTION_SAP`, `FAILED` |
| `GET_CIM_KVM_REDIRECTION_SAP` | `getCimKvmRedirectionSAP`: `cim.KVMRedirectionSAP.Get` | `COMPUTE_UPDATES`, `FAILED` |
| `COMPUTE_UPDATES` | — | `SET_REDIRECTION_SERVICE`, `PUT_IPS_OPT_IN_SERVICE`, `SUCCESS` |
| `SET_REDIRECTION_SERVICE` | `setRedirectionService`: `amt.RedirectionService.RequestStateChange` | `SET_KVM_REDIRECTION_SAP`, `FAILED` |
| `SET_KVM_REDIRECTION_SAP` | `setKvmRedirectionSap`: `cim.KVMRedirectionSAP.RequestStateChange` | `PUT_REDIRECTION_SERVICE`, `FAILED` |
| `PUT_REDIRECTION_SERVICE` | `putRedirectionService`: `amt.RedirectionService.Put` | `PUT_IPS_OPT_IN_SERVICE`, `SUCCESS`, `FAILED` |
| `PUT_IPS_OPT_IN_SERVICE` | `putIpsOptInService`: `ips.OptInService.Put` | `SUCCESS`, `FAILED` |
| `SUCCESS` | — | — |
| `FAILED` | — | — |

## ciraConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `CIRACONFIGURED` | — | `GET_CIRA_CONFIG` |
| `GET_CIRA_CONFIG` | `getCIRAConfig` (child/control/local/service operation; inspect actor) | `SET_MPS_PASSWORD`, `FAILURE` |
| `SET_MPS_PASSWORD` | `getMPSPassword` (child/control/local/service operation; inspect actor) | `ADD_TRUSTED_ROOT_CERTIFICATE`, `FAILURE` |
| `ADD_TRUSTED_ROOT_CERTIFICATE` | `addTrustedRootCertificate`: `amt.PublicKeyManagementService.AddTrustedRootCertificate` | `SAVE_MPS_PASSWORD_TO_SECRET_PROVIDER`, `FAILURE` |
| `SAVE_MPS_PASSWORD_TO_SECRET_PROVIDER` | `saveMPSPasswordToSecretProvider` (child/control/local/service operation; inspect actor) | `SAVE_DEVICE_TO_MPS`, `FAILURE` |
| `SAVE_DEVICE_TO_MPS` | `saveDeviceToMPS` (child/control/local/service operation; inspect actor) | `ADD_MPS`, `FAILURE` |
| `ADD_MPS` | `addMPS`: `amt.RemoteAccessService.AddMPS` | `ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP`, `FAILURE` |
| `ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP` | `enumerateManagementPresenceRemoteSAP`: `amt.ManagementPresenceRemoteSAP.Enumerate` | `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP`, `FAILURE` |
| `PULL_MANAGEMENT_PRESENCE_REMOTE_SAP` | `pullManagementPresenceRemoteSAP`: `amt.ManagementPresenceRemoteSAP.Pull` | `ADD_REMOTE_ACCESS_POLICY_RULE`, `ENUMERATE_MANAGEMENT_PRESENCE_REMOTE_SAP`, `FAILURE` |
| `ADD_REMOTE_ACCESS_POLICY_RULE` | `addRemoteAccessPolicyRule`: `amt.RemoteAccessService.AddRemoteAccessPolicyRule` | `ADD_USER_INITIATED_REMOTE_ACCESS_POLICY_RULE`, `FAILURE` |
| `ADD_USER_INITIATED_REMOTE_ACCESS_POLICY_RULE` | `addUserInitiatedRemoteAccessPolicyRule`: `amt.RemoteAccessService.AddRemoteAccessPolicyRule` | `ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `FAILURE` |
| `ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS` | `enumerateRemoteAccessPolicyAppliesToMPS`: `amt.RemoteAccessPolicyAppliesToMPS.Enumerate` | `PULL_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `FAILURE` |
| `PULL_REMOTE_ACCESS_POLICY_APPLIESTOMPS` | `pullRemoteAccessPolicyAppliesToMPS`: `amt.RemoteAccessPolicyAppliesToMPS.Pull` | `PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `ENUMERATE_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `FAILURE` |
| `PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS` | `putRemoteAccessPolicyAppliesToMPS`: `amt.RemoteAccessPolicyAppliesToMPS.Put` | `CHECK_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `FAILURE` |
| `CHECK_REMOTE_ACCESS_POLICY_APPLIESTOMPS` | — | `PUT_REMOTE_ACCESS_POLICY_APPLIESTOMPS`, `USER_INITIATED_CONNECTION_SERVICE` |
| `USER_INITIATED_CONNECTION_SERVICE` | `userInitiatedConnectionService`: `amt.UserInitiatedConnectionService.RequestStateChange` | `GET_ENVIRONMENT_DETECTION_SETTINGS`, `FAILURE` |
| `GET_ENVIRONMENT_DETECTION_SETTINGS` | `getEnvironmentDetectionSettings`: `amt.EnvironmentDetectionSettingData.Get` | `PUT_ENVIRONMENT_DETECTION_SETTINGS`, `FAILURE` |
| `PUT_ENVIRONMENT_DETECTION_SETTINGS` | `putEnvironmentDetectionSettings`: `amt.EnvironmentDetectionSettingData.Put` | `SUCCESS`, `FAILURE` |
| `FAILURE` | — | — |
| `SUCCESS` | — | — |

## tls

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `PROVISIONED` | — | `ENUMERATE_PUBLIC_KEY_CERTIFICATE` |
| `ENUMERATE_PUBLIC_KEY_CERTIFICATE` | `enumeratePublicKeyCertificate`: `amt.PublicKeyCertificate.Enumerate` | `PULL_PUBLIC_KEY_CERTIFICATE`, `ERROR`, `FAILED` |
| `PULL_PUBLIC_KEY_CERTIFICATE` | `pullPublicKeyCertificate`: `amt.PublicKeyCertificate.Pull` | `CHECK_CERT_MODE`, `ENUMERATE_PUBLIC_KEY_CERTIFICATE`, `FAILED` |
| `CHECK_CERT_MODE` | — | `ENTERPRISE_ASSISTANT_REQUEST` |
| `CHECK_CERT_MODE_AFTER_REQUEST` | — | `ENTERPRISE_ASSISTANT_RESPONSE` |
| `ENTERPRISE_ASSISTANT_REQUEST` | `initiateCertRequest` (child/control/local/service operation; inspect actor) | `GENERATE_KEY_PAIR`, `FAILED` |
| `ENTERPRISE_ASSISTANT_RESPONSE` | `sendEnterpriseAssistantKeyPairResponse` (child/control/local/service operation; inspect actor) | `SIGN_CSR`, `FAILED` |
| `SIGN_CSR` | `signCSR`: `amt.PublicKeyManagementService.GeneratePKCS10RequestEx` | `GET_CERT_FROM_ENTERPRISE_ASSISTANT`, `FAILED` |
| `GET_CERT_FROM_ENTERPRISE_ASSISTANT` | `getCertFromEnterpriseAssistant` (child/control/local/service operation; inspect actor) | `ADD_CERTIFICATE`, `FAILED` |
| `ADD_TRUSTED_ROOT_CERTIFICATE` | `addTrustedRootCertificate`: `amt.PublicKeyManagementService.AddTrustedRootCertificate` | `GENERATE_KEY_PAIR`, `FAILED` |
| `GENERATE_KEY_PAIR` | `generateKeyPair`: `amt.PublicKeyManagementService.GenerateKeyPair` | `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR` | `enumeratePublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Enumerate` | `PULL_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR` | `pullPublicPrivateKeyPair`: `amt.PublicPrivateKeyPair.Pull` | `PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE`, `ENUMERATE_PUBLIC_PRIVATE_KEY_PAIR`, `FAILED` |
| `PULL_PUBLIC_PRIVATE_KEY_PAIR_RESPONSE` | — | `CHECK_CERT_MODE_AFTER_REQUEST` |
| `ADD_CERTIFICATE` | `addCertificate`: `amt.PublicKeyManagementService.AddCertificate` | `ENUMERATE_TLS_CREDENTIAL_CONTEXT`, `FAILED` |
| `ENUMERATE_TLS_CREDENTIAL_CONTEXT` | `enumerateTLSCredentialContext`: `amt.TLSCredentialContext.Enumerate` | `PULL_TLS_CREDENTIAL_CONTEXT`, `FAILED` |
| `PULL_TLS_CREDENTIAL_CONTEXT` | `pullTLSCredentialContext`: `amt.TLSCredentialContext.Pull` | `CHECK_TLS_CREDENTIAL_CONTEXT`, `ENUMERATE_TLS_CREDENTIAL_CONTEXT`, `FAILED` |
| `CHECK_TLS_CREDENTIAL_CONTEXT` | — | `PUT_TLS_CREDENTIAL_CONTEXT`, `CREATE_TLS_CREDENTIAL_CONTEXT` |
| `PUT_TLS_CREDENTIAL_CONTEXT` | `putTLSCredentialContext`: `amt.TLSCredentialContext.Put` | `SYNC_TIME`, `FAILED` |
| `CREATE_TLS_CREDENTIAL_CONTEXT` | `createTLSCredentialContext`: `amt.TLSCredentialContext.Create` | `SYNC_TIME`, `FAILED` |
| `SYNC_TIME` | `timeSync` (child/control/local/service operation; inspect actor) | `ENUMERATE_TLS_DATA`, `FAILED` |
| `ENUMERATE_TLS_DATA` | `enumerateTLSData`: `amt.TLSSettingData.Enumerate` | `PULL_TLS_DATA`, `FAILED` |
| `PULL_TLS_DATA` | `pullTLSData`: `amt.TLSSettingData.Pull` | `PUT_REMOTE_TLS_DATA`, `ENUMERATE_TLS_DATA`, `FAILED` |
| `PUT_REMOTE_TLS_DATA` | `putRemoteTLSData`: `amt.TLSSettingData.Put` | `WAIT_A_BIT`, `FAILED` |
| `WAIT_A_BIT` | — | `PUT_LOCAL_TLS_DATA` |
| `PUT_LOCAL_TLS_DATA` | `putLocalTLSData`: `amt.TLSSettingData.Put` | `COMMIT_CHANGES`, `FAILED` |
| `COMMIT_CHANGES` | `commitChanges`: `amt.SetupAndConfigurationService.CommitChanges` | `SUCCESS`, `FAILED` |
| `ERROR` | `errorMachine` (child/control/local/service operation; inspect actor) | `ENUMERATE_PUBLIC_KEY_CERTIFICATE`, `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

## timeMachine

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `THE_PAST` | — | `GET_LOW_ACCURACY_TIME_SYNCH` |
| `GET_LOW_ACCURACY_TIME_SYNCH` | `getLowAccuracyTimeSync`: `amt.TimeSynchronizationService.GetLowAccuracyTimeSynch` | `GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE`, `FAILED` |
| `GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE` | — | `SET_HIGH_ACCURACY_TIME_SYNCH`, `FAILED` |
| `SET_HIGH_ACCURACY_TIME_SYNCH` | `setHighAccuracyTimeSync`: `amt.TimeSynchronizationService.SetHighAccuracyTimeSynch` | `SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE`, `FAILED` |
| `SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE` | — | `SUCCESS`, `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

