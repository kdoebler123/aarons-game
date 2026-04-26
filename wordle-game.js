// ===== Aaron's Wordle Game — wordle-game.js =====
// Modules: WordBank, GameEngine, UI, Orchestrator

// ===== WordBank Module =====

/**
 * Validates a single word bank entry.
 * @param {string} entry - A candidate word
 * @returns {boolean} - True if entry is exactly 5 alphabetic characters
 */
function isValidWord(entry) {
  return typeof entry === 'string' && /^[A-Za-z]{5}$/.test(entry);
}

/**
 * Loads and validates the word bank from a JSON file.
 * @param {string} url - Path to wordle-words.json
 * @returns {Promise<string[]>} - Array of valid uppercase 5-letter words
 * @throws {Error} - If fetch fails, JSON is invalid, or no valid words found
 */
async function loadWordBank(url) {
  var response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error("Oops! We couldn't load the words. Try refreshing!");
  }
  if (!response.ok) {
    throw new Error("Oops! We couldn't load the words. Try refreshing!");
  }
  var data;
  try {
    data = await response.json();
  } catch (err) {
    throw new Error("Uh oh! The word list is broken. Ask a grown-up for help!");
  }
  if (!Array.isArray(data)) {
    throw new Error("Uh oh! The word list is broken. Ask a grown-up for help!");
  }
  var words = [];
  for (var i = 0; i < data.length; i++) {
    if (isValidWord(data[i])) {
      words.push(data[i].toUpperCase());
    } else {
      console.warn('Skipping invalid word bank entry: ' + data[i]);
    }
  }
  if (words.length === 0) {
    throw new Error("No words to play with! The word list needs some words.");
  }
  return words;
}

/**
 * Selects a random word from the word bank.
 * @param {string[]} words - The validated word bank array
 * @returns {string} - A randomly selected uppercase 5-letter word
 */
function pickRandomWord(words) {
  return words[Math.floor(Math.random() * words.length)];
}

// ===== WordTracker: Tracks used words to avoid repeats =====

var WordTracker = (function () {
  var STORAGE_KEY = 'wordle_used_words';

  function getUsedWords() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(STORAGE_KEY);
        return [];
      }
      return parsed;
    } catch (e) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (ignore) {}
      return [];
    }
  }

  function markUsed(word) {
    var used = getUsedWords();
    if (used.indexOf(word) === -1) {
      used.push(word);
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(used));
    } catch (e) {}
  }

  function pickUnusedWord(words) {
    var used = getUsedWords();
    var available = words.filter(function (w) {
      return used.indexOf(w) === -1;
    });

    // If all words used, reset and use full list
    if (available.length === 0) {
      reset();
      available = words.slice();
    }

    return available[Math.floor(Math.random() * available.length)];
  }

  function reset() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
  }

  return {
    getUsedWords: getUsedWords,
    markUsed: markUsed,
    pickUnusedWord: pickUnusedWord,
    reset: reset
  };
})();

// ===== GameEngine Module =====

/**
 * Creates a new game state for a round.
 * @param {string} targetWord - The secret 5-letter word (uppercase)
 * @returns {GameState} - Initial game state object
 */
function createGame(targetWord) {
  return {
    targetWord: targetWord,
    guesses: [],
    feedbacks: [],
    currentInput: [],
    currentRow: 0,
    status: 'playing'
  };
}

/**
 * Adds a letter to the current guess row.
 * @param {GameState} state - Current game state
 * @param {string} letter - Single uppercase letter A-Z
 * @returns {GameState} - Updated game state (or unchanged if row is full or game over)
 */
function addLetter(state, letter) {
  if (state.status !== 'playing') return state;
  if (state.currentInput.length >= 5) return state;
  return Object.assign({}, state, {
    currentInput: state.currentInput.concat([letter.toUpperCase()])
  });
}

/**
 * Removes the last letter from the current guess row.
 * @param {GameState} state - Current game state
 * @returns {GameState} - Updated game state (or unchanged if row is empty or game over)
 */
