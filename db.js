// db.js
const admin = require('firebase-admin');

// Lê a variável de ambiente contendo o JSON do service account
const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;

if (!serviceAccountKey) {
  console.error("FIREBASE_SERVICE_ACCOUNT_KEY não está definida no ambiente.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountKey);
} catch (err) {
  console.error("Erro ao parsear FIREBASE_SERVICE_ACCOUNT_KEY:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = db;
