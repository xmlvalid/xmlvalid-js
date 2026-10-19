# Changelog

## 1.2.0

- `Diagnostic.path`: where a business rule fired, as an XPath with the document's prefixes
  (`/Invoice/cac:InvoiceLine[2]/cbc:LineExtensionAmount`).
- `sha256` and `engine` on `Result` and `ArchiveItem`: the SHA-256 of the file as sent and what
  checked it, as `Engine` (`xmlvalid`, `libxml2`, `saxonjs`), for an audit trail.

## 1.1.0

- `ruleSets` on `Validation`, `ArchiveItem` and `Schema`: the business rule sets a schema runs, as
  `RuleSet` (`key`, `name`, `version`, `pin`, `label`).
- `rulesVersion` option of `validate()` and `submit()` pins rule sets to releases
  (`peppol-bis-3-ubl@3.0.21`); a pin another release has replaced throws `RulesVersionMismatchError`
  (409 `rules_version_mismatch`, with `ruleSet`, `pinned` and `current`).

## 1.0.0

- First release: `Xmlvalid` with `validate()`, `submit()`, `waitFor()`, `validation()`, `cancel()`,
  `report()`, `share()`, `usage()`, `schemas()`; typed results and errors; `verifyWebhook()`.
