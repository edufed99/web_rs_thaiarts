# Thai Arts User Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างไฟล์ Word คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทยฉบับแก้ไขได้ ซึ่งครอบคลุมผู้เยี่ยมชม สมาชิก และผู้ดูแลระบบ พร้อมภาพหน้าจอจากเว็บไซต์จริงและผ่านการตรวจทุกหน้า

**Architecture:** ใช้เว็บไซต์จริงเป็นแหล่งภาพแบบอ่านอย่างเดียว เก็บเนื้อหากลางและดัชนีภาพไว้แยกจากสคริปต์สร้างเอกสาร แล้วใช้ `python-docx` สร้าง `.docx` อย่างทำซ้ำได้ ภาพหน้าจอจะไม่ถูกแก้ไขเป็นไฟล์ใหม่เพื่อใส่คำอธิบาย แต่จะวางร่วมกับหมายเลขและคำอธิบายที่แก้ไขได้ภายใน Word ก่อนเรนเดอร์เป็น PNG เพื่อตรวจคุณภาพทุกหน้า

**Tech Stack:** Codex in-app Browser, bundled Python runtime, `python-docx`, OOXML helpers จาก Documents skill, LibreOffice/Poppler renderer จาก Documents skill

**Spec:** `docs/superpowers/specs/2026-08-22-thai-arts-user-manual-design.md`

## Global Constraints

- ใช้เว็บไซต์จริง `https://thaiperform.fed.bpi.ac.th` เป็นแหล่งภาพและข้อความหลัก
- ผลลัพธ์เป็นไฟล์ Microsoft Word `.docx` ขนาด A4 แนวตั้ง และแก้ไขข้อความ ตาราง และภาพได้
- ครอบคลุมผู้เยี่ยมชม สมาชิก และผู้ดูแลระบบในเล่มเดียว โดยเรียบเรียงตามบทบาทและภารกิจ
- ไม่รวมการเผยแพร่ Artifact และการตั้งค่าอีเมล
- ไม่เพิ่ม แก้ไข ลบ เผยแพร่ หรือยืนยันการเปลี่ยนแปลงข้อมูลบนเว็บไซต์จริง
- ผู้ใช้เข้าสู่ระบบด้วยตนเองเมื่อเก็บภาพส่วนสมาชิกและผู้ดูแลระบบ; ห้ามรับหรือบันทึกรหัสผ่าน
- ปกปิดชื่อบัญชี อีเมล และข้อมูลส่วนบุคคลในภาพหรือหลีกเลี่ยงการจับภาพบริเวณดังกล่าว
- ใช้โทนสีกรมท่า ทอง และครีม พร้อมฟอนต์ Sarabun หรือฟอนต์ภาษาไทยที่เข้ากันได้
- ต้องมีสารบัญอัตโนมัติ เลขหน้า หัวกระดาษ ข้อมูลเวอร์ชัน กล่องหมายเหตุ/ข้อควรระวัง/ผลลัพธ์ และภาพพร้อมหมายเลขกำกับ
- ทุกชุดการแก้ไขเอกสารต้องจบด้วยการเรนเดอร์และตรวจ PNG ทุกหน้า

## File Structure

- Create: `docs/user-manual/manual-content.md` — ต้นฉบับข้อความตามบทและภารกิจ ใช้เป็นแหล่งเนื้อหากลาง
- Create: `docs/user-manual/screenshot-index.md` — ตารางจับคู่ภาพกับ URL บทบาท ภารกิจ และข้อมูลที่ต้องปกปิด
- Create: `docs/user-manual/screenshots/public/*.png` — ภาพสถานะผู้เยี่ยมชม
- Create: `docs/user-manual/screenshots/member/*.png` — ภาพสถานะสมาชิก
- Create: `docs/user-manual/screenshots/admin/*.png` — ภาพสถานะผู้ดูแลระบบ
- Create: `scripts/user_manual/build_manual.py` — สร้าง Word จากต้นฉบับและดัชนีภาพด้วย style system เดียว
- Create: `scripts/user_manual/validate_manual.py` — ตรวจข้อความ บทที่ต้องมี บทที่ห้ามมี จำนวนภาพ และโครงสร้าง OOXML
- Create: `scripts/user_manual/tests/test_build_manual.py` — ทดสอบตัวสร้างและตัวตรวจเอกสารกับ fixture ขนาดเล็ก
- Create: `deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx` — ไฟล์ส่งมอบ
- Create: `artifacts/user-manual-render/` — PNG/PDF สำหรับ QA ภายใน ไม่ใช่ไฟล์ส่งมอบ

