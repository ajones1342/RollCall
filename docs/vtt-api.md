# VTT Bridge API

RollCall exposes a small webhook endpoint so VTT modules (Fantasy Grounds Lua extensions, Foundry VTT modules, Roll20 API scripts, etc.) can push live game state into a stream's overlay without the GM mirroring it manually.

This doc is for **module developers**. Streamers don't need to read it — they just paste the URL and token from their campaign manage page into whatever VTT module they install.

## Endpoint

```
POST https://<your-rollcall-domain>/api/vtt/state
```

For the public hosted instance: `https://rollcall.dungeonfevr.com/api/vtt/state`.

The endpoint runs as a Vercel Edge Function — globally distributed, low latency.

## Authentication

Every request must include a Bearer token in the `Authorization` header:

```
Authorization: Bearer <campaign-token>
```

The token is per-campaign. Each RollCall campaign gets a unique token in the `campaign_tokens` table; the GM views and rotates it on the campaign manage page (`/gm/<campaign-id>` → **VTT Bridge** section).

**Tokens are secrets.** Never embed in client-side code or commit to public repos. Store securely in your VTT module's settings.

## Payload

JSON body. Top-level keys:

| Key | Type | Required | Description |
|---|---|---|---|
| `combat` | `CombatState` or `null` | optional | Replaces `campaigns.settings.combat`. Pass `null` to clear (end combat). |
| `lastRoll` | `DiceRoll` | optional | Replaces `campaigns.settings.lastRoll` — overlay shows a brief toast when this changes. |

At least one of these must be present, otherwise the endpoint returns `400`.

Unknown keys are ignored — your module can include extra fields without rejection. Fields that aren't in the whitelist are silently dropped.

### `CombatState` shape

```json
{
  "active": true,
  "round": 3,
  "activeIndex": 2,
  "combatants": [
    { "id": "uuid-1", "characterId": "rc-char-uuid", "name": "Aragorn", "initiative": 18 },
    { "id": "uuid-2", "characterId": null, "name": "Goblin Boss", "initiative": 14 },
    { "id": "uuid-3", "characterId": null, "name": "Goblin", "initiative": 12 }
  ]
}
```

- `active` — `true` while combat is running. `false` or send `combat: null` to end it.
- `round` — round counter, increments when activeIndex wraps from last to first.
- `activeIndex` — zero-based index into `combatants[]` of whose turn it is.
- `combatants[]` — sorted list. RollCall expects them in initiative order (descending) but doesn't sort — your module should.
  - `id` — a unique identifier for this combatant within the encounter. Stable across updates so animations work.
  - `characterId` — RollCall character UUID for PCs. `null` for NPCs / monsters. The overlay highlights the active card only when the active combatant has a `characterId` matching a known character.
  - `name` — display name.
  - `initiative` — initiative roll.

To map your VTT's character names to RollCall character UUIDs, the GM will need to either configure a name-to-UUID mapping in your module's settings, or your module reads the RollCall characters via the read API (TBD). For v1, leaving `characterId: null` for everyone is valid — combatants will still show in the GM panel with the active turn indicator, just not on individual character overlays.

### `DiceRoll` shape

```json
{
  "expression": "1d20+5",
  "total": 18,
  "detail": "[13] + 5 = 18",
  "rolledAt": "2026-05-02T18:32:11.123Z",
  "label": "Aragorn's Athletics"
}
```

- `expression` — the dice expression as a string. Display only.
- `total` — final result, prominently displayed in the toast.
- `detail` — optional breakdown, e.g. `[13] + 5 = 18` or `[3, 4, 6] + 2 = 15`. Display only.
- `rolledAt` — ISO 8601 timestamp. The overlay uses this to detect a fresh roll vs. a stored one — incrementing this triggers a new toast. Use the current time when the roll happens.
- `label` — optional context, e.g. character name + skill.

## Idempotency

The endpoint replaces the matching slot in `settings`, so POSTing the same `combat` or `lastRoll` payload twice is safe — the second call is a no-op (or close to it; realtime might fire spuriously, which the overlay tolerates).

For `lastRoll` specifically, if `rolledAt` doesn't change between two POSTs, the overlay won't re-show the toast. Use a fresh timestamp for each new roll.

## Response

```json
{ "ok": true, "applied": ["combat", "lastRoll"] }
```

`applied` lists which whitelist keys were accepted from the payload.

Error shape:

```json
{ "error": "Invalid token" }
```

Status codes:
- `200` — applied
- `400` — bad payload
- `401` — missing or invalid token
- `404` — campaign not found (token valid but campaign deleted)
- `405` — non-POST method
- `500` — server error

## Example (curl)

```sh
curl -X POST https://rollcall.dungeonfevr.com/api/vtt/state \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "lastRoll": {
      "expression": "1d20+5",
      "total": 18,
      "detail": "[13] + 5 = 18",
      "rolledAt": "2026-05-02T18:32:11.123Z",
      "label": "Athletics"
    }
  }'
```

## Server setup notes

The endpoint requires two environment variables in the Vercel project:

| Variable | Where it comes from |
|---|---|
| `SUPABASE_URL` | Same as the existing `VITE_SUPABASE_URL` (project URL) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → **service_role** key |

The service-role key is **server-side only** — never include it in any client-bundled code. It bypasses RLS, which is why the endpoint enforces auth via the per-campaign Bearer token.

## Open items

These are planned but not in v1:

- A complementary `GET /api/vtt/state/<campaignId>` to read current state (useful for VTT modules that want to reconcile on connect).
- A character-mapping helper: a `POST /api/vtt/characters` returning the campaign's character list with their UUIDs and Twitch handles so VTT modules can build a name → UUID map automatically.
- Per-character HP / condition push (currently you can only update `combat` and `lastRoll`; HP changes still flow through the GM page).
