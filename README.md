# NovaHost — Minecraft hosting platform starter

A responsive black/purple hosting storefront and customer dashboard with a Node.js API, SQLite storage, admin tools, and Pterodactyl Application API provisioning.

## Important: what is included

- Public NovaHost landing page and plan cards.
- Customer registration/login (bcrypt password hashes, signed JWT).
- Customer dashboard, account credit, server list, and Pterodactyl panel link.
- Admin dashboard: list users, servers and orders; approve manual orders; add account credit.
- Pterodactyl 1.x Application API integration to create a Pterodactyl user and provision a Minecraft server.
- Server resources are set from the selected plan on the server side, not trusted from browser input.

## What you must configure before real provisioning

This project does **not** include physical server capacity, a payment gateway, DNS, or a running Pterodactyl panel. It is a starter application, not a turnkey cloud provider. Real servers require an administrator-managed Linux host, Docker, Pterodactyl Panel + Wings, network/firewall configuration, domain and HTTPS, and enough capacity.

### Requirements

- Node.js 20+
- A trusted Linux VPS or server for production
- Pterodactyl Panel 1.x stable installation, Wings node online, and a Minecraft egg/allocation configured
- HTTPS for public deployment

### Local setup

1. Copy `.env.example` to `.env`.
2. Set `JWT_SECRET` to a long random secret (32+ characters).
3. Set a strong `ADMIN_PASSWORD` (at least 14 characters) and a private `ADMIN_EMAIL`.
4. Set `PTERO_URL` and `PTERO_APPLICATION_KEY`.
5. Set `PTERO_EGG_ID` to your Minecraft egg ID and `PTERO_ALLOCATION_ID` to an available allocation ID. Set the optional location ID if you use it.
6. Run:

   ```bash
   npm install
   npm start
   ```

7. Open `http://localhost:3000`.

The admin account is created on first startup when `ADMIN_PASSWORD` is valid. Keep `.env` private. Never put Pterodactyl API keys in frontend JavaScript or commit `.env` to Git.

## Pterodactyl compatibility

This starter targets the **Pterodactyl 1.x stable Application API** (`/api/application`). It uses `POST /users` followed by `POST /servers`. API keys should be narrowly permissioned for the required user/server operations where possible. Review the official API docs before production use:
- https://docs.pterodactyl.io/v1/api
- https://docs.pterodactyl.io/v1/api/application-servers/post-create-server

The generated customer gets a Pterodactyl account and a link to your Panel for console, file manager, backups, and other controls. NovaHost does not store customer Pterodactyl passwords or expose the application key.

## Plans and billing

The four example plans are defined in `server.js`. Prices and resource limits are placeholders; change them to match your actual node capacity and costs. Paid orders are manual in this starter: an admin approves an order and adds account credit. No card/UPI gateway is connected. Do not advertise paid plans until billing, refunds, terms, support, taxes, and capacity have been properly set up.

## Production hardening checklist

Before public launch, have a qualified adult/administrator review:
- HTTPS, reverse proxy, firewall, backups, monitoring and server patching.
- Admin MFA and account recovery.
- Email verification, password reset, audit logs and stronger session handling.
- Payment gateway webhooks and refund process.
- Per-customer resource quotas and node-capacity checks.
- Pterodactyl API key scope and dedicated service account.
- Abuse reporting, acceptable-use policy, privacy policy, terms, and support process.
- SQLite is suitable for a small prototype; use managed PostgreSQL for a larger service.
- Add CSRF protection if you change to cookie-based authentication; keep CORS restricted.

## Architecture

Browser → NovaHost Express API → SQLite + Pterodactyl Application API → Pterodactyl Panel → Wings/Docker node.

Pterodactyl manages server provisioning. Wings runs each game server in an isolated container. NovaHost is the customer-facing storefront and account/billing layer.
