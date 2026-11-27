# NOVA — Phase 2C Human Translation Review Workbook

**Candidate:** Phase 2C (Frozen — `lib/languages.ts` prompt SHA-256: `46533177d937d0dc6a14883aee6f0fc0906fd7456d63c78c64da6973e5d69106`)
**Model:** `models/gemini-2.5-flash-native-audio-latest`
**Review Status:** **PENDING HUMAN REVIEW (NOT YET EXECUTED)**
**Companion Offline Exports:** [phase2c-human-review-package.json](./phase2c-human-review-package.json) | [phase2c-human-review.csv](./phase2c-human-review.csv)

---

## IMPORTANT SCOPE NOTICE — TEXT-ONLY REVIEW

> **Generated PCM audio waveforms were NOT persisted to disk during the Phase 2C automated benchmark** (only audio chunk counts, byte totals, and text transcripts from Gemini Live `outputTranscription` were saved).
> Accordingly, this offline review packet is **STRICTLY TEXT-ONLY**:
> - Evaluators **MUST NOT** score spoken pronunciation, regional accent quality, prosody, voice warmth, cadence, or acoustic intelligibility from this sheet.
> - Keep all transcripts and review copies local/offline; do **NOT** upload to external SaaS annotation tools.
> - Acoustic & physical-earbud quality assessment requires live Phase 3 listening sessions on target devices.

---

## Reviewer Metadata (Complete Offline)

- **Reviewer Name / Role:** ______________________________ (e.g., Native Algerian Darija / French / English Bilingual)
- **Review Date:** ______________________________
- **Dialect / Regional Variant Spoken:** ______________________________
- **Mode:** Text-Only Transcript Adjudication (Phase 2C Frozen Output)

---

## Rating Scale (0–4) & 12 Evaluation Categories

| Score | Label | Definition |
| :---: | --- | --- |
| **0** | Incorrect / Unusable | Wrong meaning, inverted polarity, wrong language, or gibberish. |
| **1** | Major Meaning Problem | Core message misunderstood, key condition distorted, or severe omission. |
| **2** | Understandable with Defect | Listener grasps main point, but noticeable omission, awkward register, or unnatural literalism hurts clarity. |
| **3** | Good & Natural | Accurate and natural conversational equivalent in target language; minor stylistic variation only. |
| **4** | Excellent | Fully preserves meaning, tone, cultural nuance, and conversational flow. Do **not** penalize natural equivalents over literal word-for-word matches. |

**12 Categories to Score (put N/A only if a category does not apply, e.g. no numbers in utterance):**
1. **C1 Meaning preservation** — Core communicative intent retained.
2. **C2 Missing information** — No dropped clauses, objects, conditions, or modifiers.
3. **C3 Added information** — No hallucinated words or extra claims.
4. **C4 Negation and polarity** — Affirmative/negative polarity strictly preserved.
5. **C5 Numbers and dates** — Digits, times, dates, codes intact.
6. **C6 Names and entities** — Airlines, streets, proper nouns intact.
7. **C7 Idioms and slang** — Natural idiomatic equivalent rather than literal calque.
8. **C8 Naturalness** — Sounds like a real bilingual human speaking.
9. **C9 Target-language correctness** — Grammar, spelling, and vocabulary are correct.
10. **C10 Code-switching** — Mixed-language input (Darija+FR/EN) decoded cleanly.
11. **C11 Cultural context** — Pragmatics, warmth, politeness, register fit.
12. **C12 Conversation suitability** — Safe and clear inside a real live turn-by-turn call.

---

## Quick-Fill Summary Rating Sheet (24 Shortlist Items / 25 Spoken Turns)

