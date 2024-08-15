# aib-scraper [![Codacy Badge](https://api.codacy.com/project/badge/Grade/05c9c274ff624ae68f9805fe7b55ea3a)](https://www.codacy.com/app/fabrice404/aib-scraper?utm_source=github.com&amp;utm_medium=referral&amp;utm_content=fabrice404/aib-scraper&amp;utm_campaign=Badge_Grade)

Download balance and latest transactions from AIB's website.

## Getting Started

### Usage

```javascript
const aib = require('aib-scraper');

const result = await aib.get({
  login:    'YOUR LOGIN',
  password: 'YOUR PASSWORD',
});
```

## Built With

* [Puppeteer](https://www.npmjs.com/package/puppeteer): browser automation library
* [Cheerio](https://www.npmjs.com/package/cheerio): jQuery implementation in Node.js

## License

This project is licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0)
