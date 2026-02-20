# Example Usage

This document provides examples of how to use the MCP Mediachips server tools.

## Setup

1. Build the project:
```bash
npm run build
```

2. Start the server (from an MCP client like Claude Desktop):
```json
{
  "mcpServers": {
    "mediachips": {
      "command": "node",
      "args": ["/path/to/mcp-mediachips/dist/index.js"],
      "env": {
        "MEDIACHIPS_DB_PATH": "/path/to/db.sqlite"
      }
    }
  }
}
```

## Example Tool Calls

### Creating Media Items

**Create a video:**
```
Use the create_media_item tool with:
- title: "Introduction to TypeScript"
- url: "https://example.com/videos/typescript-intro.mp4"
- type: "video"
- description: "Learn TypeScript basics"
- tags: "tutorial,typescript,programming"
```

**Create an image:**
```
Use the create_media_item tool with:
- title: "Project Screenshot"
- url: "/images/screenshot.png"
- type: "image"
- description: "Main dashboard screenshot"
- tags: "screenshot,dashboard"
```

**Create an audio file:**
```
Use the create_media_item tool with:
- title: "Podcast Episode 1"
- url: "https://example.com/audio/episode1.mp3"
- type: "audio"
- description: "First episode of our podcast"
- tags: "podcast,episode1"
```

### Reading Media Items

**Get all media items:**
```
Use the read_media_items tool with no parameters
```

**Get a specific item by ID:**
```
Use the read_media_items tool with:
- id: 1
```

**Filter by media type:**
```
Use the read_media_items tool with:
- type: "video"
- limit: 10
```

**Pagination:**
```
Use the read_media_items tool with:
- limit: 20
- offset: 40
```

### Updating Media Items

**Update title and description:**
```
Use the update_media_item tool with:
- id: 1
- title: "Updated Title"
- description: "Updated description"
```

**Change media type:**
```
Use the update_media_item tool with:
- id: 2
- type: "image"
```

**Update tags:**
```
Use the update_media_item tool with:
- id: 3
- tags: "new,tags,here"
```

### Deleting Media Items

**Delete by ID:**
```
Use the delete_media_item tool with:
- id: 1
```

## Database Structure

The database stores media items with the following fields:

- **id**: Auto-incrementing primary key
- **title**: Name of the media item (required)
- **description**: Optional description
- **url**: Path or URL to the media file (required)
- **type**: One of: "video", "image", or "audio" (required)
- **tags**: Comma-separated tags (optional)
- **created_at**: Timestamp when created
- **updated_at**: Timestamp when last updated

## Tips

1. **Database Path**: The database will be created automatically if it doesn't exist
2. **Tags**: Use comma-separated values for multiple tags
3. **URLs**: Can be either absolute URLs or relative file paths
4. **Filtering**: Use the type filter to get only videos, images, or audio files
5. **Pagination**: Use limit and offset for handling large datasets
