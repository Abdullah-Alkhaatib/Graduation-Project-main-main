# Clean Architecture - Backend Structure

## المبدأ الأساسي

**Routes** = HTTP Layer فقط (طلبات و ردود)  
**Services** = Business Logic Layer (منطق التطبيق و قواعد العمل)

---

## الملفات المُعاد هيكلتها

### 1️⃣ Auth Service (`src/services/auth.ts`)

**المسؤولية**: كل منطق المصادقة والتسجيل

#### الدوال الرئيسية:

```typescript
// تسجيل المستخدم الجديد
registerUser(data: RegisterData): Promise<{ user, message }>

// تسجيل الدخول
loginUser(email: string, password: string): Promise<{ user, userId, message }>

// الحصول على بيانات المستخدم
getUserById(userId: number): Promise<FormattedUser>

// تحديث ساعات المكتب
updateOfficeHours(userId: number, officeHours: string | null): Promise<FormattedUser>
```

#### الدوال الفرعية:

- `formatUser()` - تنسيق بيانات المستخدم
- `generateStudentId()` - توليد معرف الطالب
- `validateStudentId()` - التحقق من صيغة المعرف
- `isStudentIdRegistered()` - التحقق من وجود المعرف
- `isEmailRegistered()` - التحقق من البريد الإلكتروني

---

### 2️⃣ Auth Route (`src/routes/auth.ts`)

**المسؤولية**: معالجة HTTP endpoints فقط

```typescript
// الآن يتضمن:
POST   /auth/register   → registerUser()
POST   /auth/login      → loginUser()
POST   /auth/logout     → destroy session
GET    /auth/me         → getUserById()
PUT    /auth/me         → updateOfficeHours()
```

**الكود الآن نظيف وبسيط** - لا validation، لا hashing، فقط HTTP handling

---

### 3️⃣ Discussion Service (`src/services/discussion-scheduling.ts`)

**المسؤولية**: كل منطق جدولة النقاشات

#### الدوال الجديدة (Database Operations):

```typescript
// الحصول على جميع الجداول مع البيانات المرتبطة
getAllDiscussionSchedules(): Promise<DiscussionScheduleWithDetails[]>

// فلترة الجداول حسب دور المستخدم
getFilteredDiscussionSchedules(userId, userRole): Promise<DiscussionScheduleWithDetails[]>

// الحصول على آخر الإعدادات
getLatestDiscussionSettings()

// حفظ الجدول الجديد
saveDiscussionSchedule(schedules, settings): Promise<void>

// التحقق من التعارضات
checkScheduleConflicts(newSchedule, existingSchedules): boolean

// تحديث جدول
updateDiscussionSchedule(id, updates): Promise<DiscussionScheduleWithDetails | null>

// حذف جدول
deleteDiscussionSchedule(id): Promise<void>
```

---

### 4️⃣ Discussion Route (`src/routes/discussions.ts`)

**المسؤولية**: معالجة HTTP endpoints فقط

```typescript
// الآن يستخدم Service functions:
GET    /discussions           → getFilteredDiscussionSchedules()
POST   /discussions/generate  → buildDiscussionSchedule() + saveDiscussionSchedule()
PUT    /discussions/:id       → updateDiscussionSchedule()
DELETE /discussions/:id       → deleteDiscussionSchedule()
```

---

## 📐 Architecture Pattern

```
┌─────────────────────────────────────────────────────────┐
│                      HTTP Request                        │
└────────────────────────────────┬──────────────────────────┘
                                 │
                                 ▼
                    ┌──────────────────────┐
                    │   Routes Layer       │
                    │  (HTTP Handlers)     │
                    │  - Validate input    │
                    │  - Call services     │
                    │  - Format response   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │ Services Layer       │
                    │ (Business Logic)     │
                    │  - Complex logic     │
                    │  - DB operations     │
                    │  - Calculations      │
                    │  - Transformations   │
                    └──────────┬───────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Database Layer      │
                    │  (Data Persistence)  │
                    └──────────────────────┘
```

---

## ✅ الفوائد

1. **Separation of Concerns** - كل layer له مسؤولية واحدة واضحة
2. **Reusability** - Services يمكن استخدامها من عدة routes
3. **Testability** - Services سهل اختبارها منفصلة
4. **Maintainability** - الكود نظيف وسهل الفهم
5. **Scalability** - سهل إضافة features جديدة

---

## 🔄 مثال عملي: الاختلاف

### قبل (Business Logic في Route):

```typescript
router.post("/auth/register", async (req, res) => {
  const { email, password, name } = req.body;
  // ✗ validation هنا
  // ✗ database query هنا
  // ✗ hashing هنا
  // ✗ error handling معقد
  res.json(user);
});
```

### بعد (Clean Architecture):

```typescript
// Route: فقط HTTP handling
router.post("/auth/register", async (req, res) => {
  try {
    const result = await registerUser(req.body);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Service: كل المنطق
export async function registerUser(data: RegisterData) {
  validateInput(data);
  hashPassword();
  saveToDatabase();
  return formattedResult;
}
```

---

## 📝 الخطوات القادمة

الـ routes التالية تحتاج إعادة هيكلة بنفس الطريقة:

- [ ] `teams.ts` → `services/teams.ts`
- [ ] `tasks.ts` → `services/tasks.ts`
- [ ] `users.ts` → `services/users.ts`
- [ ] `meetings.ts` → `services/meetings.ts`
- [ ] وغيرها...

---

## 🚀 كيف تضيف Service جديد؟

### الخطوة 1: إنشاء Service File

```typescript
// src/services/myFeature.ts
export async function doSomething(input: InputType): Promise<OutputType> {
  // Business logic here
}
```

### الخطوة 2: استخدمه في Route

```typescript
// src/routes/myFeature.ts
import { doSomething } from "../services/myFeature";

router.post("/endpoint", async (req, res) => {
  const result = await doSomething(req.body);
  res.json(result);
});
```

---

تم إعادة الهيكلة بنجاح! ✨
