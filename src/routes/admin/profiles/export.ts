import { WirelessConfig } from 'models/RCS.Config.js'
import Logger from '../../../Logger.js'
import { NOT_FOUND_EXCEPTION, NOT_FOUND_MESSAGE } from '../../../utils/constants.js'
import handleError from '../../../utils/handleError.js'
import { RPSError } from '../../../utils/RPSError.js'
import { type Request, type Response } from 'express'
import yaml from 'js-yaml'
import { encryptWithRandomKey } from '../../../utils/encryptWithRandomKey.js'

export async function exportProfile(req: Request, res: Response): Promise<void> {
  const log = new Logger('exportProfile')
  const { profileName, domainName } = req.params
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
    if (result.activation === 'acmactivate') {
      const domainStuff = await req.db.domains.getByName(domainName, req.tenantId)
      ;(result as any).domainObject = domainStuff
    }
    const wifiConfigs: any[] = []
    if (result.wifiConfigs && result.wifiConfigs.length > 0) {
      for (const wifiConfig of result.wifiConfigs) {
        const wifiConfigObject = await req.db.wirelessProfiles.getByName(wifiConfig.profileName, req.tenantId)
        if (wifiConfigObject == null) {
          throw new RPSError(NOT_FOUND_MESSAGE('Wireless', wifiConfig.profileName), NOT_FOUND_EXCEPTION)
        }
        wifiConfigs.push({
          profileName: wifiConfigObject.profileName,
          ssid: wifiConfigObject.ssid,
          priority: wifiConfig.priority,
          authenticationMethod: wifiConfigObject.authenticationMethod,
          encryptionMethod: wifiConfigObject.encryptionMethod,
          pskPassphrase: wifiConfigObject.pskPassphrase,
          ieee8021xProfileName: wifiConfigObject.ieee8021xProfileName
        })
      }
    }
    let ieee8021xConfigs: any[] = []
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
          authenticationProtocol: ieee8021xProfile.authenticationProtocol
          // clientCert: ieee8021xProfile.clientCert,
          // caCert: ieee8021xProfile.caCert,
          // privateKey: ieee8021xProfile.privateKey
        }
      ]
    }

    // Map to Go struct shape
    const output = {
      password: result.amtPassword ?? '', // Adjust as needed
      tlsConfig: {
        //delay: result.tlsDelay ?? 3,
        mode: result.tlsMode ?? ''
      },
      wiredConfig: {
        dhcp: result.dhcpEnabled ?? true,
        static: !result.dhcpEnabled,
        ipsync: result.ipSyncEnabled ?? false,
        // ipaddress: result.ipAddress ?? '',
        // subnetmask: result.subnetMask ?? '',
        // gateway: result.gateway ?? '',
        // primarydns: result.primaryDns ?? '',
        // secondarydns: result.secondaryDns ?? '',
        ieee8021xProfileName: result.ieee8021xProfileName ?? ''
      },
      wifiConfigs,
      wifiSyncEnabled: result.localWifiSyncEnabled ?? false,
      ieee8021xConfigs,
      acmactivate:
        result.activation === 'acmactivate'
          ? {
              amtPassword: result.amtPassword ?? '',
              provisioningCert: '',
              provisioningCertPwd: ''
            }
          : null,
      enterpriseAssistant: {
        eaAddress: '', //result.eaAddress ?? '',
        eaUsername: '', //result.eaUsername ?? '',
        eaPassword: '', //result.eaPassword ?? '',
        eaConfigured: '' //result.eaConfigured ?? false
      },
      // stopConfig: result.stopConfig ?? false,
      ccmactivate:
        result.activation === 'ccmactivate'
          ? {
              amtPassword: result.amtPassword ?? ''
            }
          : null
    }

    const yamlStr = yaml.dump(output)
    // Encrypt the YAML string and provide the key
    const { cipherText, key } = encryptWithRandomKey(yamlStr)
    res.status(200).send({
      filename: `${profileName}.yaml.enc`,
      content: cipherText,
      key
    })
  } catch (error) {
    handleError(log, profileName, req, res, error)
  }
}