| # | Case ID | Dir | Focus Area | Auto Rubric | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 | C11 | C12 | Overall (0-4) | Reviewer Decision / Notes |
| :---: | :---: | :---: | --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | --- |
| 1 | #17 | ar->en | Idiom (ar->en) | PASS (3/3) | | | | | | | | | | | | | | |
| 2 | #15 | ar->en | Idiom (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 3 | #19 | ar->en | Darija Slang (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 4 | #23 | ar->en | Darija Slang (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 5 | #3 | ar->fr | Everyday (ar->fr) | PASS (2/2) | | | | | | | | | | | | | | |
| 6 | #7 | ar->en | Regional Darija (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 7 | #24 | ar->en | Darija+FR Code-Switch (ar->en) | PASS (3/3) | | | | | | | | | | | | | | |
| 8 | #30 | ar->en | Darija+EN Code-Switch (ar->en) | PASS (4/4) | | | | | | | | | | | | | | |
| 9 | #55 | fr->en | FR+Darija Mix (fr->en) | FAIL (1/3) | | | | | | | | | | | | | | |
| 10 | #56 | fr->ar | FR+Darija Mix (fr->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 11 | #37 | fr->ar | FR->AR Register | PASS (2/2) | | | | | | | | | | | | | | |
| 12 | #41 | fr->ar | FR->AR Register | PASS (3/3) | | | | | | | | | | | | | | |
| 13 | #47 | fr->ar | Fast Informal FR (fr->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 14 | #64 | en->ar | EN->AR Idiom | PASS (2/2) | | | | | | | | | | | | | | |
| 15 | #65 | en->fr | EN->FR Idiom | PASS (3/3) | | | | | | | | | | | | | | |
| 16 | #70 | en->ar | Proper Nouns (en->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 17 | #74 | en->ar | Numbers/Address (en->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 18 | #78 | en->ar | Context Disambiguation (en->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 19 | #81 | ar->en | Short Ambiguous (ar->en) | FAIL (0/1) | | | | | | | | | | | | | | |
| 20 | #97 | ar->en | Self-Correction (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 21 | #101 | ar->en | Negation / Polarity (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 22 | #103 | en->ar | Negation / Register (en->ar) | PASS (3/3) | | | | | | | | | | | | | | |
| 23 | #104 | ar->fr | Double Negation (ar->fr) | PASS (3/3) | | | | | | | | | | | | | | |
| 24 | #105 | ar->en | Multi-Speaker Turn A (ar->en) | PASS (2/2) | | | | | | | | | | | | | | |
| 24 | #106 | en->ar | Multi-Speaker Turn B (en->ar) | PASS (2/2) | | | | | | | | | | | | | | |

---

## Detailed Case Cards for Bilingual Adjudication

### Shortlist #1 — Benchmark Case #17 (`Algerian Darija / Darija Idioms`, `ar -> en`)

- **Original Input:** `على راسي وعيني، دروك نبعثلك الوراق كامل.`
- **Reference Translation:** `With pleasure, I'll send you all the documents right away.`
- **Actual Phase 2C Gemini Output:** `Absolutely, I'll send you all the papers right now.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `157440` | TTFA: `1579 ms`
- **What Is Being Tested:** Must NOT translate 'ala rassi w aini' literally.
- **Reviewer Questions:** Does 'Absolutely, I'll send you all the papers right now.' convey the warmth of 'على راسي وعيني', or should an even warmer phrase like 'With pleasure' / 'I'd be happy to' be preferred? Are 'papers' vs 'documents' acceptable here?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #2 — Benchmark Case #15 (`Algerian Darija / Darija Idioms`, `ar -> en`)

- **Original Input:** `اللي فات مات، خلينا نبداو صفحة جديدة.`
- **Reference Translation:** `What's past is past, let's turn the page and start fresh.`
- **Actual Phase 2C Gemini Output:** `What's past is past, let's start a new page.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `176640` | TTFA: `1889 ms`
- **What Is Being Tested:** Idiom meaning past is forgotten, NOT literal 'who passed died'.
- **Reviewer Questions:** Does 'let's start a new page' sound idiomatic in conversational English compared to 'turn the page' or 'start a new chapter' for 'خلينا نبداو صفحة جديدة'?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #3 — Benchmark Case #19 (`Algerian Darija / Darija Slang`, `ar -> en`)

