'use client';

import { useState } from 'react';
import * as Encoding from 'encoding-japanese';

interface Post {
  name: string;
  mail: string;
  date: string;
  id: string;
  message: string;
}

export default function Home() {
  const [threadUrl, setThreadUrl] = useState('');
  const [datUrl, setDatUrl] = useState('');
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState('');

  // Convert 5ch thread URL to dat URL
  const convertToDatUrl = (url: string): string | null => {
    try {
      // Example URL: https://[server].5ch.net/test/read.cgi/[board]/[thread_id]/
      const match = url.match(/https?:\/\/([^\/]+)\.5ch\.net\/test\/read\.cgi\/([^\/]+)\/(\d+)/);
      if (match) {
        const [, server, board, threadId] = match;
        return `https://${server}.5ch.net/${board}/dat/${threadId}.dat`;
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // Handle URL conversion
  const handleConvert = () => {
    setError('');
    const converted = convertToDatUrl(threadUrl);
    if (converted) {
      setDatUrl(converted);
    } else {
      setError('無効なURLです。5chのスレッドURLを入力してください。');
      setDatUrl('');
    }
  };

  // Download dat file
  const handleDownload = async () => {
    if (!datUrl) return;
    
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
      
      const response = await fetch(datUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error('ダウンロードに失敗しました');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = datUrl.split('/').pop() || 'thread.dat';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      setError('');
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setError('ダウンロードがタイムアウトしました。');
      } else {
        setError('ダウンロードに失敗しました。ネットワークエラーまたはCORSの問題の可能性があります。');
      }
    }
  };

  // Parse dat file
  const parseDatFile = (content: string): Post[] => {
    const lines = content.split('\n').filter(line => line.trim());
    const parsedPosts: Post[] = [];

    lines.forEach((line, index) => {
      // dat format: name<>mail<>date ID:id<>message<>title
      // Note: title field appears only on first line but we treat all lines uniformly
      const parts = line.split('<>');
      if (parts.length >= 4) {
        const name = parts[0];
        const mail = parts[1];
        const dateAndId = parts[2];
        const message = parts[3].replace(/<br>/g, '\n');

        // Extract date and ID
        const idMatch = dateAndId.match(/ID:([^\s]+)/);
        const id = idMatch ? idMatch[1] : '';
        const date = dateAndId.replace(/ID:[^\s]+/, '').trim();

        parsedPosts.push({
          name: name || '名無しさん',
          mail,
          date,
          id,
          message,
        });
      }
    });

    return parsedPosts;
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError('');
    setPosts([]);
    
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      // Read file as ArrayBuffer to handle encoding properly
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      // Detect encoding - prioritize SHIFT_JIS for dat files
      const detectedEncoding = Encoding.detect(uint8Array);
      
      // Convert to UTF-8 string
      // If detected as SJIS (SHIFT_JIS), use SJIS conversion
      // Otherwise, treat as UTF-8
      let text: string;
      if (detectedEncoding === 'SJIS') {
        const unicodeArray = Encoding.convert(uint8Array, {
          to: 'UNICODE',
          from: 'SJIS'
        });
        text = Encoding.codeToString(unicodeArray);
      } else {
        // Fall back to UTF-8
        const unicodeArray = Encoding.convert(uint8Array, {
          to: 'UNICODE',
          from: 'UTF8'
        });
        text = Encoding.codeToString(unicodeArray);
      }
      
      const parsedPosts = parseDatFile(text);
      
      if (parsedPosts.length === 0) {
        setError('datファイルの解析に失敗しました。');
        return;
      }
      
      setPosts(parsedPosts);
    } catch (e) {
      setError('ファイルの読み込みに失敗しました。');
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <div className="max-w-4xl mx-auto px-4">
        <div className="bg-white rounded-lg shadow-lg p-8 mb-8">
          <h1 className="text-3xl font-bold text-center text-gray-800 mb-8">
            5ch Utils
          </h1>

          {/* URL to DAT converter */}
          <div className="mb-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              スレッドURLをdatファイルに変換
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  5chスレッドURL
                </label>
                <input
                  type="text"
                  value={threadUrl}
                  onChange={(e) => setThreadUrl(e.target.value)}
                  placeholder="https://example.5ch.net/test/read.cgi/board/1234567890/"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={handleConvert}
                className="w-full bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors"
              >
                datURLに変換
              </button>
              {datUrl && (
                <div className="space-y-2">
                  <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-1">datファイルURL:</p>
                    <p className="text-sm text-gray-600 break-all">{datUrl}</p>
                  </div>
                  <button
                    onClick={handleDownload}
                    className="w-full bg-green-500 text-white py-2 px-4 rounded-lg hover:bg-green-600 transition-colors"
                  >
                    datファイルをダウンロード
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* DAT file upload and display */}
          <div>
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              datファイルをアップロードして表示
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  datファイルを選択
                </label>
                <input
                  type="file"
                  accept=".dat"
                  onChange={handleFileUpload}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Display posts */}
        {posts.length > 0 && (
          <div className="bg-white rounded-lg shadow-lg p-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              スレッド内容 ({posts.length}レス)
            </h2>
            <div className="space-y-4">
              {posts.map((post, index) => (
                <div key={index} className="border-b border-gray-200 pb-4 last:border-b-0">
                  <div className="flex items-start space-x-2 mb-2">
                    <span className="text-sm font-semibold text-gray-700">{index + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 text-sm">
                        <span className="font-medium text-green-600">{post.name}</span>
                        {post.mail && <span className="text-gray-500">[{post.mail}]</span>}
                        <span className="text-gray-500">{post.date}</span>
                        {post.id && <span className="text-blue-600">ID:{post.id}</span>}
                      </div>
                      <div className="mt-2 text-gray-800 whitespace-pre-wrap break-words">
                        {post.message}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <footer className="text-center text-gray-400 mt-8">
        &copy; 2026 <a href="https://github.com/cyrus07424" target="_blank" className="hover:text-gray-600">cyrus</a>
      </footer>
    </div>
  );
}
