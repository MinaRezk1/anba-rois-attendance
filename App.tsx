import React from 'react';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './index.css';
import { db } from './firebase';
import './GiftsShop';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';



const generateId = () => `_${Math.random().toString(36).substring(2, 11)}`;

const CAIRO_TIMEZONE = 'Africa/Cairo';
const APP_VERSION = '2026.09.19.9';

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

const isEarlyBadgeRecord = (record) => {
    if (!record || record.type !== 'early') return false;
    if (record.meta === 'early_badge_eligible') return true;
    if (!record.recordedAt) return false;
    const recordedAt = new Date(record.recordedAt);
    return !Number.isNaN(recordedAt.getTime()) && isEarlyBadgeEligibleAt(recordedAt);
};

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

const getAttendanceWindow = (date = new Date()) => {
    const parts = getCairoDateParts(date);
    const dateKey = getCairoDateKey(date);
    const firstFriday = isFirstFridayDateKey(dateKey);

    if (firstFriday) {
        return {
            kind: 'monthlyMass',
            isWithinAllowedTime: parts.hour >= 8 && parts.hour < 12,
            message: '⚠️ الوقت الحالي ليس ضمن وقت القداس الشهري (8 ص–12 م)',
        };
    }

    if (parts.weekday === 'Fri') {
        return {
            kind: parts.hour < 16 ? 'early' : 'late',
            isWithinAllowedTime: parts.hour >= 15 && parts.hour < 17,
            message: '⚠️ الحضور المبكر (+10) متاح من 3:00 إلى 3:15 م فقط، والحضور المتأخر متاح بعد ذلك حتى 5 م.',
        };
    }

    return {
        kind: 'none',
        isWithinAllowedTime: false,
        message: '⚠️ الحضور متاح يوم الجمعة فقط.',
    };
};

