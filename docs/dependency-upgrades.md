# Dependency maintenance

Use the managed `update-dependencies` skill and the repository's
[setup, validation, and shipping guidance](../AGENTS.md).

## Compatibility and release boundaries

Inventory packages, the Ruby bundle, every `.mise.toml` tool, Android's version
catalog and Gradle wrapper, and CI action pins. Ruby is pinned in `.ruby-version`,
which the Gemfile and CI read; keep `.mise.toml`'s ruby equal to it. Check upstream
compatibility matrices and migrations together, then run the full local gate and
audit resolved dependencies. Keep intentional minimum OS versions and supported toolchains
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

Playwright's browser revision is tied to its package version. After changing that
pin, reinstall Chromium with `bun x --no-install playwright install --with-deps chromium`
and run the web integration cases against the actual production and preview builds.

## Android toolchain and release validation

Keep the Kotlin Compose compiler aligned with the Kotlin compiler selected by
AGP's [built-in Kotlin support](https://developer.android.com/build/migrate-to-built-in-kotlin).
Check the [AGP compatibility table](https://developer.android.com/build/releases/agp-9-4-0-release-notes)
and [Gradle compatibility matrix](https://docs.gradle.org/current/userguide/compatibility.html)
before changing Gradle or the build JDK. The build uses a maintained Temurin LTS
release; Java source/bytecode compatibility remains 17 and the minimum Android
version remains API 26. Regenerate both wrapper scripts with the selected Gradle
and verify the distribution SHA-256; the wrapper jar stays gitignored.

Preserve the explicit WorkManager constraint: Glance's older transitive request
can select Room keep rules that let R8 strip a required database constructor.
Revisit only when Glance itself selects a safe WorkManager/Room graph. Validate
with the minified release build and `scripts/testing/takeAndroidScreenshots.sh`, which
installs it using the local debug key and exercises startup and playback. A debug
build alone does not cover this regression.

## Deployment compatibility

The `nc.a2f0.net` custom domain belongs to Terraform in
[a2f0/a2f0.net](https://github.com/a2f0/a2f0.net); Wrangler's configuration omits
routes so it does not take over their management. Verify the authenticated
Terraform plan preserves the existing domain ID, account, hostname, and Worker
service, alongside Wrangler's read-only live Worker version and bindings checks.
Revisit this division only with a reviewed ownership migration and a complete
non-destructive preview.

Keep `upload_source_maps: false` to preserve the existing Worker upload policy.
[Wrangler 4.150](https://github.com/cloudflare/workers-sdk/releases/tag/wrangler%404.150.0)
changed the default; enabling upload later needs an explicit decision about the
source content sent to Cloudflare. This setting does not remove `.map` files
already emitted by the static website build.

Fastlane and its release SDK dependencies remain a coupled store-tool group;
RuboCop only lints and isn't part of it.
The lanes register identifiers, create/renew profiles, modify signing keychains,
and publish store builds and listings. Mocked helper tests validate local lane
logic, but do not preview those real effects. Hold this group until a genuine
read-only preview of the affected store operations is available; never run a
publishing lane just to test an upgrade. Recheck the selected
[Fastlane release notes](https://github.com/fastlane/fastlane/releases) and Ruby
advisory audit before revisiting it.

## Recording an upgrade

Put each run's version inventory, audit findings, migrations, warnings, validation,
previews, and held groups in its PR. Keep only reusable procedures and active
constraints here. Link evidence for each exception and state its removal or
revisit condition; update entries in place and remove resolved ones. Do not append
a dated upgrade journal. Historical audits are not fresh results. Keep credentials,
private logs, state, and plan contents out of public reports.
