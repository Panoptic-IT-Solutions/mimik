import { defineConfig } from "wxt";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  modules: ["@wxt-dev/module-react", "@wxt-dev/i18n/module"],
  srcDir: "src",
  imports: false,
  webExt: {
    chromiumArgs: ['--user-data-dir=/tmp/mimik-dev-profile', '--window-size=1280,800', '--window-position=0,0', '--force-device-scale-factor=1.25'],
  },
  zip: {
    excludeSources: [
      "mockups/**",
      "docs/**",
      ".claude/**",
      ".planning/**",
      ".worktrees/**",
      "CLAUDE.md",
      "AGENTS.md",
      "CONTRIBUTING.md",
    ],
  },
  alias: {
    '@': 'src',
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
    'build:manifestGenerated': (wxt, manifest) => {
      if (wxt.config.browser === 'firefox' && manifest.sidebar_action) {
        (manifest.sidebar_action as Record<string, unknown>).open_at_install = false;
        (manifest.sidebar_action as Record<string, unknown>).default_icon = 'icon32.png';
      }
    },
  },
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';
    return {
      /*
       * Fixes the Chromium extension id, so an unpacked build, a self-hosted
       * .crx and a Web Store listing all share one id. The Kinde callback URL,
       * the hub's RECORDINGS_ALLOWED_ORIGINS and the Intune force-install
       * policy all name that id. The matching private key is in 1Password as
       * "Panoptic Capture extension signing key"; only a Web Store upload of
       * the very first version needs it. This is a public key, not a secret.
       */
      ...(isFirefox
        ? {}
        : {
            key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuA8sQ8qyjO+CPiXsiVdDDwGo1j120Km84f2u2HFv7njfpDQlwrxzthK2YIcp1CjsY2gWK8eDORlKFZO68op9+93ohfovqcfSwowoBdMsYJKr0sZPHQvCJhidKyGIdcaQoxcLawxSlj+VkJj1wYZE5P12D8BbbYEGVJEHrR3dOtjy1QlwyQ9UlMr+2UFLDkE7X6KzvrTu544wTGzq1oAYEuxK/zRG3ESW9s/xtsv94AwDVI6DBd24UutiI+d0wrzRNI8aIT1JWP9Y4M2ypDNQddiC/kNGzh1hGkkHrfUU+ER+6hhZ3sr4WPT3PXpcEFT599jooycOEzVimSL7vaUrSQIDAQAB',
          }),
      /*
       * Lets an enterprise policy (Intune, Group Policy, a macOS profile) set
       * the hub URL, Kinde issuer and client id through browser.storage.managed.
       */
      storage: { managed_schema: 'managed_schema.json' },
      name: "__MSG_app_store_title__",
      description: "__MSG_app_description__",
      default_locale: "en",
      permissions: [
        "storage",
        "activeTab",
        "tabs",
        "scripting",
        "unlimitedStorage",
        "webNavigation",
        // Kinde sign-in for Panoptic Docs. Both browsers honour the permission,
        // but Firefox implements only launchWebAuthFlow and getRedirectURL, and
        // its redirect URL is a per-installation UUID rather than one fixed
        // extension id, so every Firefox install needs the wildcard callback
        // allowed on the Kinde application.
        "identity",
        ...(isFirefox ? [] : ["sidePanel", "offscreen"]),
      ],
      ...(isFirefox
        ? { optional_host_permissions: ["<all_urls>"] }
        : { host_permissions: ["<all_urls>"], minimum_chrome_version: "118" }),
      icons: {
        16: 'icon16.png',
        32: 'icon32.png',
        48: 'icon48.png',
        128: 'icon128.png',
      },
      action: {},
      // The capture notification draws the Panoptic mark into whatever page the
      // user is recording. A content script may only load a packaged file from
      // page context if that file is web accessible, so without this the mark
      // is blocked and the notification comes up empty.
      web_accessible_resources: [
        {
          resources: ["panoptic-mark.png"],
          matches: ["<all_urls>"],
        },
      ],
      ...(isFirefox
        ? {
            sidebar_action: {
              default_panel: "sidepanel.html",
              default_icon: "icon32.png",
              default_title: "Panoptic Capture",
              open_at_install: false,
            },
            browser_specific_settings: {
              gecko: {
                id: "mimik@westpoint.io",
                strict_min_version: "128.0",
                data_collection_permissions: {
                  required: ["websiteActivity"],
                  optional: [
                    "websiteContent",
                    "personallyIdentifyingInfo",
                  ],
                },
              },
            },
          }
        : {
            side_panel: {
              default_path: "sidepanel/index.html",
            },
          }),
    };
  },
});
