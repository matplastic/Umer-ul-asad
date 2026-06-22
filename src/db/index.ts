import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

const { Pool } = pg;

// Helper to extract primitive values from nested where clauses
function extractPrimitives(obj: any, list: any[] = []): any[] {
  if (obj === null || obj === undefined) return list;
  if (typeof obj !== 'object') {
    list.push(obj);
    return list;
  }
  for (const key of Object.keys(obj)) {
    if (key === 'table' || key === 'column' || typeof obj[key] === 'function') continue;
    extractPrimitives(obj[key], list);
  }
  return list;
}

// Custom In-Memory Database Engine
class InMemoryDb {
  data: Record<string, any[]> = {
    pools: [],
    planned_pools: [],
    teams: [],
    logs: [],
    inspectors: [],
    engineers: [],
    projects_summary: [],
    monthly_targets: [],
    employees: [],
    trolley_production: [],
    recycle_bin: [],
    employee_punches: []
  };

  private getTableName(tableObj: any): string {
    if (!tableObj) return '';
    const rawName = tableObj._?.name || tableObj.name || String(tableObj);
    if (!rawName) return '';
    // Map CamelCase or different plural/singular forms safely
    if (rawName.includes('pools') || rawName === 'pools') return 'pools';
    if (rawName.includes('planned') || rawName === 'planned_pools') return 'planned_pools';
    if (rawName.includes('teams') || rawName === 'teams') return 'teams';
    if (rawName.includes('logs') || rawName === 'logs') return 'logs';
    if (rawName.includes('inspectors') || rawName === 'inspectors') return 'inspectors';
    if (rawName.includes('engineers') || rawName === 'engineers') return 'engineers';
    if (rawName.includes('projects') || rawName === 'projects_summary') return 'projects_summary';
    if (rawName.includes('targets') || rawName === 'monthly_targets') return 'monthly_targets';
    if (rawName.includes('employees') || rawName === 'employees') return 'employees';
    if (rawName.includes('trolley') || rawName === 'trolley_production') return 'trolley_production';
    if (rawName.includes('recycle') || rawName === 'recycle_bin') return 'recycle_bin';
    if (rawName.includes('punches') || rawName === 'employee_punches') return 'employee_punches';
    return rawName;
  }

  select() {
    return {
      from: (tableObj: any) => {
        const tableName = this.getTableName(tableObj);
        const list = this.data[tableName] || [];
        
        const chain = {
          where: (whereClause: any) => {
            const values = extractPrimitives(whereClause);
            const filtered = list.filter((item: any) => {
              if (item.id && values.includes(item.id)) return true;
              if (item.date && values.includes(item.date)) return true;
              return false;
            });
            return {
              limit: (num: number) => Promise.resolve(filtered.slice(0, num)),
              then: (onfulfilled: any) => Promise.resolve(filtered).then(onfulfilled)
            };
          },
          limit: (num: number) => {
            return {
              then: (onfulfilled: any) => Promise.resolve(list.slice(0, num)).then(onfulfilled)
            };
          },
          then: (onfulfilled: any) => {
            return Promise.resolve(list).then(onfulfilled);
          }
        };
        return chain;
      }
    };
  }

  insert(tableObj: any) {
    const tableName = this.getTableName(tableObj);
    if (!this.data[tableName]) {
      this.data[tableName] = [];
    }

    return {
      values: (valuesObj: any) => {
        const list = this.data[tableName];
        const newItems = Array.isArray(valuesObj) ? valuesObj : [valuesObj];

        for (const item of newItems) {
          const idx = list.findIndex((x: any) => x.id === item.id);
          if (idx !== -1) {
            list[idx] = { ...list[idx], ...item };
          } else {
            list.push(item);
          }
        }

        const conflictChain = {
          onConflictDoUpdate: (config: any) => Promise.resolve(),
          onConflictDoNothing: () => Promise.resolve(),
          then: (onfulfilled: any) => Promise.resolve().then(onfulfilled)
        };

        return Object.assign(Promise.resolve(), conflictChain);
      }
    };
  }

  delete(tableObj: any) {
    const tableName = this.getTableName(tableObj);
    const list = this.data[tableName] || [];

    return {
      where: (whereClause: any) => {
        const values = extractPrimitives(whereClause);
        this.data[tableName] = list.filter((item: any) => {
          if (item.id && values.includes(item.id)) return false;
          if (item.date && values.includes(item.date)) return false;
          return true;
        });
        return Promise.resolve();
      },
      then: (onfulfilled: any) => {
        this.data[tableName] = [];
        return Promise.resolve().then(onfulfilled);
      }
    };
  }
}

// Global in-memory DB singleton
const inMemoryInstance = new InMemoryDb();

let realDb: any = null;
let useInMemory = !process.env.SQL_HOST && !process.env.DATABASE_URL && !process.env.SQL_CONNECTION_STRING;

if (!useInMemory) {
  try {
    const connectionString = process.env.DATABASE_URL || process.env.SQL_CONNECTION_STRING;
    const poolConfig: pg.PoolConfig = connectionString 
      ? { connectionString } 
      : {
          host: process.env.SQL_HOST,
          user: process.env.SQL_USER,
          password: process.env.SQL_PASSWORD,
          database: process.env.SQL_DB_NAME,
          port: parseInt(process.env.SQL_PORT || '5432', 10),
        };

    // Automatically enable SSL for external cloud hosts like Supabase
    const isExternalHost = connectionString || (process.env.SQL_HOST && !process.env.SQL_HOST.includes('localhost') && !process.env.SQL_HOST.includes('127.0.0.1'));
    if (isExternalHost) {
      poolConfig.ssl = { rejectUnauthorized: false };
    }
    
    poolConfig.connectionTimeoutMillis = 5000;

    const pool = new Pool(poolConfig);
    pool.on('error', (err) => {
      console.warn('Postgres connection pool error, falling back to in-memory database:', err);
      useInMemory = true;
    });
    realDb = drizzle(pool, { schema });
  } catch (err) {
    console.warn('Failed to initialize Postgres database connection, falling back to in-memory mode:', err);
    useInMemory = true;
  }
}

