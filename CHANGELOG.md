# Changelog

## 1.1.0

- `ruleSets` on `Validation`, `ArchiveItem` and `Schema`: the business rule sets a schema runs, as
  `RuleSet` (`key`, `name`, `version`, `pin`, `label`).
- `rulesVersion` option of `validate()` and `submit()` pins rule sets to releases
  (`peppol-bis-3-ubl@3.0.21`); a pin another release has replaced throws `RulesVersionMismatchError`
  (409 `rules_version_mismatch`, with `ruleSet`, `pinned` and `current`).

## 1.0.0

- First release: `Xmlvalid` with `validate()`, `submit()`, `waitFor()`, `validation()`, `cancel()`,
  `report()`, `share()`, `usage()`, `schemas()`; typed results and errors; `verifyWebhook()`.