- **Original Input:** `ما تكسرش راسك معاه، خليه يهدر برك.`
- **Reference Translation:** `Don't stress yourself over him, just let him talk.`
- **Actual Phase 2C Gemini Output:** `Don't bother yourself with him, just let him talk.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `163200` | TTFA: `1025 ms`
- **What Is Being Tested:** 'ma tkasarch rasek' idiomatically ('don't stress').
- **Reviewer Questions:** Does 'Don't bother yourself with him, just let him talk.' preserve the casual tone and meaning of 'ما تكسرش راسك معاه، خليه يهدر برك' without losing urgency or intent?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #4 — Benchmark Case #23 (`Algerian Darija / Darija Slang`, `ar -> en`)

- **Original Input:** `علاش راك تزعّف؟ ما قصدتش والو واللّه!`
- **Reference Translation:** `Why are you getting upset? I honestly didn't mean anything bad!`
- **Actual Phase 2C Gemini Output:** `Why are you getting upset? I swear I didn't mean anything by it!`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `178560` | TTFA: `1896 ms`
- **What Is Being Tested:** Conversational emotional defense with negation.
- **Reviewer Questions:** Does 'Why are you getting upset? I swear I didn't mean anything by it!' capture both emotional sincerity ('واللّه') and negation ('ما قصدتش والو')?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #5 — Benchmark Case #3 (`Algerian Darija / Darija Everyday`, `ar -> fr`)

- **Original Input:** `هادي بزاف غالية، ما تقدرش تنقصلنا شوية فالسومة؟`
- **Reference Translation:** `C'est trop cher, vous ne pouvez pas baisser un peu le prix ?`
- **Actual Phase 2C Gemini Output:** `C'est beaucoup trop cher, vous ne pouvez pas nous réduire un peu le prix ?`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `161280` | TTFA: `976 ms`
- **What Is Being Tested:** Polite market bargaining intent.
- **Reviewer Questions:** Does 'C'est beaucoup trop cher, vous ne pouvez pas nous réduire un peu le prix ?' fit spoken French etiquette and retain the plural 'nous' from 'تنقصلنا' naturally?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #6 — Benchmark Case #7 (`Algerian Darija / Darija Regional`, `ar -> en`)

- **Original Input:** `واش حوالك؟ كلش لاباس فـ الدار؟`
- **Reference Translation:** `How are you doing? Is everyone doing fine at home?`
- **Actual Phase 2C Gemini Output:** `How are you? Is everything okay at home?`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `151680` | TTFA: `1611 ms`
- **What Is Being Tested:** Warm Algerian family greeting.
- **Reviewer Questions:** Does 'Is everything okay at home?' naturally capture the cultural sense of 'فـ الدار' (family/household) rather than only the physical house?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #7 — Benchmark Case #24 (`Algerian Darija / Darija+FR Mix`, `ar -> en`)

