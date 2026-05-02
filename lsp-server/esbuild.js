const esbuild = require('esbuild');
const fs = require('fs/promises');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const outfile = 'dist/server.js';
const extensionServerOutfile = path.join(
  '..',
  'extension',
  'dist',
  'lsp',
  'server.js'
);

const copyToExtension = {
  name: 'copy-to-extension',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) {
        return;
      }

      await fs.mkdir(path.dirname(extensionServerOutfile), { recursive: true });
      await fs.copyFile(outfile, extensionServerOutfile);
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/server.ts'],
    bundle: true,
    format: 'cjs', // must be CJS same as extension host
    platform: 'node',
    outfile,
    external: [
      // exclude native node modules
      'vscode',
    ],
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    plugins: [copyToExtension],
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
