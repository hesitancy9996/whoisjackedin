// Builds the page into public/: the script bundled and minified, the styles minified, comments gone, no source maps.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'public');
const SCRIPT_TAG = '<script defer src="/assets/app.js"></script>';

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'assets'), { recursive: true });
await cp(path.join(root, 'src', 'icons'), path.join(out, 'assets', 'icons'), { recursive: true });

// The page script and the chart library become one file. Its name carries a hash, so browsers can keep it for good.
const bundle = await build({
  entryPoints: [path.join(root, 'src', 'app.js')],
  outdir: path.join(out, 'assets'),
  entryNames: 'app-[hash]',
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2022',
  legalComments: 'none',
  banner: { js: '/*! Charts by Apache ECharts and ZRender. Their licenses: /assets/licenses.txt */' },
  metafile: true,
});
const script = path.basename(Object.keys(bundle.metafile.outputs).find((name) => name.endsWith('.js')));

// The chart library's license asks that its notices travel with it.
const notice = async (title, ...file) => `${title}\n${'='.repeat(title.length)}\n\n${(await readFile(path.join(root, 'node_modules', ...file), 'utf8')).trim()}\n`;
await writeFile(
  path.join(out, 'assets', 'licenses.txt'),
  [
    await notice('Apache ECharts', 'echarts', 'LICENSE'),
    await notice('Apache ECharts, notice', 'echarts', 'NOTICE'),
    await notice('ZRender', 'zrender', 'LICENSE'),
  ].join('\n\n'),
);

const source = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
const open = source.indexOf('<style>');
const close = source.lastIndexOf('</style>');
if (open < 0 || close < open || !source.includes(SCRIPT_TAG)) throw new Error('src/index.html needs one <style> block and the app script tag');
const css = (await transform(source.slice(open + 7, close), { loader: 'css', minify: true, legalComments: 'none' })).code.trim();

const squeeze = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*/g, '').replace(/>\s+</g, '><');
const page = squeeze(source.slice(0, open)) + `<style>${css}</style>` + squeeze(source.slice(close + 8)).replace(SCRIPT_TAG, `<script defer src="/assets/${script}"></script>`);
await writeFile(path.join(out, 'index.html'), page);

const size = async (...file) => `${Math.round((await readFile(path.join(out, ...file))).length / 1024)} KB`;
console.log(`public/index.html ${await size('index.html')}, public/assets/${script} ${await size('assets', script)}`);
