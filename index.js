const cheerio = require('cheerio');
const debug = require('debug')('aib-scraper');
const moment = require('moment');
const { Builder, By, until } = require('selenium-webdriver');
const chrome = require('selenium-webdriver/chrome');

const defaultConfig = {
  url: 'https://onlinebanking.aib.ie/inet/roi/login.htm?',
  browser: 'chrome',
};

module.exports = {
  get: async (_config) => {
    const config = Object.assign(defaultConfig, _config);
    const driver = new Builder()
      .forBrowser(config.browser)
      .setChromeOptions(new chrome.Options().headless().windowSize({ width: 1000, height: 400 }))
      .build();

    const getElement = async (selector) => {
      debug(`getElement:${selector}`);
      const by = selector.startsWith('/') ? By.xpath(selector) : By.id(selector);
      await driver.wait(until.elementLocated(by));
      return driver.wait(until.elementIsVisible(driver.findElement(by)));
    };

    const getContent = async (selector) => {
      debug(`getContent:${selector}`);
      const element = await getElement(selector);
      return element.getAttribute('innerHTML');
    };

    const click = async (selector) => {
      debug(`click:${selector}`);
      const element = await getElement(selector);
      await element.click();
    };

    const getAmountFromText = (text) => (text.match(/DR/) ? -1 : 1) * parseFloat(text.replace(/[^0-9.-]/g, ''));

    const result = [];

    // navigate to url
    await driver.get(config.url);

    // debug('click accept cookies');
    // await getElement('acceptCookies');
    // click('acceptCookies');

    debug('click tab_limited_access');
    await getElement('tab_limited_access');
    click('tab_limited_access');

    debug('click limited-login');
    click('limited-login');

    // wait for registration number input visibility
    await getElement('username');

    // set registration number input value
    debug('set login details');
    await driver.executeScript((login, password) => {
      document.getElementById('username').value = login;
      document.getElementById('password').value = password;
    }, config.login, config.password);

    click('//a[contains(@class, "ping-button") and contains(@class, "allow")]');

    // list accounts
    debug('list account');
    const accountIds = [];
    let content = await getContent('//ul[contains(@class, "accounts-list")]');
    let $ = cheerio.load(content);

    $('div.account-name').each((i, a) => {
      accountIds.push($(a).text().trim());
    });

    for (let index = 0; index < accountIds.length; index += 1) {
      const id = accountIds[index];
      debug(`get account: ${id}`);

      // click account
      await click(`//div[contains(@class, "account-name") and contains(text(), "${id}")]`);

      // wait for account page visibility
      await getElement('//div[contains(@class, "rsvp")]');

      const nameElement = await getContent('//div[contains(@class, "main-column-left")]/h2');

      // detect account type (current,savings,creditcard)
      const mainElement = await getContent('//div[contains(@class, "rsvp")]');
      let pageType = 'current';
      if (mainElement.match(/summary-panel x3/gi)) {
        pageType = 'creditcard';
      } else if ((mainElement.match(/summary-panel x1/gi) || []).length === 1) {
        pageType = 'savings';
      }

      debug(`Page type: ${pageType}`);

      // balance
      let balanceElement;
      let availableElement;
      if (pageType === 'creditcard' || pageType === 'current') {
        balanceElement = await getContent('//ul[contains(@class, "summary-panel")]/li[2]/em');
        availableElement = await getContent('//ul[contains(@class, "summary-panel")]/li[1]/em');
      } else {
        balanceElement = await getContent('//ul[contains(@class, "summary-panel")]/li[1]/em');
        availableElement = await getContent('//ul[contains(@class, "summary-panel")]/li[1]/em');
      }

      const account = {
        name: nameElement.split('<')[0].trim(),
        balance: getAmountFromText(balanceElement),
        available: getAmountFromText(availableElement),
        transactions: { done: [], pending: [] },
      };

      content = await getContent('//body');
      $ = cheerio.load(content);

      if ($('#showMore_button_id').length) {
        // click show more
        click('//button[@id="showMore_button_id"]');

        // wait for account summary visibility
        await getElement('//ul[contains(@class, "summary-panel")]');

        content = await getContent('//body');
        $ = cheerio.load(content);
      }

      $('.transaction-table').each((i, table) => {
        const isPendingTable = i === 0;

        let date;
        $(table).find('tr, ul').each((j, row) => {
          if ($(row).hasClass('date-row')) {
            date = moment(
              $(row).text().trim().split('\t')[0],
              ['dddd, Do MMMM YY', 'DD/MM/YYYY', 'x'],
            )
              .format('YYYY-MM-DD');
          } else {
            const transaction = { date };
            if ($(row).find('.credit').length) {
              transaction.name = $(row).find('.forceWrap').text();
              transaction.amount = getAmountFromText($(row).find('.credit').first().text());
            } else if ($(row).find('.debit').length) {
              transaction.name = $(row).find('.forceWrap').text();
              transaction.amount = getAmountFromText($(row).find('.debit').first().text());
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

      // click main logo
      click('//div[contains(@class, "navLogo")]');
    }

    await getContent('//ul[contains(@class, "accounts-list")]');

    if (!config.keepItOpen) {
      driver.quit();
    }
    return result;
  },
};