- **Original Input:** `الدوسيي راهو ناقصو الـ attestation de résidence، لازم تجيبها غدوة.`
- **Reference Translation:** `The file is missing the proof of residence certificate; you must bring it tomorrow.`
- **Actual Phase 2C Gemini Output:** `The file is missing the residence certificate; you must bring it tomorrow.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `199680` | TTFA: `2074 ms`
- **What Is Being Tested:** Administrative French nouns inside Darija syntax.
- **Reviewer Questions:** Was the embedded French administrative term 'attestation de résidence' accurately translated to 'residence certificate' without leaving untranslated French?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #8 — Benchmark Case #30 (`Algerian Darija / Darija+EN Mix`, `ar -> en`)

- **Original Input:** `الـ server راهو down من الصباح، الـ team راهي تخدم باش تصلحو.`
- **Reference Translation:** `The server has been down since morning, the team is working to fix it.`
- **Actual Phase 2C Gemini Output:** `The server has been down since this morning; the team is working on fixing it.`
- **Automated Benchmark Result:** **PASS** | Concept score: `4/4` | Audio bytes: `211200` | TTFA: `2498 ms`
- **What Is Being Tested:** Embedded English tech terms inside Darija.
- **Reviewer Questions:** Are the inline English loanwords ('server', 'down', 'team') cleanly woven into grammatically correct English?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #9 — Benchmark Case #55 (`French / French+Darija Mix`, `fr -> en`)

- **Original Input:** `Franchement c'est trop ghali sahbi, fais-moi un prix.`
- **Reference Translation:** `Honestly that's way too expensive my friend, give me a better price.`
- **Actual Phase 2C Gemini Output:** `Seriously, that's too expensive, give me a discount.`
- **Automated Benchmark Result:** **FAIL** | Concept score: `1/3` | Audio bytes: `188160` | TTFA: `1826 ms`
- **What Is Being Tested:** Understands 'ghali' + 'sahbi' inside French sentence -> English.
- **Reviewer Questions:** 1) Does dropping 'sahbi' ('my friend') materially alter conversational warmth or core transactional meaning? 2) Is 'give me a discount' an idiomatic equivalent of 'fais-moi un prix'? 3) Should 'Seriously' vs 'Honestly' for 'Franchement' be penalized?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #10 — Benchmark Case #56 (`French / French+Darija Mix`, `fr -> ar`)

- **Original Input:** `Désolé khoya, j'ai eu un retard à cause des embouteillages.`
- **Reference Translation:** `آسف أخي، تأخرت بسبب الازدحام المروري.`
- **Actual Phase 2C Gemini Output:** `سمحلي خويا، تعطلت بسبب الازدحام.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `138240` | TTFA: `964 ms`
- **What Is Being Tested:** Mixed FR+AR apology rendered smoothly in Arabic.
- **Reviewer Questions:** Input uses Algerian Darija vocative 'khoya'; output kept light 'سمحلي خويا، تعطلت بسبب الازدحام.' Does this light spoken form sound better or worse than formal Fusha 'آسف أخي'?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #11 — Benchmark Case #37 (`French / French Conversational`, `fr -> ar`)

- **Original Input:** `Excusez-moi, est-ce que cette place est déjà prise ?`
- **Reference Translation:** `عفوا، هل هذا المقعد محجوز بالفعل؟`
- **Actual Phase 2C Gemini Output:** `اعذرني، هل هذا المقعد مشغول من قبل؟`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `136320` | TTFA: `945 ms`
- **What Is Being Tested:** Polite seating inquiry into natural Arabic.
- **Reviewer Questions:** Compare Phase 2C Fusha 'اعذرني، هل هذا المقعد مشغول من قبل؟' against natural Algerian Arabic ('سمحلي، هاد البلاصة محجوزة؟'). Which feels more natural and clear in live conversation?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #12 — Benchmark Case #41 (`French / French Conversational`, `fr -> ar`)

- **Original Input:** `Pourriez-vous me faire un reçu avec le tampon de l'hôtel ?`
- **Reference Translation:** `هل يمكنك إعطائي وصل دفع مختوم من الفندق؟`
- **Actual Phase 2C Gemini Output:** `هل يمكنك أن تعطيني إيصالا بختم الفندق؟`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `155520` | TTFA: `1810 ms`
- **What Is Being Tested:** Hotel receipt + official stamp.
- **Reviewer Questions:** Does 'هل يمكنك أن تعطيني إيصالا بختم الفندق؟' clearly preserve all details ('reçu', 'tampon', 'hôtel') without awkward stiffness?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #13 — Benchmark Case #47 (`French / French Fast Speech`, `fr -> ar`)

