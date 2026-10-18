// Buduje API dla Vercel Functions: kod workspace (@readyou/*) w jeden plik ESM, zależności z npm
// zewnętrzne (śledzone przez Vercel). Bez `define` — żadne zmienne środowiskowe (sekrety) nie są
// wbudowywane w paczkę; czytane są dopiero w czasie działania z ustawień projektu.
import { build } from 'esbuild';

await build({
  entryPoints: ['apps/api/src/vercel.ts'],
  outfile: 'dist-api/vercel.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  plugins: [
    {
      name: 'external-npm',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) => (args.path.startsWith('@readyou/') ? undefined : { path: args.path, external: true }));
      },
    },
  ],
});
console.log('dist-api/vercel.mjs gotowe');
