// Firebaseと初期のシート設定（本番では別管理推奨）
export const ENV = {
  firebase: {
    apiKey: "AIzaSyDhNmjRF_KO5u_L0lYflzxAm1-8BDVF5lo",
    authDomain: "worker-management-c338c.firebaseapp.com",
    projectId: "worker-management-c338c",
    storageBucket: "worker-management-c338c.firebasestorage.app",
    messagingSenderId: "372287424373",
    appId: "1:372287424373:web:6f4f088546144b1de9353c"
  },
  defaultSite: { siteId: "site1", floorId: "1F" },
  // スプレッドシート既定（UIで上書き可）
  sheetId: "1rT3ztyYNlKVPfpNDd_jfCGSF6qNG3VoCcNuhLM1Tld4",              // 例: "1A2b3C..."
  idColumn: "A",
  hasHeader: false
};