function deleteLetter(state) {
  if (state.status !== 'playing') return state;
  if (state.currentInput.length === 0) return state;
  return Object.assign({}, state, {
    currentInput: state.currentInput.slice(0, -1)
  });
}

/**
 * Computes letter-by-letter feedback for a guess against a target word.
 * Handles duplicate letters correctly: green first, then yellow only if
 * remaining target letter count allows.
 * @param {string} guess - 5-letter uppercase guess
 * @param {string} target - 5-letter uppercase target word
 * @returns {LetterFeedback[]} - Array of 5 feedback objects
 */
function computeFeedback(guess, target) {
  var result = [];
  var targetCounts = {};
  var i;

  // Count letters in target
  for (i = 0; i < target.length; i++) {
    targetCounts[target[i]] = (targetCounts[target[i]] || 0) + 1;
  }

  // Initialize result array
  for (i = 0; i < 5; i++) {
    result.push({ letter: guess[i], status: 'absent', position: i });
  }

  // First pass: mark exact matches (correct/green)
  for (i = 0; i < 5; i++) {
    if (guess[i] === target[i]) {
      result[i].status = 'correct';
      targetCounts[guess[i]]--;
    }
  }

  // Second pass: mark present (yellow) only if remaining count allows
  for (i = 0; i < 5; i++) {
    if (result[i].status === 'correct') continue;
    if (targetCounts[guess[i]] && targetCounts[guess[i]] > 0) {
      result[i].status = 'present';
      targetCounts[guess[i]]--;
    }
  }

  return result;
}

/**
 * Submits the current row as a guess. Returns updated state with feedback.
 * @param {GameState} state - Current game state
 * @returns {{ state: GameState, feedback: LetterFeedback[] | null, error: string | null }}
 */
function submitGuess(state) {
  if (state.status !== 'playing') {
    return { state: state, feedback: null, error: null };
  }
  if (state.currentInput.length < 5) {
    return { state: state, feedback: null, error: 'Not enough letters!' };
  }

  var guessWord = state.currentInput.join('');
  var feedback = computeFeedback(guessWord, state.targetWord);
  var newGuesses = state.guesses.concat([state.currentInput.slice()]);
  var newFeedbacks = state.feedbacks.concat([feedback]);
  var newRow = state.currentRow + 1;
  var newStatus = 'playing';

  if (guessWord === state.targetWord) {
    newStatus = 'won';
  } else if (newRow >= 6) {
    newStatus = 'lost';
  }

  var newState = {
    targetWord: state.targetWord,
    guesses: newGuesses,
    feedbacks: newFeedbacks,
    currentInput: [],
    currentRow: newRow,
    status: newStatus
  };

  return { state: newState, feedback: feedback, error: null };
}

/**
 * Computes the best-known status for each letter A-Z across all guesses.
 * correct > present > absent > unused
 * @param {GameState} state - Current game state
 * @returns {Object<string, string>} - Map of letter -> status
 */
function getKeyboardStatuses(state) {
  var priority = { correct: 3, present: 2, absent: 1 };
  var statuses = {};

  for (var i = 0; i < state.feedbacks.length; i++) {
    var fb = state.feedbacks[i];
    for (var j = 0; j < fb.length; j++) {
      var letter = fb[j].letter;
      var status = fb[j].status;
      var current = statuses[letter];
      if (!current || (priority[status] || 0) > (priority[current] || 0)) {
        statuses[letter] = status;
      }
    }
  }

  return statuses;
}

// ===== UI Module =====

