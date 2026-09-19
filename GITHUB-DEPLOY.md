# رفع المشروع على GitHub وتشغيله Online

## 1) اعمل Repository جديد

اعمل Repository جديد على GitHub، واختار اسم بسيط مثل:

`secondary-boys-attendance`

يفضل يكون **Public** لو هتستخدم GitHub Pages بالطريقة المجانية العادية.

## 2) ارفع المشروع

من داخل فولدر المشروع شغّل:

```bash
git init
git add .
git commit -m "Initial deployment"
git branch -M main
git remote add origin https://github.com/USERNAME/REPOSITORY.git
git push -u origin main
```

بدّل `USERNAME` و`REPOSITORY` ببيانات حسابك.

## 3) فعّل GitHub Pages

داخل الـRepository:

**Settings → Pages → Build and deployment → Source → GitHub Actions**

بعد أول `push` إلى `main`، الـworkflow الموجود في:

`.github/workflows/deploy.yml`

سيعمل Build وينشر مجلد `dist` تلقائياً.

## 4) رابط الموقع

غالباً سيكون:

`https://USERNAME.github.io/REPOSITORY/`

إعداد Vite في المشروع يكتشف اسم الـRepository تلقائياً أثناء GitHub Actions، لذلك لا تحتاج لتغيير `base` يدوياً.

## 5) ملاحظة Firebase مهمة جداً

المشروع حالياً يستخدم Firebase Firestore، لكن `firestore.rules` الحالية تسمح بالقراءة والكتابة بدون تسجيل دخول. هذا يجعل النشر مناسباً للاختبار فقط.

كذلك تسجيل الخدام الحالي يعتمد على PIN داخل تطبيق العميل، وبالتالي لا يعتبر نظام صلاحيات آمن ضد مستخدم يستطيع فحص كود الموقع.

قبل استخدام الموقع ببيانات حقيقية، يجب إضافة Firebase Authentication وقواعد Firestore مقيدة حسب صلاحيات المستخدم.
