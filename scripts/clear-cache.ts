import { clearCache, closeDb } from '../src/db/database.js';

clearCache();
console.log('Cache cleared (embeddings, constellations, patterns).');
closeDb();
