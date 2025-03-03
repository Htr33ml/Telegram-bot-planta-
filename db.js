// db.js
const admin = require('firebase-admin');

const serviceAccountKey = process.env.FIREBASE_CONFIG;
if (!serviceAccountKey) {
  console.error("FIREBASE_CONFIG não está definida no ambiente.");
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(serviceAccountKey);
} catch (err) {
  console.error("Erro ao parsear FIREBASE_CONFIG:", err);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
module.exports = db;
