const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/server.ts'],
    bundle: true,
    format: 'cjs', // must be CJS same as extension host
    platform: 'node',
    outfile: 'dist/server.js',
    external: [
      // exclude native node modules
      'vscode',
    ],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  });

  if (watch) {
    await ctx.watch();
    console.log('LSP server watching for changes...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log('LSP server built.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
