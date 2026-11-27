export interface SupportedLanguage {
  code: string;
  label: string;
  native: string;
  rtl?: boolean;
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { code: "en", label: "English", native: "English" },
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
  {
    code: "ar-dz",
    label: "Algerian Darija",
    native: "الدارجة الجزائرية",
    rtl: true,
  },
  { code: "fr", label: "French", native: "Français" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "zh", label: "Mandarin Chinese", native: "中文" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "ms", label: "Malay", native: "Bahasa Melayu" },
  { code: "th", label: "Thai", native: "ไทย" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "ur", label: "Urdu", native: "اردو", rtl: true },
] as const;

export function findLanguage(codeOrLabel?: string | null): SupportedLanguage {
  if (!codeOrLabel) return SUPPORTED_LANGUAGES[0];
  const norm = codeOrLabel.trim().toLowerCase();
  return (
    SUPPORTED_LANGUAGES.find(
      (l) => l.code === norm || l.label.toLowerCase() === norm
    ) ?? SUPPORTED_LANGUAGES[0]
  );
}

/**
 * Shared strict simultaneous interpreter prompt for Gemini Live API.
 * Enforces idiomatic meaning-based translation, Arabic dialect fluency
 * (MSA + North African/Algerian Darija), and strict anti-hallucination silence on noise.
 */
export function buildInterpreterSystemPrompt(
  langA: string,
  langB: string
): string {
  const hasDarijaTarget =
    /darija|algerian/i.test(langA) || /darija|algerian/i.test(langB);
  const isArabicInvolved =
    hasDarijaTarget || /arabic/i.test(langA) || /arabic/i.test(langB);

  const dialectGuidance = hasDarijaTarget
    ? ` For Algerian Darija, deeply understand everyday Algerian speech including French and English loanwords, code-switching (e.g., طاكسي، شومبرة، لاكليم، روطار، كونتور، ديجونكتور), and Maghrebi negative markers (ما...ش / ماشي / والو / بلا); when translating INTO Algerian Darija, speak naturally in warm, authentic everyday Algerian Darija so a local listener understands effortlessly—when translating FROM Algerian Darija into ${/darija|algerian/i.test(langA) ? langB : langA}, translate strictly into natural idiomatic ${/darija|algerian/i.test(langA) ? langB : langA}.`
    : isArabicInvolved
      ? ` For Arabic, understand both Modern Standard Arabic (Fusha) and spoken regional dialects—especially North African / Algerian Darija (including negated forms like ماشي / ما...ش / والو, Maghrebi vocabulary, and French/English loanwords)—effortlessly; when translating into Arabic, speak in clear Modern Standard Arabic (Fusha) using standard Arabic vocabulary rather than regional dialect slang or transliterated foreign loanwords.`
      : "";

  return (
    `You are a professional simultaneous voice interpreter between ${langA} and ${langB}.${dialectGuidance} ` +
    `Translate strictly by natural conversational meaning and intent, NEVER word-for-word or literally—render greetings, idioms, and everyday expressions into smooth, idiomatic target speech. ` +
    `STRICT FIDELITY: Preserve exact polarity and negations (never invert negative statements such as "ماشي أنا" / "ne...pas" / "don't" into affirmative), numbers, dates, times, names, forms of address, and final self-corrected choices without omitting key meaning. ` +
    `VOCAL DELIVERY & PROSODY: Speak like a warm, attentive human conversation partner—use natural human cadence, relaxed phrasing, and expressive emotional intonation mirroring the speaker's tone, NEVER flat or robotic. ` +
    `On EVERY utterance independently, detect which language is spoken: if ${langA}, output ONLY the spoken translation in ${langB}; if ${langB}, output ONLY the spoken translation in ${langA}. Never stick to the previous turn's direction. ` +
    `STRICT ANTI-HALLUCINATION RULE: If input is background noise, breathing, silence, coughs, clicks, <noise>, or unintelligible speech, output NOTHING and stay completely silent. ` +
    `Never guess or invent words, answer questions, add commentary, or break character.`
  );
}

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g,
  "ar-dz": /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g,
  ur: /[\u0600-\u06FF\u0750-\u077F]/g,
  hi: /[\u0900-\u097F]/g,
  th: /[\u0E00-\u0E7F]/g,
  ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  zh: /[\u4E00-\u9FFF]/g,
  latin: /[A-Za-zÀ-ÖØ-öø-ÿ]/g,
};

