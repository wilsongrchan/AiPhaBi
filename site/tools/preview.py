#!/usr/bin/env python3
"""本機預覽用的靜態伺服器 —— 跟 `python3 -m http.server` 一樣，只多一件事：
每個回應都加 `Cache-Control: no-store`。

為什麼要多這一件事：http.server 不送 Cache-Control 也不送 ETag，瀏覽器就會用
「啟發式快取」自己決定能放多久（大致是檔案已存在時間的 10%）。site.css 跟
try.js 是很久以前建的檔，於是改完重新整理**看不到變化** —— 瀏覽器根本沒發請求。
無痕視窗看得到，因為它的快取是空的。這個症狀很容易誤判成「伺服器沒重開」。

    python3 site/tools/preview.py          # 預設 8099，根目錄是 site/
    python3 site/tools/preview.py 8100
"""
import functools, http.server, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    # 條件請求也要擋掉：瀏覽器帶著 If-Modified-Since 來、伺服器回 304，
    # 收到 304 就是拿快取裡那份舊的。no-store 之後正常不會再發生，
    # 但快取裡已經躺著一份舊的時（Safari 尤其黏）第一次還是會問。
    def send_head(self):
        del self.headers['If-Modified-Since']      # email.Message：沒有就當沒事
        return super().send_head()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    handler = functools.partial(NoCache, directory=ROOT)
    print('預覽： http://localhost:%d/    根目錄：%s' % (port, ROOT))
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
