const { chromium } = require('playwright');

const VIDEO_URL = 'https://www.bilibili.com/video/BV1xx411c7mD/';

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(VIDEO_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);

  const result = await page.evaluate(async () => {
    const player = window.__INITIAL_STATE__?.player;
    const danmakuX = await player?.danmaku?.getDanmakuX?.();
    const dmArray = danmakuX?.manager?.dataBase?.dmArray || [];
    const liked = dmArray.filter((item) => item && item.isHighLike === true);
    const special = dmArray.filter(
      (item) => item && (item.pool !== 0 || item.mode === 8 || item.rawMode === 8 || item.dmFrom === 0)
    );
    const combined = dmArray.filter(
      (item) => item && (item.isHighLike === true || item.pool !== 0 || item.mode === 8 || item.rawMode === 8 || item.dmFrom === 0)
    );

    return {
      href: location.href,
      aid: window.__INITIAL_STATE__?.aid ?? null,
      bvid: window.__INITIAL_STATE__?.bvid ?? null,
      cid: window.__INITIAL_STATE__?.videoData?.cid ?? window.__INITIAL_STATE__?.cid ?? null,
      danmakuMetadata: window.__danmaku_x_metadata__ || null,
      totalDanmaku: dmArray.length,
      highLikeDanmaku: liked.length,
      specialDanmaku: special.length,
      keptDanmaku: combined.length,
      sampleHighLike: liked.slice(0, 10),
      sampleSpecial: special.slice(0, 10),
      sampleNormal: dmArray.filter((item) => item && item.isHighLike !== true).slice(0, 5),
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
