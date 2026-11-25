# Security

OAuth tokens authorize use of a Cenmax AI account's models and allowance. Protect the Pi profile and the Cenmax AI refresh-fence directory. Do not include credentials, account exports, real prompts, approval codes, or personal information in public issues.

Use `/cenmax-disconnect` for remote revocation. A failed or uncertain rotating exchange requires a fresh login. Do not delete refresh markers to replay an old token.

The host application, installed extensions, its tools, and code running as the same operating-system user are trusted. Loopback capabilities and file permissions are not operating-system isolation. Report suspected credential disclosure privately through Cenmax AI's official support channel.
