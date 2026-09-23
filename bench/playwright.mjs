/** Playwright を探して読みこむ。プロジェクトの依存には入れていない(CI でブラウザまで落とさないため) */
async function find() {
  try { return await import('playwright'); } catch { /* 次を試す */ }
  const { execSync } = await import('node:child_process');
  const globalRoot = execSync('npm root -g').toString().trim();
  try { return await import(`${globalRoot}/playwright/index.mjs`); } catch { /* 下で案内 */ }
  console.error('Playwright が見つかりません。 npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}
export const { chromium } = await find();
