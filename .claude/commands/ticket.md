---
description: Draft and file a PMS ticket for the work done this session (confirm before posting)
---

You are filing a ticket in the PMS ticketing system for work completed in this conversation.

Follow these steps exactly:

1. **Draft the ticket** from what was actually accomplished this session (not what was planned). If the user passed text after the command ($ARGUMENTS), let it steer the scope/framing.
   - **Title**: imperative and specific, ≤200 chars. Match the repo's commit style (e.g. `feat:` / `fix:` / `style:` prefixes seen in git log). One line.
   - **Description**: a concise summary in markdown — what changed and why, key files touched, and any follow-ups or caveats. ≤5000 chars. Do not pad it.

2. **Confirm with the user.** Show the drafted Title and Description and ask them to approve or edit. Do NOT post yet. (This is the agreed "auto, then confirm" flow.)

3. **On approval, post it.** Write the description to a temp file in the scratchpad dir, then run from the project root:

   ```
   node --env-file=.env scripts/pms-ticket.mjs --title "<title>" --desc-file "<scratchpad>/ticket-body.md"
   ```

   - The script defaults the column to **Done** and the assignee to **Jose** (from `.env`). Override only if the user asks: `--column "Review/QA"` or `--priority HIGH`.
   - Pass the description via `--desc-file` (not inline) so markdown/newlines/quotes survive shell parsing.

4. **Report the result.** Relay the script's success line (ticket id + URL). If it fails with a 401, tell the user the API token expired and they need to regenerate it in PMS (Settings → API tokens) and update `PMS_API_TOKEN` in `.env`.

Notes:
- Targets and auth live in `.env` (`PMS_*`). Never hardcode the token or echo it.
- Keep one ticket per logical unit of work. If the session covered several unrelated things, ask whether to file one combined ticket or several.
