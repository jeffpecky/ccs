# Account Backup/Import Design

## Overview

Add 9router-style full backup and import to CCS, enabling migration of auth tokens, account metadata, and configuration between instances.

## Scope

Full wipe-and-replace — single JSON export containing everything needed to fully restore or migrate a CCS instance.

## Data Model

### Backup File Format

Single JSON file, downloaded as `ccs-backup-{timestamp}.json`:

```json
{
  "version": 1,
  "exportedAt": "2026-08-07T12:00:00.000Z",
  "auth": {
    "active": [
      { "filename": "codex-user@gmail.com.json", "content": { ... } }
    ],
    "paused": [
      { "filename": "agy-user.json", "content": { ... } }
    ]
  },
  "accounts": { ... },
  "config": { ... }
}
```

- `auth.active` — token files from `~/.ccs/cliproxy/auth/`
- `auth.paused` — token files from `~/.ccs/cliproxy/auth-paused/`
- `accounts` — full content of `~/.ccs/cliproxy/accounts.json`
- `config` — full content of `~/.ccs/config.yaml` (parsed as JSON)

## Backend API Endpoints

### `GET /api/persist/export`

- Reads all auth files from `auth/` and `auth-paused/` directories
- Reads `accounts.json`
- Reads `config.yaml` (parsed to JSON)
- Returns JSON payload with `Content-Disposition: attachment` header
- Requires local access (same as existing backup endpoints)

### `POST /api/persist/import`

- Accepts JSON body with the backup payload
- Validates version field exists
- Creates safety backup of current state before wiping
- Wipes and replaces:
  1. Delete all files in `auth/` and `auth-paused/`
  2. Write imported auth files to correct directories
  3. Overwrite `accounts.json`
  4. Overwrite `config.yaml`
- Returns success/error
- Requires local access

## Frontend UI

Replace existing backup section content with two cards:

### Export Card
- "Download Backup" button
- Triggers browser download of `ccs-backup-{timestamp}.json`
- Shows success toast after download

### Import Card
- "Import Backup" button
- Opens file picker (accepts `.json`)
- Confirmation dialog: "This will replace ALL auth tokens, account data, and config. Continue?"
- Sends JSON to `POST /api/persist/import`
- Shows success/error toast
- Refreshes page after successful import

Existing settings.json backup/restore remains as separate functionality.

## Import Process & Error Handling

### Import Sequence
1. Parse uploaded JSON, validate `version` field
2. Create safety backup at `~/.ccs/backups/pre-import-{timestamp}/`
3. Delete all files in `auth/` and `auth-paused/`
4. Write imported auth files
5. Overwrite `accounts.json`
6. Overwrite `config.yaml`
7. Return success

### Error Handling
- Invalid JSON → 400 "Invalid backup file"
- Missing version field → 400 "Unrecognized backup format"
- File write errors → 500 with details, restore from safety backup
- Safety backup creation fails → abort import, return error

### Safety Backup
If import fails, current state can be manually restored from `~/.ccs/backups/pre-import-{timestamp}/`.
