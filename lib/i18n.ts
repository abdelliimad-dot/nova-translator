export type UiLocale = "en" | "ar";

export const LANGUAGE_ARABIC_NAMES: Record<string, string> = {
  ar: "العربية",
  en: "الإنجليزية",
  es: "الإسبانية",
  fr: "الفرنسية",
  de: "الألمانية",
  it: "الإيطالية",
  pt: "البرتغالية",
  tr: "التركية",
  ja: "اليابانية",
  ko: "الكورية",
  zh: "الصينية",
  hi: "الهندية",
  ur: "الأردية",
};

export interface NovaDictionary {
  brandName: string;
  brandSubtitle: string;
  heroTitle: string;
  heroSubtitle: string;
  fromLabel: string;
  toLabel: string;
  swapLanguagesAria: string;
  moreLanguages: string;
  moreLanguagesTitle: string;
  searchLanguagesPlaceholder: string;
  noLanguagesFound: string;
  bidirectionalHint: string;
  selectFromTitle: string;
  selectToTitle: string;
  modeABadge: string;
  modeATitle: string;
  modeASubtitle: string;
  modeACta: string;
  modeBBadge: string;
  modeBTitle: string;
  modeBSubtitle: string;
  modeBCta: string;
  modeCBadge: string;
  modeCTitle: string;
  modeCSubtitle: string;
  modeCCta: string;
  trustSecure: string;
  trustInstant: string;
  trustMulti: string;
  madeForConversations: string;
  testEarbudsBtn: string;
  settingsTitle: string;
  settingsSubtitle: string;
  closeLabel: string;
  installAppPrompt: string;
  installAppCta: string;
  iosInstallHint: string;
  uiLanguageLabel: string;
  presets: {
    arEn: string;
    arFr: string;
    arTr: string;
  };
  settingsGroups: {
    audio: string;
    translation: string;
    listening: string;
    app: string;
    privacy: string;
  };
  settingsFields: {
    micLabel: string;
    autoBuiltInMic: string;
    bluetoothRiskWarning: string;
    stereoOutputLabel: string;
    earbudTestTitle: string;
    earbudTestDesc: string;
    earbudTestAction: string;
    autoDetectLabel: string;
    autoDetectDesc: string;
    voicePersonaLabel: string;
    voicePersonaHint: string;
    vadModeLabel: string;
    autoVad: string;
    pushToTalk: string;
    vadSensitivity: string;
    sensitivityLow: string;
    sensitivityBalanced: string;
    sensitivityHigh: string;
    wakeLockLabel: string;
    wakeLockDesc: string;
    saveTranscriptsLabel: string;
    saveTranscriptsDesc: string;
    hapticsLabel: string;
    hapticsDesc: string;
    exportTranscript: string;
    clearTranscripts: string;
    clearSessionData: string;
    privacySummary: string;
    micPermissionInfo: string;
  };
}

