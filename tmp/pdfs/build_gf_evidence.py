from pathlib import Path
import json

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output/pdf"
DATA = json.loads((OUT / "GF-01_GF-03_公网复测原始记录_2026-10-13.json").read_text())
SERVER = OUT / "GF-01_GF-03_服务器复测原始记录_2026-10-13.txt"
verified = SERVER.exists()
PDF = OUT / "GF-01_GF-03_整改复测证据_2026-10-13.pdf"

pdfmetrics.registerFont(TTFont("ArialUnicode", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"))
ink = colors.HexColor("#14263D")
muted = colors.HexColor("#526274")
blue = colors.HexColor("#1766A3")
line = colors.HexColor("#D8E2EA")
green = colors.HexColor("#127A47")

styles = {
    "title": ParagraphStyle("title", fontName="ArialUnicode", fontSize=19, leading=25, textColor=ink, spaceAfter=6),
    "subtitle": ParagraphStyle("subtitle", fontName="ArialUnicode", fontSize=9.5, leading=14, textColor=muted, spaceAfter=9),
    "h": ParagraphStyle("h", fontName="ArialUnicode", fontSize=11.5, leading=16, textColor=blue, spaceBefore=10, spaceAfter=5),
    "body": ParagraphStyle("body", fontName="ArialUnicode", fontSize=8.8, leading=14, textColor=ink, spaceAfter=5),
    "small": ParagraphStyle("small", fontName="ArialUnicode", fontSize=7.8, leading=11.5, textColor=muted, spaceAfter=4),
    "cell": ParagraphStyle("cell", fontName="ArialUnicode", fontSize=8.2, leading=12, textColor=ink),
    "headcell": ParagraphStyle("headcell", fontName="ArialUnicode", fontSize=8.2, leading=12, textColor=colors.white),
    "code": ParagraphStyle("code", fontName="ArialUnicode", fontSize=8.2, leading=13, textColor=ink),
}

def P(s, style="body"):
    return Paragraph(s, styles[style])

def footer(canvas, doc):
    canvas.saveState()
    w, _ = A4
    canvas.setStrokeColor(line)
    canvas.line(18 * mm, 18 * mm, w - 18 * mm, 18 * mm)
    canvas.setFont("ArialUnicode", 7.5)
    canvas.setFillColor(muted)
    canvas.drawString(18 * mm, 13 * mm, "VeloDB | GF-01 / GF-03 整改复测证据")
    canvas.drawRightString(w - 18 * mm, 13 * mm, str(doc.page))
    canvas.restoreState()

story = [
    P("GF-01 / GF-03 整改复测证据", "title"),
    P("资产：observability-demo.velodb.io　|　公网复测：2026-10-13 11:51（北京时间）　|　服务器操作记录：2026-10-10 UTC", "subtitle"),
    P("核验结论", "h"),
    P("<b>GF-01：</b>公网未登录请求数据源列表、查询接口和原数据源代理入口均返回 HTTP 401；健康接口返回 HTTP 200。报告所描述的未认证调用路径已被认证层拦截。服务器操作记录显示匿名访问已关闭，Grafana 容器已设置到 EC2 IPv4 元数据地址的黑洞路由。"),
    P("<b>GF-03：</b>报告列出的 4 条残留数据源（ID 16、19、38、42）已在数据库备份后删除，删除命令输出为 <b>deleted: 4</b>。" + ("2026-10-13 的服务器侧只读查询再次确认这些 ID 当前不存在。" if verified else "目前尚无 2026-10-13 的服务器侧只读查询输出；当前删除结论基于 2026-10-10 的操作记录。")),
    P("证据 A｜公网未登录复测", "h"),
]

rows = [[P("方法", "headcell"), P("接口", "headcell"), P("状态", "headcell"), P("判读", "headcell")]]
interpretations = {
    "/api/health": "服务在线；database=ok",
    "/api/datasources": "匿名读取被拦截",
    "/api/ds/query": "匿名查询被拦截",
    "/api/datasources/proxy/16/": "匿名代理访问被拦截",
}
for item in DATA["checks"]:
    path = item["url"].replace("https://observability-demo.velodb.io", "")
    rows.append([P(item["method"], "cell"), P(path, "cell"), P(str(item.get("status", "错误")), "cell"), P(interpretations[path], "cell")])
t = Table(rows, colWidths=[22*mm, 87*mm, 19*mm, 43*mm], repeatRows=1)
t.setStyle(TableStyle([
    ("BACKGROUND", (0,0),(-1,0),blue),
    ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,colors.HexColor("#F4F8FB")]),
    ("LINEBELOW",(0,0),(-1,-1),0.35,line),
    ("VALIGN",(0,0),(-1,-1),"TOP"),
    ("LEFTPADDING",(0,0),(-1,-1),7),
    ("RIGHTPADDING",(0,0),(-1,-1),7),
    ("TOPPADDING",(0,0),(-1,-1),6),
    ("BOTTOMPADDING",(0,0),(-1,-1),6),
]))
story += [t, Spacer(1, 6*mm), P("复测时间：2026-10-13 03:51:54–03:51:57 UTC。原始请求结果与响应正文见同目录 JSON 文件。本次复测没有向元数据地址发起请求。", "small")]

story += [P("证据 B｜服务器整改记录", "h")]
server_items = [
    "Compose 配置第 61 行：GF_AUTH_ANONYMOUS_ENABLED=false；Grafana 容器已重建。",
    "数据库删除前精确匹配 GF-03 四个 ID；备份文件：grafana.db.bak.20261010063322；删除输出：deleted: 4。",
    "grafana-imds-guard.service：loaded、enabled、active (running)；日志：Grafana PID 2290879: IMDS blocked。",
    "Grafana 网络命名空间路由：blackhole 169.254.169.254；旧的按容器 IP 匹配的临时 iptables 规则已删除。",
]
for i, s in enumerate(server_items, 1):
    story.append(P(f"<b>{i}.</b> {s}"))
if verified:
    story.append(P("<b>2026-10-13 服务器复核：</b>当前容器配置、Compose 文件、数据库残留条数、防护服务状态和路由的原始输出见同目录服务器复测记录文件。"))
else:
    story.append(P("<b>证据时间说明：</b>上述服务器输出来自 2026-10-10 的终端操作记录；尚待本日只读复核。", "small"))

story += [
    P("范围与保留项", "h"),
    P("本证据验证报告中的匿名访问路径，并记录 4 条残留数据源的删除。未执行已认证用户 SSRF 复测；未验证所有私网目标、IPv6 元数据地址、AWS 实例级 IMDS hop limit，或容器重建时自动重设的全过程。健康接口仍显示 Grafana 11.4.0，GF-02 版本项不在本次整改证据范围内。"),
    P("依据与原始记录", "h"),
    P("《VeloDB-渗透测试报告.pdf》GF-01（第 6–10 页）、GF-03（第 13–16 页）。报告 SHA-256：7e9bee53407d3cdbdc846318d6b61600adc281f37ab0ed3025191b7e771ea2ff。", "small"),
    P("公网原始记录：GF-01_GF-03_公网复测原始记录_2026-10-13.json" + ("；服务器原始记录：GF-01_GF-03_服务器复测原始记录_2026-10-13.txt。" if verified else "。"), "small"),
]

doc = SimpleDocTemplate(str(PDF), pagesize=A4, rightMargin=18*mm, leftMargin=18*mm, topMargin=15*mm, bottomMargin=21*mm, title="GF-01 / GF-03 整改复测证据", author="Codex")
doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(PDF)