- **Original Input:** `Chais pas trop s'il va venir ce soir, il m'a rien confirmé.`
- **Reference Translation:** `ما نعرفش إذا راح يجي الليلة، ما أكدلي والو.`
- **Actual Phase 2C Gemini Output:** `مانيش عارف إذا كان راح يجي الليلة، ما أكدلي والو.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `163200` | TTFA: `1271 ms`
- **What Is Being Tested:** Reduced 'chais pas' + 'm'a rien confirmé'.
- **Reviewer Questions:** Notice source slang 'Chais pas trop...' triggered colloquial Arabic output ('مانيش عارف إذا كان راح يجي الليلة، ما أكدلي والو') rather than strict Fusha. Is this dialect accommodation desirable for informal French->Algerian speakers?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #14 — Benchmark Case #64 (`English / English Idioms`, `en -> ar`)

- **Original Input:** `Don't sweat it, we'll figure it out once we reach the hotel.`
- **Reference Translation:** `لا تقلق بشأن ذلك، سنجد حلاً بمجرد وصولنا إلى الفندق.`
- **Actual Phase 2C Gemini Output:** `لا تقلق، سنجد حلاً عندما نصل إلى الفندق.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `165120` | TTFA: `1130 ms`
- **What Is Being Tested:** 'Don't sweat it' != literal sweat.
- **Reviewer Questions:** Does 'لا تقلق، سنجد حلاً عندما نصل إلى الفندق.' render 'Don't sweat it, we'll figure it out...' accurately and warmly in Fusha?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #15 — Benchmark Case #65 (`English / English Idioms`, `en -> fr`)

- **Original Input:** `Let's call it a day and pick this back up fresh tomorrow morning.`
- **Reference Translation:** `Arrêtons-nous là pour aujourd'hui et reprenons à tête reposée demain matin.`
- **Actual Phase 2C Gemini Output:** `On arrête pour aujourd'hui et on reprend ça demain matin à tête reposée.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `163200` | TTFA: `986 ms`
- **What Is Being Tested:** Idiom 'call it a day' must be natural French.
- **Reviewer Questions:** Does 'On arrête pour aujourd'hui et on reprend ça demain matin à tête reposée.' idiomatically capture both 'call it a day' and 'pick this back up fresh'?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #16 — Benchmark Case #70 (`English / English Proper Nouns`, `en -> ar`)

- **Original Input:** `Air Algerie flight AH 1004 from London Heathrow is now boarding.`
- **Reference Translation:** `رحلة الخطوط الجوية الجزائرية AH 1004 القادمة من مطار لندن هيثرو تصعد الآن.`
- **Actual Phase 2C Gemini Output:** `الآن يتم الصعود إلى طائرة الخطوط الجوية الجزائرية رحلة AH 1004 من مطار لندن هيثرو.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `366720` | TTFA: `1125 ms`
- **What Is Being Tested:** Flight number + Heathrow intact.
- **Reviewer Questions:** Are carrier 'Air Algerie', flight number 'AH 1004', and airport 'London Heathrow' faithfully preserved in MSA structure?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #17 — Benchmark Case #74 (`English / English Numbers/Dates`, `en -> ar`)

