# Private GDT loopback bridge contract

This interface is served by the authenticated AMZ Hub profile on this PC.
The retired central Discord bot GDT endpoints remain retired.

Every request is JSON over `http://127.0.0.1:<ephemeral-port>` and carries a
launch-scoped Hub-managed bearer credential. Hub alone owns the external WSS
connection and AP slot credential. The mod uses Node HTTP, compatible with the
game's node-webkit 0.8.6 runtime. Credentials never appear in URLs or logs.
`serverId` and `clientId` are opaque identifiers, not authentication.

Hub writes `mods/DMSArchipelago/dms-ap-config.json` inside the isolated local
game staging. Fields are `bridgeBaseUrl`, `serverId`, `clientId`, `sessionToken`,
`gameVersion: "1.7.9"`, and `steamBuild: "20332874"`. Optional `smokeProfile`
(`smoke-a` or `smoke-b`) enables AP mode for new games in that QA profile.

## Session and delivery

`POST /api/archipelago/gdt/client/sync` accepts the client envelope and returns:

```json
{
  "ok": true,
  "slotData": { "contract": {} },
  "connection": { "seed_name": "...", "team": 0, "slot": 1 },
  "items": [{ "index": 0, "name": "Unlock Topic" }]
}
```

The server-provided slot contract is authoritative. Its canonical JSON SHA-256,
seed, team, slot, manifest hash, game build, 66 topic IDs, at least 40 research
IDs, four starting topics, and 19 non-empty packs of each type must validate
before a fresh save binds. Existing saves may reconnect only to the identical
binding and contract.

`POST /api/archipelago/gdt/client/poll` accepts `nextItemIndex` and returns the
same response shape. Items are the retained Archipelago `ReceivedItems` history,
indexed contiguously from zero. The bridge must be able to replay history from
any requested index; an acknowledgment must never delete the sole copy.

The mod resolves a contiguous item, applies its effect idempotently, advances
the save journal, and only then calls
`POST /api/archipelago/gdt/client/items/ack` with `throughIndex` and
`contractHash`. Acknowledgments are advisory delivery telemetry, not permission
to discard Archipelago history.

## Location and goal reporting

`POST /api/archipelago/gdt/client/progress` carries the complete monotonic
`checkedLocationIds` set, diagnostic metrics, `contractHash`, and either a null
`clientStatus` or numeric Archipelago `CLIENT_GOAL` (`30`). The bridge must send
checks idempotently and return `clientGoalAccepted: true` only after the AP
server accepts the goal status.

The mod emits `CLIENT_GOAL` only when all six final milestones are true:
30 games, 10,000,000 fans, $100,000,000 cash, 40 canonical completed research
entries, 50 canonical unlocked topics, and 7 staff entries.

## Failure behavior

Unknown items, index gaps, identity/contract changes, missing canonical objects,
unverified builds, unavailable native cash/fan APIs, and invalid hashes pause
the AP session without advancing the journal. Research packs authorize exact
canonical objects but do not complete them; the native `canResearch` rule still
controls era, prerequisites, point spending, duration, and completion.
