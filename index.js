const cheerio = require("cheerio");
const moment = require("moment");
const puppeteer = require("puppeteer");

const getAmountFromText = (text) => (text.match(/DR/) ? -1 : 1) * parseFloat(text.replace(/[^0-9.-]/g, ""));

const get = async (_config) => {
  const result = [];

  const browser = await puppeteer.launch({
    headless: _config.headless || true,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.goto("https://onlinebanking.aib.ie/inet/roi/login.htm?");

  await page.locator("#tab_limited_access").wait();
  await page.locator("#tab_limited_access").click();

  await page.locator("#limited-login").click();

  await page.locator("#username").wait();

  page.locator("#username").fill(_config.login);

  await new Promise(resolve => setTimeout(resolve, 300));

  page.locator("#password").fill(_config.password);

  await new Promise(resolve => setTimeout(resolve, 300));

  await page.locator("a.ping-button.allow").click();

  await page.waitForSelector("ul.accounts-list");
  let content = await page.$eval("ul.accounts-list", el => el.innerHTML);
  let $ = cheerio.load(content);

  const accountIds = [];
  $("div.account-name").each((i, a) => {
    accountIds.push($(a).text().trim());
  });

  for (let accountIndex = 0; accountIndex < accountIds.length; accountIndex++) {
    const accountId = accountIds[accountIndex];

    const accountElement = await page.waitForSelector(`::-p-xpath(//div[contains(@class, "account-name") and contains(text(), "${accountId}")])`);
    await accountElement.click();


    const mainElement = await page.waitForSelector("::-p-xpath(//div[contains(@class, \"rsvp\")])");
    const mainContent = (await mainElement.evaluate(el => el.innerHTML)).trim();

    let pageType = "current";
    if (mainContent.match(/summary-panel x3/gi)) {
      pageType = "creditcard";
    } else if ((mainContent.match(/summary-panel x1/gi) || []).length === 1) {
      pageType = "savings";
    }

    const nameElement = await page.waitForSelector("::-p-xpath(//div[contains(@class, \"main-column-left\")]/h2)");
    let balanceElement;
    let availableElement;
    if (pageType === "creditcard" || pageType === "current") {
      balanceElement = await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")]/li[2]/em)");
      availableElement = await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")]/li[1]/em)");
    } else {
      balanceElement = await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")]/li[1]/em)");
      availableElement = await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")]/li[1]/em)");
    }

    const nameContent = (await nameElement.evaluate(el => el.innerHTML)).trim();
    const balanceContent = (await balanceElement.evaluate(el => el.innerHTML)).trim();
    const availableContent = (await availableElement.evaluate(el => el.innerHTML)).trim();

    const account = {
      name: nameContent.split("<")[0].trim(),
      balance: getAmountFromText(balanceContent),
      availableContent: getAmountFromText(availableContent),
      transactions: { done: [], pending: [] },
    };

    content = await page.$eval("body", el => el.innerHTML);
    $ = cheerio.load(content);

    if ($("#showMore_button_id").length) {
      // click show more
      await page.locator("button#showMore_button_id").click();

      // wait for account summary visibility
      await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")])");

      content = await page.$eval("body", el => el.innerHTML);
      $ = cheerio.load(content);
    }

    $(".transaction-table").each((i, table) => {
      const isPendingTable = i !== $(".transaction-table").length - 1;

      let date;
      $(table).find("tr, ul").each((j, row) => {
        if ($(row).hasClass("date-row")) {
          date = moment(
            $(row).text().trim().split("\t")[0],
            ["dddd, Do MMMM YY", "DD/MM/YYYY", "x"],
          )
            .format("YYYY-MM-DD");
        } else {
          const transaction = { date };
          if ($(row).find(".credit").length) {
            transaction.name = $(row).find(".forceWrap").text();
            transaction.amount = getAmountFromText($(row).find(".credit").first().text());
          } else if ($(row).find(".debit").length) {
            transaction.name = $(row).find(".forceWrap").text();
            transaction.amount = getAmountFromText($(row).find(".debit").first().text());
          }

          if (transaction.amount) {
            if (isPendingTable) {
              account.transactions.pending.push(transaction);
            } else {
              account.transactions.done.push(transaction);
            }
          }
        }
      });
    });

    result.push(account);
    await page.locator("div.navLogo").click();
  }

  browser.close();

  return result;
};

module.exports = { get };
