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
    def do_POST(self):
        """例字編輯頁的「儲存」：直接寫回 site/content/examples.md。

        瀏覽器不能寫檔，但這台伺服器可以 —— 省掉「複製再貼回檔案」那一步。
        只接受這一個路徑、只寫這一個檔，不做別的。
        """
        if self.path != "/_review/save":
            self.send_error(404)
            return
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n).decode("utf-8")
        target = ROOT / "content" / "examples.md"
        text = target.read_text("utf-8")
        marker = "# ↓↓↓ 寫在這裡 ↓↓↓"
        head = text.split(marker)[0] + marker + "\n"
        target.write_text(head + "\n" + body.rstrip() + "\n", "utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write(f"已寫入 {target}".encode("utf-8"))

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *a):
        pass                                  # 安靜一點，只在啟動時印一行


def lan_ip():
    """本機在區域網路上的位址，給同一個 Wi-Fi 的手機用。"""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))          # 不會真的送封包，只是問路由要用哪個介面
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    lan = "--lan" in sys.argv                # 開放給同網段的手機看
    port = int(args[0]) if args else 8099
    host = "0.0.0.0" if lan else "127.0.0.1"
    handler = functools.partial(NoCache, directory=str(ROOT))
    with http.server.ThreadingHTTPServer((host, port), handler) as httpd:
        print(f"預覽： http://localhost:{port}/zigen.html   （Ctrl-C 停止）")
        if lan:
            ip = lan_ip()
            print(f"手機： http://{ip}:{port}/zigen.html   （同一個 Wi-Fi）"
                  if ip else "  找不到區域網路位址")
            print("  ⚠️ --lan 會讓同網段的裝置都連得到，用完就關掉")
        print("已關閉快取，一般的重新整理就會拿到最新的 CSS／JS")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
