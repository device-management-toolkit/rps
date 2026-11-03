# Issue #2935 reassessment after measured TLS optimizations

Issue reread on November 3, 2026:
[Optimize the RPS Provisioning State Machine](https://github.com/device-management-toolkit/rps/issues/2935).
The issue remains open and has no comments. The September source baseline is
v2.40.2 (`583d61f0`); latest local implementation is `b75d37f6`; combined hardware
reconfiguration used `418f752a` before its TLS-result reporting correction.

The issue explicitly prioritizes first-time activation, independent reconfiguration
analysis, complete state/call evidence, and retained security/failure behavior.
Our measured improvement covers one TLS-enforced AMT 21 ACM reconfiguration
profile. It is not complete evidence for all acceptance criteria.

## Further candidates

| Candidate | Evidence | Applicable flow | Decision |
|---|---|---|---|
| H: skip CIRA root installation when the identical certificate is freshly verified as trusted in AMT | September activation and reconfiguration each issue two AddTrustedRootCertificate requests with identical SHA-256 fingerprints after DER normalization. The combined reconfiguration still issues one CIRA root addition, even though the immediately preceding certificate inventory contains that exact certificate with TrustedRootCertficate=true. | Existing TLS reconfiguration with a fresh complete root inventory; potentially first-time activation when persistence/freshness through cleanup and upgrade can be proven. | Strong next candidate for one request removal. Require certificate identity, trusted-root flag, completeness, and no intervening invalidating operation. Different/missing/rotated roots must still install. Profile name or a previous installation alone is insufficient. |
| G: avoid discarded initial public-certificate inventory in TLS enrollment | `tls.ts` starts CONFIGURE_TLS with Enumerate/Pull PublicKeyCertificate. `CHECK_CERT_MODE` uses only signing authority. The self-signed path then overwrites the message through root addition and key generation. Enterprise Assistant initialization also overwrites the message rather than using the certificate inventory. | First-time activation and any reconfiguration that actually provisions TLS. | Two candidate reads. Not yet approved for removal: initial enumeration has explicit HTTP 401 recovery through ERROR, while the root-add actor currently fails on 401. Preserve digest recovery, post-commit TLS rollover, retries, and partial-provisioning behavior before skipping these states. |
| B: route selected non-TLS reconfiguration before TLS probing | Existing segmented September scenarios demonstrate the non-TLS route ignores the TLS probe's result. | Legacy/local non-TLS reconfiguration, not the AMT 21 TLS-enforced runs. | Two/four reads remain a scoped candidate. Needs legacy hardware/transport validation. |
| D: selective feature setters | Combined change flag can trigger KVM setter when only SOL/IDER/listener changes. Tested unchanged reconfiguration emits no feature setters. | A profile changing only a subset of feature settings. | Conditional; requires firmware semantics and selective-change scenarios. No demonstrated saving in the tested unchanged reconfiguration. |

G concerns the enrollment machine's initial reads, not the separate live
certificate/credential validation used for trust and reuse decisions. Those
security reads remain required. The first enrollment pair in the September
activation trace spans about six seconds, but includes tunnel/recovery overhead;
do not claim all of that interval as removable request time.

For H, the combined trace contains a freshly verified trusted-root inventory at
line 497 and the matching CIRA installation request at line 520, with no
intervening WS-Man mutation. The proof is based on certificate bytes and trusted
status, not action/resource repetition. Root installation could still be needed
for another profile or an invalidated attempt. Carrying the verified information
into the CIRA child should use an explicit attempt/freshness contract and be
covered by matching, missing, changed, incomplete, reset, and retry scenarios.

## Acceptance coverage

| Issue requirement | Current evidence | Remaining work |
|---|---|---|
| Map both flows and relevant stages/ports | September state/call inventory and branching analysis; implementation rationale for added verification states | Update optimized inventory where needed and validate additional profile/device paths. |
| Inventory calls and justify removals | Static inventory, isolated silly logs, redacted sequences/counts, tests and certificate-byte comparisons | Preserve fresh evidence and selector/payload distinctions for new candidates. |
| Optimize first-time activation and reconfiguration | Candidate A hardware-tested in both; combined C/E/F hardware-tested in reconfiguration | Run combined first-time activation against equivalent initial state. C may additionally benefit that path; certificate creation and waits remain. |
| Comparable before/after durations including E2E TLS | AMT 21 baseline activation ~153.9s, candidate A ~152.1s; baseline reconfiguration ~95.5s, combined ~68.8s; request counts 74→72 and 64→49 | Repeat matched runs to establish typical results. RPC command-start timing remains unavailable; reported durations use RPS receipt/final status. |
| Complete applicable wired/802.1X/wireless/CIRA/proxy stages and alternate scenarios | Activation, wired network, CIRA status success on tested profile; live TLS revalidation succeeds | Relevant 802.1X/Wi-Fi/proxy profiles, legacy tunnel/non-TLS, upgrades, missing/mismatched certificates; verify CIRA connectivity through MPS. |
| Preserve failures, retries, reconnects, partial provisioning | Regression tests; successful runs include digest challenges and tolerated cleanup reset | Hardware fault/partial-provisioning scenarios for changed paths and reporting-fix retest. |
| Automated regression coverage | 1,118 tests, lint, formatting, TypeScript and compilation pass | Focused new tests if H/G/B/D are implemented. |
| Review evidence | Developer analysis reports, private raw logs, redacted comparison artifacts | Assemble concise review evidence; no analysis branch push or PR yet. |
| Assess user-facing documentation/release notes | Existing docs identify analysis artifacts as developer-facing | A short release-note description of measured eligible reconfiguration behavior may be useful when ready to ship. |

## Recommended order

1. Test the current combined change in first-time activation, including the
   reporting correction, before adding another performance change.
2. Implement H narrowly for the already freshly verified trusted-root case.
   Extend it to activation only after proving persistence across its mutations.
3. Investigate G's digest/error dependencies and then test a separately scoped
   enrollment optimization for first-time activation.
4. Validate relevant alternate profiles and recovery paths. Explore B/D only
   with their qualifying devices/profiles; no need to optimize every listed stage
   to satisfy the issue if absence of safe savings is explained.

Do not remove the CIRA rebuild, selector-specific policy deletes, repeated
Ethernet inventory, enrollment bindings, or post-commit verification wholesale.
Their repeated labels do not prove duplicate work across mutation boundaries.
No additional production change was made in this reassessment.