const EN_DICT: NovaDictionary = {
  brandName: "NOVA",
  brandSubtitle: "Live Voice Translator",
  heroTitle: "Understand each other",
  heroSubtitle: "Speak naturally in two languages—no typing needed.",
  fromLabel: "You speak",
  toLabel: "Partner",
  swapLanguagesAria: "Swap languages",
  moreLanguages: "All",
  moreLanguagesTitle: "Choose Language",
  searchLanguagesPlaceholder: "Search language (English, Arabic, fr...)",
  noLanguagesFound: "No languages match your search.",
  bidirectionalHint: "Translates both ways automatically",
  selectFromTitle: "Choose what you speak",
  selectToTitle: "Choose what your partner speaks",
  modeABadge: "One phone",
  modeATitle: "Share Earbuds",
  modeASubtitle: "Two people sit together with one phone",
  modeACta: "Start Conversation",
  modeBBadge: "Two phones",
  modeBTitle: "Connect Two Phones",
  modeBSubtitle: "Each person listens on their own phone",
  modeBCta: "Create or Join",
  modeCBadge: "Mode C",
  modeCTitle: "Phone Speaker",
  modeCSubtitle: "No earbuds · One phone",
  modeCCta: "Start Speaker Mode",
  trustSecure: "Private audio",
  trustInstant: "Real-time voice",
  trustMulti: "13 languages",
  madeForConversations: "Made for conversations",
  testEarbudsBtn: "Check Left & Right Earbuds",
  settingsTitle: "Settings",
  settingsSubtitle: "Audio, voice, listening & privacy",
  closeLabel: "Close",
  installAppPrompt: "Install NOVA on your phone for quick access.",
  installAppCta: "Install",
  iosInstallHint: "Safari: tap Share, then Add to Home Screen.",
  uiLanguageLabel: "App Language",
  presets: {
    arEn: "AR ↔ EN",
    arFr: "AR ↔ FR",
    arTr: "AR ↔ TR",
  },
  settingsGroups: {
    audio: "Audio & Earbuds",
    translation: "Translation & Voice",
    listening: "Listening",
    app: "Preferences",
    privacy: "Privacy",
  },
  settingsFields: {
    micLabel: "Microphone",
    autoBuiltInMic: "Phone Microphone (Recommended)",
    bluetoothRiskWarning:
      "Using a Bluetooth mic can merge left & right earbud audio. Switching to your phone mic keeps both ears separate.",
    stereoOutputLabel: "Earbud Channel Balance",
    earbudTestTitle: "Check Left & Right Earbuds",
    earbudTestDesc: "Make sure each person hears only their own language",
    earbudTestAction: "Test Ears",
    autoDetectLabel: "Auto-detect who is speaking",
    autoDetectDesc: "Automatically translate whichever language is heard",
    voicePersonaLabel: "Translation Voice",
    voicePersonaHint: "Used when starting or restarting a conversation",
    vadModeLabel: "Listening Style",
    autoVad: "Hands-free",
    pushToTalk: "Hold to talk",
    vadSensitivity: "Noise Filtering",
    sensitivityLow: "Noisy places",
    sensitivityBalanced: "Balanced",
    sensitivityHigh: "Quiet rooms",
    wakeLockLabel: "Keep Screen Awake",
    wakeLockDesc: "Stop screen from locking while translating",
    saveTranscriptsLabel: "Save Conversation History",
    saveTranscriptsDesc: "Keep your text history on this device",
    hapticsLabel: "Subtle Haptics",
    hapticsDesc: "Gentle vibration when starting or tapping buttons",
    exportTranscript: "Copy Transcript",
    clearTranscripts: "Clear History",
    clearSessionData: "Reset Preferences",
    privacySummary:
      "Audio connects directly during your session using temporary session credentials.",
    micPermissionInfo:
      "Your microphone is only active while you are in a live session or earbud check.",
  },
};

