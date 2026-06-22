import { drizzle } from 'drizzle-orm/netlify-db';
import * as schema from './schema.ts';

export const db = drizzle({ schema });

export const createPool = () => {
  throw new Error('createPool is not available when using Netlify Database.');
};