const getMeetingTimeMessage = () => {
    const dateKey = getCairoDateKey();
    if (isFirstFridayDateKey(dateKey)) return 'القداس الشهري: 8 ص–12 م';
    if (isFridayDateKey(dateKey)) return 'الاجتماع: 3–5 م';
    return 'الحضور يوم الجمعة فقط';
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
            ...(rosterGrade ? { grade: rosterGrade } : {}),
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
                .filter(h => h.date && h.date.startsWith(prefix) && h.type === 'participation' && h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
                .reduce((acc, h) => acc + (h.points || 0), 0);
            return sum >= 25;
        },
        getProgress: (history, points, monthPrefix) => {
            const prefix = monthPrefix || getCurrentMonthPrefix();
            const sum = (history || [])
                .filter(h => h.date && h.date.startsWith(prefix) && h.type === 'participation' && h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
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
        check: (history, points, monthPrefix) => (history || []).filter(h => h.type === 'participation').reduce((acc, h) => acc + (h.points || 0), 0) >= 250,
        getProgress: (history, points, monthPrefix) => {
            const sum = (history || []).filter(h => h.type === 'participation').reduce((acc, h) => acc + (h.points || 0), 0);
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
        description: 'جمع 1000 نقطة أو أكثر في المجموع الكلي للنقاط',
        color: 'from-indigo-400 to-violet-600',
        check: (history, points, monthPrefix) => (points || 0) >= 1000,
        getProgress: (history, points, monthPrefix) => `${points || 0}/1000`
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
      className="fixed inset-0 bg-black bg-opacity-70 z-50 flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-indigo-950 rounded-2xl shadow-xl w-full max-w-md mx-auto text-white border border-indigo-800 transform transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-indigo-800">
          <h2 className="text-xl font-bold text-amber-400">{title}</h2>
          <button 
            onClick={onClose} 
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-full hover:bg-indigo-700"
          >
            <XIcon className="w-6 h-6" />
          </button>
        </div>
        <div className="p-6">
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

const getStudentMoney = (student) => {
    if (!student) return 0;
    if (student.customMoney !== undefined && student.customMoney !== null && student.customMoney !== '') {
        const val = parseFloat(student.customMoney);
        if (!isNaN(val)) return val;
    }
    const pts = student.pointsForLeaderboard ?? student.points ?? 0;
    return Math.floor(pts / 2);
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
    const [participationPoints, setParticipationPoints] = useState('1');
    const [participationDescription, setParticipationDescription] = useState('');
    const [gamesStationPoints, setGamesStationPoints] = useState('1');
    const [rootsPoints, setRootsPoints] = useState('1');
    const [exchangePoints, setExchangePoints] = useState('5');

    const decrementExchange = () => {
        setExchangePoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 5;
            const newVal = Math.max(1, num - 1);
            return String(newVal);
        });
    };

    const incrementExchange = () => {
        setExchangePoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 5;
            const newVal = Math.min(3000, num + 1);
            return String(newVal);
        });
    };

    const decrementParticipation = () => {
        setParticipationPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.max(-10, num - 1);
            return String(newVal);
        });
    };

    const incrementParticipation = () => {
        setParticipationPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.min(50, num + 1);
            return String(newVal);
        });
    };

    const decrementGamesStation = () => {
        setGamesStationPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.max(-50, num - 1);
            return String(newVal);
        });
    };

    const incrementGamesStation = () => {
        setGamesStationPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.min(100, num + 1);
            return String(newVal);
        });
    };

    const decrementRoots = () => {
        setRootsPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.max(-50, num - 1);
            return String(newVal);
        });
    };

    const incrementRoots = () => {
        setRootsPoints((prev) => {
            let num = parseInt(prev, 10);
            if (isNaN(num)) num = 1;
            const newVal = Math.min(100, num + 1);
            return String(newVal);
        });
    };

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
            canAddEarly: targetIsFriday && !targetIsFirstFriday && !hasReceivedAttendanceToday && meetingTimeAllowed && (!isHistoricalEdit ? currentWindow?.kind === 'early' && getCairoDateParts().hour === 15 && getCairoDateParts().minute < 15 : true),
            canAddLate: targetIsFriday && !targetIsFirstFriday && !hasReceivedAttendanceToday && meetingTimeAllowed && (!isHistoricalEdit ? currentWindow?.kind === 'late' : true),
            canAddConfession: canAddConfession,
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

    return (
        <div className="space-y-3">
            {!rules.canAddMass && !rules.canAddEarly && !rules.canAddLate && !rules.canAddParticipation && rules.windowMessage && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center text-xs font-bold text-amber-300">
                    {rules.windowMessage}
                </div>
            )}
            <button
                onClick={() => handleAddPoints('monthlyMass', 25)}
                disabled={!rules.canAddMass}
                className="w-full p-3 text-white font-bold rounded-lg transition-colors bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                قداس شهري (+25 نقطة)
            </button>
            <button
                onClick={() => handleAddPoints('early', 10)}
                disabled={!rules.canAddEarly}
                className="w-full p-3 text-white font-bold rounded-lg transition-colors bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                حضور مبكر (+10 نقاط)
            </button>
            <button
                onClick={() => handleAddPoints('late', 5)}
                disabled={!rules.canAddLate}
                className="w-full p-3 text-white font-bold rounded-lg transition-colors bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                حضور متأخر (+5 نقاط)
            </button>
             <button
                onClick={() => handleAddPoints('confession', 15)}
                disabled={!rules.canAddConfession}
                className="w-full p-3 text-white font-bold rounded-lg transition-colors bg-rose-600 hover:bg-rose-700 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
                اعتراف (+15 نقطة)
            </button>

            <div className="!mt-4 pt-4 border-t border-indigo-900/60 space-y-2.5">
                <label className="text-xs font-black uppercase tracking-wider text-fuchsia-400 flex items-center gap-1.5 mb-1 select-none">
                    <span className="text-base">🎮</span>
                    <span>نقاط Games Station</span>
                </label>
                <div className="flex items-stretch gap-2.5">
                    <div className="flex items-center bg-slate-900/60 border border-fuchsia-500/40 rounded-xl overflow-hidden shadow-inner shadow-fuchsia-950/20">
                        <button
                            type="button"
                            onClick={decrementGamesStation}
                            disabled={!rules.canAddGamesStation}
                            className="px-3.5 py-2 bg-fuchsia-950/30 hover:bg-fuchsia-900/50 text-fuchsia-400 font-black hover:text-fuchsia-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-r border-fuchsia-500/10 focus:outline-none"
                        >
                            -
                        </button>
                        <input
                            type="number"
                            id={`games-station-points-${student.id}`}
                            min="-50"
                            max="100"
                            value={gamesStationPoints}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (/^-?[0-9]*$/.test(value)) {
                                    const num = parseInt(value, 10);
                                    if ((!isNaN(num) && num >= -50 && num <= 100) || value === '' || value === '-') {
                                        setGamesStationPoints(value);
                                    } else if (value.length > 0) {
                                        const clamped = Math.max(-50, Math.min(100, num));
                                        setGamesStationPoints(String(clamped));
                                    }
                                }
                            }}
                            onBlur={() => {
                                const num = parseInt(gamesStationPoints, 10);
                                if (isNaN(num) || gamesStationPoints === '' || gamesStationPoints === '-') {
                                    setGamesStationPoints('1');
                                } else {
                                    const clamped = Math.max(-50, Math.min(100, num));
                                    setGamesStationPoints(String(clamped));
                                }
                            }}
                            className="w-14 bg-transparent border-0 text-fuchsia-100 text-center focus:outline-none focus:ring-0 text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-1"
                            disabled={!rules.canAddGamesStation}
                        />
                        <button
                            type="button"
                            onClick={incrementGamesStation}
                            disabled={!rules.canAddGamesStation}
                            className="px-3.5 py-2 bg-fuchsia-950/30 hover:bg-fuchsia-900/50 text-fuchsia-400 font-black hover:text-fuchsia-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-l border-fuchsia-500/10 focus:outline-none"
                        >
                            +
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            const points = parseInt(gamesStationPoints, 10);
                            if (!isNaN(points)) {
                                handleAddPoints('gamesStation', points);
                                setGamesStationPoints('1');
                            }
                        }}
                        disabled={!rules.canAddGamesStation || isNaN(parseInt(gamesStationPoints, 10)) || gamesStationPoints === '' || gamesStationPoints === '-'}
                        className="flex-grow rounded-xl bg-gradient-to-r from-fuchsia-500 to-pink-600 px-4 py-2.5 text-xs md:text-sm font-black text-white shadow-lg shadow-pink-900/20 hover:from-fuchsia-400 hover:to-pink-500 active:scale-[0.98] transition-all disabled:from-indigo-950 disabled:to-indigo-950 disabled:text-indigo-700/60 disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-1.5"
                    >
                        <span>🎮</span>
                        <span>إضافة نقاط الـ Games</span>
                    </button>
                </div>
            </div>

            <div className="!mt-4 pt-4 border-t border-indigo-900/60 space-y-2.5">
                <label className="text-xs font-black uppercase tracking-wider text-emerald-400 flex items-center gap-1.5 mb-1 select-none">
                    <span className="text-base">🌱</span>
                    <span>نقاط ROOTS</span>
                </label>
                <div className="flex items-stretch gap-2.5">
                    <div className="flex items-center bg-slate-900/60 border border-emerald-500/40 rounded-xl overflow-hidden shadow-inner shadow-emerald-950/20">
                        <button
                            type="button"
                            onClick={decrementRoots}
                            disabled={!rules.canAddRoots}
                            className="px-3.5 py-2 bg-emerald-950/30 hover:bg-emerald-900/50 text-emerald-400 font-black hover:text-emerald-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-r border-emerald-500/10 focus:outline-none"
                        >
                            -
                        </button>
                        <input
                            type="number"
                            id={`roots-points-${student.id}`}
                            min="-50"
                            max="100"
                            value={rootsPoints}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (/^-?[0-9]*$/.test(value)) {
                                    const num = parseInt(value, 10);
                                    if ((!isNaN(num) && num >= -50 && num <= 100) || value === '' || value === '-') {
                                        setRootsPoints(value);
                                    } else if (value.length > 0) {
                                        const clamped = Math.max(-50, Math.min(100, num));
                                        setRootsPoints(String(clamped));
                                    }
                                }
                            }}
                            onBlur={() => {
                                const num = parseInt(rootsPoints, 10);
                                if (isNaN(num) || rootsPoints === '' || rootsPoints === '-') {
                                    setRootsPoints('1');
                                } else {
                                    const clamped = Math.max(-50, Math.min(100, num));
                                    setRootsPoints(String(clamped));
                                }
                            }}
                            className="w-14 bg-transparent border-0 text-emerald-100 text-center focus:outline-none focus:ring-0 text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-1"
                            disabled={!rules.canAddRoots}
                        />
                        <button
                            type="button"
                            onClick={incrementRoots}
                            disabled={!rules.canAddRoots}
                            className="px-3.5 py-2 bg-emerald-950/30 hover:bg-emerald-900/50 text-emerald-400 font-black hover:text-emerald-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-l border-emerald-500/10 focus:outline-none"
                        >
                            +
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            const points = parseInt(rootsPoints, 10);
                            if (!isNaN(points)) {
                                handleAddPoints('roots', points);
                                setRootsPoints('1');
                            }
                        }}
                        disabled={!rules.canAddRoots || isNaN(parseInt(rootsPoints, 10)) || rootsPoints === '' || rootsPoints === '-'}
                        className="flex-grow rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-4 py-2.5 text-xs md:text-sm font-black text-white shadow-lg shadow-emerald-900/20 hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98] transition-all disabled:from-indigo-950 disabled:to-indigo-950 disabled:text-indigo-700/60 disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-1.5"
                    >
                        <span>🌱</span>
                        <span>إضافة نقاط الـ ROOTS</span>
                    </button>
                </div>
            </div>
            
            <div className="!mt-4 pt-4 border-t border-indigo-900/60 space-y-2.5">
                <label className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-1.5 mb-1 select-none">
                    <span className="text-base">✨</span>
                    <span>نقاط المشاركة</span>
                </label>
                <div className="flex items-stretch gap-2.5">
                    <div className="flex items-center bg-slate-900/60 border border-amber-500/40 rounded-xl overflow-hidden shadow-inner shadow-amber-950/20">
                        <button
                            type="button"
                            onClick={decrementParticipation}
                            disabled={!rules.canAddParticipation}
                            className="px-3.5 py-2 bg-amber-950/30 hover:bg-amber-900/50 text-amber-400 font-black hover:text-amber-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-r border-amber-500/10 focus:outline-none"
                        >
                            -
                        </button>
                        <input
                            type="number"
                            id={`participation-points-${student.id}`}
                            min="-10"
                            max="50"
                            value={participationPoints}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (/^-?[0-9]*$/.test(value)) {
                                    const num = parseInt(value, 10);
                                    if ((!isNaN(num) && num >= -10 && num <= 50) || value === '' || value === '-') {
                                        setParticipationPoints(value);
                                    } else if (value.length > 0) {
                                        const clamped = Math.max(-10, Math.min(50, num));
                                        setParticipationPoints(String(clamped));
                                    }
                                }
                            }}
                            onBlur={() => {
                                const num = parseInt(participationPoints, 10);
                                if (isNaN(num) || participationPoints === '' || participationPoints === '-') {
                                    setParticipationPoints('1');
                                } else {
                                    const clamped = Math.max(-10, Math.min(50, num));
                                    setParticipationPoints(String(clamped));
                                }
                            }}
                            className="w-14 bg-transparent border-0 text-amber-100 text-center focus:outline-none focus:ring-0 text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-1"
                            disabled={!rules.canAddParticipation}
                        />
                        <button
                            type="button"
                            onClick={incrementParticipation}
                            disabled={!rules.canAddParticipation}
                            className="px-3.5 py-2 bg-amber-950/30 hover:bg-amber-900/50 text-amber-400 font-black hover:text-amber-300 transition-colors select-none disabled:opacity-30 disabled:text-gray-500 disabled:bg-transparent text-lg leading-none border-l border-amber-500/10 focus:outline-none"
                        >
                            +
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            const points = parseInt(participationPoints, 10);
                            if (!isNaN(points)) {
                                handleAddPoints('participation', points, participationDescription);
                                setParticipationDescription('');
                                setParticipationPoints('1');
                            }
                        }}
                        disabled={!rules.canAddParticipation || isNaN(parseInt(participationPoints, 10)) || participationPoints === '' || participationPoints === '-'}
                        className="flex-grow rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-4 py-2.5 text-xs md:text-sm font-black text-white shadow-lg shadow-amber-900/20 hover:from-amber-400 hover:to-orange-500 active:scale-[0.98] transition-all disabled:from-indigo-950 disabled:to-indigo-950 disabled:text-indigo-700/60 disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-1.5"
                    >
                        <span>✨</span>
                        <span>إضافة نقاط المشاركة</span>
                    </button>
                </div>
                <input
                    type="text"
                    placeholder="سبب المشاركة (اختياري)"
                    value={participationDescription}
                    onChange={(e) => setParticipationDescription(e.target.value)}
                    className="w-full rounded-xl border border-indigo-900/50 bg-slate-900/40 text-white placeholder-indigo-400/50 focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 focus:outline-none px-3.5 py-2 text-xs md:text-sm transition-all"
                    disabled={!rules.canAddParticipation}
                />
            </div>
            
            {/* Exchange / Redeem Points Section (Negative points only) */}
            <div className="!mt-4 pt-4 border-t border-indigo-900/60 space-y-2.5">
                <label className="text-xs font-black uppercase tracking-wider text-rose-400 flex items-center gap-1.5 mb-1 select-none">
                    <span className="text-base">🔄</span>
                    <span>تبديل النقاط (خصم بالسالب)</span>
                </label>
                <div className="flex items-stretch gap-2.5">
                    <div className="flex items-center bg-slate-900/60 border border-rose-500/40 rounded-xl overflow-hidden shadow-inner shadow-rose-950/20">
                        <button
                            type="button"
                            onClick={decrementExchange}
                            className="px-3.5 py-2 bg-rose-950/30 hover:bg-rose-900/50 text-rose-400 font-black hover:text-rose-300 transition-colors select-none text-lg leading-none border-r border-rose-500/10 focus:outline-none"
                        >
                            -
                        </button>
                        <input
                            type="number"
                            id={`exchange-points-${student.id}`}
                            min="1"
                            max="3000"
                            value={exchangePoints}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (/^[0-9]*$/.test(value)) {
                                    const num = parseInt(value, 10);
                                    if (!isNaN(num) && num >= 1 && num <= 3000) {
                                        setExchangePoints(value);
                                    } else if (value === '') {
                                        setExchangePoints('');
                                    } else {
                                        const clamped = Math.max(1, Math.min(3000, num));
                                        setExchangePoints(String(clamped));
                                    }
                                }
                            }}
                            onBlur={() => {
                                const num = parseInt(exchangePoints, 10);
                                if (isNaN(num) || exchangePoints === '') {
                                    setExchangePoints('5');
                                } else {
                                    const clamped = Math.max(1, Math.min(3000, num));
                                    setExchangePoints(String(clamped));
                                }
                            }}
                            className="w-20 bg-transparent border-0 text-rose-100 text-center focus:outline-none focus:ring-0 text-sm font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none px-1"
                        />
                        <button
                            type="button"
                            onClick={incrementExchange}
                            className="px-3.5 py-2 bg-rose-950/30 hover:bg-rose-900/50 text-rose-400 font-black hover:text-rose-300 transition-colors select-none text-lg leading-none border-l border-rose-500/10 focus:outline-none"
                        >
                            +
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            const rawPts = parseInt(exchangePoints, 10);
                            if (!isNaN(rawPts) && rawPts > 0) {
                                const minusPoints = -Math.abs(rawPts);
                                handleAddPoints('exchange', minusPoints);
                                setExchangePoints('5');
                            }
                        }}
                        disabled={isNaN(parseInt(exchangePoints, 10)) || parseInt(exchangePoints, 10) <= 0}
                        className="flex-grow rounded-xl bg-gradient-to-r from-rose-600 to-red-700 px-4 py-2.5 text-xs md:text-sm font-black text-white shadow-lg shadow-rose-900/20 hover:from-rose-500 hover:to-red-600 active:scale-[0.98] transition-all disabled:from-indigo-950 disabled:to-indigo-950 disabled:text-indigo-700/60 disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-1.5"
                    >
                        <span>🔄</span>
                        <span>خصم / تبديل النقاط ({!isNaN(parseInt(exchangePoints, 10)) && parseInt(exchangePoints, 10) > 0 ? `-${Math.abs(parseInt(exchangePoints, 10))}` : '0'})</span>
                    </button>
                </div>
            </div>
        </div>
    );
};


