# Security boundary

- Bind the coordinator to loopback or a Tailscale interface; never expose it to the public Internet.
- Put a WebAuthn/passkey-capable session issuer in front of it. After passkey verification, the issuer supplies a short-lived bearer session matching `ORDIS_SESSION_TOKEN`.
- Use Tailscale ACLs so only named operator devices can reach the PWA and coordinator.
- Development bypass (`ORDIS_AUTH_MODE=development`) is only acceptable on loopback.
- External mutations require a pending approval to become approved, remain within its recorded scope, be unexpired, and be consumed atomically once.
- Secrets belong in environment/service credentials, not Git. Do not set `OPENAI_API_KEY`; Ordis deliberately aborts when it is present.
- Artifact paths are rooted under the configured data directory and should be served by identifier rather than arbitrary filesystem paths.

Full passkey registration, attestation policy, recovery, and token signing are the next security slice; the current coordinator enforces the authenticated-session boundary but does not issue sessions.

