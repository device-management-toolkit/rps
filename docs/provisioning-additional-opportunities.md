# Additional provisioning opportunities after candidate A

Baseline: September v2.40.2 (`583d61f0`). Tested optimization: candidate A
(`9179ab19`). Evidence comes from the November 3 AMT 21 activation and ACM
reconfiguration runs. Times below describe work observed in those traces;
they are not measured savings for unimplemented changes. RPC command-start
and completion timestamps are unavailable.

**Implementation status:** C, E, and F are now implemented for controlled testing
on this branch; the final section describes their conservative scope. The
observed times in the table remain measurements of the previous build, not
measurements of the combined implementation.

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


## Combined C/E/F implementation

The combined change retains candidate A and adds:

- A complete TLS probe snapshot tied to a TLS session, valid for less than
  30 seconds. Credential-context validation consumes it only within that session.
  Incomplete enumerations, resets, reconnections, expiration, and new attempts
  invalidate it. Public-certificate discovery and fingerprint validation remain.
- A distinct reuse approval for existing same-mode activation, rather than
  copying an existing leaf into the newly-issued-certificate runtime field.
  Approval requires both local and remote TLS enabled, requested remote TLS
  settings matching, DMT-generated hostname matching, a live/Vault fingerprint
  match, signature verification against the freshly fetched requested MPS CA,
  CA/leaf validity beyond a 30-day renewal window, and server-auth EKU. Custom
  profile certificates, Microsoft CA, mutual TLS, Wi-Fi, and wired 802.1X profiles
  conservatively retain the release provisioning path. Upgrades and first-time
  activation do not receive identity reuse approval.
- Removal of the rollover wait only when the policy-approved existing identity
  is still in the validated session, with no reset/reconfiguration pending.
  The old tunnel still closes and a fresh tunnel is initialized using the
  existing strict trust handling. The one-use wait decision is cleared when the
  activated port-switch state exits. Actual mutation/upgrade/rollover waits remain.
- A final live revalidation after cleanup/network/features, immediately before
  skipping deferred TLS provisioning. It reads settings, credentials, and public
  certificates (six nominal calls) and checks the identity against the original
  approved fingerprint and current policy. Failure, changed identity/settings,
  stale/incomplete snapshots, or dependency errors retain TLS provisioning.
  CIRA routing remains intact with and without a CIRA profile.

This final revalidation is intentional: cleanup/network work can reconnect or
mutate state. It replaces the observed 17-request TLS stage with six verification
reads on the eligible reconfiguration path. Together with C, the expected nominal
count on the tested unchanged profile is 49 requests, compared with 62 in the
candidate-A build and 64 in September. This is a prediction, not a hardware count.
Fresh activation may benefit from C but retains initial TLS provisioning and waits.

Added sibling activation regressions exercise real SDK reads and cryptographic
validation using generated synthetic CA/leaf certificates. They cover cache
invalidation, partial enumeration, certificate mismatch/expiry/renewal, hostname,
TLS settings, signing authority/root changes, unsupported profiles, upgrade/fresh
activation, final verification/fallback, the full probe-to-tunnel decision path,
wait retention, and CIRA routing. The existing analysis-only characterization
continues to reproduce deferred TLS when no policy-approved reuse exists.

The runtime build is intended for the user's controlled before/after hardware
comparison. No hardware duration gain for C/E/F has yet been measured, and these
conditions do not claim full coverage of every firmware/profile combination.

Retained certificate trust uses a separate `validatedCertPEM` runtime field.
Both initial reconnect and common transport reconnect treat it as managed
identity, so the post-CCM temporary self-signed fallback is disabled after
reuse approval. Newly issued certificates retain their original separate field
and take precedence. Common and activation regressions verify this behavior.

Combined implementation checks: **1,118 tests across 98 files**, lint,
formatting, TypeScript `--noEmit`, compilation, and `git diff --check` passed.
Hardware validation for the combined change remains pending.


## First combined hardware reconfiguration run

The AMT 21 TLS-enforced ACM reconfiguration with `418f752a` took **68.770 seconds**
from the RPS activation request to final status, versus **95.534 seconds** on
September and **93.238 seconds** with candidate A alone. The observed reduction
from September is **26.764 seconds (28.02%)**, in a single matched-intent run.
Initial device/profile equivalence was not independently established; repeat
runs are needed to establish typical performance.

Transport request-log counts fell from **64 to 49**. The trace confirms the
same-session credential cache, skipped unchanged-identity wait, final live
revalidation, and no key generation/certificate installation/TLS commit.
Activation, wired network, and CIRA report success. CIRA connectivity through MPS
is not independently checked. The final certificate recheck succeeds, but this
build omitted the structured TLS result because the TLS child was skipped.
That reporting regression is corrected by recording TLS success in the reused
TLS route, with sibling routing/result regressions. The correction does not
change firmware operations. The tested image remains `418f752a` until rebuilt.

A redacted comparison is saved at
`/tmp/rps-2935-reconfiguration-all-comparison.json`. RPC command-start timing and
hardware testing of combined first-time activation/failure profiles remain
pending. Bootstrap verification warnings, digest 401, and a tolerated cleanup
HTTP 400/reset are still present; skipping required recovery is not part of the
measured optimization.