const defaultAdminsData = [{"id":"admin_mina_rizk","name":"مينا رزق","pin":"1218","isLocked":false,"failedAttempts":0,"isSuperAdmin":true},{"id":"admin_shady_sameh","name":"شادي سامح","pin":"2846","isLocked":false,"failedAttempts":0,"isSuperAdmin":false},{"id":"admin_mina_moawad","name":"مينا معوض","pin":"7520","isLocked":false,"failedAttempts":0,"isSuperAdmin":false},{"id":"admin_kirollos_raafat","name":"كيرلس رأفت","pin":"7117","isLocked":false,"failedAttempts":0,"isSuperAdmin":false},{"id":"admin_nagy_wiliam","name":"ناجي وليم","pin":"2846","isLocked":false,"failedAttempts":0,"isSuperAdmin":false}];

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

// --- App Component ---
const App = () => {
    const [students, setStudents] = useState(() => {
        const local = localStorage.getItem('church_attendance_students_v8');
        if (local) {
            try {
                const parsed = JSON.parse(local);
                const approved = filterToApprovedRoster(parsed);
                if (approved.length > 0) return approved;
            } catch (e) {}
        }
        return [];
    });
    const [admins, setAdmins] = useState(() => {
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
    const [editingAdminId, setEditingAdminId] = useState(null);
    const [editingAdminPinValue, setEditingAdminPinValue] = useState('');

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

    const lastStudentsDB = useRef<string>(localStorage.getItem('church_attendance_students_v8') || '[]');
    const lastAdminsDB = useRef<string>(localStorage.getItem('church_attendance_admins_v8') || '[]');
    const isRosterMigrationInProgress = useRef(false);

    // Initialize Data from Firebase with Offline-Resilient Merging
    useEffect(() => {
        const unsubStudents = onSnapshot(doc(db, 'appData', 'students_v8'), (docSnap) => {
            if (docSnap.exists()) {
                const dbItems = docSnap.data()?.items;
                if (Array.isArray(dbItems)) {
                    const approvedItems = filterToApprovedRoster(dbItems);
                    const migrationKey = 'church_attendance_roster_migration_2026_09_19_84_v8';
                    const migrationDone = localStorage.getItem(migrationKey) === 'done';
                    const storedMigrationVersion = docSnap.data()?.rosterMigrationVersion || '';
                    const normalizedDbRoster = dbItems.map(s => normalizeRosterStudentName(s?.name)).filter(Boolean);
                    const expectedRosterKeys = APPROVED_STUDENT_ROSTER_NAMES.map(normalizeRosterStudentName).filter((key, index, list) => list.indexOf(key) === index);
                    const rosterMatchesExactly = normalizedDbRoster.length === expectedRosterKeys.length
                        && normalizedDbRoster.every((key, index) => key === expectedRosterKeys[index]);
                    const needsSeasonReset = storedMigrationVersion !== CURRENT_ROSTER_MIGRATION_VERSION;

                    if (isRosterMigrationInProgress.current) return;

                    if (!migrationDone && (needsSeasonReset || !rosterMatchesExactly || dbItems.length !== 84)) {
                        isRosterMigrationInProgress.current = true;
                        const exactRoster = buildExactCurrentRoster(dbItems);
                        setDoc(doc(db, 'appData', 'students_pre_roster_2026_backup'), {
                            items: dbItems,
                            createdAt: new Date().toISOString(),
                            migrationVersion: CURRENT_ROSTER_MIGRATION_VERSION,
                        }, { merge: true })
                            .then(() => setDoc(doc(db, 'appData', 'students_v8'), {
                                items: exactRoster,
                                rosterMigrationVersion: CURRENT_ROSTER_MIGRATION_VERSION,
                                seasonReset: true,
                            }, { merge: true }))
                            .then(() => {
                                const str = JSON.stringify(exactRoster);
                                lastStudentsDB.current = str;
                                localStorage.setItem('church_attendance_students_v8', str);
                                localStorage.setItem(migrationKey, 'done');
                                setStudents(exactRoster);
                                showToast('✅ تم تحديث كشف الـ84 طالب وتصفير النقاط الحالية وترحيل النقاط القديمة.');
                            })
                            .catch(err => {
                                console.error("Error applying 84-student roster migration:", err);
                                showToast('❌ حصل خطأ أثناء تحديث كشف الطلاب. البيانات القديمة محفوظة.');
                            })
                            .finally(() => {
                                isRosterMigrationInProgress.current = false;
                            });
                        return;
                    }

                    const str = JSON.stringify(approvedItems);
                    lastStudentsDB.current = str;
                    localStorage.setItem('church_attendance_students_v8', str);
                    setStudents(approvedItems);
                    if (JSON.stringify(approvedItems) !== JSON.stringify(dbItems)) {
                        setDoc(doc(db, 'appData', 'students_v8'), { items: approvedItems }, { merge: true })
                            .catch(err => console.error("Error syncing roster corrections:", err));
                    }
                } else {
                    setStudents([]);
                }
            } else {
                const local = localStorage.getItem('church_attendance_students_v8');
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
                    const str = JSON.stringify(dbItems);
                    lastAdminsDB.current = str;
                    localStorage.setItem('church_attendance_admins_v8', str);
                    setAdmins(dbItems);
                } else {
                    setAdmins(defaultAdminsData);
                }
            } else {
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
        if (currentStr !== lastStudentsDB.current) {
            localStorage.setItem('church_attendance_students_v8', currentStr);
            setDoc(doc(db, 'appData', 'students_v8'), { items: students }, { merge: true })
                .catch(err => console.error("Error saving students to Firestore:", err));
            lastStudentsDB.current = currentStr;
        }

        const currentAdminsStr = JSON.stringify(admins);
        if (currentAdminsStr !== lastAdminsDB.current) {
            localStorage.setItem('church_attendance_admins_v8', currentAdminsStr);
            setDoc(doc(db, 'appData', 'admins_v8'), { items: admins }, { merge: true })
                .catch(err => console.error("Error saving admins to Firestore:", err));
            lastAdminsDB.current = currentAdminsStr;
        }
    }, [students, admins]);

        const saveStudentsData = useCallback((newStudents) => {
        const str = JSON.stringify(newStudents);
        lastStudentsDB.current = str;
        localStorage.setItem('church_attendance_students_v8', str);
        setStudents(newStudents);
        setDoc(doc(db, 'appData', 'students_v8'), { items: newStudents }, { merge: true })
            .catch(err => console.error("Error saving students to Firestore:", err));
    }, []);

    const saveAdminsData = useCallback((newAdmins) => {
        const str = JSON.stringify(newAdmins);
        lastAdminsDB.current = str;
        localStorage.setItem('church_attendance_admins_v8', str);
        setAdmins(newAdmins);
        setDoc(doc(db, 'appData', 'admins_v8'), { items: newAdmins }, { merge: true })
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
            setStudents(currentStudents);
            const mergedStr = JSON.stringify(currentStudents);
            lastStudentsDB.current = mergedStr;
            localStorage.setItem('church_attendance_students_v8', mergedStr);
            setDoc(doc(db, 'appData', 'students_v8'), { items: currentStudents }, { merge: true })
                .then(() => {
                    showToast("🎉 تم استيراد ودمج سجلات الطلاب القديمة من جهازك بنجاح!");
                })
                .catch(err => console.error("Error saving migrated students:", err));
        }

        if (migratedAdmins) {
            setAdmins(currentAdmins);
            const mergedStr = JSON.stringify(currentAdmins);
            lastAdminsDB.current = mergedStr;
            localStorage.setItem('church_attendance_admins_v8', mergedStr);
            setDoc(doc(db, 'appData', 'admins_v8'), { items: currentAdmins }, { merge: true })
                .catch(err => console.error("Error saving migrated admins:", err));
        }
    }, []);

    // Automatic monthly champion rewards removed in favor of manual servant control

    const addStudent = useCallback(() => {
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
    }, [newStudentName, newStudentPhone, newStudentGrade, students, showToast]);
    
    const addPoints = useCallback((studentId, type, points, fromScan = false, description = null) => {
        if (!loggedInAdmin) {
            showToast('يجب تسجيل الدخول أولاً لإضافة نقاط.');
            return;
        }
        // Use selectedDate only for super-admin historical edits; otherwise use Cairo's current date.
        const dateToRecord = loggedInAdmin.isSuperAdmin && selectedDate && !fromScan ? selectedDate : getCairoDateKey();
        const isHistoricalEdit = loggedInAdmin.isSuperAdmin && Boolean(selectedDate) && selectedDate !== getCairoDateKey() && !fromScan;

        if (['early', 'late', 'monthlyMass', 'participation', 'gamesStation', 'roots'].includes(type) && !isHistoricalEdit) {
            const windowState = getAttendanceWindow();
            const allowed = type === 'monthlyMass'
                ? windowState.kind === 'monthlyMass' && windowState.isWithinAllowedTime
                : type === 'early'
                    ? windowState.kind === 'early' && windowState.isWithinAllowedTime && getCairoDateParts().hour === 15 && getCairoDateParts().minute < 15
                    : type === 'late'
                        ? windowState.kind === 'late' && windowState.isWithinAllowedTime
                        : windowState.isWithinAllowedTime && windowState.kind !== 'monthlyMass';
            if (!allowed) {
                showToast(windowState.message);
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
    
    const handlePinSubmit = (e) => {
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

        if (pinInput === adminToLogin.pin) {
            setLoggedInAdmin(adminToLogin);
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
        const { studentId, record } = pointToDelete;

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
    const handleAddAdmin = () => {
        const name = newAdminName.trim();
        const pin = newAdminPin.trim();

        if (!name || !pin) {
            showToast("الرجاء إدخال اسم ورقم سري للخادم الجديد.");
            return;
        }
        if (!/^\d{4,}$/.test(pin)) {
            showToast("الرقم السري يجب أن يتكون من 4 أرقام على الأقل.");
            return;
        }
        if (admins.some(a => a.name.toLowerCase() === name.toLowerCase())) {
            showToast("هذا الاسم موجود بالفعل.");
            return;
        }

        const newAdmin = {
            id: `admin_${name.replace(/\s+/g, '_').toLowerCase()}_${generateId()}`,
            name: name,
            pin: pin,
            isLocked: false,
            failedAttempts: 0,
            isSuperAdmin: false
        };

        setAdmins(prev => [...prev, newAdmin]);
        setNewAdminName('');
        setNewAdminPin('');
        showToast(`تم إضافة الخادم "${name}" بنجاح.`);
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

    const handleSaveAdminPin = (adminId) => {
        if (!/^\d{4,}$/.test(editingAdminPinValue)) {
            showToast("الرقم السري يجب أن يتكون من 4 أرقام على الأقل.");
            return;
        }
        setAdmins(prev => prev.map(a => a.id === adminId ? { ...a, pin: editingAdminPinValue } : a));
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
        const file = e.target.files[0];
        if (!file) return;

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
                    /^\d{4,}$/.test(admin.pin);

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
                    .filter(h => h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
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
                const currentMonthAwardRecord = history.find(h => 
                    (h.meta && (h.meta.includes(`monthly_all_${currentMonthPrefix}`) || h.meta.includes(`badge_reward_monthly_all_${currentMonthPrefix}`))) ||
                    (h.typeName === 'مكافأة تجميع الأوسمة' && h.date && h.date.startsWith(currentMonthPrefix)) ||
                    (h.description && (h.description.includes('تجميع الأوسمة') || h.description.includes('مكافأة الأوسمة')) && h.date && h.date.startsWith(currentMonthPrefix))
                );
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
                    description: 'حقق جميع متطلبات أوسمة الشهر الحالي (حضور 3:00–3:15 م ثلاث مرات، قداس شهري 1+، مشاركة 25+ نقطة)',
                    progress: '3/3 أوسمة مكتملة',
                    isAwarded: !!currentMonthAwardRecord,
                    awardedRecord: currentMonthAwardRecord,
                    suggestedPoints: 10,
                    color: 'from-amber-400 to-yellow-500'
                });
            }

            // 2. Triple Monthly Badges for Previous Month (بطل الشهر السابق)
            const prevHasAllMonthly = BADGES_CONFIG.filter(b => b.category === 'monthly').every(b => b.check(history, pts, prevMonthPrefix));
            if (prevHasAllMonthly) {
                const prevMonthAwardRecord = history.find(h => 
                    (h.meta && (h.meta.includes(`monthly_all_${prevMonthPrefix}`) || h.meta.includes(`badge_reward_monthly_all_${prevMonthPrefix}`))) ||
                    (h.typeName === 'مكافأة تجميع الأوسمة' && h.date && (h.date.startsWith(prevMonthPrefix) || h.date.startsWith(currentMonthPrefix))) ||
                    (h.description && (h.description.includes('تجميع الأوسمة') || h.description.includes('مكافأة الأوسمة')) && (h.description.includes(getArabicMonthName(prevMonthPrefix).split(' ')[0]) || h.date?.startsWith(prevMonthPrefix)))
                );
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
                    description: 'حقق جميع متطلبات أوسمة الشهر السابق كاملة، بما فيها 3 مرات حضور بين 3:00 و3:15 م',
                    progress: '3/3 أوسمة مكتملة',
                    isAwarded: !!prevMonthAwardRecord,
                    awardedRecord: prevMonthAwardRecord,
                    suggestedPoints: 10,
                    color: 'from-yellow-500 to-amber-600'
                });
            }

            // 3. Monthly leaderboard rewards for the previous month (manual notification only)
            const prevMonthRanking = [...students]
                .map(candidate => {
                    const prevPoints = (candidate.attendanceHistory || [])
                        .filter(h => h.date && h.date.startsWith(prevMonthPrefix))
                        .filter(h => h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
                        .reduce((sum, h) => sum + Number(h.points || 0), 0);
                    return { candidate, prevPoints };
                })
                .filter(item => item.prevPoints > 0)
                .sort((a, b) => b.prevPoints - a.prevPoints || a.candidate.name.localeCompare(b.candidate.name, 'ar'))
                .slice(0, 3);

            prevMonthRanking.forEach((item, index) => {
                const rank = index + 1;
                const rankTitles = ['المركز الأول', 'المركز الثاني', 'المركز الثالث'];
                const rankPoints = [20, 15, 10];
                const rankEmojis = ['🥇', '🥈', '🥉'];
                const candidate = item.candidate;
                const awardMeta = `leaderboard_reward_${prevMonthPrefix}_rank_${rank}`;
                const awardRecord = (candidate.attendanceHistory || []).find(h => h.meta === awardMeta);

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

            // 4. Single Monthly Badges for Current Month (أوسمة شهرية مفردة)
            BADGES_CONFIG.filter(b => b.category === 'monthly').forEach(badge => {
                const isUnlocked = badge.check(history, pts, currentMonthPrefix);
                if (isUnlocked) {
                    const singleAwardRecord = history.find(h =>
                        (h.meta && h.meta.includes(`badge_reward_${badge.id}_${currentMonthPrefix}`)) ||
                        (h.description && h.description.includes(badge.name) && h.date && h.date.startsWith(currentMonthPrefix))
                    );
                    alerts.push({
                        id: `monthly_single_${badge.id}_${currentMonthPrefix}_${student.id}`,
                        studentId: student.id,
                        studentName: student.name,
                        student,
                        badgeId: badge.id,
                        badgeTitle: `وسام: ${badge.name}`,
                        badgeEmoji: badge.emoji,
                        category: 'monthly_single',
                        categoryLabel: 'وسام شهري مفرد',
                        periodLabel: getArabicMonthName(currentMonthPrefix),
                        monthPrefix: currentMonthPrefix,
                        description: badge.description,
                        progress: badge.getProgress(history, pts, currentMonthPrefix),
                        isAwarded: !!singleAwardRecord,
                        awardedRecord: singleAwardRecord,
                        suggestedPoints: 10,
                        color: badge.color
                    });
                }
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
        if ((targetStudent.attendanceHistory || []).some(h => h.meta === targetMeta)) {
            showToast('تم منح مكافأة هذا الوسام بالفعل.');
            return;
        }

        const recordDate = getCairoDateKey();
        const newRecord = {
            id: generateId(),
            date: recordDate,
            points: pts,
            type: 'participation',
            typeName: alertItem.category.startsWith('monthly') ? 'مكافأة تجميع الأوسمة' : 'مكافأة إنجاز وسام',
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
                let filteredPoints = student.points || 0;
                
                if (leaderboardFilter === 'current_month') {
                    filteredPoints = (student.attendanceHistory || [])
                        .filter(h => h.date && h.date.startsWith(currentMonthPrefix))
                        .filter(h => h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
                        .reduce((sum, h) => sum + Number(h.points || 0), 0);
                } else if (leaderboardFilter === 'prev_month') {
                    filteredPoints = (student.attendanceHistory || [])
                        .filter(h => h.date && h.date.startsWith(prevMonthPrefix))
                        .filter(h => h.typeName !== 'مكافأة لوحة الصدارة' && !(h.meta && h.meta.startsWith('leaderboard_reward_')))
                        .reduce((sum, h) => sum + Number(h.points || 0), 0);
                }
                
                return {
                    ...student,
                    pointsForLeaderboard: filteredPoints
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

    const { superAdmin, otherAdmins } = useMemo(() => {
        const superAdmin = admins.find(a => a.isSuperAdmin);
        const otherAdmins = admins.filter(a => !a.isSuperAdmin);
        return { superAdmin, otherAdmins };
    }, [admins]);

    const isAuthenticated = !!loggedInAdmin;
    const isSuperAdmin = loggedInAdmin?.isSuperAdmin;
    const isMinaAdmin = useMemo(() => {
        if (!loggedInAdmin || !loggedInAdmin.name) return false;
        const name = loggedInAdmin.name.trim();
        return name.includes('مينا') || name.toLowerCase().includes('mina');
    }, [loggedInAdmin]);

    // بث حالة دخول مينا لملف الهدايا (GiftsShop.tsx) المستقل - إضافة فقط، مش بتغيّر أي منطق موجود
    useEffect(() => {
        window.__isMinaAdmin = isMinaAdmin;
        window.dispatchEvent(new CustomEvent('mina-admin-status', { detail: isMinaAdmin }));
    }, [isMinaAdmin]);

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

    const openPointsEditModal = (student) => {
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

        const updatedList = students.map(s => {
            if (s.id === studentForPointsEdit.id) {
                const history = s.attendanceHistory || [];
                return {
                    ...s,
                    points: Math.max(0, (s.points || 0) + diff),
                    customMoney: moneyVal,
                    attendanceHistory: newRecord ? [newRecord, ...history] : history
                };
            }
            return s;
        });
        saveStudentsData(updatedList);

        setToastMessage(`✨ تم تعديل رصيد ${studentForPointsEdit.name} إلى ${ptsVal} نقطة و (${moneyVal} جنيه) بنجاح!`);
        setTimeout(() => setToastMessage(null), 4000);
        setStudentForPointsEdit(null);
    };
    
    return (
        <div className="text-slate-100 min-h-screen p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                <header className="flex justify-between items-center mb-6 pb-4 border-b border-indigo-800/50">
                    <div>
                        <h1 className="text-3xl md:text-4xl font-bold text-amber-400 tracking-wider">Points ثانوي بنين</h1>
                        <p className="text-lg text-indigo-300 mt-1">اجتماع الأنبا رويس - كنيسة مارمينا</p>
                    </div>
                    <div className="flex items-center gap-2 md:gap-4">
                        <button
                            type="button"
                            onClick={async () => {
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
                            }}
                            className="bg-indigo-800 hover:bg-indigo-700 text-white p-2 rounded-full transition-colors"
                            title="تحديث التطبيق وتنظيف الكاش"
                            aria-label="تحديث التطبيق وتنظيف الكاش"
                        >
                            🔄
                        </button>
                        {isMinaAdmin && (
                            <button 
                                onClick={() => setActiveView('badge_alerts')}
                                className={`relative p-2 rounded-full transition-all flex items-center justify-center ${
                                    activeView === 'badge_alerts'
                                        ? 'bg-amber-500 text-indigo-950 shadow-md ring-2 ring-amber-400'
                                        : pendingBadgesCount > 0
                                        ? 'bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/50'
                                        : 'bg-indigo-800 hover:bg-indigo-700 text-white'
                                }`}
                                title="تنبيهات واستحقاقات الأوسمة والمكافآت (خاص بمينا)"
                                aria-label="تنبيهات الأوسمة (مينا)"
                            >
                                <BellIcon className="w-6 h-6" />
                                {pendingBadgesCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-red-500 to-rose-600 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-lg border-2 border-indigo-950 animate-bounce">
                                        {pendingBadgesCount}
                                    </span>
                                )}
                            </button>
                        )}
                        {isMinaAdmin && (
                            <button
                                onClick={() => window.dispatchEvent(new CustomEvent('open-gifts-shop'))}
                                className="relative bg-indigo-800 hover:bg-indigo-700 text-white p-2 rounded-full transition-colors text-xl leading-none"
                                title="متجر الهدايا"
                                aria-label="متجر الهدايا"
                            >
                                🎁
                                {giftsPendingCount > 0 && (
                                    <span className="absolute -top-1.5 -right-1.5 bg-gradient-to-r from-red-500 to-rose-600 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center shadow-lg border-2 border-indigo-950">
                                        {giftsPendingCount}
                                    </span>
                                )}
                            </button>
                        )}
                        {isAuthenticated && (
                            <button 
                                onClick={() => setBackupModalOpen(true)}
                                className="bg-indigo-800 hover:bg-indigo-700 text-white p-2 rounded-full transition-colors"
                                aria-label="النسخ الاحتياطي"
                            >
                                <CloudArrowUpIcon className="w-6 h-6" />
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
                
                {isSuperAdmin && (
                    <div className="mb-4 bg-indigo-900/50 border border-amber-500/30 p-3 rounded-lg flex items-center justify-between">
                         <div className="flex items-center gap-2 text-amber-400">
                             <CalendarIcon className="w-5 h-5" />
                             <span className="font-bold">تاريخ التسجيل:</span>
                         </div>
                         <input 
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            className="bg-indigo-950 border border-indigo-700 rounded px-2 py-1 text-white focus:outline-none focus:border-amber-500"
                        />
                    </div>
                )}
                
                <main>
                    <div className="mb-6 bg-indigo-900/70 p-1.5 rounded-xl flex items-center gap-2 border border-indigo-800/50 overflow-x-auto">
                        <button onClick={() => setActiveView('students')} className={`flex-1 min-w-[120px] text-center rounded-lg py-2 font-bold flex items-center justify-center gap-2 transition-colors ${activeView === 'students' ? 'bg-indigo-700 text-amber-400' : 'text-indigo-300 hover:bg-indigo-800/50'}`}>
                            <UserGroupIcon className="w-5 h-5" />
                            <span className="whitespace-nowrap">شباب الأنبا رويس ({students.length})</span>
                        </button>
                         <button onClick={() => setActiveView('leaderboard')} className={`flex-1 min-w-[120px] text-center rounded-lg py-2 font-bold flex items-center justify-center gap-2 transition-colors ${activeView === 'leaderboard' ? 'bg-indigo-700 text-amber-400' : 'text-indigo-300 hover:bg-indigo-800/50'}`}>
                             <TrophyIcon className="w-5 h-5" />
                             <span className="whitespace-nowrap">Leaders Board</span>
                         </button>
                         <button onClick={() => setActiveView('attendance_summary')} className={`flex-1 min-w-[120px] text-center rounded-lg py-2 font-bold flex items-center justify-center gap-2 transition-colors ${activeView === 'attendance_summary' ? 'bg-indigo-700 text-amber-400' : 'text-indigo-300 hover:bg-indigo-800/50'}`}>
                            <CalendarIcon className="w-5 h-5" />
                            <span className="whitespace-nowrap">سجل الاجتماعات</span>
                        </button>
                    </div>

                    {activeView === 'students' && (
                        <div>
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
                                                <div className="flex flex-col items-center justify-center min-w-[96px] leading-tight">
                                                    <div className="text-amber-400 font-bold text-xl">{student.points || 0}</div>
                                                    <div className="text-[9px] text-sky-300/90 font-bold text-center mt-1 whitespace-nowrap">
                                                        نقاط السنين السابقة: {student.previousYearsPoints || 0}
                                                    </div>
                                                    {isMinaAdmin && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleEditStudent(student);
                                                            }}
                                                            className="mt-1 text-[9px] text-amber-300 hover:text-amber-200 font-black underline underline-offset-2"
                                                            title="تعديل نقاط السنين السابقة"
                                                        >
                                                            ✏️ تعديل السنين السابقة
                                                        </button>
                                                    )}
                                                    <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-400/30 text-center whitespace-nowrap">
                                                        <div className="text-[9px] text-emerald-200 font-black leading-none">TOTAL POINTS</div>
                                                        <div className="text-lg text-emerald-300 font-black leading-tight">
                                                            {getStudentTotalPoints(student)}
                                                        </div>
                                                        <div className="text-[8px] text-emerald-200/70 font-semibold leading-none">السابق + الحالي</div>
                                                    </div>
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

                                                 {/* --- Badges and Achievements --- */}
                                                 <div className="mt-4 pt-4 border-t border-indigo-805/30 animate-fade-in-out">
                                                     <h4 className="text-sm font-semibold text-indigo-200 mb-3.5 flex items-center gap-2">
                                                         <span className="text-sm leading-none">🎖️</span>
                                                         <span>الأوسمة وإنجازات الشاب:</span>
                                                     </h4>
                                                     
                                                     {/* --- Section 1: Monthly Badges --- */}
                                                     <div className="mb-4 bg-indigo-950/30 p-3 rounded-xl border border-indigo-900/30">
                                                         <h5 className="text-xs font-black text-amber-300 mb-2.5 flex items-center gap-1.5 opacity-95">
                                                             <span>🕒</span>
                                                             <span>أوسمة الشهر الحالي ({getMonthFormattedAr()}):</span>
                                                         </h5>
                                                         <div className="flex flex-wrap gap-2">
                                                             {BADGES_CONFIG.filter(b => b.category === 'monthly').map(badge => {
                                                                 const isUnlocked = badge.check(student.attendanceHistory, student.points, getCairoMonthPrefix());
                                                                 const progress = badge.getProgress(student.attendanceHistory, student.points, getCairoMonthPrefix());
                                                                 return (
                                                                     <button
                                                                         key={badge.id}
                                                                         onClick={(e) => {
                                                                             e.stopPropagation();
                                                                             setSelectedBadgeDetail({
                                                                                 ...badge,
                                                                                 isUnlocked,
                                                                                 progress
                                                                             });
                                                                         }}
                                                                         className={`flex items-center gap-1.5 py-1 px-2.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none border ${
                                                                             isUnlocked 
                                                                                 ? 'bg-amber-950/70 text-amber-300 border-amber-500/40 hover:bg-amber-900/60 hover:border-amber-400 hover:scale-[1.03]' 
                                                                                 : 'bg-indigo-950/15 text-indigo-500/40 border-indigo-900/20 opacity-[0.55] hover:opacity-100 hover:text-indigo-400'
                                                                         }`}
                                                                     >
                                                                         <span className="text-sm">{badge.emoji}</span>
                                                                         <span>{badge.name}</span>
                                                                         {isUnlocked ? (
                                                                             <span className="text-[10px] text-green-400 font-extrabold font-mono">✓</span>
                                                                         ) : (
                                                                             <span className="text-[9px] text-indigo-400/50 font-mono">({progress})</span>
                                                                         )}
                                                                     </button>
                                                                 );
                                                             })}
                                                         </div>
                                                     </div>

                                                     {/* --- Section 2: Cumulative Badges --- */}
                                                     <div className="bg-indigo-950/30 p-3 rounded-xl border border-indigo-900/30">
                                                         <h5 className="text-xs font-black text-indigo-300 mb-2.5 flex items-center gap-1.5 opacity-95">
                                                             <span>🏆</span>
                                                             <span>ألقاب تراكمية وتحديات رقمية:</span>
                                                         </h5>
                                                         <div className="flex flex-wrap gap-2">
                                                             {BADGES_CONFIG.filter(b => b.category === 'cumulative').map(badge => {
                                                                 const isUnlocked = badge.check(student.attendanceHistory, student.points, undefined);
                                                                 const progress = badge.getProgress(student.attendanceHistory, student.points, undefined);
                                                                 return (
                                                                     <button
                                                                         key={badge.id}
                                                                         onClick={(e) => {
                                                                             e.stopPropagation();
                                                                             setSelectedBadgeDetail({
                                                                                 ...badge,
                                                                                 isUnlocked,
                                                                                 progress
                                                                             });
                                                                         }}
                                                                         className={`flex items-center gap-1.5 py-1 px-2.5 rounded-full text-xs font-bold transition-all cursor-pointer select-none border ${
                                                                             isUnlocked 
                                                                                 ? 'bg-indigo-950/80 text-amber-300 border-amber-500/40 hover:bg-indigo-900 hover:border-amber-400 hover:scale-[1.03]' 
                                                                                 : 'bg-indigo-950/15 text-indigo-500/40 border-indigo-900/20 opacity-[0.55] hover:opacity-100 hover:text-indigo-400'
                                                                         }`}
                                                                     >
                                                                         <span className="text-sm">{badge.emoji}</span>
                                                                         <span>{badge.name}</span>
                                                                         {isUnlocked ? (
                                                                             <span className="text-[10px] text-green-400 font-extrabold font-mono font-sans">✓</span>
                                                                         ) : (
                                                                             <span className="text-[9px] text-indigo-400/50 font-mono">({progress})</span>
                                                                         )}
                                                                     </button>
                                                                 );
                                                             })}
                                                         </div>
                                                     </div>
                                                 </div>

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
                    {activeView === 'leaderboard' && (
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
                                     const rank = index + 1;
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
                    

                    {activeView === 'attendance_summary' && (
                        <div className="space-y-4 animate-fade-in-out">
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
                                                                            <div className="w-2 h-2 rounded-full bg-green-500"></div>
                                                                            <span className="text-white font-semibold">{s.name}</span>
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

                </main>
            </div>

            {isAuthenticated && (
                <div className="fixed bottom-6 left-6 flex flex-col items-center gap-4 z-40">
                     <button
                        onClick={() => setScannerOpen(true)}
                        className="bg-amber-500 hover:bg-amber-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:scale-110"
                        aria-label="فتح الكاميرا للمسح"
                    >
                        <CameraIcon className="w-8 h-8" />
                    </button>
                    <button
                        onClick={() => setAddStudentModalOpen(true)}
                        className="bg-green-600 hover:bg-green-700 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:scale-110"
                        aria-label="إضافة شاب جديد"
                    >
                        <UserPlusIcon className="w-8 h-8" />
                    </button>
                    {isSuperAdmin && (
                        <button
                            onClick={() => setAdminManagementModalOpen(true)}
                            className="bg-sky-600 hover:bg-sky-700 text-white p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:scale-110"
                            aria-label="إدارة الخدام"
                        >
                            <ShieldCheckIcon className="w-8 h-8" />
                        </button>
                    )}
                </div>
            )}

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
                <div className="bg-indigo-800/50 p-4 rounded-lg mb-6">
                    <h3 className="text-lg font-semibold mb-3 text-indigo-200">إضافة خادم جديد</h3>
                    <div className="flex flex-col md:flex-row items-stretch gap-3">
                        <input
                            type="text"
                            value={newAdminName}
                            onChange={(e) => setNewAdminName(e.target.value)}
                            placeholder="اسم الخادم..."
                            className="w-full md:w-auto flex-grow bg-indigo-800 text-white placeholder-indigo-300 border border-indigo-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <input
                            type="password"
                            value={newAdminPin}
                            onChange={(e) => setNewAdminPin(e.target.value)}
                            placeholder="الرقم السري"
                            className="w-full md:w-48 bg-indigo-800 text-white placeholder-indigo-300 border border-indigo-700 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-amber-500"
                        />
                        <button
                            onClick={handleAddAdmin}
                            className="flex-shrink-0 flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                        >
                            <UserPlusIcon className="w-5 h-5" />
                            <span>إضافة</span>
                        </button>
                    </div>
                </div>

                <h3 className="text-lg font-semibold mt-6 mb-3 text-indigo-200">قائمة الخدام الحالية</h3>
                <div className="space-y-3">
                    {admins.filter(a => !a.isSuperAdmin).map(admin => (
                        <div key={admin.id} className="p-3 bg-indigo-800/50 rounded-lg space-y-3">
                           <div className="flex justify-between items-center">
                               <div>
                                   <p className="font-semibold">{admin.name}</p>
                                   {admin.isLocked ? (
                                       <span className="text-xs text-red-400 font-semibold">● معطل</span>
                                   ) : (
                                       <span className="text-xs text-green-400 font-semibold">● نشط</span>
                                   )}
                               </div>
                               {admin.failedAttempts >= 5 && (
                                   <button 
                                       onClick={() => handleUnlockAdminByFailure(admin.id)}
                                       className="flex items-center gap-1.5 bg-yellow-600 hover:bg-yellow-700 text-white text-xs font-bold py-1 px-2 rounded-lg transition-colors"
                                   >
                                       <KeyIcon className="w-3 h-3"/>
                                       <span>مقفل (5 محاولات)</span>
                                   </button>
                               )}
                           </div>
                            
                            {editingAdminId === admin.id ? (
                                <div className="flex items-center gap-2">
                                    <input
                                        type="password"
                                        value={editingAdminPinValue}
                                        onChange={e => setEditingAdminPinValue(e.target.value)}
                                        placeholder="الرقم السري الجديد"
                                        className="flex-grow bg-indigo-700 text-white placeholder-indigo-300 border border-indigo-600 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-500"
                                        autoFocus
                                    />
                                    <button onClick={() => handleSaveAdminPin(admin.id)} className="text-green-400 hover:text-green-300 p-1.5 rounded-full bg-indigo-900/50"><CheckIcon className="w-5 h-5"/></button>
                                    <button onClick={() => setEditingAdminId(null)} className="text-red-400 hover:text-red-300 p-1.5 rounded-full bg-indigo-900/50"><XIcon className="w-5 h-5"/></button>
                                </div>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleToggleAdminStatus(admin.id)}
                                        className={`flex-1 text-sm font-bold py-1.5 px-3 rounded-lg transition-colors ${admin.isLocked ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white`}
                                    >
                                        {admin.isLocked ? 'تفعيل' : 'تعطيل'}
                                    </button>
                                    <button
                                        onClick={() => handleStartEditPin(admin)}
                                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-bold py-1.5 px-3 rounded-lg transition-colors"
                                    >
                                        تغيير الرقم السري
                                    </button>
                                </div>
                            )}

                        </div>
                    ))}
                </div>
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
                <div className="fixed bottom-6 right-6 bg-indigo-900 text-white py-2 px-5 rounded-lg shadow-xl border border-indigo-700 animate-fade-in-out">
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
                            <div className="bg-amber-500/20 text-amber-300 px-3.5 py-2 rounded-xl border border-amber-500/30 text-xs font-black shadow-inner">الرصيد الحالي: {studentForPointsEdit.pointsForLeaderboard ?? studentForPointsEdit.points ?? 0} نقطة | {getStudentMoney(studentForPointsEdit)} جنيه</div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="bg-indigo-900/40 p-4 rounded-xl border border-indigo-800/40"><label className="block text-xs font-bold text-amber-300 mb-2">عدد النقاط المطلوب 🎯</label><div className="relative"><input type="number" value={targetPointsInput} onChange={(e) => handlePointsInputChange(e.target.value)} placeholder="مثال: 100" className="w-full bg-indigo-950 text-white font-extrabold text-lg px-3 py-2.5 rounded-lg border border-indigo-700 focus:outline-none focus:border-amber-500 text-right" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 font-bold">نقطة</span></div></div>
                            <div className="bg-indigo-900/40 p-4 rounded-xl border border-indigo-800/40"><label className="block text-xs font-bold text-amber-300 mb-2">القيمة بالجنيه 💰 (مستقلة تماماً)</label><div className="relative"><input type="number" value={targetMoneyInput} onChange={(e) => handleMoneyInputChange(e.target.value)} placeholder="مثال: 50" className="w-full bg-indigo-950 text-white font-extrabold text-lg px-3 py-2.5 rounded-lg border border-indigo-700 focus:outline-none focus:border-amber-500 text-right" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-indigo-400 font-bold">جنيه</span></div></div>
                        </div>
                        <div className="bg-amber-500/10 border border-amber-500/30 p-3.5 rounded-xl text-xs text-amber-200/90 leading-relaxed">💡 <span className="font-bold text-amber-300">تنويه:</span> النقاط والجنيهات منفصلان تماماً. يمكنك إدخال أي عدد نقاط وأي مبلغ بالجنيه بشكل مستقل دون تأثر إحداهما بالأخرى.</div>
                        <div className="flex gap-3 pt-2">
                            <button onClick={handleSavePointsEdit} className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-indigo-950 font-black py-3 rounded-xl transition-all text-sm shadow-md active:scale-[0.98]">حفظ التغييرات 💾</button>
                            <button onClick={() => setStudentForPointsEdit(null)} className="px-5 bg-indigo-900 hover:bg-indigo-800 text-indigo-200 font-bold py-3 rounded-xl transition-all text-sm">إلغاء</button>
                        </div>
                    </div>
                )}
            </Modal>

        </div>
    );
};

export default App;