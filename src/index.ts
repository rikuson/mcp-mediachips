#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import Database from "better-sqlite3";
import { existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = process.env.MEDIACHIPS_DB_PATH || "./db.sqlite";

interface MediaItem {
  id?: number;
  title: string;
  description?: string;
  url: string;
  type: "video" | "image" | "audio";
  tags?: string;
  created_at?: string;
  updated_at?: string;
}

class MediachipsServer {
  private server: Server;
  private db: Database.Database;

  constructor() {
    this.server = new Server(
      {
        name: "mcp-mediachips",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    const dbPath = resolve(DB_PATH);
    const dbExists = existsSync(dbPath);
    
    this.db = new Database(dbPath);
    
    if (!dbExists) {
      this.initializeDatabase();
    }

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private initializeDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS media_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        url TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('video', 'image', 'audio')),
        tags TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
      CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at);
    `);
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on("SIGINT", async () => {
      this.db.close();
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.getTools(),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) =>
      this.handleToolCall(request)
    );
  }

  private getTools(): Tool[] {
    return [
      {
        name: "create_media_item",
        description: "Create a new media item in the database",
        inputSchema: {
          type: "object",
          properties: {
            title: {
              type: "string",
              description: "Title of the media item",
            },
            description: {
              type: "string",
              description: "Description of the media item",
            },
            url: {
              type: "string",
              description: "URL or path to the media file",
            },
            type: {
              type: "string",
              enum: ["video", "image", "audio"],
              description: "Type of media",
            },
            tags: {
              type: "string",
              description: "Comma-separated tags for the media item",
            },
          },
          required: ["title", "url", "type"],
        },
      },
      {
        name: "read_media_items",
        description: "Read media items from the database with optional filters",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "Specific media item ID to retrieve",
            },
            type: {
              type: "string",
              enum: ["video", "image", "audio"],
              description: "Filter by media type",
            },
            limit: {
              type: "number",
              description: "Maximum number of items to return (default: 100)",
            },
            offset: {
              type: "number",
              description: "Number of items to skip (default: 0)",
            },
          },
        },
      },
      {
        name: "update_media_item",
        description: "Update an existing media item",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "ID of the media item to update",
            },
            title: {
              type: "string",
              description: "New title",
            },
            description: {
              type: "string",
              description: "New description",
            },
            url: {
              type: "string",
              description: "New URL",
            },
            type: {
              type: "string",
              enum: ["video", "image", "audio"],
              description: "New media type",
            },
            tags: {
              type: "string",
              description: "New tags (comma-separated)",
            },
          },
          required: ["id"],
        },
      },
      {
        name: "delete_media_item",
        description: "Delete a media item from the database",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "number",
              description: "ID of the media item to delete",
            },
          },
          required: ["id"],
        },
      },
    ];
  }

  private async handleToolCall(request: any) {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "create_media_item":
          return await this.createMediaItem(args);
        case "read_media_items":
          return await this.readMediaItems(args);
        case "update_media_item":
          return await this.updateMediaItem(args);
        case "delete_media_item":
          return await this.deleteMediaItem(args);
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error: any) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async createMediaItem(args: MediaItem) {
    const { title, description, url, type, tags } = args;

    const stmt = this.db.prepare(`
      INSERT INTO media_items (title, description, url, type, tags)
      VALUES (?, ?, ?, ?, ?)
    `);

    const result = stmt.run(title, description || null, url, type, tags || null);

    const newItem = this.db
      .prepare("SELECT * FROM media_items WHERE id = ?")
      .get(result.lastInsertRowid) as MediaItem;

    return {
      content: [
        {
          type: "text",
          text: `Successfully created media item:\n${JSON.stringify(newItem, null, 2)}`,
        },
      ],
    };
  }

  private async readMediaItems(args: {
    id?: number;
    type?: string;
    limit?: number;
    offset?: number;
  }) {
    const { id, type, limit = 100, offset = 0 } = args;

    if (id !== undefined) {
      const item = this.db
        .prepare("SELECT * FROM media_items WHERE id = ?")
        .get(id);

      if (!item) {
        throw new Error(`Media item with id ${id} not found`);
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(item, null, 2),
          },
        ],
      };
    }

    let query = "SELECT * FROM media_items";
    const params: any[] = [];

    if (type) {
      query += " WHERE type = ?";
      params.push(type);
    }

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    params.push(limit, offset);

    const items = this.db.prepare(query).all(...params);

    return {
      content: [
        {
          type: "text",
          text: `Found ${items.length} media item(s):\n${JSON.stringify(items, null, 2)}`,
        },
      ],
    };
  }

  private async updateMediaItem(args: MediaItem & { id: number }) {
    const { id, title, description, url, type, tags } = args;

    const existing = this.db
      .prepare("SELECT * FROM media_items WHERE id = ?")
      .get(id);

    if (!existing) {
      throw new Error(`Media item with id ${id} not found`);
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (url !== undefined) {
      updates.push("url = ?");
      params.push(url);
    }
    if (type !== undefined) {
      updates.push("type = ?");
      params.push(type);
    }
    if (tags !== undefined) {
      updates.push("tags = ?");
      params.push(tags);
    }

    if (updates.length === 0) {
      throw new Error("No fields to update");
    }

    updates.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);

    const query = `UPDATE media_items SET ${updates.join(", ")} WHERE id = ?`;
    this.db.prepare(query).run(...params);

    const updated = this.db
      .prepare("SELECT * FROM media_items WHERE id = ?")
      .get(id);

    return {
      content: [
        {
          type: "text",
          text: `Successfully updated media item:\n${JSON.stringify(updated, null, 2)}`,
        },
      ],
    };
  }

  private async deleteMediaItem(args: { id: number }) {
    const { id } = args;

    const existing = this.db
      .prepare("SELECT * FROM media_items WHERE id = ?")
      .get(id);

    if (!existing) {
      throw new Error(`Media item with id ${id} not found`);
    }

    this.db.prepare("DELETE FROM media_items WHERE id = ?").run(id);

    return {
      content: [
        {
          type: "text",
          text: `Successfully deleted media item with id ${id}`,
        },
      ],
    };
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("MCP Mediachips server running on stdio");
  }
}

const server = new MediachipsServer();
server.run().catch(console.error);