---

### Task 1: เตรียมพื้นที่ทำงานและบัญชีรายการหน้าจอ

**Files:**

- Create: `docs/user-manual/screenshot-index.md`
- Create: `docs/user-manual/screenshots/public/`
- Create: `docs/user-manual/screenshots/member/`
- Create: `docs/user-manual/screenshots/admin/`

**Interfaces:**

- Consumes: ขอบเขตจากเอกสาร spec และ route จริงใน `frontend/app/`
- Produces: ดัชนีชื่อไฟล์ภาพแบบคงที่ ซึ่ง `manual-content.md` และ `build_manual.py` อ้างอิงตรงกัน

- [ ] **Step 1: สร้างโฟลเดอร์ภาพสามบทบาทและดัชนีภาพ**

ใช้ชื่อไฟล์ตามรูปแบบ `<role>-<ลำดับสองหลัก>-<task>.png` และบันทึกอย่างน้อยรายการต่อไปนี้ในดัชนี:

```text
public-01-home.png                 /
public-02-items-search.png         /items
public-03-categories.png           /categories
public-04-occasions.png            /occasions
public-05-popular.png              /popular
public-06-top-rated.png            /top-rated
public-07-item-detail.png          /items/{id}
public-08-recommend.png            /recommend
public-09-signup.png               /signup
public-10-login.png                /login
public-11-reset-password.png       /reset-password
member-01-profile.png              /profile
member-02-profile-edit.png         /profile/edit
member-03-favorites.png            /profile/favorites
member-04-ratings.png              /profile/ratings
member-05-recent.png               /profile/recent
member-06-activity.png             /profile/activity
member-07-item-actions.png         /items/{id}
admin-01-dashboard.png             /admin
admin-02-analytics.png             /admin/analytics
admin-03-items-list.png            /admin/items
admin-04-item-create.png           /admin/items/new
admin-05-item-edit.png             /admin/items?mode=edit
admin-06-media-fields.png          /admin/items?mode=edit
admin-07-contexts.png              /admin/items?tab=contexts
admin-08-keywords.png              /admin/items?tab=keywords
admin-09-users.png                 /admin/items?tab=users
```

- [ ] **Step 2: ตรวจ route และชื่อเมนูจากโค้ด**

Run:

```powershell
rg -n "href=|router\.push|router\.replace|admin-mode-tabs|admin-data-subtabs" frontend/app frontend/components -g '*.tsx'
```

Expected: ทุกรายการในดัชนีมี route หรือจุดนำทางที่ตรวจสอบได้; รายการ Artifact Publication และ email settings ถูกระบุเป็น `excluded` ในดัชนีและไม่มีชื่อไฟล์ภาพ

- [ ] **Step 3: ตรวจดัชนีว่าครบและไม่มีหัวข้อห้าม**

Run:

```powershell
rg -n "Artifact Publication|email-settings|ตั้งค่าอีเมล" docs/user-manual/screenshot-index.md
```

Expected: พบเฉพาะบรรทัดอธิบายว่าเป็น `excluded`; ไม่มีรายการภาพหรือขั้นตอนสำหรับหัวข้อดังกล่าว

- [ ] **Step 4: Commit ดัชนีภาพ**

```powershell
git add -- docs/user-manual/screenshot-index.md
git commit -m "docs: define user manual screenshot inventory"
```

### Task 2: เก็บภาพหน้าจอสถานะผู้เยี่ยมชมแบบอ่านอย่างเดียว

**Files:**

- Create: `docs/user-manual/screenshots/public/*.png`
- Modify: `docs/user-manual/screenshot-index.md`

**Interfaces:**

- Consumes: ชื่อไฟล์และ URL จาก Task 1
- Produces: ภาพ PNG สถานะไม่เข้าสู่ระบบที่ `build_manual.py` นำไปวางในบทผู้เยี่ยมชม

