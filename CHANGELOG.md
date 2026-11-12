# Changelog

## 0.4.0

### Added

- `getKeys()` returns the `{ key, animationKey }` pair a caller must cache to
  generate transaction ids later.
- `ClientTransaction.fromKeys(keys)` rebuilds an initialized instance from that
  pair, validating both values.
- `ClientTransactionKeys` is exported from the package entry.

### Fixed

- `key`, `keyBytes`, `animationKey` and `isInitialized` are readable again, so
  callers written against 0.3.2 and earlier keep working. 0.3.3 replaced them
  with a private field and returned `undefined` for all four.
- `generateTransactionId` no longer requires instance state when both keys are
  passed as arguments, which is what its `key`/`animationKey` parameters have
  always documented.

### Changed

- The constructor argument is optional: `new ClientTransaction()` is valid and
  `initialize()` on such an instance throws `ClientTransactionInitializationError`
  instead of reading a document.

## 0.3.3

### Changed

- Migrated from Deno to Bun and reorganised the sources.

**This release broke callers that read `key`/`animationKey` off an instance and
cached them; use `getKeys()`/`fromKeys()` from 0.4.0 instead.**

## 0.3.2

### Fixed

- Resolve the ondemand chunk after X's homepage migration.
