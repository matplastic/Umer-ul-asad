import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

// Load .env variables
dotenv.config();

const connectionString = process.env.DATABASE_URL || process.env.SQL_CONNECTION_STRING;
const sqlHost = process.env.SQL_HOST;
const sqlDbName = process.env.SQL_DB_NAME;
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;

const dbCredentials: any = connectionString 
  ? { url: connectionString, ssl: { rejectUnauthorized: false } }
  : {
      host: sqlHost || 'localhost',
      user: user || 'postgres',
      password: password || '',
      database: sqlDbName || 'postgres',
      ssl: false,
    };

console.log(`Using credentials for schema migrations.`);

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials,
  verbose: true,
});