- **Original Input:** `Deliver the package to 14 Didouche Mourad Street, Algiers 16000.`
- **Reference Translation:** `سلّم الطرد إلى 14 شارع ديدوش مراد، الجزائر 16000.`
- **Actual Phase 2C Gemini Output:** `سلم الطرد إلى 14 شارع ديدوش مراد، الجزائر 16000.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `263040` | TTFA: `1265 ms`
- **What Is Being Tested:** Street number, name, and postal code preserved.
- **Reviewer Questions:** Are street number '14', street name 'Didouche Mourad', city 'Algiers', and postal code '16000' intact without digit transposition?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #18 — Benchmark Case #78 (`English / English Context`, `en -> ar`)

- **Original Input:** `Can I charge my phone behind the counter, not my credit card yet?`
- **Reference Translation:** `هل يمكنني شحن هاتفي خلف المنضدة، وليس سحب المبلغ من بطاقتي بعد؟`
- **Actual Phase 2C Gemini Output:** `هل يمكنني شحن هاتفي خلف المنضدة، ليس بطاقة الائتمان بعد؟`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `222720` | TTFA: `935 ms`
- **What Is Being Tested:** Distinguishes two senses of 'charge' (battery vs payment).
- **Reviewer Questions:** Did Arabic preserve the two meanings of 'charge' (charge phone battery vs charge credit card)? Note 'ليس بطاقة الائتمان بعد' — does omitting a repeated verb before 'credit card' still feel clear?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #19 — Benchmark Case #81 (`Difficult Speech / Difficult Short`, `ar -> en`)

- **Original Input:** `شحال؟`
- **Reference Translation:** `How much?`
- **Actual Phase 2C Gemini Output:** `How many?`
- **Automated Benchmark Result:** **FAIL** | Concept score: `0/1` | Audio bytes: `42240` | TTFA: `1051 ms`
- **What Is Being Tested:** Direct concise translation without padding.
- **Reviewer Questions:** Without prior conversational context, is 'How many?' for standalone 'شحال؟' a legitimate interpretation alongside 'How much?', or does Algerian usage default strongly enough to price ('How much?') to flag this as a mild defect?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #20 — Benchmark Case #97 (`Difficult Speech / Difficult Corrections`, `ar -> en`)

- **Original Input:** `نتلاقاو نهار الخميس... لا سمحلي، قصدي نهار الجمعة على الثلاثة.`
- **Reference Translation:** `Let's meet on Friday at three (not Thursday).`
- **Actual Phase 2C Gemini Output:** `We'll meet on Thursday... no, sorry, I mean on Friday at three.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `228480` | TTFA: `1261 ms`
- **What Is Being Tested:** Must reflect final self-corrected day: Friday.
- **Reviewer Questions:** Does reproducing the spoken self-correction ('Thursday... no, sorry, I mean on Friday at three') clearly communicate Friday @ 3 rather than confusing listeners?
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #21 — Benchmark Case #101 (`Difficult Speech / Difficult Negation`, `ar -> en`)

- **Original Input:** `ماشي أنا لي نسيت الساروت، راهو مزال فالمكتب.`
- **Reference Translation:** `I wasn't the one who forgot the key; it's still at the office.`
- **Actual Phase 2C Gemini Output:** `It wasn't me who forgot the key, it's still in the office.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `170880` | TTFA: `904 ms`
- **What Is Being Tested:** Strictly preserves negation ('wasn't me / not I').
- **Reviewer Questions:** Verify Algerian Darija negative pronoun 'ماشي أنا' is faithfully inverted to negative English ('It wasn't me...') with tense/office location preserved.
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #22 — Benchmark Case #103 (`Difficult Speech / Difficult Negation`, `en -> ar`)

- **Original Input:** `We don't accept cash after eight PM, only bank cards.`
- **Reference Translation:** `نحن لا نقبل الدفع نقداً بعد الساعة الثامنة مساءً، فقط البطاقات البنكية.`
- **Actual Phase 2C Gemini Output:** `لا نقبل الدفع نقدا بعد الساعه الثامنه مساءً، بطاقات مصرفيه فقط.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `247680` | TTFA: `1829 ms`
- **What Is Being Tested:** Preserves restriction negation ('لا نقبل').
- **Reviewer Questions:** Compare Phase 2C Fusha 'لا نقبل الدفع نقدا بعد الساعه الثامنه مساءً، بطاقات مصرفيه فقط.' with previous Darija/loanword output ('الكاش... لي كارط بونكير'). Confirm time, cash negation, and card-only constraint are 100% accurate.
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #23 — Benchmark Case #104 (`Difficult Speech / Difficult Negation`, `ar -> fr`)

- **Original Input:** `ما تخافش، هذا القرار ما عندوش حتى تأثير على الفيزا تاعك.`
- **Reference Translation:** `N'aie pas peur, cette décision n'a aucun impact sur ton visa.`
- **Actual Phase 2C Gemini Output:** `Ne t'inquiète pas, cette décision n'a aucune incidence sur ton visa.`
- **Automated Benchmark Result:** **PASS** | Concept score: `3/3` | Audio bytes: `174720` | TTFA: `1387 ms`
- **What Is Being Tested:** Double negation accurately preserved.
- **Reviewer Questions:** Confirm double negation ('ما تخافش... ما عندوش حتى تأثير') is preserved completely in 'Ne t'inquiète pas, cette décision n'a aucune incidence sur ton visa.'.
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #24 — Benchmark Case #105 (`Difficult Speech / Difficult Multi-Speaker`, `ar -> en`)

- **Original Input:** `راني واجد باش نخلص الآن.`
- **Reference Translation:** `I'm ready to pay now.`
- **Actual Phase 2C Gemini Output:** `I am ready to pay now.`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `71040` | TTFA: `1486 ms`
- **What Is Being Tested:** Turn 1 of rapid bilateral Arabic<->English alternation (Speaker A).
- **Reviewer Questions:** Paired Turn 1 of rapid bilateral AR<->EN exchange: verify clean detection of Arabic input and neutral English output 'I am ready to pay now.'.
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

### Shortlist #24 — Benchmark Case #106 (`Difficult Speech / Difficult Multi-Speaker`, `en -> ar`)

- **Original Input:** `Great, would you like to pay by card or cash?`
- **Reference Translation:** `ممتاز، هل تود الدفع بالبطاقة أم نقداً؟`
- **Actual Phase 2C Gemini Output:** `عظيم، هل تفضل الدفع بالبطاقه أو نقدا؟`
- **Automated Benchmark Result:** **PASS** | Concept score: `2/2` | Audio bytes: `172800` | TTFA: `2013 ms`
- **What Is Being Tested:** Turn 2 of rapid bilateral alternation immediately flipping EN->AR.
- **Reviewer Questions:** Paired Turn 2 immediately flipping EN->AR: verify zero language bleed from Turn 1 and accurate Fusha 'عظيم، هل تفضل الدفع بالبطاقه أو نقدا؟'.
- **Ratings (0–4):** Mean=`__`, Miss=`__`, Add=`__`, Neg=`__`, Num=`__`, Ent=`__`, Idiom=`__`, Nat=`__`, Gram=`__`, CS=`__`, Cult=`__`, Conv=`__` | **Overall:** `__`
- **Decision:** [ ] Accept as Natural / [ ] Acceptable with Minor Note / [ ] Defect — Needs Prompt Fix / [ ] Ambiguous — Add Context
- **Reviewer Notes:** _______________________________________________________

---

## Special Adjudication Prompts (#55 and #81)

### Case #55 Adjudication Prompt
- **Input:** `Franchement c'est trop ghali sahbi, fais-moi un prix.`
- **Actual Benchmark Reference Translation:** `Honestly that's way too expensive my friend, give me a better price.`
- **Actual Phase 2C Output:** `Seriously, that's too expensive, give me a discount.`
- **Questions to Decide:**
  1. In casual Algerian/French bargaining, does omitting `sahbi` (*my friend*) represent a meaningful pragmatic defect or acceptable economy in fast interpretation?
  2. Should `give me a discount` be rated **3** or **4** semantically for `fais-moi un prix`, even though the frozen keyword rubric requires the token `price`?
  3. Confirm recommendation: Keep Case #55 reference untouched and adjudicate verbally/offline whether vocative preservation warrants a future Phase 2E rubric/prompt note.

### Case #81 Adjudication Prompt
- **Input:** `شحال؟`
- **Actual Benchmark Reference Translation:** `How much?`
- **Actual Phase 2C Output:** `How many?`
- **Questions to Decide:**
  1. Without any noun or conversational turn before `شحال؟`, is `How many?` linguistically just as valid as `How much?` in Algerian Darija?
  2. Confirm recommendation: Tag #81 as **Context-Ambiguous Single-Word Utterance** in reporting while keeping the frozen benchmark score intact (`106/108`), and decide whether future datasets should pair `شحال؟` with a disambiguating preceding turn or dual-synonym allowance.
