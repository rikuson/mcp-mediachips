const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const Database = require("better-sqlite3");
const path = require("path");

const MEDIACHIPS_BASE = path.join(
  process.env.HOME || process.env.USERPROFILE,
  "Library",
  "Application Support",
  "MediaChips",
  "databases"
);

function resolveDbPath() {
  if (process.env.MEDIACHIPS_DB_PATH) return process.env.MEDIACHIPS_DB_PATH;

  const fs = require("fs");
  if (!fs.existsSync(MEDIACHIPS_BASE)) return path.join(__dirname, "db.sqlite");

  // Find the most recently modified db.sqlite under the databases directory
  const entries = fs.readdirSync(MEDIACHIPS_BASE, { withFileTypes: true });
  let best = null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dbFile = path.join(MEDIACHIPS_BASE, entry.name, "db.sqlite");
    if (!fs.existsSync(dbFile)) continue;
    const mtime = fs.statSync(dbFile).mtimeMs;
    if (!best || mtime > best.mtime) {
      best = { path: dbFile, mtime };
    }
  }
  return best ? best.path : path.join(__dirname, "db.sqlite");
}

const DB_PATH = resolveDbPath();

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  }
  return db;
}

function now() {
  return new Date().toISOString();
}

const server = new McpServer({
  name: "mcp-mediachips",
  version: "1.0.0",
});

// ─── Media Tools ──────────────────────────────────────────────────────────────

