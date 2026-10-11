# Dependency maintenance

Use the managed `update-dependencies` skill and the repository's
[setup, validation, and shipping guidance](../AGENTS.md).

## Compatibility and release boundaries

Inventory packages, the Ruby bundle, every `.mise.toml` tool, Android's version
catalog and Gradle wrapper, and CI action pins. Check upstream compatibility
matrices and migrations together, then run the full local gate and audit resolved
dependencies. Keep intentional minimum OS versions and supported toolchains
explicit. Bun owns `bun.lock`; Bundler owns `Gemfile.lock`.

The iOS and Android implementations have separate native toolchains, so validate
both platform builds when updating coupled native dependencies. The web version
has its own TypeScript build and Worker configuration. Its package version and
the mobile versions follow the separate policies in [AGENTS.md](../AGENTS.md#shipping).

A Wrangler bundle dry run checks the build; upgrading its deployment group also
requires verifying the existing account, Worker, routes, and resource bindings.
Store lanes and `web:deploy` are separate release operations. Never deploy merely
to establish that an upgrade is safe; follow the skill's preview gates before
any separately authorized release.

## Recording an upgrade

Put each run's version inventory, audit findings, migrations, warnings, validation,
previews, and held groups in its PR. Keep only reusable procedures and active
constraints here. Link evidence for each exception and state its removal or
revisit condition; update entries in place and remove resolved ones. Do not append
a dated upgrade journal. Historical audits are not fresh results. Keep credentials,
private logs, state, and plan contents out of public reports.
