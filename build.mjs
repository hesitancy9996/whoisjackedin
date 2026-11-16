// Builds public/index.html from src/index.html: scripts and styles minified, comments gone, no source maps.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const source = await readFile(new URL('./src/index.html', import.meta.url), 'utf8');

/** The one <style> or <script> block of the page, and where it sits. */
function block(tag) {
  const open = source.indexOf(`<${tag}>`);
  const close = source.lastIndexOf(`</${tag}>`);
  if (open < 0 || close < open || source.indexOf(`<${tag}>`, open + 1) >= 0) throw new Error(`expected exactly one <${tag}> block`);
  return { open, close, body: source.slice(open + tag.length + 2, close) };
}

const style = block('style');
const script = block('script');
const css = (await transform(style.body, { loader: 'css', minify: true, legalComments: 'none' })).code.trim();
// Wrapped in a function so every name can be shortened.
const js = (await transform(`(() => {${script.body}})();`, { minify: true, legalComments: 'none', target: 'es2022' })).code.trim();

const squeeze = (html) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*/g, '').replace(/>\s+</g, '><');
const page =
  squeeze(source.slice(0, style.open)) +
  `<style>${css}</style>` +
  squeeze(source.slice(style.close + 8, script.open)) +
  `<script>${js}</script>` +
  squeeze(source.slice(script.close + 9));

await mkdir(new URL('./public/', import.meta.url), { recursive: true });
await writeFile(new URL('./public/index.html', import.meta.url), page);
console.log(`public/index.html: ${source.length.toLocaleString()} -> ${page.length.toLocaleString()} bytes`);
