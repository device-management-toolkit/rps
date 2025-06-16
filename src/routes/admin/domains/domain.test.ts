/*********************************************************************
 * Copyright (c) Intel Corporation 2022
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

import { passwordChecker, domainSuffixChecker, expirationChecker } from './domain.js'
import { NodeForge } from '../../../NodeForge.js'
import { CertManager } from '../../../certManager.js'
import Logger from '../../../Logger.js'

describe('Domain Profile Validation', () => {
  const nodeForge = new NodeForge()
  const certManager = new CertManager(new Logger('CertManager'), nodeForge)
  let req
  let pfxobj
  let value

  test('passwordChecker - success', () => {
    req = {
      body: {
        provisioningCert:
          'MIIPHwIBAzCCDtUGCSqGSIb3DQEHAaCCDsYEgg7CMIIOvjCCCTIGCSqGSIb3DQEHBqCCCSMwggkfAgEAMIIJGAYJKoZIhvcNAQcBMFcGCSqGSIb3DQEFDTBKMCkGCSqGSIb3DQEFDDAcBAiez5X6uaJNRwICCAAwDAYIKoZIhvcNAgkFADAdBglghkgBZQMEASoEEFxT8M8aNmQ21VBJmNP10/mAggiwRGvio668bHHlIDpETQmJHvzEYnF3ou1Z5JkK8RCAdXbD5rkJuoQ6mzEZeyjtE2i4X0RMqVVZ+lfYUMoEysMxjccN87xGfrNvkM4En18E0xnxEcxINQmdRiqB8EniQnaLIdN4Mo7XHH0L3eqbA5ikYzDD3Do4OiGWLIMX5OCJHapR74pOcOglrcVL+QJ2blDBpIzFstgY15DYf7sxEiQPRwlccqaB0FjSxbaz9pZdE8U/dddgReJOTggB+dF5KwkntHF/CAmgAwwaORlRiA13RTRJGcuhjZ+bV9z/WmEfGqEvxAHqfgwXIoNvEpDWO/UEuuf+0Aq0uLLEebtkxfF0LHY+2Pnmw+KB9ECQdMv9GlX8LtTEGJZ8r+KquKjUcC1VNFbrCuoQxmaFNvtcpHDUcmfIzvRFWD5k56lBM+XzPVTysRoi3bmoJ134N+1XAAy8/OkJb8XMeqtJ9jTXdBdNGmhoO53huh6mP+X3tFMHGsWgFt5KAOB/IqnnYwT6gcnHRZYf59Zp9mKLSFE6IvPpkVSqOQJ3YOc6m99E3y4A/FBM0NibglfIKzbHc038NyXltv0X6oR+agDOR0pp7Zn3II0yOjFy//4ot4/Iojnz9F4Lc4ao3pnTOAU1/Osq3UQgtOlabantMfyXuTZb1RGTq52dBpsEbDq8xspIv6lONoH84ZEYDp7lj0N8nkrsH77AWNXwghUV8u3Ejd5dKUci61t5zfbHIsBiPw7aDuCkNA04xSaOKtJxofwe9d/hjmhMXT67gLK7KM4SquHyLUubqWFD3jWXmGkfKRzI+nF+pgC5HV2G85FwdxoqW7ffZ2gLayyaktpE4ncNMdUIOCCzVI3zX4JpUSoz9kJdWx68qKoxYS/UZHdRwVjtPcW8geAbriDIw3oDlAwKaPyyng7fuTQLKpRygDHuIwrCxnrNpzoxMuXkJ140bwOlSsWjjyTX5LZEcbSP6Y426wDYB60nhz3D+ACmrIL0NPGQF1R0OW72uOBCT2CYniDdr0QoexR/4B0LbS7GtPqMyx0LnIWEn1NmhELvW7GfoOOdo8K8cb927vrO9N+zCNcXdTCaM1XuJvS7uLjdREfkFvQ8FXUSf53p0Uu/nynKNzRDHeXuVDv3xaxYvNvlrGZDwgzKVclQrMUoawPyQMxgRniH0UUecx5aHz75RomL0o6NnhbbgPtW1IjsCtRloM+vqYeX/+llq99M/l1YtlGj9IdtmMYXUtvLP0Vv7Me0ro5UwUaZ1TxvdOvDAYzrpN4voaysGLdDG0c2y5+ZjxLYPp01P4IaEd6JHmjVr8IckaSEY9uTz6y3sQg7o2MLWrcRa8SJoK8p6jzGFTXo5DCSMm8CSkHT4yJP3t1Mqisxa98QY5wgJkbfGxBfhDqq0DevtcOxcsqpOhbzOdRYFLiJ0p5sm7zHsDm4cteZys3LgpPRJVeLSfn7SKg/FRWhvrvy5gf1JvqU00LHkDjXN5Fvz0YAI5mdq29iuG8VzAGv4bU8UD+JF+UWdyQS20NRPmbrmw8G1kUo6K1A0m3BciTDyH8siMcZybl2VtWwzN8JoKWpDhYLNTH2+RForqMiQ30EBPz644BVwJS48Pf4h6acZGKTK4x3ro807O8bOJup18QDJIuNmzCxW0exEYs0x20xc8yDFtN/OM4m5x9ob96SpB8hVRmQ0KtYpMuI5AeoyraONRSuR6QUzcE+Xh9sIVajlQUPPpnl4tsDo7cfJeDD/9USna11dLIBIEVdYRrVM7YsBSib4L0RrzJxEBUHt9AWlvX37IO8OCChg2iQ521cI6kaBJR2Z7rLNBM+eRkyhhn9c239hBwgYignB1VRzcPE7KhFZkejz9+VZ9twU2N+1b8H8yldCiC8Mq2/0QFIfluUi1gxTKao4fj7sSUpcy5yl7Am/ra9lLsyrg9OK+FquiyYpwRoadkEiZd30lNyzE7nPBPNxEuAFrCyqb0HASj4lYThlG6qilqM1RgOF9UIyv+y+H/1STFcVXEk61bMoPaa1lb5Dp3tUfSgjEyGrwCjaa//zgC2SkCsataK81/vqBpbPDyf7zOukQH1JNrdY1Y5d+tFjME715MaZc1oTAnbCBAX/GfDC48E98cXYcBn3ZIKe2YHDBAB1dcYj93QApaLt1HO7pHax9zc5JYn4FP+gWZrtCrIF6q2+/P/oR2e7qm+FQtsEXdrMKjpeC4hJTxzMlgF1hutFKDWp128LWD4A4ldocN0bUGDqbVjWypb5jeFuUBnv68tr2/Vnc6z3l2XOXOZGn4DVRJThqtY6vhfixCScg9QX5HhLcoRD19wSHEpbnlWeQEUA+fnYdaI8zCV1A+BmLHUH5gMeIKVqv+pZqTqqFYCcOcEAYxzg3eUWoSY8Toz5lnb+XObbyzLrSECX2/mCzkM1MIObxy7ZUdgDfM9Q18JQs/eA2ZymNENdWcWL4UgzWj0U/Wh13LEFidr+VcmaQSJRR6ybxW2uSP28olVfslWwRYloq/ujQGzgqcN62Nhi4j+wIEiFmLirOy9scuNuKKo+9zDCrT7+YyLxakKg4p87K4lPqcckteAA/lPuWnZ8fT9O8XK9wHXrDUb6KVDmmS4VdR1U5Jy/Za+ghveVHxYKoRi3Xehcnjgblv/m7t4Z+UxwUT9XMEDJPJfu1De/YbnxpGkZIFlRae7C0bgAKwFi+0a/P1ZpPgIbBEsJANM3JTmuylm45Vv20+Pot+BC9pcKl+MCNPdgQx6bJhPJ/fBAVMVg4LjLOQPjRrUbkA6qUc9ph5eVYpVDf1VEAKRvheokuxEM7ZAXFZcctqWQKf3LyFn4egdFHYaBxxUHgbss8YO0iHXTKlmlKgNobvsphG50FJB6qp2Et3l+lIrjy0QrpYvwcIqcAUiOFwCGxRAnoR/AADJNJ7EuiI4wishfaD9ulep1n8IcRUVtjB3yrbGFx6D1tBpf0w68eRJvhouUzCCBYQGCSqGSIb3DQEHAaCCBXUEggVxMIIFbTCCBWkGCyqGSIb3DQEMCgECoIIFMTCCBS0wVwYJKoZIhvcNAQUNMEowKQYJKoZIhvcNAQUMMBwECCYPMxEm1ltGAgIIADAMBggqhkiG9w0CCQUAMB0GCWCGSAFlAwQBKgQQ/T9ulY2vAA9dow6ejwOW+QSCBNBqWB0CH2Nsj9QGrtmhBXXZeioN7mJlJJEHLxHwd5yPNdWvzcHq2s2cZqYmBuDMfNJ+0UtVFWsSc85U/kwoq2X9hL4ZTrVYManLr4jROcajMZoWW3rejQssrMjEl9kbZSOkLB9MDtOF8xIdQ811V4XasfxEEhHTkjTXQ5UElsDZmT2t10G8f69xbW6muh3KDSAJBGyLHezSjYKdSZASiqjBDPo68vFyZySKXhhDm0feC9gmLoxU93cVaoPwpwgYGpAvntTX/1gvuh/hhX3zm/fgznXrd+sRjnj1kh1OdjF1K7Dv+XG10rufebsUWH16Q6Li4rmhQCiH0ao3Cnd1IVqRmVjm26Q7VIgNpCcYqwi1+d8QoI2ZAzs/WnIa27uKlXIpXKuHvKkY6ZSeSc8Ujf2oPlCkiG7h47z8uKRP0x/Cp8cqrQLuAczwAA07sSrj1sCUuaYZ/I4jdK83f1LQoZ5QrWlT+lAC+mDaWrA/U3w60xASMtnyVsphOB6xqN2Gk1ccIos107gGhfGBAk23FNfjeq7UdYzzwKl4mecpFTwaLHWghjo++BYaF/yi9mU5npYkvt9RQktoEy4rQ+klrYREq6/oTkBo6X7MRcU4FXWuk4RdTnd/gkoLH7xmgst+A47S7NlcAGZvYEWA/4HsvNkG3/fYTUpHmr68Wbawj5ptN23Dkcm1oSX3jxQrk48umGpKOHomGkswKVm7RiPBBqlO2I6wFBbmSAqsvdDd1NHYGei2VdWiZ3UPBJYPaPqQOlroZqkLn3juuJTI4AO/vJ5LMPwOWEFMoHVqUZEHXDDqFoAAjkoLLSgflhG6+G5911K3sNja648RLRu8pys6gTMF+0S9ZKgeqbH/SJ8zCxU1EXt3KjdoLiwioNtv2V2Tp3oRfsPlfKfl7i4t0PZMENwEnVNQavCT7KZ34ibpFqYGcPkIUgHGbr/AikTQgXMeMfCrV/MWs0wWEmWwqD8vtcwGSo2k3dT83RbzuKSKNMsW1WLN0b+bdYZAYh7oDce4rehbGWFtrMxMSl2L7focRac4Ns7hpd+Ac/q841kescsMAtFPeJcxMans8nTylfhiB+1+e2Sikydy6+ZLT96GZLLDm3uSEwkxgNHtB2eAkv6dPk83rpN1DjLsj8pUu4eh6CuqwqohuILJCyQMDr/7V+wucSHeAqEx2RJx8o9cx7gkfCNnqCt9/UW96bbnnlLpYuUou5R6QyWMxqTSp+s8EgBtXNLaKcjt0gjmEhieAl55LmZn0ePxSJjYyF3AYO1tvxT4wWrLdiAA/Kj7mZcOdpisdjzIJdt9JgMjdmuCiJPvrujcj4rpEyhsBgDTe39eSEWe86yxsUewnacMClv/gmk/8p5sssyjETIEgSiGJxXG3DUcqlJ2nXFlgMojU9XEXir02GlxGzm1QE6USIJZ2d4HT0TAEq8qGssLoWQ+FKGHmbc9Qmm6Own0T6YVAzTJ+llj2dosTo5PT1pM06VyEgVcaREM2PLBZYju0NpRs14hYyQ24039URFa5pmnaYvcQvv3c3U/zlnAKgO6Cpyo3aby+Zrk9z6534YVIgPjNMF7Wp3MYchH+pxSA4ju8ItvGZhy4hof123yxf8Yh4LE5HjvTfG0h9gHqJRAoUH7k8PG1jElMCMGCSqGSIb3DQEJFTEWBBQQ121XP0QcupPfyzRfFXFWVYQnPjBBMDEwDQYJYIZIAWUDBAIBBQAEIG7DUtDht1xHJ77sCWv/Gu/2n+Ecv5Zfl3TTSYF5VzlfBAhEnK6i8ASSZwICCAA=',
        provisioningCertPassword: 'P@ssw0rd'
      }
    }
    pfxobj = passwordChecker(certManager, req)
    expect(() => {
      passwordChecker(certManager, req)
    }).not.toThrow(
      new Error(
        'Unable to decrypt provisioning certificate. Please check that the password is correct, and that the certificate is a valid certificate.'
      )
    )
  })

  test('passwordChecker - failure', () => {
    req = {
      body: {
        provisioningCert:
          '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',
        provisioningCertPassword: 'Wrong123!'
      }
    }
    expect(() => {
      passwordChecker(certManager, req)
    }).toThrow(
      new Error(
        'Unable to decrypt provisioning certificate. Please check that the password is correct, and that the certificate is a valid certificate.'
      )
    )
  })

  test('domainSuffixChecker (root) - success', () => {
    value = 'vprodemo.com'
    expect(() => {
      domainSuffixChecker(pfxobj, value)
    }).not.toThrow(new Error('FQDN not associated with provisioning certificate'))
  })

  test('domainSuffixChecker (subdomain) - success', () => {
    value = 'test.vprodemo.com'
    expect(() => {
      domainSuffixChecker(pfxobj, value)
    }).not.toThrow(new Error('FQDN not associated with provisioning certificate'))
  })

  test('domainSuffixChecker (subdomain) - success', () => {
    value = 'intel.vprodemo.com'
    expect(() => {
      domainSuffixChecker(pfxobj, value)
    }).not.toThrow(new Error('FQDN not associated with provisioning certificate'))
  })

  test('domainSuffixChecker (root) - failure', () => {
    value = 'wrong.com'
    expect(() => {
      domainSuffixChecker(pfxobj, value)
    }).toThrow(new Error('FQDN not associated with provisioning certificate'))
  })
  test('domainSuffixChecker (subdomain) - failure', () => {
    value = 'test.wrong.com'
    expect(() => {
      domainSuffixChecker(pfxobj, value)
    }).toThrow(new Error('FQDN not associated with provisioning certificate'))
  })

  test('expirationChecker - success', () => {
    expect(() => {
      expirationChecker(pfxobj)
    }).not.toThrow(new Error('Uploaded certificate has expired'))
  })

  test('expirationChecker - failure', () => {
    pfxobj.certs[0].validity.notAfter = new Date(1478708162000)
    expect(() => {
      expirationChecker(pfxobj)
    }).toThrow(new Error('Uploaded certificate has expired'))
  })
})