server.tool(
  "list_media",
  "List media items with pagination, sorting, and optional filters",
  {
    limit: z.number().int().min(1).max(500).default(50).describe("Number of items to return"),
    offset: z.number().int().min(0).default(0).describe("Offset for pagination"),
    sortBy: z.enum(["id", "name", "rating", "views", "filesize", "createdAt", "updatedAt", "viewedAt"]).default("createdAt").describe("Sort field"),
    sortDir: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
    mediaTypeId: z.number().int().optional().describe("Filter by media type ID"),
    favorite: z.boolean().optional().describe("Filter favorites only"),
    search: z.string().optional().describe("Search by name (partial match)"),
    minRating: z.number().int().min(0).max(5).optional().describe("Minimum rating filter"),
  },
  async (params) => {
    const d = getDb();
    let where = [];
    let args = {};

    if (params.mediaTypeId !== undefined) {
      where.push("m.mediaTypeId = @mediaTypeId");
      args.mediaTypeId = params.mediaTypeId;
    }
    if (params.favorite !== undefined) {
      where.push("m.favorite = @favorite");
      args.favorite = params.favorite ? 1 : 0;
    }
    if (params.search) {
      where.push("m.name LIKE @search");
      args.search = `%${params.search}%`;
    }
    if (params.minRating !== undefined) {
      where.push("m.rating >= @minRating");
      args.minRating = params.minRating;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = d.prepare(`SELECT COUNT(*) as total FROM media m ${whereClause}`).get(args);

    const rows = d.prepare(`
      SELECT m.*, mt.name as mediaTypeName,
             vm.duration, vm.width, vm.height, vm.codec
      FROM media m
      LEFT JOIN mediaTypes mt ON m.mediaTypeId = mt.id
      LEFT JOIN videoMetadata vm ON vm.mediaId = m.id
      ${whereClause}
      ORDER BY m.${params.sortBy} ${params.sortDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...args, limit: params.limit, offset: params.offset });

    return {
      content: [{ type: "text", text: JSON.stringify({ total: countRow.total, items: rows }, null, 2) }],
    };
  }
);

server.tool(
  "get_media",
  "Get a single media item by ID with all related data (tags, video metadata, marks)",
  {
    id: z.number().int().describe("Media ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const media = d.prepare(`
      SELECT m.*, mt.name as mediaTypeName
      FROM media m
      LEFT JOIN mediaTypes mt ON m.mediaTypeId = mt.id
      WHERE m.id = @id
    `).get({ id });

    if (!media) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Media not found" }) }] };
    }

    const videoMeta = d.prepare("SELECT * FROM videoMetadata WHERE mediaId = @id").get({ id });
    const tags = d.prepare(`
      SELECT t.*, meta.name as metaName
      FROM tagsInMedia tim
      JOIN tags t ON tim.tagId = t.id
      LEFT JOIN meta ON tim.metaId = meta.id
      WHERE tim.mediaId = @id
    `).all({ id });
    const marks = d.prepare("SELECT * FROM marks WHERE mediaId = @id ORDER BY time").all({ id });
    const playlists = d.prepare(`
      SELECT p.*, mip."order"
      FROM mediaInPlaylists mip
      JOIN playlists p ON mip.playlistId = p.id
      WHERE mip.mediaId = @id
    `).all({ id });
    const values = d.prepare(`
      SELECT vim.value, meta.name as metaName, meta.id as metaId
      FROM valuesInMedia vim
      JOIN meta ON vim.metaId = meta.id
      WHERE vim.mediaId = @id
    `).all({ id });

    return {
      content: [{ type: "text", text: JSON.stringify({ ...media, videoMetadata: videoMeta || null, tags, marks, playlists, values }, null, 2) }],
    };
  }
);

server.tool(
  "create_media",
  "Create a new media item",
  {
    path: z.string().describe("File path"),
    name: z.string().optional().describe("Display name"),
    mediaTypeId: z.number().int().optional().describe("Media type ID"),
    rating: z.number().int().min(0).max(5).default(0).describe("Rating (0-5)"),
    favorite: z.boolean().default(false).describe("Mark as favorite"),
    bookmark: z.string().optional().describe("Bookmark text"),
  },
  async (params) => {
    const d = getDb();
    const basename = path.basename(params.path);
    const ext = path.extname(params.path);
    const name = params.name || path.basename(params.path, ext);
    const ts = now();

    const result = d.prepare(`
      INSERT INTO media (path, basename, name, ext, rating, favorite, bookmark, views, createdAt, updatedAt, mediaTypeId)
      VALUES (@path, @basename, @name, @ext, @rating, @favorite, @bookmark, 0, @ts, @ts, @mediaTypeId)
    `).run({
      path: params.path,
      basename,
      name,
      ext,
      rating: params.rating,
      favorite: params.favorite ? 1 : 0,
      bookmark: params.bookmark || null,
      ts,
      mediaTypeId: params.mediaTypeId || null,
    });

    return {
      content: [{ type: "text", text: JSON.stringify({ id: result.lastInsertRowid, message: "Media created" }) }],
    };
  }
);

server.tool(
  "update_media",
  "Update an existing media item",
  {
    id: z.number().int().describe("Media ID"),
    name: z.string().optional().describe("Display name"),
    rating: z.number().int().min(0).max(5).optional().describe("Rating (0-5)"),
    favorite: z.boolean().optional().describe("Mark as favorite"),
    bookmark: z.string().optional().describe("Bookmark text"),
    views: z.number().int().optional().describe("View count"),
  },
  async (params) => {
    const d = getDb();
    const sets = [];
    const args = { id: params.id, ts: now() };

    if (params.name !== undefined) { sets.push("name = @name"); args.name = params.name; }
    if (params.rating !== undefined) { sets.push("rating = @rating"); args.rating = params.rating; }
    if (params.favorite !== undefined) { sets.push("favorite = @favorite"); args.favorite = params.favorite ? 1 : 0; }
    if (params.bookmark !== undefined) { sets.push("bookmark = @bookmark"); args.bookmark = params.bookmark; }
    if (params.views !== undefined) { sets.push("views = @views"); args.views = params.views; }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
    }

    sets.push("updatedAt = @ts");
    d.prepare(`UPDATE media SET ${sets.join(", ")} WHERE id = @id`).run(args);

    return { content: [{ type: "text", text: JSON.stringify({ message: "Media updated", id: params.id }) }] };
  }
);

server.tool(
  "delete_media",
  "Delete a media item and all its associations",
  {
    id: z.number().int().describe("Media ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const media = d.prepare("SELECT id, name FROM media WHERE id = @id").get({ id });
    if (!media) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Media not found" }) }] };
    }
    d.prepare("DELETE FROM media WHERE id = @id").run({ id });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Media deleted", id, name: media.name }) }] };
  }
);

// ─── Tags Tools ───────────────────────────────────────────────────────────────

server.tool(
  "list_tags",
  "List tags with pagination, sorting, and optional filters",
  {
    limit: z.number().int().min(1).max(500).default(50).describe("Number of items to return"),
    offset: z.number().int().min(0).default(0).describe("Offset for pagination"),
    sortBy: z.enum(["id", "name", "rating", "views", "createdAt", "updatedAt"]).default("name").describe("Sort field"),
    sortDir: z.enum(["asc", "desc"]).default("asc").describe("Sort direction"),
    metaId: z.number().int().optional().describe("Filter by meta category ID"),
    favorite: z.boolean().optional().describe("Filter favorites only"),
    search: z.string().optional().describe("Search by name (partial match)"),
  },
  async (params) => {
    const d = getDb();
    let where = [];
    let args = {};

    if (params.metaId !== undefined) {
      where.push("t.metaId = @metaId");
      args.metaId = params.metaId;
    }
    if (params.favorite !== undefined) {
      where.push("t.favorite = @favorite");
      args.favorite = params.favorite ? 1 : 0;
    }
    if (params.search) {
      where.push("(t.name LIKE @search OR t.synonyms LIKE @search)");
      args.search = `%${params.search}%`;
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const countRow = d.prepare(`SELECT COUNT(*) as total FROM tags t ${whereClause}`).get(args);

    const rows = d.prepare(`
      SELECT t.*, meta.name as metaName,
             (SELECT COUNT(*) FROM tagsInMedia tim WHERE tim.tagId = t.id) as mediaCount
      FROM tags t
      LEFT JOIN meta ON t.metaId = meta.id
      ${whereClause}
      ORDER BY t.${params.sortBy} ${params.sortDir}
      LIMIT @limit OFFSET @offset
    `).all({ ...args, limit: params.limit, offset: params.offset });

    return {
      content: [{ type: "text", text: JSON.stringify({ total: countRow.total, items: rows }, null, 2) }],
    };
  }
);

server.tool(
  "get_tag",
  "Get a single tag by ID with all related data (media associations, values, child tags)",
  {
    id: z.number().int().describe("Tag ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const tag = d.prepare(`
      SELECT t.*, meta.name as metaName
      FROM tags t
      LEFT JOIN meta ON t.metaId = meta.id
      WHERE t.id = @id
    `).get({ id });

    if (!tag) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Tag not found" }) }] };
    }

    const media = d.prepare(`
      SELECT m.id, m.name, m.path, m.rating
      FROM tagsInMedia tim
      JOIN media m ON tim.mediaId = m.id
      WHERE tim.tagId = @id
    `).all({ id });

    const childTags = d.prepare(`
      SELECT t.id, t.name
      FROM tagsInTags tit
      JOIN tags t ON tit.tagId = t.id
      WHERE tit.parentTagId = @id
    `).all({ id });

    const parentTags = d.prepare(`
      SELECT t.id, t.name
      FROM tagsInTags tit
      JOIN tags t ON tit.parentTagId = t.id
      WHERE tit.tagId = @id
    `).all({ id });

    const values = d.prepare(`
      SELECT vit.value, meta.name as metaName, meta.id as metaId
      FROM valuesInTags vit
      JOIN meta ON vit.metaId = meta.id
      WHERE vit.tagId = @id
    `).all({ id });

    return {
      content: [{ type: "text", text: JSON.stringify({ ...tag, media, childTags, parentTags, values }, null, 2) }],
    };
  }
);

server.tool(
  "create_tag",
  "Create a new tag",
  {
    name: z.string().describe("Tag name"),
    metaId: z.number().int().describe("Meta category ID"),
    synonyms: z.string().optional().describe("Comma-separated synonyms"),
    rating: z.number().int().min(0).max(5).default(0).describe("Rating (0-5)"),
    favorite: z.boolean().default(false).describe("Mark as favorite"),
    color: z.string().optional().describe("Color hex code"),
    country: z.string().optional().describe("Country code"),
    bookmark: z.string().optional().describe("Bookmark text"),
  },
  async (params) => {
    const d = getDb();
    const ts = now();
    const result = d.prepare(`
      INSERT INTO tags (name, metaId, synonyms, rating, favorite, color, country, bookmark, views, createdAt, updatedAt)
      VALUES (@name, @metaId, @synonyms, @rating, @favorite, @color, @country, @bookmark, 0, @ts, @ts)
    `).run({
      name: params.name,
      metaId: params.metaId,
      synonyms: params.synonyms || null,
      rating: params.rating,
      favorite: params.favorite ? 1 : 0,
      color: params.color || null,
      country: params.country || null,
      bookmark: params.bookmark || null,
      ts,
    });

    return {
      content: [{ type: "text", text: JSON.stringify({ id: result.lastInsertRowid, message: "Tag created" }) }],
    };
  }
);

server.tool(
  "update_tag",
  "Update an existing tag",
  {
    id: z.number().int().describe("Tag ID"),
    name: z.string().optional().describe("Tag name"),
    synonyms: z.string().optional().describe("Comma-separated synonyms"),
    rating: z.number().int().min(0).max(5).optional().describe("Rating (0-5)"),
    favorite: z.boolean().optional().describe("Mark as favorite"),
    color: z.string().optional().describe("Color hex code"),
    country: z.string().optional().describe("Country code"),
    bookmark: z.string().optional().describe("Bookmark text"),
  },
  async (params) => {
    const d = getDb();
    const sets = [];
    const args = { id: params.id, ts: now() };

    if (params.name !== undefined) { sets.push("name = @name"); args.name = params.name; }
    if (params.synonyms !== undefined) { sets.push("synonyms = @synonyms"); args.synonyms = params.synonyms; }
    if (params.rating !== undefined) { sets.push("rating = @rating"); args.rating = params.rating; }
    if (params.favorite !== undefined) { sets.push("favorite = @favorite"); args.favorite = params.favorite ? 1 : 0; }
    if (params.color !== undefined) { sets.push("color = @color"); args.color = params.color; }
    if (params.country !== undefined) { sets.push("country = @country"); args.country = params.country; }
    if (params.bookmark !== undefined) { sets.push("bookmark = @bookmark"); args.bookmark = params.bookmark; }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
    }

    sets.push("updatedAt = @ts");
    d.prepare(`UPDATE tags SET ${sets.join(", ")} WHERE id = @id`).run(args);

    return { content: [{ type: "text", text: JSON.stringify({ message: "Tag updated", id: params.id }) }] };
  }
);

server.tool(
  "delete_tag",
  "Delete a tag and all its associations",
  {
    id: z.number().int().describe("Tag ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const tag = d.prepare("SELECT id, name FROM tags WHERE id = @id").get({ id });
    if (!tag) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Tag not found" }) }] };
    }
    d.prepare("DELETE FROM tags WHERE id = @id").run({ id });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Tag deleted", id, name: tag.name }) }] };
  }
);

// ─── Tag-Media Association Tools ──────────────────────────────────────────────

server.tool(
  "add_tag_to_media",
  "Associate a tag with a media item",
  {
    tagId: z.number().int().describe("Tag ID"),
    mediaId: z.number().int().describe("Media ID"),
    metaId: z.number().int().describe("Meta category ID of the tag"),
  },
  async ({ tagId, mediaId, metaId }) => {
    const d = getDb();
    const existing = d.prepare("SELECT 1 FROM tagsInMedia WHERE tagId = @tagId AND mediaId = @mediaId AND metaId = @metaId").get({ tagId, mediaId, metaId });
    if (existing) {
      return { content: [{ type: "text", text: JSON.stringify({ message: "Association already exists" }) }] };
    }
    d.prepare("INSERT INTO tagsInMedia (tagId, mediaId, metaId) VALUES (@tagId, @mediaId, @metaId)").run({ tagId, mediaId, metaId });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Tag added to media" }) }] };
  }
);

server.tool(
  "remove_tag_from_media",
  "Remove a tag association from a media item",
  {
    tagId: z.number().int().describe("Tag ID"),
    mediaId: z.number().int().describe("Media ID"),
  },
  async ({ tagId, mediaId }) => {
    const d = getDb();
    const result = d.prepare("DELETE FROM tagsInMedia WHERE tagId = @tagId AND mediaId = @mediaId").run({ tagId, mediaId });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Tag removed from media", removed: result.changes }) }] };
  }
);

// ─── Playlist Tools ───────────────────────────────────────────────────────────

server.tool(
  "list_playlists",
  "List all playlists with media count",
  {},
  async () => {
    const d = getDb();
    const rows = d.prepare(`
      SELECT p.*,
             (SELECT COUNT(*) FROM mediaInPlaylists mip WHERE mip.playlistId = p.id) as mediaCount
      FROM playlists p
      ORDER BY p.name
    `).all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  "get_playlist",
  "Get a playlist with its media items",
  {
    id: z.number().int().describe("Playlist ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const playlist = d.prepare("SELECT * FROM playlists WHERE id = @id").get({ id });
    if (!playlist) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Playlist not found" }) }] };
    }

    const media = d.prepare(`
      SELECT m.id, m.name, m.path, m.rating, mip."order"
      FROM mediaInPlaylists mip
      JOIN media m ON mip.mediaId = m.id
      WHERE mip.playlistId = @id
      ORDER BY mip."order"
    `).all({ id });

    return { content: [{ type: "text", text: JSON.stringify({ ...playlist, media }, null, 2) }] };
  }
);

server.tool(
  "create_playlist",
  "Create a new playlist",
  {
    name: z.string().describe("Playlist name"),
    favorite: z.boolean().default(false).describe("Mark as favorite"),
  },
  async (params) => {
    const d = getDb();
    const ts = now();
    const result = d.prepare(
      "INSERT INTO playlists (name, favorite, createdAt, updatedAt) VALUES (@name, @favorite, @ts, @ts)"
    ).run({ name: params.name, favorite: params.favorite ? 1 : 0, ts });

    return { content: [{ type: "text", text: JSON.stringify({ id: result.lastInsertRowid, message: "Playlist created" }) }] };
  }
);

server.tool(
  "update_playlist",
  "Update a playlist",
  {
    id: z.number().int().describe("Playlist ID"),
    name: z.string().optional().describe("Playlist name"),
    favorite: z.boolean().optional().describe("Mark as favorite"),
  },
  async (params) => {
    const d = getDb();
    const sets = [];
    const args = { id: params.id, ts: now() };

    if (params.name !== undefined) { sets.push("name = @name"); args.name = params.name; }
    if (params.favorite !== undefined) { sets.push("favorite = @favorite"); args.favorite = params.favorite ? 1 : 0; }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
    }

    sets.push("updatedAt = @ts");
    d.prepare(`UPDATE playlists SET ${sets.join(", ")} WHERE id = @id`).run(args);

    return { content: [{ type: "text", text: JSON.stringify({ message: "Playlist updated", id: params.id }) }] };
  }
);

server.tool(
  "delete_playlist",
  "Delete a playlist",
  {
    id: z.number().int().describe("Playlist ID"),
  },
  async ({ id }) => {
    const d = getDb();
    const playlist = d.prepare("SELECT id, name FROM playlists WHERE id = @id").get({ id });
    if (!playlist) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Playlist not found" }) }] };
    }
    d.prepare("DELETE FROM playlists WHERE id = @id").run({ id });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Playlist deleted", id, name: playlist.name }) }] };
  }
);

server.tool(
  "add_media_to_playlist",
  "Add a media item to a playlist",
  {
    playlistId: z.number().int().describe("Playlist ID"),
    mediaId: z.number().int().describe("Media ID"),
    order: z.number().int().optional().describe("Position in playlist"),
  },
  async ({ playlistId, mediaId, order }) => {
    const d = getDb();
    const existing = d.prepare("SELECT 1 FROM mediaInPlaylists WHERE playlistId = @playlistId AND mediaId = @mediaId").get({ playlistId, mediaId });
    if (existing) {
      return { content: [{ type: "text", text: JSON.stringify({ message: "Media already in playlist" }) }] };
    }

    const finalOrder = order ?? (d.prepare('SELECT COALESCE(MAX("order"), 0) + 1 as next FROM mediaInPlaylists WHERE playlistId = @playlistId').get({ playlistId })).next;
    d.prepare('INSERT INTO mediaInPlaylists (playlistId, mediaId, "order") VALUES (@playlistId, @mediaId, @order)').run({ playlistId, mediaId, order: finalOrder });

    return { content: [{ type: "text", text: JSON.stringify({ message: "Media added to playlist" }) }] };
  }
);

server.tool(
  "remove_media_from_playlist",
  "Remove a media item from a playlist",
  {
    playlistId: z.number().int().describe("Playlist ID"),
    mediaId: z.number().int().describe("Media ID"),
  },
  async ({ playlistId, mediaId }) => {
    const d = getDb();
    const result = d.prepare("DELETE FROM mediaInPlaylists WHERE playlistId = @playlistId AND mediaId = @mediaId").run({ playlistId, mediaId });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Media removed from playlist", removed: result.changes }) }] };
  }
);

// ─── Marks Tools ──────────────────────────────────────────────────────────────

server.tool(
  "list_marks",
  "List marks (bookmarks/timestamps) for a media item",
  {
    mediaId: z.number().int().describe("Media ID"),
  },
  async ({ mediaId }) => {
    const d = getDb();
    const rows = d.prepare(`
      SELECT mk.*, t.name as tagName
      FROM marks mk
      LEFT JOIN tags t ON mk.tagId = t.id
      WHERE mk.mediaId = @mediaId
      ORDER BY mk.time
    `).all({ mediaId });

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  "create_mark",
  "Create a mark (bookmark/timestamp) on a media item",
  {
    mediaId: z.number().int().describe("Media ID"),
    type: z.string().optional().describe("Mark type"),
    text: z.string().optional().describe("Mark text/label"),
    time: z.number().int().describe("Timestamp in seconds"),
    end: z.number().int().optional().describe("End timestamp in seconds"),
    tagId: z.number().int().optional().describe("Associated tag ID"),
  },
  async (params) => {
    const d = getDb();
    const result = d.prepare(`
      INSERT INTO marks (mediaId, type, text, time, end, tagId)
      VALUES (@mediaId, @type, @text, @time, @end, @tagId)
    `).run({
      mediaId: params.mediaId,
      type: params.type || null,
      text: params.text || null,
      time: params.time,
      end: params.end || null,
      tagId: params.tagId || null,
    });

    return { content: [{ type: "text", text: JSON.stringify({ id: result.lastInsertRowid, message: "Mark created" }) }] };
  }
);

server.tool(
  "update_mark",
  "Update an existing mark",
  {
    id: z.number().int().describe("Mark ID"),
    type: z.string().optional().describe("Mark type"),
    text: z.string().optional().describe("Mark text/label"),
    time: z.number().int().optional().describe("Timestamp in seconds"),
    end: z.number().int().optional().describe("End timestamp in seconds"),
    tagId: z.number().int().optional().describe("Associated tag ID"),
  },
  async (params) => {
    const d = getDb();
    const sets = [];
    const args = { id: params.id };

    if (params.type !== undefined) { sets.push("type = @type"); args.type = params.type; }
    if (params.text !== undefined) { sets.push("text = @text"); args.text = params.text; }
    if (params.time !== undefined) { sets.push("time = @time"); args.time = params.time; }
    if (params.end !== undefined) { sets.push('"end" = @end'); args.end = params.end; }
    if (params.tagId !== undefined) { sets.push("tagId = @tagId"); args.tagId = params.tagId; }

    if (sets.length === 0) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "No fields to update" }) }] };
    }

    d.prepare(`UPDATE marks SET ${sets.join(", ")} WHERE id = @id`).run(args);
    return { content: [{ type: "text", text: JSON.stringify({ message: "Mark updated", id: params.id }) }] };
  }
);

server.tool(
  "delete_mark",
  "Delete a mark",
  {
    id: z.number().int().describe("Mark ID"),
  },
  async ({ id }) => {
    const d = getDb();
    d.prepare("DELETE FROM marks WHERE id = @id").run({ id });
    return { content: [{ type: "text", text: JSON.stringify({ message: "Mark deleted", id }) }] };
  }
);

// ─── Meta & Settings Tools ────────────────────────────────────────────────────

server.tool(
  "list_meta",
  "List all meta categories (e.g., Actress, Bust, Waist, etc.)",
  {},
  async () => {
    const d = getDb();
    const rows = d.prepare(`
      SELECT m.*, ms.*,
             (SELECT COUNT(*) FROM tags t WHERE t.metaId = m.id) as tagCount
      FROM meta m
      LEFT JOIN metaSettings ms ON ms.metaId = m.id
      ORDER BY m."order"
    `).all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  "list_media_types",
  "List all media types (Videos, Images, Audios, Texts)",
  {},
  async () => {
    const d = getDb();
    const rows = d.prepare(`
      SELECT mt.*,
             (SELECT COUNT(*) FROM media m WHERE m.mediaTypeId = mt.id) as mediaCount
      FROM mediaTypes mt
      ORDER BY mt."order"
    `).all();

    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  "get_settings",
  "Get all application settings or a specific setting by option name",
  {
    option: z.string().optional().describe("Specific setting option name to retrieve"),
  },
  async ({ option }) => {
    const d = getDb();
    if (option) {
      const row = d.prepare("SELECT * FROM settings WHERE option = @option").get({ option });
      return { content: [{ type: "text", text: JSON.stringify(row || { error: "Setting not found" }, null, 2) }] };
    }
    const rows = d.prepare("SELECT * FROM settings").all();
    return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
  }
);

server.tool(
  "update_setting",
  "Update an application setting value",
  {
    option: z.string().describe("Setting option name"),
    value: z.string().describe("New value"),
  },
  async ({ option, value }) => {
    const d = getDb();
    const ts = now();
    const existing = d.prepare("SELECT id FROM settings WHERE option = @option").get({ option });
    if (existing) {
      d.prepare("UPDATE settings SET value = @value, updatedAt = @ts WHERE option = @option").run({ option, value, ts });
    } else {
      d.prepare("INSERT INTO settings (option, value, createdAt, updatedAt) VALUES (@option, @value, @ts, @ts)").run({ option, value, ts });
    }
    return { content: [{ type: "text", text: JSON.stringify({ message: "Setting updated", option, value }) }] };
  }
);

// ─── Values Tools ─────────────────────────────────────────────────────────────

server.tool(
  "set_value_for_media",
  "Set a custom meta value on a media item (e.g., description, character name)",
  {
    mediaId: z.number().int().describe("Media ID"),
    metaId: z.number().int().describe("Meta category ID"),
    value: z.string().describe("Value to set"),
  },
  async ({ mediaId, metaId, value }) => {
    const d = getDb();
    const existing = d.prepare("SELECT 1 FROM valuesInMedia WHERE mediaId = @mediaId AND metaId = @metaId").get({ mediaId, metaId });
    if (existing) {
      d.prepare("UPDATE valuesInMedia SET value = @value WHERE mediaId = @mediaId AND metaId = @metaId").run({ mediaId, metaId, value });
    } else {
      d.prepare("INSERT INTO valuesInMedia (mediaId, metaId, value) VALUES (@mediaId, @metaId, @value)").run({ mediaId, metaId, value });
    }
    return { content: [{ type: "text", text: JSON.stringify({ message: "Value set for media" }) }] };
  }
);

server.tool(
  "set_value_for_tag",
  "Set a custom meta value on a tag (e.g., bust size, waist, height)",
  {
    tagId: z.number().int().describe("Tag ID"),
    metaId: z.number().int().describe("Meta category ID"),
    value: z.string().describe("Value to set"),
  },
  async ({ tagId, metaId, value }) => {
    const d = getDb();
    const existing = d.prepare("SELECT 1 FROM valuesInTags WHERE tagId = @tagId AND metaId = @metaId").get({ tagId, metaId });
    if (existing) {
      d.prepare("UPDATE valuesInTags SET value = @value WHERE tagId = @tagId AND metaId = @metaId").run({ tagId, metaId, value });
    } else {
      d.prepare("INSERT INTO valuesInTags (tagId, metaId, value) VALUES (@tagId, @metaId, @value)").run({ tagId, metaId, value });
    }
    return { content: [{ type: "text", text: JSON.stringify({ message: "Value set for tag" }) }] };
  }
);

// ─── Stats / Search Tools ─────────────────────────────────────────────────────

server.tool(
  "get_stats",
  "Get database statistics overview",
  {},
  async () => {
    const d = getDb();
    const stats = {
      media: d.prepare("SELECT COUNT(*) as count FROM media").get().count,
      tags: d.prepare("SELECT COUNT(*) as count FROM tags").get().count,
      playlists: d.prepare("SELECT COUNT(*) as count FROM playlists").get().count,
      marks: d.prepare("SELECT COUNT(*) as count FROM marks").get().count,
      mediaTypes: d.prepare("SELECT * FROM mediaTypes ORDER BY \"order\"").all().map(mt => ({
        id: mt.id,
        name: mt.name,
        count: d.prepare("SELECT COUNT(*) as count FROM media WHERE mediaTypeId = @id").get({ id: mt.id }).count,
      })),
      metaCategories: d.prepare("SELECT id, name, type FROM meta ORDER BY \"order\"").all(),
      totalFileSize: d.prepare("SELECT COALESCE(SUM(filesize), 0) as total FROM media").get().total,
    };

    return { content: [{ type: "text", text: JSON.stringify(stats, null, 2) }] };
  }
);

server.tool(
  "search",
  "Search across media and tags simultaneously",
  {
    query: z.string().describe("Search query (partial match on names)"),
    limit: z.number().int().min(1).max(100).default(20).describe("Max results per category"),
  },
  async ({ query, limit }) => {
    const d = getDb();
    const pattern = `%${query}%`;

    const media = d.prepare(`
      SELECT m.id, m.name, m.path, m.rating, m.favorite, mt.name as mediaTypeName
      FROM media m
      LEFT JOIN mediaTypes mt ON m.mediaTypeId = mt.id
      WHERE m.name LIKE @pattern OR m.basename LIKE @pattern
      LIMIT @limit
    `).all({ pattern, limit });

    const tags = d.prepare(`
      SELECT t.id, t.name, t.rating, t.favorite, meta.name as metaName,
             (SELECT COUNT(*) FROM tagsInMedia tim WHERE tim.tagId = t.id) as mediaCount
      FROM tags t
      LEFT JOIN meta ON t.metaId = meta.id
      WHERE t.name LIKE @pattern OR t.synonyms LIKE @pattern
      LIMIT @limit
    `).all({ pattern, limit });

    return {
      content: [{ type: "text", text: JSON.stringify({ media, tags }, null, 2) }],
    };
  }
);

server.tool(
  "execute_query",
  "Execute a raw SQL SELECT query (read-only) for advanced queries not covered by other tools",
  {
    sql: z.string().describe("SQL SELECT query to execute"),
  },
  async ({ sql }) => {
    const d = getDb();
    const trimmed = sql.trim().toLowerCase();
    if (!trimmed.startsWith("select") && !trimmed.startsWith("with") && !trimmed.startsWith("pragma")) {
      return { content: [{ type: "text", text: JSON.stringify({ error: "Only SELECT, WITH, and PRAGMA queries are allowed" }) }] };
    }

    try {
      const rows = d.prepare(sql).all();
      return { content: [{ type: "text", text: JSON.stringify({ rowCount: rows.length, rows }, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── Start Server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Server error:", err);
  process.exit(1);
});
