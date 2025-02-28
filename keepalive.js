// keepalive.js
const express = require("express");
const app = express();

app.all("/", (req, res) => {
  res.send("Bot is running! All good here.");
});

function keepAlive() {
  app.listen(3000, () => {
    console.log("Server is ready to keep the app alive!");
  });
}

module.exports = keepAlive;
