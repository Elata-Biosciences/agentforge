import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const root = resolve(process.cwd());
  const src = join(root, 'dashboard-app', 'dist');
  const dest = join(root, 'src', 'cli', 'assets', 'dashboard-app');

  if (!(await isDir(src))) {
    throw new Error(`dashboard-app dist missing at: ${src} (run pnpm -C dashboard-app build)`);
  }

  // Replace the whole directory so hidden files like `.vite/manifest.json` are always in sync.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });
  // Copy the *contents* of dist into dest (including dotfiles/dirs).
  await cp(join(src, '.'), dest, { recursive: true });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
