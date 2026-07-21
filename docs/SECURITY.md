# Security boundaries

AfterPrompt treats imported material as an untrusted static visual document inside the editor. The editing canvas renders a sanitized clone. Current filtering removes scripts, frames, embedded objects, SVG animation and `foreignObject`, inline event handlers, `srcdoc`, dangerous URL schemes, CSS imports, and known executable CSS forms. Fragment packages also enforce path, count, and size limits.

The original canonical document is retained separately so standard HTML export can preserve source runtime behavior. Therefore an exported document must be reviewed before it is opened outside the editor or published.

## Deployment boundary

The current application is a local-first static client. It is not designed as an anonymous multi-tenant service for users to exchange hostile documents. Such a deployment requires additional server-side validation, strict CSP, process/origin isolation, abuse controls, and independent security review.

## Security and compatibility limits

- Sanitization is a mitigation, not a universal browser-content sandbox.
- DOM parsing and serialization can normalize markup and cannot promise byte-identical round trips.
- External references may remain in exported HTML and should be reviewed for privacy and availability.
- Complex CSS, dynamic runtimes, and advanced SVG features are outside reliable editing coverage.
- Local directory and file access remain browser-mediated; the editor provides no general local command channel.

Report vulnerabilities through the private process in the repository-level [security policy](../SECURITY.md).
