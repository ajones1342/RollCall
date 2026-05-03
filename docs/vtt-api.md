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
| `characters` | `{ [rollcallUuid]: PartialCharacter }` | optional | Per-character partial updates (HP, conditions, death saves, inspiration). See **Per-character updates** below. |

At least one of these must be present, otherwise the endpoint returns `400`.

Unknown keys are ignored — your module can include extra fields without rejection. Fields that aren't in the whitelist are silently dropped.

### Per-character updates

The `characters` field maps RollCall character UUIDs to partial updates. Only these fields are accepted; everything else is silently ignored:

| Field | Type | Notes |
|---|---|---|
| `current_hp` | int ≥ 0 | Floored. |
| `max_hp` | int ≥ 0 | Floored. |
| `temp_hp` | int ≥ 0 | Floored. |
| `conditions` | `string[]` | Replaces the current list. Non-string entries dropped. |
| `death_save_successes` | int 0–3 | Clamped. |
| `death_save_failures` | int 0–3 | Clamped. |
| `inspiration` | bool | |

Every UUID is validated to belong to the authenticated campaign before update — passing an unknown UUID, or one from another campaign, is silently dropped (returned in the response so you can see what was applied). Player-owned fields (name, race, class, attributes, hidden_fields, notes) are deliberately not included; those should stay player-driven.

The response includes `characters_updated: string[]` listing the UUIDs that actually got applied.

Example:

```json
{
  "characters": {
    "uuid-aragorn": { "current_hp": 18, "temp_hp": 5, "conditions": ["Poisoned"] },
    "uuid-frodo":   { "current_hp": 22, "inspiration": true }
  }
}
```

### Combat updates with character mapping

For combat state, `combatants[].characterId` should be a RollCall UUID for PCs and `null` for NPCs. The overlay only highlights the active card if the active combatant's `characterId` matches a known character — so VTT modules need to map their own combatant identifiers to RollCall UUIDs before sending. See [`GET /api/vtt/characters`](#get-apivttcharacters) for the mapping helper.

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

## `GET /api/vtt/characters`

Returns the campaign's character list so a VTT module can build a name-to-UUID mapping dialog. Same Bearer token auth as `/api/vtt/state`.

```sh
curl https://rollcall.dungeonfevr.com/api/vtt/characters \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

Response:

```json
{
  "characters": [
    {
      "id": "uuid-aragorn",
      "name": "Aragorn",
      "race": "Half-Elf",
      "class": "Ranger 5",
      "twitch_display_name": "ravendarq",
      "display_order": 0
    },
    {
      "id": "uuid-frodo",
      "name": "Frodo",
      "race": "Halfling",
      "class": "Rogue 4",
      "twitch_display_name": "halfling42",
      "display_order": 1
    }
  ]
}
```

Sorted by `display_order` (matches the GM's reordering on the campaign page).

Recommended VTT module flow:
1. On extension start (or when the GM opens the mapping dialog), fetch this endpoint.
2. For each PC in your VTT's combat tracker / party list, present a dropdown of these RollCall characters. Pre-select via case-insensitive name match if possible.
3. Save the GM's confirmed mapping (FG sheet path → RollCall UUID) inside your extension's local settings.
4. At runtime, when the VTT fires a change event on a character, look up the mapping, build a `characters: { [uuid]: partial }` payload, and POST to `/api/vtt/state`.

## Open items

Planned but not in v1:

- `GET /api/vtt/state/<campaignId>` to read current state (useful for VTT modules that want to reconcile on connect).
- EventSub-style push from RollCall to the VTT (currently traffic is one-way — VTT pushes, RollCall reflects).
