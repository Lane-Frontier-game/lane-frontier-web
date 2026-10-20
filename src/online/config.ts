/**
 * Firebase コンソールの「プロジェクトの設定 → マイアプリ」で表示される値を入力。
 * これはクライアントアプリの識別情報であり、秘密鍵ではありません。
 * サービスアカウントの秘密鍵などは絶対に入れないでください。
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyDb-XaFGDdNDw7VW0yHmwdmoiOGfs5oq0c',
  authDomain: 'lane-frontier-online-7bf0e.firebaseapp.com',
  databaseURL: 'https://lane-frontier-online-7bf0e-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'lane-frontier-online-7bf0e',
  storageBucket: 'lane-frontier-online-7bf0e.firebasestorage.app',
  messagingSenderId: '315372921086',
  appId: '1:315372921086:web:b81a38dd416f461ad8c5af',
}

export const isOnlineConfigured = Object.values(firebaseConfig).every(Boolean)