// Transparent DB delegator that catches runtime errors and falls back
export const db: any = {
  select: (...args: any[]) => {
    if (useInMemory) {
      return inMemoryInstance.select();
    }
    try {
      const resultObj = realDb.select(...args);
      // Overwrite 'from' to catch potential query execution failures
      const originalFrom = resultObj.from;
      resultObj.from = (tableObj: any) => {
        try {
          const fromChain = originalFrom.call(resultObj, tableObj);
          const originalThen = fromChain.then;
          fromChain.then = async (onfulfilled: any, onrejected: any) => {
            try {
              return await originalThen.call(fromChain, onfulfilled, onrejected);
            } catch (err) {
              console.warn('Drizzle query failed. Falling back to in-memory storage:', err);
              useInMemory = true;
              return inMemoryInstance.select().from(tableObj).then(onfulfilled);
            }
          };
          return fromChain;
        } catch (err) {
          useInMemory = true;
          return inMemoryInstance.select().from(tableObj);
        }
      };
      return resultObj;
    } catch (err) {
      useInMemory = true;
      return inMemoryInstance.select();
    }
  },

  insert: (tableObj: any) => {
    if (useInMemory) {
      return inMemoryInstance.insert(tableObj);
    }
    try {
      const resultObj = realDb.insert(tableObj);
      const originalValues = resultObj.values;
      resultObj.values = (valuesObj: any) => {
        try {
          const valuesChain = originalValues.call(resultObj, valuesObj);
          const originalThen = valuesChain.then;
          valuesChain.then = async (onfulfilled: any, onrejected: any) => {
            try {
              // Copy to in-memory state in parallel to stay synchronised
              await (inMemoryInstance.insert(tableObj).values(valuesObj) as any);
              return await originalThen.call(valuesChain, onfulfilled, onrejected);
            } catch (err) {
              console.warn('Drizzle insert failed. Falling back to in-memory storage:', err);
              useInMemory = true;
              return inMemoryInstance.insert(tableObj).values(valuesObj).then(onfulfilled);
            }
          };
          return valuesChain;
        } catch (err) {
          useInMemory = true;
          return inMemoryInstance.insert(tableObj).values(valuesObj);
        }
      };
      return resultObj;
    } catch (err) {
      useInMemory = true;
      return inMemoryInstance.insert(tableObj);
    }
  },

  delete: (tableObj: any) => {
    if (useInMemory) {
      return inMemoryInstance.delete(tableObj);
    }
    try {
      const resultObj = realDb.delete(tableObj);
      const originalWhere = resultObj.where;
      const originalThen = resultObj.then;
      
      const wrapThen = (chain: any) => {
        const origThen = chain.then;
        chain.then = async (onfulfilled: any, onrejected: any) => {
          try {
            return await origThen.call(chain, onfulfilled, onrejected);
          } catch (err) {
            console.warn('Drizzle delete failed. Falling back to in-memory storage:', err);
            useInMemory = true;
            return Promise.resolve().then(onfulfilled);
          }
        };
        return chain;
      };

      if (originalWhere) {
        resultObj.where = (whereClause: any) => {
          try {
            // Replicate in-memory deletion
            inMemoryInstance.delete(tableObj).where(whereClause);
            const whereChain = originalWhere.call(resultObj, whereClause);
            return wrapThen(whereChain);
          } catch (err) {
            useInMemory = true;
            return inMemoryInstance.delete(tableObj).where(whereClause);
          }
        };
      }
      if (originalThen) {
        resultObj.then = async (onfulfilled: any, onrejected: any) => {
          try {
            await (inMemoryInstance.delete(tableObj) as any);
            return await originalThen.call(resultObj, onfulfilled, onrejected);
          } catch (err) {
            useInMemory = true;
            return inMemoryInstance.delete(tableObj).then(onfulfilled);
          }
        };
      }
      return resultObj;
    } catch (err) {
      useInMemory = true;
      return inMemoryInstance.delete(tableObj);
    }
  }
};

// Export createPool as an empty/no-op helper
export const createPool = () => {
  if (useInMemory) {
    return {
      on: () => {},
      end: () => Promise.resolve(),
    } as any;
  }
  const connectionString = process.env.DATABASE_URL || process.env.SQL_CONNECTION_STRING;
  const poolConfig: pg.PoolConfig = connectionString 
    ? { connectionString } 
    : {
        host: process.env.SQL_HOST,
        user: process.env.SQL_USER,
        password: process.env.SQL_PASSWORD,
        database: process.env.SQL_DB_NAME,
        port: parseInt(process.env.SQL_PORT || '5432', 10),
      };

  const isExternalHost = connectionString || (process.env.SQL_HOST && !process.env.SQL_HOST.includes('localhost') && !process.env.SQL_HOST.includes('127.0.0.1'));
  if (isExternalHost) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }
  poolConfig.connectionTimeoutMillis = 5000;

  return new Pool(poolConfig);
};
