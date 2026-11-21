# Main/Vault Failover, Mirroring, and Config Sync

This guide describes how NorthGate OS selects its Main or Vault environment,
mirrors the server layout, protects against unsafe syncs, and moves config
updates between the bot host and the private Git remote.

## System overview

- **Main** is the primary Discord server.
- **Vault** is the backup server with its own roles, channels, and IDs.
- The bot loads one of two files at runtime: `main-config.json` or
  `vault-config.json`. It does not use `config.json`.
- A successful Main-to-Vault mirror records the source-to-Vault ID mappings
  in `vault-config.json`.
- Git-sync pushes config changes to the private remote and pulls remote config
  changes onto the bot host. Your computer receives pushed changes when its
  local checkout pulls from that remote.
- `.env` and `.env.*` files are excluded from Git staging and are never
  intentionally pushed or pulled by Git-sync.

## Files and responsibilities

| File | Purpose |
| --- | --- |
| `main-config.json` | Main server's operational settings and IDs. Production failover can blank its values. |
| `vault-config.json` | Vault server's settings and IDs, plus the Main-to-Vault mapping in `serverSync`. |
| `failover-state.json` | Active environment/mode, saved Main/Vault guild IDs, and Main backup destination. Kept local to the bot host. |
| `server-sync-state.json` | Scheduler state, including the last successful mirror time. |
| `.env` / `.env.*` | Runtime credentials such as the Discord token. Kept out of Git. |

Both config files use the same general shape. `guildId` identifies the server
for that file; `mainGuildId` and `vaultGuildId` identify the two servers.
`systemIds` contains fixed bot-specific IDs. `serverSync` in the Vault config
stores `lastSynchronizedAt`, `mainToVaultRoleIds`, and
`mainToVaultChannelIds`.

On startup, Main is the default environment unless `failover-state.json`
selects another one. `main-config.json` must exist. If the Vault file is
missing, the config manager creates it from Main as a template, unless Main
has already been blanked for production failover.

Guild ID lookup uses this precedence: environment variables, saved IDs in
`failover-state.json`, then IDs in the config files. After IDs have been saved
to failover state, changing `mainGuildId` or `vaultGuildId` in a config file
alone will not override them; update `MAIN_GUILD_ID` / `VAULT_GUILD_ID` on the
host when changing the actual server IDs.

Group commands such as `d!addgroup` and `d!delgroup` write to whichever
environment is active; they do not hardcode the Main file.

## Environment switching

These are developer-only commands, using the active config's `developers`
list. `d!launch` and `d!land` show a confirmation prompt with a description
of the selected action; canceling or letting the prompt expire makes no
environment changes. A successful switch updates the selected guild's slash
commands and restarts the bot under PM2 when PM2 is detected.

| Command | Behavior |
| --- | --- |
| `d!launch test` | Selects Vault in test mode. Leaves `main-config.json` untouched. |
| `d!launch` | Selects Vault production mode and blanks values in `main-config.json`, preserving its structure. |
| `d!land` | Selects Main. It does **not** restore values previously blanked by `d!launch`; restore Main settings before relying on Main. |
| `d!forcesync` | Starts a manual Main-to-Vault mirror. Must be run by a developer in the Vault server. The circuit breaker still applies. |

The Main and Vault guild IDs are saved in `failover-state.json` before the
Main config is blanked, so the bot can still identify both servers. They can
also be supplied through `MAIN_GUILD_ID` and `VAULT_GUILD_ID`.

While either Vault mode is active, Discord interactions originating in Main
are rejected with an ephemeral security notice. This guard covers Discord
interactions such as slash commands and component actions.

## Main-to-Vault mirror

The mirror runs on startup when no successful mirror is recorded, then
approximately every 24 hours. If a scheduled attempt fails, the next
scheduled attempt is approximately 24 hours later. A developer can request
an immediate attempt with `d!forcesync`.

The sync:

1. Fetches roles, channels, and expressions from both servers.
2. Checks Main's recent audit-log activity and validates prerequisites.
3. Creates or updates matching Vault roles and supported channels.
4. Removes extra unmanaged roles and Vault-only channels when appropriate.
5. Rewrites configured Main role/channel IDs to their Vault counterparts and
   saves the complete maps to `vault-config.json`.
6. Records the successful sync time.

Roles are matched by name; channel identity includes channel type, parent
category name, and channel name. The mirror preserves role order below the
bot's highest role. If Discord rejects a bulk role-position request with a
permission error, it retries positions individually and reports the specific
role if that also fails.

