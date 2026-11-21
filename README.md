# NorthGate OS

NorthGate OS is Northgate Studios' Discord operations bot. It manages private
support and staff-request tickets, gives staff tools to track and resolve them,
and provides server-management and emergency-lock controls.

## Ticket system

Members can open private tickets from the panels posted by staff:

| Ticket type | What it is for |
| --- | --- |
| General support | A question or issue submitted with a title and description. |
| Appeal | An appeal submitted with its reason and details. |
| Hiring | An application with the applicant's chosen name, Roblox ID, desired role, experience, and reason for applying. |
| Partnership | A proposal with the company or brand, idea, goals, and additional details. |
| Interrogation | A private conversation opened by Operations staff or an administrator with a selected member. |

Tickets are private to the opener, the relevant configured staff roles, and the
bot. The bot assigns each open ticket a number from a shared pool of 20 slots.
When all slots are occupied, new tickets must wait for one to close.

Staff can claim tickets, update or transfer a claim, add or remove a member's
ticket access, and close tickets. Closing saves a text transcript to the
configured archive channel, removes the ticket from tracking, frees its number,
and queues the channel for deletion. Staff can also schedule a ticket to close
later or cancel that schedule.

Each ticket is represented in a staff tracking channel with its status and
progress notes. The tracker can be updated with staff notes and is reconciled
with active ticket channels periodically.

### Ticket commands

- `/ticketpanel`, `/hiringpanel`, and `/partnerpanel` post the corresponding
  ticket panels.
- `/claim <id>`, `/unclaim <id>`, and `/transfer <id> <user>` manage a ticket's
  staff claim.
- `/add <id> <user>` and `/remove <id> <user>` grant or remove ticket access.
- `/close <id>` closes a ticket.
- `/autoclose <id> <duration>` schedules a close (up to 30 days).
- `/autocloseabort <id>` cancels a scheduled close.
- `/interrogate <user>` opens an interrogation ticket.

## Other member and staff workflows

- **Feature requests:** `/frequest` lets staff submit a request for a Northgate
  bot, describe the feature, and give a desired timeframe. A reviewer can
  decline it, put it on hold, take it on, or forward it. The assigned person
  records whether it was completed or could not be done, and the requester is
  notified of the outcome.
- **IT support:** `/itsupport` sends the IT team a problem report, including an
  optional image or log attachment. Developers can mark a report complete or
  dismiss it.
- **Management voice access:** `/requestmanagementvc` sends an access request
  to the management voice channel. An authorized manager already in that
  channel can accept the request. `/managementvclock` restricts or restores
  voice access, and the bot disconnects members without permitted access while
  the channel is locked.
  add role IDs with `d!addgroup techdir <role ID>`.
- **Notification roles:** `/reactionpanel` posts opt-in roles for announcements,
  events, giveaways, game nights, questions of the day, development, and
  important notices. Reacting adds or removes the matching role.
- **Welcome messages:** New members receive a welcome message pointing them to
  the rules and support-ticket channels.
- **Developer availability:** `/available` updates the bot's presence to show
  whether developers are available.
- **Server information:** `n!links`, `n!rules`, and `n!ticketrules` post the
  configured links, server rules, and ticket regulations.

## Administration and emergency controls

- `/adminpanel` posts a live status panel with bot uptime, ticket-slot usage,
  lock states, configured access-role counts, and items needing attention.
  Active DEFCON status is highlighted at the top, and the panel refreshes
  automatically.
- `/cmdlock` and `/cmdunlock` set or clear the global command-lock state.
- `a!forcelock` and `a!forceunlock` apply or reverse an emergency lockdown.
  The force lock updates configured channel and voice-channel permissions and
  disables ticket-creation buttons; the unlock restores the saved permissions.
  Activating it requires confirmation.
- `d!defcon <1-6>` adds the emergency developer IDs and applies the selected
  command-access policy. Levels 1 and 3 allow commands to developers only;
  levels 2 and 5 allow commands to the configured staff role only; levels 4
  and 6 leave normal command permissions in place. Levels 1, 2, and 4 apply
  the force lock; switching to a level without a force lock removes an active
  force lock. Developers and members with a configured ownership role can
  activate DEFCON; ownership must acknowledge the emergency-use warning before
  activation. Developers and members with a configured ownership role can run
  `d!secure` at any level, without that warning.
  `d!defcon status` shows the active level,
  command access, force-lock state, activation time, and any recorded issue.
  DEFCON 1 requires one strong warning confirmation, then uploads a
  server-configuration backup to the channel configured by
  `defconBackupChannelId` before applying the level. The storage channel may
  be in a separate preservation server, where the bot needs View Channel, Read
  Message History, Send Messages, and Attach Files. This confirmation also
  acknowledges the force-lock warning.
  `/defconguide` posts the level guide.
- `/backupcreate` creates a numbered backup in the configured storage channel.
  `/backupload` uses the newest available stored backup by default and falls
  back to older IDs when a backup cannot be loaded; it also accepts a backup ID
  or a JSON attachment. Restore updates matching roles and channels, recreates
  missing resources, leaves extras untouched, and restores supported server
  settings and channel overwrites. Messages, member lists, and member-role
  assignments are not included. Developers can delete backups with the button
  on each backup embed or `d!delbackup <backup ID>`.
  If at least 75% of the backup's combined roles and channels already match
  the server, restore aborts unless a developer explicitly overrides the
  safeguard. Only developers or configured ownership can use it, and an
  active force lock must be ended first.
