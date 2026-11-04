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

Select Ruby and isolate `GEM_HOME`, `GEM_PATH`, `BUNDLE_PATH`,
`BUNDLE_APP_CONFIG`, and `BUNDLE_USER_HOME` before any gem or bundle write;
selecting the Ruby executable alone does not isolate an inherited bundle.
Keep these paths in this checkout or its task runtime and verify `gem env home`
and `bundle config get path` in the command environment. Preserve frozen installs
for validation. After changing Ruby, install the locked native extensions under
that Ruby rather than reusing extensions compiled by another runtime.
On macOS, verify that `clang` resolves to Xcode rather than another toolchain.
If invoking Xcode's compiler directly, set `SDKROOT` from
`xcrun --sdk macosx --show-sdk-path` for the bundle installation command only;
otherwise native extension probes can fail to find standard headers. Do not carry
that macOS SDK selection into iOS builds or change the global Xcode selection.

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

Android Lint's version follows AGP, and Slack's compose-lints is built against a specific
Lint version, so move them together. Keep AGP on the 9.4 line while
[compose-lints 1.6.1](https://github.com/slackhq/compose-lints/blob/1.6.1/gradle/libs.versions.toml)
is built and tested against Lint 32.4.1; AGP 9.5 moves Lint to 32.5.0. Revisit with
upstream compatibility evidence and the full Android lint, detekt, build, unit, and
minified playback gates, not merely the AGP minimum Gradle/JDK table.

Detekt's [compatibility table](https://detekt.dev/docs/introduction/compatibility/)
lists its build/test combination, not enforced version equality: its Gradle plugin uses
compile-only Kotlin/AGP dependencies. The 2.0 alpha.6 baseline is Kotlin 2.4.10,
AGP 9.3.1, Gradle 9.6.1, and a highest tested JDK of 25. NC's newer combination
still needs real analysis/build verification; do not call it upstream-tested solely
because resolution succeeds. Detekt stays on its 2.0 prereleases, built for Kotlin 2.4
and AGP 9, because its stable 1.23 line predates both; take 2.0.0 once it's released. ktlint,
SwiftFormat, and SwiftLint are pinned in `.mise.toml`. A new release, or a new Xcode with
its warnings now errors, can add findings: run `bun run format:kotlin`, `bun run format:swift`,
and the Gradle analysis, and fix them in the upgrade.

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

Holding deployment tools does not make their dependency graphs advisory-free.
Wrangler's Miniflare dependency pins an affected Undici release; the
[Undici advisory](https://github.com/advisories/GHSA-4qv8-2p9j-2685)
identifies fixes starting at 7.30.1 on that line. Addressable in Fastlane and its
SDK graph is also affected by
[upstream advisories](https://github.com/sporkmonger/addressable/security/advisories/GHSA-4w5q-wg7v-w6gp),
with fixes starting at 2.9.1. Re-audit both complete graphs on every upgrade.
Revisit these holds with the owning group's real-environment preview and actual
integration checks; an override, mocked lane test, or successful bundle alone
cannot establish safety. Remove these constraints only after the resolved graph
is fixed and the corresponding preview and regression gates pass.

## Recording an upgrade

Put each run's version inventory, audit findings, migrations, warnings, validation,
previews, and held groups in its PR. Keep only reusable procedures and active
constraints here. Link evidence for each exception and state its removal or
revisit condition; update entries in place and remove resolved ones. Do not append
a dated upgrade journal. Historical audits are not fresh results. Keep credentials,
private logs, state, and plan contents out of public reports.
