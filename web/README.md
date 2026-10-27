# Noise Connoisseur for the web

The desktop web version, in TypeScript and the DOM. The noise is generated in an
`AudioWorklet` and played through an `<audio>` element, so media keys and the browser's media
controls work, and it keeps playing in background tabs. The site runs as the `nc` Cloudflare
Worker with static assets. This repo is available on the web at <https://nc.a2f0.net>.

## Quick start

After the [repository quick start](../README.md#quick-start), from the repository root:

```sh
bun run web:dev         # http://localhost:8080; set PORT to change it
```

It rebuilds when its sources change, including `l10n/` and `assets/brand/`; reload to pick up
a rebuild.

## Build

`bun run web:build` writes the production site to the gitignored `web/dist/` (`AudioWorklet`
needs a secure context, so it must be served over HTTPS or from localhost, not `file://`).
`bun run web:check` typechecks it, and `bun run test` includes its tests. The page, audio
worklet, and click tracker are separate bundles (`web/build.ts`); the favicon, also the logo
beside the title, is the app icon, built from `assets/brand/*.svg` with the social preview
image. The build also adds each page's
[search and social metadata](../docs/architecture.md#web-search-and-social-metadata).

Production web pages use CT for clicks; native apps remain free of analytics. See
[web click analytics](../docs/architecture.md#web-click-analytics) for activation, privacy,
and opt-outs.

## Privacy and support pages

The iOS and Android apps and their store listings link to their own privacy and support pages
in `web/ios/` and `web/android/` (served at `/ios/privacy`, `/android/support`, and so on);
`web/privacy.html` and `web/support.html` cover the website and every platform. Keep each
privacy policy accurate when an app starts storing or sending anything new.

## Deployment

`bun run web:deploy` builds the site and publishes the Worker; merging doesn't deploy it. See
[releasing](../docs/releasing.md#web).
