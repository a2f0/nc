// Compiled by l10n:check: these must remain errors as the catalog grows.
import type { LanguagePreference, LocaleTag } from "../locales";
import type { PlatformKey, Translation } from "../strings";

function catalogContracts() {
  const supported: LocaleTag = "de";
  const followDevice: LanguagePreference = "device";
  // @ts-expect-error Unsupported languages aren't published picker options.
  const unknown: LocaleTag = "not-a-language";
  // @ts-expect-error Native-only strings cannot be requested by the web app.
  const nativeOnly: PlatformKey<"web"> = "notification_channel_name";
  // @ts-expect-error A translation cannot drop an interpolation argument.
  const broken: Translation["play_noise"] = "Play";
  // @ts-expect-error A language must cover every translatable source key.
  const incomplete: Translation = { volume: "Volume" };
  return { supported, followDevice, unknown, nativeOnly, broken, incomplete };
}
void catalogContracts;
