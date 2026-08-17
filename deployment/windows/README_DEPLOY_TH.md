# คู่มือติดตั้ง Thai Arts Recommender บน Windows Server

แพ็กเกจนี้เป็น source deployment สำหรับเว็บแอป Next.js 14 + FastAPI โดยตั้งใจให้
IIS หรือ reverse proxy รับ HTTPS จากผู้ใช้ แล้วส่งต่อไปยังบริการภายในเครื่อง:

- Frontend / Application Backend (public API ทั้งหมด): `127.0.0.1:3000`
- Private Model Service (FastAPI — ไม่เปิดสู่สาธารณะ): `127.0.0.1:8001`
- PostgreSQL: `127.0.0.1:5432`

ตั้งแต่ issue #10 เป็นต้นมา FastAPI เหลือเพียง Private Model Service ที่ให้บริการ
`/internal/v1/*` โดยใช้ Internal Service Credential เท่านั้น — public API
(auth, catalogue, media, member, admin, actions, metrics, analytics) ย้ายไปอยู่
ใน Next.js Application Backend หมดแล้ว และฐานข้อมูลจัดการโดย TypeORM ของ Next.js

## สิ่งที่ไม่อยู่ในแพ็กเกจ

- รหัสผ่าน, `.env` จริง, OAuth token, Google client secret และ API key
- `.git`, `node_modules`, `.next`, cache, log, test และไฟล์ชั่วคราว
- ฐานข้อมูล PostgreSQL เดิม (ต้อง backup/restore แยกต่างหากถ้าต้องการข้อมูลเดิม)

ไฟล์สื่อใน `backend/data/uploads/` รวมอยู่ในแพ็กเกจเพื่อให้รูปที่อัปโหลดไว้ยังแสดงผล
แต่ควรตรวจสิทธิ์และข้อมูลส่วนบุคคลก่อนเผยแพร่สู่ระบบจริง

## ความต้องการของเครื่อง

ให้ผู้ดูแลระบบติดตั้งซอฟต์แวร์ 64 บิตต่อไปนี้ก่อน:

1. Python 3.11 หรือ 3.12 และเลือก Add Python to PATH
2. Node.js 20 LTS
3. PostgreSQL 16 (ถ้าต้องใช้สมาชิก, ผู้ดูแล, การบันทึกพฤติกรรม และข้อมูลแบบถาวร)
4. IIS + URL Rewrite + Application Request Routing สำหรับ HTTPS/reverse proxy

ตรวจจาก PowerShell:

```powershell
python --version
node --version
npm --version
psql --version
```

## ขั้นตอนติดตั้ง

