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
      choiceCount: 0,
      answerKeyDetected: false,
      reasons: ['PDF içinde okunabilir metin bulunamadı.'],
      questions: [],
    };
  }

  const questionPattern = /(?:^|\n)\s*(\d{1,3})[\).:-]\s+([\s\S]*?)(?=(?:\n\s*\d{1,3}[\).:-]\s+)|$)/g;
  const choicePattern = /(?:^|\s)([A-E])[\).:-]\s+/g;
  const questions = [];
  let match;

  while ((match = questionPattern.exec(text)) !== null) {
    const body = match[2].trim();
    const choices = [...body.matchAll(choicePattern)].map((item) => item[1]);
    questions.push({
      number: Number(match[1]),
      text: body,
      choices: [...new Set(choices)],
    });
  }

  const choiceCount = questions.reduce((sum, question) => sum + question.choices.length, 0);
  const questionsWithChoices = questions.filter((question) => question.choices.length >= 2).length;
  const answerKeyDetected = /(cevap\s*anahtar[ıi]|yan[ıi]t\s*anahtar[ıi])/i.test(text);
  const sequentialPairs = questions
    .slice(1)
    .filter((question, index) => question.number === questions[index].number + 1).length;

  let score = 0;
  if (questions.length >= 5) score += 35;
  if (questions.length >= 10) score += 15;
  if (questionsWithChoices >= Math.max(3, Math.ceil(questions.length * 0.5))) score += 30;
  if (sequentialPairs >= Math.max(2, Math.floor(questions.length * 0.5))) score += 15;
  if (answerKeyDetected) score += 5;

  const reasons = [];
  if (questions.length < 5) reasons.push('Yeterli sayıda soru algılanamadı.');
  if (questionsWithChoices < 3) reasons.push('Yeterli çoktan seçmeli soru yapısı algılanamadı.');
  if (sequentialPairs < 2) reasons.push('Soru numaralarında düzenli bir sıra algılanamadı.');

  return {
    suitable: score >= 60,
    confidence: Math.min(score, 100),
    questionCount: questions.length,
    choiceCount,
    answerKeyDetected,
    reasons,
    questions,
  };
}
