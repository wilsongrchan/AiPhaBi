#!/usr/bin/env python3
"""產生〈下載〉頁的字根表 PDF——site/assets/downloads/zigen-chart.pdf。

不是另外拼一份靜態表：字根圖是 zigen.js 現畫的 SVG（含高亮筆畫），複刻一份
純文字表會失去這個表最有用的部分，而且會有第三份跟網站版本分岔的風險。這裡
直接用 headless Chrome 對**真正的頁面**列印（emulate print media + page.pdf()），
印出來的就是使用者在瀏覽器上會看到的那張表本身。

⚠️ 這一步**不**掛進 build_site_data.py／CI：Playwright 的 Chromium 有一百多 MB，
Vercel／GitHub Actions 的建置環境沒有裝，硬拉進去會讓每次部署都變慢、還可能
觸發跟 preview.py 那次差不多的環境落差問題。所以產出的 PDF 是**手動跑一次、
直接進版控**的靜態檔案（見 .gitignore 裡的說明），不是「建置時現算」。

字根表大改（新字母、大量新意圖）之後要記得手動重跑、重新提交這個檔案。

用法：

    python3 site/tools/preview.py 8099 &      # 先確保本機有一份最新的網站在跑
    python3 site/tools/build_pdf.py            # 預設打 http://localhost:8099

    pip3 install playwright && playwright install chromium   # 第一次跑才需要
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / "site" / "assets" / "downloads" / "zigen-chart.pdf"


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8099"
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        sys.exit("沒裝 playwright —— 跑：pip3 install playwright && playwright install chromium")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto(f"{base}/zigen.html", wait_until="networkidle", timeout=15000)
        except Exception as e:
            sys.exit(f"打不開 {base}/zigen.html —— 本機預覽有在跑嗎？"
                      f"（python3 site/tools/preview.py 8099）\n{e}")
        # zigen.js 抓 assets/zigen.json 才畫表，networkidle 不保證那次 fetch 的
        # then() 已經跑完——等真正的字母列出現，而不是「載入中……」那個佔位段落。
        page.wait_for_selector(".zg-table tr", timeout=15000)
        # 印表機不該吃使用者的深色模式選擇——強制切回淺色主題，跟 site.js 手動
        # 切換用的是同一個屬性（localStorage 那套，這裡直接寫 DOM 就夠，不用存）。
        page.evaluate("document.documentElement.dataset.theme = 'light'")
        page.emulate_media(media="print")
        page.pdf(
            path=str(OUT),
            format="A4",
            print_background=True,
            margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"},
        )
        browser.close()
    kb = OUT.stat().st_size / 1024
    print(f"寫出：{OUT.relative_to(ROOT)}（{kb:.0f} KB）")


if __name__ == "__main__":
    main()
