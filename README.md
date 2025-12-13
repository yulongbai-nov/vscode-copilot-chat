# Company Copilot Chat (intranet build)

This fork of `GitHub.copilot-chat` is published only inside our intranet. It keeps upstream Copilot Chat behavior but adds:
- VSIX build hardened for offline/intranet CI (cache hydration + explicit build step + direct `vsce` packaging).
- Internal branding (muscular Octocat icon) and per-view icons to make the UI easier to spot in our toolset.
- Documentation tailored for private distribution and updates.

## Installing and getting updates
- Download the latest `.vsix` from the internal share (or GitHub release on our fork) and run `Extensions: Install from VSIX…` in VS Code.
- To notify teammates about new builds, share the release link and/or set up an internal channel (Teams/Slack/email) with the VSIX URL. If you maintain a private extension gallery, add it to `settings.json`:
  ```json
  {
    "extensions.gallery": {
      "serviceUrl": "https://your-intranet-gallery.example.com/_apis/public/gallery",
      "cacheUrl": "https://your-intranet-gallerycache.example.com",
      "itemUrl": "https://your-intranet-gallery.example.com/items"
    },
    "extensions.autoUpdate": true
  }
  ```
- Scripted updates for dev machines/CI: `code --install-extension ./copilot-chat-*.vsix --force`.

## What’s different from upstream
- Workflow: `publish-vsix` now hydrates the simulation cache, builds with `NODE_OPTIONS=--experimental-strip-types`, and calls `vsce package` directly (no reliance on stripped scripts).
- Branding: new strong Octocat icon for the extension and custom icons for each contributed view (Chat Debug, Context Inspector, Live Request Metadata/Editor, Subagent Prompt Monitor).
- Docs: this README focuses on internal usage; upstream marketing/telemetry copy removed.

## Views and icons
- Chat Debug: `assets/icon-chat-debug.svg`
- Context Inspector: `assets/icon-context-inspector.svg`
- Live Request Metadata: `assets/icon-live-request-metadata.svg`
- Live Request Editor: `assets/icon-live-request-editor.svg`
- Subagent Prompt Monitor: `assets/icon-subagent-monitor.svg`
- Extension icon: `assets/icon-strong-octocat.svg` (replaces the stock Copilot glyph)

## Notes
- This fork still uses upstream Copilot services; keep VS Code on the latest stable for compatibility.
- If you further customize models, endpoints, or telemetry, document the deltas here before shipping new VSIX builds.