var UI = (function () {

  function initGrid() {
    var container = document.getElementById('grid-container');
    if (!container) return;
    container.innerHTML = '';
    for (var r = 0; r < 6; r++) {
      var row = document.createElement('div');
      row.className = 'grid-row';
      for (var c = 0; c < 5; c++) {
        var tile = document.createElement('div');
        tile.className = 'tile';
        tile.setAttribute('data-row', r);
        tile.setAttribute('data-col', c);
        row.appendChild(tile);
      }
      container.appendChild(row);
    }
  }

  function getTile(row, col) {
    return document.querySelector('.tile[data-row="' + row + '"][data-col="' + col + '"]');
  }

  function updateTile(row, col, letter, status) {
    var tile = getTile(row, col);
    if (!tile) return;
    tile.textContent = letter || '';
    tile.classList.remove('correct', 'present', 'absent');
    if (status) {
      tile.classList.add(status);
    }
  }

  function revealRow(row, feedback, callback) {
    for (var i = 0; i < feedback.length; i++) {
      (function (idx) {
        setTimeout(function () {
          var tile = getTile(row, idx);
          if (tile) {
            tile.classList.add('flip');
            setTimeout(function () {
              tile.textContent = feedback[idx].letter;
              tile.classList.remove('correct', 'present', 'absent');
              tile.classList.add(feedback[idx].status);
            }, 250);
          }
          if (idx === feedback.length - 1 && callback) {
            setTimeout(callback, 300);
          }
        }, idx * 300);
      })(i);
    }
  }

  function updateKeyboard(statuses) {
    var keys = document.querySelectorAll('.key');
    for (var i = 0; i < keys.length; i++) {
      var keyEl = keys[i];
      var letter = keyEl.getAttribute('data-key');
      if (letter && letter.length === 1) {
        keyEl.classList.remove('correct', 'present', 'absent');
        if (statuses[letter]) {
          keyEl.classList.add(statuses[letter]);
        }
      }
    }
  }

  function showToast(message) {
    var container = document.getElementById('toast-container');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('fade-out');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 500);
    }, 1500);
  }

  function showGameOver(won, targetWord, guessCount) {
    var overlay = document.getElementById('game-over-overlay');
    var msgEl = document.getElementById('game-over-message');
    var wordEl = document.getElementById('game-over-word');
    if (!overlay || !msgEl) return;
    if (won) {
      msgEl.textContent = '🎉 Amazing! You got it in ' + guessCount + ' guess' + (guessCount !== 1 ? 'es' : '') + '!';
    } else {
      msgEl.textContent = '😢 So close! Better luck next time!';
    }
    if (wordEl) {
      wordEl.textContent = targetWord;
    }
    overlay.classList.remove('hidden');
  }

  function resetUI() {
    initGrid();
    // Reset keyboard colors
    var keys = document.querySelectorAll('.key');
    for (var i = 0; i < keys.length; i++) {
      keys[i].classList.remove('correct', 'present', 'absent');
    }
    // Hide overlays
    var overlay = document.getElementById('game-over-overlay');
    if (overlay) overlay.classList.add('hidden');
    // Clear toasts
    var toastContainer = document.getElementById('toast-container');
    if (toastContainer) toastContainer.innerHTML = '';
    // Hide error
    var errorScreen = document.getElementById('wordle-error-screen');
    if (errorScreen) errorScreen.classList.add('hidden');
  }

  function showError(message) {
    var errorScreen = document.getElementById('wordle-error-screen');
    var errorMsg = document.getElementById('wordle-error-message');
    var gameArea = document.getElementById('wordle-game-area');
    if (errorMsg) errorMsg.textContent = message;
    if (errorScreen) errorScreen.classList.remove('hidden');
    if (gameArea) gameArea.classList.add('hidden');
  }

  return {
    initGrid: initGrid,
    updateTile: updateTile,
    revealRow: revealRow,
    updateKeyboard: updateKeyboard,
    showToast: showToast,
    showGameOver: showGameOver,
    resetUI: resetUI,
    showError: showError
  };
})();

// ===== Orchestrator =====

