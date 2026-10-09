# Runbook (Windows Command Prompt)

Run these inside the `ultron-iris` folder. You need Node.js 20 or newer
(`node -v` to check). No `npm install` is needed: this repo has no dependencies.

## Step 1: pick the free models (needs internet)

```
npm run models:update
npm run models:check
```

`models:update` reads the live OpenRouter and NVIDIA catalogs and writes
`config/models.json`. It keeps only IDs ending in `:free`. Commit the new file.
`models:check` fails loudly if any chosen model has disappeared or is not free.
To force a model, put it in `config/models.overrides.json` and run update again.

## Step 2: deploy the proxy Worker

Run these inside the `worker` folder (`cd worker`).

1. Log in once: `npx wrangler login`
2. Add every key you have as a Worker secret. Wrangler asks you to type the
   value, so it never appears in chat or in a file:
   `npx wrangler secret put OR_KEY_1` (repeat for OR_KEY_2, OR_KEY_3, ...)
   `npx wrangler secret put NVIDIA_KEY_1` (repeat for NVIDIA_KEY_2)
3. Check `ALLOWED_ORIGINS` in `worker/wrangler.toml` matches where the app is hosted.
4. Deploy: `npx wrangler deploy`

## Test it (3 steps)

1. Open `https://ultron-iris-proxy.<your-subdomain>.workers.dev/health` in a browser.
   You want `"ok": true` and key counts above zero. Anything wrong is listed in `problems`.
2. Open `.../health?deep=1`. This makes one tiny real model call and shows each attempt.
3. Chat test (Command Prompt, one line):
   `curl -X POST https://ultron-iris-proxy.<your-subdomain>.workers.dev/chat -H "Content-Type: application/json" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in five words\"}]}"`
   (a call from the command line has no Origin header, so it is allowed.)

## Turn on CI (one-time, in the GitHub website)

The build connector cannot write workflow files. Open `docs/ci.yml.txt` in the
repo, copy its contents, then use Add file > Create new file, name it
`.github/workflows/ci.yml`, paste, and commit. It runs `npm run verify` on
every push.

## What is NOT verified yet

- Real calls to OpenRouter and NVIDIA (the build sandbox cannot reach them).
  Everything is tested against faked responses. `health?deep=1` is the real test.
- The response cache is off until you create a KV namespace (see `wrangler.toml`).
- CI has never run on GitHub, because the workflow file is not installed yet.
