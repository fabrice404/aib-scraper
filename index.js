const cheerio = require("cheerio");
const Debug = require("debug");
const moment = require("moment");
const puppeteer = require("puppeteer");

const debug = Debug("aib-scraper");

const getAmountFromText = (text) => (text.match(/DR/) ? -1 : 1) * parseFloat(text.replace(/[^0-9.-]/g, ""));

const get = async (_config) => {
  const result = [];

  const browser = await puppeteer.launch({
    headless: _config.headless != null ? _config.headless : true,
    defaultViewport: null,
  });
  const page = await browser.newPage();
  await page.goto("https://onlinebanking.aib.ie/inet/roi/login.htm?");

  await page.locator("#tab_limited_access").wait();
  await page.locator("#tab_limited_access").click();

  await page.locator("#limited-login").click();

  await page.locator("#username").wait();

  debug("Setting username");
  page.locator("#username").fill(_config.login);

  await new Promise(resolve => setTimeout(resolve, 300));

  debug("Setting password");
  page.locator("#password").fill(_config.password);

  debug("Wait for 300ms");
  await new Promise(resolve => setTimeout(resolve, 300));

  debug("Clicking login button");
  await page.locator("a.ping-button.allow").click();

  debug("Waiting for accounts list");
  await page.waitForSelector("ul.accounts-list");
  let content = await page.$eval("ul.accounts-list", el => el.innerHTML);
  let $ = cheerio.load(content);

  debug("Getting account ids");
  const accountIds = [];
  $("div.account-name").each((i, a) => {
    accountIds.push($(a).text().trim());
  });
  debug("   -->", accountIds);

  for (let accountIndex = 0; accountIndex < accountIds.length; accountIndex++) {
    const accountId = accountIds[accountIndex];

    debug("Clicking account link: ", accountId);
    const accountElement = await page.waitForSelector(`::-p-xpath(//div[contains(@class, "account-name") and contains(text(), "${accountId}")])`);
    await accountElement.click();

    debug("Wait for 300ms");
    await new Promise(resolve => setTimeout(resolve, 500));

    debug("Waiting for account page to load");
    const mainElement = await page.waitForSelector("::-p-xpath(//main[contains(@class, \"contentwrapper\")])");
    const mainContent = (await mainElement.evaluate(el => el.innerHTML)).trim();

    debug("Checking account type");
    let pageType = "current";
    if (mainContent.match(/summary-panel x3/gi)) {
      pageType = "creditcard";
    } else if ((mainContent.match(/summary-panel x1/gi) || []).length === 1) {
      pageType = "savings";
    }

    debug("   -->", pageType);

    debug("Finding account name");
    const nameElement = await page.waitForSelector("::-p-xpath(//div[contains(@class, \"main-column-left\")]/h2)");

    debug("Finding account balances");
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
      available: getAmountFromText(availableContent),
      transactions: { done: [], pending: [] },
    };

    debug("Extracting page content");
    content = await page.$eval("body", el => el.innerHTML);
    $ = cheerio.load(content);

    debug("Checking for show more button");
    if ($("#showMore_button_id").length) {

      debug("Clicking show more button");
      // click show more
      await page.locator("button#showMore_button_id").click();

      // wait for account summary visibility
      await page.waitForSelector("::-p-xpath(//ul[contains(@class, \"summary-panel\")])");

      debug("Extracting page content");
      content = await page.$eval("body", el => el.innerHTML);
      $ = cheerio.load(content);
    }

    debug("Getting transactions");
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

    $(".transactionsListItems").each((i, section) => {
      const isPending = false; // i === 0;

      let date;
      $(section).find("div").each((j, row) => {
        if ($(row).hasClass("transactionsDate")) {
          date = moment(
            $(row).text().trim().split("\t")[0],
            ["dddd, Do MMMM YY", "DD/MM/YYYY", "x"],
          )
            .format("YYYY-MM-DD");
        } else {
          const transaction = { date };
          transaction.name = $(row).find(".transactionDesc").text();
          transaction.amount = getAmountFromText($(row).find(".paidOut.r-hide").text() + $(row).find(".paidIn.r-hide").text());

          if (transaction.amount) {
            if (isPending) {
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
