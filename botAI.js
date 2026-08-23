class BotAI {
  /**
   * Botning navbatdagi yurishini aniqlab beruvchi funksiya
   * @param {string} difficulty - 'easy', 'medium', yoki 'hard'
   * @param {Array<number>} availableMoves - Bo'sh bo'lgan kataklar indekslari (masalan: [0, 2, 4, 7])
   * @param {number|null} winningMove - Bot yutishi yoki raqibni to'sishi uchun zarur bo'lgan ustuvor katak
   * @returns {number|null} - Bot tanlagan katak indeksi
   */
  static getMove(difficulty = 'medium', availableMoves = [], winningMove = null) {
    if (!availableMoves || availableMoves.length === 0) {
      return null;
    }

    let accuracy = 0.50; // default: o'rta

    if (difficulty === 'easy') {
      accuracy = 0.30;
    } else if (difficulty === 'medium') {
      accuracy = 0.50;
    } else if (difficulty === 'hard') {
      accuracy = 0.75;
    }

    const isSmartMove = Math.random() < accuracy;

    // Agar bot aqlli harakat qilsa va strategik muhim katak mavjud bo'lsa
    if (isSmartMove && winningMove !== null && availableMoves.includes(winningMove)) {
      return winningMove;
    }

    // Aks holda bo'sh kataklar orasidan tasodifiy tanlaydi
    const randomIndex = Math.floor(Math.random() * availableMoves.length);
    return availableMoves[randomIndex];
  }
}

module.exports = BotAI;
