import { createTracker } from "@a2f0/ct-client";

/** Enabled only by the production website build, never native apps or imports. */
declare const CT_ENABLED: boolean;

if (
  typeof CT_ENABLED !== "undefined" && CT_ENABLED &&
  typeof window !== "undefined" &&
  window.location.origin === "https://nc.a2f0.net"
) {
  createTracker({
    site: "nc",
    app: "web-app",
    environment: "production",
    capture: "all",
    overrideGpc: true,
    page: () => "/",
  }).init();
}
