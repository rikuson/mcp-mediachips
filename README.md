# MCP Mediachips

MCP Server for performing CRUD operations on Mediachips SQLite database using NodeJS.

## Overview

This MCP (Model Context Protocol) server provides tools to manage media items (videos, images, audio) in a SQLite database. It supports full CRUD (Create, Read, Update, Delete) operations.

## Installation

```bash
npm install
```

## Usage

The server can be run directly or configured in your MCP client settings.

### Running the server

```bash
npm run build
node dist/index.js
```

### Environment Variables

- `MEDIACHIPS_DB_PATH`: Path to the SQLite database file (default: `./db.sqlite`)

### MCP Client Configuration

Add this to your MCP client settings (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "mediachips": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-mediachips/dist/index.js"],
      "env": {
        "MEDIACHIPS_DB_PATH": "/path/to/db.sqlite"
      }
    }
  }
}
```

## Available Tools

### 1. create_media_item

Create a new media item in the database.

**Parameters:**
- `title` (required): Title of the media item
- `url` (required): URL or path to the media file
- `type` (required): Type of media - one of: `video`, `image`, `audio`
- `description` (optional): Description of the media item
- `tags` (optional): Comma-separated tags

**Example:**
```json
{
  "title": "My Video",
  "url": "https://example.com/video.mp4",
  "type": "video",
  "description": "An example video",
  "tags": "tutorial,demo"
}
```

### 2. read_media_items

Read media items from the database with optional filters.

**Parameters:**
- `id` (optional): Specific media item ID to retrieve
- `type` (optional): Filter by media type (`video`, `image`, or `audio`)
- `limit` (optional): Maximum number of items to return (default: 100)
- `offset` (optional): Number of items to skip (default: 0)

**Example:**
```json
{
  "type": "video",
  "limit": 10
}
```

### 3. update_media_item

Update an existing media item.

**Parameters:**
- `id` (required): ID of the media item to update
- `title` (optional): New title
- `description` (optional): New description
- `url` (optional): New URL
- `type` (optional): New media type
- `tags` (optional): New tags

**Example:**
```json
{
  "id": 1,
  "title": "Updated Title",
  "description": "Updated description"
}
```

### 4. delete_media_item

Delete a media item from the database.

**Parameters:**
- `id` (required): ID of the media item to delete

**Example:**
```json
{
  "id": 1
}
```

## Database Schema

The server creates a `media_items` table with the following structure:

```sql
CREATE TABLE media_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('video', 'image', 'audio')),
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## Development

### Build

```bash
npm run build
```

### Watch mode

```bash
npm run watch
```

## License

MIT