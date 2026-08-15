const { initDb } = require('./database');

initDb()
  .then(() => console.log('Done. You can now start the bot with: npm start'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
