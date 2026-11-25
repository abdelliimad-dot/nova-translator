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
  brandSubtitle: "Real-Time AI Translation",
  heroTitle: "Understand each other",
  heroSubtitle: "Speak naturally. Connect globally.",
  fromLabel: "From",
  toLabel: "To",
  swapLanguagesAria: "Swap languages",
  moreLanguages: "More",
  moreLanguagesTitle: "Choose Language",
  selectFromTitle: "Select source language",
  selectToTitle: "Select target language",
  modeABadge: "Mode A",
  modeATitle: "Face to Face",
  modeASubtitle: "Share earbuds · One phone",
  modeACta: "Start Conversation",
  modeBBadge: "Mode B",
  modeBTitle: "Connect Two Phones",
  modeBSubtitle: "Create or join a room",
  modeBCta: "Create / Join Room",
  trustSecure: "Secure & Private",
  trustInstant: "Instant Translation",
  trustMulti: "Multi-Language",
  madeForConversations: "Made for conversations",
  testEarbudsBtn: "Test Left / Right Earbuds",
  settingsTitle: "Settings",
  settingsSubtitle: "Audio, translation, listening & privacy",
  closeLabel: "Close",
  installAppPrompt: "Install NOVA on your phone for an app experience.",
  installAppCta: "Install",
  iosInstallHint: "Safari: tap Share, then Add to Home Screen.",
  uiLanguageLabel: "Interface Language",
  presets: {
    arEn: "AR ↔ EN",
    arFr: "AR ↔ FR",
    arTr: "AR ↔ TR",
  },
  settingsGroups: {
    audio: "Audio",
    translation: "Translation",
    listening: "Listening",
    app: "App",
    privacy: "Privacy",
  },
  settingsFields: {
    micLabel: "Input Microphone",
    autoBuiltInMic: "Built-in Phone Microphone (Auto)",
    bluetoothRiskWarning:
      "Bluetooth headset mic is selected. Switch to your phone's built-in mic to keep A2DP stereo separation.",
    stereoOutputLabel: "Stereo Channel Output",
    earbudTestTitle: "Left / Right Earbud Check",
    earbudTestDesc: "Verify hard stereo panning & built-in mic lock",
    earbudTestAction: "Open Test",
    autoDetectLabel: "Automatic Language Detection",
    autoDetectDesc: "Detect Arabic or partner language on each turn",
    voicePersonaLabel: "AI Voice Persona",
    voicePersonaHint: "Applies when starting or restarting a live session",
    vadModeLabel: "Capture Mode",
    autoVad: "Auto VAD",
    pushToTalk: "Push-to-Talk",
    vadSensitivity: "VAD Sensitivity",
    sensitivityLow: "Strict (noisy places)",
    sensitivityBalanced: "Balanced",
    sensitivityHigh: "Sensitive (quiet rooms)",
    wakeLockLabel: "Keep Screen Awake",
    wakeLockDesc: "Prevent screen sleep during active conversations",
    saveTranscriptsLabel: "Save Conversation History",
    saveTranscriptsDesc: "Preserve transcripts during brief reconnects",
    hapticsLabel: "Subtle Haptics",
    hapticsDesc: "Gentle vibration on tap and speech cues",
    exportTranscript: "Copy Transcript",
    clearTranscripts: "Clear Transcripts",
    clearSessionData: "Reset Preferences",
    privacySummary:
      "Audio is streamed directly over short-lived ephemeral tokens; your API key never leaves the server.",
    micPermissionInfo:
      "Microphone permission is only used while a live session or earbud test is active.",
  },
};