- [ ] **Step 1: เปิดเว็บไซต์จริงด้วย viewport เดสก์ท็อปที่คงที่**

ใช้ Browser skill เปิด `https://thaiperform.fed.bpi.ac.th/` และตั้ง viewport เป็น `1440 × 1000` หาก capability รองรับ เพื่อให้ภาพทุกหน้ามีสัดส่วนสม่ำเสมอ

- [ ] **Step 2: เก็บภาพตามดัชนี public ทีละหน้า**

ก่อนจับภาพแต่ละหน้า ให้ตรวจ DOM snapshot ว่า URL ชื่อหน้า เมนู และข้อมูลที่ปรากฏตรงกับภารกิจ แล้วบันทึกภาพเฉพาะ viewport หรือ full-page ตามความจำเป็น โดยไม่กรอกหรือส่งแบบฟอร์ม

- [ ] **Step 3: ตรวจภาพและข้อมูลส่วนบุคคล**

Run:

```powershell
Get-ChildItem docs/user-manual/screenshots/public/*.png | Select-Object Name,Length
```

Expected: มีภาพ public 11 ภาพ ทุกไฟล์มีขนาดมากกว่า 20 KB และไม่มีข้อมูลบัญชีผู้ใช้

- [ ] **Step 4: อัปเดตดัชนีด้วยวันที่และสถานะตรวจแล้ว**

เพิ่ม `captured_on=2026-08-22`, URL จริงหลัง redirect และ `privacy=pass` ให้ทุกภาพ public

- [ ] **Step 5: Commit ภาพสาธารณะและดัชนี**

```powershell
git add -- docs/user-manual/screenshots/public docs/user-manual/screenshot-index.md
git commit -m "docs: capture public user manual screenshots"
```

### Task 3: เก็บภาพหน้าจอสมาชิกและผู้ดูแลโดยไม่เปลี่ยนข้อมูล

**Files:**

- Create: `docs/user-manual/screenshots/member/*.png`
- Create: `docs/user-manual/screenshots/admin/*.png`
- Modify: `docs/user-manual/screenshot-index.md`

**Interfaces:**

- Consumes: เซสชันที่ผู้ใช้เข้าสู่ระบบด้วยตนเองและรายการภาพจาก Task 1
- Produces: ภาพ PNG สำหรับบทสมาชิกและผู้ดูแล โดยไม่มีข้อมูลลับและไม่มีการส่งแบบฟอร์ม

- [ ] **Step 1: ส่งมอบแท็บเว็บไซต์ให้ผู้ใช้เข้าสู่ระบบ**

แสดงแท็บเว็บไซต์จริงให้ผู้ใช้เข้าสู่ระบบด้วยบัญชีผู้ดูแลด้วยตนเอง และรอข้อความยืนยันว่าเข้าสู่ระบบแล้ว ห้ามอ่านหรือบันทึกรหัสผ่าน คุกกี้ local storage หรือ token

- [ ] **Step 2: เก็บภาพหน้าสมาชิก**

เปิดหน้า profile, edit, favorites, ratings, recent, activity และ item detail ตามดัชนี โดยหลีกเลี่ยงบริเวณที่แสดงอีเมลหรือชื่อจริง หากข้อมูลส่วนบุคคลอยู่ในพื้นที่จำเป็น ให้ครอบภาพเฉพาะบริเวณที่ไม่รวมข้อมูลนั้น

- [ ] **Step 3: เก็บภาพหน้าผู้ดูแล**

เปิด Dashboard, analytics, รายการข้อมูล, แบบเพิ่ม, แบบแก้ไข, ส่วนสื่อ, contexts, keywords และ users โดยหยุดก่อนปุ่มยืนยันทุกชนิด ห้ามกดบันทึก ลบ เปลี่ยนสิทธิ์ อัปโหลด หรือเผยแพร่

- [ ] **Step 4: ตรวจจำนวนไฟล์และความเป็นส่วนตัว**

Run:

```powershell
Get-ChildItem docs/user-manual/screenshots/member/*.png,docs/user-manual/screenshots/admin/*.png | Select-Object DirectoryName,Name,Length
```

Expected: มีภาพ member 7 ภาพและ admin 9 ภาพ ทุกไฟล์มากกว่า 20 KB ไม่มีอีเมล รหัสผู้ใช้ที่ไม่จำเป็น หรือข้อมูลลับที่อ่านได้

