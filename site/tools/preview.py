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


# ---------- 本機預覽的圖示改成灰階 ----------
# 分頁上同時開著本機預覽與線上站時，兩個圖示長得一模一樣，很容易改錯地方、或者
# 把本機的畫面當成已經上線的樣子（Wilson）。本機這一份轉成灰階，一眼就分得出來。
#
# ⚠️ 只在這支預覽伺服器裡做，不改 HTML、不改 site/assets 裡的檔案 —— 線上站與
# 版控裡的圖示完全不受影響。灰階圖是啟動時算一次放在記憶體裡，不落地。
_GRAY = {}


def _grayscale(path):
    """把圖示轉成灰階；沒有 Pillow 就回 None，照原樣送出。"""
    if path in _GRAY:
        return _GRAY[path]
    try:
        from PIL import Image
        import io as _io
        im = Image.open(path).convert('RGBA')
        rgb = im.convert('L').convert('RGBA')      # 去色
        rgb.putalpha(im.getchannel('A'))           # 圓角的透明度要留著
        buf = _io.BytesIO()
        rgb.save(buf, 'PNG', optimize=True)
        _GRAY[path] = buf.getvalue()
    except Exception as e:
        print('  灰階圖示做不出來（%s）—— 照原樣送出' % e)
        _GRAY[path] = None
    return _GRAY[path]


class NoCacheGrayIcon(NoCache):
    ICONS = ('/assets/img/favicon-32.png', '/assets/img/favicon-512.png',
             '/assets/img/logo-512.png', '/assets/img/logo-180.png')

    def do_GET(self):
        if self.path.split('?')[0] in self.ICONS:
            data = _grayscale(os.path.join(ROOT, self.path.split('?')[0].lstrip('/')))
            if data:
                self.send_response(200)
                self.send_header('Content-Type', 'image/png')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
                return
        return super().do_GET()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    handler = functools.partial(NoCacheGrayIcon, directory=ROOT)
    print('預覽： http://localhost:%d/    根目錄：%s' % (port, ROOT))
    print('（分頁圖示是灰階的 —— 這樣一眼看得出哪一個分頁是本機、哪一個是線上站）')
    http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
