# Manual Testing Guide

This guide helps you manually test the MCP server functionality.

## Prerequisites

```bash
npm install
npm run build
```

## Test 1: Server Startup

```bash
# Should start without errors and create database if it doesn't exist
MEDIACHIPS_DB_PATH=./test-manual.sqlite node dist/index.js
# Press Ctrl+C to stop
```

Expected: Server starts with message "MCP Mediachips server running on stdio"

## Test 2: Database Creation

```bash
# Check if database was created
ls -la test-manual.sqlite

# Check schema
sqlite3 test-manual.sqlite ".schema"
```

Expected: Database file exists with correct schema

## Test 3: Direct Database Operations

```bash
# Create a test item
sqlite3 test-manual.sqlite "INSERT INTO media_items (title, url, type, description, tags) VALUES ('Test Video', 'https://example.com/test.mp4', 'video', 'Test description', 'test,demo');"

# Read items
sqlite3 test-manual.sqlite "SELECT * FROM media_items;"

# Update item
sqlite3 test-manual.sqlite "UPDATE media_items SET title = 'Updated Video' WHERE id = 1;"

# Verify update
sqlite3 test-manual.sqlite "SELECT * FROM media_items WHERE id = 1;"

# Delete item
sqlite3 test-manual.sqlite "DELETE FROM media_items WHERE id = 1;"

# Verify deletion
sqlite3 test-manual.sqlite "SELECT * FROM media_items;"
```

## Test 4: Type Constraints

```bash
# Try to insert invalid type (should fail)
sqlite3 test-manual.sqlite "INSERT INTO media_items (title, url, type) VALUES ('Test', 'url', 'invalid');" || echo "Correctly rejected invalid type"

# Try valid types
sqlite3 test-manual.sqlite "INSERT INTO media_items (title, url, type) VALUES ('Video Test', 'url', 'video');"
sqlite3 test-manual.sqlite "INSERT INTO media_items (title, url, type) VALUES ('Image Test', 'url', 'image');"
sqlite3 test-manual.sqlite "INSERT INTO media_items (title, url, type) VALUES ('Audio Test', 'url', 'audio');"

# Verify
sqlite3 test-manual.sqlite "SELECT id, title, type FROM media_items;"
```

## Test 5: Indexes

```bash
# Check indexes exist
sqlite3 test-manual.sqlite "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='media_items';"
```

Expected: Should show idx_media_type and idx_media_created

## Cleanup

```bash
rm -f test-manual.sqlite test-manual.sqlite-shm test-manual.sqlite-wal
```

## Integration Testing with MCP Client

To test with an actual MCP client (like Claude Desktop):

1. Add to your Claude Desktop config:
```json
{
  "mcpServers": {
    "mediachips": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-mediachips/dist/index.js"],
      "env": {
        "MEDIACHIPS_DB_PATH": "/absolute/path/to/db.sqlite"
      }
    }
  }
}
```

2. Restart Claude Desktop

3. Try commands like:
   - "Create a video media item called 'Tutorial' with URL https://example.com/video.mp4"
   - "List all media items"
   - "Update media item 1 to have title 'New Title'"
   - "Delete media item 1"
