# Pi qualification

Tested 2026-11-25 with official `@mariozechner/pi-coding-agent` and `@mariozechner/pi-ai` 0.73.1, Node.js 24.22.3, Linux ARM64, in a disposable container. No host-machine Pi installation was used.

The real `pi install` command accepted the local package. Pi's SDK resource loader loaded one extension without errors and registered the Cenmax AI native OAuth provider. Tests then used the installed host's auth storage, model registry, agent session, read tool and session manager, rather than mocked replacements.

| Check | Result |
| --- | --- |
| Device authorization and native credential persistence | Passed |
| Live account-specific model catalogue | Passed; only entitled Cenmax AI names and IDs |
| Streamed generation and real file-tool execution | Passed; one read call, 23 text deltas, exact randomly generated file content |
| Fresh-process saved-session recovery | Passed; exact earlier file content, zero additional tool calls |
| Native refresh after locally forced token expiry | Passed; rotating refresh credential changed |
| `/cenmax-disconnect` remote and local logout | Passed; local credential removed and old access credential returned HTTP 401 |
| Adapter regression suite | 16 tests passed |

The test grant was revoked after the checks. Only synthetic file content was used; no credentials, account data or session transcripts are included in this package.

Not qualified: full-screen terminal UI interactions, startup model selection before catalogue discovery, custom SDK bootstrap configurations, other operating systems, load testing, account-switching concurrency and allowance exhaustion. Interactive-first onboarding remains the supported entrypoint. Package publication and gallery indexing are separate release steps.
