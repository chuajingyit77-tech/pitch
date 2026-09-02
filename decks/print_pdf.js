// 用本机 Chromium 把打印用 HTML 渲染成 PDF（1024×768 的 4:3 页面，适合 iPad 全屏阅读，带页码页脚）。
// 用法： node decks/print_pdf.js <in.html> <out.pdf> "<页脚左侧文字>"
// 依赖： playwright-core（npm i playwright-core），Chromium 路径来自 CHROMIUM 环境变量
//        或 Playwright 的默认安装位置。Google Fonts 需要网络；走代理时设置 HTTPS_PROXY。
const path = require('path');
const { chromium } = require('playwright-core');

const [, , inHtml, outPdf, footerLeft = ''] = process.argv;
if (!inHtml || !outPdf) {
  console.error('用法: node decks/print_pdf.js <in.html> <out.pdf> "<页脚左侧文字>"');
  process.exit(1);
}

const executablePath =
  process.env.CHROMIUM ||
  '/opt/pw-browsers/chromium';
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;

(async () => {
  const browser = await chromium.launch({
    executablePath,
    args: ['--ignore-certificate-errors'],
    proxy: proxy ? { server: proxy } : undefined,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1123, height: 794 },
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
  });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve(inHtml), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print', colorScheme: 'light' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const footerTemplate =
    '<div style="width:100%;padding:0 44px;box-sizing:border-box;display:flex;justify-content:space-between;' +
    'font-family:\'WenQuanYi Zen Hei\',\'Noto Sans SC\',\'PingFang SC\',sans-serif;font-size:7.5px;color:#6B7C90;letter-spacing:.04em">' +
    '<span>' + esc(footerLeft) + '</span>' +
    '<span>第 <span class="pageNumber"></span> / <span class="totalPages"></span> 页</span></div>';

  await page.pdf({
    path: outPdf,
    width: '1024px',
    height: '768px',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate,
    margin: { top: '40px', right: '44px', bottom: '46px', left: '44px' },
  });
  await browser.close();
  console.log('PDF 已生成:', outPdf);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
