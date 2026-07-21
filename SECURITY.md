# Security policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private security-advisory flow for this repository:

<https://github.com/YTdou/AfterPrompt/security/advisories/new>

Include affected commit/version, reproduction steps, impact, and any minimal safe fixture. Avoid including private user documents or active credentials. Maintainers will acknowledge reports when project capacity allows; no fixed response-time SLA is promised.

## Supported versions

Security fixes currently target the latest code on the default development line. No long-term-support release line is advertised yet.

## Scope

Relevant reports include sanitizer bypasses, unsafe URL/resource handling, archive traversal or decompression abuse, unintended local-file exposure, and exported-content confusion. AfterPrompt is not a universal hostile-content sandbox or an anonymous multi-tenant isolation system. See [security boundaries](docs/SECURITY.md).
