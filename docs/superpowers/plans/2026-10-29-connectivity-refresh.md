# Infinity Connectivity Refresh Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Preserve file ownership boundaries and verify each task before release.

**Goal:** Complete initial-connection recovery, improve negotiation diversity and diagnostics, update stable dependencies and publish a verified Windows/Mac release.

**Architecture:** Keep the existing three Trystero strategies and shared FriendsSession. Add safe diagnostics at the RTCPeerConnection constructor boundary, update configuration at the initial join, and recover rooms sequentially only with verified coverage of connected participants.

**Tech Stack:** Electron, React, TypeScript, Vite, Trystero, Playwright, native Windows audio helper.

**Spec:** `docs/superpowers/specs/2026-10-29-connectivity-refresh.md`

## Global Constraints

- No TURN, SFU, paid service or new infrastructure; media remains P2P.
- Preserve room invitations, local identity, existing features and active user processes.
- Stable current dependency versions; no prereleases, forced audit fixes or hidden API incompatibilities.
- Diagnostics contain only fixed labels and aggregate counts; no IP/port/SDP/secret/raw stats.
- Do not promise connection through every network; cross-network incident validation remains separate from local QA.

## Review Focus

- Simultaneous failed routes must not both close the alternatives protecting a healthy participant.
- Closing/switching rooms during recovery must not reopen old rooms or restore resolved warnings.
- Initial failures before onPeerJoin and silent discovery must have bounded recovery and meaningful diagnostics.
- Diagnostics and exported text must not leak room secrets, network addresses or raw exceptions.
- Dependency migrations must preserve Windows capture/cleanup, Mac permissions, existing download routes and updater metadata.

## Tasks

- [x] Dependencies: inventory npm manifests/CI, update direct stable versions and lockfiles, migrate config/API breakages, audit runtime/transitive findings, document supported Node/macOS. Owner: dependency worker; package manifests/locks, Vite/TS config and CI only.
- [x] Session recovery: add failing tests for silent initial attempts, redundant-route coverage, sequential recoveries and per-peer failure bookkeeping; implement the smallest shared-layer fix. Owner: session worker; `src/friends-session.ts`, `tests/friends-session.spec.ts` only.
- [x] Transport and diagnostics: test candidate-bundling configuration and redacted pending-transport diagnostics; implement a scoped rtcPolyfill and safe copy action in FriendsHub. Owner: principal; transport module, FriendsHub, CSS and corresponding tests.
- [x] Integration: typecheck/build, complete browser/Electron suite, simulated trickle-candidate loss with full-ICE fallback, three/four clients and returning members, packaged Windows smoke and cleanup.
- [x] Independent review: fix important findings before commit/release. Recheck changes and secret boundaries.
- [ ] Publish: bump release version, notes, main/tag, Windows and both Mac architectures, inspect CI and verify public metadata/download redirects/manifests. Update project progress with proof and limits.

## Workspace

Native worktree creation rejected Infinity because this chat is attached to Merchant. A Git worktree was created with approved command in the chat's writable visualization directory, branch `codex/connectivity-refresh`, base `21b304e`. Merchant and the original Infinity checkout remain separate.
