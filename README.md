# Cenmax AI for Pi

Use your Cenmax AI account allowance from the Pi coding agent. This package adds a native OAuth provider to `/login`, discovers the models available to the signed-in account, and uses Pi's normal tools and agent loop.

## Status and requirements

Targets the released `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` **0.73.1** public extension interfaces. Node.js 22.12+ and a POSIX host are required. The package is a Pi package, not a fork of Pi. Newer renamed SDK packages require a separately qualified release.

The initial entrypoint is interactive-first: launch Pi, load the account catalogue, then choose a model. Startup `--provider` model selection and custom SDK bootstrap order are not qualified. The extension never opens a default credential store before the active session exists, so another profile's models cannot be preloaded accidentally.

The Cenmax AI service must register the public client `cenmax-pi` with the device-code and refresh-token grants and the `chat` scope. Client IDs are public, not secrets. The package does not register or activate that client.

Live qualification passed against Pi 0.73.1 on Linux ARM64 using the real package installer and SDK agent runtime: OAuth approval, account catalogue, streamed file-tool execution, saved-session recovery, native token refresh, and remote revocation. See [qualification details](QUALIFICATION.md). The full-screen terminal UI and other operating systems have not been qualified.

## Install and connect

Download the [reviewed release package](https://github.com/cloudcenmax/cenmax-ai-pi/releases/tag/v0.1.0) into a permanent directory. It contains the integration, not the host harness:

```sh
mkdir cenmax-ai-pi
curl --fail --location --output cenmax-ai-pi-oauth-0.1.0.tgz https://github.com/cloudcenmax/cenmax-ai-pi/releases/download/v0.1.0/cenmax-ai-pi-oauth-0.1.0.tgz
tar -xzf cenmax-ai-pi-oauth-0.1.0.tgz --strip-components=1 -C cenmax-ai-pi
```

Register the extracted directory with the installed Pi host using `pi install /absolute/path/to/cenmax-ai-pi`, then start `pi`. From a source checkout, run the tests before registering it:

```sh
npm test
pi install /absolute/path/to/this/package
pi
```

In Pi, run `/login`, choose **Cenmax AI**, and follow the displayed approval link. Confirm the code and select the personal or company account whose allowance should be used. Then run `/cenmax-models` and use `/model` to select an entitled Cenmax AI model.

Public model IDs such as `pro` and `worker` are offered only when the account catalogue returns them. Each generation rechecks entitlement, including tool-loop turns. No global fallback catalogue is shipped. Refresh `/cenmax-models` after an account or plan change. Subscription cost fields are zero because this integration cannot estimate a monetary cost for allowance consumption; zero does not mean unlimited use.

Pi stores OAuth credentials through its profile-aware auth SDK and serializes refreshes. A separate private directory at `~/.config/cenmax-ai/pi` stores only one-way rotating-grant fingerprints, never the token values. Before a refresh is dispatched, an exclusive durable marker is written. An uncertain exchange requires a fresh `/login` rather than a second use of the same grant. Do not remove those markers to work around a sign-in failure or copy rotating credentials across profiles or machines.

Use `/cenmax-disconnect` to revoke the current grant remotely and remove Pi's local sign-in. Pi's generic `/logout` removes local credentials only; disconnect before using it when remote revocation is needed. If revocation cannot complete, credentials remain available so you can retry.

## Security and protocol

The fixed public service origin is `https://console.ai.cenmax.in`. Device authorization, refresh and revocation use its `/oauth` endpoints; subscription model requests use `/app/v1`. No pay-as-you-go key is required. The scopes grant model access, not saved history, files, or account management.

The extension passes reusable tokens only to the fixed Cenmax AI HTTPS origin and refuses redirects. Pi's streaming SDK receives a random, generation-scoped loopback capability limited to the selected model; it never receives the reusable OAuth token. Model endpoint/header/payload overrides cannot redirect this credential. The loopback broker closes after generation. This does not isolate hostile code running as the same operating-system user: install extensions and run tools only on a trusted host.

No telemetry is added. Errors use neutral Cenmax AI messages. Tool and command approvals remain Pi's responsibility; OAuth does not grant permission to execute commands.

## Development and public release

```sh
npm test
npm pack --dry-run
```

Tests use synthetic Cenmax AI identities and mocked host/network interfaces. They cover polling, consent URL validation, expiry, refresh fencing, model entitlements, guarded streaming handoff, disconnect ordering, and credential-file safety. Publish only the npm artifact or the allowlisted source files. Exclude credentials, local configuration, dependency directories, caches, logs, and machine-specific paths.

For public discovery, the package includes Pi's documented `pi-package` keyword and extension manifest. An npm release can be found through Pi's linked npm package search; a public Git repository can also be installed directly with a pinned tag. Neither repository creation nor this manifest publishes an npm release. Review third-party code before installation because Pi extensions execute with your user's permissions.

References: [published Pi custom-provider source](https://github.com/badlogic/pi-mono/blob/v0.73.1/packages/coding-agent/docs/custom-provider.md), [Pi package documentation](https://github.com/badlogic/pi-mono/blob/v0.73.1/packages/coding-agent/docs/packages.md).
