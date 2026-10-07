/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Intel AMT DICE trust anchors for Nova Lake and newer platforms.
 * These public Intel certificates validate AMT device certificate chains
 * when TLS is enforced on supported platforms.
 *
 * Certificate source: https://tsci.intel.com/content/DICE/certs/Intel_DICE_SubCA_CAID343_1_001.cer
 * SHA-256 fingerprint: FB:31:E4:10:9E:75:63:53:2B:3D:19:79:57:28:2A:5C:7A:9B:5D:C8:AC:49:B4:B7:BD:B0:C7:B8:A8:CF:48:F0
 */
export const AMT_DICE_ROOT_CERTS: string[] = [
  // Intel DICE SubCA certificate for CAID 343_1 (ECC P-384, valid 2023-2048)
  // Subject: O=Intel Corporation, organizationIdentifier=PEN:343, CN=Intel DICE SubCA CAID:343_1
  `-----BEGIN CERTIFICATE-----
MIIDNTCCArygAwIBAgIBATAKBggqhkjOPQQDAzCBljELMAkGA1UEBhMCVVMxCzAJ
BgNVBAgMAk9SMRIwEAYDVQQHDAlCZWF2ZXJ0b24xJzAlBgNVBAoMHkRpZ2l0YWwg
Q29udGVudCBQcm90ZWN0aW9uIExMQzEbMBkGA1UECwwSd3d3LmRpZ2l0YWwtY3Au
Y29tMSAwHgYDVQQDDBdEQ1AgRElDRSBHbG9iYWwgUm9vdCBDQTAeFw0yMzA4MzEw
MDAwMDBaFw00ODA4MzEyMzU5NTlaMFQxGjAYBgNVBAoMEUludGVsIENvcnBvcmF0
aW9uMRAwDgYDVQRhDAdQRU46MzQzMSQwIgYDVQQDDBtJbnRlbCBESUNFIFN1YkNB
IENBSUQ6MzQzXzEwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAATjQ3CY+gXLKuqBtIps
wyRnKElLktVr+oqOJG35e+HZok6OuMpAuubw9cWG5jJHxIzA1Evm1aFkLGPpUKN1
96TlhHc7ZRr3PCRDnO7E/hArckzVsUqV3FVCPXqOt+zya0SjggEdMIIBGTAfBgNV
HSMEGDAWgBTf2DOY0in/t0g+4JcBBPWEkX4k+DAdBgNVHQ4EFgQUg7+NYfGQGKhE
Me577IacE8vGXBgwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAYYwYAYI
KwYBBQUHAQEEVDBSMFAGCCsGAQUFBzAChkRodHRwczovL3RzY2kuaW50ZWwuY29t
L2NvbnRlbnQvRElDRS9jZXJ0cy9EQ1BfRElDRV9HbG9iYWxfUm9vdENBLmNlcjBU
BgNVHR8ETTBLMEmgR6BFhkNodHRwczovL3RzY2kuaW50ZWwuY29tL2NvbnRlbnQv
RElDRS9jcmxzL0RDUF9ESUNFX0dsb2JhbF9Sb290Q0EuY3JsMAoGCCqGSM49BAMD
A2cAMGQCMGGNmf8CeNB2S8oOMSdbG7OlqIXoTi6/ZPFzRosJdruS9ZVYxgGyDeqv
DVNkj+vIIgIwDH4qB21sjnGMSETaNQ/QpnoYWpUy3PrVEadgevkPln6judOr77NB
JBKbBt0vlSE6
-----END CERTIFICATE-----`
]