const AR_DICT: NovaDictionary = {
  brandName: "NOVA",
  brandSubtitle: "مترجم صوتي فوري",
  heroTitle: "نفهم بعضنا بسهولة",
  heroSubtitle: "تحدّث بطبيعتك بلغتين دون الحاجة للكتابة.",
  fromLabel: "تتحدث",
  toLabel: "الشريك",
  swapLanguagesAria: "تبديل اللغتين",
  moreLanguages: "الكل",
  moreLanguagesTitle: "اختر اللغة",
  searchLanguagesPlaceholder: "ابحث عن لغة (عربي، إنجليزي، fr...)",
  noLanguagesFound: "لا توجد لغة مطابقة للبحث.",
  bidirectionalHint: "يُترجم بالاتجاهين تلقائيًا",
  selectFromTitle: "اختر اللغة التي تتحدث بها",
  selectToTitle: "اختر اللغة التي يتحدث بها شريكك",
  modeABadge: "هاتف واحد",
  modeATitle: "مشاركة السماعتين",
  modeASubtitle: "شخصان معًا يستخدمان هاتفًا واحدًا",
  modeACta: "ابدأ المحادثة",
  modeBBadge: "هاتفان",
  modeBTitle: "ربط هاتفين",
  modeBSubtitle: "كل شخص يتحدث ويستمع على هاتفه",
  modeBCta: "إنشاء أو دخول",
  modeCBadge: "Mode C",
  modeCTitle: "مكبر الصوت",
  modeCSubtitle: "بدون سماعات · هاتف واحد",
  modeCCta: "ابدأ عبر مكبر الصوت",
  trustSecure: "خصوصية كاملة",
  trustInstant: "صوت فوري",
  trustMulti: "13 لغة",
  madeForConversations: "صُمّم للحوار الإنساني",
  testEarbudsBtn: "فحص السماعة اليسرى واليمنى",
  settingsTitle: "الإعدادات",
  settingsSubtitle: "الصوت، النبرة، الاستماع والخصوصية",
  closeLabel: "إغلاق",
  installAppPrompt: "ثبّت NOVA على هاتفك للوصول السريع.",
  installAppCta: "تثبيت",
  iosInstallHint: "في سفاري: اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.",
  uiLanguageLabel: "لغة التطبيق",
  presets: {
    arEn: "عربي ↔ EN",
    arFr: "عربي ↔ FR",
    arTr: "عربي ↔ TR",
  },
  settingsGroups: {
    audio: "الصوت والسماعات",
    translation: "الترجمة والنبرة",
    listening: "الاستماع",
    app: "التفضيلات",
    privacy: "الخصوصية",
  },
  settingsFields: {
    micLabel: "الميكروفون",
    autoBuiltInMic: "ميكروفون الهاتف (مستحسن)",
    bluetoothRiskWarning:
      "ميكروفون البلوتوث قد يدمج صوت السماعتين. اختيار ميكروفون الهاتف يحافظ على فصل اليمين واليسار.",
    stereoOutputLabel: "توازن السماعتين",
    earbudTestTitle: "فحص السماعة اليسرى واليمنى",
    earbudTestDesc: "تأكد أن كل شخص يسمع ترجمته في أذنه فقط",
    earbudTestAction: "فحص",
    autoDetectLabel: "التعرف التلقائي على المتحدث",
    autoDetectDesc: "ترجمة أي من اللغتين تلقائيًا فور سماعها",
    voicePersonaLabel: "نبرة صوت المترجم",
    voicePersonaHint: "تُطبّق عند بدء محادثة جديدة",
    vadModeLabel: "طريقة الاستماع",
    autoVad: "تلقائي",
    pushToTalk: "اضغط للتحدث",
    vadSensitivity: "تصفية الضوضاء",
    sensitivityLow: "أماكن صاخبة",
    sensitivityBalanced: "متوازن",
    sensitivityHigh: "أماكن هادئة",
    wakeLockLabel: "إبقاء الشاشة مضاءة",
    wakeLockDesc: "منع قفل الشاشة أثناء الترجمة",
    saveTranscriptsLabel: "حفظ سجل المحادثة",
    saveTranscriptsDesc: "الاحتفاظ بالنصوص محليًا على جهازك",
    hapticsLabel: "اهتزاز خفيف",
    hapticsDesc: "تنبيه لمسي لطيف عند الضغط",
    exportTranscript: "نسخ المحادثة",
    clearTranscripts: "مسح السجل",
    clearSessionData: "إعادة ضبط التفضيلات",
    privacySummary:
      "يتم بث الصوت مباشرة خلال الجلسة باستخدام رموز تحقق مؤقتة.",
    micPermissionInfo:
      "لا يعمل الميكروفون إلا أثناء وجود جلسة نشطة أو فحص السماعات.",
  },
};

export function getDictionary(locale: UiLocale): NovaDictionary {
  return locale === "ar" ? AR_DICT : EN_DICT;
}
