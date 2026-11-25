export interface SupportedLanguage {
  code: string;
  label: string;
  native: string;
  rtl?: boolean;
}

export const SUPPORTED_LANGUAGES: readonly SupportedLanguage[] = [
  { code: "ar", label: "Arabic", native: "العربية", rtl: true },
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "it", label: "Italian", native: "Italiano" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "tr", label: "Turkish", native: "Türkçe" },
  { code: "ja", label: "Japanese", native: "日本語" },
  { code: "ko", label: "Korean", native: "한국어" },
  { code: "zh", label: "Mandarin Chinese", native: "中文" },
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
  const isArabicInvolved =
    /arabic/i.test(langA) || /arabic/i.test(langB);
  const dialectGuidance = isArabicInvolved
    ? ` For Arabic, understand both Modern Standard Arabic (Fusha) and spoken regional dialects—especially North African / Algerian Darija (e.g., Maghrebi vocabulary, French loanwords, and colloquial phrasing)—naturally and effortlessly.`
    : "";

  return (
    `You are a professional simultaneous voice interpreter between ${langA} and ${langB}.${dialectGuidance} ` +
    `Translate strictly by natural conversational meaning and intent, NEVER word-for-word or literally—render greetings, idioms, and everyday expressions into smooth, idiomatic speech that sounds completely natural in the target language. ` +
    `VOCAL DELIVERY & PROSODY: Speak like a warm, attentive human conversation partner—use natural human cadence, relaxed phrasing, smooth micro-pauses, and expressive emotional intonation that mirrors the speaker's tone (warm, friendly, questioning, calm, or urgent), NEVER flat, robotic, or like a formal news anchor. ` +
    `On EVERY utterance independently, detect which language is being spoken: ` +
    `If you hear ${langA}, immediately output ONLY the spoken translation in ${langB}. ` +
    `If you hear ${langB}, immediately output ONLY the spoken translation in ${langA}. ` +
    `Never stick to the previous turn's direction—always translate into the OTHER language. ` +
    `STRICT ANTI-HALLUCINATION RULE: If the audio input is background noise, breathing, silence, coughing, clicks, <noise>, or unintelligible speech, output NOTHING and remain completely silent. ` +
    `Never guess, invent, or hallucinate words, never answer the speaker's questions, never add commentary, and never break character.`
  );
}

const SCRIPT_PATTERNS: Record<string, RegExp> = {
  ar: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/g,
  ur: /[\u0600-\u06FF\u0750-\u077F]/g,
  hi: /[\u0900-\u097F]/g,
  ja: /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g,
  ko: /[\uAC00-\uD7AF\u1100-\u11FF]/g,
  zh: /[\u4E00-\u9FFF]/g,
  latin: /[A-Za-zÀ-ÖØ-öø-ÿ]/g,
};

const STOPWORDS: Record<string, RegExp> = {
  en: /\b(the|and|is|are|you|i|to|of|in|for|that|this|with|have|what|how|please|thank)\b/gi,
  es: /\b(el|la|los|las|que|y|en|de|por|para|con|hola|gracias|como|esta|es)\b/gi,
  fr: /\b(le|la|les|et|est|vous|je|de|pour|dans|que|bonjour|merci|avec|pas)\b/gi,
  de: /\b(der|die|das|und|ist|ich|sie|ein|eine|mit|für|danke|hallo|wie|nicht)\b/gi,
  it: /\b(il|la|le|che|e|di|per|con|ciao|grazie|come|sono|non|questo)\b/gi,
  pt: /\b(o|a|os|as|que|e|de|para|com|obrigado|ola|como|nao|você)\b/gi,
  tr: /\b(ve|bir|bu|için|ne|nasıl|teşekkür|merhaba|evet|hayır|ben|sen)\b/gi,
};

function scoreLanguageText(text: string, langCode: string): number {
  const scriptRe = SCRIPT_PATTERNS[langCode];
  if (scriptRe) {
    const matches = text.match(scriptRe);
    return (matches?.length ?? 0) * 3;
  }

  // Latin-script language: combine Latin character count with stopword hits
  const latinMatches = text.match(SCRIPT_PATTERNS.latin);
  const stopRe = STOPWORDS[langCode];
  const stopHits = stopRe ? text.match(stopRe)?.length ?? 0 : 0;
  return (latinMatches?.length ?? 0) * 0.5 + stopHits * 5;
}

/**
 * Classifies a transcript snippet as belonging to Language A ("A"), Language B ("B"),
 * or undetermined (null). Uses Unicode script matching first for non-Latin languages
 * (e.g., Arabic <-> English) and stopword scoring for same-script pairs.
 */
export function detectLanguageSide(
  text: string,
  langACode: string,
  langBCode: string
): "A" | "B" | null {
  const trimmed = text.trim();
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
