# Production deployment

## Target topology

The production endpoint is:

```text
https://47.237.77.35/AfterPrompt/
```

The application is a static Vite build. Nginx serves versioned releases directly; Node.js and `vite preview` are not production runtime dependencies.

```text
/var/www/last-mile-studio/
├── current -> releases/<release-id>
├── previous -> releases/<previous-release-id>
└── releases/
    └── <release-id>/
        └── last-mile-studio/
            ├── index.html
            └── assets/
```

The existing HTTP routes `/`, `/espur/`, `/modelselect/`, and `/healthz` remain owned by the existing Nginx server block. The bootstrap adds one isolated include for the ACME challenge and `/AfterPrompt/` redirect; the legacy `/last-mile-studio/` path redirects to the canonical `/AfterPrompt/` path.

## First deployment

Build and validate an immutable release locally:

```bash
./scripts/build-release.sh
```

The command runs `npm ci`, unit tests, a normal production build, the real-browser smoke test, and the subpath production build. It then verifies that public source maps are absent and creates a SHA-256-protected archive under `.release/<release-id>/`.

Stage a completed release on the target host:

```bash
./scripts/stage-production.sh .release/<release-id>
```

The staging step is deliberately unprivileged. It uploads the archive, checksum, release metadata, deployment scripts, and Nginx/systemd templates to `/home/zkm/last-mile-studio-bootstrap`.

Review the staged files, then run the one-time root bootstrap from an interactive SSH session. Supply a real operational email address locally; do not send a sudo password through chat:

```bash
ssh zkm@47.237.77.35
sudo CERTBOT_EMAIL=you@example.com bash /home/zkm/last-mile-studio-bootstrap/deploy/bootstrap-root.sh
```

The bootstrap:

1. verifies the staged release checksum;
2. creates the release root owned by `zkm:labadmins`;
3. activates the release atomically;
4. backs up and patches the existing Nginx server with one include;
5. temporarily serves the application over HTTP for ACME validation;
6. installs pinned Certbot `5.4.0` into `/opt/certbot`;
7. requests the short-lived IP certificate for `47.237.77.35`;
8. installs the isolated HTTPS server and HTTP redirect;
9. enables a six-hour renewal timer and reload hook;
10. opens the standard HTTPS service in firewalld when firewalld is active;
11. runs Nginx, certificate, endpoint, and existing-route checks.

Alibaba Cloud's security group must also allow inbound TCP 443. The host firewall configuration cannot override a cloud security-group denial.

## Subsequent releases
Build and stage the new release in the same way. To migrate an existing installation from the legacy public path, run the staged deploy/migrate-public-path.sh through sudo in an interactive SSH session. It backs up Nginx, validates the new canonical /AfterPrompt/ route, and restores the prior configuration on failure.

After staging and any required path migration, activate it without sudo:

```bash
ssh zkm@47.237.77.35 \
  /home/zkm/last-mile-studio-bootstrap/deploy/activate-release.sh \
  /home/zkm/last-mile-studio-bootstrap
```

Then run:

```bash
curl --fail --head https://47.237.77.35/AfterPrompt/
STUDIO_BASE_URL=https://47.237.77.35/AfterPrompt/ npm run test:browser
```

No release is deleted automatically. This preserves an auditable rollback set.

## Rollback

Roll back to the recorded previous release:

```bash
ssh zkm@47.237.77.35 \
  /home/zkm/last-mile-studio-bootstrap/deploy/rollback-release.sh
```

Or select an explicit release ID:

```bash
ssh zkm@47.237.77.35 \
  /home/zkm/last-mile-studio-bootstrap/deploy/rollback-release.sh \
  <release-id>
```

Rollback only changes the `current` symlink. Static hashed assets from older releases remain available inside their release directories.

## Operational checks

```bash
curl --fail https://47.237.77.35/AfterPrompt/healthz
systemctl status nginx --no-pager
systemctl status last-mile-studio-certbot-renew.timer --no-pager
systemctl list-timers last-mile-studio-certbot-renew.timer --no-pager
/opt/certbot/bin/certbot certificates
```

Expected caching policy:

- `index.html` and SPA fallbacks: revalidate on every visit;
- fingerprinted files under `assets/`: one year, `immutable`;
- no `.map` files in the production release.

The Content Security Policy intentionally allows inline script and style inside the same-origin editor because the generated presentation preview uses dynamic `iframe.srcdoc` runtime code. Imported documents are still sanitized by the application, while Nginx blocks plugins, framing, forms, and unrelated network connections. Replacing this compatibility policy with nonce- or hash-only scripts requires a separate presentation-runtime redesign.

## Recovery from a failed bootstrap

The bootstrap writes a timestamped backup beside `/etc/nginx/conf.d/flask_app.conf` before adding the include. It validates Nginx before every reload. If the script stops, inspect the printed error and backup path before retrying; do not delete the existing application configuration.
