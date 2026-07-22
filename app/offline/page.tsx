export const metadata = {
  title: 'オフライン | Sugi Sale Logger',
};

export default function OfflinePage() {
  return (
    <main className="offline-page">
      <section className="offline-card">
        <img src="/icon-192.png" width="96" height="96" alt="Sugi Sale Logger" />
        <p className="offline-eyebrow">OFFLINE</p>
        <h1>現在オフラインです</h1>
        <p>
          通信が戻ったら、もう一度開いてください。すでに画面上で記録した販売データは端末内に保存され、オンライン復帰後に自動送信されます。
        </p>
        <a href="/">再接続する</a>
      </section>
    </main>
  );
}