- [ ] **Step 5: อัปเดตดัชนีและ Commit**

```powershell
git add -- docs/user-manual/screenshots/member docs/user-manual/screenshots/admin docs/user-manual/screenshot-index.md
git commit -m "docs: capture member and admin manual screenshots"
```

### Task 4: เขียนต้นฉบับเนื้อหาตามบทบาทและภารกิจ

**Files:**

- Create: `docs/user-manual/manual-content.md`
- Modify: `docs/user-manual/screenshot-index.md`

**Interfaces:**

- Consumes: หน้าจอจริง ดัชนีภาพ และข้อความใน `frontend/app/`/`frontend/components/`
- Produces: ต้นฉบับที่มีหัวเรื่องและ marker ภาพครบสำหรับตัวสร้าง Word

- [ ] **Step 1: เขียน front matter และบทนำ**

ใส่ชื่อเอกสาร เว็บไซต์ วันที่เอกสาร กลุ่มผู้ใช้ วิธีอ่านสัญลักษณ์ และข้อกำหนดเบื้องต้น โดยใช้ marker ภาพรูปแบบ `[[IMAGE:public-01-home.png]]`

- [ ] **Step 2: เขียนบทผู้เยี่ยมชมและบัญชีผู้ใช้**

แต่ละภารกิจต้องมีหัวข้อย่อยตามลำดับนี้: วัตถุประสงค์, เงื่อนไขก่อนเริ่ม, ขั้นตอน, ผลลัพธ์ที่ควรเห็น, หมายเหตุ/ข้อควรระวัง และอ้างภาพ public ที่สัมพันธ์กัน

- [ ] **Step 3: เขียนบทสมาชิก**

ครอบคลุม profile, profile edit, favorites, ratings, recent, activity, บันทึก/ให้คะแนนบน item detail และออกจากระบบ โดยไม่สมมติค่าข้อมูลส่วนบุคคล

- [ ] **Step 4: เขียนบทผู้ดูแลระบบ**

ครอบคลุม Dashboard, analytics, เพิ่ม/แก้ไข/ลบชุดการแสดง, รูปภาพ/วิดีโอ, contexts, categories/keywords และผู้ใช้ อธิบายผลของปุ่มบันทึกหรือลบด้วยข้อความ แต่ไม่อ้างว่ามีการกดจริง

- [ ] **Step 5: เขียนบทแก้ปัญหาและภาคผนวก**

ครอบคลุมเข้าสู่ระบบไม่ได้ ไม่พบข้อมูล บันทึกไม่สำเร็จ สิทธิ์ไม่เพียงพอ session หมดอายุ และช่องทางติดต่อ พร้อมคำศัพท์และตารางสิทธิ์สามบทบาท

- [ ] **Step 6: ตรวจเนื้อหาต้องมีและต้องห้าม**

Run:

```powershell
rg -n "ผู้เยี่ยมชม|สมาชิก|ผู้ดูแลระบบ|Dashboard|วิเคราะห์ข้อมูล|รูปภาพ|วิดีโอ|บริบท|หมวดหมู่|คำสำคัญ|สิทธิ์ผู้ใช้" docs/user-manual/manual-content.md
rg -n "เผยแพร่ Artifact|Artifact Publication|ตั้งค่าอีเมล|email-settings" docs/user-manual/manual-content.md
```

Expected: คำสำคัญที่ต้องมีปรากฏในบทที่สัมพันธ์กัน; คำต้องห้ามไม่พบเลย

- [ ] **Step 7: Commit ต้นฉบับ**

```powershell
git add -- docs/user-manual/manual-content.md docs/user-manual/screenshot-index.md
git commit -m "docs: write role-based Thai arts user manual"
```

### Task 5: สร้างตัวสร้าง Word และตัวตรวจโครงสร้างแบบทดสอบก่อน

**Files:**

- Create: `scripts/user_manual/build_manual.py`
- Create: `scripts/user_manual/validate_manual.py`
- Create: `scripts/user_manual/tests/test_build_manual.py`

**Interfaces:**

