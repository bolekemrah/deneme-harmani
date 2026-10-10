export function analyzeExamText(rawText = '') {
  const text = String(rawText)
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    return { suitable:false, confidence:0, questionCount:0, candidateCount:0, choiceCount:0, answerKeyDetected:false, reasons:['PDF içinde okunabilir metin bulunamadı.'], questions:[] };
  }

  // Gerçek denemelerde soru numarası "1.", "1)", "1 -" veya bazen yalnızca "1" satırı olabilir.
  // Soru başlangıcını satır düzeninden yakalar; rapordaki numaralı maddeler ise şık doğrulamasını geçemez.
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^(\d{1,3})(?:\s*[\).:\-])?(?:\s+|$)(.*)$/);
    if (!m) continue;
    const number = Number(m[1]);
    if (number < 1 || number > 200) continue;
    starts.push({ lineIndex:i, number, firstText:m[2] || '' });
  }

  const candidates = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].lineIndex : lines.length;
    const bodyLines = [start.firstText, ...lines.slice(start.lineIndex + 1, end)].filter(Boolean);
    return { number:start.number, body:bodyLines.join('\n').trim() };
  }).filter((candidate) => candidate.body.length > 0);

  function extractChoices(body) {
    const normalized = `\n${body}\n`;
    const marker = /(?:^|\n|\s)([A-E])\s*[\).:\-]\s*/g;
    const found = [];
    let match;
    while ((match = marker.exec(normalized)) !== null) found.push({ letter:match[1], index:match.index });
    return found;
  }

  function looksLikeQuestion(body) {
    return /\?|hangisi|hangisidir|hangisinde|hangisine|hangiler|aşağıdaki|aşağıdakilerden|değildir|doğrudur|yanlıştır|söylenebilir|söylenemez|ulaşılabilir|ulaşılamaz|verilemez|çıkarılabilir|çıkarılamaz|nedir|kaçtır|olmalıdır|bulunuz|seçiniz|verilen|göre/i.test(body.replace(/\s+/g,' '));
  }

  const questions = [];
  for (const candidate of candidates) {
    const letters = extractChoices(candidate.body).map((choice) => choice.letter);
    const uniqueLetters = [...new Set(letters)];
    const hasABC = ['A','B','C'].every((letter) => uniqueLetters.includes(letter));
    const hasFourChoices = uniqueLetters.length >= 4;
    if (hasABC && (hasFourChoices || looksLikeQuestion(candidate.body))) {
      questions.push({
        number:candidate.number,
        text:candidate.body,
        choices:uniqueLetters,
        optionCount:uniqueLetters.length,
        questionLanguageDetected:looksLikeQuestion(candidate.body),
      });
    }
  }

  const questionCount = questions.length;
  const choiceCount = questions.reduce((sum,q)=>sum+q.optionCount,0);
  const languageCount = questions.filter(q=>q.questionLanguageDetected).length;
  const answerKeyDetected = /(cevap\s*anahtar[ıi]|yan[ıi]t\s*anahtar[ıi]|\b1\s*[-.:)]?\s*[A-E]\b[\s\S]{0,100}\b2\s*[-.:)]?\s*[A-E]\b)/i.test(text);
  const sequentialPairs = questions.slice(1).filter((q,i)=>q.number===questions[i].number+1).length;

  let score=0;
  if(questionCount>=3)score+=25;
  if(questionCount>=5)score+=15;
  if(questionCount>=10)score+=10;
  if(questionCount>0&&languageCount>=Math.ceil(questionCount*.4))score+=20;
  if(questionCount>0&&questions.filter(q=>q.optionCount>=4).length>=Math.ceil(questionCount*.7))score+=20;
  if(sequentialPairs>=Math.max(2,Math.floor(questionCount*.4)))score+=5;
  if(answerKeyDetected)score+=5;

  const reasons=[];
  if(questionCount===0&&candidates.length>0)reasons.push('Numaralı içerik bulundu ancak gerçek çoktan seçmeli soru ve şık yapısı doğrulanamadı.');
  else if(questionCount===0)reasons.push('Çoktan seçmeli sınav sorusu algılanamadı.');
  if(questionCount>0&&languageCount<Math.ceil(questionCount*.4))reasons.push('Algılanan soruların bir bölümünde soru dili zayıf.');

  return { suitable:questionCount>=3&&score>=60, confidence:Math.min(score,100), questionCount, candidateCount:candidates.length, choiceCount, answerKeyDetected, reasons, questions };
}
