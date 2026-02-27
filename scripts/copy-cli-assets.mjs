import { cp, mkdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

async function existsDir(path) {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function main() {
  const root = resolve(process.cwd());
  const srcAssets = join(root, 'src', 'cli', 'assets');
  const outAssets = join(root, 'dist', 'cli', 'assets');

  if (!(await existsDir(srcAssets))) {
    return;
  }

  await mkdir(outAssets, { recursive: true });
  await cp(srcAssets, outAssets, { recursive: true });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
