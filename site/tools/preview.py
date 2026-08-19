#!/usr/bin/env python3
"""本機預覽伺服器 —— 跟 python3 -m http.server 一樣，只多做一件事：叫瀏覽器不要快取。

為什麼需要：改 CSS／JS 之後用一般的重新整理，瀏覽器常常還是拿舊的檔案，
看起來就像「改了沒生效」。Safari 尤其明顯，而它的強制重載是 ⌥⌘R
（⇧⌘R 是閱讀器模式，不是重載）。與其記快捷鍵，不如讓伺服器直接說不要快取。

用法：
    python3 site/tools/build_site_data.py && python3 site/tools/preview.py
"""
import functools
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *a):
        pass                                  # 安靜一點，只在啟動時印一行


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8099
    handler = functools.partial(NoCache, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as httpd:
        print(f"預覽： http://localhost:{port}/zigen.html   （Ctrl-C 停止）")
        print("已關閉快取，一般的重新整理就會拿到最新的 CSS／JS")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
