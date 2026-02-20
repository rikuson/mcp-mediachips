# mcp-mediachips

MCP server for [MediaChips](https://github.com/fupdec/mediachips) database. Provides CRUD tools to manage media, tags, playlists, marks, and settings via the Model Context Protocol.

## Setup

```bash
npm install
```

## Configuration

Add to your MCP client config (e.g. Claude Desktop):

```json
{
  "mcpServers": {
    "mediachips": {
      "command": "node",
      "args": ["/path/to/mcp-mediachips/index.js"],
      "env": {
        "MEDIACHIPS_DB_PATH": "/path/to/mediachips/db.sqlite"
      }
    }
  }
}
```

If `MEDIACHIPS_DB_PATH` is not set, it defaults to `db.sqlite` in the project directory.

## Tools

| Tool | Description |
|------|-------------|
| `list_media` | List media with pagination, sorting, and filters |
| `get_media` | Get media by ID with tags, video metadata, marks |
| `create_media` | Create a new media item |
| `update_media` | Update media (name, rating, favorite, bookmark) |
| `delete_media` | Delete a media item |
| `list_tags` | List tags with pagination and filters |
| `get_tag` | Get tag by ID with media, child/parent tags, values |
| `create_tag` | Create a new tag |
| `update_tag` | Update a tag |
| `delete_tag` | Delete a tag |
| `add_tag_to_media` | Associate a tag with media |
| `remove_tag_from_media` | Remove a tag from media |
| `list_playlists` | List all playlists |
| `get_playlist` | Get playlist with its media items |
| `create_playlist` | Create a new playlist |
| `update_playlist` | Update a playlist |
| `delete_playlist` | Delete a playlist |
| `add_media_to_playlist` | Add media to a playlist |
| `remove_media_from_playlist` | Remove media from a playlist |
| `list_marks` | List marks for a media item |
| `create_mark` | Create a timestamp mark on media |
| `update_mark` | Update a mark |
| `delete_mark` | Delete a mark |
| `list_meta` | List meta categories |
| `list_media_types` | List media types with counts |
| `get_settings` | Get application settings |
| `update_setting` | Update a setting |
| `set_value_for_media` | Set custom meta value on media |
| `set_value_for_tag` | Set custom meta value on tag |
| `get_stats` | Get database statistics |
| `search` | Search across media and tags |
| `execute_query` | Execute raw SELECT queries |
