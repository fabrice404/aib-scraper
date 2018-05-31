const cheerio = require('cheerio');
const { Builder, By, until } = require('selenium-webdriver');

const defaultConfig = {
  url: 'https://onlinebanking.aib.ie/inet/roi/login.htm',
  browser: 'chrome',
};

module.exports = {
  get: async (_config) => {
    const config = Object.assign(defaultConfig, _config);
    const driver = new Builder()
      .forBrowser(config.browser)
      .build();

    const getElement = async (selector) => {
      const by = selector.startsWith('/') ? By.xpath(selector) : By.id(selector);
      await driver.wait(until.elementLocated(by));
      return driver.wait(until.elementIsVisible(driver.findElement(by)));
    };

    const getContent = async (selector) => {
      const element = await getElement(selector);
      return element.getAttribute('innerHTML');
    };

    const click = async (selector) => {
      const element = await getElement(selector);
      await element.click();
    };

    const getAmountFromText = text => parseFloat(text.replace(/[^0-9.-]/g, ''));

    const result = [];

    try {
      // navigate to url
      await driver.get(config.url);

      // wait for registration number input visibility
      await getElement('regNumber_id');

      // set registration number input value
      await driver.executeScript((login) => {
        document.getElementById('regNumber_id').value = login;
      }, config.login);

      // click next button
      click('nextButton');

      // get digits to set
      const setDigit = async (n) => {
        const element = await getElement(`//label[@for="digit${n}Text"]/strong`);
        const html = await element.getAttribute('innerHTML');
        const digit = parseInt(html.replace(/Digit/i, '').trim(), 10);

        await driver.executeScript((num, value) => {
          document.getElementById(`digit${num}Text`).value = value;
        }, n, config.password.charAt(digit - 1));
      };
      await setDigit(1);
      await setDigit(2);
      await setDigit(3);

      // click log in button
      click('nextButton');

      // wait for warning visibility
      // await getElement('//div[contains(@class, "cmsAdvert")]');

      // click continue button
      // click('nextButton');

      // click account
      click('//dt[@class="account-nav"]');

      // wait for account summary visibility
      await getElement('//ul[contains(@class, "summary-panel")]');

      // balance
      const nameElement = await getContent('//div[contains(@class, "main-column-left")]/h2');
      const balanceElement = await getContent('//li[contains(@class, "bg-dark")]/em');
      const availableElement = await getContent('//li[contains(@class, "bg-light")]/em');

      const account = {
        name: nameElement.trim(),
        balance: getAmountFromText(balanceElement),
        available: getAmountFromText(availableElement),
        transactions: { done: [], pending: [] },
      };

      const data = await getContent('//div[contains(@class, "norsvp")]');
      const $ = cheerio.load(data);

      $('.transaction-table').each((i, table) => {
        const isPendingTable = $(table).find('td:contains("Balance")').length === 0;

        let date;
        $(table).find('tr').each((j, row) => {
          if ($(row).hasClass('date-row')) {
            date = $(row).find('.hide-td').text();
          } else {
            const transaction = { date };
            if ($(row).find('.credit:not(.hide-td)').length) {
              transaction.name = $(row).find('.forceWrap').text();
              transaction.amount = getAmountFromText($(row).find('.credit:not(.hide-td)').text());
            } else if ($(row).find('.debit:not(.hide-td)').length) {
              transaction.name = $(row).find('.forceWrap').text();
              transaction.amount = getAmountFromText($(row).find('.debit:not(.hide-td)').text());
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

      if (!config.keepItOpen) {
        driver.quit();
      }
    } catch (ex) {
      throw ex;
    }
    return result;
  },
};
