# คู่มือตั้งค่า Google Cloud Console สำหรับ Thai Performing Arts Recommender

คู่มือนี้อธิบายขั้นตอนการเปิดใช้งานบริการของ Google ที่ระบบต้องใช้ ได้แก่:

1. **Member Google Login** — สมัครสมาชิก/เข้าสู่ระบบด้วย Google (OpenID Connect)
2. **Admin Gmail sender** — ส่งอีเมลตั้ง/รีเซ็ตรหัสผ่านผ่าน Gmail API

> **สำคัญ:** ระบบใช้ OAuth client **แยกกัน 2 ตัว** — อย่าใช้ client เดียวกันกับทั้ง member login และ admin mail sender เพราะ scope สิทธิ์ต่างกัน (ดู ADR §6 ใน `docs/adr.md`)

---

## สารบัญ

- [ภาพรวมการใช้งาน Google ในระบบ](#ภาพรวมการใช้งาน-google-ในระบบ)
- [ขั้นตอนที่ 1: สร้างโปรเจกต์ Google Cloud](#ขั้นตอนที่-1-สร้างโปรเจกต์-google-cloud)
- [ขั้นตอนที่ 2: เปิดใช้งาน APIs](#ขั้นตอนที่-2-เปิดใช้งาน-apis)
- [ขั้นตอนที่ 3: ตั้งค่า OAuth Consent Screen](#ขั้นตอนที่-3-ตั้งค่า-oauth-consent-screen)
- [ขั้นตอนที่ 4: สร้าง OAuth client สำหรับ Member Login](#ขั้นตอนที่-4-สร้าง-oauth-client-สำหรับ-member-login)
- [ขั้นตอนที่ 5: สร้าง OAuth client สำหรับ Admin Gmail Sender](#ขั้นตอนที่-5-สร้าง-oauth-client-สำหรับ-admin-gmail-sender)
- [ขั้นตอนที่ 6: วางไฟล์และตั้งค่า env](#ขั้นตอนที่-6-วางไฟล์และตั้งค่า-env)
- [ขั้นตอนที่ 7: อนุญาต Admin Gmail Sender ครั้งแรก](#ขั้นตอนที่-7-อนุญาต-admin-gmail-sender-ครั้งแรก)
- [ขั้นตอนที่ 8: ทดสอบ](#ขั้นตอนที่-8-ทดสอบ)
- [การแก้ไขปัญหาเบื้องต้น](#การแก้ไขปัญหาเบื้องต้น)

---

## ภาพรวมการใช้งาน Google ในระบบ

| ฟีเจอร์ | ไฟล์ client | Scope | ผู้ใช้ |
|---|---|---|---|
| สมัคร/ล็อกอินด้วย Google | `google_login_client.json` | `openid email profile` | สมาชิกทั่วไป |
| ส่งอีเมลลืม/ตั้งรหัสผ่าน | `google_oauth_client.json` | `gmail.send` | แอดมินเท่านั้น |

ระบบรีเซ็ตรหัสผ่านทำงานได้ 2 ช่องทาง:

- **หลัก:** Gmail API ผ่าน OAuth refresh token ของแอดมิน
- **สำรอง:** SMTP (เช่น Gmail App Password) — ไม่ต้องใช้ Google Cloud

---

## ขั้นตอนที่ 1: สร้างโปรเจกต์ Google Cloud

1. เปิด [Google Cloud Console](https://console.cloud.google.com/)
2. คลิก **Select a project** ด้านบน → **New Project**
3. ตั้งชื่อโปรเจกต์ เช่น `thai-arts-recommender`
4. เลือก billing account (หากยังไม่มี ให้สร้างบัญชีและผูกบัตรก่อน — Gmail API มี quota ฟรีสำหรับการใช้งานทั่วไป)
5. รอสักครู่แล้วเลือกโปรเจกต์ที่สร้าง

---

## ขั้นตอนที่ 2: เปิดใช้งาน APIs

ไปที่เมนู **APIs & Services → Library** แล้วเปิดใช้งาน:

- **Google Identity Toolkit API** (หรือ **Identity Toolkit API**) — สำหรับ member Google login
- **Gmail API** — สำหรับ admin mail sender

คลิกแต่ละ API → **Enable**

---

## ขั้นตอนที่ 3: ตั้งค่า OAuth Consent Screen

1. ไปที่ **APIs & Services → OAuth consent screen**
2. เลือก **External** (หากต้องการให้ผู้ใช้ทั่วไปใช้งานได้) หรือ **Internal** (หากจำกัดเฉพาะองค์กร)
3. กรอกข้อมูล:
   - **App name:** `Thai Performing Arts Recommender`
   - **User support email:** อีเมลของคุณ
   - **Developer contact information:** อีเมลของคุณ
4. คลิก **Save and Continue**
5. หน้า **Scopes** ให้เพิ่ม scope ต่อไปนี้เพื่อให้ระบบแสดงผู้ใช้เห็นว่าจะขอสิทธิ์อะไร:
   - `openid`
   - `userinfo.email`
   - `userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.send`
6. คลิก **Save and Continue**
7. หน้า **Test users** เพิ่มอีเมล Gmail ของคุณเองก่อน (ตอน testing)
8. คลิก **Save and Continue** → **Back to Dashboard**

> **หมายเหตุ:** หากเลือก External จะต้องกด **PUBLISH APP** เมื่อพร้อมใช้งานจริง มิฉะนั้นจะมีข้อความ "Google hasn't verified this app" แสดงแก่ผู้ใช้ทั่วไป

---

## ขั้นตอนที่ 4: สร้าง OAuth client สำหรับ Member Login

1. ไปที่ **APIs & Services → Credentials**
2. คลิก **Create Credentials → OAuth client ID**
3. เลือก **Application type:** `Web application`
4. ตั้งชื่อ: `Thai Arts Member Login`
5. ในช่อง **Authorized redirect URIs** เพิ่ม:
   ```
   http://localhost:3000/api/auth/google/login/callback
   ```
   สำหรับ production เพิ่มอีกอัน เช่น:
   ```
   https://your-domain.com/api/auth/google/login/callback
   ```
6. คลิก **Create**
7. ดาวน์โหลดไฟล์ JSON ที่ได้มา
8. เปลี่ยนชื่อไฟล์เป็น `google_login_client.json`

---

## ขั้นตอนที่ 5: สร้าง OAuth client สำหรับ Admin Gmail Sender

1. ยังอยู่ที่ **APIs & Services → Credentials**
2. คลิก **Create Credentials → OAuth client ID**
3. เลือก **Application type:** `Web application`
4. ตั้งชื่อ: `Thai Arts Admin Gmail Sender`
5. ในช่อง **Authorized redirect URIs** เพิ่ม:
   ```
   http://localhost:3000/api/admin/gmail-oauth/callback
   ```
   สำหรับ production เพิ่มอีกอัน เช่น:
   ```
   https://your-domain.com/api/admin/gmail-oauth/callback
   ```
6. คลิก **Create**
7. ดาวน์โหลดไฟล์ JSON ที่ได้มา
8. เปลี่ยนชื่อไฟล์เป็น `google_oauth_client.json`

---

## ขั้นตอนที่ 6: วางไฟล์และตั้งค่า env

### วางไฟล์ลับ

สร้างโฟลเดอร์แล้ววางไฟล์ทั้งสอง:

```
frontend/
├── data/
│   └── secrets/
│       ├── google_login_client.json      ← จากขั้นตอนที่ 4
│       └── google_oauth_client.json      ← จากขั้นตอนที่ 5
```

> ไฟล์ทั้งสองไม่ต้อง commit เข้า git — โฟลเดอร์ `data/secrets` อยู่ใน `.gitignore` แล้ว

### แก้ไข `frontend/.env.local`

เพิ่มหรือแก้ไขบรรทัดต่อไปนี้:

```env
# Member Google Login
GOOGLE_LOGIN_CLIENT_FILE=./data/secrets/google_login_client.json
GOOGLE_LOGIN_REDIRECT_URI=http://localhost:3000/api/auth/google/login/callback
GOOGLE_LOGIN_STATE_TTL_SECONDS=600

# Admin Gmail sender (ใช้ส่งอีเมลลืม/ตั้งรหัสผ่าน)
GMAIL_OAUTH_CLIENT_FILE=./data/secrets/google_oauth_client.json
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/admin/gmail-oauth/callback
GMAIL_SENDER_EMAIL=dpatt148@gmail.com

# Gmail token จะถูกบันทึกอัตโนมัติหลังแอดมินอนุญาตครั้งแรก
GMAIL_OAUTH_TOKEN_FILE=./data/secrets/gmail_oauth_token.json

# ตัวเลือกสำรอง: SMTP (ไม่ต้องใช้ Google Cloud)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USERNAME=your-email@gmail.com
# SMTP_PASSWORD=your-app-password
# SMTP_FROM_EMAIL=your-email@gmail.com
# SMTP_USE_TLS=1
```

หากไม่ต้องการใช้ไฟล์ JSON สามารถระบุค่าตรงใน env ได้:

```env
GOOGLE_LOGIN_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_LOGIN_CLIENT_SECRET=your-client-secret
GOOGLE_LOGIN_REDIRECT_URI=http://localhost:3000/api/auth/google/login/callback

GMAIL_OAUTH_CLIENT_ID=your-admin-client-id.apps.googleusercontent.com
GMAIL_OAUTH_CLIENT_SECRET=your-admin-client-secret
GMAIL_OAUTH_REDIRECT_URI=http://localhost:3000/api/admin/gmail-oauth/callback
GMAIL_OAUTH_REFRESH_TOKEN=your-refresh-token
```

---

## ขั้นตอนที่ 7: อนุญาต Admin Gmail Sender ครั้งแรก

หลังจากตั้งค่า env และรันแอปแล้ว:

1. เข้าสู่ระบบด้วยบัญชีแอดมิน
2. ไปที่ **Admin → Email Settings** (`/admin/email-settings`)
3. คลิกปุ่มเชื่อมต่อ Gmail
4. ล็อกอินด้วยบัญชี Gmail ที่ต้องการให้ระบบส่งอีเมล
5. ยอมรับสิทธิ์ `gmail.send`
6. ระบบจะบันทึก refresh token ลงไฟล์ `gmail_oauth_token.json` อัตโนมัติ

หากไม่สะดวกใช้ UI สามารถเรียก API โดยตรงได้:

```bash
curl -X POST http://localhost:3000/api/admin/gmail-oauth/start \
  -H "Content-Type: application/json" \
  --cookie "your-admin-session-cookie"
```

แล้วเปิด URL ที่ได้รับในเบราว์เซอร์เพื่ออนุญาต

---

## ขั้นตอนที่ 8: ทดสอบ

### ทดสอบ Member Google Login

1. เปิดหน้า `/login` หรือ `/signup`
2. คลิก **ดำเนินการต่อด้วย Google**
3. ควร redirect ไป `accounts.google.com`
4. หลังยอมรับ ระบบจะสร้างบัญชี/เข้าสู่ระบบและ redirect กลับมา

### ทดสอบ Password Reset

1. เปิดหน้า `/reset-password`
2. กรอก username และ email ที่มีในฐานข้อมูล
3. คลิกส่งคำขอ
4. ตรวจสอบกล่องจดหมายของอีเมลนั้น
5. คลิกลิงก์ในอีเมลแล้วตั้งรหัสผ่านใหม่

---

## การแก้ไขปัญหาเบื้องต้น

### `google_login_not_configured`

- ตรวจสอบว่า `GOOGLE_LOGIN_CLIENT_FILE` ชี้ไปถูก path
- หรือตรวจสอบว่า `GOOGLE_LOGIN_CLIENT_ID`, `GOOGLE_LOGIN_CLIENT_SECRET`, `GOOGLE_LOGIN_REDIRECT_URI` ไม่เป็นค่าว่าง
- redirect URI ใน Google Cloud ต้องตรงกับ env เป๊ะ (รวมทั้ง `http` vs `https`, `localhost` vs `127.0.0.1`)

### `redirect_uri_mismatch`

- ค่า `GOOGLE_LOGIN_REDIRECT_URI` ไม่ตรงกับที่ลงทะเบียนใน Google Cloud Console
- ตรวจสอบว่าได้เพิ่ม `http://localhost:3000/api/auth/google/login/callback` ใน **Authorized redirect URIs**

### ล็อกอิน Google แล้ว redirect กลับมา error

- ตรวจสอบ `OAUTH_STATE_SECRET` ใน `.env.local` — ต้องเป็นค่า random ยาว ๆ ไม่ใช่ default
- ตรวจสอบว่า cookie ไม่ถูกบล็อกโดยเบราว์เซอร์

### ส่งอีเมลรีเซ็ตรหัสผ่านไม่ได้

- ตรวจสอบว่าแอดมินได้อนุญาต Gmail sender แล้ว (`/api/admin/gmail-oauth/status`)
- หรือตั้งค่า SMTP เป็นทางเลือกสำรอง
- หากใช้ Gmail API: ตรวจสอบว่าแอดมินบัญชีเดียวกับ `GMAIL_SENDER_EMAIL` เป็นผู้อนุญาต

### "Google hasn't verified this app"

- ต้องกด **PUBLISH APP** ใน OAuth consent screen
- หรือเพิ่มผู้ใช้เป็น **Test user** ก่อนระหว่างทดสอบ

---

## ข้อควรจำ

- `google_login_client.json` และ `google_oauth_client.json` คือลับทางเทคนิค ห้าม commit
- ใน production ควรใช้ env vars แทนไฟล์ JSON เพื่อความปลอดภัย
- อย่าลืมเปลี่ยน `OAUTH_STATE_SECRET` เป็น random string ยาว 32 ตัวอักษรขึ้นไป
- Member login และ admin mail sender ต้องเป็น OAuth client คนละตัวเสมอ
