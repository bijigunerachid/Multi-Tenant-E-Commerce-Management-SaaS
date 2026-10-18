/* eslint-disable no-console -- a command-line script: printing is its output. */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateOpenApi } from '../utils/openapiDocument.js';

// `npm run openapi -w backend`: writes docs/openapi.json from the live route table.
const target = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
writeFileSync(target, generateOpenApi());
console.log(`Wrote ${target}`);