const AR_DICT: NovaDictionary = {
  brandName: "NOVA",
  brandSubtitle: "ترجمة صوتية فورية بالذكاء الاصطناعي",
  heroTitle: "نفهم بعضنا بسهولة",
  heroSubtitle: "تحدّث بعفوية. تواصل مع العالم.",
  fromLabel: "من",
  toLabel: "إلى",
  swapLanguagesAria: "تبديل اللغتين",
  moreLanguages: "المزيد",
  moreLanguagesTitle: "اختر اللغة",
  selectFromTitle: "اختر لغة المتحدث",
  selectToTitle: "اختر لغة الترجمة",
  modeABadge: "الوضع A",
  modeATitle: "وجهًا لوجه",
  modeASubtitle: "مشاركة السماعتين · هاتف واحد",
  modeACta: "ابدأ المحادثة",
  modeBBadge: "الوضع B",
  modeBTitle: "ربط هاتفين",
  modeBSubtitle: "إنشاء غرفة أو الانضمام إليها",
  modeBCta: "إنشاء / دخول غرفة",
  trustSecure: "آمن وخاص",
  trustInstant: "ترجمة فورية",
  trustMulti: "متعدد اللغات",
  madeForConversations: "صُمّم للحوار الإنساني",
  testEarbudsBtn: "فحص السماعة اليسرى / اليمنى",
  settingsTitle: "الإعدادات",
  settingsSubtitle: "الصوت، الترجمة، الاستماع والخصوصية",
  closeLabel: "إغلاق",
  installAppPrompt: "ثبّت تطبيق NOVA على هاتفك لتجربة أسرع.",
  installAppCta: "تثبيت",
  iosInstallHint: "في سفاري: اضغط مشاركة ثم إضافة إلى الشاشة الرئيسية.",
  uiLanguageLabel: "لغة الواجهة",
  presets: {
    arEn: "عربي ↔ EN",
    arFr: "عربي ↔ FR",
    arTr: "عربي ↔ TR",
  },
  settingsGroups: {
    audio: "الصوت",
    translation: "الترجمة",
    listening: "الاستماع",
    app: "التطبيق",
    privacy: "الخصوصية",
  },
  settingsFields: {
    micLabel: "ميكروفون الإدخال",
    autoBuiltInMic: "ميكروفون الهاتف المدمج (تلقائي)",
    bluetoothRiskWarning:
      "تم اختيار ميكروفون البلوتوث. اختر ميكروفون الهاتف المدمج للحفاظ على ستيريو A2DP.",
    stereoOutputLabel: "مخرج القنوات الستيريو",
    earbudTestTitle: "اختبار السماعة اليسرى / اليمنى",
    earbudTestDesc: "تأكد من فصل القناتين وقفل الميكروفون المدمج",
    earbudTestAction: "فتح الاختبار",
    autoDetectLabel: "اكتشاف اللغة تلقائيًا",
    autoDetectDesc: "تحديد العربية أو لغة الشريك في كل جملة تلقائيًا",
    voicePersonaLabel: "نبرة الصوت بالذكاء الاصطناعي",
    voicePersonaHint: "تُطبّق عند بدء الجلسة أو إعادة تشغيلها",
    vadModeLabel: "وضع الالتقاط",
    autoVad: "تلقائي (VAD)",
    pushToTalk: "اضغط للتحدث",
    vadSensitivity: "حساسية كشف الصوت",
    sensitivityLow: "صارم (للأماكن الصاخبة)",
    sensitivityBalanced: "متوازن",
    sensitivityHigh: "حساس (للهدوء)",
    wakeLockLabel: "إبقاء الشاشة مضاءة",
    wakeLockDesc: "منع إطفاء الشاشة أثناء الترجمة الحية",
    saveTranscriptsLabel: "حفظ سجل المحادثة",
    saveTranscriptsDesc: "الاحتفاظ بالنصوص عند إعادة الاتصال المؤقتة",
    hapticsLabel: "اهتزاز خفيف",
    hapticsDesc: "تنبيه لمسي لطيف عند اللمس وبدء الكلام",
    exportTranscript: "نسخ المحادثة",
    clearTranscripts: "مسح المحادثة",
    clearSessionData: "إعادة ضبط الإعدادات",
    privacySummary:
      "يُبث الصوت عبر رموز جلسة مؤقتة قصيرة العمر، ولا يغادر مفتاح API الخادم مطلقًا.",
    micPermissionInfo:
      "يُستخدم إذن الميكروفون فقط أثناء الجلسة الحية أو اختبار السماعات.",
  },
};

export function getDictionary(locale: UiLocale): NovaDictionary {
  return locale === "ar" ? AR_DICT : EN_DICT;
}
