import { cpSync } from 'node:fs';
cpSync('src/db/schema.sql', 'dist/db/schema.sql');
