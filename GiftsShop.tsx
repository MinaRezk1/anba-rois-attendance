import React, { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from './firebase';
import { doc, onSnapshot, setDoc, runTransaction } from 'firebase/firestore';
import { getApp } from 'firebase/app';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';

const auth = getAuth(getApp()); // بيستخدم نفس مشروع Firebase بتاعك أوتوماتيك

// ============================================================
// إعدادات
// ============================================================
const SHOP_DOC = doc(db, 'shop', 'data'); // مستند مستقل تمامًا لبيانات المتجر
const STUDENTS_DOC = doc(db, 'appData', 'students_v8'); // نفس مستند بيانات الطلاب والنقط الأساسي

// رقم الموبايل ممكن يتكتب بأشكال مختلفة (بمسافات، بصفر، بـ 20+ إلخ) - الدالة دي بتوحّدهم
const normalizePhone = (value: string) => {
  const digits = (value || '').replace(/\D/g, '');
  return digits.replace(/^20/, '').replace(/^0+/, '').slice(-10);
};

// إجمالي نقط الطالب = نقط السنة الحالية + نقط السنين اللي فاتت (نفس منطق التطبيق الأساسي)
const getTotalPoints = (student: any) => (Number(student?.points) || 0) + (Number(student?.previousYearsPoints) || 0);

declare global {
  interface Window { __isMinaAdmin?: boolean; }
}

// ============================================================
// أنواع البيانات
// ============================================================
type ProductSize = { label: string; qty: number };
type Product = {
  id: string;
  name: string;
  images: string[]; // ممكن أكتر من صورة للهدية الواحدة
  points: number;
  sizes: ProductSize[]; // لو مفيش مقاسات، حط عنصر واحد { label: 'عادي', qty: X }
  description?: string;
};
type Order = {
  id: string;
  productId: string;
  productName: string;
  size: string;
  studentName: string;
  studentPhone: string;
  points: number;
  status: 'reserved' | 'delivered' | 'cancelled';
  createdAt: string;
};
type ShopData = { products: Product[]; orders: Order[] };

const DEFAULT_SHOP: ShopData = { products: [], orders: [] };
const genId = () => `_${Math.random().toString(36).substring(2, 11)}`;

// ============================================================
// المكوّن الرئيسي
// ============================================================
const GiftsShopWidget: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState<ShopData>(DEFAULT_SHOP);
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(() => !!(window as any).__isMinaAdmin);
  const [adminTab, setAdminTab] = useState<'products' | 'orders'>('products');
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [orderingProduct, setOrderingProduct] = useState<Product | null>(null);
  const [galleryProduct, setGalleryProduct] = useState<Product | null>(null);
  const seenOrderIds = useRef<Set<string> | null>(null);

  // بيتابع حالة دخول مينا من App.tsx مباشرة - لما يدخل بالباسورد بتاعه في الموقع الأساسي، وضع الأدمن هنا يتفعل أوتوماتيك
  useEffect(() => {
    const handler = (e: any) => setIsAdmin(!!e.detail);
    window.addEventListener('mina-admin-status', handler);
    return () => window.removeEventListener('mina-admin-status', handler);
  }, []);

  // فتح المتجر من زرار الهدية في الهيدر الرئيسي (خاص بمينا)
  useEffect(() => {
    const openHandler = () => setOpen(true);
    window.addEventListener('open-gifts-shop', openHandler);
    return () => window.removeEventListener('open-gifts-shop', openHandler);
  }, []);

  // اطلب إذن التنبيهات من المتصفح مرة واحدة لما يبقى مينا داخل، عشان يوصله تنبيه لما حد يحجز
  useEffect(() => {
    if (isAdmin && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [isAdmin]);

  useEffect(() => {
    const unsub = onSnapshot(SHOP_DOC, (snap) => {
      const data = snap.exists() ? (snap.data() as ShopData) : DEFAULT_SHOP;
      const orders = Array.isArray(data.orders) ? data.orders : [];

      // تنبيه لمينا لما يظهر طلب "محجوز" جديد ماكانش موجود قبل كده
      if (seenOrderIds.current === null) {
        // أول تحميل: سجّل اللي موجود بالفعل من غير ما تبعت تنبيهات عليهم
        seenOrderIds.current = new Set(orders.map(o => o.id));
      } else {
        const newReserved = orders.filter(o => o.status === 'reserved' && !seenOrderIds.current!.has(o.id));
        if (newReserved.length && isAdmin && 'Notification' in window && Notification.permission === 'granted') {
          newReserved.forEach(o => {
            new Notification('🎁 حجز هدية جديد', { body: `${o.studentName} حجز "${o.productName}" (${o.points} نقطة)` });
          });
        }
        orders.forEach(o => seenOrderIds.current!.add(o.id));
      }

      setShop({
        products: Array.isArray(data.products) ? data.products : [],
        orders,
      });
      window.dispatchEvent(new CustomEvent('gifts-pending-count', { detail: orders.filter(o => o.status === 'reserved').length }));
      setLoading(false);
    }, () => setLoading(false));
    const unsubStudents = onSnapshot(STUDENTS_DOC, (snap) => {
      const items = snap.exists() ? (snap.data() as any)?.items : [];
      setStudents(Array.isArray(items) ? items : []);
    });
    return () => { unsub(); unsubStudents(); };
  }, [isAdmin]);

  const saveShop = async (next: ShopData) => {
    const prev = shop;
    setShop(next); // تحديث فوري للشكل، بس هنرجعه لو الحفظ الحقيقي فشل
    try {
      await setDoc(SHOP_DOC, next);
    } catch (err: any) {
      setShop(prev); // رجّع الحالة القديمة عشان الشاشة متوريش حاجة مش محفوظة فعليًا
      alert('فشل الحفظ في قاعدة البيانات: ' + (err?.message || 'خطأ غير معروف') + '\n\nتأكد من قواعد الأمان (Firestore Rules) وحاول تاني.');
    }
  };

  return (
    <>
      {/* الزرار العائم - ظاهر للأولاد عشان يطلبوا هدايا، مخفي عند مينا لأن عنده زرار مخصص فوق */}
      {!isAdmin && (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', bottom: '90px', left: '16px', zIndex: 9998,
          width: '56px', height: '56px', borderRadius: '50%',
          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          boxShadow: '0 4px 14px rgba(245,158,11,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '28px', border: 'none', cursor: 'pointer',
        }}
        aria-label="الهدايا"
      >
        🎁
      </button>
      )}

      {open && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: '#0f0a2e', overflowY: 'auto',
            fontFamily: 'inherit', direction: 'rtl',
          }}
        >
          {/* الهيدر */}
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: '#1e1b4b', padding: '14px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            borderBottom: '1px solid #3730a3',
          }}>
            <h1 style={{ color: '#fbbf24', fontSize: '20px', fontWeight: 800, margin: 0 }}>
              🎁 متجر الهدايا
            </h1>
            <div style={{ display: 'flex', gap: '8px' }}>
              {isAdmin && (
                <span style={{ background: '#059669', color: 'white', borderRadius: '8px', padding: '6px 12px', fontSize: '13px', fontWeight: 700 }}>
                  وضع الأدمن ✓
                </span>
              )}
              <button onClick={() => setOpen(false)}
                style={{ background: '#312e81', border: 'none', color: 'white', borderRadius: '8px', width: '34px', height: '34px', fontSize: '18px' }}>
                ✕
              </button>
            </div>
          </div>

          {/* تابات الأدمن */}
          {isAdmin && (
            <div style={{ display: 'flex', gap: '8px', padding: '12px 16px 0' }}>
              <button onClick={() => setAdminTab('products')}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', border: 'none',
                  background: adminTab === 'products' ? '#fbbf24' : '#312e81',
                  color: adminTab === 'products' ? '#1e1b4b' : '#c7d2fe',
                }}>
                📦 المنتجات ({shop.products.length})
              </button>
              <button onClick={() => setAdminTab('orders')}
                style={{
                  flex: 1, padding: '10px', borderRadius: '10px', fontWeight: 700, fontSize: '14px', border: 'none',
                  background: adminTab === 'orders' ? '#fbbf24' : '#312e81',
                  color: adminTab === 'orders' ? '#1e1b4b' : '#c7d2fe',
                }}>
                📋 الطلبات ({shop.orders.filter(o => o.status === 'reserved').length})
              </button>
            </div>
          )}

          <div style={{ padding: '16px' }}>
            {loading && <p style={{ color: '#a5b4fc', textAlign: 'center' }}>جاري التحميل...</p>}

            {/* عرض المنتجات (للجميع) */}
            {(!isAdmin || adminTab === 'products') && !loading && (
              <>
                {isAdmin && (
                  <button
                    onClick={() => setEditingProduct({ id: genId(), name: '', images: [], points: 100, sizes: [{ label: 'عادي', qty: 1 }] })}
                    style={{ width: '100%', padding: '14px', marginBottom: '16px', borderRadius: '12px', border: '2px dashed #4338ca', background: 'transparent', color: '#a5b4fc', fontWeight: 700, fontSize: '15px' }}>
                    + إضافة هدية جديدة
                  </button>
                )}

                {shop.products.length === 0 && (
                  <p style={{ color: '#818cf8', textAlign: 'center', marginTop: '40px' }}>
                    لا توجد هدايا متاحة حاليًا
                  </p>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '14px' }}>
                  {shop.products.map(product => {
                    const totalQty = product.sizes.reduce((s, x) => s + x.qty, 0);
                    return (
                      <div key={product.id} style={{
                        background: '#1e1b4b', borderRadius: '16px', overflow: 'hidden',
                        border: '1px solid #312e81', display: 'flex', flexDirection: 'column',
                      }}>
                        <div style={{ width: '100%', aspectRatio: '1', background: '#312e81', position: 'relative' }}>
                          {product.images?.[0] ? (
                            <img src={product.images[0]} alt={product.name} onClick={() => setGalleryProduct(product)}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '40px' }}>🎁</div>
                          )}
                          {product.images?.length > 1 && (
                            <button onClick={() => setGalleryProduct(product)}
                              style={{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '6px', color: 'white', padding: '4px 8px', fontSize: '11px', fontWeight: 700 }}>
                              📷 {product.images.length} صور
                            </button>
                          )}
                          {totalQty === 0 && (
                            <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '13px' }}>
                              نفذت الكمية
                            </div>
                          )}
                          {isAdmin && (
                            <button onClick={() => setEditingProduct(product)}
                              style={{ position: 'absolute', top: '6px', left: '6px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '6px', color: 'white', width: '28px', height: '28px', fontSize: '13px' }}>
                              ✏️
                            </button>
                          )}
                        </div>
                        <div style={{ padding: '10px' }}>
                          <p style={{ color: 'white', fontWeight: 700, fontSize: '14px', margin: '0 0 4px' }}>{product.name}</p>
                          <p style={{ color: '#fbbf24', fontWeight: 800, fontSize: '14px', margin: '0 0 8px' }}>
                            {product.points} نقطة
                          </p>
                          <button
                            disabled={totalQty === 0}
                            onClick={() => setOrderingProduct(product)}
                            style={{
                              width: '100%', padding: '8px', borderRadius: '8px', border: 'none', fontWeight: 700, fontSize: '13px',
                              background: totalQty === 0 ? '#4b5563' : '#f59e0b', color: totalQty === 0 ? '#9ca3af' : '#1e1b4b',
                            }}>
                            {totalQty === 0 ? 'غير متاح' : 'اطلب الآن'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* الطلبات (أدمن فقط) */}
            {isAdmin && adminTab === 'orders' && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {shop.orders.length === 0 && <p style={{ color: '#818cf8', textAlign: 'center' }}>لا توجد طلبات بعد</p>}
                {[...shop.orders].reverse().map(order => (
                  <div key={order.id} style={{ background: '#1e1b4b', borderRadius: '12px', padding: '12px', border: '1px solid #312e81' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <span style={{ color: 'white', fontWeight: 700 }}>{order.productName} ({order.size})</span>
                      <span style={{
                        fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '6px',
                        background: order.status === 'reserved' ? '#f59e0b' : order.status === 'delivered' ? '#059669' : '#dc2626',
                        color: 'white',
                      }}>
                        {order.status === 'reserved' ? 'محجوز' : order.status === 'delivered' ? 'تم التسليم' : 'ملغي'}
                      </span>
                    </div>
                    <p style={{ color: '#c7d2fe', fontSize: '13px', margin: '2px 0' }}>👤 {order.studentName} — 📱 {order.studentPhone}</p>
                    <p style={{ color: '#fbbf24', fontSize: '13px', margin: '2px 0 10px' }}>💰 {order.points} نقطة</p>
                    {order.status === 'reserved' && (
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => {
                            const next = { ...shop, orders: shop.orders.map(o => o.id === order.id ? { ...o, status: 'delivered' as const } : o) };
                            saveShop(next);
                          }}
                          style={{ flex: 1, padding: '8px', borderRadius: '8px', border: 'none', background: '#059669', color: 'white', fontWeight: 700, fontSize: '13px' }}>
                          ✓ تم التسليم (اخصم النقط يدويًا الآن)
                        </button>
                        <button
                          onClick={() => {
                            // رجّع الكمية للمنتج وألغي الطلب
                            const products = shop.products.map(p => {
                              if (p.id !== order.productId) return p;
                              return { ...p, sizes: p.sizes.map(s => s.label === order.size ? { ...s, qty: s.qty + 1 } : s) };
                            });
                            const orders = shop.orders.map(o => o.id === order.id ? { ...o, status: 'cancelled' as const } : o);
                            saveShop({ products, orders });
                          }}
                          style={{ padding: '8px 12px', borderRadius: '8px', border: 'none', background: '#dc2626', color: 'white', fontWeight: 700, fontSize: '13px' }}>
                          إلغاء
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* مودال معاينة الصور */}
      {galleryProduct && (
        <ImageGallery product={galleryProduct} onClose={() => setGalleryProduct(null)} />
      )}

      {/* مودال إضافة/تعديل منتج */}
      {editingProduct && (
        <ProductEditor
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSave={(p) => {
            const exists = shop.products.some(x => x.id === p.id);
            const products = exists ? shop.products.map(x => x.id === p.id ? p : x) : [...shop.products, p];
            saveShop({ ...shop, products });
            setEditingProduct(null);
          }}
          onDelete={() => {
            saveShop({ ...shop, products: shop.products.filter(x => x.id !== editingProduct.id) });
            setEditingProduct(null);
          }}
        />
      )}

      {/* مودال الطلب */}
      {orderingProduct && (
        <OrderForm
          product={orderingProduct}
          students={students}
          onClose={() => setOrderingProduct(null)}
          onConfirm={async (size, matchedStudent) => {
            try {
              await runTransaction(db, async (tx) => {
                const shopSnap = await tx.get(SHOP_DOC);
                const studentsSnap = await tx.get(STUDENTS_DOC);
                const shopNow = shopSnap.exists() ? (shopSnap.data() as ShopData) : DEFAULT_SHOP;
                const studentsData = studentsSnap.exists() ? (studentsSnap.data() as any) : { items: [] };
                const items = Array.isArray(studentsData.items) ? studentsData.items : [];

                const idx = items.findIndex((s: any) => s.id === matchedStudent.id);
                if (idx === -1) throw new Error('الطالب مش موجود، حاول تاني');

                const liveStudent = items[idx];
                const total = getTotalPoints(liveStudent);
                if (total < orderingProduct.points) throw new Error('رصيد النقط مش كافي لشراء الهدية دي');

                const product = shopNow.products.find(p => p.id === orderingProduct.id);
                const sizeObj = product?.sizes.find(s => s.label === size);
                if (!product || !sizeObj || sizeObj.qty <= 0) throw new Error('نفذت الكمية، جرب هدية تانية');

                // اخصم من نقط السنة الحالية الأول، ولو مش كفاية خد الباقي من نقط السنين اللي فاتت
                let remaining = orderingProduct.points;
                let newPoints = Number(liveStudent.points) || 0;
                let newPrev = Number(liveStudent.previousYearsPoints) || 0;
                const fromCurrent = Math.min(newPoints, remaining);
                newPoints -= fromCurrent;
                remaining -= fromCurrent;
                newPrev -= remaining;

                const newItems = [...items];
                const cairoDateKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
                const historyRecord = {
                  id: genId(),
                  date: cairoDateKey,
                  points: -orderingProduct.points,
                  type: 'giftPurchase',
                  typeName: 'شراء من متجر الهدايا',
                  description: `${orderingProduct.name}${size && size !== 'عادي' ? ` (${size})` : ''}`,
                  recordedBy: liveStudent.name,
                  recordedAt: new Date().toISOString(),
                };
                newItems[idx] = {
                  ...liveStudent,
                  points: newPoints,
                  previousYearsPoints: newPrev,
                  attendanceHistory: [historyRecord, ...(liveStudent.attendanceHistory || [])],
                };

                const newProducts = shopNow.products.map(p => p.id !== product.id ? p : {
                  ...p, sizes: p.sizes.map(s => s.label === size ? { ...s, qty: s.qty - 1 } : s),
                });
                const newOrder: Order = {
                  id: genId(), productId: product.id, productName: product.name,
                  size, studentName: liveStudent.name, studentPhone: liveStudent.phone,
                  points: orderingProduct.points, status: 'reserved', createdAt: new Date().toISOString(),
                };

                tx.set(STUDENTS_DOC, { ...studentsData, items: newItems }, { merge: true });
                tx.set(SHOP_DOC, { products: newProducts, orders: [...shopNow.orders, newOrder] });
              });
              setOrderingProduct(null);
              alert('تم خصم النقط وحجز الهدية بنجاح! هيتم التواصل معاك لتسليمها.');
            } catch (err: any) {
              alert(err?.message || 'حصل خطأ، حاول تاني');
            }
          }}
        />
      )}
    </>
  );
};

// ============================================================
// مكوّنات مساعدة
// ============================================================
const Overlay: React.FC<{ onClose: () => void; children: React.ReactNode }> = ({ onClose, children }) => (
  <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
    <div onClick={e => e.stopPropagation()} style={{ background: '#1e1b4b', borderRadius: '16px', padding: '20px', width: '100%', maxWidth: '380px', border: '1px solid #312e81', direction: 'rtl' }}>
      {children}
    </div>
  </div>
);

// بيضغط الصورة ويصغّرها قبل التخزين المباشر (من غير أي خدمة خارجية أو بطاقة ائتمان)
const compressImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const maxSize = 700;
      let { width, height } = img;
      if (width > height && width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
      else if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.55));
    };
    img.onerror = reject;
    img.src = reader.result as string;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const ProductEditor: React.FC<{ product: Product; onClose: () => void; onSave: (p: Product) => void; onDelete: () => void }> = ({ product, onClose, onSave, onDelete }) => {
  const [p, setP] = useState<Product>({ ...product, images: product.images || [] });
  const [uploading, setUploading] = useState(false);
  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #4338ca', background: '#0f0a2e', color: 'white', marginBottom: '10px', fontSize: '14px' };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of Array.from(files)) {
        const dataUrl = await compressImage(file);
        urls.push(dataUrl);
      }
      setP(prev => ({ ...prev, images: [...prev.images, ...urls] }));
    } catch (e) {
      alert('حصل خطأ في معالجة الصورة، جرب صورة تانية');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <h2 style={{ color: '#fbbf24', fontWeight: 800, marginBottom: '12px' }}>{product.name ? 'تعديل هدية' : 'هدية جديدة'}</h2>
      <label style={{ color: '#c7d2fe', fontSize: '12px' }}>اسم الهدية</label>
      <input style={inputStyle} value={p.name} onChange={e => setP({ ...p, name: e.target.value })} placeholder="تيشيرت الخدمة" />

      <label style={{ color: '#c7d2fe', fontSize: '12px' }}>الصور (تقدر ترفع أكتر من صورة للهدية الواحدة)</label>
      {p.images.length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
          {p.images.map((img, i) => (
            <div key={i} style={{ position: 'relative', width: '60px', height: '60px' }}>
              <img src={img} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '8px' }} />
              <button onClick={() => setP(prev => ({ ...prev, images: prev.images.filter((_, idx) => idx !== i) }))}
                style={{ position: 'absolute', top: '-6px', right: '-6px', background: '#dc2626', border: 'none', borderRadius: '50%', width: '20px', height: '20px', color: 'white', fontSize: '11px', lineHeight: 1 }}>✕</button>
            </div>
          ))}
        </div>
      )}
      <label style={{
        display: 'block', textAlign: 'center', padding: '14px', marginBottom: '8px', borderRadius: '10px',
        border: '2px dashed #4338ca', color: '#a5b4fc', fontWeight: 700, fontSize: '13px', cursor: 'pointer',
      }}>
        {uploading ? 'جاري المعالجة...' : '📷 اختر صور من الموبايل / الكمبيوتر'}
        <input type="file" accept="image/*" multiple disabled={uploading} onChange={e => handleFiles(e.target.files)} style={{ display: 'none' }} />
      </label>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
        <input
          id="img-url-input"
          style={{ flex: 1, padding: '10px', borderRadius: '8px', border: '1px solid #4338ca', background: '#0f0a2e', color: 'white', fontSize: '13px' }}
          placeholder="أو الصق رابط صورة (imgbb.com مثلاً) بجودة أعلى"
        />
        <button
          type="button"
          onClick={() => {
            const el = document.getElementById('img-url-input') as HTMLInputElement;
            const url = el?.value?.trim();
            if (url) { setP(prev => ({ ...prev, images: [...prev.images, url] })); el.value = ''; }
          }}
          style={{ padding: '0 16px', borderRadius: '8px', border: 'none', background: '#312e81', color: 'white', fontWeight: 700, fontSize: '13px' }}>
          إضافة
        </button>
      </div>

      <label style={{ color: '#c7d2fe', fontSize: '12px' }}>تكلفة النقط</label>
      <input style={inputStyle} type="number" value={p.points} onChange={e => setP({ ...p, points: Number(e.target.value) || 0 })} />
      <label style={{ color: '#c7d2fe', fontSize: '12px' }}>المقاسات والكميات (مقاس:كمية، مفصولة بفاصلة)</label>
      <input
        style={inputStyle}
        defaultValue={p.sizes.map(s => `${s.label}:${s.qty}`).join(', ')}
        onBlur={e => {
          const sizes = e.target.value.split(',').map(part => {
            const [label, qty] = part.split(':').map(s => s.trim());
            return { label: label || 'عادي', qty: Number(qty) || 0 };
          }).filter(s => s.label);
          setP({ ...p, sizes: sizes.length ? sizes : [{ label: 'عادي', qty: 0 }] });
        }}
        placeholder="S:3, M:5, L:2"
      />
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button onClick={() => onSave(p)} disabled={!p.name || uploading} style={{ flex: 1, padding: '12px', borderRadius: '10px', border: 'none', background: '#f59e0b', color: '#1e1b4b', fontWeight: 800 }}>حفظ</button>
        {product.name && <button onClick={onDelete} style={{ padding: '12px 16px', borderRadius: '10px', border: 'none', background: '#dc2626', color: 'white', fontWeight: 700 }}>حذف</button>}
        <button onClick={onClose} style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid #4338ca', background: 'transparent', color: '#c7d2fe' }}>إلغاء</button>
      </div>
    </Overlay>
  );
};

const OrderForm: React.FC<{ product: Product; students: any[]; onClose: () => void; onConfirm: (size: string, student: any) => void }> = ({ product, students, onClose, onConfirm }) => {
  const availableSizes = product.sizes.filter(s => s.qty > 0);
  const [size, setSize] = useState(availableSizes[0]?.label || '');
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const recaptchaRef = useRef<HTMLDivElement>(null);

  const inputStyle: React.CSSProperties = { width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #4338ca', background: '#0f0a2e', color: 'white', marginBottom: '10px', fontSize: '14px' };

  const normalized = normalizePhone(phone);
  const matchedStudent = normalized.length >= 7 ? students.find(s => normalizePhone(s.phone) === normalized) : null;
  const totalPoints = matchedStudent ? getTotalPoints(matchedStudent) : 0;
  const enough = matchedStudent ? totalPoints >= product.points : false;

  const sendCode = async () => {
    if (!matchedStudent || !enough) return;
    setSending(true); setError('');
    try {
      if (!(window as any)._recaptchaVerifier) {
        (window as any)._recaptchaVerifier = new RecaptchaVerifier(auth, recaptchaRef.current!, { size: 'invisible' });
      }
      const verifier = (window as any)._recaptchaVerifier;
      const intlPhone = '+20' + normalized; // تحويل الرقم لصيغة مصر الدولية +20
      const result = await signInWithPhoneNumber(auth, intlPhone, verifier);
      confirmationRef.current = result;
      setStep('code');
    } catch (e: any) {
      setError(`فشل إرسال الكود (${e?.code || 'خطأ'}): ${e?.message || 'حاول تاني'}`);
    } finally {
      setSending(false);
    }
  };

  const verifyAndConfirm = async () => {
    if (!confirmationRef.current) return;
    setSending(true); setError('');
    try {
      await confirmationRef.current.confirm(code);
      await onConfirm(size, matchedStudent);
    } catch (e: any) {
      setError('الكود غلط، حاول تاني');
    } finally {
      setSending(false);
    }
  };

  return (
    <Overlay onClose={onClose}>
      <div ref={recaptchaRef} />
      <h2 style={{ color: '#fbbf24', fontWeight: 800, marginBottom: '4px' }}>{product.name}</h2>
      <p style={{ color: '#a5b4fc', marginBottom: '12px' }}>{product.points} نقطة</p>

      {step === 'phone' && (
        <>
          {availableSizes.length > 1 && (
            <>
              <label style={{ color: '#c7d2fe', fontSize: '12px' }}>اختر المقاس</label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {availableSizes.map(s => (
                  <button key={s.label} onClick={() => setSize(s.label)}
                    style={{ padding: '8px 16px', borderRadius: '8px', border: size === s.label ? '2px solid #fbbf24' : '1px solid #4338ca', background: size === s.label ? '#312e81' : 'transparent', color: 'white', fontWeight: 700 }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <label style={{ color: '#c7d2fe', fontSize: '12px' }}>رقم موبايلك (المسجل في الحضور)</label>
          <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="01xxxxxxxxx" inputMode="tel" />

          {normalized.length >= 7 && !matchedStudent && (
            <p style={{ color: '#f87171', fontSize: '13px', margin: '-4px 0 10px' }}>مش لاقي رقم الموبايل ده في قائمة الطلاب</p>
          )}
          {matchedStudent && (
            <p style={{ fontSize: '13px', margin: '-4px 0 10px', color: enough ? '#4ade80' : '#f87171' }}>
              {matchedStudent.name} — رصيدك: {totalPoints} نقطة {!enough && '(مش كفاية)'}
            </p>
          )}
          {error && <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '10px' }}>{error}</p>}

          <button
            disabled={!matchedStudent || !enough || !size || sending}
            onClick={sendCode}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: (!matchedStudent || !enough || !size) ? '#4b5563' : '#f59e0b', color: '#1e1b4b', fontWeight: 800, marginTop: '4px' }}>
            {sending ? 'جاري الإرسال...' : 'إرسال كود التحقق'}
          </button>
        </>
      )}

      {step === 'code' && (
        <>
          <p style={{ color: '#c7d2fe', fontSize: '13px', marginBottom: '10px' }}>
            بعتنا كود على {phone}، اكتبه هنا:
          </p>
          <input style={inputStyle} value={code} onChange={e => setCode(e.target.value)} placeholder="123456" inputMode="numeric" />
          {error && <p style={{ color: '#f87171', fontSize: '13px', marginBottom: '10px' }}>{error}</p>}
          <button
            disabled={!code || sending}
            onClick={verifyAndConfirm}
            style={{ width: '100%', padding: '12px', borderRadius: '10px', border: 'none', background: !code ? '#4b5563' : '#f59e0b', color: '#1e1b4b', fontWeight: 800 }}>
            {sending ? 'جاري التأكيد...' : 'تأكيد وخصم النقط'}
          </button>
        </>
      )}
    </Overlay>
  );
};

// معاينة الصور بجودة كاملة مع تحميل
const ImageGallery: React.FC<{ product: Product; onClose: () => void }> = ({ product, onClose }) => {
  const [index, setIndex] = useState(0);
  const images = product.images || [];
  const current = images[index];
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px', direction: 'rtl' }}>
      <button onClick={onClose} style={{ position: 'absolute', top: '16px', left: '16px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', color: 'white', width: '36px', height: '36px', fontSize: '18px' }}>✕</button>
      <p style={{ color: 'white', fontWeight: 700, marginBottom: '10px' }}>{product.name} ({index + 1}/{images.length})</p>
      <div onClick={e => e.stopPropagation()} style={{ maxWidth: '92vw', maxHeight: '65vh', display: 'flex', alignItems: 'center', gap: '10px' }}>
        {images.length > 1 && (
          <button onClick={() => setIndex(i => (i - 1 + images.length) % images.length)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', color: 'white', width: '36px', height: '36px', fontSize: '18px', flexShrink: 0 }}>‹</button>
        )}
        <img src={current} style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: '12px', objectFit: 'contain' }} />
        {images.length > 1 && (
          <button onClick={() => setIndex(i => (i + 1) % images.length)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '50%', color: 'white', width: '36px', height: '36px', fontSize: '18px', flexShrink: 0 }}>›</button>
        )}
      </div>
      <a href={current} download onClick={e => e.stopPropagation()}
        style={{ marginTop: '14px', background: '#f59e0b', color: '#1e1b4b', fontWeight: 800, padding: '10px 20px', borderRadius: '10px', textDecoration: 'none', fontSize: '14px' }}>
        ⬇ تحميل الصورة
      </a>
    </div>
  );
};

// ============================================================
// التركيب الذاتي على الصفحة - مش محتاج تحط الكومبوننت في أي مكان تاني
// ============================================================
const mountPoint = document.createElement('div');
mountPoint.id = 'gifts-shop-root';
document.body.appendChild(mountPoint);
createRoot(mountPoint).render(<GiftsShopWidget />);

export default GiftsShopWidget;
