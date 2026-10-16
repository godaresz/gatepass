# Gatepass (WH1 / WH4 / GW)

ระบบออกใบ Gatepass (Empty-Out / Empty-IN) แยก 3 คลัง แต่ละโฟลเดอร์ deploy ได้ทันที
(static site + Firebase)

| โฟลเดอร์ | Firebase project | เลขที่ Gatepass |
|---|---|---|
| `WH1/` | issue-gate-pass-ldc-sr | `YYYYMMDD-LDC-SR-WH1-001` |
| `WH4/` | issue-gate-pass-ldc-wh4 | `YYYYMMDD-LDC-SR-WH4-001` |
| `GW/`  | issue-gate-pass-ldc-gw | `YYYYMMDD-LDC-GW-001` |

## วิธีแก้โค้ด

`WH1/` คือต้นฉบับ แก้ที่ `WH1/` แล้วรัน

```bash
tools/sync-sites.sh
```

สคริปต์จะคัดลอกไป `WH4/` และ `GW/` พร้อมเปลี่ยนข้อความเฉพาะคลัง
(ชื่อหน้า, LDC-SR/LDC-GW, ชื่อบริษัท รปภ. บนใบพิมพ์)
ไฟล์ที่ **ไม่** ถูกคัดลอก คือ `js/firebase-config.js` ของแต่ละคลัง
(Firebase config + `siteConfig.gatepassPrefix`)

## การประหยัดโควต้า Firebase (Spark ฟรี: 50,000 reads / 20,000 writes ต่อวัน)

| จุด | เดิม | ตอนนี้ |
|---|---|---|
| เปิดหน้า Issue / Gatepass IN / Record / Report | อ่าน master_data ทั้งหมด (N reads ทุกครั้ง) | อ่าน 1 doc (`counters/master_version`) ใช้ master ที่ cache ไว้ในเครื่อง (`js/master-cache.js`) อ่านใหม่ทั้งหมดเฉพาะเมื่อมีการ Save Master หรือ cache อายุเกิน 12 ชม. |
| Save Master | อ่านทั้ง collection อีก 2 รอบ | ไม่อ่านเพิ่ม (ใช้ id ที่โหลดไว้) |
| Record หน้าแรก / Load More | 50 reads ต่อหน้า | 30 reads ต่อหน้า (`HISTORY_PAGE_SIZE`) |
| Record Load All / Export, Report | อ่านทุกใบในช่วงวันที่ (ไม่ใส่วันที่ = ทั้งฐานข้อมูล) | นับจำนวนก่อน (~1 read ต่อ 1,000 ใบ) เกิน 2,000 ถามยืนยัน เกิน 15,000 ไม่ให้ดึง ต้องเลือกช่วงให้สั้นลง |
| กด Fetch Report ซ้ำช่วงเดิม | อ่านใหม่ทุกครั้ง | ภายใน 5 นาทีใช้ผลเดิม (0 reads) |
| อัปเดตใบ Empty-Out | อ่านใบซ้ำหลังบันทึก | ใช้ข้อมูลที่บันทึก (0 reads) |

ปรับเกณฑ์ได้ที่ `READ_CONFIRM_LIMIT` / `READ_BLOCK_LIMIT` ใน `js/utils.js`
และ `HISTORY_PAGE_SIZE` ใน `js/record.js`
(ระบบ Login อ่านรายชื่อ users ทุกครั้งที่เปิดหน้า Login — ไม่ได้แก้ตามที่ขอ แต่ปกติมีไม่กี่ user)

## สิ่งที่แก้ไข (ไม่ได้แตะระบบ Login / User)

### ข้อผิดพลาดที่ทำให้ข้อมูลผิด
- **เลขที่ Gatepass ผิดวันช่วง 00:00–07:00** — เดิมใช้ `toISOString()` (เวลา UTC)
  ทำให้ใบที่ออกหลังเที่ยงคืนได้เลขของ "เมื่อวาน" และนับต่อจากเมื่อวาน
  แก้เป็นวันที่ตามเวลาเครื่อง (ไทย)
- **แก้ไขใบ Empty-Out แล้วจำนวนหาย** — ถ้า Master Data โหลดไม่ทันตอนเปิดหน้าแก้ไข
  ทุกแถวถูกมองว่า Supplier ไม่ถูกต้องและจำนวนถูกล้าง ตอนนี้รอ Master Data ก่อน