1. แตก ZIP ไปยังพาธที่ไม่มีช่องว่าง เช่น `C:\Apps\ThaiArtsRecommender` ห้ามรันจาก ZIP โดยตรง
2. เปิด PowerShell ในโฟลเดอร์รากของแพ็กเกจ
3. รัน:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\windows\Setup-App.ps1
```

สคริปต์จะสร้าง `backend\.venv`, ติดตั้ง Python packages, รัน `npm ci`, สร้างไฟล์
ตั้งค่าจาก template (รวมถึง Internal Service Credential สุ่มให้ตรงกันทั้งสองไฟล์)
และ Build frontend โดยจะไม่ติดตั้ง PostgreSQL/IIS ให้อัตโนมัติ

4. แก้ไข `backend\.env` และ `frontend\.env.production` ก่อนใช้งานจริง
5. ถ้าเปิดฐานข้อมูล ให้สร้างฐานข้อมูล/ผู้ใช้ด้วยรหัสผ่านที่สุ่มใหม่ จากนั้นรัน
   TypeORM migrations + seed ของ Application Backend:

```powershell
Push-Location .\frontend
$env:DATABASE_URL = "postgresql://APP_USER:URL_ENCODED_PASSWORD@127.0.0.1:5432/web_rs_thaiarts"
npm run migration:run
npm run seed
Pop-Location
```

หากรหัสผ่านฐานข้อมูลมีอักขระพิเศษ ต้อง URL-encode ก่อนใส่ใน connection string

6. หลังแก้ `frontend\.env.production` ต้อง Build ใหม่เสมอ:

```powershell
.\deploy\windows\Setup-App.ps1 -SkipPythonInstall
```

7. ทดสอบโดยเปิด PowerShell สองหน้าต่าง:

```powershell
.\deploy\windows\Start-Backend.ps1
```

```powershell
.\deploy\windows\Start-Frontend.ps1
```

แล้วเปิด PowerShell หน้าต่างที่สาม:

```powershell
.\deploy\windows\Test-Deployment.ps1
```

## ค่าที่ต้องแก้ก่อน Production

ใน `backend\.env` (Private Model Service):

- `RECSYS_INTERNAL_SERVICE_SECRET=...` ต้องตรงกับ
  `MODEL_SERVICE_SHARED_SECRET` ใน `frontend\.env.production` เสมอ
- `RECSYS_ARTIFACT_DIR=../artifacts`
- `RECSYS_E5_ENABLED` / `RECSYS_PRELOAD_E5` เฉพาะเมื่อต้องใช้โมเดล E5 จริง

ใน `frontend\.env.production`:

- `DATABASE_URL=...` โดยใช้ผู้ใช้เฉพาะแอป ไม่ใช้ superuser
- `PRIVATE_MODEL_SERVICE_URL=http://127.0.0.1:8001`
- `MODEL_SERVICE_SHARED_SECRET=...` ให้ตรงกับ backend
- browser เรียก API แบบ same-origin `/api` เสมอ — ไม่มี `NEXT_PUBLIC_API_BASE_URL`
  อีกต่อไป

## IIS reverse proxy ที่แนะนำ

- `https://ชื่อโดเมน/` -> `http://127.0.0.1:3000/`
- `https://ชื่อโดเมน/api/*` -> `http://127.0.0.1:3000/api/*`
- **ห้าม**ส่ง `api/*` ไปที่ 8001 — FastAPI เป็น private service เท่านั้น

ให้เปิด Firewall เฉพาะ 80/443 ตามนโยบายหน่วยงาน ไม่ควรเปิด 3000, 8001 หรือ 5432
ออกสู่เครือข่ายโดยตรง การตั้ง IIS, ใบรับรอง TLS และ Windows Services ควรทำโดยผู้ดูแล
ระบบของหน่วยงานหลังได้รับชื่อโดเมนและพอร์ตที่อนุมัติ

## การรันระยะยาว

สคริปต์ Start เหมาะสำหรับทดสอบการติดตั้ง ส่วน Production ควรลงทะเบียน backend และ
frontend เป็น Windows Services ด้วย service account สิทธิ์ต่ำ พร้อมกำหนด recovery และ
log rotation ห้ามใช้บัญชี Administrator เป็นตัวรันประจำ

## สำรองข้อมูล

ก่อนอัปเดตเวอร์ชัน ให้สำรองอย่างน้อย:

- PostgreSQL ด้วย `pg_dump`
- `backend/data/uploads/`
- `backend/.env` และไฟล์ secret ในระบบจัดเก็บความลับที่ได้รับอนุมัติ

## ตรวจสอบหลังติดตั้ง

- `http://127.0.0.1:8001/internal/v1/health` ต้องตอบสถานะปกติพร้อม Bearer
  credential และโหลด artifacts ได้
- `http://127.0.0.1:3000/api/health` ต้องตอบสถานะปกติ
- `http://127.0.0.1:3000` ต้องเปิดหน้าเว็บได้
- ทดสอบ login, รูป/วิดีโอ, recommendation และสิทธิ์ admin
- ตรวจว่าไม่มีพอร์ต 3000, 8001, 5432 เปิดจากภายนอก
