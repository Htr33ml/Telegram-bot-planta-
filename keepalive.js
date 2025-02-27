// keepalive.js
const express = require("express");
const server = express();

server.all("/", (req, res) => {
  res.send("Bot is running! All good here.");
});

function keepAlive() {
  server.listen(3000, () => {
    console.log("Server is ready to keep Repl alive!");
  });
}

module.exports = keepAlive;