- Consumes: `manual-content.md`, `screenshot-index.md`, โฟลเดอร์ภาพ และ output path
- Produces: `build_manual(content_path: Path, screenshot_root: Path, output_path: Path) -> Path` และ `validate_manual(docx_path: Path) -> list[str]`

- [ ] **Step 1: โหลด runtime เอกสารที่ bundle มากับ workspace**

เรียก `load_workspace_dependencies` และใช้ Python executable กับ package directory ที่ tool ส่งกลับเท่านั้น ห้ามใช้ system Python หรือ package ที่ติดตั้งใน repo จาก bundle ปัจจุบันให้กำหนดตัวแปรเฉพาะงานดังนี้:

```powershell
$DOC_PYTHON = 'C:\Users\Pichaya\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$DOC_SKILL_ROOT = 'C:\Users\Pichaya\.codex\plugins\cache\openai-primary-runtime\documents\26.819.11345\skills\documents'
```

- [ ] **Step 2: เขียน test สำหรับเอกสารขั้นต่ำ**

ทดสอบว่า `build_manual()` สร้างไฟล์ได้, มีข้อความไทย, มีรูปอย่างน้อยหนึ่งรูป, มี style `Heading 1`, มี field สารบัญ, และ `validate_manual()` คืนรายการว่างเมื่อ fixture ถูกต้อง

```python
def test_builds_editable_docx_with_required_structure(tmp_path):
    output = build_manual(FIXTURE_CONTENT, FIXTURE_SCREENSHOTS, tmp_path / "manual.docx")
    assert output.exists() and output.stat().st_size > 10_000
    assert validate_manual(output) == []
```

- [ ] **Step 3: รัน test ให้ล้มเหลวก่อน**

Run:

```powershell
& $DOC_PYTHON -m pytest scripts/user_manual/tests/test_build_manual.py -v
```

Expected: FAIL เพราะยังไม่มี `build_manual` และ `validate_manual`

- [ ] **Step 4: สร้าง style system และ parser ขั้นต่ำ**

กำหนด A4 portrait, margin 18/16/18/16 mm, Sarabun 11 pt, navy `18324A`, gold `B88A2C`, cream `F7F1E4`, Heading 1-3, caption, callout table styles, header/footer, PAGE field และ TOC field รองรับ heading 1-3

- [ ] **Step 5: สร้างการวางภาพและหมายเลขกำกับที่แก้ไขได้**

วางภาพแบบ inline ความกว้างไม่เกิน 16.5 cm ตามด้วยตารางคำอธิบายไร้เส้นกรอบ ซึ่งคอลัมน์ซ้ายเป็นเลขวงกลม/เลขขั้นตอนและคอลัมน์ขวาเป็นคำอธิบาย ห้ามเขียนหมายเลขทับลงใน raster screenshot

- [ ] **Step 6: สร้างตัวตรวจ OOXML**

ตรวจ required headings, excluded phrases, จำนวน media images, field `TOC`, field `PAGE`, header/footer, section size A4 และข้อความ alt/caption สำหรับภาพ

- [ ] **Step 7: รัน test ให้ผ่าน**

Run:

```powershell
& $DOC_PYTHON -m pytest scripts/user_manual/tests/test_build_manual.py -v
```

Expected: PASS

- [ ] **Step 8: Commit ตัวสร้างและการทดสอบ**

```powershell
git add -- scripts/user_manual
git commit -m "feat: add editable user manual document builder"
```

### Task 6: สร้างไฟล์ Word ฉบับเต็มและตรวจโครงสร้าง

**Files:**

- Create: `deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx`

**Interfaces:**

- Consumes: Task 2-5
- Produces: ไฟล์ Word ฉบับเต็มสำหรับการ QA ด้านภาพ

- [ ] **Step 1: สร้างไฟล์ Word จากต้นฉบับ**

Run:

```powershell
& $DOC_PYTHON scripts/user_manual/build_manual.py --content docs/user-manual/manual-content.md --screenshots docs/user-manual/screenshots --output 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
```

Expected: exit code 0 และไฟล์ `.docx` มีขนาดมากกว่า 1 MB

- [ ] **Step 2: รันตัวตรวจเอกสาร**

Run:

```powershell
& $DOC_PYTHON scripts/user_manual/validate_manual.py 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
```

