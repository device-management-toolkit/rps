/*********************************************************************
 * Copyright (c) Intel Corporation 2026
 * SPDX-License-Identifier: Apache-2.0
 **********************************************************************/

/**
 * Intel DICE root certificates for AMT 22+ TLS validation.
 *
 * AMT 22 devices present a DICE-rooted device identity chain (top certificate
 * `O=Intel Corporation, organizationIdentifier=PEN:343,
 * CN=Intel DICE SubCA CAID:343_1`) rather than the ODCA-rooted chain used by
 * AMT 21 and earlier. Those chains do not terminate at any certificate in
 * AMT_ODCA_ROOT_CERTS.
 *
 * Add the official Intel DICE root PEM(s) here. Once populated, AMT 22 chains
 * verify normally and the temporary bypass (see allowIntelDiceTrustBypass in
 * TLSTunnelManager) can be turned off by setting RPS_ALLOW_INTEL_DICE_BYPASS
 * to false, and eventually removed.
 */
export const AMT_DICE_ROOT_CERTS: string[] = []
