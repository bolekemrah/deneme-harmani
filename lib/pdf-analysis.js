export function analyzeExamText(rawText = '') {
  const text = String(rawText)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

  if (!text) {
    return {
      suitable: false,
      confidence: 0,
      questionCount: 0,
      candidateCount: 0,
      choiceCount: 0,
      answerKeyDetected: false,
      reasons: ['PDF içinde okunabilir metin bulunamadı.'],
      questions: [],
    };
  }

  // Önce yalnızca numaralı blokları aday olarak buluyoruz. Raporlardaki
  // 1., 2., 3. gibi maddeler bu aşamada henüz "soru" sayılmaz.
  const candidatePattern = /(?:^|\n)\s*(\d{1,3})[\).:-]\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[\).:-]\s+)|$)/g;
  const candidates = [];
  let match;

  while ((match = candidatePattern.exec(text)) !== null) {
    candidates.push({ number: Number(match[1]), body: match[2].trim() });
  }

  function extractChoices(body) {
    const matches = [...body.matchAll(/(?:^|\n|\s{2,})([A-E])[\).:-]\s+([\s\S]*?)(?=(?:\n|\s{2,})[A-E][\).:-]\s+|$)/g)];
    return matches.map((item) => ({ letter: item[1], text: item[2].trim() })).filter((item) => item.text.length > 0);
  }

  function looksLikeQuestion(body) {
    const normalized = body.replace(/\s+/g, ' ').trim();
    const hasQuestionLanguage = /\?|hangisi|hangisidir|hangisinde|hangisine|hangiler|aşağıdaki|aşağıdakilerden|değildir|doğrudur|yanlıştır|söylenebilir|söylenemez|ulaşılabilir|ulaşılamaz|verilemez|çıkarılabilir|çıkarılamaz|nedir|kaçtır|olmalıdır|bulunuz|seçiniz/i.test(normalized);
    return hasQuestionLanguage;
  }

  const questions = [];

  for (const candidate of candidates) {
    const choices = extractChoices(candidate.body);
    const letters = choices.map((choice) => choice.letter);
    const uniqueLetters = [...new Set(letters)];
    const hasOrderedChoices = uniqueLetters.length >= 3 && uniqueLetters[0] === 'A' && uniqueLetters[1] === 'B' && uniqueLetters[2] === 'C';

    // Gerçek çoktan seçmeli soru kabulü için en az A-B-C seçenek yapısı şart.
    // Soru dili ayrıca güven puanını yükseltir; rapordaki numaralı maddeler artık
    // tek başına soru sayılmaz.
    if (hasOrderedChoices) {
      questions.push({
        number: candidate.number,
        text: candidate.body,
        choices: uniqueLetters,
        optionCount: uniqueLetters.length,
        questionLanguageDetected: looksLikeQuestion(candidate.body),
      });
    }
  }

  const questionCount = questions.length;
  const choiceCount = questions.reduce((sum, question) => sum + question.optionCount, 0);
  const questionsWithQuestionLanguage = questions.filter((question) => question.questionLanguageDetected).length;
  const answerKeyDetected = /(cevap\s*anahtar[ıi]|yan[ıi]t\s*anahtar[ıi]|\b1\s*[-.:)]?\s*[A-E]\b.*\b2\s*[-.:)]?\s*[A-E]\b)/is.test(text);
  const sequentialPairs = questions
    .slice(1)
    .filter((question, index) => question.number === questions[index].number + 1).length;

  let score = 0;
  if (questionCount >= 3) score += 25;
  if (questionCount >= 5) score += 15;
  if (questionCount >= 10) score += 10;
  if (questionCount > 0 && questionsWithQuestionLanguage >= Math.ceil(questionCount * 0.5)) score += 25;
  if (questionCount > 0 && questions.every((question) => question.optionCount >= 4)) score += 15;
  if (sequentialPairs >= Math.max(2, Math.floor(questionCount * 0.5))) score += 5;
  if (answerKeyDetected) score += 5;

  const reasons = [];
  if (questionCount === 0 && candidates.length > 0) {
    reasons.push('Numaralı maddeler bulundu ancak A-B-C şeklinde gerçek çoktan seçmeli soru yapısı bulunamadı.');
  } else if (questionCount === 0) {
    reasons.push('Çoktan seçmeli sınav sorusu algılanamadı.');
  }
  if (questionCount > 0 && questionsWithQuestionLanguage < Math.ceil(questionCount * 0.5)) {
    reasons.push('Algılanan blokların çoğunda sınav sorusu dili doğrulanamadı.');
  }
  if (questionCount > 0 && questions.filter((question) => question.optionCount >= 4).length < Math.ceil(questionCount * 0.7)) {
    reasons.push('Soruların çoğunda en az dört seçenek doğrulanamadı.');
  }

  return {
    suitable: questionCount >= 3 && score >= 60,
    confidence: Math.min(score, 100),
    questionCount,
    candidateCount: candidates.length,
    choiceCount,
    answerKeyDetected,
    reasons,
    questions,
  };
}