Expected: `PASS` พร้อม required chapters ครบ, excluded phrases 0, image count อย่างน้อย 27, TOC/PAGE/header/footer present และ section A4 portrait

- [ ] **Step 3: ตรวจ metadata และ accessibility เบื้องต้น**

Run:

```powershell
& $DOC_PYTHON "$DOC_SKILL_ROOT/scripts/a11y_audit.py" 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx' --out_json artifacts/user-manual-a11y.json
```

Expected: ไม่มีภาพที่ขาดคำอธิบาย ไม่มีตารางข้อมูลที่ขาด header row และไม่มี heading level กระโดด

- [ ] **Step 4: Commit ไฟล์ Word ฉบับแรก**

```powershell
git add -- 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
git commit -m "docs: build Thai arts user manual"
```

### Task 7: เรนเดอร์ ตรวจทุกหน้า และแก้จนพร้อมส่งมอบ

**Files:**

- Modify: `docs/user-manual/manual-content.md`
- Modify: `scripts/user_manual/build_manual.py`
- Modify: `deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx`
- Create: `artifacts/user-manual-render/page-*.png`
- Create: `artifacts/user-manual-render/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.pdf`

**Interfaces:**

- Consumes: Word ฉบับเต็มจาก Task 6 และ renderer จาก Documents skill
- Produces: Word ที่ผ่าน visual QA ทุกหน้า; PNG/PDF เป็นหลักฐาน QA ภายใน

- [ ] **Step 1: เรนเดอร์ Word เป็น PNG และ PDF**

Run:

```powershell
& $DOC_PYTHON "$DOC_SKILL_ROOT/render_docx.py" 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx' --output_dir artifacts/user-manual-render --emit_pdf
```

Expected: มี `page-*.png` ครบทุกหน้าและ PDF ขนาดไม่เป็นศูนย์

- [ ] **Step 2: ตรวจ PNG ทุกหน้าที่ 100%**

เปิดดูทุกไฟล์ตามลำดับและบันทึกปัญหาเฉพาะหน้า ตรวจข้อความ/ภาพตัดกัน ตารางล้น หน้าเว้นว่างผิดปกติ ภาพเล็กเกินอ่าน ฟอนต์ไทยแตก หัว/ท้ายกระดาษผิดตำแหน่ง และข้อมูลส่วนบุคคลในภาพ

- [ ] **Step 3: แก้ต้นเหตุและสร้างใหม่**

แก้ `manual-content.md` เมื่อเป็นปัญหาเนื้อหา และแก้ `build_manual.py` เมื่อเป็นปัญหารูปแบบ จากนั้นสร้าง Word และเรนเดอร์ใหม่ทั้งเล่ม ห้ามแก้ OOXML ของไฟล์ผลลัพธ์เพียงครั้งเดียวจนไม่สามารถทำซ้ำได้

- [ ] **Step 4: รัน verification ชุดสุดท้าย**

Run:

```powershell
& $DOC_PYTHON -m pytest scripts/user_manual/tests/test_build_manual.py -v
& $DOC_PYTHON scripts/user_manual/validate_manual.py 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
& $DOC_PYTHON "$DOC_SKILL_ROOT/scripts/a11y_audit.py" 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
```

Expected: tests PASS, validator PASS, a11y audit ไม่มีข้อผิดพลาดที่ทำให้เอกสารใช้งานไม่ได้ และการตรวจ PNG ทุกหน้าผ่าน

- [ ] **Step 5: Commit การแก้ QA ขั้นสุดท้าย**

```powershell
git add -- docs/user-manual/manual-content.md scripts/user_manual/build_manual.py 'deliverables/คู่มือการใช้งานระบบแนะนำชุดการแสดงนาฏศิลป์ไทย.docx'
git commit -m "docs: finalize verified Thai arts user manual"
```

- [ ] **Step 6: ส่งมอบไฟล์ Word เท่านั้น**

ส่งลิงก์ไฟล์ `.docx` พร้อมสรุปว่าครอบคลุมสามบทบาท ตัด Artifact/email settings แล้ว และผ่านการเรนเดอร์ตรวจทุกหน้า ไม่แนบโฟลเดอร์ PNG/PDF QA เว้นแต่ผู้ใช้ร้องขอ
