# Changelog

## 1.0.0 — 2026-09-13

- Reimplemented the legacy AMXXPawn feature set with strict TypeScript and bundled native VS Code providers.
- Added document/selection formatting with lossless Pawn token validation and preservation of directives, strings and excluded regions.
- Added on-demand include resolution, bounded caching, cyclic include handling, unsaved include support and resource-scoped settings.
- Added compilation with direct process arguments, Workspace Trust, cancellation, timeout, diagnostics and preservation of the previous successful build.
- Added unit, grammar, Extension Host, real compiler, corpus and performance checks.
- Namespaced all extension settings and commands under `revo_pawn.`.
