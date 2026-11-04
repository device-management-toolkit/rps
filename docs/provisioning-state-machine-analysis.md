# RPS provisioning optimizations

This change addresses unnecessary provisioning work identified in
[issue #2935](https://github.com/device-management-toolkit/rps/issues/2935).
The comparison baseline is the September release, **v2.40.2 (`583d61f`)**.
The implementation is available in [draft PR #3005](https://github.com/device-management-toolkit/rps/pull/3005).

The goal is to reduce repeated device reads during activation and avoid replacing
an existing TLS certificate during reconfiguration when it still meets the
requested configuration.

## What changed

| Change | Result |
|---|---|
| Skip unused TLS cleanup reads | Avoid two device requests when cleanup does not need the TLS settings. |
| Reuse a fresh credential inventory | Avoid reading the same TLS credential information twice within one attempt and connection session. |
| Reuse a verified TLS certificate | Avoid generating a new key, installing a replacement certificate, and committing TLS settings during eligible reconfiguration. |
| Skip the wait for an unchanged certificate | Continue through a fresh TLS tunnel without the configured rollover delay when certificate reuse is approved. |
| Preserve clock synchronization | Read and synchronize the AMT clock before completing TLS reuse; report failure if synchronization fails. |
| Report TLS reuse success | Include TLS `Success` with `Already configured` in the provisioning result. |

## When certificate reuse applies

Reuse applies to an already activated device that stays in the same control mode.
RPS checks that TLS settings match the requested profile, the live certificate
matches the certificate stored in Vault, and its hostname, server purpose, and
signature match the expected DMT certificate and requested MPS certificate
authority. The certificate and its authority must remain valid beyond the
30-day renewal window.

RPS checks the live TLS settings and certificate again after cleanup, network,
and feature configuration. If the evidence is missing, stale, or changed, or
verification fails, RPS follows the normal certificate provisioning path.
Credential inventory reuse requires complete evidence less than 30 seconds old
from the same attempt and connection session; reconnects and resets invalidate it.

First-time activation, CCM-to-ACM upgrades, custom certificates, Microsoft CA,
mutual TLS, Wi-Fi, and wired 802.1X profiles retain certificate enrollment.

## What happens to the 15-second delay?

The default timer remains **15 seconds**. Eligible reconfiguration skips this
wait because the verified certificate is unchanged, and RPS establishes a fresh
TLS tunnel. First-time activation, certificate replacement, upgrades, and recovery
retain their required waits. Replacing those waits with a readiness check is
outside this change.

## Hardware results

Both builds were tested on the same AMT **21.0.2** device and profile, with
end-to-end TLS and the timer configured to **15 seconds**. The optimized
reconfiguration path skipped that wait. The tested optimized build was `f2ead6d`,
including the clock-synchronization fix.

| Flow | Baseline time | Optimized time | Time saved | Device requests |
|---|---|---|---|---|
| First-time activation | 194.141 s | 190.035 s | 4.106 s (2.12%) | 74 → 70 |
| ACM reconfiguration | 105.470 s | 70.508 s | 34.961 s (33.15%) | 64 → 51 |

All four runs reported successful activation status, TLS, wired network, and
CIRA configuration. First-time activation retained certificate installation and
clock synchronization. Optimized reconfiguration reused the certificate and
retained both clock-synchronization requests.

Times cover RPS receipt of the activation request through its final provisioning
status. Each result is one run, so the savings do not establish typical performance.
Full initial-state and profile snapshots were not independently captured, and
CIRA connectivity through MPS was not separately verified.

## Review status and remaining work

The implementation passed **1,128 tests across 98 files**, lint, formatting,
compilation, and TypeScript checks. Regression coverage includes stale evidence,
certificate mismatches, fallback to enrollment, tunnel trust, clock failures,
and wait handling.

Before completing issue acceptance, repeat the hardware comparisons and cover
alternate profiles and transports, changed or missing certificates, interrupted
provisioning, recovery failures, and independent CIRA connectivity through MPS.

Further ideas include reusing a verified CIRA trusted root, reducing initial
certificate reads, choosing legacy non-TLS routing earlier, and updating only
changed features. These are not implemented or included in the measured savings.

## Where to review the implementation

| File | Main responsibility |
|---|---|
| [activation.ts](../src/stateMachines/activation.ts) | Credential reuse, final verification, wait handling, clock synchronization, and TLS result. |
| [tlsReuse.ts](../src/stateMachines/tlsReuse.ts) | Certificate eligibility and trust selection. |
| [unconfiguration.ts](../src/stateMachines/unconfiguration.ts) | Skip unused cleanup reads. |
| [common.ts](../src/stateMachines/common.ts) | Use verified trust material when reconnecting. |
| [RCS.Config.ts](../src/models/RCS.Config.ts) | Track retained TLS identity within the provisioning attempt. |

Corresponding tests cover the changed paths. This change adds no API, profile
field, or required user action.