Supported channels include categories, text, announcement, voice, Stage,
Forum, and Media channels. Threads and their messages are not mirrored.
Messages, active Stage sessions, and member role assignments are also not
copied. Stage channels require the Vault server to have the Community feature
enabled.

ID maps are written only after both role and channel syncing finish. A failed
run can therefore leave some resources created or updated on Vault without
changing the saved maps or successful-sync timestamp. Retrying is intended to
match existing resources and continue.

## Nightly Main backup

The bot creates a configuration backup of **Main** every night at 00:00 UTC,
regardless of whether Main or Vault is the active environment. It uploads the
backup to Main's `defconBackupChannelId`. That destination is saved in
`failover-state.json` before production launch blanks `main-config.json`; the
Vault sync mapping is also used to recover it if available. If Main's backup
destination cannot be recovered, set `MAIN_BACKUP_CHANNEL_ID` in the bot
host's environment.

The bot must be online and able to access Main at the scheduled time. A failed
backup is logged and sent by DM to the first reachable configured developer,
preferring `SYNC_ALERT_USER_ID` when set. Backups contain server configuration such as roles,
channels, and supported settings; they do not contain messages, members, or
member-role assignments. They remain in the backup channel until manually
deleted.

## Circuit breaker and approval

Before unattended changes, the bot reads Main's audit logs for the preceding
24 hours. The mirror pauses if any threshold is reached:

| Main audit-log activity | Pause threshold |
| --- | ---: |
| Channels created | 10 or more |
| Channels deleted | 5 or more |
| Roles created | 5 or more |
| Roles deleted | 5 or more |

The bot DMs `brooksy246` with **Confirm abort** and **Sync anyway** buttons.
The approval expires after 30 minutes and only the recipient can use it.
**Confirm abort** leaves Vault unchanged; **Sync anyway** proceeds with a
full mirror and bypasses the circuit breaker for that run. Other permission,
unsupported-channel, and feature checks still apply.

If Main's audit logs cannot be checked, the bot also pauses and requests
approval rather than proceeding silently. Sync failures are sent by DM to
`brooksy246`. Set `SYNC_ALERT_USER_ID` in the bot host's environment if the
bot cannot resolve that account by username or server membership.

## Permissions and server requirements

- The bot must be able to view channels in both servers.
- The bot needs **View Audit Log** in Main.
- The bot needs **Manage Channels** and **Manage Roles** in Vault.
- The bot's highest Vault role must be above the roles it will edit.
- The Vault must enable Community if Main has Stage channels.
- Boost-limited voice bitrate and styling settings are reduced to settings
  supported by Vault where the sync code provides a fallback.

Unsupported channel types and unmet prerequisites stop the sync rather than
being treated as a successful mirror.

## Config synchronization to your computer

Git-sync checks the remote every 15 seconds and, with the current
`main-config.json` settings, pushes every 300 seconds (5 minutes). A successful
mirror or group change marks the relevant config file dirty; Git-sync commits
and pushes it when the configured push interval is due. New config commits
from your computer are pulled onto the bot host; incoming config changes
restart the process when `restartOnUpdate` is enabled.

To receive a host-side update on your computer, pull the latest commit from
the private remote in VS Code or your Git client. To send changes back, edit
the config locally, commit, and push it to that remote. For example, after
production launch blanks Main on the host and that update reaches your
computer, you can re-enter Main IDs/settings locally and push them back.

The `.gitignore` rules and Git-sync staging/push checks exclude `.env` and
`.env.*`. Config conflicts during a rebase are not auto-resolved: the rebase
is aborted so neither side is silently selected. Resolve the conflict
manually, then sync again. Keep the remote private because the config files
contain server and role IDs.

## Checking status and troubleshooting

- **`d!forcesync` says it started:** wait for the same message to be edited
  with its final result. Do not start a second sync while one is running.
- **Vault looks right but the config map is empty:** check the final sync
  result. The maps are saved only after a fully successful mirror.
- **The workspace file did not change:** confirm that the host pushed its
  config commit, then pull the private remote on your computer.
- **Stage channel error:** make sure Community is enabled on Vault.
- **Role-position error:** check the detailed failure DM for the bot's
  detected highest role, permissions, and any individual role Discord rejects.
- **Config rebase error:** resolve the conflict on the Git branch; Git-sync
  intentionally stops rather than overwriting either config.
- **No initial mirror:** verify both guild IDs, bot access to both servers,
  permissions, and that the Vault has the required Community feature when
  Stage channels are present.

Discord mirror success and Git delivery are separate outcomes: `d!forcesync`
reports mirror completion, Git-sync pushes config changes, and your computer
must pull those commits from the private remote.
