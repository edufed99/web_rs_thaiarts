from io import BytesIO
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
INPUT = Path(r"C:\Users\Pichaya\Desktop\OneDrive\Documents\att.2Beb2I0T_mu1PH-X4rHOTpzUIgoocSJSA9Khkv5iW8M.pdf")
OUTPUT = ROOT / "output" / "pdf" / "ioc_assessment_completed.pdf"
FONT_PATH = Path(r"C:\Windows\Fonts\tahoma.ttf")
BOLD_FONT_PATH = Path(r"C:\Windows\Fonts\tahomabd.ttf")


pdfmetrics.registerFont(TTFont("Tahoma", str(FONT_PATH)))
pdfmetrics.registerFont(TTFont("Tahoma-Bold", str(BOLD_FONT_PATH)))


def wrap_text(text, font_name, font_size, max_width):
    words = text.split(" ")
    lines = []
    line = ""
    for word in words:
        candidate = word if not line else f"{line} {word}"
        if pdfmetrics.stringWidth(candidate, font_name, font_size) <= max_width:
            line = candidate
            continue
        if line:
            lines.append(line)
        if pdfmetrics.stringWidth(word, font_name, font_size) <= max_width:
            line = word
            continue
        part = ""
        for char in word:
            candidate_part = f"{part}{char}"
            if pdfmetrics.stringWidth(candidate_part, font_name, font_size) <= max_width:
                part = candidate_part
            else:
                if part:
                    lines.append(part)
                part = char
        line = part
    if line:
        lines.append(line)
    return lines


def draw_wrapped(c, text, x, y, max_width, font_size=6.8, leading=9.0, max_lines=5):
    lines = wrap_text(text, "Tahoma", font_size, max_width)[:max_lines]
    c.setFont("Tahoma", font_size)
    c.setFillColor(HexColor("#1f2937"))
    for index, line in enumerate(lines):
        c.drawString(x, y - index * leading, line)


def make_overlay(page_number, width, height):
    buffer = BytesIO()
    c = canvas.Canvas(buffer, pagesize=(width, height))
    c.setFillColor(HexColor("#111827"))

    if page_number == 2:
        x_plus, x_zero = 322.4, 371.5
        row_y = {
            1: 422.5,
            2: 385.6,
            3: 310.7,
            4: 258.3,
            5: 195.5,
            6: 142.7,
        }
        scores = {
            1: "+1",
            2: "0",
            3: "0",
            4: "0",
            5: "+1",
            6: "+1",
        }
        suggestions = {
            2: "ปรับให้ระบุองค์ประกอบตามนิยาม เช่น ผู้สอน ผู้เรียน เนื้อหา สื่อ/แหล่งเรียนรู้ และบรรยากาศ",
            3: "ควรถามขั้นตอนสร้างโมเดลโดยรวมก่อน แล้วจึงถามรายละเอียดของแต่ละองค์ประกอบ",
            4: "ควรเจาะจงสิ่งที่ต้องคำนึง เช่น เป้าหมายผู้เรียน เนื้อหา กลวิธีพิเศษ สื่อ และการประเมินผล",
            6: "แก้ถ้อยคำจาก 'รูปการสอน' เป็น 'รูปแบบการสอน'",
        }
        c.setFont("Tahoma-Bold", 13)
        for item, score in scores.items():
            x = x_plus if score == "+1" else x_zero
            c.drawCentredString(x, row_y[item] - 4, "X")
        for item, suggestion in suggestions.items():
            draw_wrapped(c, suggestion, 448.0, row_y[item] + 15.5, 75.0)

    if page_number == 3:
        x_plus = 322.4
        c.setFont("Tahoma-Bold", 13)
        c.drawCentredString(x_plus, 688.5 - 4, "X")
        summary = (
            "ค่า IOC รวม = 0.57 จาก 7 ข้อ อยู่ในเกณฑ์ใช้ได้ แต่ควรปรับข้อ 2, 3 และ 4 "
            "ให้เจาะจงตามวัตถุประสงค์และนิยามศัพท์ก่อนนำไปใช้สัมภาษณ์จริง"
        )
        c.setFillColorRGB(1, 1, 1)
        c.rect(70, 588, 472, 18, stroke=0, fill=1)
        c.rect(70, 570, 472, 18, stroke=0, fill=1)
        draw_wrapped(c, summary, 82.0, 601.0, 450.0, font_size=8.6, leading=15.0, max_lines=3)

    c.save()
    buffer.seek(0)
    return PdfReader(buffer).pages[0]


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(INPUT))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages, start=1):
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        if index in {2, 3}:
            page.merge_page(make_overlay(index, width, height))
        writer.add_page(page)
    with OUTPUT.open("wb") as handle:
        writer.write(handle)
    print(OUTPUT)


if __name__ == "__main__":
    main()
