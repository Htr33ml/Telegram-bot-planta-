const db = require("./db");

(async () => {
  // 1. Salva algo
  await db.set("testeKey", ["funcionou", "123"]);
  console.log("Gravou testeKey no DB!");

  // 2. Lê de volta
  let val = await db.get("testeKey");
  console.log("Valor de testeKey =", val);

  // 3. Lista todas as chaves
  let keys = await db.list();
  console.log("Chaves no DB:", keys);
})();