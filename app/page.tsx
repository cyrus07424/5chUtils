'use client';

import { useState } from 'react';
import * as Encoding from 'encoding-japanese';
import DOMPurify from 'isomorphic-dompurify';

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
  const [isDatOchi, setIsDatOchi] = useState(false);
  const [htmlUrl, setHtmlUrl] = useState('');
  const [isConverting, setIsConverting] = useState(false);

  // Convert 5ch thread URL to dat URL
  const convertToDatUrl = (url: string, isDatOchi: boolean): string | null => {
    try {
      // Example URL: https://[server].5ch.net/test/read.cgi/[board]/[thread_id]/
      const match = url.match(/https?:\/\/([^\/]+)\.([^\/]+)\/test\/read\.cgi\/([^\/]+)\/(\d+)/);
      if (match) {
        const [, server, domain, board, threadId] = match;
        
        // Validate threadId has sufficient length for substring operations
        if (threadId.length < 5) {
          return null;
        }
        
        if (isDatOchi) {
          // Archived thread logic based on Chaika addon
          if (domain === '5ch.net' || domain === 'bbspink.com') {
            // 2023/07/11: 5ch.net の新仕様
            const first4 = threadId.substring(0, 4);
            return `https://${server}.${domain}/${board}/oyster/${first4}/${threadId}.dat`;
          } else {
            // For other 2ch type boards
            const first4 = threadId.substring(0, 4);
            const first5 = threadId.substring(0, 5);
            return `https://${server}.${domain}/${board}/kako/${first4}/${first5}/${threadId}.dat`;
          }
        } else {
          // Standard thread URL
          return `https://${server}.${domain}/${board}/dat/${threadId}.dat`;
        }
      }
      return null;
    } catch (e) {
      return null;
    }
  };

  // Handle URL conversion
  const handleConvert = () => {
    setError('');
    const converted = convertToDatUrl(threadUrl, isDatOchi);
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
        // CORS error detected - open URL in new tab as fallback
        setError('CORSエラーのため、ブラウザでダウンロードできません。新しいタブでdatファイルを開きます。');
        window.open(datUrl, '_blank', 'noopener,noreferrer');
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
        const message = parts[3]; // Keep HTML tags as-is for rendering

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

  // HTML to DAT conversion functions (ported from Python script)
  const stripTagsKeepBrA = (bodyHtml: string): string => {
    // Remove wbr tags
    bodyHtml = bodyHtml.replace(/<\/?wbr\s*\/?>/gi, '');
    // Normalize br tags
    bodyHtml = bodyHtml.replace(/<br\s*\/?>/gi, '<br>');

    // Extract and preserve anchor tags
    const anchors: string[] = [];
    // Use [\s\S] instead of 's' flag for cross-line matching
    bodyHtml = bodyHtml.replace(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi, (match, attrs, inner) => {
      const hrefMatch = attrs.match(/\bhref="([^"]+)"/i);
      const href = hrefMatch ? hrefMatch[1] : '';
      const tag = href ? `<a href="${href}">${inner}</a>` : inner;
      anchors.push(tag);
      return `\x00A${anchors.length - 1}\x00`;
    });

    // Replace br with placeholder
    bodyHtml = bodyHtml.replace(/<br>/g, '\x00BR\x00');
    
    // Remove all other HTML tags
    bodyHtml = bodyHtml.replace(/<[^>]+>/g, '');
    
    // Remove carriage returns
    bodyHtml = bodyHtml.replace(/\r/g, '');
    
    // Restore br tags
    bodyHtml = bodyHtml.replace(/\x00BR\x00/g, '<br>');
    
    // Restore anchor tags
    bodyHtml = bodyHtml.replace(/\x00A(\d+)\x00/g, (match, index) => {
      return anchors[parseInt(index)];
    });
    
    // Clean up whitespace
    bodyHtml = bodyHtml.replace(/[ \t\f\v]+/g, ' ');
    bodyHtml = bodyHtml.replace(/ ?<br> ?/g, '<br>');
    
    return bodyHtml.trim();
  };

  const extractNameAndMail = (postHtml: string): { name: string; mail: string } => {
    let mail = '';
    const mailMatch = postHtml.match(/href="mailto:([^"]*)"/i);
    if (mailMatch) {
      mail = unescapeHtml(mailMatch[1]).trim();
    }

    let name = '';
    // Use [\s\S] instead of 's' flag for cross-line matching
    const usernameMatch = postHtml.match(/<span\s+class="postusername">([\s\S]*?)<\/span>/i);
    if (usernameMatch) {
      const block = usernameMatch[1];
      const anchorMatch = block.match(/>([^<]+)<\/a>/i);
      if (anchorMatch) {
        name = anchorMatch[1];
      } else {
        name = block.replace(/<[^>]+>/g, '');
      }
    }
    name = unescapeHtml(name).trim();
    
    return { name, mail };
  };

  const unescapeHtml = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  };

  const parseHtmlPosts = (htmlText: string): Post[] => {
    const posts: Post[] = [];
    const divPostRegex = /<div\s+id="(\d+)"[^>]*\bclass="[^"]*\bpost\b[^"]*"[^>]*>/gi;
    const matches = Array.from(htmlText.matchAll(divPostRegex));
    
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const start = match.index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : htmlText.length;
      const block = htmlText.substring(start, end);

      const { name, mail } = extractNameAndMail(block);
      
      const dateMatch = block.match(/<span\s+class="date">\s*([^<]+?)\s*<\/span>/i);
      const date = dateMatch ? unescapeHtml(dateMatch[1]).trim() : '';
      
      const uidMatch = block.match(/<span\s+class="uid">\s*ID:([^<]+?)\s*<\/span>/i);
      const id = uidMatch ? unescapeHtml(uidMatch[1]).trim() : '';
      
      // Use [\s\S] instead of 's' flag for cross-line matching
      const contentMatch = block.match(/<section\s+class="post-content">([\s\S]*?)<\/section>/i);
      const bodyHtml = contentMatch ? contentMatch[1] : '';
      const message = stripTagsKeepBrA(bodyHtml);

      posts.push({
        name: name || '',
        mail,
        date,
        id,
        message,
      });
    }
    
    return posts;
  };

  const extractThreadKey = (htmlText: string): string => {
    const canonicalMatch = htmlText.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i);
    if (canonicalMatch) {
      const canonical = canonicalMatch[1];
      const keyMatch = canonical.match(/\/read\.cgi\/[^\/]+\/(\d+)\//);
      if (keyMatch) {
        return keyMatch[1];
      }
    }
    return '';
  };

  const convertHtmlToDat = (htmlText: string): { datContent: string; threadKey: string } => {
    const posts = parseHtmlPosts(htmlText);
    const threadKey = extractThreadKey(htmlText);
    
    const datLines = posts.map(p => {
      return `${p.name}<>${p.mail}<>${p.date}${p.id ? ' ID:' + p.id : ''}<>${p.message}<>`;
    });
    
    const datContent = datLines.join('\n') + (datLines.length > 0 ? '\n' : '');
    
    return { datContent, threadKey };
  };

  // Handle HTML URL conversion
  const handleHtmlConvert = async () => {
    if (!htmlUrl) {
      setError('URLを入力してください。');
      return;
    }

    setError('');
    setIsConverting(true);
    
    try {
      // Try to fetch the HTML directly first
      let htmlText: string;
      
      try {
        const response = await fetch(htmlUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch');
        }
        
        // Read as bytes and decode as Shift_JIS
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Try to decode as Shift_JIS (cp932)
        const detectedEncoding = Encoding.detect(uint8Array);
        let text: string;
        
        if (detectedEncoding === 'SJIS' || detectedEncoding === 'EUCJP') {
          const unicodeArray = Encoding.convert(uint8Array, {
            to: 'UNICODE',
            from: detectedEncoding
          });
          text = Encoding.codeToString(unicodeArray);
        } else {
          // Assume Shift_JIS for kako sites
          const unicodeArray = Encoding.convert(uint8Array, {
            to: 'UNICODE',
            from: 'SJIS'
          });
          text = Encoding.codeToString(unicodeArray);
        }
        
        htmlText = text;
      } catch (fetchError) {
        // If direct fetch fails (likely CORS), try using a CORS proxy
        setError('直接アクセスできませんでした。CORSプロキシを試しています...');
        
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(htmlUrl)}`;
        const response = await fetch(proxyUrl);
        
        if (!response.ok) {
          throw new Error('プロキシ経由でもHTMLの取得に失敗しました。');
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        const detectedEncoding = Encoding.detect(uint8Array);
        let text: string;
        
        if (detectedEncoding === 'SJIS' || detectedEncoding === 'EUCJP') {
          const unicodeArray = Encoding.convert(uint8Array, {
            to: 'UNICODE',
            from: detectedEncoding
          });
          text = Encoding.codeToString(unicodeArray);
        } else {
          const unicodeArray = Encoding.convert(uint8Array, {
            to: 'UNICODE',
            from: 'SJIS'
          });
          text = Encoding.codeToString(unicodeArray);
        }
        
        htmlText = text;
      }
      
      // Convert HTML to DAT
      const { datContent, threadKey } = convertHtmlToDat(htmlText);
      
      if (!datContent) {
        setError('HTMLの解析に失敗しました。過去ログサイトのHTMLか確認してください。');
        setIsConverting(false);
        return;
      }
      
      // Convert DAT content to Shift_JIS and download
      const datBytes = Encoding.convert(Encoding.stringToCode(datContent), {
        to: 'SJIS',
        from: 'UNICODE'
      });
      
      const blob = new Blob([new Uint8Array(datBytes)], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${threadKey || 'thread'}.dat`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      setError('');
      setIsConverting(false);
      
      // Also parse and display the posts
      const parsedPosts = parseHtmlPosts(htmlText);
      setPosts(parsedPosts);
    } catch (e) {
      setError(`エラーが発生しました: ${e instanceof Error ? e.message : '不明なエラー'}`);
      setIsConverting(false);
    }
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
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="isDatOchi"
                  checked={isDatOchi}
                  onChange={(e) => setIsDatOchi(e.target.checked)}
                  className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <label htmlFor="isDatOchi" className="ml-2 text-sm font-medium text-gray-700">
                  dat落ちしている（過去ログ）
                </label>
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

          {/* HTML to DAT converter */}
          <div className="mb-8 border-t pt-8">
            <h2 className="text-xl font-semibold text-gray-700 mb-4">
              過去ログサイトのHTMLをdatファイルに変換
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  過去ログサイトのURL
                </label>
                <input
                  type="text"
                  value={htmlUrl}
                  onChange={(e) => setHtmlUrl(e.target.value)}
                  placeholder="https://kako.5ch.net/..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <button
                onClick={handleHtmlConvert}
                disabled={isConverting}
                className={`w-full ${
                  isConverting
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-purple-500 hover:bg-purple-600'
                } text-white py-2 px-4 rounded-lg transition-colors`}
              >
                {isConverting ? '変換中...' : 'HTMLを取得してdatファイルに変換・ダウンロード'}
              </button>
              <p className="text-xs text-gray-500">
                ※ 5chの過去ログサイトのHTMLを自動的に取得・解析してdatファイルに変換します
              </p>
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
                        <span 
                          className="font-medium text-green-600"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.name) }}
                        />
                        {post.mail && <span className="text-gray-500">[{post.mail}]</span>}
                        <span className="text-gray-500">{post.date}</span>
                        {post.id && <span className="text-blue-600">ID:{post.id}</span>}
                      </div>
                      <div 
                        className="mt-2 text-gray-800 break-words"
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.message) }}
                      />
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
