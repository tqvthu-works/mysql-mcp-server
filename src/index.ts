import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import mysql from "mysql2/promise";
import { z } from "zod";
import * as dotenv from "dotenv";
dotenv.config();

// Environment configuration schema
const envSchema = z.object({
  mysqlHost: z.string().default("localhost"),
  mysqlPort: z.number().default(3306),
  mysqlUser: z.string(),
  mysqlPassword: z.string(),
  mysqlDatabase: z.string().optional(),
  allowInsert: z.string().default("false"),
  allowUpdate: z.string().default("false"),
  allowDelete: z.string().default("false"),
});

// Parse environment variables
const env = envSchema.parse({
  mysqlHost: process.env.MYSQL_HOST,
  mysqlPort: parseInt(process.env.MYSQL_PORT || "3306", 10),
  mysqlUser: process.env.MYSQL_USER,
  mysqlPassword: process.env.MYSQL_PASS,
  mysqlDatabase: process.env.MYSQL_DB,
  allowInsert: process.env.ALLOW_INSERT_OPERATION,
  allowUpdate: process.env.ALLOW_UPDATE_OPERATION,
  allowDelete: process.env.ALLOW_DELETE_OPERATION,
});

// Initialize MySQL connection pool
const createDbPool = async () => {
  return mysql.createPool({
    host: env.mysqlHost,
    port: env.mysqlPort,
    user: env.mysqlUser,
    password: env.mysqlPassword,
    database: env.mysqlDatabase,
    connectionLimit: 10,
  });
};

// MCP Server setup
const setupMcpServer = async () => {
  const server = new McpServer({
    name: "mysqlMcpServer",
    version: "1.0.0",
  });

  const pool = await createDbPool();

  // Tool: Execute SQL query
  server.tool(
    "executeSqlQuery",
    "Execute a SQL query against the MySQL database",
    {
      query: z.string().min(1, "SQL query cannot be empty"),
    },
    async ({ query }) => {
      try {
        // Prevent write operations unless explicitly allowed
        const isWriteQuery = query.toLowerCase().match(/^(insert|update|delete)/i);
        if (isWriteQuery) {
          if (query.toLowerCase().startsWith("insert") && env.allowInsert !== "true") {
            throw new Error("Insert operations are disabled");
          }
          if (query.toLowerCase().startsWith("update") && env.allowUpdate !== "true") {
            throw new Error("Update operations are disabled");
          }
          if (query.toLowerCase().startsWith("delete") && env.allowDelete !== "true") {
            throw new Error("Delete operations are disabled");
          }
        }

        const [rows] = await pool.query(query);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Resource: Get schema information
  server.resource(
    "schemaInfo",
    new ResourceTemplate("schema://{tableName}", { list: undefined }),
    async (uri, { tableName }) => {
      try {
        const [rows] = await pool.query(
          `DESCRIBE ${env.mysqlDatabase}.${tableName}`
        );
        return {
          contents: [
            {
              uri: uri.href,
              text: JSON.stringify(rows, null, 2),
            },
          ],
        };
      } catch (error) {
        throw new Error(`Failed to fetch schema: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Connect server to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.log("MCP server running...");
};

// Start the server
setupMcpServer().catch((error) => {
  console.error("Failed to start MCP server:", error);
  process.exit(1);
});