- **พิมพ์ช่อง Company/Zone แล้วจำนวนในตารางหาย** — เดิมตรวจทุกแถวทุกครั้งที่กดแป้น
  ตอนนี้ตรวจเมื่อออกจากช่อง/เลือกค่าแล้ว
- **แก้ไขใบ Gatepass IN แล้วตารางว่าง** — หน้า gatepass-in ตั้งค่าฟอร์มซ้ำ 2 ครั้ง
  (หลัง sign-in) ครั้งที่ 2 ล้างตารางของใบที่กำลังแก้ไข
- **แก้ไขใบแล้วเพิ่มแถวใหม่ไม่ได้** — แถวถัดจากแถวสุดท้ายถูก disable (ทั้ง issue และ gatepass-in)
- **รายงาน (Report) ตกหล่นรายการนาทีสุดท้าย** — End time 23:59 = 23:59:00
  ใบที่ออก 23:59:30 ไม่ถูกนับ (Record ก็เช่นกัน) ตอนนี้ครอบคลุมทั้งนาที
- **Export CSV ของ Record**: จำนวน 0 ออกมาเป็นช่องว่าง และไม่สนใจตัวกรอง Supplier / Search
  (ไฟล์ไม่ตรงกับที่เห็นบนจอ)
- **ตัวกรอง Company/Zone ใน Record** ไม่เจอใบ Empty-IN (company อยู่ในแต่ละแถว supplier)
- **Save Master Data** เดิมลบทั้งหมดก่อนแล้วค่อยเขียนใหม่ และลบใน batch เดียว
  (เกิน 500 แถวจะ error → master หายหมด) ตอนนี้เขียนก่อน-ลบทีหลัง แบ่ง batch และข้ามแถวว่าง
- **Delete All History** เกิน 500 รายการ error — แบ่ง batch
- **Upload CSV ของ Master** ค่าที่มีเครื่องหมาย `,` หรือ `"` ทำคอลัมน์เลื่อน — ใช้ CSV parser จริง
  และ Export ใส่ escape ให้ถูกต้อง
- **Sort ใน Master** ทำแถวที่เพิ่งเพิ่ม (ยังไม่ Save / จาก CSV) หาย และแถวที่ลบกลับมา
- **ใบพิมพ์/ตาราง** ที่มี Supplier เกิน 30 แถว ถูกตัดทิ้ง

### ปรับปรุง
- ตรวจจำนวนต้องเป็นจำนวนเต็ม ≥ 0 และตรวจ Supplier กับ Master ซ้ำตอนบันทึก
- Gatepass IN: กันเลขที่ Gatepass ซ้ำ, รายการ Supplier ของแถวที่แก้ไขแสดงครบ, มีตัวเลือก "รถเปล่า"
- Record: ปุ่ม Load More แสดงถูกต้อง (เดิมเช็ค ≥20 แต่ดึงทีละ 50)
- Report: กรอง Status ฝั่ง client ไม่ต้องสร้าง composite index เพิ่ม และเปลี่ยน Status ได้โดยไม่ต้อง Fetch ใหม่
- Escape HTML ทุกจุดที่เอาข้อมูลไปแสดง (ชื่อที่มี `"` หรือ `<` ไม่ทำหน้าพัง)
- ปิด Firestore debug log ใน gatepass-in
- GW และ WH4 ได้ฟีเจอร์ล่าสุดของ WH1 (คอลัมน์ Total, Sort, Upload History CSV,
  Report Status/Search, responsive, วันที่ DD/MM/YYYY, แถวเพิ่มอัตโนมัติ) — เดิม WH4
  กดแก้ไขใบ Empty-IN แล้วไม่โหลดข้อมูล เพราะยังไม่มีฟังก์ชันนี้

## ข้อสังเกตที่ยังไม่ได้แก้ (เกี่ยวกับ Login / ความปลอดภัย)
ตามที่ขอ ไม่ได้แตะระบบ Login แต่ควรทราบ:
- รหัสผ่านถูก hash ด้วย SHA-256 + salt คงที่ ฝั่ง browser และ collection `users`
  อ่านได้จากหน้าเว็บ — ควรย้ายไป Firebase Authentication (email/password)
- ความปลอดภัยของข้อมูลขึ้นกับ Firestore Security Rules (ไม่อยู่ใน repo นี้)
  ผู้ใช้ anonymous ทุกคนอ่าน/เขียน/ลบได้ถ้า rules เปิดไว้
