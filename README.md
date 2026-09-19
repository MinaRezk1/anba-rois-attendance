# Points ثانوي بنين — اجتماع الأنبا رويس

تطبيق React/Vite لتسجيل الحضور والنقاط، مع Firebase Firestore، قارئ باركود، وواجهة PWA.

## تشغيل محلي

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## النشر على GitHub Pages

المشروع يحتوي على workflow جاهز في `.github/workflows/deploy.yml`. بعد رفع المشروع إلى مستودع GitHub واستخدام الفرع `main`: 

1. افتح **Settings → Pages** في المستودع.
2. اختر **GitHub Actions** كمصدر النشر.
3. ادفع أي commit إلى `main` وانتظر انتهاء workflow.

إعداد Vite يقرأ اسم المستودع تلقائياً أثناء GitHub Actions، لذلك لا تحتاج لتعديل `base` يدوياً لمستودع عادي.

## Firebase

إعداد Firebase الحالي موجود في `firebase-applet-config.json`. إعدادات Firebase Web العامة مثل `apiKey` ليست بيانات خدمة سرية، لكن **قواعد Firestore الحالية تسمح بالقراءة والكتابة للجميع**. هذا مناسب للاختبار فقط وليس مناسباً لبيانات حقيقية قبل إضافة Firebase Authentication وقواعد وصول مقيدة.

## ملاحظات مهمة

- الحضور العادي مقيد بوقت اجتماع الجمعة 3–5 م.
- الجمعة الأولى من الشهر مخصصة للقداس 8 ص–12 م.
- التطبيق يستخدم توقيت `Africa/Cairo` لحساب التاريخ والوقت.
- ملف `App-fixed.tsx` والملفات المؤقتة القديمة أزيلت من النسخة المنشورة.
