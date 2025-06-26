import { WirelessConfig, Ieee8021xConfig, ProfileWifiConfigs } from 'models/RCS.Config.js'
import { type ExportWifiConfig, type ExportConfiguration } from '../../../models/index.js'
import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { type Request, type Response } from 'express'
import yaml from 'js-yaml'
import { encryptWithRandomKey } from '../../../utils/encryptWithRandomKey.js'
import { type CertCredentials } from '../../../interfaces/ISecretManagerService.js'
import { Environment } from '../../../utils/Environment.js'

// Constants for export configuration
const DEFAULT_USER_CONSENT = 'None'

export async function exportProfile(req: Request, res: Response): Promise<void> {
  const log = new Logger('exportProfile')
  const { profileName } = req.params
  const { domainName } = req.query as { domainName: string }
  try {
    const result = await req.db.profiles.getByName(profileName, req.tenantId)
    if (result == null) {
      throw new RPSError(NOT_FOUND_MESSAGE('AMT', profileName), NOT_FOUND_EXCEPTION)
    }
    if (result.ciraConfigName && result.ciraConfigName !== '') {
      result.ciraConfigObject = await req.db.ciraConfigs.getByName(result.ciraConfigName, req.tenantId)
      if (result.ciraConfigObject == null) {
        throw new RPSError(NOT_FOUND_MESSAGE('CIRA', result.ciraConfigName), NOT_FOUND_EXCEPTION)
      }
    }

    // Helper function to get WiFi configuration
    const getWifiConfiguration = async (wifiConfig: ProfileWifiConfigs): Promise<ExportWifiConfig> => {
      const wifiConfigObject = await req.db.wirelessProfiles.getByName(wifiConfig.profileName, req.tenantId)
      if (wifiConfigObject == null) {
        throw new RPSError(NOT_FOUND_MESSAGE('Wireless', wifiConfig.profileName), NOT_FOUND_EXCEPTION)
      }
      return {
        profileName: wifiConfigObject.profileName,
        ssid: wifiConfigObject.ssid,
        priority: wifiConfig.priority,
        authenticationMethod: wifiConfigObject.authenticationMethod,
        encryptionMethod: wifiConfigObject.encryptionMethod,
        pskPassphrase: wifiConfigObject.pskPassphrase,
        ieee8021xProfileName: wifiConfigObject.ieee8021xProfileName
      }
    }

    // Get WiFi configurations
    const wifiConfigs: ExportWifiConfig[] =
      result.wifiConfigs && result.wifiConfigs.length > 0
        ? await Promise.all(result.wifiConfigs.map(getWifiConfiguration))
        : []
    let ieee8021xConfigs: Ieee8021xConfig[] = []
    if (result.ieee8021xProfileName && result.ieee8021xProfileName !== '') {
      const ieee8021xProfile = await req.db.ieee8021xProfiles.getByName(result.ieee8021xProfileName, req.tenantId)
      if (ieee8021xProfile == null) {
        throw new RPSError(NOT_FOUND_MESSAGE('802.1x', result.ieee8021xProfileName), NOT_FOUND_EXCEPTION)
      }
      ieee8021xConfigs = [
        {
          profileName: ieee8021xProfile.profileName,
          username: ieee8021xProfile.username,
          password: ieee8021xProfile.password,
          authenticationProtocol: ieee8021xProfile.authenticationProtocol,
          pxeTimeout: ieee8021xProfile.pxeTimeout,
          wiredInterface: ieee8021xProfile.wiredInterface,
          tenantId: ieee8021xProfile.tenantId
        }
      ]
    }

    // Map wireless profiles to the new format (this mapping is now redundant)
    const wirelessProfiles: ExportWifiConfig[] = wifiConfigs

    // Get domain object for ACM activation with secrets
    let domainObject: any = null
    const passwords = {
      amt: '',
      mebx: '',
      mps: ''
    }

    if (result.activation === 'acmactivate' && domainName) {
      domainObject = await req.db.domains.getByName(domainName, req.tenantId)

      // Get provisioning cert and password from secret manager if available
      if (domainObject && req.secretsManager) {
        try {
          const certCredentials = (await req.secretsManager.getSecretAtPath(
            `certs/${domainObject.profileName}`
          )) as CertCredentials
          if (certCredentials?.CERT) {
            domainObject.provisioningCert = certCredentials.CERT || domainObject.provisioningCert || ''
            domainObject.provisioningCertPassword =
              certCredentials.CERT_PASSWORD || domainObject.provisioningCertPassword || ''
          }
        } catch (error) {
          log.error(`Failed to get cert credentials from secret manager: ${error}`)
        }
      }
    }

    // Helper function to get password from secret manager or fallback
    const getPassword = async (secretKey: string, fallbackValue: string | null | undefined): Promise<string> => {
      if (req.secretsManager) {
        try {
          return (
            (await req.secretsManager.getSecretFromKey(`profiles/${profileName}`, secretKey)) || fallbackValue || ''
          )
        } catch (error) {
          log.error(`Failed to get ${secretKey}: ${error}`)
          return fallbackValue || ''
        }
      }
      return fallbackValue || ''
    }

    // Get passwords from secret manager or profile
    passwords.amt = await getPassword('AMT_PASSWORD', result.amtPassword)
    passwords.mebx = await getPassword('MEBX_PASSWORD', result.mebxPassword)

    // Get MPS password - this is typically generated randomly
    if (result.ciraConfigObject && req.secretsManager) {
      try {
        passwords.mps = (await req.secretsManager.getSecretFromKey(`profiles/${profileName}`, 'MPS_PASSWORD')) || ''
      } catch (error) {
        log.error(`Failed to get MPS password: ${error}`)
      }
    }

    // Create the new structured output
    const output: ExportConfiguration = {
      id: 0,
      name: profileName,
      configuration: {
        generalSettings: {
          sharedFQDN: false,
          networkInterfaceEnabled: 0,
          pingResponseEnabled: false
        },
        network: {
          wired: {
            dhcpEnabled: result.dhcpEnabled ?? true,
            ipSyncEnabled: result.ipSyncEnabled ?? false,
            sharedStaticIP: false,
            ipAddress: '',
            subnetMask: '',
            defaultGateway: '',
            primaryDNS: '',
            secondaryDNS: '',
            authentication: '',
            ieee8021x: ieee8021xConfigs.length > 0 ? ieee8021xConfigs[0] : null
          },
          wireless: {
            wifiSyncEnabled: result.localWifiSyncEnabled ?? false,
            profiles: wirelessProfiles
          }
        },
        tls: {
          mutualAuthentication: false,
          enabled: result.tlsMode ? true : false,
          trustedCN: [],
          allowNonTLS: false
        },
        redirection: {
          enabled: false,
          services: {
            kvm: true,
            sol: true,
            ider: true
          },
          userConsent: DEFAULT_USER_CONSENT
        },
        userAccounts: {
          userAccounts: []
        },
        enterpriseAssistant: {
          url: Environment.Config.enterprise_assistant_url ?? 'http://localhost:8000',
          username: '',
          password: ''
        },
        amtSpecific: {
          controlMode: result.activation ?? '',
          adminPassword: passwords.amt,
          provisioningCert: domainObject?.provisioningCert ?? '',
          provisioningCertPwd: domainObject?.provisioningCertPassword ?? '',
          mebxPassword: passwords.mebx
        },
        bmcSpecific: {
          adminPassword: ''
        },
        dashSpecific: {
          adminPassword: ''
        },
        redfishSpecific: {
          adminPassword: ''
        }
      }
    }

    const yamlStr = yaml.dump(output)
    // Encrypt the YAML string and provide the key
    const { cipherText, key } = encryptWithRandomKey(yamlStr)

    res.status(200).json({
      filename: `${profileName}.yaml`,
      content: cipherText,
      key
    })
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
