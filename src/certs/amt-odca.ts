/*********************************************************************
 * Copyright (c) Intel Corporation 2024
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Intel AMT ODCA (On-Die Certificate Authority) root certificates for TLS validation.
 * These are public Intel certificates used to validate AMT device certificates
 * when TLS is enforced on the AMT platform.
 *
 * Certificate source: src/certs/OnDie_CA_RootCA_Certificate.cer
 */
export const AMT_ODCA_ROOT_CERTS: string[] = [
  // Intel OnDie CA Root Certificate (ECC P-384, valid 2019-2049)
  // Subject: O=Intel Corporation, OU=OnDie CA Root Cert Signing, CN=www.intel.com
  `-----BEGIN CERTIFICATE-----
MIICujCCAj6gAwIBAgIUPLLiHTrwySRtWxR4lxKLlu7MJ7wwDAYIKoZIzj0EAwMF
ADCBiTELMAkGA1UEBgwCVVMxCzAJBgNVBAgMAkNBMRQwEgYDVQQHDAtTYW50YSBD
bGFyYTEaMBgGA1UECgwRSW50ZWwgQ29ycG9yYXRpb24xIzAhBgNVBAsMGk9uRGll
IENBIFJvb3QgQ2VydCBTaWduaW5nMRYwFAYDVQQDDA13d3cuaW50ZWwuY29tMB4X
DTE5MDQwMzAwMDAwMFoXDTQ5MTIzMTIzNTk1OVowgYkxCzAJBgNVBAYMAlVTMQsw
CQYDVQQIDAJDQTEUMBIGA1UEBwwLU2FudGEgQ2xhcmExGjAYBgNVBAoMEUludGVs
IENvcnBvcmF0aW9uMSMwIQYDVQQLDBpPbkRpZSBDQSBSb290IENlcnQgU2lnbmlu
ZzEWMBQGA1UEAwwNd3d3LmludGVsLmNvbTB2MBAGByqGSM49AgEGBSuBBAAiA2IA
BK8SfB2UflvXZqb5Kc3+lokrABHWazvNER2axPURP64HILkXChPB0OEX5hLB7Okw
7Dy6oFqB5tQVDupgfvUX/SgYBEaDdG5rCVFrGAis6HX5TA2ewQmj14r2ncHBgnpp
B6NjMGEwHwYDVR0jBBgwFoAUtFjJ9uQIQKPyWMg5eG6ujgqNnDgwDwYDVR0TAQH/
BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAQYwHQYDVR0OBBYEFLRYyfbkCECj8ljIOXhu
ro4KjZw4MAwGCCqGSM49BAMDBQADaAAwZQIxAP9B4lFF86uvpHmkcp61cWaU565a
yE3p7ezu9haLE/lPLh5hFQfmTi1nm/sG3JEXMQIwNpKfHoDmUTrUyezhhfv3GG+1
CqBXstmCYH40buj9jKW3pHWc71s9arEmPWli7I8U
-----END CERTIFICATE-----`
]
