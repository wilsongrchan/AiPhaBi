"""貼連結 → 抓那頁的可見文字，給「試打」頁當練習文字用。

沒有裝 readability 之類的套件，就用標準庫的 HTMLParser 土法煉鋼：
去掉 script/style/nav/header/footer 這些「不是正文」的標籤，
其餘標籤照原樣灌文字進去，區塊標籤（p/div/li/br…）之間補換行。
抓不準「這是不是廣告／選單」——遇到排版乾淨的文章頁效果最好。
"""
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"

SKIP_TAGS = {"script", "style", "noscript", "template", "svg", "iframe",
             "nav", "header", "footer", "aside", "form", "button"}
BLOCK_TAGS = {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "h5", "h6",
              "tr", "blockquote", "article", "section", "ul", "ol", "table"}


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in SKIP_TAGS:
            self.skip_depth += 1
        elif tag == "br" or tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in SKIP_TAGS and self.skip_depth > 0:
            self.skip_depth -= 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skip_depth:
            self.parts.append(data)


def _normalize_url(url):
    """網址若含中文（維基百科條目常見），到這裡已經被 parse_qs 解成
    未跳脫的真正 Unicode 字元——urllib 組 request line 時要求全 ASCII，
    直接丟給它會炸。這裡把 path/query 重新百分號跳脫回去（用 safe="%"
    避免把既有的 %XX 又跳脫一次），網域則走 IDNA。"""
    p = urllib.parse.urlsplit(url)
    netloc = p.netloc
    if any(ord(ch) > 127 for ch in netloc):
        host, _, port = netloc.partition(":")
        netloc = host.encode("idna").decode("ascii") + (f":{port}" if port else "")
    path = urllib.parse.quote(p.path, safe="/%")
    query = urllib.parse.quote(p.query, safe="=&%")
    fragment = urllib.parse.quote(p.fragment, safe="%")
    return urllib.parse.urlunsplit((p.scheme, netloc, path, query, fragment))


def text_from_url(url, max_bytes=2_000_000, max_chars=20000):
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("只支援 http(s) 連結")
    url = _normalize_url(url)

    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        raw = r.read(max_bytes)
        charset = r.headers.get_content_charset()

    for enc in filter(None, [charset, "utf-8", "big5", "gb18030"]):
        try:
            html = raw.decode(enc)
            break
        except (LookupError, UnicodeDecodeError):
            continue
    else:
        html = raw.decode("utf-8", errors="replace")

    p = _TextExtractor()
    p.feed(html)
    text = "".join(p.parts)

    # 摺疊空白：一行內的連續空白縮成一個，去掉空行，段落之間留一個換行
    lines = [re.sub(r"[ \t　]+", " ", ln).strip() for ln in text.splitlines()]
    lines = [ln for ln in lines if ln]
    text = "\n".join(lines)
    if len(text) > max_chars:
        text = text[:max_chars]
    return text


if __name__ == "__main__":
    import sys
    print(text_from_url(sys.argv[1])[:2000])
