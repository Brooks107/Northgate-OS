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

- `/adminpanel` posts a live status panel with ticket-slot usage, lock states,
  configured access-role counts, and items needing attention. The panel refreshes
  automatically.
- `/cmdlock` and `/cmdunlock` set or clear the global command-lock state.
- `a!forcelock` and `a!forceunlock` apply or reverse an emergency lockdown.
  The force lock updates configured channel and voice-channel permissions and
  disables ticket-creation buttons; the unlock restores the saved permissions.
  Activating it requires confirmation.
- `d!defcon 1` ensures the emergency developer IDs are in the `dev` group and
  applies the force lock. `d!defcon 2` ensures those IDs are in `dev` without
  applying a new force lock. If a force lock was already active, DEFCON 2
  leaves it in place. `d!secure` ends the active DEFCON, reverses a lock started
  by it, and removes only IDs that the procedure itself added.
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
| `d!defcon 1`, `d!defcon 2`, `d!secure` | Start or end the tracked DEFCON procedure. |
| `d!forceclose` | Developer override to close a ticket and save its transcript. |
| `d!impersonate <user> <command>` | Checks whether a member would be allowed to use a command; it does not run it. `d!impersonate list` shows known commands. |
| `d!power <action>` | Use `off`, `on`, or `status` to manage maintenance mode. |
| `d!forcerestart core` | Restarts NorthGate OS. |
| `!msg <channel id> <message>` | Sends a developer message to a channel from DMs. |
| `a!forcelock`, `a!forceunlock` | Apply or reverse the force lock. |

### Slash commands

The bot also registers slash commands for ticket panels and actions, feature
requests, IT reports, management voice access, developer availability, the
admin panel, and global command locking. Their exact options appear in
Discord's command picker. Access depends on the command and the configured
staff roles or Discord permissions.

## Background operations

NorthGate OS restores scheduled ticket closures after a restart, keeps ticket
and lock state, refreshes the admin panel, and periodically checks that active
tickets are represented in the tracker. The running service also publishes a
heartbeat for monitoring and checks its configured Git remote for updates.

## Access and scope

Commands are gated according to their purpose—for example, by configured
developer, support, Operations, staff, management, or ownership roles, or by
Discord permissions such as Administrator or Manage Messages. Not every command
is available to every member. `!help` also lists commands belonging to other
Northgate bots; those companion-bot commands are not implemented by NorthGate
OS itself.
