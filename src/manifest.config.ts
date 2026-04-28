import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

// MV3 manifest. Permissions are minimized at install (T-7, N-11):
//   - host permissions for provider APIs are `optional_host_permissions`,
//     requested at runtime when the user enables a provider in settings.
//   - content_scripts uses `<all_urls>` matches because the floating action
//     button (F-1.2) needs to appear on any page where the user selects text.
export default defineManifest({
  manifest_version: 3,
  name: 'Hermes',
  version: pkg.version,
  description: pkg.description,

  action: {
    default_title: 'Hermes',
    default_popup: 'src/popup/index.html',
  },
  options_page: 'src/options/index.html',

  background: {
    service_worker: 'src/background/service-worker.ts',
    type: 'module',
  },

  content_scripts: [
    {
      matches: ['http://*/*', 'https://*/*'],
      js: ['src/content/content-script.ts'],
      run_at: 'document_idle',
      all_frames: false,
    },
  ],

  permissions: [
    'contextMenus',
    'storage',
    'activeTab',
    'scripting',
    'downloads',
    'offscreen',
  ],

  // Spec §T-7 prefers `optional_host_permissions`, but in practice the
  // runtime permission dance (chrome.permissions.request needing a user
  // gesture in the right context) is brittle: a user who never re-clicks
  // the provider dropdown ends up with no host permission, and the
  // offscreen-document fetch fails with an opaque "Failed to fetch".
  // Pinning these as install-time host permissions trades a single, clear
  // permission warning at install for a working capture flow on every run.
  host_permissions: [
    'https://generativelanguage.googleapis.com/*',
    'https://api.openai.com/*',
    'https://api.anthropic.com/*',
    'https://openrouter.ai/*',
    'https://api.elevenlabs.io/*',
    // Microsoft Edge "Read Aloud" TTS service. host_permissions to https
    // grants WebSocket access to the same origin per MV3 docs.
    'https://speech.platform.bing.com/*',
  ],

  commands: {
    'capture-selection': {
      suggested_key: {
        default: 'Ctrl+Shift+H',
        mac: 'Command+Shift+H',
      },
      description: 'Capture current selection to Hermes',
    },
  },

  web_accessible_resources: [
    {
      resources: ['src/offscreen/index.html'],
      matches: ['<all_urls>'],
    },
  ],

  // sql.js (used by the .apkg builder) needs to instantiate WebAssembly. MV3
  // ships with a default CSP of `script-src 'self'` for extension pages,
  // which blocks WASM compile/instantiate. Adding 'wasm-unsafe-eval' is the
  // standard, narrowest opt-in (does NOT permit eval of arbitrary JS — only
  // synchronous/streaming WASM compilation from the extension's own bytes).
  content_security_policy: {
    extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
  },
});