- `d!power off`, `d!power on`, and `d!power status` manage or report maintenance
  mode. Maintenance mode makes the bot appear offline and restricts normal
  command use to developers.

The global command lock and force lock are separate controls. A command-rate
guard can also enable the global lock after five uses of one slash command in a
minute or ten different slash commands in two minutes.

## Command reference

### Prefix commands

| Command | What it does |
| --- | --- |
| `!help` | DMs a command guide for NorthGate OS and its companion bots. |
| `n!ping` | Shows response latency. |
| `n!purge <1-100>` | Deletes recent messages. |
| `n!inject <ticket id> <info>` | Adds a progress note to the ticket tracker. |
| `n!sub <ticket id> <note id> <message>` | Replaces a tracker note; leave the message blank to delete it. |
| `n!links`, `n!rules`, `n!ticketrules` | Posts the corresponding server information. |
| `d!forceclaim <ticket id>` | Developer override to claim a ticket. |
| `d!addgroup`, `d!delgroup`, `d!showgroup` | Manage or view configured staff and access groups. |
| `d!launch [test]`, `d!land` | Switch between Main and Vault; test launch leaves Main config unchanged. |
| `d!defcon <1-6|status>`, `d!secure` | Start, inspect, or end the tracked DEFCON procedure. |
| `d!forceclose` | Developer override to close a ticket and save its transcript. |
| `d!impersonate <user> <command>` | Checks whether a member would be allowed to use a command; it does not run it. `d!impersonate list` shows known commands. |
| `d!power <action>` | Use `off`, `on`, or `status` to manage maintenance mode. |
| `d!forcerestart core` | Restarts NorthGate OS. |
| `!msg <channel id> <message>` | Sends a developer message to a channel from DMs. |
| `a!forcelock`, `a!forceunlock` | Apply or reverse the force lock. |

### Slash commands

`/defconguide` posts the DEFCON level guide. `/backupload` accepts a
NorthGate server backup JSON attachment and requires an explicit confirmation.
The bot also registers slash commands for ticket panels and actions, feature
requests, IT reports, management voice access, developer availability, the
admin panel, and global command locking. Their exact options appear in
Discord's command picker.
Access depends on the command and the configured staff roles or Discord
permissions, as well as any active DEFCON restriction.

## Background operations

NorthGate OS restores scheduled ticket closures after a restart, keeps ticket
and lock state, refreshes the admin panel, and periodically checks that active
tickets are represented in the tracker. The running service also publishes a
heartbeat for monitoring and checks its configured Git remote for updates.

### Main and Vault environments

The bot uses two tracked environment configs: `main-config.json` contains the
Main server settings, and `vault-config.json` contains the Vault settings.
`main-config.json` is required at startup; if `vault-config.json` is missing,
the bot creates it from Main as a starting template. Set `mainGuildId` and
`vaultGuildId` in `main-config.json` (or `MAIN_GUILD_ID` and `VAULT_GUILD_ID`)
to the two distinct server IDs. Until the first successful mirror, the copied
Vault config still contains Main's channel and role IDs. The mirror replaces
those with the built Vault IDs and records the mapping under `serverSync`.
Fixed bot-specific IDs and Discord media URLs live under `systemIds` in each
config. Runtime ticket/message IDs remain in the state and tracking files.

Developers can use `d!launch test` to activate Vault without changing Main,
`d!launch` to activate Vault production and blank the values in
`main-config.json` while preserving its keys, or `d!land` to return to Main.
The active environment and both server IDs persist in `failover-state.json`,
so a production launch can safely blank Main without losing the guild IDs.
Slash commands are registered for the selected guild when switching
environments. While Vault is active, interactions from Main receive the
security notice and are not processed. Config files are tracked as requested;
runtime group edits and successful Vault syncs modify the worktree. Git-sync
temporarily stashes those two files while it updates code and restores them
afterward, so runtime config edits are not automatically committed or pushed.
Git-sync also refuses to auto-push commits that change either config file.
Local config values take precedence over incoming edits to those same files;
reconcile config changes manually when needed. After `d!launch` or `d!land`
successfully switches environments, the bot replies and exits so PM2 can
restart it with only the selected config loaded.

The bot starts with an immediate Main-to-Vault role/channel mirror, then
repeats every 24 hours after a successful sync. It mirrors supported channel
and role settings and removes Vault-only channels and unmanaged roles; it does
not copy messages or member-role assignments. Main audit-log activity of 10 or more
channel creations, 5 or more channel deletions, or 5 or more role creations or
deletions in the previous 24 hours pauses the mirror and DMs `brooksy246` with
**Confirm abort** and **Sync anyway** buttons. The bot needs View Channels on
both servers, View Audit Log on Main, and Manage Channels and Manage Roles on
Vault. Manage Expressions on both servers is needed to map custom emoji
references. Set `SYNC_ALERT_USER_ID` if
the bot cannot resolve `brooksy246` from its cached users or server memberships.
Unsupported channel types or inaccessible audit logs prevent an unattended
sync rather than silently proceeding. After a successful mirror, matching
Main channel/role IDs in `vault-config.json` are replaced with the IDs of their
Vault counterparts; guild IDs and user IDs are left unchanged. The config
also records full source-to-Vault role and channel ID maps under `serverSync`.

## Access and scope

Commands are gated according to their purpose—for example, by configured
developer, support, Operations, staff, management, or ownership roles, or by
Discord permissions such as Administrator or Manage Messages. Not every command
is available to every member. `!help` also lists commands belonging to other
Northgate bots; those companion-bot commands are not implemented by NorthGate
OS itself.
