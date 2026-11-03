# RPS provisioning optimizations

This report describes the changes for
[issue #2935](https://github.com/device-management-toolkit/rps/issues/2935) on
`analysis/provisioning-state-machine`, reviewed November 3, 2026. The source
baseline is **v2.40.2 (`583d61f`)**. The tested optimized image is **`f2ead6d`**,
including the clock-synchronization correction in `9f9245b`. Both builds used
the **15-second default TLS timer**.

We removed unnecessary reads and retained a verified existing TLS identity
where eligible. The tested AMT 21 profile completed first-time activation and
reconfiguration on both builds. Broader hardware and recovery coverage remains
outstanding.

## Implemented changes

| Change | Before | After | Scope |
|---|---|---|---|
| **Skip unused cleanup reads** | Cleanup read TLS settings, then discarded the result on the TLS-enforced route. | Evaluate the existing guard before Enumerate/Pull, saving two requests. | TLS-enforced activation and reconfiguration |
| **Reuse a fresh credential check** | TLS probing and certificate validation read the same credential contexts twice. | Reuse a complete, current probe snapshot, saving two requests when eligible. | TLS validation within the same attempt/session |
| **Retain a verified TLS identity** | Deferred enrollment could regenerate keys and certificates despite an earlier live/Vault match. | Recheck identity and policy after configuration; skip enrollment only when reuse is approved. | Eligible reconfiguration in the same control mode |
| **Skip the unchanged-certificate wait** | Existing TLS reconfiguration waited for the configured rollover timer, which defaults to 15 seconds. | Skip the configured wait for an approved unchanged identity, then establish a fresh tunnel. | Eligible TLS reconfiguration |
| **Report reused TLS success** | Skipping the TLS child omitted its structured success result. | Record TLS `Success` with `Already configured` on the reuse route. | Successful identity reuse |
| **Preserve AMT clock synchronization** | The first reuse implementation also skipped the TLS child's time synchronization. | Read AMT time and synchronize it before reporting reuse success; fail if either operation fails. | Successful identity reuse |

### Conditions for safe reuse

The credential snapshot is complete, tied to the tunnel session, and valid for
less than 30 seconds. Expiration, incomplete reads, reset, reconnect,
reconfiguration, or a new attempt prevent stale reuse. Public-certificate reads,
association checks, and live/Vault fingerprint validation remain required.

Identity reuse additionally requires an already activated device in the same
control mode and all of the following:

- Local and remote TLS enabled, with requested remote settings matching.
- Live leaf matching the Vault leaf and the expected DMT-generated hostname.
- Server-auth EKU and a valid signature against the freshly fetched requested
  MPS CA.
- CA and leaf valid now and for more than the 30-day renewal window.

Custom profile certificates, Microsoft CA, mutual TLS, Wi-Fi, and wired 802.1X
profiles retain enrollment. First-time activation and CCM-to-ACM upgrades do
not receive identity reuse approval.

After cleanup, network, and feature configuration, the reuse route performs
**six live verification reads** for TLS settings, credential contexts, and
certificates. Changed identity/settings, incomplete or stale evidence, failed
checks, and dependency errors fall back to TLS provisioning. After successful
verification, `GET_REUSED_TLS_TIME` and `SET_REUSED_TLS_TIME` use the existing
time-machine actors and WS-Man SDK to read and synchronize AMT time. Success
then records the TLS result and continues to CIRA when configured, otherwise
completion. A rejected invocation, missing/nonfinite clock reading, or firmware
error return routes to failure without recording TLS reuse success. The shared
transport retains its existing retry behavior.

The configured wait is skipped only within the validated session with no reset
or reconfiguration pending. The decision is cleared when the port-switch state
exits. Actual enrollment, commit, upgrade, and recovery waits remain. Retained
certificates use `validatedCertPEM`, separate from newly issued `issuedCertPEM`;
both activation and common transport reconnect use managed trust material.
A newly issued identity takes precedence, and approved reuse disables the
bootstrap self-signed fallback.

### Changed source

| File | Responsibility |
|---|---|
| [unconfiguration.ts](../src/stateMachines/unconfiguration.ts) | Earlier cleanup guard |
| [activation.ts](../src/stateMachines/activation.ts) | Probe reuse, identity approval, final verification, wait decision, retained clock synchronization, and TLS result |
| [tlsReuse.ts](../src/stateMachines/tlsReuse.ts) | Certificate/profile eligibility and managed trust selection |
| [common.ts](../src/stateMachines/common.ts) | Managed trust on transport reconnect |
| [RCS.Config.ts](../src/models/RCS.Config.ts) | Runtime fields for retained identity |

Sibling machine tests cover the changed behavior.
[provisioningAnalysis.test.ts](../src/test/provisioningAnalysis.test.ts)
characterizes baseline routing with scripted external responses; it does not
prove complete hardware provisioning. Synthetic certificates in
[TlsReuseCertificates.ts](../src/test/helper/TlsReuseCertificates.ts) support
cryptographic regression coverage.

## Measured results

One run per flow and build was captured on November 3 using AMT **21.0.2**,
end-to-end TLS, the same device and profile name, identical dependency lockfiles,
and the **15-second TLS timer**. The first-time runs both reported initial
pre-provisioning mode (`currentMode=0`); the reconfiguration runs both reported
ACM (`currentMode=2`). RPS environment settings and credentials were carried
forward when switching images.

| Flow | Baseline time | Optimized time | Baseline requests | Optimized requests | Time reduction |
|---|---|---|---|---|---|
| First-time activation | 194.141 s | 190.035 s | 74 | 70 | 4.106 s (2.12%) |
| ACM reconfiguration | 105.470 s | 70.508 s | 64 | 51 | 34.961 s (33.15%) |

Durations run from RPS receipt of the activation request to its final
provisioning-status log, not from RPC command start. Counts are transport
request-log blocks, excluding extra actor XML logs.

### What the traces confirm

First-time activation removed only the duplicate TLS credential Enumerate/Pull
pair and unused cleanup TLS-settings Enumerate/Pull pair: **four fewer reads**.
Both builds retained CCM setup, ACM upgrade, one key generation and certificate
installation, three commits, and both clock-synchronization requests. Activation
to ACM, TLS, wired network, and CIRA all reported success.

Reconfiguration reused the verified identity, skipped its configured rollover
wait, performed final live verification, and retained `GetLowAccuracyTimeSynch`
and `SetHighAccuracyTimeSynch`. No new key or leaf certificate was created, and
no TLS commit was issued. TLS reported **Success / Already configured**; wired
network, CIRA, and activation status also reported success.

The measured reconfiguration count matches the intended route:

**64 − 2 cleanup reads − 2 duplicate credential reads − 17 enrollment requests
+ 6 final verification reads + 2 retained clock-synchronization requests = 51.**

These successful runs exercise the reporting and clock fixes on hardware for
this profile. They do not establish typical performance: each result has one
sample, full profile/configuration and fresh-state snapshots were not independently
captured, and CIRA connectivity through MPS was not separately verified. Wireless,
802.1X, proxy, alternate transports, and fault/partial-provisioning scenarios still
need their own profiles and tests.

Earlier exploratory runs used a local five-second override and a build that
omitted clock synchronization on reuse. Their 49-request result is superseded
by this corrected, 51-request measurement; do not combine the two timer settings
or treat the older timing as a result for the current implementation.

### Redacted request sequences

The four columns below are independent ordered runs, not aligned state-for-state.
Each cell contains only action/resource names. The tables establish request order
and count, not selector or payload equivalence. Raw traces remain private.
Redacted summaries and the comparison are also saved locally under
`/tmp/rps-2935-matched-runs/`; reviewers can use the embedded tables without
access to those temporary files.

<details>
<summary>Ordered calls: baseline/optimized first-time activation and reconfiguration</summary>

| # | Baseline activation (74) | Optimized activation (70) | Baseline reconfiguration (64) | Optimized reconfiguration (51) |
|---|---|---|---|---|
| 1 | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` |
| 2 | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` |
| 3 | `Setup IPS_HostBasedSetupService` | `Setup IPS_HostBasedSetupService` | `Enumerate AMT_TLSSettingData` | `Enumerate AMT_TLSSettingData` |
| 4 | `CommitChanges AMT_SetupAndConfigurationService` | `CommitChanges AMT_SetupAndConfigurationService` | `Pull AMT_TLSSettingData` | `Pull AMT_TLSSettingData` |
| 5 | `Enumerate AMT_PublicKeyCertificate` | `Enumerate AMT_PublicKeyCertificate` | `Enumerate AMT_TLSCredentialContext` | `Enumerate AMT_TLSCredentialContext` |
| 6 | `Pull AMT_PublicKeyCertificate` | `Pull AMT_PublicKeyCertificate` | `Pull AMT_TLSCredentialContext` | `Pull AMT_TLSCredentialContext` |
| 7 | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | `Enumerate AMT_TLSCredentialContext` | `Enumerate AMT_PublicKeyCertificate` |
| 8 | `GenerateKeyPair AMT_PublicKeyManagementService` | `GenerateKeyPair AMT_PublicKeyManagementService` | `Pull AMT_TLSCredentialContext` | `Pull AMT_PublicKeyCertificate` |
| 9 | `Enumerate AMT_PublicPrivateKeyPair` | `Enumerate AMT_PublicPrivateKeyPair` | `Enumerate AMT_PublicKeyCertificate` | `SetAdminAclEntryEx AMT_AuthorizationService` |
| 10 | `Pull AMT_PublicPrivateKeyPair` | `Pull AMT_PublicPrivateKeyPair` | `Pull AMT_PublicKeyCertificate` | `SetMEBxPassword AMT_SetupAndConfigurationService` |
| 11 | `AddCertificate AMT_PublicKeyManagementService` | `AddCertificate AMT_PublicKeyManagementService` | `SetAdminAclEntryEx AMT_AuthorizationService` | `Enumerate AMT_EthernetPortSettings` |
| 12 | `Enumerate AMT_TLSCredentialContext` | `Enumerate AMT_TLSCredentialContext` | `SetMEBxPassword AMT_SetupAndConfigurationService` | `Pull AMT_EthernetPortSettings` |
| 13 | `Pull AMT_TLSCredentialContext` | `Pull AMT_TLSCredentialContext` | `Enumerate AMT_EthernetPortSettings` | `Get IPS_IEEE8021xSettings` |
| 14 | `Put AMT_TLSCredentialContext` | `Put AMT_TLSCredentialContext` | `Pull AMT_EthernetPortSettings` | `Enumerate CIM_WiFiEndpointSettings` |
| 15 | `GetLowAccuracyTimeSynch AMT_TimeSynchronizationService` | `GetLowAccuracyTimeSynch AMT_TimeSynchronizationService` | `Get IPS_IEEE8021xSettings` | `Pull CIM_WiFiEndpointSettings` |
| 16 | `SetHighAccuracyTimeSynch AMT_TimeSynchronizationService` | `SetHighAccuracyTimeSynch AMT_TimeSynchronizationService` | `Enumerate CIM_WiFiEndpointSettings` | `Enumerate IPS_HTTPProxyAccessPoint` |
| 17 | `Enumerate AMT_TLSSettingData` | `Enumerate AMT_TLSSettingData` | `Pull CIM_WiFiEndpointSettings` | `Pull IPS_HTTPProxyAccessPoint` |
| 18 | `Pull AMT_TLSSettingData` | `Pull AMT_TLSSettingData` | `Enumerate IPS_HTTPProxyAccessPoint` | `Delete AMT_RemoteAccessPolicyRule` |
| 19 | `Put AMT_TLSSettingData` | `Put AMT_TLSSettingData` | `Pull IPS_HTTPProxyAccessPoint` | `Delete AMT_RemoteAccessPolicyRule` |
| 20 | `Put AMT_TLSSettingData` | `Put AMT_TLSSettingData` | `Delete AMT_RemoteAccessPolicyRule` | `Delete AMT_RemoteAccessPolicyRule` |
| 21 | `CommitChanges AMT_SetupAndConfigurationService` | `CommitChanges AMT_SetupAndConfigurationService` | `Delete AMT_RemoteAccessPolicyRule` | `Enumerate AMT_ManagementPresenceRemoteSAP` |
| 22 | `Get AMT_GeneralSettings` | `Get AMT_GeneralSettings` | `Delete AMT_RemoteAccessPolicyRule` | `Pull AMT_ManagementPresenceRemoteSAP` |
| 23 | `Enumerate AMT_TLSSettingData` | `Enumerate AMT_TLSSettingData` | `Enumerate AMT_ManagementPresenceRemoteSAP` | `Delete AMT_ManagementPresenceRemoteSAP` |
| 24 | `Pull AMT_TLSSettingData` | `Pull AMT_TLSSettingData` | `Pull AMT_ManagementPresenceRemoteSAP` | `Get AMT_EnvironmentDetectionSettingData` |
| 25 | `Enumerate AMT_TLSCredentialContext` | `Enumerate AMT_TLSCredentialContext` | `Delete AMT_ManagementPresenceRemoteSAP` | `Put AMT_EnvironmentDetectionSettingData` |
| 26 | `Pull AMT_TLSCredentialContext` | `Pull AMT_TLSCredentialContext` | `Enumerate AMT_TLSSettingData` | `Enumerate AMT_EthernetPortSettings` |
| 27 | `Enumerate AMT_TLSCredentialContext` | `Enumerate AMT_PublicKeyCertificate` | `Pull AMT_TLSSettingData` | `Pull AMT_EthernetPortSettings` |
| 28 | `Pull AMT_TLSCredentialContext` | `Pull AMT_PublicKeyCertificate` | `Get AMT_EnvironmentDetectionSettingData` | `Get AMT_RedirectionService` |
| 29 | `Enumerate AMT_PublicKeyCertificate` | `Get IPS_HostBasedSetupService` | `Put AMT_EnvironmentDetectionSettingData` | `Get IPS_OptInService` |
| 30 | `Pull AMT_PublicKeyCertificate` | `AddNextCertInChain IPS_HostBasedSetupService` | `Enumerate AMT_EthernetPortSettings` | `Get CIM_KVMRedirectionSAP` |
| 31 | `Get IPS_HostBasedSetupService` | `AddNextCertInChain IPS_HostBasedSetupService` | `Pull AMT_EthernetPortSettings` | `Enumerate AMT_TLSSettingData` |
| 32 | `AddNextCertInChain IPS_HostBasedSetupService` | `AddNextCertInChain IPS_HostBasedSetupService` | `Get AMT_RedirectionService` | `Pull AMT_TLSSettingData` |
| 33 | `AddNextCertInChain IPS_HostBasedSetupService` | `UpgradeClientToAdmin IPS_HostBasedSetupService` | `Get IPS_OptInService` | `Enumerate AMT_TLSCredentialContext` |
| 34 | `AddNextCertInChain IPS_HostBasedSetupService` | `CommitChanges AMT_SetupAndConfigurationService` | `Get CIM_KVMRedirectionSAP` | `Pull AMT_TLSCredentialContext` |
| 35 | `UpgradeClientToAdmin IPS_HostBasedSetupService` | `SetMEBxPassword AMT_SetupAndConfigurationService` | `Enumerate AMT_PublicKeyCertificate` | `Enumerate AMT_PublicKeyCertificate` |
| 36 | `CommitChanges AMT_SetupAndConfigurationService` | `Enumerate AMT_EthernetPortSettings` | `Pull AMT_PublicKeyCertificate` | `Pull AMT_PublicKeyCertificate` |
| 37 | `SetMEBxPassword AMT_SetupAndConfigurationService` | `Pull AMT_EthernetPortSettings` | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | `GetLowAccuracyTimeSynch AMT_TimeSynchronizationService` |
| 38 | `Enumerate AMT_EthernetPortSettings` | `Get IPS_IEEE8021xSettings` | `GenerateKeyPair AMT_PublicKeyManagementService` | `SetHighAccuracyTimeSynch AMT_TimeSynchronizationService` |
| 39 | `Pull AMT_EthernetPortSettings` | `Enumerate CIM_WiFiEndpointSettings` | `Enumerate AMT_PublicPrivateKeyPair` | `AddTrustedRootCertificate AMT_PublicKeyManagementService` |
| 40 | `Get IPS_IEEE8021xSettings` | `Pull CIM_WiFiEndpointSettings` | `Pull AMT_PublicPrivateKeyPair` | `AddMpServer AMT_RemoteAccessService` |
| 41 | `Enumerate CIM_WiFiEndpointSettings` | `Enumerate IPS_HTTPProxyAccessPoint` | `AddCertificate AMT_PublicKeyManagementService` | `Enumerate AMT_ManagementPresenceRemoteSAP` |
| 42 | `Pull CIM_WiFiEndpointSettings` | `Pull IPS_HTTPProxyAccessPoint` | `Enumerate AMT_TLSCredentialContext` | `Pull AMT_ManagementPresenceRemoteSAP` |
| 43 | `Enumerate IPS_HTTPProxyAccessPoint` | `Delete AMT_RemoteAccessPolicyRule` | `Pull AMT_TLSCredentialContext` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` |
| 44 | `Pull IPS_HTTPProxyAccessPoint` | `Delete AMT_RemoteAccessPolicyRule` | `Put AMT_TLSCredentialContext` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` |
| 45 | `Delete AMT_RemoteAccessPolicyRule` | `Delete AMT_RemoteAccessPolicyRule` | `GetLowAccuracyTimeSynch AMT_TimeSynchronizationService` | `Enumerate AMT_RemoteAccessPolicyAppliesToMPS` |
| 46 | `Delete AMT_RemoteAccessPolicyRule` | `Enumerate AMT_ManagementPresenceRemoteSAP` | `SetHighAccuracyTimeSynch AMT_TimeSynchronizationService` | `Pull AMT_RemoteAccessPolicyAppliesToMPS` |
| 47 | `Delete AMT_RemoteAccessPolicyRule` | `Pull AMT_ManagementPresenceRemoteSAP` | `Enumerate AMT_TLSSettingData` | `Put AMT_RemoteAccessPolicyAppliesToMPS` |
| 48 | `Enumerate AMT_ManagementPresenceRemoteSAP` | `Get AMT_EnvironmentDetectionSettingData` | `Pull AMT_TLSSettingData` | `Put AMT_RemoteAccessPolicyAppliesToMPS` |
| 49 | `Pull AMT_ManagementPresenceRemoteSAP` | `Enumerate AMT_EthernetPortSettings` | `Put AMT_TLSSettingData` | `RequestStateChange AMT_UserInitiatedConnectionService` |
| 50 | `Enumerate AMT_TLSSettingData` | `Pull AMT_EthernetPortSettings` | `Put AMT_TLSSettingData` | `Get AMT_EnvironmentDetectionSettingData` |
| 51 | `Pull AMT_TLSSettingData` | `Get AMT_RedirectionService` | `CommitChanges AMT_SetupAndConfigurationService` | `Put AMT_EnvironmentDetectionSettingData` |
| 52 | `Get AMT_EnvironmentDetectionSettingData` | `Get IPS_OptInService` | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | — |
| 53 | `Enumerate AMT_EthernetPortSettings` | `Get CIM_KVMRedirectionSAP` | `AddMpServer AMT_RemoteAccessService` | — |
| 54 | `Pull AMT_EthernetPortSettings` | `RequestStateChange AMT_RedirectionService` | `Enumerate AMT_ManagementPresenceRemoteSAP` | — |
| 55 | `Get AMT_RedirectionService` | `RequestStateChange CIM_KVMRedirectionSAP` | `Pull AMT_ManagementPresenceRemoteSAP` | — |
| 56 | `Get IPS_OptInService` | `Put AMT_RedirectionService` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | — |
| 57 | `Get CIM_KVMRedirectionSAP` | `Put IPS_OptInService` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | — |
| 58 | `RequestStateChange AMT_RedirectionService` | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | `Enumerate AMT_RemoteAccessPolicyAppliesToMPS` | — |
| 59 | `RequestStateChange CIM_KVMRedirectionSAP` | `AddMpServer AMT_RemoteAccessService` | `Pull AMT_RemoteAccessPolicyAppliesToMPS` | — |
| 60 | `Put AMT_RedirectionService` | `Enumerate AMT_ManagementPresenceRemoteSAP` | `Put AMT_RemoteAccessPolicyAppliesToMPS` | — |
| 61 | `Put IPS_OptInService` | `Pull AMT_ManagementPresenceRemoteSAP` | `Put AMT_RemoteAccessPolicyAppliesToMPS` | — |
| 62 | `AddTrustedRootCertificate AMT_PublicKeyManagementService` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | `RequestStateChange AMT_UserInitiatedConnectionService` | — |
| 63 | `AddMpServer AMT_RemoteAccessService` | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | `Get AMT_EnvironmentDetectionSettingData` | — |
| 64 | `Enumerate AMT_ManagementPresenceRemoteSAP` | `Enumerate AMT_RemoteAccessPolicyAppliesToMPS` | `Put AMT_EnvironmentDetectionSettingData` | — |
| 65 | `Pull AMT_ManagementPresenceRemoteSAP` | `Pull AMT_RemoteAccessPolicyAppliesToMPS` | — | — |
| 66 | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | `Put AMT_RemoteAccessPolicyAppliesToMPS` | — | — |
| 67 | `AddRemoteAccessPolicyRule AMT_RemoteAccessService` | `Put AMT_RemoteAccessPolicyAppliesToMPS` | — | — |
| 68 | `Enumerate AMT_RemoteAccessPolicyAppliesToMPS` | `RequestStateChange AMT_UserInitiatedConnectionService` | — | — |
| 69 | `Pull AMT_RemoteAccessPolicyAppliesToMPS` | `Get AMT_EnvironmentDetectionSettingData` | — | — |
| 70 | `Put AMT_RemoteAccessPolicyAppliesToMPS` | `Put AMT_EnvironmentDetectionSettingData` | — | — |
| 71 | `Put AMT_RemoteAccessPolicyAppliesToMPS` | — | — | — |
| 72 | `RequestStateChange AMT_UserInitiatedConnectionService` | — | — | — |
| 73 | `Get AMT_EnvironmentDetectionSettingData` | — | — | — |
| 74 | `Put AMT_EnvironmentDetectionSettingData` | — | — | — |

</details>

## Validation and next steps

The corrected implementation passed **1,128 tests across 98 files**, lint, formatting,
and whitespace checks on November 3. Earlier implementation checks also passed
TypeScript and compilation. Regressions cover cache invalidation, incomplete
reads, certificate/policy/hostname/expiry mismatches, upgrade and fresh-activation
exclusions, verification fallback, tunnel trust, wait retention, CIRA routing,
TLS results, and retained cleanup failures. Review-fix regressions also check a
drifted AMT clock, successful completion with/without CIRA, read/write firmware
errors and rejected invocations, malformed time data, changed sessions, and
retention of both the local five-second timer and the 15-second default.

| Remaining validation | Purpose |
|---|---|
| Repeated matched activation and reconfiguration | Establish typical performance and capture equivalent full initial-state/profile snapshots |
| Alternate profiles and devices | Cover wired 802.1X, Wi-Fi, proxy, no-CIRA and alternate interfaces, legacy tunnel/non-TLS, and control-mode upgrades |
| Changed or missing TLS identity/settings | Confirm enrollment and verification fallback on hardware |
| Faults and partial provisioning | Check digest recovery, resets/timeouts, reconnects, dependency failures, and interrupted attempts |
| CIRA connectivity through MPS | Verify a working connection beyond reported component success |

For comparisons, hold device/firmware, initial state, profile contents, RPC
build/flags, dependencies, network, and timers constant. Capture one isolated
private `RPS_LOG_LEVEL=silly` trace per run, including selectors/payloads,
timestamps/statuses, retries, reconnects, waits, and component results. First-time
runs require equivalent fresh states; another invocation on an activated device
measures reconfiguration. Issue acceptance remains incomplete until the relevant
hardware paths and recovery behavior are validated.

User-facing documentation assessment: these changes add no API, profile field,
or required user action, so no usage-guide change is needed. When ready to ship,
a release note should describe eligible TLS identity reuse and preserved clock
synchronization. Single-run results should not be presented as a guaranteed
percentage gain. Keep the generated release changelog unchanged here.

## Future ideas — not implemented

| Proposed change | Potential saving | Work required |
|---|---|---|
| **Choose non-TLS reconfiguration earlier** | Two or four probe reads on selected legacy/local routes | Keep the earlier LMS transport-selection probe; validate explicit tunnel flags, digest recovery, upgrades, and later TLS requirements on legacy hardware |
| **Update only changed features** | Potentially one unchanged KVM setter | Prove firmware `RequestStateChange` semantics, listener coupling, opt-in, and selective enable/disable behavior; unchanged measured reconfiguration already emitted no setters |
| **Skip initial enrollment certificate reads** | Two reads during actual TLS enrollment | Preserve initial Enumerate's HTTP 401 recovery and Pull's bounded parse retries; root-add currently sends rejected calls to failure |
| **Reuse a verified CIRA trusted root** | One root-add request on eligible reconfiguration | Hand off complete fresh inventory with attempt/session/age information; compare the exact newly loaded CIRA root and its trusted flag; retain evidence across only operations proven not to invalidate it |

Skipping the initial enrollment certificate reads loses the current
authentication recovery behavior when routing directly to certificate-mode selection. Write retries cannot simply copy read retries: an ambiguous
failure after a certificate-store write may require discovery before replay.
Enterprise Assistant, partial enrollment, reconnect, and rollover need coverage.
The observed six-second initial-read interval includes recovery/tunnel overhead
and is not a removable-time estimate.

Reusing the CIRA trusted root requires an explicit evidence handoff: final TLS
verification currently returns a boolean and does not pass its complete inventory to CIRA. Use evidence captured after cleanup; compare
normalized DER bytes or SHA-256 fingerprints against the root from CIRA's newly
loaded configuration and require `TrustedRootCertficate` to indicate trust.
Missing, malformed, incomplete, expired, changed-session, reset, or mismatched
evidence must retain installation. Both routes must continue secret persistence,
MPS registration, and policy configuration. Test matching encodings, root rotation,
untrusted matches, new attempts, lookup delays, resets, and retries. First-time
activation remains outside this proposed shortcut until persistence through
its mutations is proven. Extra discovery reads solely to skip one write would
erase the request benefit.

Validate the combined implementation first, then investigate trusted-root reuse
and enrollment-read removal separately. Earlier non-TLS routing and selective
feature updates require qualifying devices/profiles. These potential savings
are predictions, not additional measured gains.

## Reference: flow and baseline inventory

Activation and reconfiguration enter the activation machine through `ACTIVATION`
and `ACTIVATED`; reconfiguration is separate from maintenance operations.
AMT 19+ TLS activation uses port 16993. Supported legacy tunnel activation starts
on 16992 and switches to 16993; legacy non-tunnel behavior remains governed by
profile/device guards. Applicable ACM setup requires provisioning-chain/hash and
nonce validation, and setup/upgrade recovery checks actual activation state.

Configuration order remains cleanup → network (wired/802.1X, Wi-Fi, then proxy
when applicable) → features → applicable TLS enrollment or verified reuse →
CIRA → completion. Individual branches may skip stages. The CIRA proxy stage
precedes CIRA connection setup.

Repeated labels do not prove duplicated work. Ethernet inventory spans mutations;
cleanup policy deletes and CIRA association writes use distinct selectors;
cleanup and final environment settings serve different purposes. Required
enrollment bindings, certificate discovery, authentication recovery, post-commit
verification, and CIRA rebuild remain on their applicable routes. A tolerated
HTTP 400 does not justify removing a delete or its reconnect handling.

The appendix preserves the September baseline tables and the branch differences.
It is a static reference, not a current execution trace or proof of reachability.
Count Enumerate/Pull, selector loops, authentication challenges, and transport
retries separately; child/local/Vault/DB/REST operations are not WS-Man requests.

<details>
<summary>Branch differences and complete September v2.40.2 state/call inventory</summary>

### Branch differences

| State/actor | Current behavior relative to baseline |
|---|---|
| Cleanup `ENUMERATE_TLS_SETTING_DATA` | Immediate TLS-enforcement guard goes to environment detection before invoking Enumerate/Pull |
| Activation `VALIDATE_ACTIVATED_DEVICE_TLS_CERT` | Uses `validateActivatedTlsIdentity`, which performs live validation and conservative reuse policy approval |
| Activation credential-context validation | Consumes a complete current probe snapshot when eligible; otherwise reads again |
| `SIGNAL_ACTIVATED_PORT_SWITCH` | May skip only the approved unchanged-identity wait; fresh tunnel still required |
| `FEATURES_CONFIGURATION` | Eligible already-activated reuse approval first routes to `VERIFY_REUSABLE_TLS_IDENTITY` |
| `VERIFY_REUSABLE_TLS_IDENTITY` | Six nominal live verification reads; success routes to `GET_REUSED_TLS_TIME`, false/error falls back to root fetch and TLS enrollment |
| `GET_REUSED_TLS_TIME` / `SET_REUSED_TLS_TIME` | Read and synchronize AMT time before completion; invalid data, firmware errors, or rejected invocations route to failure |
| `ROUTE_REUSED_TLS` | Records TLS success and routes to CIRA or completion |

### activation

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

### unconfiguration

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

### networkConfiguration

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

### wiredNetworkConfiguration

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

### wifiNetworkConfiguration

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

### proxyConfiguration

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `ACTIVATION` | — | `CHECK_FOR_PROXY_CONFIGS` |
| `CHECK_FOR_PROXY_CONFIGS` | — | `GET_PROXY_CONFIG`, `SUCCESS` |
| `GET_PROXY_CONFIG` | `getProxyConfig` (child/control/local/service operation; inspect actor) | `ADD_PROXY_CONFIGS`, `FAILED` |
| `ADD_PROXY_CONFIGS` | `addProxyConfigs`: `ips.HTTPProxyService.AddProxyAccessPoint` | `CHECK_ADD_PROXY_CONFIGS_RESPONSE` |
| `CHECK_ADD_PROXY_CONFIGS_RESPONSE` | — | `GET_PROXY_CONFIG`, `SUCCESS` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

### featuresConfiguration

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

### ciraConfiguration

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

### tls

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `PROVISIONED` | — | `ENUMERATE_PUBLIC_KEY_CERTIFICATE` |
| `ENUMERATE_PUBLIC_KEY_CERTIFICATE` | `enumeratePublicKeyCertificate`: `amt.PublicKeyCertificate.Enumerate` | `PULL_PUBLIC_KEY_CERTIFICATE`, `ERROR`, `FAILED` |
| `PULL_PUBLIC_KEY_CERTIFICATE` | `pullPublicKeyCertificate`: `amt.PublicKeyCertificate.Pull` | `CHECK_CERT_MODE`, `ENUMERATE_PUBLIC_KEY_CERTIFICATE`, `FAILED` |
| `CHECK_CERT_MODE` | — | `ENTERPRISE_ASSISTANT_REQUEST`, `ADD_TRUSTED_ROOT_CERTIFICATE` |
| `CHECK_CERT_MODE_AFTER_REQUEST` | — | `ENTERPRISE_ASSISTANT_RESPONSE`, `ADD_CERTIFICATE` |
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

### timeMachine

| State | Actor / WS-Man builders | Direct targets |
|---|---|---|
| `THE_PAST` | — | `GET_LOW_ACCURACY_TIME_SYNCH` |
| `GET_LOW_ACCURACY_TIME_SYNCH` | `getLowAccuracyTimeSync`: `amt.TimeSynchronizationService.GetLowAccuracyTimeSynch` | `GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE`, `FAILED` |
| `GET_LOW_ACCURACY_TIME_SYNCH_RESPONSE` | — | `SET_HIGH_ACCURACY_TIME_SYNCH`, `FAILED` |
| `SET_HIGH_ACCURACY_TIME_SYNCH` | `setHighAccuracyTimeSync`: `amt.TimeSynchronizationService.SetHighAccuracyTimeSynch` | `SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE`, `FAILED` |
| `SET_HIGH_ACCURACY_TIME_SYNCH_RESPONSE` | — | `SUCCESS`, `FAILED` |
| `FAILED` | — | — |
| `SUCCESS` | — | — |

</details>
