/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Intel DICE certificates for AMT 22+ (Nova Lake) TLS validation.
 * AMT 22 devices present a DICE-rooted device identity chain rather than the
 * ODCA-rooted chain used by AMT 21 and earlier, so those chains do not terminate
 * at any certificate in AMT_ODCA_ROOT_CERTS.
 *
 * Certificate source: https://tsci.intel.com/content/DICE/certs/
 */

/**
 * Trust anchors for production AMT 22+ chains. These are always trusted. The release root signs the
 * Intel DICE SubCA (CAID:343_1) that production devices send as the top of their chain, so a production
 * chain verifies against it.
 */
export const AMT_DICE_ROOT_CERTS: string[] = [
  // DCP DICE Global Root CA, release edition (ECC P-384, valid 2022-11-08 to 9999-12-31)
  // Subject: O=Digital Content Protection LLC, OU=www.digital-cp.com, CN=DCP DICE Global Root CA
  // Source: DCP_DICE_Global_RootCA.cer (tsci.intel.com), signs production hardware
  `-----BEGIN CERTIFICATE-----
MIICvzCCAkWgAwIBAgIBATAKBggqhkjOPQQDAzCBljELMAkGA1UEBhMCVVMxCzAJ
BgNVBAgMAk9SMRIwEAYDVQQHDAlCZWF2ZXJ0b24xJzAlBgNVBAoMHkRpZ2l0YWwg
Q29udGVudCBQcm90ZWN0aW9uIExMQzEbMBkGA1UECwwSd3d3LmRpZ2l0YWwtY3Au
Y29tMSAwHgYDVQQDDBdEQ1AgRElDRSBHbG9iYWwgUm9vdCBDQTAgFw0yMjExMDgw
MDAwMDBaGA85OTk5MTIzMTIzNTk1OVowgZYxCzAJBgNVBAYTAlVTMQswCQYDVQQI
DAJPUjESMBAGA1UEBwwJQmVhdmVydG9uMScwJQYDVQQKDB5EaWdpdGFsIENvbnRl
bnQgUHJvdGVjdGlvbiBMTEMxGzAZBgNVBAsMEnd3dy5kaWdpdGFsLWNwLmNvbTEg
MB4GA1UEAwwXRENQIERJQ0UgR2xvYmFsIFJvb3QgQ0EwdjAQBgcqhkjOPQIBBgUr
gQQAIgNiAARsKutjXKfmY9oRS13S3I7tI5zgyXe9lBBSgvNN6cTWg2qypABZkTPQ
0wpqvprlp4Gs7c3QmRuZS9hjILmv+uJ8M82gqg6WAEaxqYxl+OG5FmjV7qf5kahi
ePomYmbyIWqjYzBhMB8GA1UdIwQYMBaAFN/YM5jSKf+3SD7glwEE9YSRfiT4MB0G
A1UdDgQWBBTf2DOY0in/t0g+4JcBBPWEkX4k+DAPBgNVHRMBAf8EBTADAQH/MA4G
A1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAwNoADBlAjEA8zSzW/8s2t/qMOcSzZtn
J2uM2dPjx+7wNFnLItL2IJeFhN174zEH/cEghZwqdBiTAjBrkNNclapojHjhytQa
zbCnJ+VYsurSFyJdAfiBEU8BbFpJoVHqc+S84Awlqn3jW3c=
-----END CERTIFICATE-----`
]

/**
 * Trust anchors for pre-production (debug and engineering) AMT 22+ hardware. They are trusted only
 * when the amt_dice_allow_debug_root setting is enabled (RPS_AMT_DICE_ALLOW_DEBUG_ROOT=true).
 * Never enable this in production: the debug root signs engineering parts.
 */
export const AMT_DICE_DEBUG_ROOT_CERTS: string[] = [
  // DCP DICE Global Root CA, debug edition (ECC P-384, valid 2024-01-01 to 9999-12-31)
  // Subject: O=Digital Content Protection LLC, OU=www.digital-cp.com, CN=DCP DICE Global Root CA
  // Source: DCP_DICE_Global_RootCA.cer (tsde.intel.com), signs pre-production hardware
  `-----BEGIN CERTIFICATE-----
MIICwDCCAkWgAwIBAgIBATAKBggqhkjOPQQDAzCBljELMAkGA1UEBgwCVVMxCzAJ
BgNVBAgMAk9SMRIwEAYDVQQHDAlCZWF2ZXJ0b24xJzAlBgNVBAoMHkRpZ2l0YWwg
Q29udGVudCBQcm90ZWN0aW9uIExMQzEbMBkGA1UECwwSd3d3LmRpZ2l0YWwtY3Au
Y29tMSAwHgYDVQQDDBdEQ1AgRElDRSBHbG9iYWwgUm9vdCBDQTAgFw0yNDAxMDEw
MDAwMDBaGA85OTk5MTIzMTIzNTk1OVowgZYxCzAJBgNVBAYMAlVTMQswCQYDVQQI
DAJPUjESMBAGA1UEBwwJQmVhdmVydG9uMScwJQYDVQQKDB5EaWdpdGFsIENvbnRl
bnQgUHJvdGVjdGlvbiBMTEMxGzAZBgNVBAsMEnd3dy5kaWdpdGFsLWNwLmNvbTEg
MB4GA1UEAwwXRENQIERJQ0UgR2xvYmFsIFJvb3QgQ0EwdjAQBgcqhkjOPQIBBgUr
gQQAIgNiAAS/AK1rr74Mp8quBLO+1rT2fYtJPFjdbF9t3qmnXbtHw+un1aoPjrbu
0lRtgFdcPT/o9s69WREg5Q3Cj2zr26JOeIyY4lAPPvCXjV6+h24v9ASrPqPo4OM5
egU6j4n2obCjYzBhMB8GA1UdIwQYMBaAFOtX00XGYYiDG45jnSrMGcYu2GpaMB0G
A1UdDgQWBBTrV9NFxmGIgxuOY50qzBnGLthqWjAPBgNVHRMBAf8EBTADAQH/MA4G
A1UdDwEB/wQEAwIBBjAKBggqhkjOPQQDAwNpADBmAjEA86VlSmSGGwHLHirs37pR
fy/M6jBMgUDEvnkq+4dM6vBbla4q2E+xo/911ayisivHAjEA42F7eeK35YfVJ5F6
qvc09Cdx2fdB6R65jqma/VGARZc77zQ4vQ3NMdd937jGNqZQ
-----END CERTIFICATE-----`
]
