# ultron-iris

ULTRON is a multi-agent AI assistant for **Iris** (the business). It runs as a
PWA that works on Android, iPhone and PC, and uses free models only.

> Status: build in progress. Step 0 (repo setup) only. Nothing below is built
> until its step is marked done in the build log.

## Architecture

1. **Frontend (PWA)** holds no secrets and talks only to the proxy.
2. **Proxy (Cloudflare Worker)** holds every API key as an encrypted secret.
   It routes requests to models, rate limits, caches, and handles fallbacks.
3. **Memory and data (Supabase)** stores Postgres tables, pgvector memory,
   auth and file storage.

## Agents

| Agent | Job |
|---|---|
| Ultron (supervisor) | Reads the request, picks the route, merges results |
| Researcher | Web lookups through Tavily (Exa as backup), returns sources |
| Default | General chat, drafting, quick answers |
| Memorist | Writes and reads long-term memory |
| Builder (optional, later) | Writes code and files |

All models must be free (OpenRouter IDs ending in `:free`, plus Nemotron on
the NVIDIA endpoint). Model names live in one file, `config/models.json`
(added in Step 1), never in components.

## Build sequence

One commit per step. A step is done only when it passes its checks.

0. Repo, README, .gitignore, LICENSE
1. Config and model list script
2. Worker proxy with the Default agent and a health check
3. PWA shell and motion system
4. Supervisor and Researcher
5. Supabase memory (tables, RLS, embeddings), then offline memory layer
6. Google sign-in
7. Calendar, Gmail, Maps, Drive notes
8. Service worker, offline, install prompt
9. Credit guard, logging, error screens
10. Test pass, deploy, handoff doc

## Secrets

No secret ever goes in this repo or in the frontend.

- API keys, the Supabase service role key and the Google client secret live
  only in Cloudflare Worker secrets.
- `.env` files are git-ignored. `.env.example` (key names only, no values)
  is the one allowed template.
- The Supabase URL and anon key and the Google OAuth client ID are public by
  design and may be used in the frontend. Supabase access is protected by RLS.
- If a key is ever pasted into a chat or committed, rotate it.

## Platforms

- **Stage 1:** PWA for Android, iPhone and PC.
- **Stage 2:** polish, offline behavior, full QA on all three.
- **Stage 3:** wrapped apps only if needed, reusing the same code.

## License

Proprietary. All rights reserved. See `LICENSE`.
