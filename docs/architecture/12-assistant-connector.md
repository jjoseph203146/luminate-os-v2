# AI assistant connector (read-only)

Added 2026-11-06. Lets Claude or ChatGPT answer questions such as "what needs my attention today?" from Luminate OS v2's own data, without relying on the old app's `/api/mcp`. It can only read.

## What it is
`POST /api/mcp` (`src/app/api/mcp/route.ts`) is a stateless MCP (Model Context Protocol) endpoint using the official SDK, answering with JSON. `GET` and `DELETE` return 405. Everything it can do lives in `src/domains/assistant` (`service.ts`, `tools.ts`, `redact.ts`).

## URL and key
```
https://www.luminateos.app/api/mcp?key=<MCP_API_KEY>
```
Use the `www` host: the bare domain redirects, and connectors do not follow redirects reliably. `MCP_API_KEY` is set in Vercel (Production): at least 32 random characters, otherwise the connector is off (503). An `Authorization: Bearer <key>` header is accepted too and wins over `?key=` when both are present.

## Tools (names)
`list_needs_attention`, `list_sites`, `get_client`, `list_site_issues`, `list_open_requests`, `list_expiring`, `get_financial_summary`, `list_leads`. The authoritative list, with descriptions and arguments, is `src/domains/assistant/tools.ts`.

## Security model
- **Read only.** No tool writes anything. Each tool calls existing domain services as the `ai` actor, which has read permissions only (`src/platform/auth/permissions.ts`).
- **Allow-listed fields.** Every tool builds its answer from named fields. Emails, phone numbers, contact names, notes, descriptions, comments, file paths and Stripe ids are never selected.
- **Safety net.** `sanitize` masks anything that looks like an email, phone number, Stripe id or credential in free text (for example a request title a client typed), and `assertNoBannedKeys` refuses output that contains a banned field name. Answers are capped in size.
- **Audit.** Every tool call writes an `assistant.tool_called` row to `audit_log` (actor type `ai`, tool name and arguments, no result data).
- **Rate limits.** 60 calls a minute per address; 10 failed key checks per 10 minutes per address, then 429. Both limits are in memory (per server instance), so they slow bursts but are not a global guarantee.
- **Other limits.** Body at most 64 KB; `Cache-Control: no-store` on every answer; the key is never logged and never returned; the key is compared in constant time.
- **No session.** `/api/mcp` is a public path in `src/proxy.ts` and `isPublicPath`; the key check in the route is the only gate.

## Known limitation
The key travels in the URL, because connector screens often accept only a URL. URLs can end up in logs (browser history, proxies, hosting logs). Treat the key like a password and rotate it if the URL is ever shared. The upgrade path is OAuth (the connector signs the owner in), which removes the key from the URL.

## Rotating or switching off
Change `MCP_API_KEY` in Vercel and redeploy, then update the URL in the connector. Remove the variable (or shorten it below 32 characters) to switch the connector off entirely.

## Adding it
- **Claude:** Settings > Connectors > Add custom connector. Name: Luminate OS. URL: the URL above. Authentication: **No sign-in**. Leave the OAuth client choice alone.
- **ChatGPT:** add a custom connector (MCP) with the same URL. Whether a plan accepts a key in the URL, or only OAuth, is controlled by OpenAI.
- Check: Settings > System status lists `MCP_API_KEY` as present. Ask the assistant "what needs my attention today?".
