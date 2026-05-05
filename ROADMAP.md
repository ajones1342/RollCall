# RollCall Roadmap

Tiers ordered by when they'd matter. Within a tier, items are roughly equal-priority.

## Already shipped (v0.1)

- GM auth + campaign creation
- Player auth (Twitch) + auto-create character on join
- Real-time character editing with Postgres realtime
- Per-character 1920x1080 OBS overlay (Cinzel font, transparent background)
- Multi-tenant data model (multiple campaigns per GM)
- Vercel deployment with SPA routing

## Tier 1 — Things you'll hit during actual play

If you only do these, RollCall becomes a tool you'd use happily on stream.

| Feature | Why it matters | Effort |
|---|---|---|
| GM-edit any character | DMs always want to bump HP mid-combat without bothering the player. RLS currently only permits self-edit. | Small |
| HP +/- quick buttons | Typing into a number field on a phone in combat is friction. One-tap +1 / -1 / +5 / -5. | Small |
| Auto-save with debounce | Players forget to hit Save. Save 500ms after edit with a visual "saved" indicator. | Small |
| Drag-to-reorder party | `display_order` is already in the schema. GM needs to sort overlay cards to match player video-tile order in OBS. | Small |
| Hide fields from overlay (per-character) | Mute irrelevant fields per scene/character — empty Race, no attributes, hide HP during downtime, etc. Player toggles their own; GM can toggle any (once GM-edit ships, the "or GM" part is free). Simple impl: `hidden_fields text[]` column on characters; edit form has "Show on overlay" checkbox per field; overlay skips anything in the array. | Small |
| Party Information panel for players | Read-only panel on the player edit page showing all party members (name, race/class, HP/temp, inspiration, conditions, attributes). Refreshes via realtime. GM-controlled campaign setting `partyViewRespectsHideToggles` decides whether per-character overlay-hide toggles also hide from teammates (default off — players see everything). | Small |

## Tier 2 — Combat clarity

Your viewers will see the difference.

| Feature | Notes |
|---|---|
| Temp HP | Separate from current HP (5e standard). Display as `12 (+5)` on overlay. |
| Conditions tags | Multi-select chips: poisoned, prone, blessed, etc. Show as small icons or text below name on overlay. |
| Death saves tracker | 3 success dots / 3 failure dots when at 0 HP. Visible on overlay. |
| Inspiration toggle | One-bit field. Star icon on overlay when on. |

## Tier 3 — Visual polish

Make the overlay actually beautiful, not just functional.

| Feature | Notes |
|---|---|
| **Per-campaign overlay theme** ⭐ *prerequisite for Tier 6 sharing* | Configurable: font (Cinzel default + alternatives — IM Fell English, Cormorant for fantasy, sans-serif for modern/sci-fi systems), text/accent colors, shadow strength, edge padding, optional per-field positioning offsets. Saved on the campaign. Without this, anyone using a forked/hosted RollCall is stuck with the D&D-medieval aesthetic. |
| HP change animations | Brief red flash on damage, green on heal. Crowd-pleasing. |
| Character portraits | Twitch avatar already pulled into DB; just need to add to the overlay layout (optional, since frame art often handles this). |

## Tier 4 — Twitch-native superpowers

The reason Twitch OAuth was the right choice in the first place.

| Feature | Notes |
|---|---|
| Chat commands | `!hp Aragorn` posts current HP in chat. Twitch IRC bot or PubSub. |
| Stream alerts | When a character drops below 25% HP, post to chat or trigger an OBS scene change. |
| Sub-only character flair | Subscribers' names get a different color or badge on the overlay. |
| Viewer voting | "What does the bard do next?" — viewers vote, results show on overlay. Bigger feature; needs real Twitch API integration. |

## Tier 5 — DM workflow extras

Bigger lifts but high payoff.

| Feature | Notes |
|---|---|
| Initiative tracker | Manual GM panel ships first (PCs + NPC/monster rows, init values, next/prev turn, round counter, active highlight on overlay + party panel). Schema is webhook-friendly so a future VTT-bridge module (Fantasy Grounds, Foundry, Roll20) can populate it via POST. |
| ~~Damage/heal calculator~~ | Shipped as inline HP +/- buttons (−5/−1/+1/+5) on each row of the GM party list. Free-form parser punted. |
| ~~Private GM notes~~ | Shipped — per-character, separate `character_gm_notes` table with strict RLS (only the campaign owner can read or write), shown only in GM-edit mode. |
| ~~Dice roller~~ | Shipped — GM types `NdM±K`, optional label, broadcasts a fading toast to all overlays in the campaign via `campaigns.settings.lastRoll`. |

## Tier 6 — Packaging it for other streamers

Don't start until your own stream is using RollCall solidly.

- Public landing page with sign-up
- "Create campaign" flow for new GMs (basic version already exists; polish needed)
- **Depends on Tier 3 overlay customization** — otherwise new GMs can't tailor look to their system/aesthetic
- Optional self-host docs
- Stripe billing if hosted (or keep it free / donation-supported)

## Tier 7 — Multi-system support

Today the data model bakes in D&D 5e (six named attributes, HP/temp/max, death saves, single Inspiration bit, 14 standard 5e conditions). User has plans for World of Darkness and Call of Cthulhu campaigns and wants to host other streamers' systems eventually.

### Phase 1 — Configurable attributes per campaign

| Change | Notes |
|---|---|
| Schema: add `characters.attributes` JSONB | Backfill from existing named columns; deprecate (but keep) old columns. |
| `campaigns.settings.system` selector | `'5e' \| 'wod' \| 'coc' \| 'custom'`. Built-in templates declare the attribute keys + display labels. |
| Built-in templates | **5e:** STR/DEX/CON/INT/WIS/CHA. **WoD:** Strength/Dexterity/Stamina/Charisma/Manipulation/Composure/Intelligence/Wits/Resolve (9). **CoC:** STR/CON/SIZ/DEX/APP/INT/POW/EDU (+ Luck as a resource). **Custom:** GM defines their own list. |
| PlayerEdit + Overlay + Combat Tracker | Iterate over the campaign's attribute set instead of hardcoded keys. |

### Phase 2 — Secondary resources

| Change | Notes |
|---|---|
| Schema: add `characters.resources` JSONB | Each entry `{ key, label, current, max }`. |
| Per-system defaults | 5e: just HP. WoD: Health + Willpower. CoC: HP + Sanity + Magic Points + Luck. |
| PlayerEdit / Overlay / Tracker | Render configurable resource trackers alongside HP. |

### Phase 3 (optional) — WoD damage tracks

Replace the single-pool HP for WoD with three separate trackers (Bashing / Lethal / Aggravated), each with checkable boxes. Real UX work — only worth doing if the single-pool shortcut feels limiting in actual play.

### Backward compat strategy

Stage the rollout to never break the user's running 5e game:

1. Migration adds JSONB columns + backfills from existing data (no breakage)
2. Code reads from JSONB, writes to both old and new (still works for old data)
3. Deploy, verify 5e campaign still works as before
4. New WoD/CoC campaigns use the templates
5. Drop legacy columns much later

## Next

Knock out **all of Tier 1** in one pass — they're individually small and they compound. After that, decide between combat clarity (Tier 2) or visual polish (Tier 3) based on what surfaces in real test sessions.

Skip Tier 4's deeper Twitch integrations for now — they're a meaningful Twitch API project on top of the current app, and players don't notice their absence.
