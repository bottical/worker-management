// Firebaseと初期のシート設定（本番では別管理推奨）
export const ENV = {
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "000000000000",
    appId: "1:000000000000:web:XXXXXXXXXXXXXX",
  },
  defaultSite: { siteId: "site1", floorId: "1F" },
  // スプレッドシート既定（UIで上書き可）
  sheetId: "",              // 例: "1A2b3C..."
  idColumn: "A",
  hasHeader: true,
};
