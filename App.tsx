import React from 'react';
import { createPortal } from 'react-dom';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './index.css';
import { db } from './firebase';
import './GiftsShop';
import { doc, onSnapshot, setDoc, runTransaction, deleteField } from 'firebase/firestore';



const generateId = () => `_${Math.random().toString(36).substring(2, 11)}`;

const CAIRO_TIMEZONE = 'Africa/Cairo';
const APP_VERSION = '2026.10.02.v39';

const getCairoDateParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: CAIRO_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hourCycle: 'h23',
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return {
        year: Number(values.year),
        month: Number(values.month),
        day: Number(values.day),
        hour: Number(values.hour),
        minute: Number(values.minute),
        weekday: values.weekday,
    };
};

const getCairoDateKey = (date = new Date()) => {
    const { year, month, day } = getCairoDateParts(date);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const getCairoMonthPrefix = (date = new Date()) => getCairoDateKey(date).slice(0, 7);

const isEarlyBadgeEligibleAt = (date = new Date()) => {
    const parts = getCairoDateParts(date);
    return parts.weekday === 'Fri' && !isFirstFridayDateKey(getCairoDateKey(date)) &&
        parts.hour === 15 && parts.minute >= 0 && parts.minute < 15;
};

// سجلات "مكافآت" (ترتيب الشهر، الأوسمة...) وسجلات "متجر الهدايا" مش نشاط الولد نفسه،
// فمابتدخلش في ترتيب الشهر ولا في حساب أوسمة المشاركة ولا في إحصائيات الاجتماع.
const isRewardRecord = (h) => Boolean(h) && (
    (typeof h.typeName === 'string' && h.typeName.startsWith('مكافأة')) ||
    (typeof h.meta === 'string' && /^(leaderboard_reward_|badge_reward_|manual_badge_bonus_|monthly_all_)/.test(h.meta))
);
const isGiftRecord = (h) => Boolean(h) && (h.type === 'giftPurchase' || h.type === 'giftRefund');
const isActivityRecord = (h) => !isRewardRecord(h) && !isGiftRecord(h);

// رقم الموبايل المصري بصيغة واتساب (20 + الرقم من غير الصفر)
const toWhatsAppNumber = (phone) => {
    const d = String(phone || '').replace(/\D/g, '');
    if (/^01[0125]\d{8}$/.test(d)) return '2' + d;
    if (/^1[0125]\d{8}$/.test(d)) return '20' + d;
    if (/^201[0125]\d{8}$/.test(d)) return d;
    return '';
};

// النقط اللي الولد "كسبها" السنة دي (حضور ومشاركة ومكافآت...) من غير ما مشتريات الهدايا تنقّصها.
// بتستخدم في لوحة الصدارة ووسام الألف نقطة، عشان الولد مايتأخرش في الترتيب لو صرف نقطه.
const getEarnedPointsFromHistory = (history, balancePoints = 0) => {
    const earned = (history || []).filter(h => !isGiftRecord(h)).reduce((n, h) => n + Number(h.points || 0), 0);
    return Math.max(Number(balancePoints) || 0, earned);
};

// أي "حضور مبكر" بيتحسب في وسام الحضور المبكر، في أي وقت اتسجل فيه يوم الجمعة
const isEarlyBadgeRecord = (record) => Boolean(record && record.type === 'early');

const getCairoMonthPrefixOffset = (offset, date = new Date()) => {
    const parts = getCairoDateParts(date);
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + offset, 1, 12, 0, 0));
    return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

const getArabicMonthNameFromPrefix = (prefix) => {
    const [year, month] = String(prefix || '').split('-').map(Number);
    if (!year || !month) return '';
    const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيه', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${months[month - 1]} ${year}`;
};

const isFridayDateKey = (dateKey) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return false;
    return new Date(`${dateKey}T12:00:00Z`).getUTCDay() === 5;
};

const isFirstFridayDateKey = (dateKey) => isFridayDateKey(dateKey) && Number(dateKey.slice(8, 10)) <= 7;

// إضافة النقط مسموحة يوم الجمعة بس، طول اليوم (من غير مواعيد).
// أول جمعة في الشهر: القداس الشهري بدل الاجتماع.
const getAttendanceWindow = (date = new Date()) => {
    const parts = getCairoDateParts(date);
    const dateKey = getCairoDateKey(date);

    if (isFirstFridayDateKey(dateKey)) {
        return {
            kind: 'monthlyMass',
            isWithinAllowedTime: true,
            message: '',
        };
    }

    if (parts.weekday === 'Fri') {
        return {
            kind: 'meeting',
            isWithinAllowedTime: true,
            message: '',
        };
    }

    return {
        kind: 'none',
        isWithinAllowedTime: false,
        message: '⚠️ إضافة النقط متاحة يوم الجمعة بس.',
    };
};

const getMeetingTimeMessage = () => {
    const dateKey = getCairoDateKey();
    if (isFirstFridayDateKey(dateKey)) return 'القداس الشهري: متاح طول اليوم';
    if (isFridayDateKey(dateKey)) return 'الاجتماع: إضافة النقط متاحة طول اليوم';
    return 'إضافة النقط يوم الجمعة فقط';
};

// --- Current student roster whitelist (source rosters only) ---
const APPROVED_STUDENT_ROSTER_NAMES = [
    "أمير رأفت ميخائيل", "أمير رأفت وهبة", "بافلي هاني عدلي", "بولا انطون جرجس", "بولا فيليب فوزي", "بيشوي جرجس فتحي", "بيشوي جوزيف وجدي", "جورج كرم عبدة", "جيوفاني رؤوف وهبة", "رامز عماد عبيد", "استيفن جورج", "فادي عادل عريان", "فيلوباتير أسامة رمسيس", "فيلوباتير عصام جرجس", "فيلوباتير عماد عبيد", "فيلوباتير وليد حنين", "كيرلس عادل", "كيرلس نادي فرح", "كيرلس هاني فكري", "كيفين رامي حنا", "كيفين هاني عزيز", "مارسيليو سامر سعيد", "مايكل طارق عوض", "مينا هاني سمير", "يوسف مايكل عجيب", "يوسف روماني", "فيلوباتير عادل", "جرجس صابر", "فيلوباتير ماهر", "انطونيوس سامح", "يوسف جورج", "بولا مجدي", "ديفيد هاني", "نوفير ماجد", "بيتر عماد", "بافلي سمير", "كيرلس وجدي", "جوفاني مايكل", "ديفيد سامح", "فيلوباتير امجد", "فادي ايهاب", "مكاريوس عاطف", "ابانوب هاني", "جوفاني هاني", "ابرام ياسر", "جورج وجيه", "توني ريمون", "مينا هاني (بخيت)", "جرجس نبيل", "جورج شريف", "كيرلس ماجد", "استيفن منير", "جوسيان جرجس", "مينا ميلاد", "نوفير مايكل", "ماريو وائل", "اندرو صفوت واصف قزمان", "أنطون طارق", "توماس اشرف", "جوناثان ممدوح لبيب", "سبستيان ممدوح فتحي عزمي", "كيرلس اسامة حنا", "يوسف عادل عريان", "يوسف مصباح وليم حنا", "ماريو ممدوح", "انطونيوس سمر عزيز", "بافلي جورج", "توني سعيد جابر", "دانيال يوسف", "فيلوباتير خلف منقريوس", "كيرلس ميالد يوسف فهيم", "كيرلس نادي", "مارك هاني", "مينا جرجس حليم", "ابانوب ايليا ملك", "ابانوب داود بخيت", "بولا ميالد عوض الله", "كيرلس فليب فوزي", "ماركو عاطف", "مارك ايهاب صلاح", "مرقص معوض مرقص", "نوفير جورج طانيوس داود", "نوفير باسلي", "مينا ايهاب عطالله عطية"
];

const normalizeRosterStudentName = (name) => String(name || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/اللة/g, 'الله')
    .replace(/كرلس/g, 'كيرلس')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase();

const APPROVED_STUDENT_ROSTER_KEYS = new Set(APPROVED_STUDENT_ROSTER_NAMES.map(normalizeRosterStudentName));

const isApprovedRosterStudent = (student) => Boolean(
    student && APPROVED_STUDENT_ROSTER_KEYS.has(normalizeRosterStudentName(student.name))
);

const FIRST_SECONDARY_ROSTER_NAMES = [
    "أمير رأفت ميخائيل", "أمير رأفت وهبة", "بافلي هاني عدلي", "بولا انطون جرجس", "بولا فيليب فوزي", "بيشوي جرجس فتحي", "بيشوي جوزيف وجدي", "جورج كرم عبدة", "جيوفاني رؤوف وهبة", "رامز عماد عبيد", "استيفن جورج", "فادي عادل عريان", "فيلوباتير أسامة رمسيس", "فيلوباتير عصام جرجس", "فيلوباتير عماد عبيد", "فيلوباتير وليد حنين", "كيرلس عادل", "كيرلس نادي فرح", "كيرلس هاني فكري", "كيفين رامي حنا", "كيفين هاني عزيز", "مارسيليو سامر سعيد", "مايكل طارق عوض", "مينا هاني سمير", "يوسف مايكل عجيب", "يوسف روماني"
];

const SECOND_SECONDARY_ROSTER_NAMES = [
    "فيلوباتير عادل", "جرجس صابر", "فيلوباتير ماهر", "انطونيوس سامح", "يوسف جورج", "بولا مجدي", "ديفيد هاني", "نوفير ماجد", "بيتر عماد", "بافلي سمير", "كيرلس وجدي", "جوفاني مايكل", "ديفيد سامح", "فيلوباتير امجد", "فادي ايهاب", "مكاريوس عاطف", "ابانوب هاني", "جوفاني هاني", "ابرام ياسر", "جورج وجيه", "توني ريمون", "مينا هاني (بخيت)", "جرجس نبيل", "جورج شريف", "كيرلس ماجد", "استيفن منير", "جوسيان جرجس", "مينا ميلاد", "نوفير مايكل", "ماريو وائل"
];

const THIRD_SECONDARY_ROSTER_NAMES = [
    "اندرو صفوت واصف قزمان", "أنطون طارق", "توماس اشرف", "جوناثان ممدوح لبيب", "سبستيان ممدوح فتحي عزمي", "كيرلس اسامة حنا", "يوسف عادل عريان", "يوسف مصباح وليم حنا", "ماريو ممدوح", "انطونيوس سمر عزيز", "بافلي جورج", "توني سعيد جابر", "دانيال يوسف", "فيلوباتير خلف منقريوس", "كيرلس ميالد يوسف فهيم", "كيرلس نادي", "مارك هاني", "مينا جرجس حليم", "ابانوب ايليا ملك", "ابانوب داود بخيت", "بولا ميالد عوض الله", "كيرلس فليب فوزي", "ماركو عاطف", "مارك ايهاب صلاح", "مرقص معوض مرقص", "نوفير جورج طانيوس داود", "نوفير باسلي", "مينا ايهاب عطالله عطية"
];

const ROSTER_GRADE_BY_KEY = new Map<string, string>([
    ...FIRST_SECONDARY_ROSTER_NAMES.map(name => [normalizeRosterStudentName(name), 'أولى ثانوي'] as [string, string]),
    ...SECOND_SECONDARY_ROSTER_NAMES.map(name => [normalizeRosterStudentName(name), 'تانية ثانوي'] as [string, string]),
    ...THIRD_SECONDARY_ROSTER_NAMES.map(name => [normalizeRosterStudentName(name), 'تالتة ثانوي'] as [string, string]),
]);

const getRosterGrade = (name) => ROSTER_GRADE_BY_KEY.get(normalizeRosterStudentName(name)) || '';

const getStudentTotalPoints = (student) => (
    Number(student?.points || 0) + Number(student?.previousYearsPoints || 0)
);

const CURRENT_ROSTER_MIGRATION_VERSION = '2026-09-19-84-v8';

const LEGACY_PREVIOUS_POINTS_BY_ROSTER_KEY = {
    "انطونطارق": 69,
    "ابانوبايلياملك": 85,
    "ابانوبداودبخيت": 258,
    "ابانوبهاني": 20,
    "ابرامياسر": 253,
    "استيفنمنير": 95,
    "اندروصفوتواصفقزمان": 70,
    "انطونيوسسامح": 76,
    "انطونيوسسمرعزيز": 201,
    "بافليجورج": 10,
    "بافليسمير": 0,
    "بولامجدي": 81,
    "بولاميالدعوضالله": 0,
    "توماساشرف": 0,
    "تونيريمون": 0,
    "تونيسعيدجابر": 308,
    "جرجسصابر": 40,
    "جرجسنبيل": 232,
    "جورجشريف": 147,
    "جورجوجيه": 264,
    "جوسيانجرجس": 223,
    "جوفانيمايكل": 678,
    "جوفانيهاني": 67,
    "جوناثانممدوحلبيب": 0,
    "دانياليوسف": 0,
    "ديفيدسامح": 193,
    "ديفيدهاني": 90,
    "سبستيانممدوحفتحيعزمي": 32,
    "فاديايهاب": 22,
    "فيلوباتيرامجد": 81,
    "فيلوباتيرخلفمنقريوس": 35,
    "فيلوباتيرعادل": 90,
    "فيلوباتيرماهر": 166,
    "كيرلساسامهحنا": 0,
    "كيرلسفليبفوزي": 10,
    "كيرلسماجد": 429,
    "كيرلسميالديوسففهيم": 20,
    "كيرلسنادي": 188,
    "كيرلسوجدي": 20,
    "ماركايهابصلاح": 10,
    "ماركهاني": 0,
    "ماركوعاطف": 182,
    "ماريوممدوح": 60,
    "ماريووائل": 666,
    "مرقصمعوضمرقص": 39,
    "مكاريوسعاطف": 0,
    "ميناايهابعطاللهعطيه": 0,
    "ميناجرجسحليم": 20,
    "ميناميلاد": 689,
    "ميناهانيبخيت": 20,
    "نوفيرباسلي": 188,
    "نوفيرجورجطانيوسداود": 445,
    "نوفيرماجد": 0,
    "نوفيرمايكل": 359,
    "يوسفجورج": 182,
    "يوسفعادلعريان": 0,
    "يوسفمصباحوليمحنا": 94
};

const ROSTER_PHONE_BY_KEY: Record<string, string> = Object.fromEntries([
    ["فيلوباتير عادل", "01202821716"],
    ["جرجس صابر", "01222608959"],
    ["فيلوباتير ماهر", "01064383757"],
    ["انطونيوس سامح", "01225365059"],
    ["يوسف جورج", "01068970742"],
    ["بولا مجدي", "01270041687"],
    ["ديفيد هاني", "01226638735"],
    ["نوفير ماجد", "01211799691"],
    ["بيتر عماد", "01501609107"],
    ["بافلي سمير", "01204071377"],
    ["كيرلس وجدي", "01151984121"],
    ["جوفاني مايكل", "01555900607"],
    ["ديفيد سامح", "01212400881"],
    ["فيلوباتير امجد", "01202584343"],
    ["فادي ايهاب", "01211964760"],
    ["مكاريوس عاطف", "01226609164"],
    ["ابانوب هاني", "01284705773"],
    ["جوفاني هاني", "01287597237"],
    ["ابرام ياسر", "01278793264"],
    ["جورج وجيه", "01204715400"],
    ["توني ريمون", "01220800188"],
    ["مينا هاني (بخيت)", "01276060326"],
    ["جرجس نبيل", "01223624989"],
    ["جورج شريف", "01122701955"],
    ["كيرلس ماجد", "01227547039"],
    ["استيفن منير", "01274014019"],
    ["جوسيان جرجس", "01220294180"],
    ["مينا ميلاد", "01276059466"],
    ["نوفير مايكل", "01275882859"],
    ["ماريو وائل", "01020462906"],
    ["اندرو صفوت واصف قزمان", "01287559288"],
    ["أنطون طارق", "01279826512"],
    ["توماس اشرف", "01224397257"],
    ["جوناثان ممدوح لبيب", "01212167401"],
    ["سبستيان ممدوح فتحي عزمي", "01206193106"],
    ["كيرلس اسامة حنا", "01270543922"],
    ["يوسف عادل عريان", "01278245193"],
    ["يوسف مصباح وليم حنا", "01271324533"],
    ["ماريو ممدوح", "01272595973"],
    ["انطونيوس سمرعزيز", "01289887538"],
    ["بافلى جورج", "01210974334"],
    ["توني سعيد جابر", "01226829955"],
    ["دانيال يوسف", "01275079109"],
    ["فيلوباتير خلف منقريوس", "01221743554"],
    ["كيرلس ميالد يوسف فهيم", "01155545767"],
    ["كيرلس نادي", "01276314822"],
    ["مارك هاني", "01227435884"],
    ["مينا جرجس حليم", "01055454404"],
    ["ابانوب ايليا ملك", "01096682909"],
    ["ابانوب داود بخيت", "01040749854"],
    ["بولا ميالد عوض الله", "01223064403"],
    ["كيرلس فليب فوزي", "01283999238"],
    ["ماركو عاطف", "01557000318"],
    ["مارك ايهاب صلاح", "1205495040"],
    ["مرقص معوض مرقص", "01274469314"],
    ["نوفير جورج طانيوس داود", "01275827197"],
    ["نوفير باسلي", ""],
    ["مينا ايهاب عطالله عطية", "1211593635"],
    ["أمير رأفت ميخائيل", "012813268600"],
    ["أمير رأفت وهبة", "01213372769"],
    ["بافلي هاني عدلي", "01227966400"],
    ["بولا انطون جرجس", "01008512854"],
    ["بولا فيليب فوزي", "01283999237"],
    ["بيشوي جرجس فتحي", ""],
    ["بيشوي جوزيف وجدي", "01224480641"],
    ["جورج كرم عبدة", "01201443754"],
    ["جيوفاني رؤوف وهبة", "01274559637"],
    ["رامز عماد عبيد", "01104435124"],
    ["استيفن جورج", "01222269413"],
    ["فادي عادل عريان", "01278450193"],
    ["فيلوباتير أسامة رمسيس", "01210452293"],
    ["فيلوباتير عصام جرجس", "01277906425"],
    ["فيلوباتير عماد عبيد", "01289379006"],
    ["فيلوباتير وليد حنين", "01289379006"],
    ["كيرلس عادل", ""],
    ["كيرلس نادي فرح", "01284447416"],
    ["كيرلس هاني فكري", "012772165159"],
    ["كيفين رامي حنا", "01021179316"],
    ["كيفين هاني عزيز", "01289828286"],
    ["مارسيليو سامر سعيد", "01069519459"],
    ["مايكل طارق عوض", "01275169076"],
    ["مينا هاني سمير", "0115019418"],
    ["يوسف مايكل عجيب", "01221788540"],
    ["يوسف روماني", "01285046844"]
].map(([name, phone]) => [normalizeRosterStudentName(name), phone]));

const buildExactCurrentRoster = (existingItems) => {
    const existing = Array.isArray(existingItems) ? existingItems : [];
    const byName = new Map();

    existing.forEach(student => {
        const key = normalizeRosterStudentName(student?.name);
        if (key && !byName.has(key)) byName.set(key, student);
    });

    return APPROVED_STUDENT_ROSTER_NAMES
        .filter((name, index, list) => list.findIndex(other => normalizeRosterStudentName(other) === normalizeRosterStudentName(name)) === index)
        .map(name => {
            const canonicalName = normalizeRosterStudentName(name) === normalizeRosterStudentName('مينا ميالد')
                ? 'مينا ميلاد'
                : name;
            const existingStudent = byName.get(normalizeRosterStudentName(name))
                || byName.get(normalizeRosterStudentName(canonicalName));
            const grade = getRosterGrade(canonicalName);

            if (existingStudent) {
                return {
                    ...existingStudent,
                    name: canonicalName,
                    ...(grade ? { grade } : {}),
                    previousYearsPoints: Number(LEGACY_PREVIOUS_POINTS_BY_ROSTER_KEY[normalizeRosterStudentName(canonicalName)] ?? 0) || 0,
                    phone: ROSTER_PHONE_BY_KEY[normalizeRosterStudentName(canonicalName)] ?? existingStudent.phone ?? '',
                    points: 0,
                    lastAttended: null,
                    attendanceHistory: [],
                };
            }

            return {
                id: generateId(),
                name: canonicalName,
                grade: grade || '',
                points: 0,
                previousYearsPoints: Number(LEGACY_PREVIOUS_POINTS_BY_ROSTER_KEY[normalizeRosterStudentName(canonicalName)] ?? 0) || 0,
                phone: ROSTER_PHONE_BY_KEY[normalizeRosterStudentName(canonicalName)] ?? '',
                lastAttended: null,
                attendanceHistory: [],
            };
        });
};
 
const filterToApprovedRoster = (items) => Array.isArray(items)
    ? items.map(student => {
        const correctedName = normalizeRosterStudentName(student.name) === normalizeRosterStudentName('مينا ميالد')
            ? 'مينا ميلاد'
            : student.name;
        const rosterGrade = getRosterGrade(correctedName);
        const rosterPhone = ROSTER_PHONE_BY_KEY[normalizeRosterStudentName(correctedName)];
        return {
            ...student,
            name: correctedName,
            // الصف المتسجل للطالب ليه الأولوية، والقايمة الثابتة بتستخدم بس لو مفيش صف متسجل
            grade: (student.grade && String(student.grade).trim()) ? student.grade : (rosterGrade || student.grade || ''),
            phone: (student.phone && student.phone.trim()) ? student.phone : (rosterPhone !== undefined ? rosterPhone : ''),
        };
    })
    : [];

// --- Badges & Milestones Config ---
const getCurrentMonthPrefix = () => getCairoMonthPrefix();

const getMonthFormattedAr = () => new Intl.DateTimeFormat('ar-EG', { timeZone: CAIRO_TIMEZONE, month: 'long' }).format(new Date());

const BADGES_CONFIG = [
    // --- Monthly Badges (فئة الإنجازات الشهرية) ---
    {
        id: 'monthly_attendance',
        category: 'monthly',
        categoryName: 'أوسمة شهرية (تتجدد تلقائياً)',
        name: 'ملتزم الشهر الحالي',
        emoji: '📅',
        description: 'حضر الاجتماع مبكراً (بدري) 3 مرات أو أكثر خلال الشهر الميلادي الحالي',
        color: 'from-amber-400 to-yellow-600',
        check: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            return (history || []).filter(h => h.date && h.date.startsWith(prefix) && isEarlyBadgeRecord(h)).length >= 3;
        },
        getProgress: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            const count = (history || []).filter(h => h.date && h.date.startsWith(prefix) && isEarlyBadgeRecord(h)).length;
            return `${count}/3`;
        }
    },
    {
        id: 'monthly_mass',
        category: 'monthly',
        categoryName: 'أوسمة شهرية (تتجدد تلقائياً)',
        name: 'قداس الشهر الحالي',
        emoji: '⛪',
        description: 'حضر القداس الإلهي الشهري مرة واحدة على الأقل خلال الشهر الحالي',
        color: 'from-emerald-400 to-emerald-600',
        check: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            return (history || []).filter(h => h.date && h.date.startsWith(prefix) && h.type === 'monthlyMass').length >= 1;
        },
        getProgress: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            const count = (history || []).filter(h => h.date && h.date.startsWith(prefix) && h.type === 'monthlyMass').length;
            return `${count}/1`;
        }
    },
    {
        id: 'monthly_participation',
        category: 'monthly',
        categoryName: 'أوسمة شهرية (تتجدد تلقائياً)',
        name: 'متفاعل الشهر الحالي',
        emoji: '⚡',
        description: 'حصل على 25 نقطة مشاركة وتفاعل أو أكثر خلال الشهر الحالي',
        color: 'from-purple-400 to-indigo-600',
        check: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            const sum = (history || [])
                .filter(h => h.date && h.date.startsWith(prefix) && h.type === 'participation' && isActivityRecord(h))
                .reduce((acc, h) => acc + (h.points || 0), 0);
            return sum >= 25;
        },
        getProgress: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            const sum = (history || [])
                .filter(h => h.date && h.date.startsWith(prefix) && h.type === 'participation' && isActivityRecord(h))
                .reduce((acc, h) => acc + (h.points || 0), 0);
            return `${sum}/25`;
        }
    },

    // --- Cumulative / Multi-count Badges (فئة التراكمي / بعدد المرات) ---
    {
        id: 'cumulative_early_boss',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'صاحب الساعة المدققة (25 حضور)',
        emoji: '👑',
        description: 'التزم بالحضور مبكراً 25 مرة أو أكثر تراكمياً',
        color: 'from-yellow-400 to-amber-600',
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'early').length >= 25,
        getProgress: (history, points, monthPrefix) => `${(history || []).filter(h => h.type === 'early').length}/25`
    },
    {
        id: 'cumulative_mass',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'سوبر قداسات (7 مرات)',
        emoji: '⛪',
        description: 'حضر القداس الإلهي الشهري 7 مرات أو أكثر تراكمياً',
        color: 'from-teal-400 to-emerald-600',
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'monthlyMass').length >= 7,
        getProgress: (history, points, monthPrefix) => `${(history || []).filter(h => h.type === 'monthlyMass').length}/7`
    },
    {
        id: 'cumulative_confession',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'توبة مستمرة (7 اعترافات)',
        emoji: '🕊️',
        description: 'واظب على سر الاعتراف المقدس 7 مرات أو أكثر مع أب اعترافه تراكمياً',
        color: 'from-violet-400 to-fuchsia-600',
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'confession').length >= 7,
        getProgress: (history, points, monthPrefix) => `${(history || []).filter(h => h.type === 'confession').length}/7`
    },
    {
        id: 'cumulative_participation',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'شعلة نشاط (250 نقطة مشاركة)',
        emoji: '🔥',
        description: 'شارك وتفاعل بتميز في الاجتماع ليجمع 250 نقطة مشاركة أو أكثر تراكمياً',
        color: 'from-orange-500 to-rose-600',
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'participation' && isActivityRecord(h)).reduce((acc, h) => acc + (h.points || 0), 0) >= 250,
        getProgress: (history, points, monthPrefix) => {
            const sum = (history || []).filter(h => h.type === 'participation' && isActivityRecord(h)).reduce((acc, h) => acc + (h.points || 0), 0);
            return `${sum}/250`;
        }
    },
    {
        id: 'cumulative_games',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'نجم ألعاب التحديات (7 مرات)',
        emoji: '🎮',
        description: 'أحرز نقاطاً في Games Station 7 مرات أو أكثر تراكمياً',
        color: 'from-pink-500 to-pink-700',
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'gamesStation').length >= 7,
        getProgress: (history, points, monthPrefix) => `${(history || []).filter(h => h.type === 'gamesStation').length}/7`
    },
    {
        id: 'points_milestone_1000',
        category: 'cumulative',
        categoryName: 'أرقام قياسية وتراكمية',
        name: 'نادي الألف نقطة 💯',
        emoji: '💎',
        description: 'كسب 1000 نقطة أو أكثر السنة دي (مشتريات الهدايا مابتنقّصش منها)',
        color: 'from-indigo-400 to-violet-600',
        check: (history, points, monthPrefix) => getEarnedPointsFromHistory(history, points) >= 1000,
        getProgress: (history, points, monthPrefix) => `${getEarnedPointsFromHistory(history, points)}/1000`
    }
];

const checkHasAllMonthlyBadges = (student) => {
    const history = student.attendanceHistory || [];
    const points = student.points || 0;
    return BADGES_CONFIG.filter(b => b.category === 'monthly').every(b => b.check(history, points, getCairoMonthPrefix()));
};

// --- Icons ---
const BellIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" /> </svg> );
const BarcodeIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /> <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 5.25h17.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125H3.375c-.621 0-1.125-.504-1.125-1.125V6.375c0-.621.504 1.125 1.125-1.125z" /> </svg> );
const WhatsAppIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"> <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.6 15.31 3.43 16.78L2 22L7.42 20.62C8.82 21.39 10.38 21.81 12.04 21.81C17.5 21.81 21.95 17.36 21.95 11.91C21.95 6.45 17.5 2 12.04 2ZM16.63 15.26C16.42 15.73 15.32 16.3 14.96 16.36C14.61 16.41 14.06 16.41 13.66 16.2C13.26 16 12.38 15.69 11.33 14.73C9.98 13.48 9.25 12.08 9.06 11.66C8.88 11.24 9.06 11.03 9.22 10.86C9.36 10.71 9.53 10.5 9.71 10.29C9.88 10.08 9.94 9.92 10.05 9.71C10.16 9.5 10.1 9.32 10.03 9.17C9.95 9.03 9.4 7.82 9.17 7.28C8.95 6.74 8.72 6.83 8.56 6.83C8.4 6.83 8.21 6.83 8.03 6.83C7.85 6.83 7.56 6.9 7.33 7.17C7.11 7.45 6.54 7.98 6.54 9.17C6.54 10.36 7.36 11.49 7.49 11.66C7.61 11.83 9.17 14.34 11.63 15.4C12.26 15.68 12.75 15.82 13.13 15.93C13.69 16.08 14.24 16.03 14.63 15.92C15.08 15.8 16.03 15.24 16.24 14.77C16.45 14.3 16.45 13.91 16.37 13.79C16.3 13.68 16.15 13.62 15.94 13.51C15.73 13.4 14.96 13.01 14.74 12.92C14.53 12.83 14.38 12.77 14.23 13.01C14.09 13.25 13.73 13.72 13.6 13.86C13.48 14 13.35 14.03 13.14 13.92C12.93 13.81 12.1 13.54 11.1 12.64C10.3 11.9 9.76 11.01 9.61 10.73C9.46 10.45 9.58 10.32 9.7 10.2C9.81 10.09 9.95 9.94 10.09 9.79C10.22 9.66 10.27 9.55 10.35 9.4C10.43 9.25 10.38 9.12 10.32 9C10.27 8.88 10.16 8.62 10.1 8.5C10.03 8.38 9.97 8.28 10.03 8.17C10.1 8.05 10.16 8.03 10.24 8.03C10.33 8.03 10.42 8.03 10.49 8.04C10.57 8.04 10.63 8.04 10.73 8.25C10.82 8.46 11.23 9.32 11.23 9.32C11.23 9.32 11.29 9.42 11.4 9.42C11.52 9.42 11.61 9.37 11.71 9.26C11.8 9.16 12.21 8.7 12.35 8.52C12.48 8.34 12.59 8.33 12.7 8.41C12.81 8.49 13.29 8.73 13.49 8.84C13.68 8.95 13.81 9.01 13.88 9.11C13.94 9.2 13.94 9.45 13.88 9.6C13.81 9.74 13.73 9.85 13.65 9.94C13.58 10.04 13.48 10.15 13.4 10.24C13.32 10.33 13.21 10.46 13.31 10.64C13.41 10.82 13.81 11.26 13.81 11.26C13.81 11.26 14.21 11.71 14.35 11.83C14.49 11.95 14.54 12.03 14.6 12.08C14.65 12.13 14.73 12.23 14.8 12.2C14.88 12.18 15.31 11.93 15.48 11.82C15.65 11.71 15.82 11.7 15.97 11.8C16.12 11.91 16.37 12.35 16.45 12.57C16.52 12.8 16.6 13.01 16.63 13.1C16.63 13.1 16.63 15.26 16.63 15.26Z" /> </svg> );
const CameraIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}> <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" /> <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" /> </svg> );
const UserPlusIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}> <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /> </svg> );
const XIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}> <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> </svg> );
const ChevronDownIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /> </svg> );
const LoginIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /> </svg> );
const LogoutIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" /> </svg> );
const PencilIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /> </svg> );
const CheckIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /> </svg> );
const TrashIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"> <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /> </svg> );
const UserGroupIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m-7.5-2.962c.57-1.023-.095-2.21-1.04-2.962M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7C14.453 4.546 13.232 4.5 12 4.5c-1.232 0-2.453.046-3.662.138a4.006 4.006 0 00-3.7 3.7C4.546 9.547 4.5 10.768 4.5 12c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7c1.209.092 2.43.138 3.662.138 1.232 0 2.453-.046 3.662-.138a4.006 4.006 0 003.7-3.7c.092-1.209.138-2.43.138-3.662z" /> <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a3 3 0 100-6 3 3 0 000 6z" /> </svg> );
const TrophyIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9a9.75 9.75 0 1011.316-8.8-5.25 5.25 0 00-1.866-2.433A5.25 5.25 0 0013.5 6H12m2.672.034a5.25 5.25 0 013.586 2.433 9.75 9.75 0 01-11.316 8.8" /> <path strokeLinecap="round" strokeLinejoin="round" d="M12 12.75h.008v.008H12v-.008z" /> </svg> );
const CrownIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor"> <path d="M19.467 11.233L16.03 3.39a1.5 1.5 0 00-2.733 0L9.86 11.233 4.133 8.44a1.5 1.5 0 00-1.933 2.11l4.267 9.387a1.5 1.5 0 001.3.96h8.466a1.5 1.5 0 001.3-.96l4.267-9.387a1.5 1.5 0 00-1.933-2.11L19.467 11.233z" /> </svg> );
const KeyIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" /> </svg> );
const ShieldCheckIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.286zm0 13.036h.008v.008h-.008v-.008z" /> </svg> );
const CloudArrowUpIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" /> </svg> );
const CalendarIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zM14.25 15h.008v.008H14.25V15zm0 2.25h.008v.008H14.25v-.008zM16.5 15h.008v.008H16.5V15zm0 2.25h.008v.008H16.5v-.008z" /> </svg> );
const ArrowDownTrayIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" /> </svg> );
const XMarkIcon = ({ className }) => ( <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}> <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /> </svg> );


// --- Components ---
const Modal = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;
  return (
    <div 
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex justify-center items-center p-3 sm:p-4"
      style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))', paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}
      onClick={onClose}
    >
      {/* النافذة ليها أقصى طول (قد الشاشة)، والعنوان ثابت فوق، والمحتوى بيتسكرول لو طويل */}
      <div 
        className="glass-modal rounded-3xl shadow-2xl w-full max-w-md mx-auto text-white flex flex-col max-h-full overflow-hidden"
        style={{ maxHeight: 'min(92dvh, 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex justify-between items-center p-4 border-b border-indigo-800">
          <h2 className="text-xl font-bold text-amber-400">{title}</h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-indigo-700"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-4 sm:p-6 overflow-y-auto overscroll-contain flex-1 min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
          {children}
        </div>
      </div>
    </div>
  );
};

const QRScanner = ({ onScanSuccess, onScanFailure }) => {
    const scannerRef = useRef(null);
    const isMountedRef = useRef(true);
    const [error, setError] = useState(null);
    const [permissionStatus, setPermissionStatus] = useState('loading'); // loading, granted, prompt, denied
    const [isTrying, setIsTrying] = useState(false);

    const startScanner = useCallback(async () => {
        if (!isMountedRef.current) return;
        setIsTrying(true);
        setError(null);

        if (typeof Html5Qrcode === 'undefined') {
            if (isMountedRef.current) {
                setError("مكتبة مسح الكود غير متاحة. الرجاء إعادة تحميل الصفحة.");
                if (onScanFailure) onScanFailure(new Error("مكتبة مسح الكود غير متاحة."));
                setIsTrying(false);
            }
            return;
        }
        
        let html5QrCode = scannerRef.current;
        if (!html5QrCode) {
            html5QrCode = new Html5Qrcode("qr-reader");
            scannerRef.current = html5QrCode;
        }

        if (html5QrCode.isScanning) {
            try { await html5QrCode.stop(); } catch(e) { console.warn("Scanner was already scanning, failed to stop before restart:", e); }
        }

        try {
            const status = await navigator.permissions.query({ name: 'camera' });
            if (!isMountedRef.current) return;
            setPermissionStatus(status.state);
            status.onchange = () => {
                if (isMountedRef.current) {
                    setPermissionStatus(status.state);
                    if (status.state === 'denied' && scannerRef.current && scannerRef.current.isScanning) {
                        scannerRef.current.stop().catch(() => {});
                    }
                }
            };

            if (status.state === 'denied') {
                if(isMountedRef.current) {
                    setError("تم رفض الوصول إلى الكاميرا. الرجاء تمكينها من إعدادات المتصفح الخاص بك.");
                    if (onScanFailure) onScanFailure(new Error("Permission denied"));
                    setIsTrying(false);
                }
                return;
            }
        } catch (err) {
            if(isMountedRef.current) setPermissionStatus('prompt');
            console.warn("Permissions API not supported, proceeding with camera request.", err);
        }

        const config = { fps: 10, qrbox: { width: 250, height: 250 } };
        let cameraStarted = false;
        let lastError = null;

        try {
            await html5QrCode.start({ facingMode: "environment" }, config, onScanSuccess, () => {});
            cameraStarted = true;
        } catch (facingModeError) {
            lastError = facingModeError;
            if (html5QrCode.isScanning) {
                try { await html5QrCode.stop(); } catch(e){ console.error("Failed to stop after facingMode error", e); }
            }
        }

        if (!cameraStarted && isMountedRef.current) {
            try {
                const cameras: Array<{ id: string; label: string }> = await Html5Qrcode.getCameras();
                if (isMountedRef.current && cameras && cameras.length > 0) {
                    const uniqueCameras = Array.from(new Map(cameras.map(item => [item.id, item])).values());
                    const prioritizedCameras = [
                        ...uniqueCameras.filter(c => c.label.toLowerCase().includes('back') || c.label.toLowerCase().includes('خلفية')),
                        ...uniqueCameras.filter(c => !c.label.toLowerCase().includes('back') && !c.label.toLowerCase().includes('خلفية'))
                    ];
                    
                    for (const camera of prioritizedCameras) {
                        if (!isMountedRef.current) break;
                        try {
                            if (html5QrCode.isScanning) await html5QrCode.stop();
                            await html5QrCode.start(camera.id, config, onScanSuccess, () => {});
                            cameraStarted = true;
                            break;
                        } catch (startError) {
                            lastError = startError;
                        }
                    }
                }
            } catch (enumerationError) {
                lastError = enumerationError;
            }
        }

        if (isMountedRef.current) {
            if (cameraStarted) {
                 setError(null);
            } else {
                const err = lastError || new Error("فشل تشغيل أي كاميرا متاحة.");
                let userMessage = "فشل تشغيل الكاميرا. تأكد من منح الأذونات وأن الكاميرا ليست قيد الاستخدام من قبل تطبيق آخر.";
                
                if (err.name === "NotAllowedError") {
                    userMessage = "تم رفض إذن الوصول إلى الكاميرا. الرجاء السماح بالوصول في إعدادات المتصفح.";
                } else if (err.name === "NotFoundError" || (err.message && err.message.includes("Requested device not found"))) {
                    userMessage = "لم يتم العثور على كاميرا متوافقة على هذا الجهاز.";
                } else if (err.name === "NotReadableError" || (err.message && err.message.includes("Could not start video source"))) {
                    userMessage = "لا يمكن الوصول إلى الكاميرا. قد تكون قيد الاستخدام من قبل تطبيق آخر. جرب إغلاق أي تطبيقات أخرى تستخدم الكاميرا (مثل Zoom أو كاميرا النظام) وأعد تحميل الصفحة.";
                } else if (err.message) {
                   const isInternalError = err.message.includes("html5-qrcode-cli") || err.message.includes("QR code parse error");
                   if (!isInternalError) {
                       userMessage = err.message;
                   }
                }
                
                setError(userMessage);
                if (onScanFailure) onScanFailure(err);
            }
            setIsTrying(false);
        }
    }, [onScanSuccess, onScanFailure]);

    useEffect(() => {
        isMountedRef.current = true;
        
        const checkLibraryAndStart = () => {
            if (typeof Html5Qrcode !== 'undefined') {
                startScanner();
            } else {
                setTimeout(checkLibraryAndStart, 100);
            }
        };

        checkLibraryAndStart();

        return () => {
            isMountedRef.current = false;
            if (scannerRef.current && scannerRef.current.isScanning) {
                scannerRef.current.stop().catch(err => {
                    console.warn("Failed to stop scanner on unmount:", err);
                });
            }
        };
    }, [startScanner]);
    
    let content;
    if (error) {
        content = (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-indigo-950 p-4 text-center">
                <p className="text-red-400 font-semibold mb-2">{error}</p>
                {permissionStatus === 'denied' && (
                    <p className="text-indigo-300 text-sm mt-2">
                        قد تحتاج إلى الذهاب إلى إعدادات الموقع لهذا الموقع (عادة عن طريق النقر على أيقونة القفل في شريط العنوان) وإعادة تمكين إذن الكاميرا.
                    </p>
                )}
                <button
                    onClick={startScanner}
                    disabled={isTrying}
                    className="mt-4 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg transition-colors disabled:bg-amber-500/50 disabled:cursor-wait"
                >
                    {isTrying ? 'جاري المحاولة...' : 'إعادة المحاولة'}
                </button>
            </div>
        );
    } else if (isTrying || permissionStatus === 'loading' || permissionStatus === 'prompt') {
         content = (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-indigo-950 p-4 text-center">
                <p className="text-amber-400 font-semibold animate-pulse">
                    {isTrying ? 'جاري تشغيل الكاميرا...' : 'جاري طلب إذن الوصول...'}
                </p>
                {permissionStatus === 'prompt' && <p className="text-indigo-300 text-sm mt-2">
                    الرجاء السماح بالوصول في النافذة المنبثقة التي تظهر في متصفحك.
                </p>}
            </div>
        );
    }

    return (
        <div className="w-full relative aspect-square bg-indigo-950/50 rounded-lg overflow-hidden flex items-center justify-center border-4 border-indigo-800">
            <div id="qr-reader" className="w-full h-full"></div>
            {content}
        </div>
    );
};


const BarcodeDisplay = ({ studentId }) => {
    const barcodeRef = useRef(null);

    useEffect(() => {
        if (barcodeRef.current && studentId && typeof JsBarcode !== 'undefined') {
            try {
                JsBarcode(barcodeRef.current, studentId, {
                    format: "CODE128",
                    displayValue: false,
                    lineColor: "#ffffff",
                    background: "transparent",
                    margin: 10,
                    width: 2.5,
                    height: 100,
                });
            } catch (e) {
                console.error("JsBarcode error:", e);
            }
        }
    }, [studentId]);

    return (
        <div className="flex justify-center items-center p-4 bg-indigo-900 rounded-lg">
            <svg ref={barcodeRef}></svg>
        </div>
    );
};

// الجنيهات = نص النقط، وبتتغير أوتوماتيك مع النقط.
// لو مينا زوّد أو نقّص جنيهات يدوي، بيتحفظ كـ"فرق" (moneyOffset) فوق الحساب ده،
// فالجنيهات بتفضل ماشية مع النقط بعد كده بدل ما تتثبت على رقم واحد.
// (customMoney القديم كان بيثبّت الرقم نهائيًا، فبقى متجاهَل.)
const getBaseMoney = (pts) => Math.floor((Number(pts) || 0) / 2);
const getStudentMoney = (student) => {
    if (!student) return 0;
    const pts = student.moneyBasePoints ?? student.pointsForLeaderboard ?? student.points ?? 0;
    const offset = Number(student.moneyOffset) || 0;
    return Math.max(0, getBaseMoney(pts) + offset);
};


const formatCairoDateKeyAr = (dateKey, options = {}) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey || '')) return '';
    return new Date(dateKey + 'T12:00:00Z').toLocaleDateString('ar-EG', {
        timeZone: CAIRO_TIMEZONE,
        ...options,
    });
};

const formatDateKey = (date) => {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

const getFirstFridayOfFollowingMonth = (baseDate = new Date()) => {
    const parts = getCairoDateParts(baseDate);
    const d = new Date(Date.UTC(parts.year, parts.month, 1, 12, 0, 0));
    while (d.getUTCDay() !== 5) {
        d.setUTCDate(d.getUTCDate() + 1);
    }
    return formatDateKey(d);
};

const PointActions = ({ student, addPoints, onActionAfterAdd = null, fromScan = false, selectedDate, isSuperAdmin = false }) => {
    // نوع النقط المتغيرة اللي الخادم بيضيفها (مشاركة / Games / ROOTS / خصم)
    const [mode, setMode] = useState('participation');
    const [amount, setAmount] = useState('1');
    const [participationDescription, setParticipationDescription] = useState('');

    const rules = useMemo(() => {
        if (!student) return {};

        const history = student.attendanceHistory || [];
        // Super admin can edit historical dates; normal users always operate on current Cairo date/time.
        const todayCairoDate = getCairoDateKey();
        const isHistoricalEdit = isSuperAdmin && Boolean(selectedDate) && selectedDate < todayCairoDate && !fromScan;
        const targetDate = selectedDate || getCairoDateKey();
        const currentMonthStr = targetDate.substring(0, 7);
        const targetIsFriday = isFridayDateKey(targetDate);
        const targetIsFirstFriday = isFirstFridayDateKey(targetDate);
        const currentWindow = isHistoricalEdit ? null : getAttendanceWindow();
        const meetingTimeAllowed = isHistoricalEdit ? true : Boolean(currentWindow?.isWithinAllowedTime);
        
        const hasReceivedPointsToday = (type) => history.some(h => h.date === targetDate && h.type === type);
        const hasReceivedAttendanceToday = hasReceivedPointsToday('early') || hasReceivedPointsToday('late');
        const hasReceivedGamesStationToday = hasReceivedPointsToday('gamesStation');
        const hasReceivedRootsToday = hasReceivedPointsToday('roots');
        const hasReceivedMassThisMonth = history.some(h =>
            h.date && h.date.startsWith(currentMonthStr) && h.type === 'monthlyMass'
        );
        
        const hasReceivedConfessionThisMonth = history.some(h =>
            h.date && h.date.startsWith(currentMonthStr) && h.type === 'confession'
        );
        const canAddConfession = !hasReceivedConfessionThisMonth;
        const regularMeetingTimeAllowed = meetingTimeAllowed && (!isHistoricalEdit ? currentWindow?.kind !== 'monthlyMass' : true);

        return {
            canAddMass: targetIsFirstFriday && !hasReceivedMassThisMonth && meetingTimeAllowed,
            canAddEarly: targetIsFriday && !targetIsFirstFriday && !hasReceivedAttendanceToday && meetingTimeAllowed,
            canAddLate: targetIsFriday && !targetIsFirstFriday && !hasReceivedAttendanceToday && meetingTimeAllowed,
            canAddConfession: canAddConfession && meetingTimeAllowed,
            canAddGamesStation: regularMeetingTimeAllowed && !hasReceivedGamesStationToday,
            canAddRoots: regularMeetingTimeAllowed && !hasReceivedRootsToday,
            canAddParticipation: regularMeetingTimeAllowed,
            windowMessage: isHistoricalEdit ? null : (currentWindow?.message || null),
            meetingTimeLabel: getMeetingTimeMessage(),
        };
    }, [student, selectedDate, isSuperAdmin, fromScan]);

    const handleAddPoints = (type, points, description = null) => {
        addPoints(student.id, type, points, fromScan, description);
        if (onActionAfterAdd) {
            onActionAfterAdd();
        }
    };

    if (!student) return null;

    const MODES = {
        participation: { label: 'مشاركة', emoji: '✨', min: -10, max: 50, def: 1, enabled: rules.canAddParticipation, tone: 'from-amber-500 to-orange-600', ring: 'border-amber-400 text-amber-200 bg-amber-500/20' },
        gamesStation: { label: 'Games', emoji: '🎮', min: -50, max: 100, def: 1, enabled: rules.canAddGamesStation, tone: 'from-fuchsia-500 to-pink-600', ring: 'border-fuchsia-400 text-fuchsia-200 bg-fuchsia-500/20' },
        roots: { label: 'ROOTS', emoji: '🌱', min: -50, max: 100, def: 1, enabled: rules.canAddRoots, tone: 'from-emerald-500 to-teal-600', ring: 'border-emerald-400 text-emerald-200 bg-emerald-500/20' },
        exchange: { label: 'خصم', emoji: '🔄', min: 1, max: 3000, def: 5, enabled: true, tone: 'from-rose-600 to-red-700', ring: 'border-rose-400 text-rose-200 bg-rose-500/20' },
    };
    const cfg = MODES[mode];
    const clamp = (n) => Math.max(cfg.min, Math.min(cfg.max, n));
    const num = parseInt(amount, 10);
    const amountOk = !isNaN(num) && amount !== '-' && num !== 0 && num >= cfg.min && num <= cfg.max;
    const pickMode = (m) => { setMode(m); setAmount(String(MODES[m].def)); };
    const step = (d) => setAmount(prev => { const n = parseInt(prev, 10); return String(clamp((isNaN(n) ? cfg.def : n) + d)); });
    const submitAmount = () => {
        if (!amountOk || !cfg.enabled) return;
        if (mode === 'exchange') handleAddPoints('exchange', -Math.abs(num));
        else if (mode === 'participation') { handleAddPoints('participation', num, participationDescription); setParticipationDescription(''); }
        else handleAddPoints(mode, num);
        setAmount(String(cfg.def));
    };

    const quick = [
        { type: 'monthlyMass', pts: 25, label: 'قداس شهري', emoji: '⛪', ok: rules.canAddMass, tone: 'bg-purple-600' },
        { type: 'early', pts: 10, label: 'حضور مبكر', emoji: '⏰', ok: rules.canAddEarly, tone: 'bg-green-600' },
        { type: 'late', pts: 5, label: 'حضور متأخر', emoji: '🚶', ok: rules.canAddLate, tone: 'bg-yellow-600' },
        { type: 'confession', pts: 15, label: 'اعتراف', emoji: '🙏', ok: rules.canAddConfession, tone: 'bg-rose-600' },
    ];

    return (
        <div className="space-y-3">
            {!rules.canAddMass && !rules.canAddEarly && !rules.canAddLate && !rules.canAddParticipation && rules.windowMessage && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold text-amber-300">
                    {rules.windowMessage}
                </div>
            )}

            {/* الحضور والاعتراف: زرار واحد لكل نوع */}
            <div className="grid grid-cols-2 gap-2">
                {quick.map(q => (
                    <button key={q.type} type="button" onClick={() => handleAddPoints(q.type, q.pts)} disabled={!q.ok}
                        className={`flex items-center justify-between gap-1 rounded-xl px-3 py-2.5 text-white font-bold text-sm transition active:scale-[0.97] ${q.ok ? q.tone : 'bg-white/5 text-white/30 cursor-not-allowed'}`}>
                        <span className="truncate">{q.emoji} {q.label}</span>
                        <span className={`shrink-0 text-xs font-black rounded-full px-1.5 ${q.ok ? 'bg-black/20' : ''}`}>+{q.pts}</span>
                    </button>
                ))}
            </div>

            {/* النقط المتغيرة: اختار النوع، حدّد العدد، وضيف */}
            <div className="rounded-2xl border border-white/12 bg-white/5 p-2.5 space-y-2.5">
                <div className="grid grid-cols-4 gap-1">
                    {Object.entries(MODES).map(([key, m]: [string, any]) => (
                        <button key={key} type="button" onClick={() => pickMode(key)}
                            className={`rounded-lg border py-1.5 text-[11px] font-black transition ${mode === key ? m.ring : 'border-transparent text-white/55'} ${!m.enabled ? 'opacity-40' : ''}`}>
                            <div className="text-base leading-5">{m.emoji}</div>{m.label}
                        </button>
                    ))}
                </div>
                <div className="flex items-stretch gap-2">
                    <div className="flex items-center rounded-xl border border-white/15 bg-black/20 overflow-hidden">
                        <button type="button" onClick={() => step(-1)} disabled={!cfg.enabled} className="px-3 py-2 text-lg font-black text-white/80 disabled:opacity-30">−</button>
                        <input type="text" inputMode="numeric" value={amount} disabled={!cfg.enabled}
                            onChange={(e) => { const v = e.target.value; if (/^-?[0-9]*$/.test(v)) setAmount(v); }}
                            onBlur={() => { const n = parseInt(amount, 10); setAmount(isNaN(n) ? String(cfg.def) : String(clamp(n))); }}
                            className="w-12 bg-transparent text-center text-white font-black focus:outline-none disabled:opacity-40" />
                        <button type="button" onClick={() => step(1)} disabled={!cfg.enabled} className="px-3 py-2 text-lg font-black text-white/80 disabled:opacity-30">+</button>
                    </div>
                    <button type="button" onClick={submitAmount} disabled={!cfg.enabled || !amountOk}
                        className={`flex-1 rounded-xl bg-gradient-to-r ${cfg.tone} px-3 text-sm font-black text-white transition active:scale-[0.98] disabled:opacity-35 disabled:cursor-not-allowed`}>
                        {mode === 'exchange' ? `خصم ${amountOk ? Math.abs(num) : 0} نقطة` : `ضيف ${amountOk ? (num > 0 ? `+${num}` : num) : 0} ${cfg.label}`}
                    </button>
                </div>
                {mode === 'participation' && (
                    <input type="text" placeholder="سبب المشاركة (اختياري)" value={participationDescription}
                        onChange={(e) => setParticipationDescription(e.target.value)} disabled={!cfg.enabled}
                        className="w-full rounded-xl border border-white/12 bg-black/20 text-white placeholder-white/35 focus:outline-none focus:border-amber-400 px-3 py-2 text-xs" />
                )}
                {!cfg.enabled && <p className="text-[11px] text-white/45 text-center">{mode === 'participation' ? 'المشاركة متاحة يوم الاجتماع بس.' : `${cfg.label} اتضافت النهارده خلاص، أو مش يوم اجتماع.`}</p>}
            </div>
        </div>
    );
};


const defaultAdminsData = [{"id": "admin_mina_rizk", "name": "مينا رزق", "pin": "pbkdf2$100000$ff1024c3314d991d32a611354d2266d7$5f5c8500dcf3122c8439c0eaa4ad351de1a5f35212bd6124a495417cbc824f60", "isLocked": false, "failedAttempts": 0, "isSuperAdmin": true}, {"id": "admin_shady_sameh", "name": "شادي سامح", "pin": "pbkdf2$100000$178dad37ca427baeb8b384d51ed7260a$310884f1703c51a29688404d0917df71f2bc11fdc6ff9d7dc3ff17994f8ef05f", "isLocked": false, "failedAttempts": 0, "isSuperAdmin": false}, {"id": "admin_mina_moawad", "name": "مينا معوض", "pin": "pbkdf2$100000$ab87994fa84a0f6d2b90858daf68d5c5$2e900ebec6803a8bf9eefa3963d488d7d4590033be9748903ebb906300ccd076", "isLocked": false, "failedAttempts": 0, "isSuperAdmin": false}, {"id": "admin_kirollos_raafat", "name": "كيرلس رأفت", "pin": "pbkdf2$100000$003045eefcef1fe01bb80aacb31664f7$883d70acf53589cc09e188e297417c3961fc79b39de68d05dfdfc461f93768fd", "isLocked": false, "failedAttempts": 0, "isSuperAdmin": false}, {"id": "admin_nagy_wiliam", "name": "ناجي وليم", "pin": "pbkdf2$100000$a4d6ddcb9fcb84958af13458d68314f1$4ae85c6a9b34616eb6d18c047a7111789e7f108463f131ddf38d4f8c55985290", "isLocked": false, "failedAttempts": 0, "isSuperAdmin": false}];

const mergeStudentsData = (local, dbItems) => {
    if (!Array.isArray(local) || local.length === 0) return dbItems;
    if (!Array.isArray(dbItems) || dbItems.length === 0) return local;

    const studentMap = new Map();
    
    // Put DB students in map first
    dbItems.forEach(s => {
        studentMap.set(s.id, { ...s, attendanceHistory: [...(s.attendanceHistory || [])] });
    });
    
    // Merge with local students
    local.forEach(localStudent => {
        const dbStudent = studentMap.get(localStudent.id);
        if (!dbStudent) {
            // Student only exists locally (added while offline)
            studentMap.set(localStudent.id, { ...localStudent });
        } else {
            // Student exists in both. Merge attendance history
            const mergedHistory = [...(dbStudent.attendanceHistory || [])];
            const existingIds = new Set(mergedHistory.map(h => h.id).filter(Boolean));
            
            (localStudent.attendanceHistory || []).forEach(h => {
                if (h.id && !existingIds.has(h.id)) {
                    mergedHistory.push(h);
                    existingIds.add(h.id);
                } else if (!h.id) {
                    // Fallback for items without ID
                    const isDup = mergedHistory.some(existingH => existingH.date === h.date && existingH.type === h.type && existingH.points === h.points);
                    if (!isDup) {
                        mergedHistory.push(h);
                    }
                }
            });
            
            studentMap.set(localStudent.id, {
                ...localStudent,
                ...dbStudent, // DB student (Firestore snapshot) takes priority so edits sync instantly to all devices
                attendanceHistory: mergedHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
            });
        }
    });
    
    return Array.from(studentMap.values());
};

const mergeAdminsData = (local, dbItems) => {
    if (!Array.isArray(local) || local.length === 0) return dbItems;
    if (!Array.isArray(dbItems) || dbItems.length === 0) return local;

    const adminMap = new Map();
    dbItems.forEach(a => adminMap.set(a.id, { ...a }));
    local.forEach(localAdmin => {
        const dbAdmin = adminMap.get(localAdmin.id);
        if (!dbAdmin) {
            adminMap.set(localAdmin.id, { ...localAdmin });
        } else {
            adminMap.set(localAdmin.id, {
                ...localAdmin,
                ...dbAdmin // DB admin (Firestore snapshot) takes priority
            });
        }
    });
    return Array.from(adminMap.values());
};

// ============================================================
// حماية الأرقام السرية للخدام: بتتخزن "مشفّرة" (hash) بدل ما تتخزن زي ما هي،
// فحتى لو حد قرا قاعدة البيانات أو الكود مش هيعرف الرقم السري الحقيقي.
// ============================================================
const PIN_HASH_PREFIX = 'pbkdf2$';
const PIN_HASH_ITERATIONS = 100000;
const bytesToHex = (buf) => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
const hexToBytes = (hex) => new Uint8Array((hex.match(/.{1,2}/g) || []).map(h => parseInt(h, 16)));
const isHashedPin = (value) => typeof value === 'string' && value.startsWith(PIN_HASH_PREFIX);
const derivePinHash = async (pin, saltBytes, iterations) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations }, key, 256);
    return bytesToHex(bits);
};
const hashPin = async (pin) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derivePinHash(pin, salt, PIN_HASH_ITERATIONS);
    return `${PIN_HASH_PREFIX}${PIN_HASH_ITERATIONS}$${bytesToHex(salt)}$${hash}`;
};
const verifyPin = async (pin, stored) => {
    if (!isHashedPin(stored)) return String(pin) === String(stored); // رقم قديم لسه ماتشفّرش
    const [, iterStr, saltHex, hashHex] = stored.split('$');
    const hash = await derivePinHash(pin, hexToBytes(saltHex), Number(iterStr));
    return hash === hashHex;
};

// ============================================================
// حفظ آمن لما أكتر من خادم يسجّل في نفس الوقت
// بدل ما كل جهاز يكتب قايمة الطلاب كلها فوق بعض (فيضيع شغل جهاز تاني)،
// كل جهاز بيبعت "اللي هو غيّره بس" ويدمجه على آخر نسخة موجودة فعلًا في قاعدة البيانات.
// ============================================================
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const mergeHistoryLists = (baseList, localList, remoteList) => {
    const base = Array.isArray(baseList) ? baseList : [];
    const local = Array.isArray(localList) ? localList : [];
    const remote = Array.isArray(remoteList) ? remoteList : [];
    const baseById = new Map(base.filter(r => r && r.id).map(r => [r.id, r]));
    const localById = new Map(local.filter(r => r && r.id).map(r => [r.id, r]));
    const deletedLocally = new Set([...baseById.keys()].filter(id => !localById.has(id)));
    const remoteIds = new Set(remote.filter(r => r && r.id).map(r => r.id));
    // سجلات جديدة اتضافت من الجهاز ده ولسه مش موجودة في القاعدة
    const addedLocally = local.filter(r => r && r.id && !baseById.has(r.id) && !remoteIds.has(r.id));
    const kept = remote
        .filter(r => !(r && r.id && deletedLocally.has(r.id)))
        .map(r => {
            if (!r || !r.id) return r;
            const b = baseById.get(r.id);
            const l = localById.get(r.id);
            // لو الجهاز ده عدّل السجل نفسه، خد تعديله
            return (b && l && !sameJSON(b, l)) ? l : r;
        });
    return [...addedLocally, ...kept];
};

const mergeStudentRecord = (base, local, remote) => {
    const result = { ...remote };
    const keys = new Set([...Object.keys(base || {}), ...Object.keys(local || {})]);
    keys.forEach(key => {
        if (key === 'id') return;
        const inLocal = local && Object.prototype.hasOwnProperty.call(local, key);
        if (key === 'points' || key === 'previousYearsPoints') {
            // النقط بتتدمج كـ"فرق": اللي الجهاز ده زوّده أو نقّصه بيتضاف على الرقم الحالي في القاعدة
            const delta = Number(local?.[key] || 0) - Number(base?.[key] || 0);
            if (delta !== 0) result[key] = Number(remote?.[key] || 0) + delta;
            return;
        }
        if (key === 'attendanceHistory') {
            if (!sameJSON(base?.attendanceHistory, local?.attendanceHistory)) {
                result.attendanceHistory = mergeHistoryLists(base?.attendanceHistory, local?.attendanceHistory, remote?.attendanceHistory);
            }
            return;
        }
        if (!inLocal) {
            if (base && Object.prototype.hasOwnProperty.call(base, key)) delete result[key];
            return;
        }
        if (!sameJSON(local[key], base?.[key])) result[key] = local[key];
    });
    return result;
};

const mergeStudentLists = (baseList, localList, remoteList) => {
    const base = Array.isArray(baseList) ? baseList : [];
    const local = Array.isArray(localList) ? localList : [];
    const remote = Array.isArray(remoteList) ? remoteList : [];
    const baseById = new Map(base.filter(s => s && s.id).map(s => [s.id, s]));
    const localById = new Map(local.filter(s => s && s.id).map(s => [s.id, s]));
    const remoteIds = new Set(remote.filter(s => s && s.id).map(s => s.id));

    const merged = [];
    remote.forEach(r => {
        if (!r || !r.id) { merged.push(r); return; }
        const b = baseById.get(r.id);
        const l = localById.get(r.id);
        if (b && !l) return;                 // اتمسح من الجهاز ده
        if (!b || !l || sameJSON(b, l)) { merged.push(r); return; } // الجهاز ده ماغيّرش فيه حاجة
        merged.push(mergeStudentRecord(b, l, r));
    });
    // طلاب جداد اتضافوا من الجهاز ده
    local.forEach(l => {
        if (l && l.id && !baseById.has(l.id) && !remoteIds.has(l.id)) merged.push(l);
    });
    return merged;
};

const STUDENTS_DOC_REF = () => doc(db, 'appData', 'students_v9');

const commitListMerge = (docRef: any, baseList: any[], localList: any[]) => runTransaction(db, async (tx) => {
    const snap: any = await tx.get(docRef);
    const snapData: any = snap.exists() ? snap.data() : null;
    const remoteItems = snapData && Array.isArray(snapData.items) ? snapData.items : null;
    // لو القاعدة فاضية (أول مرة / بعد نقل)، اكتب النسخة المحلية زي ما هي
    const finalItems = remoteItems ? mergeStudentLists(baseList, localList, remoteItems) : localList;
    tx.set(docRef, { items: finalItems }, { merge: true });
    return finalItems;
});
const commitStudentsMerge = (baseList, localList) => commitListMerge(STUDENTS_DOC_REF(), baseList, localList);
const ADMINS_DOC_REF = () => doc(db, 'appData', 'admins_v8');
const commitAdminsMerge = (baseList, localList) => commitListMerge(ADMINS_DOC_REF(), baseList, localList);

const safeParseList = (str) => {
    try { const v = JSON.parse(str || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
};

// ============================================================
// تصدير Excel (.xlsx) حقيقي من غير أي مكتبة خارجية
// ============================================================
const XLSX_CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c >>> 0;
    }
    return table;
})();
const xlsxCrc32 = (bytes) => {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) crc = XLSX_CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
};
const xlsxZip = (files) => {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    files.forEach(({ name, content }) => {
        const nameBytes = enc.encode(name);
        const data = enc.encode(content);
        const crc = xlsxCrc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const lv = new DataView(local.buffer);
        lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
        lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
        lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
        lv.setUint16(26, nameBytes.length, true); lv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        const cen = new Uint8Array(46 + nameBytes.length);
        const cv = new DataView(cen.buffer);
        cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
        cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
        cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
        cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
        cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
        cen.set(nameBytes, 46);
        chunks.push(local, data);
        central.push(cen);
        offset += local.length + data.length;
    });
    const centralSize = central.reduce((n, c) => n + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};
const xlsxEsc = (v) => String(v ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const xlsxColName = (i) => { let s = ''; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const xlsxSheetXml = (rows, colWidths) => {
    const cols = (colWidths || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
        const ref = `${xlsxColName(c)}${r + 1}`;
        const style = r === 0 ? ' s="1"' : '';
        if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"${style}><v>${cell}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xlsxEsc(cell)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols ? `<cols>${cols}</cols>` : ''}<sheetData>${body}</sheetData></worksheet>`;
};
const buildXlsx = (sheets) => {
    const safeName = (n, i) => xlsxEsc(String(n || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    const files = [
        { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
        { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
        { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s, i) => `<sheet name="${safeName(s.name, i)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
        { name: 'xl/styles.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF312E81"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
        ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: xlsxSheetXml(s.rows, s.widths) })),
    ];
    return xlsxZip(files);
};
const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// --- App Component ---
const App = () => {
    const [students, setStudents] = useState(() => {
        const local = localStorage.getItem('church_attendance_students_v9');
        if (local) {
            try {
                const parsed = JSON.parse(local);
                const approved = filterToApprovedRoster(parsed);
                if (approved.length > 0) return approved;
            } catch (e) {}
        }
        return [];
    });
    const [admins, setAdmins] = useState<any[]>(() => {
        const local = localStorage.getItem('church_attendance_admins_v8');
        if (local) {
            try {
                const parsed = JSON.parse(local);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            } catch (e) {}
        }
        return defaultAdminsData;
    });
    
    const [newStudentName, setNewStudentName] = useState('');
    const [newStudentPhone, setNewStudentPhone] = useState('');
    const [newStudentGrade, setNewStudentGrade] = useState('');
    const [isScannerOpen, setScannerOpen] = useState(false);
    const [scannedStudent, setScannedStudent] = useState(null);
    const [expandedStudentId, setExpandedStudentId] = useState(null);
    const [visibleHistoryStudentId, setVisibleHistoryStudentId] = useState(null);
    const [studentForAttendance, setStudentForAttendance] = useState(null);
    const [studentForBarcode, setStudentForBarcode] = useState(null);
    const [toastMessage, setToastMessage] = useState(null);
    
    const [loggedInAdmin, setLoggedInAdmin] = useState(null);
    // خادم "افتقاد بس": يشوف مجموعته ويفتقدها، ومايقدرش يضيف نقط ولا يعدّل أو يمسح أي حاجة
    const isFollowupOnlyAdmin = (a) => Boolean(a && a.role === 'followup');
    // الأدوار: افتقاد بس ← خادم كامل ← أمين فصل ← مساعد أمين عام ← أمين عام (السوبر أدمن)
    const ROLE_INFO = {
        followup: { icon: '📞', title: 'افتقاد بس', desc: 'يفتقد مجموعته ويكتب ملاحظات. مايضيفش نقط ولا يعدّل حاجة.' },
        full: { icon: '🛠️', title: 'خادم كامل', desc: 'يسجّل حضور ونقط، ويضيف ويعدّل أولاد، ويفتقد.' },
        class_leader: { icon: '🎓', title: 'أمين فصل', desc: 'خادم كامل + يتابع خدام صفّه وملاحظاتهم ويوزّع مجموعاته.' },
        assistant: { icon: '⭐', title: 'مساعد أمين عام', desc: 'خادم كامل + يتابع خدام كل الصفوف وملاحظاتهم.' },
    };
    const adminRoleKey = (a) => (['followup', 'class_leader', 'assistant'].includes(a?.role) ? a.role : 'full');
    // نطاق المتابعة: 'all' = كل الصفوف، أو اسم صف، أو '' = مالوش متابعة
    const oversightScopeOf = (a) => {
        if (!a) return '';
        if (a.isSuperAdmin || a.role === 'assistant') return 'all';
        if (a.role === 'class_leader' && a.leaderGrade) return String(a.leaderGrade).trim();
        return '';
    };
    // لو مينا غيّر صلاحية خادم أو عطّل حسابه وهو داخل، التغيير بيسري عليه فورًا
    useEffect(() => {
        if (!loggedInAdmin) return;
        const live = admins.find(a => a.id === loggedInAdmin.id);
        if (!live) return;
        if (live.isLocked && !live.isSuperAdmin) {
            setLoggedInAdmin(null);
            return;
        }
        if ((live.role || '') !== (loggedInAdmin.role || '') || (live.leaderGrade || '') !== (loggedInAdmin.leaderGrade || '')) {
            setLoggedInAdmin(prev => prev ? { ...prev, role: live.role, leaderGrade: live.leaderGrade } : prev);
            if (live.role === 'followup') setActiveView('followup');
        }
    }, [admins, loggedInAdmin]);
    const blockFollowupOnly = () => {
        if (isFollowupOnlyAdmin(loggedInAdmin)) {
            showToast('⚠️ حسابك للافتقاد بس.');
            return true;
        }
        return false;
    };
    const [isAuthModalOpen, setAuthModalOpen] = useState(false);
    const [selectedAdmin, setSelectedAdmin] = useState(null);
    const [pinInput, setPinInput] = useState('');
    const [authError, setAuthError] = useState('');

    const [editingStudent, setEditingStudent] = useState(null); // Now supports { id, phone, name }
    const [searchTerm, setSearchTerm] = useState('');
    const [activeView, setActiveView] = useState('students'); // 'students', 'leaderboard', or 'attendance_summary'
    const [studentToDelete, setStudentToDelete] = useState(null);
    const [pointToDelete, setPointToDelete] = useState(null);
    const [expandedDate, setExpandedDate] = useState(null); // For stats expansion
    const [expandedSummaryStudentKey, setExpandedSummaryStudentKey] = useState(null); // format: "date-studentId"
    const [leaderboardFilter, setLeaderboardFilter] = useState('all'); // 'all', 'current_month', 'prev_month'
    // الافتقاد: مين مسئول عن كل ولد، ومين اتافتقد (متخزن في appData/followup_v1)
    const [followup, setFollowup] = useState<{ assignments: Record<string, string>; contacts: Record<string, any> }>({ assignments: {}, contacts: {} });
    const [followupTab, setFollowupTab] = useState('report'); // المتابعة: 'report' | 'notes' | 'groups'
    const [oversightGrade, setOversightGrade] = useState('all');
    const [showWholeGroup, setShowWholeGroup] = useState(false);
    // الملاحظات (متخزنة في appData/notes_v1)
    const [notesData, setNotesData] = useState<Record<string, Record<string, any>>>({});
    const [notesStudentId, setNotesStudentId] = useState('');
    // سجل الافتقاد لكل اجتماع (علشان التقرير الشهري) — appData/followup_history_v1
    const [followupHistory, setFollowupHistory] = useState<Record<string, Record<string, any>>>({});
    const [fridayMeetingDate, setFridayMeetingDate] = useState('');
    const [atRiskOpen, setAtRiskOpen] = useState(true);
    const [monthReportOpen, setMonthReportOpen] = useState(false);
    const [monthReportPrefix, setMonthReportPrefix] = useState('');
    // الافتقاد مابيتحسبش بمجرد الضغط: الخادم لازم يرجع ويقول حصل إيه
    const [pendingContact, setPendingContact] = useState<any>(() => {
        try {
            const p = JSON.parse(localStorage.getItem('pending_followup_contact') || 'null');
            return p && Date.now() - Number(p.startedAt || 0) < 6 * 3600 * 1000 ? p : null;
        } catch (e) { return null; }
    });
    const [outcomeModal, setOutcomeModal] = useState<any>(null);
    const [outcomeNote, setOutcomeNote] = useState('');
    const hiddenAtRef = useRef(0);
    const [noteDraft, setNoteDraft] = useState('');
    const [followupGrade, setFollowupGrade] = useState('أولى ثانوي');
    const [followupAssignPickerOpen, setFollowupAssignPickerOpen] = useState(false);
    const [followupReassignAll, setFollowupReassignAll] = useState(false);
    const [expandedReportServant, setExpandedReportServant] = useState('');
    const [followupAssignServants, setFollowupAssignServants] = useState<string[]>([]);
    const [selectedBadgeDetail, setSelectedBadgeDetail] = useState(null);
    
    // Manual Monthly Champion & Badges Reward States
    const [isMonthlyChampionModalOpen, setMonthlyChampionModalOpen] = useState(false);
    const [rewardTargetMonth, setRewardTargetMonth] = useState('prev'); // 'prev' or 'current'
    const [rewardStudentId, setRewardStudentId] = useState('');
    const [rewardPoints, setRewardPoints] = useState('20');
    const [rewardDate, setRewardDate] = useState(() => getFirstFridayOfFollowingMonth());
    const [rewardRankTitle, setRewardRankTitle] = useState('المركز الأول');
    const [rewardCustomDesc, setRewardCustomDesc] = useState('');

    const [isBadgeRewardModalOpen, setBadgeRewardModalOpen] = useState(false);
    const [badgeRewardStudent, setBadgeRewardStudent] = useState(null);
    const [badgeRewardPoints, setBadgeRewardPoints] = useState('15');
    const [badgeRewardDate, setBadgeRewardDate] = useState(() => getCairoDateKey());
    const [badgeRewardDesc, setBadgeRewardDesc] = useState('مكافأة تجميع الأوسمة الشهرية');
    const [badgeAlertsFilter, setBadgeAlertsFilter] = useState('all'); // 'all', 'pending', 'awarded', 'monthly', 'cumulative'
    const [badgeAlertSearch, setBadgeAlertSearch] = useState('');
    
    // Mina Leaderboard Points Control State
    const [studentForPointsEdit, setStudentForPointsEdit] = useState(null);
    const [targetPointsInput, setTargetPointsInput] = useState('');
    const [targetMoneyInput, setTargetMoneyInput] = useState('');
    // Super admin state & modals
    const [isAddStudentModalOpen, setAddStudentModalOpen] = useState(false);
    const [isAdminManagementModalOpen, setAdminManagementModalOpen] = useState(false);
    const [isBackupModalOpen, setBackupModalOpen] = useState(false);
    
    const [newAdminName, setNewAdminName] = useState('');
    const [newAdminPin, setNewAdminPin] = useState('');
    const [newAdminRole, setNewAdminRole] = useState('followup'); // followup | full | class_leader | assistant
    const [newAdminGrade, setNewAdminGrade] = useState('أولى ثانوي');
    const [adminSectionOpen, setAdminSectionOpen] = useState(''); // 'add' | 'pin' | 'season'
    const [editingAdminId, setEditingAdminId] = useState(null);
    const [editingAdminPinValue, setEditingAdminPinValue] = useState('');
    const [ownPinCurrent, setOwnPinCurrent] = useState('');
    const [ownPinNew, setOwnPinNew] = useState('');
    const [ownPinConfirm, setOwnPinConfirm] = useState('');

    const [selectedDate, setSelectedDate] = useState(() => getCairoDateKey());
    
    // PWA Installation States
    const [deferredPrompt, setDeferredPrompt] = useState(null);
    const [showInstallBtn, setShowInstallBtn] = useState(false);
    const [isInstallDismissed, setIsInstallDismissed] = useState(() => {
        return localStorage.getItem('pwa_install_dismissed') === 'true';
    });
    const [isIOSDevice, setIsIOSDevice] = useState(false);
    const [showIOSInstallGuide, setShowIOSInstallGuide] = useState(false);

    useEffect(() => {
        const refreshClientForNewVersion = async () => {
            const storedVersion = localStorage.getItem('church_attendance_app_version');
            if (storedVersion && storedVersion !== APP_VERSION) {
                localStorage.setItem('church_attendance_app_version', APP_VERSION);
                try {
                    if ('caches' in window) {
                        const cacheNames = await caches.keys();
                        await Promise.all(cacheNames.map(name => caches.delete(name)));
                    }
                } catch (e) {
                    console.warn('Cache cleanup failed:', e);
                }
                try {
                    if ('serviceWorker' in navigator) {
                        const registrations = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(registrations.map(registration => registration.unregister()));
                    }
                } catch (e) {
                    console.warn('Service worker cleanup failed:', e);
                }
                window.location.reload();
                return;
            }

            localStorage.setItem('church_attendance_app_version', APP_VERSION);
            try {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map(registration => registration.update()));
                }
            } catch (e) {
                console.warn('Service worker update check failed:', e);
            }
        };

        refreshClientForNewVersion();
    }, []);

    // تحديث تلقائي: الموقع بيتأكد بنفسه لو فيه نسخة أحدث اترفعت، ولو لقى، بيمسح الكاش ويعمل ريفريش لوحده.
    // بيشتغل أول ما الموقع يفتح، وكل ما الموبايل يرجع للتطبيق، وكل 5 دقايق وهو مفتوح.
    useEffect(() => {
        const currentScript = document.querySelector('script[type="module"][src]') as HTMLScriptElement | null;
        const currentSrc = currentScript ? new URL(currentScript.src, window.location.href).pathname : '';
        if (!currentSrc.includes('/assets/')) return; // وضع التطوير المحلي - مفيش داعي للفحص
        const basePath = currentSrc.split('/assets/')[0] + '/';
        let stopped = false;

        const checkForNewDeploy = async () => {
            if (stopped || document.visibilityState === 'hidden') return;
            try {
                const res = await fetch(`${basePath}index.html?check=${Date.now()}`, { cache: 'no-store' });
                if (!res.ok) return;
                const html = await res.text();
                const match = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/);
                if (!match) return;
                const latestSrc = new URL(match[1], window.location.href).pathname;
                if (!latestSrc || latestSrc === currentSrc) return;
                // حماية من الريفريش المتكرر: مرة واحدة بس لكل نسخة جديدة
                if (sessionStorage.getItem('church_attendance_reloaded_for') === latestSrc) return;
                sessionStorage.setItem('church_attendance_reloaded_for', latestSrc);
                try {
                    if ('caches' in window) {
                        const names = await caches.keys();
                        await Promise.all(names.map(name => caches.delete(name)));
                    }
                    if ('serviceWorker' in navigator) {
                        const regs = await navigator.serviceWorker.getRegistrations();
                        await Promise.all(regs.map(reg => reg.unregister()));
                    }
                } catch (e) {
                    console.warn('Cache cleanup before update failed:', e);
                }
                window.location.reload();
            } catch (e) {
                // مفيش نت أو مشكلة مؤقتة - هيحاول تاني بعدين
            }
        };

        checkForNewDeploy();
        const interval = setInterval(checkForNewDeploy, 5 * 60 * 1000);
        const onVisible = () => { if (document.visibilityState === 'visible') checkForNewDeploy(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            stopped = true;
            clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, []);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e: any) => {
            e.preventDefault();
            setDeferredPrompt(e);
            if (localStorage.getItem('pwa_install_dismissed') !== 'true') {
                setShowInstallBtn(true);
            }
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

        // Detect iOS
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
        setIsIOSDevice(isIOS);

        if (isIOS && !isStandalone) {
            if (localStorage.getItem('pwa_install_dismissed') !== 'true') {
                setShowInstallBtn(true);
            }
        } else if (isStandalone) {
            setShowInstallBtn(false);
        }

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        };
    }, []);

    const handleInstallClick = async () => {
        if (isIOSDevice) {
            setShowIOSInstallGuide(true);
            return;
        }
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        console.log(`User response to PWA prompt: ${outcome}`);
        setDeferredPrompt(null);
        setShowInstallBtn(false);
    };

    const handleDismissInstall = () => {
        localStorage.setItem('pwa_install_dismissed', 'true');
        setIsInstallDismissed(true);
        setShowInstallBtn(false);
    };

    const isInitialMount = useRef(true);
    // مفيش أي حفظ بيحصل غير بعد ما البيانات الحقيقية توصل من قاعدة البيانات الأول.
    // (قبل كده: جهاز جديد أول مرة يفتح الموقع كان بيكتب قايمة الخدام الافتراضية القديمة فوق القايمة الحقيقية،
    //  فأي رقم سري اتغيّر أو خادم اتضاف كان بيرجع للقديم.)
    const studentsLoadedFromServer = useRef(false);
    const adminsLoadedFromServer = useRef(false);

    const lastStudentsDB = useRef<string>(localStorage.getItem('church_attendance_students_v9') || '[]');
    // مراقبة حجم بيانات الطلاب (الحد الأقصى لـFirebase 1 ميجا للمستند الواحد)
    const [studentsDocBytes, setStudentsDocBytes] = useState(0);
    const lastAdminsDB = useRef<string>(localStorage.getItem('church_attendance_admins_v8') || '[]');
    // تشفير تلقائي لأي رقم سري قديم لسه متخزن زي ما هو في قاعدة البيانات (بيحصل مرة واحدة)
    useEffect(() => {
        if (!adminsLoadedFromServer.current) return;
        if (!Array.isArray(admins) || !admins.some(a => a && a.pin && !isHashedPin(a.pin))) return;
        let cancelled = false;
        (async () => {
            try {
                const upgraded = await Promise.all(admins.map(async a => (a && a.pin && !isHashedPin(a.pin)) ? { ...a, pin: await hashPin(a.pin) } : a));
                if (!cancelled) setAdmins(upgraded);
            } catch (err) {
                console.error('PIN encryption upgrade failed:', err);
            }
        })();
        return () => { cancelled = true; };
    }, [admins]);

    const isRosterMigrationInProgress = useRef(false);

    // Initialize Data from Firebase with Offline-Resilient Merging
    useEffect(() => {
        const unsubStudents = onSnapshot(doc(db, 'appData', 'students_v9'), (docSnap) => {
            studentsLoadedFromServer.current = true;
            if (docSnap.exists()) {
                try { setStudentsDocBytes(new Blob([JSON.stringify(docSnap.data())]).size); } catch (e) {}
                const dbItems = docSnap.data()?.items;
                if (Array.isArray(dbItems)) {
                    const approvedItems = filterToApprovedRoster(dbItems);
                    if (isRosterMigrationInProgress.current) return;
                    // تم إلغاء "تصفير الموسم" التلقائي نهائيًا - اتعمل مرة واحدة خلاص، ومبقاش ينفع يتكرر لوحده تاني.

                    const str = JSON.stringify(approvedItems);
                    lastStudentsDB.current = str;
                    localStorage.setItem('church_attendance_students_v9', str);
                    setStudents(approvedItems);
                    if (JSON.stringify(approvedItems) !== JSON.stringify(dbItems)) {
                        commitStudentsMerge(dbItems, approvedItems)
                            .catch(err => console.error("Error syncing roster corrections:", err));
                    }
                } else {
                    setStudents([]);
                }
            } else {
                const local = localStorage.getItem('church_attendance_students_v9');
                if (local) {
                    try {
                        const parsed = JSON.parse(local);
                        const approved = filterToApprovedRoster(parsed);
                        if (approved.length > 0) {
                            setStudents(approved);
                            return;
                        }
                    } catch(e) {}
                }
                setStudents([]);
            }
        });

        const unsubAdmins = onSnapshot(doc(db, 'appData', 'admins_v8'), (docSnap) => {
            if (docSnap.exists()) {
                const dbItems = docSnap.data()?.items;
                if (Array.isArray(dbItems)) {
                    adminsLoadedFromServer.current = true;
                    const str = JSON.stringify(dbItems);
                    lastAdminsDB.current = str;
                    localStorage.setItem('church_attendance_admins_v8', str);
                    setAdmins(dbItems);
                } else {
                    setAdmins(defaultAdminsData);
                }
            } else {
                // المستند مش موجود فعلًا في القاعدة (مشروع جديد): مسموح نكتب القايمة لأول مرة
                adminsLoadedFromServer.current = true;
                lastAdminsDB.current = '[]';
                const local = localStorage.getItem('church_attendance_admins_v8');
                if (local) {
                    try {
                        const parsed = JSON.parse(local);
                        if (parsed.length > 0) {
                            setAdmins(parsed);
                            return;
                        }
                    } catch(e) {}
                }
                setAdmins(defaultAdminsData);
            }
        });



        return () => {
            unsubStudents();
            unsubAdmins();
        };
    }, []);

    // Persist to Firestore and localStorage
    useEffect(() => {
        if (isRosterMigrationInProgress.current) return;
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }

        const currentStr = JSON.stringify(students);
        if (studentsLoadedFromServer.current && currentStr !== lastStudentsDB.current) {
            const baseList = safeParseList(lastStudentsDB.current);
            localStorage.setItem('church_attendance_students_v9', currentStr);
            lastStudentsDB.current = currentStr;
            commitStudentsMerge(baseList, students)
                .catch(err => {
                    console.error("Error saving students to Firestore:", err);
                    showToast('⚠️ فشل حفظ آخر تعديل، اتأكد من النت وجرّب تاني.');
                });
        }

        const currentAdminsStr = JSON.stringify(admins);
        if (adminsLoadedFromServer.current && currentAdminsStr !== lastAdminsDB.current) {
            const adminsBase = safeParseList(lastAdminsDB.current);
            localStorage.setItem('church_attendance_admins_v8', currentAdminsStr);
            lastAdminsDB.current = currentAdminsStr;
            commitAdminsMerge(adminsBase, admins)
                .catch(err => {
                    console.error("Error saving admins to Firestore:", err);
                    showToast('⚠️ فشل حفظ تعديل الخدام، اتأكد من النت وجرّب تاني.');
                });
        }
    }, [students, admins]);

        const saveStudentsData = useCallback((newStudents) => {
        const str = JSON.stringify(newStudents);
        const baseList = safeParseList(lastStudentsDB.current);
        lastStudentsDB.current = str;
        localStorage.setItem('church_attendance_students_v9', str);
        setStudents(newStudents);
        commitStudentsMerge(baseList, newStudents)
            .catch(err => console.error("Error saving students to Firestore:", err));
    }, []);

    const saveAdminsData = useCallback((newAdmins) => {
        if (!adminsLoadedFromServer.current) return;
        const str = JSON.stringify(newAdmins);
        const adminsBase = safeParseList(lastAdminsDB.current);
        lastAdminsDB.current = str;
        localStorage.setItem('church_attendance_admins_v8', str);
        setAdmins(newAdmins);
        commitAdminsMerge(adminsBase, newAdmins)
            .catch(err => console.error("Error saving admins to Firestore:", err));
    }, []);

    const showToast = useCallback((message) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 3000);
    }, []);

    // Automatic migration of older local storage versions (v7, v6, v5)
    useEffect(() => {
        const versions = ['v7', 'v6', 'v5'];
        let migratedStudents = false;
        let migratedAdmins = false;
        let currentStudents = [...students];
        let currentAdmins = [...admins];

        // Migrate Students
        versions.forEach(v => {
            const key = `church_attendance_students_${v}`;
            const local = localStorage.getItem(key);
            if (local) {
                try {
                    const parsed = JSON.parse(local);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        currentStudents = mergeStudentsData(currentStudents, parsed);
                        migratedStudents = true;
                        // Clear migrated key to prevent repeated merge
                        localStorage.removeItem(key);
                    }
                } catch (e) {
                    console.error(`Failed to migrate students ${v}:`, e);
                }
            }
        });

        // Migrate Admins
        versions.forEach(v => {
            const key = `church_attendance_admins_${v}`;
            const local = localStorage.getItem(key);
            if (local) {
                try {
                    const parsed = JSON.parse(local);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        currentAdmins = mergeAdminsData(currentAdmins, parsed);
                        migratedAdmins = true;
                        // Clear migrated key to prevent repeated merge
                        localStorage.removeItem(key);
                    }
                } catch (e) {
                    console.error(`Failed to migrate admins ${v}:`, e);
                }
            }
        });

        if (migratedStudents) {
            const migBase = safeParseList(lastStudentsDB.current);
            setStudents(currentStudents);
            const mergedStr = JSON.stringify(currentStudents);
            lastStudentsDB.current = mergedStr;
            localStorage.setItem('church_attendance_students_v9', mergedStr);
            commitStudentsMerge(migBase, currentStudents)
                .then(() => {
                    showToast("🎉 تم استيراد ودمج سجلات الطلاب القديمة من جهازك بنجاح!");
                })
                .catch(err => console.error("Error saving migrated students:", err));
        }

        // بيانات الخدام القديمة المتخزنة على الجهاز من إصدارات قديمة جدًا مابقتش بتتكتب في قاعدة البيانات
        // (كانت ممكن ترجّع أرقام سرية قديمة). بتتمسح من الجهاز وبس.
    }, []);

    // Automatic monthly champion rewards removed in favor of manual servant control

    const addStudent = useCallback(() => {
        if (loggedInAdmin?.role === 'followup') { showToast('⚠️ حسابك للافتقاد بس.'); return; }
        if (!newStudentName.trim()) {
            showToast('الرجاء إدخال الاسم');
            return;
        }
        if (!newStudentPhone.trim()) {
            showToast('الرجاء إدخال رقم الموبايل');
            return;
        }
        if (!newStudentGrade.trim()) {
            showToast('الرجاء اختيار الصف الدراسي');
            return;
        }
        const trimmedName = newStudentName.trim();
        const isDuplicate = students.some(s => s.name.toLowerCase() === trimmedName.toLowerCase());

        if (isDuplicate) {
            showToast(`"${trimmedName}" موجود بالفعل في القائمة`);
            return;
        }

        const newStudent = {
            id: generateId(),
            name: trimmedName,
            phone: newStudentPhone.trim(),
            grade: newStudentGrade.trim(),
            points: 0,
            lastAttended: null,
            attendanceHistory: [],
        };
        const updatedStudents = [...students, newStudent].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
        saveStudentsData(updatedStudents);
        setNewStudentName('');
        setNewStudentPhone('');
        setNewStudentGrade('');
        setAddStudentModalOpen(false);
        showToast(`تمت إضافة "${trimmedName}" بنجاح`);
    }, [newStudentName, newStudentPhone, newStudentGrade, students, showToast, loggedInAdmin]);
    
    const addPoints = useCallback((studentId, type, points, fromScan = false, description = null) => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول أولاً لإضافة نقاط.');
            return;
        }
        if (loggedInAdmin.role === 'followup') {
            showToast('⚠️ حسابك للافتقاد بس.');
            return;
        }
        // Use selectedDate only for super-admin historical edits; otherwise use Cairo's current date.
        const dateToRecord = loggedInAdmin.isSuperAdmin && selectedDate && !fromScan ? selectedDate : getCairoDateKey();
        const isHistoricalEdit = loggedInAdmin.isSuperAdmin && Boolean(selectedDate) && selectedDate !== getCairoDateKey() && !fromScan;

        if (!isHistoricalEdit) {
            const windowState = getAttendanceWindow();
            if (!windowState.isWithinAllowedTime) {
                showToast(windowState.message);
                return;
            }
            const allowed = type === 'monthlyMass'
                ? windowState.kind === 'monthlyMass'
                : (type === 'early' || type === 'late')
                    ? windowState.kind === 'meeting'
                    : (type === 'participation' || type === 'gamesStation' || type === 'roots')
                        ? windowState.kind !== 'monthlyMass'
                        : true;
            if (!allowed) {
                showToast(windowState.kind === 'monthlyMass'
                    ? '⚠️ النهارده أول جمعة في الشهر (القداس الشهري)، مفيش حضور اجتماع.'
                    : '⚠️ القداس الشهري بيتسجل في أول جمعة من الشهر بس.');
                return;
            }
        }
        
        setStudents(prevStudents => {
            const studentIndex = prevStudents.findIndex(s => s.id === studentId);
            if (studentIndex === -1) return prevStudents;

            const student = { ...prevStudents[studentIndex] };
            student.attendanceHistory = student.attendanceHistory || [];

            if (type === 'early' || type === 'late') {
                const alreadyAttended = student.attendanceHistory.some(h =>
                    h.date === dateToRecord && (h.type === 'early' || h.type === 'late')
                );
                if (alreadyAttended) {
                    showToast(`تم تسجيل حضور ${student.name} بالفعل في هذا اليوم.`);
                    return prevStudents;
                }
            }

            if (type === 'monthlyMass') {
                const targetMonth = dateToRecord.slice(0, 7);
                const alreadyRegistered = student.attendanceHistory.some(h =>
                    h.type === 'monthlyMass' && h.date && h.date.startsWith(targetMonth)
                );
                if (alreadyRegistered) {
                    showToast(`تم تسجيل القداس الشهري لـ ${student.name} بالفعل هذا الشهر.`);
                    return prevStudents;
                }
            }

            if (type === 'confession') {
                const targetMonth = dateToRecord.slice(0, 7);
                if (student.attendanceHistory.some(h => h.type === 'confession' && h.date && h.date.startsWith(targetMonth))) {
                    showToast(`تم تسجيل الاعتراف لـ ${student.name} بالفعل هذا الشهر.`);
                    return prevStudents;
                }
            }

            if (type === 'gamesStation' || type === 'roots') {
                const alreadyRegistered = student.attendanceHistory.some(h =>
                    h.date === dateToRecord && h.type === type
                );
                if (alreadyRegistered) {
                    showToast(`تم تسجيل ${type === 'gamesStation' ? 'Games Station' : 'ROOTS'} لـ ${student.name} بالفعل في هذا اليوم.`);
                    return prevStudents;
                }
            }

            const typeNameMap = {
                early: 'حضور مبكر',
                late: 'حضور متأخر',
                participation: 'مشاركة',
                monthlyMass: 'قداس شهري',
                confession: 'اعتراف',
                gamesStation: 'Games Station',
                roots: 'ROOTS',
                exchange: 'تبديل النقاط'
            };

            const attendanceRecordedAt = new Date();
            const earlyBadgeEligible = type === 'early' && dateToRecord === getCairoDateKey(attendanceRecordedAt) && isEarlyBadgeEligibleAt(attendanceRecordedAt);
            const newRecord = {
                id: generateId(),
                date: dateToRecord,
                points: points,
                type: type,
                typeName: typeNameMap[type] || 'نشاط',
                description: description && description.trim() ? description.trim() : null,
                recordedBy: loggedInAdmin.name,
                recordedAt: attendanceRecordedAt.toISOString(),
                ...(earlyBadgeEligible ? { meta: 'early_badge_eligible' } : {}),
            };

            student.points = (student.points || 0) + points;
            
            // Only update lastAttended if the recorded date is today or newer than existing (though usually we care about "today")
            // Here we simply update if it's attendance type.
            if (type === 'early' || type === 'late') {
                const today = getCairoDateKey();
                if (dateToRecord === today) {
                   student.lastAttended = today;
                }
            }
            student.attendanceHistory = [newRecord, ...student.attendanceHistory];

// Automatic badge bonus removed: award manually via Badges Reward modal

            const updatedStudents = [...prevStudents];
            updatedStudents[studentIndex] = student;
            
            const pointsString = points > 0 ? `+${points}` : points;
            showToast(`تم تسجيل ${typeNameMap[type]} لـ ${student.name} (${pointsString} نقاط)`);
            
            if (fromScan) {
                setScannedStudent(student);
            }
            
            return updatedStudents;
        });
    }, [showToast, loggedInAdmin, selectedDate]);


    const handleScanFailure = useCallback(() => {
        // Scanner-level failures are already rendered by QRScanner itself.
    }, []);

    const handleScanSuccess = useCallback((decodedText) => {
        const windowState = getAttendanceWindow();
        if (!windowState.isWithinAllowedTime) {
            setScannerOpen(false);
            showToast(windowState.message);
            return;
        }
        setScannerOpen(false);
        const student = students.find(s => s.id === decodedText);
        if (student) {
            setStudentForAttendance(student);
        } else {
            showToast('لم يتم العثور على الاسم. الكود غير صالح.');
            setScannedStudent(null);
        }
    }, [students, showToast]);
    
    const handlePinSubmit = async (e) => {
        e.preventDefault();
        const adminToLogin = admins.find(a => a.id === selectedAdmin.id);
        if (!adminToLogin) {
            setAuthError('حدث خطأ غير متوقع.');
            return;
        }

        if (adminToLogin.isLocked) {
            setAuthError('تم قفل هذا الحساب. الرجاء التواصل مع مسئول النظام.');
            return;
        }

        let pinOk = false;
        try {
            pinOk = await verifyPin(pinInput, adminToLogin.pin);
        } catch (err) {
            console.error('PIN verification failed:', err);
        }
        if (pinOk) {
            setLoggedInAdmin(adminToLogin);
            if (adminToLogin.role === 'followup') setActiveView('followup');
            setAuthModalOpen(false);
            showToast(`أهلاً بك, ${adminToLogin.name}`);
            
            if (adminToLogin.failedAttempts > 0) {
                setAdmins(prevAdmins => prevAdmins.map(a => 
                    a.id === adminToLogin.id ? { ...a, failedAttempts: 0 } : a
                ));
            }
        } else {
            if (adminToLogin.isSuperAdmin) {
                setAuthError('رقم سري خاطئ. حاول مرة أخرى.');
                return;
            }

            const newFailedAttempts = (adminToLogin.failedAttempts || 0) + 1;
            let isNowLocked = false;
            let errorMessage = '';

            if (newFailedAttempts >= 5) {
                isNowLocked = true;
                errorMessage = 'تم قفل الحساب بعد 5 محاولات فاشلة.';
            } else {
                errorMessage = `رقم سري خاطئ. تبقى ${5 - newFailedAttempts} محاولات.`;
            }
            
            setAuthError(errorMessage);
            setAdmins(prevAdmins => prevAdmins.map(a =>
                a.id === adminToLogin.id ? { ...a, failedAttempts: newFailedAttempts, isLocked: isNowLocked } : a
            ));
        }
    };

    
    const handleLogout = () => {
        showToast(`تم تسجيل خروج ${loggedInAdmin.name}`);
        setLoggedInAdmin(null);
        setActiveView('students'); // Reset view on logout
        setSelectedDate(getCairoDateKey()); // Reset date on logout
    };
    
    const openAuthModal = () => {
        setSelectedAdmin(null);
        setPinInput('');
        setAuthError('');
        setAuthModalOpen(true);
    };

    const toggleStudentDetails = (studentId) => {
        setExpandedStudentId(prevId => (prevId === studentId ? null : studentId));
        setVisibleHistoryStudentId(null); // Close history when collapsing student
        setEditingStudent(null); // Reset editing
    };

    const toggleHistoryDetails = (studentId) => {
        setVisibleHistoryStudentId(prevId => prevId === studentId ? null : studentId);
    };

    // --- Editing Logic ---
    const handleEditStudent = (student) => {
        setEditingStudent({ 
            id: student.id, 
            phone: student.phone || '', 
            name: student.name,
            grade: student.grade || '',
            previousYearsPoints: Number(student.previousYearsPoints || 0)
        });
    };

    const handleSaveStudentEdit = (studentId) => {
        if (!editingStudent) return;
        if (blockFollowupOnly()) return;
        
        const newName = editingStudent.name.trim();
        const newPhone = editingStudent.phone.trim();
        const newGrade = String(editingStudent.grade || '').trim();
        const currentStudent = students.find(s => s.id === studentId);
        const requestedPreviousYearsPoints = Number(editingStudent.previousYearsPoints);
        const newPreviousYearsPoints = isMinaAdmin
            ? (Number.isFinite(requestedPreviousYearsPoints) && requestedPreviousYearsPoints >= 0 ? Math.floor(requestedPreviousYearsPoints) : null)
            : Number(currentStudent?.previousYearsPoints || 0);

        if (!newName) {
            showToast("لا يمكن ترك الاسم فارغاً");
            return;
        }

        const duplicateName = students.some(s =>
            s.id !== studentId && s.name.trim().toLowerCase() === newName.toLowerCase()
        );
        if (duplicateName) {
            showToast(`"${newName}" موجود بالفعل في القائمة`);
            return;
        }

        if (isMinaAdmin && newPreviousYearsPoints === null) {
            showToast('يرجى إدخال عدد صحيح موجب أو صفر لنقاط السنين السابقة.');
            return;
        }

        const updatedStudents = students.map(s => {
            if (s.id === studentId) {
                return {
                    ...s,
                    name: newName,
                    phone: newPhone,
                    ...(newGrade ? { grade: newGrade } : {}),
                    ...(isMinaAdmin ? { previousYearsPoints: newPreviousYearsPoints } : {})
                };
            }
            return s;
        });
        saveStudentsData(updatedStudents);
        
        setEditingStudent(null);
        showToast('تم تحديث البيانات بنجاح');
    };
    
    const handleCancelEdit = () => {
        setEditingStudent(null);
    };

    const handleDeleteStudent = (studentId) => {
        const student = students.find(s => s.id === studentId);
        if (student) {
            setStudentToDelete(student);
        }
    };
    
    const confirmDeleteStudent = () => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول أولاً.');
            return;
        }
        if (!studentToDelete) return;
        if (blockFollowupOnly()) return;
        const updatedStudents = students.filter(s => s.id !== studentToDelete.id);
        setStudents(updatedStudents);
        showToast(`تم حذف ${studentToDelete.name} بنجاح.`);
        setStudentToDelete(null);
        setExpandedStudentId(null);
    };
    
    const handleDeletePointEntry = (studentId, record) => {
        setPointToDelete({ studentId, record });
    };

    const confirmDeletePointEntry = () => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول أولاً.');
            return;
        }
        if (!pointToDelete) return;
        if (blockFollowupOnly()) { setPointToDelete(null); return; }
        const { studentId, record } = pointToDelete;
        if (isGiftRecord(record)) {
            // مسح سجل شراء هدية من هنا كان بيرجّع النقط والطلب لسه محجوز (ولو اتلغى بعدين النقط بترجع مرتين)
            showToast('⚠️ ده سجل من متجر الهدايا. لو عايز ترجّع النقط، الغِ الطلب من متجر الهدايا.');
            setPointToDelete(null);
            return;
        }

        const updatedStudents = students.map(student => {
            if (student.id === studentId) {
                const newHistory = (student.attendanceHistory || []).filter(h => h.id !== record.id);
                const newPoints = (student.points || 0) - record.points;
                return { ...student, points: newPoints, attendanceHistory: newHistory };
            }
            return student;
        });
        saveStudentsData(updatedStudents);

        showToast(`تم حذف نقطة (${record.typeName}) بنجاح.`);
        setPointToDelete(null);
    };


    // --- Super Admin Functions ---
    const handleAddAdmin = async () => {
        const name = newAdminName.trim();
        const pin = newAdminPin.trim();

        if (!name || !pin) {
            showToast("الرجاء إدخال اسم ورقم سري للخادم الجديد.");
            return;
        }
        if (!/^\d{6,}$/.test(pin)) {
            showToast("الرقم السري يجب أن يتكون من 6 أرقام على الأقل.");
            return;
        }
        if (admins.some(a => a.name.toLowerCase() === name.toLowerCase())) {
            showToast("هذا الاسم موجود بالفعل.");
            return;
        }

        const newAdmin = {
            id: `admin_${name.replace(/\s+/g, '_').toLowerCase()}_${generateId()}`,
            name: name,
            pin: await hashPin(pin),
            isLocked: false,
            failedAttempts: 0,
            isSuperAdmin: false,
            role: ROLE_INFO[newAdminRole] ? newAdminRole : 'followup',
            ...(newAdminRole === 'class_leader' ? { leaderGrade: newAdminGrade } : {}),
        };

        setAdmins(prev => [...prev, newAdmin]);
        setNewAdminName('');
        setNewAdminPin('');
        setNewAdminRole('followup');
        setAdminSectionOpen('');
        showToast(`تم إضافة الخادم "${name}" (${(ROLE_INFO[newAdminRole] || ROLE_INFO.followup).title}${newAdminRole === 'class_leader' ? ` - ${newAdminGrade}` : ''}) بنجاح.`);
    };

    const handleSetAdminRole = (adminId, role, grade = '') => {
        if (!loggedInAdmin?.isSuperAdmin || !ROLE_INFO[role]) return;
        setAdmins(prev => prev.map(a => {
            if (a.id !== adminId || a.isSuperAdmin) return a;
            const { leaderGrade, ...rest } = a;
            const g = role === 'class_leader' ? (grade || leaderGrade || 'أولى ثانوي') : '';
            showToast(`${a.name}: بقى ${ROLE_INFO[role].title}${g ? ` (${g})` : ''}`);
            return role === 'class_leader' ? { ...rest, role, leaderGrade: g } : { ...rest, role };
        }));
    };

    const handleUnlockAdminByFailure = (adminId) => {
        setAdmins(prevAdmins => prevAdmins.map(admin => {
            if (admin.id === adminId) {
                return { ...admin, isLocked: false, failedAttempts: 0 };
            }
            return admin;
        }));
        showToast("تم فتح قفل الحساب بنجاح.");
    };

    const handleToggleAdminStatus = (adminId) => {
        setAdmins(prevAdmins => prevAdmins.map(admin => {
            if (admin.id === adminId) {
                const isCurrentlyLocked = admin.isLocked || false;
                showToast(isCurrentlyLocked ? `تم تفعيل حساب ${admin.name}` : `تم تعطيل حساب ${admin.name}`);
                return { ...admin, isLocked: !isCurrentlyLocked, failedAttempts: 0 }; // also reset attempts
            }
            return admin;
        }));
    };

    const handleStartEditPin = (admin) => {
        setEditingAdminId(admin.id);
        setEditingAdminPinValue('');
    };

    // تغيير الرقم السري للسوبر أدمن نفسه (لازم يكتب رقمه الحالي الأول للتأكيد)
    const handleChangeOwnPin = async () => {
        if (!loggedInAdmin) return;
        const me = admins.find(a => a.id === loggedInAdmin.id);
        if (!me) return;
        if (!(await verifyPin(ownPinCurrent, me.pin))) {
            showToast('الرقم السري الحالي غلط.');
            return;
        }
        if (!/^\d{6,}$/.test(ownPinNew)) {
            showToast('الرقم السري الجديد يجب أن يتكون من 6 أرقام على الأقل.');
            return;
        }
        if (ownPinNew !== ownPinConfirm) {
            showToast('الرقمين الجداد مش متطابقين.');
            return;
        }
        const hashed = await hashPin(ownPinNew);
        setAdmins(prev => prev.map(a => a.id === me.id ? { ...a, pin: hashed, failedAttempts: 0 } : a));
        setLoggedInAdmin(prev => prev ? { ...prev, pin: hashed } : prev);
        setOwnPinCurrent(''); setOwnPinNew(''); setOwnPinConfirm('');
        showToast('✅ تم تغيير رقمك السري بنجاح.');
    };

    const handleSaveAdminPin = async (adminId) => {
        if (!/^\d{6,}$/.test(editingAdminPinValue)) {
            showToast("الرقم السري يجب أن يتكون من 6 أرقام على الأقل.");
            return;
        }
        const hashed = await hashPin(editingAdminPinValue);
        setAdmins(prev => prev.map(a => a.id === adminId ? { ...a, pin: hashed, failedAttempts: 0 } : a));
        showToast(`تم تغيير الرقم السري بنجاح.`);
        setEditingAdminId(null);
        setEditingAdminPinValue('');
    };

    // --- Export / Import ---
    const handleExportData = () => {
        const data = {
            students: students,
            ...(loggedInAdmin?.isSuperAdmin ? { admins } : {}),
            timestamp: new Date().toISOString(),
            version: 'v8'
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `church_attendance_backup_${getCairoDateKey()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('تم تحميل ملف النسخ الاحتياطي بنجاح.');
    };

    const handleImportData = (e) => {
        const input = e.currentTarget || e.target;
        const file = e.target.files[0];
        if (!file) return;
        const confirmed = window.confirm(
            `⚠️ تحذير مهم\n\nهتستبدل كل بيانات الطلاب والنقط الحالية بمحتوى الملف:\n"${file.name}"\n\nأي نقط أو حضور اتسجل بعد تاريخ الملف ده هيضيع.\n\nمتأكد إنك عايز تكمل؟`
        );
        if (!confirmed) {
            if (input) input.value = '';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const result = event.target?.result;
                if (typeof result !== 'string') throw new Error('Invalid backup file contents');
                const data = JSON.parse(result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    throw new Error('Invalid backup structure');
                }

                const isValidHistoryRecord = (record) =>
                    record &&
                    typeof record === 'object' &&
                    typeof record.date === 'string' &&
                    /^\d{4}-\d{2}-\d{2}$/.test(record.date) &&
                    typeof record.type === 'string' &&
                    record.type.trim().length > 0 &&
                    Number.isFinite(Number(record.points));

                const isValidStudent = (student) =>
                    student &&
                    typeof student === 'object' &&
                    typeof student.id === 'string' &&
                    student.id.trim().length > 0 &&
                    typeof student.name === 'string' &&
                    student.name.trim().length > 0 &&
                    (student.attendanceHistory === undefined || (Array.isArray(student.attendanceHistory) && student.attendanceHistory.every(isValidHistoryRecord))) &&
                    (student.points === undefined || Number.isFinite(Number(student.points)));

                const isValidAdmin = (admin) =>
                    admin &&
                    typeof admin === 'object' &&
                    typeof admin.id === 'string' &&
                    admin.id.trim().length > 0 &&
                    typeof admin.name === 'string' &&
                    admin.name.trim().length > 0 &&
                    typeof admin.pin === 'string' &&
                    (/^\d{4,}$/.test(admin.pin) || /^pbkdf2\$\d+\$[0-9a-f]+\$[0-9a-f]+$/.test(admin.pin));

                if (data.students !== undefined) {
                    if (!Array.isArray(data.students) || !data.students.every(isValidStudent)) {
                        throw new Error('Invalid students data');
                    }
                    const importedStudents = data.students.map(student => ({
                        ...student,
                        name: student.name.trim(),
                        points: Number(student.points ?? 0),
                        attendanceHistory: Array.isArray(student.attendanceHistory)
                            ? student.attendanceHistory.map(record => ({
                                ...record,
                                id: typeof record.id === 'string' && record.id.trim() ? record.id : generateId(),
                                date: record.date,
                                points: Number(record.points),
                                type: record.type.trim(),
                                typeName: typeof record.typeName === 'string' && record.typeName.trim() ? record.typeName.trim() : 'نشاط',
                                description: typeof record.description === 'string' && record.description.trim() ? record.description.trim() : null,
                                recordedBy: typeof record.recordedBy === 'string' && record.recordedBy.trim() ? record.recordedBy.trim() : 'استيراد',
                            }))
                            : [],
                    }));
                    setStudents(importedStudents);
                    showToast('تم استعادة بيانات شباب الأنبا رويس بنجاح.');
                }

                if (data.admins !== undefined) {
                    if (!Array.isArray(data.admins) || !data.admins.every(isValidAdmin)) {
                        throw new Error('Invalid admins data');
                    }
                    if (loggedInAdmin?.isSuperAdmin) {
                        setAdmins(data.admins);
                        showToast('تم استعادة بيانات الخدام بنجاح.');
                    } else {
                        showToast('استعادة بيانات الخدام متاحة للسوبر أدمن فقط.');
                    }
                }

                if (data.students === undefined && data.admins === undefined) {
                    throw new Error('Backup contains no supported data'); 
                }
                setBackupModalOpen(false);
            } catch (error) {
                console.error("Import error", error);
                showToast('حدث خطأ أثناء قراءة الملف. تأكد أنه ملف صحيح.');
            }
        };
        reader.readAsText(file);
        // Reset the input so selecting the same backup file again triggers onChange.
        e.currentTarget.value = '';
    };


    const sortedStudents = useMemo(() => {
        return [...students].sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }, [students]);

    const filteredStudents = useMemo(() => {
        if (!searchTerm) {
            return sortedStudents;
        }
        return sortedStudents.filter(student =>
            student.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [sortedStudents, searchTerm]);

    const prevMonthName = useMemo(() => {
        return getArabicMonthNameFromPrefix(getCairoMonthPrefixOffset(-1)).split(' ')[0];
    }, []);

    const lastMonthChampions = useMemo(() => {
        const prevMonthPrefix = getCairoMonthPrefixOffset(-1);

        return [...students]
            .map(student => {
                const prevPoints = (student.attendanceHistory || [])
                    .filter(h => h.date && h.date.startsWith(prevMonthPrefix))
                    .filter(isActivityRecord)
                    .reduce((sum, h) => sum + Number(h.points || 0), 0);
                return {
                    ...student,
                    prevPoints
                };
            })
            .filter(student => student.prevPoints > 0)
            .sort((a, b) => b.prevPoints - a.prevPoints)
            .slice(0, 3);
    }, [students]);

        // --- Badges & Achievements Persistent Notification Center ---
    const allBadgeAlerts = useMemo(() => {
        const currentMonthPrefix = getCairoMonthPrefix();
        const prevMonthPrefix = getCairoMonthPrefixOffset(-1);
        const getArabicMonthName = getArabicMonthNameFromPrefix;

        const alerts = [];

        students.forEach(student => {
            const history = student.attendanceHistory || [];
            const pts = student.points || 0;

            // 1. Triple Monthly Badges for Current Month (بطل الشهر الحالي)
            const currentHasAllMonthly = BADGES_CONFIG.filter(b => b.category === 'monthly').every(b => b.check(history, pts, currentMonthPrefix));
            if (currentHasAllMonthly) {
                const currentMonthAwardRecord = history.find(h => !(typeof h.meta === 'string' && h.meta.startsWith('leaderboard_reward_')) && (
                    (h.meta && (h.meta.includes(`monthly_all_${currentMonthPrefix}`) || h.meta.includes(`badge_reward_monthly_all_${currentMonthPrefix}`))) ||
                    (h.typeName === 'مكافأة تجميع الأوسمة' && h.date && h.date.startsWith(currentMonthPrefix)) ||
                    (h.description && (h.description.includes('تجميع الأوسمة') || h.description.includes('مكافأة الأوسمة')) && h.date && h.date.startsWith(currentMonthPrefix))
                ));
                alerts.push({
                    id: `monthly_all_${currentMonthPrefix}_${student.id}`,
                    studentId: student.id,
                    studentName: student.name,
                    student,
                    badgeId: 'monthly_all',
                    badgeTitle: `بطل الشهر: تجميع كل الأوسمة الشهرية (3/3)`,
                    badgeEmoji: '✨',
                    category: 'monthly',
                    categoryLabel: 'أوسمة شهرية (بطل الشهر)',
                    periodLabel: getArabicMonthName(currentMonthPrefix),
                    monthPrefix: currentMonthPrefix,
                    description: 'حقق جميع متطلبات أوسمة الشهر الحالي (حضور مبكر 3 مرات، قداس شهري 1+، مشاركة 25+ نقطة)',
                    progress: '3/3 أوسمة مكتملة',
                    isAwarded: !!currentMonthAwardRecord,
                    awardedRecord: currentMonthAwardRecord,
                    suggestedPoints: 15,
                    color: 'from-amber-400 to-yellow-500'
                });
            }

            // 2. Triple Monthly Badges for Previous Month (بطل الشهر السابق)
            const prevHasAllMonthly = BADGES_CONFIG.filter(b => b.category === 'monthly').every(b => b.check(history, pts, prevMonthPrefix));
            if (prevHasAllMonthly) {
                const prevMonthAwardRecord = history.find(h => !(typeof h.meta === 'string' && h.meta.startsWith('leaderboard_reward_')) && (
                    (h.meta && (h.meta.includes(`monthly_all_${prevMonthPrefix}`) || h.meta.includes(`badge_reward_monthly_all_${prevMonthPrefix}`))) ||
                    (h.typeName === 'مكافأة تجميع الأوسمة' && h.date && (h.date.startsWith(prevMonthPrefix) || h.date.startsWith(currentMonthPrefix))) ||
                    (h.description && (h.description.includes('تجميع الأوسمة') || h.description.includes('مكافأة الأوسمة')) && (h.description.includes(getArabicMonthName(prevMonthPrefix).split(' ')[0]) || h.date?.startsWith(prevMonthPrefix)))
                ));
                alerts.push({
                    id: `monthly_all_${prevMonthPrefix}_${student.id}`,
                    studentId: student.id,
                    studentName: student.name,
                    student,
                    badgeId: 'monthly_all_prev',
                    badgeTitle: `بطل الشهر السابق: تجميع كل الأوسمة (3/3)`,
                    badgeEmoji: '🌟',
                    category: 'monthly',
                    categoryLabel: 'أوسمة شهرية (الشهر السابق)',
                    periodLabel: getArabicMonthName(prevMonthPrefix),
                    monthPrefix: prevMonthPrefix,
                    description: 'حقق جميع متطلبات أوسمة الشهر السابق كاملة، بما فيها 3 مرات حضور مبكر',
                    progress: '3/3 أوسمة مكتملة',
                    isAwarded: !!prevMonthAwardRecord,
                    awardedRecord: prevMonthAwardRecord,
                    suggestedPoints: 15,
                    color: 'from-yellow-500 to-amber-600'
                });
            }

            // 3. Cumulative / Milestone Badges (أوسمة تراكمية وموسمية)
            BADGES_CONFIG.filter(b => b.category === 'cumulative').forEach(badge => {
                const isUnlocked = badge.check(history, pts, undefined);
                if (isUnlocked) {
                    const awardRecord = history.find(h => 
                        (h.meta && (h.meta.includes(`badge_reward_${badge.id}`) || h.meta.includes(`badge_${badge.id}`))) ||
                        (h.description && (h.description.includes(badge.name) || (badge.id === 'points_milestone_1000' && h.description.includes('الألف نقطة'))))
                    );
                    alerts.push({
                        id: `cumulative_${badge.id}_${student.id}`,
                        studentId: student.id,
                        studentName: student.name,
                        student,
                        badgeId: badge.id,
                        badgeTitle: `وسام: ${badge.name}`,
                        badgeEmoji: badge.emoji,
                        category: 'cumulative',
                        categoryLabel: 'أوسمة موسمية',
                        periodLabel: 'إنجاز تراكمي',
                        description: `${badge.description} — مستحق لمكافأة موسمية +20 نقطة (تُضاف يدويًا).`,
                        progress: badge.getProgress(history, pts, undefined),
                        isAwarded: !!awardRecord,
                        awardedRecord: awardRecord,
                        suggestedPoints: 20,
                        color: badge.color
                    });
                }
            });

            // (الأوسمة الشهرية لوحدها مالهاش مكافأة: المكافأة بس للي يكمّل الـ3 أوسمة = 15 نقطة)
        });

        // 3. مكافآت ترتيب الشهر اللي فات (أول 3): بتتحسب مرة واحدة بس للكل.
        // (قبل كده كانت جوه اللوب بتاع كل طالب، فكانت بتتكرر مرة لكل ولد: 87 × 3 = 261 تنبيه)
        const prevMonthRanking = [...students]
            .map(candidate => {
                const prevPoints = (candidate.attendanceHistory || [])
                    .filter(h => h.date && h.date.startsWith(prevMonthPrefix))
                    .filter(isActivityRecord)
                    .reduce((sum, h) => sum + Number(h.points || 0), 0);
                return { candidate, prevPoints };
            })
            .filter(item => item.prevPoints > 0)
            .sort((a, b) => b.prevPoints - a.prevPoints || a.candidate.name.localeCompare(b.candidate.name, 'ar'));
        // التعادل: اللي متساويين في النقط بياخدوا نفس المركز ونفس المكافأة،
        // واللي بعدهم بياخد المركز اللي عليه الدور (مثال: الأول، الثاني، الثاني، الثالث)
        const topScores = [...new Set(prevMonthRanking.map(item => item.prevPoints))].slice(0, 3);

        prevMonthRanking.filter(item => topScores.includes(item.prevPoints)).forEach((item) => {
            const index = topScores.indexOf(item.prevPoints);
            const rank = index + 1;
            const rankTitles = ['المركز الأول', 'المركز الثاني', 'المركز الثالث'];
            const rankPoints = [20, 15, 10];
            const rankEmojis = ['🥇', '🥈', '🥉'];
            const candidate = item.candidate;
            // لو الولد اتصرفتله مكافأة ترتيب الشهر ده قبل كده (بأي مركز)، مايتصرفلوش تاني،
            // حتى لو ترتيبه اتغير بعدين (تعادل، أو استعادة نسخة احتياطية)
            const awardRecord = (candidate.attendanceHistory || []).find(h => typeof h.meta === 'string' && h.meta.startsWith(`leaderboard_reward_${prevMonthPrefix}_rank_`));

            alerts.push({
                id: `leaderboard_${prevMonthPrefix}_rank_${rank}_${candidate.id}`,
                studentId: candidate.id,
                studentName: candidate.name,
                student: candidate,
                badgeId: `leaderboard_rank_${rank}`,
                badgeTitle: `${rankEmojis[index]} ${rankTitles[index]} في الشهر`,
                badgeEmoji: rankEmojis[index],
                category: 'monthly',
                categoryLabel: 'مكافآت ترتيب الشهر',
                periodLabel: getArabicMonthName(prevMonthPrefix),
                monthPrefix: prevMonthPrefix,
                description: `أنهى الشهر في ${rankTitles[index]} برصيد ${item.prevPoints} نقطة قبل مكافآت ترتيب الشهر.`,
                progress: `${item.prevPoints} نقطة`,
                isAwarded: !!awardRecord,
                awardedRecord: awardRecord,
                suggestedPoints: rankPoints[index],
                color: index === 0 ? 'from-amber-400 to-yellow-500' : index === 1 ? 'from-slate-300 to-slate-500' : 'from-orange-400 to-amber-700'
            });
        });

        // Sort: Pending (not awarded) first, then by student name
        return alerts.sort((a, b) => {
            if (a.isAwarded !== b.isAwarded) {
                return a.isAwarded ? 1 : -1;
            }
            return a.studentName.localeCompare(b.studentName, 'ar');
        });
    }, [students]);

    const pendingBadgesCount = useMemo(() => {
        return allBadgeAlerts.filter(a => !a.isAwarded).length;
    }, [allBadgeAlerts]);

    const filteredBadgeAlerts = useMemo(() => {
        return allBadgeAlerts.filter(alert => {
            if (badgeAlertSearch) {
                const term = badgeAlertSearch.toLowerCase();
                const matchName = alert.studentName.toLowerCase().includes(term);
                const matchTitle = alert.badgeTitle.toLowerCase().includes(term);
                const matchCat = alert.categoryLabel.toLowerCase().includes(term);
                if (!matchName && !matchTitle && !matchCat) return false;
            }
            if (badgeAlertsFilter === 'pending') return !alert.isAwarded;
            if (badgeAlertsFilter === 'awarded') return alert.isAwarded;
            if (badgeAlertsFilter === 'monthly') return alert.category === 'monthly' || alert.category === 'monthly_single';
            if (badgeAlertsFilter === 'cumulative') return alert.category === 'cumulative';
            return true;
        });
    }, [allBadgeAlerts, badgeAlertSearch, badgeAlertsFilter]);

    const handleQuickAwardBadgePoints = (alertItem, customPoints = undefined) => {
        if (!loggedInAdmin || !isMinaAdmin) {
            showToast('هذه المكافآت متاحة لمسئول النظام فقط.');
            return;
        }
        const pts = customPoints || alertItem.suggestedPoints || 15;
        const targetStudent = students.find(s => s.id === alertItem.studentId);
        if (!targetStudent) return;

        const targetMeta = alertItem.badgeId?.startsWith('leaderboard_rank_')
            ? `leaderboard_reward_${alertItem.monthPrefix}_rank_${alertItem.badgeId.replace('leaderboard_rank_', '')}`
            : `badge_reward_${alertItem.id}`;
        const isLeaderboardReward = Boolean(alertItem.badgeId?.startsWith('leaderboard_rank_'));
        const alreadyRewarded = (targetStudent.attendanceHistory || []).some(h =>
            h.meta === targetMeta ||
            (isLeaderboardReward && typeof h.meta === 'string' && h.meta.startsWith(`leaderboard_reward_${alertItem.monthPrefix}_rank_`)));
        if (alreadyRewarded) {
            showToast('تم منح مكافأة هذا الوسام بالفعل.');
            return;
        }

        const recordDate = getCairoDateKey();
        const newRecord = {
            id: generateId(),
            date: recordDate,
            points: pts,
            type: 'participation',
            typeName: isLeaderboardReward ? 'مكافأة لوحة الصدارة' : (alertItem.category.startsWith('monthly') ? 'مكافأة تجميع الأوسمة' : 'مكافأة إنجاز وسام'),
            description: `مكافأة ${alertItem.badgeTitle} (${alertItem.periodLabel})`,
            recordedBy: loggedInAdmin.name,
            meta: targetMeta
        };

        const updatedStudents = students.map(s => {
            if (s.id === alertItem.studentId) {
                const history = s.attendanceHistory || [];
                return {
                    ...s,
                    points: (s.points || 0) + pts,
                    attendanceHistory: [newRecord, ...history]
                };
            }
            return s;
        });

        saveStudentsData(updatedStudents);
        showToast(`🎉 تم منح مكافأة (+${pts} نقطة) لـ ${alertItem.studentName} عن (${alertItem.badgeTitle}) بنجاح!`);
    };


    const leaderboardStudents = useMemo(() => {
        const currentMonthPrefix = getCairoMonthPrefix();
        const prevMonthPrefix = getCairoMonthPrefixOffset(-1);

        return [...students]
            .map(student => {
                // "الكل": النقط اللي الولد كسبها السنة دي (الشراء من المتجر مابينزّلوش في الترتيب)
                let filteredPoints = getEarnedPointsFromHistory(student.attendanceHistory, student.points);
                
                if (leaderboardFilter === 'current_month') {
                    filteredPoints = (student.attendanceHistory || [])
                        .filter(h => h.date && h.date.startsWith(currentMonthPrefix))
                        .filter(isActivityRecord)
                        .reduce((sum, h) => sum + Number(h.points || 0), 0);
                } else if (leaderboardFilter === 'prev_month') {
                    filteredPoints = (student.attendanceHistory || [])
                        .filter(h => h.date && h.date.startsWith(prevMonthPrefix))
                        .filter(isActivityRecord)
                        .reduce((sum, h) => sum + Number(h.points || 0), 0);
                }
                
                return {
                    ...student,
                    pointsForLeaderboard: filteredPoints,
                    // الجنيهات في "الكل" بتفضل على الرصيد الحقيقي اللي يقدر يصرفه
                    ...(leaderboardFilter === 'all' ? { moneyBasePoints: student.points || 0 } : {}),
                };
            })
            .sort((a, b) => b.pointsForLeaderboard - a.pointsForLeaderboard);
    }, [students, leaderboardFilter]);
    
    // --- Statistics Logic for "Attendance Summary" View ---
    const meetingsStats = useMemo(() => {
        const stats: Record<string, any> = {};
        students.forEach(std => {
            (std.attendanceHistory || []).forEach(record => {
                if (!record.date) return;
                if (!isFridayDateKey(record.date)) return;
                if (!isActivityRecord(record)) return; // المكافآت ومشتريات الهدايا مش جزء من الاجتماع

                if (!stats[record.date]) {
                    stats[record.date] = {
                        date: record.date,
                        totalPoints: 0,
                        uniqueAttendees: new Set(),
                        breakdown: {}
                    };
                }
                stats[record.date].totalPoints += Number(record.points || 0);
                if (['early', 'late', 'monthlyMass'].includes(record.type)) {
                    stats[record.date].uniqueAttendees.add(std.id);
                }
                
                // Count occurrence of each type (e.g. Early: 5, Late: 2)
                const typeLabel = record.typeName || record.type;
                if (!stats[record.date].breakdown[typeLabel]) {
                    stats[record.date].breakdown[typeLabel] = 0;
                }
                stats[record.date].breakdown[typeLabel]++;
            });
        });
        // Convert to array and sort by date descending
        return Object.values(stats).sort((a, b) => b.date.localeCompare(a.date));
    }, [students]);

    // ===== الافتقاد =====
    // كل خادم ليه "مجموعة" ثابتة من الأولاد (مينا بيوزّعها بالصف). كل أسبوع، الخادم بيشوف
    // اللي غابوا من مجموعته في آخر اجتماع ويفتقدهم من الموقع، ومينا بيشوف تقرير بكل خادم.
    const FOLLOWUP_DOC_REF = () => doc(db, 'appData', 'followup_v1');
    useEffect(() => {
        const unsub = onSnapshot(FOLLOWUP_DOC_REF(), (snap) => {
            const data: any = snap.exists() ? snap.data() : {};
            setFollowup({
                assignments: (data && typeof data.assignments === 'object' && data.assignments) || {},
                contacts: (data && typeof data.contacts === 'object' && data.contacts) || {},
            });
        }, (err) => console.error('Follow-up listener error:', err));
        return () => unsub();
    }, []);
    const FOLLOWUP_HISTORY_REF = () => doc(db, 'appData', 'followup_history_v1');
    useEffect(() => {
        const unsub = onSnapshot(FOLLOWUP_HISTORY_REF(), (snap) => {
            const data: any = snap.exists() ? snap.data() : {};
            setFollowupHistory((data && typeof data.byMeeting === 'object' && data.byMeeting) || {});
        }, (err) => console.error('Follow-up history listener error:', err));
        return () => unsub();
    }, []);

    // الاجتماعات اللي حصلت فعلًا (أي جمعة اتسجل فيها حضور)، من الأحدث للأقدم
    const followupMeetings = useMemo(() => {
        const today = getCairoDateKey();
        return meetingsStats
            .filter(m => m.uniqueAttendees && m.uniqueAttendees.size > 0 && m.date <= today)
            .map(m => ({ date: m.date, attendees: m.uniqueAttendees }));
    }, [meetingsStats]);
    const latestMeetingDate = followupMeetings[0]?.date || '';

    // لكل ولد: غايب كام اجتماع ورا بعض لحد آخر اجتماع، وآخر مرة حضر إمتى
    const followupInfo = useMemo(() => {
        const map: Record<string, { streak: number; lastAttendedDate: string; missedAll: boolean }> = {};
        students.forEach(s => {
            let streak = 0;
            for (const m of followupMeetings) {
                if (m.attendees.has(s.id)) break;
                streak++;
            }
            const lastAttendedDate = (s.attendanceHistory || [])
                .filter(h => ['early', 'late', 'monthlyMass'].includes(h.type) && h.date)
                .map(h => h.date).sort().pop() || '';
            map[s.id] = { streak, lastAttendedDate, missedAll: followupMeetings.length > 0 && streak === followupMeetings.length };
        });
        return map;
    }, [students, followupMeetings]);

    const followupGrades = useMemo(() => {
        const order = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];
        const found: string[] = [...new Set<string>(students.map(s => String(s.grade || '').trim()).filter(Boolean))];
        return found.sort((a, b) => {
            const ia = order.indexOf(a), ib = order.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b, 'ar');
        });
    }, [students]);

    const assignedServantId = (studentId) => {
        const id = followup.assignments?.[studentId];
        return id && admins.some(a => a.id === id) ? id : '';
    };
    const isAbsentNow = (studentId) => (followupInfo[studentId]?.streak || 0) >= 1;
    const isFollowupContacted = (studentId) => {
        const c = followup.contacts?.[studentId];
        return Boolean(c && c.date && latestMeetingDate && c.date >= latestMeetingDate);
    };
    const byAbsence = (a, b) => (followupInfo[b.id]?.streak || 0) - (followupInfo[a.id]?.streak || 0) || String(a.name).localeCompare(String(b.name), 'ar');

    const myFollowupGroup = useMemo(() => students.filter(s => loggedInAdmin && assignedServantId(s.id) === loggedInAdmin.id), [students, followup, admins, loggedInAdmin]);
    const myFollowupAbsent = useMemo(() => myFollowupGroup.filter(s => isAbsentNow(s.id)).sort(byAbsence), [myFollowupGroup, followupInfo]);
    const myPendingFollowupCount = myFollowupAbsent.filter(s => !isFollowupContacted(s.id)).length;

    // تقرير مينا: لكل خادم، مجموعته، والغايبين منها، وافتقد كام، وآخر مرة استخدم الافتقاد
    const followupReport = useMemo(() => {
        return admins.map(a => {
            const group = students.filter(s => assignedServantId(s.id) === a.id);
            const absent = group.filter(s => isAbsentNow(s.id)).sort(byAbsence);
            const done = absent.filter(s => isFollowupContacted(s.id));
            const lastActivity = Object.values(followup.contacts || {})
                .filter((c: any) => c && c.byId === a.id && c.at)
                .map((c: any) => c.at).sort().pop() || '';
            return { admin: a, group, absent, done, lastActivity };
        }).filter(r => r.group.length > 0)
            .sort((x, y) => (x.absent.length ? x.done.length / x.absent.length : 1) - (y.absent.length ? y.done.length / y.absent.length : 1));
    }, [admins, students, followup, followupInfo, latestMeetingDate]);
    // ===== المتابعة (أمين الفصل / المساعدين / الأمين العام) =====
    const myScope = isFollowupOnlyAdmin(loggedInAdmin) ? '' : oversightScopeOf(loggedInAdmin);
    const canOversee = !!myScope;
    const scopeCoversGrade = (g) => myScope === 'all' || (!!myScope && String(g || '').trim() === myScope);
    const scopeCoversStudent = (s) => !!s && scopeCoversGrade(s.grade);
    // أمين الفصل: التوزيع دايمًا على صفّه
    useEffect(() => {
        if (myScope && myScope !== 'all' && followupGrade !== myScope) setFollowupGrade(myScope);
    }, [myScope, followupGrade]);

    // ===== الملاحظات =====
    const NOTES_DOC_REF = () => doc(db, 'appData', 'notes_v1');
    useEffect(() => {
        const unsub = onSnapshot(NOTES_DOC_REF(), (snap) => {
            const data: any = snap.exists() ? snap.data() : {};
            setNotesData((data && typeof data.notes === 'object' && data.notes) || {});
        }, (err) => console.error('Notes listener error:', err));
        return () => unsub();
    }, []);
    // مين يشوف كل ملاحظات الولد: خادمه + أمين صفّه + المساعدين + الأمين العام. غيرهم يشوف ملاحظاته هو بس.
    const canSeeAllNotesOf = (s) => !!loggedInAdmin && !!s && (scopeCoversStudent(s) || assignedServantId(s.id) === loggedInAdmin.id);
    const allNotesOf = (studentId) => Object.entries(notesData[studentId] || {})
        .map(([id, n]: [string, any]) => ({ id, ...(n || {}) }))
        .filter((n: any) => n && n.text)
        .sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || '')));
    const visibleNotesOf = (s) => {
        if (!s || !loggedInAdmin) return [];
        const list = allNotesOf(s.id);
        return canSeeAllNotesOf(s) ? list : list.filter((n: any) => n.byId === loggedInAdmin.id);
    };
    const addNote = (studentId, text) => {
        const clean = String(text || '').trim().slice(0, 1000);
        if (!loggedInAdmin || !clean) return Promise.resolve(false);
        const noteId = `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        return setDoc(NOTES_DOC_REF(), {
            notes: { [studentId]: { [noteId]: { text: clean, by: loggedInAdmin.name, byId: loggedInAdmin.id, at: new Date().toISOString(), date: getCairoDateKey() } } },
        }, { merge: true }).then(() => true).catch(err => { console.error(err); showToast('⚠️ فشل حفظ الملاحظة، جرّب تاني.'); return false; });
    };
    const deleteNote = (studentId, note) => {
        if (!loggedInAdmin || !(loggedInAdmin.isSuperAdmin || note.byId === loggedInAdmin.id)) return;
        if (!window.confirm('تمسح الملاحظة دي؟')) return;
        setDoc(NOTES_DOC_REF(), { notes: { [studentId]: { [note.id]: deleteField() } } }, { merge: true })
            .then(() => showToast('اتمسحت الملاحظة.'))
            .catch(err => { console.error(err); showToast('⚠️ فشل المسح، جرّب تاني.'); });
    };
    const notesDocKB = useMemo(() => Math.round(JSON.stringify(notesData || {}).length / 1024), [notesData]);

    // ===== ولاد بيبعدوا: غايبين 3 اجتماعات ورا بعض أو أكتر، وكانوا بيحضروا قبل كده =====
    const AT_RISK_STREAK = 3;
    const atRiskStudents = useMemo(() => students
        .filter(s => (followupInfo[s.id]?.streak || 0) >= AT_RISK_STREAK && followupInfo[s.id]?.lastAttendedDate)
        .sort((a, b) => (followupInfo[b.id]?.streak || 0) - (followupInfo[a.id]?.streak || 0) || String(a.name).localeCompare(String(b.name), 'ar')),
        [students, followupInfo]);
    const neverCameStudents = useMemo(() => followupMeetings.length >= AT_RISK_STREAK
        ? students.filter(s => !followupInfo[s.id]?.lastAttendedDate) : [], [students, followupInfo, followupMeetings]);
    const isAtRisk = (studentId) => (followupInfo[studentId]?.streak || 0) >= AT_RISK_STREAK && !!followupInfo[studentId]?.lastAttendedDate;

    // نقط النشاط لكل ولد في يوم أو شهر معيّن (من غير المكافآت والهدايا)
    const activityPointsIn = (s, prefix) => (s.attendanceHistory || [])
        .filter(h => h.date && h.date.startsWith(prefix) && isActivityRecord(h))
        .reduce((n, h) => n + Number(h.points || 0), 0);
    const firstAttendanceDate = (s) => (s.attendanceHistory || [])
        .filter(h => ['early', 'late', 'monthlyMass'].includes(h.type) && h.date).map(h => h.date).sort()[0] || '';

    // ===== ملخص الجمعة =====
    const buildFridaySummary = (meetingDate, inScope) => {
        const idx = followupMeetings.findIndex(m => m.date === meetingDate);
        if (idx === -1) return null;
        const m = followupMeetings[idx];
        const prev = followupMeetings[idx + 1];
        const scoped = students.filter(inScope);
        const present = scoped.filter(s => m.attendees.has(s.id));
        const prevCount = prev ? scoped.filter(s => prev.attendees.has(s.id)).length : null;
        const byGrade = followupGrades.map(g => ({ g, n: present.filter(s => String(s.grade || '').trim() === g).length, total: scoped.filter(s => String(s.grade || '').trim() === g).length })).filter(x => x.total > 0);
        const newKids = present.filter(s => firstAttendanceDate(s) === meetingDate);
        const returned = present.filter(s => {
            if (newKids.includes(s)) return false;
            let missed = 0;
            for (let i = idx + 1; i < followupMeetings.length; i++) { if (followupMeetings[i].attendees.has(s.id)) break; missed++; }
            return missed >= 2;
        });
        const top = present.map(s => ({ s, p: activityPointsIn(s, meetingDate) })).filter(x => x.p > 0).sort((a, b) => b.p - a.p).slice(0, 3);
        // الافتقاد اللي اتعمل على غياب الاجتماع اللي قبله
        let fuDone = 0, fuTotal = 0;
        if (prev) {
            scoped.filter(s => !prev.attendees.has(s.id) && assignedServantId(s.id)).forEach(s => {
                fuTotal++;
                if (wasContactedForMeeting(prev.date, s.id)) fuDone++;
            });
        }
        const atRiskN = idx === 0 ? atRiskStudents.filter(inScope).length : null;
        return { m, prev, present, prevCount, byGrade, newKids, returned, top, fuDone, fuTotal, atRiskN, isMass: isFirstFridayDateKey(meetingDate) };
    };
    const fridaySummaryText = (sum, scopeLabel) => {
        if (!sum) return '';
        const d = formatCairoDateKeyAr(sum.m.date, { weekday: 'long', day: 'numeric', month: 'long' });
        const diff = sum.prevCount === null ? '' : sum.present.length - sum.prevCount;
        const lines = [
            `📋 ملخص ${sum.isMass ? 'القداس الشهري' : 'اجتماع'} ${d}${scopeLabel ? ` — ${scopeLabel}` : ''}`,
            `اجتماع الأنبا رويس - ثانوي بنين`,
            ``,
            `👥 الحضور: ${sum.present.length}${diff === '' ? '' : diff > 0 ? ` (⬆️ ${diff} عن اللي قبله)` : diff < 0 ? ` (⬇️ ${Math.abs(Number(diff))} عن اللي قبله)` : ' (زي اللي قبله)'}`,
            ...(sum.byGrade.length > 1 ? [sum.byGrade.map(x => `• ${x.g}: ${x.n} من ${x.total}`).join('\n')] : []),
            ...(sum.newKids.length ? [``, `🆕 أول مرة ييجوا (${sum.newKids.length}): ${sum.newKids.map(s => s.name).join('، ')}`] : []),
            ...(sum.returned.length ? [``, `🔙 رجعوا بعد غياب (${sum.returned.length}): ${sum.returned.map(s => s.name).join('، ')}`] : []),
            ...(sum.top.length ? [``, `🏆 أعلى نقط: ${sum.top.map(x => `${x.s.name} (${x.p})`).join('، ')}`] : []),
            ...(sum.prev && sum.fuTotal ? [``, `📞 افتقاد غياب الاجتماع اللي قبله: ${sum.fuDone} من ${sum.fuTotal}`] : []),
            ...(sum.atRiskN ? [`⚠️ ولاد غايبين ${AT_RISK_STREAK} اجتماعات أو أكتر: ${sum.atRiskN}`] : []),
        ];
        return lines.join('\n');
    };

    // ===== التقرير الشهري =====
    const reportMonths = useMemo(() => [...new Set(followupMeetings.map(m => m.date.slice(0, 7)))].sort().reverse(), [followupMeetings]);
    const buildMonthReport = (prefix, inScope) => {
        const scoped = students.filter(inScope);
        const meetings = followupMeetings.filter(m => m.date.startsWith(prefix)).slice().reverse();
        const attendedCount = (s) => meetings.filter(m => m.attendees.has(s.id)).length;
        const perMeeting = meetings.map(m => ({
            date: m.date,
            isMass: isFirstFridayDateKey(m.date),
            total: scoped.filter(s => m.attendees.has(s.id)).length,
            byGrade: followupGrades.map(g => scoped.filter(s => String(s.grade || '').trim() === g && m.attendees.has(s.id)).length),
        }));
        const grades = followupGrades.map(g => {
            const kids = scoped.filter(s => String(s.grade || '').trim() === g);
            const avg = meetings.length ? kids.reduce((n, s) => n + attendedCount(s), 0) / meetings.length : 0;
            return { g, total: kids.length, avg, pct: kids.length ? Math.round((avg / kids.length) * 100) : 0 };
        }).filter(x => x.total > 0);
        const totalAvg = meetings.length ? scoped.reduce((n, s) => n + attendedCount(s), 0) / meetings.length : 0;
        const massKids = scoped.filter(s => (s.attendanceHistory || []).some(h => h.type === 'monthlyMass' && h.date && h.date.startsWith(prefix)));
        const confessions = scoped.filter(s => (s.attendanceHistory || []).some(h => h.type === 'confession' && h.date && h.date.startsWith(prefix))).length;
        const newKids = scoped.filter(s => firstAttendanceDate(s).startsWith(prefix));
        const committed = scoped.map(s => ({ s, n: attendedCount(s), p: activityPointsIn(s, prefix) }))
            .filter(x => x.n > 0).sort((a, b) => b.n - a.n || b.p - a.p).slice(0, 10);
        const servants = admins.map(a => {
            const group = scoped.filter(s => assignedServantId(s.id) === a.id);
            if (!group.length) return null;
            let absent = 0, done = 0, replied = 0, quick = 0;
            meetings.forEach(m => group.forEach(s => {
                if (m.attendees.has(s.id)) return;
                absent++;
                const c = contactForMeeting(m.date, s.id);
                if (c) { done++; if (isRepliedOutcome(c.outcome)) replied++; if (c.quick) quick++; }
            }));
            const notesN = group.reduce((n, s) => n + allNotesOf(s.id).filter((x: any) => x.byId === a.id && String(x.date || x.at || '').startsWith(prefix)).length, 0);
            return { a, size: group.length, absent, done, replied, quick, pct: absent ? Math.round((done / absent) * 100) : 100, notesN };
        }).filter(Boolean).sort((x: any, y: any) => y.pct - x.pct);
        const trackingStart = Object.keys(followupHistory || {}).sort()[0] || latestMeetingDate || '';
        return { prefix, scoped, meetings, perMeeting, grades, totalAvg, massKids, confessions, newKids, committed, servants, atRisk: atRiskStudents.filter(inScope), never: neverCameStudents.filter(inScope), trackingStart };
    };
    // وإحنا بنطبع التقرير، باقي الموقع بيستخبى
    useEffect(() => {
        document.body.classList.toggle('month-report-open', monthReportOpen);
        return () => document.body.classList.remove('month-report-open');
    }, [monthReportOpen]);

    const unassignedAbsentCount = students.filter(s => !assignedServantId(s.id) && isAbsentNow(s.id)).length;
    const unassignedCount = students.filter(s => !assignedServantId(s.id)).length;

    const recordFollowupContact = (studentId, method, extra: any = {}) => {
        if (!loggedInAdmin) return;
        const entry = { date: getCairoDateKey(), by: loggedInAdmin.name, byId: loggedInAdmin.id, method, at: new Date().toISOString(), ...extra };
        setDoc(FOLLOWUP_DOC_REF(), {
            contacts: { [studentId]: entry },
        }, { merge: true }).catch(err => { console.error(err); showToast('⚠️ فشل الحفظ، جرّب تاني.'); });
        // نسخة في سجل الاجتماع ده (مابتتمسحش لما ييجي اجتماع جديد)
        if (latestMeetingDate) {
            setDoc(FOLLOWUP_HISTORY_REF(), { byMeeting: { [latestMeetingDate]: { [studentId]: { byId: entry.byId, method, at: entry.at, ...(entry.outcome ? { outcome: entry.outcome } : {}), ...(entry.quick ? { quick: true } : {}) } } } }, { merge: true })
                .catch(err => console.error('Follow-up history save error:', err));
        }
    };
    // اتافتقد بعد اجتماع معيّن؟ (آخر اجتماع من العلامات الحالية، والقديم من السجل)
    const wasContactedForMeeting = (meetingDate, studentId) => {
        if (meetingDate === latestMeetingDate) return isFollowupContacted(studentId);
        return Boolean(followupHistory?.[meetingDate]?.[studentId]);
    };
    const contactForMeeting = (meetingDate, studentId) => {
        if (meetingDate === latestMeetingDate) return isFollowupContacted(studentId) ? followup.contacts?.[studentId] : null;
        return followupHistory?.[meetingDate]?.[studentId] || null;
    };

    // ===== نتيجة الافتقاد =====
    const savePendingContact = (p) => {
        setPendingContact(p);
        try { if (p) localStorage.setItem('pending_followup_contact', JSON.stringify(p)); else localStorage.removeItem('pending_followup_contact'); } catch (e) {}
    };
    // الخادم داس واتساب أو اتصال: لسه ماتحسبش، بنستنى يرجع
    const startFollowupContact = (studentId, method) => {
        if (!loggedInAdmin) return;
        hiddenAtRef.current = 0;
        savePendingContact({ studentId, method, startedAt: Date.now(), byId: loggedInAdmin.id });
    };
    const openOutcome = (p, awayMs = null) => { setOutcomeNote(''); setOutcomeModal({ ...p, awayMs }); };
    useEffect(() => {
        const onVis = () => {
            if (document.hidden) { hiddenAtRef.current = Date.now(); return; }
            if (!pendingContact || outcomeModal || !loggedInAdmin || pendingContact.byId !== loggedInAdmin.id) return;
            if (!hiddenAtRef.current) return; // لسه ماخرجش من الموقع
            const away = Date.now() - hiddenAtRef.current;
            hiddenAtRef.current = 0;
            openOutcome(pendingContact, away);
        };
        document.addEventListener('visibilitychange', onVis);
        return () => document.removeEventListener('visibilitychange', onVis);
    }, [pendingContact, outcomeModal, loggedInAdmin]);
    // لو الموقع اتقفل واتفتح تاني وهو لسه ماقالش حصل إيه
    useEffect(() => {
        if (!pendingContact || outcomeModal || !loggedInAdmin || pendingContact.byId !== loggedInAdmin.id) return;
        if (Date.now() - Number(pendingContact.startedAt || 0) > 4000 && !document.hidden && !hiddenAtRef.current) {
            openOutcome(pendingContact, Date.now() - Number(pendingContact.startedAt || 0));
        }
    }, [loggedInAdmin]);
    const FOLLOWUP_OUTCOMES = {
        replied: { icon: '💬', label: 'رد عليا', short: 'رد' },
        no_reply: { icon: '✉️', label: 'بعتّله ومردش لسه', short: 'مردش' },
        no_answer: { icon: '📵', label: 'مردش على المكالمة', short: 'مردش' },
        met: { icon: '🤝', label: 'قابلته أو كلمته بطريقة تانية', short: 'قابله' },
        unreachable: { icon: '❌', label: 'معرفتش أوصله', short: 'ماوصلوش' },
    };
    const OUTCOMES_BY_METHOD = { whatsapp: ['replied', 'no_reply', 'unreachable'], call: ['replied', 'no_answer', 'unreachable'], manual: ['met', 'replied', 'unreachable'] };
    const isRepliedOutcome = (o) => o === 'replied' || o === 'met';
    const QUICK_MS = 5000;
    const finishFollowupContact = (outcome) => {
        if (!outcomeModal) return;
        const note = outcomeNote.trim();
        if (outcome === 'unreachable' && !note) { showToast('اكتب في سطر ليه معرفتش توصله.'); return; }
        const quick = outcomeModal.method !== 'manual' && outcomeModal.awayMs !== null && outcomeModal.awayMs < QUICK_MS;
        recordFollowupContact(outcomeModal.studentId, outcomeModal.method, {
            outcome, ...(quick ? { quick: true } : {}),
            ...(outcomeModal.awayMs !== null ? { awaySec: Math.round(outcomeModal.awayMs / 1000) } : {}),
        });
        if (note) addNote(outcomeModal.studentId, `${FOLLOWUP_OUTCOMES[outcome].icon} ${FOLLOWUP_OUTCOMES[outcome].label}: ${note}`);
        savePendingContact(null);
        setOutcomeModal(null);
        setOutcomeNote('');
        showToast('✅ اتسجل الافتقاد.');
    };
    const cancelFollowupContact = () => {
        savePendingContact(null);
        setOutcomeModal(null);
        setOutcomeNote('');
        showToast('ماتسجلش افتقاد.');
    };
    const toggleFollowupContacted = (studentId) => {
        if (!loggedInAdmin) return;
        if (isFollowupContacted(studentId)) {
            if (latestMeetingDate) {
                setDoc(FOLLOWUP_HISTORY_REF(), { byMeeting: { [latestMeetingDate]: { [studentId]: deleteField() } } }, { merge: true })
                    .catch(err => console.error('Follow-up history delete error:', err));
            }
            setDoc(FOLLOWUP_DOC_REF(), { contacts: { [studentId]: deleteField() } }, { merge: true })
                .then(() => showToast('اتشالت علامة الافتقاد.'))
                .catch(err => { console.error(err); showToast('⚠️ فشل الحفظ، جرّب تاني.'); });
        } else {
            openOutcome({ studentId, method: 'manual', startedAt: Date.now(), byId: loggedInAdmin.id }, null);
        }
    };
    const assignFollowup = (studentId, adminId) => {
        if (!scopeCoversStudent(students.find(s => s.id === studentId))) return;
        setDoc(FOLLOWUP_DOC_REF(), { assignments: { [studentId]: adminId ? adminId : deleteField() } }, { merge: true })
            .catch(err => { console.error(err); showToast('⚠️ فشل حفظ التوزيع، جرّب تاني.'); });
    };

    // توزيع مجموعات صف كامل على خدام بيختارهم مينا، بالتساوي، وكل خادم بياخد خليط
    // (اللي بيحضروا، واللي بيغيبوا شوية، واللي بيغيبوا كتير)
    const openGroupDistribution = (reassignAll) => {
        if (!scopeCoversGrade(followupGrade)) return;
        const gradeStudents = students.filter(s => String(s.grade || '').trim() === followupGrade);
        const used = [...new Set(gradeStudents.map(s => assignedServantId(s.id)).filter(Boolean))] as string[];
        setFollowupReassignAll(Boolean(reassignAll));
        setFollowupAssignServants(used);
        setFollowupAssignPickerOpen(true);
    };
    // توزيع افتقاد تانية ثانوي اللي اتعمل في ملفات الـPDF (مينا رزق / ناجي وليم / بولا ماهر)
    const GRADE2_PDF_PRESET: Record<string, string[]> = {"mina": ["يوسف جورج", "ماريو وائل", "نوفير مايكل", "كيرلس ماجد", "جوسيان جرجس", "جورج شريف", "فيلوباتير عادل", "انطونيوس سامح", "فادي ايهاب", "مينا هاني (بخيت)", "مكاريوس عاطف"], "nagy": ["جميل نبيل", "يوسف امير", "توني ريمون", "ابرام ياسر", "ديفيد سامح", "استيفن منير", "بولا مجدي", "جيوفاني هاني", "ابانوب هاني", "بافلي سمير", "نوفير ماجد"], "bola": ["جيوفاني مايكل", "مينا ميلاد", "جورج وجيه", "جرجس نبيل", "فيلوباتير ماهر", "ديفيد هاني", "فيلوباتير امجد", "جرجس صابر", "كيرلس وجدي", "بيتر عماد"]};
    const applyGrade2PdfPreset = () => {
        if (!scopeCoversGrade('تانية ثانوي')) return;
        const norm = (n) => normalizeRosterStudentName(n);
        const findAdmin = (name) => admins.find(a => norm(a.name) === norm(name));
        const servantIds = {
            mina: admins.find(a => a.isSuperAdmin)?.id || '',
            nagy: findAdmin('ناجي وليم')?.id || '',
            bola: findAdmin('بولا ماهر')?.id || '',
        };
        const missing = [!servantIds.nagy && 'ناجي وليم', !servantIds.bola && 'بولا ماهر'].filter(Boolean);
        if (missing.length) { showToast(`⚠️ ضيف ${missing.join(' و ')} كخادم الأول من "الخدام" بنفس الاسم.`); return; }
        const updates: Record<string, string> = {};
        const notFound: string[] = [];
        Object.entries(GRADE2_PDF_PRESET).forEach(([key, list]) => {
            list.forEach(name => {
                const st = students.find(s => norm(s.name) === norm(name));
                if (st) updates[st.id] = servantIds[key]; else notFound.push(name);
            });
        });
        const count = Object.keys(updates).length;
        if (!window.confirm(`هيتطبّق توزيع تانية ثانوي بتاع الـPDF على ${count} ولد:\n• مينا رزق: ${GRADE2_PDF_PRESET.mina.length}\n• ناجي وليم: ${GRADE2_PDF_PRESET.nagy.length}\n• بولا ماهر: ${GRADE2_PDF_PRESET.bola.length}\n\nتكمل؟`)) return;
        setDoc(FOLLOWUP_DOC_REF(), { assignments: updates }, { merge: true })
            .then(() => showToast(notFound.length ? `✅ اتوزع ${count} ولد. مالقيتش: ${notFound.join('، ')}` : `✅ اتطبّق توزيع تانية ثانوي على ${count} ولد.`))
            .catch(err => { console.error(err); showToast('⚠️ فشل التوزيع، جرّب تاني.'); });
    };

    const runGroupDistribution = () => {
        if (!scopeCoversGrade(followupGrade)) return;
        const servants = admins.filter(a => followupAssignServants.includes(a.id));
        if (servants.length === 0) { showToast('اختار خادم واحد على الأقل.'); return; }
        const gradeStudents = students.filter(s => String(s.grade || '').trim() === followupGrade);
        const toAssign = gradeStudents.filter(s => followupReassignAll || !assignedServantId(s.id)).sort(byAbsence);
        if (toAssign.length === 0) { showToast('كل أولاد الصف ده ليهم خدام بالفعل.'); return; }
        if (followupReassignAll && !window.confirm(`هيتعاد توزيع كل أولاد ${followupGrade} (${toAssign.length} ولد) على: ${servants.map(a => a.name).join('، ')}.\n\nالمجموعات القديمة للصف ده هتتغير. تكمل؟`)) return;
        const load = Object.fromEntries(servants.map(a => [a.id, followupReassignAll ? 0 : gradeStudents.filter(s => assignedServantId(s.id) === a.id).length]));
        const updates: Record<string, any> = {};
        if (followupReassignAll) gradeStudents.forEach(s => { updates[s.id] = deleteField(); });
        let turn = 0;
        toAssign.forEach(s => {
            const order = servants.slice(turn).concat(servants.slice(0, turn));
            const pick = order.reduce((best, a) => (load[a.id] < load[best.id] ? a : best), order[0]);
            updates[s.id] = pick.id;
            load[pick.id]++;
            turn = (turn + 1) % servants.length;
        });
        setDoc(FOLLOWUP_DOC_REF(), { assignments: updates }, { merge: true })
            .then(() => { showToast(`✅ اتوزع ${toAssign.length} ولد من ${followupGrade} على ${servants.map(a => a.name).join('، ')}.`); setFollowupAssignPickerOpen(false); })
            .catch(err => { console.error(err); showToast('⚠️ فشل التوزيع، جرّب تاني.'); });
    };

    // ===== بداية سنة جديدة (للسوبر أدمن بس) =====
    const handleStartNewSeason = () => {
        if (!loggedInAdmin?.isSuperAdmin) return;
        const totalNow = students.reduce((n, s) => n + Math.max(0, Number(s.points) || 0), 0);
        const ok = window.confirm(
            `🔄 بداية سنة جديدة\n\n` +
            `اللي هيحصل:\n` +
            `• نقط السنة دي لكل ولد (${totalNow} نقطة لكل الأولاد) هتتنقل لـ"نقاط السنين السابقة"\n` +
            `• نقط السنة دي هتبقى صفر\n` +
            `• سجل الحضور والنقط هيتمسح عشان السنة الجديدة تبدأ نضيفة\n\n` +
            `⚠️ اتأكد إنك صرفت مكافآت أوائل الشهر اللي فات الأول.\n\n` +
            `هتتحمّل نسخة احتياطية كاملة على جهازك قبل أي حاجة. تكمل؟`
        );
        if (!ok) return;
        handleExportData();
        const typed = window.prompt('للتأكيد النهائي اكتب: سنة جديدة');
        if ((typed || '').trim() !== 'سنة جديدة') {
            showToast('اتلغى، ومحدش اتغير.');
            return;
        }
        const updated = students.map(s => {
            const { moneyOffset, customMoney, ...rest } = s;
            return {
                ...rest,
                previousYearsPoints: (Number(s.previousYearsPoints) || 0) + Math.max(0, Number(s.points) || 0),
                points: 0,
                attendanceHistory: [],
            };
        });
        saveStudentsData(updated);
        setAdminManagementModalOpen(false);
        showToast('🎉 بدأت سنة جديدة! النقط اتنقلت للسنين السابقة.');
    };

    // ===== تصدير سجل الحضور لملف Excel (للخدام والأدمنز) =====
    const ATTENDANCE_TYPES = ['early', 'late', 'monthlyMass'];
    const recordLabel = (h) => h?.typeName || h?.type || '';
    const exportMeetingToExcel = (dateKey) => {
        const sortAr = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar');
        const attended = students.filter(s => (s.attendanceHistory || []).some(h => h.date === dateKey && ATTENDANCE_TYPES.includes(h.type))).sort(sortAr);
        const attendedIds = new Set(attended.map(s => s.id));
        const absent = students.filter(s => !attendedIds.has(s.id)).sort(sortAr);
        const presentRows = [['م', 'الاسم', 'المرحلة الدراسية', 'رقم الموبايل', 'نوع الحضور', 'نقاط اليوم', 'التفاصيل']];
        attended.forEach((s, idx) => {
            const recs = (s.attendanceHistory || []).filter(h => h.date === dateKey);
            const att = recs.find(h => ATTENDANCE_TYPES.includes(h.type));
            presentRows.push([
                idx + 1, s.name || '', s.grade || '', s.phone || '', att ? recordLabel(att) : '',
                recs.filter(isActivityRecord).reduce((n, h) => n + Number(h.points || 0), 0),
                recs.map(h => `${recordLabel(h)} (${Number(h.points) > 0 ? '+' : ''}${Number(h.points || 0)})${h.description ? ' - ' + h.description : ''}`).join(' | '),
            ]);
        });
        const absentRows = [['م', 'الاسم', 'المرحلة الدراسية', 'رقم الموبايل']];
        absent.forEach((s, idx) => absentRows.push([idx + 1, s.name || '', s.grade || '', s.phone || '']));
        downloadBlob(buildXlsx([
            { name: `الحضور (${attended.length})`, rows: presentRows, widths: [5, 28, 16, 15, 16, 11, 60] },
            { name: `الغياب (${absent.length})`, rows: absentRows, widths: [5, 28, 16, 15] },
        ]), `حضور_${dateKey}.xlsx`);
        showToast('📥 تم تحميل ملف Excel');
    };
    const exportAllMeetingsToExcel = () => {
        const dates = meetingsStats.map(m => m.date).sort();
        const sortAr = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ar');
        const sorted = [...students].sort(sortAr);
        const summary = [['م', 'الاسم', 'المرحلة الدراسية', 'رقم الموبايل', ...dates, 'عدد مرات الحضور', 'نقاط السنة دي', 'نقاط السنين السابقة', 'المجموع الكلي']];
        sorted.forEach((s, idx) => {
            const hist = s.attendanceHistory || [];
            const marks = dates.map(d => hist.some(h => h.date === d && ATTENDANCE_TYPES.includes(h.type)) ? '✓' : '');
            summary.push([idx + 1, s.name || '', s.grade || '', s.phone || '', ...marks,
                marks.filter(Boolean).length, Number(s.points || 0), Number(s.previousYearsPoints || 0), getStudentTotalPoints(s)]);
        });
        const details = [['التاريخ', 'الاسم', 'المرحلة الدراسية', 'النوع', 'النقاط', 'التفاصيل', 'سجّله']];
        sorted.forEach(s => (s.attendanceHistory || []).forEach(h => {
            details.push([h.date || '', s.name || '', s.grade || '', recordLabel(h), Number(h.points || 0), h.description || '', h.recordedBy || '']);
        }));
        details.splice(1, details.length - 1, ...details.slice(1).sort((a, b) => String(b[0]).localeCompare(String(a[0])) || String(a[1]).localeCompare(String(b[1]), 'ar')));
        downloadBlob(buildXlsx([
            { name: 'ملخص الحضور', rows: summary, widths: [5, 28, 16, 15, ...dates.map(() => 12), 14, 13, 16, 13] },
            { name: 'كل السجلات', rows: details, widths: [12, 28, 16, 22, 9, 40, 16] },
        ]), `سجل_الحضور_${getCairoDateKey()}.xlsx`);
        showToast('📥 تم تحميل ملف Excel');
    };

    const { superAdmin, otherAdmins } = useMemo(() => {
        const superAdmin = admins.find(a => a.isSuperAdmin);
        const otherAdmins = admins.filter(a => !a.isSuperAdmin);
        return { superAdmin, otherAdmins };
    }, [admins]);

    // isAuthenticated = خادم كامل الصلاحيات (خادم الافتقاد بس بيتعامل كأنه زائر في باقي الموقع)
    const isAuthenticated = !!loggedInAdmin && !isFollowupOnlyAdmin(loggedInAdmin);
    const isSuperAdmin = loggedInAdmin?.isSuperAdmin;
    // صلاحيات "مينا" (المتجر، تعديل نقط السنين اللي فاتت، تنبيهات الأوسمة) للسوبر أدمن بس.
    // (قبل كده كانت بتتحدد من الاسم، فأي خادم اسمه فيه "مينا" زي "مينا معوض" كان بياخدها بالغلط.)
    const isMinaAdmin = useMemo(() => Boolean(loggedInAdmin && loggedInAdmin.isSuperAdmin), [loggedInAdmin]);

    // بث حالة دخول مينا لملف الهدايا (GiftsShop.tsx) المستقل - إضافة فقط، مش بتغيّر أي منطق موجود
    useEffect(() => {
        window.__isMinaAdmin = isMinaAdmin;
        window.dispatchEvent(new CustomEvent('mina-admin-status', { detail: isMinaAdmin }));
    }, [isMinaAdmin]);
    // أي خادم داخل: زرار الهدايا العايم (بتاع الأولاد) يستخبى عشان مايغطيش على الشاشة
    useEffect(() => {
        (window as any).__isServantLoggedIn = Boolean(loggedInAdmin);
        window.dispatchEvent(new CustomEvent('servant-login-status', { detail: Boolean(loggedInAdmin) }));
    }, [loggedInAdmin]);

    const [giftsPendingCount, setGiftsPendingCount] = useState(0);
    useEffect(() => {
        const handler = (e) => setGiftsPendingCount(e.detail || 0);
        window.addEventListener('gifts-pending-count', handler);
        return () => window.removeEventListener('gifts-pending-count', handler);
    }, []);

    const openMonthlyChampionModal = (preselectedStudentId = '', defaultRank = 'المركز الأول', defaultPts = '20', monthType = 'prev') => {
        setRewardTargetMonth(monthType);
        
        const basePrefix = monthType === 'prev' ? getCairoMonthPrefixOffset(-1) : getCairoMonthPrefix();
        const baseDate = new Date(`${basePrefix}-01T12:00:00Z`);
        const calcFirstFriday = getFirstFridayOfFollowingMonth(baseDate);
        const monthName = getArabicMonthNameFromPrefix(basePrefix).split(' ')[0];
        
        setRewardDate(calcFirstFriday);
        setRewardRankTitle(defaultRank);
        setRewardPoints(String(defaultPts));
        setRewardStudentId(preselectedStudentId);
        setRewardCustomDesc(`مكافأة ${defaultRank} عن شهر ${monthName}`);
        setMonthlyChampionModalOpen(true);
    };

    const handleGrantMonthlyChampionReward = () => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول لإضافة المكافأة.');
            return;
        }
        if (!rewardStudentId) {
            showToast('الرجاء اختيار الشاب المستحق للمكافأة.');
            return;
        }
        const pts = parseInt(rewardPoints, 10);
        if (isNaN(pts) || pts <= 0) {
            showToast('الرجاء إدخال عدد نقاط صحيح أكبر من الصفر.');
            return;
        }
        if (!rewardDate) {
            showToast('الرجاء تحديد تاريخ إضافة المكافأة.');
            return;
        }

        const targetStd = students.find(s => s.id === rewardStudentId);
        if (!targetStd) return;
        const rewardMonthPrefix = rewardTargetMonth === 'prev' ? getCairoMonthPrefixOffset(-1) : getCairoMonthPrefix();
        if ((targetStd.attendanceHistory || []).some(h => typeof h.meta === 'string' && h.meta.startsWith(`leaderboard_reward_${rewardMonthPrefix}_rank_`))) {
            showToast(`⚠️ ${targetStd.name} خد مكافأة ترتيب الشهر ده قبل كده.`);
            return;
        }

        const newRecord = {
            id: generateId(),
            date: rewardDate,
            points: pts,
            type: 'participation',
            typeName: 'مكافأة لوحة الصدارة',
            description: rewardCustomDesc || `مكافأة ${rewardRankTitle}`,
            recordedBy: loggedInAdmin.name,
            meta: `leaderboard_reward_${rewardTargetMonth === 'prev' ? getCairoMonthPrefixOffset(-1) : getCairoMonthPrefix()}_rank_${rewardRankTitle === 'المركز الأول' ? 1 : rewardRankTitle === 'المركز الثاني' ? 2 : 3}`
        };

        const updatedStudents = students.map(s => {
            if (s.id === rewardStudentId) {
                const history = s.attendanceHistory || [];
                return {
                    ...s,
                    points: (s.points || 0) + pts,
                    attendanceHistory: [newRecord, ...history]
                };
            }
            return s;
        });

        saveStudentsData(updatedStudents);
        setMonthlyChampionModalOpen(false);
        showToast(`🎉 تم منح مكافأة (${pts} نقطة) لـ ${targetStd.name} بنجاح!`);
    };

    const openBadgeRewardModal = (student, defaultPts = '15') => {
        setBadgeRewardStudent(student);
        setBadgeRewardPoints(String(defaultPts));
        setBadgeRewardDate(getCairoDateKey());
        const mName = getArabicMonthNameFromPrefix(getCairoMonthPrefix()).split(' ')[0];
        setBadgeRewardDesc(`مكافأة تجميع الأوسمة لشهر ${mName}`);
        setBadgeRewardModalOpen(true);
    };

    const handleGrantBadgeReward = () => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول لإضافة المكافأة.');
            return;
        }
        if (!badgeRewardStudent) return;
        
        const pts = parseInt(badgeRewardPoints, 10);
        if (isNaN(pts) || pts <= 0) {
            showToast('الرجاء إدخال عدد نقاط صحيح أكبر من الصفر.');
            return;
        }
        if (!badgeRewardDate) {
            showToast('الرجاء تحديد تاريخ إضافة المكافأة.');
            return;
        }

        const newRecord = {
            id: generateId(),
            date: badgeRewardDate,
            points: pts,
            type: 'participation',
            typeName: 'مكافأة تجميع الأوسمة',
            description: badgeRewardDesc || 'مكافأة تجميع الأوسمة الشهرية (يدوي)',
            recordedBy: loggedInAdmin.name,
            meta: `manual_badge_bonus_${generateId()}`
        };

        const updatedStudents = students.map(s => {
            if (s.id === badgeRewardStudent.id) {
                const history = s.attendanceHistory || [];
                return {
                    ...s,
                    points: (s.points || 0) + pts,
                    attendanceHistory: [newRecord, ...history]
                };
            }
            return s;
        });

        saveStudentsData(updatedStudents);
        setBadgeRewardModalOpen(false);
        showToast(`🎉 تم منح مكافأة الأوسمة (+${pts} نقطة) لـ ${badgeRewardStudent.name} بنجاح!`);
    };

    const openPointsEditModal = (studentFromView) => {
        // خد بيانات الولد الأصلية (مش النسخة المعروضة في لوحة الصدارة اللي فيها نقط الشهر بس)،
        // عشان الجنيهات تتحسب على الرصيد الحقيقي ومايتعملش تعديل جنيهات بالغلط
        const { pointsForLeaderboard, moneyBasePoints, ...rest } = studentFromView || {};
        const student = students.find(s => s.id === rest.id) || rest;
        setStudentForPointsEdit(student);
        const currentPts = student.points ?? 0;
        setTargetPointsInput(String(currentPts));
        setTargetMoneyInput(String(getStudentMoney(student)));
    };

    const handlePointsInputChange = (valStr) => {
        setTargetPointsInput(valStr);
    };

    const handleMoneyInputChange = (valStr) => {
        setTargetMoneyInput(valStr);
    };

    const handleSavePointsEdit = () => {
        if (!studentForPointsEdit) return;
        if (blockFollowupOnly()) return;
        
        const ptsVal = parseInt(targetPointsInput, 10);
        if (isNaN(ptsVal) || ptsVal < 0) {
            setToastMessage('⚠️ يرجى إدخال عدد نقاط صحيح (صفر أو أكثر)');
            setTimeout(() => setToastMessage(null), 3000);
            return;
        }

        const moneyVal = parseFloat(targetMoneyInput);
        if (isNaN(moneyVal) || moneyVal < 0) {
            setToastMessage('⚠️ يرجى إدخال مبلغ صحيح بالجنيه');
            setTimeout(() => setToastMessage(null), 3000);
            return;
        }

        const currentPts = studentForPointsEdit.points ?? 0;
        const diff = ptsVal - currentPts;

        const dateToRecord = selectedDate || getCairoDateKey();
        const newRecord = diff !== 0 ? {
            id: generateId(),
            date: dateToRecord,
            points: diff,
            type: 'manual',
            typeName: 'تعديل نقاط (مينا)',
            description: `تعديل رصيد النقاط والفلوس بواسطة الخادم ${loggedInAdmin.name}`,
            recordedBy: loggedInAdmin.name,
        } : null;

        const newPts = Math.max(0, currentPts + diff);
        // الجنيهات اللي اتكتبت في الخانة: لو هي نفس الحساب العادي للنقط الجديدة، يبقى مفيش تعديل يدوي
        const autoMoneyForOldPts = getBaseMoney(currentPts) + (Number(studentForPointsEdit.moneyOffset) || 0);
        const moneyUntouched = Math.round(moneyVal) === Math.round(autoMoneyForOldPts);
        const newOffset = moneyUntouched
            ? (Number(studentForPointsEdit.moneyOffset) || 0)   // مالمسش الجنيهات: سيب الفرق القديم زي ما هو
            : Math.round(moneyVal) - getBaseMoney(newPts);       // عدّلها يدوي: احفظ الفرق عن الحساب العادي

        const updatedList = students.map(s => {
            if (s.id === studentForPointsEdit.id) {
                const history = s.attendanceHistory || [];
                const { customMoney, moneyOffset, ...rest } = s;
                return {
                    ...rest,
                    points: Math.max(0, (s.points || 0) + diff),
                    ...(newOffset !== 0 ? { moneyOffset: newOffset } : {}),
                    attendanceHistory: newRecord ? [newRecord, ...history] : history
                };
            }
            return s;
        });
        saveStudentsData(updatedList);

        setToastMessage(`✨ تم تعديل رصيد ${studentForPointsEdit.name} إلى ${ptsVal} نقطة و (${Math.max(0, getBaseMoney(newPts) + newOffset)} جنيه) بنجاح!`);
        setTimeout(() => setToastMessage(null), 4000);
        setStudentForPointsEdit(null);
    };
    
    // تحديث التطبيق وتنظيف الكاش (بقى في صفحة الإدارة، وللزوار في الهيدر)
    const forceRefreshApp = async () => {
        try {
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(cacheNames.map(name => caches.delete(name)));
            }
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map(registration => registration.unregister()));
            }
            localStorage.setItem('church_attendance_app_version', APP_VERSION);
            window.location.reload();
        } catch (e) {
            console.error('Manual cache cleanup failed:', e);
            window.location.reload();
        }
    };

    // الأقسام: الرئيسية (الأولاد/الترتيب/الاجتماعات) — الافتقاد — الإدارة
    const HOME_VIEWS = ['students', 'leaderboard', 'attendance_summary'];
    const isFollowupOnlyUser = !!loggedInAdmin && !isAuthenticated;
    const currentSection = isFollowupOnlyUser ? 'followup'
        : activeView === 'followup' ? 'followup'
        : activeView === 'oversight' ? (canOversee ? 'oversight' : 'followup')
        : (activeView === 'admin' || activeView === 'badge_alerts') ? 'admin'
        : 'home';
    const goSection = (view) => { setActiveView(view); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    const adminAlertsCount = isSuperAdmin ? (pendingBadgesCount + giftsPendingCount) : 0;
    const todayKey = getCairoDateKey();

    return (
        <div className={`text-slate-100 min-h-screen p-4 md:p-8 ${isAuthenticated ? 'pb-32 md:pb-32' : ''}`}>
            <div className="max-w-4xl mx-auto">
                <header className="glass-panel flex justify-between items-center mb-5 px-4 py-3 rounded-2xl sticky top-2 z-30" style={{ top: 'max(8px, env(safe-area-inset-top, 0px))' }}>
                    <div>
                        <h1 className="text-2xl md:text-4xl font-black text-white tracking-wide">Points <span className="text-amber-300">ثانوي بنين</span></h1>
                        <p className="text-sm md:text-lg text-white/60 mt-0.5">اجتماع الأنبا رويس - كنيسة مارمينا</p>
                    </div>
                    <div className="flex items-center gap-2 md:gap-4">
                        {!isAuthenticated && (
                            <button
                                type="button"
                                onClick={forceRefreshApp}
                                className="glass-btn text-white w-10 h-10 rounded-full flex items-center justify-center"
                                title="تحديث التطبيق"
                                aria-label="تحديث التطبيق"
                            >
                                🔄
                            </button>
                        )}
                        {isAuthenticated ? (
                            <div className="text-left">
                                <span className="text-amber-400 font-semibold block text-sm md:text-base">مرحباً, {loggedInAdmin.name}</span>
                                 <button onClick={handleLogout} className="flex items-center gap-2 text-red-400 hover:text-red-300 font-bold py-1 rounded-lg transition-colors text-sm">
                                    <LogoutIcon className="w-4 h-4" />
                                    <span>خروج</span>
                                </button>
                            </div>
                        ) : (
                             <button onClick={openAuthModal} className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                               <LoginIcon className="w-5 h-5" />
                               <span className="hidden md:inline">دخول خدام</span>
                               <span className="md:hidden">دخول</span>
                            </button>
                        )}
                    </div>
                </header>
                
                {showInstallBtn && !isInstallDismissed && (
                    <div className="mb-6 bg-gradient-to-r from-amber-500/20 via-yellow-500/10 to-indigo-900/50 border border-amber-500/40 p-4 rounded-xl flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shadow-amber-950/20 relative overflow-hidden backdrop-blur-sm">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl pointer-events-none" />
                        <div className="flex items-center gap-3.5 rtl:text-right">
                            <div className="bg-amber-500/20 p-2.5 rounded-xl border border-amber-500/30 shrink-0">
                                <ArrowDownTrayIcon className="w-6 h-6 text-amber-400" />
                            </div>
                            <div>
                                <h4 className="font-black text-amber-300 text-sm md:text-base">
                                    {isIOSDevice ? 'تثبيت تطبيق Points على الـ iPhone! 📲' : 'تثبيت تطبيق Points على موبايلك! 📲'}
                                </h4>
                                <p className="text-xs text-indigo-200 mt-0.5">افتح التطبيق بنقرة واحدة من الشاشة الرئيسية، وسجل غياب وحضور الطلاب أسرع بكتير وبدون نت!</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0 justify-end">
                            <button 
                                onClick={handleInstallClick}
                                className="flex-1 md:flex-initial bg-amber-500 hover:bg-amber-600 text-indigo-950 font-black px-4 py-2 rounded-lg text-sm transition-all duration-200 flex items-center justify-center gap-1.5 shadow-md hover:shadow-amber-500/20 active:scale-95"
                            >
                                <ArrowDownTrayIcon className="w-4 h-4" />
                                <span>{isIOSDevice ? 'طريقة التثبيت' : 'تثبيت الآن'}</span>
                            </button>
                            <button 
                                onClick={handleDismissInstall}
                                className="p-2 text-indigo-300 hover:text-white hover:bg-indigo-800/30 rounded-lg transition-colors"
                                title="إغلاق"
                            >
                                <XMarkIcon className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                )}
                
                {isSuperAdmin && selectedDate !== todayKey && currentSection === 'home' && (
                    <div className="mb-4 glass-card border !border-amber-400/40 p-3 rounded-2xl flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-amber-300 text-sm font-bold">
                            <CalendarIcon className="w-5 h-5" />
                            <span>بتسجّل على يوم {selectedDate}</span>
                        </div>
                        <button onClick={() => setSelectedDate(todayKey)} className="text-xs font-black bg-amber-400 text-slate-900 px-3 py-1.5 rounded-full">رجّعه النهارده</button>
                    </div>
                )}
                
                <main>
                    {currentSection === 'home' && (
                        <div className="mb-5 glass-panel p-1 rounded-2xl grid grid-cols-3 gap-1">
                            {[
                                { v: 'students', label: `الأولاد (${students.length})`, icon: <UserGroupIcon className="w-5 h-5" /> },
                                { v: 'leaderboard', label: 'الترتيب', icon: <TrophyIcon className="w-5 h-5" /> },
                                { v: 'attendance_summary', label: 'الاجتماعات', icon: <CalendarIcon className="w-5 h-5" /> },
                            ].map(t => (
                                <button key={t.v} onClick={() => setActiveView(t.v)}
                                    className={`rounded-xl py-2 px-1 text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${activeView === t.v ? 'seg-active text-white' : 'text-white/60 hover:text-white'}`}>
                                    {t.icon}
                                    <span className="whitespace-nowrap">{t.label}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {!isFollowupOnlyUser && activeView === 'students' && (
                        <div>
                            {isAuthenticated && (
                                <button onClick={() => setAddStudentModalOpen(true)}
                                    className="w-full mb-3 glass-card rounded-2xl py-3 flex items-center justify-center gap-2 text-emerald-300 font-black active:scale-[0.98] transition">
                                    <UserPlusIcon className="w-5 h-5" />
                                    <span>إضافة ولد جديد</span>
                                </button>
                            )}
                            <div className="mb-6 relative">
                                <input
                                    type="text"
                                    placeholder="ابحث عن الاسم..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-indigo-900/70 text-white placeholder-indigo-300 border border-indigo-800/50 rounded-lg pr-4 pl-10 py-3 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                />
                                {searchTerm && (
                                    <button
                                        onClick={() => setSearchTerm('')}
                                        className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-white bg-indigo-900/50 rounded-full p-1 transition-colors"
                                        aria-label="مسح البحث"
                                    >
                                        <XIcon className="w-4 h-4" />
                                    </button>
                                )}
                            </div>

                            <div className="space-y-3">
                                {filteredStudents.map(student => {
                                    const hasAllMonthly = checkHasAllMonthlyBadges(student);
                                    return (
                                    <div key={student.id} id={`student-card-${student.id}`} className={`bg-indigo-900/70 rounded-xl shadow-md border overflow-hidden ${hasAllMonthly ? 'border-amber-400/80 shadow-amber-500/10 ring-1 ring-amber-400/20' : 'border-indigo-800/50'}`}>
                                        <div className="p-4 flex justify-between items-center cursor-pointer hover:bg-indigo-800/50 transition-colors" onClick={() => toggleStudentDetails(student.id)}>
                                            <div className='flex items-center gap-4 flex-wrap'>
                                                <div className="flex flex-col min-w-[124px] rounded-xl bg-indigo-950/60 border border-indigo-700/50 overflow-hidden text-center leading-tight">
                                                    <div className="px-2 pt-1.5 pb-1">
                                                        <div className="text-[10px] text-amber-200/80 font-bold">نقاط السنة دي</div>
                                                        <div className="text-amber-400 font-black text-2xl">{student.points || 0}</div>
                                                    </div>
                                                    <div className="px-2.5 py-1 border-t border-indigo-700/40 flex items-center justify-between gap-2">
                                                        <span className="text-[10px] text-sky-300/90 font-bold whitespace-nowrap">السنين السابقة</span>
                                                        <span className="text-sky-300 font-black text-sm">{student.previousYearsPoints || 0}</span>
                                                    </div>
                                                    <div className="px-2.5 py-1 bg-emerald-500/10 border-t border-emerald-400/30 flex items-center justify-between gap-2">
                                                        <span className="text-[10px] text-emerald-200 font-black whitespace-nowrap">المجموع الكلي</span>
                                                        <span className="text-emerald-300 font-black text-base">{getStudentTotalPoints(student)}</span>
                                                    </div>
                                                    {isMinaAdmin && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEditStudent(student);
                                                            }}
                                                            className="py-1 border-t border-indigo-700/40 text-[10px] text-amber-300 hover:text-amber-200 hover:bg-indigo-800/40 font-black"
                                                            title="تعديل نقاط السنين السابقة"
                                                        >
                                                            ✏️ تعديل السنين السابقة
                                                        </button>
                                                    )}
                                                </div>
                                                <span className="text-lg font-semibold flex items-center gap-2 flex-wrap">
                                                    <span>{student.name}</span>
                                                    {student.grade && (
                                                        <span className="inline-flex items-center gap-1 bg-sky-500/15 text-sky-300 border border-sky-400/30 font-black text-[10px] px-2 py-0.5 rounded-full shrink-0 select-none">
                                                            🎓 {student.grade}
                                                        </span>
                                                    )}
                                                    {hasAllMonthly && (
                                                        <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-indigo-950 font-black text-[10px] px-2 py-0.5 rounded-full shadow-md animate-pulse shrink-0 select-none">
                                                            ✨ بطل الشهر 👑
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-4">
                                                 {student.lastAttended === getCairoDateKey() && (
                                                    <span className="text-xs bg-green-500/20 text-green-300 px-2 py-1 rounded-full">حضر اليوم</span>
                                                )}
                                                <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform ${expandedStudentId === student.id ? 'rotate-180' : ''}`} />
                                            </div>
                                        </div>

                                        {expandedStudentId === student.id && (
                                            <div className="p-4 border-t border-indigo-800/50 bg-indigo-900/50">
                                                {isAuthenticated && (() => {
                                                    const list = visibleNotesOf(student);
                                                    return (
                                                        <button type="button" onClick={() => { setNotesStudentId(student.id); setNoteDraft(''); }}
                                                            className="w-full mb-4 flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2.5 text-right">
                                                            <span className="min-w-0 truncate text-sm text-white/85">{list[0] ? `📝 ${list[0].text}` : '📝 مفيش ملاحظات على الولد ده'}</span>
                                                            <span className="shrink-0 text-xs font-black text-amber-300">{list.length > 0 ? `الملاحظات (${list.length})` : '+ ملاحظة'}</span>
                                                        </button>
                                                    );
                                                })()}
                                                <div className="flex justify-between items-start mb-4">
                                                    <div className="space-y-2 w-full">
                                                        {/* Name Edit (Super Admin Only) */}
                                                        {editingStudent?.id === student.id ? (
                                                            <div className='space-y-2 bg-indigo-800 p-2 rounded border border-indigo-700'>
                                                                <div className="flex flex-col gap-1">
                                                                     <label className="text-xs text-indigo-300">الاسم:</label>
                                                                     <input 
                                                                        type="text"
                                                                        value={editingStudent.name}
                                                                        onChange={(e) => setEditingStudent({...editingStudent, name: e.target.value})}
                                                                        className="bg-indigo-700 text-white border border-indigo-600 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full"
                                                                        disabled={!isSuperAdmin}
                                                                     />
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                     <label className="text-xs text-indigo-300">الموبايل:</label>
                                                                     <input
                                                                        type="tel"
                                                                        value={editingStudent.phone}
                                                                        onChange={(e) => setEditingStudent({...editingStudent, phone: e.target.value})}
                                                                        className="bg-indigo-700 text-white border border-indigo-600 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full"
                                                                     />
                                                                </div>
                                                                <div className="flex flex-col gap-1">
                                                                     <label className="text-xs text-indigo-300">الصف الدراسي:</label>
                                                                     <select
                                                                        value={editingStudent.grade || ''}
                                                                        onChange={(e) => setEditingStudent({...editingStudent, grade: e.target.value})}
                                                                        className="bg-indigo-700 text-white border border-indigo-600 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full"
                                                                     >
                                                                        <option value="">بدون تحديد</option>
                                                                        <option value="أولى ثانوي">أولى ثانوي</option>
                                                                        <option value="تانية ثانوي">تانية ثانوي</option>
                                                                        <option value="تالتة ثانوي">تالتة ثانوي</option>
                                                                     </select>
                                                                </div>
                                                                {isMinaAdmin && (
                                                                    <div className="flex flex-col gap-1">
                                                                        <label className="text-xs text-amber-300 font-bold">نقاط السنين السابقة (مينا فقط):</label>
                                                                        <input
                                                                            type="number"
                                                                            min="0"
                                                                            step="1"
                                                                            value={editingStudent.previousYearsPoints ?? 0}
                                                                            onChange={(e) => setEditingStudent({...editingStudent, previousYearsPoints: e.target.value})}
                                                                            className="bg-indigo-700 text-white border border-amber-500/50 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500 w-full"
                                                                        />
                                                                    </div>
                                                                )}
                                                                <div className="flex justify-end gap-2 mt-2">
                                                                    <button onClick={() => handleSaveStudentEdit(student.id)} className="text-green-400 hover:text-green-300 p-1"><CheckIcon className="w-5 h-5"/></button>
                                                                    <button onClick={handleCancelEdit} className="text-red-400 hover:text-red-300 p-1"><XIcon className="w-5 h-5"/></button>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                     <span className="text-indigo-300 text-sm">رقم الموبايل:</span>
                                                                     <div className='flex items-center gap-2'>
                                                                         <span className="font-mono">{student.phone || 'لا يوجد'}</span>
                                                                         {isAuthenticated && (
                                                                            <button onClick={() => handleEditStudent(student)} className="text-gray-400 hover:text-white"><PencilIcon className="w-4 h-4"/></button>
                                                                         )}
                                                                     </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className='flex items-center gap-4 ml-4'>
                                                        {isAuthenticated && (
                                                            <button 
                                                                onClick={() => setStudentForBarcode(student)}
                                                                className="text-sky-400 hover:text-sky-300 transition-colors"
                                                                aria-label="عرض الباركود"
                                                            >
                                                                <BarcodeIcon className="w-6 h-6" />
                                                            </button>
                                                        )}
                                                        {student.phone && (
                                                            <a href={`https://wa.me/2${student.phone}`} target="_blank" rel="noopener noreferrer" className="text-green-400 hover:text-green-300">
                                                                <WhatsAppIcon className="w-6 h-6" />
                                                            </a>
                                                        )}
                                                    </div>
                                                </div>

                                                 {/* --- الأوسمة: دواير صغيرة، ودوس على أي واحدة تشوف تفاصيلها --- */}
                                                 {(() => {
                                                     const monthly = BADGES_CONFIG.filter(b => b.category === 'monthly').map(badge => ({
                                                         badge, isUnlocked: badge.check(student.attendanceHistory, student.points, getCairoMonthPrefix()),
                                                         progress: badge.getProgress(student.attendanceHistory, student.points, getCairoMonthPrefix()),
                                                     }));
                                                     const cumulative = BADGES_CONFIG.filter(b => b.category === 'cumulative').map(badge => ({
                                                         badge, isUnlocked: badge.check(student.attendanceHistory, student.points, undefined),
                                                         progress: badge.getProgress(student.attendanceHistory, student.points, undefined),
                                                     }));
                                                     const dot = ({ badge, isUnlocked, progress }) => (
                                                         <button key={badge.id} type="button" title={badge.name}
                                                             onClick={(e) => { e.stopPropagation(); setSelectedBadgeDetail({ ...badge, isUnlocked, progress }); }}
                                                             className={`relative w-10 h-10 rounded-full flex items-center justify-center text-lg border transition active:scale-90 ${isUnlocked ? 'bg-amber-400/20 border-amber-300/70 shadow-[0_0_10px_rgba(251,191,36,0.25)]' : 'bg-white/5 border-white/10 grayscale opacity-40'}`}>
                                                             {badge.emoji}
                                                             {isUnlocked && <span className="absolute -bottom-0.5 -left-0.5 w-4 h-4 rounded-full bg-emerald-500 text-[9px] text-white font-black flex items-center justify-center">✓</span>}
                                                         </button>
                                                     );
                                                     const mDone = monthly.filter(x => x.isUnlocked).length;
                                                     const cDone = cumulative.filter(x => x.isUnlocked).length;
                                                     return (
                                                         <div className="mt-4 pt-3 border-t border-indigo-800/50">
                                                             <div className="text-sm font-bold text-indigo-200 mb-2">🎖️ الأوسمة</div>
                                                             <div className="space-y-2">
                                                                 <div className="flex items-center gap-2">
                                                                     <div className="w-20 shrink-0 leading-tight">
                                                                         <div className="text-[11px] font-bold text-amber-200/90">الشهر ده</div>
                                                                         <div className={`text-[11px] font-black ${mDone === monthly.length ? 'text-amber-300' : 'text-white/50'}`}>{mDone}/{monthly.length}{mDone === monthly.length ? ' ✨' : ''}</div>
                                                                     </div>
                                                                     <div className="flex flex-wrap items-center gap-1.5">{monthly.map(dot)}</div>
                                                                 </div>
                                                                 <div className="flex items-center gap-2 pt-2 border-t border-white/10">
                                                                     <div className="w-20 shrink-0 leading-tight">
                                                                         <div className="text-[11px] font-bold text-sky-200/90">الألقاب</div>
                                                                         <div className="text-[11px] font-black text-white/50">{cDone}/{cumulative.length}</div>
                                                                     </div>
                                                                     <div className="flex flex-wrap items-center gap-1.5">{cumulative.map(dot)}</div>
                                                                 </div>
                                                             </div>
                                                         </div>
                                                     );
                                                 })()}

                                                 {isAuthenticated && (
                                                    <div className="pt-4 border-t border-indigo-800/50">
                                                        <h4 className="text-md font-semibold mb-3 text-indigo-200">إضافة نقاط يدوياً:</h4>
                                                        <PointActions student={student} addPoints={addPoints} selectedDate={isSuperAdmin ? selectedDate : null} isSuperAdmin={isSuperAdmin} />
                                                    </div>
                                                )}

                                                <div className="mt-4 pt-4 border-t border-indigo-800/50">
                                                    <div onClick={() => toggleHistoryDetails(student.id)} className="flex justify-between items-center cursor-pointer">
                                                        <h4 className="text-md font-semibold text-indigo-200">تفاصيل النقاط:</h4>
                                                        <ChevronDownIcon className={`w-5 h-5 text-gray-400 transition-transform ${visibleHistoryStudentId === student.id ? 'rotate-180' : ''}`} />
                                                    </div>
                                                    {visibleHistoryStudentId === student.id && (
                                                        <ul className="space-y-2 max-h-48 overflow-y-auto pr-2 mt-3">
                                                            {student.attendanceHistory && student.attendanceHistory.length > 0 ? 
                                                                [...student.attendanceHistory]
                                                                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Descending: Newest first
                                                                .map((record, index) => {
                                                                 const canDelete = isSuperAdmin || (loggedInAdmin && record.recordedBy === loggedInAdmin.name);
                                                                 return (
                                                                    <li key={record.id || index} className="bg-indigo-800/50 p-2 rounded-md text-sm">
                                                                        <div className="flex justify-between items-center">
                                                                            <div className="flex-grow">
                                                                                <div className="flex justify-between items-center">
                                                                                    <span>
                                                                                        <span className="text-indigo-400 ml-2 text-xs">({formatCairoDateKeyAr(record.date)})</span>
                                                                                        {record.typeName}
                                                                                    </span>
                                                                                    <span className={`font-bold ${record.points > 0 ? 'text-green-400' : 'text-red-400'}`}>{record.points > 0 ? `+${record.points}`: record.points}</span>
                                                                                </div>
                                                                                {record.description && (
                                                                                    <p className="text-indigo-300 text-xs mt-1 pr-4">{record.description}</p>
                                                                                )}
                                                                                {/* 'Recorded By' is visible ONLY to Super Admin */}
                                                                                {isSuperAdmin && record.recordedBy && (
                                                                                    <p className="text-indigo-400 text-xs mt-1 pr-4">بواسطة: {record.recordedBy}</p>
                                                                                )}
                                                                            </div>
                                                                            {canDelete && (
                                                                                <button 
                                                                                    onClick={() => handleDeletePointEntry(student.id, record)}
                                                                                    className="text-red-500 hover:text-red-400 p-1 ml-2 flex-shrink-0"
                                                                                    aria-label="حذف النقطة"
                                                                                >
                                                                                    <TrashIcon className="w-4 h-4"/>
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </li>
                                                                 );
                                                            }) : <p className="text-gray-500 text-sm text-center mt-2">لا يوجد سجل حضور بعد.</p>}
                                                        </ul>
                                                    )}
                                                </div>
                                                 
                                                {isAuthenticated && (
                                                    <div className="mt-4 pt-4 border-t border-indigo-800/50">
                                                        <button 
                                                            onClick={() => handleDeleteStudent(student.id)}
                                                            className="w-full flex items-center justify-center gap-2 bg-red-600/80 hover:bg-red-600 text-white font-bold py-2 px-3 rounded-lg transition-colors"
                                                        >
                                                            <TrashIcon className="w-5 h-5" />
                                                            <span>حذف الشاب</span>
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {!isFollowupOnlyUser && activeView === 'leaderboard' && (
                         <div className="space-y-4 animate-fade-in-out">
                             {/* Admin Manual Rewards Bar */}
                             {isAuthenticated && (
                                 <div className="flex flex-wrap gap-3 items-center justify-between bg-gradient-to-r from-indigo-950/90 via-indigo-900/80 to-indigo-950/90 p-3.5 rounded-2xl border border-amber-400/40 shadow-lg">
                                     <div className="flex items-center gap-3">
                                         <span className="text-2xl">🏆</span>
                                         <div>
                                             <h4 className="text-sm md:text-base font-black text-amber-300">مكافآت بطل الشهر والأوسمة (يدوياً)</h4>
                                             <p className="text-xs text-indigo-200">تحكم كامل في إضافة مكافأة الأول في الشهر (في أول جمعة) وتجميع الأوسمة</p>
                                         </div>
                                     </div>
                                     <button
                                         onClick={() => {
                                             const topStudent = leaderboardStudents[0];
                                             openMonthlyChampionModal(topStudent ? topStudent.id : '', 'المركز الأول', '20', leaderboardFilter === 'prev_month' ? 'prev' : 'current');
                                         }}
                                         className="bg-gradient-to-r from-amber-400 via-amber-500 to-yellow-600 hover:from-amber-300 hover:to-yellow-500 text-indigo-950 font-black text-xs md:text-sm px-4 py-2.5 rounded-xl flex items-center gap-2 shadow-md transition-all active:scale-95 border border-amber-300"
                                     >
                                         <span className="text-base">🎁</span>
                                         <span>منح مكافأة المركز الأول / بطل الشهر</span>
                                     </button>
                                 </div>
                             )}
                             {/* Leaderboard Month filter */}
                             <div className="flex gap-2 p-1.5 rounded-xl bg-indigo-950/60 border border-indigo-800/40 overflow-x-auto">
                                 <button
                                     onClick={() => setLeaderboardFilter('all')}
                                     className={`flex-1 min-w-[90px] text-center py-2 px-3 rounded-lg text-xs md:text-sm font-bold transition-all ${leaderboardFilter === 'all' ? 'bg-indigo-700 text-amber-400 font-extrabold shadow-md shadow-indigo-900/60' : 'text-indigo-300 hover:text-white hover:bg-indigo-800/20'}`}
                                 >
                                     الكل (تراكمي)
                                 </button>
                                 <button
                                     onClick={() => setLeaderboardFilter('current_month')}
                                     className={`flex-1 min-w-[120px] text-center py-2 px-3 rounded-lg text-xs md:text-sm font-bold transition-all ${leaderboardFilter === 'current_month' ? 'bg-indigo-700 text-amber-400 font-extrabold shadow-md shadow-indigo-900/60' : 'text-indigo-300 hover:text-white hover:bg-indigo-800/20'}`}
                                 >
                                     الشهر الحالي ({getArabicMonthNameFromPrefix(getCairoMonthPrefix()).split(' ')[0]})
                                 </button>
                                 <button
                                     onClick={() => setLeaderboardFilter('prev_month')}
                                     className={`flex-1 min-w-[120px] text-center py-2 px-3 rounded-lg text-xs md:text-sm font-bold transition-all ${leaderboardFilter === 'prev_month' ? 'bg-indigo-700 text-amber-400 font-extrabold shadow-md shadow-indigo-900/60' : 'text-indigo-300 hover:text-white hover:bg-indigo-800/20'}`}
                                 >
                                     الشهر السابق ({getArabicMonthNameFromPrefix(getCairoMonthPrefixOffset(-1)).split(' ')[0]})
                                 </button>
                             </div>

                             {leaderboardStudents.length === 0 ? (
                                 <p className="text-center text-indigo-300 mt-10">لا يوجد بيانات لعرضها في هذه التصفية.</p>
                             ) : (
                                 leaderboardStudents.map((student, index) => {
                                     // المتساويين في النقط بياخدوا نفس المركز (الأول، الثاني، الثاني، الثالث...)
                                     const rank = 1 + new Set(
                                         leaderboardStudents
                                             .map(s => Number(s.pointsForLeaderboard || 0))
                                             .filter(p => p > Number(student.pointsForLeaderboard || 0))
                                     ).size;
                                     const currentMonthPrefix = getCairoMonthPrefix();
                                     const prevMonthPrefix = getCairoMonthPrefixOffset(-1);
                                     const filterPrefix = leaderboardFilter === 'prev_month' ? prevMonthPrefix : (leaderboardFilter === 'current_month' ? currentMonthPrefix : undefined);

                                     const studentBadges = BADGES_CONFIG.filter(b => {
                                          if (leaderboardFilter === 'all') {
                                              return b.category === 'cumulative' && b.check(student.attendanceHistory, student.points, undefined);
                                          } else {
                                              return b.category === 'monthly' && b.check(student.attendanceHistory, student.points, filterPrefix);
                                          }
                                      });

                                     if (rank === 1) {
                                         return (
                                             <div key={student.id} className="p-5 flex justify-between items-center rounded-2xl border-2 border-amber-400 bg-gradient-to-br from-amber-400/30 via-amber-500/10 to-indigo-900/70 shadow-2xl shadow-amber-400/20 transform scale-[1.02] md:scale-105 transition-transform duration-200">
                                                 <div className="flex items-center gap-4">
                                                     <span className="text-4xl">🥇</span>
                                                     <div>
                                                         <div className="flex items-center gap-2 flex-wrap">
                                                            <CrownIcon className="w-5 h-5 text-amber-300 shrink-0" />
                                                             <span className="text-lg md:text-xl font-bold text-white flex items-center gap-2 flex-wrap">
                                                                <span>{student.name}</span>
                                                                {checkHasAllMonthlyBadges(student) && (
                                                                    <span className="inline-flex items-center gap-1.5 shrink-0">
                                                                        <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-indigo-950 font-black text-[9px] px-1.5 py-0.5 rounded-full shadow border border-amber-300 select-none">
                                                                            ✨ بطل الشهر
                                                                        </span>
                                                                        {isAuthenticated && (
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    openBadgeRewardModal(student, '15');
                                                                                }}
                                                                                className="inline-flex items-center gap-1 bg-purple-500/30 hover:bg-purple-500/50 text-purple-200 border border-purple-400/40 font-bold text-[9px] px-2 py-0.5 rounded-full transition-all"
                                                                                title="منح مكافأة تجميع الأوسمة يدويًا"
                                                                            >
                                                                                <span>🎖️</span>
                                                                                <span>مكافأة الأوسمة</span>
                                                                            </button>
                                                                        )}
                                                                    </span>
                                                                )}
                                                             </span>
                                                         </div>
                                                         <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                                                             <span className="text-xs text-amber-200">المركز الأول</span>
                                                             {studentBadges.map(b => (
                                                                 <span 
                                                                     key={b.id} 
                                                                     title={`${b.name}: ${b.description}`} 
                                                                     className="text-sm cursor-pointer hover:scale-125 transition-transform shrink-0"
                                                                     onClick={(e) => {
                                                                         e.stopPropagation();
                                                                         setSelectedBadgeDetail({
                                                                             ...b,
                                                                             isUnlocked: true,
                                                                             progress: b.getProgress(student.attendanceHistory, student.points, filterPrefix)
                                                                         });
                                                                     }}
                                                                 >
                                                                     {b.emoji}
                                                                 </span>
                                                             ))}
                                                         </div>
                                                     </div>
                                                 </div>
                                                 <div className="text-right">
                                                     <div className="text-amber-300 font-black text-2xl md:text-3xl">
                                                         {student.pointsForLeaderboard || 0}
                                                     </div>
                                                     <div className="text-amber-200/80 text-xs md:text-sm font-bold">
                                                         = {getStudentMoney(student)} جنيه
                                                     </div>
                                                      <div className="flex flex-col gap-1 mt-1 mr-auto">
                                                           {isAuthenticated && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openMonthlyChampionModal(student.id, 'المركز الأول', '20', leaderboardFilter === 'prev_month' ? 'prev' : 'current');
                                                                   }}
                                                                   className="text-[11px] font-black text-amber-950 bg-gradient-to-r from-amber-300 to-yellow-400 hover:from-amber-200 hover:to-yellow-300 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm active:scale-95"
                                                                   title="منح مكافأة المركز الأول للشهر (تضاف في أول جمعة)"
                                                               >
                                                                   <span>🎁</span>
                                                                   <span>مكافأة الأول (+20)</span>
                                                               </button>
                                                           )}
                                                           {isMinaAdmin && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openPointsEditModal(student);
                                                                   }}
                                                                   className="text-[11px] font-bold text-amber-300 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm"
                                                                   title="تعديل نقاط الشاب والفلوس (مينا فقط)"
                                                               >
                                                                   <PencilIcon className="w-3 h-3" />
                                                                   <span>تعديل (مينا)</span>
                                                               </button>
                                                           )}
                                                       </div>
                                                 </div>
                                             </div>
                                         );
                                     }

                                     if (rank === 2) {
                                          return (
                                              <div key={student.id} className="p-4 flex justify-between items-center rounded-xl border-2 border-slate-300 bg-gradient-to-br from-slate-300/30 via-slate-400/10 to-indigo-900/70 shadow-xl shadow-slate-400/20">
                                                 <div className="flex items-center gap-4">
                                                     <span className="text-3xl">🥈</span>
                                                     <div>
                                                         <span className="text-base md:text-lg font-semibold text-slate-100 flex items-center gap-2 flex-wrap">
                                                              <span>{student.name}</span>
                                                              {checkHasAllMonthlyBadges(student) && (
                                                                  <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-indigo-950 font-black text-[9px] px-1.5 py-0.5 rounded-full shadow border border-amber-300 shrink-0 select-none">
                                                                      ✨ بطل  الشهر
                                                                  </span>
                                                              )}
                                                          </span>
                                                         <div className="flex flex-wrap gap-1.5 mt-0.5 items-center">
                                                             <span className="text-xs text-slate-300">المركز الثاني</span>
                                                             {studentBadges.map(b => (
                                                                 <span 
                                                                     key={b.id} 
                                                                     title={`${b.name}: ${b.description}`} 
                                                                     className="text-sm cursor-pointer hover:scale-125 transition-transform shrink-0"
                                                                     onClick={(e) => {
                                                                         e.stopPropagation();
                                                                         setSelectedBadgeDetail({
                                                                             ...b,
                                                                             isUnlocked: true,
                                                                             progress: b.getProgress(student.attendanceHistory, student.points, filterPrefix)
                                                                         });
                                                                     }}
                                                                 >
                                                                     {b.emoji}
                                                                 </span>
                                                             ))}
                                                         </div>
                                                     </div>
                                                 </div>
                                                 <div className="text-right">
                                                     <div className="text-slate-200 font-bold text-xl md:text-2xl">
                                                         {student.pointsForLeaderboard || 0}
                                                     </div>
                                                     <div className="text-slate-300/80 text-xs font-bold">
                                                         = {getStudentMoney(student)} جنيه
                                                     </div>
                                                      <div className="flex flex-col gap-1 mt-1 mr-auto">
                                                           {isAuthenticated && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openMonthlyChampionModal(student.id, 'المركز الثاني', '15', leaderboardFilter === 'prev_month' ? 'prev' : 'current');
                                                                   }}
                                                                   className="text-[11px] font-bold text-slate-900 bg-slate-200 hover:bg-white px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm active:scale-95"
                                                                   title="منح مكافأة المركز الثاني للشهر (تضاف في أول جمعة)"
                                                               >
                                                                   <span>🎁</span>
                                                                   <span>مكافأة الثاني (+15)</span>
                                                               </button>
                                                           )}
                                                           {isMinaAdmin && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openPointsEditModal(student);
                                                                   }}
                                                                   className="text-[11px] font-bold text-amber-300 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm"
                                                                   title="تعديل نقاط الشاب والفلوس (مينا فقط)"
                                                               >
                                                                   <PencilIcon className="w-3 h-3" />
                                                                   <span>تعديل (مينا)</span>
                                                               </button>
                                                           )}
                                                       </div>
                                                 </div>
                                             </div>
                                         );
                                     }

                                     if (rank === 3) {
                                          return (
                                              <div key={student.id} className="p-4 flex justify-between items-center rounded-xl border-2 border-orange-500 bg-gradient-to-br from-orange-500/30 via-orange-600/10 to-indigo-900/70 shadow-lg shadow-orange-600/20">
                                                 <div className="flex items-center gap-4">
                                                     <span className="text-3xl">🥉</span>
                                                     <div>
                                                        <span className="text-base md:text-lg font-semibold text-orange-100 flex items-center gap-2 flex-wrap">
                                                            <span>{student.name}</span>
                                                            {checkHasAllMonthlyBadges(student) && (
                                                                <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-indigo-950 font-black text-[9px] px-1.5 py-0.5 rounded-full shadow border border-amber-300 shrink-0 select-none">
                                                                    ✨ بطل الشهر
                                                                </span>
                                                            )}
                                                         </span>
                                                        <div className="flex flex-wrap gap-1.5 mt-0.5 items-center">
                                                            <span className="text-xs text-orange-200">المركز الثالث</span>
                                                            {studentBadges.map(b => (
                                                                <span 
                                                                    key={b.id} 
                                                                    title={`${b.name}: ${b.description}`} 
                                                                    className="text-sm cursor-pointer hover:scale-125 transition-transform shrink-0"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setSelectedBadgeDetail({
                                                                            ...b,
                                                                            isUnlocked: true,
                                                                            progress: b.getProgress(student.attendanceHistory, student.points, filterPrefix)
                                                                        });
                                                                    }}
                                                                >
                                                                    {b.emoji}
                                                                </span>
                                                            ))}
                                                        </div>
                                                     </div>
                                                 </div>
                                                 <div className="text-right">
                                                     <div className="text-orange-200 font-bold text-xl md:text-2xl">
                                                         {student.pointsForLeaderboard || 0}
                                                     </div>
                                                     <div className="text-orange-200/80 text-xs font-bold">
                                                         = {getStudentMoney(student)} جنيه
                                                     </div>
                                                      <div className="flex flex-col gap-1 mt-1 mr-auto">
                                                           {isAuthenticated && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openMonthlyChampionModal(student.id, 'المركز الثالث', '10', leaderboardFilter === 'prev_month' ? 'prev' : 'current');
                                                                   }}
                                                                   className="text-[11px] font-bold text-orange-950 bg-orange-300 hover:bg-orange-200 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm active:scale-95"
                                                                   title="منح مكافأة المركز الثالث للشهر (تضاف في أول جمعة)"
                                                               >
                                                                   <span>🎁</span>
                                                                   <span>مكافأة الثالث (+10)</span>
                                                               </button>
                                                           )}
                                                           {isMinaAdmin && (
                                                               <button
                                                                   onClick={(e) => {
                                                                       e.stopPropagation();
                                                                       openPointsEditModal(student);
                                                                   }}
                                                                   className="text-[11px] font-bold text-amber-300 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all shadow-sm"
                                                                   title="تعديل نقاط الشاب والفلوس (مينا فقط)"
                                                               >
                                                                   <PencilIcon className="w-3 h-3" />
                                                                   <span>تعديل (مينا)</span>
                                                               </button>
                                                           )}
                                                       </div>
                                                 </div>
                                             </div>
                                         );
                                     }
                                     
                                     // Ranks 4 and below
                                     return (
                                         <div key={student.id} className="p-3 pl-4 flex justify-between items-center rounded-lg bg-indigo-900/70 border border-indigo-800/50 hover:bg-indigo-805/90 transition-colors">
                                             <div className="flex items-center gap-4">
                                                 <span className="text-sm md:text-base font-mono text-indigo-300 w-8 text-center">{rank}</span>
                                                 <div>
                                                     <span className="font-medium text-white text-sm md:text-base flex items-center gap-2 flex-wrap">
                                                      <span>{student.name}</span>
                                                      {checkHasAllMonthlyBadges(student) && (
                                                          <span className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-400 to-yellow-500 text-indigo-950 font-black text-[9px] px-1.5 py-0.5 rounded-full shadow border border-amber-300 shrink-0 select-none">
                                                              ✨ بطل الشهر
                                                          </span>
                                                      )}
                                                   </span>
                                                     <div className="flex flex-wrap gap-1 mt-0.5">
                                                         {studentBadges.map(b => (
                                                             <span 
                                                                 key={b.id} 
                                                                 title={`${b.name}: ${b.description}`} 
                                                                 className="text-xs cursor-pointer hover:scale-125 transition-transform shrink-0"
                                                                 onClick={(e) => {
                                                                     e.stopPropagation();
                                                                     setSelectedBadgeDetail({
                                                                         ...b,
                                                                         isUnlocked: true,
                                                                         progress: b.getProgress(student.attendanceHistory, student.points, filterPrefix)
                                                                     });
                                                                 }}
                                                             >
                                                                 {b.emoji}
                                                             </span>
                                                         ))}
                                                     </div>
                                                 </div>
                                             </div>
                                             <div className="text-right">
                                                 <div className="text-amber-400 font-semibold text-base md:text-lg">
                                                     {student.pointsForLeaderboard || 0}
                                                 </div>
                                                 <div className="text-indigo-400 text-xs">
                                                     = {getStudentMoney(student)} جنيه
                                                 </div>
                                                      {isMinaAdmin && (
                                                          <button
                                                              onClick={(e) => {
                                                                  e.stopPropagation();
                                                                  openPointsEditModal(student);
                                                              }}
                                                              className="mt-1.5 text-[11px] font-bold text-amber-300 hover:text-amber-100 bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/40 px-2 py-0.5 rounded-md flex items-center justify-center gap-1 transition-all mr-auto shadow-sm"
                                                              title="تعديل نقاط الشاب والفلوس (مينا فقط)"
                                                          >
                                                              <PencilIcon className="w-3 h-3" />
                                                              <span>تعديل (مينا)</span>
                                                          </button>
                                                      )}
                                             </div>
                                         </div>
                                     );
                                 })
                             )}
                         </div>
                     )}{activeView === 'badge_alerts' && isMinaAdmin && (
                        <div className="space-y-6 animate-fade-in-out font-sans text-right" dir="rtl">
                            {/* --- Overview Metrics Bar --- */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                                <div className="bg-gradient-to-br from-indigo-900/60 to-indigo-950/80 p-4 rounded-2xl border border-indigo-800/60 flex items-center justify-between shadow-md">
                                    <div>
                                        <p className="text-xs font-bold text-indigo-300">إجمالي الأوسمة والإنجازات</p>
                                        <h4 className="text-2xl font-black text-white mt-1">{allBadgeAlerts.length}</h4>
                                    </div>
                                    <div className="p-3 bg-indigo-800/40 rounded-xl border border-indigo-700/50 text-2xl">
                                        🎖️
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-amber-950/50 via-slate-900/90 to-indigo-950/80 p-4 rounded-2xl border-2 border-amber-500/50 flex items-center justify-between shadow-md shadow-amber-950/20">
                                    <div>
                                        <p className="text-xs font-bold text-amber-300">⚠️ بانتظار إضافة النقاط</p>
                                        <h4 className="text-2xl font-black text-amber-400 mt-1">{pendingBadgesCount} مستحق</h4>
                                    </div>
                                    <div className="p-3 bg-amber-500/20 rounded-xl border border-amber-500/40 text-2xl animate-pulse">
                                        ⏳
                                    </div>
                                </div>

                                <div className="bg-gradient-to-br from-emerald-950/50 via-slate-900/90 to-indigo-950/80 p-4 rounded-2xl border border-emerald-500/50 flex items-center justify-between shadow-md">
                                    <div>
                                        <p className="text-xs font-bold text-emerald-300">✅ تم منح النقاط لها</p>
                                        <h4 className="text-2xl font-black text-emerald-400 mt-1">{allBadgeAlerts.length - pendingBadgesCount} مكتمل</h4>
                                    </div>
                                    <div className="p-3 bg-emerald-500/20 rounded-xl border border-emerald-500/40 text-2xl">
                                        🎉
                                    </div>
                                </div>
                            </div>

                            {/* --- Search & Filters Bar --- */}
                            <div className="bg-indigo-950/80 p-4 rounded-2xl border border-indigo-800/60 space-y-3.5 backdrop-blur-sm">
                                <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
                                    <div className="relative w-full sm:w-80">
                                        <input
                                            type="text"
                                            placeholder="ابحث بالاسم أو اسم الوسام..."
                                            value={badgeAlertSearch}
                                            onChange={(e) => setBadgeAlertSearch(e.target.value)}
                                            className="w-full bg-indigo-900/70 text-white placeholder-indigo-400 text-sm border border-indigo-800 rounded-xl pr-3.5 pl-9 py-2.5 focus:outline-none focus:border-amber-400"
                                        />
                                        {badgeAlertSearch && (
                                            <button
                                                onClick={() => setBadgeAlertSearch('')}
                                                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                                            >
                                                <XIcon className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="text-xs text-indigo-300 font-medium">
                                        عرض <span className="font-bold text-amber-300">{filteredBadgeAlerts.length}</span> من أصل <span className="font-bold text-white">{allBadgeAlerts.length}</span> إنجاز
                                    </div>
                                </div>

                                {/* Filter Buttons */}
                                <div className="flex flex-wrap gap-2 pt-1 border-t border-indigo-900/60">
                                    <button
                                        onClick={() => setBadgeAlertsFilter('all')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            badgeAlertsFilter === 'all'
                                                ? 'bg-amber-500 text-indigo-950 shadow-sm'
                                                : 'bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800/60'
                                        }`}
                                    >
                                        الكل ({allBadgeAlerts.length})
                                    </button>

                                    <button
                                        onClick={() => setBadgeAlertsFilter('pending')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                            badgeAlertsFilter === 'pending'
                                                ? 'bg-gradient-to-r from-amber-500 to-yellow-500 text-indigo-950 shadow-md font-black'
                                                : 'bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30'
                                        }`}
                                    >
                                        <span>⚠️ بانتظار إضافة النقاط</span>
                                        <span className="bg-amber-950/60 text-amber-200 px-1.5 py-0.2 rounded-full text-[10px]">
                                            {pendingBadgesCount}
                                        </span>
                                    </button>

                                    <button
                                        onClick={() => setBadgeAlertsFilter('awarded')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                                            badgeAlertsFilter === 'awarded'
                                                ? 'bg-emerald-600 text-white shadow-md'
                                                : 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 border border-emerald-500/30'
                                        }`}
                                    >
                                        <span>✅ تم منح النقاط</span>
                                        <span className="bg-emerald-950/60 text-emerald-200 px-1.5 py-0.2 rounded-full text-[10px]">
                                            {allBadgeAlerts.length - pendingBadgesCount}
                                        </span>
                                    </button>

                                    <button
                                        onClick={() => setBadgeAlertsFilter('monthly')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            badgeAlertsFilter === 'monthly'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800/60'
                                        }`}
                                    >
                                        🌟 أوسمة شهرية
                                    </button>

                                    <button
                                        onClick={() => setBadgeAlertsFilter('cumulative')}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                            badgeAlertsFilter === 'cumulative'
                                                ? 'bg-indigo-600 text-white shadow-sm'
                                                : 'bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800/60'
                                        }`}
                                    >
                                        🏆 أوسمة تراكمية وموسمية
                                    </button>
                                </div>
                            </div>

                            {/* --- Alerts Cards Grid --- */}
                            {filteredBadgeAlerts.length === 0 ? (
                                <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-2xl p-12 text-center text-indigo-300 space-y-3">
                                    <div className="text-4xl">🎖️✨</div>
                                    <h4 className="text-lg font-bold text-white">لا توجد تنبيهات تطابق البحث أو الفلتر المحدد</h4>
                                    <p className="text-xs text-indigo-400">ستظهر هنا أي أوسمة جديدة يحصل عليها الشباب تلقائياً لمتابعتها وإضافة نقاطها بضغطة زر.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {filteredBadgeAlerts.map(alert => {
                                        const isAwarded = alert.isAwarded;
                                        return (
                                            <div
                                                key={alert.id}
                                                className={`rounded-2xl p-4 md:p-5 transition-all duration-300 relative overflow-hidden flex flex-col justify-between ${
                                                    isAwarded
                                                        ? 'bg-gradient-to-br from-emerald-950/70 via-slate-900/90 to-teal-950/80 border-2 border-emerald-500/70 shadow-md shadow-emerald-950/20'
                                                        : 'bg-gradient-to-br from-amber-950/80 via-slate-900/95 to-indigo-950/90 border-2 border-amber-500/80 shadow-xl shadow-amber-950/30'
                                                }`}
                                            >
                                                {/* Card Background Glow */}
                                                <div 
                                                    className={`absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl pointer-events-none opacity-20 ${
                                                        isAwarded ? 'bg-emerald-400' : 'bg-amber-400'
                                                    }`} 
                                                />

                                                <div>
                                                    {/* Top Bar: Student Name & Status Badge */}
                                                    <div className="flex items-start justify-between gap-3 mb-3">
                                                        <div className="flex items-center gap-2.5">
                                                            <div className="w-10 h-10 rounded-xl bg-indigo-900/80 border border-indigo-700 flex items-center justify-center text-xl shrink-0 shadow-inner">
                                                                {alert.badgeEmoji}
                                                            </div>
                                                            <div>
                                                                <h4 className="font-black text-white text-base hover:text-amber-300 transition-colors cursor-pointer"
                                                                    onClick={() => {
                                                                        const targetStd = students.find(s => s.id === alert.studentId);
                                                                        if (targetStd) {
                                                                            setStudentForAttendance(targetStd);
                                                                        }
                                                                    }}
                                                                >
                                                                    {alert.studentName}
                                                                </h4>
                                                                <span className="text-[11px] text-indigo-300 font-medium">
                                                                    {alert.categoryLabel} • {alert.periodLabel}
                                                                </span>
                                                            </div>
                                                        </div>

                                                        {/* Status Pill with Color Shift */}
                                                        <div>
                                                            {isAwarded ? (
                                                                <div className="bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm shrink-0">
                                                                    <span>✅</span>
                                                                    <span>تمت الإضافة (+{alert.awardedRecord?.points || alert.suggestedPoints} نقطة)</span>
                                                                </div>
                                                            ) : (
                                                                <div className="bg-amber-500/20 text-amber-300 border border-amber-500/60 text-[11px] font-black px-2.5 py-1 rounded-full flex items-center gap-1 shadow-sm shrink-0 animate-pulse">
                                                                    <span>⚠️</span>
                                                                    <span>بانتظار النقاط (+{alert.suggestedPoints})</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Badge Details & Criteria */}
                                                    <div className="bg-indigo-950/70 p-3 rounded-xl border border-indigo-900/60 mb-4 space-y-1.5">
                                                        <div className="flex items-center justify-between text-xs font-bold text-amber-300">
                                                            <span>{alert.badgeTitle}</span>
                                                            <span className="text-[11px] font-mono text-indigo-300 bg-indigo-900/80 px-2 py-0.5 rounded-md">
                                                                {alert.progress}
                                                            </span>
                                                        </div>
                                                        <p className="text-xs text-indigo-200/90 leading-relaxed">
                                                            {alert.description}
                                                        </p>
                                                    </div>

                                                    {/* History Info if Awarded */}
                                                    {isAwarded && alert.awardedRecord && (
                                                        <div className="text-[11px] text-emerald-300/90 bg-emerald-950/40 border border-emerald-800/40 p-2 rounded-lg mb-3 flex items-center justify-between">
                                                            <span>📅 تاريخ الإضافة: {alert.awardedRecord.date}</span>
                                                            <span>👤 الخادم: {alert.awardedRecord.recordedBy || 'مسجل'}</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Action Bar */}
                                                <div className="pt-2 border-t border-indigo-900/60 flex items-center gap-2">
                                                    {!isAwarded ? (
                                                        <>
                                                            <button
                                                                onClick={() => handleQuickAwardBadgePoints(alert)}
                                                                className="flex-1 bg-gradient-to-r from-amber-400 to-yellow-500 hover:from-amber-300 hover:to-yellow-400 text-indigo-950 font-black py-2 px-3 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95"
                                                                title="إضافة سريعة لنقاط المكافأة"
                                                            >
                                                                <span>⚡</span>
                                                                <span>إضافة المكافأة الآن (+{alert.suggestedPoints} نقطة)</span>
                                                            </button>

                                                            <button
                                                                onClick={() => {
                                                                    const std = students.find(s => s.id === alert.studentId);
                                                                    if (std) {
                                                                        openBadgeRewardModal(std, String(alert.suggestedPoints));
                                                                    }
                                                                }}
                                                                className="bg-indigo-900/80 hover:bg-indigo-800 text-indigo-200 hover:text-white font-bold py-2 px-3 rounded-xl text-xs border border-indigo-700 transition-colors"
                                                                title="تخصيص النقاط والتاريخ"
                                                            >
                                                                ⚙️ تخصيص
                                                            </button>
                                                        </>
                                                    ) : (
                                                        <div className="w-full flex items-center justify-between">
                                                            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1">
                                                                <span>🎉</span>
                                                                <span>تم تسجيل ومزامنة النقاط بنجاح في قاعدة البيانات</span>
                                                            </span>
                                                            <button
                                                                onClick={() => {
                                                                    const std = students.find(s => s.id === alert.studentId);
                                                                    if (std) {
                                                                        setStudentForAttendance(std);
                                                                    }
                                                                }}
                                                                className="text-[11px] font-bold text-indigo-300 hover:text-white bg-indigo-900/50 hover:bg-indigo-900 px-2.5 py-1 rounded-lg border border-indigo-800 transition-colors"
                                                            >
                                                                عرض السجل 📋
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    

                    {(activeView === 'followup' || activeView === 'oversight' || isFollowupOnlyUser) && loggedInAdmin && (() => {
                        const mode = (activeView === 'oversight' && canOversee && !isFollowupOnlyUser) ? 'oversight' : 'mine';
                        const tab = mode === 'mine' ? 'mine' : (['report', 'notes', 'groups', 'friday'].includes(followupTab) ? followupTab : 'report');
                        const reportGrade = myScope === 'all' ? oversightGrade : myScope;
                        const inReportGrade = (s) => reportGrade === 'all' || String(s.grade || '').trim() === reportGrade;
                        const noteLine = (n) => n ? `${n.by} • ${fmtShortAt(n.at)}` : '';
                        const fmt = (d, opts: any = { day: 'numeric', month: 'long' }) => d ? formatCairoDateKeyAr(d, opts) : '';
                        function fmtShortAt(iso) {
                            if (!iso) return '';
                            const d = new Date(iso);
                            return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short' });
                        }
                        const fmtAt = (iso) => {
                            if (!iso) return '';
                            const d = new Date(iso);
                            return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
                        };
                        const methodLabel = (m) => m === 'whatsapp' ? 'واتساب' : m === 'call' ? 'مكالمة' : 'يدوي';
                        const notesBtn = (s, compact = false) => {
                            const n = visibleNotesOf(s).length;
                            return (
                                <button type="button" onClick={() => { setNotesStudentId(s.id); setNoteDraft(''); }}
                                    className={`shrink-0 font-bold rounded-lg border border-white/15 bg-white/10 text-white/85 ${compact ? 'text-[11px] px-2 py-1' : 'text-xs px-3 py-2'}`}>
                                    📝 {n > 0 ? `ملاحظات (${n})` : 'ملاحظة'}
                                </button>
                            );
                        };
                        const tabBtn = (id, label) => (
                            <button type="button" onClick={() => setFollowupTab(id)}
                                className={`flex-1 py-2 rounded-lg text-xs font-black transition-colors ${tab === id ? 'bg-amber-500 text-indigo-950' : 'text-indigo-200 hover:bg-indigo-800/60'}`}>{label}</button>
                        );
                        const bar = (done, total) => {
                            const pct = total ? Math.round((done / total) * 100) : 100;
                            const color = pct >= 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-500';
                            return <div className="h-2 bg-indigo-950 rounded-full overflow-hidden"><div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(pct, total ? 4 : 100)}%` }} /></div>;
                        };

                        // كارت ولد غايب (بيستخدم في "افتقادي")
                        const renderStudentCard = (s) => {
                            const info = followupInfo[s.id] || { streak: 0, lastAttendedDate: '', missedAll: false };
                            const done = isFollowupContacted(s.id);
                            const contact = followup.contacts?.[s.id];
                            const wa = toWhatsAppNumber(s.phone);
                            const firstName = String(s.name || '').split(' ')[0];
                            const waText = encodeURIComponent(`أهلاً يا ${firstName} 👋 وحشتنا في الاجتماع! مستنيينك الجمعة الجاية إن شاء الله 🙏`);
                            return (
                                <div key={s.id} className={`rounded-2xl border p-3.5 space-y-2.5 ${done ? 'bg-emerald-900/20 border-emerald-600/40' : 'bg-indigo-900/50 border-indigo-700/50'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-bold text-white">{s.name}</div>
                                            <div className="text-[11px] text-indigo-300 mt-0.5">
                                                {s.grade ? `${s.grade} • ` : ''}{info.lastAttendedDate ? `آخر حضور ${fmt(info.lastAttendedDate)}` : 'ماحضرش السنة دي'}
                                            </div>
                                        </div>
                                        <span className={`shrink-0 text-[11px] font-black px-2 py-0.5 rounded-full whitespace-nowrap border ${isAtRisk(s.id) ? 'bg-red-600 text-white border-red-400' : 'bg-red-500/15 text-red-300 border-red-400/30'}`}>
                                            {isAtRisk(s.id) ? '⚠️ ' : ''}{info.streak === 1 ? 'غاب آخر اجتماع' : `غايب ${info.streak} اجتماعات`}
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {wa ? (
                                            <a href={`https://wa.me/${wa}?text=${waText}`} target="_blank" rel="noopener noreferrer" onClick={() => startFollowupContact(s.id, 'whatsapp')}
                                                className="flex items-center justify-center gap-1 bg-green-600 hover:bg-green-700 text-white text-xs font-bold py-2 rounded-lg">
                                                <WhatsAppIcon className="w-4 h-4" /> واتساب
                                            </a>
                                        ) : <span className="flex items-center justify-center bg-indigo-950/60 text-indigo-400 text-[11px] font-bold py-2 rounded-lg">مفيش رقم</span>}
                                        {wa ? (
                                            <a href={`tel:${s.phone}`} onClick={() => startFollowupContact(s.id, 'call')}
                                                className="flex items-center justify-center gap-1 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold py-2 rounded-lg">📞 اتصال</a>
                                        ) : <span className="flex items-center justify-center bg-indigo-950/60 text-indigo-400 text-[11px] font-bold py-2 rounded-lg">—</span>}
                                        <button type="button" onClick={() => toggleFollowupContacted(s.id)}
                                            className={`text-xs font-bold py-2 rounded-lg ${done ? 'bg-emerald-600 text-white' : 'bg-indigo-700 hover:bg-indigo-600 text-indigo-100'}`}>
                                            {done ? '✅ اتافتقد' : 'افتقدته'}
                                        </button>
                                    </div>
                                    {!done && pendingContact?.studentId === s.id && (
                                        <button type="button" onClick={() => openOutcome(pendingContact, hiddenAtRef.current ? Date.now() - hiddenAtRef.current : null)}
                                            className="w-full text-xs font-black py-2 rounded-lg bg-amber-500 text-indigo-950">⏳ قول حصل إيه علشان يتحسب افتقاد</button>
                                    )}
                                    {done && contact && (
                                        <div className="text-[11px] text-emerald-300">
                                            اتافتقد ({methodLabel(contact.method)}{contact.outcome && FOLLOWUP_OUTCOMES[contact.outcome] ? ` • ${FOLLOWUP_OUTCOMES[contact.outcome].icon} ${FOLLOWUP_OUTCOMES[contact.outcome].short}` : ''}) {fmt(contact.date, { weekday: 'long', day: 'numeric', month: 'long' })} بواسطة {contact.by}
                                            {contact.quick && <span className="text-amber-300 font-bold"> • ⚡ رجع بسرعة</span>}
                                        </div>
                                    )}
                                    {(() => {
                                        const last = visibleNotesOf(s)[0];
                                        return (
                                            <div className="flex items-center gap-2">
                                                <div className="flex-1 min-w-0 text-[11px] text-white/60 truncate">
                                                    {last ? <>📝 {last.text} <span className="text-white/40">— {noteLine(last)}</span></> : 'مفيش ملاحظات'}
                                                </div>
                                                {notesBtn(s, true)}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        };

                        return (
                            <div className="space-y-4 animate-fade-in-out">
                                <div className="bg-indigo-900/60 border border-indigo-700/60 rounded-2xl p-4 space-y-2">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <h2 className="text-lg font-black text-amber-400">{mode === 'oversight' ? `📊 المتابعة${myScope !== 'all' ? ` - ${myScope}` : ''}` : '📞 افتقادي'}</h2>
                                        {latestMeetingDate && <span className="text-[11px] text-indigo-300">آخر اجتماع: {fmt(latestMeetingDate, { weekday: 'long', day: 'numeric', month: 'long' })}</span>}
                                    </div>
                                    {mode === 'oversight' && (
                                        <div className="grid grid-cols-4 gap-1 p-1 bg-indigo-950/60 rounded-xl">
                                            {tabBtn('report', 'التقرير')}
                                            {tabBtn('friday', 'الجمعة')}
                                            {tabBtn('notes', 'الملاحظات')}
                                            {tabBtn('groups', 'المجموعات')}
                                        </div>
                                    )}
                                    {mode === 'oversight' && (
                                        <button type="button" onClick={() => { setMonthReportPrefix(prev => prev || reportMonths[0] || getCairoMonthPrefix()); setMonthReportOpen(true); }}
                                            className="w-full rounded-xl border border-white/15 bg-white/10 py-2 text-sm font-black text-white">
                                            📄 التقرير الشهري (PDF)
                                        </button>
                                    )}
                                    {mode === 'oversight' && tab !== 'groups' && myScope === 'all' && (
                                        <div className="flex gap-1.5 flex-wrap">
                                            {['all', ...followupGrades].map(g => (
                                                <button key={g} type="button" onClick={() => setOversightGrade(g)}
                                                    className={`px-3 py-1 rounded-full text-[11px] font-black border ${oversightGrade === g ? 'bg-amber-500 text-indigo-950 border-amber-400' : 'bg-white/5 text-white/70 border-white/15'}`}>
                                                    {g === 'all' ? 'كل الصفوف' : g}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {followupMeetings.length === 0 && tab !== 'groups' && tab !== 'notes' && <p className="text-center text-indigo-300 mt-8">لسه مفيش اجتماعات متسجلة.</p>}

                                {/* ===== افتقادي ===== */}
                                {followupMeetings.length > 0 && tab === 'mine' && (
                                    <div className="space-y-3">
                                        {myFollowupGroup.length === 0 ? (
                                            <p className="text-center text-indigo-300 mt-6">{canOversee ? 'إنت مش عليك مجموعة. المجموعات بتتوزع من 📊 المتابعة ← المجموعات.' : 'لسه ماتوزعتش عليك مجموعة. كلّم أمين الفصل أو مينا رزق.'}</p>
                                        ) : (
                                            <>
                                                <div className="bg-indigo-900/40 border border-indigo-700/50 rounded-2xl p-3.5 space-y-2">
                                                    <div className="text-sm text-white font-bold">
                                                        مجموعتك {myFollowupGroup.length} ولد • غاب منهم {myFollowupAbsent.length}
                                                    </div>
                                                    {myFollowupAbsent.length > 0 && (
                                                        <>
                                                            <div className="flex justify-between text-[11px] text-indigo-300"><span>افتقدت {myFollowupAbsent.length - myPendingFollowupCount} من {myFollowupAbsent.length}</span></div>
                                                            {bar(myFollowupAbsent.length - myPendingFollowupCount, myFollowupAbsent.length)}
                                                        </>
                                                    )}
                                                </div>
                                                {myFollowupAbsent.length === 0
                                                    ? <p className="text-center text-emerald-300 mt-4">كل مجموعتك حضرت آخر اجتماع 🎉</p>
                                                    : myFollowupAbsent.map(s => renderStudentCard(s))}
                                                {myFollowupGroup.length > myFollowupAbsent.length && (
                                                    <div className="bg-indigo-900/40 border border-indigo-700/50 rounded-2xl overflow-hidden">
                                                        <button type="button" onClick={() => setShowWholeGroup(v => !v)} className="w-full flex justify-between items-center px-3.5 py-3 text-sm font-bold text-white">
                                                            <span>✅ اللي حضروا من مجموعتك ({myFollowupGroup.length - myFollowupAbsent.length})</span>
                                                            <span className="text-xs text-white/50">{showWholeGroup ? '▲' : '▼'}</span>
                                                        </button>
                                                        {showWholeGroup && (
                                                            <div className="border-t border-indigo-700/50 divide-y divide-indigo-800/60">
                                                                {myFollowupGroup.filter(s => !isAbsentNow(s.id)).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar')).map(s => (
                                                                    <div key={s.id} className="flex items-center justify-between gap-2 px-3.5 py-2">
                                                                        <span className="text-sm text-white truncate">{s.name}</span>
                                                                        {notesBtn(s, true)}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* ===== تقرير الخدام (المتابعة) ===== */}
                                {followupMeetings.length > 0 && tab === 'report' && mode === 'oversight' && (() => {
                                    const scoped = followupReport
                                        .map(r => ({ ...r, group: r.group.filter(inReportGrade), absent: r.absent.filter(inReportGrade), done: r.done.filter(inReportGrade) }))
                                        .filter(r => r.group.length > 0);
                                    const unCount = students.filter(s => inReportGrade(s) && !assignedServantId(s.id)).length;
                                    const unAbsent = students.filter(s => inReportGrade(s) && !assignedServantId(s.id) && isAbsentNow(s.id)).length;
                                    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString();
                                    const notesCountBy = (adminId) => students.filter(inReportGrade).reduce((n, s) => n + allNotesOf(s.id).filter((x: any) => x.byId === adminId && String(x.at || '') >= monthAgo).length, 0);
                                    const riskList = atRiskStudents.filter(inReportGrade);
                                    const neverList = neverCameStudents.filter(inReportGrade);
                                    return (
                                    <div className="space-y-3">
                                        {(riskList.length > 0 || neverList.length > 0) && (
                                            <div className="rounded-2xl border border-red-400/40 bg-red-500/10 overflow-hidden">
                                                <button type="button" onClick={() => setAtRiskOpen(v => !v)} className="w-full flex items-center justify-between gap-2 p-3.5 text-right">
                                                    <span className="font-black text-red-200">⚠️ ولاد بيبعدوا ({riskList.length})</span>
                                                    <span className="text-[11px] text-red-200/70">غايبين {AT_RISK_STREAK} اجتماعات أو أكتر {atRiskOpen ? '▲' : '▼'}</span>
                                                </button>
                                                {atRiskOpen && (
                                                    <div className="border-t border-red-400/30 divide-y divide-red-400/15">
                                                        {riskList.length === 0 && <p className="p-3 text-xs text-red-100/70">مفيش حد بيبعد دلوقتي 🎉</p>}
                                                        {riskList.map(s => {
                                                            const info = followupInfo[s.id];
                                                            const servant = admins.find(a => a.id === assignedServantId(s.id));
                                                            const last = allNotesOf(s.id)[0];
                                                            return (
                                                                <div key={s.id} className="px-3.5 py-2.5 space-y-1">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-sm font-bold text-white truncate">{s.name} <span className="text-[11px] font-normal text-white/50">({s.grade || ''})</span></span>
                                                                        <span className="shrink-0 text-[11px] font-black text-red-200">غايب {info.streak}</span>
                                                                    </div>
                                                                    <div className="text-[11px] text-white/55">
                                                                        آخر حضور {fmt(info.lastAttendedDate)} • {servant ? `خادمه: ${servant.name}` : <span className="text-red-300 font-bold">مالوش خادم</span>}
                                                                        {isFollowupContacted(s.id) ? ' • ✅ اتافتقد الأسبوع ده' : ' • ⏳ لسه ماتافتقدش'}
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="flex-1 min-w-0 text-[11px] text-white/50 truncate">{last ? `📝 ${last.text}` : 'مفيش ملاحظات'}</div>
                                                                        {notesBtn(s, true)}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                        {neverList.length > 0 && (
                                                            <p className="px-3.5 py-2.5 text-[11px] text-white/50">وفيه كمان {neverList.length} ولد ماحضروش ولا مرة السنة دي (موجودين في التقرير الشهري).</p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {unCount > 0 && (
                                            <button type="button" onClick={() => setFollowupTab('groups')}
                                                className="w-full text-right bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs text-red-200 font-bold">
                                                ⚠️ فيه {unCount} ولد من غير خادم ({unAbsent} منهم غايبين). دوس هنا عشان توزّعهم.
                                            </button>
                                        )}
                                        {scoped.length === 0 ? (
                                            <p className="text-center text-indigo-300 mt-6">لسه مفيش مجموعات متوزعة.</p>
                                        ) : scoped.map(r => {
                                            const open = expandedReportServant === r.admin.id;
                                            const pending = r.absent.filter(s => !isFollowupContacted(s.id));
                                            return (
                                                <div key={r.admin.id} className="bg-indigo-900/50 border border-indigo-700/50 rounded-2xl overflow-hidden">
                                                    <button type="button" onClick={() => setExpandedReportServant(open ? '' : r.admin.id)} className="w-full text-right p-3.5 space-y-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-black text-white">{r.admin.name}</span>
                                                            <span className={`text-xs font-black ${r.absent.length === 0 || r.done.length === r.absent.length ? 'text-emerald-300' : r.done.length > 0 ? 'text-amber-300' : 'text-red-300'}`}>
                                                                {r.absent.length === 0 ? 'كل مجموعته حضرت ✅' : `افتقد ${r.done.length} من ${r.absent.length}`}
                                                            </span>
                                                        </div>
                                                        {r.absent.length > 0 && bar(r.done.length, r.absent.length)}
                                                        {r.done.length > 0 && (() => {
                                                            const cs = r.done.map(s => followup.contacts?.[s.id] || {});
                                                            const replied = cs.filter(c => isRepliedOutcome(c.outcome)).length;
                                                            const noReply = cs.filter(c => c.outcome && !isRepliedOutcome(c.outcome)).length;
                                                            const quickN = cs.filter(c => c.quick).length;
                                                            return (
                                                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-bold">
                                                                    <span className="text-emerald-300">💬 {replied} ردوا</span>
                                                                    <span className="text-white/55">🔕 {noReply} مردوش</span>
                                                                    {quickN > 0 && <span className="text-amber-300">⚡ {quickN} رجع بسرعة</span>}
                                                                </div>
                                                            );
                                                        })()}
                                                        <div className="flex justify-between gap-2 text-[11px] text-indigo-300">
                                                            <span>مجموعته {r.group.length} ولد • 📝 {notesCountBy(r.admin.id)} ملاحظة آخر شهر</span>
                                                            <span className="text-left">{r.lastActivity ? `آخر استخدام: ${fmtAt(r.lastActivity)}` : 'ماستخدمش الافتقاد لسه'}</span>
                                                        </div>
                                                    </button>
                                                    {open && (
                                                        <div className="border-t border-indigo-700/50 p-3 space-y-1.5 bg-indigo-950/40">
                                                            {r.absent.length === 0 && <p className="text-xs text-indigo-300">مفيش غايبين في مجموعته.</p>}
                                                            {[...pending, ...r.done].map(s => {
                                                                const isDone = isFollowupContacted(s.id);
                                                                const last = allNotesOf(s.id)[0];
                                                                return (
                                                                    <div key={s.id} className="py-1.5 space-y-1">
                                                                        <div className="flex items-center justify-between gap-2 text-xs">
                                                                            <span className="text-white truncate">{isDone ? '✅' : '⏳'} {s.name} <span className="text-indigo-400">({s.grade || ''})</span></span>
                                                                            <span className={`shrink-0 ${isDone ? 'text-emerald-300' : 'text-red-300'}`}>{isDone ? (() => { const c = followup.contacts?.[s.id] || {}; const o = FOLLOWUP_OUTCOMES[c.outcome]; return `${methodLabel(c.method)}${o ? ` • ${o.icon} ${o.short}` : ''}${c.quick ? ' ⚡' : ''}`; })() : 'لسه ماتافتقدش'}</span>
                                                                        </div>
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="flex-1 min-w-0 text-[11px] text-white/55 truncate">{last ? <>📝 {last.text} <span className="text-white/35">— {noteLine(last)}</span></> : 'مفيش ملاحظات'}</div>
                                                                            {notesBtn(s, true)}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    );
                                })()}

                                {/* ===== كل الملاحظات (المتابعة) ===== */}
                                {tab === 'notes' && mode === 'oversight' && (() => {
                                    const feed = students.filter(inReportGrade)
                                        .flatMap(s => allNotesOf(s.id).map((n: any) => ({ ...n, student: s })))
                                        .sort((a: any, b: any) => String(b.at || '').localeCompare(String(a.at || '')))
                                        .slice(0, 80);
                                    return (
                                        <div className="space-y-2.5">
                                            {feed.length === 0 ? (
                                                <p className="text-center text-indigo-300 mt-6">لسه مفيش ملاحظات اتكتبت.</p>
                                            ) : feed.map((n: any) => (
                                                <button key={`${n.student.id}_${n.id}`} type="button" onClick={() => { setNotesStudentId(n.student.id); setNoteDraft(''); }}
                                                    className="w-full text-right bg-indigo-900/50 border border-indigo-700/50 rounded-2xl p-3 space-y-1">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <span className="font-bold text-white text-sm truncate">{n.student.name} <span className="text-[11px] text-indigo-300 font-normal">({n.student.grade || ''})</span></span>
                                                        <span className="shrink-0 text-[11px] text-white/45">{fmtShortAt(n.at)}</span>
                                                    </div>
                                                    <div className="text-sm text-white/85 whitespace-pre-wrap break-words">{n.text}</div>
                                                    <div className="text-[11px] text-sky-300">✍️ {n.by}</div>
                                                </button>
                                            ))}
                                            {feed.length === 80 && <p className="text-center text-[11px] text-white/40">بيظهر آخر 80 ملاحظة بس. دوس على أي ولد تشوف كل ملاحظاته.</p>}
                                        </div>
                                    );
                                })()}

                                {/* ===== ملخص الجمعة ===== */}
                                {tab === 'friday' && mode === 'oversight' && (() => {
                                    if (followupMeetings.length === 0) return <p className="text-center text-indigo-300 mt-6">لسه مفيش اجتماعات متسجلة.</p>;
                                    const date = followupMeetings.some(m => m.date === fridayMeetingDate) ? fridayMeetingDate : followupMeetings[0].date;
                                    const sum = buildFridaySummary(date, inReportGrade);
                                    if (!sum) return null;
                                    const text = fridaySummaryText(sum, reportGrade === 'all' ? '' : reportGrade);
                                    const diff = sum.prevCount === null ? null : sum.present.length - sum.prevCount;
                                    const stat = (label, value, tone = 'text-white') => (
                                        <div className="rounded-xl bg-white/5 border border-white/10 py-2 text-center">
                                            <div className={`text-xl font-black ${tone}`}>{value}</div>
                                            <div className="text-[10px] text-white/55 font-bold">{label}</div>
                                        </div>
                                    );
                                    const nameList = (title, list, tone) => list.length > 0 && (
                                        <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                                            <div className={`text-xs font-black mb-1 ${tone}`}>{title} ({list.length})</div>
                                            <div className="text-sm text-white/85 leading-relaxed">{list.map(s => s.name).join('، ')}</div>
                                        </div>
                                    );
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex gap-1.5 overflow-x-auto pb-1">
                                                {followupMeetings.slice(0, 8).map(m => (
                                                    <button key={m.date} type="button" onClick={() => setFridayMeetingDate(m.date)}
                                                        className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] font-black border ${m.date === date ? 'bg-amber-500 text-indigo-950 border-amber-400' : 'bg-white/5 text-white/70 border-white/15'}`}>
                                                        {fmt(m.date, { day: 'numeric', month: 'short' })}{isFirstFridayDateKey(m.date) ? ' ⛪' : ''}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="grid grid-cols-3 gap-2">
                                                {stat('حضروا', sum.present.length, 'text-amber-300')}
                                                {stat('عن اللي قبله', diff === null ? '—' : diff > 0 ? `+${diff}` : String(diff), diff === null ? 'text-white' : diff >= 0 ? 'text-emerald-300' : 'text-red-300')}
                                                {stat('أول مرة', sum.newKids.length, 'text-sky-300')}
                                            </div>
                                            {sum.byGrade.length > 1 && (
                                                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${sum.byGrade.length}, minmax(0, 1fr))` }}>
                                                    {sum.byGrade.map(x => stat(x.g, `${x.n}/${x.total}`))}
                                                </div>
                                            )}
                                            {nameList('🆕 أول مرة ييجوا', sum.newKids, 'text-sky-300')}
                                            {nameList('🔙 رجعوا بعد غياب', sum.returned, 'text-emerald-300')}
                                            {sum.top.length > 0 && (
                                                <div className="rounded-xl bg-white/5 border border-white/10 p-3">
                                                    <div className="text-xs font-black mb-1 text-amber-300">🏆 أعلى نقط</div>
                                                    <div className="text-sm text-white/85">{sum.top.map(x => `${x.s.name} (${x.p})`).join('، ')}</div>
                                                </div>
                                            )}
                                            {sum.prev && sum.fuTotal > 0 && (
                                                <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-1.5">
                                                    <div className="text-xs font-black text-white/80">📞 افتقاد غياب الاجتماع اللي قبله: {sum.fuDone} من {sum.fuTotal}</div>
                                                    {bar(sum.fuDone, sum.fuTotal)}
                                                </div>
                                            )}
                                            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                                                <div className="text-[11px] font-black text-white/50 mb-1.5">الرسالة اللي هتتبعت:</div>
                                                <pre className="whitespace-pre-wrap text-xs text-white/80 font-sans leading-relaxed">{text}</pre>
                                            </div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"
                                                    className="flex items-center justify-center gap-1.5 bg-green-600 text-white text-sm font-black py-2.5 rounded-xl">
                                                    <WhatsAppIcon className="w-4 h-4" /> ابعت واتساب
                                                </a>
                                                <button type="button" onClick={() => {
                                                    const done = () => showToast('✅ اتنسخ الملخص.');
                                                    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => window.prompt('انسخ الملخص:', text));
                                                    else window.prompt('انسخ الملخص:', text);
                                                }} className="bg-white/10 border border-white/15 text-white text-sm font-black py-2.5 rounded-xl">📋 نسخ</button>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* ===== توزيع المجموعات (المتابعة) ===== */}
                                {tab === 'groups' && mode === 'oversight' && (() => {
                                    const gradeStudents = students.filter(s => String(s.grade || '').trim() === followupGrade).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
                                    const gradeUnassigned = gradeStudents.filter(s => !assignedServantId(s.id));
                                    const perServant = admins.map(a => ({ a, n: gradeStudents.filter(s => assignedServantId(s.id) === a.id).length })).filter(x => x.n > 0);
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex gap-2 flex-wrap">
                                                {followupGrades.filter(scopeCoversGrade).map(g => (
                                                    <button key={g} type="button" onClick={() => { setFollowupGrade(g); setFollowupAssignPickerOpen(false); }}
                                                        className={`px-3 py-1.5 rounded-full text-xs font-black border ${followupGrade === g ? 'bg-amber-500 text-indigo-950 border-amber-400' : 'bg-indigo-900/60 text-indigo-200 border-indigo-700'}`}>
                                                        {g} ({students.filter(s => String(s.grade || '').trim() === g).length})
                                                    </button>
                                                ))}
                                            </div>

                                            <div className="bg-indigo-900/50 border border-indigo-700/50 rounded-2xl p-3.5 space-y-2">
                                                <div className="text-sm font-bold text-white">{followupGrade}: {gradeStudents.length} ولد</div>
                                                {perServant.length > 0 && (
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {perServant.map(x => <span key={x.a.id} className="bg-sky-500/15 text-sky-200 border border-sky-400/30 text-[11px] font-bold px-2 py-0.5 rounded-full">{x.a.name}: {x.n}</span>)}
                                                    </div>
                                                )}
                                                <div className={`text-xs font-bold ${gradeUnassigned.length ? 'text-red-300' : 'text-emerald-300'}`}>
                                                    {gradeUnassigned.length ? `${gradeUnassigned.length} ولد من غير خادم` : 'كل الأولاد ليهم خدام ✅'}
                                                </div>
                                                {followupGrade === 'تانية ثانوي' && (
                                                    <button type="button" onClick={applyGrade2PdfPreset}
                                                        className="w-full bg-amber-500 hover:bg-amber-600 text-indigo-950 text-xs font-black py-2 rounded-lg">
                                                        📋 طبّق توزيع الـPDF (مينا رزق / ناجي وليم / بولا ماهر)
                                                    </button>
                                                )}
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button type="button" onClick={() => openGroupDistribution(false)} disabled={gradeUnassigned.length === 0}
                                                        className="bg-sky-600 hover:bg-sky-700 disabled:opacity-40 text-white text-xs font-bold py-2 rounded-lg">🔀 وزّع اللي من غير خادم</button>
                                                    <button type="button" onClick={() => openGroupDistribution(true)}
                                                        className="bg-indigo-700 hover:bg-indigo-600 text-indigo-100 text-xs font-bold py-2 rounded-lg">♻️ إعادة توزيع الصف كله</button>
                                                </div>
                                                {followupAssignPickerOpen && (
                                                    <div className="bg-indigo-950/80 border border-sky-500/40 rounded-xl p-3 space-y-2">
                                                        <p className="text-sm font-bold text-sky-300">
                                                            {followupReassignAll ? `إعادة توزيع كل أولاد ${followupGrade} على:` : `توزيع ${gradeUnassigned.length} ولد من ${followupGrade} على:`}
                                                        </p>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            {admins.filter(a => !a.isLocked).map(a => {
                                                                const on = followupAssignServants.includes(a.id);
                                                                return (
                                                                    <button key={a.id} type="button" onClick={() => setFollowupAssignServants(prev => on ? prev.filter(id => id !== a.id) : [...prev, a.id])}
                                                                        className={`text-xs font-bold py-2 px-2 rounded-lg border ${on ? 'bg-sky-600 border-sky-400 text-white' : 'bg-indigo-900 border-indigo-700 text-indigo-200'}`}>
                                                                        {on ? '✓ ' : ''}{a.name}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        <div className="flex gap-2">
                                                            <button type="button" onClick={runGroupDistribution} disabled={followupAssignServants.length === 0}
                                                                className="flex-1 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2 rounded-lg text-sm">وزّع بالتساوي</button>
                                                            <button type="button" onClick={() => setFollowupAssignPickerOpen(false)} className="px-4 bg-indigo-800 text-indigo-200 font-bold py-2 rounded-lg text-sm">إلغاء</button>
                                                        </div>
                                                        <p className="text-[11px] text-indigo-400">كل خادم بياخد خليط من اللي بيحضروا واللي بيغيبوا. ولو الخادم مش في القايمة، ضيفه الأول من "الخدام".</p>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="bg-indigo-900/40 border border-indigo-700/50 rounded-2xl divide-y divide-indigo-800/60">
                                                {gradeStudents.map(s => (
                                                    <div key={s.id} className="flex items-center justify-between gap-2 px-3 py-2">
                                                        <span className="text-sm text-white truncate">{s.name}</span>
                                                        <select value={assignedServantId(s.id)} onChange={(e) => assignFollowup(s.id, e.target.value)}
                                                            className={`shrink-0 max-w-[48%] bg-indigo-950 border rounded-lg px-2 py-1 text-xs ${assignedServantId(s.id) ? 'text-white border-indigo-700' : 'text-red-300 border-red-500/50'}`}>
                                                            <option value="">— من غير خادم —</option>
                                                            {admins.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        );
                    })()}

                    {!isFollowupOnlyUser && activeView === 'attendance_summary' && (
                        <div className="space-y-4 animate-fade-in-out">
                            {isAuthenticated && meetingsStats.length > 0 && (
                                <button
                                    type="button"
                                    onClick={exportAllMeetingsToExcel}
                                    className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl shadow-md transition-colors"
                                >
                                    📥 تحميل سجل الحضور كله (Excel)
                                </button>
                            )}
                            {meetingsStats.length === 0 ? (
                                <p className="text-center text-indigo-300 mt-10">لا توجد سجلات حضور حتى الآن.</p>
                            ) : (
                                meetingsStats.map(stat => (
                                    <div key={stat.date} className="bg-indigo-900/70 rounded-xl border border-indigo-800/50 overflow-hidden cursor-pointer hover:bg-indigo-800/50 transition-colors" onClick={() => setExpandedDate(expandedDate === stat.date ? null : stat.date)}>
                                        <div className="p-4 flex justify-between items-center">
                                            <div>
                                                <div className="flex items-center gap-2 mb-1">
                                                    <CalendarIcon className="w-5 h-5 text-amber-400"/>
                                                    <span className="font-bold text-lg text-white">
                                                        {formatCairoDateKeyAr(stat.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                                                    </span>
                                                </div>
                                                <div className="text-indigo-300 text-sm flex gap-4">
                                                    <span>حضور: <strong className="text-white">{stat.uniqueAttendees.size}</strong></span>
                                                </div>
                                            </div>
                                            <ChevronDownIcon className={`w-6 h-6 text-gray-400 transition-transform ${expandedDate === stat.date ? 'rotate-180' : ''}`} />
                                        </div>
                                        {expandedDate === stat.date && (
                                            <div className="px-4 pb-4 pt-2 border-t border-indigo-800/50 bg-indigo-900/90">
                                                {isAuthenticated && (
                                                    <button
                                                        type="button"
                                                        onClick={(e) => { e.stopPropagation(); exportMeetingToExcel(stat.date); }}
                                                        className="w-full mb-3 flex items-center justify-center gap-2 bg-emerald-600/90 hover:bg-emerald-600 text-white text-sm font-bold py-2 rounded-lg transition-colors"
                                                    >
                                                        📥 تحميل حضور وغياب الاجتماع ده (Excel)
                                                    </button>
                                                )}
                                                <h4 className="text-sm font-semibold text-indigo-200 mb-2">أسماء الحضور ({stat.uniqueAttendees.size}):</h4>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                    {students
                                                        .filter(s => stat.uniqueAttendees.has(s.id))
                                                        .sort((a, b) => a.name.localeCompare(b.name, 'ar'))
                                                        .map(s => {
                                                            const dailyPoints = (s.attendanceHistory || [])
                                                                .filter(h => h.date === stat.date)
                                                                .reduce((sum, h) => sum + Number(h.points || 0), 0);
                                                            const isExpanded = expandedSummaryStudentKey === `${stat.date}-${s.id}`;
                                                            return (
                                                                <div 
                                                                    key={s.id} 
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        const key = `${stat.date}-${s.id}`;
                                                                        setExpandedSummaryStudentKey(prev => prev === key ? null : key);
                                                                    }}
                                                                    className="flex flex-col bg-indigo-950/50 p-2.5 rounded-lg text-indigo-100 text-sm cursor-pointer hover:bg-slate-800/45 transition-all select-none border border-transparent hover:border-indigo-800/30"
                                                                >
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="flex items-center gap-2">
                                                                            <div className="w-2 h-2 rounded-full bg-green-500 shrink-0"></div>
                                                                            <span className="text-white font-semibold">{s.name}</span>
                                                                            {s.grade && (
                                                                                <span className="bg-sky-500/15 text-sky-300 border border-sky-400/30 font-black text-[10px] px-2 py-0.5 rounded-full whitespace-nowrap">
                                                                                    🎓 {s.grade}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 font-mono">
                                                                            <span className={`font-bold ${dailyPoints > 0 ? 'text-amber-400' : 'text-gray-400'}`}>
                                                                                {dailyPoints > 0 ? `+${dailyPoints}` : dailyPoints}
                                                                            </span>
                                                                            <ChevronDownIcon className={`w-4 h-4 text-gray-400/80 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                                                                        </div>
                                                                    </div>
                                                                    
                                                                    {isExpanded && (
                                                                        <div className="space-y-1.5 mt-2 pt-2 border-t border-indigo-900/40 pr-1 shrink-0">
                                                                            {(s.attendanceHistory || [])
                                                                                .filter(h => h.date === stat.date)
                                                                                .map((record, rIdx) => (
                                                                                    <div key={record.id || rIdx} className="flex justify-between items-start text-xs text-indigo-300 py-0.5">
                                                                                        <div className="flex flex-col max-w-[80%]">
                                                                                            <span className="font-semibold text-indigo-200">{record.typeName}</span>
                                                                                            {record.description && (
                                                                                                <span className="text-amber-300/90 text-[11px] pr-2 mt-0.5 whitespace-pre-wrap leading-relaxed">({record.description})</span>
                                                                                            )}
                                                                                        </div>
                                                                                        <span className={`font-mono font-bold shrink-0 ${record.points > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                                                                            {record.points > 0 ? `+${record.points}` : record.points}
                                                                                        </span>
                                                                                    </div>
                                                                                ))
                                                                            }
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    }
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeView === 'admin' && isAuthenticated && (
                        <div className="space-y-4">
                            <h2 className="text-xl font-black text-white">⚙️ الإدارة</h2>
                            <div className="grid grid-cols-2 gap-3">
                                {isSuperAdmin && (
                                    <button onClick={() => setAdminManagementModalOpen(true)} className="admin-tile">
                                        <span className="text-3xl">👥</span>
                                        <span className="font-black text-white">الخدام</span>
                                        <span className="text-[11px] text-white/55">إضافة وصلاحيات وأرقام سرية</span>
                                    </button>
                                )}
                                {isSuperAdmin && (
                                    <button onClick={() => window.dispatchEvent(new CustomEvent('open-gifts-shop'))} className="admin-tile relative">
                                        <span className="text-3xl">🎁</span>
                                        <span className="font-black text-white">متجر الهدايا</span>
                                        <span className="text-[11px] text-white/55">الهدايا والطلبات</span>
                                        {giftsPendingCount > 0 && <span className="tile-badge">{giftsPendingCount}</span>}
                                    </button>
                                )}
                                {isSuperAdmin && (
                                    <button onClick={() => goSection('badge_alerts')} className="admin-tile relative">
                                        <span className="text-3xl">🔔</span>
                                        <span className="font-black text-white">الأوسمة والمكافآت</span>
                                        <span className="text-[11px] text-white/55">المستحقين وأوائل الشهر</span>
                                        {pendingBadgesCount > 0 && <span className="tile-badge">{pendingBadgesCount}</span>}
                                    </button>
                                )}
                                <button onClick={() => setBackupModalOpen(true)} className="admin-tile">
                                    <CloudArrowUpIcon className="w-8 h-8 text-sky-300" />
                                    <span className="font-black text-white">النسخ الاحتياطي</span>
                                    <span className="text-[11px] text-white/55">تحميل واستعادة البيانات</span>
                                </button>
                                <button onClick={forceRefreshApp} className="admin-tile">
                                    <span className="text-3xl">🔄</span>
                                    <span className="font-black text-white">تحديث التطبيق</span>
                                    <span className="text-[11px] text-white/55">لو حاسس إن فيه حاجة قديمة</span>
                                </button>
                            </div>
                            {isSuperAdmin && (
                                <div className="glass-card rounded-2xl p-4 flex items-center justify-between gap-3">
                                    <div>
                                        <div className="font-black text-white flex items-center gap-2"><CalendarIcon className="w-5 h-5 text-amber-300" /> تاريخ التسجيل</div>
                                        <div className="text-[11px] text-white/55 mt-0.5">غيّره بس لو هتسجّل نقط ليوم فات</div>
                                    </div>
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        onChange={(e) => setSelectedDate(e.target.value || todayKey)}
                                        className="glass-input rounded-xl px-2 py-1.5 text-white focus:outline-none"
                                    />
                                </div>
                            )}
                        </div>
                    )}

                </main>
            </div>

            {isAuthenticated && (
                // الشريط اللي تحت: الأقسام الأساسية
                <nav className="fixed bottom-0 inset-x-0 z-40 px-3" style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }}>
                    <div className="glass-bar max-w-md mx-auto rounded-[26px] grid gap-1 px-2 py-1.5" style={{ gridTemplateColumns: `repeat(${canOversee ? 5 : 4}, minmax(0, 1fr))` }}>
                        {[
                            { key: 'home', label: 'الرئيسية', onClick: () => goSection(HOME_VIEWS.includes(activeView) ? activeView : 'students'), icon: <UserGroupIcon className="w-6 h-6" /> },
                            { key: 'scan', label: 'مسح', onClick: () => setScannerOpen(true), icon: <CameraIcon className="w-6 h-6" /> },
                            { key: 'followup', label: 'الافتقاد', onClick: () => goSection('followup'), icon: <span className="text-xl leading-6">📞</span>, badge: myPendingFollowupCount },
                            ...(canOversee ? [{ key: 'oversight', label: 'المتابعة', onClick: () => goSection('oversight'), icon: <span className="text-xl leading-6">📊</span>, badge: atRiskStudents.filter(scopeCoversStudent).length }] : []),
                            { key: 'admin', label: 'الإدارة', onClick: () => goSection('admin'), icon: <span className="text-xl leading-6">⚙️</span>, badge: adminAlertsCount },
                        ].map(item => {
                            const active = item.key === currentSection;
                            return (
                                <button key={item.key} onClick={item.onClick} aria-label={item.label}
                                    className={`relative flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-2xl active:scale-95 transition-all ${active ? 'nav-active text-amber-300' : item.key === 'scan' ? 'text-amber-300' : 'text-white/70'}`}>
                                    {item.icon}
                                    <span className="text-[11px] font-bold">{item.label}</span>
                                    {item.badge > 0 && (
                                        <span className="absolute top-0.5 right-1/4 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{item.badge}</span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </nav>
            )}

            {monthReportOpen && canOversee && createPortal((() => {
                const prefix = monthReportPrefix || reportMonths[0] || getCairoMonthPrefix();
                const scopeFn = (s) => myScope === 'all' || String(s.grade || '').trim() === myScope;
                const r = buildMonthReport(prefix, scopeFn);
                const monthName = getArabicMonthNameFromPrefix(prefix);
                const dShort = (d) => formatCairoDateKeyAr(d, { day: 'numeric', month: 'long' });
                const th = { padding: '6px 8px', background: '#eef2ff', color: '#312e81', fontWeight: 800, fontSize: 12, borderBottom: '1px solid #c7d2fe', textAlign: 'right' as const };
                const td = { padding: '6px 8px', fontSize: 12, borderBottom: '1px solid #e5e7eb', textAlign: 'right' as const };
                const h2 = { fontSize: 15, fontWeight: 900, color: '#1e1b4b', margin: '18px 0 8px' };
                const kpi = (label, value) => (
                    <div style={{ flex: '1 1 0', minWidth: 90, border: '1px solid #e0e7ff', borderRadius: 12, padding: '8px 6px', textAlign: 'center', background: '#f8faff' }}>
                        <div style={{ fontSize: 20, fontWeight: 900, color: '#4338ca' }}>{value}</div>
                        <div style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>{label}</div>
                    </div>
                );
                return (
                    <div id="month-report" dir="rtl" style={{ position: 'fixed', inset: 0, zIndex: 70, overflowY: 'auto', background: '#fff', color: '#0f172a', fontFamily: "'Cairo', sans-serif" }}>
                        <style>{`
                            @media print {
                                body.month-report-open #root { display: none !important; }
                                body.month-report-open::before { display: none !important; }
                                body.month-report-open { background: #fff !important; }
                                #month-report { position: static !important; overflow: visible !important; }
                                #month-report .no-print { display: none !important; }
                                #month-report table, #month-report .keep { break-inside: avoid; }
                                @page { size: A4; margin: 12mm; }
                            }
                            #month-report * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                        `}</style>
                        <div className="no-print" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', gap: 8, alignItems: 'center', padding: 'max(10px, env(safe-area-inset-top, 0px)) 12px 10px', background: '#1e1b4b', color: '#fff', flexWrap: 'wrap' }}>
                            <select value={prefix} onChange={(e) => setMonthReportPrefix(e.target.value)}
                                style={{ background: '#312e81', color: '#fff', border: '1px solid #6366f1', borderRadius: 10, padding: '6px 8px', fontWeight: 800 }}>
                                {(reportMonths.length ? reportMonths : [prefix]).map(p => <option key={p} value={p}>{getArabicMonthNameFromPrefix(p)}</option>)}
                            </select>
                            <button type="button" onClick={() => window.print()} style={{ flex: 1, background: '#f59e0b', color: '#1e1b4b', fontWeight: 900, borderRadius: 10, padding: '8px 10px' }}>🖨️ اطبع / احفظ PDF</button>
                            <button type="button" onClick={() => setMonthReportOpen(false)} style={{ background: 'rgba(255,255,255,0.15)', fontWeight: 900, borderRadius: 10, padding: '8px 12px' }}>إغلاق</button>
                        </div>
                        <div style={{ maxWidth: 780, margin: '0 auto', padding: '18px 16px 40px' }}>
                            <div style={{ borderBottom: '3px solid #4338ca', paddingBottom: 10 }}>
                                <div style={{ fontSize: 22, fontWeight: 900, color: '#1e1b4b' }}>تقرير شهر {monthName}</div>
                                <div style={{ fontSize: 13, color: '#475569', fontWeight: 700 }}>اجتماع الأنبا رويس — ثانوي بنين — كنيسة مارمينا{myScope !== 'all' ? ` — ${myScope}` : ''}</div>
                                <div style={{ fontSize: 11, color: '#94a3b8' }}>اتعمل بواسطة {loggedInAdmin?.name} يوم {formatCairoDateKeyAr(getCairoDateKey(), { day: 'numeric', month: 'long', year: 'numeric' })}</div>
                            </div>

                            {r.meetings.length === 0 ? (
                                <p style={{ marginTop: 24, textAlign: 'center', color: '#64748b' }}>مفيش اجتماعات متسجلة في الشهر ده.</p>
                            ) : (<>
                                <div className="keep" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                                    {kpi('اجتماعات', r.meetings.length)}
                                    {kpi('متوسط الحضور', `${Math.round(r.totalAvg)} من ${r.scoped.length}`)}
                                    {kpi('حضروا القداس', r.massKids.length)}
                                    {kpi('اعترفوا', r.confessions)}
                                    {kpi('أول مرة ييجوا', r.newKids.length)}
                                </div>

                                <div style={h2}>📅 الحضور في كل اجتماع</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr><th style={th}>التاريخ</th>{followupGrades.map(g => <th key={g} style={th}>{g}</th>)}<th style={th}>الإجمالي</th></tr></thead>
                                    <tbody>{r.perMeeting.map(m => (
                                        <tr key={m.date}><td style={td}>{dShort(m.date)}{m.isMass ? ' (قداس)' : ''}</td>{m.byGrade.map((n, i) => <td key={i} style={td}>{n}</td>)}<td style={{ ...td, fontWeight: 900 }}>{m.total}</td></tr>
                                    ))}</tbody>
                                </table>

                                <div style={h2}>🎓 نسبة الحضور لكل صف</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr><th style={th}>الصف</th><th style={th}>عدد الأولاد</th><th style={th}>متوسط الحضور</th><th style={th}>النسبة</th></tr></thead>
                                    <tbody>{r.grades.map(x => (
                                        <tr key={x.g}><td style={td}>{x.g}</td><td style={td}>{x.total}</td><td style={td}>{x.avg.toFixed(1)}</td>
                                            <td style={td}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><div style={{ flex: 1, height: 8, background: '#e5e7eb', borderRadius: 99 }}><div style={{ width: `${x.pct}%`, height: 8, background: x.pct >= 50 ? '#10b981' : x.pct >= 25 ? '#f59e0b' : '#ef4444', borderRadius: 99 }} /></div><b>{x.pct}%</b></div></td></tr>
                                    ))}</tbody>
                                </table>

                                <div style={h2}>📞 الافتقاد (لكل خادم)</div>
                                {r.servants.length === 0 ? <p style={{ fontSize: 12, color: '#64748b' }}>لسه مفيش مجموعات متوزعة.</p> : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead><tr><th style={th}>الخادم</th><th style={th}>مجموعته</th><th style={th}>غياب</th><th style={th}>افتقد</th><th style={th}>ردوا</th><th style={th}>النسبة</th><th style={th}>⚡</th><th style={th}>ملاحظات</th></tr></thead>
                                        <tbody>{r.servants.map((x: any) => (
                                            <tr key={x.a.id}><td style={{ ...td, fontWeight: 800 }}>{x.a.name}</td><td style={td}>{x.size}</td><td style={td}>{x.absent}</td><td style={td}>{x.done}</td><td style={td}>{x.replied}</td>
                                                <td style={{ ...td, fontWeight: 900, color: x.pct >= 70 ? '#059669' : x.pct >= 30 ? '#d97706' : '#dc2626' }}>{x.absent ? `${x.pct}%` : '—'}</td><td style={{ ...td, color: x.quick ? '#d97706' : '#94a3b8' }}>{x.quick || '—'}</td><td style={td}>{x.notesN}</td></tr>
                                        ))}</tbody>
                                    </table>
                                )}
                                {r.trackingStart && <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>* تسجيل الافتقاد لكل اجتماع بدأ من {dShort(r.trackingStart)}، فالاجتماعات اللي قبل كده ممكن تبان أقل من الحقيقة. والمجموعات محسوبة على التوزيع الحالي. ⚡ = الخادم رجع للموقع بعد أقل من 5 ثواني من ما داس واتساب أو اتصال.</p>}

                                <div style={h2}>⭐ أكتر الأولاد التزامًا</div>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead><tr><th style={th}>#</th><th style={th}>الاسم</th><th style={th}>الصف</th><th style={th}>حضر</th><th style={th}>نقط الشهر</th></tr></thead>
                                    <tbody>{r.committed.map((x, i) => (
                                        <tr key={x.s.id}><td style={td}>{i + 1}</td><td style={{ ...td, fontWeight: 800 }}>{x.s.name}</td><td style={td}>{x.s.grade || ''}</td><td style={td}>{x.n} من {r.meetings.length}</td><td style={td}>{x.p}</td></tr>
                                    ))}</tbody>
                                </table>

                                {r.newKids.length > 0 && (<>
                                    <div style={h2}>🆕 أول مرة ييجوا الشهر ده ({r.newKids.length})</div>
                                    <p style={{ fontSize: 12, lineHeight: 1.9 }}>{r.newKids.map(s => s.name).join('، ')}</p>
                                </>)}

                                <div style={h2}>⚠️ ولاد بيبعدوا ({r.atRisk.length})</div>
                                {r.atRisk.length === 0 ? <p style={{ fontSize: 12, color: '#059669' }}>مفيش حد غايب {AT_RISK_STREAK} اجتماعات ورا بعض 🎉</p> : (
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead><tr><th style={th}>الاسم</th><th style={th}>الصف</th><th style={th}>غايب</th><th style={th}>آخر حضور</th><th style={th}>خادمه</th></tr></thead>
                                        <tbody>{r.atRisk.map(s => (
                                            <tr key={s.id}><td style={{ ...td, fontWeight: 800 }}>{s.name}</td><td style={td}>{s.grade || ''}</td><td style={td}>{followupInfo[s.id]?.streak} اجتماعات</td>
                                                <td style={td}>{dShort(followupInfo[s.id]?.lastAttendedDate)}</td><td style={td}>{admins.find(a => a.id === assignedServantId(s.id))?.name || '—'}</td></tr>
                                        ))}</tbody>
                                    </table>
                                )}
                                {r.never.length > 0 && (<>
                                    <div style={h2}>🚫 ماحضروش ولا مرة السنة دي ({r.never.length})</div>
                                    <p style={{ fontSize: 12, lineHeight: 1.9 }}>{r.never.map(s => s.name).join('، ')}</p>
                                </>)}
                            </>)}
                        </div>
                    </div>
                );
            })(), document.body)}

            <Modal isOpen={!!outcomeModal && !!loggedInAdmin} onClose={() => setOutcomeModal(null)}
                title={`📞 حصل إيه مع ${students.find(s => s.id === outcomeModal?.studentId)?.name || ''}؟`}>
                {outcomeModal && (() => {
                    const opts = OUTCOMES_BY_METHOD[outcomeModal.method] || OUTCOMES_BY_METHOD.manual;
                    const quick = outcomeModal.method !== 'manual' && outcomeModal.awayMs !== null && outcomeModal.awayMs < QUICK_MS;
                    return (
                        <div className="space-y-3">
                            {quick && (
                                <p className="text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-xl p-2.5">
                                    ⚡ رجعت بسرعة. لو لسه مابعتّش أو ماكلمتش، دوس "لسه ماعملتش" تحت.
                                </p>
                            )}
                            <div className="space-y-2">
                                {opts.map(o => (
                                    <button key={o} type="button" onClick={() => finishFollowupContact(o)}
                                        className={`w-full text-right flex items-center gap-3 rounded-xl border px-3.5 py-3 font-bold ${o === 'unreachable' ? 'border-red-400/30 bg-red-500/10 text-red-100' : isRepliedOutcome(o) ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100' : 'border-white/15 bg-white/5 text-white'}`}>
                                        <span className="text-xl">{FOLLOWUP_OUTCOMES[o].icon}</span>
                                        <span>{FOLLOWUP_OUTCOMES[o].label}</span>
                                    </button>
                                ))}
                            </div>
                            <textarea value={outcomeNote} onChange={(e) => setOutcomeNote(e.target.value)} rows={2} maxLength={500}
                                placeholder="ملاحظة (اختياري) — ولو معرفتش توصله لازم تكتب ليه"
                                className="w-full glass-input rounded-xl px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                            <button type="button" onClick={cancelFollowupContact} className="w-full text-sm font-bold text-white/60 py-2 rounded-xl border border-white/10">لسه ماعملتش (ماتحسبش)</button>
                        </div>
                    );
                })()}
            </Modal>

            <Modal isOpen={!!notesStudentId && !!loggedInAdmin} onClose={() => { setNotesStudentId(''); setNoteDraft(''); }}
                title={`📝 ملاحظات: ${students.find(s => s.id === notesStudentId)?.name || ''}`}>
                {(() => {
                    const st = students.find(s => s.id === notesStudentId);
                    if (!st || !loggedInAdmin) return null;
                    const list = visibleNotesOf(st);
                    const seesAll = canSeeAllNotesOf(st);
                    const fmtNoteAt = (iso) => {
                        const d = new Date(iso);
                        return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' });
                    };
                    return (
                        <div className="space-y-4">
                            <div className="text-xs text-white/55">
                                {st.grade ? `${st.grade} • ` : ''}{assignedServantId(st.id) ? `خادمه: ${admins.find(a => a.id === assignedServantId(st.id))?.name || ''}` : 'مالوش خادم افتقاد'}
                            </div>
                            <div className="space-y-2">
                                <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} rows={3} maxLength={1000}
                                    placeholder="اكتب ملاحظة… (مثلًا: عنده امتحانات لحد آخر الشهر)"
                                    className="w-full glass-input rounded-xl px-3 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                                <button type="button" disabled={!noteDraft.trim()}
                                    onClick={async () => { const ok = await addNote(st.id, noteDraft); if (ok) { setNoteDraft(''); showToast('✅ اتحفظت الملاحظة.'); } }}
                                    className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-indigo-950 font-black py-2.5 rounded-xl">حفظ الملاحظة</button>
                                <p className="text-[11px] text-white/45 leading-relaxed">
                                    الملاحظة بيشوفها خادم الولد وأمين الفصل والمساعدين والأمين العام. الأولاد مابيشوفوهاش.
                                    اكتب الحاجات العملية بس، ومتكتبش أسرار عائلية أو تفاصيل حساسة.
                                </p>
                                {loggedInAdmin.isSuperAdmin && notesDocKB > 700 && (
                                    <p className="text-[11px] text-red-300 font-bold">⚠️ مساحة الملاحظات قربت تخلص ({notesDocKB} KB من 1024). قول لـClaude.</p>
                                )}
                            </div>
                            <div className="space-y-2">
                                <h3 className="text-sm font-black text-white/80">{seesAll ? `كل الملاحظات (${list.length})` : `ملاحظاتك إنت (${list.length})`}</h3>
                                {list.length === 0 ? (
                                    <p className="text-center text-sm text-white/45 py-3">لسه مفيش ملاحظات.</p>
                                ) : list.map((n: any) => (
                                    <div key={n.id} className="rounded-xl border border-white/12 bg-white/5 p-3 space-y-1.5">
                                        <div className="text-sm text-white whitespace-pre-wrap break-words">{n.text}</div>
                                        <div className="flex items-center justify-between gap-2 text-[11px]">
                                            <span className="text-sky-300">✍️ {n.by} • <span className="text-white/45">{fmtNoteAt(n.at)}</span></span>
                                            {(loggedInAdmin.isSuperAdmin || n.byId === loggedInAdmin.id) && (
                                                <button type="button" onClick={() => deleteNote(st.id, n)} className="text-red-300 font-bold px-2 py-0.5 rounded-md hover:bg-red-500/15">مسح</button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            <Modal isOpen={isScannerOpen} onClose={() => setScannerOpen(false)} title="مسح كود الشاب">
                <QRScanner onScanSuccess={handleScanSuccess} onScanFailure={handleScanFailure} />
            </Modal>
            
            <Modal isOpen={!!studentForAttendance} onClose={() => setStudentForAttendance(null)} title={`تسجيل نقاط لـ: ${studentForAttendance?.name}`}>
                {studentForAttendance && (
                     <PointActions
                        student={studentForAttendance}
                        addPoints={addPoints}
                        onActionAfterAdd={() => setStudentForAttendance(null)}
                        fromScan={true}
                        selectedDate={isSuperAdmin ? selectedDate : null}
                    />
                )}
            </Modal>
            
            <Modal isOpen={!!studentForBarcode} onClose={() => setStudentForBarcode(null)} title={`باركود: ${studentForBarcode?.name}`}>
                {studentForBarcode && (
                    <div>
                        <BarcodeDisplay studentId={studentForBarcode.id} />
                        <p className="text-center text-indigo-300 mt-4 text-sm">
                            هذا هو الباركود الخاص بالطالب. يمكنه حفظه كصورة على موبايله لاستخدامه في تسجيل الحضور.
                        </p>
                    </div>
                )}
            </Modal>

            <Modal isOpen={!!scannedStudent} onClose={() => setScannedStudent(null)} title="تم تسجيل الحضور">
                {scannedStudent && (
                    <div className="text-center">
                        <h3 className="text-2xl font-bold text-green-400 mb-2">{scannedStudent.name}</h3>
                        <p className="text-lg">نقاطك الحالية: <span className="font-bold text-amber-400">{scannedStudent.points}</span></p>
                        <button onClick={() => setScannedStudent(null)} className="mt-6 bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                            حسنًا
                        </button>
                    </div>
                )}
            </Modal>
            
            <Modal isOpen={isAuthModalOpen} onClose={() => setAuthModalOpen(false)} title="دخول الخدام">
                {!selectedAdmin ? (
                    <div>
                        <p className='text-indigo-300 mb-4'>الرجاء اختيار اسمك من القائمة:</p>
                        <div className="flex flex-col gap-3">
                            {superAdmin && (
                                <button
                                    key={superAdmin.id}
                                    onClick={() => setSelectedAdmin(superAdmin)}
                                    className="w-full bg-indigo-700 hover:bg-indigo-600 text-amber-400 font-bold py-3 px-4 rounded-lg transition-colors border-2 border-amber-500/50"
                                >
                                    {superAdmin.name}
                                </button>
                            )}
                            {otherAdmins.map(admin => (
                                <button
                                    key={admin.id}
                                    onClick={() => setSelectedAdmin(admin)}
                                    className="w-full bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-3 px-4 rounded-lg transition-colors"
                                >
                                    {admin.name}
                                </button>
                            ))}
                        </div>
                    </div>
                ) : (
                    <form onSubmit={handlePinSubmit}>
                        <p className='text-indigo-300 mb-4'>أهلاً, <span className="font-bold text-amber-400">{selectedAdmin.name}</span>. الرجاء إدخال الرقم السري.</p>
                        <input
                            type="password"
                            value={pinInput}
                            onChange={(e) => setPinInput(e.target.value)}
                            className="w-full bg-indigo-800 text-white border border-indigo-700 rounded-lg px-4 py-2 mb-4 text-center tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                            placeholder="••••"
                            autoFocus
                        />
                        {authError && <p className="text-red-400 text-sm mb-4">{authError}</p>}
                        <div className="flex gap-4">
                            <button type="button" onClick={() => setSelectedAdmin(null)} className="w-full bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                رجوع
                            </button>
                            <button type="submit" className="w-full bg-amber-500 hover:bg-amber-600 text-white font-bold py-2 px-4 rounded-lg transition-colors">
                                دخول
                            </button>
                        </div>
                    </form>
                )}
            </Modal>

            <Modal isOpen={!!studentToDelete} onClose={() => setStudentToDelete(null)} title="تأكيد الحذف">
                {studentToDelete && (
                    <div className="text-center">
                        <p className="text-lg text-indigo-200 mb-6">
                            هل أنت متأكد أنك تريد حذف <span className="font-bold text-amber-400">{studentToDelete.name}</span>؟<br />
                            <span className="text-sm text-red-400">لا يمكن التراجع عن هذا الإجراء.</span>
                        </p>
                        <div className="flex justify-center gap-4">
                            <button 
                                onClick={() => setStudentToDelete(null)}
                                className="bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={confirmDeleteStudent}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                            >
                                نعم, احذف
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
            
            <Modal isOpen={!!pointToDelete} onClose={() => setPointToDelete(null)} title="تأكيد حذف النقطة">
                {pointToDelete && (
                    <div className="text-center">
                        <p className="text-lg text-indigo-200 mb-4">
                            هل أنت متأكد من حذف هذه النقطة للمخدوم <span className="font-bold text-amber-400">{students.find(s => s.id === pointToDelete.studentId)?.name}</span>؟
                        </p>
                        <div className="bg-indigo-900/80 border border-indigo-700 p-3 rounded-lg mb-6 text-right space-y-1 text-sm">
                            <p><strong>النوع:</strong> {pointToDelete.record.typeName}</p>
                            <p><strong>النقاط:</strong> <span className={`font-bold ${pointToDelete.record.points > 0 ? 'text-green-400' : 'text-red-400'}`}>{pointToDelete.record.points > 0 ? `+${pointToDelete.record.points}`: pointToDelete.record.points}</span></p>
                            <p><strong>أضيفت بواسطة:</strong> {pointToDelete.record.recordedBy}</p>
                            {pointToDelete.record.description && <p><strong>السبب:</strong> {pointToDelete.record.description}</p>}
                        </div>
                        <div className="flex justify-center gap-4">
                            <button 
                                onClick={() => setPointToDelete(null)}
                                className="bg-indigo-700 hover:bg-indigo-600 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                            >
                                إلغاء
                            </button>
                            <button
                                onClick={confirmDeletePointEntry}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                            >
                                نعم, احذف
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
            
             <Modal isOpen={isBackupModalOpen} onClose={() => setBackupModalOpen(false)} title="النسخ الاحتياطي والبيانات">
                <div className="space-y-6 text-center">
                    <p className="text-indigo-300">
                        يمكنك استخدام هذه الأدوات لحفظ بيانات الحضور والنقاط، أو لاستعادتها ومشاهدة الترتيب.
                    </p>
                    
                    {isAuthenticated && (
                        <div className="bg-indigo-800/50 p-4 rounded-lg border border-indigo-700">
                            <h3 className="text-lg font-bold text-amber-400 mb-2">تصدير البيانات</h3>
                            <p className="text-sm text-indigo-300 mb-4">
                                قم بتحميل ملف يحتوي على كل أسماء الخدام والمخدومين والنقاط الحالية.
                            </p>
                            <button 
                                onClick={handleExportData}
                                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                            >
                                <CloudArrowUpIcon className="w-5 h-5 rotate-180" />
                                <span>تحميل نسخة احتياطية</span>
                            </button>
                        </div>
                    )}

                    {isAuthenticated && (
                    <div className="bg-indigo-800/50 p-4 rounded-lg border border-indigo-700">
                        <h3 className="text-lg font-bold text-sky-400 mb-2">استعادة / عرض البيانات</h3>
                        <p className="text-sm text-indigo-300 mb-4">
                            اختر ملف النسخة الاحتياطية لعرض الترتيب أو استعادة البيانات.
                        </p>
                        <label className="w-full bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer">
                            <CloudArrowUpIcon className="w-5 h-5" />
                            <span>رفع ملف البيانات</span>
                            <input 
                                type="file" 
                                accept=".json"
                                onChange={handleImportData}
                                className="hidden"
                            />
                        </label>
                    </div>
                    )}
                </div>
            </Modal>

            <Modal isOpen={isAddStudentModalOpen} onClose={() => setAddStudentModalOpen(false)} title="إضافة شاب جديد">
                 <div className="space-y-4">
                    <div>
                         <label htmlFor="new-student-name" className="block text-sm font-medium text-indigo-300 mb-2">الاسم</label>
                         <input
                             id="new-student-name"
                             type="text"
                             value={newStudentName}
                             onChange={(e) => setNewStudentName(e.target.value)}
                             placeholder="الاسم الثلاثي"
                             className="w-full bg-indigo-800 text-white placeholder-indigo-400 border border-indigo-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                         />
                    </div>
                    <div>
                         <label htmlFor="new-student-phone" className="block text-sm font-medium text-indigo-300 mb-2">رقم الموبايل</label>
                         <input
                             id="new-student-phone"
                             type="tel"
                             value={newStudentPhone}
                             onChange={(e) => setNewStudentPhone(e.target.value)}
                             placeholder="012XXXXXXXX"
                             className="w-full bg-indigo-800 text-white placeholder-indigo-400 border border-indigo-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                         />
                    </div>
                    <div>
                         <label htmlFor="new-student-grade" className="block text-sm font-medium text-indigo-300 mb-2">الصف الدراسي</label>
                         <select
                             id="new-student-grade"
                             value={newStudentGrade}
                             onChange={(e) => setNewStudentGrade(e.target.value)}
                             className="w-full bg-indigo-800 text-white border border-indigo-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                         >
                             <option value="">اختر الصف الدراسي</option>
                             <option value="أولى ثانوي">أولى ثانوي</option>
                             <option value="تانية ثانوي">تانية ثانوي</option>
                             <option value="تالتة ثانوي">تالتة ثانوي</option>
                         </select>
                    </div>
                     <button
                         onClick={addStudent}
                         disabled={!newStudentName.trim() || !newStudentPhone.trim() || !newStudentGrade.trim()}
                         className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg transition-colors disabled:bg-gray-500 disabled:cursor-not-allowed !mt-6"
                     >
                         <UserPlusIcon className="w-5 h-5" />
                         <span>إضافة</span>
                     </button>
                 </div>
            </Modal>
            
            <Modal isOpen={isAdminManagementModalOpen} onClose={() => setAdminManagementModalOpen(false)} title="إدارة الخدام">
                {(() => {
                    const servants = admins.filter(a => !a.isSuperAdmin);
                    const fullCount = servants.filter(a => a.role !== 'followup' && !a.isLocked).length;
                    const gradeOptions = ['أولى ثانوي', 'تانية ثانوي', 'تالتة ثانوي'];
                    const roleAvatar = { followup: 'bg-rose-500/20 text-rose-200', full: 'bg-sky-500/20 text-sky-200', class_leader: 'bg-emerald-500/20 text-emerald-200', assistant: 'bg-amber-500/20 text-amber-200' };
                    const followupCount = servants.filter(a => a.role === 'followup' && !a.isLocked).length;
                    const lockedCount = servants.filter(a => a.isLocked).length;
                    const groupSize = (id) => students.filter(s => followup.assignments?.[s.id] === id).length;
                    const sectionBtn = (id, icon, label, tone) => (
                        <button type="button" onClick={() => setAdminSectionOpen(adminSectionOpen === id ? '' : id)}
                            className={`w-full flex items-center justify-between gap-2 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${tone}`}>
                            <span>{icon} {label}</span>
                            <span className="text-xs opacity-70">{adminSectionOpen === id ? '▲' : '▼'}</span>
                        </button>
                    );
                    const inputCls = "w-full bg-indigo-950 text-white placeholder-indigo-400 border border-indigo-700 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500";
                    return (
                        <div className="space-y-4">
                            {/* ملخص */}
                            <div className="grid grid-cols-3 gap-2 text-center">
                                <div className="bg-sky-500/10 border border-sky-400/30 rounded-xl py-2">
                                    <div className="text-xl font-black text-sky-300">{fullCount}</div>
                                    <div className="text-[10px] text-sky-200 font-bold">خادم كامل وفوق</div>
                                </div>
                                <div className="bg-rose-500/10 border border-rose-400/30 rounded-xl py-2">
                                    <div className="text-xl font-black text-rose-300">{followupCount}</div>
                                    <div className="text-[10px] text-rose-200 font-bold">افتقاد بس</div>
                                </div>
                                <div className="bg-slate-500/10 border border-slate-400/30 rounded-xl py-2">
                                    <div className="text-xl font-black text-slate-300">{lockedCount}</div>
                                    <div className="text-[10px] text-slate-300 font-bold">معطّل</div>
                                </div>
                            </div>

                            {/* إضافة خادم */}
                            {sectionBtn('add', '➕', 'إضافة خادم جديد', 'bg-sky-600 hover:bg-sky-700 text-white')}
                            {adminSectionOpen === 'add' && (
                                <div className="bg-indigo-900/60 border border-indigo-700/60 rounded-xl p-3 space-y-3">
                                    <input type="text" value={newAdminName} onChange={(e) => setNewAdminName(e.target.value)} placeholder="اسم الخادم (زي ما هيظهر في الافتقاد)" className={inputCls} />
                                    <input type="password" inputMode="numeric" value={newAdminPin} onChange={(e) => setNewAdminPin(e.target.value)} placeholder="الرقم السري (6 أرقام على الأقل)" className={inputCls} />
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(ROLE_INFO).map(([id, info]) => ({ id, ...info })).map(r => (
                                            <button key={r.id} type="button" onClick={() => setNewAdminRole(r.id)}
                                                className={`text-right rounded-xl border p-2.5 transition-colors ${newAdminRole === r.id ? 'bg-amber-500/15 border-amber-400' : 'bg-indigo-950/60 border-indigo-700'}`}>
                                                <div className={`text-sm font-black ${newAdminRole === r.id ? 'text-amber-300' : 'text-white'}`}>{newAdminRole === r.id ? '◉' : '○'} {r.icon} {r.title}</div>
                                                <div className="text-[10px] text-indigo-300 mt-1 leading-relaxed">{r.desc}</div>
                                            </button>
                                        ))}
                                    </div>
                                    {newAdminRole === 'class_leader' && (
                                        <select value={newAdminGrade} onChange={(e) => setNewAdminGrade(e.target.value)} className={inputCls}>
                                            {gradeOptions.map(g => <option key={g} value={g}>أمين فصل {g}</option>)}
                                        </select>
                                    )}
                                    <button onClick={handleAddAdmin} disabled={!newAdminName.trim() || !newAdminPin.trim()}
                                        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg transition-colors">
                                        <UserPlusIcon className="w-5 h-5" />
                                        <span>إضافة الخادم</span>
                                    </button>
                                </div>
                            )}

                            {/* قايمة الخدام */}
                            <div>
                                <h3 className="text-sm font-black text-indigo-200 mb-2">الخدام ({servants.length})</h3>
                                {servants.length === 0 ? (
                                    <p className="text-center text-indigo-300 text-sm py-4">لسه مفيش خدام. ضيف أول خادم من فوق.</p>
                                ) : (
                                    <div className="space-y-2.5">
                                        {servants.map(admin => {
                                            const roleKey = adminRoleKey(admin);
                                            const size = groupSize(admin.id);
                                            return (
                                                <div key={admin.id} className={`rounded-xl border p-3 space-y-2.5 ${admin.isLocked ? 'bg-slate-800/40 border-slate-600/40 opacity-75' : 'bg-indigo-900/50 border-indigo-700/50'}`}>
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-10 h-10 shrink-0 rounded-full flex items-center justify-center font-black text-lg ${roleAvatar[roleKey]}`}>
                                                            {String(admin.name || '?').trim().charAt(0)}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="font-bold text-white truncate">{admin.name}</div>
                                                            <div className="text-[11px] text-indigo-300">
                                                                {admin.isLocked ? <span className="text-red-300 font-bold">● معطّل</span> : <span className="text-green-300 font-bold">● نشط</span>}
                                                                <span> • {ROLE_INFO[roleKey].icon} {ROLE_INFO[roleKey].title}{roleKey === 'class_leader' && admin.leaderGrade ? ` ${admin.leaderGrade}` : ''}</span>
                                                                {size > 0 && <span> • مجموعته {size} ولد</span>}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* الصلاحية */}
                                                    <div className="grid grid-cols-2 gap-1 p-1 bg-indigo-950/70 rounded-lg text-xs font-bold">
                                                        {Object.entries(ROLE_INFO).map(([id, info]: [string, any]) => (
                                                            <button key={id} type="button" onClick={() => { if (roleKey !== id) handleSetAdminRole(admin.id, id); }}
                                                                className={`py-1.5 rounded-md transition-colors ${roleKey === id ? 'bg-amber-500 text-indigo-950' : 'text-indigo-200'}`}>{info.icon} {info.title}</button>
                                                        ))}
                                                    </div>
                                                    {roleKey === 'class_leader' && (
                                                        <select value={admin.leaderGrade || ''} onChange={(e) => handleSetAdminRole(admin.id, 'class_leader', e.target.value)} className={inputCls}>
                                                            {!admin.leaderGrade && <option value="">اختار الصف</option>}
                                                            {gradeOptions.map(g => <option key={g} value={g}>أمين فصل {g}</option>)}
                                                        </select>
                                                    )}

                                                    {admin.failedAttempts >= 5 && (
                                                        <button onClick={() => handleUnlockAdminByFailure(admin.id)}
                                                            className="w-full flex items-center justify-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold py-1.5 rounded-lg">
                                                            <KeyIcon className="w-3 h-3" /> اتقفل بعد 5 محاولات غلط — دوس لفتحه
                                                        </button>
                                                    )}

                                                    {editingAdminId === admin.id ? (
                                                        <div className="flex items-center gap-2">
                                                            <input type="password" inputMode="numeric" value={editingAdminPinValue} onChange={e => setEditingAdminPinValue(e.target.value)}
                                                                placeholder="الرقم السري الجديد (6 أرقام)" className={inputCls} autoFocus />
                                                            <button onClick={() => handleSaveAdminPin(admin.id)} className="text-green-300 p-2 rounded-lg bg-indigo-950"><CheckIcon className="w-5 h-5" /></button>
                                                            <button onClick={() => setEditingAdminId(null)} className="text-red-300 p-2 rounded-lg bg-indigo-950"><XIcon className="w-5 h-5" /></button>
                                                        </div>
                                                    ) : (
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <button onClick={() => handleStartEditPin(admin)}
                                                                className="bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-bold py-2 rounded-lg">🔑 تغيير الرقم السري</button>
                                                            <button onClick={() => handleToggleAdminStatus(admin.id)}
                                                                className={`text-xs font-bold py-2 rounded-lg text-white ${admin.isLocked ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600/80 hover:bg-red-700'}`}>
                                                                {admin.isLocked ? '✅ تفعيل الحساب' : '⛔ تعطيل الحساب'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* حسابي */}
                            {sectionBtn('pin', '🔑', 'تغيير رقمي السري', 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30')}
                            {adminSectionOpen === 'pin' && (
                                <div className="bg-indigo-900/60 border border-amber-500/30 rounded-xl p-3 space-y-2">
                                    <input type="password" inputMode="numeric" value={ownPinCurrent} onChange={e => setOwnPinCurrent(e.target.value)} placeholder="رقمك السري الحالي" className={inputCls} />
                                    <input type="password" inputMode="numeric" value={ownPinNew} onChange={e => setOwnPinNew(e.target.value)} placeholder="الرقم الجديد (6 أرقام على الأقل)" className={inputCls} />
                                    <input type="password" inputMode="numeric" value={ownPinConfirm} onChange={e => setOwnPinConfirm(e.target.value)} placeholder="اكتب الرقم الجديد تاني للتأكيد" className={inputCls} />
                                    <button onClick={handleChangeOwnPin} disabled={!ownPinCurrent || !ownPinNew || !ownPinConfirm}
                                        className="w-full bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-indigo-950 font-bold py-2 rounded-lg">حفظ رقمي الجديد</button>
                                </div>
                            )}

                            {/* منطقة حساسة */}
                            {sectionBtn('season', '🔄', 'بداية سنة جديدة', 'bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30')}
                            {adminSectionOpen === 'season' && (
                                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 space-y-2">
                                    <p className="text-xs text-red-200/90 leading-relaxed">بتنقل نقط السنة دي لـ"نقاط السنين السابقة" لكل الأولاد، وتصفّر نقط السنة وسجل الحضور. بتحمّل نسخة احتياطية الأول، وبتسألك مرتين.</p>
                                    <button type="button" onClick={handleStartNewSeason} className="w-full bg-red-600 hover:bg-red-700 text-white font-bold py-2 rounded-lg">بداية سنة جديدة</button>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </Modal>

            
             {/* --- Selected Badge Detail Popup Modal --- */}
             <Modal 
                 isOpen={!!selectedBadgeDetail} 
                 onClose={() => setSelectedBadgeDetail(null)} 
                 title="تفاصيل وسام التميز"
             >
                 {selectedBadgeDetail && (
                     <div className="text-center space-y-4">
                         <span className="text-6xl block drop-shadow-lg p-2 animate-[bounce_2s_infinite]">{selectedBadgeDetail.emoji}</span>
                         <h3 className="text-2xl font-bold bg-gradient-to-r from-amber-400 to-yellow-300 bg-clip-text text-transparent">{selectedBadgeDetail.name}</h3>
                         <p className="text-base text-indigo-100 font-medium">{selectedBadgeDetail.description}</p>
                         <div className="bg-indigo-950/75 p-4 rounded-xl border border-indigo-900 shadow-inner mt-4 text-right">
                             <div className="flex justify-between items-center text-xs text-indigo-300 mb-1.5">
                                 <span className="font-bold flex items-center gap-1">📈 نسبة الإكمال الحالية:</span>
                                 <span className="font-mono font-black text-amber-300 bg-indigo-900/60 px-2 py-0.5 rounded-md border border-indigo-800">{selectedBadgeDetail.progress}</span>
                             </div>
                             <div className="w-full bg-slate-900 rounded-full h-3.5 overflow-hidden border border-indigo-900 p-0.5 font-mono">
                                 <div 
                                     className={`h-full rounded-full bg-gradient-to-r ${selectedBadgeDetail.color}`}
                                     style={{ width: `${Math.min(100, (parseFloat(selectedBadgeDetail.progress.split('/')[0]) / parseFloat(selectedBadgeDetail.progress.split('/')[1])) * 100)}%` }}
                                 ></div>
                             </div>
                         </div>
                         <div className="pt-2 text-xs text-slate-400">
                             {selectedBadgeDetail.isUnlocked ? (
                                 <span className="text-green-400 font-black text-sm flex items-center justify-center gap-1.5">
                                     🌟 مبروك! لقد تم تحقيق هذا الإنجاز بنجاح!
                                 </span>
                             ) : (
                                 <span className="text-indigo-300 text-xs">
                                     واصل الحضور والنشاط والقداس والاعتراف لفتح هذا الوسام الخاص بك!
                                 </span>
                             )}
                         </div>
                     </div>
                 )}
             </Modal>

             {/* --- iOS Installation Guide Modal --- */}
             <Modal 
                 isOpen={showIOSInstallGuide} 
                 onClose={() => setShowIOSInstallGuide(false)} 
                 title="تثبيت التطبيق على الـ iPhone 📲"
             >
                 <div className="space-y-5 text-right font-sans" dir="rtl">
                     <p className="text-sm text-indigo-200 leading-relaxed">
                         لتثبيت تطبيق <span className="text-amber-400 font-bold">Points</span> على جهاز الايفون الخاص بك والوصول إليه بسرعة وبدون إنترنت، اتبع هذه الخطوات البسيطة في متصفح <span className="text-amber-400 font-bold">Safari</span>:
                     </p>
                     
                     <div className="space-y-4">
                         <div className="flex items-start gap-3.5 bg-indigo-900/40 p-3 rounded-xl border border-indigo-800/40">
                             <div className="bg-amber-500/20 text-amber-400 font-black text-xs w-6 h-6 flex items-center justify-center rounded-full shrink-0 mt-0.5">
                                 ١
                             </div>
                             <div>
                                 <h4 className="font-bold text-white text-sm mb-1">اضغط على زر المشاركة (Share) 📤</h4>
                                 <p className="text-xs text-indigo-300 leading-relaxed">
                                     تجد هذا الزر في شريط الأدوات بالأسفل بمتصفح Safari (أيقونة المربع التي يخرج منها سهم لأعلى).
                                 </p>
                             </div>
                         </div>

                         <div className="flex items-start gap-3.5 bg-indigo-900/40 p-3 rounded-xl border border-indigo-800/40">
                             <div className="bg-amber-500/20 text-amber-400 font-black text-xs w-6 h-6 flex items-center justify-center rounded-full shrink-0 mt-0.5">
                                 ٢
                             </div>
                             <div>
                                 <h4 className="font-bold text-white text-sm mb-1">اختر "إضافة إلى الشاشة الرئيسية" ➕</h4>
                                 <p className="text-xs text-indigo-300 leading-relaxed">
                                     اسحب القائمة لأسفل حتى تجد خيار <span className="text-white font-bold">"إضافة إلى الشاشة الرئيسية"</span> أو <span className="font-mono text-white">"Add to Home Screen"</span> واضغط عليه.
                                 </p>
                             </div>
                         </div>

                         <div className="flex items-start gap-3.5 bg-indigo-900/40 p-3 rounded-xl border border-indigo-800/40">
                             <div className="bg-amber-500/20 text-amber-400 font-black text-xs w-6 h-6 flex items-center justify-center rounded-full shrink-0 mt-0.5">
                                 ٣
                             </div>
                             <div>
                                 <h4 className="font-bold text-white text-sm mb-1">اضغط على "إضافة" (Add) 🌟</h4>
                                 <p className="text-xs text-indigo-300 leading-relaxed">
                                     اضغط على كلمة <span className="text-amber-400 font-bold">"إضافة"</span> أو <span className="font-mono text-amber-400 font-bold">"Add"</span> في أعلى اليمين لتأكيد التثبيت.
                                 </p>
                             </div>
                         </div>
                     </div>

                     <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl text-center">
                         <p className="text-xs text-amber-300 font-bold">
                             🎉 مبروك! سيظهر رمز التطبيق الآن على شاشتك الرئيسية بجوار تطبيقاتك المفضلة!
                         </p>
                     </div>

                     <button 
                         onClick={() => setShowIOSInstallGuide(false)}
                         className="w-full bg-gradient-to-r from-amber-500 to-yellow-600 text-slate-950 font-black py-2.5 rounded-xl hover:from-amber-400 hover:to-yellow-500 transition-all text-sm shadow-md active:scale-[0.98]"
                     >
                         فهمت، سأقوم بالتثبيت الآن
                     </button>
                 </div>
             </Modal>

{toastMessage && (
                <div className={`fixed ${loggedInAdmin ? 'bottom-24' : 'bottom-6'} right-6 left-6 sm:left-auto z-50 bg-indigo-900 text-white py-2 px-5 rounded-lg shadow-xl border border-indigo-700 animate-fade-in-out text-center sm:text-right`}>
                    <p>{toastMessage}</p>
                </div>
            )}
        
            
            {/* --- Manual Monthly Champion Reward Modal --- */}
            <Modal
                isOpen={isMonthlyChampionModalOpen}
                onClose={() => setMonthlyChampionModalOpen(false)}
                title="🏆 منح مكافأة بطل الشهر / المراكز الأولى يدويًا"
            >
                <div className="space-y-4 text-right font-sans" dir="rtl">
                    <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl">
                        <p className="text-xs text-amber-300 leading-relaxed font-semibold">
                            💡 تتيح لك هذه الخاصية إضافة مكافأة للأول في الشهر أو المراكز الأولى يدويًا، مع تحديد عدد النقاط وتاريخ تسجيلها في <strong className="text-white">أول جمعة في الشهر التالي</strong>.
                        </p>
                    </div>

                    {/* Month Selection */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">عن أي شهر:</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setRewardTargetMonth('prev');
                                    const prevPrefix = getCairoMonthPrefixOffset(-1);
                                    const prevDate = new Date(`${prevPrefix}-01T12:00:00Z`);
                                    const firstFri = getFirstFridayOfFollowingMonth(prevDate);
                                    setRewardDate(firstFri);
                                    const mName = getArabicMonthNameFromPrefix(prevPrefix).split(' ')[0];
                                    setRewardCustomDesc(`مكافأة ${rewardRankTitle} عن شهر ${mName}`);
                                }}
                                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${rewardTargetMonth === 'prev' ? 'bg-amber-500 text-indigo-950 font-black shadow' : 'bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800'}`}
                            >
                                الشهر السابق ({getArabicMonthNameFromPrefix(getCairoMonthPrefixOffset(-1)).split(' ')[0]})
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setRewardTargetMonth('current');
                                    const curPrefix = getCairoMonthPrefix();
                                    const curDate = new Date(`${curPrefix}-01T12:00:00Z`);
                                    const firstFri = getFirstFridayOfFollowingMonth(curDate);
                                    setRewardDate(firstFri);
                                    const mName = getArabicMonthNameFromPrefix(curPrefix).split(' ')[0];
                                    setRewardCustomDesc(`مكافأة ${rewardRankTitle} عن شهر ${mName}`);
                                }}
                                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all ${rewardTargetMonth === 'current' ? 'bg-amber-500 text-indigo-950 font-black shadow' : 'bg-indigo-900/60 text-indigo-300 hover:bg-indigo-800'}`}
                            >
                                الشهر الحالي ({getArabicMonthNameFromPrefix(getCairoMonthPrefix()).split(' ')[0]})
                            </button>
                        </div>
                    </div>

                    {/* Student Select */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">اختر الشاب المستحق للمكافأة:</label>
                        <select
                            value={rewardStudentId}
                            onChange={(e) => setRewardStudentId(e.target.value)}
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-400"
                        >
                            <option value="">-- اضغط لاختيار الشاب --</option>
                            {students.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.name} ({s.points || 0} نقطة)
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Rank Preset Selector */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">المركز / الترتيب:</label>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { rank: 'المركز الأول', pts: '20', emoji: '🥇' },
                                { rank: 'المركز الثاني', pts: '15', emoji: '🥈' },
                                { rank: 'المركز الثالث', pts: '10', emoji: '🥉' }
                            ].map(item => (
                                <button
                                    key={item.rank}
                                    type="button"
                                    onClick={() => {
                                        setRewardRankTitle(item.rank);
                                        setRewardPoints(item.pts);
                                        const tPrefix = rewardTargetMonth === 'prev'
                                            ? getCairoMonthPrefixOffset(-1)
                                            : getCairoMonthPrefix();
                                        const mName = getArabicMonthNameFromPrefix(tPrefix).split(' ')[0];
                                        setRewardCustomDesc(`مكافأة ${item.rank} عن شهر ${mName}`);
                                    }}
                                    className={`py-2 px-2 rounded-lg text-xs font-bold flex flex-col items-center gap-1 transition-all ${rewardRankTitle === item.rank ? 'bg-amber-400 text-indigo-950 font-black shadow-md' : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'}`}
                                >
                                    <span>{item.emoji} {item.rank}</span>
                                    <span className="text-[11px] opacity-80">(+{item.pts} نقطة)</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Points Input */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">عدد النقاط الممنوحة:</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                value={rewardPoints}
                                onChange={(e) => setRewardPoints(e.target.value)}
                                placeholder="مثلاً 20"
                                className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-base font-bold text-center focus:outline-none focus:border-amber-400"
                            />
                            <span className="text-amber-400 font-bold text-sm shrink-0">نقطة</span>
                        </div>
                    </div>

                    {/* Date Field (Defaults to First Friday of following month) */}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs text-indigo-300 font-bold">تاريخ تسجيل المكافأة:</label>
                            <span className="text-[11px] text-amber-300 font-semibold bg-amber-400/15 px-2 py-0.5 rounded border border-amber-400/30">
                                📅 أول جمعة في الشهر التالي ({rewardDate})
                            </span>
                        </div>
                        <input
                            type="date"
                            value={rewardDate}
                            onChange={(e) => setRewardDate(e.target.value)}
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-400 font-mono"
                        />
                        <p className="text-[11px] text-indigo-300 mt-1">
                            تم ضبط التاريخ تلقائياً على أول جمعة في الشهر التالي ({rewardDate}) ويمكنك تغييره يدوياً إذا رغبت.
                        </p>
                    </div>

                    {/* Description / Reason */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">البيان / الوصف (يظهر في سجل الشاب):</label>
                        <input
                            type="text"
                            value={rewardCustomDesc}
                            onChange={(e) => setRewardCustomDesc(e.target.value)}
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-sm focus:outline-none focus:border-amber-400"
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button
                            type="button"
                            onClick={handleGrantMonthlyChampionReward}
                            className="flex-1 bg-gradient-to-r from-amber-500 to-yellow-600 hover:from-amber-400 hover:to-yellow-500 text-indigo-950 font-black py-3 rounded-xl transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 text-sm md:text-base"
                        >
                            <span>🏆</span>
                            <span>إضافة المكافأة للشاب الآن</span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setMonthlyChampionModalOpen(false)}
                            className="bg-indigo-800 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors text-sm"
                        >
                            إلغاء
                        </button>
                    </div>
                </div>
            </Modal>

            {/* --- Manual Badges Reward Modal --- */}
            <Modal
                isOpen={isBadgeRewardModalOpen && !!badgeRewardStudent}
                onClose={() => setBadgeRewardModalOpen(false)}
                title={`🎖️ منح مكافأة تجميع الأوسمة لـ (${badgeRewardStudent?.name})`}
            >
                <div className="space-y-4 text-right font-sans" dir="rtl">
                    <div className="bg-purple-500/10 border border-purple-500/30 p-3 rounded-xl">
                        <p className="text-xs text-purple-200 leading-relaxed font-semibold">
                            ✨ تجميع الأوسمة يتم مكافأته يدويًا من خلالك. حدد عدد النقاط والتاريخ الذي ترغب في إضافته للشاب.
                        </p>
                    </div>

                    {/* Points Presets */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">عدد النقاط الممنوحة:</label>
                        <div className="flex gap-2 mb-2">
                            {['15', '20', '25', '30'].map(pts => (
                                <button
                                    key={pts}
                                    type="button"
                                    onClick={() => setBadgeRewardPoints(pts)}
                                    className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${badgeRewardPoints === pts ? 'bg-purple-500 text-white font-black shadow' : 'bg-indigo-900/60 text-indigo-200 hover:bg-indigo-800'}`}
                                >
                                    +{pts} نقطة
                                </button>
                            ))}
                        </div>
                        <input
                            type="number"
                            min="1"
                            value={badgeRewardPoints}
                            onChange={(e) => setBadgeRewardPoints(e.target.value)}
                            placeholder="عدد النقاط"
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-base font-bold text-center focus:outline-none focus:border-purple-400"
                        />
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">تاريخ تسجيل المكافأة:</label>
                        <input
                            type="date"
                            value={badgeRewardDate}
                            onChange={(e) => setBadgeRewardDate(e.target.value)}
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-sm focus:outline-none focus:border-purple-400 font-mono"
                        />
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-xs text-indigo-300 font-bold mb-1.5">البيان / الوصف:</label>
                        <input
                            type="text"
                            value={badgeRewardDesc}
                            onChange={(e) => setBadgeRewardDesc(e.target.value)}
                            className="w-full bg-indigo-950 border border-indigo-700 text-white rounded-lg p-2.5 text-sm focus:outline-none focus:border-purple-400"
                        />
                    </div>

                    <div className="pt-2 flex gap-3">
                        <button type="button" onClick={handleGrantBadgeReward} className="flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-black py-3 rounded-xl transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 text-sm md:text-base">
                            <span>🎖️</span><span>إضافة مكافأة الأوسمة الآن</span>
                        </button>
                        <button type="button" onClick={() => setBadgeRewardModalOpen(false)} className="bg-indigo-800 hover:bg-indigo-700 text-white font-bold py-3 px-4 rounded-xl transition-colors text-sm">إلغاء</button>
                    </div>
                </div>
            </Modal>

            {/* --- Mina Only Leaderboard Points & Money Control Modal --- */}
            <Modal
                isOpen={!!studentForPointsEdit && isMinaAdmin}
                onClose={() => setStudentForPointsEdit(null)}
                title="التحكم بالنواحي والفلوس (خاص بالخادم مينا) ⚖️"
            >
                {studentForPointsEdit && (
                    <div className="space-y-5 text-right font-sans" dir="rtl">
                        <div className="bg-indigo-950/80 p-4 rounded-xl border border-indigo-800/60 flex items-center justify-between">
                            <div><h3 className="font-black text-amber-400 text-base md:text-lg">{studentForPointsEdit.name}</h3><p className="text-xs text-indigo-300 mt-0.5">تعديل رصيد النقاط والفلوس في لوحة الصدارة</p></div>
                            <div className="bg-amber-500/20 text-amber-300 px-3.5 py-2 rounded-xl border border-amber-500/30 text-xs font-black shadow-inner">الرصيد الحالي: {studentForPointsEdit.points ?? 0} نقطة | {getStudentMoney(studentForPointsEdit)} جنيه</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-indigo-900/40 p-4 rounded-xl border border-indigo-800/40"><label className="block text-xs font-bold text-amber-300 mb-2">عدد النقاط المطلوب 🎯</label><div className="relative"><input type="number" value={targetPointsInput} onChange={(e) => handlePointsInputChange(e.target.value)} placeholder="مثال: 100" className="w-full bg-indigo-950 text-white font-extrabold text-lg px-3 py-2.5 rounded-lg border border-indigo-700 focus:outline-none focus:border-amber-500 text-right" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 font-bold">نقطة</span></div></div>
                            <div className="bg-indigo-900/40 p-4 rounded-xl border border-indigo-800/40"><label className="block text-xs font-bold text-amber-300 mb-2">القيمة بالجنيه 💰</label><div className="relative"><input type="number" value={targetMoneyInput} onChange={(e) => handleMoneyInputChange(e.target.value)} placeholder="مثال: 50" className="w-full bg-indigo-950 text-white font-extrabold text-lg px-3 py-2.5 rounded-lg border border-indigo-700 focus:outline-none focus:border-amber-500 text-right" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 font-bold">جنيه</span></div></div>
                        </div>
                        <div className="bg-amber-500/10 border border-amber-500/30 p-3.5 rounded-xl text-xs text-amber-200/90 leading-relaxed">💡 <span className="font-bold text-amber-300">تنويه:</span> الجنيهات = نص النقط وبتتغير لوحدها مع النقط. لو غيّرت الجنيهات بإيدك، الفرق ده بيتحفظ وبيفضل ماشي مع النقط بعد كده.</div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleSavePointsEdit} className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-indigo-950 font-black py-3 rounded-xl transition-all text-sm shadow-md active:scale-[0.98]">حفظ التغييرات 💾</button>
                            <button onClick={() => setStudentForPointsEdit(null)} className="px-5 bg-indigo-900 hover:bg-indigo-800 text-indigo-200 font-bold py-3 rounded-xl transition-all text-sm">إلغاء</button>
                        </div>
                    </div>
                )}
            </Modal>

            {isSuperAdmin && studentsDocBytes > 700000 && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60, background: '#b91c1c', color: 'white', textAlign: 'center', fontSize: 13, fontWeight: 700, padding: '8px 12px' }}>
                    ⚠️ بيانات الطلاب وصلت {Math.round(studentsDocBytes / 10485.76)}% من الحد الأقصى. حمّل نسخة احتياطية وكلّم المطوّر قريب عشان نوسّع المساحة.
                </div>
            )}
            <div style={{ position: 'fixed', bottom: loggedInAdmin ? 'calc(1px + env(safe-area-inset-bottom, 0px))' : 4, right: 6, fontSize: 8, opacity: 0.35, color: '#c7d2fe', zIndex: 45, pointerEvents: 'none', direction: 'ltr' }}>v{APP_VERSION}</div>
        </div>
    );
};

export default App;