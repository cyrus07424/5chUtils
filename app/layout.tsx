import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "5ch Utils",
  description: "5chのスレッドURLをdatファイルに変換してダウンロードし、datファイルを読み込んで表示するツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
