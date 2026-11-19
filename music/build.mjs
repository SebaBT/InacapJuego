import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'demo.js')],
  bundle: true,
  minify: false,
  format: 'iife',
  target: 'es2020',
  outfile: path.join(here, 'demo.bundle.js'),
  logLevel: 'info'
});