var Orchestrator = (function () {
  var wordBank = [];
  var gameState = null;

  function updateCurrentRow() {
    if (!gameState) return;
    var row = gameState.currentRow;
    for (var c = 0; c < 5; c++) {
      var letter = gameState.currentInput[c] || '';
      UI.updateTile(row, c, letter, null);
    }
  }

  function handleKeyPress(key) {
    if (!gameState || gameState.status !== 'playing') return;

    var upperKey = key.toUpperCase();

    if (upperKey === 'ENTER') {
      var result = submitGuess(gameState);
      if (result.error) {
        UI.showToast(result.error);
        return;
      }
      if (result.feedback) {
        gameState = result.state;
        var revealRow = gameState.currentRow - 1;
        UI.revealRow(revealRow, result.feedback, function () {
          UI.updateKeyboard(getKeyboardStatuses(gameState));
          if (gameState.status === 'won') {
            WordTracker.markUsed(gameState.targetWord);
            UI.showGameOver(true, gameState.targetWord, gameState.guesses.length);
          } else if (gameState.status === 'lost') {
            WordTracker.markUsed(gameState.targetWord);
            UI.showGameOver(false, gameState.targetWord, gameState.guesses.length);
          }
        });
      }
    } else if (upperKey === 'BACKSPACE' || upperKey === 'DELETE') {
      gameState = deleteLetter(gameState);
      updateCurrentRow();
    } else if (/^[A-Z]$/.test(upperKey)) {
      gameState = addLetter(gameState, upperKey);
      updateCurrentRow();
    }
  }

  function startNewRound() {
    var target = WordTracker.pickUnusedWord(wordBank);
    gameState = createGame(target);
    UI.resetUI();
  }

  async function launchWordle() {
    try {
      wordBank = await loadWordBank('wordle-words.json');
    } catch (err) {
      UI.showError(err.message);
      return;
    }
    UI.initGrid();
    startNewRound();

    // Physical keyboard
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var key = e.key;
      if (key === 'Enter') {
        e.preventDefault();
        handleKeyPress('ENTER');
      } else if (key === 'Backspace') {
        e.preventDefault();
        handleKeyPress('BACKSPACE');
      } else if (/^[a-zA-Z]$/.test(key)) {
        handleKeyPress(key.toUpperCase());
      }
    });

    // Virtual keyboard clicks
    var keys = document.querySelectorAll('.key');
    for (var i = 0; i < keys.length; i++) {
      keys[i].addEventListener('click', function () {
        var k = this.getAttribute('data-key');
        if (k) handleKeyPress(k);
      });
    }

    // Play Again button
    var playAgainBtn = document.getElementById('play-again-btn-wordle');
    if (playAgainBtn) {
      playAgainBtn.addEventListener('click', function () {
        startNewRound();
      });
    }

    // Close overlay button — lets player review their game
    var closeBtn = document.getElementById('close-overlay-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        document.getElementById('game-over-overlay').classList.add('hidden');
      });
    }
  }

  return {
    launchWordle: launchWordle,
    handleKeyPress: handleKeyPress,
    startNewRound: startNewRound
  };
})();

// ===== Boot =====
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {
    Orchestrator.launchWordle();

    // Suppress right-click context menu
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    // Settings menu toggle
    var settingsBtn = document.getElementById('wordle-settings-btn');
    var settingsMenu = document.getElementById('wordle-settings-menu');
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        settingsMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', function () {
        settingsMenu.classList.add('hidden');
      });
    }

    // Reset words button
    var resetWordsBtn = document.getElementById('reset-words-btn');
    if (resetWordsBtn) {
      resetWordsBtn.addEventListener('click', function () {
        WordTracker.reset();
        settingsMenu.classList.add('hidden');
        alert('Word list has been reset! All words are available again.');
      });
    }
  });
}

// ===== Module exports for testing =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isValidWord: isValidWord,
    loadWordBank: loadWordBank,
    pickRandomWord: pickRandomWord,
    WordTracker: WordTracker,
    createGame: createGame,
    addLetter: addLetter,
    deleteLetter: deleteLetter,
    computeFeedback: computeFeedback,
    submitGuess: submitGuess,
    getKeyboardStatuses: getKeyboardStatuses,
    UI: UI,
    Orchestrator: Orchestrator
  };
}
