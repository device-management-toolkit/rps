# Additional provisioning opportunities after candidate A

Baseline: September v2.40.2 (`583d61f0`). Tested optimization: candidate A
(`9179ab19`). Evidence comes from the November 3 AMT 21 activation and ACM
reconfiguration runs. Times below describe work observed in those traces;
they are not measured savings for unimplemented changes. RPC command-start
and completion timestamps are unavailable.

## Prioritized findings

| Priority | Candidate | Observed evidence | Potential benefit and conditions |
|---|---|---|---|
| 1 | E: preserve a validated existing TLS identity during unchanged reconfiguration | Both reconfiguration runs report a live/Vault certificate match and set `tlsNeedsProvisioning=false`, but later run TLS key generation, certificate installation, TLS-setting writes, and commit. | The optimized trace spends about 24.2 seconds across 17 WS-Man requests in this deferred TLS stage. Avoiding an unnecessary stage could yield materially more than candidate A, but the stage is not yet proven unnecessary for changed profiles or certificate policy. |
| 2 | C: reuse the successful credential-context probe within the same attempt | `checkAmtTlsState` Enumerate/Pull TLSCredentialContext is immediately followed by a second Enumerate/Pull of that resource in live-certificate validation. No intervening firmware writes appear in the trace. The same duplication occurs in the activation trace after its earlier TLS setup. | Two read requests, approximately two seconds in these runs. Keep public-certificate enumeration, handle association, fingerprint checks, complete results, and per-attempt invalidation on reconnect/mutation/failure. |
| 3 | F: avoid rollover wait when validating unchanged TLS on an already activated device | Immediately after a live/Vault match, the activated port-switch actor reports an existing 16993 path and waits 5 seconds before initializing a fresh tunnel. No intervening commit/certificate/TLS-setting mutation is logged in that interval. | A conditional five-second wait is worth investigating. Preserve fresh tunnel creation and strict trust verification; do not shorten waits after actual provisioning, commit, upgrade, or transport errors. Prove lifecycle state and firmware behavior before skipping any wait. |
| 4 | B: route selected non-TLS reconfiguration before probing TLS | Earlier release characterizations demonstrate two/four discarded TLS reads on selected non-TLS routes. | Separate legacy/non-TLS case; it does not apply to the AMT 21 TLS-enforced runs. |
| 5 | D: selective feature setters | The first-time activation trace writes redirection/KVM/opt-in. Reconfiguration only reads these services and emits no corresponding setters when unchanged. | No feature-setter saving is demonstrated in the tested unchanged reconfiguration. Selective setters need a profile where only SOL/IDER/listener or KVM changes and firmware dependency validation. |

## Why candidate E happens

`VALIDATE_ACTIVATED_DEVICE_TLS_CERT` sets `tlsNeedsProvisioning=false` and marks
TLS already configured after successful validation. The later
`needsPostProvisioningTLS` guard also checks whether the per-connection
`device.tls.issuedCertPEM` is absent and whether the incoming client payload says
TLS is enforced. A validated existing leaf is not recorded as an issued leaf in
that runtime field by `validateDeviceTlsCert`.

Consequently, TLS-enforced reconfiguration can reach
`FETCH_POST_PROVISIONING_ROOT_KEY → TLS` despite successful reuse validation.
The TLS child then runs its certificate/key/configuration sequence. This is an
inference from the source, supported by both captured sequences.

A new segmented executable characterization in
`src/test/provisioningAnalysis.test.ts` reproduces the routing inconsistency:
mocked successful certificate validation follows the real matching-result
transition, sets the flag to false and marks TLS already configured; successful
feature completion then follows the real guard to deferred TLS provisioning.
The scenario stubs external validation/features, so it proves routing behavior,
not certificate cryptography or hardware correctness.

Do not fix this by blindly copying the Vault leaf into `issuedCertPEM` or by
skipping all TLS work whenever the fingerprint matches. That field participates
in TLS trust/transition handling. A reuse decision should explicitly distinguish
validated existing identity from newly issued identity, and verify requested
profile settings, signing authority/root, hostname, validity/renewal policy,
control-mode upgrade, and any later invalidating operation. Changed or missing
TLS settings, mismatches, rotation, failed validation, and interrupted attempts
must still provision correctly. Preserving identity may still require applying
changed TLS settings separately.

## Retained work and limits

- The three cleanup remote-access-policy deletes address different selectors.
  The tested cleanup includes an HTTP 400/reset; neither its tolerated status
  nor an empty-store case proves that deletion or reset handling can be removed.
- Cleanup and CIRA rebuild different configuration stages. Skipping a full CIRA
  rebuild needs a live policy/server/password/root/proxy comparison and proof of
  partial-provisioning behavior. An unchanged profile name alone is insufficient.
- TLS and CIRA trusted-root additions must be compared by certificate identity
  and required usage. The resource/action name alone does not prove redundancy.
- Ethernet reads straddle cleanup/configuration boundaries; caching requires a
  field-level freshness contract.
- Digest 401 challenges and actual transport-reset recovery remain required.
  Keep strict TLS verification when replacing the bootstrap tunnel after live
  certificate discovery. Candidate F concerns the wait, not weakening trust.
- All further candidates need focused tests, independent changes, and matched
  hardware validation. No additional production change has been made here.

## Request-count audit

The first-time activation logs contain three extra XML logs from the activation
actor for `AddNextCertInChain`, in addition to the common transport request logs.
Earlier counts of 77/75 included those actor logs. After excluding them, transport
request-log counts are **74 before and 72 after**. The difference is still exactly
the two cleanup TLS reads. Reconfiguration counts remain **64 before and 62 after**.
These are logged request blocks, not packet captures or unique selector counts.
A separate redacted audit is saved at `/tmp/rps-2935-request-count-audit.json`.

For implementation order, first evaluate E's profile/security conditions, then
implement the narrower C independently. Evaluate F with lifecycle-specific
firmware evidence. Avoid adding the time estimates together: caching and stage
reuse change the later sequence, and measured savings require matched runs.

## Verification

After adding the routing characterization: **1,082 tests across 98 files**,
lint, formatting, TypeScript `--noEmit`, and `git diff --check` passed. Production
source and the running optimized container remain at candidate A behavior.
