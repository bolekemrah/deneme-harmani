// Deneme Harmanı soru doğrulama/kalite katmanı.
// Bu katman OCR veya PDF okuyucudan gelen adayları puanlar.
// Tek başına A-B-C-D-E görülmesi bir içeriği soru yapmaz.

const QUESTION_LANGUAGE = /\?|hangisi|hangisidir|hangisinde|hangisine|hangiler|aşağıdaki|aşağıdakilerden|değildir|doğrudur|yanlıştır|söylenebilir|söylenemez|ulaşılabilir|ulaşılamaz|çıkarılabilir|çıkarılamaz|nedir|kaçtır|olmalıdır|bulunuz|seçiniz/i;

export function validateQuestionCandidate(candidate = {}) {
  const stem = String(candidate.stem || candidate.text || '').replace(/\s+/g, ' ').trim();
  const options = Array.isArray(candidate.options) ? candidate.options : [];
  const optionTexts = options.map((option) => String(option?.text || option || '').trim()).filter(Boolean);

  const signals = {
    meaningfulStem: stem.length >= 20,
    questionLanguage: QUESTION_LANGUAGE.test(stem),
    enoughOptions: optionTexts.length >= 4,
    meaningfulOptions: optionTexts.filter((text) => text.length >= 2).length >= 4,
    distinctOptions: new Set(optionTexts.map((text) => text.toLocaleLowerCase('tr-TR'))).size === optionTexts.length,
    notMostlySingleLetters: optionTexts.filter((text) => /^[a-zçğıöşü]$/i.test(text)).length <= 1,
  };

  let structureConfidence = 0;
  if (signals.meaningfulStem) structureConfidence += 20;
  if (signals.questionLanguage) structureConfidence += 20;
  if (signals.enoughOptions) structureConfidence += 25;
  if (signals.meaningfulOptions) structureConfidence += 20;
  if (signals.distinctOptions) structureConfidence += 10;
  if (signals.notMostlySingleLetters) structureConfidence += 5;

  const reasons = [];
  if (!signals.meaningfulStem) reasons.push('Anlamlı uzunlukta bir soru kökü doğrulanamadı.');
  if (!signals.questionLanguage) reasons.push('Soru kökünde güçlü sınav sorusu dili doğrulanamadı.');
  if (!signals.enoughOptions) reasons.push('En az dört seçenek doğrulanamadı.');
  if (!signals.meaningfulOptions) reasons.push('Seçeneklerin içeriği yeterince anlamlı görünmüyor.');
  if (!signals.distinctOptions) reasons.push('Tekrarlanan seçenekler bulundu.');

  return {
    isQuestion: structureConfidence >= 70 && signals.enoughOptions && signals.meaningfulStem,
    structureConfidence,
    signals,
    reasons,
  };
}

export function createQualityRecord(candidate = {}, validation = validateQuestionCandidate(candidate)) {
  return {
    isQuestion: validation.isQuestion,
    structureConfidence: validation.structureConfidence,
    // Bu alanlar daha sonra ÖSYM referans veri seti + AI değerlendirmesi ile doldurulacak.
    osymSimilarity: null,
    languageQuality: null,
    distractorQuality: null,
    measurementQuality: null,
    difficulty: null,
    overallQuality: null,
    subject: null,
    topic: null,
    correctAnswer: null,
    correctAnswerVerified: false,
    needsHumanReview: validation.structureConfidence < 85,
    reasons: validation.reasons,
  };
}
