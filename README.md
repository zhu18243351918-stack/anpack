# Anpack

Anpack is a local-first packaging dieline, 3D editing and product rendering workstation.

## Targets

- **Web / GitHub Pages**: public product website and authenticated browser editor.
- **Windows desktop / Tauri 2**: the same React + Three.js editor with an embedded Blender Cycles final-render pipeline.

## Local development

```powershell
pnpm install
Copy-Item .env.example .env.local
pnpm dev:web
```

Desktop development requires Rust, WebView2 and a Blender runtime at `src-tauri/resources/blender/blender.exe`:

```powershell
pnpm tauri:dev
```

## Authentication

Create a Supabase project, apply `supabase/migrations/0001_auth_profiles.sql`, deploy the `issue-offline-receipt` Edge Function, then configure the Vite variables documented in `.env.example`. Project files, GLB assets and artwork are never stored in Supabase.

## Project format

New files use `.anpack`, a ZIP container containing `project.json`, a manifest, textures and an optional `assets/model.glb`. Version 1–3 snapshots and `.packshot` files remain readable through migration code.

## Release

GitHub Pages and tagged Windows releases are built by workflows in `.github/workflows`. Replace the placeholder repository URL and Tauri updater public key before the first release.

## License

Anpack source is publicly viewable but all rights are reserved. Blender and other dependencies retain their own licenses; see `src-tauri/resources/THIRD_PARTY_LICENSES.md`.