const STOPWORDS: Record<string, RegExp> = {
  en: /\b(the|and|is|are|was|were|you|i|we|they|it|to|of|in|on|at|for|that|this|with|have|has|do|did|can|will|what|where|when|how|why|please|thank|yes|no|sorry|here|there|my|your)\b/gi,
  es: /\b(el|la|los|las|un|una|que|y|en|de|por|para|con|hola|gracias|como|cómo|esta|está|es|son|yo|tú|nosotros|sí|no|pero|donde|dónde|cuando|mi|tu|muy|buenos)\b/gi,
  fr: /\b(le|la|les|un|une|des|et|est|sont|vous|nous|tu|il|elle|je|j|c|l|d|de|du|pour|dans|sur|que|qui|bonjour|merci|avec|pas|ne|oui|non|mais|où|quand|comment|pourquoi|très|bien|mon|ton|ça)\b/gi,
  de: /\b(der|die|das|den|dem|ein|eine|und|ist|sind|ich|du|wir|sie|es|mit|für|auf|in|nicht|ja|nein|danke|hallo|wie|wo|wann|warum|bitte|sehr|gut|mein|dein)\b/gi,
  it: /\b(il|lo|la|i|gli|le|un|una|che|e|è|sono|di|a|da|in|per|con|ciao|grazie|come|dove|quando|io|tu|noi|sì|no|non|ma|molto|bene|questo|quello|mio)\b/gi,
  pt: /\b(o|a|os|as|um|uma|que|e|é|são|de|em|por|para|com|obrigado|obrigada|olá|ola|como|onde|quando|não|nao|sim|mas|eu|você|muito|bem|meu|sua)\b/gi,
  tr: /\b(ve|bir|bu|şu|o|için|ne|nerede|nasıl|ne zaman|teşekkür|teşekkürler|merhaba|evet|hayır|ben|sen|biz|var|yok|değil|çok|iyi|lütfen|ile|ama|mı|mi)\b/gi,
  ms: /\b(saya|anda|terima|kasih|selamat|tolong|mana|berapa|ini|itu|tidur|makan|air|jalan|bilik|lapangan|terbang|boleh|mahu|ya|tidak)\b/gi,
};

const DIACRITIC_BONUSES: Record<string, RegExp> = {
  fr: /[éèêëàâçùûîïôœ]/g,
  es: /[ñáíóú¿¡]/g,
  de: /[äöüß]/g,
  it: /[àèéìòù]/g,
  pt: /[ãõçáéíóú]/g,
  tr: /[ğşıçöüĞŞİÖÜ]/g,
  ur: /[پچژگٹڈڑںھہئے]/g,
};

function scoreLanguageText(text: string, langCode: string): number {
  const scriptRe = SCRIPT_PATTERNS[langCode];
  if (scriptRe) {
    const matches = text.match(scriptRe);
    const baseScore = (matches?.length ?? 0) * 3;
    const distinctRe = DIACRITIC_BONUSES[langCode];
    const bonus = distinctRe ? (text.match(distinctRe)?.length ?? 0) * 8 : 0;
    return baseScore + bonus;
  }

  // Latin-script language: combine Latin character count, stopword hits, and distinct diacritics
  const latinMatches = text.match(SCRIPT_PATTERNS.latin);
  const stopRe = STOPWORDS[langCode];
  const stopHits = stopRe ? text.match(stopRe)?.length ?? 0 : 0;
  const distinctRe = DIACRITIC_BONUSES[langCode];
  const diacriticHits = distinctRe ? text.match(distinctRe)?.length ?? 0 : 0;
  return (latinMatches?.length ?? 0) * 0.4 + stopHits * 5 + diacriticHits * 4;
}

/**
 * Classifies a transcript snippet as belonging to Language A ("A"), Language B ("B"),
 * or undetermined (null). Strips digits/punctuation first so times/numbers or brief
 * code-switched loanwords (e.g. Darija+French) do not flip script attribution.
 */
export function detectLanguageSide(
  text: string,
  langACode: string,
  langBCode: string
): "A" | "B" | null {
  const trimmed = text.replace(/[0-9.,:%!?+\-_/()[\]{}'"@#]/g, " ").trim();
  if (trimmed.length < 1) return null;

  // Fast exact script separation when one is non-Latin and the other is Latin
  const aIsNonLatin = Boolean(SCRIPT_PATTERNS[langACode]);
  const bIsNonLatin = Boolean(SCRIPT_PATTERNS[langBCode]);

  if (aIsNonLatin !== bIsNonLatin) {
    const nonLatinCode = aIsNonLatin ? langACode : langBCode;
    const nonLatinCount =
      trimmed.match(SCRIPT_PATTERNS[nonLatinCode])?.length ?? 0;
    const latinCount = trimmed.match(SCRIPT_PATTERNS.latin)?.length ?? 0;

    if (nonLatinCount === 0 && latinCount === 0) return null;
    // In mixed Arabic/Darija + French utterances, dominant non-Latin words govern speaker
    if (nonLatinCount >= 2 && nonLatinCount * 2 >= latinCount) {
      return aIsNonLatin ? "A" : "B";
    }
    if (nonLatinCount > latinCount) {
      return aIsNonLatin ? "A" : "B";
    }
    if (latinCount > nonLatinCount) {
      return aIsNonLatin ? "B" : "A";
    }
    return null;
  }

  if (trimmed.length < 2) return null;
  const scoreA = scoreLanguageText(trimmed, langACode);
  const scoreB = scoreLanguageText(trimmed, langBCode);
  if (Math.abs(scoreA - scoreB) < 1.5) return null;
  return scoreA > scoreB ? "A" : "B";
}

export interface PrintableTurn {
  speakerLabel: string;
  sourceText: string;
  translatedText: string;
}

export function formatTranscriptForExport(turns: PrintableTurn[]): string {
  return turns
    .map((t) => {
      const lines = [`[${t.speakerLabel}]`];
      if (t.sourceText) lines.push(t.sourceText);
      if (t.translatedText) lines.push(`→ ${t.translatedText}`);
      return lines.join("\n");
    })
    .join("\n\n");
}
